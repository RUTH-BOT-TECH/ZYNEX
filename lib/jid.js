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
function resolveSendJid(jid, sock) {
  if (!isLid(jid)) return jid;
  const me = (sock && sock.user) || {};
  const mePn = me.id ? bare(me.id) + PN_SUFFIX : null;

  // Our own LID: reply to ourselves on the PN. This is the stall.
  const ownLids = [me.lid, me.lidPn, me.lidId].filter(Boolean).map(bare);
  if (ownLids.includes(bare(jid)) && mePn) return mePn;

  const learned = lidToPn.get(bare(jid));
  if (learned) return learned;

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
