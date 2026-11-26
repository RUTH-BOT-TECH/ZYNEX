#!/usr/bin/env node
/**
 * audit-fixes-test.cjs — the "slightly stuff" found in the head-to-toe sweep.
 *
 * 1. `.hug` and friends now produce real @tags (see mentions-test.cjs).
 * 2. Hardcoded `.command` hints ignored a custom PREFIX.
 * 3. Direct text sends outside handler.reply() skipped linkPreview:false, so
 *    any URL-bearing text could still trigger the missing link-preview module.
 * 4. Group admin/warning lists printed @numbers with no mentions array.
 */
'use strict';
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const hints = require(path.join(ROOT, 'lib', 'commandHint'));
const group = require(path.join(ROOT, 'lib', 'engines', 'group'));
const { handleMessage } = require(path.join(ROOT, 'lib', 'handler'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

console.log('\n══ prefix-aware hints ══\n');

t('known command hints follow a custom prefix', () => {
  const s = 'Use *.menu* or `.play song` — then Try .resize 800';
  assert.strictEqual(
    hints.withPrefix(s, '!'),
    'Use *!menu* or `!play song` — then Try !resize 800',
  );
});

t('URLs, decimals and unknown dots are left alone', () => {
  const s = 'Docs: https://example.com/.env · 1.5 · .notacommand';
  assert.strictEqual(hints.withPrefix(s, '!'), s);
});

t('the default dot changes nothing', () => {
  const s = 'Use *.menu* or `.play`';
  assert.strictEqual(hints.withPrefix(s, '.'), s);
});

t('multi-character prefixes work too', () => {
  assert.strictEqual(hints.withPrefix('Type *.menu*', '>>'), 'Type *>>menu*');
});

t('engine-only subcommands are known, not mistaken for filenames', () => {
  for (const n of ['place', 'drop', 'hint', 'answer', 'board', 'resign', 'fill', 'uncover']) {
    assert.ok(hints.KNOWN.has(n), `${n} missing from the hint vocabulary`);
  }
});

console.log('\n══ the handler actually applies it ══\n');

t('reply(), captions and direct text sends use hint() + linkPreview:false', () => {
  const h = src('lib/handler.js');
  assert.match(h, /const hints = require\('\.\/commandHint'\)/);
  assert.match(h, /const hint = \(t\) => hints\.withPrefix\(t, prefix\)/);
  assert.match(h, /text: hint\(text\), linkPreview: false/);
  assert.match(h, /caption: hint\(caption\)/);
  assert.match(h, /text: hint\(result\.text\), linkPreview: false/);
  assert.match(h, /sock: commandSock/);
  assert.match(h, /new Proxy\(sock/);
  assert.ok(!/\{ text: result\.text \}/.test(h));
});

(async () => {
  await ta('a !place reply tells the user to type !tictactoe, not .tictactoe', async () => {
    const sent = [];
    const sock = {
      sendMessage: async (jid, payload) => { sent.push(payload); },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
    };
    const msg = {
      key: { remoteJid: '120363audit@g.us', participant: '2348111000001@s.whatsapp.net', fromMe: false, id: 'AUDIT1' },
      message: { conversation: '!place' },
      pushName: 'Tester',
    };
    await handleMessage(sock, msg, { mode: 'public', id: 'AUDIT', prefix: '!' });
    const text = sent.map((p) => p.text || '').join('\n');
    assert.match(text, /\*!tictactoe @friend\*/, text);
    assert.ok(!/\*\.tictactoe/.test(text), text);
    assert.ok(sent.every((p) => p.linkPreview === false), 'a direct text send skipped linkPreview:false');
  });

  await ta('direct sock.sendMessage captions also follow the custom prefix', async () => {
    const games = require(path.join(ROOT, 'lib', 'engines', 'games'));
    games._internals.reset();
    const P2 = '2348111000002@s.whatsapp.net';
    const sent = [];
    const sock = {
      sendMessage: async (jid, payload) => { sent.push(payload); },
      readMessages: async () => {},
      sendPresenceUpdate: async () => {},
    };
    const msg = {
      key: { remoteJid: '120363audit3@g.us', participant: '2348111000001@s.whatsapp.net', fromMe: false, id: 'AUDIT3' },
      message: {
        extendedTextMessage: {
          text: '!tictactoe @2348111000002',
          contextInfo: { mentionedJid: [P2] },
        },
      },
      pushName: 'Tester',
    };
    await handleMessage(sock, msg, { mode: 'public', id: 'AUDIT3', prefix: '!' });
    const caption = sent.map((p) => p.caption || '').join('\n');
    assert.match(caption, /\*!place 1\*/, caption);
    assert.ok(!/\*\.place/.test(caption), caption);
    assert.ok(sent.some((p) => (p.mentions || []).includes(P2)), 'opponent was not mentioned');
  });

  t('anti-call and welcome hints use the configured prefix too', () => {
    assert.match(src('lib/anti/antiCall.js'), /dbSession\?\.prefix \|\| process\.env\.PREFIX/);
    assert.match(src('lib/anti/welcome.js'), /process\.env\.PREFIX \|\| '\.'/);
  });

  console.log('\n══ group @numbers are real mentions ══\n');

  await ta('.admins tags admins through reply(), not just as decoration', async () => {
    const P1 = '2348111000001@s.whatsapp.net';
    const P2 = '2348111000002@s.whatsapp.net';
    const replies = [];
    await group.execute({
      command: 'admins', args: [], argString: '', from: '120363audit2@g.us',
      sender: P1, msg: { key: {}, message: {} }, mentionedJid: [],
      sock: {
        user: { id: P1 },
        groupMetadata: async () => ({
          subject: 'Audit group',
          participants: [{ id: P1 }, { id: P2, admin: 'admin' }],
        }),
      },
      reply: async (text, options) => { replies.push({ text, options }); },
    });
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].text, /@2348111000002/);
    assert.deepStrictEqual(replies[0].options.mentions, [P2]);
  });

  t('group target resolution uses the shared caption-aware helper', () => {
    const g = src('lib/engines/group.js');
    assert.match(g, /mention\.pickTarget\(\{ mentionedJid, m, args \}\)/);
    assert.ok(!/extendedTextMessage\?\.contextInfo\s*$/m.test(g));
  });

  t('group and anti text payloads opt out of link previews', () => {
    for (const f of [
      'lib/engines/group.js', 'lib/anti/welcome.js', 'lib/anti/antiLink.js',
      'lib/anti/antiBadword.js', 'lib/anti/antiBot.js', 'lib/anti/antiDelete.js',
      'lib/commands/tagall.js', 'lib/commands/groupst.js', 'lib/sessionManager.js', 'lib/panelBot.js',
    ]) {
      assert.match(src(f), /linkPreview: false/, `${f} is missing linkPreview:false`);
    }
  });

  console.log('\n══ truthful metadata ══\n');

  t('package.json and README agree on the suite count', () => {
    const pkg = JSON.parse(src('package.json'));
    const count = Object.keys(pkg.scripts).filter((k) => k.startsWith('test:')).length;
    const chain = pkg.scripts['test:all'].split('&&').length;
    assert.strictEqual(count, 56);
    assert.strictEqual(chain, 56);
    assert.match(src('README.md'), new RegExp(`→ ${count} suites, exit 0`));
    assert.match(src('public/assets/readme/meta-tests.svg'), new RegExp(`>${count} SUITES<`));
    assert.match(src('public/assets/readme/stat-tests.svg'), new RegExp(`>${count}<`));
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
