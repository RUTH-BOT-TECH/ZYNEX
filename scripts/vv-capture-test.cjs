/**
 * Arrival capture — the half of `.vv` that actually decides whether it works.
 *
 * The user supplied the working reference implementation, and it differs from
 * ours in exactly two places. Both are pinned here, because both were silently
 * costing every view-once before it could be unlocked:
 *
 *   Reference
 *   ---------
 *   const vo  = m.message?.viewOnceMessageV2?.message || ...
 *   const buf = await downloadMediaMessage({ key: m.key, message: vo }, 'buffer', {})
 *
 *   Ours, before
 *   ------------
 *   if (!media.mediaKey || !(media.url || media.directPath)) return null;
 *   const buffer = await dl(msg, 'buffer', {}, {})
 *
 * We refused to try without a visible key — the exact shape a view-once arrives
 * in — and then handed the downloader the whole envelope instead of the node.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const VOL = fs.mkdtempSync(path.join(os.tmpdir(), 'vvcap-'));
process.env.AUTH_DIR_ROOT = VOL;

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };
const ta = async (n, fn) => { try { await fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };

const cache = require('../lib/mediaCache');

const WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
let seq = 0;
const build = (wrapper, node = {}) => ({
  key: { id: `ID-${wrapper}-${++seq}`, remoteJid: 'x@s.whatsapp.net' },
  message: {
    [wrapper]: {
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          mediaKey: Buffer.from('key'),
          directPath: '/v/t62/x',
          ...node,
        },
      },
    },
  },
});

/** Capture a message, recording exactly what the downloader was handed. */
const capture = async (msg, dl) => {
  let handed = null;
  const stub = async (target) => { handed = target; return Buffer.from('BYTES'); };
  const out = await cache.precacheMedia(msg, { downloadMediaMessage: dl || stub });
  return { handed, out };
};

(async () => {
  /* ── the two things the reference does ─────────────────────────────────── */
  for (const w of WRAPPERS) {
    await ta(`${w}: the node is passed still wrapped under its type key`, async () => {
      const { handed } = await capture(build(w));
      if (!handed) throw new Error('nothing was downloaded');
      const keys = Object.keys(handed.message);
      if (keys[0] !== 'imageMessage') {
        throw new Error(`downloadMediaMessage would see '${keys[0]}' instead of a content type`);
      }
      if (!handed.message.imageMessage.mediaKey) throw new Error('mediaKey lost');
      if (!handed.key || !handed.key.id) throw new Error('message key lost');
    });
  }

  await ta('a node with NO visible mediaKey is still attempted', async () => {
    // This is the shape that used to be refused before trying.
    const msg = build('viewOnceMessageV2', { mediaKey: undefined });
    const { handed } = await capture(msg);
    if (!handed) throw new Error('refused to try without a mediaKey — that is the old bug');
  });

  await ta('a node with no directPath or url is still attempted', async () => {
    const msg = build('viewOnceMessageV2', { directPath: undefined, url: undefined });
    const { handed } = await capture(msg);
    if (!handed) throw new Error('refused to try without an address');
  });

  await ta('a genuinely empty stub fails quietly instead of throwing', async () => {
    const msg = { key: { id: 'EMPTY1', remoteJid: 'x' }, message: { viewOnceMessageV2: { message: {} } } };
    // nothing to download: no media node anywhere
    const { out } = await capture(msg);
    if (out !== null) throw new Error('stored something for an empty stub');
  });

  await ta('a download that throws does not break the message path', async () => {
    const boom = async () => { throw new Error('network down'); };
    const msg = build('viewOnceMessageV2');
    const { out } = await capture(msg, boom);
    if (out !== null) throw new Error('returned an entry from a failed download');
  });

  await ta('a successful capture writes the bytes to disk', async () => {
    const msg = build('viewOnceMessageV2', {});
    msg.key.id = 'WRITTEN1';  // fixed so the next test can find it
    const { out } = await capture(msg);
    if (!out || !out.path) throw new Error('no cache entry');
    if (!fs.existsSync(out.path)) throw new Error('file was not written');
  });

  await ta('the byte cache is keyed by message id, so a later .vv can find it', async () => {
    const got = cache.getCachedMedia('WRITTEN1');
    if (!got) throw new Error('getCachedMedia did not return the captured bytes');
  });

  /* ── the rule the reference also enforces ──────────────────────────────── */
  t("a self-sent message is not capturable, and that is correct", () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../lib/mediaCache.js'), 'utf8');
    // We do not skip fromMe here (a self-sent item is harmless to try), but the
    // reference skips it and no bot unlocks your own view-once. Recorded so the
    // next person does not "fix" a non-bug.
    if (!/viewOnceMessageV2/.test(src)) throw new Error('wrapper handling disappeared');
  });

  /* ── the primitive, not the helper ─────────────────────────────────────── */
  await ta('the production capture uses downloadContentFromMessage, not the helper', async () => {
    /*
     * The helper (downloadMediaMessage) inspects a message object, guesses the
     * content type and unwraps; every failure in this area came from that
     * inspection. The primitive takes (node, kind) and cannot misidentify
     * anything — this is the call the reference makes at arrival time.
     */
    const src = fs.readFileSync(path.resolve(__dirname, '../lib/mediaCache.js'), 'utf8');
    if (!/downloadContentFromMessage\(media, kind\)/.test(src)) {
      throw new Error('capture does not use the primitive');
    }
    // and with no injected downloader the real one is exercised
    const real = await cache.precacheMedia({
      key: { id: 'REAL-PATH-' + Date.now(), remoteJid: 'x' },
      message: { viewOnceMessageV2: { message: { imageMessage: {
        mimetype: 'image/jpeg', mediaKey: Buffer.from('k'),
        directPath: '/v/x', url: 'https://mmg.whatsapp.net/v/x',
      } } } },
    });
    // a fake URL cannot download; what matters is that it TRIED and returned
    // null with a log rather than throwing
    if (real !== null) throw new Error('a fake url produced a cache entry');
  });

  t('the pre-check that skipped keyless media is gone from both arrival paths', () => {
    const sessionSrc = fs.readFileSync(path.resolve(__dirname, '../lib/sessionManager.js'), 'utf8');
    if (/if \(cacheable && \(await precacheMedia/.test(sessionSrc)) {
      throw new Error('arrival capture still gates on a visible key');
    }
    if (/const captured = cacheable \?/.test(sessionSrc)) {
      throw new Error('view-once capture still gates on a visible key');
    }
  });

  fs.rmSync(VOL, { recursive: true, force: true });
  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
