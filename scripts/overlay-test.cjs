/**
 * scripts/overlay-test.cjs — the image effects must be the RECOGNISED effect.
 *
 * ★ The history this suite exists to prevent
 *
 * The first version of the overlay engine drew approximations with ffmpeg
 * filter chains: a black band with a red rule for `.wasted`, grey bars for
 * `.jail`. Every test passed. The output was not the thing anyone knows — the
 * real `.wasted` is the GTA loss screen and the real `.jail` is a photo behind
 * prison bars.
 *
 * So these tests do not ask "did ffmpeg exit 0". They ask:
 *   - does a real PNG asset exist for every advertised name?
 *   - is the asset composited, rather than approximated with filters?
 *   - does the result keep the asset's dimensions?
 *   - is the user's photo actually still visible underneath it?
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'lib/engines/overlay.js'));
const I = engine._internal;
const { ffmpegPath } = require(path.join(ROOT, 'lib/ffmpeg'));

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const ASSETS = path.join(ROOT, 'assets', 'overlays');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-ovt-'));

/** A photo-like input: not flat, so "is it still visible" is meaningful. */
const PHOTO = path.join(TMP, 'photo.png');
execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi',
  '-i', 'testsrc2=size=480x480:rate=1', '-frames:v', '1', '-update', '1', PHOTO]);
const IMG = fs.readFileSync(PHOTO);

const decode = (buf) => execFileSync(ffmpegPath(), ['-loglevel', 'error',
  '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
  { input: buf, maxBuffer: 256 * 1024 * 1024 });

/* ── the artwork must exist ───────────────────────────────── */
t('every advertised effect has real artwork on disk', () => {
  const missing = [];
  for (const [name, def] of Object.entries(I.EFFECTS)) {
    const found = ['png', 'jpg'].some((e) => fs.existsSync(path.join(ASSETS, `${def.file}.${e}`)));
    if (!found) missing.push(name);
  }
  assert.deepStrictEqual(missing, [], `no artwork for: ${missing.join(', ')}`);
});

t('the artwork is committed, not resolved from node_modules at runtime', () => {
  // A node_modules path would vanish on a clean install or a different package
  // manager, and the command would break in production only.
  const src = fs.readFileSync(path.join(ROOT, 'lib/engines/overlay.js'), 'utf8');
  assert.ok(!/node_modules.*canvacord-assets/.test(src), 'engine still depends on canvacord-assets at runtime');
  assert.ok(fs.existsSync(ASSETS), 'assets/overlays is missing from the repo');
});

t('the key overlays are the real transparent artwork', () => {
  // wasted must be RGBA (alpha) — an opaque rectangle would hide the photo.
  const wasted = path.join(ASSETS, 'wasted.png');
  assert.ok(fs.existsSync(wasted), 'wasted.png missing');
  const b = fs.readFileSync(wasted);
  assert.strictEqual(b.slice(1, 4).toString(), 'PNG');
  const colourType = b[25];
  assert.ok([4, 6].includes(colourType), `wasted.png has no alpha channel (colour type ${colourType})`);
  const dim = I.dimensions(wasted);
  assert.ok(dim.w === 750 && dim.h === 920, `wasted.png is ${dim.w}x${dim.h}, expected 750x920`);
});

/* ── rendering must composite, not approximate ────────────── */
t('every effect renders at the artwork dimensions', async () => {
  const wrong = [];
  for (const [name, def] of Object.entries(I.EFFECTS)) {
    const asset = ['png', 'jpg'].map((e) => path.join(ASSETS, `${def.file}.${e}`)).find((p) => fs.existsSync(p));
    const want = I.dimensions(asset);
    const out = await I.render(IMG, name);
    const got = I.dimensions(Buffer.from(out));
    if (!got || got.w !== want.w || got.h !== want.h) {
      wrong.push(`${name}: ${got ? `${got.w}x${got.h}` : 'unreadable'} vs artwork ${want.w}x${want.h}`);
    }
  }
  assert.deepStrictEqual(wrong, [], 'effects did not match their artwork:\n  ' + wrong.join('\n  '));
});

t('the user photo is still visible under the overlay', async () => {
  // If the compositing were inverted the output would be the artwork alone.
  const out = await I.render(IMG, 'wasted');
  const raw = decode(Buffer.from(out));
  const uniqueColours = new Set();
  for (let i = 0; i + 2 < raw.length; i += 3 * 401) {
    uniqueColours.add(`${raw[i]},${raw[i + 1]},${raw[i + 2]}`);
  }
  assert.ok(uniqueColours.size > 20,
    `wasted output has only ${uniqueColours.size} distinct sampled colours — the photo is not showing through`);
});

t('a flat photo still produces a valid image, not a crash', async () => {
  const flat = path.join(TMP, 'flat.png');
  execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=c=orange:size=300x300', '-frames:v', '1', '-update', '1', flat]);
  const out = await I.render(fs.readFileSync(flat), 'jail');
  assert.ok(out.length > 200);
  assert.strictEqual(Buffer.from(out).slice(1, 4).toString(), 'PNG');
});

t('a portrait photo is cover-cropped, not squashed', async () => {
  const tall = path.join(TMP, 'tall.png');
  execFileSync(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc2=size=200x800:rate=1', '-frames:v', '1', '-update', '1', tall]);
  const out = await I.render(fs.readFileSync(tall), 'wasted');
  const dim = I.dimensions(Buffer.from(out));
  assert.ok(dim && dim.w === 750 && dim.h === 920, `got ${dim ? dim.w + 'x' + dim.h : 'no size'}`);
});

t('no effect relies on drawtext, which ffmpeg-static does not have', () => {
  const list = execFileSync(ffmpegPath(), ['-hide_banner', '-filters']).toString();
  if (/\bdrawtext\b/.test(list)) return; // different build — constraint moot
  const src = fs.readFileSync(path.join(ROOT, 'lib/engines/overlay.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/drawtext=/.test(code), 'an effect calls drawtext, which this ffmpeg cannot run');
});

/* ── failure paths ────────────────────────────────────────── */
t('no image produces an instruction, not a crash', async () => {
  let said = null;
  await engine.execute({
    command: 'wasted',
    reply: (x) => { said = String(x); return Promise.resolve(); },
    download: async () => { throw new Error('no media in this message'); },
  });
  assert.ok(/Reply to a photo/i.test(said), `expected guidance, got: ${said}`);
});

t('a broken image is reported with a cause', async () => {
  let said = null;
  await engine.execute({
    command: 'jail',
    reply: (x) => { said = String(x); return Promise.resolve(); },
    download: async () => Buffer.from('not an image at all'),
  });
  assert.ok(/failed/i.test(said), `expected a failure message, got: ${said}`);
  assert.ok(/ffmpeg could not process/i.test(said), 'did not say what went wrong');
});

/* ── ownership ────────────────────────────────────────────── */
t('no effect shadows a command that already exists', () => {
  for (const reserved of ['kiss', 'slap', 'hug', 'pat', 'tourl', 'sticker', 'ping']) {
    assert.ok(!engine.match(reserved), `${reserved} would shadow an existing command`);
  }
});

t('claimed names and artwork lists agree', () => {
  const claimed = new Set(engine.extraNames);
  for (const n of Object.keys(I.EFFECTS)) assert.ok(claimed.has(n), `${n} has artwork but is not claimed`);
  for (const n of claimed) assert.ok(I.EFFECTS[n], `${n} is claimed but has no artwork`);
});

t('handler still sends a returned image', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/handler.js'), 'utf8');
  assert.ok(/Buffer\.isBuffer\(result\.image\)/.test(src), 'handler discards returned media again');
});

setTimeout(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`✔ ${name}`); pass++; }
    catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}, 50);
