# ZYNEX-MD — verified free APIs

Every endpoint below was **probed live on 22 Nov 2026** (HTTP status + payload
checked). Anything that failed was dropped, not left in "just in case".

Rule of thumb: a `200` is not proof. `restcountries.com` returns **HTTP 200
with an error body** — it's fully deprecated while appearing healthy. That's
why every entry here has its payload shape noted.

## Working (keyless)

| API | Used by | Payload |
|---|---|---|
| `api.otakugifs.xyz/gif?reaction=` | `.hug .kiss .slap .pat` +38 | `{url}` → real GIF (200, ~800KB) |
| `nekos.life/api/v2/img/<tag>` | `.neko .waifu`, reaction fallback | `{url}` → real image |
| `api.thecatapi.com/v1/images/search` | `.cat` | `[{url}]` |
| `dog.ceo/api/breeds/image/random` | `.dog`, `.shibe` | `{message}` |
| `randomfox.ca/floof/` | `.fox` | `{image}` |
| `api.alquran.cloud/v1/*` | `.quran .ayah` | Arabic + Sahih translation |
| `api.aladhan.com/v1/timingsByCity` | `.prayer` | timings + Hijri date |
| `api.aladhan.com/v1/qibla` | `.qibla` | `{direction}` |
| `api.aladhan.com/v1/gToH` | `.hijri` | Hijri conversion |
| `api.worldbank.org/v2/country` | `.country` | capital, region, income, ISO2 |
| `flagcdn.com/w640/<iso2>.png` | `.country .flag` | flag image |
| `openlibrary.org/search.json` | `.book` | title, author, year |
| `bible-api.com/<ref>` | `.bible` | reference + text (WEB) |
| `api.coingecko.com/v3/simple/price` | `.crypto` | USD/NGN/EUR + 24h |
| `open.er-api.com/v6/latest/<cur>` | `.convert` | live FX rates |
| `api.coinbase.com/v2/exchange-rates` | `.currency` | FX fallback |
| `opentdb.com/api.php` | `.trivia` | multiple-choice questions |
| `api.dictionaryapi.dev` | `.dictionary` | definitions + examples |
| `poetrydb.org/random` | `.poem` | poem lines |
| `api.adviceslip.com/advice` | `.advice` | `{slip.advice}` |
| `catfact.ninja/fact` | `.catfact` | `{fact}` |
| `dog-api.kinduff.com/api/facts` | `.dogfact` | `{facts[]}` |
| `api.kanye.rest` | `.kanye` | `{quote}` |
| `corporatebs-generator.sameerkumar.website` | `.corporatebs` | `{phrase}` |
| `v2.jokeapi.dev/joke/Any` | `.joke` | `{joke}` |
| `icanhazdadjoke.com` | `.dadjoke` | `{joke}` |
| `zenquotes.io/api/random` | `.quote` | `[{q,a}]` |
| `uselessfacts.jsph.pl` | `.fact` | `{text}` |
| `en.wikipedia.org/rest_v1/page/summary` | `.wiki` | `{extract}` |
| `wttr.in/<city>?format=j1` | `.weather` | weather JSON |
| `api.urbandictionary.com/v0/define` | `.urban` | definitions |
| `api.streamelements.com/kappa/v2/speech` | `.tts` | MP3 audio |
| `api.mymemory.translated.net` | `.translate` | translation |
| `api.qrserver.com/v1/create-qr-code` | `.qr` | PNG |
| `api.deezer.com/search` | `.play .song` | 30s official preview + artwork |
| `itunes.apple.com/search` | `.play` fallback | 30s preview |
| `text.pollinations.ai/<prompt>` | `.chat .explain .codegen` +15 | plain-text answer, keyless |
| `image.pollinations.ai/prompt/<p>` | `.imagine .aiart .ghibli` +12 | JPEG bytes, keyless |
| `api.deezer.com/search` | `.track .album .artist .playlist .genre` | tracks, albums, artists, playlists |
| `graphql.anilist.co` (**POST**) | `.anilist .manga .animeinfo .mangainfo .character` | anime + manga metadata |
| `api.tvmaze.com/search/shows` | `.series .tv .movie .movies .imdb` | `[{show:{…}}]` |
| `feeds.bbci.co.uk/news/rss.xml` | `.bbc .news` | RSS `<item>` list |
| `rss.cnn.com/rss/edition.rss` | `.cnn` | RSS `<item>` list |
| `news.yahoo.com/rss/` | `.yahoo` | RSS `<item>` list |
| `site.api.espn.com/.../scoreboard` | `.nba .nfl .epl .laliga .ucl .soccer .football .tennis .f1 .cricket .sports .score .fixtures` | `events[]` — **needs browser UA, 403 to bots** |
| `site.api.espn.com/apis/v2/.../standings` | `.standings` | group tree → rows |
| `thecocktaildb.com/api/json/v1/1` | `.cocktail .drink` | drink + measures |
| `themealdb.com/api/json/v1/1` | `.food .recipe` | meal + measures |
| `world.openfoodfacts.net/api/v2/search` | `.calories .nutrition` | `products[]` + nutriments |
| `search.openfoodfacts.org/search` | `.calories .nutrition` fallback | `hits[]` |
| `en.wikipedia.org/w/api.php` | `.wikihow` | search + `prop=extracts` intros (needs UA) |
| `api.datamuse.com/words?rel_rhy=` | `.rhyme` | rhyming words |

## Rendering locally instead of calling out

| Feature | Why | Instead |
|---|---|---|
| `.neon .glitch .batman` +64 logos | `api.flamingtext.com` now **429s this host**, and its design URLs return `text/html` with HTTP 200 — the bot was sending web pages as images | `lib/logostyles.js`, SVG → `sharp`, zero requests |

## Rate-limited / conditional

| API | Behaviour |
|---|---|
| `world.openfoodfacts.org/cgi/search.pl` | **503 much of the time** — the engine falls back to `.net` and `search.openfoodfacts.org` |
| `site.api.espn.com` | **403 to any bot user-agent**, 200 to a browser UA. Send a browser UA. |
| `api.openfoodfacts` legacy search | slow (2-4s) even when it does answer |
| `text.pollinations.ai` | **~3 replies / 45s per IP**, 402 when over |
| `image.pollinations.ai` | **1 image / 45s per IP**, 503 when busy |
| `text.pollinations.ai/openai` (POST) | works but throttles harder than the GET route |
| `duckduckgo.com/duckchat/v1` | 418 `ERR_BN_LIMIT` — needs JS proof-of-work, unusable server-side |
| `api.deepinfra.com`, `api.airforce`, `chat.webllm.ai` | 401 / 402 / 405 — no free anonymous access |

## Dead — removed or replaced

| API | Status | Replaced with |
|---|---|---|
| `restcountries.com` (all versions) | **200 + error body**, deprecated | World Bank |
| `api.quotable.io` | DNS does not resolve | zenquotes |
| `co.wuk.sh` (Cobalt) | DNS does not resolve | Deezer |
| `paxsenix.dpdns.org` | 404 | Deezer |
| `ytdl-core` | 410 Gone | — (previews only) |
| `@distube/ytdl-core` | "Sign in to confirm you're not a bot" | — |
| Invidious `/latest_version` | serves HTML, not audio | — |
| `api.techyt.tech` etc. | 404 | — |
| `ipapi.co` | 429 rate-limited | `ip-api.com` |
| `exchangerate.host` | 401 (key now required) | `open.er-api.com` |
| `omdbapi.com` | 401 (key required) | — |
| `api.jikan.moe` | unreachable | — |
| `waifu.pics` | unreachable | nekos.life |
| `nekos.best` | 403 | nekos.life |
| `hadithapi.com` | 401 (key required) | — |
| `api.jikan.moe` (retry) | still times out — **do not retry** | AniList GraphQL |
| `wikihow.com/api.php` | 500 | Wikipedia search |
| `itunes.apple.com?media=movie` | 200 but `resultCount: 0` for every term | — (no keyless film DB) |
| `yts.mx` | unreachable | — |
| `kitsu.io` with raw `filter[text]` | empty body; needs `filter%5Btext%5D` | — |

## Why no keyed APIs

You asked for APIs that don't need registration. Every working entry above is
keyless. Where a key is unavoidable (OMDb, RapidAPI downloaders), the command
says so instead of failing silently.
