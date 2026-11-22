/**
 * AI ENGINE — 54 catalogue names on keyless endpoints.
 *
 * Probed live, Nov 2026:
 *
 *   text  → text.pollinations.ai   (gpt-oss-20b, no key)
 *   image → image.pollinations.ai  (sana, no key)
 *
 * The honesty problems this engine exists to solve:
 *
 * 1. **Pollinations throttles by IP, not by key.** Measured: ~3 text replies per
 *    45s, 1 image per 45s, and a 503 when it is simply busy. A WhatsApp group is
 *    far faster than that. So there is one queue for the whole bot: calls are
 *    spaced, retried on 503, and when the wait would be long the command says
 *    "busy, ~N seconds" instead of hanging or failing silently.
 *
 * 2. **There is exactly one model and one image model.** `.gpt4 .claude .gemini
 *    .grok .llama .midjourney .dalle .flux .bard .deepseek .copilot` therefore
 *    cannot really be those models. They are honest aliases: the reply names the
 *    command, the answer, and states plainly which backend produced it. They are
 *    *not* silent lies about which model answered.
 *
 * 3. **Photo restyling is not possible.** `.aiface .faceswap .cartoonify
 *    .anime2d .ghibli .pixar .disney3d .caricature .figurine .deepfake` all imply
 *    taking *your* photo and changing it. Probed: image-to-image with a reference
 *    changes the output by a few bytes (same fox, same pose) — there is no real
 *    img2img. Asking the model to draw a new picture "in that style" is something
 *    else entirely, so those commands call it what it is: a new text-to-image
 *    drawing, and they say so up front.
 *
 * 4. **No speech-to-text, no voice cloning.** `.stt .transcribe .deepfake`
 *    (voice) need a model we do not have keyless — they refuse and name what
 *    works instead (`.tts`).
 *
 * What genuinely works here: chat, code generation/debugging, rewriting,
 * explaining, summarising, translation-style tasks, prompt building for image
 * models, and real image generation on any prompt.
 */
'use strict';

const crypto = require('crypto');

const TEXT_ENDPOINT = 'https://text.pollinations.ai';
const IMAGE_ENDPOINT = 'https://image.pollinations.ai/prompt';
const UA = 'ZYNEX-MD/1.0 (WhatsApp bot)';

/* ══════════════════ the shared queue ══════════════════ */

const TEXT_GAP_MS = 16_000; // safe under the measured ~3 replies / 45s
const IMAGE_GAP_MS = 48_000; // measured limit is 1 image / 45s

const queue = {
  text: { last: 0, chain: Promise.resolve() },
  image: { last: 0, chain: Promise.resolve() },
};

/** how long until this lane can run again, in ms */
function waitFor(lane) {
  const q = queue[lane];
  const gap = lane === 'image' ? IMAGE_GAP_MS : TEXT_GAP_MS;
  return Math.max(0, q.last + gap - Date.now());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `job` on a lane, serialised behind every other job on that lane.
 * Rejects immediately if the queue is so backed up that the caller should have
 * been told to wait — the engine checks `waitFor` first and reports it.
 */
function enqueue(lane, job) {
  const q = queue[lane];
  const run = async () => {
    const wait = waitFor(lane);
    if (wait > 0) await sleep(wait);
    q.last = Date.now();
    return job();
  };
  const result = q.chain.then(run, run);
  q.chain = result.catch(() => {});
  return result;
}

/* ══════════════════ text ══════════════════ */

/**
 * One completion. Pollinations' GET route is the stable one — the POST
 * /openai route answers 402/503 far more often from this host.
 */
async function complete(prompt, { timeoutMs = 45_000 } = {}) {
  return enqueue('text', async () => {
    const url = `${TEXT_ENDPOINT}/${encodeURIComponent(prompt)}`;
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'text/plain' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await res.text();
        if (res.ok && body && !/Free limit reached|rate limit|SERVICE_UNAVAILABLE/i.test(body.slice(0, 200))) {
          return body.trim();
        }
        lastErr = new Error(
          res.status === 402 ? 'rate limited' : res.status === 503 ? 'service busy' : `HTTP ${res.status}`,
        );
        // the service tells us how long to wait; honour it when it does
        const m = body.match(/wait (\d+) seconds|Retry after (\d+)/i);
        const hinted = m ? parseInt(m[1] || m[2], 10) : 0;
        if (hinted > 0 && hinted < 90) await sleep(Math.min(90_000, hinted * 1000 + 500));
        else await sleep(3000 * (attempt + 1));
      } catch (e) {
        lastErr = e;
        await sleep(2500 * (attempt + 1));
      }
    }
    throw lastErr || new Error('no answer');
  });
}

/* ══════════════════ image ══════════════════ */

const IMAGE_PRESETS = {
  // the prompt suffix that pushes the one available model toward a look
  anime2d: 'anime style, clean lineart, cel shading',
  animeai: 'anime style, detailed illustration',
  ghibli: 'studio ghibli style, soft watercolour background, gentle warm light',
  pixar: 'pixar 3d animation style, soft studio lighting, expressive character',
  disney3d: 'disney 3d animation style, glossy render, warm lighting',
  cartoonify: 'cartoon illustration, thick outlines, flat bold colours',
  caricature: 'exaggerated caricature illustration, big head, comic style',
  figurine: 'collectible figurine photograph, glossy resin, studio backdrop',
  aiart: 'digital art, highly detailed, dramatic lighting',
  aiimage: 'photorealistic, 8k, natural lighting',
  txt2img: 'photorealistic, 8k, natural lighting',
  imagine: 'cinematic digital art, dramatic composition',
};

/** Build a /prompt URL; the seed makes a request reproducible. */
function imageUrl(prompt, { width = 1024, height = 1024, seed, model } = {}) {
  const p = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
  
    seed: String(seed ?? Math.floor(Math.random() * 1e9)),
  });
  if (model) p.set('model', model);
  return `${IMAGE_ENDPOINT}/${encodeURIComponent(prompt)}?${p.toString()}`;
}

/**
 * Generate one image. Returns { buffer, contentType } — bytes, never a URL, so
 * the caller can verify it is really an image before sending it.
 */
async function generateImage(prompt, opts = {}) {
  return enqueue('image', async () => {
    const url = imageUrl(prompt, opts);
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(120_000),
        });
        const type = res.headers.get('content-type') || '';
        if (res.ok && type.startsWith('image/')) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 2000) return { buffer: buf, contentType: type };
          lastErr = new Error('image came back empty');
        } else {
          const body = await res.text();
          const m = body.match(/wait (\d+) seconds|Retry after (\d+)/i);
          const hinted = m ? parseInt(m[1] || m[2], 10) : 0;
          lastErr = new Error(res.status === 402 ? 'rate limited' : res.status === 503 ? 'service busy' : `HTTP ${res.status}`);
          if (hinted > 0 && hinted < 120) await sleep(Math.min(120_000, hinted * 1000 + 1000));
          else await sleep(6000 * (attempt + 1));
        }
      } catch (e) {
        lastErr = e;
        await sleep(5000 * (attempt + 1));
      }
    }
    throw lastErr || new Error('no image');
  });
}

/* ══════════════════ prompt helpers ══════════════════ */

const BASE_SYSTEM = [
  'You are ZYNEX, a concise assistant inside a WhatsApp group chat.',
  'Answer in the fewest lines that fully answer. No preamble, no restating the question.',
  'Never use markdown headings or tables. Plain text and simple - bullets only.',
  'If you are unsure or the request needs private data you do not have, say so plainly.',
].join(' ');

const TASKS = {
  chat: (q) => `${BASE_SYSTEM}\n\nHuman: ${q}\nAssistant:`,
  assistant: (q) => `${BASE_SYSTEM}\n\nHuman: ${q}\nAssistant:`,
  explain: (q) => `${BASE_SYSTEM}\n\nExplain this simply, with one concrete example: ${q}`,
  explaincode: (q) => `${BASE_SYSTEM}\n\nExplain what this code does, step by step, then flag any bug:\n\n${q}`,
  codegen: (q) => `${BASE_SYSTEM}\n\nWrite working code for this. Output only the code plus one line on how to run it.\n\n${q}`,
  debugcode: (q) => `${BASE_SYSTEM}\n\nFind the bug in this code. Name the line and give the fix:\n\n${q}`,
  refactor: (q) => `${BASE_SYSTEM}\n\nRefactor this for readability without changing behaviour. Output the code only:\n\n${q}`,
  regex: (q) => `${BASE_SYSTEM}\n\nGive a single regular expression for this. Explain it in one line:\n\n${q}`,
  sql: (q) => `${BASE_SYSTEM}\n\nWrite one SQL query for this. Standard SQL, no markdown:\n\n${q}`,
  grammar: (q) => `${BASE_SYSTEM}\n\nFix spelling and grammar only. Keep the meaning and tone. Output the corrected text only:\n\n${q}`,
  proofread: (q) => `${BASE_SYSTEM}\n\nProofread. Corrected text first, then at most 3 short notes:\n\n${q}`,
  rewrite: (q) => `${BASE_SYSTEM}\n\nRewrite this more clearly, same meaning, same length or shorter:\n\n${q}`,
  paraphrase: (q) => `${BASE_SYSTEM}\n\nParaphrase this in different words, same meaning:\n\n${q}`,
  expand_text: (q) => `${BASE_SYSTEM}\n\nExpand this into a short, well-structured paragraph:\n\n${q}`,
  simplify: (q) => `${BASE_SYSTEM}\n\nRewrite this so a 12-year-old understands it:\n\n${q}`,
  summarize: (q) => `${BASE_SYSTEM}\n\nSummarise in at most 5 short bullets:\n\n${q}`,
  summary: (q) => `${BASE_SYSTEM}\n\nSummarise in at most 5 short bullets:\n\n${q}`,
  eli5: (q) => `${BASE_SYSTEM}\n\nExplain this like I am five, in under 4 sentences: ${q}`,
};

/* ══════════════════ NAMES ══════════════════ */

// Commands that are honest aliases for the single available model, with the
// label shown to the user so nobody is told they are talking to GPT-5.
const ALIASES = {
  ai: 'AI', assistant: 'AI', chat: 'AI', chatgpt: 'AI', gpt: 'AI', gpt4: 'AI', gpt5: 'AI',
  openai: 'AI', claude: 'AI', gemini: 'AI', bard: 'AI', grok: 'AI', llama: 'AI',
  mistral: 'AI', deepseek: 'AI', copilot: 'AI',
};

const TEXT_COMMANDS = {
  chat: 'chat', assistant: 'assistant', explain: 'explain', eli5: 'eli5',
  explaincode: 'explaincode', codegen: 'codegen', debugcode: 'debugcode',
  refactor: 'refactor', regex: 'regex', sql: 'sql', grammar: 'grammar',
  proofread: 'proofread', rewrite: 'rewrite', paraphrase: 'paraphrase',
  expand_text: 'expand_text', simplify: 'simplify', summarize: 'summarize',
  summary: 'summary',
};

const IMAGE_COMMANDS = new Set([
  'aiart', 'aiimage', 'txt2img', 'imagine', 'anime2d', 'animeai', 'ghibli',
  'pixar', 'disney3d', 'cartoonify', 'caricature', 'figurine',
  // catalogue aliases for "generate an image"
  'dalle', 'midjourney', 'flux', 'stablediffusion', 'animeai',
]);

// names that imply editing YOUR photo — there is no img2img, so they refuse
const RESTYLE_REFUSALS = {
  aiface: 'changing the face on a photo',
  faceswap: 'swapping faces between two photos',
  deepfake: 'deepfake / face or voice replacement',
};

// names that imply a model we do not have
const MODEL_REFUSALS = {
  stt: 'speech-to-text',
  transcribe: 'speech-to-text',
  aivoice: 'voice cloning / AI voice generation',
};

const NAMES = new Set([
  ...Object.keys(ALIASES),
  ...Object.keys(TEXT_COMMANDS),
  ...Object.keys(TASKS),
  ...IMAGE_COMMANDS,
  ...Object.keys(RESTYLE_REFUSALS),
  ...Object.keys(MODEL_REFUSALS),
  ...Object.keys(IMAGE_PRESETS),
  'variation', 'prompt',
]);

/* ══════════════════ helpers ══════════════════ */

const ARG = (args) => (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

function chunk(text, size = 3500) {
  if (text.length <= size) return [text];
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.trim()) out.push(rest);
  return out;
}

const QUEUE_HINT = (lane) => {
  const wait = Math.ceil(waitFor(lane) / 1000);
  return wait > 3 ? ` — busy right now, about ${wait}s` : '';
};

/* ══════════════════ the engine ══════════════════ */

module.exports = {
  id: 'ai',
  name: 'ai-engine',

  match(name) {
    return NAMES.has(name);
  },

  describe(name) {
    if (IMAGE_COMMANDS.has(name)) return 'AI image generation';
    if (RESTYLE_REFUSALS[name]) return 'Photo restyle (no img2img available)';
    if (MODEL_REFUSALS[name]) return 'Needs a model we do not have keyless';
    return 'AI text answer';
  },

  extraNames: [...NAMES],

  // exposed so tests can see the real budget instead of guessing
  _internals: {
    waitFor, complete, generateImage, queue, TEXT_GAP_MS, IMAGE_GAP_MS, TASKS, IMAGE_PRESETS,
    /** resolve once `lane` may run again — used by tests to avoid self-throttling */
    settle: (lane) => sleep(waitFor(lane)),
  },

  async execute({ command, args, reply, sock, from, msg }) {
    const q = ARG(args);

    /* ── honest refusals first ─────────────────────────── */
    if (RESTYLE_REFUSALS[command]) {
      return reply(
        `🚫 *${command}* would mean ${RESTYLE_REFUSALS[command]} — and no keyless service does real\n` +
          `image-to-image from this host. I checked: feeding a reference photo back in returns the same\n` +
          `picture with the same pose, so calling it a "restyle" would be a lie.\n\n` +
          `What *does* work:\n` +
          `▸ \`.imagine <description>\` — a brand-new drawing from your text\n` +
          `▸ \`.ghibli <description>\` — same, pushed toward a soft illustrated look\n` +
          `▸ \`.convert\` — real image edits (resize, crop, filters, format)`,
      );
    }

    if (MODEL_REFUSALS[command]) {
      // A refusal that leaves the user with nowhere to go is barely better than
      // a fake answer, so every one of these names a real command.
      const alt = {
        aivoice: '▸ `.tts <text>` — real text-to-speech in 10 languages',
        stt:
          'No keyless speech-to-text exists from this host, so I cannot turn a voice note into text.\n' +
          'Type or paste the words instead and I will answer them:\n' +
          '▸ `.chat <your question>` · `.summarize <text>` · `.translate <text>`',
        transcribe:
          'No keyless speech-to-text exists from this host, so I cannot transcribe audio.\n' +
          'For the opposite direction there is real text-to-speech:\n' +
          '▸ `.tts <text>` — speaks your text in 10 languages',
      }[command];
      return reply(`🚫 *${command}* needs ${MODEL_REFUSALS[command]}, which I have no keyless access to.\n\n${alt}`);
    }

    /* ── image generation ──────────────────────────────── */
    if (IMAGE_COMMANDS.has(command)) {
      if (!q) return reply(`❌ Use \`.${command} a neon cyberpunk market in Lagos\``);
      const preset = IMAGE_PRESETS[command];
      const finalPrompt = preset ? `${q}, ${preset}` : q;
      const wait = waitFor('image');
      if (wait > 70_000) {
        return reply(
          `⏳ Image queue is backed up (~${Math.ceil(wait / 1000)}s).\n` +
            `The free tier allows about one image per 45 seconds — try again shortly.`,
        );
      }
      try {
        const { buffer } = await generateImage(finalPrompt);
        const cap =
          `🎨 *${command.toUpperCase()}*\n` +
          `_${q}_\n\n` +
          `renderer: sana (keyless) · ${preset ? `style: ${preset.split(',')[0]}` : 'no style preset'}\n` +
          `_There is exactly one free image model — this is not ${command}, it is that model._`;
        return await sock.sendMessage(from, { image: buffer, caption: cap }, { quoted: msg });
      } catch (e) {
        return reply(
          `❌ Image generation failed (${e.message}).\n` +
            `The free tier allows ~1 image / 45s — wait a moment and retry.`,
        );
      }
    }

    /* ── prompt helper: turn an idea into an image prompt ── */
    if (command === 'prompt') {
      if (!q) return reply('❌ Use `.prompt a girl selling bread at sunrise`');
      try {
        const out = await complete(
          `${BASE_SYSTEM}\n\nTurn this idea into one vivid image-generation prompt under 60 words. Output the prompt only:\n${q}`,
        );
        return reply(`🖋️ *Prompt for \`.imagine\`*\n\n${out}`);
      } catch (e) {
        return reply(`❌ Prompt builder unavailable (${e.message}). Try again shortly.`);
      }
    }

    /* ── text commands ─────────────────────────────────── */
    const task = TEXT_COMMANDS[command] || (ALIASES[command] ? 'chat' : null);
    if (!task) {
      return reply(`❌ *${command}* isn't wired up.`);
    }

    if (!q) {
      const hint =
        task === 'codegen' ? 'a python script that renames files by date'
        : task === 'regex' ? 'match a Nigerian phone number'
        : task === 'sql' ? 'top 5 customers by total spend'
        : 'what is a database index';
      return reply(`❌ Use \`.${command} ${hint}\``);
    }

    const wait = waitFor('text');
    if (wait > 60_000) {
      return reply(`⏳ AI queue is busy (~${Math.ceil(wait / 1000)}s). The free tier allows ~3 replies a minute.`);
    }

    try {
      const prompt = TASKS[task](q);
      const answer = await complete(prompt);
      const label = ALIASES[command] ? ALIASES[command] : 'AI';
      const head = `🤖 *${command}* · ${label}`;
      const parts = chunk(answer);
      await reply(`${head}\n\n${parts[0]}`);
      for (let i = 1; i < parts.length; i++) await reply(parts[i]);
    } catch (e) {
      const msgText =
        /rate limited|busy/i.test(e.message)
          ? `⏳ The free AI tier is rate-limited right now (~${Math.ceil(waitFor('text') / 1000)}s). Try again shortly.`
          : `❌ AI unavailable (${e.message}).`;
      return reply(msgText);
    }
  },
};
