/**
 * scripts/reference-audit.cjs — every command checked against a REFERENCE.
 *
 * ★ Why this exists
 *
 * Built first, researched afterwards, was the mistake. `.wasted` drew a red
 * band instead of compositing the GTA artwork; `.bcrypt` returned a scrypt hash
 * under a bcrypt name; `.phonetic` turned a space into "Zero" because
 * Number(' ') is 0.
 *
 * Every one of those would have been caught by asking "what does the reference
 * say the correct output is?" before shipping. So this file holds known-answer
 * vectors from published sources, not self-consistent round trips:
 *
 *   vigenere  ATTACKATDAWN + LEMON -> LXFOPVEFRNHR      (Wikipedia)
 *   caesar    HELLO shift 3        -> KHOOR
 *   atbash    HELLO                -> SVOOL
 *   affine    5,8 AFFINE           -> IHHWVC
 *   railfence WEAREDISCOVERED...   -> WECRLTEERDSOEEFEAOCAIVDEN (Wikipedia)
 *   AQI/UV    EPA and WHO breakpoint tables
 *   bcrypt    an externally produced $2b$ hash must verify here
 *
 * A round-trip test proves a cipher is reversible. It does NOT prove it is the
 * right cipher. These do.
 */
const path = require('path');
process.env.SILENT = '1';
process.env.CRYPTO_SECRET = 'audit';

const ROOT = path.resolve(__dirname, '..');
const cryptoI = require(path.join(ROOT, 'lib/engines/crypto.js'))._internal;
const overlayI = require(path.join(ROOT, 'lib/engines/overlay.js'))._internal;
const personalI = require(path.join(ROOT, 'lib/engines/personal.js'))._internal;
const lookupI = require(path.join(ROOT, 'lib/engines/lookup.js'))._internal;

const results = [];
const check = (cmd, what, pass, detail = '') =>
  results.push({ cmd, what, pass, detail });

/* ── crypto: known-answer vectors from published references ── */
const KAT = [
  ['vigenere', 'ATTACKATDAWN + LEMON', cryptoI.vigenere('ATTACKATDAWN', 'LEMON'), 'LXFOPVEFRNHR'],
  ['caesar', 'HELLO shift 3', cryptoI.caesar('HELLO', 3), 'KHOOR'],
  ['atbash', 'HELLO', cryptoI.atbash('HELLO'), 'SVOOL'],
  ['affine', 'AFFINE a=5 b=8', cryptoI.affineEncrypt('AFFINE', 5, 8), 'IHHWVC'],
  ['morse', 'sos', cryptoI.toMorse('sos'), '... --- ...'],
  ['railfence', 'WEAREDISCOVEREDFLEEATONCE rails=3',
    cryptoI.railFence('WEAREDISCOVEREDFLEEATONCE', 3), 'WECRLTEERDSOEEFEAOCAIVDEN'],
  ['bacon', 'hello first letter', cryptoI.bacon('hello').split(' ')[0], 'aabbb'],
  ['phonetic', 'abc', cryptoI.phonetic('abc'), 'Alfa Bravo Charlie'],
];
for (const [cmd, what, got, want] of KAT) {
  check(cmd, what, got === want, got === want ? '' : `got "${got}" want "${want}"`);
}

/* ── overlays: asset dimensions + real render ─────────────── */
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const ff = require(path.join(ROOT, 'lib/ffmpeg')).ffmpegPath();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'testsrc2=size=400x400:rate=1', '-frames:v', '1', '-update', '1', path.join(tmp, 'p.png')]);
const PHOTO = fs.readFileSync(path.join(tmp, 'p.png'));

(async () => {
  for (const [name, def] of Object.entries(overlayI.EFFECTS)) {
    const asset = ['png', 'jpg'].map((e) => path.join(ROOT, 'assets/overlays', `${def.file}.${e}`))
      .find((p) => fs.existsSync(p));
    try {
      const out = await overlayI.render(PHOTO, name);
      const dim = overlayI.dimensions(Buffer.from(out));
      const want = overlayI.dimensions(asset);
      const ok = dim && dim.w === want.w && dim.h === want.h && out.length > 500;
      check(`overlay:${name}`, `renders at artwork size ${want.w}x${want.h}`, ok, ok ? '' : JSON.stringify(dim));
    } catch (e) {
      check(`overlay:${name}`, 'renders', false, e.message.slice(0, 50));
    }
  }

  /* ── duration parsing vs hand computation ───────────────── */
  const DUR = [['10m', 600000], ['2h', 7200000], ['1d', 86400000], ['1h30m', 5400000], ['5', 300000]];
  for (const [input, want] of DUR) {
    const got = personalI.parseDuration(input);
    check('remind', `parses "${input}"`, got === want, got === want ? '' : `got ${got}`);
  }
  for (const bad of ['abc', '-5m', '', '0m']) {
    const got = personalI.parseDuration(bad);
    check('remind', `refuses "${bad}"`, got === null, got === null ? '' : `got ${got}`);
  }

  /* ── AQI bands vs the published EPA table ──────────────── */
  const EPA = [[0, 'Good'], [50, 'Good'], [51, 'Moderate'], [100, 'Moderate'],
    [101, 'Unhealthy for sensitive groups'], [150, 'Unhealthy for sensitive groups'],
    [151, 'Unhealthy'], [200, 'Unhealthy'], [201, 'Very unhealthy'],
    [300, 'Very unhealthy'], [301, 'Hazardous']];
  for (const [v, want] of EPA) {
    const got = lookupI.aqiBand(v).label;
    check('aqi', `AQI ${v} -> ${want}`, got === want, got === want ? '' : `got "${got}"`);
  }

  /* ── UV bands vs WHO ───────────────────────────────────── */
  const WHO = [[0, 'Low'], [2, 'Low'], [3, 'Moderate'], [5, 'Moderate'],
    [6, 'High'], [7, 'High'], [8, 'Very high'], [10, 'Very high'], [11, 'Extreme']];
  for (const [v, want] of WHO) {
    const got = lookupI.uvBand(v).label;
    check('uv', `UV ${v} -> ${want}`, got === want, got === want ? '' : `got "${got}"`);
  }

  /* ── bcrypt interop ────────────────────────────────────── */
  const ext = '$2b$12$EqUJ33z4ui1.N5vDTaEdjehGuQ3upgAZ6MA6.0XZXc2bHp2tusdtW';
  const r = await cryptoI.verifyPassword('mypassword', ext);
  check('bcrypt', 'verifies an externally-produced $2b$ hash', r.ok === true, JSON.stringify(r));

  /* ── AES-GCM round trip + tamper ───────────────────────── */
  const sealed = cryptoI.seal('audit text');
  check('encrypt', 'seal/open round-trips', cryptoI.open(sealed) === 'audit text');
  let tamperRejected = false;
  try { cryptoI.open(sealed.slice(0, -4) + 'AAAA'); } catch { tamperRejected = true; }
  check('decrypt', 'rejects a tampered payload', tamperRejected);

  /* ── report ───────────────────────────────────────────── */
  const byCmd = {};
  for (const r2 of results) {
    byCmd[r2.cmd] = byCmd[r2.cmd] || { pass: 0, fail: 0, fails: [] };
    if (r2.pass) byCmd[r2.cmd].pass++;
    else { byCmd[r2.cmd].fail++; byCmd[r2.cmd].fails.push(`${r2.what} (${r2.detail})`); }
  }
  console.log('COMMAND              RESULT');
  console.log('─'.repeat(62));
  for (const [cmd, s] of Object.entries(byCmd).sort()) {
    const mark = s.fail === 0 ? '✔' : '✗';
    console.log(`${mark} ${cmd.padEnd(20)} ${String(s.pass).padStart(2)} ok${s.fail ? `  ${s.fail} FAIL` : ''}`);
    for (const f of s.fails) console.log(`      └─ ${f}`);
  }
  const total = results.length;
  const failed = results.filter((r3) => !r3.pass).length;
  console.log('─'.repeat(62));
  console.log(`${failed === 0 ? '✔' : '✗'} ${total - failed}/${total} reference checks passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
})();
