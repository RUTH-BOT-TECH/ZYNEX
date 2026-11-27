/**
 * .wiki <topic> — Wikipedia summary.
 *
 * `define` used to be an alias here, which made `.define serendipity` return a
 * Wikipedia article instead of a dictionary definition. It now belongs to the
 * dictionary engine. This file also used BOT_NAME / REPO_URL as undeclared
 * globals, so its User-Agent could crash on a real request; they are imported
 * from the single source of truth now.
 */
'use strict';

const axios = require('axios');
const { BOT_NAME, REPO_URL } = require('../botInfo');

module.exports = {
  name: 'wiki',
  aliases: ['wikipedia'],
  desc: 'Wikipedia summary',
  category: 'tools',

  async execute({ args, argString, reply }) {
    const query = String(argString || (Array.isArray(args) ? args.join(' ') : args || '')).trim();
    if (!query) return reply('❌ Provide a topic.\nUsage: `.wiki Lagos`');

    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const res = await axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': `${BOT_NAME}/1.0 (WhatsApp bot; +${REPO_URL})` },
      });
      const data = res.data;
      if (data.type === 'standard' || data.type === 'disambiguation') {
        return reply(
          `📚 *Wikipedia: ${data.title}*\n\n${data.extract || 'No summary available.'}` +
            (data.content_urls?.desktop?.page ? `\n\n🔗 ${data.content_urls.desktop.page}` : ''),
        );
      }
      return reply(`❌ No Wikipedia article found for *${query}*.`);
    } catch (e) {
      if (e.response?.status === 404) return reply(`❌ No Wikipedia article found for *${query}*.`);
      return reply(`❌ Wikipedia is unavailable right now (${e.message}).`);
    }
  },
};
