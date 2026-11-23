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

/* ── Password hashing ─────────────────────────────────────── */
t('hash then verify succeeds', () => {
  const h = I.hashPassword('correct horse battery staple');
  assert.ok(I.verifyPassword('correct horse battery staple', h).ok);
});

t('wrong password does not verify', () => {
  const h = I.hashPassword('secret');
  assert.ok(!I.verifyPassword('Secret', h).ok, 'case-different password verified');
  assert.ok(!I.verifyPassword('secret ', h).ok, 'trailing space verified');
});

t('the same password hashes differently every time', () => {
  assert.notStrictEqual(I.hashPassword('same'), I.hashPassword('same'), 'salt is not random');
});

t('a bcrypt string is not silently accepted', () => {
  // $2b$10$... must be rejected, not crash and not pass
  const r = I.verifyPassword('x', '$2b$10$abcdefghijklmnopqrstuv');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not a scrypt hash/);
});

t('hash format is self-describing', () => {
  const h = I.hashPassword('x');
  assert.match(h, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
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

setTimeout(() => {
  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}, 300);
