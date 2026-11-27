# Live-test corrections — anime image + identifiable anti-bug notice

**User report:** “the commands aren't set settled … `.anime Naruto` just text out put
wat of the image”, followed by an owner DM that showed `Blocked: 97405882134595`,
called the rate limit “temporary — not blocked”, then claimed the number was
“blocked permanently”. The user asked: “How will I know the person it block”.

**Status:** researched, fixed and validated locally. At the time of writing,
GitHub `main` was at pushed `7a43b34`; commit/push and deployment are separate
actions. No Railway, Supabase or Vercel call was made.

---

## 1. Research before editing

- AniList's official `MediaCoverImage` object exposes `extraLarge`, `large` and
  `medium` cover URLs [1](https://docs.anilist.co/reference/object/mediacoverimage).
  The existing query already requested `coverImage { large }` but threw the URL
  away and replied with text only.
- Comparable WhatsApp bots treat `.anime [query]` as AniList anime information
  [2](https://github.com/Pah-0/neon_bot), and at least one sends the cover as an
  image with the caption, falling back to text when media fails [1](https://github.com/kyyou-ze/Bot-ai-yuzaki-tsukasa).
  So the user's live correction is consistent with the convention: **image + info**,
  not text-only and not a random catgirl.
- Baileys renders a real mention only when the visible text contains `@digits`
  **and** the matching JID is in the `mentions` array [1](https://whiskeysockets-baileys-94.mintlify.app/messaging/text-messages).
- Modern WhatsApp group messages can report a `@lid` participant while supplying
  the real phone number in `participantPn`; a bare 14-digit LID is not a usable
  phone identity [4](https://github.com/WhiskeySockets/Baileys/issues/1683).
  The repo already has `lib/jid.js` `rememberFromKey()` and `lib/mention.js` for
  exactly this mapping.

---

## 2. `.anime Naruto` now sends the cover

`lib/engines/search.js`:

- `ANIME_DETAIL` now requests `coverImage { extraLarge large }` and `bannerImage`.
- `.anime` and `.animeinfo` build the same information caption, then send it as
  an **image caption** using the AniList cover URL. If WhatsApp/Baileys rejects
  the image, it falls back to the text answer instead of failing.
- The caption still contains title, episodes, duration, year, status, score,
  popularity, genres, studio, synopsis and the AniList link. A short
  `🖼️ Cover: AniList` line makes the image source honest.
- Descriptions are now `Anime info + cover image by title` and
  `Anime details + cover image`.

Live smoke from this workspace:

```text
ANIME IMAGE URL:
https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20-dE6UHbFFg1A5.jpg

CAPTION HEAD:
🎌 *NARUTO* | _Naruto_ | 📺 220 episodes · 23 min
```

`.animepic`, `.randomanime`, `.animeimg` and `.animeimage` still mean random
anime artwork. `.image`, `.gimage`, `.unsplash`, `.pexels` and `.pixabay` remain
honest fallbacks. No unknown/ambiguous command was guessed at.

---

## 3. Anti-bug notice now identifies the person

The old `sessionManager.js` branch was internally contradictory:

- `checkSpam()` correctly returned a **temporary** rate-limit drop, but the caller
  still invoked `handleBlock()` and sent a DM saying the number was blocked
  permanently.
- The DM showed only `senderNum`, which for a modern group can be a 14-digit
  `@lid` such as `97405882134595`, with no name, no `@tag`, no group, and no
  resolved phone number.

`lib/anti/antiBug.js` now:

- Tags every rate-limit result with `temporary: true`, `permanent: false`, and
  says `nobody blocked`.
- Keeps the existing `lib/jid.js` / `lib/mention.js` identity resolution.
- Exports `formatIncident()` and `shouldNotify()`.
- `formatIncident()` produces a tappable `@number`, the sender's `pushName`, the
  group/DM, the raw `@lid`, the resolved phone number when Baileys supplied it,
  the reason, and a matching `mentions` array.
- `shouldNotify()` allows one owner DM per sender per incident type per 30s, so a
  burst cannot flood the owner's chat.

`lib/sessionManager.js` now:

- Calls `handleBlock()` **only** for a permanent block-list decision, never for a
  temporary throttle.
- Reads `participantPn`, `senderPn`, `participantAlt` and `remoteJidAlt` when
  available.
- Sends the new incident card with `mentions` and `linkPreview: false`.
- No longer contains the false “blocked permanently and cannot message you again”
  sentence for a rate-limit event.

Example owner DM for the reported case:

```text
🛡️ *ANTI-BUG PROTECTION*

⏱️ *Temporary flood guard — message dropped*

👤 *Sender:* @2348012345678 — Tunde
💬 *Where:* Group `120363400000000000@g.us`
🔎 *Raw ID:* `97405882134595@lid`
📇 *Phone:* @2348012345678 _(resolved from WhatsApp)_
⚡ *Reason:* Rate limit: 9 messages in 4161ms (temporary flood guard — nobody blocked)

_Nobody was blocked. This burst was dropped; normal messages resume after the window resets._
```

`mentions`: `["2348012345678@s.whatsapp.net"]`.

If WhatsApp does not supply a phone-number alternative, the card says so and
uses the linked ID instead of inventing a number. The owner still gets the
display name, group, raw ID and tappable linked-ID mention.

---

## 4. Tests and validation

- `npm run test:command-truth-2` → **20/20**; new mocked `.anime Naruto` check
  asserts an AniList image URL and the info caption.
- `npm run test:search` → **67/67**; new live check asserts the cover image is
  actually sent, not just described.
- `npm run test:live` → **22/22**; new checks pin temporary-vs-permanent spam
  results, the `@number`/name/group/LID notice, the `mentions` array, notice
  cooldown, and removal of the contradictory sentence.
- `npm run test:all` → **57 suites, exit 0, 0 `✗`**.
- `node --check` passes on every changed JavaScript file.
- `git diff --check` passes.
- No live WhatsApp retest was possible from this workspace; the user's next live
  test should show an image with the info caption and a readable owner DM.

---

## 5. Boundaries

- `.rate`, `.vv dm`, `.hidetag`, `.tagall`, the badge/tick, API-key layer,
  Supabase, Vercel and Railway were untouched.
- No hidden/covert deletion, no anti-delete whitelist, no key storage.
- The previously supplied raw GitHub PAT and Railway token should still be
  rotated/revoked.
- Railway auto-deploy is off: after any future push, a manual **Redeploy** is
  needed before a live WhatsApp retest.
