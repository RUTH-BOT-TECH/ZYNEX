/** .translate — Translate text using Google Translate */

module.exports = {
  name: 'translate',
  aliases: ['tr', 'trans'],
  desc: 'Translate text (usage: .translate en Hello)',
  category: 'tools',
  async execute({
  args, reply }) {
  const axios = require('axios');
    if (args.length < 2) return reply('❌ Usage: `.translate <lang> <text>`\nExample: `.translate fr Hello world`');
    const targetLang = args[0].toLowerCase();
    const text = args.slice(1).join(' ');
    if (!text) return reply('❌ Provide text to translate.');

    let translation = null;
    let source = null;

    // Primary: MyMemory (free, keyless, high rate limit)
    try {
      const r = await axios.get('https://api.mymemory.translated.net/get', {
        params: { q: text, langpair: `auto|${targetLang}` },
        timeout: 8000,
      });
      const t = r.data?.responseData?.translatedText;
      if (t && r.data?.responseStatus == 200) {
        translation = t;
        source = 'MyMemory';
      }
    } catch { /* fall through */ }

    // Fallback: Google unofficial endpoint
    if (!translation) {
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { timeout: 8000 });
        translation = res.data[0].map((t) => t[0]).join('');
        source = 'Google';
      } catch { /* ignore */ }
    }

    if (!translation) {
      return reply('❌ Translation service is busy right now. Try again in a moment.');
    }

    await reply(
      `🌍 *Translation*\n\n` +
      `To: *${targetLang}*\n\n` +
      `*Original:*\n${text}\n\n` +
      `*Translation:*\n${translation}\n\n` +
      `_via ${source}_`,
    );
  },
};
