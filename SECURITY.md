# ZYNEX-MD — security notes

## ⚠️ Things found in the upstream repo that were removed

### 1. Silent support-group auto-join

The upstream project hardcoded a WhatsApp invite code and, **5 seconds after
every successful pairing**, silently added the paired account to that group:

```js
const DEFAULT_SUPPORT_GROUP_INVITE = 'CEzNfBdOYHj6pWzWOrgISb';  // NOT OURS
await sock.groupAcceptInvite(inviteCode);
```

No notification to the user. Whoever owns that invite code gets their group
populated by every user of the bot.

**Removed.** The default is now empty and the call site is opt-in:

```env
# only if you want it, using YOUR OWN group's code
SUPPORT_GROUP_INVITE=
```

### 2. Remote credential fetcher (`panelBot.js`)

The panel mode fetched your full WhatsApp auth keys from a third-party server:

```
GET {PAIRING_API_URL}/api/get-creds/{SESSION_ID}
→ { creds_base64 }
```

`creds_base64` is **complete auth material** — sufficient to operate your
WhatsApp account. Their endpoints now return 404, but the code path remains
for anyone who sets `PAIRING_API_URL`.

**Not used.** `PANEL_MODE=0` (our default) never touches it. If you ever set
`PANEL_MODE=1`, `PAIRING_API_URL` must point at a server *you* control.

## Safe defaults in this copy

| Setting | Value | Why |
|---|---|---|
| `PANEL_MODE` | `0` | pairing happens locally; no remote key fetch |
| `SUPPORT_GROUP_INVITE` | *(empty)* | nothing joins anything on your behalf |
| `PAIRING_API_URL` | *(empty)* | unused in dashboard mode |

## Credentials that never leave your server

- `auth_state/` / `session/` — WhatsApp auth keys. **Never commit these.**
  Both are in `.gitignore`.
- `.env` — your owner number and any API keys. Also gitignored.

## Before you deploy to Render/Railway

1. Set the env vars in the host's dashboard — never commit `.env`.
2. `git remote` should be **your** GitHub account.
3. Run `npm run brand-check` — confirms no third-party JIDs/links remain.
