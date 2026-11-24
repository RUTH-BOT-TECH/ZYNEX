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

/**
 * Shown when WhatsApp has only delivered a keyless stand-in. It is NOT a
 * terminal failure: the item is queued and will be posted automatically when
 * the media arrives (see lib/viewOncePending.js).
 */
const WAITING_REPLY =
  '⏳ *View-once queued — I dey wait for the media.*\n\n' +
  'WhatsApp sent this device an empty stand-in (no media key, no download address). ' +
  'Since the November 2026 update, that is what a **WEB/Chrome companion** gets; ' +
  'an **Android** companion receives the real photo or video. Both your own ' +
  'view-once and somebody else’s work the same way — the sender is not the problem.\n\n' +
  '*On the host (one time):*\n' +
  '1. `DEVICE_IDENTITY=android`\n' +
  '2. Re-pair from your phone (WhatsApp → Linked Devices → log out this device, then pair again)\n' +
  '3. Send a new view-once, then reply `.vv`\n\n' +
  '_The bot now also auto-matches `creds.platform`, so a session already linked ' +
  'as Android fixes itself on restart without any variable._\n' +
  '_If the media lands within 90 seconds, I go post am here automatically — no need to run `.vv` again._';

module.exports = {
  name: 'vv',
  aliases: ['viewonce', 'rvo', 'view'],
  desc: 'Unlock a view-once photo/video — replies with it; add `dm` to send to the owner',
  category: 'media',
  async execute({ sock, msg, from, reply, download, args, dbSession }) {
    // Parsed once, up here: the failure branches need it to decide whether to
    // run a diagnosis, and they run before the success path.
    const argv = (Array.isArray(args) ? args : String(args || '').split(/\s+/))
      .map((a) => String(a).toLowerCase().trim())
      .filter(Boolean);

    /**
     * ★ "Eventually open" — the user's exact requirement.
     *
     * A keyless `view_once_unavailable_fanout` stand-in is NOT a permanent
     * failure: it means the socket is being seen as a WEB companion. Once the
     * Android identity is restored (or a late append/history batch lands), the
     * real media arrives under the same stanzaId. Register it instead of
     * firing a terminal "nothing can recover it" at the user.
     */
    const queuePending = () => {
      const dm = argv.includes('dm');
      const owner = dbSession?.phoneNumber ? `${dbSession.phoneNumber}@s.whatsapp.net` : null;
      try {
        return require('../viewOncePending').register({
          stanzaId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId ||
                    msg.message?.imageMessage?.contextInfo?.stanzaId ||
                    msg.message?.videoMessage?.contextInfo?.stanzaId,
          sock, from, msg, reply, toOwner: dm, ownerJid: owner,
        });
      } catch { return false; }
    };

    const quoted =
      msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
      msg.message?.imageMessage?.contextInfo?.quotedMessage ||
      msg.message?.videoMessage?.contextInfo?.quotedMessage;

    if (!quoted) {
      return reply(
        '❌ Reply to a *view-once* message with `.vv`.\n\n' +
          '• `.vv dm` — send it to the owner instead of this chat\n' +
          '• `.vv why` — diagnose a view-once that would not unlock',
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
    let cachedMeta = null;
    try {
      const mediaCache = require('../mediaCache');
      cached = (stanzaId && mediaCache.getCachedMedia(stanzaId)) || null;
      // Bytes alone are not enough: when the quote is stripped (the normal
      // case) the send path has no media node to read mimetype/caption/type
      // from. precacheMedia saved all of that on arrival.
      if (cached) {
        cachedMeta =
          (typeof mediaCache.getCachedMediaMeta === 'function' && mediaCache.getCachedMediaMeta(stanzaId)) ||
          null;
      }
    } catch {}

    // Give up only when NO media node exists anywhere — not merely when the key
    // looks absent. The downloader is the authority on whether it can fetch.
    if (!cached && !originalMedia && !quotedMedia) {
      // Checked before every other branch below: they all return early, and the
      // first draft put this after them, which made it unreachable.
      if (argv.includes('why')) {
        return reply(diagnose({ cached, original, quoted, quotedMedia, hasKey, failures: [], msg }));
      }
      const quotedKeys = Object.keys(quoted || {});
      console.log(
        `[VV] nothing downloadable yet. stanzaId=${stanzaId || 'none'} original=${original ? 'stored' : 'not-stored'} ` +
          `originalKey=${originalMedia ? Boolean(originalMedia.mediaKey) : 'n/a'} quotedKey=${quotedMedia ? Boolean(quotedMedia.mediaKey) : 'n/a'} ` +
          `quotedKeys=${JSON.stringify(quotedKeys)} fromMe=${Boolean(msg.key?.fromMe)}`,
      );

      const looksLikeText = Boolean(
        quoted?.extendedTextMessage || quoted?.conversation || quoted?.imageMessage || quoted?.videoMessage,
      );
      if (looksLikeText) {
        return reply(
          '❌ That message has no view-once photo or video in it.\n\n' +
            '_Reply directly to the view-once item itself._',
        );
      }

      /**
       * ★ THE FALSE "YOU SENT IT YOURSELF" BRANCH IS GONE.
       *
       * It keyed off `msg.key.fromMe` — but on a self-bot EVERY command the
       * owner sends has fromMe=true, including replies to OTHER people's
       * view-once. Production logged `fromMe=true` on all three `.vv` attempts
       * and the bot answered "you sent it yourself, no bot can recover that".
       * That was a lie: the item was simply a view_once_unavailable_fanout
       * stand-in because the socket presented a WEB identity while the session
       * was linked as Android.
       *
       * Both your OWN view-once and somebody else's are unlocked the same way
       * once the Android identity is restored — WhatsApp fanouts the media to
       * that device class. So we queue the stanzaId and deliver automatically
       * when the bytes arrive, instead of declaring it impossible.
       */
      await queuePending();
      return reply(WAITING_REPLY);
    }

    // Which media NODE are we working with? `media` must stay the node itself —
    // payloadFor() reads .mimetype and .fileName straight off it.
    if (hasKey(originalMedia)) {
      const innerOriginal = unwrap(original.message) || {};
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
     * ★ THE DEFECT THAT MADE `.vv` LOOK DEAD EVEN WHEN THE CACHE WORKED.
     *
     * Production logged `[CACHE] captured <id>, 1841 KB` and then replied
     *   ❌ Downloaded it but could not send it back
     *      (Cannot read properties of null (reading 'mimetype'))
     *
     * Why: a quoted view-once arrives STRIPPED — no imageMessage, no
     * mediaKey, nothing. `media` and `type` were derived only from that quote,
     * so both were null. The bytes came from the cache, but `payloadFor()`
     * still dereferenced `media.mimetype` and threw. The one case the media
     * cache exists for (a quote with no media node) was the one case the send
     * path could not handle.
     *
     * Fix: reconstruct the send shape from the metadata saved at capture time.
     * `media` becomes a plain descriptor, not a protocol node — payloadFor and
     * sendHere only read mimetype / fileName / caption / ptt off it.
     */
    if (!type) {
      const k = cachedMeta?.kind;
      if (k && ['image', 'video', 'audio', 'document'].includes(k)) type = k;
      else if (k === 'sticker') type = 'image';
      if (!type && cachedMeta?.mimetype) {
        type = require('../mediaCache').typeFromMimetype(cachedMeta.mimetype);
      }
      // A captured view-once with no metadata at all is a photo in practice.
      if (!type) type = 'image';
    }

    if (!media) {
      media = {
        mimetype: cachedMeta?.mimetype || undefined,
        fileName: cachedMeta?.fileName || undefined,
        caption: cachedMeta?.caption || undefined,
        ptt: cachedMeta?.ptt,
      };
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

    // Resolved up here because the FORWARD route needs a destination as well.
    // It used to be computed only after the download, so `.vv dm` forwarded
    // the photo into the group anyway — the private option was silently ignored.
    const toOwner = argv.includes('dm');
    const ownerJid = dbSession?.phoneNumber
      ? `${dbSession.phoneNumber}@s.whatsapp.net`
      : null;

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

    /**
     * ★ THE ROUTE OTHER DEVS USE — forward the node, do not download it.
     *
     * Every "anti-view-once" bot that works does this:
     *
     *     await sock.sendMessage(jid, { forward: message, viewOnce: false })
     *
     * Two details make it work, and both were missing here:
     *
     *  1. `normalizeMessageContent` (inside generateForwardMessageContent)
     *     already strips the `viewOnceMessage*` wrapper for us.
     *  2. The media node still carries `viewOnce: true`, and WhatsApp renders on
     *     that field — so it has to be deleted before the forward, or the result
     *     arrives as another view-once. Implementations that predate the current
     *     wrappers do exactly this:
     *
     *         delete msg.viewOnceMessage.message[vtype].viewOnce
     *
     *     `viewOnce: false` in the send options only prevents Baileys from
     *     RE-wrapping; it does not clear the field that arrived.
     *
     * Why this is better than downloading and resending: no 64 MB buffer, no
     * re-encryption, no re-upload. WhatsApp relays the existing media reference,
     * so it also works for clips too large to hold in memory.
     */
    const forwardable = (() => {
      const whole = hasKey(quotedMedia) ? (inner || quoted) : original?.message;
      if (!whole) return null;
      const copied = JSON.parse(JSON.stringify(whole));
      const node = unwrap(copied) || {};
      delete node.imageMessage?.viewOnce;
      delete node.videoMessage?.viewOnce;
      delete node.audioMessage?.viewOnce;
      delete node.documentMessage?.viewOnce;
      return copied;
    })();

    if (!buffer && forwardable && (!toOwner || ownerJid)) {
      attempts.push({
        name: 'forward the original (view-once stripped)',
        run: async () => {
          const { generateForwardMessageContent } = require('@whiskeysockets/baileys');
          // Throws when there is genuinely nothing to relay, which is the
          // signal to fall through to a download attempt.
          generateForwardMessageContent(
            { key: { remoteJid: ctx.remoteJid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant },
              message: forwardable },
            true,
          );
          const destination = toOwner ? ownerJid : from;
          await sock.sendMessage(destination, { forward: { key: { remoteJid: ctx.remoteJid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant }, message: forwardable }, viewOnce: false });
          return Buffer.from('FORWARDED');
        },
      });
    }

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

    /**
     * ★ THE RE-UPLOAD ROUTE — different from the one that is dead.
     *
     * `requestPlaceholderResend` asks the phone to re-send a message the bot
     * never got, and refuses to do it for view-once (see the note at the bottom
     * of this file). `updateMediaMessage` is a different protocol: it sends a
     * MEDIA_RETRY stanza carrying the mediaKey and asks whichever device still
     * has the bytes to upload them again, returning a fresh directPath.
     *
     * Baileys only fires it from inside downloadMediaMessage, on one narrow
     * error path, which is why expired media usually just fails. Calling it
     * directly makes the retry happen for any node that has a mediaKey — the
     * case that matters here, because WhatsApp drops media from its servers
     * after a couple of weeks and this is the only way back.
     *
     * It needs a real mediaKey, so it is only worth attempting when there is
     * one. A stripped quote has nothing to retry.
     */
    const retryableNode = hasKey(quotedMedia) ? quotedMedia : hasKey(originalMedia) ? originalMedia : null;
    const retryableWhole = hasKey(quotedMedia) ? (inner || quoted) : original?.message;
    if (!buffer && retryableNode && typeof sock?.updateMediaMessage === 'function') {
      attempts.push({
        name: 'media retry request (updateMediaMessage)',
        run: async () => {
          const { downloadMediaMessage } = require('@whiskeysockets/baileys');
          // The request re-uploads on WhatsApp's side and rewrites directPath/url
          // on the node in place, so download AFTER it resolves.
          await sock.updateMediaMessage({
            key: { remoteJid: ctx.remoteJid, id: ctx.stanzaId, fromMe: false, participant: ctx.participant },
            message: retryableWhole,
          });
          return downloadMediaMessage({ key: { remoteJid: ctx.remoteJid, id: ctx.stanzaId }, message: retryableWhole }, 'buffer', {}, {});
        },
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

      /**
       * ★ THIS IS THE ERROR THE LIVE LOG SHOWED, THREE TIMES:
       *
       *   keys=["interactiveAnnotations","scanLengths","annotations","viewOnce"]
       *   directPath=MISSING url=MISSING mediaKey=MISSING
       *   routes=["… No valid media URL or directPath present in message" ×3]
       *
       * The old reply said "There is nothing left to unlock in that one" and
       * told the user it was permanent. It was neither: the stand-in is a
       * DEVICE-IDENTITY problem, and the media can still arrive. Queue it and
       * let viewOncePending deliver it when it does.
       */
      await queuePending();
      if (noUrl || noKey) return reply(WAITING_REPLY);
      return reply(`⏳ Could not fetch that media yet — I go try again when e land.\n\n_${all.slice(0, 240)}_`);
    }

    if (!buffer || !buffer.length) {
      return reply('❌ Downloaded nothing — WhatsApp returned an empty file. It may have expired.');
    }

    // The forward route relays the message itself, so there is nothing left to
    // send — replying again would post the same photo twice.
    if (buffer.length === 9 && buffer.toString() === 'FORWARDED') {
      console.log('[VV] delivered by forwarding the original node');
      if (toOwner) return reply('🔒 Sent privately to the owner. _This chat got only this notice._');
      return;
    }

    if (!toOwner) return sendHere(sock, from, msg, reply, type, buffer, media);

    /* ── explicit opt-in: deliver privately to the paired account ── */
    if (!ownerJid) {
      return reply('❌ I do not know the owner number for this session, so I cannot DM it.');
    }
    try {
      await sock.sendMessage(ownerJid, {
        ...payloadFor(type, buffer, media),
        caption: `🔓 *View-once unlocked*\n\n👤 ${msg.pushName || 'Unknown'}\n💬 ${from.endsWith('@g.us') ? 'Group' : 'DM'}\n📅 ${new Date().toLocaleString()}`,
      });
      return reply('🔒 Sent privately to the owner. _This chat got only this notice._');
    } catch (e) {
      return reply(`❌ Could not send to the owner (${e.message}).`);
    }
  },
};

function payloadFor(type, buffer, media = {}) {
  // A view-once served from the cache has no protocol node — only the bytes
  // and the metadata captured at arrival. Never assume `media` exists.
  media = media || {};
  if (type === 'image') return { image: buffer };
  if (type === 'video') return { video: buffer, mimetype: media.mimetype || 'video/mp4' };
  if (type === 'audio') {
    return {
      audio: buffer,
      mimetype: media.mimetype || 'audio/ogg; codecs=opus',
      ptt: media.ptt !== false,
    };
  }
  return {
    document: buffer,
    mimetype: media.mimetype || 'application/octet-stream',
    fileName: media.fileName || 'view-once',
  };
}


/**
 * ★ `.vv why` — diagnose instead of guessing.
 *
 * Every failure is one of three causes, and they need different actions from the
 * user. Printing raw route errors made them look identical.
 *
 * This has to be CALLED FIRST in the failure path. It was first written further
 * down, after three early returns, which made it unreachable — the same class of
 * bug that had `.vv` reply "I have this message but not the media" to items it
 * could actually have unlocked.
 */
function diagnose({ cached, original, quoted, quotedMedia, hasKey, failures, msg }) {
  const sawWrapper = Boolean(
    quoted?.viewOnceMessage || quoted?.viewOnceMessageV2 || quoted?.viewOnceMessageV2Extension,
  );
  const quotedHasKey = hasKey(quotedMedia);
  const looksLikeText = Boolean(
    quoted?.conversation || quoted?.extendedTextMessage,
  ) && !sawWrapper;

  const lines = [
    '🔬 *View-once diagnosis*',
    '',
    `• Bot received the item: ${original ? 'yes (stored)' : 'no'}`,
    `• Media bytes cached: ${cached ? 'yes' : 'no'}`,
    `• Quote carries a wrapper: ${sawWrapper ? 'yes' : 'no'}`,
    `• Quote carries media key: ${quotedHasKey ? 'yes' : 'no'}`,
    `• Sender: ${msg.pushName || 'unknown'}`,
    '',
  ];

  if (cached) {
    lines.push('➡️ The bytes are on disk but sending failed. That is a bug in the bot — report this.');
  } else if (looksLikeText) {
    lines.push(
      '➡️ *You replied to a normal message.* There is no view-once in that quote at all.',
      'Reply directly to the view-once item itself.',
    );
  } else if (!sawWrapper && !quotedHasKey) {
    lines.push(
      '➡️ *The quote has no view-once in it and no media key.*',
      'Reply directly to the view-once item, not the message underneath it.',
    );
  } else if (!quotedHasKey) {
    lines.push(
      '➡️ *The quote arrived stripped* — a `view_once_unavailable_fanout` stand-in.',
      '',
      'Since Nov 2026 WhatsApp only fanouts view-once media to ANDROID companions. ' +
        'A WEB/Chrome companion gets this keyless stub and nothing else — for your own ' +
        'view-once AND for other people’s alike.',
      '',
      'Set `DEVICE_IDENTITY=android` and re-pair once. The bot now auto-matches ' +
        '`creds.platform`, so a session already linked as Android fixes itself on restart.',
      '',
      '_This request is queued: if the media arrives in the next 90s it is posted automatically._',
    );
  } else {
    lines.push(
      '➡️ The quote HAS a key, but WhatsApp refused the download.',
      'The item has most likely expired on their servers — the request is queued in case it lands late.',
    );
  }
  lines.push('', `_${failures.length} download route(s) tried, 0 succeeded_`);
  return lines.join('\n');
}

async function sendHere(sock, from, msg, reply, type, buffer, media = {}) {
  /**
   * ★ Keep the sender's own caption.
   *
   * It used to be replaced outright by our unlock notice, so a view-once photo
   * that said "the address is..." arrived with no address. The notice moves to
   * the end where it does not bury anything.
   */
  const original = String(media?.caption || '').trim();
  const caption =
    (original ? `${original}\n\n` : '') +
    `🔓 *View-once unlocked*\n` +
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

/**
 * ★ The two routes worth documenting, because one of them does not work.
 *
 * `requestPlaceholderResend` — asking the phone to re-deliver a view-once that
 * the bot never received — was tested and abandoned by the reference
 * implementation of this feature (juniorkrz/stickerbot #88): the phone never
 * answered. Baileys 7.0.0-rc14 goes further and refuses to even send the
 * request for a view-once stanza:
 *
 *     unavailableType === 'view_once_unavailable_fanout'
 *       -> 'skipping placeholder resend for excluded unavailable type'
 *
 * That is deliberate: it mirrors WhatsApp Web, which does not request view-once
 * content from the phone either. So no amount of retrying gets the media from
 * WhatsApp to a companion device.
 *
 * The route that DOES work is NOT a download from a phone-supplied quote: it is
 * the DEVICE IDENTITY. Since WhatsApp's November 2026 update, view-once media
 * is fanned out to ANDROID-class companions and withheld from WEB/Chrome ones
 * (which get this `view_once_unavailable_fanout` stand-in). A real Android
 * companion receives the media node with mediaKey/url/directPath, so
 * `precacheMedia()` can capture it on arrival and `.vv` can unlock BOTH your
 * own and other people's view-once alike.
 *
 * Practical consequence: match the platform the session was linked as
 * (`creds.platform`) — see lib/deviceIdentity.js — and re-pair once if the
 * session is still a WEB companion. `lib/viewOncePending.js` then delivers the
 * item automatically if the media lands after the command was already typed.
 */
module.exports._internals = { payloadFor, sendHere };
