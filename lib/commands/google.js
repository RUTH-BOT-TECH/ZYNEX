/**
 * .google <query> — honest web lookup, not a fake Google SERP.
 *
 * Google has no keyless server-side results API; its HTML endpoint returns a
 * consent/JavaScript shell to this host. So this command uses DuckDuckGo's
 * keyless Instant Answer API for the answer, says exactly which service
 * answered, and gives a real Google link for the full search. Calling that a
 * "Google search result" would be a lie.
 */
'use strict';

const { ddgInstant, formatDdgInstant, searchUrl } = require('../webSearch');

module.exports = {
  name: 'google',
  aliases: ['g', 'search'],
  desc: 'Web answer + Google search link',
  category: 'tools',

  async execute({ args, argString, reply }) {
    const q = String(argString || (Array.isArray(args) ? args.join(' ') : args || '')).trim();
    if (!q) return reply('❌ Provide a search query.\nUsage: `.google best restaurants in Lagos`');

    const googleUrl = searchUrl('google', q);
    try {
      const data = await ddgInstant(q);
      const text = formatDdgInstant(q, data, {
        provider: 'DuckDuckGo Instant Answer (keyless)',
        openUrl: googleUrl,
      });
      if (text) return reply(text);
    } catch {
      // fall through to the honest link-only answer
    }

    return reply(
      `🔎 *Web search: ${q}*\n\n` +
        '_No instant answer is available for this query._\n\n' +
        `▸ Google: ${googleUrl}\n` +
        `▸ Bing: ${searchUrl('bing', q)}\n` +
        `▸ DuckDuckGo: ${searchUrl('duckduckgo', q)}\n\n` +
        '_Live Google results need a paid/keyed SERP API; this bot does not pretend to have one._',
    );
  },
};
