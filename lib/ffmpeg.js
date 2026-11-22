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
const { execFileSync } = require('child_process');

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

module.exports = { ffmpegPath, hasFfmpeg };
