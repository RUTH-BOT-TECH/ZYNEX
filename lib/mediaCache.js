'use strict';
/**
 * Capture media the moment it arrives; serve it from disk later.
 *
 * Why this exists
 * ───────────────
 * `.vv` (unlock view-once) can only work if the media was obtained BEFORE
 * WhatsApp deletes it. Two hard deadlines:
 *
 *   • A view-once item is removed from WhatsApp's servers once it is opened.
 *   • The sender's device may also drop it for a linked companion.
 *
 * So "reply .vv later" is fundamentally too late unless the bytes were already
 * captured. That is what happened in production: the user replied to a photo
 * that had just been sent, and the log said `original=not-stored` — nothing was
 * kept, so nothing could be unlocked.
 *
 * What this module does
 * ─────────────────────
 * On arrival (both `notify` and `append` batches), for any image/video/audio/
 * document — including inside view-once wrappers — it downloads the bytes and
 * writes them to disk, keyed by message id. `.vv` then reads the file.
 *
 * Bounded on purpose: a small LRU with a byte budget and an age limit, pruned
 * on every write, so this cannot fill the volume.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_ENTRIES = 300;
const MAX_BYTES = 200 * 1024 * 1024;   // 200 MB total
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ITEM_BYTES = 32 * 1024 * 1024;

function cacheDir() {
  const root = require('./paths').AUTH_DIR;
  const dir = require('./paths').mediaCacheDir;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // fall back to tmp if the volume is read-only
    const tmp = path.join(os.tmpdir(), 'zynex-media-cache');
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
    return tmp;
  }
  return dir;
}

const fileFor = (id) => path.join(cacheDir(), `${String(id).replace(/[^\w.-]/g, '_')}.bin`);
const metaPath = () => path.join(cacheDir(), 'index.json');

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function writeIndex(idx) {
  try {
    fs.writeFileSync(metaPath(), JSON.stringify(idx));
  } catch {}
}

/** Drop expired entries and enforce the size/entry budget. */
function prune(idx) {
  const now = Date.now();
  const kept = [];
  for (const e of idx.entries) {
    if (now - e.at > MAX_AGE_MS) {
      try { fs.rmSync(fileFor(e.id), { force: true }); } catch {}
      continue;
    }
    kept.push(e);
  }
  let total = kept.reduce((n, e) => n + (e.bytes || 0), 0);
  while (kept.length > MAX_ENTRIES || total > MAX_BYTES) {
    const gone = kept.shift();
    if (!gone) break;
    total -= gone.bytes || 0;
    try { fs.rmSync(fileFor(gone.id), { force: true }); } catch {}
  }
  return { entries: kept };
}

/** Unwrap every container WhatsApp uses to find the media node. */
function findMedia(message) {
  let m = message;
  for (let depth = 0; depth < 6 && m; depth++) {
    const media = m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage;
    if (media) return media;
    m =
      m.viewOnceMessageV2Extension?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessage?.message ||
      m.ephemeralMessage?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message;
  }
  return null;
}

/**
 * Like findMedia, but keeps the node wrapped under its own key.
 *
 * findMedia returns the inner `imageMessage` — which is what most callers want,
 * but NOT what downloadMediaMessage wants. It runs getContentType on whatever it
 * is given, so a bare `{ mimetype, mediaKey, directPath }` has no content type
 * and fails looking like missing media.
 *
 * Returns `{ imageMessage: node }` (or video/audio/document), or null.
 */
function findMediaWrapper(message) {
  let m = message;
  for (let depth = 0; depth < 6 && m; depth++) {
    for (const k of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
      if (m[k]) return { [k]: m[k] };
    }
    m =
      m.viewOnceMessageV2Extension?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessage?.message ||
      m.ephemeralMessage?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message;
  }
  return null;
}

/**
 * Download and persist the media attached to `msg`, if any.
 * Returns the cache entry, or null when there is nothing to cache.
 * Never throws: this runs on the message hot path.
 */
async function precacheMedia(msg, { downloadMediaMessage } = {}) {
  try {
    if (!msg?.key?.id || !msg.message) return null;

    /*
     * findMediaWrapper keeps the node under its type key — `{ imageMessage: n }`
     * — which is the shape both download functions want. findMedia returns the
     * bare node with the key stripped, and `media.imageMessage` then reads
     * undefined on it, so every branch below silently found nothing.
     */
    const wrapper = findMediaWrapper(msg.message);
    if (!wrapper) return null;
    const typeKey = Object.keys(wrapper)[0];              // 'imageMessage'
    const kind = typeKey.replace(/Message$/, '');         // 'image'
    const media = wrapper[typeKey];                       // the node itself

    /*
     * ★ TWO RULES TAKEN FROM BOTS THAT ACTUALLY UNLOCK VIEW-ONCE.
     *
     * 1. DO NOT require a visible mediaKey or url before trying.
     *
     *    This used to bail out with
     *        if (!media.mediaKey || !(media.url || media.directPath)) return null;
     *    which is exactly the shape a view-once arrives in — so the one case
     *    worth capturing was the one case that refused to try. The working
     *    implementations do not pre-check at all; they just call
     *    downloadMediaMessage and let it fail:
     *
     *        const vo = m.message?.viewOnceMessageV2?.message || ...
     *        const buf = await downloadMediaMessage({ key: m.key, message: vo }, 'buffer', {})
     *
     *    A failed attempt costs one caught error. A skipped attempt costs the
     *    media, permanently, because WhatsApp deletes it server-side.
     *
     * 2. Pass the UNWRAPPED content, not the envelope.
     *
     *    downloadMediaMessage runs getContentType on whatever it is given. Hand
     *    it `{ viewOnceMessageV2: { message: {...} } }` and it takes the
     *    wrapper as the content node, finds no url on it, and fails with
     *    "No valid media URL or directPath present in message" — an error about
     *    the wrong object, not about the media.
     */
    if (media.fileLength && Number(media.fileLength) > MAX_ITEM_BYTES) return null;

    const target = fileFor(msg.key.id);
    if (fs.existsSync(target)) return { id: msg.key.id, path: target, cached: true };

    /**
     * ★ THE PRIMITIVE, NOT THE HELPER.
     *
     * `downloadMediaMessage` inspects a message object: it runs getContentType,
     * unwraps whatever it finds, and rebuilds the download from the wrapper it
     * picked. Every failure in this area lived in that inspection rather than in
     * the media — "No valid media URL or directPath present in message" is it
     * looking at a wrapper and finding no url.
     *
     * `downloadContentFromMessage(node, kind)` takes the media node and a word
     * ('image', 'video', 'audio', 'document') and nothing else. No message key,
     * no remoteJid, no stanza, no content-type guessing. There is nothing left
     * to misidentify.
     *
     *   const stream = await downloadContentFromMessage(vo[kind + 'Message'], kind)
     *   const chunks = []
     *   for await (const c of stream) chunks.push(c)
     *
     * `downloadMediaMessage` is still honoured when a caller injects one (the
     * tests do), but the production path uses the primitive.
     */
    let buffer;
    if (downloadMediaMessage) {
      // injected (tests): keep the exact shape the caller expects
      buffer = await downloadMediaMessage({ key: msg.key, message: wrapper }, 'buffer', {}, {});
    } else {
      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(media, kind);
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      buffer = Buffer.concat(chunks);
    }

    if (!buffer || !buffer.length) return null;

    fs.writeFileSync(target, buffer);
    const idx = readIndex();
    idx.entries.push({
      id: msg.key.id,
      bytes: buffer.length,
      at: Date.now(),
      mimetype: media.mimetype || null,
      kind: media.imageMessage ? 'image' : 'media',
    });
    // Prune AFTER inserting: pruning first lets the new entry push the cache one
    // over the limit, which is how this reached 301 entries.
    writeIndex(prune(idx));
    console.log(`[CACHE] captured ${msg.key.id} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return { id: msg.key.id, path: target, bytes: buffer.length };
  } catch (e) {
    // Silent by design: a cache miss must never break message handling, but log
    // once so a systematically failing path is visible.
    const key = e?.message || 'unknown';
    if (!precacheMedia._seen) precacheMedia._seen = new Set();
    if (!precacheMedia._seen.has(key)) {
      precacheMedia._seen.add(key);
      console.log(`[CACHE] could not capture media: ${key}`);
    }
    return null;
  }
}

/** Read a previously captured item, or null. */
function getCachedMedia(id) {
  if (!id) return null;
  try {
    const p = fileFor(id);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function cacheStats() {
  const idx = readIndex();
  return {
    entries: idx.entries.length,
    bytes: idx.entries.reduce((n, e) => n + (e.bytes || 0), 0),
    dir: cacheDir(),
  };
}

module.exports = { precacheMedia, getCachedMedia, cacheStats, findMedia, findMediaWrapper, _internals: { cacheDir, fileFor } };
