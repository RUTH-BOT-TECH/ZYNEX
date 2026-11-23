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
   * The tuple moved into lib/deviceIdentity.js so all three socket paths agree.
   * What still matters is the original rule: browser[0] must be a PlatformType
   * key, or Baileys silently pairs as CHROME while the OS field says otherwise.
   */
  const id = require('../lib/deviceIdentity');
  const { proto } = require('@whiskeysockets/baileys');
  for (const name of Object.keys(id.PRESETS)) {
    const r = id.resolve(name);
    const platform = proto.DeviceProps.PlatformType[String(r.browser[0]).toUpperCase()];
    assert.ok(platform !== undefined,
      `${name}: '${r.browser[0]}' is not a PlatformType — it silently falls back to CHROME`);
    assert.strictEqual(platform, r.platform, `${name}: platform disagrees with browser[0]`);
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
  // Researched answer (juniorkrz/stickerbot #88): a view-once never reaches a
  // companion device, but a reply sent from the phone that received it carries
  // the full media node in contextInfo.quotedMessage. Telling the user that is
  // more useful than any error message.
  const src = fs.readFileSync(path.join(ROOT, 'lib/commands/vv.js'), 'utf8');
  assert.ok(/Reply to it from your phone/i.test(src), 'the working method is not explained');
  assert.ok(/Do not open it/i.test(src), 'the "do not open it first" condition is missing');
  assert.ok(/quote is the only route/i.test(src), 'must say where the media comes from');
});

t('capture refuses a stub instead of storing junk', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  assert.ok(/cacheable/.test(src), 'no cacheability check before download');
  assert.ok(/\[VV-ARRIVE\]/.test(src), 'view-once arrivals must be logged to be diagnosable');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
