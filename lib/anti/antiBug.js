/**
 * Anti-bug — temporary flood guard + manual permanent block list
 *
 * A burst of messages is dropped for the current window only. It is NOT a
 * WhatsApp block and is NOT added to the permanent list. The owner receives one
 * identifiable, tappable notice per burst.
 *
 * Permanent entries are managed explicitly with `.antibug`; a fast typist
 * tripping the rate window never creates one.
 *
 * This protects against:
 *   - Message flooding
 *   - Bug attacks (malformed messages that crash WhatsApp)
 *   - Spam bots
 *   - Suspicious rapid-fire messages
 *
 * The bot owner is NEVER blocked.
 */

const fs = require('fs');
const path = require('path');
const mention = require('../mention');

const BLOCK_LIST_FILE = path.join(__dirname, '..', '..', 'antibug_blocks.json');

// Rate tracking: phoneNumber → [{ ts, count }]
const rateTracker = new Map();
const WINDOW_MS = 10000; // 10 seconds
const MAX_MSGS = 8; // Max 8 messages in 10s before the temporary drop
const NOTICE_COOLDOWN_MS = 30_000;
const noticeLast = new Map();

// Load blocked numbers
let blockedNumbers = [];
try {
  blockedNumbers = JSON.parse(fs.readFileSync(BLOCK_LIST_FILE, 'utf8') || '[]');
} catch { blockedNumbers = []; }

function saveBlockList() {
  try { fs.writeFileSync(BLOCK_LIST_FILE, JSON.stringify(blockedNumbers, null, 2)); } catch {}
}

function isBlocked(phoneNumber) {
  return blockedNumbers.includes(phoneNumber);
}

/** An @lid identity is not a phone number — blocking one would block nobody. */
function looksLikeLid(id) {
  const digits = String(id).replace(/\D/g, '');
  return digits.length > 13; // national numbers are <= 13 digits
}

function blockNumber(phoneNumber) {
  if (looksLikeLid(phoneNumber)) {
    console.log(`[ANTI-BUG] Not adding ${phoneNumber} to the block list — that is a @lid identity, not a phone number`);
    return;
  }
  if (!blockedNumbers.includes(phoneNumber)) {
    blockedNumbers.push(phoneNumber);
    saveBlockList();
    console.log(`[ANTI-BUG] 🚫 Blocked ${phoneNumber} permanently`);
  }
}

/**
 * Check if a message should be dropped (spam/flood).
 * Returns { blocked, temporary, permanent, reason }.
 */
function checkSpam(phoneNumber, isOwner) {
  // Never block the owner
  if (isOwner) return { blocked: false, reason: '' };

  // Check if already blocked
  if (isBlocked(phoneNumber)) {
    return {
      blocked: true, temporary: false, permanent: true, alreadyBlocked: true,
      reason: 'Already on the permanent block list',
    };
  }

  const now = Date.now();

  if (!rateTracker.has(phoneNumber)) {
    rateTracker.set(phoneNumber, { firstMsg: now, count: 1 });
    return { blocked: false, reason: '' };
  }

  const tracker = rateTracker.get(phoneNumber);
  const elapsed = now - tracker.firstMsg;

  if (elapsed < WINDOW_MS) {
    tracker.count++;

    if (tracker.count > MAX_MSGS) {
      // SPAM DETECTED — drop the burst, but do NOT permanently blacklist.
      // `blockNumber()` here meant a fast typist (or the owner on a second
      // device) got silently banned forever by their own bot, with the ban
      // written to a plaintext file. Throttling is temporary and self-healing;
      // a permanent block needs a human to ask for it.
      rateTracker.delete(phoneNumber);
      return {
        blocked: true, temporary: true, permanent: false,
        reason: `Rate limit: ${tracker.count} messages in ${elapsed}ms (temporary flood guard — nobody blocked)`,
      };
    }
  } else {
    // Reset the window
    rateTracker.set(phoneNumber, { firstMsg: now, count: 1 });
  }

  return { blocked: false, reason: '' };
}

/**
 * Handle an explicit/permanent WhatsApp block. Never call this for a temporary
 * rate-limit result: a burst is dropped, not banned.
 */
async function handleBlock(sock, phoneNumber, reason) {
  if (looksLikeLid(phoneNumber)) {
    // `46274514571441@s.whatsapp.net` is not a real number. Calling
    // updateBlockStatus on it is a no-op at best and can put the pairing at risk
    // at worst; the LID is logged so the cause is visible instead.
    console.log(`[ANTI-BUG] Refusing to block ${phoneNumber} — that is a @lid identity, not a phone number`);
    return;
  }
  try {
    const jid = `${phoneNumber}@s.whatsapp.net`;
    // Block on WhatsApp
    await sock.updateBlockStatus(jid, 'block');
    console.log(`[ANTI-BUG] 🚫 WhatsApp-blocked ${phoneNumber}: ${reason}`);

    // Notify owner
    const ownerNumber = phoneNumber; // We'll get the owner from session context
    // (Notification is sent by the caller who has the owner number)
  } catch (e) {
    console.warn('[ANTI-BUG] Block failed:', e.message);
  }
}

/**
 * Export block list for .antibug command
 */
function getBlockList() {
  return blockedNumbers;
}

/** Drop every entry. Exposed so a bad list can be cleared from chat. */
function clearBlocks() {
  const removed = blockedNumbers.slice();
  blockedNumbers = [];
  saveBlockList();
  return removed;
}

function unblockNumber(phoneNumber) {
  blockedNumbers = blockedNumbers.filter(n => n !== phoneNumber);
  saveBlockList();
}

/** One owner notice per sender per incident type, so a burst cannot spam DMs. */
function shouldNotify(senderNum, kind = 'temporary', now = Date.now()) {
  const key = `${kind}:${senderNum}`;
  const last = noticeLast.get(key) || 0;
  if (now - last < NOTICE_COOLDOWN_MS) return false;
  noticeLast.set(key, now);
  return true;
}

function safeDisplayName(pushName) {
  const name = String(pushName || '')
    .replace(/[\r\n*_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name && name !== 'User' ? name.slice(0, 60) : '';
}

/**
 * Build the owner-facing incident card. A real @tag requires BOTH the visible
 * `@digits` text and a matching JID in `mentions`; we return both.
 */
function formatIncident({
  senderJid, senderNum, pushName, chatJid, resolvedJid, reason, permanent = false,
}) {
  const raw = String(senderJid || senderNum || 'unknown');
  const resolved = resolvedJid && mention.tag(resolvedJid) ? resolvedJid : null;
  const identity = resolved || senderJid || senderNum;
  const tag = mention.tag(identity) || `@${senderNum || 'unknown'}`;
  const mentions = mention.mentions(identity);
  const display = safeDisplayName(pushName);
  const isGroup = String(chatJid || '').endsWith('@g.us');
  const where = isGroup ? `Group \`${chatJid}\`` : 'Private chat';
  const phone = resolved ? mention.digits(resolved) : null;
  const phoneLine = phone && phone !== senderNum
    ? `📇 *Phone:* @${phone} _(resolved from WhatsApp)_`
    : phone
      ? `📇 *Phone:* @${phone}`
      : '📇 *Phone:* _not supplied by WhatsApp; showing the linked ID_';
  const headline = permanent
    ? '🚫 *Permanent block — message dropped*'
    : '⏱️ *Temporary flood guard — message dropped*';
  const footer = permanent
    ? '_This sender is on the permanent block list._'
    : '_Nobody was blocked. This burst was dropped; normal messages resume after the window resets._';

  const text =
    `🛡️ *ANTI-BUG PROTECTION*\n\n` +
    `${headline}\n\n` +
    `👤 *Sender:* ${tag}${display ? ` — ${display}` : ''}\n` +
    `💬 *Where:* ${where}\n` +
    `🔎 *Raw ID:* \`${raw}\`\n` +
    `${phoneLine}\n` +
    `⚡ *Reason:* ${reason || 'Flood guard'}\n\n` +
    footer;
  return { text, mentions };
}

module.exports = {
  _internals: { looksLikeLid, shouldNotify, NOTICE_COOLDOWN_MS },
  checkSpam,
  handleBlock,
  isBlocked,
  blockNumber,
  unblockNumber,
  clearBlocks,
  getBlockList,
  formatIncident,
  shouldNotify,
  name: 'antibug',
  aliases: ['antibug', 'ab'],
  desc: 'Anti-bug protection (always on) — view/manage blocked numbers',
  category: 'anti',
  async execute({ sock, reply, args, dbSession }) {
    const action = args[0]?.toLowerCase();

    if (action === 'list') {
      if (blockedNumbers.length === 0) {
        return reply('🛡️ *Anti-Bug Protection*\n\n✅ No blocked numbers.\n\n_Bot is protected. Spammers are auto-blocked._');
      }
      let list = `🛡️ *Anti-Bug — Blocked Numbers (${blockedNumbers.length})*\n\n`;
      blockedNumbers.forEach((num, i) => {
        list += `${i + 1}. ${num}\n`;
      });
      return reply(list);
    }

    if (action === 'clear' || action === 'reset') {
      const removed = clearBlocks();
      return reply(
        `🧹 Cleared *${removed.length}* blocked entr${removed.length === 1 ? 'y' : 'ies'}.\n\n` +
          (removed.length ? `_Removed: ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? '…' : ''}_` : '_The list was already empty._'),
      );
    }

    if (action === 'unblock' && args[1]) {
      const num = args[1].replace(/\D/g, '');
      unblockNumber(num);
      try { await sock.updateBlockStatus(`${num}@s.whatsapp.net`, 'unblock'); } catch {}
      return reply(`✅ Unblocked ${num}`);
    }

    // Show status
    return reply(
      `🛡️ *ANTI-BUG PROTECTION*\n\n` +
      `🟢 *Status:* ACTIVE (always on)\n` +
      `🚫 *Blocked numbers:* ${blockedNumbers.length}\n` +
      `⚡ *Max messages:* ${MAX_MSGS} per ${WINDOW_MS / 1000}s\n\n` +
      `*Usage:*\n` +
      `  .antibug list → View blocked numbers\n` +
      `  .antibug unblock <number> → Unblock someone\n` +
      `  .antibug clear → Empty the whole list\n\n` +
      `_Floods are throttled, not banned. Nothing is blacklisted without you asking._`
    );
  },
};
