# 👑 ZYNEX-MD

A Baileys-based WhatsApp bot — 58 commands, web pairing dashboard, anti-commands,
group tools and AI auto-reply.

Based on **MEG QUEEN MD** by Yobby (MIT licensed). Rebranded and configured for ZYNEX.

## Quick start

```bash
npm install
cp .env.example .env     # then edit
npm start
```

Open http://localhost:4000 and pair your number.

## Configuration

Create `.env`:

```env
PANEL_MODE=0                 # 0 = dashboard mode (recommended)
BOT_NAME=ZYNEX-MD
PREFIX=.
OWNER_NUMBER=2348012345678   # your number, digits only, no +
OWNER_NAME=ZYNEX
PORT=4000
```

## Two run modes

| Mode | Env | What it does |
|---|---|---|
| **Dashboard** (recommended) | `PANEL_MODE=0` | Web UI at `/` — pair from the browser, manage sessions |
| Panel | `PANEL_MODE=1` (default) | Headless; reads `SESSION_ID` from env — for Pterodactyl-style panels |

## Commands

`58 commands · 186 aliases · 10 categories`

- **main** — ping, alive, menu, test
- **group** — link, tagall
- **admin** — delete, demote, kick, mute, promote, unmute, revoke, setdesc, setname
- **anti** — antibot, antibug, anticall, antidelete, antilink
- **media** — status, groupst, logo, song, tts, vv
- **owner** — alwaysonline, autorespond, block, disconnect, shutdown, dp, pp, private, public, restart, setbotimage, setprefix, unblock
- **sticker** — sticker
- **tools** — calculate, google, qr, translate, url, weather, wiki
- **fun** — 8ball, coinflip, dare, dice, fact, joke, quote, truth
- **info** — owner, whoami, repo

`.menu` shows the card, `.menu all` shows the full list.

## Deploying

**Railway / Render / VPS** — the bot needs an always-on host (a persistent
WebSocket). Serverless platforms like Vercel will *not* work.

```bash
docker build -t zynex-md .
docker run -d --env-file .env -p 4000:4000 -v $(pwd)/session:/app/session zynex-md
```

`railway.json` and `render.yaml` are included.

## Before you deploy — set these

- `OWNER_NUMBER` — your WhatsApp number (digits only)
- `REPO_URL` and the repo link in `lib/commands/repo.js` — replace `YOUR-USERNAME`
- `public/assets/*` — banner art is AI-generated placeholder; swap for your own

## Credits

- Original: **MEG QUEEN MD** by Yobby — MIT License (see `LICENSE`)
- Baileys — WhiskeySockets
