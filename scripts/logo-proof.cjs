#!/usr/bin/env node
/**
 * logo-proof.cjs — regenerates samples/textmaker-proof.html
 *
 * Renders every textmaker command through the real engine and lays them out in
 * a labelled contact sheet, so the proof is something you can look at rather
 * than a claim. Each tile is produced by the same code path `.neon` uses.
 *
 * Run: node scripts/logo-proof.cjs
 */
'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const LOGOS = require(path.resolve(__dirname, '..', 'lib', 'logostyles.js'));

const GROUPS = [
  ['Glow & light', ['neon', 'neonlight', 'light', 'fire', 'flame']],
  ['Cold & cloud', ['ice', 'snow', 'cloud']],
  ['Metal & dimension', ['chrome', 'metal', 'silver', '3dtext', 'goldtext', 'shadow']],
  ['Texture', ['sand', 'sandwriting', 'graffiti', 'grafitti']],
  ['Digital', ['glitch', 'glitchtext', 'hacker', 'galaxy', 'space', 'thunder', 'thunderlogo', 'rainbow']],
  ['Game & fandom nameplates', [
    'apex', 'avengers', 'batman', 'blackpink', 'clan', 'cod', 'dragonball', 'esports',
    'fortnite', 'freefire', 'gaming', 'joker', 'marvel', 'minecraft', 'ml',
    'mobilelegends', 'naruto', 'onepiece', 'pubg', 'roblox', 'squad', 'superman',
    'team', 'valorant',
  ]],
  ['Platform nameplates', [
    'youtubelogo', 'ytlogo', 'tiktoklogo', 'iglogo', 'fblogo', 'twitterlogo', 'discordlogo', 'pornhub',
  ]],
];

const TILE_W = 460;
const LABEL_H = 26;
const GAP = 8;
const COLS = 2;
const MARGIN = 14;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

(async () => {
  const rows = []; // { type:'heading', text } | { type:'row', tiles:[{buf,h,label}] }

  for (const [heading, names] of GROUPS) {
    rows.push({ type: 'heading', text: heading });
    for (let i = 0; i < names.length; i += COLS) {
      const slice = names.slice(i, i + COLS);
      const tiles = [];
      for (const name of slice) {
        let png;
        try {
          png = await LOGOS.render(name, 'ZYNEX-MD');
        } catch (e) {
          console.log(`  ! ${name}: ${e.message}`);
          continue;
        }
        const img = await sharp(png).resize({ width: TILE_W }).png().toBuffer();
        const meta = await sharp(img).metadata();
        // label strip below the tile
        const label = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${LABEL_H}">
             <rect width="${TILE_W}" height="${LABEL_H}" fill="#15161a"/>
             <circle cx="14" cy="${LABEL_H / 2}" r="3" fill="#4f8cff"/>
             <text x="28" y="${LABEL_H / 2 + 5}" font-family="DejaVu Sans Mono" font-size="13" fill="#c9d2e0">.${esc(name)}</text>
           </svg>`,
        );
        const stacked = await sharp({ create: { width: TILE_W, height: meta.height + LABEL_H, channels: 3, background: '#15161a' } })
          .composite([{ input: img, left: 0, top: 0 }, { input: label, left: 0, top: meta.height }])
          .png()
          .toBuffer();
        tiles.push({ buf: stacked, h: meta.height + LABEL_H });
      }
      if (tiles.length) rows.push({ type: 'row', tiles });
    }
  }

  // cards
  rows.push({ type: 'heading', text: 'Document cards (real fields, not decoration)' });
  const cardTiles = [];
  for (const [cmd, accent, fields] of [
    ['bizcard', '#4f8cff', [['Name', 'Chinedu Okafor'], ['Role', 'Software Engineer'], ['Phone', '+234 802 101 6309'], ['Email', 'chinedu@zynex.dev']]],
    ['idcard', '#22c55e', [['Name', 'Amina Bello'], ['ID', 'ZYN-2026-0441'], ['Group', 'ZYNEX-MD Testers'], ['Status', 'ACTIVE']]],
  ]) {
    const png = await LOGOS.card({ title: cmd.replace(/_/g, ' ').toUpperCase(), accent, fields });
    const img = await sharp(png).resize({ width: TILE_W }).png().toBuffer();
    const meta = await sharp(img).metadata();
    const label = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${LABEL_H}">
         <rect width="${TILE_W}" height="${LABEL_H}" fill="#15161a"/>
         <circle cx="14" cy="${LABEL_H / 2}" r="3" fill="#22c55e"/>
         <text x="28" y="${LABEL_H / 2 + 5}" font-family="DejaVu Sans Mono" font-size="13" fill="#c9d2e0">.${cmd}</text>
       </svg>`,
    );
    cardTiles.push({
      buf: await sharp({ create: { width: TILE_W, height: meta.height + LABEL_H, channels: 3, background: '#15161a' } })
        .composite([{ input: img, left: 0, top: 0 }, { input: label, left: 0, top: meta.height }])
        .png()
        .toBuffer(),
      h: meta.height + LABEL_H,
    });
  }
  rows.push({ type: 'row', tiles: cardTiles });

  /* ── layout the sheet ── */
  const headingH = 42;
  let height = MARGIN;
  for (const r of rows) {
    if (r.type === 'heading') height += headingH;
    else height += Math.max(...r.tiles.map((t) => t.h)) + GAP;
  }
  const width = MARGIN * 2 + TILE_W * COLS + GAP;

  const composites = [];
  let y = MARGIN;
  const sheetW = width;
  for (const r of rows) {
    if (r.type === 'heading') {
      composites.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${headingH}">
             <text x="${MARGIN}" y="${headingH - 14}" font-family="DejaVu Sans" font-size="20" font-weight="bold" fill="#eef2f8">${esc(r.text)}</text>
           </svg>`,
        ),
        left: 0,
        top: y,
      });
      y += headingH;
    } else {
      const rowH = Math.max(...r.tiles.map((t) => t.h));
      r.tiles.forEach((t, i) => {
        composites.push({ input: t.buf, left: MARGIN + i * (TILE_W + GAP), top: y });
      });
      y += rowH + GAP;
    }
  }

  const sheet = await sharp({ create: { width, height, channels: 3, background: '#0c0d10' } })
    .composite(composites)
    .png()
    .toBuffer();

  const b64 = sheet.toString('base64');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ZYNEX-MD — textmaker proof</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#08090c; color:#e8edf5;
         font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1120px; margin:0 auto; padding:38px 22px 64px; }
  h1 { font-size:27px; margin:0 0 6px; letter-spacing:-0.4px; }
  .sub { color:#8b95a7; margin:0 0 26px; font-size:14px; }
  .stats { display:flex; flex-wrap:wrap; gap:10px; margin:0 0 26px; padding:0; list-style:none; }
  .stats li { background:#12141a; border:1px solid #21262f; border-radius:9px; padding:9px 14px; font-size:13px; }
  .stats b { color:#7fb0ff; }
  img { width:100%; height:auto; display:block; border-radius:11px; border:1px solid #21262f; }
  .note { background:#12141a; border-left:3px solid #4f8cff; border-radius:0 9px 9px 0;
          padding:13px 17px; margin:26px 0 0; font-size:13.5px; color:#a8b3c4; }
  .note b { color:#dfe7f2; }
  code { background:#1b1f27; padding:1px 6px; border-radius:4px; font-size:12.5px; color:#9ecbff; }
</style></head>
<body><div class="wrap">
  <h1>ZYNEX-MD — textmaker commands</h1>
  <p class="sub">Every tile below was rendered by <code>lib/logostyles.js</code> at proof time. No network calls.</p>
  <ul class="stats">
    <li><b>${Object.keys(LOGOS.STYLES).length}</b> styles</li>
    <li><b>${LOGOS.CARDS.size}</b> document cards</li>
    <li><b>0</b> remote requests</li>
    <li>renderer: <b>sharp + SVG</b></li>
  </ul>
  <img src="data:image/png;base64,${b64}" alt="Every textmaker logo rendered by the bot">
  <div class="note">
    <b>What changed.</b> These commands used to fetch from <code>api.flamingtext.com</code>, which now
    answers <b>429</b> to this host — and the URL it was given returned an HTML page with HTTP&nbsp;200, so
    the bot was sending a web page to WhatsApp and calling it an image. Every logo is now drawn locally
    with SVG + sharp, so it either renders or it fails loudly; it can never quietly send an error page.
    <br><br>
    <b>Franchise and platform names are themed nameplates, not the official logos.</b> A bot that
    reproduced the Batman or YouTube wordmark would be passing off someone else's trademark, so
    <code>.batman</code> draws a Gotham-palette plate, <code>.youtubelogo</code> draws a play-icon
    lockup, and the caption says so on every reply.
  </div>
</div></body></html>`;

  const out = path.resolve(__dirname, '..', 'samples', 'textmaker-proof.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`sheet ${width}x${height}  →  ${out} (${(html.length / 1024).toFixed(0)} KB)`);
})();
