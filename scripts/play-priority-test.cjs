/**
 * .play must try FULL TRACKS before previews.
 *
 * This is a regression guard for a bug that was invisible in tests and obvious
 * in production: a hand-written lib/commands/song.js shadows the downloader
 * engine, and its source chain opened with Deezer/iTunes — the only keyless
 * endpoints that exist, both deliberately capped at 30 seconds. So .play could
 * never return a whole song, while .Soundcloud beside it did, because that name
 * reaches the engine and yt-dlp.
 *
 * Production evidence this test encodes: `.play` logged "sent ... via Deezer
 * (469 KB)" while `.Soundcloud` logged a 2.6 MB file in the same minute.
 *
 * The fix is order, so the test asserts order: yt-dlp is attempted before any
 * preview source, and a successful full-track download never falls through to
 * a preview.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n) => { console.log(`✔ ${n}`); pass++; };
const no = (n, d) => { console.log(`✗ ${n}  ${d || ''}`); fail++; };

const src = fs.readFileSync(path.join(ROOT, 'lib/commands/song.js'), 'utf8');

/* ── 1. the hand-written file is still the one that wins ──────────────────── */
const mod = require(path.join(ROOT, 'lib/commands/song.js'));
if (mod.name === 'play') ok('.play is served by lib/commands/song.js (hand-written files win)');
else no('.play is not served by song.js', mod.name);

/* ── 2. order inside execute: yt-dlp before the preview chain ─────────────── */
const body = src.slice(src.indexOf('async execute('));
const posYtdlp = body.indexOf('ytdlp.downloadAudio');
const posDeezer = body.indexOf('fromDeezer, fromItunes');
const posLoop = body.indexOf('for (const fn of');
if (posYtdlp > -1 && posDeezer > -1 && posYtdlp < posLoop) {
  ok('yt-dlp is attempted before any preview source');
} else {
  no('previews are still tried first', `ytdlp@${posYtdlp} loop@${posLoop}`);
}

/* ── 3. a full track is sent and the function returns ─────────────────────── */
const sendBlock = body.slice(posYtdlp, posLoop);
if (/return;/.test(sendBlock)) ok('a successful full track returns instead of falling through to a preview');
else no('a full track would fall through to a preview');

if (/full track/.test(sendBlock)) ok('the caption names the source as a full track');
else no('the caption does not distinguish a full track from a preview');

/* ── 4. previews still exist as a real fallback ───────────────────────────── */
if (/fromDeezer|fromItunes/.test(src)) ok('Deezer/iTunes remain as an honest fallback');
else no('the preview fallback was deleted outright — a blocked IP would then fail silently');

/* ── 5. a bot gate is explained, not swallowed ────────────────────────────── */
if (/isBotGate/.test(src)) ok('a YouTube bot-gate is reported with a remedy');
else no('a bot gate would be swallowed');

/* ── 6. behaviour: one call, full track, no preview ───────────────────────── */
(async () => {
  const sends = [];
  const ctx = {
    sock: { sendMessage: async (from, c) => { sends.push(c); return {}; } },
    msg: { key: { id: 'T' + Date.now(), remoteJid: 'x' } },
    args: ['All', 'Girls', 'Are', 'The', 'Same'],
    from: 'x',
    reply: async (t) => { sends.push({ text: String(t) }); return {}; },
  };

  const ytdlp = require(path.join(ROOT, 'lib/ytdlp'));
  if (!ytdlp.ytDlpPath()) {
    console.log('… yt-dlp not present here, skipping the behavioural call');
  } else {
    await mod.execute(ctx);
    const audio = sends.find((c) => c.audio);
    if (audio) ok('it sends an audio buffer');
    else no('no audio was sent');

    if (audio && audio.mimetype === 'audio/mpeg') ok('the audio is sent as mp3');
    else no('wrong mimetype', audio && audio.mimetype);

    // A 30-second preview is ~400-500 KB. Anything under 700 KB is a preview.
    if (audio && audio.audio.length > 700 * 1024) {
      ok(`the file is a full track (${(audio.audio.length / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      no(`that is a preview, not a full track (${audio ? (audio.audio.length / 1024).toFixed(0) : 0} KB)`);
    }

    // and it must not ALSO send a preview afterwards
    const previewish = sends.filter((c) => c.text && /preview/i.test(c.text) && !/Fetching|Searching/i.test(c.text));
    if (!previewish.length) ok('no preview message followed a successful full track');
    else no('a preview attempt still ran after the full track', previewish[0].text.slice(0, 80));
  }

  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
