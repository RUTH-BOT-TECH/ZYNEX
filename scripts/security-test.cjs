#!/usr/bin/env node
/**
 * security-test.cjs — the security engine must be verifiable, not reassuring.
 *
 * Three classes of assertion:
 *
 *  1. CRYPTO MUST BE CORRECT. TOTP is checked against the RFC 6238 published
 *     test vectors — if those pass, the codes match every authenticator app.
 *  2. VERDICTS MUST BE REAL. A known-malware test domain must come back
 *     dangerous; a clean domain must not. A leaked password must be found by
 *     count, not by a guess.
 *  3. REFUSALS MUST BE HONEST. Anything needing a key (HIBP email lookup,
 *     VirusTotal, KYC) must say so and name a working alternative, never
 *     invent a result.
 *
 * Run: node scripts/security-test.cjs      (npm run test:security)
 */
process.env.SILENT = '1';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const sec = require(path.join(ROOT, 'lib', 'engines', 'security.js'));
const registry = require(path.join(ROOT, 'lib', 'registry.js'));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \u2713 ${n}`); }
  else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); }
};

let sent = [];
async function run(command, args = [], sender = '2348111000005@s.whatsapp.net') {
  sent = [];
  await sec.execute({
    command, args, from: '120363400000000001@g.us', sender,
    msg: { key: {}, message: {} }, prefix: '.',
    sock: { sendMessage: async () => ({}) },
    reply: async (t) => { sent.push(String(t)); return {}; },
  });
  return sent.join('\n');
}

(async () => {
  console.log('\n\u2550\u2550 Security engine \u2550\u2550\n');

  /* ── 1. routing ── */
  const cat = registry.byCategory()['security'] || [];
  const missing = cat.filter((o) => o.source === 'fallback').map((o) => o.name);
  ok(`all ${cat.length} catalogue security names are implemented`, missing.length === 0, missing.join(' '));
  const misrouted = sec.extraNames.filter((n) => {
    const o = registry.get(n);
    return !o || (o.engine || o.source) !== 'security';
  });
  ok(`every declared name routes here (${sec.extraNames.length})`, misrouted.length === 0, misrouted.join(' '));

  /* ── 2. TOTP against the RFC 6238 vectors ── */
  console.log('');
  const { totp, totpCheck } = sec._internals;
  const b32enc = (buf) => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0, val = 0, out = '';
    for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += A[(val << (5 - bits)) & 31];
    return out;
  };
  const RFC_SECRET = b32enc(Buffer.from('12345678901234567890', 'ascii'));
  const VECTORS = [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']];
  let vectorsPassed = 0;
  for (const [t, expected] of VECTORS) {
    if (totp(RFC_SECRET, { at: t * 1000 }) === expected) vectorsPassed++;
  }
  ok('TOTP matches all 4 RFC 6238 test vectors', vectorsPassed === 4, `${vectorsPassed}/4`);

  ok('TOTP accepts a code from the previous window', totpCheck(RFC_SECRET, totp(RFC_SECRET, { at: Date.now() - 30_000 })));
  ok('TOTP rejects a wrong code', !totpCheck(RFC_SECRET, '000000'));
  ok('TOTP rejects a code from 5 minutes ago', !totpCheck(RFC_SECRET, totp(RFC_SECRET, { at: Date.now() - 300_000 })));

  /* ── 3. hash identification ── */
  console.log('');
  const { hashKind } = sec._internals;
  ok('identifies MD5 by length', hashKind('5d41402abc4b2a76b9719d911017c592') === 'MD5');
  ok('identifies SHA-256 by length',
    hashKind('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824') === 'SHA-256');
  ok('rejects non-hex input', hashKind('not-a-hash!') === null);

  /* ── 4. typosquat detection (offline logic) ── */
  console.log('');
  const { typosquatCheck } = sec._internals;
  for (const [host, expectHit] of [
    ['whatsapp-login.top', true],
    ['paypa1.com', true],
    ['goog1e.com', true],
    ['paypal.com', false],
    ['google.com', false],
    ['amaz0n.net', true],
    ['github.com', false],
  ]) {
    const r = typosquatCheck(host);
    const flagged = r.hits.length > 0;
    ok(`lookalike detection: ${host}`, flagged === expectHit, `hits=${r.hits.map((h) => h.brand).join(',') || 'none'}`);
  }

  /* ── 5. live: Safe Browsing must flag a known-bad domain ── */
  console.log('');
  try {
    const bad = await sec._internals.safeBrowsing('testsafebrowsing.appspot.com');
    ok('Safe Browsing flags the known-malware test site', bad.verdict === 'dangerous', JSON.stringify(bad.flags));
    const clean = await sec._internals.safeBrowsing('google.com');
    ok('Safe Browsing does not flag google.com', clean.verdict === 'clean', clean.verdict);
  } catch (e) {
    ok('Safe Browsing reachable', false, e.message);
  }

  /* ── 6. live: a leaked password must be found with a count ── */
  try {
    const { count } = await sec._internals.pwnedPassword('password');
    ok('Pwned Passwords finds "password"', count > 1_000_000, `${count} hits`);
    const strong = await sec._internals.pwnedPassword('q9X$vL2#mK8wZt4RvN7p');
    ok('Pwned Passwords does not invent hits for a random password', strong.count === 0, `${strong.count}`);
  } catch (e) {
    ok('Pwned Passwords reachable', false, e.message);
  }

  /* ── 7. .scan output contract ── */
  console.log('');
  const badScan = await run('scan', ['testsafebrowsing.appspot.com']);
  ok('.scan calls a known-bad site HIGH risk', /HIGH/.test(badScan) && /DANGEROUS/.test(badScan), badScan.split('\n').slice(0, 4).join(' | '));
  const goodScan = await run('scan', ['google.com']);
  ok('.scan does not call google.com high risk', !/HIGH/.test(goodScan) && /CLEAN|LOW/.test(goodScan), goodScan.split('\n').slice(0, 4).join(' | '));
  ok('.scan includes the "not a guarantee" caveat', /not a guarantee|no known signal/i.test(goodScan));
  const localScan = await run('scan', ['http://192.168.1.1/admin']);
  ok('.scan refuses to judge a private address', /private|local/i.test(localScan), localScan.slice(0, 60));

  /* ── 8. refusals name alternatives ── */
  console.log('');
  for (const [cmd, args, re] of [
    ['pwned', ['someone@example.com'], /needs a paid key|not available/i],
    ['breach', ['someone@example.com'], /needs a paid key|not available/i],
    ['filescan', [], /not available|VirusTotal/i],
    ['virus', [], /not available|VirusTotal/i],
    ['kycstatus', [], /not available/i],
  ]) {
    const out = await run(cmd, args);
    ok(`.${cmd} refuses and names a working alternative`, re.test(out) && /`\./.test(out), out.replace(/\n/g, ' ').slice(0, 80));
  }

  /* ── 9. local state actually persists ── */
  console.log('');
  const chat = '120363400000000099@g.us';
  const store = require(path.join(ROOT, 'lib', 'secstore.js'));
  store.set(chat, 'probe', { v: 1 });
  ok('local store round-trips a value', store.get(chat, 'probe')?.v === 1);
  store.set(chat, 'probe', null);
  ok('local store deletes on null', store.get(chat, 'probe') === null);

  const total = pass + fails.length;
  console.log(`\n${pass}/${total} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  \u2022 ' + f));
    process.exit(1);
  }
})();
