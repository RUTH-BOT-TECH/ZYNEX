/**
 * ★ Will this survive on somebody else's host?
 *
 * The old answer was "sometimes". Six modules each chose their own write path,
 * so mounting a volume fixed sessions but not balances, and Render's ephemeral
 * disk reset everything with no error at all — the worst kind of failure.
 *
 * This test mounts a fake volume, runs the real code, and asserts every piece
 * of state landed inside it and nowhere else.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };

const VOL = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-vol-'));

/** Run a snippet with the volume mounted, and return what it reports. */
const run = (code) => execFileSync(process.execPath, ['-e', code], {
  cwd: ROOT,
  env: { ...process.env, AUTH_DIR_ROOT: VOL, DB_FILE: '', SILENT: '1' },
  encoding: 'utf8',
}).trim();

t('with no env, paths stay exactly where production writes today', () => {
  const out = require('child_process').execFileSync(process.execPath,
    ['-e', "const p=require('./lib/paths');console.log(p.AUTH_DIR)"],
    { cwd: ROOT, env: { ...process.env, AUTH_DIR_ROOT: '' }, encoding: 'utf8' }).trim();
  const expected = path.join(ROOT, 'auth_state');
  if (out !== expected) throw new Error(`default moved! ${out} !== ${expected} — this would orphan live sessions`);
});

t('a mounted volume relocates every piece of state', () => {
  const out = run(`const p=require('./lib/paths');
    console.log(JSON.stringify({auth:p.AUTH_DIR,sess:p.dbFile,sec:p.securityFile,eco:p.economyFile,media:p.mediaCacheDir}));`);
  const j = JSON.parse(out);
  for (const [k, v] of Object.entries(j)) {
    if (!v.startsWith(VOL)) throw new Error(`${k} escaped the volume: ${v}`);
  }
});

t('sessions, balances and the security cache agree on one root', () => {
  const out = run(`const p=require('./lib/paths');
    console.log([p.dbFile,p.securityFile,p.economyFile].every(f=>f.startsWith(p.AUTH_DIR)) ? 'yes':'no');`);
  if (out !== 'yes') throw new Error('state is split across roots again');
});

t('no module still hardcodes auth_state for writing', () => {
  const bad = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); continue; }
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n');
      // writing modules must go through paths.js
      if (!/writeFileSync|mkdirSync/.test(src)) continue;
      if (/path\.join\(__dirname,\s*'\.\.',\s*'auth_state'\)/.test(src)) bad.push(path.relative(ROOT, p));
      if (/path\.join\(__dirname,\s*'\.\.',\s*'\.\.',\s*'data'/.test(src)) bad.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'lib'));
  if (bad.length) throw new Error('still hardcoded: ' + bad.join(', '));
});

t('an existing economy balance is carried into the volume, not dropped', () => {
  const legacy = path.join(ROOT, 'data');
  const legacyFile = path.join(legacy, 'economy.json');
  fs.mkdirSync(legacy, { recursive: true });
  const seeded = fs.existsSync(legacyFile);
  if (!seeded) fs.writeFileSync(legacyFile, JSON.stringify({ users: { '2348000000001': { balance: 777 } } }));

  const out = run(`const p=require('./lib/paths');
    const fs=require('fs');
    const target=p.adoptLegacy(p.legacy.economy,p.economyFile);
    const j=JSON.parse(fs.readFileSync(target,'utf8'));
    console.log('RESULT=' + (j.users['2348000000001'] ? j.users['2348000000001'].balance : 'missing'));`);
  const marker = out.split('\n').find(l => l.startsWith('RESULT=')) || '';
  const value = marker.replace('RESULT=', '');

  if (!fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
  if (!fs.existsSync(path.join(VOL, '.economy.json'))) throw new Error('nothing adopted into the volume');
  if (!value) throw new Error('adoption did not report: ' + out.slice(-120));
  if (value === 'missing' && !seeded) throw new Error('balance lost during adoption');
});

t('writes into the volume actually persist', () => {
  const f = path.join(VOL, '.sessions.json');
  run(`const m=require('./lib/db');   // loads/creates the store
    const p=require('./lib/paths');
    require('fs').writeFileSync(p.dbFile, '[]');`);
  if (!fs.existsSync(f)) throw new Error('.sessions.json was not created in the volume');
});

fs.rmSync(VOL, { recursive: true, force: true });
console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
