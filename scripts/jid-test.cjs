#!/usr/bin/env node
/**
 * LID vs PN addressing.
 *
 * Every assertion here comes from a production symptom: the bot replied
 * instantly to other numbers but stalled forever in its own chat, showing
 * "Waiting for this message. This may take a while." while the log said
 * "✓ Command completed".
 *
 * Baileys decides a destination is "me" by comparing digits:
 *   const isMe = user === meUser      // LID digits vs PN digits — never equal
 * so replying to your own @lid makes the library treat your own account as a
 * stranger, and the usync device lookup finds no session.
 */
const assert = require('assert');
const jid = require('../lib/jid');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

const OWN_PN = '2348021016309';
const OWN_LID = '48190237720785';
const OWNER_LID = '46274514571441';

const sock = {
  user: {
    id: `${OWN_PN}:8@s.whatsapp.net`,
    lid: `${OWN_LID}@lid`,
  },
};

console.log('\n══ classification ══\n');

t('a LID is recognised', () => {
  assert.ok(jid.isLid(`${OWN_LID}@lid`));
  assert.ok(!jid.isLid(`${OWN_PN}@s.whatsapp.net`));
});

t('a PN is recognised', () => {
  assert.ok(jid.isPn(`${OWN_PN}@s.whatsapp.net`));
  assert.ok(!jid.isPn(`${OWN_LID}@lid`));
});

t('bare() strips server and device suffix', () => {
  assert.strictEqual(jid.bare(`${OWN_PN}:8@s.whatsapp.net`), OWN_PN);
  assert.strictEqual(jid.bare(`${OWN_LID}:3@lid`), OWN_LID);
  assert.strictEqual(jid.bare(undefined), '');
});

console.log('\n══ the self-chat stall ══\n');

t('our OWN @lid resolves to our PN — this is the bug that was stalling', () => {
  const out = jid.resolveSendJid(`${OWN_LID}@lid`, sock);
  assert.strictEqual(out, `${OWN_PN}@s.whatsapp.net`);
  assert.ok(jid.isPn(out), 'must be a PN or Baileys cannot see it is "me"');
});

t('a normal PN is left completely alone', () => {
  const pn = '2349165331115@s.whatsapp.net';
  assert.strictEqual(jid.resolveSendJid(pn, sock), pn);
});

t('a group JID is left alone', () => {
  const g = '120363424039452916@g.us';
  assert.strictEqual(jid.resolveSendJid(g, sock), g);
});

t("someone else's @lid is learned and then resolved to their PN", () => {
  jid.rememberFromKey({
    remoteJid: `${OWNER_LID}@lid`,
    senderPn: `2349165331115@s.whatsapp.net`,
  });
  assert.strictEqual(
    jid.resolveSendJid(`${OWNER_LID}@lid`, sock),
    '2349165331115@s.whatsapp.net',
  );
});

t('an unknown @lid is passed through rather than corrupted', () => {
  const unknown = '99999999999999@lid';
  assert.strictEqual(jid.resolveSendJid(unknown, sock), unknown);
});

t('works with no socket at all (does not throw)', () => {
  assert.strictEqual(jid.resolveSendJid(`${OWN_LID}@lid`, null), `${OWN_LID}@lid`);
});

console.log('\n══ device suffix — the actual stall ══\n');

t('a device-suffixed PN is stripped (this is what stalled in production)', () => {
  // sendConnectionMessage used `user.id` straight from creds, which is
  // 2348021016309:11@s.whatsapp.net. Baileys addresses device 11 only and the
  // phone waits forever.
  assert.strictEqual(
    jid.resolveSendJid('2348021016309:11@s.whatsapp.net', sock),
    '2348021016309@s.whatsapp.net',
  );
});

t('a device-suffixed own LID becomes our bare PN', () => {
  assert.strictEqual(
    jid.resolveSendJid('48190237720785:11@lid', sock),
    '2348021016309@s.whatsapp.net',
  );
});

t('stripDevice leaves groups alone', () => {
  assert.strictEqual(jid.stripDevice('120363424039452916@g.us'), '120363424039452916@g.us');
});

t('stripDevice leaves a bare JID alone', () => {
  assert.strictEqual(jid.stripDevice('2349165331115@s.whatsapp.net'), '2349165331115@s.whatsapp.net');
});

t('stripDevice tolerates junk', () => {
  assert.strictEqual(jid.stripDevice(null), null);
  assert.strictEqual(jid.stripDevice('nodomain'), 'nodomain');
});

console.log('\n══ learning from inbound keys ══\n');

t('participantPn teaches a group participant LID', () => {
  jid.rememberFromKey({
    remoteJid: '120363424039452916@g.us',
    participant: '11111111111111@lid',
    participantPn: '2347011223344@s.whatsapp.net',
  });
  assert.strictEqual(
    jid.resolveSendJid('11111111111111@lid', sock),
    '2347011223344@s.whatsapp.net',
  );
});

t('a key with no PN teaches nothing (no bogus mapping)', () => {
  const before = jid.lidToPn.size;
  jid.rememberFromKey({ remoteJid: '22222222222222@lid' });
  assert.strictEqual(jid.lidToPn.size, before);
});

t('rememberFromKey tolerates junk', () => {
  jid.rememberFromKey(null);
  jid.rememberFromKey({ remoteJid: 'x@s.whatsapp.net', senderPn: 'garbage' });
});

console.log('\n══ socket patching ══\n');

t('patchSocketSends rewrites the destination before sending', () => {
  const sent = [];
  const fake = { user: sock.user, sendMessage: (j, c, o) => { sent.push([j, c, o]); return 'ok'; } };
  jid.patchSocketSends(fake);
  const r = fake.sendMessage(`${OWN_LID}@lid`, { text: 'hi' }, {});
  assert.strictEqual(r, 'ok');
  assert.strictEqual(sent[0][0], `${OWN_PN}@s.whatsapp.net`);
  assert.deepStrictEqual(sent[0][1], { text: 'hi' }, 'content must pass through untouched');
});

t('patching twice does not double-wrap', () => {
  const fake = { user: sock.user, sendMessage: () => 'ok' };
  jid.patchSocketSends(fake);
  const wrapped = fake.sendMessage;
  jid.patchSocketSends(fake);
  assert.strictEqual(fake.sendMessage, wrapped);
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
