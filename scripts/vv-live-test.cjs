#!/usr/bin/env node
/**
 * vv-live-test.cjs — the production failure, reproduced end to end.
 *
 * Every other .vv suite stubs `getCachedMedia` with a Buffer and replies to a
 * quote that still carries a media node. That is the ONE shape that always
 * worked. Real view-once quotes arrive STRIPPED, so the bytes come from the
 * arrival cache and there is no media node anywhere in the quote.
 *
 * What shipped, from the production log:
 *
 *   [CACHE] captured 3EB076EED6644A5EFF2AD5 (1841 KB)
 *   [VV] 1/4 served from the media cache (...)
 *   ❌ Downloaded it but could not send it back
 *      (Cannot read properties of null (reading 'mimetype'))
 *
 * So the media was captured and then thrown away at the last step. This suite
 * writes a REAL cache entry through precacheMedia() and runs the real .vv
 * against a stripped quote — no stubbed getter, no injected buffer.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// paths.js resolves once, at require time — point it at a throwaway volume
// BEFORE anything else is loaded.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-vv-live-'));
process.env.AUTH_DIR_ROOT = TMP;
process.env.SILENT = '1';

const ROOT = path.resolve(__dirname, '..');
const mediaCache = require(path.join(ROOT, 'lib', 'mediaCache'));
const vv = require(path.join(ROOT, 'lib', 'commands', 'vv'));
const { _internals } = vv;

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fails.push(`${name} :: ${detail}`); console.log(`  ✘ ${name}   ${detail}`); }
};

const mediaNode = (kind, extra = {}) => ({
  [`${kind}Message`]: {
    mimetype: kind === 'image' ? 'image/jpeg' : 'video/mp4',
    mediaKey: Buffer.from('a-media-key'),
    directPath: '/v/t62/some-direct-path',
    url: 'https://mmg.whatsapp.net/o',
    viewOnce: true,
    ...extra,
  },
});

/** One real arrival, captured exactly as sessionManager does it. */
async function capture(id, kind, extra = {}) {
  const incoming = {
    key: { id, remoteJid: '2348000000001@s.whatsapp.net', fromMe: false },
    pushName: 'Sender',
    message: { viewOnceMessageV2Extension: { message: mediaNode(kind, extra) } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
  const bytes = Buffer.from(`REAL-${kind.toUpperCase()}-BYTES-FOR-${id}`);
  const entry = await mediaCache.precacheMedia(incoming, {
    downloadMediaMessage: async () => bytes,
  });
  return { id, bytes, entry };
}

/** The command the user actually sends: a reply to a STRIPPED view-once. */
function strippedReply(id, args = []) {
  return {
    key: { id: 'CMD-' + id, remoteJid: '120363000000000000@g.us', fromMe: false },
    pushName: 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      extendedTextMessage: {
        text: '.vv' + (args.length ? ' ' + args.join(' ') : ''),
        contextInfo: {
          stanzaId: id,
          participant: '2348000000001@s.whatsapp.net',
          quotedMessage: { viewOnceMessageV2Extension: { message: {} } },
        },
      },
    },
  };
}

function harness(msg, args = []) {
  const sent = [], replied = [];
  const ctx = {
    sock: {
      sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; },
      updateMediaMessage: async () => ({}),
    },
    msg,
    from: msg.key.remoteJid,
    reply: async (t) => { replied.push(String(t)); return {}; },
    download: undefined,
    args,
    dbSession: { phoneNumber: '2348099999999' },
  };
  return { ctx, sent, replied };
}

(async () => {
  console.log('\n══ .vv — cached bytes + stripped quote (the production case) ══\n');

  /* 1. image ------------------------------------------------------------- */
  const img = await capture('VVIMG1', 'image', { caption: 'the address is 12 Lagos St' });
  ok('the arrival was actually written to the media cache', Boolean(img.entry),
     JSON.stringify(img.entry));
  const meta = mediaCache.getCachedMediaMeta('VVIMG1');
  ok('the cache remembers the send kind, not the useless word "media"',
     meta && meta.kind === 'image', JSON.stringify(meta));
  ok('the cache remembers the sender caption',
     meta && meta.caption === 'the address is 12 Lagos St', JSON.stringify(meta));

  {
    const { ctx, sent, replied } = harness(strippedReply('VVIMG1'));
    await vv.execute(ctx);
    ok('a stripped quote + cached image sends the photo instead of an error',
       sent.length === 1 && Boolean(sent[0].content.image),
       `sent=${JSON.stringify(sent.map((s) => Object.keys(s.content)))} replies=${JSON.stringify(replied)}`);
    ok('no "could not send it back" error is emitted',
       !replied.some((r) => /could not|❌/i.test(r)), replied.join(' | '));
    ok('the original caption survives the unlock',
       /the address is 12 Lagos St/.test(String(sent[0]?.content?.caption || '')),
       String(sent[0]?.content?.caption || ''));
  }

  /* 2. video — the branch that literally threw on media.mimetype ---------- */
  const vid = await capture('VVVID1', 'video');
  ok('a video arrival is cached too', Boolean(vid.entry), JSON.stringify(vid.entry));
  {
    const { ctx, sent, replied } = harness(strippedReply('VVVID1'));
    await vv.execute(ctx);
    ok('a stripped quote + cached video is sent as video/mp4',
       sent.length === 1 && Boolean(sent[0].content.video) &&
       sent[0].content.mimetype === 'video/mp4',
       `sent=${JSON.stringify(sent.map((s) => Object.keys(s.content)))} replies=${JSON.stringify(replied)}`);
  }

  /* 3. payloadFor must tolerate a missing node on its own ---------------- */
  ok('payloadFor never dereferences a null media node', (() => {
    try {
      const out = _internals.payloadFor('video', Buffer.from('x'), null);
      return out.video && out.mimetype === 'video/mp4';
    } catch (e) { return false; }
  })());

  /* 4. `.vv dm` must not forward into the group -------------------------- */
  {
    const quoted = {
      viewOnceMessageV2: {
        message: mediaNode('image', { viewOnce: true }),
      },
    };
    const msg = strippedReply('VVDM1', ['dm']);
    msg.message.extendedTextMessage.contextInfo.quotedMessage = quoted;
    const { ctx, sent, replied } = harness(msg, ['dm']);
    await vv.execute(ctx);
    const fwd = sent.find((s) => s.content && s.content.forward);
    ok('.vv dm forwards to the owner, not the group',
       Boolean(fwd) && fwd.jid === '2348099999999@s.whatsapp.net',
       `destinations=${JSON.stringify(sent.map((s) => s.jid))}`);
    ok('.vv dm says where it went',
       replied.some((r) => /Sent privately/.test(r)), replied.join(' | '));
  }

  /* 5. no cache at all must keep the honest explanation ------------------ */
  {
    const { ctx, replied } = harness(strippedReply('NEVER-CAPTURED'));
    await vv.execute(ctx);
    ok('an item that never arrived still explains how .vv works',
       replied.some((r) => /phone|stripped/i.test(r)), replied.join(' | ').slice(0, 180));
  }

  console.log(`\n${fails.length ? '✘' : '✔'} ${pass}/${pass + fails.length} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  • ' + f));
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(fails.length ? 1 : 0);
})();
