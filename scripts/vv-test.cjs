/**
 * .vv — view-once unlock.
 *
 * The command was guessed at for a while. This pins it to the three shapes that
 * actually arrive from WhatsApp and to the reference behaviour, so a change that
 * quietly breaks one of them fails here instead of in a user's chat.
 *
 * Reference: juniorkrz/stickerbot #88 — the media comes from
 * contextInfo.quotedMessage of a reply sent from the PHONE, and
 * requestPlaceholderResend was tested and abandoned because the phone never
 * answered. Baileys 7.0.0-rc14 will not even send that request for a view-once
 * stanza ('view_once_unavailable_fanout' is excluded on purpose).
 */
const path = require('path');
const assert = require('assert');
const vv = require('../lib/commands/vv');
const { _internals } = vv;

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };

/* ── the payload shapes ──────────────────────────────────────────────────── */
t('audio is resent as a voice note, not a music file', () => {
  const out = _internals.payloadFor('audio', Buffer.from('x'), { mimetype: 'audio/ogg' });
  assert.strictEqual(out.ptt, true, 'missing ptt — WhatsApp renders a scrub bar');
  assert.ok(/ogg/.test(out.mimetype));
});

t('a non-voice audio clip keeps ptt off', () => {
  const out = _internals.payloadFor('audio', Buffer.from('x'), { mimetype: 'audio/mpeg', ptt: false });
  assert.strictEqual(out.ptt, false);
});

t('image and video payloads stay plain', () => {
  assert.ok(_internals.payloadFor('image', Buffer.from('x'), {}).image);
  const v = _internals.payloadFor('video', Buffer.from('x'), { mimetype: 'video/mp4' });
  assert.ok(v.video && v.mimetype === 'video/mp4');
});

t('a document keeps its own filename', () => {
  const d = _internals.payloadFor('document', Buffer.from('x'), { fileName: 'invoice.pdf' });
  assert.strictEqual(d.fileName, 'invoice.pdf');
});

/* ── helper: build a fake whatsapp message ───────────────────────────────── */
const imageNode = (extra = {}) => ({
  imageMessage: {
    mimetype: 'image/jpeg',
    mediaKey: Buffer.from('key'),
    directPath: '/v/t62/x',
    url: 'https://mmg.whatsapp.net/x',
    ...extra,
  },
});
const replyTo = (quotedMessage, { id = 'STANZA1', args = '' } = {}) => ({
  msg: {
    key: { remoteJid: '234@g.us', fromMe: false, id: 'CMD1' },
    pushName: 'Tester',
    message: {
      extendedTextMessage: {
        text: '.vv' + (args ? ' ' + args : ''),
        contextInfo: { stanzaId: id, participant: '2348000000001@s.whatsapp.net', quotedMessage },
      },
    },
  },
  replied: [],
});

const run = async (message, { cached = null } = {}) => {
  const replied = [];
  const fakeSock = {
    sendMessage: async () => ({}),
    updateMediaMessage: async () => ({}),
  };
  const ctx = {
    sock: fakeSock,
    msg: message,
    from: '234@g.us',
    reply: async (txt) => { replied.push(String(txt)); return {}; },
    download: undefined,
    args: message.args || [],
    dbSession: { phoneNumber: '2348000000001' },
  };
  /*
   * Stub the route .vv reaches first — the media cache. Baileys exposes
   * downloadContentFromMessage as a named ESM export, and assigning to it
   * silently does nothing, so a stub there is a stub that never runs.
   */
  const cache = require('../lib/mediaCache');
  const realGet = cache.getCachedMedia;
  cache.getCachedMedia = (id) => (cached && id === 'STANZA1' ? Buffer.from(cached) : null);
  try {
    await vv.execute(ctx);
  } finally {
    cache.getCachedMedia = realGet;
  }
  return replied;
};

(async () => {
  /* ── shape 1: the working route — quote carries the key ────────────────── */
  await (async () => {
    const { msg } = replyTo(imageNode());
    const out = await run(msg, { cached: 'MEDIA-BYTES' });
    t('a reply that carries the real media key is unlocked', () => {
      // no error text means it went to sendMessage, which is success
      const errs = out.filter((x) => x.startsWith('❌'));
      if (errs.length) throw new Error('failed: ' + errs[0].slice(0, 120));
    });
  })();

  /* ── shape 2: replying to nothing at all ──────────────────────────────── */
  await (async () => {
    const { msg } = replyTo(undefined);
    const out = await run(msg);
    t('a reply to a plain message says how to use it', () => {
      assert.ok(out.some((x) => /Reply to a \*view-once\* message/i.test(x)), out[0]);
      assert.ok(out.some((x) => /\.vv why/.test(x)), 'does not advertise the diagnosis command');
    });
  })();

  /* ── shape 3: the stripped quote — the normal real-world failure ───────── */
  await (async () => {
    const stripped = { viewOnceMessageV2Extension: { message: {} } };
    const { msg } = replyTo(stripped);
    const out = await run(msg);
    t('a stripped view-once quote explains what to do, not what went wrong', () => {
      const joined = out.join('\n');
      assert.ok(/Reply to it from your phone|phone/i.test(joined), joined.slice(0, 200));
    });
  })();

  /* ── shape 4: the diagnosis command ───────────────────────────────────── */
  await (async () => {
    const stripped = { viewOnceMessageV2Extension: { message: {} } };
    const { msg } = replyTo(stripped);
    msg.message.extendedTextMessage.text = '.vv why';
    msg.args = ['why'];
    const out = await run(msg, { cached: null });
    t('.vv why names the failure cause', () => {
      const joined = out.join('\n');
      assert.ok(/View-once diagnosis/.test(joined), joined.slice(0, 120));
      assert.ok(/recipient|stripped|wrong thing/i.test(joined), 'no cause named');
      assert.ok(/Quote carries media key: no/.test(joined), 'did not report the key state');
    });
  })();

  /* ── shape 5: replying to a text message, not a view-once ─────────────── */
  await (async () => {
    const { msg } = replyTo({ conversation: 'just text' });
    const out = await run(msg);
    t('replying to ordinary text says there is nothing to unlock', () => {
      const joined = out.join('\n');
      assert.ok(/no view-once|nothing to unlock|Reply to a/i.test(joined), joined.slice(0, 160));
    });
  })();

  /* ── the re-upload route ──────────────────────────────────────────────── */
  t('an expired item with a media key attempts a re-upload', () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../lib/commands/vv.js'), 'utf8');
    if (!/updateMediaMessage\(\{/.test(src)) throw new Error('the media-retry route is not wired');
    // it must only fire when there is a key to retry with
    if (!/retryableNode\s*=\s*hasKey/.test(src)) throw new Error('retry does not check for a mediaKey');
  });

  t('the retry route is tried after the free routes, not instead of them', () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../lib/commands/vv.js'), 'utf8');
    const retryAt = src.indexOf("name: 'media retry request");
    const cacheAt = src.indexOf('served from the media cache');
    if (cacheAt === -1) throw new Error('cache route missing');
    if (retryAt < cacheAt) throw new Error('a network retry runs before the free cache read');
  });

  /* ── the arrival log ──────────────────────────────────────────────────── */
  t('a view-once that arrives with no media node is still logged', () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../lib/sessionManager.js'), 'utf8');
    // the old line lived inside `if (node)` — the keyless case logged nothing
    if (!/if \(m\.key\?\.isViewOnce \|\| node\?\.viewOnce\)/.test(src)) {
      throw new Error('a keyless view-once arrival is invisible in the logs');
    }
    if (!/unwrapForLog/.test(src)) throw new Error('the log cannot see inside the wrapper');
  });

  /* ── the failure that was actually happening ──────────────────────────── */
  /**
   * The live log had fromMe=true on EVERY `.vv` — because on a self-bot the
   * owner's own command messages are fromMe. The old code read that as
   * "you sent this view-once yourself, no bot can recover it" and refused.
   * That was a lie: the item was a view_once_unavailable_fanout stand-in from
   * a WEB companion. Own and peer view-once are unlocked identically once the
   * Android identity is restored, so both must be queued, never blamed.
   */
  await (async () => {
    const stub = { interactiveAnnotations: {}, scanLengths: [], annotations: {}, viewOnce: true };
    const { msg } = replyTo(stub);
    msg.key.fromMe = true;                 // ← all three production attempts
    const out = await run(msg);
    t('a self-sent command is NOT wrongly told "you sent it yourself"', () => {
      const joined = out.join('\n');
      if (/you sent yourself/i.test(joined)) throw new Error('fromMe=true on a command was misread as the quoted author');
      if (!/queued|wait/i.test(joined)) throw new Error('no queued/awaiting-media reply: ' + joined.slice(0, 140));
      if (!/DEVICE_IDENTITY=android/.test(joined)) throw new Error('does not name the identity fix');
    });
  })();

  await (async () => {
    const stub = { interactiveAnnotations: {}, scanLengths: [], annotations: {}, viewOnce: true };
    const { msg } = replyTo(stub);
    msg.key.fromMe = false;                // somebody else's, but still a stub
    const out = await run(msg);
    t("somebody else's stub is not blamed on the sender", () => {
      const joined = out.join('\n');
      if (/you sent yourself/i.test(joined)) throw new Error('misattributed a peer message to the user');
      if (!/queued|wait/i.test(joined)) throw new Error('peer item was not queued: ' + joined.slice(0, 140));
    });
  })();

  /* ── the forward route: what other devs actually do ───────────────────── */
  await (async () => {
    const { msg } = replyTo({
      viewOnceMessageV2: { message: imageNode({ viewOnce: true }) },
    });
    const sent = [];
    const fakeSock = { sendMessage: async (jid, content) => { sent.push(content); return {}; }, updateMediaMessage: async () => ({}) };
    const ctx = {
      sock: fakeSock, msg, from: '234@g.us',
      reply: async () => ({}), download: undefined, args: [],
      dbSession: { phoneNumber: '2348000000001' },
    };
    const cache = require('../lib/mediaCache');
    const realGet = cache.getCachedMedia;
    cache.getCachedMedia = () => null;
    try { await vv.execute(ctx); } finally { cache.getCachedMedia = realGet; }

    t('a view-once that carries a wrapper is relayed, not re-uploaded', () => {
      const fwd = sent.find((c) => c && c.forward);
      if (!fwd) throw new Error('nothing was forwarded; payloads sent: ' + sent.length);
      if (fwd.viewOnce !== false) throw new Error('viewOnce:false missing — Baileys would re-wrap it');
      return true;
    });

    t('the relayed node no longer says viewOnce', () => {
      const fwd = sent.find((c) => c && c.forward);
      if (!fwd) throw new Error('nothing forwarded');
      const fresh = JSON.parse(JSON.stringify(fwd.forward.message));
      const node = fresh.viewOnceMessageV2?.message || fresh.imageMessage || fresh;
      if (node.imageMessage?.viewOnce || node.viewOnce) throw new Error('viewOnce survived — it would arrive as another view-once');
      return true;
    });

    t('it is delivered once, not twice', () => {
      const mediaish = sent.filter((c) => c && (c.image || c.video || c.audio || c.forward));
      if (mediaish.length > 1) throw new Error('posted ' + mediaish.length + ' copies');
      return true;
    });
  })();

  /* ── the dead route stays dead, and documented ────────────────────────── */
  t('the source records why requestPlaceholderResend was not used', () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../lib/commands/vv.js'), 'utf8');
    assert.ok(/requestPlaceholderResend/.test(src), 'the dead route is not documented');
    assert.ok(/view_once_unavailable_fanout/.test(src), 'the Baileys exclusion is not recorded');
    assert.ok(!/await sock\.requestPlaceholderResend\(/.test(src), 'a dead route is being called live');
  });

  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
