/**
 * App icons, generated from the real ZYNEX-MD artwork.
 *
 * ★ This replaced a hand-drawn crown-and-Z mark. The mark read cleanly at 48px,
 * but it was not the logo — and an app icon's job is to be the thing the user
 * already recognises, not a substitute for it. The artwork is the brand, so the
 * artwork is what the home screen shows.
 *
 * The one real constraint is Android's maskable icon: launchers crop it to a
 * circle/squircle, so anything in the outer ~20% is cut. The wordmark spans
 * almost the full width of the artwork, so a straight re-use would slice the Z
 * and the X. The maskable variant therefore scales the artwork down onto an
 * extended dark field — the crop then lands on background, not on letters.
 *
 * Run: npm run icons
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../public/assets');
const ICONS = path.resolve(__dirname, '../public/assets/app-icons');
const SRC = path.join(OUT, 'zynex-logo.png');   // the artwork as it always was

const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
  ['favicon-16.png', 16],
];

require('fs').mkdirSync(ICONS, { recursive: true });

(async () => {
  const meta = await sharp(SRC).metadata();
  if (!meta.width) throw new Error('zynex-logo.png is unreadable');

  // ── plain icons: the artwork, square, untouched ──────────────────────────
  for (const [name, size] of sizes) {
    await sharp(SRC)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(path.join(ICONS, name));
    console.log(`${name.padEnd(24)} ${size}x${size}  ${(fs.statSync(path.join(ICONS, name)).size / 1024).toFixed(1)} KB`);
  }

  // ── maskable: artwork shrunk inside the safe zone ────────────────────────
  /*
   * 512 canvas, artwork at 68% (≈348px) centred. A launcher circle inscribed in
   * the 512 square keeps everything within ~80% of the width, so artwork at 68%
   * sits entirely inside it with margin on every side. The surrounding field is
   * a dark purple pulled from the artwork so the seam is invisible.
   */
  const S = 512;
  const inner = Math.round(S * 0.68);
  const art = await sharp(SRC).resize(inner, inner, { fit: 'cover', position: 'centre' }).png().toBuffer();

  await sharp({
    create: { width: S, height: S, channels: 4, background: { r: 12, g: 8, b: 20, alpha: 1 } },
  })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toFile(path.join(ICONS, 'icon-maskable-512.png'));
  console.log(`icon-maskable-512.png    512x512  ${(fs.statSync(path.join(ICONS, 'icon-maskable-512.png')).size / 1024).toFixed(1)} KB`);
})();
