/**
 * HANGMAN PLAYGROUND — a local test harness for `.hangman`
 *
 * This is NOT a reimplementation. It calls the real
 * `lib/engines/games.js` execute()/handleFreeText() paths with a mocked
 * WhatsApp socket, captures the exact PNG buffer the bot would send, and
 * hands it to the browser.
 *
 * So if a letter behaves oddly here, it behaves that way on WhatsApp too.
 *
 * Run:  node tools/hangman-playground.js
 */
const http = require('http');
const crypto = require('crypto');
const games = require('../lib/engines/games');

const PORT = Number(process.env.PLAY_PORT || 5055);

/* ── per-browser session = one WhatsApp chat ─────────────── */
const sessions = new Map(); // sid -> chatId

/**
 * Session id -> a stable fake chat JID.
 *
 * Bug this fixes: once a game finished the chat id stayed keyed to a session
 * whose state no longer existed, so "New game" reused a dead chat and later
 * guesses were silently declined. Each new game now gets a fresh chat id.
 */
function sidFor(req, res) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/sid=([a-f0-9]{16})/);
  if (m && sessions.has(m[1])) return m[1];
  const sid = crypto.randomBytes(8).toString('hex');
  sessions.set(sid, newChatId(sid));
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return sid;
}

const newChatId = (sid) => `playground-${sid}-${Date.now().toString(36)}@g.us`;

/* ── capture what the engine "sends" ─────────────────────── */
function makeContext(chatId, text) {
  const captured = { images: [], texts: [] };
  const sender = `234800000${chatId.slice(-4)}@s.whatsapp.net`;
  const msg = { key: { remoteJid: chatId, participant: sender, id: 'x' }, message: { conversation: text } };

  const sock = {
    sendMessage: async (jid, content) => {
      if (content && content.image) captured.images.push(content.image);
      if (content && content.caption) captured.texts.push(content.caption);
      if (content && content.text) captured.texts.push(content.text);
      return {};
    },
    groupMetadata: async () => ({ participants: [{ id: sender }] }),
    readMessages: async () => {},
  };

  return {
    captured,
    ctx: {
      command: '', args: [], from: chatId, sender, msg, sock,
      prefix: '.',
      reply: async (t) => { captured.texts.push(String(t)); return {}; },
    },
  };
}

/* ── the two engine calls we need ────────────────────────── */
async function startGame(chatId) {
  const { captured, ctx } = makeContext(chatId, '.hangman');
  await games.execute({ ...ctx, command: 'hangman', args: [] });
  return captured;
}

async function guess(chatId, text) {
  const { captured, ctx } = makeContext(chatId, text);
  const claimed = await games.handleFreeText({
    text, from: chatId, sender: ctx.sender, msg: ctx.msg,
    sock: ctx.sock, reply: ctx.reply,
  });
  return { captured, claimed };
}

/* ── HTTP ────────────────────────────────────────────────── */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZYNEX-MD · hangman test</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0f1216;color:#eef3f9;font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#161c24;border:1px solid #232c38;border-radius:16px;padding:22px;max-width:560px;width:100%}
h1{font-size:17px;margin:0 0 3px;font-weight:600}
.sub{color:#7f90a5;font-size:12px;margin-bottom:16px}
#board{width:100%;border-radius:10px;display:block;background:#0f1216;min-height:200px}
#cap{margin-top:12px;font-size:14px;color:#c8d6e6;white-space:pre-wrap;min-height:22px}
.keys{display:grid;grid-template-columns:repeat(9,1fr);gap:5px;margin-top:16px}
button{background:#243040;color:#e6eef8;border:1px solid #31414f;border-radius:7px;padding:9px 0;font-size:14px;font-weight:600;cursor:pointer;transition:background .12s}
button:hover:not(:disabled){background:#2f3f53}
button:disabled{opacity:.28;cursor:default}
button.hit{background:#1f5c3a;border-color:#2f9e5f;color:#9be8b8}
button.miss{background:#5c1f2a;border-color:#9e2f45;color:#f0a3b3}
.row{display:flex;gap:8px;margin-top:12px}
.row button{flex:1;background:#1e2a38}
.reset{background:#2b3a4f !important}
#status{margin-top:10px;font-size:12px;color:#6d7f94}
</style></head>
<body>
<div class="card">
  <h1>🪢 Hangman — live test</h1>
  <div class="sub">Running the bot's real <code>lib/engines/games.js</code>. Every image below is the exact PNG WhatsApp receives.</div>
  <img id="board" alt="hangman board">
  <div id="cap"></div>
  <div class="keys" id="keys"></div>
  <div class="row" style="align-items:stretch">
    <input id="word" placeholder="type the whole word…" maxlength="24"
      style="flex:2;background:#1b2531;border:1px solid #31414f;border-radius:7px;padding:9px 11px;color:#e6eef8;font-size:14px;outline:none"
      onkeydown="if(event.key==='Enter')guessWord()">
    <button onclick="guessWord()" style="flex:1">Solve</button>
    <button class="reset" onclick="start()" style="flex:1">New game</button>
  </div>
  <div id="status"></div>
</div>
<script>
const keysEl = document.getElementById('keys');
const used = {};
let over = false;

for (const ch of 'abcdefghijklmnopqrstuvwxyz'.split('')) {
  const b = document.createElement('button');
  b.textContent = ch.toUpperCase();
  b.dataset.k = ch;
  b.onclick = () => send(ch);
  keysEl.appendChild(b);
}

function paint(data) {
  if (data.image) document.getElementById('board').src = 'data:image/png;base64,' + data.image;
  document.getElementById('cap').textContent = data.caption || '';
  document.getElementById('status').textContent = data.status || '';
  if (data.over) {
    over = true;
    for (const b of keysEl.children) b.disabled = true;
  }
}

async function start() {
  over = false;
  for (const k in used) delete used[k];
  for (const b of keysEl.children) { b.disabled = false; b.className = ''; }
  const r = await fetch('/api/start', { method: 'POST' });
  paint(await r.json());
}

async function guessWord() {
  if (over) return;
  const el = document.getElementById('word');
  const w = el.value.trim().toLowerCase();
  if (!w) return;
  el.value = '';
  await post(w);
}

async function send(ch) {
  if (over || used[ch]) return;
  await post(ch);
}

async function post(ch) {
  const r = await fetch('/api/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ letter: ch }),
  });
  const data = await r.json();
  if (data.hit !== undefined) {
    used[ch] = data.hit;
    const b = [...keysEl.children].find(x => x.dataset.k === ch);
    if (b) { b.className = data.hit ? 'hit' : 'miss'; b.disabled = true; }
  }
  paint(data);
}

start();
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const sid = sidFor(req, res);
    const chatId = sessions.get(sid);

    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }

    if (req.url === '/api/start' && req.method === 'POST') {
      // fresh chat id per game so state can never collide with a finished one
      const freshId = newChatId(sid);
      sessions.set(sid, freshId);
      const captured = await startGame(freshId);
      const img = captured.images[captured.images.length - 1];
      return json(res, 200, {
        image: img ? img.toString('base64') : null,
        caption: captured.texts.join('\n'),
        status: 'Game started — pick a letter.',
        over: false,
      });
    }

    if (req.url === '/api/guess' && req.method === 'POST') {
      if (!sessions.has(sid)) return json(res, 400, { caption: 'Start a game first.' });
      let body = '';
      for await (const chunk of req) body += chunk;
      const body_ = JSON.parse(body || '{}');
      const letter = String(body_.letter || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!letter.length) return json(res, 400, { caption: 'send a letter or a word' });

      const { captured, claimed } = await guess(chatId, letter);
      const img = captured.images[captured.images.length - 1];
      const caption = captured.texts.join('\n') || '(no response)';
      const over = /SOLVED|Hanged|GAME OVER/i.test(caption);
      // A miss is any response that says so; a hit is any other in-progress
      // response. The engine's own wording is the source of truth here.
      let hit;
      if (!over) hit = !/Miss/i.test(caption);
      return json(res, 200, {
        image: img ? img.toString('base64') : null,
        caption,
        hit,
        over,
        status: claimed ? '' : 'engine declined (no game running)',
      });
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[playground]', e);
    json(res, 500, { caption: 'server error: ' + e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hangman playground on http://0.0.0.0:${PORT}`);
});
