#!/usr/bin/env node
/**
 * Retry receipts must be answerable.
 *
 * Production log, after getMessage was first wired:
 *
 *   [RETRY] requested 3EB06F97D8B5CB00DD7062 but it is not in the store
 *   [RETRY] requested 3EB0ED3E84D1EA84CFBBB6 but it is not in the store
 *
 * Both ids begin 3EB0 — they are ids of messages WE sent. A recipient that
 * cannot decrypt asks the sender to re-send the original, naming that outgoing
 * id. Only inbound messages were ever stored, so the lookup always missed and
 * the recipient's phone stayed on "Waiting for this message" forever.
 * (WhiskeySockets/Baileys#1701)
 *
 * The fix: generate the outgoing id ourselves and store the message under it,
 * so getMessage(key) can hand the exact bytes back.
 */
process.env.SILENT = '1';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

// isolate the JSON DB and auth dir before anything loads
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-retry-'));
process.env.AUTH_DIR_ROOT = path.join(tmp, 'auth_state');
process.env.DB_FILE = path.join(tmp, 'db.json');
fs.mkdirSync(process.env.AUTH_DIR_ROOT, { recursive: true });

const { storeMessage, getStoredMessage } = require(path.join(ROOT, 'lib', 'anti', 'antiDelete.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

console.log('\n══ the store answers by id ══\n');

t('an outgoing message can be stored and read back', () => {
  const outgoingId = '3EB0TEST0000000000000000000001';
  storeMessage({
    key: { id: outgoingId, remoteJid: '2348021016309@s.whatsapp.net', fromMe: true },
    message: { conversation: 'Pong! 🏓' },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  const back = getStoredMessage(outgoingId);
  assert.ok(back, 'getStoredMessage returned nothing for an outgoing id');
  assert.strictEqual(back.message.conversation, 'Pong! 🏓');
});

t('a retry for an unknown id returns null, not a throw', () => {
  assert.strictEqual(getStoredMessage('3EB0NEVERSEEN'), null);
});

t('getStoredMessage tolerates junk input', () => {
  assert.doesNotThrow(() => getStoredMessage(undefined));
  assert.strictEqual(getStoredMessage(undefined), null);
});

console.log('\n══ the socket stores what it sends ══\n');

t('sendMessage pins a messageId and records the message', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  // generation must happen for sends that do not already carry an id
  assert.ok(/generateMessageIDV2/.test(src), 'outgoing ids must be generated');
  // and the send must be recorded under that id
  assert.ok(/storeMessage\(\{[\s\S]{0,200}fromMe:\s*true/.test(src),
    'sent messages must be stored with fromMe:true so retries can be answered');
});

t('getMessage hands the stored message back', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  const block = src.slice(src.indexOf('getMessage:'), src.indexOf('getMessage:') + 600);
  assert.ok(/getStoredMessage/.test(block), 'getMessage must consult the store');
  assert.ok(/return stored\.message/.test(block), 'it must return the message itself');
});

console.log('\n══ simulate the production retry ══\n');

t('a 3EB0 outgoing id that was stored is served on retry', () => {
  const id = '3EB0ED3E84D1EA84CFBBB6';   // one of the ids from the live log
  storeMessage({
    key: { id, remoteJid: '2348021016309@s.whatsapp.net', fromMe: true },
    message: { extendedTextMessage: { text: '🤖 Pong!' } },
  });
  const served = getStoredMessage(id);
  assert.ok(served, 'the exact id from the failing production retry must resolve');
  assert.ok(served.message.extendedTextMessage.text.includes('Pong'));
});

t('the store evicts rather than growing without bound', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'anti', 'antiDelete.js'), 'utf8');
  assert.ok(/MAX_STORED/.test(src), 'an unbounded store is a memory leak');
});

console.log('\n══ self-send device refresh ══\n');

t('a self-send forces a fresh device list', () => {
  // Our own device id climbed :11 -> :12 -> :13 -> :14 in one session. Baileys
  // builds ONLY the deviceSentMessage copy for a self-send, addressed per device
  // id from a cache, so a stale entry means no fallback and a permanent
  // "Waiting for this message".
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  assert.ok(/useUserDevicesCache:\s*false/.test(src), 'must disable the device cache for self-sends');
  assert.ok(/self-send — forcing a fresh device list/.test(src), 'must log it');
});

t('the refresh is applied only to self-sends, not every send', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'sessionManager.js'), 'utf8');
  // it must be guarded by a comparison against our own id
  assert.ok(/bare\(target\) === meId/.test(src), 'unconditional cache-busting would be wasteful');
});

console.log('\n══ .vv on an unrecoverable stub ══\n');

t('.vv explains that an unrecoverable view-once is not a transient failure', () => {
  // The wording was rewritten when the stored-original lookup moved to the
  // front; the requirement is unchanged — the reply must not suggest "try
  // again later" for something that cannot come back.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'vv.js'), 'utf8');
  assert.ok(/quote arrived stripped|never received that view-once/i.test(src), 'must name the real situation');
  assert.ok(/nothing can recover it|nothing to unlock/i.test(src), 'must not imply a transient failure');
  assert.ok(/Nothing can recover it/i.test(src), 'must be honest about permanence');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
