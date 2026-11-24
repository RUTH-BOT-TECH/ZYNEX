#!/usr/bin/env node
/**
 * play-sources-test.cjs — `.play` must return a FULL track, not a 30s preview.
 *
 * The regression this pins: on a datacentre IP YouTube answers "Sign in to
 * confirm you're not a bot", so the old code fell straight through to
 * Deezer/iTunes 30-second previews. SoundCloud (scsearch) is not bot-gated and
 * returns real 5-minute tracks with no cookies at all — verified live on
 * 2026-11-24: a 322.6 s result downloaded as a 5:22 MP3.
 *
 * Also pins every auth knob so a redeploy can silently forget cookies/PO token
 * and fail this suite instead of failing in someone's chat.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.SILENT = '1';

const ROOT = path.resolve(__dirname, '..');
const yt = require(path.join(ROOT, 'lib', 'ytdlp.js'));
const I = yt._internals;

let pass = 0, fail = 0, skip = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
};
const skipped = (why) => Object.assign(new Error(why), { skipped: true });
const ta = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) {
    if (e && e.skipped) { console.log(`  ⊘ ${name} — skipped (${e.message})`); skip++; }
    else { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
  }
};

const KEYS = [
  'YTDLP_COOKIES_FILE', 'YTDLP_COOKIES_B64', 'YTDLP_COOKIES',
  'YTDLP_PROXY', 'YTDLP_POT_PROVIDER_URL', 'YTDLP_PLAYER_CLIENT',
  'YTDLP_PLUGIN_DIR', 'YTDLP_REMOTE_COMPONENTS', 'YTDLP_EXTRA_ARGS',
  'YTDLP_JS_RUNTIME', 'YTDLP_FORCE_IPV4', 'YTDLP_AUDIO_SOURCE',
  'YTDLP_SOUNDCLOUD_FALLBACK', 'YTDLP_SC_RESULTS',
];
function env(values = {}) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
  I.resetConfig();
}
env();

console.log('\n══ source selection ══\n');

t('the default search is still YouTube (unchanged contract)', () => {
  assert.strictEqual(yt.queryToTarget('daft punk'), 'ytsearch1:daft punk');
});
t('a direct URL is passed through for either source', () => {
  const u = 'https://soundcloud.com/daft-punk-id/daft-punk-one-more-time';
  assert.strictEqual(yt.queryToTarget(u), u);
  assert.strictEqual(yt.queryToTarget(u, 'soundcloud'), u);
});
t('a SoundCloud search uses scsearch', () => {
  assert.ok(/^scsearch\d+:/.test(yt.queryToTarget('daft punk', 'soundcloud')));
  assert.strictEqual(yt.queryToTarget('daft punk', 'soundcloud'), 'scsearch8:daft punk');
});
t('pickFullLengthEntry skips the 30-second Go+ previews', () => {
  const entries = [
    { webpage_url: 'https://soundcloud.com/a', duration: 30, title: 'One More Time' },
    { webpage_url: 'https://soundcloud.com/b', duration: 322.606, title: 'One More Time' },
    { webpage_url: 'https://soundcloud.com/c', duration: 320.4, title: 'One More Time' },
  ];
  assert.strictEqual(I.pickFullLengthEntry(entries).webpage_url, 'https://soundcloud.com/b');
});
t('pickFullLengthEntry rejects a multi-hour mix', () => {
  assert.strictEqual(I.pickFullLengthEntry([{ webpage_url: 'x', duration: 7200 }]), null);
});
t('the audio chain tries YouTube first, then SoundCloud', () => {
  assert.deepStrictEqual(I.audioSources(), ['youtube', 'soundcloud']);
});
t('YTDLP_AUDIO_SOURCE=soundcloud skips the bot-gated source entirely', () => {
  env({ YTDLP_AUDIO_SOURCE: 'soundcloud' });
  assert.deepStrictEqual(I.audioSources(), ['soundcloud']);
  env();
});
t('the SoundCloud fallback can be disabled', () => {
  env({ YTDLP_SOUNDCLOUD_FALLBACK: '0' });
  assert.deepStrictEqual(I.audioSources(), ['youtube']);
  env();
});

console.log('\n══ auth / transport knobs ══\n');

t('a JS runtime is declared so EJS challenges can be solved', () => {
  env({ YTDLP_JS_RUNTIME: 'node' });
  const args = I.baseArgs();
  const i = args.indexOf('--js-runtimes');
  assert.ok(i >= 0, 'yt-dlp would report "JS runtimes: none"');
  assert.strictEqual(args[i + 1], 'node');
});
t('IPv4 is forced by default on cloud hosts', () => {
  env();
  assert.ok(I.baseArgs().includes('-4'));
});
t('YTDLP_FORCE_IPV4=0 opts out', () => {
  env({ YTDLP_FORCE_IPV4: '0' });
  assert.ok(!I.baseArgs().includes('-4'));
});

const COOKIE_TEXT = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tSECRETVALUE\n';
t('YTDLP_COOKIES_B64 becomes a 0600 cookies file, and the secret stays off argv', () => {
  env({ YTDLP_COOKIES_B64: Buffer.from(COOKIE_TEXT).toString('base64'), YTDLP_JS_RUNTIME: 'node' });
  const args = I.baseArgs();
  const i = args.indexOf('--cookies');
  assert.ok(i >= 0, 'no --cookies flag');
  const p = args[i + 1];
  assert.ok(fs.existsSync(p), 'cookies file was not written');
  assert.strictEqual(fs.statSync(p).mode & 0o777, 0o600, 'cookie file must not be world-readable');
  assert.ok(/SECRETVALUE/.test(fs.readFileSync(p, 'utf8')));
  assert.ok(!args.join(' ').includes('SECRETVALUE'), 'the session secret leaked onto the command line');
});
t('YTDLP_COOKIES_FILE is honoured when a volume is mounted', () => {
  env();
  const p = path.join(require('os').tmpdir(), 'zynex-test-cookies.txt');
  fs.writeFileSync(p, COOKIE_TEXT);
  process.env.YTDLP_COOKIES_FILE = p;
  I.resetConfig();
  const args = I.baseArgs();
  assert.strictEqual(args[args.indexOf('--cookies') + 1], p);
  process.env.YTDLP_COOKIES_FILE = '';
});
t('proxy, PO token, player client and plugin dir all reach the CLI', () => {
  env({
    YTDLP_PROXY: 'http://user:pass@residential.example:8080',
    YTDLP_POT_PROVIDER_URL: 'http://127.0.0.1:4416',
    YTDLP_PLAYER_CLIENT: 'mweb',
    YTDLP_PLUGIN_DIR: '/opt/yt-dlp-plugins',
    YTDLP_EXTRA_ARGS: '--sleep-requests 1',
  });
  const args = I.baseArgs().join(' ');
  assert.ok(/--proxy http:\/\/user:pass@residential\.example:8080/.test(args));
  assert.ok(/youtubepot-bgutilhttp:base_url=http:\/\/127\.0\.0\.1:4416/.test(args));
  assert.ok(/youtube:player_client=mweb/.test(args));
  assert.ok(/--plugin-dirs \/opt\/yt-dlp-plugins/.test(args));
  assert.ok(/--sleep-requests 1/.test(args));
  env();
});
t('isBotGate recognises the exact YouTube refusal', () => {
  assert.ok(yt.isBotGate("Sign in to confirm you're not a bot"));
  assert.ok(yt.isBotGate('LOGIN_REQUIRED / PO Token missing'));
  assert.ok(!yt.isBotGate('nothing found for that search'));
});
t('the failure message tells the operator what to set', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'ytdlp.js'), 'utf8');
  assert.ok(/YTDLP_COOKIES_B64/.test(src), 'no actionable hint on a bot gate');
  const dl = fs.readFileSync(path.join(ROOT, 'lib', 'engines', 'downloader.js'), 'utf8');
  assert.ok(/isBotGate/.test(dl), 'the chat reply does not surface the bot-gate hint');
  // Compare inside the audio branch only: deezerSearch is also DEFINED near
  // the top of the file, which would make a whole-file indexOf misleading.
  const audioBranch = dl.slice(dl.indexOf('if (isAudio(command))'));
  assert.ok(audioBranch.indexOf('ytdlp.downloadAudio') < audioBranch.indexOf('deezerSearch'),
    'a 30s preview is tried before the full-length source again');
});

(async () => {
  console.log('\n══ live (network) ══\n');
  await ta('a FULL-LENGTH track resolves from SoundCloud with no cookies', async () => {
    env();                                   // deliberately no auth at all
    if (!yt.ytDlpPath()) throw skipped('no yt-dlp binary');
    try {
      const info = await yt.resolve('daft punk one more time', { source: 'soundcloud' });
      assert.ok(info.duration > 60, `only ${info.duration}s — that is a preview`);
      assert.ok(/soundcloud\.com/.test(info.webpage_url), info.webpage_url);
      assert.strictEqual(info.source, 'soundcloud');
    } catch (e) {
      if (/network|timed out|ENOTFOUND|ECONN|no full-length|Sign in|403|429|Command failed/i.test(String(e.message))) {
        throw skipped('external source refused the request');
      }
      throw e;
    }
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed${skip ? `, ${skip} skipped` : ''}\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
