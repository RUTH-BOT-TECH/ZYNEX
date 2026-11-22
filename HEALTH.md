# ZYNEX-MD — API health report

Last audited: **22 Nov 2026**

Every external service the bot depends on was probed live. This is what
was broken and what was fixed.

## Fixed

| Command | Was | Now | Status |
|---|---|---|---|
| `.play` / `.song` | paxsenix **404**, cobalt **dead** | **Deezer** (official, keyless) + iTunes fallback | ✅ |
| `.joke` | official-joke-api **503** | `v2.jokeapi.dev` | ✅ |
| `.quote` | api.quotable.io **DNS dead** | `zenquotes.io` | ✅ |
| `.translate` | Google gtx **429** | MyMemory primary, Google fallback | ✅ |
| `.wiki` | Wikimedia **403** (default UA blocked) | sends a User-Agent | ✅ |
| `.wiki` | called undefined `replyWithImage` → crash | removed dead branch | ✅ |
| `.play` | iTunes searched `country: KE` | `NG` | ✅ |

## Why `.play` only sends 30s previews

This isn't a bug in the code — it's the state of the world in 2026:

- `ytdl-core` → **410 Gone** (YouTube blocked it)
- `@distube/ytdl-core` → **"Sign in to confirm you're not a bot"**
  (YouTube blocks datacenter IPs — every hosted bot hits this)
- Cobalt → now requires an API key
- Invidious `/latest_version` → serves HTML, not audio

Deezer's public API still serves official ~30s previews **with cover art**,
keyless, every time. That's what we ship.

### Want full songs?

Two real options:

1. **Cookies** — export YouTube cookies from a logged-in browser and point
   `@distube/ytdl-core` at them. Works until the cookie expires.
2. **Self-hosted Cobalt** — run it with `docker run -d -p 9000:9000 ghcr.io/imputnet/cobalt`,
   then set `COBALT_API_URL=http://localhost:9000/`. The `.play` chain
   already supports it — it's source #3.

## Verified working

```
.play    ✅ Deezer audio + cover art (469 KB, <500ms)
.joke    ✅
.quote   ✅
.translate ✅
.fact    ✅
.weather ✅
.wiki    ✅ (after UA fix)
.qr      ✅
.8ball .dice .coinflip ✅
```

## Not verified (need a real WhatsApp session / media input)

`.sticker` `.vv` `.setbotimage` `.pp` `.dp` — these need a real image reply.
They load and route correctly, but the media path can only be proven
in a live chat.

## Run the audit yourself

```bash
npm test            # offline, no network
npm run test:network # hits live APIs
npm run brand-check  # confirms no upstream branding leaked
```
