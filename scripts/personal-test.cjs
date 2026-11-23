/**
 * scripts/personal-test.cjs — saved data must survive, and say so when it cannot.
 *
 * The bug this suite exists to prevent: economy.js writes to /app/data, which
 * is NOT the Railway volume, so balances silently reset on every deploy. A
 * fresh boot looks exactly like a wiped one, which is why it survived so long.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');

// Point the store at a scratch dir before requiring, so tests never touch real data.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-personal-'));
process.env.DATA_DIR = SCRATCH;
for (const f of fs.readdirSync(SCRATCH)) fs.unlinkSync(path.join(SCRATCH, f));

const engine = require(path.join(ROOT, 'lib/engines/personal.js'));
const I = engine._internal;

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('store resolves to DATA_DIR when set', () => {
  assert.strictEqual(I.dataDir(), SCRATCH);
  assert.strictEqual(I.DATA_FILE, path.join(SCRATCH, 'personal.json'));
});

t('store prefers the mounted volume over the repo directory', () => {
  // Simulate the Railway layout: AUTH_DIR_ROOT exists and is writable.
  const out = require('child_process').execFileSync(process.execPath, ['-e', `
    delete process.env.DATA_DIR;
    process.env.AUTH_DIR_ROOT = ${JSON.stringify(SCRATCH)};
    const i = require('./lib/engines/personal.js')._internal;
    console.log(i.dataDir());
  `], { cwd: ROOT, env: { ...process.env, DATA_DIR: '' } }).toString().trim();
  assert.strictEqual(out, SCRATCH);
});

t('a bare number of minutes parses', () => {
  assert.strictEqual(I.parseDuration('5'), 300000);
});

t('compound durations add up', () => {
  assert.strictEqual(I.parseDuration('1h30m'), 5400000);
  assert.strictEqual(I.parseDuration('2h45m30s'), 9930000);
});

t('an unreadable duration returns null, not a default', () => {
  // Defaulting to e.g. 10 minutes would set a reminder the user never asked for
  assert.strictEqual(I.parseDuration('soon'), null);
  assert.strictEqual(I.parseDuration(''), null);
  assert.strictEqual(I.parseDuration('-5m'), null);
});

t('humanDuration renders the same units back', () => {
  assert.strictEqual(I.humanDuration(5400000), '1h 30m');
  assert.strictEqual(I.humanDuration(90000), '1m 30s');
});

/* ── behaviour through the real engine entry point ────────── */
async function run(command, argString, extra = {}) {
  let said = null;
  await engine.execute({
    command,
    args: String(argString || '').split(' ').filter(Boolean),
    argString: String(argString || ''),
    reply: (t2) => { said = typeof t2 === 'string' ? t2 : t2; return Promise.resolve(); },
    from: '2348000000001@s.whatsapp.net',
    senderJid: '2348000000001@s.whatsapp.net',
    ...extra,
  });
  return said;
}

t('bookmark stores and lists', async () => {
  await run('bookmark', 'https://github.com/RUTH-BOT-TECH/ZYNEX the repo');
  const list = await run('bookmarks', '');
  assert.ok(/the repo/.test(list), 'label missing from list');
  assert.ok(/ZYNEX/.test(list), 'url missing from list');
});

t('bookmark rejects a non-http string', async () => {
  const out = await run('bookmark', 'notaurl');
  assert.ok(/http/i.test(out), 'should mention http');
});

t('saved data is written to disk immediately', () => {
  assert.ok(fs.existsSync(I.DATA_FILE), 'no file written — data would not survive a restart');
  const raw = JSON.parse(fs.readFileSync(I.DATA_FILE, 'utf8'));
  assert.ok(raw.users['2348000000001'], 'user missing from the file on disk');
});

t('data reloads from disk in a fresh process', () => {
  const out = require('child_process').execFileSync(process.execPath, ['-e', `
    const i = require('./lib/engines/personal.js')._internal;
    const u = i._user('2348000000001@s.whatsapp.net');
    console.log(u.bookmarks.length);
  `], { cwd: ROOT, env: { ...process.env, DATA_DIR: SCRATCH } }).toString().trim();
  assert.strictEqual(out, '1', 'bookmarks did not survive a process restart');
});

t('todo and donetodo move an item to done', async () => {
  await run('todo', 'buy data');
  const before = await run('todos', '');
  assert.ok(/1 open/.test(before), `expected 1 open task, got: ${before}`);
  await run('donetodo', '1');
  const after = await run('todos', '');
  assert.ok(/0 open, 1 done/.test(after), `expected 0 open, got: ${after}`);
});

t('reminder is scheduled and listed', async () => {
  const out = await run('remind', '10m check the oven');
  assert.ok(/Reminder set/i.test(out), `not confirmed: ${out}`);
  const list = await run('reminders', '');
  assert.ok(/check the oven/.test(list));
});

t('a reminder time that cannot be read is refused, not guessed', async () => {
  const out = await run('remind', 'someday call mum');
  assert.ok(/can't read|can’t read/i.test(out), `should refuse: ${out}`);
});

t('delreminder cancels the right one', async () => {
  const before = await run('reminders', '');
  assert.ok(/check the oven/.test(before));
  await run('delreminder', '1');
  const after = await run('reminders', '');
  // The empty-state hint contains the words "check the oven" as an example, so
  // match the no-reminders sentence rather than the task name.
  assert.ok(/No reminders/i.test(after), 'reminder survived deletion');
});

t('a corrupt file warns instead of silently resetting', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-bad-'));
  fs.writeFileSync(path.join(bad, 'personal.json'), '{ this is not json');
  const res = require('child_process').spawnSync(process.execPath, ['-e', `
    require('./lib/engines/personal.js');
    console.log('loaded');
  `], { cwd: ROOT, env: { ...process.env, DATA_DIR: bad } });
  const said = res.stdout.toString() + res.stderr.toString();
  assert.ok(/loaded/.test(said), 'process did not survive a corrupt file');
  assert.ok(/unreadable/i.test(said), 'corrupt file was swallowed without a word');
});

t('reminders are delivered from the socket that actually runs', () => {
  /**
   * This is the assertion that would have caught the original mistake.
   *
   * server.js runs PANEL_MODE=0 -> sessionManager.js. lib/bot.js has its own
   * makeWASocket but is never started in production, so a ticker wired there
   * compiles, reviews cleanly, and never fires.
   */
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const usesPanel = /PANEL_MODE\s*===\s*'0'/.test(server)
    && /require\('\.\/lib\/sessionManager'\)|start\(\)/.test(server);
  assert.ok(usesPanel, 'server.js entry logic changed — re-check which socket is live');

  const live = fs.readFileSync(path.join(ROOT, 'lib/sessionManager.js'), 'utf8');
  assert.ok(/startReminderTicker/.test(live), 'reminder ticker is not wired into the live socket path');
  assert.ok(/sock\.sendMessage/.test(live), 'no delivery call on the live path');

  const dead = fs.readFileSync(path.join(ROOT, 'lib/bot.js'), 'utf8');
  const stripped = dead.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/startReminderTicker/.test(stripped), 'ticker was wired into bot.js, which never runs in production');
});

t('the live path guards against a stale socket closure', () => {
  const live = fs.readFileSync(path.join(ROOT, 'lib/sessionManager.js'), 'utf8');
  assert.ok(/catch\s*\(e\)\s*\{[^}]*REMIND/i.test(live) || /\[REMIND\] could not start/.test(live),
    'a failure to start the ticker would be silent');
});

t('every claimed command replies, never silence', async () => {
  for (const name of engine.extraNames) {
    const out = await run(name, '');
    assert.ok(out !== null, `${name} produced no reply`);
  }
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`✔ ${name}`); pass++; }
    catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
  }
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
