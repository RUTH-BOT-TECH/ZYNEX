#!/usr/bin/env node
/**
 * Download the standalone yt-dlp binary into vendor/ at install time.
 *
 * Why this exists
 * ───────────────
 * `youtube-dl-exec` ships a launcher that begins with `#!/usr/bin/env python3`.
 * It installs cleanly, sits at the expected path, is executable — and cannot
 * run in this container:
 *
 *   env: 'python3': No such file or directory
 *
 * Installing python3 is not an option (no root, and the build ignores nixPkgs —
 * proven when the same approach failed for ffmpeg). The standalone build is a
 * self-contained 41 MB ELF executable with no interpreter at all, so that is
 * what we fetch.
 *
 * It runs from `postinstall`, so a fresh `npm install` on any host — Railway,
 * the sandbox, a VPS — produces a working binary without a manual step.
 *
 * Failure is loud but non-fatal: `.play` still works, degrading to the 30-second
 * preview sources, and the log says why.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const VENDOR = path.join(__dirname, '..', 'vendor');
const TARGET = path.join(VENDOR, 'yt-dlp');
const URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

function log(msg) { console.log(`[yt-dlp] ${msg}`); }

/** Follow redirects (GitHub releases go through several). */
function download(url, dest, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'ZYNEX-MD-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, hops + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        fs.renameSync(tmp, dest);
        resolve();
      }));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timed out')));
  });
}

(async () => {
  try {
    // Already present and runnable? Nothing to do.
    if (fs.existsSync(TARGET)) {
      try {
        fs.accessSync(TARGET, fs.constants.X_OK);
        const { execFileSync } = require('child_process');
        const v = execFileSync(TARGET, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
        if (/^\d{4}\.\d{2}\.\d{2}/.test(v)) {
          log(`already present (${v})`);
          return;
        }
      } catch {
        log('present but not runnable — re-fetching');
      }
    }

    fs.mkdirSync(VENDOR, { recursive: true });
    log('downloading the standalone binary…');
    await download(URL, TARGET);
    fs.chmodSync(TARGET, 0o755);

    const { execFileSync } = require('child_process');
    const version = execFileSync(TARGET, ['--version'], { encoding: 'utf8', timeout: 20000 }).trim();
    const size = (fs.statSync(TARGET).size / 1048576).toFixed(0);
    log(`ready: ${version} (${size} MB)`);
  } catch (e) {
    // Loud, but never break the install: the bot must still deploy.
    log(`FAILED to install the binary — ${e.message}`);
    log('`.play` will fall back to 30-second previews until this succeeds');
  }
})();
