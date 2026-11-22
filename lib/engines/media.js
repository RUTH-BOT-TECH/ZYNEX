/**
 * MEDIA ENGINE — animals, anime images, and random pictures.
 *
 * Every endpoint verified live and keyless:
 *   • api.thecatapi.com   → cats
 *   • dog.ceo             → dogs
 *   • randomfox.ca        → foxes
 *   • nekos.life          → neko / waifu / kitsune / husbando
 *   • cdn.nekos.life      → actually serves the images
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (compatible; ZYNEX-MD/1.0)';

const ANIMALS = {
  cat:     { label: 'Cat',     emoji: '🐱', get: () => axios.get('https://api.thecatapi.com/v1/images/search', { timeout: 9000, headers: { 'User-Agent': UA } }).then((r) => r.data[0].url) },
  cats:    { label: 'Cat',     emoji: '🐱', get: () => axios.get('https://api.thecatapi.com/v1/images/search', { timeout: 9000 }).then((r) => r.data[0].url) },
  dog:     { label: 'Dog',     emoji: '🐶', get: () => axios.get('https://dog.ceo/api/breeds/image/random', { timeout: 9000 }).then((r) => r.data.message) },
  dogs:    { label: 'Dog',     emoji: '🐶', get: () => axios.get('https://dog.ceo/api/breeds/image/random', { timeout: 9000 }).then((r) => r.data.message) },
  fox:     { label: 'Fox',     emoji: '🦊', get: () => axios.get('https://randomfox.ca/floof/', { timeout: 9000 }).then((r) => r.data.image) },
  shibe:   { label: 'Shiba',   emoji: '🐕', get: () => axios.get('https://dog.ceo/api/breed/shiba/images/random', { timeout: 9000 }).then((r) => r.data.message) },
};

const ANIME = {
  neko:     { label: 'Neko',     emoji: '🐈', tag: 'neko' },
  waifu:    { label: 'Waifu',    emoji: '🌸', tag: 'waifu' },
  kitsune:  { label: 'Kitsune',  emoji: '🦊', tag: 'kitsune' },
  husbando: { label: 'Husbando', emoji: '🤵', tag: 'husbando' },
  anime:    { label: 'Anime',    emoji: '🎌', tag: 'neko' },
};

async function nekosImg(tag) {
  const r = await axios.get(`https://nekos.life/api/v2/img/${tag}`, { timeout: 9000, headers: { 'User-Agent': UA } });
  return r.data?.url;
}

const ANIMAL_NAMES = Object.keys(ANIMALS);
const ANIME_NAMES = Object.keys(ANIME);

module.exports = {
  id: 'media',
  name: 'media-engine',

  match(name) {
    return ANIMAL_NAMES.includes(name) || ANIME_NAMES.includes(name) || ['randompic', 'randomimg', 'randomphoto', 'wallpaper', 'wp', 'background', 'pfp', 'profilepic', 'avatar', 'getpp', 'dp', 'picture', 'photo', 'pic'].includes(name);
  },

  describe(name) {
    if (ANIMALS[name]) return `Random ${ANIMALS[name].label.toLowerCase()} picture`;
    if (ANIME[name]) return `Random ${ANIME[name].label.toLowerCase()} image`;
    return 'Random picture';
  },

  extraNames: [...ANIMAL_NAMES, ...ANIME_NAMES],

  async execute({ command, reply, sock, from, msg }) {
    /* ── animals ────────────────────────────────────────── */
    if (ANIMALS[command]) {
      const a = ANIMALS[command];
      try {
        const url = await a.get();
        if (!url) throw new Error('no url');
        return await sock.sendMessage(from, { image: { url }, caption: `${a.emoji} ${a.label}` }, { quoted: msg });
      } catch (e) {
        return reply(`❌ Couldn't fetch a ${a.label.toLowerCase()} right now.`);
      }
    }

    /* ── anime ──────────────────────────────────────────── */
    if (ANIME[command]) {
      const a = ANIME[command];
      try {
        const url = await nekosImg(a.tag);
        if (!url) throw new Error('no url');
        return await sock.sendMessage(from, { image: { url }, caption: `${a.emoji} ${a.label}` }, { quoted: msg });
      } catch {
        return reply(`❌ Couldn't fetch a ${a.label.toLowerCase()} image right now.`);
      }
    }

    /* ── generic random picture ─────────────────────────── */
    try {
      const url = await nekosImg('neko');
      return await sock.sendMessage(from, { image: { url }, caption: '🖼️ Random picture' }, { quoted: msg });
    } catch {
      return reply('❌ No picture available right now.');
    }
  },
};
