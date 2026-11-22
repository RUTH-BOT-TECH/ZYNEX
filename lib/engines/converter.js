/**
 * CONVERTER ENGINE
 *
 * Media conversion that actually runs — no third-party image services.
 *
 * Three backends, all local:
 *   sharp       image transforms, format conversion, SVG/emoji rendering
 *   ffmpeg      audio <-> video, gif, frames, compression
 *   imagemagick PDF output (sharp's prebuilt binary has no PDF writer)
 *
 * Two network features only, both verified keyless:
 *   upload      tmpfiles.org / uguu.se  (real uploads, verified)
 *   screenshot  image.thum.io / api.microlink.io (real page captures)
 *
 * Anything that cannot be done without an API key is refused explicitly and
 * names the exact command that works instead. It is never faked.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ff = require('../ffmpeg');

/* ── limits ──────────────────────────────────────────────── */
const MAX_IMAGE = 25 * 1024 * 1024;      // 25 MB
const WA_IMAGE_CEILING = 16 * 1024 * 1024; // WhatsApp practical image ceiling
const WA_BUDGET = 14 * 1024 * 1024;

/* ── image helpers ───────────────────────────────────────── */
async function loadImage(ctx) {
  const quoted = ctx.msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const direct = ctx.msg?.message?.imageMessage;
  const hasMedia = Boolean(quoted?.imageMessage || direct);
  if (!hasMedia) return { error: 'Reply to an *image* with this command.' };
  try {
    const buf = await ctx.download();
    if (!buf || !buf.length) return { error: 'Could not download that image.' };
    if (buf.length > MAX_IMAGE) return { error: `That image is too large (${(buf.length / 1048576).toFixed(1)} MB). Max 25 MB.` };
    return { buf };
  } catch (e) {
    return { error: `Could not read that image (${e.message}).` };
  }
}

async function meta(buf) {
  try {
    const m = await sharp(buf).metadata();
    return { width: m.width, height: m.height, format: m.format, size: buf.length };
  } catch {
    return null;
  }
}

/** Send an image result, respecting WhatsApp's size ceiling. */
async function sendImage(ctx, buf, caption, opts = {}) {
  let out = buf;
  if (out.length > WA_IMAGE_CEILING) {
    // recompress rather than fail
    try {
      out = await sharp(out).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    } catch { /* keep original and let WhatsApp handle it */ }
  }
  try {
    await ctx.sock.sendMessage(ctx.from, { image: out, caption, ...opts }, { quoted: ctx.msg });
    return true;
  } catch (e) {
    await ctx.reply(`❌ Could not send the result (${e.message}).`);
    return false;
  }
}

/* ── text rendering (used by .stiker, .ttp, .attp, .qc, .quotely) ── */
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Wrap text into lines that fit a pixel width for a given font size.
 * Rough but effective: average glyph width is ~0.55em for DejaVu Sans.
 */
function wrapText(text, maxWidth, fontSize) {
  const perChar = fontSize * 0.55;
  const maxChars = Math.max(6, Math.floor(maxWidth / perChar));
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line.length) { line = w; continue; }
    if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/** Build a quote card PNG. */
async function quoteCard(text, author = '', opts = {}) {
  const W = 900;
  const PAD = 64;
  const fontSize = opts.fontSize || 38;
  const lines = wrapText(text, W - PAD * 2, fontSize);
  const lineH = Math.round(fontSize * 1.45);
  const H = Math.max(420, PAD * 2 + lines.length * lineH + (author ? 90 : 20));

  const bg = opts.bg || '#101822';
  const fg = opts.fg || '#f2f6fb';
  const accent = opts.accent || '#4fc3f7';

  const tspans = lines
    .map((l, i) => `<text x="${PAD}" y="${PAD + 40 + i * lineH}" font-size="${fontSize}" font-family="DejaVu Serif, Georgia, serif" fill="${fg}">${escapeXml(l)}</text>`)
    .join('');

  const authorEl = author
    ? `<text x="${W - PAD}" y="${H - 44}" font-size="26" text-anchor="end" font-family="DejaVu Sans" fill="${accent}">— ${escapeXml(author)}</text>`
    : `<text x="${W - PAD}" y="${H - 44}" font-size="22" text-anchor="end" font-family="DejaVu Sans" fill="${accent}">ZYNEX-MD</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    <rect x="0" y="0" width="10" height="${H}" fill="${accent}"/>
    <text x="${PAD}" y="${PAD - 14}" font-size="24" font-family="DejaVu Sans" fill="${accent}" opacity="0.7">“</text>
    ${tspans}
    ${authorEl}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Build a chat-bubble ("quote") image. */
async function chatBubble({ name, text, avatarColour }) {
  const W = 820;
  const PAD = 28;
  const fontSize = 30;
  const lines = wrapText(text, W - PAD * 2 - 40, fontSize);
  const lineH = Math.round(fontSize * 1.4);
  const H = PAD * 2 + 46 + lines.length * lineH + 24;

  const body = lines
    .map((l, i) => `<text x="${PAD + 20}" y="${PAD + 62 + i * lineH}" font-size="${fontSize}" font-family="DejaVu Sans" fill="#e9eef5">${escapeXml(l)}</text>`)
    .join('');

  const colour = avatarColour || '#2f9e5f';
  const initial = escapeXml((name || 'Z').trim().charAt(0).toUpperCase());

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" rx="18" fill="#1f2c34"/>
    <rect x="0" y="0" width="6" height="${H}" rx="3" fill="${colour}"/>
    <circle cx="${PAD + 24}" cy="${PAD + 24}" r="22" fill="${colour}"/>
    <text x="${PAD + 24}" y="${PAD + 33}" font-size="24" text-anchor="middle" font-family="DejaVu Sans" fill="#ffffff">${initial}</text>
    <text x="${PAD + 60}" y="${PAD + 32}" font-size="24" font-family="DejaVu Sans" fill="${colour}">${escapeXml(name || 'ZYNEX')}</text>
    ${body}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Render an emoji (or any text) to a transparent PNG. */
async function textToPng(text, { size = 512, colour = '#000000' } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <text x="50%" y="50%" font-size="${Math.round(size * 0.72)}" text-anchor="middle"
      dominant-baseline="central" font-family="DejaVu Sans" fill="${colour}">${escapeXml(text)}</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  // sticker-friendly: 512x512, transparent, webp
  return sharp(png).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 92 }).toBuffer();
}

/** Render text to a sticker with a coloured background and outline. */
async function textSticker(text, { bg = '#0f4c81', fg = '#ffffff', size = 512 } = {}) {
  const lines = wrapText(text, size * 0.82, Math.min(110, Math.floor(size / Math.max(3, text.length / 3))));
  const fontSize = lines.length === 1 ? Math.min(120, Math.floor(size * 0.7 / Math.max(1, text.length * 0.32)))
    : Math.min(84, Math.floor(size * 0.8 / lines.length));
  const lineH = Math.round(fontSize * 1.12);
  const startY = size / 2 - ((lines.length - 1) * lineH) / 2;

  const body = lines
    .map((l, i) => `<text x="50%" y="${startY + i * lineH}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central"
        font-family="DejaVu Sans, sans-serif" font-weight="bold" fill="${fg}"
        stroke="#00000033" stroke-width="2">${escapeXml(l)}</text>`)
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${size * 0.08}" fill="${bg}"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).resize(size, size).webp({ quality: 92 }).toBuffer();
}

/* ── upload ──────────────────────────────────────────────── */
/**
 * Real upload, verified working. tmpfiles.org keeps files 1 hour by default,
 * uguu.se keeps them 3 hours. Both are keyless.
 * Note: tmpfiles' returned /dl/ path is HTML — the /api/v1 upload response is
 * JSON and the share link is the returned url.
 */
async function uploadBuffer(buf, filename = 'zynex.png') {
  // 1) uguu — returns a direct file URL that serves the real content-type
  try {
    const fd = new FormData();
    fd.append('files[]', new Blob([buf]), filename);
    const r = await fetch('https://uguu.se/upload.php', { method: 'POST', body: fd, signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    if (j?.success && j.files?.[0]?.url) return { url: j.files[0].url, host: 'uguu.se', hours: 3 };
  } catch { /* try next */ }

  // 2) tmpfiles — share page
  try {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), filename);
    const r = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd, signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    if (j?.status === 'success' && j.data?.url) return { url: j.data.url, host: 'tmpfiles.org', hours: 1 };
  } catch { /* fall through */ }

  return null;
}

/* ── screenshot ──────────────────────────────────────────── */
async function screenshot(url) {
  const clean = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const r = await fetch(`https://image.thum.io/get/width/1000/crop/1400/${clean}`, {
      signal: AbortSignal.timeout(45000),
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const m = await sharp(buf).metadata().catch(() => null);
      if (m?.width > 50) return { buf, engine: 'thum.io' };
    }
  } catch { /* fall through */ }

  try {
    const r = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(clean)}&screenshot=true&meta=false`, {
      signal: AbortSignal.timeout(45000),
    });
    const j = await r.json();
    const shot = j?.data?.screenshot?.url;
    if (shot) {
      const img = await fetch(shot, { signal: AbortSignal.timeout(45000) });
      if (img.ok) return { buf: Buffer.from(await img.arrayBuffer()), engine: 'microlink.io' };
    }
  } catch { /* fall through */ }

  return null;
}

/* ── pdf ─────────────────────────────────────────────────── */
function imConvert(args) {
  return new Promise((resolve) => {
    execFile('convert', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stderr: stderr || '' });
    });
  });
}

/** image buffer -> PDF via ImageMagick. Resolves { ok, buffer, stderr }. */
async function imageToPdf(buf, ext = '.png') {
  const inFile = path.join(os.tmpdir(), `zx-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  const outFile = inFile.replace(/\.[a-z0-9]+$/i, '.pdf');
  try {
    fs.writeFileSync(inFile, buf);
    const res = await imConvert([inFile, outFile]);
    if (!res.ok || !fs.existsSync(outFile)) return { ok: false, stderr: res.stderr };
    return { ok: true, buffer: fs.readFileSync(outFile) };
  } finally {
    try { fs.unlinkSync(inFile); } catch {}
    try { fs.unlinkSync(outFile); } catch {}
  }
}

/** Plain text -> PDF using ImageMagick's @file input is fragile; render a tall PNG first. */
async function textToPdf(text) {
  const W = 1240;
  const PAD = 80;
  const fontSize = 28;
  const lines = String(text).split('\n').flatMap((l) => wrapText(l || ' ', W - PAD * 2, fontSize));
  const lineH = Math.round(fontSize * 1.5);
  const H = Math.max(400, PAD * 2 + lines.length * lineH);
  const body = lines
    .map((l, i) => `<text x="${PAD}" y="${PAD + i * lineH}" font-size="${fontSize}" font-family="DejaVu Monospace, monospace" fill="#111111">${escapeXml(l)}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return imageToPdf(png, '.png');
}

/* ── fuzzy URL-ish detection ─────────────────────────────── */
function looksLikeUrl(s) {
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(String(s || '').trim());
}

module.exports = {
  id: 'converter',
  name: 'converter-engine',
  match: null,         // set below
  describe: (n) => `converter:${n}`,

  // exported so tests and other engines can reuse them
  _internals: { quoteCard, chatBubble, textToPng, textSticker, uploadBuffer, screenshot, imageToPdf, textToPdf, wrapText, loadImage, meta, sendImage },
};

/* ── command table ───────────────────────────────────────── */
const IMAGE_FILTERS = {
  blur: (p) => p.blur(8),
  sharpen: (p) => p.sharpen({ sigma: 2 }),
  grayscale: (p) => p.grayscale(),
  grey: (p) => p.grayscale(),
  invert: (p) => p.negate(),
  sepia: (p) => p.recomb([[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]),
  enhance: (p) => p.modulate({ brightness: 1.12, saturation: 1.28 }).sharpen(),
  hd: (p) => p.sharpen({ sigma: 1.4 }).modulate({ brightness: 1.05, saturation: 1.15 }),
  upscale: (p) => p.resize({ width: 2000, withoutEnlargement: false, kernel: 'lanczos3' }),
  remini: (p) => p.sharpen({ sigma: 1.8 }).modulate({ brightness: 1.06, saturation: 1.18 }).linear(1.08, -8),
};

/* Sticker-specific commands live in lib/engines/sticker.js. The converter keeps
 * its own media/sticker commands (stiker, ttp, attp, qc) because they share the
 * ffmpeg + upload helpers above; the pure sticker operations delegate. */
let STICKER_ENGINE = null;
function stickerEngine() {
  if (!STICKER_ENGINE) STICKER_ENGINE = require('./sticker');
  return STICKER_ENGINE;
}

const NAMES = new Set([
  'resize', 'crop', 'rotate', 'blur', 'sharpen', 'grayscale', 'grey', 'invert', 'sepia',
  'enhance', 'hd', 'upscale', 'remini', 'compress', 'toimage', 'toimg', 'togif', 'tovideo',
  'tomp4', 'tom3', 'tomp3', 'toaudio', 'toptv', 'tovn', 'tovoice', 'stiker', 'sticker',
  'ttp', 'attp', 'emojimix', 'emoji2png', 'qc', 'quotely', 'swm', 'wm', 'ss', 'ssweb',
  'sspc', 'ssphone', 'sstab', 'screenshot', 'upload', 'uploader', 'imgbb', 'catbox',
  'telegraph', 'txt2pdf', 'img2pdf', 'doc2pdf', 'pdf2img', 'img2img', 'exif', 'metadata',
  'resize2', 'exifstrip', 'toimage', 'mediaconvert', 'convertmedia',
  /* ── sticker family (implemented in lib/engines/sticker.js, claimed here so
        registry loads that engine; see STICKER_ENGINE below) ── */
]);

const ALIASES = {
  sticker: 'stiker',
  toimg: 'toimage',
  tomp4: 'tovideo',
  tomp3: 'toaudio',
  tovoice: 'tovn',
  toptv: 'tovn',
  screenshot: 'ssweb',
  sstab: 'ssweb',
  sspc: 'ssweb',
  ssphone: 'ssweb',
  uploader: 'upload',
  exifstrip: 'exif',
  red: 'resize',
  convertmedia: 'tovideo',
  mediaconvert: 'tovideo',
};

const NOT_AVAILABLE = {
  ocr: {
    why: 'OCR needs a keyed service — every keyless OCR endpoint I tested is rate-limited or dead (ocr.space\'s free demo key returns E581 rate-limit; the old free OCR APIs are gone).',
    instead: 'Ask the sender to type the text, or use *.toimage* to grab it as a picture.',
  },
  readtext: {
    why: 'Reading text out of an image needs OCR, which needs a keyed API.',
    instead: '*.toimage* keeps it as a picture; *.qc* turns your own text into an image.',
  },
  removebg: {
    why: 'Background removal needs a model or a keyed API (remove.bg, Photoroom). There is no free unattended endpoint.',
    instead: '*.blur* the background yourself or crop it out with *.crop*.',
  },
  imgbb: {
    why: 'imgbb requires a personal API key (verified: returns "Invalid API v1 key").',
    instead: '*.upload* works with no key (uguu.se / tmpfiles.org).',
  },
  catbox: {
    why: 'catbox.moe rejects anonymous uploads ("Invalid uploader") and is behind Cloudflare.',
    instead: '*.upload* works with no key.',
  },
  telegraph: {
    why: 'telegra.ph upload returns "Unknown error" for programmatic uploads now.',
    instead: '*.upload* works with no key.',
  },
  quotely: {
    why: 'The quotely service is dead; quote rendering is done locally instead.',
    instead: 'Using the local renderer — *.qc* makes a quote card.',
  },
  'doc2pdf': {
    why: 'Converting .doc/.docx needs LibreOffice, which is not installed on this host and cannot be installed without root.',
    instead: '*.txt2pdf* for text, *.img2pdf* for images.',
  },
};

const engine = {
  id: 'converter',
  name: 'converter-engine',
  extraNames: [...NAMES],

  match(command) {
    return NAMES.has(command);
  },

  describe(name) {
    return `converter:${name}`;
  },

  async execute(ctx) {
    const { command: raw, args, msg, sock, from, reply } = ctx;
    const command = ALIASES[raw] || raw;
    const text = args.join(' ').trim();

    /* ── honest refusals first ── */
    if (NOT_AVAILABLE[raw] || NOT_AVAILABLE[command]) {
      const info = NOT_AVAILABLE[raw] || NOT_AVAILABLE[command];
      return reply(`❌ *${raw}* isn't possible without an API key.\n\n${info.why}\n\n✅ Instead: ${info.instead}`);
    }

    /* ══════════ image transforms (need a replied image) ══════════ */
    if (['resize', 'crop', 'rotate', 'compress', 'toimage', 'exif', 'metadata', ...Object.keys(IMAGE_FILTERS)].includes(command)) {
      const { buf, error } = await loadImage(ctx);
      if (error) return reply(`❌ ${error}`);

      const before = await meta(buf);
      let out;
      let caption;

      try {
        switch (command) {
          case 'resize': {
            const w = parseInt(args[0], 10);
            const h = parseInt(args[1], 10);
            if (!w && !h) return reply('❌ Use *.resize 800* or *.resize 800 600*');
            out = await sharp(buf).resize({ width: w || null, height: h || null, fit: 'inside', withoutEnlargement: false }).png().toBuffer();
            const after = await meta(out);
            caption = `📐 *RESIZED*\n${before.width}×${before.height} → ${after.width}×${after.height}`;
            break;
          }
          case 'crop': {
            const w = parseInt(args[0], 10);
            const h = parseInt(args[1], 10);
            if (!w || !h) return reply('❌ Use *.crop 500 500* (width height)');
            if (!before) return reply('❌ Could not read that image.');
            const left = Math.max(0, Math.round((before.width - w) / 2));
            const top = Math.max(0, Math.round((before.height - h) / 2));
            const cw = Math.min(w, before.width - left);
            const ch = Math.min(h, before.height - top);
            out = await sharp(buf).extract({ left, top, width: cw, height: ch }).png().toBuffer();
            caption = `✂️ *CROPPED*\n${before.width}×${before.height} → ${cw}×${ch}`;
            break;
          }
          case 'rotate': {
            const deg = parseInt(args[0], 10);
            if (![90, 180, 270, -90].includes(deg)) return reply('❌ Use *.rotate 90*, *.rotate 180* or *.rotate 270*');
            out = await sharp(buf).rotate(deg).png().toBuffer();
            caption = `🔄 *ROTATED ${deg}°*`;
            break;
          }
          case 'compress': {
            const before2 = buf.length;
            out = await sharp(buf).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
            const pct = Math.max(1, Math.round((1 - out.length / before2) * 100));
            caption = `🗜️ *COMPRESSED*\n${(before2 / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB (−${pct}%)`;
            break;
          }
          case 'toimage':
          case 'metadata': {
            if (!before) return reply('❌ Could not read that image.');
            caption =
              `🖼️ *IMAGE INFO*\n\n` +
              `Format : *${before.format}*\nSize   : *${before.width}×${before.height}*\n` +
              `Weight : *${(before.size / 1024).toFixed(1)} KB*`;
            out = await sharp(buf).png().toBuffer();
            break;
          }
          case 'exif': {
            const m = await sharp(buf).metadata();
            const ex = m.exif ? `Yes (${m.exif.length} bytes, stripped)` : 'None';
            out = await sharp(buf).rotate().png().toBuffer(); // .rotate() auto-applies EXIF then drops it
            caption = `📋 *EXIF*\n\nCamera data: ${ex}\nOrientation: ${m.orientation || 'none'}\n\n_Stripped in the output._`;
            break;
          }
          default: {
            out = await withFilter(IMAGE_FILTERS[command], buf);
            caption = `✨ *${raw.toUpperCase()}* applied`;
          }
        }
      } catch (e) {
        return reply(`❌ Could not process that image (${e.message}).`);
      }

      if (!out) return reply('❌ Nothing to send.');
      return sendImage(ctx, out, caption);
    }

    /* ══════════ stickers ══════════ */
    if (command === 'stiker') {
      const { buf, error } = await loadImage(ctx);
      if (error) return reply(`❌ ${error}\n\n_Or use *.atTP text* for a text sticker._`.replace('atTP', 'attp'));
      // WhatsApp stickers: 512px max side, webp. Keep transparency.
      const out = await sharp(buf).resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90, alphaQuality: 100 }).toBuffer();
      await sock.sendMessage(from, { sticker: out }, { quoted: msg });
      return;
    }

    if (command === 'ttp' || command === 'attp') {
      if (!text) return reply(`❌ Use *.${raw} your text here*`);
      const sticker = await textSticker(text, {
        bg: command === 'attp' ? `hsl(${Math.floor(Math.random() * 360)}, 65%, 42%)` : '#0f4c81',
      });
      await sock.sendMessage(from, { sticker }, { quoted: msg });
      return;
    }

    if (command === 'emojimix') {
      const a = args[0], b = args[1];
      if (!a || !b) return reply('❌ Use *.emojimix 😂 🔥* — two emoji.');
      const mix = await emojiKitchen(a, b);
      if (!mix) {
        return reply(`❌ No combination exists for *${a} ${b}* in Google Emoji Kitchen.\n\n_Try common pairs like 😂🔥 or 😀😍._`);
      }
      await sock.sendMessage(from, { sticker: mix }, { quoted: msg });
      return;
    }

    if (command === 'emoji2png') {
      const e = args[0] || text;
      if (!e) return reply('❌ Use *.emoji2png 😀*');
      const buf = await textToPng(e, { size: 512 });
      return sock.sendMessage(from, { sticker: buf }, { quoted: msg });
    }

    /* ══════════ quote cards ══════════ */
    if (command === 'qc') {
      if (!text) return reply('❌ Use *.qc your quote* or *.qc your quote | Author*');
      const [body, author] = text.split('|').map((s) => s.trim());
      const png = await quoteCard(body, author || '');
      return sendImage(ctx, png, `💬 *QUOTE CARD*`);
    }

    /* ══════════ audio / video ══════════ */
    if (['toaudio', 'tovn', 'tovideo', 'togif'].includes(command)) {
      const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const hasVideo = Boolean(quoted?.videoMessage || msg?.message?.videoMessage);
      const hasAudio = Boolean(quoted?.audioMessage || msg?.message?.audioMessage);
      const hasSticker = Boolean(quoted?.stickerMessage);

      if (command === 'toaudio' || command === 'tovn') {
        if (!hasVideo && !hasAudio) return reply('❌ Reply to a *video* or *audio* with this command.');
        let buf;
        try { buf = await ctx.download(); } catch (e) { return reply(`❌ Download failed (${e.message}).`); }
        const ext = hasAudio ? '.mp3' : '.mp4';
        const r = await ff.convert(buf, ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k'], { inExt: ext, outExt: '.mp3' });
        if (!r.ok) {
          // A video with no audio track is a normal thing to meet — say so.
          const hasNoAudioStream = /does not contain any stream|Output file .* does not contain/i.test(r.stderr || '');
          return reply(hasNoAudioStream
            ? '❌ That video has *no audio track*, so there is nothing to extract.'
            : '❌ Could not extract the audio from that file.');
        }
        const payload = command === 'tovn'
          ? { audio: r.buffer, mimetype: 'audio/mpeg', ptt: true }
          : { audio: r.buffer, mimetype: 'audio/mpeg' };
        return sock.sendMessage(from, payload, { quoted: msg });
      }

      if (command === 'tovideo') {
        if (!hasAudio) return reply('❌ Reply to an *audio* file with this command.');
        let buf;
        try { buf = await ctx.download(); } catch (e) { return reply(`❌ Download failed (${e.message}).`); }
        const r = await ff.convert(buf,
          ['-f', 'lavfi', '-i', 'color=c=#0b1220:s=640x360:r=1', '-shortest',
            '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'],
          { inExt: '.mp3', outExt: '.mp4' });
        if (!r.ok) return reply('❌ Could not build a video from that audio.');
        return sock.sendMessage(from, { video: r.buffer, mimetype: 'video/mp4', caption: '🎬 *Converted to video*' }, { quoted: msg });
      }

      // togif — video or sticker -> gif
      if (!hasVideo && !hasSticker) return reply('❌ Reply to a *video* or *sticker* with this command.');
      let buf;
      try { buf = await ctx.download(); } catch (e) { return reply(`❌ Download failed (${e.message}).`); }
      const inExt = hasSticker ? '.webp' : '.mp4';
      const r = await ff.convert(buf, ['-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0'], { inExt, outExt: '.gif' });
      if (!r.ok) return reply('❌ Could not convert that to a GIF.');
      return sock.sendMessage(from, { video: r.buffer, mimetype: 'image/gif', gifPlayback: true, caption: '🎞️ *GIF*' }, { quoted: msg });
    }

    /* ══════════ upload ══════════ */
    if (command === 'upload') {
      const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const isMedia = quoted?.imageMessage || quoted?.videoMessage || quoted?.audioMessage || quoted?.documentMessage;
      if (!isMedia) return reply('❌ Reply to a photo, video, audio or document with *.upload*');
      let buf;
      try { buf = await ctx.download(); } catch (e) { return reply(`❌ Download failed (${e.message}).`); }
      if (buf.length > 90 * 1024 * 1024) return reply('❌ Files over 90 MB cannot be uploaded by these hosts.');
      await reply('⏳ Uploading…');
      const res = await uploadBuffer(buf, path.basename(quoted.imageMessage ? 'image.png' : 'file.bin'));
      if (!res) return reply('❌ Both upload hosts refused the file. Try again in a moment.');
      return reply(
        `☁️ *UPLOADED*\n\n🔗 ${res.url}\n\n` +
          `Host: ${res.host}\nKept for: ~${res.hours} hour${res.hours > 1 ? 's' : ''}\n` +
          `_These hosts are free and temporary — link expires._`,
      );
    }

    /* ══════════ screenshot ══════════ */
    if (command === 'ssweb') {
      if (!text || !looksLikeUrl(text)) return reply('❌ Use *.ssweb example.com*');
      await reply('⏳ Capturing…');
      const shot = await screenshot(text);
      if (!shot) return reply('❌ Both screenshot services are unavailable right now. Try again shortly.');
      return sendImage(ctx, shot.buf, `📸 *${text}*\n_via ${shot.engine}_`);
    }

    /* ══════════ PDF ══════════ */
    if (command === 'txt2pdf') {
      if (!text) return reply('❌ Use *.txt2pdf your text here*');
      const r = await textToPdf(text);
      if (!r.ok) return reply('❌ PDF writer is unavailable on this host.');
      return sock.sendMessage(from, {
        document: r.buffer, mimetype: 'application/pdf', fileName: 'zynex.pdf',
        caption: '📄 *PDF created*',
      }, { quoted: msg });
    }

    if (command === 'img2pdf') {
      const { buf, error } = await loadImage(ctx);
      if (error) return reply(`❌ ${error}`);
      const r = await imageToPdf(buf, '.png');
      if (!r.ok) return reply('❌ PDF writer is unavailable on this host.');
      return sock.sendMessage(from, {
        document: r.buffer, mimetype: 'application/pdf', fileName: 'zynex.pdf',
        caption: '📄 *Image converted to PDF*',
      }, { quoted: msg });
    }

    if (command === 'pdf2img') {
      const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quoted?.documentMessage) return reply('❌ Reply to a *PDF document* with *.pdf2img*');
      return reply(
        `❌ Rendering PDFs to images needs *poppler* (pdftoppm), which is not installed on this host and cannot be installed without root.\n\n` +
          `✅ Instead: forward the PDF and open it, or use *.ssweb* if it has a public link.`,
      );
    }

    /* ══════════ watermark ══════════ */
    if (command === 'swm' || command === 'wm') {
      const { buf, error } = await loadImage(ctx);
      if (error) return reply(`❌ ${error}`);
      const mark = text || 'ZYNEX-MD';
      const m = await meta(buf);
      if (!m) return reply('❌ Could not read that image.');
      const fs2 = Math.max(18, Math.round(m.width * 0.045));
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">
          <text x="${m.width - 24}" y="${m.height - 28}" font-size="${fs2}" text-anchor="end"
            font-family="DejaVu Sans" fill="#ffffff" opacity="0.8"
            stroke="#000000" stroke-width="1.5" paint-order="stroke">${escapeXml(mark)}</text>
        </svg>`,
      );
      const out = await sharp(buf).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
      return sendImage(ctx, out, `💧 *WATERMARKED* — "${mark}"`);
    }

    return reply(
      `❌ *${raw}* isn't available yet.\n\n` +
        `Working converters: *.resize* *.crop* *.rotate* *.blur* *.sharpen* *.grayscale* *.invert* *.sepia* ` +
        `*.enhance* *.hd* *.upscale* *.compress* *.stiker* *.ttp* *.attp* *.emojimix* *.qc* *.toaudio* ` +
        `*.tovn* *.tovideo* *.togif* *.upload* *.ssweb* *.txt2pdf* *.img2pdf* *.swm*`,
    );
  },
};

async function withFilter(fn, buf) {
  const pipeline = fn(sharp(buf));
  return pipeline.png().toBuffer();
}

/* ── Google Emoji Kitchen (keyless, verified) ────────────── */
function emojiToCodepoint(emoji) {
  const cps = [...emoji].map((c) => c.codePointAt(0).toString(16));
  return cps.map((c) => `u${c}`).join('-');
}

const KITCHEN_DATES = ['20201001', '20240113', '20230803', '20220406'];

async function emojiKitchen(a, b) {
  const ca = emojiToCodepoint(a);
  const cb = emojiToCodepoint(b);
  // Emoji Kitchen stores both orders; try left-right and right-left
  const combos = [`${ca}_${cb}`, `${cb}_${ca}`];
  for (const date of KITCHEN_DATES) {
    for (const combo of combos) {
      for (const left of [ca, cb]) {
        const url = `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${left}/${combo}.png`;
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
          if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          const m = await sharp(buf).metadata().catch(() => null);
          if (!m?.width) continue;
          return sharp(buf).resize(512, 512, { fit: 'inside' }).webp({ quality: 92 }).toBuffer();
        } catch { /* next */ }
      }
    }
  }
  return null;
}

notavailable: {
  /* keep the table referenced so linters don't drop it */
}

module.exports = engine;
module.exports._test = { emojiKitchen, quoteCard, chatBubble, textSticker, textToPng, uploadBuffer, screenshot, imageToPdf, textToPdf, wrapText, NAMES };
