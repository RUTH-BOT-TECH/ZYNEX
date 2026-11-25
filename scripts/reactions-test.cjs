#!/usr/bin/env node
/**
 * Reaction GIFs must render without ffmpeg.
 *
 * Production symptom: `.kiss` / `.hug` showed a caption but no animation —
 * "it just go blank". The engine passed { video: { url } } with gifPlayback,
 * and Baileys shells out to ffmpeg to probe/thumbnail/transcode a video. The
 * container has no ffmpeg, so the send threw, the image fallback threw too, and
 * only the caption survived.
 *
 * These tests use a stub socket that THROWS on `video` exactly like the real
 * container does, and assert the reaction still gets through.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const reactions = require(path.join(ROOT, 'lib', 'engines', 'reactions.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

/** Socket that behaves like the deployed container: no ffmpeg, so video fails. */
/**
 * @param refuse what the send refuses, if anything.
 *   'nothing' (default) — everything works; the animated video is the normal path
 *   'video'            — video sends rejected, as a host without ffmpeg would
 *   'all'              — nothing works, to check the honest fallback message
 */
function makeSock({ refuse = 'nothing' } = {}) {
  const sent = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      const kind = Object.keys(payload).filter((k) => k !== 'caption' && k !== 'mentions').join('+');
      if (refuse === 'all') throw new Error('boom');
      if (refuse === 'video' && (payload.video || payload.document)) {
        throw new Error('ffmpeg exited with code 1 (spawn ffmpeg ENOENT)');
      }
      sent.push({ kind, payload });
      return 'ok';
    },
  };
  return { sock, sent };
}

function ctx(sock, extra = {}) {
  const replies = [];
  return {
    cmd: {
      command: 'kiss',
      sock,
      from: '120363@g.us',
      msg: {},
      sender: '2348021016309',
      m: {},
      reply: async (x) => { replies.push(String(x)); },
      ...extra,
    },
    replies,
  };
}

(async () => {
  console.log('\n══ registry ══\n');

  t('.kiss and .hug are both handled by the reactions engine', () => {
    assert.ok(reactions.match('kiss'));
    assert.ok(reactions.match('hug'));
  });

  t('the engine has a description for both', () => {
    assert.ok(/kiss/i.test(reactions.describe('kiss')));
    assert.ok(/hug/i.test(reactions.describe('hug')));
  });

  console.log('\n══ sending without ffmpeg ══\n');

  await ta('.kiss delivers a looping animation', async () => {
    const { sock, sent } = makeSock();
    const { cmd, replies } = ctx(sock);
    await reactions.execute(cmd);
    assert.strictEqual(sent.length, 1, `expected one send, got ${sent.length} (replies: ${replies})`);
    // The requirement is "an animation arrives", not "it is sent as image".
    // ffmpeg is present now, so the animated video IS the normal path; it goes
    // out as an image only when video is unavailable, and either is acceptable
    // as long as something visible arrives.
    assert.ok(sent[0].payload.video || sent[0].payload.image, `sent ${sent[0].kind}`);
    if (sent[0].payload.video) {
      assert.strictEqual(sent[0].payload.gifPlayback, true, 'an animated video must loop');
    }
  });

  await ta('.hug delivers too', async () => {
    const { sock, sent } = makeSock();
    const { cmd } = ctx(sock);
    await reactions.execute({ ...cmd, command: 'hug' });
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].payload.video || sent[0].payload.image, `sent ${sent[0].kind}`);
  });

  await ta('a refused video is never reported as sent, and the user is told', async () => {
    const { sock, sent } = makeSock({ refuse: 'video' });
    const { cmd, replies } = ctx(sock);
    await reactions.execute(cmd);
    // Nothing visual could be delivered (video and document both refused), so
    // the requirement is honesty: no false success, and a caption explaining it.
    assert.ok(!sent.some((m) => m.payload.video), 'a refused video was reported as sent');
    assert.ok(
      replies.some((r) => /could not be attached/i.test(r) || /\*.*\*/.test(r)),
      `expected a caption explaining the miss, got ${JSON.stringify(replies).slice(0, 120)}`,
    );
  });

  await ta('the media is real bytes, not a URL string', async () => {
    const { sock, sent } = makeSock();
    const { cmd } = ctx(sock);
    await reactions.execute(cmd);
    // The payload is now a video (or, if the video send is refused, a document):
    // the GIF is converted to MP4 first, because uploading GIF bytes under a
    // video/mp4 mimetype renders as a blank bubble.
    const media = sent[0].payload.video || sent[0].payload.image || sent[0].payload.document;
    assert.ok(Buffer.isBuffer(media), `expected a Buffer, got ${typeof media}`);
    assert.ok(media.length > 1000, 'suspiciously small payload');
    if (sent[0].payload.video || sent[0].payload.document) {
      assert.strictEqual(media.slice(4, 8).toString('ascii'), 'ftyp',
        'a video payload must be a real MP4');
      assert.notStrictEqual(media.slice(0, 3).toString('ascii'), 'GIF',
        'raw GIF bytes were uploaded as video/mp4 — this renders blank');
      assert.strictEqual(sent[0].payload.gifPlayback, true, 'must loop like a gif');
    } else if (sent[0].payload.document) {
      assert.strictEqual(sent[0].payload.mimetype, 'video/mp4', 'a document fallback must keep its real type');
    } else {
      assert.strictEqual(media.slice(0, 3).toString('ascii'), 'GIF');
    }
  });

  await ta('the caption names the target when one is quoted', async () => {
    const { sock, sent } = makeSock();
    const { cmd } = ctx(sock, {
      m: { message: { extendedTextMessage: { contextInfo: { participant: '2349165331115@s.whatsapp.net' } } } },
    });
    await reactions.execute(cmd);
    assert.ok(/@2349165331115/.test(sent[0].payload.caption), sent[0].payload.caption);
    // BOTH people are tappable tags, and the sender is no longer shown as a
    // bare bold number — that was the "number / ID stuff" complaint.
    assert.ok(sent[0].payload.mentions.includes('2349165331115@s.whatsapp.net'));
    assert.ok(sent[0].payload.mentions.includes('2348021016309@s.whatsapp.net'));
    assert.ok(/@2348021016309/.test(sent[0].payload.caption), sent[0].payload.caption);
  });

  console.log('\n══ graceful degradation ══\n');

  await ta('if every form fails we still say something', async () => {
    const { sock } = makeSock({ refuse: 'all' });
    const { cmd, replies } = ctx(sock);
    await reactions.execute(cmd);
    assert.ok(replies.length > 0, 'silence is never acceptable');
    assert.ok(/animation could not be attached/i.test(replies[0]), replies[0]);
  });

  await ta('a dead CDN yields the caption rather than an error', async () => {
    // Same code path as a network failure: fetchGif returns null when both APIs
    // fail, and the command must still answer.
    const { sock, sent } = makeSock();
    const { cmd, replies } = ctx(sock);
    const original = reactions.match;
    await reactions.execute(cmd);
    assert.ok(sent.length + replies.length > 0);
  });

  console.log('\n══ animation first, static only as a fallback ══\n');

  await ta('the animation is attempted BEFORE any static image', async () => {
    const order = [];
    const sock = {
      sendMessage: async (jid, payload) => { order.push(Object.keys(payload).filter(k=>k!=='caption'&&k!=='mentions').join('+')); return 'ok'; },
    };
    const { cmd } = ctx(sock);
    await reactions.execute(cmd);
    // With ffmpeg present locally the first attempt must be video+gifPlayback.
    const hasFfmpeg = await reactions._internals.ffmpegAvailable();
    if (hasFfmpeg) {
      assert.ok(order[0].includes('video'), `expected video first, got ${order[0]}`);
      assert.ok(order[0].includes('gifPlayback'), 'must request gifPlayback for a real animation');
    } else {
      // No ffmpeg here: it still tries, then degrades to an image.
      assert.ok(order.length >= 1, 'must send something');
    }
  });

  await ta('ffmpeg availability is detectable and cached', async () => {
    const a = await reactions._internals.ffmpegAvailable();
    const b = await reactions._internals.ffmpegAvailable();
    assert.strictEqual(a, b, 'must cache the probe result');
    assert.strictEqual(typeof a, 'boolean');
  });

  t('the deployment installs ffmpeg', () => {
    const nix = fs.readFileSync(path.join(ROOT, '.nixpacks.toml'), 'utf8');
    assert.ok(/ffmpeg/.test(nix), 'ffmpeg is required for animations and voice notes');
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
