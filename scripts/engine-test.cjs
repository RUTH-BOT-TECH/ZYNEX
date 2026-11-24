/**
 * Engine test — proves the dynamic registry actually runs commands.
 *   node scripts/engine-test.cjs
 */
const registry = require('../lib/registry');

let pass = 0;
const fails = [];
const out = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; out.push(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fails.push({ name, detail }); out.push(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
}

const sent = [];
const ctx = (args = []) => ({
  args, argString: args.join(' '), command: '', category: '',
  sender: '2348021016309@s.whatsapp.net',
  from: '120363000000000000@g.us',
  msg: { key: { remoteJid: '120363000000000000@g.us' }, message: {} },
  m: { message: {} },
  sock: {
    sendMessage: async (j, c) => { sent.push(c); return {}; },
  },
  reply: async (t) => { sent.push({ text: String(t) }); return {}; },
  prefix: '.',
});

async function run(cmdName, args = []) {
  sent.length = 0;
  const entry = registry.get(cmdName);
  if (!entry) return { ok: false, reason: 'not registered' };
  try {
    await entry.execute({ ...ctx(args), command: cmdName });
    return { ok: true, output: sent.map((s) => s.text || `[${Object.keys(s).join(',')}]`).join('\n') };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

(async () => {
  console.log(`\n\x1b[1mZYNEX-MD — engine test\x1b[0m\n`);
  console.log(`registry: ${registry.stats.total} names · ${registry.stats.bySource.engine} engine-backed · ${registry.stats.bySource.fallback} fallback\n`);

  console.log('\x1b[1mText engine\x1b[0m');
  for (const [cmd, input, expect] of [
    ['bold', ['hello'], '𝗵𝗲𝗹𝗹𝗼'],
    ['italic', ['hello'], null],
    ['fraktur', ['zynex'], null],
    ['circle', ['abc'], 'ⓐⓑⓒ'],
    ['smallcaps', ['zynex'], 'ᴢʏɴᴇx'],
    ['upside', ['hello'], null],
    ['strikethrough', ['text'], null],
    ['binary', ['hi'], '011'],
    ['morse', ['sos'], '...'],
    ['backwards', ['abc'], 'cba'],
    ['mock', ['hello'], null],
    ['upper', ['abc'], 'ABC'],
    ['clap', ['a b'], '👏'],
  ]) {
    const r = await run(cmd, input);
    const ok = r.ok && r.output && (!expect || r.output.includes(expect));
    check(`.${cmd} "${input[0]}" → ${(r.output || r.reason || '').slice(0, 26)}`, ok, r.reason);
  }

  console.log('\n\x1b[1mEconomy engine\x1b[0m');
  // fresh identity so cooldowns from a previous run can't mask failures
  const ECON_USER = `test${Date.now()}@s.whatsapp.net`;
  const econCtx = (args = []) => ({ ...ctx(args), sender: ECON_USER });
  const runEcon = async (cmd, args = []) => {
    sent.length = 0;
    const entry = registry.get(cmd);
    if (!entry) return { ok: false, reason: 'not registered' };
    try {
      await entry.execute({ ...econCtx(args), command: cmd });
      return { ok: true, output: sent.map((x) => x.text || '').join('\n') };
    } catch (e) { return { ok: false, reason: e.message }; }
  };
  {
    const r = await runEcon('balance');
    check('.balance shows wallet', r.ok && /Wallet/.test(r.output), r.reason);
  }
  {
    const r = await runEcon('daily');
    check('.daily credits coins', r.ok && /claimed|coins/i.test(r.output), r.reason);
  }
  {
    const r = await runEcon('work');
    check('.work pays out', r.ok && /coins/.test(r.output), r.reason);
  }
  {
    const r = await runEcon('shop');
    check('.shop lists items', r.ok && /pickaxe/.test(r.output), r.reason);
  }
  {
    const r = await runEcon('deposit', ['100']);
    check('.deposit moves money', r.ok && /Deposited/.test(r.output), r.reason);
  }
  {
    const r = await runEcon('leaderboard');
    check('.leaderboard renders', r.ok && r.output.length > 0, r.reason);
  }
  {
    const r = await runEcon('rank');
    check('.rank shows level bar', r.ok && /Level/.test(r.output), r.reason);
  }
  {
    const r = await runEcon('adopt', ['Rex', 'dog']);
    check('.adopt creates a pet', r.ok && /Adopted|costs/.test(r.output), r.reason);
  }

  console.log('\n\x1b[1mFun engine\x1b[0m');
  for (const c of ['joke', 'quote', 'fact', 'truth', 'dare', '8ball', 'roast', 'compliment', 'hug']) {
    const r = await run(c, ['test']);
    check(`.${c} responds`, r.ok && r.output.length > 0, r.reason);
  }
  {
    const r = await run('rate');
    check('.rate gives a deterministic score', r.ok && /\d+\/100/.test(r.output), r.reason);
  }
  {
    const r = await run('choose', ['tea, coffee']);
    check('.choose picks an option', r.ok && /(tea|coffee)/.test(r.output), r.reason);
  }

  console.log('\n\x1b[1mTools engine\x1b[0m');
  for (const [cmd, args, expect] of [
    ['calc', ['12*8+4'], '100'],
    ['calc', ['process.exit()'], null],
    ['base64', ['hi'], 'aGk='],
    ['sha256', ['abc'], 'ba7816bf'],
    ['morse', ['sos'], null],
    ['binary', ['A'], '01000001'],
    ['wordcount', ['one two three'], '3'],
    ['jsonformat', ['{"a":1}'], '"a"'],
    ['password', ['20'], null],
    ['uuid', [], null],
    ['time', [], null],
    ['sysinfo', [], 'Node'],
  ]) {
    const r = await run(cmd, args);
    const ok = r.ok && r.output && (!expect || r.output.includes(expect));
    check(`.${cmd} ${args.join(' ')}`.trim(), ok, r.reason || (r.output || '').slice(0, 40));
  }
  {
    const r = await run('calc', ['process.exit()']);
    check('.calc rejects code injection', r.ok && /Only (digits|numbers)/.test(r.output), r.reason);
  }

  console.log('\n\x1b[1mDownloader engine\x1b[0m');
  for (const c of ['ytsearch', 'yts']) {
    const r = await run(c, ['test query']);
    check(`.${c} searches`, r.ok, r.reason);
  }
  {
    const r = await run('ytmp4', ['test']);
    /*
     * ★ This used to demand the word "unavailable", because .ytmp4 genuinely
     * had no video path and said so. yt-dlp now resolves real videos (verified:
     * a 30:10 / 186 MB 480p file), so the old assertion failed against working
     * code and masked a pass as a defect.
     *
     * What still has to be true: it either returns a real video, or it explains
     * why not. Silent nothing is the only unacceptable outcome.
     */
    const realVideo = /⏱️\s*\d+:\d\d/.test(r.output) && /💾/.test(r.output);
    const honestNo = /unavailable|Cobalt|could not|no video/i.test(r.output);
    check('.ytmp4 returns a real video or says why not', r.ok && (realVideo || honestNo), r.reason || r.output.slice(0, 160));
  }
  {
    const r = await run('apk', ['test']);
    check('.apk gives guidance', r.ok && r.output.length > 0, r.reason);
  }

  console.log('\n\x1b[1mFallback honesty\x1b[0m');
  {
    const r = await run('tebakgambar');
    check('unimplemented catalogue name says so', r.ok && /isn't wired up|no implementation/.test(r.output), r.reason);
  }

  console.log('\n' + out.join('\n'));
  const total = pass + fails.length;
  console.log(`\n\x1b[1m${pass}/${total} passed\x1b[0m` + (fails.length ? `  \x1b[31m(${fails.length} failed)\x1b[0m` : '  \x1b[32m✔ all green\x1b[0m'));
  if (fails.length) { fails.forEach((f) => console.log(`  • ${f.name}: ${f.detail}`)); process.exit(1); }
})();
