/**
 * Anti-delete — Stores all messages and restores deleted ones
 *
 * When a message is deleted (by sender or admin), the original content
 * is re-sent to the chat with a "🚫 Anti-Delete" header.
 *
 * Also forwards deleted messages to the bot owner's DM.
 *
 * Per-user setting: dbSession.antiDelete (default true)
 *   .antidelete on   → enable
 *   .antidelete off  → disable
 */

const fs = require('fs');
const path = require('path');

const messageStore = new Map();
const MAX_STORED = 2000;

/**
 * ★ Persist the message store across restarts.
 *
 * This lived only in memory. That is fatal for view-once recovery, because the
 * ONE thing that makes a quoted view-once downloadable is having kept the
 * original stanza — WhatsApp strips `mediaKey` from the quote, so the stored
 * copy is the only way in. Every redeploy emptied the Map and turned `.vv` on
 * every existing message into "original=not-stored".
 *
 * Why this was so hard to spot: it worked in testing and failed in production,
 * and the difference was not the code — it was that the process had restarted
 * in between. Eight deploys in an hour meant the store was almost always empty
 * by the time a command ran.
 *
 * Serialised with a protobuf-aware path rather than plain JSON. Baileys carries
 * `mediaKey`, `fileEncSha256` and `fileSha256` as Buffers/Uint8Arrays, and
 * JSON.stringify turns those into {"0":12,"1":240,...} objects that no longer
 * decrypt. Storing the *raw protobuf bytes* avoids the whole class of problem —
 * `proto.Message.encode` keeps every field exactly as received.
 */
const STORE_DIR = () => {
  const root = process.env.AUTH_DIR_ROOT || path.join(__dirname, '..', '..', 'auth_state');
  const dir = path.join(root, '.msg_store');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
};
const STORE_FILE = () => path.join(STORE_DIR(), 'store.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h, same as the reference implementation

let saveTimer = null;
let dirty = false;

/** Serialise one WebMessageInfo to base64 protobuf, falling back to JSON. */
function encodeEntry(entry) {
  try {
    const { proto } = require('@whiskeysockets/baileys');
    const bytes = proto.Message.encode(entry.msg.message || {}).finish();
    return {
      id: entry.msg.key.id,
      at: entry.storedAt,
      key: entry.msg.key,
      pushName: entry.msg.pushName || null,
      messageTimestamp: entry.msg.messageTimestamp || null,
      pb: Buffer.from(bytes).toString('base64'),
    };
  } catch {
    // Last resort: plain JSON. Media keys may not survive, but text and
    // anti-delete still work — better a degraded entry than a lost message.
    return { id: entry.msg.key.id, at: entry.storedAt, key: entry.msg.key, raw: entry.msg };
  }
}

function decodeEntry(e) {
  try {
    if (e.pb) {
      const { proto } = require('@whiskeysockets/baileys');
      const message = proto.Message.decode(Buffer.from(e.pb, 'base64'));
      return { msg: { key: e.key, message, pushName: e.pushName, messageTimestamp: e.messageTimestamp }, storedAt: e.at };
    }
    if (e.raw) return { msg: e.raw, storedAt: e.at };
  } catch {}
  return null;
}

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_FILE(), 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return 0;
    const now = Date.now();
    let n = 0;
    for (const e of arr) {
      if (!e || now - (e.at || 0) > MAX_AGE_MS) continue;
      const decoded = decodeEntry(e);
      if (decoded) { messageStore.set(e.id, decoded); n++; }
    }
    console.log(`[STORE] restored ${n} message(s) from disk`);
    return n;
  } catch (e) {
    if (e.code !== 'ENOENT') console.log(`[STORE] could not restore: ${e.message}`);
    return 0;
  }
}

/** Debounced write — the message path must not block on disk. */
function persistSoon() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      const now = Date.now();
      const out = [];
      for (const [id, entry] of messageStore) {
        if (now - entry.storedAt > MAX_AGE_MS) continue;
        out.push(encodeEntry({ ...entry, msg: { ...entry.msg, key: { ...entry.msg.key, id } } }));
      }
      fs.writeFileSync(STORE_FILE(), JSON.stringify(out));
    } catch (e) {
      console.log(`[STORE] could not persist: ${e.message}`);
    }
  }, 2000);
  if (saveTimer.unref) saveTimer.unref();
}

async function storeMessage(msg) {
  if (!msg.key || !msg.key.id) return;
  // Store ALL messages — including fromMe (owner's own messages can be deleted too)
  if (messageStore.size >= MAX_STORED) {
    const firstKey = messageStore.keys().next().value;
    messageStore.delete(firstKey);
  }
  messageStore.set(msg.key.id, {
    msg,
    storedAt: Date.now(),
  });
  persistSoon();
}

// Restore on load so `.vv` survives a restart.
loadStore();

/**
 * Extract readable description from a stored message
 */
function describeMessage(msg) {
  if (!msg?.message) return '[no content]';
  const m = msg.message;

  if (m.conversation) return `💬 Text: ${m.conversation.slice(0, 500)}`;
  if (m.extendedTextMessage?.text) return `💬 Text: ${m.extendedTextMessage.text.slice(0, 500)}`;
  if (m.imageMessage) return `🖼️ Image${m.imageMessage.caption ? ` (caption: ${m.imageMessage.caption})` : ''}`;
  if (m.videoMessage) return `🎬 Video${m.videoMessage?.caption ? ` (caption: ${m.videoMessage.caption})` : ''}`;
  if (m.stickerMessage) return '🎨 Sticker';
  if (m.audioMessage) return '🎵 Audio';
  if (m.voiceMessage) return '🎤 Voice note';
  if (m.documentMessage) return `📄 Document: ${m.documentMessage.fileName || 'unknown'}`;
  if (m.contactMessage) return `👤 Contact: ${m.contactMessage.displayName || 'unknown'}`;
  if (m.locationMessage) return `📍 Location: ${m.locationMessage.degreesLatitude || ''},${m.locationMessage.degreesLongitude || ''}`;
  if (m.liveLocationMessage) return '📍 Live location';

  return `[${Object.keys(m).join(', ') || 'unknown'}]`;
}

async function handleAntiDelete(sock, update, sessionId) {
  console.log('[ANTI-DELETE] Update received:', JSON.stringify({
    hasKey: !!update?.key,
    keyId: update?.key?.id,
    hasUpdate: !!update?.update,
    updateKeys: update?.update ? Object.keys(update.update) : [],
  }));

  // Anti-delete is ON by default. Disable via .antidelete off or env ANTI_DELETE=false
  if (process.env.ANTI_DELETE === 'false') {
    console.log('[ANTI-DELETE] Disabled by env');
    return;
  }

  // Load dbSession to check per-user setting
  let dbSession = null;
  let ownerNumber = null;
  if (sessionId) {
    try {
      const { prisma } = require('../db');
      dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
      if (dbSession?.antiDelete === false) {
        console.log(`[ANTI-DELETE] Disabled for session ${sessionId}`);
        return;
      }
      ownerNumber = dbSession?.phoneNumber;
    } catch (e) {
      console.warn('[ANTI-DELETE] Failed to load session:', e.message);
    }
  }

  const { key, update: updateData } = update;
  if (!key?.id) {
    console.log('[ANTI-DELETE] No key.id — skipping');
    return;
  }

  // Check if this is a deletion event
  // Baileys sends protocolMessage with type 0 (REVOKE) when a message is deleted
  if (!updateData?.message?.protocolMessage) {
    console.log('[ANTI-DELETE] No protocolMessage — not a delete event');
    return;
  }

  const protoMsg = updateData.message.protocolMessage;
  console.log('[ANTI-DELETE] Protocol message type:', protoMsg.type);

  // Type 0 = REVOKE (message deleted)
  // Some Baileys versions use type 15 for revoke as well — accept both
  if (protoMsg.type !== 0 && protoMsg.type !== 15) {
    console.log(`[ANTI-DELETE] Type ${protoMsg.type} is not a delete event — skipping`);
    return;
  }

  const stored = messageStore.get(key.id);
  if (!stored) {
    console.log(`[ANTI-DELETE] Message ${key.id} not in store (already evicted or never stored)`);
    return;
  }

  const original = stored.msg;
  const who = key.participant || key.remoteJid;
  const whoNum = who.split('@')[0].split(':')[0];
  const isGroup = key.remoteJid.endsWith('@g.us');

  console.log(`[ANTI-DELETE] Recovering message ${key.id} from ${whoNum}`);

  const description = describeMessage(original);
  const header = `🚫 *ANTI-DELETE*\n\n👤 *Deleted by:* @${whoNum}\n💬 *Chat:* ${isGroup ? 'group' : 'DM'}\n\n*Original content:*\n${description}`;

  // 1. Re-send to the same chat
  try {
    await sock.sendMessage(key.remoteJid, {
      text: header,
      mentions: [who],
    });
    console.log('[ANTI-DELETE] ✓ Re-sent text to chat');

    // 2. If original had text content, send it as a separate message (so it's copyable)
    const text = original.message?.conversation || original.message?.extendedTextMessage?.text;
    if (text && text.length > 0) {
      await sock.sendMessage(key.remoteJid, {
        text: `📝 *Original text:*\n${text}`,
      });
    }
  } catch (e) {
    console.warn('[ANTI-DELETE] Failed to restore to chat:', e.message);
  }

  // 3. Forward to the owner's DM (if owner is set and not the same chat)
  if (ownerNumber && key.remoteJid !== `${ownerNumber}@s.whatsapp.net`) {
    try {
      const ownerJid = `${ownerNumber}@s.whatsapp.net`;
      const ownerHeader = `🚫 *ANTI-DELETE*\n\n👤 *Deleted by:* @${whoNum}\n💬 *From:* ${key.remoteJid}\n\n*Original content:*\n${description}`;
      await sock.sendMessage(ownerJid, {
        text: ownerHeader,
        mentions: [who],
      });
      const text = original.message?.conversation || original.message?.extendedTextMessage?.text;
      if (text) {
        await sock.sendMessage(ownerJid, { text: `📝 *Original text:*\n${text}` });
      }
      console.log(`[ANTI-DELETE] ✓ Forwarded to owner ${ownerNumber}`);
    } catch (e) {
      console.warn('[ANTI-DELETE] Failed to forward to owner:', e.message);
    }
  }

  // Remove from store to avoid duplicate recovery
  messageStore.delete(key.id);
}

/**
 * Look a message up by id. Used by .vv to recover the ORIGINAL stanza: a quoted
 * message arrives stripped of its media key (WhatsApp sends only the wrapper
 * without `mediaKey`), so downloading from the quote alone fails with
 * "Cannot derive from empty media key" — Baileys issue #2907.
 */
function getStoredMessage(id) {
  return messageStore.get(id)?.msg || null;
}

module.exports = {
  handleAntiDelete,
  storeMessage,
  getStoredMessage,
  name: 'antidelete',
  aliases: ['antidelete', 'ad'],
  desc: 'Toggle anti-delete (on/off) for your bot',
  category: 'anti',
  async execute({ reply, args, dbSession }) {
    if (!dbSession) return reply('❌ No session record.');
    const action = args[0]?.toLowerCase();
    let newValue;
    if (action === 'on') newValue = true;
    else if (action === 'off') newValue = false;
    else {
      return reply(
        `📝 *Anti-Delete is currently:* ${dbSession.antiDelete === false ? '🔴 OFF' : '🟢 ON'}\n\n` +
        `*Usage:* \`.antidelete on\` or \`.antidelete off\`\n\n` +
        `_When ON, deleted messages are recovered and shown in the chat + forwarded to your DM._`
      );
    }
    try {
      const { prisma } = require('../db');
      await prisma.botSession.update({
        where: { id: dbSession.id },
        data: { antiDelete: newValue },
      });
      await reply(`✅ *Anti-Delete is now ${newValue ? '🟢 ON' : '🔴 OFF'}*`);
    } catch (e) {
      await reply(`❌ Failed: ${e.message}`);
    }
  },
};
