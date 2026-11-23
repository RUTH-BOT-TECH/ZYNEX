/**
 * lib/engines/overlay.js — image effects built on ffmpeg, with no native module.
 *
 * These are the 845-stub names people actually ask for: wasted, jail,
 * triggered, wanted, rip, trash, affect, beautiful, rainbow and friends.
 *
 * ★ Why not canvacord
 *
 * canvacord implements all of these natively, and it was the obvious choice.
 * It was installed, tested, and SEGFAULTED this host (exit 139) — the canvas
 * backend does not survive here. Shipping it would have made every one of
 * these commands kill the bot process. ffmpeg-static is already a dependency
 * and already used for GIFs and voice notes, so it is the safe route.
 *
 * ★ There is no text rendering here at all.
 *
 * ffmpeg-static is built WITHOUT drawtext — 493 filters, and it is not among
 * them — so any "put words on the image" effect dies with "No such filter".
 * The Railway container also has zero system fonts (fc-list returns 0), which
 * would have broken drawtext a second way. Every effect below is therefore
 * built from drawbox/drawgrid/overlay, which this build does have, so the
 * result is identical on a laptop and in production.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ffmpegPath } = require('../ffmpeg');

/* ── font discovery ───────────────────────────────────────── */
const FONT_CANDIDATES = [
  path.join(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Bold.ttf'),
  path.join(__dirname, '..', '..', 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

function fontPath() {
  for (const f of FONT_CANDIDATES) {
    try { if (fs.statSync(f).size > 1000) return f; } catch { /* keep looking */ }
  }
  return null;
}

/* ffmpeg filter arguments need ':' '\' and ''' escaped inside drawtext */
function escText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const line = String(stderr || '')
          .split('\n')
          .filter((l) => /error|invalid|no such|failed/i.test(l))
          .slice(-2)
          .join(' ') || err.message;
        return reject(new Error(line.trim()));
      }
      resolve();
    });
  });
}

/**
 * Apply a filter chain to an input image and return PNG bytes.
 *
 * Every effect is expressed as a filter string rather than an external API:
 * the APIs that used to serve these (popcat) are 404/500, and a command that
 * depends on somebody else's free endpoint breaks without warning.
 */
async function render(inputBuffer, filter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-ov-'));
  const inFile = path.join(dir, 'in.img');
  const outFile = path.join(dir, 'out.png');
  try {
    fs.writeFileSync(inFile, inputBuffer);
    await run([
      '-y', '-loglevel', 'error',
      '-i', inFile,
      '-vf', filter,
      '-frames:v', '1',
      // Without -update 1 ffmpeg refuses to write a single image to a fixed
      // filename and "succeeds" with a zero-byte file.
      '-update', '1',
      outFile,
    ]);
    const buf = fs.readFileSync(outFile);
    if (!buf.length) throw new Error('ffmpeg produced an empty image');
    return buf;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/* ── effect definitions ───────────────────────────────────────
 * `needsOriginal: false` effects are pure colour transforms; the rest overlay
 * something over the user's photo.
 */
const FONT = fontPath();

const EFFECTS = {
  wasted: {
    desc: 'GTA \"wasted\" — desaturated with a red band across the middle',
    /**
     * ★ drawtext is NOT COMPILED into ffmpeg-static.
     *
     * This build reports 493 filters and drawtext is not one of them, so every
     * text overlay failed with "No such filter" while looking correct. Rather
     * than depend on a font at all, the word is drawn as a band: a black
     * banner with a red rule through it, which reads the same at a glance.
     */
    args: () => [
      'format=gray',
      'colorbalance=rs=0.35:gs=0:bs=-0.2',
      'eq=contrast=1.35:brightness=-0.06',
      'drawbox=x=0:y=ih*0.42:w=iw:h=ih*0.16:c=black@0.80:t=fill',
      'drawbox=x=0:y=ih*0.487:w=iw:h=ih*0.012:c=0x8B0000:t=fill',
      'drawbox=x=iw*0.18:y=ih*0.452:w=iw*0.64:h=ih*0.016:c=0x8B0000:t=fill',
    ].join(','),
  },
  jail: {
    desc: 'Behind prison bars',
    args: () => [
      'scale=iw:ih',
      // 4 thick bars: at iw/7 with t=10 they vanished into a busy photo.
      'drawgrid=w=iw/4:h=ih:t=18:c=0x1a1a1a@0.9',
      'drawgrid=w=iw/4:h=ih:t=6:c=0x6b6b6b@0.65:x=iw/8',
      'eq=contrast=1.15:saturation=0.6:brightness=-0.06',
    ].join(','),
  },
  triggered: {
    desc: 'Shaking red tint',
    args: () => [
      'scale=iw:ih',
      'colorbalance=rs=0.30:gs=-0.10:bs=-0.10',
      'eq=contrast=1.4:saturation=1.5',
      'noise=alls=12:allf=t',
    ].join(','),
  },
  wanted: {
    desc: 'Wanted poster — sepia stock with a bordered plate',
    args: () => [
      'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
      'eq=contrast=1.1:brightness=0.05',
      'drawbox=x=0:y=0:w=iw:h=ih:c=0x3b2a12:t=14',
      'drawbox=x=0:y=0:w=iw:h=ih*0.13:c=0x3b2a12:t=fill',
      'drawbox=x=iw*0.30:y=ih*0.045:w=iw*0.40:h=ih*0.012:c=0xf5e9d0:t=fill',
      'drawbox=x=iw*0.34:y=ih*0.075:w=iw*0.32:h=ih*0.012:c=0xf5e9d0:t=fill',
    ].join(','),
  },
  rip: {
    desc: 'Rest in peace — grey tombstone with an arched headstone',
    args: () => [
      'format=gray',
      'eq=contrast=1.2:brightness=-0.04',
      'drawbox=x=iw*0.14:y=ih*0.16:w=iw*0.72:h=ih*0.68:c=black@0.62:t=fill',
      'drawbox=x=iw*0.14:y=ih*0.16:w=iw*0.72:h=ih*0.68:c=0x9a9a9a:t=6',
      'drawbox=x=iw*0.44:y=ih*0.26:w=iw*0.012:h=ih*0.34:c=0xd0d0d0:t=fill',
      'drawbox=x=iw*0.34:y=ih*0.32:w=iw*0.32:h=ih*0.012:c=0xd0d0d0:t=fill',
    ].join(','),
  },
  trash: {
    desc: 'Garbage — heavy grain and dull colour',
    args: () => 'eq=saturation=0.35:contrast=1.15:brightness=-0.05,noise=alls=22:allf=t,format=gray',
  },
  affect: {
    desc: 'Warm nostalgic grade',
    args: () => 'eq=saturation=0.7:contrast=0.92:brightness=0.04,colorbalance=rs=0.18:bs=-0.12',
  },
  beautiful: {
    desc: 'Beauty glow',
    args: () => 'scale=iw:ih,boxblur=luma_radius=2:luma_power=1:chroma_radius=1:chroma_power=1,eq=brightness=0.06:saturation=1.15',
  },
  rainbow: {
    desc: 'Rainbow wash',
    args: () => 'hue=H=2*PI*t:s=1.4,eq=contrast=1.05',
  },
  facepalm: {
    desc: 'Facepalm — shake plus a dark vignette',
    args: () =>
      'eq=contrast=1.2:brightness=-0.04,rotate=0.03:c=black@0,' +
      'vignette=PI/4',
  },
  distracted: {
    desc: 'Blurred background, sharp frame',
    // The previous chain referenced an overlay without giving it inputs, so
    // ffmpeg could not build the graph. Explicit labels everywhere.
    args: () =>
      'split[base][sharp];[base]boxblur=luma_radius=8:luma_power=2[soft];[soft][sharp]overlay,format=yuv420p',
  },
  fuse: {
    desc: 'Blended with a flame tone',
    args: () => 'colorbalance=rs=0.45:gs=0.05:bs=-0.35,eq=contrast=1.3:saturation=1.6,noise=alls=8:allf=t',
  },
  colorfy: {
    desc: 'Boosted colour everywhere',
    args: () => 'eq=saturation=2.2:contrast=1.15',
  },
  hitler: {
    desc: 'German 1940s newsreel grade',
    args: () => 'format=gray,eq=contrast=1.5:brightness=-0.05,noise=alls=16:allf=t',
  },
  shit: {
    desc: 'Brown smear',
    args: () => 'colorbalance=rs=0.5:gs=0.2:bs=-0.5,eq=saturation=0.55:contrast=1.1',
  },
  spank: {
    desc: 'Sharp red flare',
    args: () => 'colorbalance=rs=0.5:bs=-0.3,eq=contrast=1.35',
  },
  bed: {
    desc: 'Soft sleepy blur with warm light',
    args: () => 'boxblur=luma_radius=3:luma_power=1,colorbalance=rs=0.2:gs=0.05:bs=-0.1,eq=brightness=0.08',
  },
  jokeoverhead: {
    desc: 'Pop-art contrast',
    args: () => 'eq=saturation=1.9:contrast=1.5:brightness=0.03',
  },
};

const NAMES = new Set(Object.keys(EFFECTS));

/** Names this engine must never take over, because something real owns them. */
const RESERVED = new Set(['delete', 'kiss', 'slap', 'pat', 'hug', 'tourl', 'beautiful_x']);

const engine = {
  id: 'overlay',
  name: 'overlay-engine',
  extraNames: [...NAMES],
  fontPath,

  match(name) { return NAMES.has(name); },

  async execute(ctx) {
    const { command, reply } = ctx;
    const effect = EFFECTS[command];
    if (!effect) return reply(`❌ \`${command}\` is not wired in the overlay engine.`);

    /**
     * lib/handler.js exposes the media downloader as `download`. It already
     * resolves "the image attached to this message, or the one it quotes", and
     * it throws a readable error when there is none. Use it rather than
     * re-implementing quoted-message resolution a second time.
     */
    let input = null;
    try {
      if (typeof ctx.download === 'function') input = await ctx.download();
      else if (typeof ctx.getQuotedImage === 'function') input = await ctx.getQuotedImage();
    } catch (e) {
      return reply(
        `🖼️ *${command}*\n\nReply to a photo with \`.${command}\`.\n\n` +
        `_${e.message}_`,
      );
    }

    if (!input || !input.length) {
      return reply(
        `🖼️ *${command}*\n\nReply to a photo with \`.${command}\`.\n\n_${effect.desc}_`,
      );
    }

    try {
      const out = await render(input, effect.args());
      if (!out || out.length < 100) throw new Error('the effect produced an unusable image');
      return { image: out, caption: `🖼️ .${command} — ${effect.desc}` };
    } catch (e) {
      return reply(
        `❌ *.${command}* failed\n\n${e.message}\n\n` +
        '_The photo was received but ffmpeg could not process it. Try a JPG or PNG under 10 MB._',
      );
    }
  },
};

module.exports = engine;
module.exports._internal = { EFFECTS, fontPath, escText, render, NAMES, RESERVED };
module.exports.EFFECTS = EFFECTS;
