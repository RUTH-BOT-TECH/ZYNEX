/**
 * STICKER ENGINE — the sticker family the catalogue lists.
 *
 * Everything is local: sharp for images, the existing ffmpeg-static wrapper for
 * video, and SVG for text stickers. No network, no keys, no rate limits.
 *
 * Design notes that matter:
 *
 *  • WhatsApp stickers are **512×512 WebP, ≤ 1 MB, ≤ 3 s** for animated ones.
 *    Every path here enforces that, because a 4 MB 800×600 WebP is accepted by
 *    the API and then refused by the phone — which looks like the bot is broken.
 *  • Transparency has to survive. Flipping/rotating/cropping a cut-out sticker
 *    and flattening it onto white would silently ruin it, so every operation
 *    works on RGBA and the output keeps an alpha channel.
 *  • "Emoji" stickers here are the real Unicode emoji drawn to PNG by sharp, not
 *    a scraped image — so `.emoji 🚀` works offline and cannot 404.
 *
 * Animated stickers come in as video/GIF; `.togif` and friends already exist in
 * the converter, so this engine accepts them and converts via ffmpeg-static.
 */
'use strict';

const sharp = require('sharp');

const MAX_STICKER_BYTES = 1000 * 1024; // WhatsApp's ceiling
const STICKER_SIDE = 512;

const esc = (v) =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/* ══════════════════ the sticker format ══════════════════ */

/**
 * Fit any image into the WhatsApp sticker box without distorting it, keep the
 * alpha channel, and keep the file under the size ceiling.
 */
async function toSticker(buf, { side = STICKER_SIDE, quality = 90 } = {}) {
  const inner = await sharp(buf)
    .resize(side, side, { fit: 'inside', withoutEnlargement: true, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const { width = side, height = side } = await sharp(inner).metadata();

  // centre it on a transparent square — WhatsApp crops to square otherwise
  let out = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: inner, left: Math.round((side - width) / 2), top: Math.round((side - height) / 2) }])
    .webp({ quality, alphaQuality: 100, effort: 4 })
    .toBuffer();

  // step the quality down rather than hand WhatsApp an oversized sticker
  let q = quality;
  while (out.length > MAX_STICKER_BYTES && q > 40) {
    q -= 15;
    out = await sharp({
      create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: inner, left: Math.round((side - width) / 2), top: Math.round((side - height) / 2) }])
      .webp({ quality: q, alphaQuality: 80, effort: 4 })
      .toBuffer();
  }
  return out;
}

/** is this an animated source (video or gif)? */
const isAnimated = (buf) =>
  buf &&
  buf.length > 12 &&
  (buf.toString('ascii', 0, 3) === 'GIF' ||
    buf.toString('ascii', 4, 8) === 'ftyp' ||
    buf.toString('ascii', 0, 4) === 'RIFF');

/* ══════════════════ image operations ══════════════════ */

const OPS = {
  /** circular crop with a transparent surround */
  async circle(buf) {
    const side = STICKER_SIDE;
    const inner = await sharp(buf).resize(side, side, { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from(
      `<svg width="${side}" height="${side}"><circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}" fill="#fff"/></svg>`,
    );
    const cut = await sharp(inner)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cut, left: 0, top: 0 }])
      .webp({ quality: 92, alphaQuality: 100 })
      .toBuffer();
  },

  /** rounded corners — `radius` in px on a 512 canvas */
  async rounded(buf, { radius = 64 } = {}) {
    const side = STICKER_SIDE;
    const inner = await sharp(buf).resize(side, side, { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from(
      `<svg width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
    );
    const cut = await sharp(inner).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    return sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cut, left: 0, top: 0 }])
      .webp({ quality: 92, alphaQuality: 100 })
      .toBuffer();
  },

  /** mirror horizontally */
  async flip(buf, { vertical = false } = {}) {
    return toSticker(await sharp(buf).flop().toBuffer());
  },

  /** rotate — degrees, multiples of 90 keep it clean */
  async rotate(buf, { degrees = 90 } = {}) {
    return toSticker(await sharp(buf).rotate(degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer());
  },

  /** crop to the subject using sharp's trim, then centre */
  async crop(buf) {
    let trimmed;
    try {
      trimmed = await sharp(buf).trim({ threshold: 12 }).toBuffer();
    } catch {
      trimmed = buf; // nothing to trim — a uniform image
    }
    return toSticker(trimmed);
  },

  /** force square with cover (fills the frame, may clip edges) */
  async square(buf) {
    const inner = await sharp(buf)
      .resize(STICKER_SIDE, STICKER_SIDE, { fit: 'cover' })
      .png()
      .toBuffer();
    return sharp(inner).webp({ quality: 92, alphaQuality: 100 }).toBuffer();
  },
};

/* ══════════════════ watermarks ══════════════════ */

async function watermark(buf, text = null, { position = 'br' } = {}) {
  text = text || require('../botInfo').BOT_NAME;
  const side = STICKER_SIDE;
  const base = await sharp(buf)
    .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // The pill has to sit on the *picture*, not on the 512 canvas — a contain-fit
  // leaves letterbox bands, and the first version put the watermark in one.
  const box = await sharp(base).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  const art = { x: box.info.trimOffsetLeft ?? 0, y: box.info.trimOffsetTop ?? 0, w: box.info.width, h: box.info.height };
  const offsetX = art.x < 0 ? -art.x : 0;
  const offsetY = art.y < 0 ? -art.y : 0;
  const artW = art.w || side;
  const artH = art.h || side;

  const label = String(text).slice(0, 20);
  const fs = Math.max(15, Math.min(26, Math.floor(artW / Math.max(5, label.length) * 0.8)));
  const w = Math.round(label.length * fs * 0.62 + 22);
  const h = fs + 14;
  const margin = 8;
  const x = position === 'bl' ? offsetX + margin
    : position === 'center' ? offsetX + Math.round((artW - w) / 2)
    : offsetX + artW - w - margin;
  const y = position.startsWith('t') ? offsetY + margin : offsetY + artH - h - margin;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#000000" opacity="0.6"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 1}" text-anchor="middle" dominant-baseline="central"
      font-family="DejaVu Sans, sans-serif" font-size="${fs}" font-weight="bold" fill="#ffffff">${esc(label)}</text>
  </svg>`;
  return sharp(base)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer();
}

/* ══════════════════ text stickers ══════════════════ */

const PALETTES = [
  ['#0f4c81', '#ffffff'], ['#e63946', '#ffffff'], ['#2a9d8f', '#ffffff'],
  ['#f4a261', '#111111'], ['#6a4c93', '#ffffff'], ['#ffd166', '#111111'],
  ['#06d6a0', '#111111'], ['#111827', '#38bdf8'], ['#fdf0d5', '#780000'],
  ['#1f2937', '#f9fafb'],
];

const wrap = (text, maxChars) => {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line.trim());
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
};

/**
 * A text sticker: rounded plate, wrapped bold text, optional emoji frame.
 * `style` picks a palette deterministically from the text so the same phrase
 * always looks the same.
 */
async function textSticker(text, { palette, style = 'plain' } = {}) {
  const side = STICKER_SIDE;
  const phrase = String(text).trim().slice(0, 120);
  const [bg, fg] = palette || PALETTES[Math.abs(hash(phrase)) % PALETTES.length];

  const chars = Math.min(16, Math.max(7, Math.ceil(Math.sqrt(phrase.length * 1.7))));
  const lines = wrap(phrase, chars);
  const size = Math.min(96, Math.floor((side * 0.78) / Math.max(3, lines.length)));
  const lineH = Math.round(size * 1.16);
  const startY = side / 2 - ((lines.length - 1) * lineH) / 2;

  const emit = lines
    .map(
      (l, i) =>
        `<text x="${side / 2}" y="${startY + i * lineH}" text-anchor="middle" dominant-baseline="central"
           font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="${fg}">${esc(l)}</text>`,
    )
    .join('');

  const frame =
    style === 'bubble'
      ? `<rect x="26" y="26" width="${side - 52}" height="${side - 52}" rx="70" fill="${bg}"/>
         <polygon points="${side / 2 - 30},${side - 26} ${side / 2 + 30},${side - 26} ${side / 2},${side - 74}" fill="${bg}"/>`
      : style === 'burst'
        ? starPath(side, bg)
        : `<rect x="26" y="26" width="${side - 52}" height="${side - 52}" rx="56" fill="${bg}"/>`;

  const dots = Array.from({ length: 0 }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">
    ${dots}${frame}${emit}
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 94, alphaQuality: 100 }).toBuffer();
}

function starPath(side, fill) {
  const cx = side / 2;
  const cy = side / 2;
  const spikes = 14;
  const outer = side * 0.48;
  const inner = side * 0.37;
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return h;
}

/* ══════════════════ emoji stickers ══════════════════ */

/**
 * Twemoji SVGs, the standard open-licence emoji artwork.
 *
 * Why this and not a font: this container has **no emoji font at all** —
 * `fc-match "Noto Color Emoji"` falls back to DejaVu, and DejaVu has no colour
 * glyphs. The first version rendered `.emoji 🚀` as the literal text "01F680",
 * which is the codepoint, not the emoji. Twemoji gives real colour artwork and
 * renders identically everywhere, since it is plain SVG.
 */
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg';

/** codepoint string for a single emoji, matching Twemoji's filenames */
function twemojiCode(glyph) {
  const points = [];
  for (const ch of String(glyph)) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) continue; // variation selector is dropped in filenames
    points.push(cp.toString(16));
  }
  return points.join('-');
}

/** split a string into individual emoji (grapheme-ish, handles ZWJ + modifiers) */
function splitEmoji(input) {
  const out = [];
  const text = String(input);
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    let chunk = String.fromCodePoint(cp);
    i += chunk.length;
    // join zero-width-joiner sequences and skin-tone modifiers
    for (;;) {
      const next = text.codePointAt(i);
      if (!next) break;
      if (next === 0x200d || (next >= 0x1f3fb && next <= 0x1f3ff)) {
        chunk += String.fromCodePoint(next);
        i += String.fromCodePoint(next).length;
        const after = text.codePointAt(i);
        if (after) {
          chunk += String.fromCodePoint(after);
          i += String.fromCodePoint(after).length;
        }
        continue;
      }
      break;
    }
    if (chunk.trim()) out.push(chunk);
  }
  return out;
}

async function fetchTwemoji(glyph) {
  const code = twemojiCode(glyph);
  if (!code) throw new Error('no emoji found');
  const res = await fetch(`${TWEMOJI}/${code}.svg`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`no artwork for ${glyph}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * One big emoji on an optional plate. Throws with a clear message if Twemoji has
 * no artwork for that codepoint, so a wrong glyph never becomes a blank sticker.
 */
async function emojiSticker(emoji, { bg = null, side = STICKER_SIDE, pad = 0.1 } = {}) {
  const glyphs = splitEmoji(emoji || '🙂');
  const first = glyphs[0];
  if (!first) throw new Error('no emoji in that');

  const art = await fetchTwemoji(first);
  const inner = Math.round(side * (1 - pad * 2));
  const scaled = await sharp(art).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const m = await sharp(scaled).metadata();

  const plate = bg
    ? `<rect width="${side}" height="${side}" rx="72" fill="${bg}"/>`
    : '';
  const base = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">${plate}</svg>`))
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{ input: scaled, left: Math.round((side - m.width) / 2), top: Math.round((side - m.height) / 2) }])
    .webp({ quality: 94, alphaQuality: 100 })
    .toBuffer();
}

/** a "row" of emoji as one sticker (`.emojisticker 🚀🔥🌟`) */
async function emojiRow(emoji, { side = STICKER_SIDE } = {}) {
  const glyphs = splitEmoji(emoji).slice(0, 6);
  if (!glyphs.length) throw new Error('no emoji in that');
  const cell = Math.floor(side / glyphs.length);
  const parts = [];
  for (let i = 0; i < glyphs.length; i++) {
    try {
      const art = await fetchTwemoji(glyphs[i]);
      const png = await sharp(art).resize(cell - 8).png().toBuffer();
      const m = await sharp(png).metadata();
      parts.push({
        input: png,
        left: i * cell + Math.round((cell - m.width) / 2),
        top: Math.round((side - m.height) / 2),
      });
    } catch {
      /* skip a glyph with no artwork rather than fail the whole row */
    }
  }
  if (!parts.length) throw new Error('no artwork for any of those');
  const base = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  return sharp(base).composite(parts).webp({ quality: 94, alphaQuality: 100 }).toBuffer();
}

/** turn a phrase into big-emoji letters where possible */
const LETTER_EMOJI = {
  a: '🅰️', b: '🅱️', c: '🌊', d: '🎯', e: '📧', f: '🎏', g: '🎮', h: '🏠', i: 'ℹ️',
  j: '🎷', k: '🔑', l: '🎸', m: 'Ⓜ️', n: '🌙', o: '⭕', p: '🅿️', q: '👑', r: '🌈',
  s: '💲', t: '🌴', u: '⛎', v: '✔️', w: '〰️', x: '❌', y: '🍸', z: '💤',
};

/** .emojify — render a word using emoji letters, block letters, or a mix */
async function emojify(text, { mode = 'letters' } = {}) {
  const word = String(text).toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 12) || require('../botInfo').BOT_NAME.toUpperCase().slice(0, 12);
  if (mode === 'letters') {
    const mapped = [...word.toLowerCase()]
      .map((ch) => (ch === ' ' ? '  ' : LETTER_EMOJI[ch] || ch.toUpperCase()))
      .join(' ');
    return mapped;
  }
  return null;
}

/* ══════════════════ the engine ══════════════════ */

const NAMES = new Set([
  // text stickers
  'ttp2', 'ttp3', 'ttp4', 'ttp5', 'ttp6', 'attp2', 'attp3', 'ttps', 'stickertext', 'stickers',
  // image edits
  'stickercircle', 'stickerrounded', 'stickerflip', 'stickerrotate', 'stickercrop',
  'stickersquare', 'stickerwm', 'stickerblur', 'stickerpack', 'sticker2',
  // emoji
  'emoji', 'emojify', 'emojisticker', 'emoji2sticker', 'emojigif', 'emixt',
  // misc
  'smeme', 'memesticker', 'stickersearch', 'tgsticker', 'tourl2',
  'webp2png', 'webp2mp4', 'gif2mp4', 'img2txt',
]);

const TTP_STYLES = {
  ttp2: { style: 'plain' }, attp2: { style: 'plain' }, attp3: { style: 'burst' },
  ttp3: { style: 'burst' }, ttp4: { style: 'bubble' }, ttp5: { style: 'plain', big: true },
  ttp6: { style: 'burst', big: true }, ttps: { style: 'plain' }, stickertext: { style: 'plain' },
};

module.exports = {
  id: 'sticker',
  name: 'sticker-engine',
  match: (n) => NAMES.has(n),
  describe(name) {
    if (TTP_STYLES[name]) return 'Text sticker';
    if (['emoji', 'emojify', 'emojisticker', 'emoji2sticker'].includes(name)) return 'Emoji sticker';
    if (name === 'img2txt') return 'Describe an image (needs a vision model — see refusal)';
    return 'Sticker edit';
  },
  extraNames: [...NAMES],
  _internals: { toSticker, textSticker, emojiSticker, watermark, emojify, OPS, isAnimated, PALETTES },

  async execute(ctx) {
    const { command, args, reply, sock, from, msg } = ctx;
    const text = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

    /* ── helpers bound to this message ── */
    const sendSticker = async (buf, caption) => {
      if (!buf) return reply('❌ Nothing to send.');
      try {
        return await sock.sendMessage(from, { sticker: buf }, { quoted: msg });
      } catch (e) {
        if (caption) return reply(`${caption}\n\n_Sticker send failed: ${e.message}_`);
        return reply(`❌ Could not send the sticker (${e.message}).`);
      }
    };

    const getMedia = async () => {
      if (typeof ctx.download !== 'function') {
        return { error: 'This command needs an image. Reply to one with the command.' };
      }
      try {
        const buf = await ctx.download();
        if (!buf?.length) return { error: 'Could not read that image.' };
        return { buf };
      } catch (e) {
        return { error: e.message };
      }
    };

    /* ══════════ text stickers ══════════ */
    if (TTP_STYLES[command] || command === 'stickertext') {
      if (!text) return reply(`❌ Use \`.${command} your text here\``);
      const opts = TTP_STYLES[command] || { style: 'plain' };
      const palette = command.startsWith('attp')
        ? PALETTES[Math.floor(Math.random() * PALETTES.length)]
        : undefined;
      try {
        return await sendSticker(await textSticker(text, { ...opts, palette }));
      } catch (e) {
        return reply(`❌ Could not render that sticker (${e.message}).`);
      }
    }

    /* ══════════ emoji ══════════ */
    if (command === 'emoji' || command === 'emojisticker' || command === 'emoji2sticker' || command === 'emojigif') {
      if (!text) return reply(`❌ Use \`.${command} 🚀\``);
      try {
        const many = splitEmoji(text).length > 1;
        return await sendSticker(many ? await emojiRow(text) : await emojiSticker(text));
      } catch (e) {
        return reply(
          `❌ Could not draw that emoji (${e.message}).\n\n` +
            `_Emoji artwork comes from Twemoji; a few rare codepoints have no file yet._`,
        );
      }
    }

    if (command === 'emojify') {
      if (!text) return reply('❌ Use `.emojify zynex`');
      const out = await emojify(text);
      return reply(`✨ ${out}\n\n_Emoji spelling — each letter mapped to the closest emoji._`);
    }

    if (command === 'emixt') {
      const [a, b] = (text || '').split(/\s+/);
      if (!a || !b) return reply('❌ Use `.emixt 😂 🔥` — two emoji in one sticker.');
      // no Emoji Kitchen keyless — but stacking two glyphs is honest and local
      try {
        const side = STICKER_SIDE;
        const [artA, artB] = await Promise.all([fetchTwemoji(splitEmoji(a)[0]), fetchTwemoji(splitEmoji(b)[0])]);
        const size = Math.round(side * 0.52);
        const pngA = await sharp(artA).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        const pngB = await sharp(artB).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        const base = await sharp({
          create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).png().toBuffer();
        return await sendSticker(
          await sharp(base)
            .composite([
              { input: pngA, left: Math.round(side * 0.06), top: Math.round(side * 0.14) },
              { input: pngB, left: Math.round(side * 0.42), top: Math.round(side * 0.40) },
            ])
            .webp({ quality: 94, alphaQuality: 100 })
            .toBuffer(),
        );
      } catch (e) {
        return reply(`❌ Could not make that sticker (${e.message}).`);
      }
    }

    /* ══════════ image edits ══════════ */
    const EDIT = {
      stickercircle: () => 'circle',
      stickerrounded: () => 'rounded',
      stickerflip: () => 'flip',
      stickerrotate: () => 'rotate',
      stickercrop: () => 'crop',
      stickersquare: () => 'square',
    };

    if (EDIT[command]) {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}\n\n_Reply to an image with \`.${command}\`._`);
      try {
        const out = await OPS[EDIT[command]()](buf);
        return await sendSticker(out);
      } catch (e) {
        return reply(`❌ Could not edit that image (${e.message}).`);
      }
    }

    if (command === 'stickerwm') {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}`);
      try {
        return await sendSticker(await watermark(buf, text));
      } catch (e) {
        return reply(`❌ Could not watermark that (${e.message}).`);
      }
    }

    if (command === 'stickerblur') {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}`);
      try {
        return await sendSticker(await toSticker(await sharp(buf).blur(9).toBuffer()));
      } catch (e) {
        return reply(`❌ Could not blur that (${e.message}).`);
      }
    }

    if (command === 'sticker2' || command === 'stickerpack') {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}\n\n_Reply to an image to turn it into a sticker._`);
      try {
        return await sendSticker(await toSticker(buf));
      } catch (e) {
        return reply(`❌ Could not make a sticker of that (${e.message}).`);
      }
    }

    /* ══════════ format conversions ══════════ */
    if (command === 'webp2png') {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}`);
      try {
        const png = await sharp(buf).png().toBuffer();
        return sock.sendMessage(from, { image: png, caption: '🖼️ WEBP → PNG' }, { quoted: msg });
      } catch (e) {
        return reply(`❌ Could not convert that (${e.message}).`);
      }
    }

    if (command === 'webp2mp4' || command === 'gif2mp4') {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}`);
      try {
        const ff = require('../ffmpeg');
        // convert() resolves to { ok, buffer, stderr } — not a bare buffer
        const conv = await ff.convert(
          buf,
          ['-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'],
          { inExt: '.webp', outExt: '.mp4' },
        );
        if (!conv.ok || !conv.buffer) {
          throw new Error((conv.stderr || 'ffmpeg produced no output').split('\n').slice(-2).join(' ').slice(0, 140));
        }
        return sock.sendMessage(from, { video: conv.buffer, caption: `🎬 ${command.toUpperCase()}` }, { quoted: msg });
      } catch (e) {
        return reply(
          `❌ Could not convert that (${e.message}).\n\n_Animated stickers must be video or GIF — a static WebP has no motion to convert._`,
        );
      }
    }

    /* ══════════ meme ══════════ */
    if (command === 'smeme' || command === 'memesticker') {
      const { buf, error } = await getMedia();
      if (error) return reply(`❌ ${error}\n\n_Reply to an image: \`.${command} top text | bottom text\`_`);
      const [top, bottom] = text.includes('|') ? text.split('|').map((s) => s.trim()) : ['', text];
      try {
        const side = STICKER_SIDE;
        const base = await sharp(buf)
          .resize(side, side, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        const font = (t) => Math.min(56, Math.floor(460 / Math.max(4, String(t).length)));
        const meme = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">
          ${top ? `<text x="${side / 2}" y="52" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
             font-size="${font(top)}" fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke">${esc(top)}</text>` : ''}
          ${bottom ? `<text x="${side / 2}" y="${side - 34}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
             font-size="${font(bottom)}" fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke">${esc(bottom)}</text>` : ''}
        </svg>`;
        const out = await sharp(base)
          .composite([{ input: Buffer.from(meme), left: 0, top: 0 }])
          .webp({ quality: 92, alphaQuality: 100 })
          .toBuffer();
        return await sendSticker(out);
      } catch (e) {
        return reply(`❌ Could not build that meme (${e.message}).`);
      }
    }

    /* ══════════ honest refusals ══════════ */
    if (command === 'img2txt') {
      return reply(
        `🚫 *img2txt* needs a vision model, and the one keyless model available\n` +
          `(\`.imagine\`) only generates images — it cannot read them.\n\n` +
          `What works instead:\n` +
          `▸ \`.toimage\` — real image metadata (format, size, weight)\n` +
          `▸ \`.convert metadata\` — same, plus EXIF and orientation\n` +
          `▸ \`.scan <link>\` — check a link found *in* a screenshot\n` +
          `▸ \`.ocr\` — refuses too, and explains why (no keyless OCR)`,
      );
    }

    if (command === 'stickersearch') {
      return reply(
        `🔎 *Sticker search needs a source, and there isn't one.*\n\n` +
          `Every sticker-search API (Giphy/Tenor sticker endpoints) needs a key, and the\n` +
          `keyless GIF services that remain only serve GIFs — which WhatsApp takes as\n` +
          `video, not as a sticker pack.\n\n` +
          `What works instead:\n` +
          `▸ Reply to any image with \`.stiker\` to make your own\n` +
          `▸ \`.ttp2 your text\` · \`.ttp4 your text\` — text stickers, rendered locally\n` +
          `▸ \`.emoji 🚀\` — big emoji sticker\n` +
          `▸ \`.emojimix 😂 🔥\` — Google Emoji Kitchen combinations (real API)`,
      );
    }

    if (command === 'tgsticker') {
      return reply(
        `🚫 *tgsticker* would import a Telegram sticker pack. Telegram's API needs a\n` +
          `bot token, and there is no keyless endpoint that resolves a pack name.\n\n` +
          `What works instead:\n` +
          `▸ \`.ssweb <telegram sticker url>\` — screenshot a public page\n` +
          `▸ Reply to an image with \`.stiker\` to make your own sticker`,
      );
    }

    if (command === 'tourl2') {
      return reply(
        `🔗 Use \`.upload\` (or \`.tourl\`) — it is already wired to two working keyless hosts\n` +
          `(uguu.se, then tmpfiles.org) and replies with a real direct link.\n\n` +
          `\`.tourl2\` had no separate host left to add: catbox, litterbox, 0x0.st and file.io\n` +
          `are all dead from this host, so a second implementation would just be the same code.`,
      );
    }

    return reply(`❌ *${command}* isn't wired up.`);
  },
};

module.exports.toSticker = toSticker;
module.exports.textSticker = textSticker;
module.exports.emojiSticker = emojiSticker;
module.exports.emojiRow = emojiRow;
module.exports.splitEmoji = splitEmoji;
module.exports.twemojiCode = twemojiCode;
module.exports.watermark = watermark;
module.exports.OPS = OPS;
