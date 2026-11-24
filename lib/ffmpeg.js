'use strict';
/**
 * Where is ffmpeg?
 *
 * Three sources, in order of reliability:
 *   1. ffmpeg-static — an npm package that ships a prebuilt binary. This is the
 *      one that actually works here: .nixpacks.toml lists ffmpeg in nixPkgs and
 *      the build environment ignored it (verified: `command -v ffmpeg` exit 1
 *      inside the running container, while ffmpeg-static runs ffmpeg 7.0.2).
 *   2. an explicit FFMPEG_PATH
 *   3. `ffmpeg` on PATH, e.g. a developer machine
 *
 * Returns the path, or null when nothing is usable.
 */
const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const execFileAsync = promisify(execFile);

let cached;

function ffmpegPath() {
  if (cached !== undefined) return cached;

  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath) candidates.push(staticPath);
  } catch {
    // package not installed — fine
  }
  candidates.push('ffmpeg');

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 8000 });
      cached = candidate;
      /**
       * Baileys itself spawns the bare word `ffmpeg` when it needs a video
       * thumbnail ({ video: { url } } paths). On a host with only
       * ffmpeg-static — no system package — that produced
       * "spawn ffmpeg ENOENT" and the animation silently fell back to a static
       * image. Put the resolved binary's directory on PATH so the child
       * process finds it too, not just our own execFile calls.
       */
      if (candidate !== 'ffmpeg') {
        const dir = path.dirname(candidate);
        const parts = String(process.env.PATH || '').split(path.delimiter);
        if (!parts.includes(dir)) {
          process.env.PATH = dir + path.delimiter + (process.env.PATH || '');
        }
      }
      console.log(`[FFMPEG] using ${candidate}`);
      return cached;
    } catch {
      // try the next one
    }
  }
  cached = null;
  console.log('[FFMPEG] no working binary — animations and voice notes degrade');
  return cached;
}

function hasFfmpeg() {
  return Boolean(ffmpegPath());
}

/**
 * Pitch shift by N semitones, tempo preserved.
 *
 * `audio.js` builds its effect table at require time and called
 * `ffmpeg.pitchSemitones(4)` — a function this module never exported. The
 * resulting TypeError happened while the module was being loaded, so the whole
 * audio engine was dropped:
 *
 *   [REGISTRY] engine audio.js failed to load: ffmpeg.pitchSemitones is not a function
 *
 * Every audio effect command was dead, not merely pitch. Found in production
 * logs, not by the test suites — hence the engine-load check added alongside.
 *
 * Chain: resample to shift pitch (which also changes speed), then correct the
 * speed with atempo. atempo accepts 0.5–2.0, so keep the ratio in that band.
 */
function pitchSemitones(semitones = 0) {
  const ratio = Math.pow(2, semitones / 12);
  const atempo = 1 / ratio;
  const clamped = Math.min(2, Math.max(0.5, atempo));
  return `asetrate=${Math.round(44100 * ratio)},aresample=44100,atempo=${clamped.toFixed(4)}`;
}

/**
 * Convert an in-memory buffer with ffmpeg.
 *
 * `converter.js` and `sticker.js` both called `ff.convert(buf, args, opts)`
 * and expected `{ ok, buffer, stderr }`. This module never exported it, so
 * `.toaudio`, `.tovn`, `.tovideo`, `.togif` and `.webp2mp4` all died with
 * "ff.convert is not a function".
 *
 * Input and output are temporary files (ffmpeg works on paths, not buffers);
 * everything is removed in `finally`, including on failure.
 */
async function convert(input, args = [], opts = {}) {
  const bin = ffmpegPath();
  if (!bin) return { ok: false, stderr: 'ffmpeg is not available on this host' };
  if (!Buffer.isBuffer(input) || !input.length) return { ok: false, stderr: 'empty input buffer' };

  const { inExt = '.bin', outExt = '.bin', timeout = 60000 } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-ff-'));
  const inFile = path.join(dir, 'in' + inExt);
  const outFile = path.join(dir, 'out' + outExt);
  try {
    fs.writeFileSync(inFile, input);
    const argv = ['-y', '-loglevel', 'error', '-i', inFile, ...args, outFile];
    const { stderr } = await execFileAsync(bin, argv, {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (!fs.existsSync(outFile)) {
      return { ok: false, stderr: (stderr || 'ffmpeg produced no output').slice(0, 2000) };
    }
    const buffer = fs.readFileSync(outFile);
    if (!buffer.length) return { ok: false, stderr: 'ffmpeg produced an empty output' };
    return { ok: true, buffer, stderr: String(stderr || '') };
  } catch (e) {
    return {
      ok: false,
      stderr: String((e && (e.stderr || e.message)) || e).slice(0, 2000),
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { ffmpegPath, hasFfmpeg, pitchSemitones, convert };
