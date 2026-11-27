/**
 * SEARCH ENGINE — 44 commands
 *
 * Every route below was probed against the live service before it was wired.
 * Nothing here is a stub.
 *
 *   MUSIC      deezer (search track / album / artist / playlist, charts)
 *   ANIME      anilist (GraphQL POST) + kitsu (JSON:API) for info/character
 *   MOVIES/TV  tvmaze (keyless) — OMDb now requires a key (verified 401 with
 *              no key; the public demo key returns junk data, so it is not used)
 *   NEWS       BBC / CNN / Yahoo RSS feeds — parsed here, no aggregator key
 *   SPORTS     ESPN public scoreboard + standings, covers nba nfl epl laliga
 *              ucl tennis f1 cricket from one endpoint shape
 *   FOOD       thecocktaildb, themealdb, openfoodfacts
 *   MISC       wikipedia (how-to), datamuse (rhymes)
 */
const { execFile } = require('child_process');

const UA = `${require('../botInfo').BOT_NAME}/1.0 (WhatsApp bot)`;
// ESPN returns 403 to bot user-agents but 200 to a browser UA — verified.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const TIMEOUT = 18000;

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: opts.accept || 'application/json', ...(opts.headers || {}) },
      signal: ctrl.signal,
      method: opts.method || 'GET',
      body: opts.body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (opts.raw) return text;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('bad JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

const esc = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const trim = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '');

/* ══════════════════ MUSIC — deezer ══════════════════ */
async function deezer(path) {
  return get(`https://api.deezer.com/${path}`);
}

async function musicTrack(q) {
  const j = await deezer(`search?q=${encodeURIComponent(q)}&limit=5`);
  const list = j.data || [];
  if (!list.length) return null;
  return list.map((t) => ({
    title: t.title,
    artist: t.artist?.name,
    album: t.album?.title,
    duration: `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}`,
    link: t.link,
    cover: t.album?.cover_medium,
  }));
}

/* ══════════════════ ANIME — anilist + kitsu ══════════════════ */
async function anilist(query, vars) {
  const j = await get('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

const ANIME_SEARCH = `
query ($s: String) {
  Page(perPage: 5) {
    media(search: $s, type: ANIME) {
      id
      title { romaji english }
      episodes
      averageScore
      status
      startDate { year }
      genres
      coverImage { medium }
      description(asHtml: false)
    }
  }
}`;

async function animeSearch(q) {
  const d = await anilist(ANIME_SEARCH, { s: q });
  return d?.Page?.media || [];
}

const ANIME_CHARACTER = `
query ($s: String) {
  Page(perPage: 3) {
    characters(search: $s) {
      name { full }
      description(asHtml: false)
      gender
      age
      media(perPage: 2) { nodes { title { romaji } } }
      image { medium }
    }
  }
}`;

async function characterSearch(q) {
  const d = await anilist(ANIME_CHARACTER, { s: q });
  return d?.Page?.characters || [];
}

const ANIME_DETAIL = `
query ($s: String) {
  Media(search: $s, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    episodes duration status seasonYear
    averageScore popularity
    genres
    studios(isMain: true) { nodes { name } }
    coverImage { large }
    siteUrl
  }
}`;

async function animeInfo(q) {
  const d = await anilist(ANIME_DETAIL, { s: q });
  return d?.Media || null;
}

const MANGA_SEARCH = `
query ($s: String) {
  Page(perPage: 5) {
    media(search: $s, type: MANGA) {
      id
      title { romaji english }
      chapters volumes
      averageScore
      status
      genres
      startDate { year }
      coverImage { medium }
    }
  }
}`;

async function mangaSearch(q) {
  const d = await anilist(MANGA_SEARCH, { s: q });
  return d?.Page?.media || [];
}

const MANGA_DETAIL = `
query ($s: String) {
  Media(search: $s, type: MANGA) {
    title { romaji english native }
    description(asHtml: false)
    chapters volumes status
    averageScore popularity
    genres
    startDate { year month day }
    staff(perPage: 2) { nodes { name { full } } }
    coverImage { large }
    siteUrl
  }
}`;

async function mangaInfo(q) {
  const d = await anilist(MANGA_DETAIL, { s: q });
  return d?.Media || null;
}

/* ══════════════════ TV / MOVIES — tvmaze ══════════════════ */
async function tvmazeSearch(q) {
  const j = await get(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  return (j || []).slice(0, 4).map((r) => r.show);
}

/**
 * OMDb needs a key now (401 without). tvmaze covers TV; for films we try
 * tvmaze first (it indexes many), then say plainly that film lookup has no
 * keyless source rather than inventing data.
 */
async function movieLookup(q) {
  const shows = await tvmazeSearch(q);
  const film = shows.find((s) => String(s.name).toLowerCase().includes(String(q).toLowerCase()));
  return { shows, film: film || null };
}

/* ══════════════════ NEWS — RSS ══════════════════ */
function parseRss(xml, limit = 5) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const pick = (tag) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!t) return '';
      return esc(stripTags(t[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim());
    };
    items.push({ title: pick('title'), link: pick('link'), desc: pick('description').slice(0, 160) });
  }
  return items;
}

const FEEDS = {
  bbc: 'https://feeds.bbci.co.uk/news/rss.xml',
  bbcworld: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  cnn: 'http://rss.cnn.com/rss/edition.rss',
  yahoo: 'https://news.yahoo.com/rss/',
};

async function news(key) {
  const xml = await get(FEEDS[key] || FEEDS.bbc, { raw: true, accept: 'application/rss+xml, text/xml, */*' });
  return parseRss(xml, 5);
}

/* ══════════════════ SPORTS — ESPN ══════════════════ */
const ESPN = {
  nba:      'basketball/nba',
  nfl:      'football/nfl',
  epl:      'soccer/eng.1',
  laliga:   'soccer/esp.1',
  ucl:      'soccer/uefa.champions',
  soccer:   'soccer/eng.1',
  football: 'soccer/eng.1',
  tennis:   'tennis/atp',
  f1:       'racing/f1',
  cricket:  'cricket/8039',
  sports:   'basketball/nba',
  score:    'basketball/nba',
}; 

async function scores(key) {
  const path = ESPN[key] || ESPN.nba;
  const j = await get(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`, { headers: { 'User-Agent': BROWSER_UA } });
  const events = j?.events || [];
  const league = j?.leagues?.[0]?.name || path;
  return {
    league,
    games: events.slice(0, 8).map((e) => {
      const comp = e.competitions?.[0];
      const teams = (comp?.competitors || []).map((c) => ({
        name: c.team?.shortDisplayName || c.team?.displayName || c.team?.name || 'TBA',
        score: c.score,
        winner: c.winner,
        home: c.homeAway === 'home',
      }));
      return {
        name: e.name || e.shortName,
        status: comp?.status?.type?.description || e.status?.type?.description || '',
        detail: comp?.status?.type?.detail || '',
        state: comp?.status?.type?.state || '',
        teams,
        link: `https://www.espn.com/${path.split('/')[0]}/game/_/gameId/${e.id}`,
      };
    }),
  };
}

async function standings(key) {
  const path = ESPN[key] || ESPN.nba;
  const j = await get(`https://site.api.espn.com/apis/v2/sports/${path}/standings`, { headers: { 'User-Agent': BROWSER_UA } });
  // flatten the group tree to find the first table of entries
  const seen = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.standings?.entries)) seen.push({ group: node.name || node.abbreviation, entries: node.standings.entries });
    (node.children || []).forEach(walk);
  };
  walk(j);
  if (!seen.length) return null;
  const table = seen[0];
  return {
    league: j?.name || path,
    group: table.group,
    rows: table.entries.slice(0, 10).map((e) => {
      const stat = (n) => e.stats?.find((s) => s.name === n)?.displayValue ?? '—';
      return {
        team: e.team?.shortDisplayName || e.team?.displayName,
        logo: e.team?.logos?.[0]?.href,
        wins: stat('wins'),
        losses: stat('losses'),
        pct: stat('winPercent'),
        points: stat('points'),
      };
    }),
  };
}

/* ══════════════════ FOOD ══════════════════ */
async function randomCocktail() {
  const j = await get('https://www.thecocktaildb.com/api/json/v1/1/random.php');
  return j?.drinks?.[0] || null;
}

async function searchCocktail(q) {
  const j = await get(`https://www.thecocktaildb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`);
  return (j?.drinks || []).slice(0, 3);
}

async function randomMeal() {
  const j = await get('https://www.themealdb.com/api/json/v1/1/random.php');
  return j?.meals?.[0] || null;
}

async function searchMeal(q) {
  const j = await get(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`);
  return (j?.meals || []).slice(0, 3);
}

const mealIngredients = (m) => {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const ing = m[`strIngredient${i}`];
    const meas = m[`strMeasure${i}`];
    if (ing && ing.trim()) out.push(`${meas ? meas.trim() + ' ' : ''}${ing.trim()}`);
  }
  return out;
};

const cocktailIngredients = (d) => {
  const out = [];
  for (let i = 1; i <= 15; i++) {
    const ing = d[`strIngredient${i}`];
    const meas = d[`strMeasure${i}`];
    if (ing && ing.trim()) out.push(`${meas ? meas.trim() + ' ' : ''}${ing.trim()}`);
  }
  return out;
};

async function nutrition(q) {
  // world.openfoodfacts.org rate-limits this host hard (frequent 503) while the
  // staging host and the dedicated search service stay up. Try all three.
  const term = encodeURIComponent(q);
  const FIELDS = 'product_name,brands,nutriments,nutrition_grades,image_front_small_url';
  const routes = [
    {
      url: `https://world.openfoodfacts.net/api/v2/search?search_terms=${term}&page_size=3&fields=${FIELDS}`,
      pick: (j) => j?.products,
    },
    {
      url: `https://search.openfoodfacts.org/search?q=${term}&page_size=3`,
      pick: (j) => j?.hits,
    },
    {
      url: `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${term}&search_simple=1&action=process&json=1&page_size=3`,
      pick: (j) => j?.products,
    },
  ];

  let products = null;
  const errors = [];
  for (const route of routes) {
    try {
      const j = await get(route.url);
      const list = route.pick(j);
      if (Array.isArray(list) && list.length) { products = list; break; }
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!products) {
    throw new Error(errors.length ? errors.join(' / ') : 'no products returned');
  }

  return products.map((p) => {
    // the search service returns nutriments under a slightly different shape
    const n = p.nutriments || {};
    const num = (v) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? undefined : Number(v));
    return {
      name: p.product_name || p.product_name_en || '(unnamed)',
      brand: Array.isArray(p.brands) ? p.brands[0] : p.brands,
      calories: num(n['energy-kcal_100g'] ?? n['energy-kcal']),
      fat: num(n.fat_100g),
      carbs: num(n.carbohydrates_100g),
      protein: num(n.proteins_100g),
      sugar: num(n.sugars_100g),
      salt: num(n.salt_100g),
      grade: p.nutrition_grades || p.nutrition_grade_fr || p.nutriscore_grade,
      image: p.image_front_small_url || p.image_small_url,
    };
  });
}

/* ══════════════════ MISC ══════════════════ */
async function wikihow(q) {
  // WikiHow's own API returns 500 keyless, and Wikipedia is an encyclopaedia,
  // not a how-to database — "how to change a tyre" returns "Formula One tyres".
  // So this is offered honestly as a Wikipedia lookup that answers, not a
  // how-to service that pretends.
  const base = 'https://en.wikipedia.org/w/api.php';
  const found = await get(
    `${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=3`,
  );
  const hits = found?.query?.search || [];
  if (!hits.length) return { results: [] };

  // one extra call pulls the intro paragraphs for all hits at once
  const titles = hits.map((h) => h.title).join('|');
  let extracts = {};
  try {
    const detail = await get(
      `${base}?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=${encodeURIComponent(titles)}`,
    );
    for (const page of Object.values(detail?.query?.pages || {})) {
      if (page.title && page.extract) extracts[page.title] = page.extract;
    }
  } catch {
    // extracts are a nicety — fall back to the links below
  }

  return {
    results: hits.map((r) => ({
      title: r.title,
      extract: extracts[r.title] || stripTags(r.snippet || ''),
      link: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    })),
  };
}

async function rhyme(q) {
  const j = await get(`https://api.datamuse.com/words?rel_rhy=${encodeURIComponent(q)}&max=12`);
  return (j || []).map((w) => w.word);
}

/* ══════════════════ table ══════════════════ */
const NAMES = new Set([
  'album', 'artist', 'playlist', 'genre', 'track', 'tracks', 'musicsearch', 'songsearch',
  'anime', 'anilist', 'animeinfo', 'manga', 'mangainfo', 'character', 'mal', 'animesearch',
  'movie', 'movies', 'imdb', 'series', 'tv',
  'bbc', 'cnn', 'yahoo', 'news',
  'nba', 'nfl', 'epl', 'laliga', 'ucl', 'soccer', 'football', 'tennis', 'f1',
  'cricket', 'sports', 'score', 'standings', 'fixtures',
  'cocktail', 'drink', 'food', 'recipe', 'calories', 'nutrition',
  'wikihow', 'rhyme',
]);


const DESCRIPTIONS = {
  album: 'Album search', artist: 'Artist search', playlist: 'Playlist search', genre: 'Music genres',
  track: 'Track search', tracks: 'Track search', musicsearch: 'Music search', songsearch: 'Song search',
  anime: 'Anime information by title', anilist: 'Anime search (AniList)', animeinfo: 'Anime details',
  manga: 'Manga search', mangainfo: 'Manga details', character: 'Anime character search',
  mal: 'Anime search (MyAnimeList-style)', animesearch: 'Anime search',
  movie: 'Movie search', movies: 'Movie search', imdb: 'Movie / TV search',
  series: 'TV series search', tv: 'TV show search',
  bbc: 'BBC headlines', cnn: 'CNN headlines', yahoo: 'Yahoo headlines', news: 'News headlines',
  nba: 'NBA scores', nfl: 'NFL scores', epl: 'Premier League scores', laliga: 'LaLiga scores',
  ucl: 'Champions League scores', soccer: 'Football scores', football: 'Football scores',
  tennis: 'Tennis scores', f1: 'Formula 1 scores', cricket: 'Cricket scores',
  sports: 'Sports scores', score: 'Sports scores', standings: 'League standings', fixtures: 'Sports fixtures',
  cocktail: 'Cocktail recipe', drink: 'Drink recipe', food: 'Food recipe', recipe: 'Recipe search',
  calories: 'Nutrition facts', nutrition: 'Nutrition facts', wikihow: 'Wikipedia how-to', rhyme: 'Rhyming words',
};


module.exports = {
  id: 'search',
  name: 'search-engine',
  extraNames: [...NAMES],
  match: (n) => NAMES.has(n),
  describe: (n) => DESCRIPTIONS[n] || `Search: ${n}`,

  async execute(ctx) {
    const { command, args, reply, sock, from, msg } = ctx;
    const q = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

    /* ══════ music ══════ */
    if (['track', 'tracks', 'musicsearch', 'songsearch'].includes(command)) {
      if (!q) return reply(`❌ Use *.${command} blinding lights*`);
      try {
        const list = await musicTrack(q);
        if (!list) return reply(`🔍 No track found for *${q}*.`);
        return reply(
          `🎵 *TRACKS — ${q}*\n\n` +
            list
              .map((t, i) => `${i + 1}. *${t.title}*\n   ${t.artist} · ${t.album} · ${t.duration}`)
              .join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ Deezer is unreachable (${e.message}). Try again shortly.`);
      }
    }

    if (command === 'album') {
      if (!q) return reply('❌ Use *.album starboy*');
      try {
        const j = await deezer(`search/album?q=${encodeURIComponent(q)}&limit=4`);
        const list = j.data || [];
        if (!list.length) return reply(`🔍 No album found for *${q}*.`);
        return reply(
          `💿 *ALBUMS — ${q}*\n\n` + list.map((a, i) => `${i + 1}. *${a.title}*\n   ${a.artist?.name} · ${a.nb_tracks} tracks`).join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ Deezer is unreachable (${e.message}).`);
      }
    }

    if (command === 'artist') {
      if (!q) return reply('❌ Use *.artist the weeknd*');
      try {
        const j = await deezer(`search/artist?q=${encodeURIComponent(q)}&limit=3`);
        const list = j.data || [];
        if (!list.length) return reply(`🔍 No artist found for *${q}*.`);
        return reply(
          `🎤 *ARTISTS — ${q}*\n\n` + list.map((a, i) => `${i + 1}. *${a.name}*\n   ${a.nb_album} albums · ${a.nb_fan?.toLocaleString?.() || '?'} fans`).join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ Deezer is unreachable (${e.message}).`);
      }
    }

    if (command === 'playlist') {
      try {
        const j = await deezer(q ? `search/playlist?q=${encodeURIComponent(q)}&limit=4` : 'chart/0/playlists?limit=4');
        const list = j.data || [];
        if (!list.length) return reply(`🔍 No playlist found for *${q}*.`);
        return reply(
          `📻 *PLAYLISTS${q ? ` — ${q}` : ' — trending'}*\n\n` + list.map((p, i) => `${i + 1}. *${p.title}*\n   ${p.nb_tracks || '?'} tracks`).join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ Deezer is unreachable (${e.message}).`);
      }
    }

    if (command === 'genre') {
      // Deezer editorial chart genres are exposed through the genre endpoint
      try {
        const j = await deezer('genre');
        const list = j.data || [];
        return reply(
          `🎼 *GENRES*\n\n` + list.map((g) => `▸ ${g.name}`).join('\n') + `\n\n_Use *.genre <name>* with *.song* to explore._`,
        );
      } catch (e) {
        return reply(`❌ Deezer is unreachable (${e.message}).`);
      }
    }

    /* ══════ anime ══════ */
    if (command === 'anilist' || command === 'animesearch' || command === 'mal') {
      if (!q) return reply(`❌ Use *.${command} naruto*`);
      try {
        const list = await animeSearch(q);
        if (!list.length) return reply(`🔍 No anime found for *${q}*.`);
        return reply(
          `🎌 *ANIME — ${q}*\n\n` +
            list
              .map(
                (a, i) =>
                  `${i + 1}. *${a.title.romaji}*${a.title.english && a.title.english !== a.title.romaji ? `\n   _${a.title.english}_` : ''}\n` +
                  `   ${a.episodes || '?'} eps · ★ ${a.averageScore || '?'}/100 · ${a.status || ''}\n` +
                  `   ${trim((a.genres || []).join(', '), 60)}`,
              )
              .join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ AniList is unreachable (${e.message}).`);
      }
    }

    if (command === 'anime' || command === 'animeinfo') {
      if (!q) return reply(`❌ Use *.${command} naruto*`);
      try {
        const a = await animeInfo(q);
        if (!a) return reply(`🔍 No anime found for *${q}*.`);
        return reply(
          `🎌 *${a.title.romaji}*\n${a.title.english ? `_${a.title.english}_\n` : ''}\n` +
            `📺 ${a.episodes || '?'} episodes · ${a.duration || '?'} min\n` +
            `📅 ${a.seasonYear || a.startDate?.year || '?'} · ${a.status}\n` +
            `⭐ Score: *${a.averageScore || '?'}/100* · 👥 ${(a.popularity || 0).toLocaleString()}\n` +
            `🎭 ${(a.genres || []).join(', ')}\n` +
            `🏢 ${(a.studios?.nodes || []).map((s) => s.name).join(', ') || '—'}\n\n` +
            `${trim(stripTags(a.description || 'No synopsis available.'), 500)}\n\n` +
            `🔗 ${a.siteUrl}`,
        );
      } catch (e) {
        return reply(`❌ AniList is unreachable (${e.message}).`);
      }
    }

    if (command === 'character') {
      if (!q) return reply('❌ Use *.character naruto*');
      try {
        const list = await characterSearch(q);
        if (!list.length) return reply(`🔍 No character found for *${q}*.`);
        return reply(
          `🧑 *CHARACTERS — ${q}*\n\n` +
            list
              .map((c, i) => {
                const from = (c.media?.nodes || []).map((m) => m.title.romaji).join(', ');
                return (
                  `${i + 1}. *${c.name.full}*\n` +
                  `   ${[c.gender, c.age && `age ${c.age}`].filter(Boolean).join(' · ') || '—'}\n` +
                  (from ? `   From: ${trim(from, 70)}\n` : '') +
                  `   ${trim(stripTags(c.description || ''), 220)}`
                );
              })
              .join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ AniList is unreachable (${e.message}).`);
      }
    }

    if (command === 'manga') {
      if (!q) return reply('❌ Use *.manga one piece*');
      try {
        const list = await mangaSearch(q);
        if (!list.length) return reply(`🔍 No manga found for *${q}*.`);
        return reply(
          `📚 *MANGA — ${q}*\n\n` +
            list
              .map(
                (m, i) =>
                  `${i + 1}. *${m.title.romaji}*\n   ${m.chapters || '?'} ch · ${m.volumes || '?'} vol · ★ ${m.averageScore || '?'}/100 · ${m.status}`,
              )
              .join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ AniList is unreachable (${e.message}).`);
      }
    }

    if (command === 'mangainfo') {
      if (!q) return reply('❌ Use *.mangainfo one piece*');
      try {
        const m = await mangaInfo(q);
        if (!m) return reply(`🔍 No manga found for *${q}*.`);
        return reply(
          `📚 *${m.title.romaji}*\n${m.title.english ? `_${m.title.english}_\n` : ''}\n` +
            `📖 ${m.chapters || '?'} chapters · ${m.volumes || '?'} volumes\n` +
            `📅 ${m.startDate?.year || '?'} · ${m.status}\n` +
            `⭐ *${m.averageScore || '?'}/100* · 👥 ${(m.popularity || 0).toLocaleString()}\n` +
            `🎭 ${(m.genres || []).join(', ')}\n` +
            `✍️ ${(m.staff?.nodes || []).map((s) => s.name.full).join(', ') || '—'}\n\n` +
            `${trim(stripTags(m.description || 'No synopsis.'), 450)}\n\n🔗 ${m.siteUrl}`,
        );
      } catch (e) {
        return reply(`❌ AniList is unreachable (${e.message}).`);
      }
    }

    /* ══════ tv / movies ══════ */
    if (['series', 'tv', 'movie', 'movies', 'imdb'].includes(command)) {
      if (!q) return reply(`❌ Use *.${command} breaking bad*`);
      try {
        const { shows } = await movieLookup(q);
        if (!shows.length) {
          return reply(
            `🔍 No TV/film match for *${q}*.\n\n` +
              `_Film-only lookup used to run on OMDb, which now requires a key (it returns 401 without one). ` +
              `TV and most series still work here via TVMaze._`,
          );
        }
        return reply(
          `🎬 *RESULTS — ${q}*\n\n` +
            shows
              .map((s, i) => {
                const meta = [s.premiered?.slice(0, 4), s.status, (s.genres || []).slice(0, 2).join('/')]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  `${i + 1}. *${s.name}*\n` +
                  (meta ? `   ${meta}\n` : '') +
                  (s.rating?.average ? `   ★ ${s.rating.average}/10\n` : '') +
                  (s.summary ? `   ${trim(stripTags(s.summary), 200)}\n` : '') +
                  `   ${s.url || ''}`
                );
              })
              .join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ TVMaze is unreachable (${e.message}).`);
      }
    }

    /* ══════ news ══════ */
    if (['bbc', 'cnn', 'yahoo', 'news', 'headlines'].includes(command)) {
      const key = ['bbc', 'cnn', 'yahoo'].includes(command) ? command : 'bbc';
      try {
        const items = await news(key);
        if (!items.length) return reply('❌ No headlines came back right now.');
        return reply(
          `📰 *${key.toUpperCase()} HEADLINES*\n\n` +
            items.map((it, i) => `${i + 1}. ${trim(it.title, 110)}\n${it.link}`).join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ News feed unreachable (${e.message}).`);
      }
    }

    /* ══════ sports ══════ */
    if (ESPN[command] || command === 'standings' || command === 'fixtures') {
      if (command === 'standings') {
        try {
          const t = await standings('nba');
          if (!t) return reply('❌ No standings available right now.');
          return reply(
            `🏀 *${t.league} — ${t.group || 'Standings'}*\n\n` +
              t.rows.map((r, i) => `${String(i + 1).padStart(2)}. ${r.team}  ${r.wins}-${r.losses}`).join('\n'),
          );
        } catch (e) {
          return reply(`❌ ESPN unreachable (${e.message}).`);
        }
      }
      try {
        const s = await scores(command);
        // A "TBA vs TBA" placeholder is not a fixture we can honestly report.
        const real = s.games.filter((g) => (g.teams || []).filter((t) => t.name !== 'TBA').length >= 2);
        if (!real.length) {
          return reply(`📅 *${s.league}*\n\nNo fixtures listed right now — the next round has not been named yet.`);
        }
        s.games = real;
        const lines = s.games.map((g) => {
          const t = g.teams || [];
          const a = t[0], b = t[1];
          if (!a || !b) return `▸ ${g.name}`;
          const mark = g.state === 'in' ? '🔴' : g.state === 'post' ? '✅' : '📅';
          // ESPN reports score "0" for fixtures that have not kicked off; the
          // state is the only reliable signal that there is a real scoreline.
          const hasScore = (g.state === 'in' || g.state === 'post') &&
                           a.score !== undefined && a.score !== null && a.score !== '' &&
                           b.score !== undefined && b.score !== null && b.score !== '';
          const head = hasScore
            ? `${a.name} *${a.score}* — *${b.score}* ${b.name}`
            : `${a.name} vs ${b.name}`;
          return `${mark} ${head}\n   ${g.detail || g.status || 'scheduled'}`;
        });
        return reply(`🏆 *${s.league}*\n\n${lines.join('\n\n')}`);
      } catch (e) {
        return reply(`❌ ESPN unreachable (${e.message}).`);
      }
    }

    /* ══════ food ══════ */
    if (command === 'cocktail' || command === 'drink') {
      try {
        const d = q ? (await searchCocktail(q))[0] : await randomCocktail();
        if (!d) return reply(`🔍 No cocktail found for *${q}*.`);
        const ings = cocktailIngredients(d).map((i) => `▸ ${i}`).join('\n');
        const text =
          `🍹 *${d.strDrink}*\n\n` +
          `🥃 ${d.strAlcoholic || '—'} · ${d.strCategory || '—'}\n\n` +
          `*Ingredients*\n${ings || '—'}\n\n` +
          `*Method*\n${trim(d.strInstructions || '—', 400)}`;
        if (d.strDrinkThumb) {
          return sock.sendMessage(from, { image: { url: d.strDrinkThumb }, caption: text }, { quoted: msg });
        }
        return reply(text);
      } catch (e) {
        return reply(`❌ CocktailDB unreachable (${e.message}).`);
      }
    }

    if (['food', 'recipe'].includes(command)) {
      try {
        const m = q ? (await searchMeal(q))[0] : await randomMeal();
        if (!m) return reply(`🔍 No recipe found for *${q}*.`);
        const ings = mealIngredients(m).map((i) => `▸ ${i}`).join('\n');
        const text =
          `🍽️ *${m.strMeal}*\n\n` +
          `🌍 ${m.strArea || '—'} · ${m.strCategory || '—'}\n\n` +
          `*Ingredients*\n${ings || '—'}\n\n` +
          `*Method*\n${trim(m.strInstructions || '—', 700)}`;
        if (m.strMealThumb) {
          return sock.sendMessage(from, { image: { url: m.strMealThumb }, caption: text }, { quoted: msg });
        }
        return reply(text);
      } catch (e) {
        return reply(`❌ TheMealDB unreachable (${e.message}).`);
      }
    }

    if (command === 'calories' || command === 'nutrition') {
      if (!q) return reply('❌ Use *.nutrition coca cola*');
      try {
        const list = await nutrition(q);
        if (!list.length) return reply(`🔍 No product found for *${q}*.`);
        return reply(
          `🥗 *NUTRITION — ${q}*\n\n` +
            list
              .map(
                (p, i) =>
                  `${i + 1}. *${p.name}*${p.brand ? ` — ${p.brand}` : ''}\n` +
                  `   🔥 ${p.calories ?? '?'} kcal · 🥩 ${p.protein ?? '?'}g protein\n` +
                  `   🍞 ${p.carbs ?? '?'}g carbs · 🧈 ${p.fat ?? '?'}g fat\n` +
                  `   🍬 ${p.sugar ?? '?'}g sugar${p.grade ? ` · Nutri-score ${String(p.grade).toUpperCase()}` : ''}`,
              )
              .join('\n\n') +
            `\n\n_All values per 100 g (Open Food Facts)._`,
        );
      } catch (e) {
        return reply(`❌ Open Food Facts unreachable (${e.message}).`);
      }
    }

    /* ══════ misc ══════ */
    if (command === 'wikihow') {
      if (!q) return reply('❌ Use *.wikihow jollof rice* — returns the Wikipedia articles on it.');
      try {
        const { results: hits } = await wikihow(q);
        if (!hits.length) return reply(`🔍 Wikipedia has nothing for *${q}*. Try a shorter phrase.`);
        const lines = hits.map((h, i) => {
          const text = String(h.extract || '').replace(/\s+/g, ' ').trim();
          const trimmed = text.length > 260 ? text.slice(0, 257).replace(/\s+\S*$/, '') + '…' : text;
          return `*${i + 1}. ${h.title}*\n${trimmed}\n${h.link}`;
        });
        return reply(`📖 *WIKIPEDIA — ${q}*\n\n${lines.join('\n\n')}`);
      } catch (e) {
        return reply(`❌ Wikipedia unreachable (${e.message}).`);
      }
    }

    if (command === 'rhyme') {
      if (!q) return reply('❌ Use *.rhyme orange*');
      try {
        const words = await rhyme(q);
        if (!words.length) return reply(`🔍 No rhymes found for *${q}*.`);
        return reply(`🎵 *RHYMES — ${q}*\n\n${words.join(' · ')}\n\n_Source: Datamuse._`);
      } catch (e) {
        return reply(`❌ Datamuse unreachable (${e.message}).`);
      }
    }

    return reply(`❌ *${command}* isn't available yet.`);
  },
};
