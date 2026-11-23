/**
 * scripts/crypto-test.cjs — the cipher engine must round-trip exactly.
 *
 * A cipher that decodes to something *almost* right is worse than one that
 * errors: the user cannot tell whether the fault is theirs or ours. Every
 * reversible function here is checked by encrypting then decrypting.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { _internal: I } = require(path.join(ROOT, 'lib/engines/crypto.js'));
const engine = require(path.join(ROOT, 'lib/engines/crypto.js'));

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`✔ ${name}`); pass++; }
  catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
};

const SAMPLES = [
  'Hello, World! 123',
  'attack at dawn',
  'The Quick Brown Fox Jumps Over The Lazy Dog',
  'na wa ooo 9ja',
];

/* ── Vigenère ─────────────────────────────────────────────── */
t('vigenere round-trips every sample', () => {
  for (const s of SAMPLES) {
    assert.strictEqual(I.vigenere(I.vigenere(s, 'lemon'), 'lemon', true), s, `failed on: ${s}`);
  }
});

t('vigenere leaves digits and punctuation untouched', () => {
  assert.ok(I.vigenere('123!? .,', 'key').includes('123!? .,'));
});

t('vigenere refuses a key with no letters', () => {
  assert.throws(() => I.vigenere('hi', '123'), /at least one letter/);
});

t('vigenere handles a key longer than the text', () => {
  assert.strictEqual(I.vigenere(I.vigenere('hi', 'abcdefghij'), 'abcdefghij', true), 'hi');
});

/* ── Caesar ───────────────────────────────────────────────── */
t('caesar round-trips', () => {
  for (const s of SAMPLES) {
    for (const n of [1, 3, 13, 25]) {
      assert.strictEqual(I.caesar(I.caesar(s, n), n, true), s, `shift ${n} on ${s}`);
    }
  }
});

t('caesar wraps past z', () => {
  assert.strictEqual(I.caesar('z', 1), 'a');
  assert.strictEqual(I.caesar('Z', 25), 'Y');
});

t('caesar handles a negative shift', () => {
  assert.strictEqual(I.caesar(I.caesar('abc', -5), -5, true), 'abc');
});

t('rot13 is its own inverse', () => {
  assert.strictEqual(I.caesar(I.caesar('Secret Message', 13), 13), 'Secret Message');
});

/* ── Atbash ───────────────────────────────────────────────── */
t('atbash is its own inverse', () => {
  for (const s of SAMPLES) assert.strictEqual(I.atbash(I.atbash(s)), s);
});

t('atbash maps a->z and A->Z', () => {
  assert.strictEqual(I.atbash('aA'), 'zZ');
});

/* ── Affine ───────────────────────────────────────────────── */
t('affine round-trips', () => {
  for (const s of SAMPLES) {
    const enc = I.affineEncrypt(s, 5, 8);
    assert.strictEqual(I.affineDecrypt(enc, 5, 8), s);
  }
});

t('affine rejects a slope that is not coprime with 26', () => {
  // 13 and 26 share a factor, so E is not a bijection and cannot be undone
  assert.throws(() => I.affineEncrypt('abc', 13, 4), /not coprime/);
});

t('affine rejects letters where numbers belong', () => {
  assert.throws(() => I.affineEncrypt('abc', 'x', 4), /two numbers/);
});

/* ── Morse ────────────────────────────────────────────────── */
t('morse round-trips', () => {
  assert.strictEqual(I.fromMorse(I.toMorse('sos help')), 'sos help');
  assert.strictEqual(I.fromMorse(I.toMorse('hello world')), 'hello world');
});

t('morse emits the documented SOS pattern', () => {
  assert.strictEqual(I.toMorse('sos'), '... --- ...');
});

t('morse keeps word breaks as /', () => {
  assert.ok(I.toMorse('a b').includes('/'));
});

/* ── Bacon ────────────────────────────────────────────────── */
t('bacon round-trips', () => {
  assert.strictEqual(I.bacon(I.bacon('hello'), true), 'hello');
});

t('bacon output is only a and b', () => {
  assert.ok(/^[ab\s]+$/.test(I.bacon('hello world')));
});

/* ── Rail fence ───────────────────────────────────────────── */
t('rail fence round-trips', () => {
  for (const rails of [2, 3, 4, 7]) {
    assert.strictEqual(I.railFence(I.railFence('hello world', rails), rails, true), 'hello world', `rails ${rails}`);
  }
});

t('rail fence actually scrambles the text', () => {
  assert.notStrictEqual(I.railFence('hello world', 3), 'hello world');
});

/* ── bcrypt ───────────────────────────────────────────────────
 * ★ These were written against scrypt-under-a-bcrypt-name. Real bcrypt is the
 * point: the hash must be a `$2b$` string another system can verify.
 */
const asyncTests = [];
const ta = (name, fn) => asyncTests.push([name, fn]);

ta('bcrypt produces a real $2b$ hash', async () => {
  const h = await I.hashPassword('correct horse battery staple');
  assert.match(h, /^\$2b\$12\$[./A-Za-z0-9]{53}$/, `not a bcrypt string: ${h}`);
});

ta('bcrypt verifies the right password', async () => {
  const h = await I.hashPassword('correct horse battery staple');
  assert.ok((await I.verifyPassword('correct horse battery staple', h)).ok);
});

ta('bcrypt rejects a near-miss password', async () => {
  const h = await I.hashPassword('secret');
  assert.ok(!(await I.verifyPassword('Secret', h)).ok, 'case-different password verified');
  assert.ok(!(await I.verifyPassword('secret ', h)).ok, 'trailing space verified');
  assert.ok(!(await I.verifyPassword('secre', h)).ok, 'truncated password verified');
});

ta('the same password hashes differently every time', async () => {
  const a = await I.hashPassword('same');
  const b = await I.hashPassword('same');
  assert.notStrictEqual(a, b, 'salt is not random');
});

ta('a non-bcrypt hash is refused, not silently accepted', async () => {
  const r = await I.verifyPassword('x', 'scrypt$16384$8$1$abc$def');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not a bcrypt hash/);
});

ta('bcrypt is interoperable: an external $2b$ hash verifies here', async () => {
  // produced by an independent bcrypt implementation, not by this code
  const external = '$2b$12$EqUJ33z4ui1.N5vDTaEdjehGuQ3upgAZ6MA6.0XZXc2bHp2tusdtW';
  assert.ok((await I.verifyPassword('mypassword', external)).ok);
});

/* ── AES-256-GCM sealing ──────────────────────────────────── */
process.env.CRYPTO_SECRET = 'test-secret-for-suite';

t('seal then open round-trips', () => {
  const payload = I.seal('hidden message');
  assert.strictEqual(I.open(payload), 'hidden message');
});

t('the payload is self-describing v1.iv.tag.body', () => {
  const p = I.seal('x').split('.');
  assert.strictEqual(p.length, 4);
  assert.strictEqual(p[0], 'v1');
});

t('the same text seals differently every time', () => {
  assert.notStrictEqual(I.seal('x'), I.seal('x'), 'IV is not random');
});

t('tampering is detected, not silently decoded', () => {
  const p = I.seal('important');
  const parts = p.split('.');
  parts[3] = parts[3].slice(0, -4) + 'AAAA';
  assert.throws(() => I.open(parts.join('.')), /authenticate|unable/i);
});

t('a malformed payload is refused with a reason', () => {
  assert.throws(() => I.open('not-a-payload'), /not a sealed payload/i);
  assert.throws(() => I.open('v2.a.b.c'), /Unsupported payload version/i);
});

/* ── NATO phonetic ────────────────────────────────────────── */
t('phonetic spells out the standard words', () => {
  assert.strictEqual(I.phonetic('abc'), 'Alfa Bravo Charlie');
  assert.strictEqual(I.phonetic('NOVA42'), 'November Oscar Victor Alfa Four Two');
  assert.strictEqual(I.phonetic('sos'), 'Sierra Oscar Sierra');
});

t('phonetic keeps digits and spaces readable', () => {
  assert.ok(I.phonetic('a b').includes('·'));
  assert.match(I.phonetic('1'), /^One$/);
});

/* ── Strength ─────────────────────────────────────────────── */
t('strength grades a short password as weak', () => {
  assert.ok(['weak', 'very weak'].includes(I.passwordStrength('abc').label));
});

t('strength grades a long mixed password as strong', () => {
  const s = I.passwordStrength('Tr0ub4dor&3-xtra-Long!');
  assert.ok(['strong', 'fair'].includes(s.label), `got ${s.label}`);
});

t('strength reports entropy bits', () => {
  assert.ok(I.passwordStrength('aB3!aB3!aB3!').bits > 0);
});

/* ── Engine plumbing ──────────────────────────────────────── */
t('engine claims every name it implements', () => {
  for (const n of ['vigenere', 'caesar', 'atbash', 'affine', 'morse', 'bcrypt', 'railfence']) {
    assert.ok(engine.match(n), `${n} not claimed`);
  }
});

t('engine does not claim names it does not implement', () => {
  assert.ok(!engine.match('wasted'));
  assert.ok(!engine.match('play'));
});

t('every claimed name produces a reply, never silence', async () => {
  // A command that resolves without replying looks like a dead bot.
  for (const name of engine.extraNames) {
    let replied = false;
    await engine.execute({
      command: name,
      args: [],
      argString: '',
      reply: () => { replied = true; return Promise.resolve(); },
    });
    assert.ok(replied, `${name} replied nothing`);
  }
});

setTimeout(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); console.log(`✔ ${name}`); pass++; }
    catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
  }
  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}, 150);
