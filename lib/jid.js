'use strict';
/**
 * WhatsApp addressing: LID vs PN.
 *
 * A WhatsApp account has two identifiers:
 *   PN  2348021016309@s.whatsapp.net   — the phone number
 *   LID 48190237720785@lid             — a privacy alias (Linked ID), per account
 *
 * Inbound messages from LID-migrated accounts arrive with `remoteJid` set to the
 * LID. Replying to that LID verbatim is unreliable for the OWNER'S OWN CHAT,
 * because Baileys decides whether a destination is "me" like this
 * (node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js:412):
 *
 *     const isMe = user === meUser        // user = LID digits, meUser = PN digits
 *
 * Those never match, so a self-message addressed by LID is treated as a message
 * to a stranger. Baileys then resolves devices via a usync lookup, finds nothing
 * for a LID that was never mapped, and the send stalls — the phone shows
 * "Waiting for this message. This may take a while." while the log cheerfully
 * says "✓ Command completed".
 *
 * That is exactly why other numbers respond instantly and the bot's own number
 * does not: the other chats resolve to a real @s.whatsapp.net JID.
 *
 * The fix is to reply to the PN whenever we can work out what it is.
 */

const LID_SUFFIX = '@lid';
const PN_SUFFIX = '@s.whatsapp.net';

/** digits only, from any of: "123@s.whatsapp.net", "123:4@lid", "123" */
function bare(id) {
  return String(id || '').split('@')[0].split(':')[0];
}

function isLid(jid) {
  return typeof jid === 'string' && jid.endsWith(LID_SUFFIX);
}

function isPn(jid) {
  return typeof jid === 'string' && jid.endsWith(PN_SUFFIX);
}

/**
 * Cache of LID → PN, learned from inbound message keys.
 * Baileys puts both identifiers on every incoming message, so after any traffic
 * with a contact we know its PN and never have to send to a bare LID again.
 */
const lidToPn = new Map();

/**
 * Our OWN identities, learned from creds.json rather than from the socket.
 *
 * ★ `sock.user` does not carry `lid` in Baileys 6.7.24 — the live log shows
 * `sock.user=2348021016309:12@s.whatsapp.net sock.lid=-`. Relying on it meant
 * the own-LID check never matched and replies to our own chat went out as a
 * bare `48190237720785@lid`, which Baileys addresses as a stranger. Creds.json
 * DOES have it (`me.lid = 48190237720785:11@lid`), so register it from there.
 */
/**
 * Per-account own-identity map: Map<bareAccountId, Map<bareLid, pnJid>>
 *
 * ★ This was a single global Map, which is wrong the moment the server hosts
 * two sessions. In production the ZYNEX session (2349165331115) registered
 * RUTH's LID when replying to her — because registerOwnIdentity() was learning
 * "*this* LID resolves to that PN" for every address it saw — and then treated
 * RUTH as part of its own identity, rewriting her address to her PN. Her device
 * is keyed on the LID, so her replies stopped decrypting: "Waiting for this
 * message" on a chat that had been working perfectly.
 */
const ownIdentityByAccount = new Map();

/** The map for one account, creating it on first use. */
function ownMap(account) {
  const key = bare(account) || 'default';
  if (!ownIdentityByAccount.has(key)) ownIdentityByAccount.set(key, new Map());
  return ownIdentityByAccount.get(key);
}

/** Back-compat view used by tests: the default account's map. */
const ownLidToPn = ownMap('default');

function registerOwnIdentity({ phoneNumber, lid, id } = {}) {
  const pn = bare(id) || bare(phoneNumber);
  if (!pn) return;
  const pnJid = `${pn}${PN_SUFFIX}`;
  const map = ownMap(pn);
  // ONLY the lid belonging to this account. Never a candidate list: that is how
  // a peer's LID got recorded as "me" and rewritten, breaking their chat.
  if (isLid(lid)) map.set(bare(lid), pnJid);
  map.set(pn, pnJid);
}

/** Record what an inbound message taught us about a LID. */
function rememberFromKey(key) {
  if (!key) return;
  // senderPn / participantPn are the PN for whatever senderJid is.
  const pn = key.senderPn || key.participantPn || key.remoteJidAlt;
  if (!pn || !String(pn).includes('@')) return;
  const pnJid = String(pn).endsWith(PN_SUFFIX) ? String(pn) : bare(pn) + PN_SUFFIX;
  for (const candidate of [key.remoteJid, key.participant, key.senderLid, key.participantLid]) {
    if (isLid(candidate)) lidToPn.set(bare(candidate), pnJid);
  }
}

/**
 * Turn any JID into something safe to send to.
 *
 * Order of preference:
 *   1. not a LID            → unchanged
 *   2. it is OUR OWN lid    → our own PN (this is the self-chat case)
 *   3. we learned its PN    → that PN
 *   4. one of our own lids  → our own PN
 *   5. unknown              → unchanged (a LID that resolves to a real peer
 *                             still works; only self-addressing breaks)
 */
/**
 * Strip a device suffix: "2348021016309:11@s.whatsapp.net" -> "2348021016309@s.whatsapp.net"
 *
 * ★ This was the actual cause of the self-chat stall. sendConnectionMessage()
 * used `const jid = user.id` straight from the creds, and `user.id` carries the
 * device: 2348021016309:11@s.whatsapp.net. Baileys decodes that to
 * user=2348021016309 device=11 and builds a deviceSentMessage for device
 * 11 only. The phone shows "Waiting for this message. This may take a while."
 * forever, because the only addressed device never delivered it.
 *
 * Sending to the bare user JID lets the library address the account's real
 * device set instead of one hard-coded device id.
 */
function stripDevice(jid) {
  if (typeof jid !== 'string') return jid;
  const at = jid.indexOf('@');
  if (at === -1) return jid;
  const user = jid.slice(0, at);
  const server = jid.slice(at + 1);
  const colon = user.indexOf(':');
  if (colon === -1) return jid;
  return `${user.slice(0, colon)}@${server}`;
}

function resolveSendJid(jid, sock) {
  // Device suffix first: it breaks self-sends regardless of LID vs PN.
  jid = stripDevice(jid);
  if (!isLid(jid)) return jid;
  const me = (sock && sock.user) || {};
  const mePn = me.id ? bare(me.id) + PN_SUFFIX : null;

  // ONLY rewrite our own identity. This is the whole rule.
  //
  // Rewriting someone ELSE's LID to their PN breaks their chat: their Signal
  // session is keyed on the LID, so a message addressed to the PN cannot be
  // decrypted by that device and shows as "Waiting for this message. This may
  // take a while." Proven in production — the self-chat rewrite delivered a
  // visible reply (the private-mode notice at 4:55 PM) while every rewritten
  // stranger LID produced a placeholder.
  //
  // Self is different because Baileys compares digits to decide `isMe`
  // (messages-send.js:412) and a bare @lid never matches our PN, so a
  // self-addressed @lid is treated as a stranger and never delivered.
  // Only OUR OWN account's map. A LID belonging to anyone else must never
  // match, no matter what this process learned while serving another session.
  const account = bare(me.id) || bare(me.phoneNumber);
  const own = account ? ownMap(account).get(bare(jid)) : undefined;
  if (own) return own;

  const ownLids = [me.lid, me.lidPn, me.lidId].filter(Boolean).map(bare);
  if (ownLids.includes(bare(jid)) && mePn) return mePn;

  // Never touch anyone else's addressing.
  return jid;
}

/**
 * Install the resolver on a socket so every send in every command file is
 * covered without touching 53 handlers.
 */
function patchSocketSends(sock, onResolve) {
  if (!sock || sock.__zynexJidPatched) return sock;
  const original = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options) => {
    const target = resolveSendJid(jid, sock);
    if (target !== jid) {
      if (typeof onResolve === 'function') onResolve(jid, target);
      else console.log(`[JID] ${jid} → ${target} (LID would not resolve as self)`);
    }
    return original(target, content, options);
  };
  sock.__zynexJidPatched = true;
  return sock;
}

module.exports = {
  bare,
  stripDevice,
  registerOwnIdentity,
  ownLidToPn,
  ownIdentityByAccount,
  ownMap,
  isLid,
  isPn,
  lidToPn,
  rememberFromKey,
  resolveSendJid,
  patchSocketSends,
  PN_SUFFIX,
  LID_SUFFIX,
  _internals: { lidToPn },
};
