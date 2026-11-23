/**
 * ZYNEX-MD v2.0 — Multi-user WhatsApp bot pairing server
 *
 * Zero-config deployment:
 *   - Anyone can visit the site + pair their WhatsApp
 *   - The FIRST user to pair becomes the "owner" (stored in DB)
 *   - Each user gets their own Baileys bot instance
 *   - Sessions are tracked in Prisma DB (SQLite)
 *   - Idle sessions auto-disconnect after IDLE_TIMEOUT_HOURS
 *
 * Env vars (ALL optional — defaults work for Render free tier):
 *   PORT, BOT_NAME, PREFIX, DATABASE_URL, MAX_SESSIONS,
 *   IDLE_TIMEOUT_HOURS, PAIRING_CODE_TTL, SITE_PASSWORD,
 *   ANTI_DELETE, AUTO_READ_STATUS, OWNER_NUMBER
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const { ensureDB, prisma } = require('./lib/db');
const sessionManager = require('./lib/sessionManager');
const { REPO_URL } = require('./lib/botInfo');

const app = express();
// Port logic:
//   - Pterodactyl auto-sets SERVER_PORT (e.g. 2532) → use that
//   - Render sets PORT → use that
//   - Else (mini-service alongside Next.js on port 3000), use 3001
const PORT = process.env.SERVER_PORT || process.env.PORT || 3001;
const BOT_NAME = process.env.BOT_NAME || 'ZYNEX-MD';
const PAIRING_CODE_TTL = parseInt(process.env.PAIRING_CODE_TTL || '90', 10);

/**
 * Normalize a phone number to international format (digits only, no leading 0).
 * - Strips + and spaces
 * - Strips a single leading 0 (local prefix) — user must still provide country code
 * - Validates length 8..15
 * Returns the normalized number, or null if invalid.
 */
function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).replace(/[^\d]/g, ''); // digits only
  if (!p) return null;
  // Strip one leading 0 (e.g., "0712345678" → "712345678") — but ONLY if there's a
  // country code after it. If user typed "0254..." that's ambiguous, leave it.
  if (p.length > 10 && p.startsWith('0')) p = p.slice(1);
  if (!/^\d{8,15}$/.test(p)) return null;
  return p;
}

/**
 * Format a Baileys pairing code with a dash for readability.
 * Baileys may return "ABCDEFGH" or "ABCD-EFGH" — normalize to "ABCD-EFGH".
 */
function formatPairCode(code) {
  if (!code) return code;
  const c = String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (c.length === 8) return c.slice(0, 4) + '-' + c.slice(4);
  return c;
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ ACCESS CONTROL ============

/**
 * ONE gate for everything that isn't purely decorative.
 *
 * Only /api/pair used to check SITE_PASSWORD. That left /api/status and
 * /api/session/:phone serving every paired phone number to anybody who loaded
 * the URL, and /api/disconnect let a stranger tear down a live WhatsApp session
 * with no credentials at all — verified against the deployed site.
 *
 * The password is sent once, then kept in an httpOnly cookie, so the dashboard
 * works normally without re-prompting on every poll.
 */
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const TOKEN = SITE_PASSWORD
  ? require('crypto').createHash('sha256').update(`zynex:${SITE_PASSWORD}`).digest('hex')
  : '';

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthorized(req) {
  if (!SITE_PASSWORD) return true; // no password configured = open (dev default)
  // The cookie holds the hash; the body/header carry the password the user typed.
  // Comparing the raw password to TOKEN (as a first draft did) rejected the
  // correct password, which is exactly the class of bug this whole change is about.
  if (parseCookies(req).zynex_auth === TOKEN) return true;
  const typed = req.body?.password || req.headers['x-site-password'];
  return Boolean(typed) && typed === SITE_PASSWORD;
}

function setAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `zynex_auth=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
}

/** Express middleware: 401 unless the caller proved they know the password. */
function requireAuth(req, res, next) {
  if (isAuthorized(req)) return next();
  return res.status(401).json({ error: 'Wrong site password' });
}

// ============ API ENDPOINTS ============

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    sessions: sessionManager.getSessionsCount(),
  });
});

// Bot status — overall + list of all sessions
app.get('/api/status', async (req, res) => {
  try {
    const authed = isAuthorized(req);
    // Cached for 10 minutes; null when GitHub is unreachable or rate-limited,
    // which the page renders as no count rather than a wrong one.
    const star = await require('./lib/star').starCount();
    const sessions = await sessionManager.getAllSessions();
    const activeSessions = sessions.filter(s => s.status === 'connected').length;
    res.json({
      botName: BOT_NAME,
      version: '1.0.0',
      // tells the page whether to show a password box — never the password itself
      authRequired: Boolean(SITE_PASSWORD),
      authorized: authed,
      activeSessions,
      totalPaired: sessions.length,
      // Counts are public so the page can render stats; the records are not.
      // Every field in them includes a phone number.
      sessions: authed
        ? sessions.slice(0, 20)
        : sessions.slice(0, 20).map(s => ({
            id: s.id,
            status: s.status,
            inMemory: s.inMemory,
            messagesReceived: s.messagesReceived,
            commandsExecuted: s.commandsExecuted,
            createdAt: s.createdAt,
            phoneNumber: '•••••••' + String(s.phoneNumber || '').slice(-2),
          })),
      // the page needs to know to ask for the password
      authHint: SITE_PASSWORD && !authed ? 'password required for full access' : undefined,
      // Repo + live star count, so the page's link is informative rather than a
      // dead anchor. GitHub forbids anonymous starring, so this is a count and
      // a link — never a fake "star for me" action.
      repo: REPO_URL,
      stars: star ? star.stars : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Request a pairing code — creates a new session
app.post('/api/pair', async (req, res) => {
  try {
    const rawPhone = req.body?.phoneNumber;
    const phoneNumber = normalizePhone(rawPhone);

    if (!phoneNumber) {
      return res.status(400).json({
        error: 'Invalid phone number. Use digits only with country code. Example: 254712345678 (no +, no spaces, no leading 0).',
      });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Wrong site password' });
    }
    setAuthCookie(res); // so the rest of the dashboard stops asking

    // Check if this number is already paired AND active
    const existing = await prisma.botSession.findUnique({ where: { phoneNumber } });
    if (existing && existing.status === 'connected') {
      return res.status(409).json({
        error: 'This number is already paired. Send .disconnect from WhatsApp or use the disconnect button.',
      });
    }

    console.log(`[PAIR] Requesting pairing code for ${phoneNumber} (raw input: "${rawPhone}")`);

    // Create session
    const result = await sessionManager.createSession(phoneNumber);

    // Format the code with a dash for readability (e.g., "ABCD-EFGH")
    const prettyCode = formatPairCode(result.code);

    console.log(`[PAIR] ✓ Code generated for ${phoneNumber}: ${prettyCode} (raw: ${result.code})`);

    res.json({
      success: true,
      code: prettyCode,
      rawCode: result.code,
      sessionId: result.sessionId,
      phoneNumber,
      expiresIn: PAIRING_CODE_TTL,
      instructions: [
        '1. Open WhatsApp on your phone',
        '2. Tap Settings → Linked Devices → Link a Device',
        '3. When the QR scanner opens, tap "Link with phone number instead"',
        '4. Enter the code below (with or without the dash):',
      ],
    });
  } catch (e) {
    console.error('[PAIRING ERROR]', e);
    res.status(500).json({ error: e.message || 'Failed to generate pairing code' });
  }
});

// Disconnect a specific session by phone number
app.post('/api/disconnect', requireAuth, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber required' });

    const session = await prisma.botSession.findUnique({ where: { phoneNumber } });
    if (!session) return res.json({ ok: true, message: 'Already disconnected' });

    await sessionManager.removeSession(session.id);
    res.json({ ok: true, message: 'Disconnected. Session cleared.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get details for a specific session (by phone number)
app.get('/api/session/:phone', requireAuth, async (req, res) => {
  try {
    const session = await prisma.botSession.findUnique({
      where: { phoneNumber: req.params.phone },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({
      ...session,
      inMemory: sessionManager.getSession(session.id) !== undefined,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ START ============
async function start() {
  // db.js resolves its own path (preferring the auth_state volume) at require
  // time. All that is left to do here is carry over a legacy off-volume DB once.
  try {
    const legacy = path.join(__dirname, 'sessions.json');
    if (process.env.DB_FILE && fs.existsSync(process.env.DB_FILE) === false && fs.existsSync(legacy)) {
      fs.copyFileSync(legacy, process.env.DB_FILE);
      console.log('[BOOT] Migrated legacy sessions.json onto the persistent volume');
    }
    console.log(`[BOOT] Session DB: ${process.env.DB_FILE}`);
  } catch (e) {
    console.error('[BOOT] Session DB migration error:', e.message);
  }

  await ensureDB();

  // Reconnect sessions from DB (survives server restart)
  try {
    await sessionManager.reconnectAllSessions();
  } catch (e) {
    console.error('[BOOT] reconnectAllSessions error:', e.message);
  }

  // Auth folders that no DB record owns are dead weight at best and poison at
  // worst — sweep them so they can never be inherited by a new pairing.
  try {
    await sessionManager.sweepOrphanAuthFolders();
  } catch (e) {
    console.error('[BOOT] sweepOrphanAuthFolders error:', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║     ${BOT_NAME} v4.3 — Multi-user pairing server  ║`);
    console.log(`╚══════════════════════════════════════════════╝`);
    console.log(`\n🌐 Pairing site: http://localhost:${PORT}`);
    console.log(`📡 API:          http://localhost:${PORT}/api/status`);
    console.log(`💚 Health:       http://localhost:${PORT}/health`);
    console.log(`👥 Active sessions: ${sessionManager.getSessionsCount()} (no limit — bot is for everyone)`);
    console.log(`💾 DB:           SQLite at ${process.env.DATABASE_URL || 'file:./prisma/zynex.db'}\n`);
  });

  // Keep process alive — handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT]', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED]', err);
  });
  process.on('exit', (code) => {
    console.error(`[EXIT] Process exiting with code ${code}`);
  });
  process.on('SIGTERM', () => {
    console.log('[SIGTERM] Received — shutting down');
  });
  process.on('SIGINT', () => {
    console.log('[SIGINT] Received — shutting down');
    process.exit(0);
  });
}

// === ZYNEX-MD — Panel mode (single-user, SESSION_ID-based) ===
// Always run panelBot on Pterodactyl — if SESSION_ID is missing, panelBot
// will wait for it to be set via the panel Startup tab.
if (process.env.PANEL_MODE === '0') {
  // Original multi-user pairing server (legacy)
  start().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
} else {
  const { startPanelBot } = require('./lib/panelBot');
  startPanelBot().catch((err) => {
    console.error('[FATAL] panelBot:', err);
    process.exit(1);
  });
}
