/**
 * REACTIONS ENGINE — anime reaction GIFs
 *
 * `.hug @user` sends an actual animated GIF with a caption, which is what these
 * commands mean on every MD bot. Sourced from two keyless APIs that were
 * verified live:
 *   • api.otakugifs.xyz   → JSON { url } pointing at a CDN gif
 *   • nekos.life          → JSON { url } pointing at a CDN gif
 *
 * Both return real image/gif (200, ~800KB–6MB), no key, no signup.
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (compatible; ZYNEX-MD/1.0)';

/* command → { verb, emoji, reactions[] } */
const REACTIONS = {
  hug:        { verb: 'hugs',              emoji: '🤗', api: ['hug'] },
  kiss:       { verb: 'kisses',            emoji: '😘', api: ['kiss'] },
  pat:        { verb: 'pats',              emoji: '🫳', api: ['pat'] },
  slap:       { verb: 'slaps',             emoji: '🖐️', api: ['slap'] },
  cuddle:     { verb: 'cuddles',           emoji: '🥰', api: ['cuddle'] },
  cry:        { verb: 'cries with',        emoji: '😭', api: ['cry'] },
  smile:      { verb: 'smiles at',         emoji: '😊', api: ['smile'] },
  wave:       { verb: 'waves at',          emoji: '👋', api: ['wave'] },
  wink:       { verb: 'winks at',          emoji: '😉', api: ['wink'] },
  blush:      { verb: 'blushes at',        emoji: '😳', api: ['blush'] },
  bite:       { verb: 'bites',             emoji: '😬', api: ['bite'] },
  lick:       { verb: 'licks',             emoji: '😋', api: ['lick'] },
  poke:       { verb: 'pokes',             emoji: '👉', api: ['poke'] },
  bonk:       { verb: 'bonks',             emoji: '🔨', api: ['bonk'] },
  yeet:       { verb: 'yeets',             emoji: '🚀', api: ['yeet'] },
  highfive:   { verb: 'high-fives',        emoji: '🙌', api: ['highfive'] },
  handhold:   { verb: 'holds hands with',  emoji: '🤝', api: ['handhold'] },
  nom:        { verb: 'noms',              emoji: '🍽️', api: ['nom'] },
  dance:      { verb: 'dances with',       emoji: '💃', api: ['dance'] },
  happy:      { verb: 'is happy with',     emoji: '😄', api: ['happy'] },
  laugh:      { verb: 'laughs with',       emoji: '😂', api: ['laugh'] },
  punch:      { verb: 'punches',           emoji: '🥊', api: ['punch'] },
  glomp:      { verb: 'glomps',            emoji: '🫂', api: ['glomp'] },
  smug:       { verb: 'smugs at',          emoji: '😏', api: ['smug'] },
  cringe:     { verb: 'cringes at',        emoji: '😬', api: ['cringe'] },
  bully:      { verb: 'bullies',           emoji: '😈', api: ['bully'] },
  bite2:      { verb: 'bites',             emoji: '😬', api: ['bite'] },
  snuggle:    { verb: 'snuggles',          emoji: '🥰', api: ['cuddle'] },
  salute:     { verb: 'salutes',           emoji: '🫡', api: ['salute'] },
  thumbsup:   { verb: 'approves of',       emoji: '👍', api: ['thumbsup'] },
  shrug:      { verb: 'shrugs at',         emoji: '🤷', api: ['shrug'] },
  stare:      { verb: 'stares at',         emoji: '👀', api: ['stare'] },
  think:      { verb: 'thinks about',      emoji: '🤔', api: ['think'] },
  tickle:     { verb: 'tickles',           emoji: '🤣', api: ['tickle'] },
  pout:       { verb: 'pouts at',          emoji: '😤', api: ['pout'] },
  sad:        { verb: 'is sad with',       emoji: '😢', api: ['sad'] },
  sleepy:     { verb: 'is sleepy with',    emoji: '😴', api: ['sleepy'] },
  thumbs:     { verb: 'approves of',       emoji: '👍', api: ['thumbsup'] },
  angry:      { verb: 'is angry at',       emoji: '😠', api: ['angry'] },
  bored:      { verb: 'is bored with',     emoji: '😐', api: ['bored'] },
  facepalm:   { verb: 'facepalms at',      emoji: '🤦', api: ['facepalm'] },
};

const NAMES = Object.keys(REACTIONS);

/* ── fetch one GIF URL, with fallbacks ────────────────────── */
async function fetchGif(tag) {
  // 1. otakugifs
  try {
    const r = await axios.get('https://api.otakugifs.xyz/gif', {
      params: { reaction: tag },
      timeout: 8000,
      headers: { 'User-Agent': UA },
    });
    if (r.data?.url) return r.data.url;
  } catch { /* next */ }

  // 2. nekos.life
  try {
    const r = await axios.get(`https://nekos.life/api/v2/img/${tag}`, {
      timeout: 8000,
      headers: { 'User-Agent': UA },
    });
    if (r.data?.url) return r.data.url;
  } catch { /* next */ }

  return null;
}

module.exports = {
  id: 'reactions',
  name: 'reactions-engine',

  match(name) {
    return Boolean(REACTIONS[name]);
  },

  describe(name) {
    const r = REACTIONS[name];
    return r ? `${r.verb} (anime gif)` : 'reaction';
  },

  extraNames: NAMES,

  async execute({ command, reply, sock, from, msg, sender, m }) {
    const r = REACTIONS[command];
    const quoted = m?.message?.extendedTextMessage?.contextInfo;
    const target = quoted?.participant || quoted?.mentionedJid?.[0] || null;

    const me = String(sender).split('@')[0];
    const them = target ? String(target).split('@')[0] : null;

    const caption = them
      ? `${r.emoji} *${me}* ${r.verb} *${them}*`
      : `${r.emoji} *${me}* ${r.verb} everyone!`;

    const gif = await fetchGif(r.api[0]);
    if (!gif) {
      console.log(`[REACTION] ${command}: every CDN failed`);
      return reply(caption);
    }

    // ★ Download the GIF ourselves and send the BYTES.
    //
    // The old code passed { video: { url: gif }, gifPlayback: true }. Baileys
    // shells out to ffmpeg to probe, thumbnail and transcode whatever it is
    // given as a video, and the container has no ffmpeg — so the send threw,
    // the fallback threw too, and the user got only a caption with no animation
    // (the "blank" reaction). Fetching the bytes ourselves and letting Baileys
    // store them as the original video avoids the transcode entirely.
    let buf;
    try {
      buf = await fetchBytes(gif);
    } catch (e) {
      console.log(`[REACTION] ${command}: download failed (${e.message}) — using the URL`);
      // Fall back to the URL, which still works on hosts that DO have ffmpeg.
      return sendReaction(sock, from, msg, { url: gif }, caption, target, reply);
    }

    const isGif = buf.slice(0, 3).toString('ascii') === 'GIF';
    console.log(`[REACTION] ${command}: ${isGif ? 'gif' : 'unknown'} ${buf.length} bytes`);

    /**
     * ★ Try the real animation FIRST.
     *
     * { video, gifPlayback: true } is what makes WhatsApp render a looping,
     * muted animation rather than a still picture. It needs ffmpeg (Baileys
     * transcodes and thumbnails the video), which is why .nixpacks.toml now
     * installs it — previously the send threw and we fell back to a static
     * image, which is exactly what the user saw: "an image, not a kiss".
     *
     * If ffmpeg is missing the send still fails here and we degrade to a static
     * image; the log says which happened.
     */
    const hasFfmpeg = await ffmpegAvailable();
    if (!isGif || hasFfmpeg) {
      try {
        const res = await sock.sendMessage(
          from,
          { video: buf, gifPlayback: true, caption, ...(target ? { mentions: [target] } : {}) },
          { quoted: msg },
        );
        console.log(`[REACTION] sent as animated video (ffmpeg=${hasFfmpeg})`);
        return res;
      } catch (e) {
        console.log(`[REACTION] animated send failed (${e.message}) — falling back`);
      }
    }

    return sendReaction(sock, from, msg, buf, caption, target, reply, isGif);
  },
};

/** Is ffmpeg on PATH? Cached, because this is checked on every reaction. */
let _ffmpeg = null;
async function ffmpegAvailable() {
  if (_ffmpeg !== null) return _ffmpeg;
  try {
    _ffmpeg = require('../ffmpeg').hasFfmpeg();
  } catch {
    _ffmpeg = false;
  }
  if (!_ffmpeg) console.log('[REACTION] ffmpeg not found — animated GIFs will be sent as static images');
  return _ffmpeg;
}

/** Download a URL to a Buffer, with a size guard. */
async function fetchBytes(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 12 * 1024 * 1024,
    headers: { 'User-Agent': UA, Accept: 'image/gif,image/*' },
  });
  return Buffer.from(r.data);
}

async function sendReaction(sock, from, msg, media, caption, target, reply, isGif = true) {
  const mention = target ? { mentions: [target] } : {};
  // Attempts in order of what actually renders without ffmpeg.
  const attempts = isGif
    ? [
        ['image (animated)', () => sock.sendMessage(from, { image: media, caption, ...mention }, { quoted: msg })],
        ['sticker', () => sock.sendMessage(from, { sticker: media }, { quoted: msg })],
        ['video+gifPlayback', () => sock.sendMessage(from, { video: media, gifPlayback: true, caption, ...mention }, { quoted: msg })],
      ]
    : [
        ['video+gifPlayback', () => sock.sendMessage(from, { video: media, gifPlayback: true, caption, ...mention }, { quoted: msg })],
        ['image', () => sock.sendMessage(from, { image: media, caption, ...mention }, { quoted: msg })],
        ['sticker', () => sock.sendMessage(from, { sticker: media }, { quoted: msg })],
      ];

  const errors = [];
  for (const [label, fn] of attempts) {
    try {
      const res = await fn();
      console.log(`[REACTION] sent as ${label}`);
      return res;
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  }
  console.log(`[REACTION] all forms failed — ${errors.join(' | ')}`);
  // Better a caption than silence.
  return reply(`${caption}\n\n_(the animation could not be attached right now)_`);
}

// exposed for tests
module.exports._internals = { ffmpegAvailable };
