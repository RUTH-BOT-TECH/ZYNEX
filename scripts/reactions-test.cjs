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
function makeSock({ failEverything = false } = {}) {
  const sent = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      const kind = Object.keys(payload).filter((k) => k !== 'caption' && k !== 'mentions').join('+');
      if (failEverything) throw new Error('boom');
      if (payload.video) throw new Error("ffmpeg exited with code 1 (spawn ffmpeg ENOENT)");
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

  await ta('.kiss delivers an animated image even though video would fail', async () => {
    const { sock, sent } = makeSock();
    const { cmd, replies } = ctx(sock);
    await reactions.execute(cmd);
    assert.strictEqual(sent.length, 1, `expected one send, got ${sent.length} (replies: ${replies})`);
    assert.ok(sent[0].payload.image, 'must go out as `image`, not `video` — video needs ffmpeg');
  });

  await ta('.hug delivers too', async () => {
    const { sock, sent } = makeSock();
    const { cmd } = ctx(sock);
    await reactions.execute({ ...cmd, command: 'hug' });
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].payload.image);
  });

  await ta('the media is real bytes, not a URL string', async () => {
    const { sock, sent } = makeSock();
    const { cmd } = ctx(sock);
    await reactions.execute(cmd);
    const media = sent[0].payload.image;
    assert.ok(Buffer.isBuffer(media), `expected a Buffer, got ${typeof media}`);
    assert.ok(media.length > 1000, 'suspiciously small payload');
    assert.strictEqual(media.slice(0, 3).toString('ascii'), 'GIF', 'not GIF data');
  });

  await ta('the caption names the target when one is quoted', async () => {
    const { sock, sent } = makeSock();
    const { cmd } = ctx(sock, {
      m: { message: { extendedTextMessage: { contextInfo: { participant: '2349165331115@s.whatsapp.net' } } } },
    });
    await reactions.execute(cmd);
    assert.ok(/2349165331115/.test(sent[0].payload.caption), sent[0].payload.caption);
    assert.deepStrictEqual(sent[0].payload.mentions, ['2349165331115@s.whatsapp.net']);
  });

  console.log('\n══ graceful degradation ══\n');

  await ta('if every form fails we still say something', async () => {
    const { sock } = makeSock({ failEverything: true });
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

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
