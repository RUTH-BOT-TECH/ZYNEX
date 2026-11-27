#!/usr/bin/env node
/**
 * search-test.cjs — live assertions for every command in lib/engines/search.js
 *
 * Unlike the other suites these hit the real keyless APIs, so a failure here can
 * mean "the internet changed", not "our code broke". Each route is asserted on
 * shape (did we get the expected kind of answer?) rather than exact content.
 *
 * Run: node scripts/search-test.cjs      (npm run test:search)
 */
process.env.SILENT = '1';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const search = require(path.join(ROOT, 'lib/engines', 'search.js'));

/* ── harness ─────────────────────────────────────────────────────────── */
let sent = [];
const sock = { sendMessage: async (j, c) => { sent.push(c); return {}; } };

function ctx(command, args = []) {
  sent = [];
  return {
    command,
    args,
    from: '120363400000000000@g.us',
    sender: '2348111000001@s.whatsapp.net',
    msg: { key: {}, message: {} },
    prefix: '.',
    sock,
    reply: async (t) => { sent.push({ text: String(t) }); return {}; },
  };
}

const body = () => {
  const m = sent[sent.length - 1] || {};
  return String(m.caption || m.text || '');
};

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fails.push(`${name} :: ${detail}`); console.log(`  \u2717 ${name}   ${detail}`); }
};

/* A real answer: matched the expected shape, and is not an error card. */
const good = (re) => {
  const b = body();
  const errored = /unreachable|isn't available yet|removed the endpoint|^❌/m.test(b);
  return { pass: re.test(b) && !errored, detail: `${b.replace(/\n/g, ' ').slice(0, 90)}` };
};

/* ── cases: [command, args, expectedShape] ───────────────────────────── */
const CASES = [
  // music — deezer
  ['track',      ['blinding lights'], /🎵|\*Tracks\*|TRACKS/i],
  ['tracks',     ['blinding lights'], /🎵|\*Tracks\*|TRACKS/i],
  ['musicsearch',['burna boy'],       /🎵|\*Tracks\*|TRACKS/i],
  ['songsearch', ['burna boy'],       /🎵|\*Tracks\*|TRACKS/i],
  ['album',      ['starboy'],         /ALBUM/i],
  ['artist',     ['the weeknd'],      /ARTIST/i],
  ['playlist',   ['chill'],           /PLAYLIST/i],
  ['genre',      [],                  /GENRE/i],

  // anime + manga — anilist (POST graphql)
  ['anilist',    ['naruto'],          /ANIME/i],
  ['anime',      ['naruto'],          /Score|Episode|ANIME/i],
  ['animesearch',['naruto'],          /ANIME/i],
  ['mal',        ['naruto'],          /ANIME/i],
  ['animeinfo',  ['naruto'],          /Score|Episode/i],
  ['character',  ['naruto'],          /CHARACTER/i],
  ['manga',      ['one piece'],       /MANGA/i],
  ['mangainfo',  ['one piece'],       /Score|Chapter/i],

  // tv / film — tvmaze
  ['series',     ['breaking bad'],    /RESULT|Breaking/i],
  ['tv',         ['breaking bad'],    /RESULT|Breaking/i],
  ['movie',      ['inception'],       /RESULT|Inception|key|no keyless/i],
  ['movies',     ['inception'],       /RESULT|Inception|key|no keyless/i],
  ['imdb',       ['inception'],       /RESULT|Inception|key|no keyless/i],

  // news — rss
  ['bbc',        [],                  /HEADLINE/i],
  ['cnn',        [],                  /HEADLINE/i],
  ['yahoo',      [],                  /HEADLINE/i],
  ['news',       [],                  /HEADLINE/i],

  // sport — espn
  ['nba',        [],                  /National Basketball|No games|offseason/i],
  ['nfl',        [],                  /National Football|No games|offseason/i],
  ['epl',        [],                  /Premier League|No games|offseason/i],
  ['laliga',     [],                  /LaLiga|La Liga|No games|offseason/i],
  ['ucl',        [],                  /Champions|No games|offseason/i],
  ['soccer',     [],                  /Premier League|soccer|No games/i],
  ['football',   [],                  /Premier League|No games|No fixtures/i],
  ['tennis',     [],                  /ATP|Tennis|No games|offseason/i],
  ['f1',         [],                  /Formula|F1|No games|offseason/i],
  ['cricket',    [],                  /Cricket|No games|No fixtures|International/i],
  ['sports',     [],                  /National Basketball|No games|offseason/i],
  ['score',      [],                  /National Basketball|No games|offseason/i],
  ['standings',  [],                  /Conference|Division|Standings/i],
  ['fixtures',   [],                  /National Basketball|Premier|No games|No fixtures|offseason/i],

  // food — cocktaildb / mealdb / openfoodfacts
  ['cocktail',   [],                  /Ingredient|No cocktail/i],
  ['drink',      [],                  /Ingredient|No cocktail/i],
  ['food',       [],                  /Ingredient|No recipe/i],
  ['recipe',     [],                  /Ingredient|No recipe/i],
  ['calories',   ['coca cola'],       /NUTRITION|kcal|per 100/i],
  ['nutrition',  ['coca cola'],       /NUTRITION|kcal|per 100/i],

  // misc — wikipedia / datamuse
  ['wikihow',    ['jollof rice'],      /WIKIPEDIA|Jollof/i],
  ['rhyme',      ['orange'],          /RHYME/i],
];

(async () => {
  console.log('\n\u2550\u2550 Search engine — live routes \u2550\u2550\n');

  const named = new Set((search.extraNames || []));
  console.log(`  engine declares ${named.size} command names\n`);

  /* 1. every declared name has a test case (and vice versa) */
  const tested = new Set(CASES.map((c) => c[0]));
  const untested = [...named].filter((n) => !tested.has(n));
  const extra = [...tested].filter((n) => !named.has(n));
  ok('every declared command is covered by a test', untested.length === 0, untested.join(', '));
  ok('no test exercises an undeclared command', extra.length === 0, extra.join(', '));

  /* 2. every declared name actually routes to this engine */
  const reg = require(path.join(ROOT, 'lib/registry.js'));
  const misrouted = [];
  for (const n of named) {
    const owner = reg.get(n);
    if (!owner || (owner.engine || owner.source || '').toString().toLowerCase().indexOf('search') === -1) {
      misrouted.push(`${n}→${owner ? (owner.engine || owner.source) : 'null'}`);
    }
  }
  ok('all names route to the search engine', misrouted.length === 0, misrouted.join(', '));

  /* 3. live answers */
  console.log('');
  const slow = [];
  let animePayload = null;
  for (const [cmd, args, re] of CASES) {
    const started = Date.now();
    try {
      await search.execute(ctx(cmd, args));
      if (cmd === 'anime' && args[0] === 'naruto') animePayload = sent[sent.length - 1];
      const r = good(re);
      ok(`.${cmd}${args.length ? ' ' + args.join(' ') : ''}`, r.pass, r.detail);
      if (Date.now() - started > 8000) slow.push(`.${cmd} ${Date.now() - started}ms`);
    } catch (e) {
      ok(`.${cmd}`, false, `threw: ${e.message}`);
    }
  }

  ok('.anime Naruto sends an AniList cover image, not text only',
     /anilist\.co/i.test(String(animePayload?.image?.url || '')) &&
     /NARUTO/i.test(String(animePayload?.caption || '')),
     `payload=${JSON.stringify(animePayload || {}).slice(0, 160)}`);

  /* 4. argument-required routes must refuse politely, not crash */
  console.log('');
  for (const cmd of ['track', 'album', 'artist', 'anime', 'anilist', 'animeinfo', 'character', 'manga', 'series', 'calories', 'wikihow', 'rhyme']) {
    try {
      await search.execute(ctx(cmd, []));
      const b = body();
      ok(`.${cmd} with no query asks for one`, /❌|Use \*/i.test(b) && b.length < 200, b.slice(0, 70));
    } catch (e) {
      ok(`.${cmd} with no query asks for one`, false, `threw: ${e.message}`);
    }
  }

  /* 5. junk input must not crash */
  console.log('');
  for (const junk of ['%%%', 'asdkjhasdkjhasd', '🚀🔥', 'a'.repeat(300)]) {
    try {
      await search.execute(ctx('rhyme', [junk]));
      ok(`.rhyme survives ${JSON.stringify(junk.slice(0, 12))}`, body().length > 0, 'empty reply');
    } catch (e) {
      ok(`.rhyme survives ${JSON.stringify(junk.slice(0, 12))}`, false, `threw: ${e.message}`);
    }
  }

  const total = pass + fails.length;
  console.log(`\n${pass}/${total} passed`);
  if (slow.length) console.log(`slow routes: ${slow.join(', ')}`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  \u2022 ' + f));
    process.exit(1);
  }
})();
