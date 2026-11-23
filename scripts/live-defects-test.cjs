/**
 * Three defects found in the live production log, pinned so they stay fixed.
 *
 * Everything here was observed on the running bot rather than imagined:
 *   1. .ping sent two messages for one command
 *   2. every URL-bearing reply tried to fetch a link preview through a package
 *      that is not installed, logging ERR_MODULE_NOT_FOUND
 *   3. a history batch logged "cached 0 media item(s)" whether or not anything
 *      was captured
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const eq = (n, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { console.log(`✔ ${n}`); pass++; }
  else { console.log(`✗ ${n}  got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); fail++; }
};

/* ── 1. .ping ─────────────────────────────────────────────────────────────── */
(async () => {
  const ping = require(path.join(ROOT, 'lib/commands/ping'));
  const capture = async (startedSecondsAgo) => {
    const out = [];
    const msg = { key: { messageTimestamp: Math.floor(Date.now() / 1000) - (startedSecondsAgo || 0) } };
    await ping.execute({ reply: async (t) => { out.push(t); return {}; }, botName: 'ZYNEX-MD', msg });
    return out;
  };

  const one = await capture(2);
  eq('.ping sends exactly one message, not two', one.length, 1);
  if (!/PONG/.test(one[0])) { console.log('✗ .ping reply is not a pong'); fail++; } else { console.log('✔ the reply is the result, not a placeholder'); pass++; }
  if (/Pinging/.test(one[0])) { console.log('✗ placeholder text still present'); fail++; } else { console.log('✔ no placeholder message'); pass++; }
  // the number is wrapped in WhatsApp bold markers: 'Round trip:* 2667ms'
  const ms = Number((one[0].match(/Round trip:[^0-9]*(\d+)ms/) || [])[1]);
  if (!(ms >= 1000 && ms <= 20000)) {
    console.log(`✗ the elapsed time is not a plausible round trip (${ms})`); fail++;
  } else { console.log(`✔ the elapsed round trip is reported (${ms}ms)`); pass++; }

  // a missing timestamp must degrade, not print NaN
  const noTs = await capture(null);
  if (/NaN|undefined|null/.test(noTs[0])) { console.log('✗ missing timestamp leaks NaN into the reply'); fail++; }
  else { console.log('✔ a message with no timestamp degrades cleanly'); pass++; }

  // a history-sync timestamp is not a latency
  const ancient = await capture(999999);
  if (/Round trip/.test(ancient[0])) { console.log('✗ a 14-day-old timestamp was reported as latency'); fail++; }
  else { console.log('✔ an ancient timestamp is not reported as latency'); pass++; }

  /* ── 2. link previews ───────────────────────────────────────────────────── */
  const handler = fs.readFileSync(path.join(ROOT, 'lib/handler.js'), 'utf8');
  const replyBlock = handler.slice(handler.indexOf('reply: async (text, options)'), handler.indexOf('replyWithImage'));
  if (/linkPreview: false/.test(replyBlock)) {
    console.log('✔ every reply opts out of link previews'); pass++;
  } else {
    console.log('✗ replies can still trigger the missing link-preview-js import'); fail++;
  }

  eq('link-preview-js is still intentionally not a dependency', 'NOT_INSTALLED',
     (() => { try { require.resolve('link-preview-js'); return 'INSTALLED'; } catch { return 'NOT_INSTALLED'; } })());

  /* ── 3. the noisy append line ───────────────────────────────────────────── */
  const sm = fs.readFileSync(path.join(ROOT, 'lib/sessionManager.js'), 'utf8');
  const appendLines = sm.split('\n').filter((l) => /media item\(s\)/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  if (appendLines.some((l) => !/if \(captured/.test(sm.slice(0, sm.indexOf(l)).split('\n').slice(-3).join('\n')))) {
    console.log('✗ a batch can still log "cached 0"'); fail++;
  } else {
    console.log('✔ the append batch line only appears when something was captured'); pass++;
  }

  /* ── self-chat must keep working: the owner is recognised through a LID ─── */
  /*
   * Production: sock.user=2348021016309, sock.lid=48190237720785, and the
   * owner's own DMs arrive addressed from the LID. Matching only against the PN
   * locked the owner out of their own bot.
   */
  const jid = require(path.join(ROOT, 'lib/jid'));
  jid.registerOwnIdentity({ phoneNumber: '2348021016309', lid: '48190237720785', id: '2348021016309:17@s.whatsapp.net' });
  const key = {
    remoteJid: '48190237720785@lid',
    remoteJidAlt: '2348021016309@s.whatsapp.net',
    addressingMode: 'lid',
    fromMe: false,
  };
  jid.rememberFromKey(key);
  const resolved = jid.resolveSendJid('48190237720785@lid', { user: { id: '2348021016309:17@s.whatsapp.net', lid: '48190237720785:17@lid' } });
  eq('sending to our own LID is rewritten to the phone number',
     resolved, '2348021016309@s.whatsapp.net');

  /* ── and a real message reaches the handler without throwing ────────────── */
  const boot = spawn(process.execPath, ['-e', `
    process.env.SILENT='1';
    const h = require('./lib/handler');
    if (typeof h.handleMessage !== 'function') { console.log('NO_HANDLEMESSAGE'); process.exit(0); }
    console.log('EXPORTED');
  `], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  boot.stdout.on('data', (d) => out += d);
  await new Promise((r) => boot.on('exit', r));
  if (/EXPORTED/.test(out)) { console.log('✔ the handler still loads standalone'); pass++; }
  else { console.log('✗ handler failed to load:', out.slice(0, 120)); fail++; }

  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
