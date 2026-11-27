/**
 * .bing <query> — real Bing web results.
 *
 * The old generic tools branch answered every search command with three links
 * (Google + Bing + DDG). This file gives `.bing` its own owner and parses the
 * keyless Bing RSS result feed instead. If that feed is unavailable, it says so
 * and links to Bing rather than pretending another provider answered.
 */
'use strict';

const { bingSearch, formatBingResults, searchUrl } = require('../webSearch');

module.exports = {
  name: 'bing',
  aliases: ['bingsearch'],
  desc: 'Bing web search results',
  category: 'search',

  async execute({ args, argString, reply }) {
    const q = String(argString || (Array.isArray(args) ? args.join(' ') : args || '')).trim();
    if (!q) return reply('❌ Provide a search query.\nUsage: `.bing Naruto`');

    try {
      const items = await bingSearch(q, 5);
      const text = formatBingResults(q, items, { title: 'Bing results' });
      if (text) return reply(text);
      return reply(
        `🔎 No Bing results found for *${q}*.\n\n` +
          `▸ ${searchUrl('bing', q)}\n\n` +
          '_Try a more specific query._',
      );
    } catch (e) {
      return reply(
        `❌ Bing search is unavailable right now (${e.message}).\n\n` +
          `▸ ${searchUrl('bing', q)}\n\n` +
          `_Use \`.gsearch ${q}\` for a generic web-search link._`,
      );
    }
  },
};
