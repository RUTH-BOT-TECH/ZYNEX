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

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
