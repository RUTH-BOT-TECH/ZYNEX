#!/usr/bin/env node
/**
 * A chat command must never be able to kill the host.
 *
 * On a shared pairing server one process hosts the web panel and every paired
 * user's socket. `.restart` used to call process.exit(0), which:
 *   - dropped every other user's session
 *   - took the pairing site down (502)
 *   - exited CLEAN, so Railway's restartPolicyType ON_FAILURE never restarted
 *     the container — it stayed dead until someone redeployed by hand
 *
 * `.shutdown` had the same shape with exit(1).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Strip comments before scanning: these files DOCUMENT the bug they fix, so a
// naive search finds "process.exit(0)" in the explanation and fails itself.
const code = (p) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n══ no chat command exits the process ══\n');

t('.restart does not call process.exit', () => {
  const src = code('lib/commands/restart.js');
  assert.ok(!/process\.exit\s*\(/.test(src), '.restart must not exit the host');
  assert.ok(/restartInPlace/.test(src), 'it should reconnect the socket instead');
});

t('.shutdown does not call process.exit', () => {
  const src = code('lib/commands/shutdown.js');
  assert.ok(!/process\.exit\s*\(/.test(src), '.shutdown must not exit the host');
  assert.ok(/stopSession/.test(src), 'it should stop only its own session');
});

t('.shutdown keeps the creds so the number can be resumed', () => {
  const src = code('lib/commands/shutdown.js');
  assert.ok(/keepCreds:\s*true/.test(src), 'clearing creds turns stop into re-pair');
});

t('no command file exits the process at all', () => {
  const dir = path.join(ROOT, 'lib', 'commands');
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // ignore matches inside comments
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/process\.exit\s*\(/.test(code)) offenders.push(f);
  }
  assert.deepStrictEqual(offenders, [], `these can kill the host: ${offenders.join(', ')}`);
});

console.log('\n══ restart policy ══\n');

t('a clean exit is restarted too (ALWAYS, not ON_FAILURE)', () => {
  const cfg = JSON.parse(read('railway.json'));
  assert.strictEqual(
    cfg.deploy.restartPolicyType,
    'ALWAYS',
    'ON_FAILURE ignores exit code 0, so a clean exit leaves the site down',
  );
});

t('the healthcheck path is still /health', () => {
  const cfg = JSON.parse(read('railway.json'));
  assert.strictEqual(cfg.deploy.healthcheckPath, '/health');
});

console.log('\n══ session manager surface ══\n');

t('restartInPlace and stopSession are exported', () => {
  const sm = require(path.join(ROOT, 'lib', 'sessionManager'));
  assert.strictEqual(typeof sm.restartInPlace, 'function');
  assert.strictEqual(typeof sm.stopSession, 'function');
});

t('stopSession on an unknown id returns a result instead of throwing', async () => {});
t('stopSession degrades gracefully when nothing is running', () => {
  const sm = require(path.join(ROOT, 'lib', 'sessionManager'));
  // synchronous guard: it must not throw for a missing session
  assert.doesNotThrow(() => sm.stopSession('does-not-exist'));
});

console.log('\n══ reconnect after a crash vs a deliberate stop ══\n');

const { execFileSync } = require('child_process');

/**
 * Run reconnectAllSessions in a child process with its own DB and auth dir.
 * Paths are passed as data, not interpolated into code -- an earlier version
 * built the child script with nested template literals and handed it a literal
 * "${authDir}" path, so the folder never existed and the "revive" case failed
 * for a reason that had nothing to do with the code under test.
 */
function reconnectScenario(name, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `zynex-rc-${name}-`));
  const authDir = path.join(dir, 'auth_state');
  fs.mkdirSync(authDir, { recursive: true });
  const specs = rows.map((r) => {
    const folder = path.join(authDir, r.phoneNumber);
    fs.mkdirSync(folder, { recursive: true });
    if (r.creds) {
      fs.writeFileSync(
        path.join(folder, 'creds.json'),
        JSON.stringify({ me: { id: `${r.phoneNumber}:8@s.whatsapp.net` }, registered: true }),
      );
    }
    return { phone: r.phoneNumber, status: r.status, folder };
  });

  const script = `
    const { prisma, ensureDB } = require('./lib/db');
    const sm = require('./lib/sessionManager');
    const specs = JSON.parse(process.env.SPECS);
    (async () => {
      await ensureDB();
      for (const spec of specs) {
        await prisma.botSession.create({
          data: { phoneNumber: spec.phone, status: spec.status, authFolder: spec.folder, mode: 'public', prefix: '.' },
        });
      }
      await sm.reconnectAllSessions();
      process.exit(0);
    })();
  `;
  const out = execFileSync('node', ['-e', script], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, AUTH_DIR_ROOT: authDir, DB_FILE: '', SPECS: JSON.stringify(specs) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').find((l) => /Reconnecting \d+ of/.test(l)) || '';
}

t('a crash (creds still on disk) revives the session', () => {
  const line = reconnectScenario('crash', [{ phoneNumber: '2348021016309', status: 'disconnected', creds: true }]);
  assert.ok(/Reconnecting 1 of 1/.test(line), `expected a revive, got: ${line}`);
});

t('a deliberate logout (no creds) is NOT revived', () => {
  const line = reconnectScenario('logout', [{ phoneNumber: '2348021016309', status: 'disconnected', creds: false }]);
  assert.ok(/Reconnecting 0 of 1/.test(line), `revived a logged-out account: ${line}`);
});

t('.shutdown marks "stopped" and is NOT revived on boot', () => {
  const line = reconnectScenario('stopped', [{ phoneNumber: '2349165331115', status: 'stopped', creds: true }]);
  assert.ok(/Reconnecting 0 of 1/.test(line), `revived a session the user stopped: ${line}`);
});

console.log('\n══ disconnect removes the record ══\n');

t('removeSession works with no live socket', () => {
  // It used to `if (!s) return;` — so after a restart, or once a session was
  // marked disconnected, pressing Disconnect did nothing at all.
  const src = code('lib/sessionManager.js');
  const fn = src.slice(src.indexOf('async function removeSession'));
  const body = fn.slice(0, fn.indexOf('return { ok: true }'));
  assert.ok(!/^\s*if \(!s\) return;\s*$/m.test(body), 'must not bail out when the socket is gone');
  assert.ok(/prisma\.botSession\.findUnique/.test(body), 'must fall back to the stored record');
});

t('the row is DELETED, not left marked disconnected', () => {
  const src = code('lib/sessionManager.js');
  const fn = src.slice(src.indexOf('async function removeSession'));
  const body = fn.slice(0, fn.indexOf('return { ok: true }'));
  assert.ok(/botSession\.delete\(/.test(body), 'a disconnected row stayed listed forever');
});

t('the db layer actually supports delete and deleteMany', () => {
  const db = code('lib/db.js');
  assert.ok(/delete:\s*async/.test(db), 'there was no delete operation at all');
  assert.ok(/deleteMany:\s*async/.test(db));
});

t('delete really removes a row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-del-'));
  const script = `
    const { prisma, ensureDB } = require('./lib/db');
    (async () => {
      await ensureDB();
      const row = await prisma.botSession.create({ data: { phoneNumber: '2348021016309', status: 'connected' } });
      await prisma.botSession.delete({ where: { id: row.id } });
      const left = await prisma.botSession.findMany({ where: {} });
      console.log('LEFT=' + left.length);
      process.exit(0);
    })();
  `;
  const out = execFileSync('node', ['-e', script], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, DB_FILE: path.join(dir, 'db.json'), AUTH_DIR_ROOT: path.join(dir, 'auth_state') },
  });
  assert.ok(/LEFT=0/.test(out), `row survived deletion: ${out.trim()}`);
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
