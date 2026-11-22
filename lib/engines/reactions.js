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

    // GIF first; plain text if the CDN is down
    if (gif) {
      try {
        return await sock.sendMessage(
          from,
          { video: { url: gif }, gifPlayback: true, caption, ...(target ? { mentions: [target] } : {}) },
          { quoted: msg },
        );
      } catch {
        // some CDNs serve webp/gif that Baileys won't take as video — send as sticker-ish gif
        try {
          return await sock.sendMessage(
            from,
            { image: { url: gif }, caption, ...(target ? { mentions: [target] } : {}) },
            { quoted: msg },
          );
        } catch { /* fall through to text */ }
      }
    }

    return reply(caption);
  },
};
