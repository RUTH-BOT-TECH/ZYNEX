/**
 * lib/deviceIdentity.js — what kind of device this bot claims to be.
 *
 * ★ The question this answers: "`.vv` works in WhatsApp on an Android browser,
 *   so why not here?"
 *
 * Because the two are not the same device. A browser on an Android phone is
 * ANDROID_PHONE (PlatformType 16). This bot identified as Chrome on Chrome —
 * CHROME (1) — which WhatsApp treats as a desktop-ish web client. View-once
 * media is not relayed to that device type; it receives a keyless stub, which is
 * exactly what the production log showed:
 *
 *   keys=[interactiveAnnotations,scanLengths,annotations,viewOnce]
 *   directPath=MISSING  url=MISSING  mediaKey=MISSING
 *
 * ── And the trap that made the first Android attempt fail ────────────────────
 *
 * Baileys derives the platform from `browser[0]` and nothing else:
 *
 *   getPlatformId(browser) {
 *     const platformType = proto.DeviceProps.PlatformType[browser.toUpperCase()]
 *     return platformType ? platformType.toString() : '1'   // chrome
 *   }
 *
 * `Browsers.android('Chrome')` returns ['Chrome', 'Android', ''] — so the
 * platform came from 'Chrome' and the device was CHROME while the OS field said
 * Android. A device that lies about itself is what WhatsApp declines to link,
 * which is why that attempt "broke pairing".
 *
 * AND there is no 'ANDROID' key in PlatformType at all — the value is
 * ANDROID_PHONE (16). Presenting Android therefore needs:
 *
 *   browser: ['ANDROID_PHONE', 'Chrome', '130.0.6723.58']
 *            ^ platform token        ^ shown in Linked Devices
 *
 * ── Why this is opt-in and not the default ──────────────────────────────────
 *
 * Changing identity mid-session is not safe: the creds in auth_state carry the
 * identity used at first pairing. Flipping it afterwards can invalidate the
 * session, and an already-linked device cannot silently become an Android phone.
 * So the default stays Chrome, and switching is an explicit decision made before
 * a fresh pairing — with a warning, because the cost is a re-pair, not because
 * the code is risky.
 */

const { proto } = require('@whiskeysockets/baileys');

const P = proto.DeviceProps.PlatformType;

/**
 * Identity presets. `platform` is the token getPlatformId reads out of
 * browser[0]; `label` is what appears in WhatsApp → Linked Devices.
 */
const PRESETS = {
  chrome: { browser: ['Chrome', 'Chrome', '130.0.0'], platform: P.CHROME },
  android: { browser: ['ANDROID_PHONE', 'Chrome', '130.0.6723.58'], platform: P.ANDROID_PHONE },
  desktop: { browser: ['DESKTOP', 'Desktop', '2.2440.9'], platform: P.DESKTOP },
};

const ALIASES = {
  '': 'chrome', default: 'chrome', web: 'chrome', browser: 'chrome',
  chrome: 'chrome',
  android: 'android', phone: 'android', android_phone: 'android',
  desktop: 'desktop', macos: 'desktop', windows: 'desktop',
};

/**
 * Resolve DEVICE_IDENTITY. Returns { name, browser, platform, label, note }.
 * An unknown value falls back to chrome and says so rather than throwing —
 * a bot that will not boot is worse than a bot with the wrong identity.
 */
function resolve(raw = process.env.DEVICE_IDENTITY) {
  const key = ALIASES[String(raw || '').trim().toLowerCase()];
  if (!key) {
    return {
      ...PRESETS.chrome,
      name: 'chrome',
      label: 'Chrome',
      note: `unknown DEVICE_IDENTITY '${raw}' — using chrome`,
    };
  }
  const p = PRESETS[key];
  return { ...p, name: key, label: p.browser[0] === 'ANDROID_PHONE' ? 'Android' : p.browser[1], note: null };
}

/**
 * The browser tuple to hand makeWASocket.
 *
 * This is the whole fix for the failed first attempt: browser[0] must be a
 * PlatformType token, not a product name.
 */
function browserFor(raw) {
  return resolve(raw).browser;
}

/**
 * Would switching to `next` invalidate sessions that already paired as `prev`?
 * True whenever the platform token differs — WhatsApp ties the linked device to
 * the identity it was linked with.
 */
function needsRepair(prev, next) {
  return resolve(prev).platform !== resolve(next).platform;
}

module.exports = { resolve, browserFor, needsRepair, PRESETS, PLATFORM: P };
