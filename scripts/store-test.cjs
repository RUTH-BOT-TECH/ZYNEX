#!/usr/bin/env node
/**
 * The message store must survive a restart.
 *
 * This is the whole reason `.vv` failed in production while passing in tests.
 *
 * A quoted view-once arrives with NO mediaKey — WhatsApp strips it. The only
 * way to unlock one is to have kept the original stanza when it arrived, and
 * download against that. The store that keeps it was `new Map()`: in memory
 * only. Every redeploy emptied it, so by the time a `.vv` ran, every message
 * was "original=not-stored" and the command could only apologise.
 *
 * Eight deploys in an hour made that the normal case rather than an edge case.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-store-'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

// Each subprocess is a fresh "process restart" — require cache and module state
// both start empty, which is exactly what a redeploy does.
const run = (code) => execFileSync(process.execPath, ['-e', code], {
  cwd: ROOT,
  env: { ...process.env, AUTH_DIR_ROOT: dir, SILENT: '1' },
  encoding: 'utf8',
});

console.log('\n══ durability ══\n');

run(`
  const ad = require('./lib/anti/antiDelete');
  ad.storeMessage({
    key: { id: 'VV1', remoteJid: '123@g.us', fromMe: false },
    message: { viewOnceMessageV2Extension: { message: { imageMessage: {
      mediaKey: Buffer.alloc(32, 7),
      directPath: '/v/t62.7118-24/xyz',
      url: 'https://mmg.whatsapp.net/v/t62',
      mimetype: 'image/jpeg',
      fileLength: 4096,
    }}}},
    pushName: 'T',
  });
  setTimeout(() => process.exit(0), 2600);
`);

const out = run(`
  const ad = require('./lib/anti/antiDelete');
  const got = ad.getStoredMessage('VV1');
  if (!got) { console.log('MISSING'); process.exit(0); }
  const n = got.message.viewOnceMessageV2Extension.message.imageMessage;
  console.log(JSON.stringify({
    mediaKey: n.mediaKey ? n.mediaKey.length : null,
    intact: n.mediaKey ? Array.from(n.mediaKey).every(b => b === 7) : false,
    directPath: n.directPath || null,
    url: n.url || null,
    fileLength: n.fileLength ?? null,
  }));
`);

const parsed = JSON.parse(out.trim().split('\n').pop());
const restartOut = run(`
  const ad = require('./lib/anti/antiDelete');
  const got = ad.getStoredMessage('VV1');
  if (!got) { console.log('MISSING'); process.exit(0); }
  const n = got.message.viewOnceMessageV2Extension.message.imageMessage;
  console.log(JSON.stringify({
    mediaKey: n.mediaKey ? n.mediaKey.length : null,
    intact: n.mediaKey ? Array.from(n.mediaKey).every(b => b === 7) : false,
    directPath: n.directPath || null,
    url: n.url || null,
    fileLength: n.fileLength ?? null,
  }));
`);
const restored = JSON.parse(restartOut.trim().split('\n').pop());

t('a stored message is readable after a fresh process start', () => {
  assert.notStrictEqual(restored, 'MISSING', 'the store did not survive the restart');
});

t('the mediaKey survives the round trip', () => {
  assert.strictEqual(restored.mediaKey, 32, 'mediaKey length changed or was lost');
  assert.strictEqual(restored.intact, true,
    'mediaKey bytes were corrupted — plain JSON turns a Buffer into {"0":..} and it stops decrypting');
});

t('directPath and url survive', () => {
  assert.strictEqual(restored.directPath, '/v/t62.7118-24/xyz');
  assert.strictEqual(restored.url, 'https://mmg.whatsapp.net/v/t62');
});

t('protobuf is used, not plain JSON, for the payload', () => {
  const files = fs.readdirSync(path.join(dir, '.msg_store'));
  assert.ok(files.includes('store.json'), 'no store file written');
  const raw = JSON.parse(fs.readFileSync(path.join(dir, '.msg_store', 'store.json'), 'utf8'));
  assert.ok(raw[0].pb, 'entry was not stored as protobuf — Buffers will not survive');
});

t('the store is bounded and expires entries', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'anti', 'antiDelete.js'), 'utf8');
  assert.ok(/MAX_AGE_MS/.test(src), 'no expiry — the file would grow without limit');
  assert.ok(/MAX_STORED/.test(src), 'no entry cap');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
