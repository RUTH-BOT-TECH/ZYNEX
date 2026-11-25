'use strict';
/**
 * Full-length audio/video resolution via yt-dlp.
 *
 * Why this replaced the preview API: `.play` was serving Deezer's and iTunes'
 * 30-second preview clips, because those are the only keyless endpoints that
 * exist — the full track is copyrighted and deliberately withheld. yt-dlp runs
 * locally, needs no API key, has no quota, and returns real full-length media.
 *
 * ── The 2026 problem: YouTube's bot gate ───────────────────────────────────
 * From a datacentre IP (Railway, Render, Vercel, this sandbox) YouTube answers
 * "Sign in to confirm you're not a bot". That is an IP/trust decision, not a
 * bug in this file. Research + live testing on 2026-11-24 gave this fix order:
 *
 *   1. keep yt-dlp current (postinstall pulls the latest standalone build)
 *   2. give it a JavaScript runtime for EJS challenges (Deno, or Node via
 *      --js-runtimes node) and prefer IPv4 (-4)
 *   3. cookies from a throwaway logged-in session  → YTDLP_COOKIES_B64
 *   4. a PO-token provider                        → YTDLP_POT_PROVIDER_URL
 *   5. a clean/residential IP                    → YTDLP_PROXY
 *
 * BUT 3–5 are all extra infrastructure, and SoundCloud is not bot-gated at
 * all. On the same IP where YouTube refused, `scsearch8:` returned eight
 * results including full 322-second tracks, and a real download produced a
 * 5:22 MP3 with zero cookies. So `.play` now tries YouTube first and falls
 * back to SoundCloud (skipping the 30-second Go+ previews) BEFORE it ever
 * considers a Deezer/iTunes preview.
 *
 * See PLAY.md for the operator's step-by-step.
 *
 * Binary resolution
 * ─────────────────
 * `youtube-dl-exec` ships a 3 MB launcher that downloads the correct yt-dlp
 * binary for the platform at install time (into its own bin/). Because
 * `node_modules` is rebuilt on every deploy, the package must stay a declared
 * dependency — the same lesson as ffmpeg-static. A 41 MB standalone build is
 * preferred because the launcher needs python3.
 *
 * ffmpeg
 * ──────
 * yt-dlp shells out to ffmpeg for `--extract-audio`, so it is told where ours
 * lives (ffmpeg-static). Without that it fails with "ffprobe not found".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** SoundCloud serves 30 s Go+ previews next to real uploads — never pick one. */
const MIN_FULL_TRACK_SEC = 60;
const MAX_FULL_TRACK_SEC = 900;

/**
 * Locate a WORKING yt-dlp binary, or null. Cached: probed on every command.
 *
 * ★ Presence is not enough — the binary has to actually run.
 *
 * The `youtube-dl-exec` package ships a 3 MB launcher that starts with
 * `#!/usr/bin/env python3`. It looks installed, sits at the expected path, is
 * executable, and is useless in a container without python:
 *
 *   env: 'python3': No such file or directory
 *
 * Caught only by running it after deploy. So every candidate is executed once
 * with `--version` and must print a version string before being accepted.
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

/** Is `name` an executable somewhere on PATH? (no shell, no `which` needed) */
function onPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch { /* keep looking */ }
  }
  return false;
}

/**
 * Resolve the cookies file. Three ways in, one `--cookies` flag out:
 *
 *   YTDLP_COOKIES_FILE  path on a mounted volume
 *   YTDLP_COOKIES_B64   base64 of a Netscape cookies.txt (best for env vars)
 *   YTDLP_COOKIES       the raw Netscape text
 *
 * Secret material never reaches a log line, and the temp copy is 0600.
 * Treat this file like a password: it is a logged-in Google session.
 */
let _cookiesFile;
function cookiesFile() {
  if (_cookiesFile !== undefined) return _cookiesFile;
  const explicit = String(process.env.YTDLP_COOKIES_FILE || '').trim();
  if (explicit) {
    if (fs.existsSync(explicit)) { _cookiesFile = explicit; return _cookiesFile; }
    console.log('[YTDLP] YTDLP_COOKIES_FILE points at a missing file — ignoring');
  }
  let raw = '';
  const b64 = String(process.env.YTDLP_COOKIES_B64 || '').trim();
  if (b64) {
    try { raw = Buffer.from(b64, 'base64').toString('utf8'); }
    catch { raw = ''; }
  }
  if (!raw.trim()) raw = String(process.env.YTDLP_COOKIES || '');
  if (!raw.trim()) { _cookiesFile = null; return null; }

  try {
    const p = path.join(os.tmpdir(), `zynex-yt-cookies-${process.pid}.txt`);
    fs.writeFileSync(p, raw, { mode: 0o600 });
    fs.chmodSync(p, 0o600);
    _cookiesFile = p;
    console.log('[YTDLP] cookies loaded from env into a 0600 temp file');
  } catch (e) {
    console.log(`[YTDLP] could not write cookies file: ${e.message}`);
    _cookiesFile = null;
  }
  return _cookiesFile;
}

/**
 * yt-dlp needs an external JS runtime to solve YouTube's EJS challenges.
 * Deno is enabled by default; Node/Bun must be named explicitly. The official
 * standalone binary bundles the solver scripts, so only the engine is needed.
 */
function jsRuntimeArgs() {
  const forced = String(process.env.YTDLP_JS_RUNTIME || '').trim();
  if (/^(0|off|none)$/i.test(forced)) return [];
  if (forced) return ['--js-runtimes', forced];
  if (onPath('deno')) return [];                 // yt-dlp picks it up itself
  if (onPath('bun')) return ['--js-runtimes', 'bun'];
  return ['--js-runtimes', 'node'];             // this IS a Node app
}

/** Every yt-dlp invocation starts with these. All auth knobs are env-driven. */
function baseArgs() {
  const args = ['--no-warnings', '--no-playlist', '--quiet'];
  const ff = ffmpegLocation();
  if (ff) args.push('--ffmpeg-location', ff);

  args.push(...jsRuntimeArgs());
  // YouTube scores IPv6 from cloud hosts poorly; -4 is the safer default.
  if (process.env.YTDLP_FORCE_IPV4 !== '0') args.push('-4');

  const cookies = cookiesFile();
  if (cookies) args.push('--cookies', cookies);

  const proxy = String(process.env.YTDLP_PROXY || '').trim();
  if (proxy) args.push('--proxy', proxy);

  const pot = String(process.env.YTDLP_POT_PROVIDER_URL || '').trim();
  if (pot) args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${pot}`);

  const client = String(process.env.YTDLP_PLAYER_CLIENT || '').trim();
  if (client) args.push('--extractor-args', `youtube:player_client=${client}`);

  const plugins = String(process.env.YTDLP_PLUGIN_DIR || '').trim();
  if (plugins) args.push('--plugin-dirs', plugins);

  const remote = String(process.env.YTDLP_REMOTE_COMPONENTS || '').trim();
  if (remote) args.push('--remote-components', remote);

  const extra = String(process.env.YTDLP_EXTRA_ARGS || '').trim();
  if (extra) args.push(...extra.split(/\s+/));

  return args;
}

/** Which sources `.play` tries, in order. */
function audioSources() {
  const only = String(process.env.YTDLP_AUDIO_SOURCE || '').trim().toLowerCase();
  if (only === 'youtube' || only === 'soundcloud') return [only];
  if (process.env.YTDLP_SOUNDCLOUD_FALLBACK === '0') return ['youtube'];
  return ['youtube', 'soundcloud'];
}

/** Turn a user's text into a search expression for the chosen source. */
function queryToTarget(query, source = 'youtube') {
  const q = String(query || '').trim();
  if (!q) throw new Error('nothing to search for');
  // A direct URL is used as-is.
  if (/^https?:\/\//i.test(q)) return q;
  if (source === 'soundcloud') {
    const n = Number(process.env.YTDLP_SC_RESULTS || 8) || 8;
    return `scsearch${n}:${q}`;
  }
  return `ytsearch1:${q}`;
}

/** Normalise a yt-dlp info dict into the shape downloader.js expects. */
function normalise(info, source) {
  const thumb = info.thumbnail ||
    (Array.isArray(info.thumbnails) && (info.thumbnails[info.thumbnails.length - 1] || {}).url) || '';
  const url = info.webpage_url || info.url ||
    (source === 'youtube' && info.id ? `https://youtu.be/${info.id}` : '');
  return {
    id: info.id,
    title: info.title || 'unknown',
    duration: Number(info.duration) || 0,
    uploader: info.uploader || info.channel || '',
    thumbnail: thumb,
    webpage_url: url,
    url,
    source,
  };
}

/** Pick the first REAL track, not a 30-second Go+ preview or a 3-hour mix. */
function pickFullLengthEntry(entries) {
  return (Array.isArray(entries) ? entries : []).find((e) => {
    const d = Number(e && e.duration) || 0;
    return e && e.webpage_url && d >= MIN_FULL_TRACK_SEC && d <= MAX_FULL_TRACK_SEC;
  }) || null;
}

/** Is this YouTube's bot wall / PO-token refusal (as opposed to a real miss)? */
function isBotGate(text) {
  return /sign in to confirm|not a bot|LOGIN_REQUIRED|PO Token|\b403\b|bot check/i.test(String(text || ''));
}

/** Flatten a child_process error into one readable line (stderr matters!). */
function errText(e) {
  return [e && e.stderr, e && e.message]
    .filter(Boolean).map(String).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve metadata without downloading.
 * Returns { id, title, duration, uploader, thumbnail, webpage_url, url, source }.
 */
async function resolve(query, opts = {}) {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available on this host');
  const source = opts.source || 'youtube';
  const target = queryToTarget(query, source);

  const flags = ['--dump-single-json', '--no-check-formats'];
  if (source === 'soundcloud') flags.push('--flat-playlist');

  const { stdout, stderr } = await execFileAsync(
    bin,
    [...baseArgs(), ...flags, target],
    { maxBuffer: 16 * 1024 * 1024, timeout: 60000 },
  );

  let json;
  try { json = JSON.parse(stdout); }
  catch { throw new Error(String(stderr || 'yt-dlp returned no metadata').trim().slice(0, 300)); }

  // A bot-gated ytsearch returns { entries: [null] } and exits 0. Keep the
  // stderr text in the thrown error so the fallback/user can recognise it.
  const entries = (Array.isArray(json.entries) ? json.entries : [json]).filter(Boolean);
  if (!entries.length) {
    throw new Error(String(stderr || '').trim().slice(0, 300) || 'nothing found for that search');
  }

  if (source === 'soundcloud') {
    // `excludeUrls` lets downloadAudio re-roll a candidate that turned out to
    // be DRM-protected only when the download started. Flat search metadata
    // does not flag those tracks, so they have to be skipped by URL.
    const excluded = new Set(Array.isArray(opts.excludeUrls) ? opts.excludeUrls : []);
    const candidates = entries.filter((e) => !excluded.has(e && e.webpage_url));
    const picked = pickFullLengthEntry(candidates);
    if (!picked) throw new Error('no full-length SoundCloud track found for that search');
    return normalise(picked, 'soundcloud');
  }
  return normalise(entries[0], 'youtube');
}

/**
 * Download audio and return { buffer, info, mimetype }.
 *
 * Tries YouTube, then SoundCloud, then gives up. Converted to MP3 at a modest
 * bitrate: good enough for a chat, and a third of the size of best quality.
 */
async function downloadAudio(query, { durationLimitSec = 0 } = {}) {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available on this host');

  const failures = [];
  for (const source of audioSources()) {
    /**
     * SoundCloud's flat search happily lists tracks that yt-dlp refuses at
     * download time with "This video is DRM protected". There is no metadata
     * flag for it, so the only reliable move is to skip that URL and try the
     * next full-length result. Without this, a DRM-protected #1 result made
     * `.play` fall all the way back to a 30-second Deezer preview.
     */
    const maxAttempts = source === 'soundcloud' ? 4 : 1;
    const tried = new Set();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let info;
      try {
        info = await resolve(query, { source, excludeUrls: [...tried] });
      } catch (e) {
        failures.push(`${source}: ${errText(e).slice(0, 180)}`);
        break;
      }
      if (durationLimitSec && info.duration > durationLimitSec) {
        failures.push(`${source}: that track is ${fmt(info.duration)} long; the limit here is ${fmt(durationLimitSec)}`);
        break;
      }

      // Download the EXACT result we resolved — re-running a search expression
      // can pick a different (30-second) entry on the second pass.
      const target = info.webpage_url || queryToTarget(query, source);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-yt-'));
      const template = path.join(dir, 'audio.%(ext)s');
      let reason = '';
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
      } catch (e) {
        reason = errText(e);
        failures.push(`${source} download: ${reason.slice(0, 180)}`);
      } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
      }

      // Re-roll only for DRM. A format/network/geo error will hit the next
      // candidate too, so move on to the other source instead of retrying.
      if (source === 'soundcloud' && /DRM protected/i.test(reason) && info.webpage_url) {
        tried.add(info.webpage_url);
        continue;
      }
      break;
    }
  }

  const all = failures.join(' | ');
  const hasAuth = process.env.YTDLP_COOKIES_B64 || process.env.YTDLP_COOKIES_FILE || process.env.YTDLP_COOKIES;
  if (isBotGate(all) && !hasAuth) {
    throw new Error(
      `YouTube blocked this server's IP (${all.slice(0, 130)}). ` +
        'Set YTDLP_COOKIES_B64 for YouTube-only tracks — see PLAY.md',
    );
  }
  throw new Error(all.slice(0, 400) || 'no full-length source found');
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
        info.webpage_url || target,
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

module.exports = {
  ytDlpPath,
  resolve,
  downloadAudio,
  downloadVideo,
  queryToTarget,
  fmt,
  isBotGate,
  _internals: {
    baseArgs,
    cookiesFile,
    jsRuntimeArgs,
    audioSources,
    pickFullLengthEntry,
    normalise,
    errText,
    resetConfig: () => { _cookiesFile = undefined; },
    MIN_FULL_TRACK_SEC,
  },
};
