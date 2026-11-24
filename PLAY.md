# Making `.play` return the FULL track (not a 30-second preview)

Researched and verified on **2026-11-24** against a live deploy-like IP.

---

## TL;DR — it already works now, with zero setup

I reproduced the problem: from this server YouTube answers

```
ERROR: [youtube] FGBhQbmPwH8: Sign in to confirm you're not a bot.
```

…so `lib/engines/downloader.js` fell through to Deezer/iTunes, whose `preview`
fields are **only 30 seconds long by design**. Those are keyless endpoints; the
full track is copyrighted and deliberately withheld. Not a bug, a ceiling.

On the **same IP**, with **no cookies**, yt-dlp's SoundCloud search returned 8
results including 322-second tracks, and a real download produced a **5:22 MP3
(4.9 MB)**. So `.play` now does:

```
.youtube  →  SoundCloud (scsearch8, skip any result < 60s)  →  Deezer/iTunes 30s preview
```

SoundCloud does not bot-gate datacentre IPs and needs no PO token. The caption
now says `via SoundCloud (full track)` so you can see which source won.

**Verify:**

```bash
npm install                  # postinstall fetches ffmpeg + yt-dlp
npm run test:play            # 16 offline checks + 1 live full-length check
node -e "require('./lib/ytdlp').resolve('daft punk one more time',{source:'soundcloud'}).then(console.log)"
```

Optional: if YouTube is always blocked on your host, skip the wasted attempt:

```bash
YTDLP_AUDIO_SOURCE=soundcloud
```

---

## If you specifically need YouTube (music videos, YouTube-only uploads)

You need to give YouTube a **trust signal**. Work down this list in order —
[jumping straight to cookies often fails because the real causes are 1 and 2](https://tunelio.dev/blog/yt-dlp-sign-in-to-confirm-not-a-bot/).

### 1. Keep yt-dlp current (most "not a bot" errors are a stale binary)

YouTube breaks extractors constantly; only new releases carry the counter-fix.
Our postinstall skips a binary that already exists, so force a refresh when
`.play` suddenly fails on *every* song:

```bash
npm run ytdlp:update         # deletes vendor/yt-dlp, downloads the latest release
./vendor/yt-dlp --version    # should be within days of today
```

### 2. JavaScript runtime + IPv4 (already automatic in this repo)

Current yt-dlp needs an external JS runtime (Deno by default, or Node named
explicitly) to solve YouTube's EJS challenges. This host showed
`JS runtimes: none`, which silently drops formats. `lib/ytdlp.js` now:

- adds `--js-runtimes node` when Deno/Bun are not on PATH (it is a Node app),
- adds `-4` because YouTube scores cloud IPv6 poorly.

Override with `YTDLP_JS_RUNTIME=deno:/usr/bin/deno` or `YTDLP_FORCE_IPV4=0`.
The official standalone binary bundles the solver scripts, so
`--remote-components` is normally unnecessary (`YTDLP_REMOTE_COMPONENTS` if
your build lacks them). See [yt-dlp's EJS setup](https://deepwiki.com/yt-dlp/yt-dlp-wiki/3.3-external-javascript-(ejs)-setup).

### 3. Cookies from a THROWAWAY session — the fix that actually clears the gate

This is what YouTube's own error message asks for. Do it exactly this way,
because YouTube rotates session cookies on every page load:

1. Open a **private / incognito** window.
2. Sign in to YouTube with a **spare Google account** — never your main one;
   automated use from a flagged IP can get that account restricted.
3. In that same tab open `https://www.youtube.com/robots.txt`.
4. Export `youtube.com` cookies in **Netscape cookies.txt** format
   (extension: *Get cookies.txt LOCALLY*).
5. **Close the private window immediately** and never open YouTube in that
   profile again. Do not log that account out — logout invalidates the export.
6. Put it on the host as an env var (the bot writes it to a `0600` temp file;
   the secret never appears on the command line):

```bash
# Linux
base64 -w0 cookies.txt
# macOS
base64 -i cookies.txt | tr -d '\n'
```

Paste that one line into your host's env as:

```
YTDLP_COOKIES_B64=<the base64 line>
```

…or mount the file on a persistent volume and set
`YTDLP_COOKIES_FILE=/app/secrets/cookies.txt`, or paste the raw Netscape text
into `YTDLP_COOKIES`.

⚠️ `cookies.txt` is a **password**. It is gitignored here. Cookies expire —
when it stops working, re-export from a fresh private window rather than
retrying. Do **not** use `--cookies-from-browser` on a headless server (there is
no browser profile to read).

Sources: [yt-dlp cookies FAQ / private-window method](https://ytdlp.org/guides/fix-sign-in-to-confirm-not-a-bot), [step-by-step cookie export](https://jnzlab.io/posts/ytdlp-cookie-auth-guide/).

### 4. PO-token provider (for stubborn 403s)

YouTube now asks some player clients for a Proof-of-Origin token. The standard
answer is the **bgutil** provider ([plugin](https://github.com/Brainicism/bgutil-ytdlp-pot-provider), [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/Extractors/8d946242b3df93271961d6bee0f004bd21f4f9ee)):

```bash
# sidecar (Docker), bound to loopback
docker run -d --name bgutil-pot -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider
```

```
YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416
YTDLP_PLUGIN_DIR=/path/to/bgutil-ytdlp-pot-provider/plugin   # standalone binary
YTDLP_PLAYER_CLIENT=mweb,tv,web_safari
```

Note: this repo uses the **standalone** yt-dlp binary, which does not discover
pip-installed plugins — hence `YTDLP_PLUGIN_DIR`. A PO token does **not** bypass
an IP-level login wall; on a flagged datacentre IP you usually still need
cookies too.

### 5. Change the IP (the actual wall on most cloud hosts)

If a laptop on home internet downloads the same video without cookies, your
server's IP is the problem and no flag fixes it. Route yt-dlp through a
residential/mobile proxy, or host the bot on a VPS with a cleaner address:

```
YTDLP_PROXY=http://user:pass@residential-proxy-host:port
```

Cheap rotating datacentre proxies are scored the same as your VPS — they rarely
help. Also slow down if you serve many users:
`YTDLP_EXTRA_ARGS="--sleep-requests 1 --limit-rate 2M"`.

---

## Deployment note (important for Vercel)

`.play` downloads a 5–20 MB file, transcodes it with ffmpeg, and holds it in
memory before WhatsApp upload. A Baileys WhatsApp socket also has to stay
connected 24/7. **Vercel serverless functions cannot do either** (ephemeral FS,
short execution limits, no long-lived socket). Use the repo's
`railway.toml` / `render.yaml` / a VPS with a persistent volume for the bot;
Vercel is fine for the pairing web page only. Supabase is not involved — this
project uses a local JSON session store.

---

## Environment variables (all optional)

| Var | What it does |
| --- | --- |
| `YTDLP_AUDIO_SOURCE` | `youtube` \| `soundcloud`. Skip a source entirely. |
| `YTDLP_SOUNDCLOUD_FALLBACK=0` | Disable the SoundCloud fallback. |
| `YTDLP_SC_RESULTS` | SoundCloud results to inspect (default 8). |
| `YTDLP_COOKIES_B64` | Base64 Netscape cookies.txt — **the main YouTube fix**. |
| `YTDLP_COOKIES_FILE` / `YTDLP_COOKIES` | Path on a volume / raw Netscape text. |
| `YTDLP_POT_PROVIDER_URL` | bgutil PO-token HTTP endpoint. |
| `YTDLP_PLUGIN_DIR` | Plugin directory for the standalone binary. |
| `YTDLP_PLAYER_CLIENT` | e.g. `mweb,tv,web_safari`. |
| `YTDLP_PROXY` | Residential/mobile proxy URL. |
| `YTDLP_JS_RUNTIME` | `node` (auto) / `deno:/path` / `0` to disable. |
| `YTDLP_FORCE_IPV4=0` | Turn off `-4`. |
| `YTDLP_REMOTE_COMPONENTS` | e.g. `ejs:github` if solver scripts are missing. |
| `YTDLP_EXTRA_ARGS` | Any extra yt-dlp flags. |

`npm run ytdlp:update` force-refreshes the binary.

---

## One mistake to avoid

Do **not** hammer retries when the bot gate is active — it makes the IP look
*more* automated. This bot now recognises `Sign in to confirm` as terminal for
that request, tries SoundCloud once, and tells the operator exactly what to set
instead of looping.

### Sources consulted (Nov 2026)

- [Fix "Sign in to confirm you're not a bot" (2026) — fix order](https://tunelio.dev/blog/yt-dlp-sign-in-to-confirm-not-a-bot/)
- [ytdlp.org — cookies, private window, PO token on servers](https://ytdlp.org/guides/fix-sign-in-to-confirm-not-a-bot)
- [yt-dlp PO Token Guide (official wiki)](https://github.com/yt-dlp/yt-dlp/wiki/Extractors/8d946242b3df93271961d6bee0f004bd21f4f9ee)
- [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
- [EJS / JavaScript runtime setup](https://deepwiki.com/yt-dlp/yt-dlp-wiki/3.3-external-javascript-(ejs)-setup)
- [SoundCloud fallback for datacentre IP blocks](https://github.com/northernblader-sys/cloud-bot/pull/6)
- [Running yt-dlp in Docker/on a server with cookies](https://ytdlp.org/guides/run-yt-dlp-server)
