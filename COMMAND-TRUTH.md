# Command-truth audit — research first, then verified fixes

**Request:** “some commands that doesn't work on what they does … search online …
so u won't be editing wat u didn't know”, then “correct the commands that isn't
good enough” and “Just make it work perfectly”.

**Result:** the remaining researched command families are now aligned locally.
The first pass fixed `.rate` and `.hidetag`; this follow-up resolves the sticker
abbreviations by **separating the competing conventions** instead of guessing.
The badge/tick detail you love is untouched.

**Status:** pushed in `1e82b68`. A later pass added `COMMAND-TRUTH-2.md`; current validation is **57 suites**. This report preserves the earlier audit state, so its inventory numbers are historical; current numbers live in `COMMAND-TRUTH-2.md`.

---

## 1. Important caveat

There is **no universal standard** for WhatsApp-bot command names. `.qc`,
`.attp`, `.swm`, `.take` and `.steal` mean different things in different bot
families. Online sources are convention evidence, not law. I only changed code
when the local behaviour clearly disagreed with an advertised meaning **and**
comparable bots documented the expected behaviour.

The BWM XMD PRO repo used for the README style does **not** publish a command
list, so meanings were cross-checked against other public bot docs and source
code.

---

## 2. Inventory facts

- Registry: **2,202 names** — **205** hand-written files, **1,160**
  engine-backed names, **837** honest fallback stubs.
- **1,365 / 2,202 (62.0%)** are implemented; `node scripts/audit-commands.cjs`
  reports **audit clean**.
- **394** names have a very short/generic description (`Economy`, `Info`,
  `games:board`, `misc · ad`). Generic is not automatically broken.
- Fallback stubs are not broken commands: they answer honestly that the name is
  not implemented.

---

## 3. First-pass mismatches — fixed

| Command | Expected meaning | Old ZYNEX behaviour | Status |
|---|---|---|---|
| `.hug`, `.kiss`, `.pat`, `.slap` | Reaction GIF **with the target tagged**; Wath documents `.hug` as “Sends a hug gif tagging someone” [1](https://wath.app/en/commands) | Bold digits, no `@`, sender untagged, caption fallback lost mentions | Fixed earlier |
| `.ship` | Compatibility between two people; `/ship @person [@other]` [1](https://wath.app/en/commands/ship) | Only accepted a mention; advertised `.ship name1 name2` but did not implement it | Fixed earlier |
| `.rate` | “Rate **anything** out of **10**”; `.rate <thing>` [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD), [3](https://github.com/Mdjake/Wa-bot) | Ignored the typed subject, hashed the sender, printed `40–99 /100` | Fixed |
| `.hidetag` | **Silently** tag every group member; no visible `@number` list [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD), [4](https://github.com/Tohidkhan6332/Whatsapp), [5](https://github.com/usmanbalouch2762/cockroach-minibot) | `tagall.js` claimed `hidetag` as an alias, so it printed a visible numbered list | Fixed |
| `.tagall` | Visible mention of everyone, often a numbered list [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD) | Visible numbered list + mentions | Left correct |

---

## 4. Remaining commands — now corrected

| Name | Research evidence | What ZYNEX does now |
|---|---|---|
| `.qc` | Tsukasa builds a quote from text **or a replied message** [6](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa); QuotLy supports PNG cards and WebP stickers [7](https://github.com/LyoSU/quote-bot/blob/master/README.md) | **PNG quote card** from typed text, `text \| author`, **or a replied message**. Caption is `💬 QUOTE CARD`. |
| `.quotely` | Same quote-sticker convention [7](https://github.com/LyoSU/quote-bot/blob/master/README.md) | **WebP quote sticker** (512×512) with real pack/author EXIF. Previously it was only an honest “service dead” refusal. |
| `.ttp` | PRIME-MD: plain text sticker [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD); Tsukasa: static text sticker [6](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa) | Static blue text sticker, now with real sticker EXIF metadata. |
| `.attp` | Mausam, WA-Goat, StarkBot and Hijjaz call it an **animated rainbow text sticker** [8](https://github.com/Mausam5055/WP-Bot), [9](https://github.com/frnAlt/WA-Goat), [10](https://github.com/pujeshreddy/StarkBot-MD), [11](https://github.com/kashafHijjaze/Whatsapp-bot-); PRIME-MD only says “colourful sticker” [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD) | **Real animated WebP**: 8 rainbow frames at 8 fps, infinite loop, `ANIM`/`ANMF` chunks, `isAnimated: true`, sticker EXIF. Falls back to a static sticker only if ffmpeg is unavailable. |
| `.swm` | Indonesian bots and Tsukasa use `.swm pack\|author` to write **sticker EXIF pack/author metadata** [12](https://github.com/zennn08/BaseSelfBot/blob/master/xinz.js), [13](https://github.com/jakisoft/simpel-bot-wa), [6](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa) | Replied sticker is repacked with real `sticker-pack-name` / `sticker-pack-publisher` EXIF. Refuses non-sticker media. |
| `.wm` | Visual watermark convention: draw text onto the artwork [6](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa) | Still draws a **visible PNG watermark** on an image. No EXIF claim. |
| `.take` / `.steal` | Mausam `.take <packname>` rebrands a sticker [8](https://github.com/Mausam5055/WP-Bot); X-Asena `#take`/`#steal` repack sticker EXIF [14](https://github.com/Neeraj-x0/X-Asena); WhatsAppBotMultiDevice `steal` copies a sticker into your own pack [15](https://github.com/jacktheboss220/WhatsAppBotMultiDevice) | New `lib/commands/take.js`: replying to a sticker repacks it with `pack\|author`. **`.steal` without a sticker still runs the economy robbery command**, so both real meanings survive. |
| `.sticker` / `.s` | Sticker metadata is WebP EXIF, not a Baileys message option [16](https://socket.dev/npm/package/wa-sticker-formatter), [17](https://github.com/pedroslopez/whatsapp-web.js/issues/511) | Image **or video** becomes a real WebP sticker; pack/author are injected into EXIF. Video becomes animated WebP via the bundled ffmpeg. The old `{ packname, author }` fields were ignored by Baileys. |
| `.exif` / `.exifstrip` | Local alias `exifstrip` makes the intended meaning “strip camera metadata” | Left as an image EXIF stripper; described truthfully as such. |
| `.who` | “Pick a random group member for ‘who is …?’” | Verified: still picks and tags a random participant. Untouched. |
| `.alwaysonline` | PRIME-MD: keep presence shown as online [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD) | Verified: `lib/commands/alwaysonline.js` updates `dbSession.alwaysOnline`; `sessionManager.js` has presence/idle handling. Untouched. |

### Why this is not guessing

The ambiguous abbreviations were resolved by giving each real convention its own
command or context:

- **PNG quote card** → `.qc`; **WebP quote sticker** → `.quotely`.
- **Animated rainbow text** → `.attp`; **plain static text** → `.ttp`.
- **EXIF pack/author metadata** → `.swm`, `.take`, `.steal` on a sticker.
- **Visible drawn watermark** → `.wm`.
- **Sticker repack** → `.take` / `.steal` when a sticker is quoted.
- **Economy robbery** → `.steal` when no sticker is quoted.

---

## 5. Source changes in this follow-up

- New `lib/stickerMetadata.js`: builds the WhatsApp WebP EXIF TIFF/IFD payload,
  parses `pack|author`, repacks static or animated WebP, reads back metadata, and
  detects `ANIM`/`ANMF` chunks.
- Added `node-webpmux@3.2.1` to `package.json` / `package-lock.json`; it rewrites
  the RIFF container correctly for static and animated stickers.
- New `lib/commands/take.js`: owns `take`, `steal`, `steal2`; delegates to the
  economy engine when `.steal` is used without a replied sticker.
- `lib/commands/sticker.js`: removed the misleading `take` alias; now writes real
  EXIF metadata, converts video to animated WebP, and reports pack/author/size.
- `lib/engines/converter.js`: truthful registry descriptions; `.qc` reply support;
  real `.quotely`; animated `.attp`; static `.ttp`; `.swm` EXIF repack; `.wm`
  visual watermark; sticker EXIF on all local sticker outputs; removed the stale
  `.quotely` refusal.
- `lib/handler.js`: passes `command: cmdName` into file-command contexts so
  `.take` vs `.steal` can be distinguished.
- `scripts/converter-test.cjs` now pins animated `.attp`, replied-message `.qc`,
  `.quotely`, `.wm`, and real `.swm` EXIF.
- `scripts/command-truth-test.cjs` now pins all researched descriptions, command
  ownership, `.take` EXIF repack, `.who` / `.alwaysonline`, and truthful metadata.
- README badges, `package.json` description and `AUDIT.md` coverage numbers were
  updated to **1,365 implemented / 205 files / 837 stubs**.

---

## 6. What I still will NOT do

- Turn the 837 honest stubs into fake implementations.
- “Fix” a command only because its description is generic.
- Touch the badge/tick, welcome banner, `.vv`, `.play`, Railway logs, env vars or
  deploy config in this pass.
- Use Supabase or Vercel APIs; none were called.
- Claim a live WhatsApp retest from this workspace.

---

## 7. Validation and deployment

- `npm run test:all` → **56 suites, exit 0**, **0 `✗`**.
- `test:command-truth` **15/15**, `test:converter` **45/45**,
  `test:botinfo` **13/13**, `test:audit-fixes` **13/13**,
  `test:mentions` **18/18**, `test:reactions` **12/12**,
  `test:welcome-once` **12/12**, `test:play-priority` **10/10**.
- `node scripts/audit-commands.cjs`: clean, **1,365 / 2,202**, **205 files ·
  1,160 engine-backed · 837 stubs**.
- `node --check` passes on every changed JavaScript file.
- No live WhatsApp retest was possible from this workspace.
- When this report was first written, the follow-up was local only; it was later
  pushed as `1e82b68`. See `COMMAND-TRUTH-2.md` for the newer pass. Railway
  auto-deploy is still off, so a manual **Redeploy** is needed after any push.
- Rotate/revoke the raw GitHub PAT and Railway account token pasted earlier.

---

## Sources used for meaning, not for code

- Wath command list and `/ship`: [1](https://wath.app/en/commands), [1](https://wath.app/en/commands/ship)
- PRIME-MD command reference: [2](https://github.com/abdulraheemsamoo79-lgtm/PRIME-MD)
- Saif Bot command table: [3](https://github.com/Mdjake/Wa-bot)
- Hidden-tag references: [4](https://github.com/Tohidkhan6332/Whatsapp), [5](https://github.com/usmanbalouch2762/cockroach-minibot)
- Tsukasa quote / sticker / watermark plugins: [6](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa)
- QuotLy quote formats: [7](https://github.com/LyoSU/quote-bot/blob/master/README.md)
- Animated `.attp` references: [8](https://github.com/Mausam5055/WP-Bot), [9](https://github.com/frnAlt/WA-Goat), [10](https://github.com/pujeshreddy/StarkBot-MD), [11](https://github.com/kashafHijjaze/Whatsapp-bot-)
- `.swm` EXIF metadata references: [12](https://github.com/zennn08/BaseSelfBot/blob/master/xinz.js), [13](https://github.com/jakisoft/simpel-bot-wa)
- `.take` / `.steal` repack references: [14](https://github.com/Neeraj-x0/X-Asena), [15](https://github.com/jacktheboss220/WhatsAppBotMultiDevice)
- WebP sticker EXIF format: [16](https://socket.dev/npm/package/wa-sticker-formatter), [17](https://github.com/pedroslopez/whatsapp-web.js/issues/511), [18](https://docs.wwebjs.dev/util_Util.js.html)
- BWM XMD PRO visual reference, no command list: [19](https://github.com/Bwmxmdgo/BWM-XMD-GO-V2)
