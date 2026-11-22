# ZYNEX-MD — command engines

## The problem with 1,916 commands

Your catalogue lists **1,916 unique names**. Implementing them as 1,916 files
would be ~200k lines of near-duplicate code, and ~1,000 of them need API keys
nobody has.

The way real MD bots actually work: **one engine, many names.**

```
.bold .italic .fraktur .circle .morse .binary .zalgo .upside ...
        └──────────── one text engine ────────────┘
```

## Current coverage

| | count |
|---|---|
| Names in catalogue | **2,067** |
| Hand-written command files | **179** |
| Engine-backed commands | **683** |
| **Total real implementations** | **862** (46.6%) |
| Honest "not wired up" stubs | 1,205 |

Before this work the bot had **58** commands. Now **862** actually do something.

## The engines

| Engine | Names | What it does |
|---|---|---|
| `group` | 82 | members, admins, polls, warnings, join requests, group settings, rules |
| `tools` | 127 | calc, encode/hash, network, QR, TTS, time, search, translate |
| `text` | 104 | Unicode styles, case, morse/binary/hex, logo images |
| `economy` | 90 | wallet, daily, work/mine/fish/hunt, bank, shop, pets, marriage, gamble |
| `downloader` | 72 | play/song (Deezer), YouTube search, honest answers elsewhere |
| `fun` | 57 | jokes, quotes, facts, truth/dare, 8ball, roast, rate, ship |
| `info` | 55 | country, books, Bible, crypto, trivia, dictionary, poetry |
| `reactions` | 41 | anime GIFs — `.hug .kiss .slap` +38 |
| `islamic` | 32 | Quran, prayer times, qibla, hijri, duas |
| `media` | 23 | cats, dogs, foxes, neko, waifu |

## The duplicate rule

Two engines claiming one name is a bug — the first loaded silently wins and the
other's code is dead weight. That happened during development (the fun engine
was swallowing `.advice`, tools was swallowing `.country`).

`npm run audit` now probes **every catalogue name through `match()`** — not just
`extraNames` — and fails the build on any collision:

```
✓ no engine claims the same command twice
✓ audit clean
```

A hand-written file beating an engine is *expected* precedence, not a collision.

## Resolution order

```
1. lib/commands/<file>.js    hand-written  — always wins
2. lib/engines/*.js match()  engine-backed
3. fallback                  says "isn't wired up yet" — never silent
```

The fallback is deliberate. A command that exists but silently does nothing
looks identical to a broken bot. Saying so is honest and debuggable.

## Adding a new engine

```js
// lib/engines/myengine.js
module.exports = {
  id: 'myengine',
  match: (name) => ['foo', 'bar'].includes(name),
  describe: (name) => 'does foo',
  async execute({ command, args, reply }) { await reply('hi'); },
  extraNames: ['foo', 'bar'],  // index names not in the catalogue
};
```

Drop the file in — the registry picks it up on boot. No wiring.

## Testing

```bash
npm test           # 53 command files
npm run test:engines   # 50 engine assertions
npm run coverage       # JSON coverage stats
```

## Group engine detail

No external APIs. Everything is Baileys group metadata.

| Command group | Names |
|---|---|
| Members | `.members .listmembers .participants` |
| Admins | `.admins .listadmins .staff .tagadmin .tagowner` |
| Info | `.groupinfo .ginfo .grouptitle .gdesc` |
| Tagging | `.hidetag .tag .tagme .mention` |
| Polls | `.poll .vote .endpoll .results` |
| Warnings | `.warn .warnings .unwarn .resetwarn .clearwarns` |
| Join requests | `.requests .approve .reject .approveall .rejectall` |
| Settings | `.announce .restrict .lockgroup .unlockgroup .ephemeral` |
| Activity | `.groupstats .activity .inactive .mostactive` |
| Rules | `.rules .setrules` |

Safety decisions:

- Every command checks the sender is **group admin** or bot owner.
- Anything requiring admin rights verifies the **bot itself** is admin first,
  and says so plainly instead of failing silently.
- `.kickall` is deliberately refused — mass removal trips WhatsApp's abuse
  detection and gets the number banned. The warning system with auto-kick
  at the limit is the safe equivalent.
- Warnings persist in `data/groups.json` across restarts.

## Audio engine detail (`lib/engines/audio.js`)

**Verified with real ffmpeg 7.0.2** — 43/43 effects tested against a synthesized
3-second 440 Hz MP3; every one returned valid MP3 audio sent as a voice note.

Proof the filters are genuinely applied (not just re-encoded):

| filter | output duration | expected |
|---|---|---|
| original | 3.03 s | — |
| `nightcore` | 2.43 s | ÷1.25 ✓ |
| `vaporwave` | 3.79 s | ÷0.80 ✓ |
| `slow` | 4.31 s | ÷0.70 ✓ |

### How ffmpeg is resolved (`lib/ffmpeg.js`)
1. `FFMPEG_PATH` env var, if set and executable.
2. `ffmpeg-static` npm package (bundled binary — **no server install needed**).
3. System `ffmpeg` on `PATH`.

All invocations use `execFile` with argv arrays, so no shell interpolation is
possible. Audio is written to `os.tmpdir()` and cleaned up after every call.

### Parametric
- `.volume <0.1–10>` / `.vol <n>`
- `.trim <seconds>` / `.cut <seconds>`

## Games engine detail (`lib/engines/games.js`, `lib/engines/audio.js`)

### Games — 71 names, three families

**Quiz** — real question banks, vendored into `data/quiz/` so play needs no network:

| bank | rows | game |
|---|---|---|
| `asahotak.json` | 228 | `.asahotak` |
| `caklontong.json` | 414 | `.caklontong` |
| `siapakahaku.json` | 268 | `.siapakahaku` |
| `susunkata.json` | 356 | `.susunkata` |
| `tebakkata.json` | 302 | `.tebakkata` |
| `tebaktebakan.json` | 199 | `.tebaktebakan` |
| `family100.json` | 7,152 | `.family100` |
| **total** | **8,919** | |

Plus `.tebakkimia` (28 real elements), `.guesscountry`, `.guessflag`/`.tebakbendera`
(42 countries, flags from flagcdn.com), `.mathquiz`, `.guessnumber`, `.guesscolor`,
`.riddlegame`.

**Duel** — `.tictactoe` (8-line win detection), `.connect4` (4-in-a-row in all
directions), `.rps`. Real turn order, real board state, wrong player is refused.

**Solo** — `.wordle` (proper green/yellow/grey algorithm with letter pooling),
`.hangman`, `.anagram`/`.scramble`, `.2048` (real slide+merge), `.minesweeper`
(flood fill), `.sudoku` (backtracking generator + validator), `.maze`, `.typeracer`
(real WPM), `.wordchain`, `.adventure`, `.fight`, `.quest`, `.rpg`, `.wheel`.

Wins pay out through the **economy engine** — `economy.js` now exports
`user()`, `save()` and `coins()` so there is one balance store, not two.

### Free-text answers

Quiz answers are plain chat, not `.commands`. The handler calls
`games.handleFreeText()` for every non-prefixed message and it returns `true`
**only** when a game is genuinely waiting for input — ordinary conversation is
never hijacked. Covered by `scripts/freetext-test.cjs`.

### Honest refusals

`.chess` `.checkers` `.uno` `.snake` `.tetris` reply with a plain explanation
that they need a full rules engine WhatsApp messages can't drive, and list the
playable alternatives. They are **not** faked.

## Chess (`lib/chess.js` + `lib/chessboard.js`)

Real, playable chess. No hand-rolled rules — castling rights, en passant,
promotion, pins, checkmate, stalemate, threefold repetition and the 50-move rule
all interact, so legality is delegated to **chess.js** (BSD-2-Clause). The parts
we built ourselves are the ones users notice.

### How it plays in WhatsApp
Messages are plain text, so the board is sent as a **rendered PNG** — it looks
identical on every phone, highlights the last move, and flags check in red.

| command | what it does |
|---|---|
| `.chess` | new game vs the computer (you play White) |
| `.chess @friend` | Player vs Player in the same chat |
| `.playchess e4` or `.playchess e2e4` | send your move (SAN or from-to) |
| `.board` | re-send the current position |
| `.hint` | engine suggests a move for you |
| `.undo` | take back your move and the reply |
| `.resign` | resign |

*(`.move` is the maze game, not chess — the names are kept distinct on purpose.)*

### Opponent
**Stockfish via chess-api.com** — keyless, verified responding:

```
POST https://chess-api.com/v1
{"fen":"rnbqkbnr/...","depth":12}
→ {"move":"e2e4","san":"e4","eval":0.4,...}
```

Depth scales with `.chess` level. A small opening book answers the first move
instantly. If the engine is unreachable the bot plays a random legal move and
**says so in the caption** — it never hangs or pretends.

### Verified
`scripts/chess-test.cjs` — 18 assertions: board renders as a valid PNG, engine
replies, illegal moves rejected with a helpful list, wrong player blocked,
resign/undo/hint work, PvP alternation enforced. A 23-ply game was played to a
real checkmate (`Qb7#`) with zero state desyncs; stored move history always
replays to the same FEN the bot rendered.

### Why move history, not just FEN
A FEN carries no history, which would silently break undo, threefold repetition
and PGN. Chess state is also flushed to disk **synchronously** after every move —
a debounced write meant a restart inside 300 ms lost the move.

## Board rendering (`lib/gameboard.js`)

Every board game sends a **PNG image**, not an ASCII grid — same reasoning as
chess: identical on every phone, no monospace-font dependency, tappable, and
readable at WhatsApp preview size.

| game | command | rendered board |
|---|---|---|
| X & O | `.tictactoe @friend` | 3×3 grid, winning line drawn through it |
| Connect 4 | `.connect4 @friend` | 7×6 blue board, winning four ringed |
| 2048 | `.2048` | coloured tiles + live score |
| Minesweeper | `.minesweeper` | numbered cells, mines drawn as shapes |
| Sudoku | `.sudoku` | 9×9 with 3×3 block shading |
| Maze | `.maze` | walls, green dot, flag |
| Wordle | `.wordle` | green/yellow/grey tiles per guess |
| Hangman | `.hangman` | gallows drawn one limb at a time |

**Shapes, not glyphs.** X and O are two strokes and a circle; mines are a circle
with eight spokes; the hangman is lines and a circle. Nothing depends on a font
shipping the right Unicode codepoint, so the boards render identically on the
Render host as they do here.

Every renderer falls back to the original text board if `sharp` ever fails, so a
missing native binary degrades instead of breaking the command.

### The bug this caught
`tttWinner`/`c4Winner` originally returned a bare `'X'`/`1`. The renderers read
`w.line` to draw the winning stroke — always `undefined`, so wins silently lost
their highlight while everything still "worked". Both now return
`{ winner, line }`, and `scripts/board-test.cjs` asserts the win image is **not
byte-identical** to the pre-win board.

## Converter engine detail (`lib/engines/converter.js`, 54 names)

Three **local** backends — no third-party image service does the work:

| backend | used for |
|---|---|
| **sharp** | resize, crop, rotate, blur, sharpen, grayscale, invert, sepia, enhance, hd, upscale, compress, format conversion, stickers, quote cards |
| **ffmpeg** | audio ↔ video, voice notes, GIF, frame extraction |
| **imagemagick** | PDF writing (sharp's prebuilt binary has no PDF encoder) |

### Verified commands
`.resize .crop .rotate .blur .sharpen .grayscale .invert .sepia .enhance .hd
.upscale .remini .compress .toimage .exif .stiker .ttp .attp .emoji2png .emojimix
.qc .toaudio .tovn .tovideo .togif .upload .ssweb .txt2pdf .img2pdf .swm`

### Keyless network features (all verified live)
- **Upload** → `uguu.se` primary, `tmpfiles.org` fallback. Both return a URL that
  actually serves `image/png` — confirmed by re-fetching the link.
- **Screenshot** → `image.thum.io` primary, `api.microlink.io` fallback.
- **Emoji Kitchen** → Google's `gstatic.com` asset host. Real combinations
  return art; unknown pairs return "no combination exists" rather than breaking.

### Deliberate refusals (with the reason and the alternative)
`.ocr` `.readtext` — no keyless OCR survives; `ocr.space`'s shared demo key is
rate-limited (E581) and the free OCR APIs are gone.

`.removebg` — needs a model or a keyed API.
`.imgbb` `.catbox` `.telegraph` — all reject anonymous uploads now (imgbb wants a
key, catbox says "Invalid uploader", telegra.ph returns "Unknown error").
`.doc2pdf` — needs LibreOffice; not installed, cannot be installed without root.
`.pdf2img` — needs poppler; same constraint.

Each one replies with why and what to use instead — never a silent failure and
never a fake.

### Notable bugs caught
- `.toaudio` on a **silent video** gave a generic error; it now says the video
  has no audio track, which is a normal thing to receive.
- `convert` was colliding with the currency engine's `.convert 100 USD NGN`;
  the media converter yields and exposes `.convertmedia` instead.

## Command output: text vs image

Only commands where a **picture is the actual deliverable** send media. Everything
else is plain text — deliberate, so the bot doesn't turn into an image spammer.

| command | output | why |
|---|---|---|
| `.balance` `.daily` `.profile` `.rank` | **text** | numbers with emoji and bold — no picture needed |
| `.upside` `.bold` `.fancy` | **text** | the transformed characters *are* the answer |
| `.password` `.uuid` `.hash` | **text** | you need to copy the string |
| `.weather` `.country` `.crypto` | **text** | data |
| `.groupinfo` `.admins` `.members` | **text** | data |
| `.asahotak` `.caklontong` `.family100` | **text** | question and answer |
| `.tictactoe` `.connect4` `.2048` `.minesweeper` `.sudoku` `.maze` `.wordle` `.hangman` `.chess` | **image** | you cannot play these in text |
| `.qc` `.ttp` `.attp` `.stiker` `.swm` | **image** | the image is the product |
| `.ssweb` `.toimage` `.emojimix` | **image** | capturing/rendering is the request |

Measured across the whole engine set: **games and converter send media; economy,
tools, text, group, islamic, info and reactions reply with text.**

## No-dead-commands guard (`scripts/no-dead-commands.cjs`)

Walks every implemented name, calls the engine, and fails the build if any
command answers with generic filler ("Working on it", "isn't available yet") or
throws. This is what caught 9 unfinished economy commands
(`craft smelt equip unequip use repair trade upgrade forge`) which are now a
working crafting system:

- `.mine` drops raw `iron` / `gold` / `diamond`
- `.smelt <ore>` converts raw ore → craft ore (iron 1, gold 2, diamond 5)
- `.craft <item>` / `.forge` spends ore + coins to make equipment
- `.equip` `.unequip` `.use` `.upgrade` (5 levels) `.repair` `.trade @user`
