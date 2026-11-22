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
| Names in catalogue | **1,934** |
| Hand-written command files | **179** |
| Engine-backed commands | **500** |
| **Total real implementations** | **679** (33.8%) |
| Honest "not wired up" stubs | 1,327 |

Before this work the bot had **58** commands. Now **679** actually do something.

## The five engines

| Engine | Names | What it does |
|---|---|---|
| `text` | 105 | Unicode styles, case, morse/binary/hex, logo images |
| `tools` | 143 | calc, encode/hash, network, QR, TTS, time, search, translate |
| `economy` | 91 | wallet, daily, work/mine/fish/hunt, bank, shop, pets, marriage, gamble |
| `fun` | 89 | jokes, quotes, facts, truth/dare, 8ball, roast, rate, ship, reactions |
| `downloader` | 72 | play/song (Deezer), YouTube search, honest answers elsewhere |

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
