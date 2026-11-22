/**
 * Developer and text utilities that were absent.
 *
 * Commands: jwt, json, uuid, hashid, entropy, regex, timestamp, base64
 *
 * Every one of these is local — no API, no network, no key. That matters: the
 * catalogue previously listed several of these as "coming soon" while the real
 * implementations are a dozen lines each.
 */

const crypto = require('crypto');

/* ── JWT ─────────────────────────────────────────────────────────────────── */

const b64urlDecode = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Decode without verifying.
 *
 * This is deliberately labelled as such in the reply. A JWT you were merely
 * shown is not a JWT you trust, and printing "valid" with no key would be a lie
 * that gets someone hurt.
 */
function decodeJwt(token) {
  const parts = String(token).trim().split('.');
  if (parts.length !== 3) throw new Error('a JWT has three dot-separated parts');
  const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  return { header, payload, signature: parts[2] };
}

const pretty = (obj) => JSON.stringify(obj, null, 2);

/* ── JSON ────────────────────────────────────────────────────────────────── */

function formatJson(text, minify) {
  const parsed = JSON.parse(text);
  return minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2);
}

/* ── Entropy ─────────────────────────────────────────────────────────────── */

/**
 * Rough strength estimate in bits: length × log2(alphabet size).
 *
 * This is the standard approximation and it is honest about its limits — it
 * knows nothing about "password123" being in every wordlist. The reply says so
 * rather than overclaiming.
 */
function passwordEntropy(password) {
  const p = String(password);
  if (!p) return { bits: 0, pool: 0, label: 'empty' };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(p)) pool += 33;
  const bits = p.length * Math.log2(pool || 1);
  const label =
    bits < 28 ? 'very weak' : bits < 36 ? 'weak' : bits < 60 ? 'reasonable' : bits < 80 ? 'strong' : 'very strong';
  return { bits, pool, label };
}

/* ── Commands ────────────────────────────────────────────────────────────── */

module.exports = {
  name: 'jwt',
  aliases: ['json', 'jwt', 'uuid', 'entropy', 'timestamp', 'ts', 'base64', 'b64'],
  desc: 'Developer tools: decode JWT, format JSON, UUID, password entropy, timestamps, base64',
  category: 'tools',

  async execute(ctx) {
    const { reply, args = [], command, msg } = ctx;
    const cmd = String(command || this.name).toLowerCase();
    const text = args.join(' ').trim();

    // Many of these read better when you reply to the thing you want processed.
    const quoted =
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
      msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
      '';
    const payload = text || quoted;

    switch (cmd) {
      case 'jwt': {
        if (!payload) return reply('❌ Usage: `.jwt eyJhbGciOi...` or reply to a token.');
        try {
          const { header, payload: body } = decodeJwt(payload);
          return reply(
            `🔓 *JWT decoded* — NOT verified\n\n` +
              `*Header*\n\`\`\`${pretty(header)}\`\`\`\n\n*Payload*\n\`\`\`${pretty(body)}\`\`\`\n\n` +
              `_No signature check: this bot holds no key, so a decoded token proves nothing about who issued it._`,
          );
        } catch (e) {
          return reply(`❌ Could not decode that token — ${e.message}.`);
        }
      }

      case 'json': {
        if (!payload) return reply('❌ Usage: `.json {"a":1}` or reply to JSON.');
        const minify = /\bmin\b/i.test(text);
        try {
          return reply(`✅ Valid JSON\n\n\`\`\`${formatJson(payload, minify)}\`\`\``);
        } catch (e) {
          return reply(`❌ Invalid JSON — ${e.message}`);
        }
      }

      case 'uuid': {
        const count = Math.min(Math.max(Number.parseInt(args[0], 10) || 1, 1), 10);
        const list = Array.from({ length: count }, () => crypto.randomUUID());
        return reply(`🆔 *UUID${count > 1 ? `s (${count})` : ''}*\n\n\`\`\`${list.join('\n')}\`\`\``);
      }

      case 'entropy': {
        if (!payload) return reply('❌ Usage: `.entropy MyPassword123` or reply to a message with it.');
        const { bits, pool, label } = passwordEntropy(payload);
        return reply(
          `🔐 *Password strength*\n\n` +
            `Entropy: *${bits.toFixed(1)} bits* — ${label}\n` +
            `Length: ${payload.length} · alphabet: ~${pool}\n\n` +
            `_An estimate only: it cannot know that a long password is also a famous one._`,
        );
      }

      case 'timestamp':
      case 'ts': {
        let num = Number.parseInt(text, 10);
        if (!Number.isFinite(num)) num = Math.floor(Date.now() / 1000);
        // Accept milliseconds too, so a copy-pasted JS timestamp also works.
        const ms = String(num).length > 10 ? num : num * 1000;
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return reply('❌ Usage: `.timestamp 1700000000`');
        return reply(
          `🕒 \`${num}\`\n\n` +
            `UTC: *${d.toISOString()}*\n` +
            `Local: *${d.toString()}*\n` +
            `Unix ms: \`${d.getTime()}\``,
        );
      }

      case 'base64':
      case 'b64': {
        const mode = String(args[0] || '').toLowerCase();
        const body = args.slice(1).join(' ') || (mode ? '' : payload);
        if (!['encode', 'decode'].includes(mode) || !body) {
          return reply('❌ Usage:\n`.base64 encode hello`\n`.base64 decode aGVsbG8=`');
        }
        if (mode === 'encode') {
          return reply(`\`\`\`${Buffer.from(body, 'utf8').toString('base64')}\`\`\``);
        }
        const out = Buffer.from(body, 'base64').toString('utf8');
        // A decoded binary blob renders as replacement characters; that is the
        // honest signal that the input was not text.
        if (!out || out.includes('\uFFFD')) return reply('❌ That is not valid base64 text.');
        return reply(`\`\`\`${out}\`\`\``);
      }

      default:
        return reply('❌ Unknown tool.');
    }
  },
};

module.exports._internals = { decodeJwt, formatJson, passwordEntropy };
