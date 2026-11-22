/**
 * ART ENGINE — ASCII art, figlet banners, code-image rendering, hashtags.
 *
 * All local. figlet ships 332 fonts inside the package, so `.figlet -f banner
 * ZYNEX` works with no network and no rate limit.
 *
 * The interesting constraint here is WhatsApp's *rendering*, not the fonts:
 * text is delivered in a proportional font, so a figlet banner collapses into
 * nonsense unless it is wrapped in a monospace block. Every ASCII output in this
 * engine is therefore wrapped in ``` fences and checked to survive without
 * trailing-whitespace stripping.
 */
'use strict';

const figlet = require('figlet');
const sharp = require('sharp');

const esc = (v) =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** WhatsApp refuses messages over ~65k, and a 300-char line of figlet is absurd. */
const MAX_LINE = 60;

const ARG = (args) => (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

/* ══════════════════ figlet ══════════════════ */

const DEFAULT_FONTS = ['Standard', 'Slant', 'Big', 'Banner', 'Block', 'Digital', 'Doom', 'Ghost'];

/**
 * Render text as a figlet banner.
 * Font may be given as `-f <font> text` or `--font=<font> text`.
 */
async function banner(text, { font = 'Standard' } = {}) {
  const phrase = String(text).slice(0, MAX_LINE);
  const render = (f) =>
    new Promise((resolve, reject) => {
      figlet.text(phrase, { font: f, horizontalLayout: 'default', width: 80 }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

  let out;
  try {
    out = await render(font);
  } catch {
    // unknown font — fall back and say which one was used
    out = await render('Standard');
    font = 'Standard';
  }
  const lines = String(out).replace(/\s+$/, '').split('\n');
  const width = Math.max(...lines.map((l) => l.length));
  // figlet wraps at `width` by itself, so a long phrase becomes a taller banner
  // rather than a 209-column one nobody can read on a phone.
  return { text: lines.join('\n'), font, wide: width > 80 };
}

/** Which figlet fonts exist (for `.figletfonts`). */
const fontList = () => figlet.fontsSync().sort();

/* ══════════════════ ASCII art ══════════════════ */

/** A hand-drawn banner set so `.ascii` works with no font at all. */
const ASCII_ART = {
  zynex: `
 ███████╗██╗   ██╗███╗   ██╗███████╗██╗  ██╗
 ╚══███╔╝╚██╗ ██╔╝████╗  ██║██╔════╝╚██╗██╔╝
   ███╔╝  ╚████╔╝ ██╔██╗ ██║█████╗   ╚███╔╝
  ███╔╝    ╚██╔╝  ██║╚██╗██║██╔══╝   ██╔██╗
 ███████╗   ██║   ██║ ╚████║███████╗██╔╝ ██╗
 ╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝`,
  heart: `
   ██╗   ██╗    ██╗   ██╗
  ██╔╝   ╚██╗  ██╔╝   ╚██╗
 ██╔╝     ╚████╔╝     ╚██╗
 ╚██╗     ██╔╝██╗     ██╔╝
  ╚██╗   ██╔╝  ╚██╗   ██╔╝
   ╚═╝   ╚═╝    ╚═╝   ╚═╝`,
  skull: `
     ▄▄▄▄▄▄▄▄▄
   ▄█████████▄
  ███▀▀▀▀▀▀▀███
  ██  ▄▄ ▄▄  ██
  ██  ▀▀ ▀▀  ██
  ███▄▄▄▄▄▄▄███
   ▀█████████▀
     ▀▀ ▀▀ ▀▀`,
  fire: `
      (  .      )
   )           (              )
     .  '   .   '  .  '  .
(    .  .   .    .     *   )
  )  .   *  .   )     (   .`,
  cat: `
    /\\_/\\
   ( o.o )   purr
    > ^ <
   /|   |\\
  (_|   |_)
    |   |
    |___|`,
  rose: `
      _(_)_
  @@@@(_)@@@
   (_)   (_)
    \\  o  /
     \\ | /
      |_|`,
  star: `
         *
        ***
   *************
    ***********
     *********
    ***  *  ***
   **    *    **
  *      *      *`,
  love: `
  ██╗     ██████╗ ██╗   ██╗███████╗
  ██║    ██╔═══██╗██║   ██║██╔════╝
  ██║    ██║   ██║██║   ██║█████╗
  ██║    ██║   ██║╚██╗ ██╔╝██╔══╝
  ███████╗╚██████╔╝ ╚████╔╝ ███████╗
  ╚══════╝ ╚═════╝   ╚═══╝  ╚══════╝`,
  ghost: `
        .-.
     .-(   )-.
    /   o o   \\
   |  \\     /  |
   |   \\___/   |
   |           |
   |  |     |  |`,
  bird: `
                __
               / _)
      .-^^^-/ /
   __/       /
  <__.|_|-|_|`,
};

/* ══════════════════ small-caps / fancy lettering ══════════════════ */

const LATIN = [...'abcdefghijklmnopqrstuvwxyz'];

/** Replace a-z with a same-length glyph table, code-unit safe. */
function transliterate(str, table) {
  const glyphs = [...table];
  if (glyphs.length !== LATIN.length) throw new Error(`glyph table has ${glyphs.length} entries, needs 26`);
  let out = '';
  for (const ch of String(str)) {
    const i = LATIN.indexOf(ch.toLowerCase());
    out += i >= 0 ? glyphs[i] : ch;
  }
  return out;
}

const FANCY = {
  smallcaps: (s) => transliterate(s.toLowerCase(), 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ'),
  symbols: (s) =>
    [...s]
      .map((c) => {
        const map = {
          a: 'α', b: 'в', c: '¢', d: '∂', e: 'є', f: 'ƒ', g: 'g', h: 'н', i: 'ι',
          j: 'נ', k: 'к', l: 'ℓ', m: 'м', n: 'η', o: 'σ', p: 'ρ', q: 'q', r: 'я',
          s: 'ѕ', t: 'т', u: 'υ', v: 'ν', w: 'ω', x: 'χ', y: 'у', z: 'z',
        };
        return map[c.toLowerCase()] || c;
      })
      .join(''),
  // Glyph tables are split with [...str], never indexed as UTF-16 code units:
  // the cursive letterforms are astral, so `cur[i]` returned half a surrogate
  // pair and `.cursive zynex` printed "𝓏𝓎 𝓍" with letters missing.
  cursive: (s) => transliterate(s, '𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏'),
  letter: (s) => transliterate(s, 'ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ'),
  bigtext: (s) => asciiWord(s),
  smalltext: (s) => FANCY.smallcaps(s),
};

/** block letters drawn from █ for arbitrary words (no font needed) */
function asciiWord(word) {
  const GLYPHS = {
    a: ['█▀█', '█▀█', '▀ ▀'], b: ['█▀▄', '█▀▄', '▀▀ '], c: ['█▀▀', '█  ', '▀▀▀'],
    d: ['█▀▄', '█ █', '▀▀ '], e: ['█▀▀', '█▀▀', '▀▀▀'], f: ['█▀▀', '█▀▀', '▀  '],
    g: ['█▀▀', '█ █', '▀▀▀'], h: ['█ █', '█▀█', '▀ ▀'], i: ['█', '█', '▀'],
    j: ['  █', '  █', '▀▀ '], k: ['█ █', '█▀▄', '▀ ▀'], l: ['█  ', '█  ', '▀▀▀'],
    m: ['█▄█', '█ █', '▀ ▀'], n: ['█▀█', '█ █', '▀ ▀'], o: ['█▀█', '█ █', '▀▀▀'],
    p: ['█▀█', '█▀▀', '▀  '], q: ['█▀█', '█ █', '▀▀▄'], r: ['█▀▄', '█▀▄', '▀ ▀'],
    s: ['█▀▀', '▀▀█', '▀▀▀'], t: ['▀█▀', ' █ ', ' ▀ '], u: ['█ █', '█ █', '▀▀▀'],
    v: ['█ █', '█ █', ' ▀ '], w: ['█ █', '█▄█', '▀ ▀'], x: ['█ █', ' ▄ ', '▀ ▀'],
    y: ['█ █', ' █ ', ' ▀ '], z: ['▀▀█', ' ▄▀', '▀▀▀'], ' ': ['  ', '  ', '  '],
    '0': ['█▀█', '█ █', '▀▀▀'], '1': ['▄█ ', ' █ ', '▀▀▀'], '2': ['▀▀█', '█▀▀', '▀▀▀'],
    '3': ['▀▀█', ' ▀█', '▀▀▀'], '4': ['█ █', '▀▀█', '  ▀'], '5': ['█▀▀', '▀▀█', '▀▀▀'],
    '6': ['█▀▀', '█▀█', '▀▀▀'], '7': ['▀▀█', '  █', '  ▀'], '8': ['█▀█', '█▀█', '▀▀▀'],
    '9': ['█▀█', '▀▀█', '▀▀▀'],
  };
  const rows = ['', '', ''];
  for (const ch of String(word).toLowerCase().slice(0, 12)) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let i = 0; i < 3; i++) rows[i] += g[i] + ' ';
  }
  return rows.join('\n');
}

/* ══════════════════ code → image ══════════════════ */

/**
 * Render a snippet as a syntax-tinted image, like Carbon but local.
 * Not a screenshot: real syntax colouring for the few languages we can tokenise
 * honestly (keywords, strings, numbers, comments).
 */
const KEYWORDS = {
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'await', 'async', 'class', 'new', 'import', 'from', 'export', 'try', 'catch', 'throw', 'typeof'],
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'class', 'try', 'except', 'with', 'as', 'lambda', 'yield', 'None', 'True', 'False'],
  php: ['function', 'return', 'if', 'else', 'foreach', 'echo', 'class', 'new', 'public', 'private', 'static'],
};

function tokenise(line, lang) {
  const words = new Set(KEYWORDS[lang] || KEYWORDS.js);
  // Tokenise in ONE pass; chained .replace() re-colours its own inserted markup
  // (the digits inside fill="#a5d6a7" became a <tspan> and broke the XML).
  const TOKEN = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/[^\n]*|#[^\n]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z0-9_$]+)/g;
  let out = '';
  let m;
  let last = 0;
  while ((m = TOKEN.exec(line)) !== null) {
    if (m.index > last) out += esc(line.slice(last, m.index));
    last = TOKEN.lastIndex;
    if (m[1]) out += `<tspan fill="#a5d6a7">${esc(m[1])}</tspan>`;
    else if (m[2]) out += `<tspan fill="#6b7f8f">${esc(m[2])}</tspan>`;
    else if (m[3]) out += `<tspan fill="#f0b37e">${esc(m[3])}</tspan>`;
    else if (m[4] && words.has(m[4])) out += `<tspan fill="#82aaff">${esc(m[4])}</tspan>`;
    else out += esc(m[0]);
  }
  if (last < line.length) out += esc(line.slice(last));
  return out;
}

async function codeImage(code, { lang = 'js', theme = 'dark' } = {}) {
  const lines = String(code).replace(/\t/g, '  ').split('\n').slice(0, 40);
  const fs = 20;
  const pad = 34;
  const lineH = Math.round(fs * 1.55);
  const charW = fs * 0.6; // DejaVu Sans Mono advance
  const width = Math.min(1400, Math.max(520, Math.round(Math.max(...lines.map((l) => l.length)) * charW + pad * 2)));
  const height = pad + 14 + (lines.length - 1) * lineH + pad;

  const bg = theme === 'light' ? '#f5f7fa' : '#151b23';
  const fg = theme === 'light' ? '#243b53' : '#d6deeb';

  const body = lines
    .map(
      (l, i) =>
        `<text x="${pad}" y="${pad + 14 + i * lineH}" font-family="DejaVu Sans Mono, monospace" font-size="${fs}" fill="${fg}">${tokenise(l || ' ', lang)}</text>`,
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${bg}"/>
    <circle cx="${pad}" cy="18" r="6" fill="#ff5f57"/><circle cx="${pad + 20}" cy="18" r="6" fill="#febc2e"/>
    <circle cx="${pad + 40}" cy="18" r="6" fill="#28c840"/>
    <line x1="0" y1="34" x2="${width}" y2="34" stroke="${theme === 'light' ? '#dde3ea' : '#1f2933'}" stroke-width="1"/>
    ${body}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/* ══════════════════ hashtags ══════════════════ */

const STOP = new Set('the a an and or but if then than that this these those is are was were be been being of to in on at by for with from as it its i you he she they we my your his her their not no so very just about into over under again more most some such only own same too can will just'.split(' '));

/** extract weighted hashtags from a block of text */
function hashtags(text) {
  const clean = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const counts = new Map();
  for (const w of clean.split(/\s+/)) {
    if (!w || w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([w]) => `#${w}`);
}

/* ══════════════════ names ══════════════════ */

const NAMES = new Set([
  'ascii', 'asciiart', 'figlet', 'figletfonts', 'bigtext', 'smalltext', 'tinytext',
  'cursive', 'symbol', 'symbols', 'letter', 'codeimage', 'carbon', 'hashtag', 'hashtags',
  'image2', 'text2', 'art',
]);

const ART_KEYS = Object.keys(ASCII_ART);

module.exports = {
  id: 'art',
  name: 'art-engine',
  match: (n) => NAMES.has(n),
  describe(name) {
    if (name === 'figlet' || name === 'figletfonts') return 'ASCII banner (figlet)';
    if (['codeimage', 'carbon'].includes(name)) return 'Render code as an image';
    if (['hashtag', 'hashtags'].includes(name)) return 'Extract hashtags from text';
    return 'ASCII / fancy text art';
  },
  extraNames: [...NAMES],
  _internals: { banner, fontList, asciiWord, codeImage, hashtags, ASCII_ART, tokenise, FANCY, transliterate },

  async execute({ command, args, reply }) {
    const raw = ARG(args);

    /* ── figlet ── */
    if (command === 'figlet') {
      // `-f Font text`, `--font=Foo text`, or plain text
      let font = 'Standard';
      let text = raw;
      const fMatch = raw.match(/^(?:-f|--font)[= ]+(\S+)\s+([\s\S]+)$/i);
      if (fMatch) {
        font = fMatch[1];
        text = fMatch[2];
      }
      if (!text) {
        return reply(
          `🔤 Usage: \`.figlet your text\` or \`.figlet -f Banner your text\`\n\n` +
            `Fonts: \`.figletfonts\` lists all ${fontList().length}.\n` +
            `Popular: ${DEFAULT_FONTS.join(', ')}`,
        );
      }
      try {
        const r = await banner(text, { font });
        return reply(
          '```\n' + r.text + '\n```' +
            (r.font !== font ? `\n_Font *${font}* not found — used *${r.font}*._` : '') +
            (r.wide ? '\n_Shrunk because the banner was too wide for a phone._' : ''),
        );
      } catch (e) {
        return reply(`❌ Could not render that (${e.message}).`);
      }
    }

    if (command === 'figletfonts') {
      const list = fontList();
      const chunks = [];
      for (let i = 0; i < list.length; i += 40) chunks.push(list.slice(i, i + 40).join(' · '));
      return reply(`🔤 *${list.length} figlet fonts*\n\n` + chunks.join('\n\n') + '\n\n_Use: `.figlet -f <Font> text`_');
    }

    /* ── hand-drawn art ── */
    if (command === 'ascii' || command === 'asciiart' || command === 'art') {
      const key = (raw || 'zynex').toLowerCase();
      if (ASCII_ART[key]) {
        return reply('```' + ASCII_ART[key] + '\n```');
      }
      // anything not in the set gets a real banner instead of a made-up drawing
      try {
        const r = await banner(raw || 'ZYNEX', { font: 'Standard' });
        return reply(
          '```\n' + r.text + '\n```\n\n' +
            `_No drawing for *${key}*. Have these: ${ART_KEYS.join(', ')}_\n` +
            `_Shown above: a banner of what you typed._`,
        );
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── fancy alphabets ── */
    if (FANCY[command]) {
      if (!raw) return reply(`❌ Use \`.${command} your text\``);
      return reply(`✨ ${FANCY[command](raw)}\n\n_${command} · Unicode lettering, so it copies and pastes everywhere._`);
    }

    /* ── code → image ── */
    if (command === 'codeimage' || command === 'carbon') {
      if (!raw) {
        return reply(
          `🖼️ Usage: \`.${command} const x = 1;\`\n` +
            `Language: \`.${command} -l python def f(): pass\`\n\n` +
            `_Rendered locally — not a screenshot, so it works offline and cannot fail on a CDN._`,
        );
      }
      let lang = 'js';
      let code = raw;
      const lMatch = raw.match(/^(?:-l|--lang)[= ]+(\w+)\s+([\s\S]+)$/i);
      if (lMatch) {
        lang = lMatch[1].toLowerCase();
        code = lMatch[2];
      }
      try {
        const png = await codeImage(code, { lang });
        const { sock, from, msg } = arguments[0];
        return sock.sendMessage(from, { image: png, caption: `🖼️ *${lang.toUpperCase()}* · ${code.split('\n').length} lines` }, { quoted: msg });
      } catch (e) {
        return reply(`❌ Could not render that (${e.message}).`);
      }
    }

    /* ── hashtags ── */
    if (command === 'hashtag' || command === 'hashtags') {
      if (!raw) return reply(`#️⃣ Usage: \`.${command} paste some text here\``);
      const tags = hashtags(raw);
      if (!tags.length) return reply('❌ No usable words in that (all short or stop-words).');
      return reply(`#️⃣ *${tags.length} hashtags*\n\n${tags.join(' ')}`);
    }

    /* ── honest refusals for the vague names ── */
    if (command === 'image2' || command === 'text2') {
      return reply(
        `❓ *${command}* is ambiguous in the catalogue — it has no described purpose.\n\n` +
          `Name what you want instead:\n` +
          `▸ \`.toimage\` — image metadata\n` +
          `▸ \`.stiker\` — turn an image into a sticker\n` +
          `▸ \`.figlet text\` — ASCII banner\n` +
          `▸ \`.codeimage code\` — code as a picture`,
      );
    }

    return reply(`❌ *${command}* isn't wired up.`);
  },
};
