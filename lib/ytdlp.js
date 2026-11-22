'use strict';
/**
 * YouTube audio/video resolution via yt-dlp.
 *
 * Why this replaced the preview API: `.play` was serving Deezer's and iTunes'
 * 30-second preview clips, because those are the only keyless endpoints that
 * exist — the full track is copyrighted and deliberately withheld. The result
 * looked like a bug ("why can it play only 30 sec") but was simply the ceiling
 * of that approach.
 *
 * yt-dlp runs locally, needs no API key, has no quota, and returns real
 * full-length media.
 *
 * Binary resolution
 * ─────────────────
 * `youtube-dl-exec` ships a 3 MB launcher that downloads the correct yt-dlp
 * binary for the platform at install time (into its own bin/). Because
 * `node_modules` is rebuilt on every deploy, the package must stay a declared
 * dependency — the same lesson as ffmpeg-static, where the build ignored
 * `nixPkgs` and only the npm package survived.
 *
 * ffmpeg
 * ──────
 * yt-dlp shells out to ffmpeg for `--extract-audio`, so it is told where ours
 * lives (ffmpeg-static). Without that it fails with "ffprobe not found", which
 * is a confusing error for a user to receive.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * Locate a WORKING yt-dlp binary, or null. Cached: probed on every command.
 *
 * ★ Presence is not enough — the binary has to actually run.
 *
 * The `youtube-dl-exec` package ships a 3 MB launcher that starts with
 * `#!/usr/bin/env python3`. It looks installed, sits at the expected path, is
 * executable, and is useless in this container:
 *
 *   env: 'python3': No such file or directory
 *
 * Caught only by running it after deploy. So every candidate is now executed
 * once with `--version` and must print a version string before being accepted;
 * a 40 MB standalone build is preferred, and the launcher is kept only as a
 * last resort for hosts that do have python.
 */
const STANDALONE = path.join(__dirname, '..', 'vendor', 'yt-dlp');
const LAUNCHER = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp');

let _bin;
function probe(candidate) {
  try {
    if (!fs.existsSync(candidate)) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    const out = require('child_process').execFileSync(candidate, ['--version'], {
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /^\d{4}\.\d{2}\.\d{2}/.test(String(out).trim());
  } catch {
    return false;
  }
}

function ytDlpPath() {
  if (_bin !== undefined) return _bin;
  for (const c of [STANDALONE, LAUNCHER]) {
    if (probe(c)) {
      _bin = c;
      console.log(`[YTDLP] using ${c}`);
      return _bin;
    }
    if (fs.existsSync(c)) console.log(`[YTDLP] ${c} exists but will not run (python? wrong arch?)`);
  }
  _bin = null;
  console.log('[YTDLP] no working binary — .play will fall back to 30s previews');
  return _bin;
}

function ffmpegLocation() {
  try {
    const p = require('./ffmpeg').ffmpegPath();
    // yt-dlp wants the directory containing ffmpeg, or the binary itself.
    return p || null;
  } catch {
    return null;
  }
}

function baseArgs() {
  const args = ['--no-warnings', '--no-playlist', '--quiet'];
  const ff = ffmpegLocation();
  if (ff) args.push('--ffmpeg-location', ff);
  return args;
}

/** Turn a user's text into the best available search expression. */
function queryToTarget(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('nothing to search for');
  // A direct URL is used as-is; anything else becomes a YouTube search.
  if (/^https?:\/\//i.test(q)) return q;
  return `ytsearch1:${q}`;
}

/**
 * Resolve metadata without downloading.
 * Returns { id, title, duration, uploader, thumbnail, webpage_url }.
 */
async function resolve(query) {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available on this host');
  const target = queryToTarget(query);

  const { stdout } = await execFileAsync(
    bin,
    [
      ...baseArgs(),
      '--dump-single-json',
      '--no-check-formats',
      target,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 60000 },
  );

  const json = JSON.parse(stdout);
  // ytsearch returns a playlist-shaped object with one entry.
  const info = json.entries ? json.entries[0] : json;
  if (!info) throw new Error('nothing found for that search');

  return {
    id: info.id,
    title: info.title || 'unknown',
    duration: Number(info.duration) || 0,
    uploader: info.uploader || info.channel || '',
    thumbnail: info.thumbnail || '',
    webpage_url: info.webpage_url || `https://youtu.be/${info.id}`,
    url: info.webpage_url || `https://youtu.be/${info.id}`,
  };
}

/**
 * Download audio and return { buffer, info, mimetype }.
 *
 * Converted to MP3 at a modest bitrate: good enough for a chat, and a third of
 * the size of best-quality, which matters because Railway bills egress.
 */
async function downloadAudio(query, { durationLimitSec = 0 } = {}) {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available on this host');
  const target = queryToTarget(query);

  const info = await resolve(query);
  if (durationLimitSec && info.duration > durationLimitSec) {
    throw new Error(
      `that track is ${fmt(info.duration)} long; the limit here is ${fmt(durationLimitSec)}`,
    );
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-yt-'));
  const template = path.join(dir, 'audio.%(ext)s');
  try {
    await execFileAsync(
      bin,
      [
        ...baseArgs(),
        '-f', 'bestaudio/best',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '5',
        '-o', template,
        target,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 180000 },
    );

    const file = fs.readdirSync(dir).find((f) => f.startsWith('audio.'));
    if (!file) throw new Error('yt-dlp produced no audio file');
    const full = path.join(dir, file);
    const size = fs.statSync(full).size;
    if (size > MAX_AUDIO_BYTES) throw new Error(`audio is ${Math.round(size / 1048576)} MB, too large to send`);
    return { buffer: fs.readFileSync(full), info, mimetype: 'audio/mpeg', bytes: size };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Download video and return { buffer, info, mimetype }.
 *
 * Capped at 480p by default: a 1080p file is often 50–100 MB, and WhatsApp
 * refuses large videos anyway. The cap is a delivery decision, not a quality
 * statement, and the reply says which quality was sent.
 */
async function downloadVideo(query, { maxHeight = 480, durationLimitSec = 0 } = {}) {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available on this host');
  const target = queryToTarget(query);

  const info = await resolve(query);
  if (durationLimitSec && info.duration > durationLimitSec) {
    throw new Error(
      `that video is ${fmt(info.duration)} long; the limit here is ${fmt(durationLimitSec)}`,
    );
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-ytv-'));
  const template = path.join(dir, 'video.%(ext)s');
  try {
    await execFileAsync(
      bin,
      [
        ...baseArgs(),
        '-f', `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]/best`,
        '--merge-output-format', 'mp4',
        '-o', template,
        target,
      ],
      { maxBuffer: 8 * 1024 * 1024, timeout: 300000 },
    );

    const file = fs.readdirSync(dir).find((f) => f.startsWith('video.'));
    if (!file) throw new Error('yt-dlp produced no video file');
    const full = path.join(dir, file);
    const size = fs.statSync(full).size;
    if (size > MAX_VIDEO_BYTES) throw new Error(`video is ${Math.round(size / 1048576)} MB, too large to send`);
    return { buffer: fs.readFileSync(full), info, mimetype: 'video/mp4', bytes: size };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

const fmt = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

module.exports = { ytDlpPath, resolve, downloadAudio, downloadVideo, queryToTarget, fmt };
