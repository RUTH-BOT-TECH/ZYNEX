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
 *   1. Deezer       → ~30s official preview + cover art  (works reliably)
 *   2. iTunes       → ~30s preview                        (backup)
 *   3. Cobalt       → full audio IF an operator key is configured via COBALT_API_URL
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
          '`.play <youtube link>`',
      );
    }

    await reply(`🔍 *Searching:* ${input}`);

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
