#!/usr/bin/env node
/**
 * mentions-test.cjs — `@number` must be a REAL tag, not decoration.
 *
 * Reported: ".hug is supposed to have their number / ID stuff". It printed
 * `*2348021016309* hugs *2348134112474*` — bold digits, no `@`, and only the
 * target JID in `mentions`, so nobody was tappable and the sender was never
 * tagged. The same defect was in roast/compliment/rate/love, `.who`, game turn
 * notices and economy transfers.
 *
 * WhatsApp renders a mention only when the caption contains `@<digits>` AND
 * the matching full JID is in `mentions`. This suite pins both halves.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const m = require(path.join(ROOT, 'lib', 'mention.js'));
const jid = require(path.join(ROOT, 'lib', 'jid.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

console.log('\n══ identity normalisation ══\n');

t('digits() strips @, domain and device suffix', () => {
  assert.strictEqual(m.digits('2348021016309@s.whatsapp.net'), '2348021016309');
  assert.strictEqual(m.digits('2348021016309:11@s.whatsapp.net'), '2348021016309');
  assert.strictEqual(m.digits('@209758283931714:14@lid'), '209758283931714');
  assert.strictEqual(m.digits('2348021016309'), '2348021016309');
});

t('toJid() turns a bare number into a mentionable PN JID', () => {
  assert.strictEqual(m.toJid('2348021016309'), '2348021016309@s.whatsapp.net');
  assert.strictEqual(m.toJid('@2348021016309'), '2348021016309@s.whatsapp.net');
  assert.strictEqual(m.toJid('2348021016309:12@s.whatsapp.net'), '2348021016309@s.whatsapp.net');
  assert.strictEqual(m.toJid('not-a-person'), null);
});

t('a learned LID is displayed as the real phone number', () => {
  jid.lidToPn.set('209758283931714', '2348134112474@s.whatsapp.net');
  assert.strictEqual(m.toJid('209758283931714:14@lid'), '2348134112474@s.whatsapp.net');
  assert.strictEqual(m.tag('209758283931714:14@lid'), '@2348134112474');
});

t('tag() and mentions() produce the two halves of a real tag', () => {
  assert.strictEqual(m.tag('2348021016309@s.whatsapp.net'), '@2348021016309');
  assert.deepStrictEqual(
    m.mentions('2348021016309', '2348134112474@s.whatsapp.net', '2348021016309'),
    ['2348021016309@s.whatsapp.net', '2348134112474@s.whatsapp.net'],
  );
});

console.log('\n══ target resolution (all message types) ══\n');

t('the handler-provided mentionedJid wins, even on an image caption', () => {
  const ctx = {
    mentionedJid: ['2348134112474@s.whatsapp.net'],
    m: { message: { imageMessage: { contextInfo: { participant: '999999999@s.whatsapp.net' } } } },
    args: [],
  };
  assert.strictEqual(m.pickTarget(ctx), '2348134112474@s.whatsapp.net');
});

t('a quoted author is the target when nobody is mentioned', () => {
  assert.strictEqual(
    m.pickTarget({ m: { message: { extendedTextMessage: { contextInfo: { participant: '2349165331115@s.whatsapp.net' } } } } }),
    '2349165331115@s.whatsapp.net',
  );
});

t('a bare number typed after the command works too', () => {
  assert.strictEqual(
    m.pickTarget({ m: {}, args: ['hug', '2348012345678'] }),
    '2348012345678@s.whatsapp.net',
  );
  assert.strictEqual(m.pickTarget({ m: {}, args: [] }), null);
});

console.log('\n══ .hug actually tags people ══\n');

// Make every CDN fail so we exercise the caption-only path deterministically.
const axios = require('axios');
axios.get = async () => { throw new Error('offline for the test'); };
const reactions = require(path.join(ROOT, 'lib', 'engines', 'reactions.js'));

function run(extra = {}) {
  const replies = [];
  const ctx = {
    command: 'hug',
    sock: { sendMessage: async () => 'ok' },
    from: '120363@g.us',
    msg: {},
    m: {},
    sender: '2348021016309@s.whatsapp.net',
    mentionedJid: [],
    args: [],
    reply: async (text, options) => { replies.push({ text, options }); return 'ok'; },
    ...extra,
  };
  return { ctx, replies };
}

(async () => {
  await ta('with a mention, BOTH people are @tagged and mentioned', async () => {
    const { ctx, replies } = run({ mentionedJid: ['2348134112474@s.whatsapp.net'] });
    await reactions.execute(ctx);
    assert.strictEqual(replies.length, 1, 'expected the caption fallback');
    assert.match(replies[0].text, /@2348021016309/);
    assert.match(replies[0].text, /@2348134112474/);
    assert.match(replies[0].text, /hugs/);
    assert.ok(!/\*2348021016309\*/.test(replies[0].text), 'still a bare bold number');
    assert.deepStrictEqual(replies[0].options.mentions, [
      '2348021016309@s.whatsapp.net', '2348134112474@s.whatsapp.net',
    ]);
  });

  await ta('with no target, the sender is still tagged', async () => {
    const { ctx, replies } = run();
    await reactions.execute(ctx);
    assert.match(replies[0].text, /@2348021016309/);
    assert.match(replies[0].text, /everyone!/);
    assert.deepStrictEqual(replies[0].options.mentions, ['2348021016309@s.whatsapp.net']);
  });

  await ta('a bare number argument becomes a real tag', async () => {
    const { ctx, replies } = run({ args: ['2348012345678'] });
    await reactions.execute(ctx);
    assert.match(replies[0].text, /@2348012345678/);
    assert.ok(replies[0].options.mentions.includes('2348012345678@s.whatsapp.net'));
  });

  await ta('a LID target is shown as its known phone number', async () => {
    const { ctx, replies } = run({ mentionedJid: ['209758283931714:14@lid'] });
    await reactions.execute(ctx);
    assert.match(replies[0].text, /@2348134112474/);
    assert.ok(!/209758283931714/.test(replies[0].text), 'a raw LID leaked into the caption');
  });

  console.log('\n══ the same fix reached the other engines ══\n');

  for (const f of ['lib/engines/reactions.js', 'lib/engines/fun.js', 'lib/engines/games.js', 'lib/engines/economy.js']) {
    t(`${f} uses the shared mention helper`, () => {
      assert.match(src(f), /require\('\.\.\/mention'\)/);
      assert.match(src(f), /mentions/);
    });
  }

  t('.who passes the picked participant as a mention', () => {
    assert.match(src('lib/engines/games.js'), /mentions: mention\.mentions\(p\.id\)/);
  });

  t('.ship name1 name2 is implemented, not just advertised', () => {
    const f = src('lib/engines/fun.js');
    assert.match(f, /args\.length >= 2 \? args\.slice\(0, 2\)/);
    assert.ok(/\.ship name1 name2/.test(f));
  });

  t('stale metadata is gone', () => {
    assert.ok(!/57\+ commands/.test(src('package.json')));
    assert.match(src('package.json'), /2,209 command names/);
    assert.ok(!/No push was made/.test(src('REPAIR.md')));
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
