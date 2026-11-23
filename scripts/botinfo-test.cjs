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
