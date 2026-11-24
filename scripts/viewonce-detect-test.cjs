#!/usr/bin/env node
/**
 * View-once detection and the browser identity that makes it possible.
 *
 * The production finding this encodes:
 *
 *   [VV] node inventory. keys=["interactiveAnnotations","scanLengths",
 *        "annotations","viewOnce"] directPath=MISSING url=MISSING mediaKey=MISSING
 *
 * WhatsApp withholds view-once media from web-class linked devices. A companion
 * announcing Chrome/Ubuntu gets a placeholder, so the bot never receives the
 * content and there is nothing to cache — `.vv` then has nothing to unlock no
 * matter how correct the command is.
 *
 * Baileys 7 added Browsers.android(), which announces a companion that does
 * receive view-once media, plus normalizeMessageContent() which covers every
 * wrapper shape.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const baileys = require('@whiskeysockets/baileys');

console.log('\n══ browser identity ══\n');

t('Baileys 7 exposes an android identity', () => {
  assert.ok(typeof baileys.Browsers.android === 'function', 'Browsers.android is missing');
  const b = baileys.Browsers.android('ZYNEX');
  assert.deepStrictEqual(b, ['ZYNEX', 'Android', '']);
});

/**
 * The browser identity must be a REAL platform, because Baileys derives the
 * platform id from the first element only:
 *
 *   getPlatformId(browser) => proto.DeviceProps.PlatformType[browser[0].toUpperCase()] || '1'
 *
 * `Browsers.android(name)` returns [name, 'Android', ''] — so the platform came
 * from the bot name, 'ZYNEX-MD' matched nothing, and it silently fell back to
 * CHROME while the OS said Android. WhatsApp refused to link the device.
 */
t('the browser identity resolves to a real platform type', () => {
  /*
   * Baileys 7.0.0-rc14 reads browser[1] (getUserAgent + getPlatformType),
   * NOT browser[0]. `getPlatformType('ANDROID')` special-cases ANDROID_PHONE.
   * Putting ANDROID_PHONE in browser[0] while browser[1] said 'Chrome' was
   * the second half of the live `.vv` bug: the socket still logged in as WEB.
   */
  const id = require('../lib/deviceIdentity');
  const P = baileys.proto.DeviceProps.PlatformType;
  for (const name of Object.keys(id.PRESETS)) {
    const r = id.resolve(name);
    const u = String(r.browser[1]).toUpperCase();
    const platform = u === 'ANDROID' ? P.ANDROID_PHONE : P[u];
    assert.ok(platform !== undefined,
      `${name}: '${r.browser[1]}' is not a PlatformType — it silently falls back to CHROME`);
    assert.strictEqual(platform, r.platform, `${name}: platform disagrees with browser[1]`);
  }
});

t('the identity does not use the bot name as a browser name', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  // Strip comments first: the explanation above mentions the call by name, and a
  // source-grepping test matching its own documentation is a trap hit before.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Browsers\.android\(/.test(code),
    'Browsers.android(name) puts the bot name in the browser field, which is not a platform');
});

console.log('\n══ detection across every wrapper ══\n');

const viewOnceShapes = {
  'viewOnceMessage': { viewOnceMessage: { message: { imageMessage: { url: 'u', mediaKey: 'k' } } } },
  'viewOnceMessageV2': { viewOnceMessageV2: { message: { imageMessage: { url: 'u', mediaKey: 'k' } } } },
  'viewOnceMessageV2Extension': { viewOnceMessageV2Extension: { message: { imageMessage: { url: 'u', mediaKey: 'k' } } } },
  'ephemeral-nested': { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u', mediaKey: 'k' } } } } } },
};

for (const [name, shape] of Object.entries(viewOnceShapes)) {
  t(`detects ${name}`, () => {
    const { findMedia } = require(path.join(ROOT, 'lib', 'mediaCache.js'));
    const node = findMedia(shape);
    assert.ok(node, `media node not found in ${name}`);
    assert.ok(node.mediaKey, 'the media key was lost while unwrapping');
  });
}

t('the flat viewOnce flag on an image is recognised as view-once', () => {
  const { findMedia } = require(path.join(ROOT, 'lib', 'mediaCache.js'));
  const node = findMedia({ imageMessage: { viewOnce: true, url: 'u', mediaKey: 'k' } });
  assert.ok(node && node.viewOnce === true);
});

t('a placeholder stub is not mistaken for media', () => {
  // exactly what production received
  const { findMedia } = require(path.join(ROOT, 'lib', 'mediaCache.js'));
  const node = findMedia({
    imageMessage: { viewOnce: true, annotations: [], scanLengths: [], interactiveAnnotations: [] },
  });
  assert.ok(node && !node.mediaKey && !node.url, 'stub should be detectable as un-cacheable');
});

t('.vv explains the route that DOES work, not just that it failed', () => {
  // Nov 2026: the working route is the DEVICE IDENTITY, not a phone-supplied
  // quote. A WEB companion gets a view_once_unavailable_fanout stand-in; an
  // ANDROID companion receives the media itself. Both own and others' items
  // are unlocked the same way, and the request is queued until media arrives.
  const src = fs.readFileSync(path.join(ROOT, 'lib/commands/vv.js'), 'utf8');
  assert.ok(/DEVICE_IDENTITY=android/.test(src), 'the Android identity fix is not explained');
  assert.ok(/creds\.platform/.test(src), 'auto-matching the stored platform is not explained');
  assert.ok(/queuePending\(\)/.test(src), 'the item is not queued for late-arriving media');
  assert.ok(!/you sent yourself/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    'the false "you sent it yourself" refusal is still in the code');
  assert.ok(/view_once_unavailable_fanout/.test(src), 'the real stand-in is not named');
});

t('an empty stub stores nothing, and every arrival is still logged', () => {
  /*
   * This used to assert a `cacheable` pre-check existed. That check was the bug:
   * view-once media arrives WITHOUT a visible key, so the pre-check skipped the
   * one case worth capturing. What matters is the outcome — an empty stub must
   * produce no junk entry — which is now tested directly in
   * scripts/vv-capture-test.cjs ('a genuinely empty stub fails quietly').
   */
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  assert.ok(/\[VV-ARRIVE\]/.test(src), 'view-once arrivals must be logged to be diagnosable');
  assert.ok(!/if \(cacheable && \(await precacheMedia/.test(src),
    'capture is gated on a visible key again — that skips keyless view-once media');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
