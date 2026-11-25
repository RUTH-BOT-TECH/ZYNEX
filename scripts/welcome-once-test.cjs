/**
 * scripts/welcome-once-test.cjs — the welcome banner is a FIRST-PAIRING event.
 *
 * Live Railway logs, 5.5-hour window:
 *   15 socket closes — 11x code 500 "Stream Errored (ack)", 4x 428
 *   "Connection Terminated" — each followed by a 3s reconnect, a fresh
 *   `connection: 'open'`, `[SEND] self-send` and
 *   `[SESSION ...] Welcome message sent with banner`.
 *
 * The banner uses menu-banner.png — the same image `.menu` sends — so the
 * owner saw a "menu" every ~50 minutes without typing anything. There was no
 * process restart, no [BOOT], no [EXIT], no .menu command, no .restart, no
 * 401, no conflict. Only the WhatsApp websocket was being replaced.
 *
 * This suite locks the fix: a new pairing gets exactly one banner; a boot
 * restore or an auto-reconnect gets none.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sm = src('lib/sessionManager.js');
const pkg = JSON.parse(src('package.json'));

let passed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('\n══ welcome banner: once on a new pairing, never on reconnect ══\n');

t('startSocket accepts a skipWelcome option', () => {
  assert.match(sm, /async function startSocket\(sessionId, phoneNumber, authFolder, options = \{\}\)/);
  assert.match(sm, /let welcomeSent = false;/);
});

t('the open handler is guarded, not an unconditional send', () => {
  assert.match(sm, /if \(!options\.skipWelcome && !welcomeSent\)/);
  assert.ok(
    !/await sendConnectionMessage\(sessionId, phoneNumber, user\);/.test(sm),
    'an unguarded 3-argument welcome call is still present',
  );
  assert.match(sm, /welcomeSent = true;/);
  assert.match(sm, /await sendConnectionMessage\(sessionId, phoneNumber, user, sock\);/);
});

t('a duplicate open event on the same socket cannot re-send', () => {
  const guard = sm.indexOf('if (!options.skipWelcome && !welcomeSent)');
  const send = sm.indexOf('await sendConnectionMessage(', guard);
  assert.ok(guard !== -1 && send > guard, 'send is outside the guard');
  const block = sm.slice(guard, sm.indexOf('} else {', guard));
  assert.match(block, /welcomeSent = true;/);
  assert.match(sm.slice(send), /Welcome banner skipped/);
});

t('boot restores pass skipWelcome: true', () => {
  const at = sm.indexOf('async function reconnectAllSessions()');
  const body = sm.slice(at, sm.indexOf('\n/**\n * Get a session by phone number', at));
  assert.match(body, /startSocket\(dbSession\.id, dbSession\.phoneNumber, dbSession\.authFolder, \{ skipWelcome: true \}\)/);
  assert.ok(!/startSocket\(dbSession\.id, dbSession\.phoneNumber, dbSession\.authFolder\);/.test(body));
});

t('auto-reconnect after a transient close passes skipWelcome: true', () => {
  const at = sm.indexOf('Reconnecting in ${delay/1000}s');
  const body = sm.slice(at, at + 900);
  assert.match(body, /startSocket\(sessionId, phoneNumber, authFolder, \{ skipWelcome: true \}\)/);
});

t('codes 500 / 428 / 515 are all treated as transient reconnects', () => {
  assert.match(sm, /statusCode === 515 \? 5000 : 3000/);
  assert.match(sm, /Other close reasons \(515, 428, network blip, etc\.\)/);
});

t('a genuinely new pairing still gets the banner', () => {
  const at = sm.indexOf('async function createSession(phoneNumber)');
  const body = sm.slice(at, sm.indexOf('async function startSocket(', at));
  assert.match(body, /const sock = await startSocket\(sessionId, phoneNumber, authFolder\);/);
  assert.ok(!/skipWelcome/.test(body), 'createSession must not skip the welcome');
});

t('restartInPlace goes through reconnectAllSessions (no fresh banner)', () => {
  const at = sm.indexOf('async function restartInPlace(');
  assert.ok(at !== -1, 'restartInPlace missing');
  const body = sm.slice(at, sm.indexOf('\n/**', at + 10));
  assert.match(body, /reconnectAllSessions\(\)/);
});

t('panel mode also sends its CONNECTED banner only once', () => {
  const pb = src('lib/panelBot.js');
  assert.match(pb, /let connectedBannerSent = false;/);
  assert.match(pb, /if \(!connectedBannerSent\)/);
  assert.match(pb, /connectedBannerSent = true;/);
  assert.match(pb, /CONNECTED banner skipped \(reconnected socket\)/);
  const guard = pb.indexOf('if (!connectedBannerSent)');
  // The payload may also carry linkPreview:false; what matters is that the
  // send sits inside the once-only guard.
  const send = pb.indexOf('sock.sendMessage(user.id, { text: connectedBanner()', guard);
  assert.ok(guard !== -1 && send > guard, 'panel banner is outside its guard');
  assert.match(pb, /text: connectedBanner\(\), linkPreview: false/);
});

t('sendConnectionMessage uses the socket that emitted open', () => {
  assert.match(sm, /async function sendConnectionMessage\(sessionId, phoneNumber, user, sockOverride\)/);
  assert.match(sm, /const sock = sockOverride \|\| s\?\.sock;/);
  assert.match(sm, /Welcome skipped: no live socket/);
  const start = sm.indexOf('async function sendConnectionMessage(');
  const end = sm.indexOf('\n/**\n * Schedule idle cleanup', start);
  const body = sm.slice(start, end);
  assert.ok(!/s\.sock\.sendMessage/.test(body), 'still sending on the stale in-memory socket');
  assert.strictEqual((body.match(/sock\.sendMessage/g) || []).length, 3);
});

t('the welcome message itself still ships the banner and the .menu hint', () => {
  const start = sm.indexOf('async function sendConnectionMessage(');
  const body = sm.slice(start, sm.indexOf('\n/**\n * Schedule idle cleanup', start));
  assert.match(body, /menu-banner\.png/);
  assert.match(body, /Type \*\$\{prefix\}menu\*/);
  assert.match(body, /Welcome message sent with banner/);
});

t('the regression suite is part of test:all', () => {
  assert.strictEqual(pkg.scripts['test:welcome-once'], 'node scripts/welcome-once-test.cjs');
  assert.match(pkg.scripts['test:all'], /npm run test:welcome-once/);
});

console.log(`\n✔ ${passed}/12 passed\n`);
