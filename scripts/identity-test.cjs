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

t('android presents ANDROID_PHONE as browser[0] — the bug that broke pairing', () => {
  const r = id.resolve('android');
  // getPlatformId reads browser[0].toUpperCase() as a PlatformType key.
  assert.strictEqual(r.browser[0], 'ANDROID_PHONE', 'browser[0] must be a PlatformType token');
  assert.strictEqual(r.platform, P.ANDROID_PHONE);
  assert.ok(P[r.browser[0]] !== undefined, 'browser[0] is not a PlatformType key');
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

t('every preset resolves to a real platform', () => {
  for (const name of Object.keys(id.PRESETS)) {
    const r = id.resolve(name);
    // getPlatformId uppercases browser[0] before the lookup
    assert.strictEqual(r.platform, P[String(r.browser[0]).toUpperCase()], `${name}: browser[0] does not map to its platform`);
    assert.strictEqual(r.note, null, `${name} produced a note: ${r.note}`);
  }
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
  const idAt = src.indexOf('const identity = identityModule.resolve()');
  const sockAt = src.indexOf('const sock = makeWASocket(');
  if (idAt === -1) throw new Error('identity is not resolved');
  if (idAt > sockAt) throw new Error('identity resolved after the socket was created');
});

console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
