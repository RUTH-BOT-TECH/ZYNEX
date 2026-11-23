/**
 * lib/botInfo.js — single source of truth for who this bot is.
 *
 * Every command that prints a repo URL, an owner number or a contact link reads
 * from here. Before this file existed, `.repo` shipped `YOUR-USERNAME` and
 * `2348000000000` to users, and `.wiki` sent that same placeholder in its
 * User-Agent header to Wikipedia. One place, one truth.
 *
 * Values come from env first so a second deployment can rebrand without editing
 * code; the literals below are this instance's real identity, not samples.
 */

const BOT_NAME = process.env.BOT_NAME || 'ZYNEX-MD';
const OWNER_NAME = process.env.OWNER_NAME || 'ZYNEX';

/** International form, digits only — e.g. 2348021016309 */
const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '2348021016309').replace(/\D/g, '');

const REPO_URL = process.env.REPO_URL || 'https://github.com/RUTH-BOT-TECH/ZYNEX';

/**
 * Where a self-hoster pairs their own device.
 *
 * This was hardcoded to zynex-pairing.onrender.com — a host this project does
 * not control. A fork-er following the panel's own instructions would have been
 * sent to a stranger's domain to hand over a WhatsApp session ID.
 *
 * Defaults to our live Railway deployment; a fork-er overrides it with one env
 * var, same as BOT_NAME.
 */
const SITE_URL = process.env.SITE_URL || 'https://zynex-md-production.up.railway.app';

/** The session-ID format a fork-er's own deployment will emit. */
const SESSION_PREFIX = process.env.SESSION_PREFIX
  || BOT_NAME.toLowerCase().replace(/[^a-z0-9]/g, '') + '-md';

/**
 * 2348021016309 -> 08021016309
 * Only rewrite Nigerian numbers; anything else is shown as stored.
 */
function ownerLocalNumber(number = OWNER_NUMBER) {
  const n = String(number).replace(/\D/g, '');
  if (n.length === 13 && n.startsWith('234')) return '0' + n.slice(3);
  return n;
}

/** wa.me needs international digits and nothing else. */
function ownerWaLink(number = OWNER_NUMBER) {
  return `https://wa.me/${String(number).replace(/\D/g, '')}`;
}

module.exports = {
  BOT_NAME,
  SITE_URL,
  SESSION_PREFIX,
  OWNER_NAME,
  OWNER_NUMBER,
  OWNER_LOCAL: ownerLocalNumber(),
  REPO_URL,
  ownerLocalNumber,
  ownerWaLink,
};
