/**
 * lib/paths.js — one answer to "where do we write?"
 *
 * Why this file exists: self-hosting broke on every host that has an ephemeral
 * filesystem, and the cause was not the host. It was that six modules each
 * decided for themselves where state lives:
 *
 *   lib/sessionManager.js  __dirname/../auth_state        (ignored the env)
 *   lib/bot.js             __dirname/../auth_state        (ignored the env)
 *   lib/panelBot.js        __dirname/../auth_state        (ignored the env)
 *   lib/db.js              AUTH_DIR_ROOT                  (respected it)
 *   lib/mediaCache.js      AUTH_DIR_ROOT                  (respected it)
 *   lib/secstore.js        __dirname/../data/security.json   ← outside the volume
 *   lib/engines/economy.js __dirname/../data/economy.json    ← outside the volume
 *
 * So a fork-er on Render or Railway who mounted a volume and set AUTH_DIR_ROOT
 * got a half-migrated bot: sessions survived a redeploy, balances and the
 * security cache did not - and on Render the whole thing reset every restart
 * with no explanation.
 *
 * The fix is one resolver. Point AUTH_DIR_ROOT at a persistent disk and every
 * piece of state follows it.
 *
 * DEFAULT IS UNCHANGED. With no env set this resolves to <project>/auth_state,
 * exactly where production already writes, so deploying this does not orphan
 * anyone's paired session.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Where the WhatsApp session folders live. The one thing you must persist. */
const AUTH_DIR = process.env.AUTH_DIR_ROOT || path.join(ROOT, 'auth_state');

/**
 * Everything else lives under the same root on purpose: a self-hoster only has
 * to mount ONE volume, and a host that gives you a single disk just works.
 */
const STATE_DIR = AUTH_DIR;

module.exports = {
  ROOT,
  AUTH_DIR,
  STATE_DIR,
  securityFile: path.join(STATE_DIR, '.security.json'),
  economyFile: path.join(STATE_DIR, '.economy.json'),
  dbFile: process.env.DB_FILE || path.join(AUTH_DIR, '.sessions.json'),
  mediaCacheDir: path.join(AUTH_DIR, '.media_cache'),
  /** Any path under AUTH_DIR is safe to write; anything else may be wiped. */
  isPersistent: (p) => path.resolve(p).startsWith(path.resolve(AUTH_DIR)),
  /** Old locations, so a self-hoster's existing data can be rescued once. */
  legacy: {
    security: path.join(ROOT, 'data', 'security.json'),
    economy: path.join(ROOT, 'data', 'economy.json'),
    games: path.join(ROOT, 'data', 'games.json'),
    groups: path.join(ROOT, 'data', 'groups.json'),
    personal: path.join(ROOT, 'data', 'personal.json'),
  },
};

/**
 * Move a legacy state file into the persistent root, once.
 * Returns the path that should be used from now on.
 */
function adoptLegacy(legacyPath, newPath) {
  const fs = require('fs');
  try {
    if (legacyPath === newPath) return newPath;
    if (fs.existsSync(newPath)) return newPath;          // already migrated
    if (!fs.existsSync(legacyPath)) return newPath;      // nothing to move
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.copyFileSync(legacyPath, newPath);
    console.log(`[PATHS] adopted ${path.relative(ROOT, legacyPath)} -> ${path.relative(ROOT, newPath)}`);
  } catch (e) {
    console.error(`[PATHS] could not adopt ${legacyPath}: ${e.message}`);
  }
  return newPath;
}

module.exports.adoptLegacy = adoptLegacy;
