/**
 * ★ Can somebody fork this, rename it, and redeploy without touching the panel?
 *
 * That is the whole point of this test. A fork-er should never open a source
 * file. They set BOT_NAME and they are done.
 *
 * But the danger is the opposite of convenience: a rename that leaks into the
 * panel — a hardcoded path, a cached module, a wrong relative require — and the
 * pairing page stops working. So this boots the real server with a foreign bot
 * name and password, and asserts the panel still answers.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`✔ ${name}`); pass++; }
  catch (e) { console.log(`✗ ${name}  ${e.message}`); fail++; }
};
const get = (port, p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p, timeout: 8000 }, (r) => {
    let b = ''; r.on('data', d => b += d); r.on('end', () => res({ code: r.statusCode, body: b }));
  }).on('error', rej).on('timeout', function () { this.destroy(rej(new Error('timeout'))); });
});

// who does the fork-er pretend to be?
const FOREIGN = { BOT_NAME: 'AZURE-MD', OWNER_NAME: 'ALICE', SITE_PASSWORD: 'alice-own-password', PORT: '39871' };

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

t('a fork-er never has to open a source file', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); continue; }
      if (!f.endsWith('.js')) continue;
      if (f === 'botInfo.js') continue;
      const code = strip(fs.readFileSync(p, 'utf8'));
      for (const line of code.split('\n')) {
        if (!/ZYNEX/.test(line)) continue;
        if (/RUTH-BOT-TECH/.test(line)) continue;   // a URL, not a name
        if (/'[^']*ZYNEX[^']*'/.test(line) || /`[^`]*ZYNEX[^`]*`/.test(line)) {
          offenders.push(`${path.relative(ROOT, p)}: ${line.trim().slice(0, 60)}`);
        }
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  walk(path.join(ROOT, 'public'));
  if (offenders.length) throw new Error('still hardcoded:\n  ' + offenders.join('\n  '));
});

t('the bot name has exactly one source of truth', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'node_modules') walk(p); continue; }
      const src = fs.readFileSync(p, 'utf8');
      // a *definition* is `const X = process.env.BOT_NAME || ...`, not a read
      if (f.endsWith('.js') && f !== 'botInfo.js' && /const\s+\w+\s*=\s*process\.env\.BOT_NAME\s*\|\|/.test(src)) {
        files.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'lib'));
  if (files.length) throw new Error('duplicate BOT_NAME definitions: ' + files.join(', '));
});


const boot = (env, ms = 12000) => new Promise(async (res) => {
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (env.PORT) { try { await get(env.PORT, '/api/status'); break; } catch {} }
    else if (/SILENT|SESSION_ID|waiting/i.test(log) && log.length > 200) break;
    await new Promise(r => setTimeout(r, 300));
  }
  res({ child, log: () => log, kill: () => child.kill('SIGKILL') });
});

(async () => {
  /* ── 1. panel mode (premium access-code users) ──────────────────────────
     The panel is the thing that must never break. It runs on a host with no
     HTTP at all, so we assert on what it prints and that it stays alive. */
  const panel = await boot({ ...FOREIGN, PANEL_MODE: '1', SESSION_ID: '' }, 9000);

  t('panel mode starts under a foreign bot name', () => {
    if (!/AZURE-MD/.test(panel.log())) throw new Error('banner did not use the foreign name:\n' + panel.log().slice(-300));
  });
  t('panel points at a pairing site that exists (not a dead domain)', () => {
    const m = panel.log().match(/Pairing site:\s*(\S+)/);
    if (!m) throw new Error('panel did not print a pairing site');
    if (/onrender\.com/.test(m[1])) throw new Error('still pointing at the dead onrender host: ' + m[1]);
    if (!/railway\.app|localhost/.test(m[1])) throw new Error('unexpected host: ' + m[1]);
  });
  t('panel prints the session format it actually accepts', () => {
    const m = panel.log().match(/Format:\s*(\S+)/);
    if (!m) throw new Error('panel did not print a session format');
    if (/zynex-md:/.test(m[1]) && !/azuremd/.test(m[1])) throw new Error('still our prefix: ' + m[1]);
  });
  t('panel mode does not crash on startup', () => {
    if (/\[FATAL\]/.test(panel.log())) throw new Error('crashed:\n' + panel.log().slice(-400));
  });
  panel.kill();

  /* ── 2. pairing site (the public panel) ─────────────────────────────────
     Same code, same files — a rename must not take the site down. */
  const site = await boot({ ...FOREIGN, PANEL_MODE: '0' }, 12000);
  let status;
  try { status = await get(FOREIGN.PORT, '/api/status'); } catch (e) { status = null; }

  t('pairing site still answers HTTP after the rename', () => {
    if (!status) throw new Error('no response:\n' + site.log().slice(-300));
    if (status.code !== 200) throw new Error('status ' + status.code);
  });
  t('pairing site does not leak our name into the panel', () => {
    if (!status) throw new Error('no response');
    const s = status.body.replace(/RUTH-BOT-TECH\/ZYNEX/g, '');
    if (/ZYNEX/.test(s)) throw new Error('panel leaked our name: ' + s.slice(0, 120));
  });
  let page = null;
  try { page = await get(FOREIGN.PORT, '/'); } catch {}
  t('pairing page still renders after the rename', () => {
    if (!page) throw new Error('page did not load');
    if (!/<!doctype html/i.test(page.body)) throw new Error('not html');
    if (!page.body.includes('id="repoLink"')) throw new Error('star widget missing');
  });

  /* ── the panel itself is the same product ────────────────────────────────
     A fork-er should get a panel that looks and works exactly like this one,
     with their name on it. Not a stripped copy, not a different page. */
  t('a fork-er gets the identical panel, not a stripped copy', () => {
    if (!page) throw new Error('page did not load');
    const mine = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    if (page.body.length !== mine.length) throw new Error('served page differs from the file on disk');
    for (const id of ['repoLink', 'brandTitle', 'brandSub', 'brandCredit', 'ses-card']) {
      if (!page.body.includes(`id="${id}"`)) throw new Error(`panel is missing #${id}`);
    }
  });

  t('the panel renames itself from /api/status, not from the source', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    if (!/function\s+paintBrand/.test(html)) throw new Error('no paintBrand()');
    if (!/paintBrand\(\s*d\s*&&\s*d\.botName\s*\)/.test(html)) throw new Error('paintBrand is not fed the API name');
    // and the endpoint it reads must actually carry the name
    if (!status) throw new Error('no status payload to check');
    let j = {};
    try { j = JSON.parse(status.body); } catch { throw new Error('status not JSON'); }
    if (!j.botName) throw new Error('/api/status does not expose botName');
    if (/ZYNEX/.test(j.botName)) throw new Error('status still reports our name: ' + j.botName);
    if (j.botName !== 'AZURE-MD') throw new Error('status reports the wrong name: ' + j.botName);
  });
  site.kill();

  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
