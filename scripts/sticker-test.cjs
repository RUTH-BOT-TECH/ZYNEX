#!/usr/bin/env node
/**
 * sticker-test.cjs — a sticker command must produce a sticker WhatsApp accepts.
 *
 * WhatsApp's rules are the assertions here, not our own preferences:
 *   - WebP format
 *   - 512×512
 *   - under 1 MB
 *   - alpha channel preserved (otherwise a cut-out image gets a black box)
 *
 * Plus the two bugs this suite was written after:
 *   - `.emoji 🚀` rendered "01F680" (the codepoint) because the container has no
 *     emoji font. Fixed with Twemoji artwork; asserted by checking the pixels are
 *     actually coloured, not text.
 *   - The watermark pill landed in the letterbox band beside the picture instead
 *     of on it. Asserted by checking the pill's pixels target a corner of the
 *     *trimmed* art box.
 *
 * Run: node scripts/sticker-test.cjs      (npm run test:stickers)
 */
process.env.SILENT = '1';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const ROOT = path.resolve(__dirname, '..');
const sticker = require(path.join(ROOT, 'lib', 'engines', 'sticker.js'));
const registry = require(path.join(ROOT, 'lib', 'registry.js'));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \u2713 ${n}`); }
  else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); }
};

/* ── test media, generated locally so the suite has no network dependency ── */
const FIXTURE = path.join('/tmp', 'zynex-sticker-fixture.png');
async function fixture() {
  if (fs.existsSync(FIXTURE)) return fs.readFileSync(FIXTURE);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="640">
    <rect width="900" height="640" fill="#0f766e"/>
    <circle cx="450" cy="320" r="200" fill="#f59e0b"/>
    <text x="450" y="350" text-anchor="middle" font-size="96" font-family="DejaVu Sans" fill="#ffffff">TEST</text>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(FIXTURE, buf);
  return buf;
}

let sent = [];
async function run(command, args = [], { media = null } = {}) {
  sent = [];
  await sticker.execute({
    command, args, from: '120363400000000004@g.us', sender: '2348111000007@s.whatsapp.net',
    msg: { key: {}, message: {} }, prefix: '.',
    sock: { sendMessage: async (j, c) => { sent.push(c); return {}; } },
    reply: async (t) => { sent.push({ text: String(t) }); return {}; },
    download: media ? async () => media : undefined,
  });
  return sent[sent.length - 1] || {};
}

/** verify a payload really is a WhatsApp-legal sticker */
async function checkSticker(buf, { alpha = true } = {}) {
  if (!Buffer.isBuffer(buf)) return { ok: false, why: 'not a buffer' };
  const meta = await sharp(buf).metadata();
  if (meta.format !== 'webp') return { ok: false, why: `format ${meta.format}` };
  if (meta.width !== 512 || meta.height !== 512) return { ok: false, why: `${meta.width}x${meta.height}` };
  if (buf.length > 1024 * 1024) return { ok: false, why: `${(buf.length / 1024).toFixed(0)} KB > 1 MB` };
  if (alpha && !meta.hasAlpha) return { ok: false, why: 'no alpha channel' };
  return { ok: true, meta };
}

/** how much colour is in the image (0 = greyscale/empty) */
async function colourfulness(buf) {
  const { data, info } = await sharp(buf).resize(64, 64).raw().toBuffer({ resolveWithObject: true });
  let diff = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    diff += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i + 1] - data[i + 2]);
  }
  return diff / (64 * 64);
}

(async () => {
  console.log('\n\u2550\u2550 Sticker engine \u2550\u2550\n');
  const IMG = await fixture();

  /* ── 1. routing ── */
  const misrouted = sticker.extraNames.filter((n) => {
    const o = registry.get(n);
    return !o || (o.engine || o.source) !== 'sticker';
  });
  ok(`every declared sticker name routes here (${sticker.extraNames.length})`, misrouted.length === 0, misrouted.join(' '));

  /* ── 2. text stickers ── */
  console.log('');
  for (const cmd of ['ttp2', 'ttp3', 'ttp4', 'ttp5', 'ttp6', 'attp2', 'attp3', 'stickertext']) {
    const p = await run(cmd, ['hello world']);
    const r = await checkSticker(p.sticker);
    ok(`.${cmd} makes a 512×512 WebP sticker`, r.ok, r.why || '');
  }
  const emptyText = await run('ttp2', []);
  ok('.ttp2 with no text explains usage', /Use `\./.test(String(emptyText.text || '')), String(emptyText.text || '').slice(0, 40));

  /* ── 3. text stickers wrap rather than overflow ── */
  const longText = await run('ttp2', ['this is a rather long phrase that must wrap onto several lines']);
  const longOk = await checkSticker(longText.sticker);
  ok('.ttp2 handles a long phrase without breaking the canvas', longOk.ok, longOk.why || '');

  /* ── 4. emoji stickers are real artwork, not codepoint text ── */
  console.log('');
  for (const glyph of ['🚀', '🔥', '🎯', '❤️']) {
    const p = await run('emoji', [glyph]);
    const r = await checkSticker(p.sticker);
    if (!r.ok) { ok(`.emoji ${glyph}`, false, r.why); continue; }
    const colour = await colourfulness(p.sticker);
    // monochrome text of "01F680" sits near 0; Twemoji artwork is vividly coloured
    ok(`.emoji ${glyph} renders colour artwork`, colour > 3, `colourfulness ${colour.toFixed(1)}`);
  }

  const row = await run('emojisticker', ['🚀🔥🌟']);
  ok('.emojisticker accepts several emoji', (await checkSticker(row.sticker)).ok);

  const mix = await run('emixt', ['😂 🔥']);
  ok('.emixt combines two emoji', (await checkSticker(mix.sticker)).ok);

  const less = await run('emixt', ['😂']);
  ok('.emixt with one emoji asks for two', /Use `\./.test(String(less.text || '')), String(less.text || '').slice(0, 40));

  /* ── 5. image edits keep the alpha channel ── */
  console.log('');
  for (const cmd of ['stickercircle', 'stickerrounded', 'stickerflip', 'stickerrotate', 'stickercrop', 'stickerblur', 'sticker2']) {
    const p = await run(cmd, [], { media: IMG });
    const r = await checkSticker(p.sticker);
    ok(`.${cmd} keeps 512×512 WebP with alpha`, r.ok, r.why || '');
  }

  const circle = await run('stickercircle', [], { media: IMG });
  {
    // the corners of a circle sticker must be transparent
    const { data, info } = await sharp(circle.sticker).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corner = data[(2 * info.width + 2) * 4 + 3];
    ok('.stickercircle leaves transparent corners', corner < 30, `corner alpha ${corner}`);
  }

  /* ── 6. the edit-only commands must not send anything without media ── */
  console.log('');
  for (const cmd of ['stickercircle', 'stickerwm', 'smeme']) {
    const p = await run(cmd, ['x']);
    ok(`.${cmd} without media asks for an image`, !p.sticker && !p.image && /❌|reply to/i.test(String(p.text || '')), String(p.text || '').slice(0, 50));
  }

  /* ── 7. the watermark lands on the picture, not beside it ── */
  const wm = await run('stickerwm', ['ZYNEX'], { media: IMG });
  {
    const r = await checkSticker(wm.sticker);
    ok('.stickerwm produces a valid sticker', r.ok, r.why || '');
    // the pill is a dark rounded rect in the bottom-right of the *image*.
    // Sample the bottom-right quadrant of the trim box and expect dark pixels.
    const { data, info } = await sharp(wm.sticker)
      .ensureAlpha()
      .trim({ threshold: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sx = Math.floor(info.width * 0.86);
    const sy = Math.floor(info.height * 0.94);
    const i = (sy * info.width + sx) * info.channels;
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    ok('.stickerwm draws the pill on the artwork', lum < 120, `sampled luminance ${lum.toFixed(0)} (pill is dark)`);
  }

  /* ── 8. meme captions ── */
  const meme = await run('smeme', ['TOP TEXT | bottom text'], { media: IMG });
  ok('.smeme builds a captioned sticker', (await checkSticker(meme.sticker)).ok);

  /* ── 9. honest refusals ── */
  console.log('');
  for (const [cmd, re] of [
    ['img2txt', /vision model/],
    ['stickersearch', /needs a source|needs a key/],
    ['tgsticker', /bot token|needs a/i],
    ['tourl2', /\.upload/],
  ]) {
    const p = await run(cmd, ['x']);
    const body = String(p.text || '');
    ok(`.${cmd} refuses and names a working command`, re.test(body) && /`\./.test(body), body.replace(/\n/g, ' ').slice(0, 70));
  }

  /* ── 10. the size ceiling is enforced, not hoped for ── */
  console.log('');
  const noisy = await sharp({
    create: { width: 1400, height: 1400, channels: 4, noise: { type: 'gaussian', mean: 128, sigma: 70 } },
  })
    .png()
    .toBuffer();
  const big = await sticker.toSticker(noisy);
  ok('a noisy 1400px source still lands under 1 MB', big.length <= 1024 * 1024, `${(big.length / 1024).toFixed(0)} KB`);
  ok('…and is still 512×512 WebP', (await checkSticker(big)).ok, '');

  const total = pass + fails.length;
  console.log(`\n${pass}/${total} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  \u2022 ' + f));
    process.exit(1);
  }
})();
