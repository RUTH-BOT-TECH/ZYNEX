/**
 * lib/viewOncePending.js — "eventually open" for `.vv`.
 *
 * The live log showed the real failure shape:
 *
 *   [VV] node inventory. keys=["interactiveAnnotations","scanLengths",
 *        "annotations","viewOnce"] directPath=MISSING url=MISSING mediaKey=MISSING
 *   [VV] all routes failed. stanzaId=AC1CA7EF… original=not-stored cached=no
 *        routes=["… No valid media URL or directPath present in message" ×3]
 *
 * That is a `view_once_unavailable_fanout` stand-in: a WEB companion never
 * receives the media at all. Two things make it recoverable in practice:
 *
 *  1. Once the socket presents the ANDROID identity the session was linked
 *     as, WhatsApp DOES fanout the media — but the switch/history sync can
 *     land a few seconds after the user already typed `.vv`.
 *  2. `precacheMedia()` writes bytes on arrival, keyed by the same stanzaId
 *     the quote carries.
 *
 * So instead of firing a terminal "nothing can recover it" at a keyless stub,
 * `.vv` registers the stanzaId here. Any `messages.upsert` that later delivers
 * that id (or the same media in an append/history batch) unlocks it
 * automatically — one send, no duplicate, no retry storm. A single bounded
 * timer gives an actionable answer if nothing ever arrives.
 *
 * Never throws: this is on the message hot path.
 */

const WAIT_MS = Number(process.env.VV_PENDING_WAIT_MS || 90000);
const pending = new Map();

function keyOf(x) {
  return String(x || '').trim();
}

/**
 * Register a `.vv` that saw a keyless view-once stub.
 * `ctx` = { stanzaId, sock, from, msg, reply, toOwner, ownerJid }
 */
async function register(ctx) {
  const id = keyOf(ctx.stanzaId);
  if (!id) return false;

  // A second `.vv` on the same item just extends the window, it must not
  // create a second delivery.
  const existing = pending.get(id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => timeout(id), WAIT_MS);
    if (existing.timer.unref) existing.timer.unref();
    return true;
  }

  const job = {
    ...ctx,
    id,
    at: Date.now(),
    timer: null,
    done: false,
  };
  pending.set(id, job);
  job.timer = setTimeout(() => timeout(id), WAIT_MS);
  if (job.timer.unref) job.timer.unref();
  console.log(`[VV-PENDING] queued ${id} — waiting up to ${WAIT_MS / 1000}s for the media to arrive`);
  return true;
}

function timeout(id) {
  const job = pending.get(id);
  if (!job || job.done) return;
  job.done = true;
  pending.delete(id);
  try {
    job.reply(
      '⏳ *Still no media for that view-once.*\n\n' +
        'This bot is being seen by WhatsApp as a **WEB/Chrome companion**. Since the November 2026 ' +
        'update, WhatsApp does not deliver view-once photos or videos to WEB companions — it sends an ' +
        'empty stub with no media key, so there is nothing for any bot to download.\n\n' +
        '*Fix (one time):*\n' +
        '1. Set `DEVICE_IDENTITY=android` on the host (or let the bot auto-match `creds.platform`)\n' +
        '2. **Re-pair** the session — log out the linked device and pair again with that value set\n' +
        '3. Send a NEW view-once, then reply `.vv`\n\n' +
        '_Already-linked Android sessions are matched automatically; no re-pair needed for those._',
    );
  } catch { /* socket may be gone */ }
}

/**
 * Called for EVERY incoming `messages.upsert`. If the id we were waiting for
 * arrives with real media, capture it and deliver the unlocked item.
 */
async function onMessage(m) {
  if (!m || !pending.size) return;
  const id = keyOf(m?.key?.id);
  const job = pending.get(id);
  if (!job || job.done) return;

  try {
    const mediaCache = require('./mediaCache');
    const wrapper = mediaCache.findMediaWrapper(m.message);
    if (!wrapper) return; // still a stub — keep waiting

    // A stub can carry a media node with no key/address. Only a real node is
    // worth capturing; `precacheMedia` is the authority on that.
    const typeKey = Object.keys(wrapper)[0];
    const node = wrapper[typeKey];
    if (!node || !(node.mediaKey && (node.url || node.directPath))) return;

    let bytes = mediaCache.getCachedMedia(id);
    if (!bytes) {
      await mediaCache.precacheMedia(m);
      bytes = mediaCache.getCachedMedia(id);
    }
    if (!bytes || !bytes.length) return;

    const meta = mediaCache.getCachedMediaMeta(id) || { kind: mediaCache.typeFromMimetype(node.mimetype) };
    await deliver(job, bytes, meta, node);
    job.done = true;
    clearTimeout(job.timer);
    pending.delete(id);
    console.log(`[VV-PENDING] delivered ${id} (${bytes.length} bytes, ${meta.kind})`);
  } catch (e) {
    console.log(`[VV-PENDING] delivery failed for ${id}: ${e.message}`);
  }
}

async function deliver(job, bytes, meta, node) {
  // Lazy require: vv.js requires this module at load time, so requiring it
  // back at module scope would be a cycle.
  const vv = require('./commands/vv');
  const { payloadFor } = vv._internals;
  let type = meta.kind;
  if (!['image', 'video', 'audio', 'document'].includes(type)) {
    type = type === 'sticker' ? 'image' : mediaTypeOf(node.mimetype);
  }
  const descriptor = {
    mimetype: meta.mimetype || node?.mimetype,
    fileName: meta.fileName || node?.fileName,
    caption: meta.caption || node?.caption,
    ptt: meta.ptt,
  };
  const destination = job.toOwner && job.ownerJid ? job.ownerJid : job.from;
  const caption =
    (descriptor.caption ? `${descriptor.caption}\n\n` : '') +
    '🔓 *View-once unlocked* (delivered as soon as the media arrived)\n' +
    `👤 From: ${job.msg?.pushName || 'Unknown'}`;
  await job.sock.sendMessage(
    destination,
    { ...payloadFor(type, bytes, descriptor), caption },
    { quoted: job.msg },
  );
  if (job.toOwner && job.ownerJid && job.ownerJid !== job.from) {
    try { await job.reply('🔒 Sent privately to the owner.'); } catch {}
  }
}

function mediaTypeOf(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

function cancel(id) {
  const job = pending.get(keyOf(id));
  if (!job) return;
  clearTimeout(job.timer);
  pending.delete(keyOf(id));
}

function stats() {
  return { waiting: pending.size, ids: [...pending.keys()] };
}

module.exports = { register, onMessage, cancel, stats, WAIT_MS, _internals: { pending, deliver } };
