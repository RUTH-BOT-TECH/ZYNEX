#!/usr/bin/env node
/**
 * command-truth-2-test.cjs — pass 2: search, anime, dictionary and image names.
 *
 * Pins the second research pass described in COMMAND-TRUTH-2.md:
 *   .bing <query>      → real Bing RSS results, not three engine links
 *   .anime <title>     → AniList anime information, not a random catgirl
 *   .animepic          → random anime artwork (the old `.anime` behaviour)
 *   .getpp/.pfp        → a real profile picture, not a random picture
 *   .define            → dictionary definition, not Wikipedia
 *   .synonym/.antonym  → Datamuse word relations, not a definition
 *   .wallpaper         → neutral Picsum photo, not a `neko` image
 *
 * Network calls are mocked here; scripts/search-test.cjs covers the live
 * AniList route separately.
 */
'use strict';
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const axios = require('axios');
const registry = require(path.join(ROOT, 'lib', 'registry'));
const web = require(path.join(ROOT, 'lib', 'webSearch'));
const bing = require(path.join(ROOT, 'lib', 'commands', 'bing'));
const google = require(path.join(ROOT, 'lib', 'commands', 'google'));
const wiki = require(path.join(ROOT, 'lib', 'commands', 'wiki'));
const getpp = require(path.join(ROOT, 'lib', 'commands', 'getpp'));
const info = require(path.join(ROOT, 'lib', 'engines', 'info'));
const media = require(path.join(ROOT, 'lib', 'engines', 'media'));

const realGet = axios.get;
const realFetch = global.fetch;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const RSS = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel><title>Bing: Naruto</title>
<item><title>Naruto - Wikipedia</title><link>https://en.wikipedia.org/wiki/Naruto</link><description>Naruto is a Japanese manga &amp; anime series.</description></item>
<item><title>NARUTO OFFICIAL SITE</title><link>https://naruto-official.com/en</link><description>Official Naruto &amp; Boruto site.</description></item>
</channel></rss>`;

const fetchXml = async () => ({ ok: true, status: 200, text: async () => RSS });
const fetchJson = (data) => async () => ({ ok: true, status: 200, json: async () => data });

console.log('\n══ pass 2 registry ownership ══\n');

t('.bing is a dedicated file command with real Bing results', () => {
  const e = registry.get('bing');
  assert.strictEqual(e.source, 'file');
  assert.match(e.desc, /Bing web search results/);
  assert.strictEqual(e.category, 'search');
});

t('.anime is AniList information, not the media engine', () => {
  const e = registry.get('anime');
  assert.strictEqual(e.engine, 'search');
  assert.match(e.desc, /Anime information by title/);
  assert.notStrictEqual(e.engine, 'media');
});

t('random anime artwork kept honest names', () => {
  for (const n of ['animepic', 'randomanime', 'animeimg', 'animeimage']) {
    const e = registry.get(n);
    assert.strictEqual(e.engine, 'media', `${n} lost its media owner`);
    assert.match(e.desc, /Random anime image/);
  }
});

t('.getpp / .pfp / .avatar / .getdp fetch a real profile picture', () => {
  for (const n of ['getpp', 'pfp', 'avatar', 'getdp']) {
    const e = registry.get(n);
    assert.strictEqual(e.source, 'file');
    assert.match(e.desc, /profile picture/i);
  }
});

t('.define is a dictionary command, not a Wikipedia alias', () => {
  const e = registry.get('define');
  assert.strictEqual(e.engine, 'info');
  assert.match(e.desc, /Dictionary definition/);
  assert.ok(!/aliases:\s*\[[^\]]*'define'/.test(src('lib/commands/wiki.js')));
});

t('synonym / antonym / thesaurus have truthful descriptions', () => {
  assert.match(registry.get('synonym').desc, /Synonyms/);
  assert.match(registry.get('antonym').desc, /Antonyms/);
  assert.match(registry.get('thesaurus').desc, /synonyms \+ antonyms/i);
});

t('provider-honest search / wiki descriptions', () => {
  assert.match(registry.get('google').desc, /Web answer \+ Google search link/);
  assert.match(registry.get('gsearch').desc, /Generic web search/);
  assert.match(registry.get('ddg').desc, /DuckDuckGo/);
  assert.match(registry.get('urban').desc, /Urban Dictionary/);
  assert.match(registry.get('wiki').desc, /Wikipedia summary/);
  assert.match(registry.get('yahoo').desc, /Yahoo headlines/);
});

t('generic image names describe neutral photos, not anime', () => {
  assert.match(registry.get('wallpaper').desc, /Random wallpaper photo/);
  assert.match(registry.get('picture').desc, /Random photo/);
  assert.match(registry.get('naruto').desc, /naruto text logo/);
});

t('no-keyless-API image commands stay honest fallbacks', () => {
  for (const n of ['image', 'img', 'gimage', 'unsplash', 'pexels', 'pixabay']) {
    assert.strictEqual(registry.get(n).source, 'fallback', `${n} pretends to work`);
  }
});

console.log('\n══ source-level guards ══\n');

t('Bing RSS parser and command are wired', () => {
  assert.match(src('lib/webSearch.js'), /format=rss/);
  assert.match(src('lib/webSearch.js'), /parseBingRss/);
  assert.match(src('lib/commands/bing.js'), /bingSearch/);
  assert.match(src('lib/engines/tools.js'), /SEARCH_DESCRIPTIONS/);
});

t('AniList anime branch and honest random-image names exist', () => {
  assert.match(src('lib/engines/search.js'), /command === 'anime' \|\| command === 'animeinfo'/);
  assert.match(src('lib/engines/media.js'), /picsum\.photos/);
  assert.match(src('lib/catalogue/commands.js'), /animepic randomanime animeimg animeimage/);
});

t('dictionary, profile-picture and wiki fixes are present', () => {
  assert.match(src('lib/engines/info.js'), /rel_syn/);
  assert.match(src('lib/engines/info.js'), /rel_ant/);
  assert.match(src('lib/commands/getpp.js'), /profilePictureUrl/);
  assert.match(src('lib/commands/wiki.js'), /require\('\.\.\/botInfo'\)/);
});

console.log('\n══ mocked functional checks ══\n');

(async () => {
  try {
    await ta('Bing RSS XML parses into real result objects', async () => {
      const items = web.parseBingRss(RSS, 5);
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].title, 'Naruto - Wikipedia');
      assert.strictEqual(items[0].link, 'https://en.wikipedia.org/wiki/Naruto');
      assert.match(items[0].snippet, /manga & anime/);
      const out = web.formatBingResults('Naruto', items);
      assert.match(out, /Bing results: Naruto/);
      assert.match(out, /Bing public RSS/);
    });

    await ta('.bing Naruto replies with parsed Bing results', async () => {
      global.fetch = fetchXml;
      const replies = [];
      await bing.execute({ args: ['Naruto'], argString: 'Naruto', reply: async (x) => replies.push(String(x)) });
      assert.strictEqual(replies.length, 1);
      assert.match(replies[0], /Naruto - Wikipedia/);
      assert.match(replies[0], /en\.wikipedia\.org\/wiki\/Naruto/);
      assert.ok(!/▸ Google:/.test(replies[0]), 'still the old three-link salad');
    });

    await ta('.google says DuckDuckGo answered and links to Google', async () => {
      global.fetch = fetchJson({
        AbstractText: 'A Japanese manga series.',
        AbstractURL: 'https://en.wikipedia.org/wiki/Naruto',
        RelatedTopics: [{ Text: 'Naruto Uzumaki' }],
      });
      const replies = [];
      await google.execute({ args: ['Naruto'], argString: 'Naruto', reply: async (x) => replies.push(String(x)) });
      assert.match(replies[0], /DuckDuckGo Instant Answer/);
      assert.match(replies[0], /google\.com\/search\?q=Naruto/);
      assert.ok(!/^\*Google search results\*/m.test(replies[0]));
    });

    await ta('.wiki imports bot identity and returns a Wikipedia summary', async () => {
      axios.get = async () => ({
        data: {
          type: 'standard', title: 'Lagos', extract: 'Lagos is a city in Nigeria.',
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Lagos' } },
        },
      });
      const replies = [];
      await wiki.execute({ args: ['Lagos'], argString: 'Lagos', reply: async (x) => replies.push(String(x)) });
      assert.match(replies[0], /Wikipedia: Lagos/);
      assert.match(replies[0], /Lagos is a city/);
    });

    await ta('.synonym and .antonym use Datamuse relationships', async () => {
      axios.get = async (url) => {
        assert.match(url, /api\.datamuse\.com\/words/);
        const data = /rel_syn/.test(url)
          ? [{ word: 'joyful' }, { word: 'glad' }]
          : [{ word: 'sad' }, { word: 'unhappy' }];
        return { data };
      };
      const syn = [];
      await info.execute({ command: 'synonym', args: ['happy'], argString: 'happy', reply: async (x) => syn.push(String(x)) });
      assert.match(syn[0], /Synonyms: happy/);
      assert.match(syn[0], /joyful/);
      const ant = [];
      await info.execute({ command: 'antonym', args: ['happy'], argString: 'happy', reply: async (x) => ant.push(String(x)) });
      assert.match(ant[0], /Antonyms: happy/);
      assert.match(ant[0], /sad/);
    });

    await ta('.wallpaper sends a neutral photo buffer, not a neko URL', async () => {
      axios.get = async () => ({
        headers: { 'content-type': 'image/jpeg' },
        data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      });
      const sent = [];
      await media.execute({
        command: 'wallpaper', args: [], from: '120363@g.us',
        msg: { key: { remoteJid: '120363@g.us' }, message: {} },
        sock: { sendMessage: async (_jid, payload) => { sent.push(payload); return {}; } },
        reply: async (x) => sent.push({ text: String(x) }),
      });
      const image = sent.find((x) => x.image);
      assert.ok(Buffer.isBuffer(image?.image), 'expected a real image buffer');
      assert.match(image.caption, /Random wallpaper/);
    });

    await ta('.getpp fetches a profile picture and tags the number', async () => {
      axios.get = async () => ({
        headers: { 'content-type': 'image/jpeg' },
        data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      });
      const target = '2348111000002@s.whatsapp.net';
      const sent = [];
      const replies = [];
      await getpp.execute({
        mentionedJid: [target], sender: '2348111000001@s.whatsapp.net',
        senderJid: '2348111000001@s.whatsapp.net', participant: '2348111000001@s.whatsapp.net',
        from: '120363@g.us',
        msg: { key: { remoteJid: '120363@g.us', participant: '2348111000001@s.whatsapp.net' }, message: {} },
        sock: {
          profilePictureUrl: async (jid) => {
            assert.strictEqual(jid, target);
            return 'https://example.com/pp.jpg';
          },
          sendMessage: async (_jid, payload) => { sent.push(payload); return {}; },
        },
        reply: async (x) => replies.push(String(x)),
      });
      assert.strictEqual(replies.length, 0, replies.join('\n'));
      assert.ok(Buffer.isBuffer(sent[0]?.image));
      assert.match(sent[0].caption, /@2348111000002/);
      assert.deepStrictEqual(sent[0].mentions, [target]);
    });
  } finally {
    axios.get = realGet;
    global.fetch = realFetch;
  }

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
