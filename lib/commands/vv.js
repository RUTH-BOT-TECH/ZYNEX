/**
 * .vv — unlock view-once media.
 *
 * WhatsApp does not send view-once images as `imageMessage`. They arrive wrapped,
 * and the wrapper has changed three times:
 *
 *   viewOnceMessageV2Extension  ← current (2024+)
 *   viewOnceMessageV2           ← older
 *   viewOnceMessage             ← original
 *
 * …and any of those can sit inside `ephemeralMessage` (disappearing chats) or
 * `documentWithCaptionMessage`. A check for `viewOnceMessageV2` alone recognises
 * almost nothing that arrives today, which is why this command looked dead.
 *
 * The media is delivered to the chat where the command was used. It is NOT routed
 * to the bot owner's DM: whoever replied to the view-once is the person who could
 * already see it, and silently forwarding someone's photo to a third party is not
 * something a chat command should do without being asked. `.vv dm` does that
 * explicitly, and says so.
 */
module.exports = {
  name: 'vv',
  aliases: ['viewonce', 'rvo', 'view'],
  desc: 'Unlock a view-once photo/video — replies with it; add `dm` to send to the owner',
  category: 'media',
  async execute({ sock, msg, from, reply, download, args, dbSession }) {
    const quoted =
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
      msg.message?.imageMessage?.contextInfo?.quotedMessage ||
      msg.message?.videoMessage?.contextInfo?.quotedMessage;

    if (!quoted) {
      return reply(
        '❌ Reply to a *view-once* message with `.vv`.\n\n' +
          '_Add `dm` (`.vv dm`) to have it sent to the owner instead of this chat._',
      );
    }

    // Unwrap every container WhatsApp is known to use.
    const unwrap = (node) => {
      let m = node;
      for (let depth = 0; depth < 5 && m; depth++) {
        const next =
          m.viewOnceMessageV2Extension?.message ||
          m.viewOnceMessageV2?.message ||
          m.viewOnceMessage?.message ||
          m.ephemeralMessage?.message ||
          m.documentWithCaptionMessage?.message ||
          m.editedMessage?.message;
        if (!next) break;
        m = next;
      }
      return m;
    };

    const inner = unwrap(quoted);
    const media =
      inner?.imageMessage || inner?.videoMessage || inner?.audioMessage || inner?.documentMessage || null;

    const type = inner?.imageMessage
      ? 'image'
      : inner?.videoMessage
        ? 'video'
        : inner?.audioMessage
          ? 'audio'
          : inner?.documentMessage
            ? 'document'
            : null;

    if (!media || !type) {
      // Distinguish "you replied to the wrong thing" from "I can't read this".
      const what = Object.keys(quoted || {})[0] || 'nothing';
      return reply(
        `❌ That message has no view-once photo or video in it (it looks like *${what}*).\n\n` +
          '_Reply directly to the view-once item — if it has already been opened once, WhatsApp may have removed it for good._',
      );
    }

    // ── Recover the original stanza ──────────────────────────────────────────
    // A quoted message arrives stripped: WhatsApp sends only the view-once
    // WRAPPER inside contextInfo, with no `mediaKey`, `url`, `directPath` or
    // `fileSha256`. Decrypting that is impossible and Baileys throws
    // "Cannot derive from empty media key" (upstream issue #2907, still open).
    //
    // But we stored the real message when it arrived, so pull the media keys
    // from there and download against the original — if it is still in memory.
    const ctxInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo;
    const stanzaId = ctxInfo?.stanzaId;

    let original = null;
    try {
      const { getStoredMessage } = require('../anti/antiDelete');
      original = stanzaId ? getStoredMessage(stanzaId) : null;
    } catch {}

    const mediaNodeOf = (whole) => {
      if (!whole) return null;
      const u = unwrap(whole);
      return u?.imageMessage || u?.videoMessage || u?.audioMessage || u?.documentMessage || null;
    };

    const quotedMedia = mediaNodeOf(quoted);
    const originalMedia = mediaNodeOf(original?.message);
    const hasKey = (node) => Boolean(node && node.mediaKey && (node.url || node.directPath));

    let buffer;
    try {
      if (typeof download !== 'function') throw new Error('media downloader unavailable');

      // Prefer the stored original — it carries the real key.
      if (hasKey(originalMedia)) {
        console.log(`[VV] downloading from the stored original (stanzaId=${stanzaId})`);
        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        buffer = await downloadMediaMessage(
          original,
          'buffer',
          {},
          { logger: sock.logger, reuploadRequest: sock.updateMediaMessage },
        );
      } else {
        // No stored original, or it has no key either: let the normal downloader
        // try. It may still succeed from the quote, and its error is the honest
        // one to report.
        buffer = await download();
      }
    } catch (e) {
      const noKey = /empty media key/i.test(e.message || '');
      if (noKey) {
        console.log(
          `[VV] empty media key. stanzaId=${stanzaId || 'none'} original=${original ? 'stored' : 'not-stored'} ` +
            `originalMediaKey=${originalMedia ? Boolean(originalMedia.mediaKey) : 'n/a'} ` +
            `quotedMediaKey=${quotedMedia ? Boolean(quotedMedia.mediaKey) : 'n/a'} ` +
            `quotedKeys=${JSON.stringify(Object.keys(quotedMedia || {}))}`,
        );
      }
      return reply(
        `❌ Could not download that media (${e.message}).\n\n` +
          (noKey
            ? '_WhatsApp did not give this device the media key for that item — it was likely sent from this same account, or already expired on their servers._'
            : '_View-once media can only be fetched while it is still on the server — once opened, it may already be gone._'),
      );
    }
    if (!buffer || !buffer.length) {
      return reply('❌ Downloaded nothing — WhatsApp returned an empty file. It may have expired.');
    }

    const toOwner = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).some(
      (a) => String(a).toLowerCase() === 'dm',
    );

    if (!toOwner) return sendHere(sock, from, msg, reply, type, buffer, media);

    /* ── explicit opt-in: deliver privately to the paired account ── */
    const ownerNumber = dbSession?.phoneNumber;
    if (!ownerNumber) {
      return reply('❌ I do not know the owner number for this session, so I cannot DM it.');
    }
    try {
      await sock.sendMessage(`${ownerNumber}@s.whatsapp.net`, {
        ...payloadFor(type, buffer, media),
        caption: `🔓 *View-once unlocked*\n\n👤 ${msg.pushName || 'Unknown'}\n💬 ${from.endsWith('@g.us') ? 'Group' : 'DM'}\n📅 ${new Date().toLocaleString()}`,
      });
      return reply('🔒 Sent privately to the owner. _This chat got only this notice._');
    } catch (e) {
      return reply(`❌ Could not send to the owner (${e.message}).`);
    }
  },
};

function payloadFor(type, buffer, media) {
  if (type === 'image') return { image: buffer };
  if (type === 'video') return { video: buffer, mimetype: media.mimetype || 'video/mp4' };
  if (type === 'audio') return { audio: buffer, mimetype: media.mimetype || 'audio/mpeg' };
  return {
    document: buffer,
    mimetype: media.mimetype || 'application/octet-stream',
    fileName: media.fileName || 'view-once',
  };
}

async function sendHere(sock, from, msg, reply, type, buffer, media) {
  const caption =
    `🔓 *View-once unlocked*\n\n` +
    `👤 From: ${msg.pushName || 'Unknown'}\n` +
    `_Whoever could see it in this chat can see it here — this did not leak it anywhere new._`;
  try {
    return await sock.sendMessage(
      from,
      { ...payloadFor(type, buffer, media), caption },
      { quoted: msg },
    );
  } catch (e) {
    return reply(`❌ Downloaded it but could not send it back (${e.message}).`);
  }
}

module.exports._internals = { payloadFor };
