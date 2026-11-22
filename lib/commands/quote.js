/** .quote — Random inspirational quote */

module.exports = {
  name: 'quote',
  aliases: ['q', 'inspire'],
  desc: 'Get a random inspirational quote',
  category: 'fun',
  async execute({
  reply }) {
  const axios = require('axios');
    try {
      const res = await axios.get('https://zenquotes.io/api/random', { timeout: 8000 });
      const d = Array.isArray(res.data) ? res.data[0] : res.data;
      await reply(`💬 *"${d.q}"*\n\n— *${d.a}*`);
    } catch {
      const fallback = ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Be the change you wish to see in the world.', 'Success is not final, failure is not fatal: it is the courage to continue that counts.'];
      const q = fallback[Math.floor(Math.random() * fallback.length)];
      await reply(`💬 *"${q}"*`);
    }
  },
};
