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
const { getContentType } = require('@whiskeysockets/baileys');

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
    /**
     * Unwrap via getContentType, exactly as the NOVA_MD implementation does:
     *
     *   const type = getContentType(message);
     *   if (!type || !WRAPPERS.includes(type)) return message;
     *   const inner = message[type]?.message ?? message[type];
     *
     * Two differences from the hand-rolled version this replaced:
     *
     *  1. `?? message[type]` — when a wrapper has no `.message` child it IS the
     *     content. The old code required `.message` and silently stopped one
     *     level too early, leaving a wrapper where the media was expected.
     *  2. Dispatching on getContentType rather than a list of `.message` probes
     *     means the wrapper is found even when it is the only key present.
     */
    const WRAPPERS = [
      'ephemeralMessage',
      'viewOnceMessage',
      'viewOnceMessageV2',
      'viewOnceMessageV2Extension',
      'documentWithCaptionMessage',
      'editedMessage',
    ];
    const unwrap = (node, depth = 0) => {
      if (!node || depth > 5) return node;
      const t = getContentType(node);
      if (!t || !WRAPPERS.includes(t)) return node;
      const inner = node[t]?.message ?? node[t];
      return unwrap(inner, depth + 1);
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
    /**
     * ★ FIRST: is the media already on disk?
     *
     * The bytes are captured the moment a message arrives (lib/mediaCache), so
     * this succeeds even after WhatsApp has deleted the item from its servers —
     * which is the normal case for a view-once, and the reason "reply .vv later"
     * used to be hopeless.
     */
    let cached = null;
    try {
      const { getCachedMedia } = require('../mediaCache');
      cached = (stanzaId && getCachedMedia(stanzaId)) || null;
    } catch {}

    // Give up only when NO media node exists anywhere — not merely when the key
    // looks absent. The downloader is the authority on whether it can fetch.
    if (!cached && !originalMedia && !quotedMedia) {
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

    /**
     * ── Fetch the media, trying every route in order ─────────────────────────
     *
     * A single attempt is not enough. The same view-once can be reachable by one
     * route and unreachable by another, depending on whether it was captured,
     * who sent it, and whether the quote carries a key at all. Each strategy
     * below is genuinely different, so a failure in one says nothing about the
     * next — stopping at the first error was giving up too early.
     *
     *   1. the media cache      — bytes already on disk; survives WhatsApp deleting
     *                             the item, which is the usual case for view-once
     *   2. the stored original  — the real stanza, with the real mediaKey
     *   3. the socket downloader— sock.downloadMediaMessage, which carries the
     *                             live connection's media credentials
     *   4. the quote itself     — often just a wrapper, but sometimes carries keys
     */
    const ctx = {
      stanzaId: ctxInfo?.stanzaId,
      participant: ctxInfo?.participant,
      remoteJid: ctxInfo?.remoteJid || (msg.key?.fromMe ? msg.key.remoteJid : ctxInfo?.participant) || msg.key?.remoteJid,
    };

    /**
     * ★ The downloader must receive the UNWRAPPED content.
     *
     * `downloadMediaMessage` calls `getContentType(message)` and then looks for
     * `message[type].mediaKey` / `.url`. Given a raw quote it finds
     * `viewOnceMessageV2Extension`, takes THAT as the content node, finds no
     * `url` on it, and fails with:
     *
     *   "No valid media URL or directPath present in message"
     *
     * …which is not a statement about the media at all — it is a statement about
     * having been handed the wrong object. That error is exactly what production
     * reported, while `type=image` in the same log line proved the unwrap had
     * already succeeded two lines earlier. The unwrapped node is the thing to
     * download; the wrapper is not.
     */
    const quoteTarget = {
      key: {
        remoteJid: ctx.remoteJid,
        id: ctx.stanzaId,
        fromMe: false,
        participant: ctx.participant,
      },
      message: inner || quoted,
      messageTimestamp: msg.messageTimestamp,
    };

    // The quote keyed by the COMMAND message instead of the stanza — the shape
    // the NOVA_MD implementation uses (`key: msg.key, message: inner`). Media
    // decryption uses the node's own mediaKey, so the message key only affects
    // retry/addressing behaviour; having both shapes costs nothing.
    const commandKeyTarget = {
      key: { ...msg.key },
      message: inner || quoted,
      messageTimestamp: msg.messageTimestamp,
    };

    const attempts = [];
    let buffer = null;

    if (cached) {
      buffer = cached;
      console.log(`[VV] 1/4 served from the media cache (${cached.length} bytes, stanzaId=${ctx.stanzaId})`);
    }

    /**
     * ★ THE ROUTE THAT WAS MISSING: downloadContentFromMessage.
     *
     * `downloadMediaMessage` is the high-level helper: it inspects the message
     * object, runs getContentType, unwraps, then rebuilds the download from the
     * wrapper it found. Every one of our failures lived in that inspection —
     * "No valid media URL or directPath present in message" is it looking at a
     * wrapper and finding no url, not the media being unavailable.
     *
     * `downloadContentFromMessage` is the primitive underneath. It takes the
     * media NODE and the type string, and nothing else:
     *
     *     const type  = Object.keys(msg)[0];              // 'imageMessage'
     *     const media = msg[type];                        // holds mediaKey + directPath
     *     const stream = await downloadContentFromMessage(media, type.replace('Message',''));
     *
     * No wrapper detection, no message key, no remoteJid, no stanza. There is
     * nothing left to misidentify — which is why implementations built on it do
     * not hit this class of error at all.
     */
    const MEDIA_TYPES = {
      imageMessage: 'image',
      videoMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'document',
      stickerMessage: 'sticker',
    };

    if (!buffer && media && MEDIA_TYPES[type + 'Message']) {
      attempts.push({
        name: 'downloadContentFromMessage (bare node)',
        run: async () => {
          const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
          const stream = await downloadContentFromMessage(media, MEDIA_TYPES[type + 'Message']);
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          return Buffer.concat(chunks);
        },
      });
    }

    if (!buffer && original && hasKey(originalMedia)) {
      attempts.push({
        name: 'stored original',
        run: () =>
          require('@whiskeysockets/baileys').downloadMediaMessage(
            original,
            'buffer',
            {},
            { logger: sock.logger, reuploadRequest: sock.updateMediaMessage },
          ),
      });
    }

    // The socket-bound downloader. NOVA MD's .vv goes straight here, and it is a
    // real difference: this call carries the live connection's media auth rather
    // than rebuilding it from arguments.
    if (typeof sock?.downloadMediaMessage === 'function') {
      attempts.push({
        name: 'socket downloader (unwrapped quote)',
        run: () => sock.downloadMediaMessage(quoteTarget, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage }),
      });
      attempts.push({
        name: 'socket downloader (command key)',
        run: () => sock.downloadMediaMessage(commandKeyTarget, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage }),
      });
    }

    attempts.push({
      name: 'quoted media',
      run: () =>
        require('@whiskeysockets/baileys').downloadMediaMessage(
          quoteTarget,
          'buffer',
          {},
          { reuploadRequest: sock.updateMediaMessage },
        ),
    });

    if (typeof download === 'function') {
      attempts.push({ name: 'context downloader', run: () => download() });
    }

    const failures = [];
    for (let i = 0; i < attempts.length && !buffer; i++) {
      const a = attempts[i];
      try {
        const got = await a.run();
        if (got && got.length) {
          buffer = got;
          console.log(`[VV] ${i + 2}/${attempts.length + 1} fetched via the ${a.name} (${got.length} bytes)`);
        } else {
          failures.push(`${a.name}: returned nothing`);
        }
      } catch (e) {
        failures.push(`${a.name}: ${e.message || e}`);
      }
    }

    if (!buffer) {
      /**
       * Every route failed. Log the whole picture BEFORE replying, so the next
       * report is diagnosable from the log alone: which stanza, whether an
       * original was kept, whether either side had a key, what each route said,
       * and — crucially — whether the cache had ever held this id.
       */
      /**
       * Inventory the media node itself. `No valid media URL or directPath
       * present in message` comes from exactly one place in Baileys
       * (messages-media.js:422) and one condition:
       *
       *     const downloadUrl = directPath ? getUrlFromDirectPath(directPath) : url;
       *     if (!downloadUrl) throw new Boom('No valid media URL or directPath...')
       *
       * So that error is proof the node had neither field — nothing to fetch.
       * Printing the node's actual keys settles whether the quote was stripped
       * or whether we are still holding the wrong object.
       */
      const nodeKeys = media && typeof media === 'object' ? Object.keys(media) : [];
      console.log(
        `[VV] node inventory. keys=${JSON.stringify(nodeKeys)} ` +
          `directPath=${media?.directPath ? 'present' : 'MISSING'} ` +
          `url=${media?.url ? 'present' : 'MISSING'} ` +
          `mediaKey=${media?.mediaKey ? 'present' : 'MISSING'} ` +
          `fileLength=${media?.fileLength ?? 'n/a'}`,
      );
      console.log(
        `[VV] all routes failed. stanzaId=${ctx.stanzaId || 'none'} ` +
          `original=${original ? 'stored' : 'not-stored'} ` +
          `cached=${cached ? 'yes' : 'no'} ` +
          `originalKey=${originalMedia ? Boolean(originalMedia.mediaKey) : 'n/a'} ` +
          `quotedKey=${quotedMedia ? Boolean(quotedMedia.mediaKey) : 'n/a'} ` +
          `type=${type || 'none'} fromMe=${Boolean(msg.key?.fromMe)} ` +
          `routes=${JSON.stringify(failures)}`,
      );

      const all = failures.join(' | ');
      const noUrl = /no valid media url|directpath/i.test(all);
      const noKey = /empty media key|cannot derive/i.test(all);

      if (noUrl || noKey) {
        return reply(
          '❌ *There is nothing left to unlock in that one.*\n\n' +
            'WhatsApp kept no copy for this bot — no media key and no address to fetch it from. ' +
            'For a view-once, that is permanent: the item is deleted from their servers once it is opened, ' +
            'and a device that never saw it cannot get it back afterwards.\n\n' +
            '_Anything the bot receives from now on is captured the moment it arrives, so `.vv` works on those — ' +
            'reply soon after the item is sent._',
        );
      }
      return reply(`❌ Could not download that media.\n\n_${all.slice(0, 300)}_`);
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
