/** .wiki — Search Wikipedia */

module.exports = {
  name: 'wiki',
  aliases: ['wikipedia', 'define'],
  desc: 'Search Wikipedia',
  category: 'tools',
  async execute({
  args, reply }) {
  const axios = require('axios');
    const query = args.join(' ');
    if (!query) return reply('❌ Provide a search query.\nUsage: `.wiki Nairobi`');

    try {
      // Wikipedia REST API summary endpoint
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const res = await axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': `${BOT_NAME}/1.0 (WhatsApp bot; +${REPO_URL})` },
      });
      const data = res.data;

      if (data.type === 'standard' || data.type === 'disambiguation') {
        let text = `📚 *Wikipedia: ${data.title}*\n\n${data.extract}\n`;
        if (data.content_urls?.desktop?.page) {
          text += `\n🔗 ${data.content_urls.desktop.page}`;
        }
        await reply(text);
      } else {
        await reply(`❌ No Wikipedia article found for *${query}*`);
      }
    } catch (e) {
      if (e.response?.status === 404) await reply(`❌ No Wikipedia article found for *${query}*`);
      else await reply(`❌ Failed: ${e.message}`);
    }
  },
};
