/**
 * Device identity — what the bot claims to be to WhatsApp.
 *
 * The user's question was the key one: ".vv works in an Android browser, so why
 * not here?" Because they are different device types, and the first attempt at
 * presenting Android broke pairing. This pins both facts so the mistake cannot
 * come back.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { proto } = require('@whiskeysockets/baileys');
const id = require('../lib/deviceIdentity');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };

const P = proto.DeviceProps.PlatformType;

t('the default identity is unchanged, so no live session breaks', () => {
  const r = id.resolve(undefined);
  assert.deepStrictEqual(r.browser, ['Chrome', 'Chrome', '130.0.0']);
  assert.strictEqual(r.platform, P.CHROME);
});

t('android presents a genuine ANDROID companion (Baileys rc14 reads browser[1])', () => {
  const r = id.resolve('android');
  // rc14: getUserAgent() and getPlatformType() BOTH read browser[1].
  // `Browsers.android('Chrome')` returns ['Chrome','Android',''] — that is
  // the shape WhatsApp recognises as an Android companion.
  assert.strictEqual(r.browser[1], 'Android', 'browser[1] must say Android');
  assert.ok(r.browser[1].toLowerCase().includes('android'), 'the socket would still log in as WEB');
  assert.strictEqual(r.platform, P.ANDROID_PHONE);
  assert.strictEqual(r.label, 'Android');
});

t("the wrong shape ('Chrome' first) would silently resolve to CHROME", () => {
  // this is exactly what Browsers.android('Chrome') produced
  const bogus = ['Chrome', 'Android', ''];
  const resolved = proto.DeviceProps.PlatformType[bogus[0].toUpperCase()] || 1;
  assert.strictEqual(resolved, P.CHROME, 'the trap is no longer real — update this test');
  // and there is no plain 'ANDROID' key, only ANDROID_PHONE
  assert.strictEqual(P.ANDROID, undefined);
  assert.strictEqual(P.ANDROID_PHONE, 16);
});

/** getPlatformType() in Baileys rc14 — reads browser[1], not browser[0]. */
const platformFromBrowser = (b) => {
  const u = String(b).toUpperCase();
  if (u === 'ANDROID') return P.ANDROID_PHONE;
  return P[u] || P.CHROME;
};

t('every preset resolves to a real platform', () => {
  for (const name of Object.keys(id.PRESETS)) {
    const r = id.resolve(name);
    assert.strictEqual(r.platform, platformFromBrowser(r.browser[1]), `${name}: browser[1] does not map to its platform`);
    assert.strictEqual(r.note, null, `${name} produced a note: ${r.note}`);
  }
});

t('an already-linked Android session is auto-matched without any env var', () => {
  const r = id.resolveForSession(undefined, 'android');
  assert.strictEqual(r.name, 'android', 'the linked platform was ignored');
  assert.strictEqual(r.browser[1], 'Android');
  assert.strictEqual(r.matched, 'android');
  assert.strictEqual(r.note, null, 'a healthy match must not emit a warning');
});

t('an explicit DEVICE_IDENTITY still wins over the stored platform', () => {
  const r = id.resolveForSession('chrome', 'android');
  assert.strictEqual(r.name, 'chrome');
  assert.ok(!r.matched, 'explicit config must not be silently overridden');
});

t('platformMatches compares names, not a name against a numeric platform id', () => {
  // The old boot warning did String('android') !== String(16) and ALWAYS fired.
  assert.strictEqual(id.platformMatches('android', id.resolve('android')), true);
  assert.strictEqual(id.platformMatches('ANDROID_PHONE', id.resolve('android')), true);
  assert.strictEqual(id.platformMatches(16, id.resolve('android')), true);
  assert.strictEqual(id.platformMatches('android', id.resolve('chrome')), false);
  assert.strictEqual(id.platformMatches(undefined, id.resolve('chrome')), true, 'unknown creds must not cry wolf');
});

t('an unknown value falls back instead of refusing to boot', () => {
  const r = id.resolve('nonsense');
  assert.strictEqual(r.platform, P.CHROME);
  assert.ok(/unknown DEVICE_IDENTITY/.test(r.note));
});

t('switching identity is flagged as needing a re-pair', () => {
  assert.strictEqual(id.needsRepair('chrome', 'android'), true);
  assert.strictEqual(id.needsRepair('chrome', 'chrome'), false);
});

t('all three socket paths use the resolver', () => {
  for (const f of ['lib/sessionManager.js', 'lib/panelBot.js', 'lib/bot.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!/deviceIdentity'\)\.browserFor|identity\.browser/.test(src)) {
      throw new Error(`${f} does not use the identity resolver`);
    }
    if (/browser:\s*\['Chrome',\s*'Chrome'/.test(src) || /Browsers\.appropriate\('Chrome'\)/.test(src)) {
      throw new Error(`${f} still hardcodes a browser tuple`);
    }
  }
});

t('a session linked as another platform is warned about before connecting', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/sessionManager.js'), 'utf8');
  if (!/storedPlatform/.test(src)) throw new Error('no boot-time identity comparison');
  if (!/will likely drop the link/.test(src)) throw new Error('the warning does not say what will happen');
});

t('identity is decided before makeWASocket is called', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/sessionManager.js'), 'utf8');
  const idAt = src.indexOf('const identity = identityModule.resolveForSession(');
  const sockAt = src.indexOf('const sock = makeWASocket(');
  if (idAt === -1) throw new Error('identity is not resolved for the session');
  if (idAt > sockAt) throw new Error('identity resolved after the socket was created');
});

t('the other two socket paths also pass the stored platform', () => {
  for (const f of ['lib/panelBot.js', 'lib/bot.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/browserFor\(undefined,\s*state\.creds\?\.platform\)/.test(src), `${f} ignores creds.platform`);
  }
});

console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
