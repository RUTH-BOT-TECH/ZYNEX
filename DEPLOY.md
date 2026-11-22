# Deploying ZYNEX-MD on Railway

Repo is pre-configured: `railway.toml` sets the nixpacks builder, `node server.js`
as the start command, and `/health` as the healthcheck. You should not need to
touch build settings — just don't override them.

---

## Step 1 — New project

1. Go to <https://railway.app> and sign in **with GitHub**.
2. **New Project** → **Deploy from GitHub repo**.
3. If Railway asks for access, grant it to `RUTH-BOT-TECH` (or just the `ZYNEX` repo).
4. Pick **RUTH-BOT-TECH/ZYNEX**.

Railway starts building immediately. Ignore the first deploy — it will boot without
a volume and without env vars, which is expected. Let it finish or cancel it.

## Step 2 — Add the volume (do this before pairing)

This is the step people skip, and it's the one that matters: `auth_state/` holds
your WhatsApp credentials. **No volume = re-pairing after every deploy.**

1. Open the service (click the box on the canvas).
2. **Variables** tab is next to **Settings** — go to **Settings**.
3. Scroll to **Volumes** → **+ New Volume**.
4. **Mount path:** `/app/auth_state`
5. Click **Add**.

Railway will restart the service. That's normal.

> Why `/app/auth_state`: nixpacks puts the app in `/app`, and the bot writes
> credentials to `<repo>/auth_state`. Mounting the volume at that exact path means
> the credentials live on the volume instead of the container's throwaway disk.
> Mounting it at `/app/data` or `/app` would either do nothing or shadow your code.

## Step 3 — Environment variables

**Variables** tab → **+ New Variable** → **Raw Editor**, paste this and edit the
values:

```env
PANEL_MODE=0
BOT_NAME=ZYNEX-MD
PREFIX=.
OWNER_NUMBER=2348012345678
OWNER_NAME=ZYNEX
SITE_PASSWORD=pick-a-long-password-here
```

| Variable | Why |
|---|---|
| `PANEL_MODE=0` | Dashboard mode. Without it the service runs headless and never serves the pairing page. |
| `OWNER_NUMBER` | Your number, digits only, country code, no `+`, no leading `0`. This is the account that gets owner commands. |
| `SITE_PASSWORD` | **Set this before you share the URL.** With it unset, anyone who finds the link can pair *their* WhatsApp to *your* bot. |
| `PORT` | **Do not set it.** Railway injects `PORT` itself; the app already reads it. |

Click **Deploy** (or it redeploys on save).

## Step 4 — Get a public domain

1. Service → **Settings** → **Networking** → **Public Networking** → **Generate Domain**.
2. You get something like `zynex-md-production.up.railway.app`.
3. Open it — you should see the ZYNEX-MD pairing page.

If the page doesn't load, the deploy failed; check **Deployments → View Logs** before
changing anything.

## Step 5 — Pair your WhatsApp

1. Open your Railway URL.
2. Enter your password (`SITE_PASSWORD`), then your number with country code.
3. Railway shows an 8-character code like `MHKA-8PVA`. It expires in 90 seconds.
4. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device → Link with
   phone number instead** → type the code.
5. The dashboard should flip the session to connected.

Then send `.menu` to your own number from another phone and the bot should reply.

## Step 6 — Confirm it survived

The real test of the volume:

1. Service → **Deployments** → **Redeploy** (latest commit).
2. Wait for the healthcheck to go green.
3. `/health` should report the session, and the bot should still answer **without**
   asking you to pair again.

If it asks for a code again, the volume is mounted at the wrong path — check step 2.

---

## Things that will bite you

**The free plan / trial credit.** Railway is usage-billed. Once credit runs out the
service stops and the bot goes silent. Keep an eye on **Usage**.

**Do not add `vercel.json`-style serverless deploys.** This is a long-lived
WebSocket; it cannot run as a function.

**`sessions.json` is not on the volume.** Session *state* lives in `auth_state/`
(covered). The JSON at the repo root that tracks dashboard metadata is not — it
regenerates. The consequence: after a redeploy, a bot session may still be live on
WhatsApp while the dashboard briefly shows it as unknown. Harmless; it reconciles on
the next message.

**`data/` is gitignored**, so a fresh deploy starts with empty wallets, no game
state and no saved security settings. Quiz banks are tracked and will be there.

**Healthcheck timeout is 60s** (`railway.toml`). It was 30 and the boot sequence —
registry, 1,302 aliases, session reconnect — is longer than that on a cold container.
If Railway still marks the deploy unhealthy, look at the logs rather than raising
the timeout again: a repeated failure is a crash loop, not slowness.

**`better-sqlite3` is installed but never imported.** The "database" is a JSON file
(`lib/db.js`). If the native build ever fails on Railway you can safely remove that
dependency — but it currently builds fine, so leave it until it doesn't.

**Pairing codes expire in 90 seconds.** If yours lapses, request another; nothing is
broken and the session ID stays the same.

---

## Command reference (what the env vars actually do)

```bash
npm start                     # node server.js, honours PORT (Railway sets it)
curl $URL/health              # {"ok":true,"sessions":N}
curl $URL/api/status          # bot name, versions, active sessions
```

`PANEL_MODE=0` → Express dashboard + API on `PORT`.
`PANEL_MODE` unset/`1` → headless, reads `SESSION_ID` from env (Pterodactyl-style).
