const sharp = require('sharp');
const fs = require('fs');

/*
 * App icons are not the logo. At 48px the full artwork is unreadable, and
 * Android masks icons into a circle/squircle — anything near the edge is cut.
 * So the icon is a clean brand mark: dark field, purple crown, a Z, all inside
 * the safe zone (the middle 80%), plus a maskable variant with extra padding.
 */
const mark = (pad = 0) => {
  const S = 512;
  const inset = S * (0.1 + pad);          // safe zone
  const inner = S - inset * 2;
  const cx = S / 2;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12101c"/>
      <stop offset="0.55" stop-color="#0a0608"/>
      <stop offset="1" stop-color="#1a0f2e"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.45" stop-color="#d8d8e8"/>
      <stop offset="0.5" stop-color="#9aa0b8"/>
      <stop offset="1" stop-color="#eef2f8"/>
    </linearGradient>
    <linearGradient id="purple" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${S * 0.018}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${S}" height="${S}" fill="url(#bg)"/>

  <!-- crown -->
  <g transform="translate(${cx}, ${S * 0.245})" filter="url(#glow)">
    <path d="M ${-inner * 0.20} ${inner * 0.055}
             L ${-inner * 0.13} ${-inner * 0.075}
             L ${-inner * 0.055} ${inner * 0.02}
             L 0 ${-inner * 0.115}
             L ${inner * 0.055} ${inner * 0.02}
             L ${inner * 0.13} ${-inner * 0.075}
             L ${inner * 0.20} ${inner * 0.055}
             L ${inner * 0.155} ${inner * 0.115}
             L ${-inner * 0.155} ${inner * 0.115} Z"
          fill="url(#purple)"/>
  </g>

  <!-- Z -->
  <g filter="url(#glow)">
    <path d="M ${cx - inner * 0.215} ${S * 0.40}
             L ${cx + inner * 0.215} ${S * 0.40}
             L ${cx + inner * 0.215} ${S * 0.475}
             L ${cx - inner * 0.075} ${S * 0.645}
             L ${cx + inner * 0.215} ${S * 0.645}
             L ${cx + inner * 0.215} ${S * 0.72}
             L ${cx - inner * 0.215} ${S * 0.72}
             L ${cx - inner * 0.215} ${S * 0.645}
             L ${cx + inner * 0.075} ${S * 0.475}
             L ${cx - inner * 0.215} ${S * 0.475} Z"
          fill="url(#metal)" stroke="#7c3aed" stroke-width="${S * 0.008}"/>
  </g>
</svg>`;
};

(async () => {
  const out = 'public/assets';
  const svg = Buffer.from(mark(0));
  const maskable = Buffer.from(mark(0.06));

  await sharp(svg).png().resize(192, 192).toFile(`${out}/icon-192.png`);
  await sharp(svg).png().resize(512, 512).toFile(`${out}/icon-512.png`);
  await sharp(maskable).png().resize(512, 512).toFile(`${out}/icon-maskable-512.png`);
  await sharp(svg).png().resize(180, 180).toFile(`${out}/apple-touch-icon.png`);
  await sharp(svg).png().resize(32, 32).toFile(`${out}/favicon-32.png`);
  await sharp(svg).png().resize(16, 16).toFile(`${out}/favicon-16.png`);

  for (const f of ['icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon-32.png','favicon-16.png']) {
    const m = await sharp(`${out}/${f}`).metadata();
    console.log(f.padEnd(24), m.width + 'x' + m.height, (fs.statSync(`${out}/${f}`).size/1024).toFixed(1)+' KB');
  }
})();
