#!/usr/bin/env node
/**
 * logo-test.cjs — every textmaker command must return a REAL image.
 *
 * The failure this suite exists to prevent: the previous logo path pointed at
 * `api.flamingtext.com`, which now answers 429 to this host — and the old code
 * replied with `{ image: { url } }`, so Baileys handed WhatsApp an HTML error
 * page to display as a picture. HTTP 200 is not proof of an image, and neither
 * is "the command didn't throw".
 *
 * So every assertion here decodes the actual bytes with sharp.
 *
 * Run: node scripts/logo-test.cjs      (npm run test:logos)
 */
process.env.SILENT = '1';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const sharp = require('sharp');
const registry = require(path.join(ROOT, 'lib', 'registry.js'));
const LOGOS = require(path.join(ROOT, 'lib', 'logostyles.js'));

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fails.push(`${name} :: ${detail}`); console.log(`  \u2717 ${name}   ${detail}`); }
};

let sent = [];
const sock = { sendMessage: async (j, c) => { sent.push(c); return {}; } };

async function run(command, args) {
  sent = [];
  const owner = registry.get(command);
  if (!owner || !owner.execute) throw new Error(`"${command}" has no owner`);
  await owner.execute({
    command, args, from: '1203634@g.us', sender: '2348111000002@s.whatsapp.net',
    msg: { key: {}, message: {} }, prefix: '.', sock,
    reply: async (t) => { sent.push({ text: String(t) }); return {}; },
  });
  return sent[sent.length - 1] || {};
}

const isPng = (buf) => Buffer.isBuffer(buf) && buf.length > 8 &&
  buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';

(async () => {
  console.log('\n\u2550\u2550 Text logos — local render, real bytes \u2550\u2550\n');

  /* 1. the catalogue's textmaker names must all be claimed */
  const cat = registry.byCategory()['textmaker'] || [];
  const missing = cat.filter((o) => o.source === 'fallback').map((o) => o.name);
  ok(`all ${cat.length} textmaker names are implemented`, missing.length === 0, missing.join(' '));

  /* 2. every logo style renders a decodable PNG through the registry */
  console.log('');
  const styles = Object.keys(LOGOS.STYLES);
  let rendered = 0;
  for (const style of styles) {
    try {
      const payload = await run(style, ['ZYNEX']);
      const img = payload.image;
      if (!img) { ok(`.${style}`, false, `no image, got: ${JSON.stringify(String(payload.text || '').slice(0, 60))}`); continue; }
      if (img.url) { ok(`.${style}`, false, `sent a URL instead of bytes: ${img.url}`); continue; }
      if (!isPng(img)) { ok(`.${style}`, false, 'payload is not a PNG'); continue; }
      const meta = await sharp(img).metadata();
      const sane = meta.width >= 400 && meta.height >= 180;
      ok(`.${style}`, sane, `${meta.width}x${meta.height}`);
      if (sane) rendered++;
    } catch (e) {
      ok(`.${style}`, false, `threw: ${e.message}`);
    }
  }
  ok('every style produced a real PNG', rendered === styles.length, `${rendered}/${styles.length}`);

  /* 3. card styles take fields and label themselves honestly */
  console.log('');
  for (const cmd of ['bizcard', 'namecard', 'id_card', 'idcard', 'certificate', 'flyer', 'poster', 'banner', 'thumbnail']) {
    try {
      const payload = await run(cmd, ['Name=Ada Obi', 'Role=Developer', 'Phone=08030000000']);
      const img = payload.image;
      const good = isPng(img) && (await sharp(img).metadata()).width >= 600;
      ok(`.${cmd} renders a card`, good, isPng(img) ? 'too small' : 'not a PNG');
    } catch (e) {
      ok(`.${cmd} renders a card`, false, `threw: ${e.message}`);
    }
  }

  /* 4. a card with no fields must ask for them, not render an empty box */
  console.log('');
  for (const cmd of ['bizcard', 'idcard']) {
    const payload = await run(cmd, []);
    const askedForDetail = /needs details|❌/i.test(String(payload.text || ''));
    ok(`.${cmd} with no fields asks for them`, askedForDetail && !payload.image, JSON.stringify(String(payload.text || '').slice(0, 50)));
  }

  /* 5. no logo command may still reach for the dead remote service */
  console.log('');
  const deadUrl = styles.filter((s) => false); // placeholder kept for clarity
  let remoteHits = 0;
  for (const style of styles.slice(0, 8)) {
    const payload = await run(style, ['X']);
    if (payload.image && payload.image.url) remoteHits++;
    if (payload.image && Buffer.isBuffer(payload.image) === false) remoteHits++;
  }
  ok('no style sends a remote image URL', remoteHits === 0, `${remoteHits} remote payloads`);

  /* 6. trademark/franchise styles must say what they are */
  console.log('');
  for (const style of ['batman', 'naruto', 'youtubelogo', 'minecraft']) {
    const payload = await run(style, ['TEST']);
    const caption = String(payload.caption || '');
    ok(`.${style} caption discloses it is a custom nameplate`, /not the official|themed nameplate/i.test(caption), caption.slice(0, 70));
  }

  /* 7. long and awkward text must not blow the layout up */
  console.log('');
  const awkward = [
    ['short', 'A'],
    ['long', 'The Quick Brown Fox Jumps Over Lagos'],
    ['unicode', 'Chinedu ❤️ Ọ̀ṣun 🇳🇬'],
    ['symbols', 'ZYNEX-MD <>&"\''],
  ];
  for (const [label, text] of awkward) {
    try {
      const payload = await run('neon', [text]);
      const img = payload.image;
      const meta = isPng(img) ? await sharp(img).metadata() : null;
      const fits = meta && meta.width === 1000 && meta.height === 420;
      ok(`.neon handles ${label} text`, fits, meta ? `${meta.width}x${meta.height}` : 'no PNG');
    } catch (e) {
      ok(`.neon handles ${label} text`, false, `threw: ${e.message}`);
    }
  }

  /* 8. the plain text styles must still be plain text (user's rule) */
  console.log('');
  for (const cmd of ['bold', 'upside', 'smallcaps', 'clap']) {
    try {
      const payload = await run(cmd, ['hello']);
      ok(`.${cmd} replies in text, not an image`, !payload.image && Boolean(payload.text), JSON.stringify(String(payload.text || '').slice(0, 40)));
    } catch (e) {
      ok(`.${cmd} replies in text, not an image`, false, `threw: ${e.message}`);
    }
  }

  /* 9. the guard: no logo command may reference the dead render service */
  console.log('');
  const fs = require('fs');
  const textEngine = fs.readFileSync(path.join(ROOT, 'lib', 'engines', 'text.js'), 'utf8');
  ok('text engine no longer calls api.flamingtext.com', !/flamingtext\.com\/logo/.test(textEngine), 'dead service still referenced');

  const total = pass + fails.length;
  console.log(`\n${pass}/${total} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  \u2022 ' + f));
    process.exit(1);
  }
})();
