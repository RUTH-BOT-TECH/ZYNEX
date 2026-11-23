/**
 * lib/engines/personal.js — per-user saved things: bookmarks, saved messages,
 * reminders, todos.
 *
 * Ported from NOVA_MD's misc plugins (bookmark, bookmarks, savemsg, savedmsgs,
 * remind(er), reminders, delreminder, todo, donetodo) and rewritten CommonJS.
 *
 * ★ PERSISTENCE, and why this file does not copy economy.js
 *
 * economy.js writes to /app/data/economy.json — the repo directory. On Railway
 * the only path that survives a redeploy is the mounted volume at
 * /app/auth_state. /app/data does not exist in the container at all, so every
 * economy balance is created, written, and then thrown away on the next
 * deploy. That is invisible in testing because a fresh boot looks identical to
 * a wiped one.
 *
 * Everything here resolves through dataPath() below, which prefers the volume,
 * so the data actually outlives the process.
 */
const fs = require('fs');
const path = require('path');

const MAX_ITEMS = 100;          // per user, per list — a cap, not a guess
const REMINDER_TICK_MS = 30_000;

/**
 * Resolve a writable location that survives a redeploy.
 * Order: explicit env, then the mounted volume, then the repo (local dev).
 */
function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const vol = require('../paths').AUTH_DIR;
  try {
    if (fs.existsSync(vol)) {
      const probe = path.join(vol, '.write-test');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
      return vol;
    }
  } catch { /* not writable — fall through, but say so below */ }
  // no explicit dir and the volume is not writable: still write to the volume
  // path so a later mount picks the data up, rather than silently using the
  // repo directory that Render wipes on every restart.
  return require('../paths').STATE_DIR;
}

const P2 = require('../paths');
// filename unchanged on purpose: somebody already running this with DATA_DIR
// set keeps their reminders. Only the directory moved.
const DATA_FILE = P2.adoptLegacy(P2.legacy.personal, path.join(dataDir(), 'personal.json'));

/**
 * This store is written synchronously when it changes. Reminders that vanish
 * on a crash are worse than a few milliseconds of blocking write, and the file
 * stays small because of MAX_ITEMS.
 */
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { users: raw.users || {}, reminders: raw.reminders || [] };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Never swallow a corrupt file: a silent reset looks like data loss.
      console.warn(`[PERSONAL] ${DATA_FILE} unreadable (${e.message}) — starting empty`);
    }
    return { users: {}, reminders: [] };
  }
}

let db = load();

function persist() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (e) {
    console.error(`[PERSONAL] SAVE FAILED: ${e.message} (${DATA_FILE})`);
    return false;
  }
}

function uid(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

function user(jid) {
  const id = uid(jid);
  if (!db.users[id]) {
    db.users[id] = { bookmarks: [], saved: [], todos: [] };
  }
  const u = db.users[id];
  // A user written before a list existed must not crash on first use.
  u.bookmarks = u.bookmarks || [];
  u.saved = u.saved || [];
  u.todos = u.todos || [];
  return u;
}

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const shortUrl = (u) => clip(u, 60);

/* ── reminder ticker ──────────────────────────────────────── */
let ticker = null;
let onDue = null;

function startReminderTicker(handler) {
  onDue = handler;
  if (ticker) return;
  ticker = setInterval(async () => {
    if (!db.reminders.length) return;
    const now = Date.now();
    const due = db.reminders.filter((r) => r.dueAt <= now);
    if (!due.length) return;
    db.reminders = db.reminders.filter((r) => r.dueAt > now);
    persist();
    for (const r of due) {
      if (typeof onDue === 'function') {
        try { await onDue(r); }
        catch (e) { console.error(`[REMIND] delivery failed for ${r.jid}: ${e.message}`); }
      }
    }
  }, REMINDER_TICK_MS);
  // Never hold the process open just for reminders.
  if (ticker.unref) ticker.unref();
}

/**
 * Parse "10m", "2h", "1d", "90s", "1h30m" into milliseconds.
 * Returns null for anything unparseable — the caller must report it rather
 * than defaulting to a number the user did not ask for.
 */
function parseDuration(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (/^-/.test(s)) return null;   // a negative duration is in the past — refuse it
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60_000; // bare number = minutes
  const re = /(\d+(?:\.\d+)?)\s*(mo|[smhdw])/g;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000 };
  let total = 0, matched = false, m;
  while ((m = re.exec(s))) {
    total += parseFloat(m[1]) * unit[m[2]];
    matched = true;
  }
  return matched && total > 0 ? Math.round(total) : null;
}

function humanDuration(ms) {
  const parts = [];
  const units = [['d', 86_400_000], ['h', 3_600_000], ['m', 60_000], ['s', 1000]];
  let left = ms;
  for (const [label, size] of units) {
    if (left >= size) { parts.push(`${Math.floor(left / size)}${label}`); left %= size; }
  }
  return parts.length ? parts.join(' ') : '0s';
}

/* ── engine ───────────────────────────────────────────────── */
const NAMES = new Set([
  'bookmark', 'bookmarks', 'delbookmark', 'savemsg', 'savedmsgs',
  'remind', 'remindme', 'reminder', 'reminders', 'delreminder',
  'todo', 'todos', 'addtodo', 'donetodo', 'deltodo',
]);

module.exports = {
  id: 'personal',
  name: 'personal-engine',
  extraNames: [...NAMES],
  startReminderTicker,

  match(name) { return NAMES.has(name); },

  async execute({ command, args, argString, reply, from, senderJid }) {
    const text = (argString || args.join(' ')).trim();
    const who = senderJid || from;
    const u = user(who);

    switch (command) {
      /* ── bookmarks ─────────────────────────────────────── */
      case 'bookmark': {
        const url = (args[0] || '').trim();
        const label = args.slice(1).join(' ').trim() || url;
        if (!/^https?:\/\//i.test(url)) {
          return reply('🔖 `.bookmark <https://link> [label]`\n_Only http(s) links are saved._');
        }
        if (u.bookmarks.length >= MAX_ITEMS) {
          return reply(`🔖 Your list is full (${MAX_ITEMS}). Remove one with \`.delbookmark <n>\`.`);
        }
        u.bookmarks.push({ url, label: clip(label, 60), at: Date.now() });
        const ok = persist();
        return reply(
          `🔖 *Saved* (#${u.bookmarks.length})\n\n${clip(label, 60)}\n${shortUrl(url)}` +
          (ok ? '' : '\n\n⚠️ _Could not write to disk — this may not survive a restart._'),
        );
      }

      case 'bookmarks': {
        if (!u.bookmarks.length) {
          return reply('🔖 No bookmarks yet. Add one with `.bookmark https://example.com my link`');
        }
        const lines = u.bookmarks.map((b, i) => `*${i + 1}.* ${b.label}\n     ${shortUrl(b.url)}`);
        return reply(`🔖 *Your bookmarks* (${u.bookmarks.length})\n\n${lines.join('\n\n')}\n\n_Remove one: \`.delbookmark <number>\`_`);
      }

      case 'delbookmark': {
        const n = parseInt(text, 10);
        if (!Number.isFinite(n) || n < 1 || n > u.bookmarks.length) {
          return reply(u.bookmarks.length
            ? `🔖 Pick 1–${u.bookmarks.length}. See \`.bookmarks\`.`
            : '🔖 You have no bookmarks to delete.');
        }
        const [gone] = u.bookmarks.splice(n - 1, 1);
        persist();
        return reply(`🗑️ Removed *${gone.label}*`);
      }

      /* ── saved messages ────────────────────────────────── */
      case 'savemsg': {
        // NOVA saves the replied text. We accept both a reply and inline text.
        const body = (args.quotedText || text || '').trim();
        if (!body) {
          return reply('💾 Reply to a message with `.savemsg`, or use `.savemsg <text>`.');
        }
        if (u.saved.length >= MAX_ITEMS) {
          return reply(`💾 Saved list is full (${MAX_ITEMS}). Clear one with \`.delsaved <n>\`.`);
        }
        u.saved.push({ text: clip(body, 2000), at: Date.now() });
        persist();
        return reply(`💾 *Saved* (#${u.saved.length})\n\n_${clip(body, 200)}_`);
      }

      case 'savedmsgs': {
        if (!u.saved.length) return reply('💾 Nothing saved yet. Reply to a message with `.savemsg`.');
        const lines = u.saved.map((s, i) => `*${i + 1}.* ${clip(s.text, 120)}`);
        return reply(`💾 *Saved messages* (${u.saved.length})\n\n${lines.join('\n\n')}`);
      }

      case 'delsaved': {
        const n = parseInt(text, 10);
        if (!Number.isFinite(n) || n < 1 || n > u.saved.length) {
          return reply(u.saved.length ? `💾 Pick 1–${u.saved.length}.` : '💾 Nothing saved.');
        }
        u.saved.splice(n - 1, 1);
        persist();
        return reply('🗑️ Removed.');
      }

      /* ── reminders ─────────────────────────────────────── */
      case 'remind':
      case 'remindme':
      case 'reminder': {
        // .remind 10m take the food out   |   .remind 2h: meeting
        const m = text.match(/^(\S+)\s*:?\s+([\s\S]+)$/);
        if (!m) {
          return reply(
            '⏰ `.remind <time> <what>`\n\n' +
            'Examples:\n`.remind 10m check the oven`\n`.remind 2h30m call mum`\n`.remind 1d renew data`\n\n' +
            '_Units: s, m, h, d, w. A bare number means minutes._',
          );
        }
        const ms = parseDuration(m[1]);
        if (!ms) {
          return reply(`⏰ I can't read *${m[1]}* as a time. Use \`10m\`, \`2h\`, \`1d\`, or a number of minutes.`);
        }
        if (ms > 365 * 86_400_000) return reply('⏰ That is over a year away — pick something shorter.');
        const what = m[2].trim();
        db.reminders.push({ id: `r${Date.now()}${Math.floor(Math.random() * 1000)}`, jid: who, text: what, dueAt: Date.now() + ms, createdAt: Date.now() });
        persist();
        const when = new Date(Date.now() + ms);
        return reply(`⏰ *Reminder set* for ${humanDuration(ms)} from now\n\n*${what}*\n\n_${when.toUTCString()}_`);
      }

      case 'reminders': {
        const mine = db.reminders.filter((r) => r.jid === who).sort((a, b) => a.dueAt - b.dueAt);
        if (!mine.length) return reply('⏰ No reminders. Set one with `.remind 10m check the oven`');
        const lines = mine.map((r, i) => {
          const left = humanDuration(Math.max(0, r.dueAt - Date.now()));
          return `*${i + 1}.* ${clip(r.text, 80)}\n     _in ${left}_`;
        });
        return reply(`⏰ *Your reminders* (${mine.length})\n\n${lines.join('\n\n')}\n\n_Cancel: \`.delreminder <number>\`_`);
      }

      case 'delreminder': {
        const mine = db.reminders.filter((r) => r.jid === who).sort((a, b) => a.dueAt - b.dueAt);
        const n = parseInt(text, 10);
        if (!Number.isFinite(n) || n < 1 || n > mine.length) {
          return reply(mine.length ? `⏰ Pick 1–${mine.length}. See \`.reminders\`.` : '⏰ No reminders to cancel.');
        }
        const target = mine[n - 1];
        db.reminders = db.reminders.filter((r) => r.id !== target.id);
        persist();
        return reply(`🗑️ Cancelled: *${clip(target.text, 80)}*`);
      }

      /* ── todos ─────────────────────────────────────────── */
      case 'todo':
      case 'addtodo': {
        if (!text) return reply('📝 `.todo <task>`\nSee them with `.todos`, finish with `.donetodo <n>`.');
        if (u.todos.length >= MAX_ITEMS) return reply(`📝 Todo list is full (${MAX_ITEMS}).`);
        u.todos.push({ text: clip(text, 300), done: false, at: Date.now() });
        persist();
        return reply(`📝 *Added* (#${u.todos.length})\n\n${clip(text, 200)}`);
      }

      case 'todos': {
        if (!u.todos.length) return reply('📝 No tasks. Add one with `.todo buy data`');
        const open = u.todos.filter((t) => !t.done);
        const done = u.todos.filter((t) => t.done);
        const line = (t, i) => `${t.done ? '☑️' : '⬜'} *${i + 1}.* ${clip(t.text, 100)}`;
        const body = [
          ...open.map((t) => line(t, u.todos.indexOf(t) + 1)),
          ...done.map((t) => line(t, u.todos.indexOf(t) + 1)),
        ].join('\n');
        return reply(`📝 *Your tasks* — ${open.length} open, ${done.length} done\n\n${body}\n\n_Finish: \`.donetodo <number>\`_`);
      }

      case 'donetodo': {
        const n = parseInt(text, 10);
        if (!Number.isFinite(n) || n < 1 || n > u.todos.length) {
          return reply(u.todos.length ? `📝 Pick 1–${u.todos.length}. See \`.todos\`.` : '📝 No tasks.');
        }
        const item = u.todos[n - 1];
        if (item.done) return reply(`☑️ Already done: *${clip(item.text, 80)}*`);
        item.done = true;
        item.doneAt = Date.now();
        persist();
        return reply(`✅ *Done:* ${clip(item.text, 100)}`);
      }

      case 'deltodo': {
        const n = parseInt(text, 10);
        if (!Number.isFinite(n) || n < 1 || n > u.todos.length) {
          return reply(u.todos.length ? `📝 Pick 1–${u.todos.length}.` : '📝 No tasks.');
        }
        const [gone] = u.todos.splice(n - 1, 1);
        persist();
        return reply(`🗑️ Removed: *${clip(gone.text, 80)}*`);
      }

      default:
        return reply(`❌ \`${command}\` is not wired in the personal engine.`);
    }
  },
};

module.exports._internal = {
  parseDuration, humanDuration, dataDir, DATA_FILE,
  _db: () => db,
  _reset: () => { db = { users: {}, reminders: [] }; },
  _user: user,
};
