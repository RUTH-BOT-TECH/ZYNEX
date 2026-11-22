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
