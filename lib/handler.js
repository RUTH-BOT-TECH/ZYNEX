/**
 * ZYNEX-MD — Message handler + command router (multi-user)
 *
 * Each call receives a `dbSession` (the BotSession DB record) so commands
 * can read the user's prefix + settings.
 */

const fs = require('fs');
const path = require('path');

const { BOT_NAME } = require('./botInfo');
const { createFakeContact } = require('./createFakeContact');
const hints = require('./commandHint');

// Load commands dynamically
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');
const antiDir = path.join(__dirname, 'anti');

function loadCommands() {
  commands.clear();

  // 1. Load regular commands from lib/commands/
  if (fs.existsSync(commandsDir)) {
    for (const file of fs.readdirSync(commandsDir)) {
      if (!file.endsWith('.js')) continue;
      try {
        const cmd = require(path.join(commandsDir, file));
        if (cmd && cmd.name && cmd.execute) {
          commands.set(cmd.name.toLowerCase(), cmd);
          if (Array.isArray(cmd.aliases)) {
            for (const alias of cmd.aliases) {
              commands.set(alias.toLowerCase(), cmd);
            }
          }
        }
      } catch (e) {
        console.error(`[HANDLER] Failed to load ${file}:`, e.message);
      }
    }
  }

  // 2. Also load command-style exports from lib/anti/ (e.g. .antidelete, .anticall)
  //    These modules export both a check/handle function AND a command (name+execute)
  if (fs.existsSync(antiDir)) {
    for (const file of fs.readdirSync(antiDir)) {
      if (!file.endsWith('.js')) continue;
      try {
        const mod = require(path.join(antiDir, file));
        if (mod && mod.name && mod.execute) {
          // Avoid duplicates (if a command with this name already exists)
          if (commands.has(mod.name.toLowerCase())) continue;
          commands.set(mod.name.toLowerCase(), mod);
          if (Array.isArray(mod.aliases)) {
            for (const alias of mod.aliases) {
              if (!commands.has(alias.toLowerCase())) {
                commands.set(alias.toLowerCase(), mod);
              }
            }
          }
        }
      } catch (e) {
        // Anti-module failed to load — non-fatal
      }
    }
  }

  // 3. Merge the dynamic registry: 1,916 catalogue names via engines.
  //    Hand-written files win; engines fill the gaps; unknown names answer honestly.
  try {
    const registry = require('./registry');
    let engineLinked = 0;
    for (const entry of registry.list()) {
      if (entry.source !== 'engine') continue;
      const key = entry.name.toLowerCase();
      if (commands.has(key)) continue; // a real file already owns this name
      const full = registry.get(entry.name);
      commands.set(key, {
        name: entry.name,
        desc: entry.desc,
        category: entry.category,
        execute: (ctx) => full.execute(ctx),
      });
      engineLinked++;
    }
    global.__REGISTRY_STATS__ = registry.stats;
    console.log(`[HANDLER] Registry: ${engineLinked} engine-backed commands linked`);
  } catch (e) {
    console.warn('[HANDLER] Registry not loaded:', e.message);
  }

  console.log(`[HANDLER] Loaded ${commands.size} command aliases`);
}

loadCommands();

/**
 * Main message handler — now accepts dbSession for per-user settings
 * Respects private/public mode:
 *   - "public" (default): bot responds to everyone
 *   - "private": bot only responds to the owner (the user who paired)
 */
async function handleMessage(sock, msg, dbSession) {
  const text = extractText(msg);
  if (!text) return;

  // Use the user's own prefix (from DB)
  const prefix = dbSession?.prefix || process.env.PREFIX || '.';
  // Engines still write example commands as `*.menu*`. Re-write only known
  // command hints to the session's prefix; URLs/decimals are untouched.
  const hint = (t) => hints.withPrefix(t, prefix);

  /**
   * Engines and hand-written commands often call `sock.sendMessage()` directly
   * instead of `reply()`. Wrap the socket once so those payloads get the same
   * prefix-aware hints and explicit linkPreview:false as reply() does. Method
   * lookups are bound back to the real socket so Baileys' internals still work.
   */
  const commandSock = new Proxy(sock, {
    get(target, prop, receiver) {
      if (prop === 'sendMessage') {
        return (jid, payload, options) => {
          let p = payload;
          if (p && typeof p === 'object' && !Buffer.isBuffer(p)) {
            p = { ...p };
            if (typeof p.text === 'string') {
              p.text = hint(p.text);
              p.linkPreview = false;
            }
            if (typeof p.caption === 'string') p.caption = hint(p.caption);
          }
          return target.sendMessage(jid, p, options);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  // Log every message we receive (helps debug "bot not responding")
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderJid.split('@')[0].split(':')[0];
  const chatType = msg.key.remoteJid.endsWith('@g.us') ? 'GROUP' : 'DM';
  console.log(`[MSG] ${chatType} from ${senderNum}: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}" | prefix=${prefix} | mode=${dbSession?.mode || 'public'}`);

  // No prefix → let the games engine claim it if a quiz is waiting.
  // (quiz answers, wordle guesses, hangman letters arrive as plain chat)
  if (!text.startsWith(prefix)) {
    if (text.trim().length > 0 && text.trim().length < 200) {
      try {
        const gamesEngine = require('./engines/games');
        if (typeof gamesEngine.handleFreeText === 'function') {
          const claimed = await gamesEngine.handleFreeText({
            text: text.trim(),
            from: msg.key.remoteJid,
            sender: senderJid,
            msg,
            sock,
            reply: (t) => sock.sendMessage(
              msg.key.remoteJid,
              { text: hint(String(t)), linkPreview: false },
              { quoted: createFakeContact(msg) },
            ),
          });
          if (claimed) {
            console.log(`[MSG] → Free-text answer consumed by games engine`);
            return;
          }
        }
      } catch (e) {
        console.error('[MSG] free-text handler failed:', e.message);
      }
    }
    return;
  }

  const body = text.slice(prefix.length).trim();
  if (!body) return;

  const [cmdName, ...args] = body.split(/\s+/);
  const command = commands.get(cmdName.toLowerCase());

  // Unknown command → tell the user (don't just silently return)
  if (!command) {
    console.log(`[MSG] Unknown command: ${prefix}${cmdName}`);
    try {
      await sock.sendMessage(msg.key.remoteJid, {
        text: `❓ *Unknown command:* ${prefix}${cmdName}\n\nType *${prefix}menu* to see all available commands.`,
        linkPreview: false,
      }, { quoted: createFakeContact(msg) });
    } catch {}
    return;
  }

  // PRIVATE MODE: only the owner (the user who paired) can use commands.
  //
  // This used to `return` silently, which reads as "the bot is dead" to everyone
  // else — no reply, no reason, nothing in the chat. Silent rejection is the one
  // thing this project does not do, so non-owners now get one short notice and
  // the log names exactly why they were turned away.
  if (dbSession?.mode === 'private') {
    // `senderNum` already has the :device suffix stripped, and so does
    // dbSession.phoneNumber — comparing raw JIDs here would never match under
    // multi-device and would lock the owner out of their own bot.
    const me = sock.user || {};
    const norm = (v) => String(v || '').split('@')[0].split(':')[0];
    const ownerIds = new Set(
      [dbSession.phoneNumber, me.id, me.lid, me.phoneNumber].filter(Boolean).map(norm),
    );
    const ownerNumber = norm(dbSession.phoneNumber);
    const senderNumber = norm(senderNum);
    const isOwnerSender =
      ownerIds.has(senderNumber) || msg.key.fromMe === true;
    if (!ownerNumber) {
      console.log('[MSG] private mode set but this session has no phoneNumber — allowing');
    } else if (!isOwnerSender) {
      console.log(`[MSG] Ignored (private mode: ${senderNumber} != owner ${ownerNumber})`);
      try {
        await sock.sendMessage(
          msg.key.remoteJid,
          {
            text: hint(
              '🔒 *This bot is in private mode.*\n\n' +
              'Only its owner can use commands right now. Nothing is broken — ' +
              'the owner can switch it back with `.public`.'),
            linkPreview: false,
          },
          { quoted: createFakeContact(msg) },
        );
      } catch {
        /* if this fails there is nothing else to do */
      }
      return;
    }
  }

  console.log(`[MSG] → Running command: ${prefix}${cmdName}`);

  // Mark message as read
  try { await sock.readMessages([msg.key]); } catch {}

  // Set typing indicator
  try { await sock.sendPresenceUpdate('composing', msg.key.remoteJid); } catch {}

  try {
    // Mentioned jids can live on the message itself or on the quote.
    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.audioMessage?.contextInfo ||
      msg.message?.documentMessage?.contextInfo ||
      msg.message?.stickerMessage?.contextInfo ||
      {};

    const senderJid = msg.key.participant || msg.key.remoteJid;
    const senderNumber = String(senderJid).split('@')[0].split(':')[0];
    const ownerNumbers = String(process.env.OWNER_NUMBER || '')
      .split(',')
      .map((x) => x.replace(/[^\d]/g, ''))
      .filter(Boolean);

    const result = await command.execute({
      sock: commandSock,
      msg,
      m: msg,                       // alias: several engines destructure `m`
      command: cmdName,
      args,
      argString: args.join(' '),    // alias: group/info/islamic read this
      text: body,
      fullText: text,
      from: msg.key.remoteJid,
      sender: senderJid,
      // personal engine keys reminders/bookmarks to the USER, not the chat
      senderJid,
      isGroup: msg.key.remoteJid.endsWith('@g.us'),
      pushName: msg.pushName || 'User',
      botName: BOT_NAME,
      prefix,
      dbSession,
      sessionId: dbSession?.id,
      // mentioned jids and the message author's jid, as read by pickTarget()
      mentionedJid: contextInfo.mentionedJid || [],
      participant: senderJid,
      isOwner: ownerNumbers.includes(senderNumber),
      reply: async (text, options) => {
        /*
         * ★ Every reply opts out of link previews explicitly.
         *
         * We already pass `linkPreview: false` at makeWASocket, but Baileys
         * checks for previews further in — in generateLinkPreviewIfRequired,
         * which reads generateWAMessage's own getUrlInfo, not the socket
         * option. Any reply containing a URL therefore still ran the preview
         * path, which dynamically imports `link-preview-js`. That package is
         * not installed, so each URL-bearing reply logged:
         *
         *   [INFO] url generation failed ... ERR_MODULE_NOT_FOUND
         *
         * The message still sent (Baileys catches and continues), which is why
         * this was easy to miss — it is pure noise in the log and a wasted
         * 3-second fetch attempt on every menu containing a link.
         *
         * `linkPreview: false` here is the flag generateWAMessageContent reads.
         */
        return await sock.sendMessage(
          msg.key.remoteJid,
          { text: hint(text), linkPreview: false, ...options },
          { quoted: createFakeContact(msg) },
        );
      },
      replyWithImage: async (imageBuffer, caption) => {
        return await sock.sendMessage(msg.key.remoteJid,
          { image: imageBuffer, caption: hint(caption), linkPreview: false }, { quoted: createFakeContact(msg) });
      },
      replyWithSticker: async (stickerBuffer) => {
        return await sock.sendMessage(msg.key.remoteJid, { sticker: stickerBuffer }, { quoted: createFakeContact(msg) });
      },
      replyWithAudio: async (audioBuffer) => {
        return await sock.sendMessage(msg.key.remoteJid, { audio: audioBuffer, mimetype: 'audio/mpeg' }, { quoted: createFakeContact(msg) });
      },

      /**
       * Download the media the message is about: the image/video/document/audio
       * attached to the message itself, or the one it is quoting.
       *
       * This was missing entirely, which meant every media command crashed with
       * "ctx.download is not a function" in production — the test suites injected
       * their own `download` and never caught it. `no-dead-commands` looked fine
       * because those paths reply with an error string rather than throwing.
       */
      /**
       * getQuotedImage — the overlay engine's documented fallback for reading
       * the photo a command replied to. ctx.download already exists, but an
       * engine that asks for this by name must not get `undefined` and crash.
       */
      getQuotedImage: async () => {
        const quoted =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
          msg.message?.imageMessage?.contextInfo?.quotedMessage ||
          msg.message?.videoMessage?.contextInfo?.quotedMessage;
        const content = quoted || msg.message || {};
        const isSticker = Boolean(content.stickerMessage);
        const node = content.imageMessage || content.stickerMessage;
        if (!node) throw new Error('reply to a photo with this command');
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const stream = await downloadContentFromMessage(node, isSticker ? 'sticker' : 'image');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (!buf.length) throw new Error('that photo could not be downloaded');
        return buf;
      },

      download: async () => {
        const quoted =
          msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
          msg.message?.imageMessage?.contextInfo?.quotedMessage ||
          msg.message?.videoMessage?.contextInfo?.quotedMessage;
        const source = quoted || msg.message;
        const kind = source?.imageMessage
          ? 'imageMessage'
          : source?.videoMessage
            ? 'videoMessage'
            : source?.audioMessage
              ? 'audioMessage'
              : source?.documentMessage
                ? 'documentMessage'
                : source?.stickerMessage
                  ? 'stickerMessage'
                  : null;

        if (!kind) {
          throw new Error('no media in this message — reply to an image, video, audio or document');
        }

        // Baileys needs a message object carrying the key it will decrypt with.
        const target = quoted
          ? {
              key: {
                remoteJid: msg.key.remoteJid,
                id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId ||
                    msg.message?.imageMessage?.contextInfo?.stanzaId ||
                    msg.message?.videoMessage?.contextInfo?.stanzaId,
                fromMe: false,
                participant: msg.message?.extendedTextMessage?.contextInfo?.participant ||
                             msg.message?.imageMessage?.contextInfo?.participant ||
                             msg.message?.videoMessage?.contextInfo?.participant,
              },
              message: quoted,
            }
          : msg;

        const { downloadMediaMessage } = require('@whiskeysockets/baileys');
        const buffer = await downloadMediaMessage(
          target,
          'buffer',
          {},
          { logger: sock.logger, reuploadRequest: sock.updateMediaMessage },
        );
        if (!buffer || !buffer.length) throw new Error('download returned no data');
        return buffer;
      },
    });

    // Increment per-user command count (JSON db supports this via update)
    if (dbSession) {
      try {
        const { prisma } = require('./db');
        await prisma.botSession.update({
          where: { id: dbSession.id },
          data: {
            commandsExecuted: (dbSession.commandsExecuted || 0) + 1,
            lastActiveAt: new Date().toISOString(),
          },
        });
      } catch (e) {
        // Non-fatal — don't break the user's command
        console.warn(`[HANDLER] Failed to update stats for ${dbSession.id}:`, e.message);
      }
    }
    /**
     * ★ A returned artefact must be SENT.
     *
     * Commands that produce media return { image } / { audio } / { video }
     * instead of calling reply, because the engine does not own the socket.
     * The handler previously discarded the return value, so those commands ran,
     * did the work, and delivered nothing — with no error anywhere. Anything
     * returned here is now delivered explicitly.
     */
    if (result && typeof result === 'object') {
      const send = async (payload) => {
        try {
          return await sock.sendMessage(msg.key.remoteJid, payload, { quoted: createFakeContact(msg) });
        } catch (e) {
          console.error(`[CMD:${cmdName}] returned artefact failed to send:`, e.message);
          await sock.sendMessage(msg.key.remoteJid, {
            text: hint(`⚠️ *${cmdName}* produced a result but sending it failed:\n${e.message}`),
            linkPreview: false,
          }, { quoted: createFakeContact(msg) }).catch(() => {});
        }
      };
      if (Buffer.isBuffer(result.image)) await send({ image: result.image, caption: hint(result.caption) });
      else if (Buffer.isBuffer(result.video)) await send({ video: result.video, caption: hint(result.caption), ...(result.gifPlayback ? { gifPlayback: true } : {}) });
      else if (Buffer.isBuffer(result.audio)) await send({ audio: result.audio, mimetype: result.mimetype || 'audio/mpeg', ptt: !!result.ptt });
      else if (Buffer.isBuffer(result.sticker)) await send({ sticker: result.sticker });
      else if (typeof result.text === 'string' && result.text.trim()) await send({ text: hint(result.text), linkPreview: false });
    }

    console.log(`[MSG] ✓ Command ${prefix}${cmdName} completed`);
  } catch (e) {
    console.error(`[CMD:${cmdName}] Error:`, e);
    try {
      await sock.sendMessage(msg.key.remoteJid, {
        text: hint(`❌ *Error running ${cmdName}*\n\n${e.message || e}`),
        linkPreview: false,
      }, { quoted: createFakeContact(msg) });
    } catch {}
  } finally {
    try { await sock.sendPresenceUpdate('paused', msg.key.remoteJid); } catch {}
  }
}

function extractText(msg) {
  if (!msg.message) return '';
  if (msg.message.conversation) return msg.message.conversation;
  if (msg.message.extendedTextMessage?.text) return msg.message.extendedTextMessage.text;
  if (msg.message.imageMessage?.caption) return msg.message.imageMessage.caption;
  if (msg.message.videoMessage?.caption) return msg.message.videoMessage.caption;
  return '';
}

/**
 * Anti-command router — uses per-session settings
 */
async function handleAnti(sock, msg, dbSession) {
  const antiModules = ['antiLink', 'antiBot', 'antiSpam', 'antiBadword'];
  for (const mod of antiModules) {
    try {
      const anti = require(`./anti/${mod}`);
      if (anti.check) await anti.check(sock, msg, dbSession);
    } catch {
      // Module not loaded
    }
  }
}

/**
 * Describe what we can honestly claim: real files + engine-backed names.
 * Fallback catalogue names are deliberately excluded from the menu.
 */
function getCommandsList() {
  const seen = new Set();
  const list = [];
  for (const [alias, cmd] of commands.entries()) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    list.push({ name: cmd.name, aliases: cmd.aliases || [], desc: cmd.desc || '', category: cmd.category || 'misc' });
  }
  return list;
}

module.exports = { handleMessage, handleAnti, getCommandsList, loadCommands };
