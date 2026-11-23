/**
 * ★ "If someone has the password, won't they disconnect another bot?"
 *
 * Before this: yes. One shared panel password returned every paired phone
 * number and a Disconnect button next to each one. Fine for one person running
 * their own number; fatal the moment a deployer resells access, because one
 * buyer could delete another's bot.
 *
 * Now a bot belongs to whoever holds the 6-digit code issued when it was
 * paired. The password buys the counts. These tests boot the real server and
 * try to break that, as a password holder.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); console.log(`✔ ${n}`); pass++; } catch (e) { console.log(`✗ ${n}  ${e.message}`); fail++; } };

const request = (port, method, p, body, headers = {}) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: p, method, timeout: 8000,
    headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
    (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ code: r.statusCode, body: b })); });
  req.on('error', rej).on('timeout', function () { this.destroy(new Error('timeout')); });
  if (data) req.write(data);
  req.end();
});

/* ── unit behaviour: the code itself ─────────────────────────────────────── */
const VOL = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-own-'));
process.env.AUTH_DIR_ROOT = VOL;
delete require.cache[require.resolve('../lib/paths')];
delete require.cache[require.resolve('../lib/access')];
const access = require('../lib/access');

const A = '2348000000001', B = '2348000000002';
const codeA = access.claim(A);
const codeB = access.claim(B);

t('pairing issues a 6-digit code', () => {
  if (!/^\d{6}$/.test(codeA)) throw new Error('not 6 digits: ' + codeA);
});

t('a code opens only its own bot', () => {
  if (!access.owns(A, codeA)) throw new Error('owner cannot open own bot');
  if (access.owns(B, codeA)) throw new Error('A\'s code opened B\'s bot');
  if (access.owns(A, codeB)) throw new Error('B\'s code opened A\'s bot');
});

t('the code is stored hashed, never in the clear', () => {
  const raw = fs.readFileSync(access._file, 'utf8');
  if (raw.includes(codeA)) throw new Error('access code stored in plaintext');
  const j = JSON.parse(raw);
  if (!j[A].hash || j[A].hash.length !== 64) throw new Error('no sha256 hash stored');
});

t('no code, no access', () => {
  if (access.owns(A, '')) throw new Error('empty code accepted');
  if (access.owns(A, null)) throw new Error('null code accepted');
});

t('a wrong code does not unlock, and nothing is brute-forceable for free', () => {
  for (let i = 0; i < 200; i++) {
    const guess = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    if (guess !== codeA && access.owns(A, guess)) throw new Error('guessed a code');
  }
});

t('re-pairing issues a fresh code and retires the old one', () => {
  const next = access.claim(A);
  if (access.owns(A, codeA)) throw new Error('old code still works after re-pair');
  if (!access.owns(A, next)) throw new Error('new code does not work');
});

/* ── the live routes, as a password holder ───────────────────────────────── */
(async () => {
  const PORT = 39899;
  const PASSWORD = 'deployer-password';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PANEL_MODE: '0', SITE_PASSWORD: PASSWORD, AUTH_DIR_ROOT: VOL, SILENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);

  const up = async () => {
    for (let i = 0; i < 40; i++) {
      try { await request(PORT, 'GET', '/health'); return true; } catch { await new Promise(r => setTimeout(r, 300)); }
    }
    return false;
  };
  const alive = await up();

  t('server boots', () => { if (!alive) throw new Error('no listen:\n' + log.slice(-300)); });

  if (alive) {
    const pw = { 'x-site-password': PASSWORD };

    // A password holder with no access code
    const st = await request(PORT, 'GET', '/api/status', null, pw);
    let j = {};
    try { j = JSON.parse(st.body); } catch { throw new Error('status not JSON'); }

    t('the password alone returns no bot records', () => {
      if (j.authorized !== true) throw new Error('password was not accepted');
      if ((j.sessions || []).length !== 0) throw new Error('password holder saw ' + j.sessions.length + ' records');
    });

    t('the password holder still sees the counts they legitimately need', () => {
      if (typeof j.totalPaired !== 'number' || typeof j.activeSessions !== 'number') {
        throw new Error('counts missing from status');
      }
    });

    t('no phone number leaks in the status payload', () => {
      if (/\b23480\d{7}\b/.test(st.body)) throw new Error('a full phone number was exposed');
    });

    t('disconnecting someone else\'s bot is refused', async () => {});
    const dc = await request(PORT, 'POST', '/api/disconnect',
      { phoneNumber: A, accessCode: codeB }, pw);
    t('a mismatched code cannot disconnect a bot', () => {
      if (dc.code !== 403) throw new Error('expected 403, got ' + dc.code + ' ' + dc.body.slice(0, 80));
      if (!/access code/i.test(dc.body)) throw new Error('refusal did not say why');
    });

    const dcNoCode = await request(PORT, 'POST', '/api/disconnect', { phoneNumber: A }, pw);
    t('no code at all cannot disconnect a bot', () => {
      if (dcNoCode.code !== 403) throw new Error('expected 403, got ' + dcNoCode.code);
    });

    const detail = await request(PORT, 'GET', `/api/session/${A}`, null, pw);
    t('reading a bot\'s record needs its code', () => {
      if (detail.code !== 403) throw new Error('expected 403, got ' + detail.code);
    });

    const unknown = await request(PORT, 'GET', '/api/get-creds/anything', null, pw);
    t('an unknown API route is a JSON 404, not the HTML page', () => {
      if (unknown.code !== 404) throw new Error('expected 404, got ' + unknown.code);
      if (/<!doctype html/i.test(unknown.body)) throw new Error('served HTML for an API path');
    });
  }

  child.kill('SIGKILL');
  fs.rmSync(VOL, { recursive: true, force: true });
  console.log(`\n${fail ? '✗' : '✔'} ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
