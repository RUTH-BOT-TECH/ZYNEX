/**
 * lib/access.js — who is allowed to touch which bot?
 *
 * The panel had one shared password, and that password was total power. Anyone
 * holding it could read every paired phone number in the dashboard and press
 * Disconnect on anyone's bot. Fine when one person runs a panel for their own
 * number. Not fine the moment a deployer resells access, which is exactly what
 * "they have deployers on their panel who can also host somebody" means.
 *
 * So each bot now has a claim: a 6-digit access code returned once, to the
 * person who paired it, and never shown to anyone else. Knowing the panel
 * password lets you PAIR A NEW BOT. It no longer lets you see or touch the bots
 * that are already there.
 *
 * What the holder of the panel password keeps, deliberately: the counts. The
 * owner of the deployment needs to know how full the host is, and a number is
 * not a phone number.
 *
 * This is a claim code, not authentication. There are no accounts, no sessions,
 * no password reset, nothing to phish. If the code is lost the bot can only be
 * reached from WhatsApp itself (.disconnect) — which the panel already tells
 * people.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const P = require('./paths');

const FILE = path.join(P.STATE_DIR, 'access.json');

/** 6 digits: short enough to type from a chat, 1-in-a-million to guess. */
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

const hash = (code) => crypto.createHash('sha256').update('access:' + String(code)).digest('hex');

function load() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  try { fs.chmodSync(FILE, 0o600); } catch { /* not fatal */ }
}

/**
 * Claim a number for a new owner. Returns the code to hand back ONCE.
 * Re-pairing the same number issues a fresh code and drops the old one, which
 * is the only recovery path there is — and it requires the panel password.
 */
function claim(phoneNumber) {
  let db = {};
  try { db = load(); } catch { db = {}; }
  const code = newCode();
  db[String(phoneNumber)] = {
    hash: hash(code),
    createdAt: new Date().toISOString(),
  };
  save(db);
  return code;
}

/**
 * Does this code own this number?
 * Returns true only on an exact match, compared in constant time so a wrong
 * code cannot be narrowed down by timing it.
 */
function owns(phoneNumber, code) {
  if (!code) return false;
  let db;
  try { db = load(); } catch { return false; }
  const rec = db[String(phoneNumber)];
  if (!rec || !rec.hash) return false;

  const a = Buffer.from(rec.hash, 'hex');
  const b = Buffer.from(hash(code), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Has this number ever been claimed? Used to tell "no code yet" from "wrong code". */
function isClaimed(phoneNumber) {
  try {
    const db = load();
    return Boolean(db[String(phoneNumber)]);
  } catch { return false; }
}

function release(phoneNumber) {
  let db;
  try { db = load(); } catch { return; }
  if (!(String(phoneNumber) in db)) return;
  delete db[String(phoneNumber)];
  save(db);
}

module.exports = { claim, owns, isClaimed, release, newCode, _file: FILE };
