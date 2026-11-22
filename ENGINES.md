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
| **Total real implementations** | **862** (41.7%) |
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
