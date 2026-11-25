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
const mention = require('../mention');

const UA = `Mozilla/5.0 (compatible; ${require('../botInfo').BOT_NAME}/1.0)`;

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

  async execute({ command, reply, sock, from, msg, sender, m, mentionedJid = [], args = [] }) {
    const r = REACTIONS[command];

    /**
     * ★ The number / ID the user expected.
     *
     * Old output was `*2348021016309* hugs *2348134112474*` — bold digits, no
     * `@`, and only the target in `mentions`, so nothing was tappable and the
     * sender was never tagged at all. Now both people are real mentions and the
     * caption shows `@<number>`. Targets also come from the handler's
     * normalised contextInfo (all message types), a quoted author, or a bare
     * number typed after the command — not just extendedTextMessage.
     */
    const target = mention.pickTarget({ mentionedJid, m, args });
    const meJid = mention.toJid(sender);
    const mentions = mention.mentions(meJid, target);
    const meTag = mention.tag(meJid) || 'someone';
    const themTag = mention.tag(target);

    const caption = themTag
      ? `${r.emoji} ${meTag} ${r.verb} ${themTag}`
      : `${r.emoji} ${meTag} ${r.verb} everyone!`;

    const gif = await fetchGif(r.api[0]);
    if (!gif) {
      console.log(`[REACTION] ${command}: every CDN failed`);
      return reply(caption, { mentions });
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
      return sendReaction(sock, from, msg, { url: gif }, caption, mentions, reply);
    }

    const isGif = buf.slice(0, 3).toString('ascii') === 'GIF';
    console.log(`[REACTION] ${command}: ${isGif ? 'gif' : 'unknown'} ${buf.length} bytes`);

    /**
     * ★ Convert the GIF to MP4 BEFORE sending it as a video.
     *
     * This is the bug behind "it brings the gif but the gif is not showing":
     * the raw GIF bytes were handed to Baileys as `{ video, gifPlayback: true }`
     * and uploaded with mimetype video/mp4. WhatsApp was given a file whose
     * first bytes are `GIF89a` in a container declared as MP4, so the message
     * arrives and the player has nothing it can decode — a blank bubble rather
     * than an animation. The send succeeds, which is why this never raised an
     * error anywhere.
     *
     * `gifPlayback: true` does not convert anything; it only tells WhatsApp to
     * loop and mute the video it is given. The conversion is ours to do.
     *
     * ffmpeg: H.264 + yuv420p + even dimensions + faststart, which is the
     * combination WhatsApp renders reliably. yuv420p matters — many GIFs are
     * RGB and produce a video phones will not play.
     */
    if (isGif) {
      try {
        const { ffmpegPath } = require('../ffmpeg');
        const bin = ffmpegPath();
        if (bin) {
          const fs = require('fs');
          const os = require('os');
          const nodePath = require('path');
          const { execFile } = require('child_process');
          const { promisify } = require('util');
          const execFileAsync = promisify(execFile);

          const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'zynex-rx-'));
          const inFile = nodePath.join(dir, 'in.gif');
          const outFile = nodePath.join(dir, 'out.mp4');
          fs.writeFileSync(inFile, buf);

          await execFileAsync(
            bin,
            [
              '-y',
              '-i', inFile,
              '-movflags', '+faststart',
              '-pix_fmt', 'yuv420p',
              // Odd dimensions are rejected by H.264; force even numbers.
              '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
              '-an',
              outFile,
            ],
            { timeout: 30000 },
          );

          const mp4 = fs.readFileSync(outFile);
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

          // Confirm it really is an MP4 before sending. A failed conversion that
          // still gets sent is the exact failure this whole block exists to fix.
          const isMp4 = mp4.slice(4, 8).toString('ascii') === 'ftyp';
          if (isMp4 && mp4.length > 1024) {
            buf = mp4;
            console.log(`[REACTION] ${command}: GIF→MP4 ${Math.round(buf.length / 1024)} KB (ftyp ok)`);
          } else {
            console.log(`[REACTION] ${command}: conversion produced no usable MP4 — sending the GIF bytes`);
          }
        } else {
          console.log(`[REACTION] ${command}: no ffmpeg, cannot convert the GIF`);
        }
      } catch (e) {
        console.log(`[REACTION] ${command}: GIF→MP4 failed (${e.message.slice(0, 120)})`);
      }
    }

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
          { video: buf, gifPlayback: true, caption, mentions },
          { quoted: msg },
        );
        console.log(`[REACTION] sent as animated video (ffmpeg=${hasFfmpeg})`);
        return res;
      } catch (e) {
        console.log(`[REACTION] animated send failed (${e.message}) — falling back`);
      }
    }

    return sendReaction(sock, from, msg, buf, caption, mentions, reply, isGif);
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

/**
 * Sniff what the buffer actually is.
 *
 * The fallback order used to be decided by a guess about the source, which
 * meant an MP4 could be uploaded as an image and a GIF could be uploaded as an
 * MP4 — both render as an empty bubble, and both send without erroring. Decide
 * from the bytes instead.
 */
function containerOf(media) {
  if (!Buffer.isBuffer(media)) return 'url';
  if (media.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (media.slice(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  if (media.slice(0, 4).toString('ascii') === 'RIFF') return 'webp';
  return 'unknown';
}

async function sendReaction(sock, from, msg, media, caption, mentions, reply, isGif = true) {
  const mentionOpt = { mentions };
  const kind = containerOf(media);

  // Attempts in order of what actually renders, matching the real container.
  const attempts = kind === 'mp4'
    ? [
        ['video+gifPlayback', () => sock.sendMessage(from, { video: media, gifPlayback: true, caption, ...mentionOpt }, { quoted: msg })],
        // A video that will not send can still go as a document, which the
        // recipient can open — better than an unplayable bubble.
        ['document', () => sock.sendMessage(from, { document: media, mimetype: 'video/mp4', fileName: 'reaction.mp4', caption, ...mentionOpt }, { quoted: msg })],
      ]
    : isGif
      ? [
          ['image (gif bytes)', () => sock.sendMessage(from, { image: media, caption, ...mentionOpt }, { quoted: msg })],
          ['sticker', () => sock.sendMessage(from, { sticker: media }, { quoted: msg })],
          ['document', () => sock.sendMessage(from, { document: media, mimetype: 'image/gif', fileName: 'reaction.gif', caption, ...mentionOpt }, { quoted: msg })],
        ]
      : [
          ['video+gifPlayback', () => sock.sendMessage(from, { video: media, gifPlayback: true, caption, ...mentionOpt }, { quoted: msg })],
          ['image', () => sock.sendMessage(from, { image: media, caption, ...mentionOpt }, { quoted: msg })],
          ['document', () => sock.sendMessage(from, { document: media, mimetype: 'video/mp4', fileName: 'reaction.mp4', caption, ...mentionOpt }, { quoted: msg })],
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
  return reply(`${caption}\n\n_(the animation could not be attached right now)_`, { mentions });
}

// exposed for tests
module.exports._internals = { ffmpegAvailable };
