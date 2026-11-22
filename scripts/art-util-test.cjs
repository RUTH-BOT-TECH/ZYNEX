#!/usr/bin/env node
/**
 * art-util-test.cjs — ASCII art, figlet banners, WHOIS/DNS/HTTP, zip, PDF.
 *
 * Three things this suite refuses to accept:
 *   1. **A banner that isn't monospace-fenced.** WhatsApp renders in a
 *      proportional font; an unfenced figlet banner is unreadable. Every ASCII
 *      output must be wrapped in ``` fences.
 *   2. **A DNS/WHOIS answer that didn't come from the network.** These are live
 *      lookups against real hosts, so the assertions check for facts that can
 *      only come from the wire (registrar name, actual A record), not just
 *      "some text came back".
 *   3. **A `text2pdf` that draws glyphs instead of embedding text.** Verified by
 *      round-tripping our own PDF back through pdf-parse and matching a phrase
 *      inside it. ImageMagick-produced PDFs fail exactly this test.
 *
 * Run: node scripts/art-util-test.cjs      (npm run test:art)
 */
process.env.SILENT = '1';

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const art = require(path.join(ROOT, 'lib', 'engines', 'art.js'));
const util = require(path.join(ROOT, 'lib', 'engines', 'util.js'));
const registry = require(path.join(ROOT, 'lib', 'registry.js'));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \u2713 ${n}`); }
  else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); }
};

let sent = [];
function ctxFor(command, args, { media = null } = {}) {
  sent = [];
  return {
    command, args,
    from: '120363400000000004@g.us',
    sender: '2348111000007@s.whatsapp.net',
    msg: { key: {}, message: {} },
    prefix: '.',
    sock: { sendMessage: async (j, c) => { sent.push(c); return {}; } },
    reply: async (t) => { sent.push({ text: String(t) }); return {}; },
    download: media ? async () => media : undefined,
  };
}
const last = () => sent[sent.length - 1] || {};
const lastText = () => String(last().text || '');

(async () => {
  /* ══════════════════ routing ══════════════════ */
  console.log('\n\u2550\u2550 Routing \u2550\u2550\n');
  const badRoute = [];
  for (const n of [...registry.ALL_NAMES]) {
    const g = registry.get(n);
    if (!g) continue;
    const owner = g.engine || g.source;
    if (art.match(n) && owner !== 'art') badRoute.push(`${n}->${owner}`);
  }
  ok('no figlet/art name routes to a different engine', badRoute.length === 0, badRoute.slice(0, 6).join(','));

  const utilNames = ['whois', 'whois2', 'dns', 'dnslookup', 'portscan', 'checkport', 'openport', 'curl', 'fetch', 'webget', 'httpget', 'ping2', 'ping3', 'zip', 'unzip', 'archive', 'unarchive', 'pdf2text', 'pdftext', 'readpdf', 'text2pdf', 'compile', 'runcode', 'exec', 'shell', 'eval2', 'runtime', 'pastebin', 'paste', 'scribd', 'base64url', 'jsonfmt', 'yaml2json'];
  const wrong = utilNames.filter((n) => {
    const g = registry.get(n);
    return !g || (g.engine || g.source) !== 'util';
  });
  ok(`all ${utilNames.length} utility names route to this engine`, wrong.length === 0, wrong.join(','));

  /* ══════════════════ figlet ══════════════════ */
  console.log('\n\u2550\u2550 figlet \u2550\u2550\n');

  await art.execute(ctxFor('figlet', ['ZYNEX']));
  const banner = lastText();
  ok('.figlet renders a banner', /[_\\/|]/.test(banner) && banner.length > 40, banner.slice(0, 40));
  ok('.figlet fences the banner in monospace', banner.includes('```'), 'no ``` fence — proportional font will destroy it');
  const bannerLines = banner.split('\n').filter((l) => l && !l.startsWith('```'));
  ok('.figlet uses more than one line', bannerLines.length >= 4, `${bannerLines.length} lines`);

  await art.execute(ctxFor('figlet', ['-f', 'Slant', 'HI']));
  const slanted = lastText();
  ok('.figlet -f Slant picks the Slant font', /Slant|_/.test(slanted), slanted.slice(0, 40));

  await art.execute(ctxFor('figlet', ['-f', 'NotAFont', 'HI']));
  const fallback = lastText();
  ok('.figlet with a bogus font still renders', fallback.includes('```'), 'nothing rendered');
  ok('…and admits which font it actually used', /not found|Standard/i.test(fallback), fallback.slice(0, 60));

  await art.execute(ctxFor('figlet', []));
  ok('.figlet with no text explains usage', /usage/i.test(lastText()), lastText().slice(0, 40));

  await art.execute(ctxFor('figlet', ['-f', 'Standard', 'the quick brown fox jumps over the lazy dog twice over']));
  const long = lastText();
  const widest = Math.max(...long.split('\n').filter((l) => l && !l.includes('```')).map((l) => l.length));
  ok('a long phrase stays under 100 columns', widest < 100, `${widest} cols`);

  await art.execute(ctxFor('figletfonts', []));
  const fonts = lastText();
  ok('.figletfonts lists a real font count', /(\d{3})\s*figlet fonts/.test(fonts), fonts.slice(0, 40));
  ok('…and names fonts you can actually pass', /Slant|Standard|Banner/.test(fonts), 'no known font named');

  /* ══════════════════ hand-drawn art ══════════════════ */
  console.log('\n\u2550\u2550 ASCII art \u2550\u2550\n');
  for (const key of ['zynex', 'heart', 'skull', 'cat']) {
    await art.execute(ctxFor('ascii', [key]));
    const t = lastText();
    ok(`.ascii ${key} prints a drawing`, t.length > 60 && t.includes('```'), t.slice(0, 30));
  }
  await art.execute(ctxFor('ascii', ['dragon']));
  const unknown = lastText();
  ok('.ascii with no drawing admits it and lists what exists', /No drawing/i.test(unknown), unknown.slice(0, 50));
  ok('…and still renders something rather than nothing', unknown.includes('```'), 'empty');

  // `.love` belongs to fun.js (the love calculator), not here — routing assert only
  ok('.love stays with the love calculator, not the art engine', (registry.get('love').engine || registry.get('love').source) === 'fun', 'art stole .love');

  /* ══════════════════ fancy alphabets ══════════════════ */
  console.log('\n\u2550\u2550 fancy text \u2550\u2550\n');
  const fancyExpect = { cursive: '𝒶', letter: 'ⓐ', smallcaps: 'ᴀ', symbols: 'α' };
  for (const [cmd, glyph] of Object.entries(fancyExpect)) {
    await art.execute(ctxFor(cmd, ['abc']));
    ok(`.${cmd} maps letters to ${glyph}`, lastText().includes(glyph), lastText().slice(0, 40));
  }
  // The astral-plane bug: `.cursive zynex` printed "𝓏𝓎 𝓍", silently dropping
  // letters because the glyph table was indexed by UTF-16 code unit. Every
  // character of the input must survive, and each must be a whole codepoint.
  await art.execute(ctxFor('cursive', ['zynex']));
  const cur = lastText().split('\n')[0].replace('\u2728', '').trim();
  ok('.cursive keeps every letter', [...cur].filter((c) => c !== ' ').length === 5, `got ${[...cur].length} glyphs from 5 letters: ${cur}`);
  ok('.cursive emits whole codepoints, not half surrogate pairs', !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cur), 'lone surrogate in output');
  ok('a full sentence survives transliteration intact', (() => {
    const out = art._internals.transliterate('the quick brown fox', [...'𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏'].join(''));
    const expected = 'the quick brown fox'.replace(/ /g, '').length; // 16, not 15 — count it, don't hardcode it
    return [...out].filter((c) => c !== ' ').length === expected;
  })(), 'glyph count changed');

  await art.execute(ctxFor('bigtext', ['abc']));
  const big = lastText();
  ok('.bigtext draws block letters', (big.match(/█|▀/g) || []).length > 6, big.slice(0, 20));
  ok('.bigtext is 3 rows tall', big.split('\n').filter((l) => /[█▀▄]/.test(l)).length === 3, 'wrong height');

  await art.execute(ctxFor('cursive', []));
  ok('.cursive with no text explains usage', /❌|usage/i.test(lastText()), lastText().slice(0, 30));

  /* ══════════════════ code image ══════════════════ */
  console.log('\n\u2550\u2550 code → image \u2550\u2550\n');
  await art.execute(ctxFor('codeimage', ['const answer = 42;']));
  const png = last().image;
  ok('.codeimage sends an image', Buffer.isBuffer(png), 'no image payload');
  if (Buffer.isBuffer(png)) {
    const sharp = require('sharp');
    const m = await sharp(png).metadata();
    ok('.codeimage output is a real PNG', m.format === 'png', m.format);
    ok('.codeimage is wide enough to read', m.width >= 520, `${m.width}px`);
    ok('.codeimage has no dead space at the bottom', m.height < 260, `${m.height}px tall`);
  }
  await art.execute(ctxFor('codeimage', ['-l', 'python', 'def f():', '    return None']));
  ok('.codeimage accepts a language flag', /PYTHON/i.test(String(last().caption || '')), String(last().caption || '').slice(0, 40));

  // the tokeniser bug: chained .replace() re-coloured its own fill="#a5d6a7"
  const tok = util_tokCheck();
  ok('the syntax tokeniser does not corrupt its own markup', tok, 'nested tspan / broken XML');

  /* ══════════════════ hashtags ══════════════════ */
  console.log('\n\u2550\u2550 hashtags \u2550\u2550\n');
  await art.execute(ctxFor('hashtags', ['Lagos traffic is terrible. Lagos roads need fixing. Traffic everywhere in Lagos.']));
  const tags = lastText();
  ok('.hashtags ranks repeated words first', /#lagos\s+#traffic|#lagos\s+#traffic/.test(tags) || tags.indexOf('#lagos') < tags.indexOf('#fixing'), tags.slice(0, 80));
  ok('.hashtags drops stop-words', !/#(the|is|and|in)\b/.test(tags), tags.slice(0, 60));
  await art.execute(ctxFor('hashtags', ['a an the of to']));
  ok('.hashtags says so when there is nothing to tag', /no usable words/i.test(lastText()), lastText().slice(0, 40));

  /* ══════════════════ WHOIS (live) ══════════════════ */
  console.log('\n\u2550\u2550 WHOIS (live) \u2550\u2550\n');
  const w = await util._internals.whois('github.com');
  ok('WHOIS returns a real registry record', !w.error && !!w.domain, w.error || '');
  ok('WHOIS finds the registrar', /MarkMonitor|NameCheap|GoDaddy|Tucows|Gandi|Amazon|CSC|Cloudflare/i.test(String(w.registrar)), String(w.registrar));
  ok('WHOIS finds a creation date from the wire', /^\d{4}-\d{2}-\d{2}/.test(String(w.created)), String(w.created));
  ok('WHOIS lists nameservers', (w.ns || []).length > 0, 'none');
  const bogus = await util._internals.whois('not-a-domain');
  ok('WHOIS rejects a non-domain', !!bogus.error, 'accepted garbage');
  const nx = await util._internals.whois('this-definitely-does-not-exist-92041.com');
  ok('WHOIS reports an unregistered domain as unregistered', !!nx.error && /not registered|no record/i.test(nx.error), nx.error || 'claimed it exists');

  await util.execute(ctxFor('whois', ['github.com']));
  const wt = lastText();
  ok('.whois prints a labelled record', /\*github\.com\*/.test(wt) && /Registrar/.test(wt), wt.slice(0, 60));

  /* ══════════════════ DNS (live) ══════════════════ */
  console.log('\n\u2550\u2550 DNS (live) \u2550\u2550\n');
  const d = await util._internals.dnsLookup('example.com');
  ok('DNS resolves A records for example.com', Array.isArray(d.records?.A) && d.records.A.length > 0, JSON.stringify(d.records && Object.keys(d.records)));
  ok('DNS returns an address that looks real', /\d+\.\d+\.\d+\.\d+|:/.test(String((d.records?.A || [])[0])), String(d.records?.A));
  ok('DNS knows example.com has an SOA', !!d.records?.SOA, 'no SOA');
  const dmx = await util._internals.dnsLookup('gmail.com', 'MX');
  ok('DNS can be asked for one type', Object.keys(dmx.records || {}).length === 1 && !!dmx.records.MX, JSON.stringify(Object.keys(dmx.records || {})));
  const dnx = await util._internals.dnsLookup('no-such-host-zynex-9211.example');
  ok('DNS says plainly when a name does not resolve', !!dnx.error, 'invented records');

  /* ══════════════════ HTTP inspector (live) ══════════════════ */
  console.log('\n\u2550═════════════════ HTTP ══════════════════\n');
  const h = await util._internals.httpGet('https://example.com');
  ok('HTTP inspector gets a status', h.status === 200, String(h.status));
  ok('HTTP inspector reports timing', typeof h.ms === 'number' && h.ms >= 0, String(h.ms));
  ok('HTTP inspector extracts the <title>', /Example Domain/i.test(String(h.title)), String(h.title));
  ok('HTTP inspector returns headers', Object.keys(h.headers || {}).length > 0, 'no headers');
  const badUrl = await util._internals.httpGet('http://nonexistent-zynex-9921.invalid');
  ok('HTTP inspector fails honestly on a dead host', !!badUrl.error && /could not reach/i.test(badUrl.error), badUrl.error || 'no error');

  /* ══════════════════ ports (live) ══════════════════ */
  console.log('\n\u2550\u2550 ports \u2550\u2550\n');
  const ps = await util._internals.portScan('example.com', [443, 80, 22]);
  ok('port scan finds 443 open on example.com', ps.open?.includes(443), JSON.stringify(ps.open));
  const priv = await util._internals.portScan('192.168.1.1');
  ok('port scan refuses private addresses', !!priv.error && /private/i.test(priv.error), priv.error || 'probed it');
  await util.execute(ctxFor('portscan', []));
  ok('.portscan explains what it does when given nothing', /usage|probes/i.test(lastText()), lastText().slice(0, 50));

  /* ══════════════════ ping ══════════════════ */
  console.log('\n\u2550\u2550 ping ══════════════════\n');
  await util.execute(ctxFor('ping2', ['example.com']));
  const pt = lastText();
  ok('.ping2 reports 4 attempts', (pt.match(/#\d/g) || []).length === 4, pt.slice(0, 60));
  ok('.ping2 says it is a TCP connect, not ICMP', /TCP connect/i.test(pt), 'claims to be ICMP');

  /* ══════════════════ zip ══════════════════ */
  console.log('\n\u2550\u2550 zip ══════════════════\n');
  const z = util._internals.zipFiles([{ name: 'a.txt', buf: Buffer.from('hello from zynex') }, { name: 'b/c.json', buf: Buffer.from('{"ok":true}') }]);
  ok('zip builds a valid archive', z.buffer && z.buffer.readUInt32LE(0) === 0x04034b50, 'bad magic');
  const r = util._internals.readZip(z.buffer);
  ok('unzip reads back both entries', r.files?.length === 2, JSON.stringify(r.error || r.files?.length));
  ok('unzip recovers the text', r.files.some((f) => f.text === 'hello from zynex'), JSON.stringify(r.files?.map((f) => f.text)));
  const gz = zlib.gzipSync(Buffer.from('x'.repeat(500)));
  ok('unzip rejects a non-zip with a clear message', /not a zip/i.test(util._internals.readZip(gz).error || ''), 'wrong error');

  // zip-slip. adm-zip sanitises on WRITE (verified: '../../etc/passwd' is stored
  // as 'etc/passwd'), so the writer is tested by behaviour and the reader's guard
  // is tested by name — a hostile archive from elsewhere never passes through our
  // writer at all.
  const slip = util._internals.zipFiles([{ name: '../../etc/passwd', buf: Buffer.from('x') }]);
  const slipNames = util._internals.readZip(slip.buffer).files.map((f) => f.name);
  ok('the zip writer strips ../ from entry names', !slipNames.some((n) => n.includes('..')), JSON.stringify(slipNames));
  const guard = util._internals.isUnsafeEntry;
  ok('the zip reader flags ../ traversal', guard('../../etc/passwd') && guard('a/../../b'), 'guard missed traversal');
  ok('the zip reader flags absolute paths', guard('/etc/passwd') && guard('C:\\Windows\\x'), 'guard missed absolute');
  ok('the zip reader accepts ordinary names', !guard('photos/cat.jpg') && !guard('readme.txt'), 'false positive');

  await util.execute(ctxFor('zip', ['note for the group']));
  ok('.zip without a file zips the text', Buffer.isBuffer(last().document), 'no document sent');
  ok('.zip names the file', /\.zip$/.test(String(last().fileName || '')), String(last().fileName));

  await util.execute(ctxFor('unzip', [], { media: z.buffer }));
  const ut = lastText();
  ok('.unzip lists entries from a replied file', /a\.txt/.test(ut), ut.slice(0, 60));
  ok('.unzip previews a text file inside', /hello from zynex/.test(ut), 'no preview');
  await util.execute(ctxFor('unzip', []));
  ok('.unzip without media asks for a zip', /reply to a/i.test(lastText()), lastText().slice(0, 40));

  /* ══════════════════ PDF ══════════════════ */
  console.log('\n\u2550\u2550 PDF ══════════════════\n');
  const PHRASE = 'ZYNEX-MD PDF round trip test.';
  const built = util._internals.buildPdf(PHRASE + '\n\n' + 'Second paragraph proving extraction. '.repeat(20));
  ok('text2pdf writes a real PDF header', built.buffer.subarray(0, 5).toString() === '%PDF-', built.buffer.subarray(0, 8).toString());
  ok('text2pdf ends with %%EOF', built.buffer.subarray(-8).toString().includes('%%EOF'), 'truncated');
  const back = await util._internals.pdfToText(built.buffer);
  ok('the PDF parses back', !back.error && back.pages >= 1, back.error || '');
  ok('…and the text is extractable, not drawn as glyphs', String(back.text).includes(PHRASE), 'no match — this is what an ImageMagick PDF does');

  const multi = util._internals.buildPdf('line of text\n'.repeat(400));
  ok('a long document paginates', multi.pages > 1, `${multi.pages} page(s)`);
  const multiBack = await util._internals.pdfToText(multi.buffer);
  ok('…and every page still extracts', multiBack.pages === multi.pages, `${multiBack.pages} vs ${multi.pages}`);

  const notpdf = await util._internals.pdfToText(Buffer.from('<html>definitely not a pdf</html>'));
  ok('pdf2text rejects a non-PDF without dumping a parser trace', !!notpdf.error && notpdf.error.length < 120, String(notpdf.error).slice(0, 80));

  await util.execute(ctxFor('text2pdf', []));
  ok('.text2pdf with no text explains usage', /usage/i.test(lastText()), lastText().slice(0, 40));
  await util.execute(ctxFor('pdf2text', []));
  ok('.pdf2text without a file asks for one', /reply to a/i.test(lastText()), lastText().slice(0, 40));

  /* ══════════════════ refusals ══════════════════ */
  console.log('\n\u2550\u2550 refusals \u2550\u2550\n');
  for (const cmd of ['compile', 'runcode', 'shell', 'exec']) {
    await util.execute(ctxFor(cmd, ['print(1)']));
    const t = lastText();
    ok(`.${cmd} refuses and explains why`, /can't run code|no sandbox|no shell/i.test(t), t.slice(0, 60));
    ok(`.${cmd} does not fake an output`, !/^1$|hello world|Process exited/m.test(t), 'invented an output');
  }
  await util.execute(ctxFor('pastebin', ['secret notes']));
  const paste = lastText();
  ok('.pastebin refuses and names .upload', /\.upload/.test(paste), paste.slice(0, 60));
  await util.execute(ctxFor('yaml2json', ['a: 1']));
  ok('.yaml2json refuses rather than guessing YAML', /needs a YAML parser/i.test(lastText()), lastText().slice(0, 50));

  /* ══════════════════ misc ══════════════════ */
  console.log('\n\u2550\u2550 misc \u2550\u2550\n');
  await util.execute(ctxFor('base64url', ['hello?world']));
  ok('.base64url produces URL-safe output', /^[A-Za-z0-9_-]+$/.test(lastText().replace(/```/g, '').trim()), lastText().slice(0, 40));
  await util.execute(ctxFor('jsonfmt', ['{"a":1,"b":[1,2]}']));
  ok('.jsonfmt pretty-prints valid JSON', /"b": \[/.test(lastText()), lastText().slice(0, 60));
  await util.execute(ctxFor('jsonfmt', ['{bad json']));
  ok('.jsonfmt reports invalid JSON as invalid', /invalid json/i.test(lastText()), lastText().slice(0, 40));

  /* ══════════════════ report ══════════════════ */
  const total = pass + fails.length;
  console.log(`\n${fails.length ? '\u2717' : '\u2714'} ${pass}/${total} passed\n`);
  if (fails.length) {
    console.log('FAILURES:');
    fails.forEach((f) => console.log('  ' + f));
    process.exit(1);
  }
})();

/** the tokeniser must produce balanced XML — its own output broke sharp once */
function util_tokCheck() {
  const { tokenise } = art._internals;
  const out = tokenise('const x = 42; // hi', 'js');
  const open = (out.match(/<tspan/g) || []).length;
  const close = (out.match(/<\/tspan>/g) || []).length;
  return open === close && !/<tspan[^>]*<tspan/.test(out);
}
