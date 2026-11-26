#!/usr/bin/env node
/**
 * command-truth-test.cjs — commands must do what their names advertise.
 *
 * Researched against comparable WhatsApp bots (see COMMAND-TRUTH.md):
 *   .rate <thing>  → rate THAT THING out of 10
 *   .hidetag       → silently tag everyone (no visible @numbers)
 *   .tagall        → visible tag list
 *
 * This suite pins the researched command meanings. The first pass fixed .rate
 * and .hidetag; the second pass resolved the sticker abbreviations by separating
 * competing conventions instead of guessing, and kept .who/.alwaysonline intact.
 */
'use strict';
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const registry = require(path.join(ROOT, 'lib', 'registry'));
const fun = require(path.join(ROOT, 'lib', 'engines', 'fun'));
const group = require(path.join(ROOT, 'lib', 'engines', 'group'));
const sharp = require('sharp');
const stickerMeta = require(path.join(ROOT, 'lib', 'stickerMetadata'));
const take = require(path.join(ROOT, 'lib', 'commands', 'take'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const SENDER = '2348111000001@s.whatsapp.net';
const TARGET = '2348111000002@s.whatsapp.net';

function rateRun(command, args = [], extra = {}) {
  const replies = [];
  const ctx = {
    command, args, from: '120363truth@g.us', sender: SENDER,
    m: { key: {}, message: {} }, msg: { key: {}, message: {} },
    mentionedJid: [], sock: { sendMessage: async () => ({}) },
    reply: async (text, options) => { replies.push({ text, options }); },
    ...extra,
  };
  return { ctx, replies };
}

console.log('\n══ .rate means "rate anything out of 10" ══\n');

t('registry no longer describes .rate as "Rate someone"', () => {
  assert.match(registry.get('rate').desc, /Rate anything out of 10/);
  assert.ok(!src('lib/engines/fun.js').includes('*${score}/100*'), 'the old /100 output is still live');
});

(async () => {
  await ta('.rate my car rates the typed thing, not the sender', async () => {
    const { ctx, replies } = rateRun('rate', ['my', 'car']);
    await fun.execute(ctx);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].text, /my car/, replies[0].text);
    assert.match(replies[0].text, /\*\d+\/10\*/, replies[0].text);
    assert.ok(!/you: \*\d+\/10\*/.test(replies[0].text), replies[0].text);
    const bar = replies[0].text.split('\n').pop();
    assert.strictEqual(bar.length, 10, `bar should be 10 cells, got ${bar.length}`);
  });

  await ta('.rate is deterministic for the same subject', async () => {
    const a = rateRun('rate', ['my', 'car']);
    const b = rateRun('rate', ['my', 'car']);
    await fun.execute(a.ctx);
    await fun.execute(b.ctx);
    assert.strictEqual(a.replies[0].text, b.replies[0].text);
  });

  await ta('different subjects can score differently', async () => {
    const a = rateRun('rate', ['my', 'car']);
    const b = rateRun('rate', ['the', 'moon']);
    await fun.execute(a.ctx);
    await fun.execute(b.ctx);
    assert.notStrictEqual(a.replies[0].text, b.replies[0].text);
  });

  await ta('.rate @user shows and tags the phone number', async () => {
    const { ctx, replies } = rateRun('rate', ['@2348111000002'], {
      mentionedJid: [TARGET],
      m: { message: { extendedTextMessage: { contextInfo: { mentionedJid: [TARGET] } } } },
    });
    await fun.execute(ctx);
    assert.match(replies[0].text, /@2348111000002/);
    assert.deepStrictEqual(replies[0].options.mentions, [TARGET]);
  });

  console.log('\n══ .hidetag means silent tag, .tagall means visible tag ══\n');

  t('.hidetag is owned by the silent group engine, not tagall.js', () => {
    const r = registry.get('hidetag');
    assert.strictEqual(r.source, 'engine', JSON.stringify(r));
    assert.strictEqual(r.engine, 'group');
    assert.match(r.desc, /silently/i);
    assert.ok(!/aliases:\s*\[[^\]]*'hidetag'/.test(src('lib/commands/tagall.js')));
    assert.match(src('lib/engines/group.js'), /new Set\(\['hidetag', 'hidetagall', 'silenttag'\]\)/);
    assert.strictEqual(registry.get('tagall').source, 'file');
  });

  await ta('.hidetag sends no visible @numbers but mentions everyone', async () => {
    const P1 = SENDER, P2 = TARGET, P3 = '2348111000003@s.whatsapp.net';
    const sent = [];
    const sock = {
      user: { id: P1 },
      groupMetadata: async () => ({
        subject: 'Truth group',
        participants: [{ id: P1 }, { id: P2 }, { id: P3 }],
      }),
      sendMessage: async (jid, payload) => { sent.push({ jid, payload }); },
    };
    await group.execute({
      command: 'hidetag', args: ['quiet'], argString: 'quiet',
      from: '120363truth2@g.us', sender: P1, isOwner: true,
      msg: { key: {}, message: {} }, mentionedJid: [], sock,
      reply: async (text, options) => { sent.push({ reply: true, text, options }); },
    });
    assert.strictEqual(sent.length, 1, JSON.stringify(sent));
    assert.strictEqual(sent[0].payload.text, 'quiet');
    assert.ok(!sent[0].payload.text.includes('@'), 'visible @number leaked into hidden tag');
    assert.deepStrictEqual(sent[0].payload.mentions, [P1, P2, P3]);
    assert.strictEqual(sent[0].payload.linkPreview, false);
  });

  console.log('\n══ remaining command-truth fixes ══\n');

  t('researched sticker names now have truthful descriptions', () => {
    assert.match(registry.get('qc').desc, /Quote card/);
    assert.match(registry.get('quotely').desc, /Quote sticker/);
    assert.match(registry.get('ttp').desc, /Plain static text sticker/);
    assert.match(registry.get('attp').desc, /Animated rainbow/);
    assert.match(registry.get('swm').desc, /pack\|author EXIF/);
    assert.match(registry.get('wm').desc, /visible watermark/);
    assert.match(registry.get('take').desc, /Repack a replied sticker/);
    assert.match(registry.get('steal').desc, /Repack a replied sticker/);
  });

  t('competing sticker conventions are separated in code', () => {
    const c = src('lib/engines/converter.js');
    assert.match(c, /if \(command === 'qc' \|\| command === 'quotely'\)/);
    assert.match(c, /if \(command === 'ttp'\)/);
    assert.match(c, /if \(command === 'attp'\)/);
    assert.match(c, /if \(command === 'swm'\)/);
    assert.match(c, /if \(command === 'wm'\)/);
    assert.match(c, /rainbowTextSticker/);
    assert.match(c, /repackSticker/);
    assert.ok(!c.includes('quotely: {'), '.quotely is still a refusal');
  });

  t('.take / .steal have one clear owner and preserve economy .steal', () => {
    assert.strictEqual(registry.get('take').source, 'file');
    assert.strictEqual(registry.get('steal').source, 'file');
    assert.ok(!/aliases:\s*\[[^\]]*'take'/.test(src('lib/commands/sticker.js')));
    assert.match(src('lib/commands/take.js'), /command: 'steal'/);
    assert.match(src('lib/engines/economy.js'), /steal:\s*\{/);
    assert.match(src('lib/commands/sticker.js'), /repackSticker/);
  });

  t('handler passes the invoked command name to file commands', () => {
    assert.match(src('lib/handler.js'), /command: cmdName/);
  });

  t('real WebP EXIF metadata dependency is declared', () => {
    const pkg = JSON.parse(src('package.json'));
    assert.ok(pkg.dependencies['node-webpmux'], 'node-webpmux is missing');
  });

  t('.who and .alwaysonline remain wired to their verified behaviour', () => {
    assert.match(src('lib/engines/games.js'), /if \(command === 'who'\)/);
    assert.match(src('lib/commands/alwaysonline.js'), /alwaysOnline/);
    assert.match(src('lib/sessionManager.js'), /alwaysOnline/);
  });

  await ta('.take repacks a replied sticker with real EXIF', async () => {
    const STICKER = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 20, g: 120, b: 240, alpha: 1 } },
    }).webp({ quality: 80 }).toBuffer();
    const sent = [];
    const ctx = {
      command: 'take',
      args: ['MyPack', '|', 'Me'],
      from: '120363take@g.us',
      sender: SENDER,
      pushName: 'Tester',
      prefix: '.',
      msg: {
        key: { remoteJid: '120363take@g.us', id: 'TAKE1' },
        message: { extendedTextMessage: { contextInfo: { quotedMessage: { stickerMessage: {} }, participant: TARGET } } },
      },
      m: { key: {}, message: {} },
      sock: { sendMessage: async (jid, payload) => { sent.push(payload); return {}; } },
      reply: async (text) => { sent.push({ text: String(text) }); return {}; },
      download: async () => STICKER,
    };
    await take.execute(ctx);
    const sticker = (sent.find((x) => x.sticker) || {}).sticker;
    const meta = await stickerMeta.readStickerMetadata(sticker);
    assert.ok(stickerMeta.isWebp(sticker), 'no WebP sticker sent');
    assert.strictEqual(meta && meta['sticker-pack-name'], 'MyPack');
    assert.strictEqual(meta && meta['sticker-pack-publisher'], 'Me');
  });

  t('the suite count in package.json / README is truthful', () => {
    const pkg = JSON.parse(src('package.json'));
    const count = Object.keys(pkg.scripts).filter((k) => k.startsWith('test:')).length;
    assert.strictEqual(count, 56);
    assert.strictEqual(pkg.scripts['test:all'].split('&&').length, 56);
    assert.match(src('README.md'), new RegExp(`→ ${count} suites, exit 0`));
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
