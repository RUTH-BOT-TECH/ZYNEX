/**
 * Number / unit / numeral conversions.
 *
 * A whole category that was simply absent. Grouped into one module because each
 * command is a pure function — splitting them into forty files would add noise
 * without adding clarity.
 *
 * Commands: num2roman, roman2num, number2words, datasize, distance, caesar,
 *           vigenere, moonphase, color
 */

const round = (n, dp = 4) => String(Number(Number(n).toFixed(dp)));

function firstNumber(args) {
  const raw = String(args?.[0] ?? '').replace(/,/g, '');
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

/* ── Roman numerals ──────────────────────────────────────────────────────── */

const ROMAN_TABLE = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(n) {
  const num = Math.trunc(n);
  // The classic subtractive notation only defines 1–3999.
  if (num < 1 || num > 3999) throw new Error('out of range');
  let rest = num;
  let out = '';
  for (const [value, glyph] of ROMAN_TABLE) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

function fromRoman(str) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const s = String(str).toUpperCase().trim();
  if (!/^[IVXLCDM]+$/.test(s)) throw new Error('not a roman numeral');
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    total += next > cur ? -cur : cur;
  }
  return total;
}

/* ── Numbers to words ────────────────────────────────────────────────────── */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n) {
  const num = Math.trunc(Math.abs(Number(n)));
  if (!Number.isFinite(num)) throw new Error('not a number');
  if (num === 0) return 'zero';

  const chunk = (x) => {
    let s = '';
    if (x >= 100) {
      s += `${ONES[Math.floor(x / 100)]} hundred`;
      x %= 100;
      if (x) s += ' ';
    }
    if (x >= 20) {
      s += TENS[Math.floor(x / 10)];
      if (x % 10) s += `-${ONES[x % 10]}`;
    } else if (x > 0) {
      s += ONES[x];
    }
    return s;
  };

  const parts = [];
  let rest = num;
  for (const [size, label] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (rest >= size) {
      parts.push(`${chunk(Math.floor(rest / size))} ${label}`);
      rest %= size;
    }
  }
  if (rest) parts.push(chunk(rest));
  return (Number(n) < 0 ? 'minus ' : '') + parts.join(' ');
}

/* ── Ciphers ─────────────────────────────────────────────────────────────── */

function caesar(text, shift) {
  const s = ((Math.trunc(shift) % 26) + 26) % 26;
  return String(text).replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + s) % 26) + base);
  });
}

function vigenere(text, key, decode) {
  const clean = String(key).replace(/[^a-z]/gi, '').toLowerCase();
  if (!clean) throw new Error('key must contain letters');
  let i = 0;
  return String(text).replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    const k = clean.charCodeAt(i++ % clean.length) - 97;
    const shift = decode ? -k : k;
    return String.fromCharCode((((c.charCodeAt(0) - base + shift) % 26) + 26) % 26 + base);
  });
}

/* ── Moon phase ──────────────────────────────────────────────────────────── */

function moonPhase(when = new Date()) {
  // Mean synodic month, measured from the known new moon of 2000-01-06 18:14 UTC.
  const SYNODIC = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (when.getTime() - knownNewMoon) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const phases = [
    [1.85, '🌑 New moon'],
    [5.54, '🌒 Waxing crescent'],
    [9.23, '🌓 First quarter'],
    [12.91, '🌔 Waxing gibbous'],
    [16.61, '🌕 Full moon'],
    [20.30, '🌖 Waning gibbous'],
    [23.99, '🌗 Last quarter'],
    [27.68, '🌘 Waning crescent'],
    [SYNODIC, '🌑 New moon'],
  ];
  const [, label] = phases.find(([limit]) => age < limit) || phases[phases.length - 1];
  const illumination = Math.round((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2 * 100);
  return { age, label, illumination };
}

/* ── Colours ─────────────────────────────────────────────────────────────── */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error('not a hex colour');
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* ── Commands ────────────────────────────────────────────────────────────── */

module.exports = {
  name: 'num2roman',
  aliases: ['toroman', 'roman', 'roman2num', 'fromroman', 'number2words', 'words', 'datasize', 'bytes', 'distance',
    'caesar', 'vigenere', 'moonphase', 'color', 'colour', 'hex', 'rgb'],
  desc: 'Converters: roman numerals, numbers to words, sizes, distance, ciphers, colours, moon phase',
  category: 'tools',

  /** Dispatch on the command actually used, not on this module's primary name. */
  async execute(ctx) {
    const { reply, args = [], command } = ctx;
    const cmd = String(command || this.name).toLowerCase();
    const text = args.join(' ');
    const bad = (usage) => reply(`❌ ${usage}`);

    switch (cmd) {
      case 'num2roman':
      case 'toroman':
      case 'roman': {
        const v = firstNumber(args);
        if (v === null) return bad('Usage: `.num2roman 1994`');
        try {
          return reply(`🏛️ ${Math.trunc(v)} → *${toRoman(v)}*`);
        } catch {
          return bad('Roman numerals only cover 1–3999.');
        }
      }

      case 'roman2num':
      case 'fromroman': {
        if (!text) return bad('Usage: `.roman2num MCMXCIV`');
        try {
          return reply(`🏛️ ${text.toUpperCase()} → *${fromRoman(text)}*`);
        } catch {
          return bad('That is not a Roman numeral (use I V X L C D M).');
        }
      }

      case 'number2words':
      case 'words': {
        const v = firstNumber(args);
        if (v === null) return bad('Usage: `.number2words 1250`');
        return reply(`🔢 ${v} → *${numberToWords(v)}*`);
      }

      case 'datasize':
      case 'bytes': {
        const v = firstNumber(args);
        if (v === null || v < 0) return bad('Usage: `.datasize 1048576`');
        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.min(Math.floor(Math.log(Math.max(v, 1)) / Math.log(1024)), units.length - 1);
        return reply(`💾 ${v} bytes = *${round(v / 1024 ** i, 2)} ${units[i]}*`);
      }

      case 'distance': {
        // Accept "5 km mi" — value, from, to.
        const [rawValue, from, to] = args;
        const v = firstNumber([rawValue]);
        if (v === null || !from || !to) {
          return bad('Usage: `.distance 5 km mi`\nUnits: km, mi, m, ft, cm, in, nmi');
        }
        const toMetres = { km: 1000, m: 1, cm: 0.01, mi: 1609.344, ft: 0.3048, in: 0.0254, nmi: 1852 };
        const a = toMetres[String(from).toLowerCase()];
        const b = toMetres[String(to).toLowerCase()];
        if (!a || !b) return bad('Unknown unit. Use: km, mi, m, ft, cm, in, nmi');
        return reply(`📏 ${v} ${from} = *${round((v * a) / b, 4)} ${to}*`);
      }

      case 'caesar': {
        // .caesar 3 hello   |   .caesar -3 khoor
        const shift = firstNumber(args);
        const payload = args.slice(1).join(' ');
        if (shift === null || !payload) return bad('Usage: `.caesar 3 hello`  (negative shift decodes)');
        return reply(`🔐 Shift ${Math.trunc(shift)}\n\n\`\`\`${caesar(payload, shift)}\`\`\``);
      }

      case 'vigenere': {
        const [mode, key, ...rest] = args;
        const payload = rest.join(' ');
        if (!['encode', 'decode'].includes(String(mode).toLowerCase()) || !key || !payload) {
          return bad('Usage: `.vigenere encode KEY hello world`\n       `.vigenere decode KEY ifmmp xpsme`');
        }
        try {
          const out = vigenere(payload, key, String(mode).toLowerCase() === 'decode');
          return reply(`🔐 Vigenère (${mode})\n\n\`\`\`${out}\`\`\``);
        } catch (e) {
          return bad(`Vigenère needs a key of letters — ${e.message}.`);
        }
      }

      case 'moonphase': {
        const { age, label, illumination } = moonPhase(new Date());
        return reply(
          `🌙 *Moon phase*\n\n${label}\n\n` +
            `Age: *${age.toFixed(1)}* days of 29.5\n` +
            `Illuminated: *${illumination}%*`,
        );
      }

      case 'color':
      case 'colour':
      case 'hex':
      case 'rgb': {
        const input = text.trim();
        if (!input) return bad('Usage: `.color #ff8800`');
        try {
          const rgb = hexToRgb(input);
          const hsl = rgbToHsl(rgb);
          return reply(
            `🎨 *${input.startsWith('#') ? input : `#${input}`}*\n\n` +
              `RGB: *${rgb.r}, ${rgb.g}, ${rgb.b}*\n` +
              `HSL: *${hsl.h}°, ${hsl.s}%, ${hsl.l}%*\n` +
              `Hex: \`#${[rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, '0')).join('')}\``,
          );
        } catch {
          return bad('That is not a hex colour. Try `.color #ff8800`');
        }
      }

      default:
        return bad('Unknown conversion.');
    }
  },
};

module.exports._internals = { toRoman, fromRoman, numberToWords, caesar, vigenere, moonPhase, hexToRgb, rgbToHsl };
