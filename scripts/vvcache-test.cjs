#!/usr/bin/env node
/**
 * The media cache: capture on arrival, serve on `.vv`.
 *
 * Production log that motivated this:
 *
 *   [VV] no media URL. stanzaId=ACA790624A2C25F5130BD0CABD2B7276 original=not-stored
 *
 * The user had just sent a photo, replied `.vv`, and there was nothing to work
 * with — because nothing was ever captured, and because `append` batches were
 * discarded wholesale before media was looked at. View-once media is deleted by
 * WhatsApp the moment it is opened, so "reply later" can only ever work if the
 * bytes were taken on arrival.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-vvcache-'));
process.env.AUTH_DIR_ROOT = path.join(tmp, 'auth_state');
fs.mkdirSync(process.env.AUTH_DIR_ROOT, { recursive: true });

const mediaCache = require(path.join(ROOT, 'lib', 'mediaCache.js'));

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const MEDIA = Buffer.from('x'.repeat(4096));

function viewOnceMessage(id) {
  return {
    key: { id, remoteJid: '123@g.us', fromMe: false },
    message: {
      viewOnceMessageV2Extension: {
        message: {
          imageMessage: {
            mediaKey: 'k',
            url: 'https://mmg.whatsapp.net/x',
            mimetype: 'image/jpeg',
            fileLength: 4096,
          },
        },
      },
    },
  };
}

(async () => {
  console.log('\n══ unwrapping ══\n');

  await t('media is found inside a view-once wrapper', () => {
    const node = mediaCache.findMedia(viewOnceMessage('A').message);
    assert.ok(node, 'view-once wrapper was not unwrapped');
    assert.strictEqual(node.mimetype, 'image/jpeg');
  });

  await t('media is found through nested wrappers', () => {
    const node = mediaCache.findMedia({
      ephemeralMessage: {
        message: {
          viewOnceMessageV2: {
            message: { videoMessage: { mediaKey: 'k', url: 'u', mimetype: 'video/mp4' } },
          },
        },
      },
    });
    assert.ok(node, 'nested wrapper not unwrapped');
  });

  await t('a text message yields nothing', () => {
    assert.strictEqual(mediaCache.findMedia({ extendedTextMessage: { text: 'hi' } }), null);
  });

  console.log('\n══ capture on arrival ══\n');

  await t('a view-once is downloaded and stored on disk', async () => {
    const entry = await mediaCache.precacheMedia(viewOnceMessage('VV1'), {
      downloadMediaMessage: async () => MEDIA,
    });
    assert.ok(entry, 'nothing captured');
    assert.ok(fs.existsSync(entry.path), 'file was not written');
  });

  await t('the captured bytes are readable afterwards', () => {
    const buf = mediaCache.getCachedMedia('VV1');
    assert.ok(buf, 'cache returned nothing');
    assert.strictEqual(buf.length, MEDIA.length);
  });

  await t('this works even though WhatsApp has since deleted the item', () => {
    // Simulate the server forgetting it: the message object is gone, only the id
    // survives in the quote. The cache is the only source left.
    const buf = mediaCache.getCachedMedia('VV1');
    assert.ok(buf && buf.length === MEDIA.length, 'a cached item must survive without the stanza');
  });

  await t('capturing twice is a no-op, not a duplicate', async () => {
    const entry = await mediaCache.precacheMedia(viewOnceMessage('VV1'), {
      downloadMediaMessage: async () => MEDIA,
    });
    assert.ok(entry.cached, 'second capture should hit the existing file');
    assert.strictEqual(mediaCache.cacheStats().entries, 1);
  });

  await t('a message with no media is ignored', async () => {
    const r = await mediaCache.precacheMedia({ key: { id: 'T1' }, message: { conversation: 'hi' } }, {
      downloadMediaMessage: async () => MEDIA,
    });
    assert.strictEqual(r, null);
  });

  await t('a download failure is swallowed, never thrown', async () => {
    const r = await mediaCache.precacheMedia(viewOnceMessage('FAIL1'), {
      downloadMediaMessage: async () => { throw new Error('boom'); },
    });
    assert.strictEqual(r, null, 'a failed capture must not break message handling');
  });

  await t('an oversized item is refused before downloading', async () => {
    const big = viewOnceMessage('BIG1');
    big.message.viewOnceMessageV2Extension.message.imageMessage.fileLength = 900 * 1024 * 1024;
    let called = false;
    const r = await mediaCache.precacheMedia(big, {
      downloadMediaMessage: async () => { called = true; return MEDIA; },
    });
    assert.strictEqual(r, null);
    assert.strictEqual(called, false, 'should not download something it will discard');
  });

  console.log('\n══ bounded storage ══\n');

  await t('the cache reports its size', () => {
    const s = mediaCache.cacheStats();
    assert.ok(s.entries >= 1);
    assert.ok(s.bytes > 0);
  });

  await t('old entries are pruned so this cannot fill the volume', async () => {
    // 320 items exceeds MAX_ENTRIES (300)
    for (let i = 0; i < 320; i++) {
      await mediaCache.precacheMedia(viewOnceMessage(`P${i}`), {
        downloadMediaMessage: async () => Buffer.from('y'.repeat(64)),
      });
    }
    const s = mediaCache.cacheStats();
    assert.ok(s.entries <= 300, `cache grew to ${s.entries} entries`);
  });

  console.log('\n══ wiring ══\n');

  await t('.vv consults the cache before the network', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'vv.js'), 'utf8');
    assert.ok(/getCachedMedia/.test(src), '.vv must read the cache');
    assert.ok(/served from the media cache/.test(src), 'and say so');
  });

  await t('media is captured for both notify and append batches', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
    const notifyBlock = src.split("sock.ev.on('messages.upsert'")[1] || '';
    const hits = (notifyBlock.match(/precacheMedia/g) || []).length;
    assert.ok(hits >= 2, `append batches were skipped (found ${hits} capture sites)`);
    assert.ok(/cached \$\{captured\} media item/.test(src), 'append path must report what it cached');
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
