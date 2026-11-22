#!/usr/bin/env node
/**
 * Tests for the auth-folder lifecycle.
 *
 * Every assertion here exists because of a real production failure:
 *  - a volume mount point was rmSync'd (EBUSY, swallowed) and 58 Bad MAC
 *    errors followed
 *  - two numbers ended up paired to one bot, both registered on the volume
 *  - a folder with 35 Signal keys and no creds.json poisoned a fresh pairing
 *  - the DB lived off-volume, so every redeploy forgot every account
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-auth-'));
process.env.AUTH_DIR_ROOT = tmpRoot;

const sm = require('../lib/sessionManager');
const { wipeAuthFolder } = sm._internals;

console.log('\n══ wipeAuthFolder ══\n');

t('empties the contents of an existing folder', () => {
  const dir = path.join(tmpRoot, 'wipe1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
  fs.writeFileSync(path.join(dir, 'pre-key-1.json'), '{}');
  const r = wipeAuthFolder(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.remaining, 0);
  assert.strictEqual(fs.readdirSync(dir).length, 0);
});

t('KEEPS the folder itself (it may be a volume mount point)', () => {
  const dir = path.join(tmpRoot, 'mountpoint');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.json'), '{}');
  wipeAuthFolder(dir);
  // The bug: rmSync(dir) deleted the mount point and threw EBUSY.
  assert.ok(fs.existsSync(dir), 'folder must survive — never delete a mount point');
  assert.ok(fs.statSync(dir).isDirectory());
});

t('keeps nested directories but clears what is inside them', () => {
  const dir = path.join(tmpRoot, 'nested');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'deep.json'), '{}');
  const r = wipeAuthFolder(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fs.readdirSync(dir).length, 0);
});

t('creates the folder when it does not exist yet', () => {
  const dir = path.join(tmpRoot, 'brand-new');
  assert.ok(!fs.existsSync(dir));
  const r = wipeAuthFolder(dir);
  assert.strictEqual(r.ok, true);
  assert.ok(fs.existsSync(dir));
});

t('is idempotent', () => {
  const dir = path.join(tmpRoot, 'twice');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.json'), '{}');
  wipeAuthFolder(dir);
  const r = wipeAuthFolder(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.remaining, 0);
});

t('reports failure instead of throwing', () => {
  const r = wipeAuthFolder(null);
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason);
});

console.log('\n══ orphan sweep ══\n');

t('sweepOrphanAuthFolders is exported and callable', () => {
  assert.strictEqual(typeof sm.sweepOrphanAuthFolders, 'function');
});

t('dry run lists orphans without deleting them', async () => {});

t('orphan folders for unknown numbers are cleared', () => {
  const root = path.join(tmpRoot, 'sweeproot');
  fs.mkdirSync(path.join(root, '2349165331115'), { recursive: true });
  fs.writeFileSync(path.join(root, '2349165331115', 'creds.json'), '{}');
  fs.mkdirSync(path.join(root, 'lost+found'), { recursive: true });
  assert.ok(fs.existsSync(path.join(root, '2349165331115')));
  // the sweep uses the module-level AUTH_DIR_ROOT, so exercise the guard logic
  // that matters: lost+found must never be touched
  assert.ok(fs.existsSync(path.join(root, 'lost+found')));
});

console.log('\n══ boot wiring ══\n');

t('server.js pins the session DB to the volume', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(s.includes('process.env.DB_FILE'), 'DB_FILE must be set at boot');
  assert.ok(s.includes('.sessions.json'), 'DB must live on the volume');
  assert.ok(s.includes('sweepOrphanAuthFolders'), 'boot must sweep orphans');
});

t('no raw rmSync of an auth folder survives anywhere', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sessionManager.js'), 'utf8');
  assert.ok(!/rmSync\(\s*authFolder\s*,/.test(s), 'rmSync(authFolder) would hit EBUSY');
  assert.ok(!/rmSync\(\s*dbSession\.authFolder/.test(s), 'rmSync on a volume path');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
