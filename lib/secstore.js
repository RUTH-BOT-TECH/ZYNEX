/**
 * lib/secstore.js — tiny on-disk store for the security engine's local state.
 *
 * The security engine has two kinds of state that are genuinely the bot's own:
 *   - per-chat flags: 2FA requirement, ban list, activity log, verified users
 *   - short-lived challenges: captcha answers
 *
 * This is NOT a security boundary. It is a convenience so `.twofa on` and
 * `.ipban` survive a restart. Anything that needs to be trustworthy (codes,
 * hashes) is computed, never stored.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const P = require('./paths');
const FILE = P.adoptLegacy(P.legacy.security, P.securityFile);
const TTL_MS = 2 * 60 * 1000; // challenges expire; flags do not

let cache = null;
let timer = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
    } catch {
      // a failed write must never take the bot down
    }
  }, 250);
  if (timer.unref) timer.unref();
}

const key = (chat, field) => `${chat}::${field}`;

function get(chat, field) {
  const db = load();
  const rec = db[key(chat, field)];
  if (!rec) return null;
  if (rec.expires && Date.now() > rec.expires) {
    delete db[key(chat, field)];
    persist();
    return null;
  }
  return rec.value;
}

function set(chat, field, value, ttlMs) {
  const db = load();
  const k = key(chat, field);
  if (value === null || value === undefined) {
    delete db[k];
  } else {
    db[k] = { value, at: Date.now(), ...(ttlMs ? { expires: Date.now() + ttlMs } : {}) };
  }
  persist();
}

/** append to a chat's activity log (capped) */
function log(chat, what, who) {
  const db = load();
  const k = key(chat, 'log');
  const rec = db[k] || { value: [] };
  rec.value.push({ what, who: who || null, at: Date.now() });
  if (rec.value.length > 200) rec.value = rec.value.slice(-200);
  db[k] = rec;
  persist();
}

module.exports = { get, set, log, TTL_MS, FILE };
