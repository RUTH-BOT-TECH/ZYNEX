#!/usr/bin/env node
/**
 * vv-identity-test.cjs — the Railway `.vv` failure, reproduced and fixed.
 *
 * Live log (2026-11-24 18:34–18:36, three attempts):
 *
 *   [IDENTITY] ⚠ This session was linked as platform android
 *              but DEVICE_IDENTITY now presents 1 (chrome)
 *   [VV] node inventory. keys=["interactiveAnnotations","scanLengths",
 *        "annotations","viewOnce"] directPath=MISSING url=MISSING mediaKey=MISSING
 *   [VV] all routes failed. stanzaId=AC1CA7EF… original=not-stored cached=no
 *        quotedKey=false type=image fromMe=true
 *        routes=["… No valid media URL or directPath present in message" ×3]
 *
 * Causes, all now covered here:
 *  1. `DEVICE_IDENTITY` unset → socket presented WEB although creds said android.
 *  2. The "android" preset used browser[0]; rc14 reads browser[1].
 *  3. `fromMe=true` on the owner's COMMAND was misread as "you sent this
 *     view-once yourself" and refused.
 *  4. Keyless stand-ins were dropped before storeMessage / never queued, so a
 *     late-arriving media could not unlock anything ("eventually open").
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-vv-identity-'));
process.env.AUTH_DIR_ROOT = TMP;
process.env.SILENT = '1';
process.env.VV_PENDING_WAIT_MS = '5000';

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
};
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n══ identity: the actual cause ══\n');

const id = require(path.join(ROOT, 'lib', 'deviceIdentity'));

t('Baileys rc14 derives Android from browser[1]', () => {
  const { Browsers } = require('@whiskeysockets/baileys');
  assert.ok(Browsers.android('Chrome')[1].toLowerCase().includes('android'));
  assert.strictEqual(id.resolve('android').browser[1], 'Android');
});

t('an unset DEVICE_IDENTITY follows the platform the session was linked as', () => {
  const r = id.resolveForSession(undefined, 'android');
  assert.strictEqual(r.name, 'android');
  assert.strictEqual(r.matched, 'android');
  assert.strictEqual(r.browser[1], 'Android');
});

t('explicit DEVICE_IDENTITY still wins', () => {
  assert.strictEqual(id.resolveForSession('chrome', 'android').name, 'chrome');
});

t('the boot warning compares names, not a name to a numeric platform id', () => {
  assert.strictEqual(id.platformMatches('android', id.resolve('android')), true);
  assert.strictEqual(id.platformMatches('android', id.resolve('chrome')), false);
});

t('startSocket resolves identity from creds before makeWASocket', () => {
  const sm = code('lib/sessionManager.js');
  const at = sm.indexOf('resolveForSession(process.env.DEVICE_IDENTITY, storedPlatform)');
  assert.ok(at !== -1, 'storedPlatform is not used');
  assert.ok(at < sm.indexOf('const sock = makeWASocket('), 'resolved after the socket');
});

t('the boot log says Android delivery is enabled instead of only warning', () => {
  assert.ok(/Android companions receive view-once media/.test(src('lib/sessionManager.js')));
  assert.ok(/does not deliver view-once media/.test(src('lib/sessionManager.js')));
});

t('all three socket paths pass creds.platform', () => {
  assert.ok(/browserFor\(undefined,\s*state\.creds\?\.platform\)/.test(code('lib/panelBot.js')));
  assert.ok(/browserFor\(undefined,\s*state\.creds\?\.platform\)/.test(code('lib/bot.js')));
});

console.log('\n══ .vv: no false blame, and "eventually open" ══\n');

t('the live log shape is recognised as a keyless stand-in, not a self-sent item', () => {
  const vv = code('lib/commands/vv.js');
  assert.ok(/view_once_unavailable_fanout/.test(vv), 'stand-in not named');
  assert.ok(!/you sent yourself/.test(vv), 'false self-sent refusal remains');
  assert.ok(/DEVICE_IDENTITY=android/.test(vv), 'identity fix not explained');
  assert.ok(/queuePending\(\)/.test(vv), 'no pending queue');
});

t('keyless upserts are stored instead of being dropped before storeMessage', () => {
  const sm = code('lib/sessionManager.js');
  const noMsg = sm.indexOf('Message has no .message field');
  const storeNear = sm.indexOf('await storeMessage(msg)', noMsg);
  assert.ok(noMsg !== -1 && storeNear !== -1 && storeNear - noMsg < 400,
    'the !msg.message branch still discards the stanza');
});

t('every upsert is offered to the pending queue before any early return', () => {
  const sm = code('lib/sessionManager.js');
  const upsert = sm.indexOf("sock.ev.on('messages.upsert'");
  const notify = sm.indexOf('vvPending.onMessage(m)', upsert);
  const skip = sm.indexOf("if (type !== 'notify')", upsert);
  assert.ok(notify !== -1 && skip !== -1 && notify < skip,
    'pending resolution is gated behind the non-notify early return');
});

console.log('\n══ pending queue: media that lands late is delivered once ══\n');

(async () => {
  const pending = require(path.join(ROOT, 'lib', 'viewOncePending'));
  const mediaCache = require(path.join(ROOT, 'lib', 'mediaCache'));

  const stanzaId = 'AC1CA7EFE7B3A5C5C56132FFF65DD67D';
  const sent = [];
  const texts = [];
  const sock = { sendMessage: async (jid, payload) => { sent.push({ jid, payload }); } };
  const msg = {
    key: { remoteJid: '2348021016309@s.whatsapp.net', id: 'CMD1', fromMe: true },
    message: { extendedTextMessage: { text: '.vv', contextInfo: { stanzaId } } },
    pushName: 'Owner',
  };
  const reply = async (text) => texts.push(String(text));

  await pending.register({ stanzaId, sock, from: '123@g.us', msg, reply, toOwner: false, ownerJid: null });
  t('a keyless stand-in registers exactly one waiter', () => {
    assert.strictEqual(pending.stats().waiting, 1);
  });

  // A second `.vv` on the same item must not create a second delivery.
  await pending.register({ stanzaId, sock, from: '123@g.us', msg, reply, toOwner: false, ownerJid: null });
  t('repeating .vv extends the window instead of duplicating it', () => {
    assert.strictEqual(pending.stats().waiting, 1);
  });

  // A bare stub still arrives — must NOT be treated as media.
  await pending.onMessage({
    key: { id: stanzaId, remoteJid: '123@g.us' },
    message: { viewOnceMessageV2Extension: { message: { imageMessage: { viewOnce: true } } } },
  });
  t('another keyless stub does not falsely "deliver" anything', () => {
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(pending.stats().waiting, 1);
  });

  // Real media lands under the same stanzaId (Android fanout / append batch).
  const real = {
    key: { id: stanzaId, remoteJid: '123@g.us', fromMe: false },
    pushName: 'Friend',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      viewOnceMessageV2Extension: {
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            mediaKey: Buffer.from('a-real-media-key'),
            directPath: '/v/t62/real-path',
            url: 'https://mmg.whatsapp.net/o',
            viewOnce: true,
            caption: 'the address is 12 Market St',
          },
        },
      },
    },
  };
  const bytes = Buffer.from('REAL-VIEW-ONCE-BYTES');
  await mediaCache.precacheMedia(real, { downloadMediaMessage: async () => bytes });
  await pending.onMessage(real);

  t('the media is delivered automatically when it finally arrives', () => {
    assert.strictEqual(sent.length, 1, `sent ${sent.length} items`);
    assert.ok(sent[0].payload.image, 'not sent as an image');
    assert.deepStrictEqual(sent[0].payload.image, bytes);
  });
  t('the original caption survives the delayed delivery', () => {
    assert.ok(/12 Market St/.test(sent[0].payload.caption || ''));
  });
  t('the waiter is cleared after delivery', () => {
    assert.strictEqual(pending.stats().waiting, 0);
  });

  // A pending item that never arrives must still explain itself, once.
  const texts2 = [];
  const id2 = 'NEVER_ARRIVES';
  process.env.VV_PENDING_WAIT_MS = '250';
  delete require.cache[require.resolve(path.join(ROOT, 'lib', 'viewOncePending'))];
  const p2 = require(path.join(ROOT, 'lib', 'viewOncePending'));
  await p2.register({
    stanzaId: id2, sock, from: '123@g.us', msg,
    reply: async (text) => texts2.push(String(text)), toOwner: false, ownerJid: null,
  });
  await new Promise((r) => setTimeout(r, 400));
  t('a timeout gives one actionable answer, not silence', () => {
    assert.strictEqual(texts2.length, 1, `got ${texts2.length} replies`);
    assert.ok(/DEVICE_IDENTITY=android/.test(texts2[0]));
    assert.ok(/re-pair/i.test(texts2[0]));
  });

  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
