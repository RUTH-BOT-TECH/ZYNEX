/**
 * lib/engines/overlay.js — the real image effects, composited from PNG assets.
 *
 * ★ What this file used to be, and why it was wrong
 *
 * The first version drew approximations with ffmpeg filters: a black band with
 * a red rule for "wasted", grey bars for "jail". They rendered, they passed
 * tests, and they were not the thing anyone recognises. The real .wasted is the
 * GTA loss screen — big red lettering inside a grey band — and .jail is a photo
 * behind grey prison bars.
 *
 * Every bot that ships these composites the user's photo under a transparent
 * PNG. That is the whole trick, and it is the reason the output looks right:
 * the overlay is artwork, not a filter chain.
 *
 * assets/overlays/*.png now holds that artwork (from canvacord-assets, MIT, in
 * this repo so no runtime dependency). Rendering is three ffmpeg steps:
 *
 *   1. scale the photo to cover the overlay's aspect ratio, and crop
 *   2. composite the overlay on top at full size
 *
 * ffmpeg-static has no drawtext, which no longer matters: nothing here draws
 * text.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ffmpegPath } = require('../ffmpeg');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'overlays');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const line = String(stderr || '')
          .split('\n')
          .filter((l) => /error|invalid|no such|failed|unable/i.test(l))
          .slice(-2)
          .join(' ') || err.message;
        return reject(new Error(line.trim()));
      }
      resolve();
    });
  });
}

/** Read an image's pixel dimensions without an image library. Accepts a path or a Buffer. */
function dimensions(fileOrBuffer) {
  const b = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  if (b.slice(1, 4).toString() === 'PNG' && b.slice(12, 16).toString() === 'IHDR') {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  // JPEG: walk the segments looking for an SOF marker
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Composite `input` under assets/overlays/<name>.<ext>.
 *
 * The photo is scaled to COVER the overlay's aspect ratio and then centre-
 * cropped, because squashing a portrait photo into a square overlay looks
 * wrong and cropping at the wrong ratio looks worse.
 */
async function composite(inputBuffer, assetName, opts = {}) {
  const ext = ['png', 'jpg'].find((e) => fs.existsSync(path.join(ASSETS, `${assetName}.${e}`)));
  if (!ext) throw new Error(`no artwork named "${assetName}" in assets/overlays`);
  const asset = path.join(ASSETS, `${assetName}.${ext}`);

  const dim = dimensions(asset);
  if (!dim || !dim.w || !dim.h) throw new Error(`could not read the size of ${assetName}.${ext}`);
  const { w, h } = dim;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-ov-'));
  const inFile = path.join(dir, 'in.img');
  const outFile = path.join(dir, 'out.png');

  try {
    fs.writeFileSync(inFile, inputBuffer);

    const filter = [
      // 1. cover-fit the photo: scale to fill, then crop the overflow
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[photo]`,
      // 2. overlay the artwork at full size
      `[photo][1:v]overlay=0:0:format=auto[out]`,
    ].join(';');

    await run([
      '-y', '-loglevel', 'error',
      '-i', inFile,
      '-i', asset,
      '-filter_complex', filter,
      '-map', '[out]',
      '-frames:v', '1',
      '-update', '1',
      outFile,
    ]);

    const buf = fs.readFileSync(outFile);
    if (!buf.length) throw new Error('ffmpeg produced an empty image');
    return opts.asJpeg ? buf : buf;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/**
 * Effects that are artwork plus a colour treatment rather than a pure overlay.
 * `grade` is applied to the photo BEFORE the artwork goes on, so the artwork
 * keeps its own colours — that is what the reference implementations do.
 */
const GRADES = {
  hitler: 'format=gray,eq=contrast=1.5:brightness=-0.03',
  triggered: 'colorbalance=rs=0.25:gs=-0.05:bs=-0.05,eq=contrast=1.3:saturation=1.4',
  shit: 'colorbalance=rs=0.4:gs=0.15:bs=-0.4,eq=saturation=0.7',
  spank: 'colorbalance=rs=0.35:bs=-0.2,eq=contrast=1.2',
};

/**
 * The artwork list. Each entry must have a matching file in assets/overlays —
 * the tests assert this, so a name cannot be advertised without its asset.
 */
const EFFECTS = {
  wasted: { file: 'wasted', desc: 'GTA "wasted" loss screen' },
  jail: { file: 'jail', desc: 'behind grey prison bars' },
  triggered: { file: 'triggered', desc: 'TRIGGERED banner', grade: GRADES.triggered },
  rip: { file: 'rip', desc: 'R.I.P. tombstone' },
  trash: { file: 'trash', desc: 'binned' },
  wanted: { file: 'wanted', desc: 'wanted poster' },
  affect: { file: 'affect', desc: 'no effect' },
  beautiful: { file: 'beautiful', desc: 'beautiful' },
  facepalm: { file: 'facepalm', desc: 'facepalm' },
  bed: { file: 'bed', desc: 'in bed' },
  spank: { file: 'spank', desc: 'spanked', grade: GRADES.spank },
  hitler: { file: 'hitler', desc: '1940s newsreel', grade: GRADES.hitler },
  shit: { file: 'shit', desc: 'bullshit', grade: GRADES.shit },
  distracted: { file: 'distracted', desc: "can't focus" },
  jokeoverhead: { file: 'jokeoverhead', desc: 'joke overhead' },
};

const NAMES = new Set(Object.keys(EFFECTS));

/** Apply a colour grade to the photo, then composite the artwork. */
async function render(inputBuffer, name) {
  const def = EFFECTS[name];
  if (!def) throw new Error(`unknown effect "${name}"`);
  if (!def.grade) return composite(inputBuffer, def.file);

  const ext = ['png', 'jpg'].find((e) => fs.existsSync(path.join(ASSETS, `${def.file}.${e}`)));
  const asset = path.join(ASSETS, `${def.file}.${ext}`);
  const dim = dimensions(asset);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-ovg-'));
  const inFile = path.join(dir, 'in.img');
  const outFile = path.join(dir, 'out.png');
  try {
    fs.writeFileSync(inFile, inputBuffer);
    const filter = [
      `[0:v]scale=${dim.w}:${dim.h}:force_original_aspect_ratio=increase,crop=${dim.w}:${dim.h},${def.grade}[photo]`,
      `[photo][1:v]overlay=0:0:format=auto[out]`,
    ].join(';');
    await run(['-y', '-loglevel', 'error', '-i', inFile, '-i', asset,
      '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-update', '1', outFile]);
    const buf = fs.readFileSync(outFile);
    if (!buf.length) throw new Error('ffmpeg produced an empty image');
    return buf;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

const engine = {
  id: 'overlay',
  name: 'overlay-engine',
  extraNames: [...NAMES],
  assetDir: ASSETS,

  match(name) { return NAMES.has(name); },

  async execute(ctx) {
    const { command, reply } = ctx;
    const def = EFFECTS[command];
    if (!def) return reply(`❌ \`${command}\` is not wired in the overlay engine.`);

    let input = null;
    try {
      if (typeof ctx.download === 'function') input = await ctx.download();
      else if (typeof ctx.getQuotedImage === 'function') input = await ctx.getQuotedImage();
    } catch (e) {
      return reply(
        `🖼️ *${command}* — ${def.desc}\n\nReply to a photo with \`.${command}\`.\n\n_${e.message}_`,
      );
    }

    try {
      const out = await render(input, command);
      if (!out || out.length < 200) throw new Error('the effect produced an unusable image');
      return { image: out, caption: `🖼️ .${command}` };
    } catch (e) {
      return reply(
        `❌ *.${command}* failed\n\n${e.message}\n\n` +
        '_The photo was received but ffmpeg could not process it. Try a JPG or PNG under 10 MB._',
      );
    }
  },
};

module.exports = engine;
module.exports._internal = { EFFECTS, GRADES, render, composite, dimensions, NAMES, ASSETS };
