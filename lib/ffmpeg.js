/**
 * FFMPEG HELPER — locate the binary, run it safely, clean up temp files.
 *
 * Resolution order:
 *   1. FFMPEG_PATH env var (set this on hosts that ship their own ffmpeg)
 *   2. the `ffmpeg-static` package (bundled — works on Render/Railway with no
 *      apt-get and no root)
 *   3. whatever `ffmpeg` is on PATH
 *
 * Every call goes through execFile (not exec) with an argv array, so no user
 * text is ever shell-interpreted.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let FFMPEG = null;

function resolveFfmpeg() {
  if (FFMPEG) return FFMPEG;
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    FFMPEG = process.env.FFMPEG_PATH;
    return FFMPEG;
  }
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
      FFMPEG = staticPath;
      return FFMPEG;
    }
  } catch { /* not installed */ }
  FFMPEG = 'ffmpeg';
  return FFMPEG;
}

const available = () => Boolean(resolveFfmpeg());

/** Run ffmpeg with an argv array. Resolves {ok, stderr}. */
function run(args, timeout = 120000) {
  return new Promise((resolve) => {
    const bin = resolveFfmpeg();
    execFile(bin, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stderr: (stderr || '') + (err ? `\n${err.message}` : ''), stdout });
    });
  });
}

/** Temp file path with an extension, inside the OS temp dir. */
function tmp(ext = '.bin') {
  const name = `zynex-${crypto.randomBytes(8).toString('hex')}${ext}`;
  return path.join(os.tmpdir(), name);
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

/**
 * Apply an audio filter and return a Buffer of the result.
 * @param {Buffer} input      source audio
 * @param {string} filter     ffmpeg -af value, e.g. 'bass=g=15'
 * @param {object} opts       { ext, inExt, extra }
 */
async function filterAudio(input, filter, { inExt = '.mp3', ext = '.mp3', extra = [] } = {}) {
  const inFile = tmp(inExt);
  const outFile = tmp(ext);
  fs.writeFileSync(inFile, input);
  const args = ['-y', '-i', inFile, '-af', filter, ...extra, outFile];
  const res = await run(args);
  let out = null;
  try {
    if (res.ok && fs.existsSync(outFile)) out = fs.readFileSync(outFile);
  } finally {
    cleanup(inFile, outFile);
  }
  return { ok: Boolean(out), buffer: out, stderr: res.stderr };
}

/** Generic convert: input buffer + argv (without the output path). */
async function convert(input, args, { inExt = '.bin', outExt = '.bin' } = {}) {
  const inFile = tmp(inExt);
  const outFile = tmp(outExt);
  fs.writeFileSync(inFile, input);
  const full = ['-y', '-i', inFile, ...args, outFile];
  const res = await run(full);
  let out = null;
  try {
    if (res.ok && fs.existsSync(outFile)) out = fs.readFileSync(outFile);
  } finally {
    cleanup(inFile, outFile);
  }
  return { ok: Boolean(out), buffer: out, stderr: res.stderr };
}

/** Speed / tempo change without changing pitch. */
const atempo = (factor) => {
  // atempo accepts 0.5–2.0 per instance, so chain them for extreme values
  const parts = [];
  let f = factor;
  while (f > 2) { parts.push('atempo=2.0'); f /= 2; }
  while (f < 0.5) { parts.push('atempo=0.5'); f /= 0.5; }
  parts.push(`atempo=${f.toFixed(3)}`);
  return parts.join(',');
};

/** Pitch shift expressed in semitones (uses rubberband-free approach). */
const pitchSemitones = (semitones) => {
  const ratio = Math.pow(2, semitones / 12);
  return `asetrate=44100*${ratio.toFixed(4)},aresample=44100,atempo=${(1 / ratio).toFixed(4)}`;
};

module.exports = { available, resolveFfmpeg, run, filterAudio, convert, tmp, cleanup, atempo, pitchSemitones };
