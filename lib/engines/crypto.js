/**
 * lib/engines/crypto.js — real, self-contained cipher and hashing tools.
 *
 * These are the NOVA tools we lacked: bcrypt, cipher, vigenere, affine,
 * rot13, atbash, morse, caesar, bacon, rail fence, plus password strength.
 *
 * Everything here is pure Node — no npm dependency, no network, no native
 * build. That matters: canvacord segfaulted this host, and a command that
 * cannot start is worse than one that does not exist.
 *
 * Ported from NOVA_MD's plugins/tools/codes.js (ESM) and rewritten to
 * CommonJS, keeping its actual cipher math rather than inventing new code.
 */

const crypto = require('crypto');

/* ── Vigenère ────────────────────────────────────────────────
 * Ported verbatim in behaviour from NOVA: non-letters pass through
 * untouched and do not advance the key, so "attack at dawn" round-trips.
 */
function vigenere(text, key, decode = false) {
  const letters = String(key || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) throw new Error('The key needs at least one letter.');
  let i = 0;
  return [...String(text)].map((ch) => {
    const lower = ch.toLowerCase();
    if (lower < 'a' || lower > 'z') return ch;
    const shift = letters.charCodeAt(i++ % letters.length) - 97;
    const base = ch === lower ? 97 : 65;
    const offset = (ch.charCodeAt(0) - base + (decode ? -shift : shift) + 26) % 26;
    return String.fromCharCode(base + offset);
  }).join('');
}

/* ── Caesar / ROT-n ─────────────────────────────────────────── */
function caesar(text, shift, decode = false) {
  const n = ((parseInt(shift, 10) || 0) % 26 + 26) % 26;
  const s = decode ? (26 - n) % 26 : n;
  return [...String(text)].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCharCode(((c - 65 + s) % 26) + 65);
    if (c >= 97 && c <= 122) return String.fromCharCode(((c - 97 + s) % 26) + 97);
    return ch;
  }).join('');
}

/* ── Atbash (a↔z) ───────────────────────────────────────────── */
function atbash(text) {
  return [...String(text)].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCharCode(90 - (c - 65));
    if (c >= 97 && c <= 122) return String.fromCharCode(122 - (c - 97));
    return ch;
  }).join('');
}

/* ── Affine E(x) = (a·x + b) mod 26 ─────────────────────────── */
function affineEncrypt(text, a, b) {
  const A = parseInt(a, 10), B = parseInt(b, 10);
  if (!Number.isFinite(A) || !Number.isFinite(B)) throw new Error('Need two numbers: .affine 5 8 <text>');
  if (gcd(((A % 26) + 26) % 26, 26) !== 1) throw new Error(`${A} is not coprime with 26 — the cipher would not be reversible.`);
  return [...String(text)].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCharCode(((A * (c - 65) + B) % 26 + 26) % 26 + 65);
    if (c >= 97 && c <= 122) return String.fromCharCode(((A * (c - 97) + B) % 26 + 26) % 26 + 97);
    return ch;
  }).join('');
}

function gcd(x, y) { while (y) [x, y] = [y, x % y]; return x; }

function modInverse(a, m) {
  const A = ((a % m) + m) % m;
  for (let x = 1; x < m; x++) if ((A * x) % m === 1) return x;
  throw new Error(`${a} has no inverse modulo 26.`);
}

function affineDecrypt(text, a, b) {
  const A = parseInt(a, 10), B = parseInt(b, 10);
  const inv = modInverse(A, 26);
  return [...String(text)].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return String.fromCharCode(((inv * (c - 65 - B)) % 26 + 26) % 26 + 65);
    if (c >= 97 && c <= 122) return String.fromCharCode(((inv * (c - 97 - B)) % 26 + 26) % 26 + 97);
    return ch;
  }).join('');
}

/* ── Morse ──────────────────────────────────────────────────── */
const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....',
  i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.',
  q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-',
  y: '-.--', z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', "'": '.----.', '/': '-..-.',
};
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

function toMorse(text) {
  return String(text).toLowerCase().split(/\s+/)
    .map((word) => [...word].map((c) => MORSE[c] || '').filter(Boolean).join(' '))
    .filter(Boolean).join(' / ');
}

function fromMorse(text) {
  return String(text).trim().split(/\s*\/\s*/)
    .map((word) => word.split(/\s+/).map((c) => MORSE_REV[c] || '').join(''))
    .join(' ');
}

/* ── Bacon's cipher ─────────────────────────────────────────── */
function bacon(text, decode = false) {
  const AZ = 'abcdefghijklmnopqrstuvwxyz';
  if (decode) {
    const bits = String(text).toLowerCase().replace(/[^ab]/g, '');
    if (!bits) throw new Error('Bacon text only contains a and b.');
    let out = '';
    for (let i = 0; i + 5 <= bits.length; i += 5) {
      const n = parseInt(bits.slice(i, i + 5).replace(/a/g, '0').replace(/b/g, '1'), 2);
      if (n < 26) out += AZ[n];
    }
    return out;
  }
  return [...String(text).toLowerCase()].filter((c) => AZ.includes(c))
    .map((c) => AZ.indexOf(c).toString(2).padStart(5, '0').replace(/0/g, 'a').replace(/1/g, 'b'))
    .join(' ');
}

/* ── Rail fence ─────────────────────────────────────────────── */
function railFence(text, rails, decode = false) {
  const r = Math.max(2, Math.min(20, parseInt(rails, 10) || 3));
  const s = String(text);
  const pattern = [];
  let row = 0, dir = 1;
  for (let i = 0; i < s.length; i++) {
    pattern.push(row);
    if (row === 0) dir = 1; else if (row === r - 1) dir = -1;
    row += dir;
  }
  if (decode) {
    const out = new Array(s.length);
    let idx = 0;
    for (let rr = 0; rr < r; rr++)
      for (let i = 0; i < s.length; i++)
        if (pattern[i] === rr) out[i] = s[idx++];
    return out.join('');
  }
  let res = '';
  for (let rr = 0; rr < r; rr++)
    for (let i = 0; i < s.length; i++)
      if (pattern[i] === rr) res += s[i];
  return res;
}

/* ── bcrypt-shaped hash with no dependency ────────────────────
 * Real bcrypt needs a native build, which this host punishes. This is
 * scrypt — a memory-hard KDF from Node's own crypto, arguably stronger
 * than bcrypt — stored in a self-describing `scrypt$N$r$p$salt$hash`
 * format so verify() can never confuse it with a bcrypt string.
 */
function hashPassword(password, cost = 16384) {
  const N = Math.max(1024, Math.min(65536, cost));
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return { ok: false, reason: 'not a scrypt hash' };
  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), salt, expected.length, {
    N: parseInt(N, 10), r: parseInt(r, 10), p: parseInt(p, 10),
  });
  // timing-safe: a plain === leaks how many bytes matched
  const ok = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  return { ok };
}

/* ── password strength, honestly graded ──────────────────────── */
function passwordStrength(pw) {
  const s = String(pw || '');
  const checks = {
    length: s.length >= 12,
    lower: /[a-z]/.test(s),
    upper: /[A-Z]/.test(s),
    digit: /\d/.test(s),
    symbol: /[^A-Za-z0-9]/.test(s),
    noRepeat: !/(.)\1{2,}/.test(s),
  };
  const score = Object.values(checks).filter(Boolean).length;
  // entropy estimate: charset size ^ length
  let pool = 0;
  if (checks.lower) pool += 26;
  if (checks.upper) pool += 26;
  if (checks.digit) pool += 10;
  if (checks.symbol) pool += 33;
  const bits = pool > 0 ? Math.round(s.length * Math.log2(pool)) : 0;
  const label = bits >= 80 ? 'strong' : bits >= 55 ? 'fair' : bits >= 35 ? 'weak' : 'very weak';
  return { score, checks, bits, label };
}

/* ── engine interface ─────────────────────────────────────── */
const NAMES = new Set([
  'vigenere', 'vig', 'caesar', 'rot13', 'atbash', 'affine', 'morse',
  'demorse', 'bacon', 'debacon', 'railfence', 'bcrypt', 'checkpass',
  'passcheck2', 'passgen2', 'hashpw',
]);

module.exports = {
  id: 'crypto',
  name: 'crypto-engine',
  extraNames: [...NAMES],

  match(name) { return NAMES.has(name); },

  async execute({ command, args, argString, reply }) {
    const text = (argString || args.join(' ')).trim();

    switch (command) {
      /* .vigenere <key> <text>   |   .vigenere -d <key> <text> */
      case 'vigenere':
      case 'vig': {
        const raw = text;
        const decode = /^-d\s+|^--decode\s+/.test(raw);
        const body = raw.replace(/^-d\s+|^--decode\s+/, '');
        const [key, ...rest] = body.split(/\s+/);
        const plain = rest.join(' ');
        if (!key || !plain) {
          return reply(
            '🔐 *Vigenère cipher*\n\n' +
            '`.vigenere <key> <text>`  — encrypt\n' +
            '`.vigenere -d <key> <text>`  — decrypt\n\n' +
            '_Example:_ `.vigenere lemon attack at dawn`',
          );
        }
        try {
          const out = vigenere(plain, key, decode);
          return reply(`🔐 *${decode ? 'Decoded' : 'Encoded'}*\n\n\`${out}\``);
        } catch (e) {
          return reply(`❌ ${e.message}`);
        }
      }

      /* .caesar <shift> <text>  |  .caesar -d <shift> <text> */
      case 'caesar':
      case 'rot13': {
        if (command === 'rot13') {
          return reply(`🔄 *ROT13*\n\n\`${caesar(text, 13)}\``);
        }
        const decode = /^-d\s+/.test(text);
        const body = text.replace(/^-d\s+/, '');
        const m = body.match(/^(-?\d+)\s+([\s\S]+)$/);
        if (!m) return reply('🔐 `.caesar <shift> <text>`\nExample: `.caesar 3 hello`\nAdd `-d` to decode.');
        return reply(`🔐 *Caesar ${m[1]}*\n\n\`${caesar(m[2], m[1], decode)}\``);
      }

      case 'atbash': {
        if (!text) return reply('🔐 `.atbash <text>` — a↔z substitution');
        return reply(`🔐 *Atbash*\n\n\`${atbash(text)}\``);
      }

      /* .affine <a> <b> <text>  |  .affine -d <a> <b> <text> */
      case 'affine': {
        const decode = /^-d\s+/.test(text);
        const m = text.replace(/^-d\s+/, '').match(/^(\d+)\s+(\d+)\s+([\s\S]+)$/);
        if (!m) return reply('🔐 `.affine <a> <b> <text>`\nExample: `.affine 5 8 hello`\nAdd `-d` to decode.');
        try {
          const out = decode ? affineDecrypt(m[3], m[1], m[2]) : affineEncrypt(m[3], m[1], m[2]);
          return reply(`🔐 *Affine ${m[1]},${m[2]}*\n\n\`${out}\``);
        } catch (e) {
          return reply(`❌ ${e.message}`);
        }
      }

      case 'morse': {
        if (!text) return reply('📡 `.morse <text>` — or `.demorse ...` to read it back');
        return reply(`📡 *Morse*\n\n\`${toMorse(text)}\``);
      }
      case 'demorse': {
        if (!text) return reply('📡 `.demorse <morse>` — use / between words');
        return reply(`📡 *Decoded*\n\n\`${fromMorse(text)}\``);
      }

      case 'bacon': {
        if (!text) return reply('🔐 `.bacon <text>` — a/b encoding');
        return reply(`🔐 *Bacon*\n\n\`${bacon(text)}\``);
      }
      case 'debacon': {
        if (!text) return reply('🔐 `.debacon <a/b text>`');
        try { return reply(`🔐 *Decoded*\n\n\`${bacon(text, true)}\``); }
        catch (e) { return reply(`❌ ${e.message}`); }
      }

      /* .railfence <rails> <text>  |  -d to reverse */
      case 'railfence': {
        const decode = /^-d\s+/.test(text);
        const m = text.replace(/^-d\s+/, '').match(/^(\d+)\s+([\s\S]+)$/);
        if (!m) return reply('🔐 `.railfence <rails> <text>`\nExample: `.railfence 3 hello world`\nAdd `-d` to decode.');
        return reply(`🔐 *Rail fence ${m[1]}*\n\n\`${railFence(m[2], m[1], decode)}\``);
      }

      /* .bcrypt <password> — hash it.  .checkpass <pw> <hash> — verify */
      case 'bcrypt':
      case 'hashpw': {
        if (!text) return reply('🔒 `.bcrypt <password>` — returns a salted hash');
        const hash = hashPassword(text);
        return reply(
          '🔒 *Password hash*\n\n' +
          `\`${hash}\`\n\n` +
          '_scrypt — memory-hard, from Node core. No native build, so it cannot break on deploy._\n' +
          'Verify with `.checkpass <password> <hash>`.',
        );
      }
      case 'checkpass':
      case 'passcheck2': {
        const m = text.match(/^(\S+)\s+(scrypt\$\S+)$/);
        if (!m) return reply('🔒 `.checkpass <password> <hash>`');
        try {
          const r = verifyPassword(m[1], m[2]);
          return reply(r.ok ? '✅ *Match* — that password produced this hash.' : '❌ *No match* — different password.');
        } catch (e) {
          return reply(`❌ ${e.message}`);
        }
      }

      /* .passgen2 [length] — strong random password with a strength report */
      case 'passgen2':
      case 'passcheck2x': {
        const len = Math.max(8, Math.min(64, parseInt(text, 10) || 20));
        const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+';
        const bytes = crypto.randomBytes(len);
        // modulo bias is real for 256 % 70; rejection-sample instead
        let pw = '';
        for (const b of bytes) {
          if (b < 70 * Math.floor(256 / 70)) pw += chars[b % chars.length];
        }
        while (pw.length < len) {
          const b = crypto.randomBytes(1)[0];
          if (b < 70 * Math.floor(256 / 70)) pw += chars[b % chars.length];
        }
        pw = pw.slice(0, len);
        const s = passwordStrength(pw);
        return reply(
          `🔑 *Generated password*\n\n\`${pw}\`\n\n` +
          `Strength: *${s.label}* (~${s.bits} bits)`,
        );
      }

      default:
        return reply(`❌ \`${command}\` is not wired in the crypto engine.`);
    }
  },
};

module.exports._internal = {
  vigenere, caesar, atbash, affineEncrypt, affineDecrypt,
  toMorse, fromMorse, bacon, railFence, hashPassword, verifyPassword,
  passwordStrength,
};
