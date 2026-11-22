/**
 * lib/logostyles.js — the 67 textmaker command names, as local render recipes.
 *
 * Every style draws with SVG + sharp only. Nothing here touches the network, so
 * a logo either renders or throws — it can never silently send an error page.
 *
 * The names come from the vendored catalogue (`textmaker` category). Several
 * names are the same effect spelled twice (`.neon`/`.neonlight`,
 * `.graffiti`/`.grafitti`, `.glitch`/`.glitchtext`, `.id_card`/`.idcard`,
 * `.bizcard`/`.namecard`), so they share one recipe rather than duplicating code.
 */
'use strict';

const sharp = require('sharp');
const L = require('./logo');

const W = 1000;
const H = 420;

const T = (s) => L.esc(s);

/* ══════════════════ effect recipes ══════════════════ */

/** glowing word on black — .neon .neonlight .light */
async function neon(text, { c1 = '#39ff88', c2 = '#00d4ff', bg = '#04060a', label } = {}) {
  const defs = L.GRAD('g', [[0, c1], [1, c2]], 0, 0, 1, 1) + L.glowFilter('f', 9, 3);
  const lay = await L.compose({
    text, W, H, bg, scale: 0.66, defs,
    inkOpts: { size: 170, fill: 'url(#g)', filters: 'url(#f)' },
  });
  const labelY = Math.min(H - 34, lay.box.y + lay.box.height + 74);
  const front = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs>
     <text x="${W / 2}" y="${labelY}" text-anchor="middle" font-family="${L.FONT}"
       font-size="26" fill="${c1}" opacity="0.75" letter-spacing="10">${T(label || 'NEON')}</text></svg>`,
  );
  return L.finish(lay, [], [{ input: front, left: 0, top: 0 }]);
}

/** fire — .fire .flame */
async function fire(text) {
  const defs =
    L.GRAD('g', [[0, '#fff3a0'], [0.35, '#ffb703'], [0.7, '#f9410a'], [1, '#8a1300']], 0, 0, 0, 1) +
    L.GRAD('glow', [[0, '#ff9d00'], [1, '#ff2d00']], 0, 0, 1, 1) +
    L.glowFilter('f', 7, 2);
  const lay = await L.compose({
    text, W, H, bg: '#120402', scale: 0.66,
    defs,
    inkOpts: { size: 170, fill: 'url(#g)', stroke: 'url(#glow)', strokeWidth: 6, filters: 'url(#f)' },
  });
  // embers behind
  let embers = '';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = H * 0.45 + Math.random() * H * 0.55;
    const r = Math.random() * 2.6 + 0.6;
    const o = (0.15 + Math.random() * 0.6).toFixed(2);
    embers += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="${Math.random() > 0.5 ? '#ffb703' : '#ff5a00'}" opacity="${o}"/>`;
  }
  const behind = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${embers}</svg>`,
  );
  return L.finish(lay, [], [{ input: behind, left: 0, top: 0 }]);
}

/** chrome / metal — .chrome .metal .silver .steel */
async function chrome(text) {
  const defs =
    L.GRAD('g', [
      [0, '#f7f9fc'], [0.18, '#c9d3e0'], [0.34, '#ffffff'], [0.5, '#8a97a8'],
      [0.62, '#e6ecf5'], [0.8, '#6c7789'], [1, '#dfe6ef'],
    ], 0, 0, 0, 1) +
    L.shadowFilter('s', 3, 4, '#000000');
  const lay = await L.compose({
    text, W, H, bg: '#10131a', scale: 0.7, defs,
    inkOpts: { size: 175, fill: 'url(#g)', stroke: '#2b3444', strokeWidth: 3, filters: 'url(#s)' },
  });
  return L.finish(lay, []);
}

/** 3D extrusion — .3dtext .light3d */
async function threeD(text) {
  const defs = L.GRAD('g', [[0, '#8ef6ff'], [1, '#4f8cff']], 0, 0, 0, 1);
  const lay = await L.compose({
    text, W, H, bg: '#0a0f1c', scale: 0.62, defs,
    inkOpts: { size: 170, fill: 'url(#g)', stroke: '#0b2a4a', strokeWidth: 4 },
    offsetY: -18,
  });
  const ext = await L.extrude(lay, { dx: 3, dy: 3, steps: 16, fill: '#123a63' });
  return L.finish(lay, ext);
}

/** gold — .goldtext .luxury */
async function gold(text) {
  const defs =
    L.GRAD('g', [
      [0, '#fff6c2'], [0.22, '#f7d774'], [0.44, '#c9962b'], [0.56, '#ffe9a3'],
      [0.74, '#b8821f'], [1, '#f2cf6a'],
    ], 0, 0, 0, 1) +
    L.shadowFilter('s', 4, 5, '#000000');
  const lay = await L.compose({
    text, W, H, bg: '#0d0a03', scale: 0.66, defs,
    inkOpts: { size: 170, fill: 'url(#g)', stroke: '#5c3d05', strokeWidth: 3, filters: 'url(#s)' },
  });
  const ext = await L.extrude(lay, { dx: 2, dy: 2, steps: 8, fill: '#3a2600' });
  return L.finish(lay, ext);
}

/** graffiti — .graffiti .grafitti .sandwriting */
async function graffiti(text) {
  const defs =
    L.GRAD('g', [[0, '#ff2e63'], [0.5, '#ffd166'], [1, '#08d9d6']], 0, 0, 1, 1) +
    `<filter id="r"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n"/>
     <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  const lay = await L.compose({
    text, W, H, bg: '#0c0c10', scale: 0.64, defs,
    inkOpts: { size: 165, fill: 'url(#g)', stroke: '#111', strokeWidth: 5, filters: 'url(#r)' },
    offsetY: -22,
  });
  // drips are generated after layout so they hang off the actual word bottom
  let drips = '';
  const dripY = lay.box.y + lay.box.height - 12;
  for (let i = 0; i < 24; i++) {
    const x = lay.box.x + Math.random() * lay.box.width;
    const h = 18 + Math.random() * 70;
    const w = 4 + Math.random() * 8;
    drips += `<rect x="${x.toFixed(0)}" y="${dripY.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="${(w / 2).toFixed(1)}" fill="${Math.random() > 0.35 ? '#ff2e63' : '#08d9d6'}" opacity="0.55"/>`;
  }
  return L.finish(lay, [], [
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${drips}</svg>`), left: 0, top: 0 },
  ]);
}

/**
 * glitch — .glitch .glitchtext .hacker
 * Real VHS tear: horizontal bands of the word are sliced out and shoved
 * sideways, then chromatic ghosts are laid over the top in screen blend. Tinting
 * whole copies of the word (the first attempt) only produced a 6px fringe on the
 * final scaled image — invisible on a phone screen.
 */
async function glitch(text) {
  const lay = await L.compose({
    text, W, H, bg: '#050508', scale: 0.66,
    inkOpts: { size: 170, fill: '#f2f6ff' },
  });
  const b = lay.box;

  // flattened word-on-background, ready to be sliced
  const flat = await sharp(lay.base)
    .composite([{ input: lay.word, left: Math.round(b.x), top: Math.round(b.y) }])
    .png()
    .toBuffer();

  // Thin tears only. Wide slices tore the word apart and the ghost copies
  // showed through the gaps, which read as corruption rather than aberration.
  const bands = [];
  const sliceH = 10;
  for (let i = 0; i < 2; i++) {
    const top = Math.round(b.y + b.height * (0.34 + i * 0.32));
    const height = Math.min(sliceH, H - top);
    if (height <= 2 || top < 0) continue;
    const shift = (i % 2 ? 1 : -1) * (12 + Math.round(Math.random() * 6));
    const region = await sharp(flat)
      .extract({ left: 0, top, width: W, height })
      .png()
      .toBuffer();
    bands.push({ input: region, left: shift, top });
  }

  // chromatic ghosts, tight enough to read as a coloured edge
  const ghosts = [];
  for (const [colour, dx] of [['#ff0044', -8], ['#00e5ff', 8]]) {
    const tint = await sharp(lay.word).tint(colour).png().toBuffer();
    ghosts.push({ input: tint, left: Math.round(b.x) + dx, top: Math.round(b.y) });
  }

  // scan lines
  let lines = '';
  for (let y = 0; y < H; y += 4) lines += `<rect x="0" y="${y}" width="${W}" height="2" fill="#000" opacity="0.16"/>`;
  const scan = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines}</svg>`);

  return sharp(lay.base)
    .composite([...ghosts, ...bands, { input: scan, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

/** ice / snow / cloud / water — cold palette */
async function ice(text, { c1 = '#dff6ff', c2 = '#5bc8ff', bg = '#04121c', label = 'ICE' } = {}) {
  const defs = L.GRAD('g', [[0, c1], [1, c2]], 0, 0, 1, 1) + L.glowFilter('f', 6, 2);
  const lay = await L.compose({
    text, W, H, bg, scale: 0.66, defs,
    inkOpts: { size: 170, fill: 'url(#g)', stroke: '#ffffff', strokeWidth: 2, filters: 'url(#f)' },
  });
  let flakes = '';
  for (let i = 0; i < 70; i++) {
    flakes += `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="${(Math.random() * 2 + 0.5).toFixed(1)}" fill="#ffffff" opacity="${(Math.random() * 0.5 + 0.1).toFixed(2)}"/>`;
  }
  const l = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${flakes}</svg>`);
  return L.finish(lay, [], [{ input: l, left: 0, top: 0 }]);
}

/** lightning — .thunder .thunderlogo */
async function thunder(text) {
  const defs = L.GRAD('g', [[0, '#fffde7'], [1, '#ffd60a']], 0, 0, 0, 1) + L.glowFilter('f', 8, 3);
  const lay = await L.compose({
    text, W, H, bg: '#080a14', scale: 0.64, defs,
    inkOpts: { size: 168, fill: 'url(#g)', stroke: '#7a6400', strokeWidth: 3, filters: 'url(#f)' },
  });
  const bolt = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <polyline points="120,40 210,40 175,150 245,150 150,390 190,200 120,200 175,90"
      fill="#ffe066" opacity="0.55"/>
    <polyline points="880,40 790,40 828,150 758,150 852,390 812,200 880,200 826,90"
      fill="#ffe066" opacity="0.55"/></svg>`;
  return L.finish(lay, [], [{ input: Buffer.from(bolt), left: 0, top: 0 }]);
}

/** galaxy / space — .galaxy .space */
async function galaxy(text) {
  const defs =
    L.GRAD('g', [[0, '#ffd9f7'], [0.4, '#b388ff'], [0.72, '#5c6bff'], [1, '#00e5ff']], 0, 0, 1, 1) +
    L.glowFilter('f', 7, 2);
  const lay = await L.compose({
    text, W, H, bg: '#03030c', scale: 0.66, defs,
    inkOpts: { size: 168, fill: 'url(#g)', filters: 'url(#f)' },
  });
  let stars = '';
  for (let i = 0; i < 220; i++) {
    const r = Math.random() * 1.7 + 0.3;
    stars += `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(Math.random() * 0.85 + 0.1).toFixed(2)}"/>`;
  }
  const neb = `<ellipse cx="${W * 0.32}" cy="${H * 0.7}" rx="320" ry="120" fill="#7b2cff" opacity="0.16"/>
               <ellipse cx="${W * 0.72}" cy="${H * 0.3}" rx="280" ry="110" fill="#00b3ff" opacity="0.14"/>${stars}`;
  return L.finish(lay, [], [
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${neb}</svg>`), left: 0, top: 0 },
  ]);
}

/** rainbow — .rainbow .candy */
async function rainbow(text, { bg = '#0a0a12' } = {}) {
  const defs = [
    L.GRAD('g', [
      [0, '#ff004d'], [0.2, '#ff8a00'], [0.4, '#ffe600'],
      [0.6, '#2bff88'], [0.8, '#00c2ff'], [1, '#b14bff'],
    ], 0, 0, 1, 0),
    L.shadowFilter('s', 3, 4, '#000'),
  ].join('');
  const lay = await L.compose({
    text, W, H, bg, scale: 0.68, defs,
    inkOpts: { size: 172, fill: 'url(#g)', stroke: '#0a0a12', strokeWidth: 4, filters: 'url(#s)' },
  });
  return L.finish(lay, []);
}

/** sand — .sand .sandwriting */
async function sand(text) {
  const defs =
    L.GRAD('g', [[0, '#ffe0a3'], [0.5, '#e0a75e'], [1, '#a9713a']], 0, 0, 0, 1) +
    L.shadowFilter('s', 3, 5, '#3b2410');
  const lay = await L.compose({
    text, W, H, bg: '#c9a06a', scale: 0.64, defs,
    inkOpts: { size: 168, fill: 'url(#g)', stroke: '#6d451f', strokeWidth: 2, filters: 'url(#s)' },
  });
  let grain = '';
  for (let i = 0; i < 900; i++) {
    grain += `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="${(Math.random() * 1.6 + 0.3).toFixed(1)}" fill="${Math.random() > 0.5 ? '#fff3d6' : '#8a6134'}" opacity="${(Math.random() * 0.35).toFixed(2)}"/>`;
  }
  return L.finish(lay, [], [
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${grain}</svg>`), left: 0, top: 0 },
  ]);
}

/** shadow / paper-cut — .shadow .papercut */
async function shadow(text) {
  const lay = await L.compose({
    text, W, H, bg: '#12161f', scale: 0.66,
    inkOpts: { size: 170, fill: '#e9eef7' },
    offsetY: -14,
  });
  const ext = await L.extrude(lay, { dx: 1.6, dy: 2.2, steps: 22, fill: '#2b3548' });
  return L.finish(lay, ext);
}

/** outline / sketch / emboss — .light .sketch .comic .cartoon .pencil */
async function outline(text, { fill = 'none', stroke = '#f2f6ff', bg = '#0a0d14', dash = false } = {}) {
  const lay = await L.compose({
    text, W, H, bg, scale: 0.68,
    inkOpts: {
      size: 172, fill, stroke, strokeWidth: 4,
      defs: dash ? '<g id="d"/>' : '',
    },
  });
  return L.finish(lay, []);
}

/* ══════════════════ fandom + brand cards ══════════════════
 * These command names imply a specific franchise or platform logo. We cannot
 * reproduce a trademarked wordmark — and a bot that did would be selling you
 * someone else's trademark. So each renders a themed nameplate in that
 * franchise's *palette* and typography mood, and says so on the card.
 */

const MOTIF = {
  // low-opacity background geometry — this is what makes two nameplates in
  // similar colours read as different designs
  hexes: (W, H, c) => {
    let o = '';
    for (let r = 0; r < 5; r++) for (let q = 0; q < 7; q++) {
      const cx = 70 + q * 150, cy = 50 + r * 90;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${(cx + 46 * Math.cos(a)).toFixed(0)},${(cy + 46 * Math.sin(a)).toFixed(0)}`;
      }).join(' ');
      o += `<polygon points="${pts}" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.16"/>`;
    }
    return o;
  },
  grid: (W, H, c) => {
    let o = '';
    for (let x = 0; x < W; x += 44) o += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${c}" stroke-width="1" opacity="0.12"/>`;
    for (let y = 0; y < H; y += 44) o += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c}" stroke-width="1" opacity="0.12"/>`;
    return o;
  },
  rays: (W, H, c) => {
    let o = '';
    for (let i = 0; i < 26; i++) {
      const a = (Math.PI * 2 * i) / 26;
      o += `<line x1="${W / 2}" y1="${H / 2}" x2="${(W / 2 + 900 * Math.cos(a)).toFixed(0)}" y2="${(H / 2 + 900 * Math.sin(a)).toFixed(0)}" stroke="${c}" stroke-width="2" opacity="0.10"/>`;
    }
    return o;
  },
  diamonds: (W, H, c) => {
    let o = '';
    for (let r = 0; r < 4; r++) for (let q = 0; q < 6; q++) {
      const cx = 90 + q * 160 + (r % 2 ? 80 : 0), cy = 60 + r * 110;
      o += `<polygon points="${cx},${cy - 34} ${cx + 34},${cy} ${cx},${cy + 34} ${cx - 34},${cy}" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.15"/>`;
    }
    return o;
  },
  chevrons: (W, H, c) => {
    let o = '';
    for (let i = 0; i < 9; i++) {
      const x = -100 + i * 150;
      o += `<polyline points="${x},${H} ${x + 110},${H / 2} ${x},0" fill="none" stroke="${c}" stroke-width="3" opacity="0.10"/>`;
    }
    return o;
  },
  bars: (W, H, c) => {
    let o = '';
    for (let i = 0; i < 14; i++) {
      const h = 40 + Math.random() * 200;
      o += `<rect x="${i * 76}" y="${H - h}" width="34" height="${h.toFixed(0)}" fill="${c}" opacity="0.08"/>`;
    }
    return o;
  },
};

const THEMES = {
  apex: { bg: '#12060a', c1: '#ff2d55', c2: '#ff8a00', tag: 'APEX STYLE', motif: 'chevrons' },
  avengers: { bg: '#0a0d1a', c1: '#e01b24', c2: '#f5c518', tag: 'ASSEMBLE', motif: 'rays' },
  batman: { bg: '#050507', c1: '#f5c518', c2: '#8a6d00', tag: 'GOTHAM', motif: 'diamonds' },
  cod: { bg: '#0b0d0a', c1: '#c8ff4d', c2: '#4d7c00', tag: 'CALL OF DUTY STYLE', motif: 'grid' },
  dragonball: { bg: '#0a0c14', c1: '#ff9d00', c2: '#2f6fff', tag: 'DRAGON BALL STYLE', motif: 'rays' },
  fortnite: { bg: '#0a0a2a', c1: '#00d4ff', c2: '#b14bff', tag: 'FORTNITE STYLE', motif: 'hexes' },
  freefire: { bg: '#1a0a00', c1: '#ff6a00', c2: '#ffcf00', tag: 'FREE FIRE STYLE', motif: 'bars' },
  joker: { bg: '#06120a', c1: '#4dff88', c2: '#a020f0', tag: 'WHY SO SERIOUS', motif: 'hexes' },
  marvel: { bg: '#12060a', c1: '#e01b24', c2: '#ffffff', tag: 'MARVEL STYLE', motif: 'rays' },
  minecraft: { bg: '#0d1408', c1: '#7cbd4a', c2: '#3c6d24', tag: 'MINECRAFT STYLE', motif: 'grid' },
  ml: { bg: '#0a0614', c1: '#ffb300', c2: '#7b2cff', tag: 'MOBILE LEGENDS STYLE', motif: 'diamonds' },
  mobilelegends: { bg: '#0a0614', c1: '#ffb300', c2: '#7b2cff', tag: 'MOBILE LEGENDS STYLE', motif: 'diamonds' },
  naruto: { bg: '#140a04', c1: '#ff8a00', c2: '#2f6fff', tag: 'SHINOBI', motif: 'chevrons' },
  onepiece: { bg: '#04101a', c1: '#ffd23f', c2: '#e01b24', tag: 'GRAND LINE', motif: 'hexes' },
  pubg: { bg: '#0a0d0a', c1: '#f5c518', c2: '#8a6d00', tag: 'BATTLE ROYALE', motif: 'bars' },
  roblox: { bg: '#14141a', c1: '#e01b24', c2: '#ffffff', tag: 'ROBLOX STYLE', motif: 'grid' },
  superman: { bg: '#0a0d1a', c1: '#2f6fff', c2: '#e01b24', tag: 'MAN OF STEEL', motif: 'diamonds' },
  valorant: { bg: '#14060b', c1: '#ff4655', c2: '#ffb3ba', tag: 'VALORANT STYLE', motif: 'chevrons' },
  gaming: { bg: '#08020f', c1: '#00e5ff', c2: '#ff00d4', tag: 'GAMER', motif: 'grid' },
  esports: { bg: '#050510', c1: '#ffd60a', c2: '#00e5ff', tag: 'ESPORTS', motif: 'rays' },
  squad: { bg: '#0a0f1c', c1: '#00e5ff', c2: '#4f8cff', tag: 'SQUAD', motif: 'diamonds' },
  team: { bg: '#0a0f1c', c1: '#8ef6ff', c2: '#4f8cff', tag: 'TEAM', motif: 'diamonds' },
  clan: { bg: '#12060a', c1: '#ff2d55', c2: '#ffb300', tag: 'CLAN', motif: 'chevrons' },
  blackpink: { bg: '#0b0710', c1: '#ff2d95', c2: '#111111', tag: 'IN YOUR AREA', motif: 'rays' },
};

async function themed(text, key) {
  const t = THEMES[key] || THEMES.gaming;
  const defs =
    L.GRAD('g', [[0, t.c1], [1, t.c2]], 0, 0, 1, 1) +
    L.glowFilter('f', 6, 2);
  const motifSvg = MOTIF[t.motif || 'grid'](W, H, t.c1);
  const lay = await L.compose({
    text, W, H, bg: t.bg, scale: 0.66, defs,
    inkOpts: { size: 166, fill: 'url(#g)', stroke: t.c2, strokeWidth: 3, filters: 'url(#f)' },
    offsetY: -10,
    behind: motifSvg,
  });
  // angular brackets around the word — the shape reads as "game logo"
  const b = lay.box;
  const cap = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <polygon points="${b.x - 44},${b.y - 26} ${b.x - 18},${b.y + b.height + 30} ${b.x - 34},${b.y + b.height + 30} ${b.x - 60},${b.y - 26}" fill="${t.c1}" opacity="0.9"/>
    <polygon points="${b.x + b.width + 44},${b.y - 26} ${b.x + b.width + 60},${b.y + b.height + 30} ${b.x + b.width + 34},${b.y + b.height + 30} ${b.x + b.width + 18},${b.y - 26}" fill="${t.c1}" opacity="0.9"/>
    <line x1="${b.x - 80}" y1="${b.y + b.height + 44}" x2="${b.x + b.width + 80}" y2="${b.y + b.height + 44}" stroke="${t.c2}" stroke-width="2" opacity="0.5"/>
    <text x="${W / 2}" y="${b.y + b.height + 82}" text-anchor="middle" font-family="${L.FONT}" font-size="24"
      letter-spacing="9" fill="${t.c1}" opacity="0.8">${T(t.tag)}</text></svg>`;
  return L.finish(lay, [], [{ input: Buffer.from(cap), left: 0, top: 0 }]);
}

/* ── platform wordmarks: drawn as our own neutral glyph + nameplate ── */
const PLATFORM = {
  youtube: { bg: '#0a0a0a', c1: '#ff0033', label: 'YOUTUBE', shape: 'play' },
  yt: { bg: '#0a0a0a', c1: '#ff0033', label: 'YOUTUBE', shape: 'play' },
  tiktoklogo: { bg: '#050508', c1: '#25f4ee', c2: '#fe2c55', label: 'TIKTOK', shape: 'note' },
  iglogo: { bg: '#12060e', c1: '#e1306c', c2: '#f77737', label: 'INSTAGRAM', shape: 'cam' },
  fblogo: { bg: '#05070f', c1: '#1877f2', label: 'FACEBOOK', shape: 'f' },
  twitterlogo: { bg: '#04070d', c1: '#1d9bf0', label: 'TWITTER', shape: 'bird' },
  discordlogo: { bg: '#0a0a14', c1: '#5865f2', label: 'DISCORD', shape: 'chat' },
  pornhub: { bg: '#0a0a0a', c1: '#ff9900', label: '18+', shape: 'block' },
};

async function platform(text, key) {
  const p = PLATFORM[key];
  const defs = L.GRAD('g', [[0, p.c1], [1, p.c2 || p.c1]], 0, 0, 1, 1) + L.glowFilter('f', 5, 2);
  // badge glyph on the left, word on the right
  const glyph = {
    play: `<rect x="60" y="${H / 2 - 70}" width="150" height="106" rx="26" fill="${p.c1}"/><polygon points="120,${H / 2 - 44} 120,${H / 2 + 22} 170,${H / 2 - 11}" fill="#fff"/>`,
    note: `<circle cx="105" cy="${H / 2 + 40}" r="34" fill="${p.c1}"/><rect x="132" y="${H / 2 - 90}" width="16" height="130" fill="${p.c1}"/><path d="M148 ${H / 2 - 96} q46 14 46 52" stroke="${p.c2}" stroke-width="16" fill="none"/>`,
    cam: `<rect x="62" y="${H / 2 - 62}" width="146" height="124" rx="34" fill="none" stroke="${p.c1}" stroke-width="12"/><circle cx="135" cy="${H / 2}" r="34" fill="none" stroke="${p.c2}" stroke-width="12"/><circle cx="188" cy="${H / 2 - 44}" r="9" fill="${p.c1}"/>`,
    f: `<text x="70" y="${H / 2 + 55}" font-family="${L.FONT}" font-size="150" font-weight="bold" fill="${p.c1}">f</text>`,
    bird: `<path d="M60 ${H / 2 + 40} q70 20 130 -30 q-30 6 -40 -20 q30 8 48 -14 q-40 0 -52 -30 q20 -6 40 -26 q-60 10 -104 44 q-16 14 -22 76 z" fill="${p.c1}"/>`,
    chat: `<rect x="62" y="${H / 2 - 62}" width="146" height="100" rx="42" fill="${p.c1}"/><circle cx="110" cy="${H / 2 - 12}" r="12" fill="#0a0a14"/><circle cx="150" cy="${H / 2 - 12}" r="12" fill="#0a0a14"/>`,
    block: `<rect x="62" y="${H / 2 - 62}" width="140" height="124" rx="16" fill="${p.c1}"/><rect x="86" y="${H / 2 - 36}" width="92" height="72" rx="10" fill="#0a0a0a"/><text x="132" y="${H / 2 + 18}" font-family="${L.FONT}" font-size="42" font-weight="bold" fill="${p.c1}" text-anchor="middle">18</text>`,
  }[p.shape];

  const ink = await L.textInk({ text, size: 120, fill: 'url(#g)', defs, filters: 'url(#f)' });
  // size the word to the space left of the badge, and sit it on the badge's
  // centre line so the nameplate reads as one lockup
  const sized = await L.scaleInk(ink, W * 0.5, H * 0.42);
  const base = await L.backdrop(W, H, p.bg, defs, glyph);

  const left = Math.round(W * 0.26);
  const top = Math.round((H - sized.height) / 2) - 8;

  // caption sits clearly below both the word and the badge, never across them
  const capY = Math.min(H - 26, top + sized.height + 46);
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs>
     <text x="${W - 56}" y="${capY}" text-anchor="end" font-family="${L.FONT}" font-size="19"
       letter-spacing="6" fill="${p.c1}" opacity="0.65">${T(p.label)}</text></svg>`,
  );
  return sharp(base)
    .composite([
      { input: sized.png, left, top },
      { input: label, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/* ── cards / docs: these carry real information, so they lay out as a document ── */

const luma = (hex) => {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** pick black or white text for a background */
const onColor = (hex) => (luma(hex) > 0.55 ? '#111418' : '#ffffff');

async function card({ title, fields, lines = [], accent = '#4f8cff', bg = '#101420', width = 1000 }) {
  const pad = 56;
  const rowH = 46;
  const bodyTop = 210;
  const h = bodyTop + fields.length * rowH + lines.length * 34 + 96;
  let rows = '';
  fields.forEach(([k, v], i) => {
    const y = bodyTop + i * rowH;
    rows += `<text x="${pad}" y="${y}" font-family="${L.FONT}" font-size="24" fill="#8b95a7">${T(k)}</text>
             <text x="${width - pad}" y="${y}" text-anchor="end" font-family="${L.FONT}" font-size="26" font-weight="bold" fill="#eef2f8">${T(v)}</text>
             <line x1="${pad}" y1="${y + 16}" x2="${width - pad}" y2="${y + 16}" stroke="#232a3a" stroke-width="1"/>`;
  });
  let notes = '';
  lines.forEach((l, i) => {
    notes += `<text x="${pad}" y="${bodyTop + fields.length * rowH + 22 + i * 34}" font-family="${L.MONO}" font-size="20" fill="#9aa5b8">${T(l)}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">
    <defs>${L.GRAD('a', [[0, accent], [1, '#00000000']], 0, 0, 1, 0)}</defs>
    <rect width="${width}" height="${h}" rx="0" fill="${bg}"/>
    <rect width="${width}" height="8" fill="url(#a)"/>
    <text x="${pad}" y="104" font-family="${L.FONT}" font-size="44" font-weight="bold" fill="#eef2f8">${T(title)}</text>
    <rect x="${pad}" y="132" width="90" height="5" rx="2.5" fill="${accent}"/>
    ${rows}${notes}
    <text x="${width - pad}" y="${h - 34}" text-anchor="end" font-family="${L.FONT}" font-size="18" letter-spacing="4" fill="#4a5364">ZYNEX-MD</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/* ══════════════════ the map: one entry per catalogue name ══════════════════ */

const STYLES = {
  /* textmaker — effects */
  neon: (t) => neon(t),
  neonlight: (t) => neon(t, { label: 'NEON' }),
  light: (t) => neon(t, { c1: '#fff7b0', c2: '#ffb300', label: 'LIGHT' }),
  fire: (t) => fire(t),
  flame: (t) => fire(t),
  ice: (t) => ice(t),
  snow: (t) => ice(t, { c1: '#ffffff', c2: '#a8d8ff', label: 'SNOW' }),
  cloud: (t) => ice(t, { c1: '#ffffff', c2: '#b8c6dd', bg: '#2a3550', label: 'CLOUD' }),
  chrome: (t) => chrome(t),
  metal: (t) => chrome(t),
  silver: (t) => chrome(t),
  '3dtext': (t) => threeD(t),
  goldtext: (t) => gold(t),
  graffiti: (t) => graffiti(t),
  grafitti: (t) => graffiti(t),
  glitch: (t) => glitch(t),
  glitchtext: (t) => glitch(t),
  thunder: (t) => thunder(t),
  thunderlogo: (t) => thunder(t),
  galaxy: (t) => galaxy(t),
  space: (t) => galaxy(t),
  rainbow: (t) => rainbow(t),
  sand: (t) => sand(t),
  sandwriting: (t) => sand(t),
  shadow: (t) => shadow(t),
  hacker: (t) => glitch(t),

  /* fandom / gaming nameplates */
  apex: (t) => themed(t, 'apex'),
  avengers: (t) => themed(t, 'avengers'),
  batman: (t) => themed(t, 'batman'),
  cod: (t) => themed(t, 'cod'),
  dragonball: (t) => themed(t, 'dragonball'),
  esports: (t) => themed(t, 'esports'),
  fortnite: (t) => themed(t, 'fortnite'),
  freefire: (t) => themed(t, 'freefire'),
  gaming: (t) => themed(t, 'gaming'),
  joker: (t) => themed(t, 'joker'),
  marvel: (t) => themed(t, 'marvel'),
  minecraft: (t) => themed(t, 'minecraft'),
  ml: (t) => themed(t, 'ml'),
  mobilelegends: (t) => themed(t, 'mobilelegends'),
  naruto: (t) => themed(t, 'naruto'),
  onepiece: (t) => themed(t, 'onepiece'),
  pubg: (t) => themed(t, 'pubg'),
  roblox: (t) => themed(t, 'roblox'),
  squad: (t) => themed(t, 'squad'),
  superman: (t) => themed(t, 'superman'),
  valorant: (t) => themed(t, 'valorant'),
  clan: (t) => themed(t, 'clan'),
  team: (t) => themed(t, 'team'),
  light3d: (t) => threeD(t),
  blackpink: (t) => themed(t, 'blackpink'),

  /* platform nameplates */
  youtubelogo: (t) => platform(t, 'youtube'),
  ytlogo: (t) => platform(t, 'youtube'),
  tiktoklogo: (t) => platform(t, 'tiktoklogo'),
  iglogo: (t) => platform(t, 'iglogo'),
  fblogo: (t) => platform(t, 'fblogo'),
  twitterlogo: (t) => platform(t, 'twitterlogo'),
  discordlogo: (t) => platform(t, 'discordlogo'),
  pornhub: (t) => platform(t, 'pornhub'),
};

/** the nameplates that must state they are custom renderings, not real logos */
const TRIBUTE = new Set(Object.keys(THEMES).concat(['ml', 'mobilelegends', 'team', 'clan', 'squad']));
const TRADEMARKED = new Set([
  'youtubelogo', 'ytlogo', 'tiktoklogo', 'iglogo', 'fblogo', 'twitterlogo', 'discordlogo', 'pornhub',
]);

/** document-card styles: their content is information, not decoration */
const CARDS = new Set([
  'bizcard', 'namecard', 'id_card', 'idcard', 'certificate', 'flyer', 'poster', 'banner', 'thumbnail',
]);

/** accent colour per card style, so each reads as a different document */
const ACCENTS = {
  bizcard: '#4f8cff',
  namecard: '#f59e0b',
  id_card: '#22c55e',
  idcard: '#22c55e',
  certificate: '#a855f7',
  flyer: '#ef4444',
  poster: '#f97316',
  banner: '#06b6d4',
  thumbnail: '#84cc16',
};

async function render(name, text) {
  const fn = STYLES[name];
  if (!fn) throw new Error(`no renderer for ${name}`);
  return fn(text);
}

module.exports = {
  STYLES, CARDS, ACCENTS, TRIBUTE, TRADEMARKED, render, card, neon, threeD, themed, platform,
  onColor, W, H,
};
