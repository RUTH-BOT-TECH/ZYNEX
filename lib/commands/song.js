/**
 * .play / .song <name> or <url> — Find and send a song
 *
 * Reality check (why this file looks the way it does):
 *   • paxsenix / cobalt / ytdl-core / Invidious all stopped working for
 *     server-hosted bots in 2026 (404s, key-gating, or YouTube's
 *     "sign in to confirm you're not a bot" block on datacenter IPs).
 *   • Deezer's public API is keyless, official, and still serves audio.
 *
 * So the source chain is:
 *   1. yt-dlp       → FULL track, YouTube then SoundCloud  (primary)
 *   2. Deezer       → ~30s official preview + cover art    (fallback only)
 *   3. iTunes       → ~30s preview                         (last resort)
 *
 * ★ Order matters and used to be wrong: previews came first, so .play could
 * never return a whole song even though the downloader beside it could.
 *
 * Usage:
 *   .play Faded
 *   .play Alan Walker Faded
 *   .play https://www.youtube.com/watch?v=60ItHLz5WEA
 *
 * Aliases: .music, .song, .audio, .ytaudio, .play
 */
const axios = require('axios');
const { createFakeContact } = require('../createFakeContact');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

/* Pull a searchable title out of a URL, or return the query as-is */
async function resolveQuery(input) {
  if (!/^https?:\/\//i.test(input)) return input;

  // Try oEmbed first — cheap and doesn't hit YouTube's bot wall
  try {
    const r = await axios.get('https://www.youtube.com/oembed', {
      params: { url: input, format: 'json' },
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    if (r.data?.title) return r.data.title;
  } catch { /* fall through */ }

  return input;
}

/* ── Source 1: Deezer (keyless API, official previews) ── */
async function fromDeezer(query) {
  const r = await axios.get('https://api.deezer.com/search', {
    params: { q: query, limit: 1 },
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });
  const t = r.data?.data?.[0];
  if (!t?.preview) return null;
  return {
    source: 'Deezer',
    title: t.title,
    artist: t.artist?.name,
    album: t.album?.title,
    duration: t.duration,
    previewSeconds: 30,
    url: t.preview,
    artwork: t.album?.cover_big || t.album?.cover_medium || null,
    link: t.link,
  };
}

/* ── Source 2: iTunes (backup) ── */
async function fromItunes(query) {
  const r = await axios.get('https://itunes.apple.com/search', {
    params: { term: query, media: 'music', limit: 1, country: 'NG' },
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });
  const t = r.data?.results?.[0];
  if (!t?.previewUrl) return null;
  return {
    source: 'iTunes',
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName,
    duration: Math.round((t.trackTimeMillis || 0) / 1000),
    previewSeconds: 30,
    url: t.previewUrl,
    artwork: (t.artworkUrl100 || '').replace('100x100', '600x600') || null,
    link: t.trackViewUrl,
  };
}

/* ── Source 3: Cobalt, only if a self-hosted instance is configured ── */
async function fromCobalt(input) {
  const base = process.env.COBALT_API_URL;
  if (!base) return null;
  const r = await axios.post(
    base.replace(/\/$/, ''),
    { url: input, downloadMode: 'audio', audioFormat: 'mp3' },
    { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, timeout: 25000 },
  );
  if (!r.data?.url) return null;
  return {
    source: 'Cobalt',
    title: input,
    artist: null,
    album: null,
    duration: 0,
    previewSeconds: null,
    url: r.data.url,
    artwork: null,
    link: input,
  };
}

const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'unknown');

module.exports = {
  name: 'play',
  aliases: ['song', 'music', 'audio', 'ytaudio', 'playaudio'],
  desc: 'Search and send a song',
  category: 'media',

  async execute({ sock, msg, args, from, reply }) {
    const input = args.join(' ').trim();
    if (!input) {
      return reply(
        '❌ *Usage*\n' +
          '`.play Faded`\n' +
          '`.play Alan Walker Faded`\n' +
          '`.play <youtube or soundcloud link>`',
      );
    }

    /*
     * ★ FULL TRACKS FIRST. This is the fix.
     *
     * This file used to open with the preview chain below, which meant .play
     * ALWAYS returned 30 seconds — Deezer's `preview` field and iTunes'
     * `previewUrl` are the only keyless endpoints that exist, and both are
     * deliberately truncated. .Soundcloud returned full tracks because it
     * reaches the downloader ENGINE, which tries yt-dlp; .play never got there
     * because a hand-written file shadows an engine of the same name and this
     * one only knew previews.
     *
     * Production evidence: `.play` logged `sent ... via Deezer (469 KB)` while
     * `.Soundcloud` logged `[YTDLP] using /app/vendor/yt-dlp` and a 2.6 MB
     * file. Same bot, same minute, different code path.
     *
     * So yt-dlp is now the first source here too. Previews remain below as a
     * genuine fallback — if every full-track source is blocked, a 30-second
     * clip beats silence, but it is never the first answer.
     */
    const ytdlp = require('../ytdlp');

    if (ytdlp.ytDlpPath()) {
      try {
        await reply(`🔍 *Searching:* ${input}`);
        const { buffer, info, bytes } = await ytdlp.downloadAudio(input);

        const caption =
          `🎵 *${info.title}*` +
          (info.uploader ? `\n🎤 ${info.uploader}` : '') +
          (info.duration ? `\n⏱️ ${fmtDur(info.duration)}` : '') +
          `\n💾 ${(bytes / 1024 / 1024).toFixed(2)} MB · via ` +
          `${info.source === 'soundcloud' ? 'SoundCloud' : 'YouTube'} (full track)` +
          (info.webpage_url ? `\n🔗 ${info.webpage_url}` : '');

        if (info.thumbnail) {
          try {
            await sock.sendMessage(from, { image: { url: info.thumbnail }, caption }, { quoted: msg });
          } catch {
            await reply(caption);
          }
        } else {
          await reply(caption);
        }

        await sock.sendMessage(
          from,
          {
            audio: buffer,
            mimetype: 'audio/mpeg',
            fileName: `${info.title}.mp3`.replace(/[\\/:*?"<>|]/g, '_'),
          },
          { quoted: msg },
        );
        console.log(`[PLAY] full track "${info.title}" via ${info.source} (${(bytes / 1024).toFixed(0)} KB)`);
        return;
      } catch (e) {
        const reason = String(e.message || e).slice(0, 300);
        console.log(`[PLAY] full-track sources failed: ${reason}`);
        const hint = ytdlp.isBotGate(reason)
          ? '\n_YouTube blocked this server IP — set `YTDLP_COOKIES_B64` for YouTube-only tracks._'
          : '';
        await reply(`⚠️ Full track unavailable${hint}\n_Trying a 30-second preview…_`);
      }
    } else {
      console.log('[PLAY] yt-dlp unavailable — the only sources left are 30s previews');
      await reply('🔍 *Searching:* ' + input);
    }

    const query = await resolveQuery(input);

    // Try each source in order, first hit wins
    let track = null;
    const errors = [];
    for (const fn of [fromDeezer, fromItunes]) {
      try {
        track = await fn(query);
        if (track) break;
      } catch (e) {
        errors.push(`${fn.name}: ${e.message}`);
      }
    }
    if (!track) {
      try {
        track = await fromCobalt(input);
      } catch (e) {
        errors.push(`fromCobalt: ${e.message}`);
      }
    }

    if (!track) {
      console.warn('[PLAY] all sources failed:', errors.join(' | '));
      return reply(
        `❌ *No song found for:* ${input}\n\n` +
          `> Try a different spelling, or "Artist - Title".`,
      );
    }

    // Download the audio
    let audio;
    try {
      const res = await axios.get(track.url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 20 * 1024 * 1024,
        headers: { 'User-Agent': UA },
      });
      audio = Buffer.from(res.data);
    } catch (e) {
      console.warn('[PLAY] download failed:', e.message);
      return reply(`❌ Found *${track.title}* but the download failed. Try again.`);
    }

    const caption =
      `🎵 *${track.title}*` +
      (track.artist ? `\n🎤 *${track.artist}*` : '') +
      (track.album ? `\n💿 ${track.album}` : '') +
      (track.duration ? `\n⏱️ ${fmtDur(track.duration)}` : '') +
      `\n💾 ${(audio.length / 1024 / 1024).toFixed(2)} MB · via ${track.source}` +
      (track.previewSeconds ? `\n\n_${track.previewSeconds}s official preview_` : '') +
      (track.link ? `\n🔗 ${track.link}` : '');

    // Send with cover art when we have it, plain audio otherwise
    const quoted = createFakeContact(msg);
    try {
      if (track.artwork) {
        // Send cover + caption as a document-ish card, then the audio
        await sock.sendMessage(
          from,
          { image: { url: track.artwork }, caption },
          { quoted },
        );
        await sock.sendMessage(from, {
          audio,
          mimetype: 'audio/mpeg',
          fileName: `${track.title} - ${track.artist || track.source}.mp3`,
        }, { quoted });
      } else {
        await sock.sendMessage(from, {
          audio,
          mimetype: 'audio/mpeg',
          fileName: `${track.title}.mp3`,
          caption,
        }, { quoted });
      }
    } catch (e) {
      console.warn('[PLAY] send failed:', e.message);
      return reply(`❌ Could not send audio: ${e.message}`);
    }

    console.log(`[PLAY] sent "${track.title}" via ${track.source} (${(audio.length / 1024).toFixed(0)} KB)`);
  },
};
