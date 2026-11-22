# Railway deployment — live record

Deployed 2026-11-22 via `railway` CLI 5.75 with an account token.

| | |
|---|---|
| **Pairing site** | https://zynex-md-production.up.railway.app |
| Project | `zynex-md` (`c4bab150-bb43-4c32-98ce-81d3e91a0cbb`) |
| Service | `zynex-md` (`7b60e626-bc1d-4c5b-8836-e3f946e63767`) |
| Environment | production (`a4bb431a-1fd0-4ef7-a03f-a648631db5ff`) |
| Volume | `zynex-md-volume` 500 MB at `/app/auth_state` |
| Runtime | Node 22 (pinned), nixpacks |

## Verified live

```
GET  /health      → {"ok":true,"sessions":0}
GET  /            → 200, 22,674 bytes
POST /api/pair    → {"success":true,"code":"F79C-M82L",...}   (with SITE_PASSWORD)
POST /api/pair    → {"error":"Wrong site password"}           (without it)
POST /api/disconnect → {"ok":true}
```

The pairing code was real and came from WhatsApp. The password gate is enforced
server-side, not just hidden in the UI.

## Two build failures, and what they taught

**1. `better-sqlite3` cannot build on Node 24.**
```
gyp ERR! cwd /app/node_modules/better-sqlite3
node -v v24.10.0 ... gyp ERR! not ok
```
No prebuilt binary exists for that Node version, so it fell back to compiling from
source and failed. **Nothing imported it** — `grep -rn better-sqlite3 lib/ server.js
scripts/` returned nothing, and the real store is `lib/db.js` (a JSON file). Removed
in `5f42b9c`.

**2. Nixpacks picked Node 18, and Baileys refuses to install below 20.**
```
npm error path /app/node_modules/@whiskeysockets/baileys
npm error command sh -c node ./engine-requirements.js
npm error ❌ This package requires Node.js 20+ to run reliably.
npm error    You are using Node.js 18.20.8.
```
Fixed in `07c169b`: `.nixpacks.toml` pins `nixPkgs = ["nodejs_22", "openssl"]` and
`package.json` now declares `"node": ">=20.0.0"` instead of `>=18`.

Both failures were only visible in the **build** logs. `railway logs` shows runtime
output and would have shown a healthy old deployment — the distinction matters when
debugging.

## Live configuration

Secrets are set as Railway variables, not in the repo:

| Variable | Value |
|---|---|
| `PANEL_MODE` | `0` (dashboard mode — without this the service never serves the site) |
| `BOT_NAME` | `ZYNEX-MD` |
| `PREFIX` | `.` |
| `OWNER_NUMBER` | *set — your number* |
| `OWNER_NAME` | `ZYNEX` |
| `SITE_PASSWORD` | *set — change it* |

`PORT` is injected by Railway (the container logs show `:8080`). Do not set it.

## Before you share the URL

1. **Change `SITE_PASSWORD`.** The current one was generated during setup and has
   appeared in a chat log. `railway variables --set SITE_PASSWORD=<new>`.
2. **Confirm `OWNER_NUMBER` is your real number** — it decides who gets owner
   commands.
3. **Revoke the GitHub token used for the push** and the Railway account token when
   you're done; both were pasted into chat.

## Known cosmetic mismatch

Runtime logs print `ZYNEX-MD v4.3` and `SQLite at file:./prisma/zynex.db`. Both are
stale strings from the original project — the version in `package.json` is `1.0.0`
and the store is `lib/db.js` writing JSON. Harmless, but do not trust those two lines
when debugging.

## Day-two operations

```bash
railway status                 # what's deployed
railway logs                   # runtime
railway logs --build           # build failures show up HERE, not in `logs`
railway variables              # confirm env
railway volume list            # confirm the auth_state mount survived
railway redeploy --yes         # republish the current image
railway up --detach --yes      # deploy the current working tree
```

**The volume is the whole point.** `auth_state/` holds WhatsApp credentials. If
`railway volume list` ever shows the mount gone, the next redeploy forces a re-pair.
