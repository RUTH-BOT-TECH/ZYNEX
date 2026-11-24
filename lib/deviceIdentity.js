/**
 * lib/deviceIdentity.js — what kind of device this bot claims to be.
 *
 * ── Why `.vv` could not unlock anything on the live host ─────────────────────
 *
 * WhatsApp's November 2026 protocol update only fanouts view-once media to
 * ANDROID-class companion devices. A WEB/Chrome companion receives a
 * `view_once_unavailable_fanout` ciphertext stand-in instead; Baileys rc14
 * ACKs and drops it BEFORE `messages.upsert`, so there is nothing to store,
 * nothing to cache, and the quoted view-once is a keyless stub:
 *
 *   keys=[interactiveAnnotations,scanLengths,annotations,viewOnce]
 *   directPath=MISSING  url=MISSING  mediaKey=MISSING
 *
 * Production log, twice at boot:
 *
 *   [IDENTITY] ⚠ This session was linked as platform android
 *   but DEVICE_IDENTITY now presents 1 (chrome).
 *
 * The session WAS paired as Android. Two separate defects made the live socket
 * present Chrome anyway:
 *
 *  1. `DEVICE_IDENTITY` was not set on the host, so resolve() defaulted to
 *     chrome — even though `creds.platform` (written by Baileys at pairing)
 *     says `android`. An env var should never be able to silently contradict
 *     the identity a session was actually linked with.
 *
 *  2. The old "android" preset was ['ANDROID_PHONE','Chrome','130...']. In
 *     Baileys 7.0.0-rc14 that is STILL a web client:
 *
 *       validate-connection.js:16  getUserAgent() checks browser[1] for "android"
 *       validate-connection.js:85  getPlatformType(browser[1])
 *       socket.js:30               warns only when browser[1] includes "android"
 *
 *     `getPlatformId(browser[0])` is from an older Baileys and is no longer
 *     used for registration/login. Baileys' own `Browsers.android('Chrome')`
 *     returns `['Chrome','Android','']` — browser[1] is the platform token.
 *     So the correct tuple is ['Chrome','Android','<version>'].
 *
 * Fixes here:
 *  - `android` now presents a genuine Android companion (browser[1]='Android').
 *  - `resolveForSession()` auto-matches `creds.platform` when no explicit
 *    DEVICE_IDENTITY is set, so an already-linked Android session stops
 *    pretending to be Chrome without anyone having to configure the host.
 *  - `platformMatches()` compares names, not a name against a numeric ID
 *    (the old warning compared 'android' to 16 and always fired).
 *
 * ── Still true ──────────────────────────────────────────────────────────────
 *
 * Changing identity on a session that paired as a DIFFERENT platform can
 * invalidate the link; that needs a fresh pairing. Auto-matching the stored
 * platform is safe — it restores the identity the session already has.
 */

const { proto } = require('@whiskeysockets/baileys');

const P = proto.DeviceProps.PlatformType;

/**
 * Identity presets.
 *
 * `browser[1]` is what rc14 reads to decide WEB vs ANDROID (getUserAgent +
 * getPlatformType). `browser[0]` is only the display/OS string. `platform` is
 * the DeviceProps.PlatformType number, used for diagnostics and re-pair checks.
 */
const PRESETS = {
  chrome:  { browser: ['Chrome', 'Chrome', '130.0.0'],        platform: P.CHROME,        label: 'Chrome' },
  android: { browser: ['Chrome', 'Android', '130.0.6723.58'], platform: P.ANDROID_PHONE, label: 'Android' },
  desktop: { browser: ['DESKTOP', 'Desktop', '2.2440.9'],      platform: P.DESKTOP,       label: 'Desktop' },
};

const ALIASES = {
  '': 'chrome', default: 'chrome', web: 'chrome', browser: 'chrome',
  chrome: 'chrome',
  android: 'android', phone: 'android', android_phone: 'android',
  desktop: 'desktop', macos: 'desktop', windows: 'desktop',
};

/**
 * Baileys writes `creds.platform` from the `<platform name="...">` node at
 * pairing (configureSuccessfulPairing). It is a NAME like `android`, not the
 * numeric DeviceProps value — which is why the old comparison always warned.
 */
function normalisePlatform(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['android', 'android_phone', 'phone', '16'].includes(s)) return 'android';
  if (['chrome', 'web', 'browser', '1'].includes(s)) return 'chrome';
  if (['desktop', 'macos', 'windows', '7'].includes(s)) return 'desktop';
  return null;
}

/**
 * Resolve DEVICE_IDENTITY. An unknown value falls back to chrome and says so
 * rather than throwing — a bot that will not boot is worse than a wrong identity.
 */
function resolve(raw = process.env.DEVICE_IDENTITY) {
  const key = ALIASES[String(raw || '').trim().toLowerCase()];
  if (!key) {
    return {
      ...PRESETS.chrome,
      name: 'chrome',
      note: `unknown DEVICE_IDENTITY '${raw}' — using chrome`,
    };
  }
  const p = PRESETS[key];
  return { ...p, name: key, note: null };
}

/**
 * ★ Resolve for a REAL session: honour an explicit env var, otherwise follow
 * the platform this session was paired as. This is the fix for the live host —
 * no Railway variable needed, and no re-pair, because we are restoring (not
 * changing) the linked identity.
 *
 * `matched` is set when the stored platform was used, so the boot log can say
 * that view-once delivery is enabled instead of emitting a scary warning.
 */
function resolveForSession(raw = process.env.DEVICE_IDENTITY, storedPlatform) {
  const explicit = String(raw ?? '').trim();
  if (explicit) return resolve(explicit);
  const key = normalisePlatform(storedPlatform);
  if (!key) return resolve(undefined);
  return { ...resolve(key), matched: String(storedPlatform) };
}

/** Does an already-linked session agree with the identity we are presenting? */
function platformMatches(storedPlatform, identity) {
  const key = normalisePlatform(storedPlatform);
  if (!key) return true; // unknown creds shape: don't cry wolf
  return key === identity.name;
}

/** The browser tuple to hand makeWASocket. */
function browserFor(raw = process.env.DEVICE_IDENTITY, storedPlatform) {
  return resolveForSession(raw, storedPlatform).browser;
}

/** Would switching to `next` invalidate sessions that paired as `prev`? */
function needsRepair(prev, next) {
  return resolve(prev).platform !== resolve(next).platform;
}

module.exports = {
  resolve, resolveForSession, platformMatches, browserFor, needsRepair,
  normalisePlatform, PRESETS, PLATFORM: P,
};
