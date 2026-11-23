/**
 * JSON file-based session store — no external DB needed
 */
const fs = require('fs');
const path = require('path');

/**
 * Where the session DB lives.
 *
 * ★ This MUST be resolved at require time, not at boot time. It was previously
 * `process.env.DB_FILE || ...` evaluated once here, which meant a DB_FILE set
 * later inside server.js's start() arrived too late: db.js had already captured
 * the default, read /app/sessions.json (off-volume, wiped by every redeploy) and
 * reported "0 sessions" no matter what the boot log said.
 *
 * Prefer an explicit DB_FILE. Otherwise, if AUTH_DIR_ROOT exists — on Railway
 * that is the persistent volume mount — put the DB there so pairings survive
 * redeploys. Fall back to the repo root for plain local runs.
 */
function defaultDbFile() {
  const vol = require('./paths').AUTH_DIR;
  try {
    if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) {
      return path.join(vol, '.sessions.json');
    }
  } catch {}
  return path.join(__dirname, '..', 'sessions.json');
}

const DB_FILE = require('./paths').dbFile;
process.env.DB_FILE = DB_FILE;   // keep the resolved path visible to callers

let sessions = [];
try { sessions = JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '[]'); } catch { sessions = []; }

function save() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(sessions, null, 2)); } catch (e) {}
}

const prisma = {
  botSession: {
    findUnique: async ({ where }) => {
      return sessions.find(s => s.phoneNumber === where.phoneNumber || s.id === where.id) || null;
    },
    findFirst: async ({ where }) => {
      if (!where) return sessions[0] || null;
      if (where.status) return sessions.find(s => s.status === where.status) || null;
      return sessions[0] || null;
    },
    findMany: async ({ where } = {}) => {
      let r = [...sessions];
      if (where?.status) r = r.filter(s => s.status === where.status);
      return r;
    },
    create: async ({ data }) => {
      const s = {
        id: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        messagesReceived: 0,
        messagesSent: 0,
        commandsExecuted: 0,
        ...data,
      };
      sessions.push(s);
      save();
      return s;
    },
    delete: async ({ where }) => {
      const i = sessions.findIndex((s) => (where.id ? s.id === where.id : s.phoneNumber === where.phoneNumber));
      if (i === -1) return null;
      const [gone] = sessions.splice(i, 1);
      save();
      return gone;
    },
    deleteMany: async ({ where } = {}) => {
      const before = sessions.length;
      if (!where || !where.phoneNumber) return { count: 0 };
      sessions = sessions.filter((s) => s.phoneNumber !== where.phoneNumber);
      save();
      return { count: before - sessions.length };
    },
    update: async ({ where, data }) => {
      const i = sessions.findIndex(s => s.phoneNumber === where.phoneNumber || s.id === where.id);
      if (i >= 0) {
        sessions[i] = { ...sessions[i], ...data, updatedAt: new Date().toISOString() };
        save();
        return sessions[i];
      }
      return null;
    },
    count: async () => sessions.length,
  },
};

async function ensureDB() {
  console.log('[DB] JSON store ready:', sessions.length, 'sessions');
}

module.exports = { prisma, ensureDB };
