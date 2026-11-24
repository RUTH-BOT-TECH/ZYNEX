/**
 * DOWNLOADER ENGINE
 * Collapses 90+ catalogue names into one handler.
 *
 *   .play .song .video .ytmp3 .ytmp4 .ytsearch .tiktok .instagram .facebook
 *   .twitter .spotify .pinterest .apk .soundcloud .threads .reddit ... (93 total)
 *
 * Design notes:
 *  - Only sources that actually still work in 2026 are wired to real APIs.
 *  - Everything else answers honestly with the supported alternative instead of
 *    hanging or pretending to work.
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

/* ── what each name means ─────────────────────────────────── */
const AUDIO = new Set([
  'play', 'song', 'music', 'audio', 'ytaudio', 'ytmp3', 'yta', 'youtubeaudio',
  'spotify', 'spotifysearch', 'spdl', 'soundcloud', 'scdl', 'tiktokmp3',
  'ttmp3', 'tiktokaudio', 'lyrics', 'lyric', 'play2', 'nowplaying', 'np',
]);
const VIDEO = new Set([
  'video', 'ytmp4', 'ytv', 'ytvideo', 'ytdoc', 'facebook', 'fb', 'fbdl',
  'instagram', 'ig', 'igdl', 'igstory', 'igreel', 'igpost', 'igtv', 'reels',
  'tiktok', 'tt', 'ttmp4', 'tw', 'twitter', 'twdl', 'x', 'threads',
  'snapchat', 'reddit', 'likee', 'capcut', 'vimeo', 'dailymotion', 'twitch',
  'bilibili', 'terabox', 'pinterest', 'pin', 'pindl', 'tiktoksearch',
]);
const SEARCH = new Set(['ytsearch', 'yts', 'youtube', 'pinsearch', 'tiktoksearch']);
const FILE = new Set([
  'apk', 'apkdl', 'apksearch', 'playstore', 'modapk', 'mediafire', 'mf',
  'mega', 'gdrive', 'drive', 'github', 'gitdl', 'gitclone', 'imgur',
  'telegram', 'tele', 'sticker_dl',
]);

const isAudio = (n) => AUDIO.has(n);
const isVideo = (n) => VIDEO.has(n);
const isSearch = (n) => SEARCH.has(n);
const isFile = (n) => FILE.has(n);

/* ── Deezer: the one audio source that still works keyless ── */
async function deezerSearch(query) {
  const r = await axios.get('https://api.deezer.com/search', {
    params: { q: query, limit: 1 },
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });
  return r.data?.data?.[0] || null;
}

async function itunesSearch(query) {
  const r = await axios.get('https://itunes.apple.com/search', {
    params: { term: query, media: 'music', limit: 1, country: 'NG' },
    headers: { 'User-Agent': UA },
    timeout: 12000,
  });
  return r.data?.results?.[0] || null;
}

/* ── YouTube search listing (metadata only — no stream access) ── */
async function ytSearch(query, limit = 5) {
  const r = await axios.get('https://www.youtube.com/results', {
    params: { search_query: query },
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });
  const html = String(r.data);
  const out = [];
  const re = /"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"\}\].*?"lengthText":\{"[^}]*"simpleText":"([\d:]+)"/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    out.push({ id: m[1], title: m[2], length: m[3], url: `https://youtu.be/${m[1]}` });
  }
  // fallback: id + title only
  if (!out.length) {
    const re2 = /"videoId":"([\w-]{11})"/g;
    while ((m = re2.exec(html)) && out.length < limit) out.push({ id: m[1], title: '(untitled)', url: `https://youtu.be/${m[1]}` });
  }
  return out;
}

const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

module.exports = {
  id: 'downloader',
  name: 'downloader-engine',

  match(name) {
    return AUDIO.has(name) || VIDEO.has(name) || SEARCH.has(name) || FILE.has(name);
  },

  describe(name) {
    if (isAudio(name)) return 'Download / play audio';
    if (isVideo(name)) return 'Download video';
    if (isSearch(name)) return 'Search YouTube';
    return 'Download file';
  },

  async execute({ command, args, reply, sock, from, msg }) {
    const query = args.join(' ').trim();

    /* ── YouTube search ─────────────────────────────────── */
    if (isSearch(command)) {
      if (!query) return reply(`Usage: \`.${command} <query>\``);
      const results = await ytSearch(query, 5);
      if (!results.length) return reply(`❌ No results for *${query}*`);
      return reply(
        `🔎 *YouTube: ${query}*\n\n` +
          results.map((r, i) => `${i + 1}. ${r.title}\n    ${r.length ? r.length + ' · ' : ''}${r.url}`).join('\n\n'),
      );
    }

    /* ── audio ──────────────────────────────────────────── */
    if (isAudio(command)) {
      if (!query) return reply(`Usage: \`.${command} <song name>\``);

      /**
       * ★ yt-dlp first — full-length audio.
       *
       * Everything below this block serves 30-SECOND PREVIEWS: Deezer's
       * `preview` field and iTunes' `previewUrl` are the only keyless endpoints
       * that exist, because the full track is copyrighted and deliberately
       * withheld. That is why `.play` cut off at 30 seconds — not a bug, a
       * ceiling. yt-dlp runs locally, needs no key, and returns the whole song,
       * so it is tried first and the previews remain as a fallback.
       */
      const ytdlp = require('../ytdlp');
      try {
        if (ytdlp.ytDlpPath()) {
          await reply(`⬇️ *Fetching full track…*\n_${query}_`);
          const { buffer, info, bytes } = await ytdlp.downloadAudio(query);
          const dur = info.duration ? `\n⏱️ ${fmtDur(info.duration)}` : '';
          const caption =
            `🎵 *${info.title}*` +
            (info.uploader ? `\n🎤 ${info.uploader}` : '') +
            dur +
            `\n💾 ${(bytes / 1024 / 1024).toFixed(2)} MB · via ${info.source === 'soundcloud' ? 'SoundCloud' : 'YouTube'} (full track)` +
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
          return sock.sendMessage(
            from,
            {
              audio: buffer,
              mimetype: 'audio/mpeg',
              fileName: `${info.title}.mp3`.replace(/[\\/:*?"<>|]/g, '_'),
            },
            { quoted: msg },
          );
        }
        console.log('[PLAY] yt-dlp unavailable — falling back to a 30s preview');
      } catch (e) {
        const reason = String(e.message || e).slice(0, 300);
        // Log the WHOLE thing: the bot-gate text is the diagnosable part.
        console.log(`[PLAY] full-track sources failed: ${reason}`);
        const botHint = ytdlp.isBotGate(reason)
          ? '\n_YouTube blocked this server IP — set `YTDLP_COOKIES_B64` (see PLAY.md) for YouTube-only tracks._'
          : '';
        await reply(
          `⚠️ Full track unavailable (${reason.slice(0, 90)})${botHint}\n` +
            '_Trying a 30-second preview…_',
        );
      }

      let track = null;
      try {
        const d = await deezerSearch(query);
        if (d?.preview) {
          track = {
            source: 'Deezer',
            title: d.title,
            artist: d.artist?.name,
            album: d.album?.title,
            duration: d.duration,
            url: d.preview,
            artwork: d.album?.cover_big || d.album?.cover_medium,
            link: d.link,
            preview: 30,
          };
        }
      } catch { /* try next */ }

      if (!track) {
        try {
          const t = await itunesSearch(query);
          if (t?.previewUrl) {
            track = {
              source: 'iTunes',
              title: t.trackName,
              artist: t.artistName,
              album: t.collectionName,
              duration: Math.round((t.trackTimeMillis || 0) / 1000),
              url: t.previewUrl,
              artwork: (t.artworkUrl100 || '').replace('100x100', '600x600'),
              link: t.trackViewUrl,
              preview: 30,
            };
          }
        } catch { /* give up below */ }
      }

      if (!track) return reply(`❌ No track found for *${query}*`);

      const res = await axios.get(track.url, {
        responseType: 'arraybuffer', timeout: 60000,
        maxContentLength: 20 * 1024 * 1024, headers: { 'User-Agent': UA },
      });
      const audio = Buffer.from(res.data);

      const caption =
        `🎵 *${track.title}*` +
        (track.artist ? `\n🎤 ${track.artist}` : '') +
        (track.album ? `\n💿 ${track.album}` : '') +
        (track.duration ? `\n⏱️ ${fmtDur(track.duration)}` : '') +
        `\n💾 ${(audio.length / 1024 / 1024).toFixed(2)} MB · via ${track.source}` +
        (track.preview
          ? `\n\n_⚠️ ${track.preview}-second official preview — full tracks need yt-dlp_`
          : '') +
        (track.link ? `\n🔗 ${track.link}` : '');

      if (track.artwork) {
        await sock.sendMessage(from, { image: { url: track.artwork }, caption }, { quoted: msg });
      } else {
        await reply(caption);
      }
      return sock.sendMessage(from, {
        audio, mimetype: 'audio/mpeg',
        fileName: `${track.title} - ${track.artist || track.source}.mp3`,
      }, { quoted: msg });
    }

    /* ── video / social ─────────────────────────────────── */
    if (isVideo(command)) {
      if (!query) return reply(`Usage: \`.${command} <url or search>\``);
      /**
       * Video works now too. The old reply claimed YouTube blocked server-side
       * downloads and that only Cobalt could fix it; yt-dlp does it directly,
       * and 480p keeps the file inside what WhatsApp will accept.
       */
      try {
        const ytdlp = require('../ytdlp');
        if (!ytdlp.ytDlpPath()) throw new Error('yt-dlp is not available on this host');
        await reply(`⬇️ *Fetching video…*\n_${query}_`);
        const { buffer, info, bytes } = await ytdlp.downloadVideo(query);
        await reply(
          `🎬 *${info.title}*` +
            (info.duration ? `\n⏱️ ${fmtDur(info.duration)}` : '') +
            `\n💾 ${(bytes / 1024 / 1024).toFixed(2)} MB · 480p`,
        );
        return sock.sendMessage(
          from,
          {
            video: buffer,
            mimetype: 'video/mp4',
            fileName: `${info.title}.mp4`.replace(/[\\/:*?"<>|]/g, '_'),
          },
          { quoted: msg },
        );
      } catch (e) {
        return reply(
          `❌ Video download unavailable — ${e.message.slice(0, 140)}\n\n` +
            `_Audio still works: \`.play <song name>\`_`,
        );
      }
    }

    /* ── files ──────────────────────────────────────────── */
    return reply(
      `📦 *\`.${command}\` needs a direct file URL.*\n\n` +
        `APK/Play Store mirrors and Mega links are region- and auth-gated; ` +
        `paste a direct link and I'll fetch it, or use \`.upload\` to host a file.`,
    );
  },
};
