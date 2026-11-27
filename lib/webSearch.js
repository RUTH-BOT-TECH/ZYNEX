/**
 * lib/webSearch.js — keyless, provider-honest web lookups.
 *
 * Why this file exists: the old tools engine answered `.bing`, `.gsearch`,
 * `.ddg`, `.google` and friends with the SAME three links. That is not a
 * search result, and it is not honest about which service was used.
 *
 * Research (Nov 2026):
 *   • Bing's public `format=rss` web-search feed still returns 10 `<item>`
 *     results with title / link / description. It is an unofficial RSS view,
 *     carries a personal non-commercial notice, and can change without notice.
 *   • The old Bing Search API was retired in 2025; there is no new key for it.
 *   • Google has no keyless SERP JSON API, and its HTML endpoint returns a
 *     consent/JS shell to a server. DuckDuckGo's Instant Answer API is keyless
 *     but is an *answer* API, not a list of search results.
 *
 * So: `.bing` parses real Bing RSS results. `.google`/`.ddg` say exactly what
 * they used, and never dress an answer up as another engine's SERP.
 */
'use strict';

const { BOT_NAME } = require('./botInfo');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const API_UA = `${BOT_NAME}/1.0 (WhatsApp bot)`;
const TIMEOUT_MS = 12_000;

const SEARCH_URLS = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  yahoo: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
};

function trim(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function decodeEntities(s) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®',
  };
  return String(s ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_m, e) => {
      const k = e.toLowerCase();
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return named[k] ?? `&${e};`;
    })
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}

/** Parse a Bing RSS/Atom item list. Exported so tests need no network. */
function parseBingRss(xml, limit = 5) {
  const blocks = [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return blocks
    .slice(0, Math.max(0, limit))
    .map((m) => ({
      title: trim(decodeEntities(tag(m[1], 'title')), 140),
      link: decodeEntities(tag(m[1], 'link')),
      snippet: trim(decodeEntities(tag(m[1], 'description')), 220),
    }))
    .filter((x) => x.title && /^https?:\/\//i.test(x.link));
}

async function bingSearch(query, limit = 5) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&format=rss`;
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Bing RSS HTTP ${res.status}`);
  return parseBingRss(await res.text(), limit);
}

function formatBingResults(query, items, { title = 'Bing results' } = {}) {
  if (!items.length) return null;
  return [
    `🔎 *${title}: ${query}*`,
    '',
    ...items.map((r, i) =>
      `${i + 1}. *${r.title}*\n   ${r.link}\n   ${r.snippet || '_No description._'}`,
    ),
    '',
    '_Source: Bing public RSS (keyless, personal/non-commercial use)._',
  ].join('\n');
}

async function ddgInstant(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': API_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DuckDuckGo instant answer HTTP ${res.status}`);
  return res.json();
}

function formatDdgInstant(query, data, { provider = 'DuckDuckGo instant answer', openUrl } = {}) {
  const abstract = trim(data?.AbstractText, 700);
  const related = (Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [])
    .map((t) => trim(t?.Text || t?.Result || '', 180))
    .filter(Boolean)
    .slice(0, 4);
  if (!abstract && !related.length) return null;

  const lines = [`🔎 *Web answer: ${query}*`, '', `_Source: ${provider}._`, ''];
  if (abstract) {
    lines.push(abstract);
    if (data?.AbstractURL) lines.push(`🔗 ${data.AbstractURL}`);
  }
  if (related.length) {
    lines.push('', '*Related:*', ...related.map((t) => `▸ ${t}`));
  }
  if (openUrl) lines.push('', `🌐 Open full search: ${openUrl}`);
  return lines.join('\n');
}

function searchUrl(provider, query) {
  const fn = SEARCH_URLS[provider] || SEARCH_URLS.google;
  return fn(String(query || '').trim());
}

module.exports = {
  BROWSER_UA,
  API_UA,
  TIMEOUT_MS,
  SEARCH_URLS,
  trim,
  decodeEntities,
  parseBingRss,
  bingSearch,
  formatBingResults,
  ddgInstant,
  formatDdgInstant,
  searchUrl,
};
