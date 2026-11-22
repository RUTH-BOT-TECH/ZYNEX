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
    let media =
      inner?.imageMessage || inner?.videoMessage || inner?.audioMessage || inner?.documentMessage || null;

    let type = inner?.imageMessage
      ? 'image'
      : inner?.videoMessage
        ? 'video'
        : inner?.audioMessage
          ? 'audio'
          : inner?.documentMessage
            ? 'document'
            : null;

    // ── Look up the ORIGINAL stanza before deciding anything ─────────────────
    // A quoted view-once arrives stripped: WhatsApp sends only the wrapper
    // inside contextInfo, often with no imageMessage at all and never with a
    // usable mediaKey. The real message — with the real keys — was captured
    // when it arrived, so that is the thing to download from.
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
    const hasKey = (node) => Boolean(node && node.mediaKey && (node.url || node.directPath));

    const originalMedia = mediaNodeOf(original?.message);
    const quotedMedia = mediaNodeOf(quoted);

    /**
     * ★ Decide what to do ONLY after checking the original.
     *
     * This block used to run first and bail out on `!media`, which meant a
     * stripped quote — the normal shape for somebody else's view-once — was
     * rejected before the stored original was ever consulted. Replying `.vv`
     * to a view-once that had already been captured always failed, whether or
     * not it had been opened.
     */
    // Give up only when NO media node exists anywhere — not merely when the key
    // looks absent. The downloader is the authority on whether it can fetch.
    if (!originalMedia && !quotedMedia) {
      const quotedKeys = Object.keys(quoted || {});
      const isSelfSent = Boolean(quoted?.viewOnce !== undefined && !quotedMedia);
      console.log(
        `[VV] nothing downloadable. stanzaId=${stanzaId || 'none'} original=${original ? 'stored' : 'not-stored'} ` +
          `originalKey=${originalMedia ? Boolean(originalMedia.mediaKey) : 'n/a'} quotedKey=${quotedMedia ? Boolean(quotedMedia.mediaKey) : 'n/a'} ` +
          `quotedKeys=${JSON.stringify(quotedKeys)}`,
      );

      if (original) {
        return reply(
          '❌ *I have this message but not the media itself.*\n\n' +
            'WhatsApp sent this device only the wrapper, with no key and no address to download from. ' +
            'That happens when the item was opened and cleared before the bot could fetch it.\n\n' +
            '_Nothing can recover it after WhatsApp drops it — the media lives on their servers only until it is opened._',
        );
      }
      // Nothing media-shaped anywhere: either you replied to a text message, or
      // the view-once never reached this device.
      const looksLikeText = Boolean(
        quoted?.extendedTextMessage || quoted?.conversation || quoted?.imageMessage || quoted?.videoMessage,
      );
      if (looksLikeText) {
        return reply(
          '❌ That message has no view-once photo or video in it.\n\n' +
            '_Reply directly to the view-once item itself._',
        );
      }
      return reply(
        '❌ *This device never received that view-once.*\n\n' +
          'No media key and no download address arrived with it, so there is nothing to unlock. ' +
          'This is what you get for an item *you* sent from this same account, or one that has already been opened.\n\n' +
          '_For a view-once somebody else sends you, the bot can only unlock it if it captured the item when it arrived — reply with `.vv` soon after it is sent._',
      );
    }

    // Which media NODE are we working with? `media` must stay the node itself —
    // payloadFor() reads .mimetype and .fileName straight off it.
    if (hasKey(originalMedia)) {
      const innerOriginal = unwrap(original.message);
      media =
        innerOriginal.imageMessage ||
        innerOriginal.videoMessage ||
        innerOriginal.audioMessage ||
        innerOriginal.documentMessage;
      type =
        innerOriginal.imageMessage ? 'image'
        : innerOriginal.videoMessage ? 'video'
        : innerOriginal.audioMessage ? 'audio'
        : 'document';
    }

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
      const msgText = e.message || '';
      const noKey = /empty media key/i.test(msgText);
      /**
       * "No valid media URL or directPath present in message" is a DIFFERENT
       * failure from a missing media key: the message carried no download
       * location at all. Both mean the same thing to the user — this device was
       * never given the material — but blaming server-side expiry for a message
       * that has no URL is misleading.
       */
      const noUrl = /no valid media url|directpath/i.test(msgText);
      if (noKey) {
        console.log(
          `[VV] empty media key. stanzaId=${stanzaId || 'none'} original=${original ? 'stored' : 'not-stored'} ` +
            `originalMediaKey=${originalMedia ? Boolean(originalMedia.mediaKey) : 'n/a'} ` +
            `quotedMediaKey=${quotedMedia ? Boolean(quotedMedia.mediaKey) : 'n/a'} ` +
            `quotedKeys=${JSON.stringify(Object.keys(quotedMedia || {}))}`,
        );
      }
      if (noUrl) {
        console.log(`[VV] no media URL. stanzaId=${stanzaId || 'none'} original=${original ? 'stored' : 'not-stored'}`);
        return reply(
          '❌ *That message has no downloadable media in it.*\n\n' +
            "What arrived here is only a placeholder — no image data and no address to fetch it from. " +
            "WhatsApp sends the full media only to the device that *received* the item, and that copy is gone once it is opened.\n\n" +
            '_If somebody else sends you a view-once and you reply `.vv` before opening it, this works._',
        );
      }
      return reply(
        `❌ Could not download that media (${e.message}).\n\n` +
          (noKey
            ? '_WhatsApp did not give this device the media key for that item — it was likely sent from this same account, or already expired on their servers._'
            : '_The media is no longer available from WhatsApp — it may have been opened already, or expired on their servers._'),
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
