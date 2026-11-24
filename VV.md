# `.vv` — why it kept failing, and wetin I changed

Read from the **live Railway log** on 2026-11-24 (project `zynex-md`, deployment
`c9cce00a-6085-4a7b-8110-a77ca51e4b1a`), read-only. Nothing on the host was
edited to produce this.

---

## The exact error

```
18:34:39 [MSG] DM from 46274514571441: ".vv" | prefix=. | mode=private
18:34:39 [VV] node inventory. keys=["interactiveAnnotations","scanLengths","annotations","viewOnce"]
          directPath=MISSING url=MISSING mediaKey=MISSING fileLength=n/a
18:34:39 [VV] all routes failed. stanzaId=AC1CA7EF… original=not-stored cached=no
          quotedKey=false type=image fromMe=true
          routes=["downloadContentFromMessage (bare node): No valid media URL or
                  directPath present in message", "quoted media: …", "context downloader: …"]
```

Three attempts (18:34:39, 18:36:05, 18:36:34) — same result every time. And at
**every boot**:

```
18:29:34 / 18:45:21
[IDENTITY] ⚠ This session was linked as platform android
but DEVICE_IDENTITY now presents 1 (chrome). WhatsApp will likely drop the link.
```

Railway service variables were only `BOT_NAME, OWNER_NAME, OWNER_NUMBER,
PANEL_MODE, PREFIX, SITE_PASSWORD` — **`DEVICE_IDENTITY` was not set**.

---

## Root cause (four separate bugs, all now fixed)

### 1. The socket was lying about what it is
`creds.platform` (written by Baileys from the `<platform>` node at pairing) says
**`android`**. With no `DEVICE_IDENTITY` set, `lib/deviceIdentity.js` defaulted
to **chrome**, so a genuinely Android session logged in as a **WEB companion**.

WhatsApp's **November 2026** protocol update only fanouts view-once media to
Android-class companions. A WEB companion receives a
`view_once_unavailable_fanout` ciphertext stand-in that never decrypts; Baileys
`7.0.0-rc14` ACKs and drops it before `messages.upsert`, so nothing is stored
and nothing is cached. That is exactly `original=not-stored cached=no`.

Sources: [Baileys rc16 fork — "WhatsApp only fanouts view-once messages to Android companions"](https://github.com/QadeerXTech/QadeerXTechxbaileys), [rc15 fork — `view_once_unavailable_fanout` handling](https://github.com/AbdulRehman19721986/RedxBaileys), [Baileys PR #2334 — placeholder resend excludes `view_once_unavailable_fanout`](https://github.com/WhiskeySockets/Baileys/pull/2334), [neoxr #344 — the identical stub, Oct→Nov 2026](https://github.com/neoxr/neoxr-bot/issues/344), [neoxr fix #347](https://github.com/neoxr/neoxr-bot/commit/50e09fe2e2ce7d840cb5a5bccf0c9a2220154708).

### 2. The "android" preset was not Android at all
The old tuple was `['ANDROID_PHONE', 'Chrome', '130.0.6723.58']`. In Baileys
7.0.0-rc14 the platform is decided by **`browser[1]`**, not `browser[0]`:

```js
// node_modules/@whiskeysockets/baileys/lib/Utils/validate-connection.js
platform: config.browser[1].toLocaleLowerCase().includes('android') ? ANDROID : WEB
platformType: getPlatformType(config.browser[1])
// node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:30
if (browser[1].toLocaleLowerCase().includes('android')) { /* android path */ }
```

Baileys' own `Browsers.android('Chrome')` returns `['Chrome', 'Android', '']`.
So `browser[1] = 'Chrome'` meant the socket **still logged in as WEB** even when
`DEVICE_IDENTITY=android` was set. Fixed to
`['Chrome', 'Android', '130.0.6723.58']`.

### 3. `fromMe` was misread as "you sent this view-once yourself"
On a self-bot **every command the owner sends has `msg.key.fromMe = true`** —
including a reply to *another person's* view-once. The old code used that flag
to answer:

> ❌ That one cannot be unlocked — it is a view-once you sent yourself. … No bot
> can recover that, and no setting changes it.

The log shows `fromMe=true` on all three attempts. That was a **false** refusal:
the sender of the quoted item is irrelevant. Both your own and other people's
view-once are unlocked the same way once the device identity is right. Removed.

### 4. Nothing queued the item, so "eventually open" was impossible
Keyless stand-ins were dropped at `if (!msg.message) continue` **before**
`storeMessage()` ever saw them, and the reply declared the failure permanent.
So even if the media arrived seconds later, `.vv` had already given up.

---

## Wetin I changed

| File | Change |
| --- | --- |
| `lib/deviceIdentity.js` | `android` now presents a real Android companion (`browser[1]='Android'`). New `resolveForSession(raw, storedPlatform)` **auto-matches `creds.platform`** when the env var is empty, so an already-Android session fixes itself on restart with no Railway variable and no re-pair. New `platformMatches()` compares names (the old warning compared `'android'` to `16` and could never be satisfied). |
| `lib/sessionManager.js` | Resolves identity from creds before `makeWASocket`; logs `✔ matched the platform this session was linked as … Android companions receive view-once media`; warns plainly when a session really is WEB. Stores keyless upserts instead of discarding them. Calls `viewOncePending.onMessage(m)` for **every** upsert before any early return. |
| `lib/panelBot.js`, `lib/bot.js` | Both other socket paths pass `state.creds?.platform` so they cannot silently present WEB either. |
| `lib/viewOncePending.js` **(new)** | "Eventually open": `.vv` registers the stanzaId; when the real media lands under that id it is captured and posted automatically — once, with the original caption. Bounded 90 s wait (`VV_PENDING_WAIT_MS`), one actionable timeout reply, no retry storm. |
| `lib/commands/vv.js` | Removes the false self-sent refusal and the "nothing can recover it" fatalism. Keyless stand-ins now queue + explain the real fix. `.vv why` names `view_once_unavailable_fanout` and `DEVICE_IDENTITY=android`. |
| `.env.example` | Documents the auto-match default and why `chrome` cannot do view-once. |
| `scripts/vv-identity-test.cjs` **(new)** | 17 checks reproducing the exact log shape: identity auto-match, all three socket paths, no false `fromMe` blame, keyless upserts stored, pending delivery + caption + single-send + timeout. |
| `scripts/identity-test.cjs`, `viewonce-detect-test.cjs`, `vv-test.cjs`, `mode-vv-test.cjs`, `retry-test.cjs` | Updated assertions that encoded the old, wrong "permanent / self-sent" story. |

---

## Wetin YOU go do

### Good news: for your current session, **nothing** on Railway needs changing.
Your `creds.platform` is already `android`. With the fix, leaving
`DEVICE_IDENTITY` empty makes the bot present Android again automatically.

1. **Redeploy** this commit (Railway auto-deploys from GitHub `main`, or restart
   the service). No variable change, no re-pair.
2. Watch the boot log. You should now see, and **not** see the old warning:

```
[IDENTITY] ✔ matched the platform this session was linked as (android) —
           presenting Android [Chrome / Android / 130.0.6723.58].
           Android companions receive view-once media; WEB companions do not.
```

3. **Send a NEW view-once** (your own or somebody else's), then reply `.vv`.
   Expected log: `[CACHE] captured <id> (… KB)` on arrival, then
   `[VV] 1/4 served from the media cache`. If the media is a few seconds late,
   `[VV-PENDING] delivered <id>` posts it automatically — that is the
   "eventually open" behaviour.

### If the bot still logs `code=401 / isLoggedOut=true` (it did at 18:28:14)
The link was invalidated by the earlier identity mismatch. Then re-pair once:

1. WhatsApp → **Linked Devices** → log out this device.
2. Clear that session's auth folder on the Railway volume
   (`auth_state/<session>/`), or create a new session.
3. Set `DEVICE_IDENTITY=android` **before** pairing (optional now — auto-match
   handles it — but explicit is fine).
4. Pair again, confirm `[IDENTITY] ✔` at boot, then test.

### Two small things from the log
- `.vvdm` is not a command (18:36:25 → `Unknown command`). Use **`.vv dm`**
  (with a space) — you did try that at 18:36:34.
- There were **no `.vv` attempts after the 18:45:21 boot**; the last was
  18:36:34. Make sure you test **after** the new deployment lands.

---

## Honest limits

- A view-once that was **already opened and had no Android companion online**
  when it arrived cannot be recovered after the fact — WhatsApp held no copy
  for that device. New items are fine.
- If a session was genuinely paired as **chrome/web**, auto-match keeps it
  chrome (it does not silently change identity, because that would drop the
  link). The boot log will say so and ask for one re-pair with
  `DEVICE_IDENTITY=android`.
- The 90 s pending window covers late fanout/history sync. It is not a retry
  loop — hammering WhatsApp after a bot-gate-style refusal makes an IP look
  more automated.
- `requestPlaceholderResend` is deliberately **not** used: rc14 excludes
  `view_once_unavailable_fanout` from placeholder resend, matching WhatsApp Web.
