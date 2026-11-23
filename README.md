<div align="center">

<img src="public/assets/zynex-logo.png" width="230" alt="ZYNEX-MD">

# ZYNEX-MD

**A WhatsApp bot that tells the truth.**

[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white&labelColor=0d1117)](https://nodejs.org)
[![Baileys](https://img.shields.io/badge/Baileys-6.7-25D366?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=0d1117)](https://github.com/WhiskeySockets/Baileys)
[![License](https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge&labelColor=0d1117)](LICENSE)

</div>

---

## Quick start

```bash
git clone https://github.com/RUTH-BOT-TECH/ZYNEX.git
cd ZYNEX && npm install
cp .env.example .env     # set OWNER_NUMBER
npm start                # open http://localhost:4000 and pair
```

## Make it yours

Fork it and rename it without opening a single source file. Three variables:

```bash
BOT_NAME=AZURE-MD          # the name in chat, stickers, logos, the panel
OWNER_NUMBER=2348012345678 # digits only, country code, no + and no leading 0
SITE_URL=https://your-app.up.railway.app   # where your users pair
```

That is the whole rebrand. `scripts/rebrand-test.cjs` boots the server as a
different bot and fails the build if any user-visible string still says the old
name, or if the panel stops answering. It also fails if the name is defined in
two places, so it cannot drift back.

Deploy with `npm run deploy` — it pushes to GitHub and Railway together.

## Commands

`2,139 names · 1,294 working · 60.5%` — the rest answer with an honest refusal and
name a command that does work. Run `.menu` in chat for the live list.

| | |
|---|---|
| **Games** | chess, hangman, tic-tac-toe, 2048, quiz, word games |
| **Stickers** | text stickers, emoji art, circle/crop/blur edits, memes |
| **Media** | logos in 59 styles, converters, image & PDF tools, TTS |
| **Search** | music, anime, TV, news, recipes, Wikipedia, dictionary |
| **Security** | URL scanning, TOTP, hashes, SSL, domain age |
| **Utilities** | WHOIS, DNS, ports, HTTP inspector, zips, PDFs |

## Deploy

Railway, Render or a VPS — it needs a persistent socket.
**Not Vercel, not any serverless platform.**

[![Deploy](https://img.shields.io/badge/Deploy-Railway-7c3aed?style=for-the-badge&logo=railway&logoColor=white&labelColor=0d1117)](https://railway.app)

<div align="center"><sub>Built with Baileys · sharp · ffmpeg-static</sub></div>

### Hosting: what actually works

The bot holds a live WhatsApp socket and writes state, so the host has to give
you two things: **an always-on process** and **a disk that survives a restart.**

| Host | Works? | What to set |
|---|---|---|
| **Railway** | ✅ | Mount a volume at `/data`, set `AUTH_DIR_ROOT=/data` |
| **Render** | ⚠️ paid only | Starter plan (free sleeps + no disk), disk at `/data`, same env |
| **VPS / Pterodactyl** | ✅ | `AUTH_DIR_ROOT=/path/to/state`, or leave unset |
| **Fly.io** | ✅ | A volume, same env |
| **Vercel / Netlify / any serverless** | ❌ | A WhatsApp socket cannot run in a request handler |

**One variable moves all state.** `AUTH_DIR_ROOT` relocates sessions, economy
balances, game boards, group settings, reminders and the media cache together.
Leave it unset and everything goes to `./auth_state`, which is where this
project has always written.

Forking an existing deployment? Your old `data/*.json` files are copied into the
new location once on first start, so balances and reminders are not lost.
