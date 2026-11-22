const c = require('../lib/engines/converter');
const sharp = require('sharp');
const fs = require('fs');
const T = c._test;
let pass = 0, fail = [];
const ok = (n, cond, d='') => { if (cond) { pass++; console.log('  ✓ '+n); } else { fail.push(n+' :: '+d); console.log('  ✗ '+n+'  '+d); } };
const isPng = b => b && b.slice(0,4).toString('hex') === '89504e47';
const isWebp = b => b && b.slice(8,12).toString('ascii') === 'WEBP';

(async () => {
  console.log('── quote card ──');
  const qc = await T.quoteCard('The best way to predict the future is to create it yourself.', 'Abraham Lincoln');
  ok('renders a PNG', isPng(qc), qc && qc.length);
  fs.writeFileSync('/tmp/zynex-conv-c-quote.png', qc);
  const qc2 = await T.quoteCard('Short one');
  ok('works with no author', isPng(qc2));

  console.log('\n── chat bubble ──');
  const cb = await T.chatBubble({ name: 'ZYNEX', text: 'Hello from the bot! This is a rendered bubble.' });
  ok('renders a PNG', isPng(cb));
  fs.writeFileSync('/tmp/zynex-conv-c-bubble.png', cb);

  console.log('\n── text sticker ──');
  const st = await T.textSticker('ZYNEX MD');
  ok('renders webp sticker', isWebp(st), st && st.length);
  fs.writeFileSync('/tmp/zynex-conv-c-sticker.webp', st);
  const st2 = await T.textSticker('a much longer piece of sticker text here');
  ok('wraps long text', isWebp(st2));
  fs.writeFileSync('/tmp/zynex-conv-c-sticker-long.webp', st2);

  console.log('\n── emoji -> png ──');
  const e2p = await T.textToPng('😂');
  ok('renders webp', isWebp(e2p));

  console.log('\n── emoji kitchen (real Google API) ──');
  const mix = await T.emojiKitchen('😂', '🔥');
  ok('😂+🔥 returns an image', isWebp(mix), mix ? mix.length : 'null');
  if (mix) fs.writeFileSync('/tmp/zynex-conv-c-emojimix.webp', mix);
  const mix2 = await T.emojiKitchen('😀', '😍');
  ok('😀+😍 returns an image', isWebp(mix2), mix2 ? mix2.length : 'null');
  const bad = await T.emojiKitchen('🫠', '🪿');
  ok('unknown combo returns null (not a crash)', bad === null);

  console.log('\n── upload (real network) ──');
  const up = await T.uploadBuffer(fs.readFileSync('/tmp/zynex-conv-c-quote.png'), 'zynex.png');
  ok('upload returns a url', Boolean(up && up.url), JSON.stringify(up));
  if (up) {
    console.log('    ->', up.url, `(${up.host})`);
    const r = await fetch(up.url, { signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type') || '';
    ok('uploaded url serves an image', r.ok && /image/.test(ct), `status ${r.status} type ${ct}`);
  }

  console.log('\n── pdf ──');
  const pdf = await T.textToPdf('Hello from ZYNEX-MD.\nThis is a real PDF built locally.');
  ok('text -> pdf', pdf.ok && pdf.buffer.slice(0,4).toString() === '%PDF', pdf.ok ? pdf.buffer.length+'b' : pdf.stderr.slice(0,60));
  if (pdf.ok) fs.writeFileSync('/tmp/zynex-conv-c-test.pdf', pdf.buffer);
  const png = await sharp({create:{width:300,height:200,channels:3,background:'#2b7a4b'}}).png().toBuffer();
  const pdf2 = await T.imageToPdf(png);
  ok('image -> pdf', pdf2.ok && pdf2.buffer.slice(0,4).toString() === '%PDF');

  console.log('\n── screenshot (real network) ──');
  const ss = await T.screenshot('example.com');
  ok('screenshot returns an image', ss && isPng(ss.buf), ss ? ss.engine+' '+ss.buf.length : 'null');
  if (ss) fs.writeFileSync('/tmp/zynex-conv-c-screenshot.png', ss.buf);

  console.log(`\n${pass}/${pass+fail.length} passed`);
  if (fail.length) { console.log('\nFAILS:'); fail.forEach(f=>console.log('  •',f)); process.exit(1); }
})();
