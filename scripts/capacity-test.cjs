/**
 * ★ Can a deployer host other people on their own panel, and what happens when
 *   the host fills up?
 *
 * Multi-tenancy needed no new feature — the panel already gives every visitor
 * their own bot. What was missing was a ceiling: past ~20 sockets on a 1 GB
 * container the kernel kills the process and every paired user drops at once.
 *
 * These tests pin the arithmetic to the real container limits and prove the
 * refusal path, so "just host more people" cannot turn into "everyone is gone".
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };
const cap = require('../lib/capacity');

t('the cap is computed from this host, not hardcoded', () => {
  const c = cap.compute();
  if (c.source !== 'memory') throw new Error('did not read container memory: ' + JSON.stringify(c));
  if (!Number.isFinite(c.limit) || c.limit < 1) throw new Error('bad limit: ' + c.limit);
});

t('a 1 GB container admits about 16 bots, not 200', () => {
  // 1024 MB - 180 MB base = 844 MB / 50 MB = 16
  const n = cap.compute({ memBytes: 1024 * 1024 * 1024 }).limit;
  if (n < 10 || n > 20) throw new Error('1 GB should admit ~16 bots, got ' + n);
});

t('a 953 MB production container admits 15 — enough to know the real ceiling', () => {
  const n = cap.compute({ memBytes: 999997440 }).limit;
  if (n < 12 || n > 18) throw new Error('production ceiling looks wrong: ' + n);
});

t('a 4 GB box admits four times as many, with no code change', () => {
  const small = cap.compute({ memBytes: 1024 * 1024 * 1024 }).limit;
  const big = cap.compute({ memBytes: 4 * 1024 * 1024 * 1024 }).limit;
  if (big <= small * 3) throw new Error(`scaling is not linear: ${small} -> ${big}`);
});

t('MAX_SESSIONS overrides the host', () => {
  const out = execFileSync(process.execPath, ['-e', `
    const cap = require('./lib/capacity'); console.log(cap.compute().limit);
  `], { cwd: ROOT, env: { ...process.env, MAX_SESSIONS: '3' }, encoding: 'utf8' }).trim();
  assert.strictEqual(Number(out), 3);
});

t('MAX_SESSIONS=0 means unlimited, and says what that costs', () => {
  const out = execFileSync(process.execPath, ['-e', `
    const cap = require('./lib/capacity'); const c = cap.compute();
    console.log(c.limit + '|' + c.reason);
  `], { cwd: ROOT, env: { ...process.env, MAX_SESSIONS: '0' }, encoding: 'utf8' }).trim();
  const [limit, reason] = out.split('|');
  assert.strictEqual(Number(limit), 0);
  if (!/memory first/i.test(reason)) throw new Error('unlimited is offered without its cost: ' + reason);
});

t('the 4th on a 3-bot server is refused with a reason, not a crash', () => {
  const r = cap.canAccept(3);
  // canAccept reads the real env; force the cap for the check
  process.env.MAX_SESSIONS = '3';
  delete require.cache[require.resolve('../lib/capacity')];
  const fresh = require('../lib/capacity');
  const res = fresh.canAccept(3);
  delete process.env.MAX_SESSIONS;
  if (res.ok) throw new Error('admitted a 4th session past a cap of 3');
  if (!res.message || !/safe limit is 3/.test(res.message)) throw new Error('refusal did not explain itself: ' + res.message);
  if (!/Nothing was lost/.test(res.message)) throw new Error('refusal does not reassure the user: ' + res.message);
});

t('under the cap with memory to spare, pairing is allowed', () => {
  delete process.env.MAX_SESSIONS;
  delete require.cache[require.resolve('../lib/capacity')];
  const fresh = require('../lib/capacity');
  const res = fresh.canAccept(0);
  if (!res.ok) throw new Error('refused the very first session: ' + res.message);
});

t('the pair route is gated before any WhatsApp work', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const gateAt = src.indexOf('capacity.canAccept(');
  const createAt = src.indexOf('createSession(');
  if (gateAt === -1) throw new Error('pair route has no capacity gate');
  if (createAt !== -1 && gateAt > createAt) throw new Error('gate runs after the session is created');
  if (!/res\.status\(503\)/.test(src)) throw new Error('refusal is not a retryable status');
});

t('the panel can see the headroom', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  if (!/capacity:\s*\{[^}]*pressure\(\)/.test(src)) throw new Error('/api/status does not expose capacity');
});

t('memory pressure is reported as a real number', () => {
  const p = cap.pressure();
  if (typeof p.usedMb !== 'number' || p.usedMb <= 0) throw new Error('no rss reading');
  if (p.limitMb !== null && (p.percent < 0 || p.percent > 100)) throw new Error('percent out of range: ' + p.percent);
});

console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
