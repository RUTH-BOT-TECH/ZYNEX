/**
 * lib/mention.js — one place to turn "someone" into a tappable @number.
 *
 * WhatsApp only renders a real mention when BOTH are true:
 *   1. the caption contains `@<digits>`, and
 *   2. the matching JID is in the message's `mentions` array.
 *
 * A lot of commands did one or the other. `.hug` did neither: it printed
 * `*2348021016309*` (bold digits, no @) and passed only the target JID. So the
 * "number / ID stuff" the user expected was either plain text or missing.
 *
 * This module also fixes the LID problem: a modern WhatsApp group can report
 * a contact as `209758283931714:14@lid`. Displaying that as `@209758283931714`
 * is useless. When lib/jid.js has learned the contact's PN from an inbound
 * message key, we show the real phone number instead.
 */
const jid = require('./jid');

/** Digits only, from "123@s.whatsapp.net", "123:4@lid", "123" or "@123". */
function digits(x) {
  return String(x || '').replace(/^@/, '').split('@')[0].split(':')[0];
}

/**
 * Normalise anything into a JID that can go into `mentions`.
 * Returns null for values that are not a usable identity.
 */
function toJid(x) {
  if (!x) return null;
  const s = String(x).trim().replace(/^@/, '');
  const at = s.indexOf('@');
  const user = (at === -1 ? s : s.slice(0, at)).split(':')[0];
  if (!/^\d{5,}$/.test(user)) return null;
  const server = at === -1 ? jid.PN_SUFFIX.slice(1) : s.slice(at + 1);
  let out = `${user}@${server}`;
  if (jid.isLid(out)) {
    const pn = jid.lidToPn.get(user);
    if (pn) out = pn; // show a real phone number, not a 14-digit LID
  }
  return out;
}

/** The `@123456` string for a caption. */
function tag(x) {
  const j = toJid(x);
  return j ? `@${digits(j)}` : null;
}

/** A de-duplicated `mentions` array (full JIDs, never bare numbers). */
function mentions(...xs) {
  const out = [];
  for (const x of xs) {
    const j = toJid(x);
    if (j && !out.includes(j)) out.push(j);
  }
  return out;
}

/** Pick the best target from a handler context. */
function pickTarget({ mentionedJid, m, args } = {}) {
  // handler.js already normalises contextInfo across text, image, video,
  // document and sticker messages. Engines that only read
  // m.message.extendedTextMessage lose `.hug @user` sent on a caption.
  const ci =
    m?.message?.extendedTextMessage?.contextInfo ||
    m?.message?.imageMessage?.contextInfo ||
    m?.message?.videoMessage?.contextInfo ||
    m?.message?.documentMessage?.contextInfo ||
    m?.message?.stickerMessage?.contextInfo ||
    {};
  const fromMention = (mentionedJid || [])[0] || ci.mentionedJid?.[0];
  if (fromMention) return toJid(fromMention);
  if (ci.participant) return toJid(ci.participant);

  // `.hug 2348012345678` — a bare number typed after the command.
  for (const a of args || []) {
    const n = String(a).replace(/\D/g, '');
    if (/^\d{7,15}$/.test(n)) return toJid(n);
  }
  return null;
}

module.exports = { digits, toJid, tag, mentions, pickTarget };
