#!/usr/bin/env node
/**
 * ai-test.cjs — the AI engine has to be honest about three things.
 *
 * 1. Anything that needs a model we don't have must REFUSE, and name a working
 *    alternative. Never a fabricated answer.
 * 2. Anything that generates must return real bytes — an image command that
 *    replies with a URL, or a text command that echoes its prompt, is a fake.
 * 3. The free tier is throttled by IP (~3 text/min, 1 image/45s). The engine
 *    must serialise, retry, and report waits — not hammer and fail.
 *
 * The live half of this suite is deliberately small: the free tier is a shared
 * resource, and a test suite that burns it makes the bot worse for the user.
 *
 * Run: node scripts/ai-test.cjs      (npm run test:ai)
 */
process.env.SILENT = '1';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const ai = require(path.join(ROOT, 'lib', 'engines', 'ai.js'));
const registry = require(path.join(ROOT, 'lib', 'registry.js'));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \u2713 ${n}`); }
  else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); }
};

let sent = [];
const sock = { sendMessage: async (j, c) => { sent.push(c); return {}; } };

async function run(command, args = []) {
  sent = [];
  await ai.execute({
    command, args, from: '1203634@g.us', sender: '2348111000003@s.whatsapp.net',
    msg: { key: {}, message: {} }, prefix: '.', sock,
    reply: async (t) => { sent.push({ text: String(t) }); return {}; },
  });
  return sent[sent.length - 1] || {};
}

const text = (p) => String(p.text || p.caption || '');
const isImage = (b) => Buffer.isBuffer(b) && b.length > 2000;

(async () => {
  console.log('\n\u2550\u2550 AI engine \u2550\u2550\n');

  /* ── 1. routing: every declared name must be routed to us ── */
  const reg = registry.byCategory()['ai'] || [];
  const missing = reg.filter((o) => o.source === 'fallback').map((o) => o.name);
  ok(`all ${reg.length} catalogue ai names are implemented`, missing.length === 0, missing.join(' '));

  const declared = ai.extraNames;
  const misrouted = declared.filter((n) => {
    const owner = registry.get(n);
    return !owner || (owner.engine || owner.source) !== 'ai';
  });
  ok(`every declared ai name routes to the ai engine (${declared.length})`, misrouted.length === 0, misrouted.join(' '));

  /* ── 2. honest refusals (offline) ── */
  console.log('');
  const REFUSE = {
    faceswap: /swapping faces/i,
    aiface: /face on a photo/i,
    deepfake: /deepfake/i,
    stt: /speech-to-text/i,
    transcribe: /speech-to-text/i,
    aivoice: /voice/i,
  };
  for (const [cmd, re] of Object.entries(REFUSE)) {
    const p = await run(cmd, ['x']);
    const body = text(p);
    const refuses = re.test(body) && /🚫/.test(body);
    const namesAlternative = /\.imagine|\.ghibli|\.tts|\.convert|\.chat|\.summarize/.test(body);
    ok(`.${cmd} refuses honestly and offers an alternative`, refuses && namesAlternative, body.replace(/\n/g, ' ').slice(0, 78));
    ok(`.${cmd} sends no image`, !p.image, 'sent an image anyway');
  }

  /* ── 3. every generating command must ask for a prompt ── */
  console.log('');
  const IMAGE_CMDS = ['imagine', 'aiart', 'aiimage', 'txt2img', 'ghibli', 'anime2d', 'pixar', 'cartoonify', 'dalle', 'midjourney', 'flux'];
  for (const cmd of IMAGE_CMDS) {
    // Queue-throttle branch is only taken when backed up; with an empty prompt
    // the usage message is returned before any network call.
    const p = await run(cmd, []);
    ok(`.${cmd} with no prompt explains usage`, /Use `\./.test(text(p)) && !p.image, text(p).slice(0, 60));
  }

  /* ── 4. the throttle contract (offline) ── */
  console.log('');
  const { waitFor, TEXT_GAP_MS, IMAGE_GAP_MS } = ai._internals;
  ok('text lane spaces calls (~3/min budget)', TEXT_GAP_MS >= 15000 && TEXT_GAP_MS <= 20000, `${TEXT_GAP_MS}ms`);
  ok('image lane respects the 45s limit', IMAGE_GAP_MS >= 45000, `${IMAGE_GAP_MS}ms`);
  ok('waitFor returns a number for both lanes',
    typeof waitFor('text') === 'number' && typeof waitFor('image') === 'number');

  /* ── 5. live: one text answer, one image ── */
  console.log('');
  // This suite shares one IP with every other live test, so it waits for its own
  // lane instead of blaming the engine for a throttle the suite caused.
  await ai._internals.settle('text');
  try {
    const p = await run('explain', ['what is a cache in one sentence']);
    const body = text(p);
    const answered = body.length > 40 && !/unavailable|HTTP \d/i.test(body);
    ok('.explain gives a real answer', answered, body.replace(/\n/g, ' ').slice(0, 90));
    ok('.explain labels itself honestly', /· AI/.test(body), body.split('\n')[0]);
  } catch (e) {
    ok('.explain gives a real answer', false, `threw: ${e.message}`);
  }

  // The free image tier is genuinely flaky near its limit (measured: 402/503 on
  // roughly one call in three even when spaced). Retry a couple of times so the
  // suite tests the engine, not the service's mood — but still fail if every
  // attempt fails, because then it really is broken.
  await ai._internals.settle('image');
  try {
    let p = {};
    for (let attempt = 0; attempt < 3 && !isImage(p.image); attempt++) {
      if (attempt) await ai._internals.settle('image');
      p = await run('imagine', ['a red bicycle against a yellow wall']);
    }
    const good = isImage(p.image);
    const meta = good ? await sharp(p.image).metadata() : null;
    ok('.imagine returns real image bytes', good && meta.width >= 256, good ? `${meta.width}x${meta.height}` : 'no image');
    ok('.imagine caption names the real renderer', /sana/.test(String(p.caption || '')), String(p.caption || '').slice(0, 60));
  } catch (e) {
    ok('.imagine returns real image bytes', false, `threw: ${e.message}`);
  }

  /* ── 6. the lie-guard: no alias may claim to be a model it isn't ── */
  console.log('');
  for (const alias of ['gpt4', 'claude', 'gemini', 'grok', 'midjourney', 'dalle']) {
    const p = await run(alias, []);
    const body = text(p);
    // with no prompt it must ask for one; the label is what matters
    ok(`.${alias} is an alias asking for input, not a fake model`, /Use `\./.test(body) || /· AI|sana/.test(body), body.slice(0, 60));
  }
  const src = require('fs').readFileSync(path.join(ROOT, 'lib', 'engines', 'ai.js'), 'utf8');
  ok('engine documents that only one model exists', /exactly one model|one model and one image model|gpt-oss-20b/.test(src));

  const total = pass + fails.length;
  console.log(`\n${pass}/${total} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  \u2022 ' + f));
    process.exit(1);
  }
})();
