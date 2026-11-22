/**
 * lib/logo.js — text-logo renderer, 100% local.
 *
 * Why not flamingtext/textpro? They are the classic choice for these commands,
 * but as of Nov 2026 `api.flamingtext.com` answers **429 to this host** and the
 * URL the old code used returned an HTML page with HTTP 200 — so `.neon hello`
 * was quietly sending a web page as an "image". ephoto360 likewise needs a
 * scraping session. None of that is acceptable: a broken logo must never look
 * like a working one.
 *
 * So every logo here is drawn locally with SVG → sharp. No network, no key, no
 * rate limit, and a render either produces a real PNG or throws.
 *
 * Architecture:
 *   1. `textInk()` renders the word alone at full size and trims to its exact
 *      ink box, so we know precisely how wide the word is before laying it out.
 *   2. `compose()` scales that ink to the canvas and stacks the style's
 *      decorations behind and on top of it.
 *   3. Each style is a small recipe, so 67 command names share ~15 effect
 *      primitives instead of 67 bespoke code paths.
 */
'use strict';

const sharp = require('sharp');

const FONT = 'DejaVu Sans';
const MONO = 'DejaVu Sans Mono';

/* ── primitives ─────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Render the word on its own, trim to the ink, and report its box.
 * `fill` may be a colour or `url(#id)` — pass `defs` for gradients.
 */
async function textInk({
  text,
  size = 160,
  weight = 'bold',
  font = FONT,
  fill = '#ffffff',
  stroke = null,
  strokeWidth = 0,
  defs = '',
  letterSpacing = 0,
  filters = '',
}) {
  const pad = Math.ceil(size * 0.6) + strokeWidth;
  const probeW = Math.max(2000, Math.ceil(size * 1.05 * String(text).length) + pad * 2);
  const probeH = Math.ceil(size * 2.2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${probeW}" height="${probeH}">
    <defs>${defs}</defs>
    <text x="${pad}" y="${Math.ceil(size * 1.4)}" font-family="${font}" font-weight="${weight}"
      font-size="${size}" fill="${fill}"
      ${stroke ? `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke"` : ''}
      ${letterSpacing ? `letter-spacing="${letterSpacing}"` : ''}
      ${filters ? `filter="${filters}"` : ''}>${esc(text)}</text>
  </svg>`;
  const raw = await sharp(Buffer.from(svg)).png().toBuffer();
  const { data, info } = await sharp(raw)
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

/** Scale the ink to `targetW` and return both the buffer and its final box. */
async function scaleInk(ink, targetW, maxH) {
  let w = Math.round(targetW);
  let h = Math.round((ink.height / ink.width) * w);
  if (maxH && h > maxH) {
    h = Math.round(maxH);
    w = Math.round((ink.width / ink.height) * h);
  }
  const png = await sharp(ink.png).resize({ width: w, height: h, fit: 'fill' }).png().toBuffer();
  return { png, width: w, height: h };
}

/** A solid colour / gradient rectangle, optionally transparent. */
async function backdrop(w, h, fill, defs = '', extra = '') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>${defs}</defs>
    ${fill ? `<rect width="${w}" height="${h}" fill="${fill}"/>` : ''}
    ${extra}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * The generic layout: word centred on a canvas, with `behind` and `front`
 * SVG layers supplied by the style recipe.
 */
async function compose({
  text,
  W = 1000,
  H = 420,
  inkOpts = {},
  behind = '',
  front = '',
  defs = '',
  bg = '#0b0d12',
  scale = 0.82,
  offsetX = 0,
  offsetY = 0,
}) {
  // `defs` must reach the text probe too — a `fill="url(#g)"` resolves to
  // nothing if the gradient is only defined on the background layer, and the
  // word then renders invisible after the trim.
  const ink = await textInk({ text, defs, ...inkOpts });
  const targetW = Math.round(W * scale);
  const maxH = Math.round(H * 0.62);
  const sized = await scaleInk(ink, targetW, maxH);

  const x = Math.round((W - sized.width) / 2 + offsetX);
  const y = Math.round((H - sized.height) / 2 + offsetY);

  // front layer is authored in canvas coordinates, so the word can be given
  // per-style treatment (gloss, highlight, outline) around its exact box.
  const layers = [{ input: await backdrop(W, H, bg, defs, behind), left: 0, top: 0 }];
  return {
    W, H, box: { x, y, width: sized.width, height: sized.height },
    word: sized.png,
    base: layers[0].input,
    frontSvg: front ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs>${front}</svg>`) : null,
  };
}

/**
 * Flatten a composition: `behind` layers (extrusion, ghost copies) sit under the
 * word, `front` layers (sparkle, scan lines, brackets) sit over it. The word
 * itself is always placed — forgetting it was the bug that made half the styles
 * render as an empty background.
 */
async function finish(layout, behind = [], front = []) {
  const b = layout.box;
  const composites = [
    ...behind,
    { input: layout.word, left: Math.round(b.x), top: Math.round(b.y) },
    ...front,
  ];
  return sharp(layout.base).composite(composites).png().toBuffer();
}

/* ── effect helpers ─────────────────────────────────────────────────── */

/** Draw the word repeatedly along an offset — gives 3D extrusion / long shadow. */
async function extrude(layout, { dx = 2, dy = 2, steps = 14, fill = '#1b2a4a', start = 1 } = {}) {
  const out = [];
  const b = layout.box;
  for (let i = steps; i >= start; i--) {
    const tint = await sharp(layout.word)
      .tint(fill)
      .png()
      .toBuffer();
    out.push({ input: tint, left: Math.round(b.x + i * dx), top: Math.round(b.y + i * dy) });
  }
  return out;
}

/** Coloured ghost copies behind the word (glitch / chromatic aberration). */
async function ghosts(layout, colours = ['#ff0044', '#00e5ff'], dist = 5) {
  const out = [];
  const b = layout.box;
  const offsets = [
    [-dist, 0],
    [dist, 0],
  ];
  for (let i = 0; i < colours.length; i++) {
    const tint = await sharp(layout.word).tint(colours[i]).png().toBuffer();
    const [ox, oy] = offsets[i % offsets.length];
    out.push({ input: tint, left: Math.round(b.x + ox), top: Math.round(b.y + oy) });
  }
  return out;
}

/* ── palette ────────────────────────────────────────────────────────── */

const GRAD = (id, stops, x1, y1, x2, y2) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

const glowFilter = (id, blur, extra = 2) => `
  <filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="${blur}" result="b"/>
    <feMerge>${Array.from({ length: extra }, () => `<feMergeNode in="b"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

const shadowFilter = (id, dist, blur, colour) => `
  <filter id="${id}" x="-40%" y="-40%" width="190%" height="190%">
    <feDropShadow dx="${dist}" dy="${dist}" stdDeviation="${blur}" flood-color="${colour}" flood-opacity="0.85"/>
  </filter>`;

module.exports = {
  FONT,
  MONO,
  esc,
  textInk,
  scaleInk,
  backdrop,
  compose,
  finish,
  extrude,
  ghosts,
  GRAD,
  glowFilter,
  shadowFilter,
};
