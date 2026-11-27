# Command-truth audit — pass 2: search, anime, dictionary and image names

**Request:** “some commands that doesn't work very well … `.bing` … `.anime
Naruto` … like alot of others commands too not doing exactly wat he suppose
does”; then “Yeah it is only 2 I can do buh u know I cant do everything finish
so do the remaining one make them wrk”.

**Scope:** finish the researched command-truth mismatches in the local repo.
Do not touch `.rate`, `.vv dm`, the badge/tick, the API-key layer, Supabase,
Vercel, Railway, or any unknown/ambiguous command. No commit, push, deploy or
live WhatsApp retest was authorized for this pass.

---

## 1. Research first

There is **no universal WhatsApp-bot command standard**, so public bots and
provider docs were used as *convention evidence*, never as law:

- `.bing <query>` is expected to return **Bing web results**. `hubot-search`
  queries the Bing Search API and returns the first results; an older WhatsApp
  search-bot article describes Bing + Wikipedia search. The official Bing Search
  APIs were retired on 11 August 2025; the current replacement is not a drop-in
  raw-SERP API. Bing's public `?format=rss` endpoint still returned a 200 XML
  feed with 10 result items in a live probe from this workspace. It is an
  unofficial, personal/non-commercial RSS feed and may change.
- `.anime <title>` is documented as **AniList anime information** in Pah-0's
  `neon_bot`; other bots use `#anime <name>` for anime info, while a smaller
  convention uses plain `.anime` for random artwork. Because the user's example
  was `.anime Naruto`, the title-information meaning wins; random artwork moves
  to names that say what they do.
- `/define`, `/synonyms` and `/antonyms` mean word meaning, similar words and
  opposites respectively. Free Dictionary API provides definitions; Datamuse's
  `rel_syn` and `rel_ant` provide real relationships.
- PFP/DP means **profile/display picture**, not a random catgirl. Baileys'
  `sock.profilePictureUrl(jid, 'image')` returns the actual WhatsApp profile
  picture; `.getpp`, `.pfp`, `.avatar` and `.getdp` now use it. Existing
  `.profilepic` and `.dp` set-picture commands were left alone.
- `.gimage` is usually **Google image search** and `.wallpaper` is a generic
  wallpaper. Google HTML from this host returned only consent/JS shells; DDG
  HTML returned a 202 challenge, Yahoo returned 500, and `loremflickr` returned
  500. Rather than mislabel a `neko` image as a Google image or a wallpaper,
  provider-specific names were left as honest fallback stubs and neutral Picsum
  photos were used where a generic photo is genuinely delivered.
- `.naruto` is a *text-logo maker* name, not an anime-info command. Its
  description now says `naruto text logo`.

Provider probes: Bing RSS 200 XML / 10 items; DDG Instant 200 JSON; DDG HTML
202 challenge / 0 results; Google Chrome UA 200 HTML / 0 `<h3>`; Yahoo 500;
Picsum 200 JPEG; Datamuse `rel_syn=happy` → halcyon/content/bright, `rel_ant=happy`
→ sad/distressed/unhappy.

---

## 2. Corrections

| Family | Before | Now |
|---|---|---|
| `.bing`, `.bingsearch` | Generic `tools` SEARCH branch replied with a Google/DDG/Wikipedia link salad and called it Bing | Dedicated file command parses Bing's public RSS and returns numbered real results; footer says `Bing public RSS` so the provider is honest |
| `.google`, `.g`, `.search` | Advertised Google results while using DuckDuckGo | Dedicated file command labels the DDG Instant Answer and supplies a real Google search link; no fake SERP |
| `.gsearch`, `.duckduckgo`, `.ddg`, `.urban` | Same generic link salad for every provider | Provider-specific descriptions; DDG uses the instant answer + DDG link, Urban uses Urban Dictionary, `.gsearch` uses parsed Bing results and names Bing RSS as the source |
| `.wiki`, `.wikipedia` | Wikipedia lookup used undeclared `BOT_NAME` / `REPO_URL` variables, so its User-Agent could crash; `.define` was an alias | Wikipedia summary with those values imported from `lib/botInfo.js`; `.define` removed from the aliases |
| `.define`, `.dictionary`, `.dict`, `.meaning` | Wikipedia lookup | Free Dictionary API definitions/phonetics/part of speech/examples |
| `.synonym`, `.synonyms`, `.antonym`, `.antonyms`, `.thesaurus` | Definition or generic search | Datamuse relationship words; `.thesaurus` combines synonyms and antonyms |
| `.anime`, `.animeinfo` | Random catgirl/neko image even for `.anime Naruto` | AniList GraphQL information by title; episodes, status, score, genres, synopsis and site URL. No query asks for a title |
| `.animepic`, `.randomanime`, `.animeimg`, `.animeimage` | No explicit honest home | Random anime artwork, preserving the old image behaviour under names that say it |
| `.getpp`, `.pfp`, `.avatar`, `.getdp` | Random image / fallback | Real target profile picture via Baileys, caption tags `@number`, matching `mentions` list, graceful `404` handling |
| `.wallpaper`, `.wp`, `.randompic`, `.picture` | `neko` image mislabelled as a wallpaper | Neutral Picsum photo buffer with a truthful caption; anime is never claimed |
| `.naruto` | `Name text logo` | `naruto text logo` |
| `.image`, `.img`, `.gimage`, `.unsplash`, `.pexels`, `.pixabay` | Not backed by a working keyless provider | Left as honest fallback stubs: no fake Google/Unsplash/Pexels/Pixabay results |

`.hidetag` remains silent, `.tagall` remains visible, `.rate` is untouched,
`.vv dm` is untouched, and the badge/tick is untouched.

---

## 3. New implementation files

- `lib/webSearch.js` — Bing RSS parsing, provider-honest formatting, DDG Instant
  Answer, short `fetch` helper, and safe link builders.
- `lib/commands/bing.js` — `.bing` / `.bingsearch` real Bing results.
- `lib/commands/google.js` — `.google` / `.g` / `.search` DDG answer + Google link.
- `lib/commands/wiki.js` — Wikipedia summary with configured identity.
- `lib/commands/getpp.js` — `.getpp` / `.pfp` / `.avatar` / `.getdp` profile
  picture.

Modified: `lib/engines/tools.js`, `lib/engines/info.js`, `lib/engines/search.js`,
`lib/engines/media.js`, `lib/engines/text.js`, `lib/catalogue/commands.js`,
`scripts/search-test.cjs`, `scripts/command-truth-test.cjs`,
`scripts/audit-fixes-test.cjs`, `scripts/mentions-test.cjs`, package
scripts/description, README, AUDIT, COMMAND-TRUTH (historical note), and the
five README stat SVGs. New: `scripts/command-truth-2-test.cjs` and this report.

---

## 4. Validation

- `npm run test:all` → **57 suites, exit 0**, **0 `✗`**.
- `scripts/command-truth-2-test.cjs` → **19/19** with mocked network calls.
- `scripts/search-test.cjs` includes live `.anime naruto` (AniList) and a
  no-query guard; full run passed.
- `node --check` passes on every changed JavaScript file.
- `node scripts/audit-commands.cjs`: **audit clean**, **1,373 / 2,209 names
  implemented (62.2%)**, **210 file-owned · 1,163 engine-backed · 836 stubs**.
- Direct smoke: `.bing Naruto` returned `Naruto - Wikipedia` and its Wikipedia
  link; `.anime Naruto` returned `NARUTO` and `220 episodes · 23 min`.
- No live WhatsApp retest was possible from this workspace.

**Delivery status:** this pass was validated locally. GitHub/Railway deployment
is a separate action; Railway auto-deploy is off, so a manual **Redeploy** is
needed to pick up pushed changes. No Railway, Supabase or Vercel call, and no
API key, was made. The previously supplied raw GitHub PAT and Railway token
should still be rotated/revoked.

---

## Sources used for meaning, not copied code

- Bing convention / retired API / RSS: [1](https://github.com/ClaudeBot/hubot-search), [2](https://www.virtualcuriosities.com/articles/2543/how-to-use-rss-to-subscribe-to-search-results-on-bing), [3](https://github.com/macieklamberski/feedscout/pull/643), [4](https://cloro.dev/blog/bing-search-api-key/), [5](https://oden-api.com/blog/bing-web-search-api-retired-alternatives-2026)
- Anime convention / AniList: [6](https://github.com/Team-Lethargic/Whatsapp-Anime-Bot), [7](https://github.com/SomnathDas/Whatsapp-botto-re), [8](https://github.com/Pah-0/neon_bot), [9](https://freeapihub.com/apis/anilist)
- Dictionary / word relations: [10](https://dev.to/trushmi/how-to-use-free-dictionary-api-gec), [11](https://learn.microsoft.com/en-us/connectors/datamuseip/), [12](https://github.com/suyashb95/wordbot/blob/master/README.md)
- PFP meaning / Baileys: [13](https://www.npmjs.com/package/@whiskeysockets/baileys), [14](https://baileys.wiki/messaging/chat-management)
- Image command convention: [15](https://github.com/mursalin3352/M-KING-Bot)
