#!/usr/bin/env node
/**
 * Force-refresh the standalone yt-dlp binary.
 *
 * scripts/fetch-ytdlp.cjs (postinstall) deliberately skips a binary that is
 * already present and runnable — correct for a fast install, wrong when
 * YouTube has just broken an old extractor. `postinstall` runs on every
 * deploy but would keep the same month-old build forever.
 *
 *   npm run ytdlp:update
 *
 * Run this whenever `.play` suddenly starts failing on every track.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'vendor', 'yt-dlp');
try {
  fs.rmSync(target, { force: true });
  console.log('[yt-dlp] removed the old binary — fetching the latest release');
} catch (e) {
  console.log(`[yt-dlp] could not remove ${target}: ${e.message}`);
}
require('./fetch-ytdlp.cjs');
