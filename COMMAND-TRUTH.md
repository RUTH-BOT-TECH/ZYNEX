# Command-truth audit — research first, then verified fixes

**Request:** “some commands that doesn’t work on what they does … search online …
so u won't be editing wat u didn't know”.  
**Result:** two clearly verified mismatches are fixed locally, with a regression
suite. Ambiguous sticker abbreviations were researched further and **left
untouched on purpose**. The badge/tick detail you love is untouched.

**Local commits, not pushed:** `601df7f` (mention/audit fixes) and `the follow-up local commit`
(command-truth fixes). Full 56-suite validation is green.

---

## 1. Important caveat

There is **no universal standard** for WhatsApp-bot command names. `.qc`,
`.swm`, `.attp`, `.who` etc. mean different things in different bot families.
Online sources are convention evidence, not law. I only changed code when the
local behaviour clearly disagreed with the advertised meaning **and** a
comparable bot documented the expected behaviour.

The BWM XMD PRO repo used for the README style does **not** publish a command
list, so meanings were cross-checked against other public bot docs.

---

## 2. Inventory facts

- Registry: **2,202 names** — **204** hand-written files, **1,160**
  engine-backed names, **838** honest fallback stubs.
- **394** names have a very short/generic description (`Economy`, `Info`,
  `games:board`, `misc · ad`). Generic is not automatically broken.
- Fallback stubs are not broken commands: they answer honestly that the name is
  not implemented.

---

## 3. High-confidence mismatches — now fixed locally

| Command | Expected meaning | Old ZYNEX behaviour | Status |
|---|---|---|---|
| `.hug`, `.kiss`, `.pat`, `.slap` | Reaction GIF **with the target tagged**; Wath documents `.hug` as “Sends a hug gif tagging someone” [1](https://wath.app/en/commands) | Bold digits, no `@`, sender untagged, caption fallback lost mentions | Fixed in `601df7f` |
| `.ship` | Compatibility between two people; `/ship @person [@other]` [1](https://wath.app/en/commands/ship) | Only accepted a mention; advertised `.ship name1 name2` but did not implement it | Fixed in `601df7f` |
| `.rate` | “Rate **anything** out of **10**”; `.rate <thing>` [3](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD), [3](https://github.com/Mdjake/Wa-bot) | Ignored the typed subject, hashed the sender, printed `40–99 /100` | **Fixed in `the follow-up local commit`** |
| `.hidetag` | **Silently** tag every group member; no visible `@number` list [3](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD), [1](https://github.com/Tohidkhan6332/Whatsapp), [2](https://github.com/usmanbalouch2762/cockroach-minibot) | `tagall.js` claimed `hidetag` as an alias, so it printed a visible numbered list | **Fixed in `the follow-up local commit`** |
| `.tagall` | Visible mention of everyone, often a numbered list [3](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD) | Visible numbered list + mentions | Left correct |

### Exactly what `the follow-up local commit` changed

- `lib/engines/fun.js`
  - `.rate my car` now rates **“my car”**, not “you”.
  - Score is **0–10** with a 10-cell bar, deterministic per subject.
  - `.rate @user` still shows `@number` and sends a real `mentions` array.
  - Registry description changed from `Rate someone` to
    `Rate anything out of 10`.
- `lib/commands/tagall.js`
  - removed the misleading `hidetag` alias.
- `lib/engines/group.js`
  - `hidetag` added to the silent-tag set alongside `hidetagall` / `silenttag`.
- `scripts/engine-test.cjs` updated from `/100` to `/10`.
- New `scripts/command-truth-test.cjs` (9/9) pins both behaviours.
- README/test badges and `AUDIT.md` now say **56 suites**, not 55.

---

## 4. Ambiguous names — researched again, still NOT edited

| Command | What online research shows | Why it stays untouched |
|---|---|---|
| `.qc` | Tsukasa calls it a **quote card** from a replied message or text [1](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa); another bot calls it a fake-chat **quote sticker** [1](https://github.com/jefry-dot/capstone_botwa); QuotLy supports WebP stickers **and** PNG images [3](https://github.com/LyoSU/quote-bot/blob/master/README.md) | Local code sends a PNG quote card. Both conventions are real; changing it would be a guess. |
| `.attp` | WA-Goat / Mausam call it an **animated rainbow text sticker** [1](https://github.com/frnAlt/WA-Goat), [3](https://github.com/Mausam5055/WP-Bot); PRIME-MD only says “colourful sticker” [4](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD) | Local code makes a static coloured text sticker. Animated WebP is a different feature. |
| `.ttp` | PRIME-MD: plain text sticker [4](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD); Tsukasa: static text sticker [1](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa) | Local behaviour already matches. |
| `.swm` / `.wm` | Older Indonesian bots use `.swm pack|author` to write **sticker EXIF pack/author metadata** [1](https://github.com/zennn08/BaseSelfBot/blob/master/xinz.js), [2](https://github.com/jakisoft/simpel-bot-wa); Tsukasa uses `.wm <text>` as a **visual watermark on a sticker** [1](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa) | Local `swm`/`wm` overlays text on an image. Same abbreviations, two incompatible features; EXIF writing needs `webpmux`, which this project does not ship. |
| `.take` / `.steal` | Commonly “repack/rebrand a sticker with your own pack metadata” [1](https://github.com/jacktheboss220/WhatsAppBotMultiDevice), [1](https://github.com/ikramshabbir/X-MD) | Needs a deeper read of `lib/engines/sticker.js` before judging. |
| `.who` | Usually “pick a random group member for ‘who is …?’” | Local code already picks and tags a random participant. Probably correct. |
| `.alwaysonline` | PRIME-MD: “Keep your presence shown as online” [4](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD) | Command updates `dbSession.alwaysOnline`; `sessionManager.js` has presence/idle handling. Looks wired. |

---

## 5. What I still will NOT do

- Turn the 838 honest stubs into fake implementations.
- “Fix” a command only because its description is generic.
- Touch `.qc`, `.attp`, `.swm`, `.wm`, `.take`, `.steal` or `.who` until their
  expected behaviour is confirmed.
- Touch the badge/tick, welcome banner, `.vv`, `.play`, Railway logs, env vars
  or deploy config in this pass.
- Use Supabase or Vercel APIs; none were called.

---

## 6. Validation and deployment

- `npm run test:all` → **56 suites, exit 0**, no `✗` markers.
- `test:command-truth` 9/9, `test:mentions` 18/18,
  `test:audit-fixes` 13/13, `test:reactions` 12/12,
  `test:welcome-once` 12/12, `test:play-priority` 10/10.
- No live WhatsApp retest was possible from this workspace.
- Both commits are **local only**: no push happened because no push token was
  provided. Railway auto-deploy is still off, so a manual **Redeploy** is
  needed after the push.
- Rotate/revoke the raw GitHub PAT and Railway account token pasted earlier.

---

## Sources used for meaning, not for code

- Wath command list and `/ship`: [1](https://wath.app/en/commands), [1](https://wath.app/en/commands/ship)
- PRIME-MD full command reference: [3](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD), [4](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD)
- Saif Bot command table: [3](https://github.com/Mdjake/Wa-bot)
- ZeroTwo anime reactions: [5](https://zerotwo.bot/commands)
- Hidden-tag references: [1](https://github.com/Tohidkhan6332/Whatsapp), [2](https://github.com/usmanbalouch2762/cockroach-minibot)
- Sticker / quote conventions: [1](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa), [1](https://github.com/jefry-dot/capstone_botwa), [3](https://github.com/LyoSU/quote-bot/blob/master/README.md), [1](https://github.com/frnAlt/WA-Goat), [3](https://github.com/Mausam5055/WP-Bot), [1](https://github.com/zennn08/BaseSelfBot/blob/master/xinz.js), [2](https://github.com/jakisoft/simpel-bot-wa), [1](https://github.com/ikramshabbir/X-MD), [1](https://github.com/jacktheboss220/WhatsAppBotMultiDevice)
- BWM XMD PRO visual reference, no command list: [1](https://github.com/Bwmxmdgo/BWM-XMD-GO-V2)
