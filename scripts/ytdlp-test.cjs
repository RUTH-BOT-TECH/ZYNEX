#!/usr/bin/env node
/**
 * yt-dlp integration — full-length `.play`.
 *
 * The complaint: ".play works but why can it play only 30 sec".
 *
 * The answer was not a bug. The engine served Deezer's and iTunes' `preview`
 * fields, which are the only keyless endpoints that exist — the full track is
 * copyrighted and deliberately withheld. 30 seconds was the ceiling of that
 * approach, and the `preview: 30` value was a label, not a limit.
 *
 * yt-dlp removes the ceiling: local binary, no API key, no quota. These tests
 * check the wiring and the guard rails; the network-dependent parts are
 * skipped when the binary is unavailable so the suite stays runnable offline.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const yt = require(path.join(ROOT, 'lib', 'ytdlp.js'));

let pass = 0, fail = 0, skip = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) {
    if (e && e.skipped) { console.log(`  ⊘ ${name} — skipped (${e.message})`); skip++; }
    else { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
  }
}

console.log('\n══ binary ══\n');

t('a yt-dlp binary is resolved', () => {
  assert.ok(yt.ytDlpPath(), 'no yt-dlp binary — .play will fall back to 30s previews');
});

t('the binary actually runs', () => {
  const bin = yt.ytDlpPath();
  if (!bin) return;
  const v = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
  assert.ok(/^\d{4}\.\d{2}\.\d{2}/.test(v), `unexpected version string: ${v}`);
});

t('youtube-dl-exec is a declared dependency', () => {
  // node_modules is rebuilt on every deploy; only package.json survives.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['youtube-dl-exec'], 'the binary would vanish on deploy');
});

t('the binary is PROBED, not just found', () => {
  // The youtube-dl-exec launcher starts with #!/usr/bin/env python3 and looks
  // perfectly installed while being unable to run:
  //   env: 'python3': No such file or directory
  // Presence checks passed; only executing it caught that.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp.js'), 'utf8');
  assert.ok(/function probe\(/.test(src), 'no probe — a non-runnable binary would be accepted');
  assert.ok(/--version/.test(src), 'the probe must actually execute the binary');
  assert.ok(/vendor/.test(src), 'the standalone build should be preferred over the python launcher');
});

t('a postinstall step fetches the standalone binary', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.postinstall, 'no postinstall — the 41 MB binary is gitignored and would be missing');
  assert.ok(/fetch-ytdlp/.test(pkg.scripts.postinstall), 'postinstall does not fetch yt-dlp');
});

t('the fetch script cannot break a deploy', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-ytdlp.cjs'), 'utf8');
  // Failure must be logged and survived: a build that dies here leaves the bot
  // undeployable over a missing download.
  assert.ok(/catch/.test(src), 'no error handling — a network blip would fail the build');
  assert.ok(/non-fatal/i.test(src) || /fall back/.test(src), 'the script must state its fallback');
});

t('the 41 MB binary is not committed to git', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/^vendor\/?$/m.test(ignore), 'vendor/ would be added to the repo on every commit');
});

t('ffmpeg is offered to yt-dlp so --extract-audio can work', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp.js'), 'utf8');
  assert.ok(/--ffmpeg-location/.test(src), 'without this yt-dlp fails with "ffprobe not found"');
});

console.log('\n══ query handling ══\n');

t('a bare name becomes a YouTube search', () => {
  assert.strictEqual(yt.queryToTarget('daft punk'), 'ytsearch1:daft punk');
});

t('a direct URL is passed through untouched', () => {
  const u = 'https://www.youtube.com/watch?v=FGBhQbmPwH8';
  assert.strictEqual(yt.queryToTarget(u), u);
});

t('an empty query is rejected before spawning anything', () => {
  assert.throws(() => yt.queryToTarget('   '), /nothing to search/i);
});

t('formats durations readably', () => {
  assert.strictEqual(yt.fmt(321), '5:21');
  assert.strictEqual(yt.fmt(59), '0:59');
});

console.log('\n══ wiring ══\n');

t('.play tries yt-dlp before the preview sources', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/engines/downloader.js'), 'utf8');
  const audio = src.slice(src.indexOf('if (isAudio(command))'));
  const ytPos = audio.indexOf('ytdlp.downloadAudio');
  const deezerPos = audio.indexOf('deezerSearch');
  assert.ok(ytPos > -1, 'yt-dlp is not used at all');
  assert.ok(ytPos < deezerPos, 'the 30s preview is still tried first');
});

t('the preview label admits it is a preview', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/engines/downloader.js'), 'utf8');
  assert.ok(/official preview/.test(src), 'a 30s clip must not be presented as the track');
});

t('video downloads are no longer refused outright', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/engines/downloader.js'), 'utf8');
  assert.ok(!/Video downloads are unavailable right now/.test(src),
    'the old "server-hosted downloads are blocked" reply is still there');
  assert.ok(/downloadVideo/.test(src), 'video path not wired');
});

t('oversized media is refused with a real reason', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/ytdlp.js'), 'utf8');
  assert.ok(/MAX_AUDIO_BYTES/.test(src), 'no audio size cap');
  assert.ok(/MAX_VIDEO_BYTES/.test(src), 'no video size cap');
  assert.ok(/too large to send/.test(src), 'the refusal must explain itself');
});

t('the video quality is capped so WhatsApp will accept it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/ytdlp.js'), 'utf8');
  assert.ok(/height<=\$\{maxHeight\}/.test(src), 'no height cap — a 1080p file often exceeds WhatsApp limits');
  assert.ok(/maxHeight = 480/.test(src), 'default cap should be 480p');
});

t('temporary files are cleaned up even when the download fails', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/ytdlp.js'), 'utf8');
  const finallys = (src.match(/\} finally \{/g) || []).length;
  assert.ok(finallys >= 2, 'a failed download would leave the temp dir on the volume');
});

(async () => {
  console.log('\n══ live (network) ══\n');

  await ta('resolves a real track with a full duration', async () => {
    if (!yt.ytDlpPath()) throw Object.assign(new Error('no binary'), { skipped: true });
    const info = await yt.resolve('daft punk one more time');
    assert.ok(info.title, 'no title returned');
    // The entire point: substantially longer than a 30-second preview.
    assert.ok(info.duration > 60, `duration ${info.duration}s is still preview-length`);
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed${skip ? `, ${skip} skipped` : ''}\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
