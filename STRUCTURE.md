# ZYNEX-MD — file structure

Generated from the tree at commit `d3fdb8a` on `main`.
`node_modules/` and `.git/` omitted. Line counts are real (`wc -l`), not estimates.

```
zynex-md/
│
├── server.js                     entry point, 8.6 KB — two modes:
│                                   PANEL_MODE=0 → Express dashboard
│                                   otherwise    → lib/panelBot.js
│
├── lib/                          ← the bot itself (984 KB)
│   ├── registry.js              182  file → engine → fallback resolution; 2,139 names
│   ├── handler.js               357  message router; builds the ctx every engine receives
│   ├── bot.js                   259  Baileys socket, auth, reconnect
│   ├── panelBot.js              278  dashboard-driven bot lifecycle
│   ├── sessionManager.js        944  pair-code / QR session handling
│   ├── db.js                     63  SQLite (better-sqlite3)
│   ├── secstore.js               83  data/security.json with 250 ms debounce
│   │
│   ├── ffmpeg.js                116  convert(input, argsArray, {inExt,outExt}) → {ok,buffer,stderr}
│   ├── logo.js                  214  render(name, text) — local sharp SVG
│   ├── logostyles.js            602  59 logo styles
│   ├── chess.js                 145  move legality, PGN/FEN
│   ├── chessboard.js            164  board → SVG
│   ├── gameboard.js             408  shared game renderer
│   ├── createFakeContact.js      52  vCard generation
│   │
│   ├── engines/                  ← 20 files, 9,587 lines
│   │   ├── games.js            1553  chess, hangman, tic-tac-toe, 2048, quiz, word games
│   │   ├── security.js          877  .scan, TOTP, hashes, SSL, RDAP, Safe Browsing
│   │   ├── search.js            823  music, anime, TV, news, recipes, Wikipedia, dict
│   │   ├── converter.js         708  images, PDFs, quotes, emoji kitchen, screenshots
│   │   ├── sticker.js           699  35 sticker commands, 512×512 WebP + alpha
│   │   ├── util.js              647  NEW — WHOIS, DNS, ports, HTTP, zip, PDF
│   │   ├── economy.js           597  wallet, bank, daily, shop, gambling
│   │   ├── stalk.js             504  public profiles + deliberate refusals
│   │   ├── group.js             478  admin, antilink config, welcome
│   │   ├── ai.js                429  text + image generation (keyless backend)
│   │   ├── art.js               425  NEW — figlet, ASCII art, code→PNG, hashtags
│   │   ├── tools.js             312  ip, headers, sysinfo, encode/decode
│   │   ├── info.js              290  bot/group/user info, stats
│   │   ├── islamic.js           232  Qur'an, prayer times, hadith (where sourced)
│   │   ├── fun.js               222  jokes, quotes, 8ball, truth/dare, love calc
│   │   ├── downloader.js        203  media downloaders
│   │   ├── text.js              195  case, reverse, fancy text, counters
│   │   ├── audio.js             166  TTS, audio effects via ffmpeg
│   │   ├── reactions.js         138  anime reactions (otakugifs, nekos.life)
│   │   └── media.js              89  image search / meme helpers
│   │
│   ├── commands/                 53 hand-written commands — these WIN over engines
│   │   │                           8ball alive alwaysonline autorespond block
│   │   │                           calculate coinflip dare delete demote dice
│   │   │                           disconnect dp fact google groupst joke kick
│   │   │                           link logo menu mute owner ping pp private
│   │   │                           promote public qr quote repo restart revoke
│   │   │                           setbotimage setdesc setname setprefix
│   │   │                           shutdown song status sticker tagall test
│   │   │                           translate truth tts unblock unmute url vv
│   │   │                           weather whoami wiki
│   │
│   ├── catalogue/                ← the source of truth for "what was promised"
│   │   ├── commands.js          13 KB, grouped by category
│   │   └── union.txt            14 KB, the flat list (924 from the .txt + extras)
│   │
│   ├── anti/                     8 moderation modules
│   │   └── antiBadword antiBot antiBug antiCall antiDelete antiLink
│   │       antiSpam welcome
│   │
│   └── utils/
│
├── scripts/                      172 KB — 20 scripts, every suite is executable proof
│   ├── harness-test.cjs         160  parses handler.js's real ctx literal; 16 assertions
│   ├── smoke-test.cjs           116  50 — every catalogue name answers *something*
│   ├── engine-test.cjs          174  17 — engine contract
│   ├── games-test.cjs           109  18
│   ├── chess-test.cjs            77  30
│   ├── board-test.cjs           125  40
│   ├── converter-test.cjs        97  64
│   ├── converter-render-test.cjs 69  visual proof for converters
│   ├── freetext-test.cjs         39  non-command chatter
│   ├── search-test.cjs          187  64
│   ├── logo-test.cjs            161  86
│   ├── logo-proof.cjs           191  renders every style to samples/
│   ├── sticker-test.cjs         208  38
│   ├── art-util-test.cjs        324  95  NEW
│   ├── ai-test.cjs              152  39
│   ├── security-test.cjs        180  31
│   ├── stalk-test.cjs           127  39
│   ├── no-dead-commands.cjs      49  asserts 0 fallback commands
│   ├── audit-commands.cjs        96  coverage %, double-claims, shadowing
│   └── brand-check.sh            26  refuses upstream branding
│
├── data/                         gitignored — runtime state, seeded from data/quiz/
│   ├── economy.json  games.json  security.json
│   └── quiz/         7 JSON banks (asahotak caklontong family100
│                     siapakahaku susunkata tebakkata tebaktebakan)
│
├── public/                       5.6 MB dashboard
│   ├── index.html
│   └── assets/        favicon.png  zynex-logo.png  logo.svg
│                      menu-banner.svg  menu-banner.png  gtav-logo.png
│
├── samples/                      6.9 MB, 53 files, all committed — the visual evidence
│                      board-start.png  board-mate.png  c-bubble.png
│                      c-emojimix-preview.png  8d.mp3  bass.mp3
│                      audio-proof.html  … (one artefact per thing I claimed works)
│
├── tools/
│   └── hangman-playground.js     interactive board tester
│
├── docs
│   ├── ENGINES.md               36 KB — engine table, handler contract, per-engine detail
│   ├── APIS.md                   9 KB — every third-party host + which command uses it
│   ├── HEALTH.md                 2 KB
│   ├── SECURITY.md               2 KB
│   ├── README.md / README-ZYNEX.md / LICENSE (MIT)
│
└── deploy configs
    ├── railway.json  railway.toml      ← use these
    ├── render.yaml
    ├── .nixpacks.toml
    └── vercel.json                     ← present, but Vercel cannot host a Baileys socket
```

## Direct dependencies (16)

`@whiskeysockets/baileys` · `adm-zip` · `axios` · `better-sqlite3` · `body-parser` ·
`cheerio` · `chess.js` · `cors` · `dotenv` · `express` · `ffmpeg-static` · `figlet` ·
`form-data` · `pdf-parse` · `pino` · `sharp`

Added in the last two commits: `figlet` (332 banner fonts), `pdf-parse` (PDF text),
`adm-zip` (archives). `archiver` was installed and then removed — `adm-zip` covers zip
writing in 2 packages instead of 45.

## Notes

- **`lib/commands/` beats `lib/engines/`** — 32 engine names are shadowed by hand-written
  files. The audit prints these as informational, not as errors.
- **`data/` is gitignored**, so a fresh clone starts with empty wallets and no game state.
  Only `data/quiz/` is tracked (7 files) because the quiz commands need it.
- **`samples/` is deliberately committed** despite the size: it is the only record that
  a logo style or a board render actually produced the picture claimed for it.
- **`vercel.json` stays** because the original project shipped it, but the deploy path
  is Railway or Render — a long-lived WhatsApp socket does not fit serverless.
