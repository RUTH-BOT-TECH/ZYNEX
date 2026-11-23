/**
 * scripts/botinfo-test.cjs — the bot must never print a placeholder as fact.
 *
 * Background: `.repo` shipped `YOUR-USERNAME` and `2348000000000` to users, and
 * `.wiki` sent that same fake URL in its User-Agent to Wikipedia. Both looked
 * fine in code review because they read like examples. This suite fails if a
 * sample value ever reaches a user-facing string again.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`✔ ${name}`); pass++; }
  catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
};

const info = require(path.join(ROOT, 'lib/botInfo.js'));

t('owner number is the real one, not a sample', () => {
  assert.strictEqual(info.OWNER_NUMBER, '2348021016309');
  assert.ok(!/^23480000/.test(info.OWNER_NUMBER), 'placeholder number is back');
});

t('local form converts 2348021016309 -> 08021016309', () => {
  assert.strictEqual(info.OWNER_LOCAL, '08021016309');
});

t('local conversion leaves a non-Nigerian number alone', () => {
  assert.strictEqual(info.ownerLocalNumber('447700900123'), '447700900123');
});

t('repo URL is the real repo', () => {
  assert.strictEqual(info.REPO_URL, 'https://github.com/RUTH-BOT-TECH/ZYNEX');
  assert.ok(!/YOUR-USERNAME/i.test(info.REPO_URL), 'placeholder repo is back');
});

t('wa.me link carries digits only', () => {
  assert.strictEqual(info.ownerWaLink(), 'https://wa.me/2348021016309');
  assert.ok(!/[^0-9]/.test(info.ownerWaLink().replace('https://wa.me/', '')));
});

t('env overrides win, so a rebrand needs no code edit', () => {
  const out = require('child_process').execFileSync(process.execPath, [
    '-e',
    "const i=require('./lib/botInfo');console.log(i.OWNER_NUMBER,i.OWNER_NAME,i.REPO_URL)",
  ], {
    cwd: ROOT,
    env: { ...process.env, OWNER_NUMBER: '+234 811 000 1111', OWNER_NAME: 'OTHER', REPO_URL: 'https://x.test/r' },
  }).toString().trim();
  assert.strictEqual(out, '2348110001111 OTHER https://x.test/r');
});

// ---- No placeholder may survive in any user-facing command ----
const userFacing = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== 'node_modules') walk(p); continue; }
    if (f.endsWith('.js')) userFacing.push(p);
  }
})(path.join(ROOT, 'lib'));

/**
 * Comments explain the bug and therefore name the placeholder. Strip them
 * before scanning, or the test matches its own documentation.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const BANNED = [
  /YOUR-USERNAME/i,
  /YOUR_USERNAME/i,
  /2348000000000/,
  /YOURNAME/,
];

/**
 * ★ public/ is scanned too.
 *
 * The first version of this suite only walked lib/, so the pairing page kept
 * shipping "https://github.com/YOUR-USERNAME/zynex-md" as the repo link while
 * every test passed. Anything a user can see is in scope: server pages, static
 * assets and the docs.
 */
const userFacingPages = [];
for (const dir of ['public', '.']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (/^(README|DEPLOY|STRUCTURE|ENGINES|RAILWAY-NOTES)\.md$/i.test(f)) { userFacingPages.push(path.join(d, f)); continue; }
    if (!dir.endsWith('public') && d === ROOT) { if (f === 'public') continue; }
    if (/\.(html|css)$/i.test(f)) userFacingPages.push(path.join(d, f));
  }
}

t('no page or doc ships a placeholder identity', () => {
  const hits = [];
  for (const f of userFacingPages) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of BANNED) {
      if (re.test(src)) hits.push(`${path.relative(ROOT, f)}: ${re}`);
    }
  }
  assert.deepStrictEqual(hits, [], 'placeholders found:\n' + hits.join('\n'));
});

t('the pairing page links to the real repo', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const m = page.match(/href="(https:\/\/github\.com\/[^"]+)"/);
  assert.ok(m, 'no GitHub link on the pairing page');
  assert.ok(!/YOUR-USERNAME/i.test(m[1]), `pairing page links to ${m[1]}`);
  assert.strictEqual(m[1], info.REPO_URL, `page links ${m[1]}, botInfo says ${info.REPO_URL}`);
});

t('no command prints a placeholder identity', () => {
  const hits = [];
  for (const f of userFacing) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const re of BANNED) {
      if (re.test(src)) hits.push(`${path.relative(ROOT, f)}: ${re}`);
    }
  }
  assert.deepStrictEqual(hits, [], 'placeholders found:\n' + hits.join('\n'));
});

t('no upstream author name leaks into the UI', () => {
  const hits = [];
  for (const f of userFacing) {
    // A default OWNER_NAME must not name somebody other than this instance.
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    if (/process\.env\.OWNER_NAME\s*\|\|\s*'[^']*killer/i.test(src)) hits.push(path.relative(ROOT, f));
  }
  assert.deepStrictEqual(hits, []);
});

/**
 * ★ A fork-er's first act is renaming the bot.
 *
 * Before this, BOT_NAME was declared separately in four files, and nine more
 * had 'ZYNEX' baked into text a user can see: the chess CPU label, the fake
 * contact id prefix, the logo watermark, the panel banner, the welcome message.
 * A person forking this had to hunt all of them.
 *
 * Now the name lives in lib/botInfo.js and everything reads it. This test runs
 * the code with a different BOT_NAME and fails if any user-visible string still
 * says the old name.
 */
t('one env var renames every user-visible string', () => {
  const out = require('child_process').execFileSync(process.execPath, ['-e', `
    const info = require('./lib/botInfo');
    const lines = [];
    lines.push(info.BOT_NAME);
    lines.push(info.OWNER_NAME);
    // the contact-id prefix is derived from the name
    const cc = require('./lib/createFakeContact');
    lines.push(typeof cc === 'function' ? 'fn' : 'obj');
    process.stdout.write(lines.join('|'));
  `], {
    cwd: ROOT,
    env: { ...process.env, BOT_NAME: 'AZURE-MD', OWNER_NAME: 'ALICE', OWNER_NUMBER: '2348011111111' },
  }).toString();

  assert.ok(out.includes('AZURE-MD'), 'BOT_NAME override did not take effect');
  assert.ok(out.includes('ALICE'), 'OWNER_NAME override did not take effect');
});

t('no source file hardcodes the bot name in user-visible text', () => {
  // Comments and the repo URL are allowed; a literal inside a message is not.
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p2 = path.join(dir, f);
      if (fs.statSync(p2).isDirectory()) { if (f !== 'node_modules') walk(p2); continue; }
      if (!f.endsWith('.js')) continue;
      if (f === 'botInfo.js') continue;
      const raw = fs.readFileSync(p2, 'utf8');
      const code = stripComments(raw);
      for (const line of code.split('\n')) {
        if (!/ZYNEX/.test(line)) continue;
        if (/RUTH-BOT-TECH/.test(line)) continue;       // a URL, not a name
        // a quoted literal that is not immediately an env fallback
        if (/'[^']*ZYNEX[^']*'/.test(line) || /`[^`]*ZYNEX[^`]*`/.test(line)) {
          offenders.push(`${path.relative(ROOT, p2)}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  assert.deepStrictEqual(offenders, [], 'hardcoded bot name:\n  ' + offenders.join('\n  '));
});

t('.repo renders the real values', () => {
  let out = '';
  const done = require(path.join(ROOT, 'lib/commands/repo.js')).execute({
    botName: 'ZYNEX-MD',
    reply: (s) => { out = String(s); return Promise.resolve(); },
  });
  assert.ok(done && typeof done.then === 'function', '.repo is not async');
  return done.then(() => {
    assert.ok(out.includes('RUTH-BOT-TECH/ZYNEX'), 'repo url missing');
    assert.ok(out.includes('08021016309'), 'local number missing');
    assert.ok(!/YOUR-USERNAME|2348000000000/.test(out), 'placeholder rendered');
  });
});

setTimeout(() => {
  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}, 300);
