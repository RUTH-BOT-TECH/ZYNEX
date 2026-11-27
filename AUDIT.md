# ZYNEX-MD — head-to-toe small-stuff audit

**Date:** 2026-11-24  
**Trigger:** `.hug` was supposed to show/tag the target's number / ID.  
**Scope:** read the interaction path first, then sweep neighbouring engines,
group tools, anti-features, handler output, deployment docs and tests.

---

## 1. The `.hug` bug

**Before**

```text
🤗 *2348021016309* hugs *2348134112474*
```

Those are bold digits, not WhatsApp mentions. The sender was never tagged,
the caption had no `@`, and the target was only put in `mentions` on media
sends. When every GIF CDN failed, the caption-only fallback lost `mentions`
entirely.

Target resolution was also too narrow: it read only
`m.message.extendedTextMessage.contextInfo`, preferred a quoted author over an
actual mention, ignored the handler's normalised `mentionedJid`, phone-number
arguments, `:device` suffixes and LID identities.

**After**

```text
🤗 @2348021016309 hugs @2348134112474
mentions: ["2348021016309@s.whatsapp.net", "2348134112474@s.whatsapp.net"]
```

`lib/mention.js` is now the single helper for:

- turning any JID / bare number / `@number` / LID into `@<phone-number>`;
- stripping `:device` suffixes;
- mapping a learned `@lid` to the real phone number;
- choosing a target from `mentionedJid`, quoted participants, **all** caption
  message types, or a number typed after the command;
- producing a de-duplicated `mentions` array on every send, including GIF
  failure fallbacks.

It is wired into `reactions.js`, `fun.js`, `economy.js`, `games.js`,
`group.js` and the handler's direct socket sends.

---

## 2. Same-class fixes found in the sweep

| Area | Problem | Fix |
|---|---|---|
| `.kiss`, `.pat`, `.slap` + 37 reactions | same fake number caption | all 40 reaction names use the shared helper |
| `.roast`, `.compliment`, `.rate`, `.love` | `@number` with no `mentions` | real tags; `.ship name1 name2` now works as advertised |
| `.who` | picked a participant but did not mention them | real tag + `mentions` |
| Tic-tac-toe / Connect 4 / chess | turn and win notices printed `@number`; board-free fallbacks had no mentions | normalised JIDs, LID-aware tags, mentions on every path |
| `.warn`, `.admins`, `.members`, `.tag` | some lists printed `@number` with no mentions; target resolution read only text quotes | shared `pickTarget`, real tags, `linkPreview:false` |
| `.send`, `.trade` | transfer replies printed `@number` without tagging | `mentions` added |
| Custom `PREFIX` | ~100 usage hints hardcoded `*.menu*`, `` `.play` ``, `Use .resize 800` | `lib/commandHint.js` rewrites only known command hints; URLs, decimals and `.env` are untouched |
| Direct `sendMessage` | some text payloads skipped `linkPreview:false`, so URL-bearing text could still hit the missing link-preview module | handler wraps the command socket; direct text sends in group/anti/session/panel paths now opt out |
| Stale truth | README said 52 suites; `package.json` said `57+ commands`; `REPAIR.md` said no push was made | now 57 suites, 2,209 names / 1,373 implemented, truthful push note |

---

## 3. Validation

- `npm run test:all` → **57 suites, exit 0**, no `✗` markers.
- New suites: `test:mentions` (18/18), `test:audit-fixes` (13/13) and `test:command-truth`.
- `test:reactions` 12/12, `test:welcome-once` 12/12, `test:play-priority` 10/10.
- `node scripts/audit-commands.cjs` now reports 1,373 / 2,209 implemented,
  210 file-owned names, audit clean.
- `board-test.cjs` had one random 2048 false failure: after `left` + `up`,
  `right` can legally be a no-op. The test now accepts the honest
  `Nothing moves that way.` reply as well as a new board.

---

## 4. Boundaries / still on your side

- No Railway logs, environment variables or deploy config were edited.
- No Supabase or Vercel API calls were made.
- No live WhatsApp `.hug` retest was possible from this workspace.
- Railway auto-deploy is still off, so **redeploy** after any push to pick up
  these changes; a restart alone is not a new build.
- Rotate/revoke the raw GitHub PAT and Railway account token previously pasted
  in chat. Neither is stored in the workspace.
- YouTube's cloud-IP bot gate remains external; the SoundCloud full-track
  fallback from the earlier fix is unchanged.

Reaction names such as `hug`/`kiss` also appear in the catalogue's `image`
family string, but the reactions engine owns those names at registry priority —
this is an informational duplicate, not a broken command.

---

## 5. Follow-up: command-truth fixes (`the follow-up local commit`)

After researching comparable WhatsApp bots, two more verified mismatches were
corrected without guessing at ambiguous abbreviations:

- `.rate <thing>` now rates the typed subject **out of 10** instead of ignoring
  it and printing `40–99 /100` for the sender.
- `.hidetag` now routes to the **silent** group tag engine; `.tagall` remains
  the visible numbered tag list.
- `scripts/command-truth-test.cjs` (9/9) pins both behaviours.
- Ambiguous `.qc` / `.attp` / `.swm` / `.wm` / `.take` / `.steal` names were
  researched again and deliberately left untouched in this first pass — later
  completed in section 6 and `COMMAND-TRUTH.md`.
- Full `npm run test:all` is green across **57 suites**.

---

## 6. Follow-up: remaining command-truth corrections

After more source-level research, the deliberately skipped commands were fixed
without guessing. The full report is `COMMAND-TRUTH.md`.

- `.qc` now makes a PNG quote card from typed text **or a replied message**;
  `.quotely` makes a WebP quote sticker. Both carry real sticker EXIF where
  applicable.
- `.attp` is now a real **animated rainbow WebP sticker** (`ANIM`/`ANMF`, 8
  frames, infinite loop, `isAnimated: true`). `.ttp` stays static.
- `.swm` now repacks a replied sticker with `pack|author` EXIF; `.wm` still draws
  a visible watermark on an image. The two conventions are no longer collapsed.
- `.take` / `.steal` now repack a replied sticker with real EXIF metadata. When
  `.steal` is used without a sticker it still runs the economy robbery command,
  so both documented meanings survive.
- `.sticker` / `.s` now write pack/author into the WebP EXIF instead of relying
  on Baileys `packname`/`author` fields, and convert video to animated WebP.
- New `lib/stickerMetadata.js` and `node-webpmux@3.2.1` provide real WebP EXIF
  muxing for static and animated stickers.
- `lib/handler.js` now passes `command: cmdName` to file commands so `.take` and
  `.steal` can be distinguished.
- `test:command-truth` is now **15/15**; `test:converter` is **45/45**.
- `npm run test:all` is green across **57 suites**, 0 failures.
- Coverage is now **1,373 / 2,209**, **210 file-owned · 1,163 engine-backed ·
  836 stubs**, audit clean.
- No badge/tick, `.vv`, `.play`, Railway log/config, Supabase or Vercel changes.
- Still local only: no push, no deploy, no live WhatsApp retest.
