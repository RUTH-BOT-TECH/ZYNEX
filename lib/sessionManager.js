/**
 * ZYNEX-MD — Session Manager
 *
 * Manages MULTIPLE concurrent Baileys bot instances (one per WhatsApp user).
 * Each session has its own:
 *   - Auth state folder (auth_state/<sessionId>/)
 *   - Prisma DB record (BotSession)
 *   - Message handlers
 *
 * Memory note: each Baileys socket uses ~30-50MB RAM.
 * On Render free (512MB) → ~5-7 concurrent sessions.
 * On Render starter (2GB) → ~25-30 concurrent sessions.
 */

const fs = require('fs');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const jidHelper = require('./jid');
const { prisma } = require('./db');
const { handleMessage, handleAnti } = require('./handler');
const { createFakeContact } = require('./createFakeContact');

const AUTH_DIR_ROOT = path.join(__dirname, '..', 'auth_state');

/**
 * Empty a session's auth folder WITHOUT deleting the folder itself.
 *
 * `authFolder` lives under AUTH_DIR_ROOT, which on Railway is the mount point of
 * a persistent volume. `rmSync(folder, {recursive:true})` on a mount point fails
 * with EBUSY, and because every call site was wrapped in `catch {}` the failure
 * was invisible — the old creds survived, new ones were written over them, and
 * the socket kept using the stale Signal state it had already loaded. That is
 * what produced "failed to decrypt message ... SessionError: No session record"
 * for the owner's own messages: blue ticks, no reply, forever.
 */
function wipeAuthFolder(folder) {
  if (!folder) return { ok: false, reason: 'no folder' };
  try {
    if (fs.existsSync(folder)) {
      for (const entry of fs.readdirSync(folder)) {
        fs.rmSync(path.join(folder, entry), { recursive: true, force: true });
      }
    } else {
      fs.mkdirSync(folder, { recursive: true });
    }
    return { ok: true, remaining: fs.existsSync(folder) ? fs.readdirSync(folder).length : 0 };
  } catch (e) {
    console.log(`[SESSION] ⚠️ Could not wipe auth folder ${folder}: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

/**
 * Delete auth folders that no DB record claims.
 *
 * These are the leftovers that caused the two-account problem: a pairing that
 * was logged out, a redeploy that lost the DB, a number the user unlinked in
 * WhatsApp. They hold live Signal keys but belong to nobody, so they are pure
 * risk — a later pairing for the same number silently inherits them.
 *
 * Runs at boot. Never throws: a sweep failure must not stop the server.
 */
async function sweepOrphanAuthFolders({ dryRun = false } = {}) {
  const removed = [];
  try {
    if (!fs.existsSync(AUTH_DIR_ROOT)) return { removed, checked: 0 };
    const known = new Set();
    try {
      const all = await prisma.botSession.findMany({ where: {} });
      for (const r of all) {
        if (r.phoneNumber) known.add(String(r.phoneNumber).split('@')[0].split(':')[0]);
      }
    } catch (e) {
      console.log(`[BOOT] Orphan sweep skipped — could not read DB: ${e.message}`);
      return { removed, checked: 0 };
    }
    // Anything currently live in memory is definitely not an orphan.
    for (const s of sessions.values()) {
      known.add(String(s.phoneNumber).split('@')[0].split(':')[0]);
    }

    const entries = fs.readdirSync(AUTH_DIR_ROOT, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === 'lost+found') continue;    // filesystem artefact, not ours
      if (ent.name.startsWith('.')) continue;     // .sessions.json etc.
      if (known.has(ent.name)) continue;
      const full = path.join(AUTH_DIR_ROOT, ent.name);
      if (dryRun) {
        removed.push(ent.name);
        continue;
      }
      const wiped = wipeAuthFolder(full);
      if (wiped.ok) {
        removed.push(ent.name);
        console.log(`[BOOT] 🧹 Removed orphan auth folder: ${ent.name}`);
      } else {
        console.log(`[BOOT] ⚠️ Could not clear orphan ${ent.name}: ${wiped.reason}`);
      }
    }
    if (removed.length === 0) console.log('[BOOT] No orphan auth folders.');
  } catch (e) {
    console.log(`[BOOT] Orphan sweep error: ${e.message}`);
  }
  return { removed, checked: removed.length };
}
if (!fs.existsSync(AUTH_DIR_ROOT)) fs.mkdirSync(AUTH_DIR_ROOT, { recursive: true });

const logger = P({ level: 'warn' }, P.destination({ sync: true }));

// In-memory map of active sessions
// sessionId → { sock, phoneNumber, status, lastActive, cleanupTimer }
const sessions = new Map();

/**
 * Hard-stop every in-memory session bound to a phone number, without touching
 * the auth folder. Used before re-pairing so two sockets never share one
 * account's Signal state (that produces "Bad MAC" and undecryptable messages).
 */
async function killSessionsForNumber(phoneNumber) {
  const num = String(phoneNumber).split('@')[0].split(':')[0];
  for (const [id, s] of sessions) {
    if (String(s.phoneNumber).split('@')[0].split(':')[0] !== num) continue;
    console.log(`[SESSION ${id}] 🔻 Killing stale session for ${num} before re-pair`);
    try { if (s.cleanupTimer) clearTimeout(s.cleanupTimer); } catch {}
    try { stopAlwaysOnline(id); } catch {}
    try { await s.sock.end(undefined); } catch {}
    sessions.delete(id);
  }
}

// No limit on concurrent sessions — bot is for everyone.
// RAM usage is ~30-50MB per active Baileys socket. Monitor your host's memory.
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_HOURS || '6', 10) * 60 * 60 * 1000;
const BOT_NAME = process.env.BOT_NAME || 'ZYNEX-MD';

/**
 * Create a new bot session for a phone number.
 * Returns the session ID + the Baileys pairing code.
 */
async function createSession(phoneNumber) {
  // No concurrent session limit — bot is for everyone.
  // Each Baileys socket uses ~30-50MB RAM; scale your host accordingly.

  // Check if session already exists in DB
  let dbSession = await prisma.botSession.findUnique({ where: { phoneNumber } });
  if (dbSession && dbSession.status === 'connected') {
    throw new Error('This phone number is already paired. Disconnect first.');
  }

  // Create or update DB record
  if (!dbSession) {
    // Every user is the owner of their OWN bot instance — no global owner
    dbSession = await prisma.botSession.create({
      data: {
        phoneNumber,
        status: 'pairing',
        authFolder: path.join(AUTH_DIR_ROOT, phoneNumber),
        mode: 'public',        // default: respond to everyone
        prefix: '.',           // default prefix
        antiDelete: true,      // anti-delete ON by default
        antiCall: true,        // anti-call ON by default
        autoReadStatus: true,  // auto-read status ON by default
      },
    });
    console.log(`[SESSION ${dbSession.id}] 👤 New user: ${phoneNumber}`);
  } else {
    // Re-pairing an existing number: same folder, but the old socket must go.
    // Leaving a previous session for this number alive is what let a 401'd
    // session and a fresh one run side by side, fighting over the same keys.
    await killSessionsForNumber(phoneNumber);
    dbSession = await prisma.botSession.update({
      where: { phoneNumber },
      data: { status: 'pairing' },
    });
  }

  const sessionId = dbSession.id;
  const authFolder = dbSession.authFolder;
  if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

  // ★ Two different numbers must never share one auth folder.
  // Auth folders are keyed by phone number, so this usually cannot happen — but
  // when a stale volume directory lingers (e.g. a partial wipe that silently
  // failed with EBUSY) a new number can inherit another account's Signal keys.
  // The result is exactly what the owner saw: welcome card sends fine, then
  // every command is "no .message field" / "No session record" and never runs.
  // A folder is only reusable if its creds.json belongs to THIS number.
  // Anything else -- another number's keys, or Signal keys with no creds at all
  // (left behind when a logout wiped creds but not the 30+ pre-key files) --
  // gets emptied first. Orphaned keys are exactly what makes a freshly paired
  // socket unable to decrypt its own messages.
  const entries = fs.readdirSync(authFolder);
  if (entries.length > 0) {
    const credsPath = path.join(authFolder, 'creds.json');
    let credsNum = null;
    try {
      if (fs.existsSync(credsPath)) {
        const meId = JSON.parse(fs.readFileSync(credsPath, 'utf8'))?.me?.id || null;
        credsNum = meId ? String(meId).split('@')[0].split(':')[0] : null;
      }
    } catch (e) {
      console.log(`[SESSION] ⚠️ Unreadable creds.json in ${authFolder}: ${e.message}`);
    }
    if (credsNum !== phoneNumber) {
      const why = !credsNum ? 'no valid creds (orphaned Signal keys)' : `creds for ${credsNum}`;
      const wiped = wipeAuthFolder(authFolder);
      console.log(`[SESSION] ♻️ Auth folder had ${why}, pairing ${phoneNumber} — wiped: ${wiped.ok ? 'yes, ' + wiped.remaining + ' left' : 'FAILED — ' + wiped.reason}`);
    }
  }

  // Start the Baileys socket
  const sock = await startSocket(sessionId, phoneNumber, authFolder);

  // Wait for the socket to be ready to receive a pairing code request.
  // Baileys emits a QR code event when the socket is open + ready to receive commands.
  // We DON'T need to wait for connection: 'open' (that only fires after the user
  // has scanned the QR / entered the pairing code). Instead, we wait for the QR event
  // (or connection: 'open' if it happens first).
  // Timeout: 45s (was 30s — increased for slow networks / Render cold starts).
  let connectionResolved = false;
  const connectionPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!connectionResolved) {
        connectionResolved = true;
        reject(new Error('Connection timeout after 45s. WhatsApp may be blocking the connection. Check your network and try again.'));
      }
    }, 45000);

    const handler = async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log(`[SESSION ${sessionId}] wait handler:`, JSON.stringify({ connection, hasQr: !!qr, statusCode: lastDisconnect?.error?.output?.statusCode }));

      // As soon as we get a QR, the socket is ready — request the pairing code now
      if (qr && !connectionResolved) {
        connectionResolved = true;
        clearTimeout(timeout);
        sock.ev.off('connection.update', handler);
        console.log(`[SESSION ${sessionId}] QR received — socket ready for pairing code`);
        resolve();
      } else if (connection === 'open' && !connectionResolved) {
        // Already connected (e.g. existing auth) — also ready
        connectionResolved = true;
        clearTimeout(timeout);
        sock.ev.off('connection.update', handler);
        resolve();
      } else if (connection === 'close' && !connectionResolved) {
        connectionResolved = true;
        clearTimeout(timeout);
        sock.ev.off('connection.update', handler);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        // Clean up auth on 401 so next attempt starts fresh
        if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
          try {
            wipeAuthFolder(authFolder);
          } catch {}
        }
        // Provide helpful error messages
        if (statusCode === 401) {
          reject(new Error('WhatsApp rejected the connection (401). This can happen if you have too many linked devices. Try removing old linked devices from WhatsApp Settings → Linked Devices, then try again.'));
        } else if (statusCode === 515) {
          reject(new Error('WhatsApp is restarting. Please wait 10 seconds and try again.'));
        } else {
          reject(new Error(`Connection closed (status ${statusCode}). Please try again.`));
        }
      }
    };
    sock.ev.on('connection.update', handler);
  });

  try {
    await connectionPromise;
    console.log(`[SESSION ${sessionId}] Socket ready — requesting pairing code immediately...`);
  } catch (e) {
    try { await sock.logout(); } catch {}
    throw new Error(`Failed to connect to WhatsApp: ${e.message}`);
  }

  // ★ Request pairing code IMMEDIATELY after QR — don't wait for wsReady
  // (wsReady may not exist in all Baileys versions, and waiting causes timeout)
  let code;
  try {
    console.log(`[SESSION ${sessionId}] → Calling sock.requestPairingCode("${phoneNumber}")`);
    code = await sock.requestPairingCode(phoneNumber);
    console.log(`[SESSION ${sessionId}] ← WhatsApp returned pairing code: ${code}`);
  } catch (e) {
    console.error(`[SESSION ${sessionId}] requestPairingCode failed:`, e);
    // Retry once after 2 seconds
    console.log(`[SESSION ${sessionId}] Retrying pairing code in 2s...`);
    await new Promise(r => setTimeout(r, 2000));
    try {
      code = await sock.requestPairingCode(phoneNumber);
      console.log(`[SESSION ${sessionId}] ← Retry succeeded! Code: ${code}`);
    } catch (e2) {
      try { await sock.logout(); } catch {}
      throw new Error(`Failed to get pairing code from WhatsApp: ${e2.message}`);
    }
  }

  if (!code || code.length < 4) {
    try { await sock.logout(); } catch {}
    throw new Error('WhatsApp returned an invalid pairing code. Please try again.');
  }

  // Store in memory
  sessions.set(sessionId, {
    sock,
    phoneNumber,
    status: 'pairing',
    lastActive: Date.now(),
    cleanupTimer: null,
  });

  // Schedule idle cleanup
  scheduleIdleCleanup(sessionId);

  console.log(`[SESSION ${sessionId}] Created for ${phoneNumber} — pairing code: ${code}`);
  return { sessionId, code, db: dbSession };
}

/**
 * Start a Baileys socket for a session
 */
async function startSocket(sessionId, phoneNumber, authFolder) {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[SESSION ${sessionId}] Using Baileys v${version} (latest: ${isLatest})`);
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    // ★ CRITICAL: Use Browsers.appropriate('Chrome') so WhatsApp sees a
    // realistic device fingerprint:
    //   ['Ubuntu', 'Chrome', '22.04.4']
    // Using 'ZYNEX-MD' as the browser name (or as the OS, which the old code
    // did by mistake) is a red flag for WhatsApp's bot detection. The bot's
    // name shows up in messages and the welcome banner instead.
    browser: ['Chrome', 'Chrome', '130.0.0'],
    defaultQueryTimeoutMs: 120000,
    connectTimeoutMs: 120000,
    qrTimeout: 120000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: false,        // don't force online state (less suspicious)
    syncFullHistory: false,
    retryRequestDelayMs: 2000,
    linkPreview: false,
    /**
     * ★ Required for retry receipts.
     *
     * When a recipient cannot decrypt a message it sends a retry receipt asking
     * the sender to resend the original. Baileys defaults this to
     * `async () => undefined`, meaning we can never answer — the recipient's
     * phone then shows "Waiting for this message. This may take a while."
     * permanently, because it is waiting for a re-send that never comes.
     * See WhiskeySockets/Baileys#1701.
     *
     * We already keep every inbound message for anti-delete, so hand it back.
     */
    getMessage: async (key) => {
      try {
        const { getStoredMessage } = require('./anti/antiDelete');
        const stored = getStoredMessage(key?.id);
        if (stored?.message) {
          console.log(`[RETRY] resending stored message ${key.id}`);
          return stored.message;
        }
        console.log(`[RETRY] requested ${key?.id} but it is not in the store`);
      } catch (e) {
        console.log(`[RETRY] lookup failed for ${key?.id}: ${e.message}`);
      }
      return undefined;
    },
  });

  // ============ MAIN EVENT HANDLERS ============
  // ★ All handlers registered ONCE per socket. On reconnect, startSocket()
  // creates a fresh sock, so these handlers are registered fresh.

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, receivedPendingNotifications } = update;
    console.log(`[SESSION ${sessionId}] connection.update:`, JSON.stringify({
      connection,
      statusCode: lastDisconnect?.error?.output?.statusCode,
      hasQr: !!qr,
      receivedPendingNotifications,
    }));

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const errorMsg = lastDisconnect?.error?.message || 'unknown';
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const sess = sessions.get(sessionId);
      const isPairing = sess && sess.status !== 'connected';

      console.log(`[SESSION ${sessionId}] ❌ Closed — code=${statusCode} (${errorMsg}) | isPairing=${isPairing} | isLoggedOut=${isLoggedOut}`);

      // ★ Clean up old socket's event listeners
      try {
        sock.ev.removeAllListeners('messages.upsert');
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        sock.ev.removeAllListeners('messages.update');
        sock.ev.removeAllListeners('call');
        sock.ev.removeAllListeners('group-participants.update');
      } catch {}

      // Status 401 = WhatsApp rejected the connection (logged out / rate limited / auth corrupted)
      // Status 515 = WhatsApp restarting
      // Status 410 = Connection gone
      // Status 428 = Connection closed
      if (isLoggedOut || statusCode === 401) {
        if (isPairing) {
          // During pairing — the auth state might be corrupted.
          // Clear it and try fresh (don't delete the session — user can retry)
          console.log(`[SESSION ${sessionId}] Pairing failed (${statusCode}). Clearing auth + marking disconnected.`);
          try {
            wipeAuthFolder(authFolder);
          } catch {}
          try {
            await prisma.botSession.update({
              where: { id: sessionId },
              data: { status: 'disconnected' },
            });
          } catch {}
          sessions.delete(sessionId);
          // Return error to the pairing endpoint (it handles this)
        } else {
          // Already connected but got 401 — WhatsApp logged out the linked device
          console.log(`[SESSION ${sessionId}] WhatsApp logged out (401). Clearing auth + marking disconnected.`);
          try {
            wipeAuthFolder(authFolder);
          } catch {}
          try {
            await prisma.botSession.update({
              where: { id: sessionId },
              data: { status: 'disconnected' },
            });
          } catch {}
          sessions.delete(sessionId);
        }
      } else {
        // Other close reasons (515, 428, network blip, etc.) — try reconnect with delay
        const delay = statusCode === 515 ? 5000 : 3000; // WhatsApp restart = wait longer
        console.log(`[SESSION ${sessionId}] Connection closed (${statusCode}). Reconnecting in ${delay/1000}s...`);
        setTimeout(async () => {
          try {
            const newSock = await startSocket(sessionId, phoneNumber, authFolder);
            const s3 = sessions.get(sessionId);
            if (s3) s3.sock = newSock;
            console.log(`[SESSION ${sessionId}] ✅ Reconnected after close`);

            // Restart always-online heartbeat if enabled
            try {
              const dbSess = await prisma.botSession.findUnique({ where: { id: sessionId } });
              if (dbSess?.alwaysOnline === true) {
                startAlwaysOnline(newSock, sessionId);
              }
            } catch {}
          } catch (e) {
            console.error(`[SESSION ${sessionId}] Reconnect failed:`, e.message);
          }
        }, 3000);
      }
    } else if (connection === 'open') {
      const user = sock.user;
      console.log(`[SESSION ${sessionId}] ✅ Connected as ${user.id} (${user.name || 'unknown'})`);

      // Update DB
      await prisma.botSession.update({
        where: { id: sessionId },
        data: {
          status: 'connected',
          whatsappId: user.id,
          displayName: user.name || '',
          lastActiveAt: new Date(),
        },
      });

      const s = sessions.get(sessionId);
      if (s) s.status = 'connected';

      // Send connection confirmation
      await sendConnectionMessage(sessionId, phoneNumber, user);

      // ★ Wait 5 seconds before joining the support group to avoid
      // WhatsApp's "slow down — you're sending messages too fast" rate limit
      await new Promise(r => setTimeout(r, 5000));

      // ★ Auto-join a support group — ONLY if the operator explicitly configured
      // one. Off by default so nothing joins anything on your behalf.
      if (process.env.SUPPORT_GROUP_INVITE && process.env.SUPPORT_GROUP_INVITE !== 'disabled') {
        try {
          await autoJoinSupportGroup(sock, sessionId, phoneNumber);
        } catch (e) {
          console.warn(`[SESSION ${sessionId}] Auto-join group failed:`, e.message);
        }
      }

      // ★ Start always-online heartbeat if enabled
      try {
        const freshSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
        if (freshSession?.alwaysOnline === true) {
          startAlwaysOnline(sock, sessionId);
        }
      } catch {}
    }
  });

  // ★ SINGLE messages.upsert handler — handles BOTH command processing AND status auto-read
  // (Old code had TWO handlers which caused race conditions + double-processing)
  // ★ Replying to an @lid chat address is unreliable for our OWN number: Baileys
  // compares the destination against the PN to decide "is this me", the digits
  // never match, and the send stalls (phone shows "Waiting for this message").
  // Wrapping sendMessage once here covers every command file.
  // Log EVERY outgoing send, not only the rewritten ones. Without this there is
  // no way to tell "we never tried to send" from "we sent to an address that
  // never resolved", which is precisely the ambiguity that made the self-chat
  // stall so hard to pin down.
  // Register our OWN identity from creds — the only place the LID is reliable.
  // sock.user has no `lid` field in this Baileys build (live log: sock.lid=-),
  // so without this the own-LID rewrite never matched and self-chat replies
  // were addressed to a bare @lid that Baileys treats as a stranger.
  try {
    const creds = state.creds || {};
    jidHelper.registerOwnIdentity({
      phoneNumber,
      lid: creds.me?.lid,
      id: creds.me?.id,
    });
    console.log(
      `[JID] own identity: pn=${creds.me?.id || phoneNumber} lid=${creds.me?.lid || 'none'}`,
    );
  } catch (e) {
    console.log(`[JID] could not register own identity: ${e.message}`);
  }

  jidHelper.patchSocketSends(sock, (from, to) => {
    console.log(`[SEND] 🔁 ${from} → ${to}  (LID rewritten to PN)`);
  });
  const beforeSend = sock.sendMessage;
  sock.sendMessage = async (jid, content, opts) => {
    const kind = content ? Object.keys(content).filter((k) => k !== 'caption').join('+') : '?';
    console.log(`[SEND] → ${jid} (${kind})`);
    return beforeSend(jid, content, opts);
  };

  // messagesSent was never incremented anywhere, so the panel always reported
  // "0 sent" even while replies were going out. Count the real thing.
  // NOTE: `s` (the in-memory session record) does not exist here — startSocket()
  // runs before createSession()/reconnectAllSessions() store it. Referencing it
  // threw a ReferenceError that the bare `catch {}` swallowed, so this counter
  // silently never worked. Read the row instead.
  const rawSend = sock.sendMessage;
  let sentCount = 0;
  sock.sendMessage = async (...args) => {
    const res = await rawSend(...args);
    sentCount++;
    try {
      const row = await prisma.botSession.findUnique({ where: { id: sessionId } });
      await prisma.botSession.update({
        where: { id: sessionId },
        data: { messagesSent: (row?.messagesSent || 0) + 1 },
      });
    } catch (e) {
      console.log(`[SESSION ${sessionId}] could not record send: ${e.message}`);
    }
    return res;
  };

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (!messages || !messages.length) return;
    console.log(`[SESSION ${sessionId}] 📨 messages.upsert type=${type} count=${messages.length}`);

    // Skip non-real-time messages (history sync, etc.)
    if (type !== 'notify') {
      console.log(`[SESSION ${sessionId}] ↩️ Skipping (type=${type} !== 'notify')`);
      return;
    }

    const s = sessions.get(sessionId);
    if (!s) {
      console.log(`[SESSION ${sessionId}] ↩️ No active session in memory map`);
      return;
    }

    // Load DB session once for this batch
    const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
    if (!dbSession) {
      console.log(`[SESSION ${sessionId}] ↩️ No DB session record — skipping`);
      return;
    }

    for (const msg of messages) {
      try {
        // 1. Auto-read status broadcasts (separate from command processing)
        if (msg.key.remoteJid === 'status@broadcast') {
          if (dbSession.autoReadStatus !== false) {
            try { await sock.readMessages([msg.key]); } catch {}
          }
          continue; // don't run commands on status updates
        }

        // 2. Validate message has content
        if (!msg.message) {
          console.log(`[SESSION ${sessionId}] ↩️ Message has no .message field`);
          continue;
        }

        // 3. ★ FIX: Don't skip fromMe messages at all.
        //    The bot is the owner's linked WhatsApp device, so:
        //    - In DMs: fromMe=true means the OWNER texted from their phone
        //    - In groups: fromMe=true means the owner texted from their phone
        //      (the bot's own sent messages also have fromMe=true, but they
        //       don't start with the command prefix, so they're ignored by
        //       the handler anyway — no infinite loop)
        //    Old code skipped fromMe in groups → blocked all owner group commands.
        //    Now we process everything and let the handler decide.

        // Learn this sender's PN from the stanza (Baileys attaches senderPn /
        // participantPn). Without it we only know the LID, and a LID cannot be
        // used to reply to our own chat.
        try { jidHelper.rememberFromKey(msg.key); } catch {}

        // [ADDR] — what we are actually replying TO. "DM from <sender>" above is
        // the sender, which for a self-chat is the LID while the chat itself is
        // the PN (or vice versa). Without this line there is no way to tell
        // which one a stalled reply was addressed to.
        console.log(
          `[ADDR] remoteJid=${msg.key.remoteJid} participant=${msg.key.participant || '-'} ` +
            `fromMe=${msg.key.fromMe} senderLid=${msg.key.senderLid || '-'} ` +
            `senderPn=${msg.key.senderPn || '-'} stanzaId=${msg.key.id} ` +
            `sock.user=${sock.user?.id || '-'} sock.lid=${sock.user?.lid || '-'}`,
        );

        // 4. Update lastActive + message counter
        s.lastActive = Date.now();
        try {
          await prisma.botSession.update({
            where: { id: sessionId },
            data: {
              lastActiveAt: new Date(),
              messagesReceived: (dbSession.messagesReceived || 0) + 1,
            },
          });
        } catch {}

        // 5. Store message for anti-delete (always — store first, decide later)
        try {
          const { storeMessage } = require('./anti/antiDelete');
          await storeMessage(msg);
        } catch {}

        // ★★ ANTI-BUG PROTECTION (always on) ★★
        // Check for spam/flood before processing the message
        try {
          const { checkSpam, handleBlock, isBlocked } = require('./anti/antiBug');
          const senderJid = msg.key.participant || msg.key.remoteJid;
          const senderNum = senderJid.split('@')[0].split(':')[0];

          // Owner identity has to be checked in every form WhatsApp uses, or the
          // owner gets rate-limited (and then blocked) by their own bot:
          //   - phone number            2348021016309
          //   - multi-device suffix     2348021016309:11
          //   - @lid linked identity    46274514571441@lid   ← seen in production:
          //     the owner's own .ping/.menu arrived as a 14-digit LID, failed the
          //     number comparison, tripped the spam window and was blocked, so no
          //     command ever reached the handler. Blue ticks and silence.
          const me = sock.user || {};
          const selfIds = new Set(
            [
              dbSession.phoneNumber,
              me.id,
              me.lid,
              me.phoneNumber,
            ]
              .filter(Boolean)
              .map((v) => String(v).split('@')[0].split(':')[0]),
          );
          const isOwner =
            selfIds.has(senderNum) ||
            msg.key.fromMe === true ||
            // any @lid identity of the owner, as reported by the socket
            (senderJid.endsWith('@lid') && Boolean(me.lid) && String(me.lid).split('@')[0] === senderNum);

          const spamCheck = checkSpam(senderNum, isOwner);
          if (spamCheck.blocked) {
            console.log(`[ANTI-BUG] 🚫 Blocked message from ${senderNum}: ${spamCheck.reason}`);
            if (!isBlocked(senderNum)) {
              // First time blocked — block on WhatsApp + notify owner
              await handleBlock(sock, senderNum, spamCheck.reason);
              try {
                const ownerJid = `${dbSession.phoneNumber}@s.whatsapp.net`;
                await sock.sendMessage(ownerJid, {
                  text: `🛡️ *ANTI-BUG PROTECTION*\n\n🚫 *Blocked:* ${senderNum}\n⚡ *Reason:* ${spamCheck.reason}\n\n_This number has been blocked permanently and cannot message you again._`,
                });
              } catch {}
            }
            continue; // Skip this message entirely
          }
        } catch (e) {
          console.warn(`[ANTI-BUG] Check failed:`, e.message);
        }

        // 6. Run the message handler (commands)
        await handleMessage(sock, msg, dbSession);

        // 7. Run anti-modules (anti-link, anti-bot, etc.)
        await handleAnti(sock, msg, dbSession);

        // 8. ★ Auto-respond (if enabled + message is NOT from the owner + not a command)
        //    This makes the bot reply like a human on the owner's behalf.
        if (dbSession.autoRespond === true) {
          try {
            await maybeAutoRespond(sock, msg, dbSession);
          } catch (e) {
            console.warn(`[SESSION ${sessionId}] Auto-respond error:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[SESSION ${sessionId}] Message processing error:`, e);
      }
    }
  });

  // Anti-delete
  sock.ev.on('messages.update', async (updates) => {
    const { handleAntiDelete } = require('./anti/antiDelete');
    const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
    // Anti-delete is ON by default (dbSession.antiDelete !== false)
    if (dbSession?.antiDelete === false) return;
    for (const update of updates) {
      try { await handleAntiDelete(sock, update, sessionId); } catch (e) {
        console.warn(`[SESSION ${sessionId}] Anti-delete error:`, e.message);
      }
    }
  });

  // Anti-call — auto-reject incoming WhatsApp calls
  // ★ Baileys emits 'call' event with an ARRAY of calls: [call1, call2, ...]
  //    Old code treated it as a single object → callEvent.id was undefined → nothing rejected.
  sock.ev.on('call', async (calls) => {
    const callList = Array.isArray(calls) ? calls : [calls];
    console.log(`[SESSION ${sessionId}] 📞 Incoming call event: ${callList.length} call(s)`);
    for (const callEvent of callList) {
      console.log(`[SESSION ${sessionId}] 📞 Call:`, JSON.stringify({
        from: callEvent?.from,
        isVideo: callEvent?.isVideo,
        status: callEvent?.status,
        id: callEvent?.id,
      }));
      try {
        const { handleCall } = require('./anti/antiCall');
        const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
        await handleCall(sock, callEvent, dbSession);
      } catch (e) {
        console.warn(`[SESSION ${sessionId}] Anti-call error:`, e.message);
      }
    }
  });

  // Welcome/Goodbye
  sock.ev.on('group-participants.update', async (event) => {
    const { handleGroupJoin, handleGroupLeave } = require('./anti/welcome');
    try {
      if (event.action === 'add') await handleGroupJoin(sock, event, sessionId);
      else if (event.action === 'remove') await handleGroupLeave(sock, event, sessionId);
    } catch {}
  });

  // ★ No separate 'messages.upsert' for status auto-read — it's now handled
  //    in the SINGLE messages.upsert handler above (see step 1).
  //    Old code had TWO handlers firing on every message — caused race conditions.

  return sock;
}

/**
 * ★ Auto-respond to messages on behalf of the bot owner.
 *
 * Only triggers when:
 *   - dbSession.autoRespond === true
 *   - Message is from someone ELSE (not the owner)
 *   - Message is NOT a command (doesn't start with prefix)
 *   - Message is in a DM (not a group — too noisy in groups)
 *
 * Uses the autoRespond module to generate a human-like reply.
 */
async function maybeAutoRespond(sock, msg, dbSession) {
  const text = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text ||
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption || '';

  if (!text) return;

  // Don't reply to commands (messages starting with prefix)
  const prefix = dbSession.prefix || '.';
  if (text.startsWith(prefix)) return;

  // Don't reply in groups (too noisy + could trigger anti-spam)
  if (msg.key.remoteJid.endsWith('@g.us')) return;

  // Don't reply to status broadcasts
  if (msg.key.remoteJid === 'status@broadcast') return;

  // Don't reply to the owner's own messages (would cause infinite loop)
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderJid.split('@')[0].split(':')[0];
  if (senderNum === dbSession.phoneNumber) return;

  console.log(`[AUTO-RESPOND] Generating reply for message from ${senderNum}: "${text.slice(0, 60)}..."`);

  try {
    // Generate a reply using the autoRespond module
    const { generateReply } = require('./utils/autoRespond');
    const reply = await generateReply(text, msg.pushName || 'Friend');

    if (!reply) {
      console.log('[AUTO-RESPOND] No reply generated — skipping');
      return;
    }

    // Small delay to look natural (1-3 seconds)
    const delay = 1000 + Math.random() * 2000;
    await new Promise(r => setTimeout(r, delay));

    // Send the reply
    await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: createFakeContact(msg) });
    console.log(`[AUTO-RESPOND] ✓ Sent: "${reply.slice(0, 60)}..."`);
  } catch (e) {
    console.warn('[AUTO-RESPOND] Failed:', e.message);
  }
}

/**
 * ★ Always-online heartbeat
 *
 * When dbSession.alwaysOnline === true, sends a presence update
 * every 30 seconds to keep the bot appearing "online".
 *
 * Also bypasses the idle-session cleanup.
 */
const onlineHeartbeats = new Map(); // sessionId → interval timer

function startAlwaysOnline(sock, sessionId) {
  // Stop existing heartbeat if any
  stopAlwaysOnline(sessionId);

  const heartbeat = setInterval(async () => {
    try {
      const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
      if (!dbSession || dbSession.alwaysOnline !== true) {
        // Always-online was turned off — stop the heartbeat
        stopAlwaysOnline(sessionId);
        return;
      }
      // Send presence update
      const jid = dbSession.phoneNumber + '@s.whatsapp.net';
      await sock.sendPresenceUpdate('available', jid);
    } catch (e) {
      // Socket may have closed — stop the heartbeat
      console.warn(`[SESSION ${sessionId}] Heartbeat error:`, e.message);
      stopAlwaysOnline(sessionId);
    }
  }, 30000); // every 30 seconds

  onlineHeartbeats.set(sessionId, heartbeat);
  console.log(`[SESSION ${sessionId}] 💓 Always-online heartbeat started (30s interval)`);
}

function stopAlwaysOnline(sessionId) {
  const heartbeat = onlineHeartbeats.get(sessionId);
  if (heartbeat) {
    clearInterval(heartbeat);
    onlineHeartbeats.delete(sessionId);
    console.log(`[SESSION ${sessionId}] 💓 Heartbeat stopped`);
  }
}

/**
 * ★ Auto-join the owner's support group after pairing
 *
 * When a user pairs their WhatsApp with the bot, this silently joins
 * their account to the specified support/community group using the
 * invite code from chat.whatsapp.com links.
 *
 * Silent/anonymous: no notification is sent to the user about this join.
 *
 * The invite code is extracted from URLs like:
 *   https://chat.whatsapp.com/<INVITE_CODE>
 *
 * DISABLED BY DEFAULT. The upstream project hardcoded a third-party invite
 * here, which silently added every paired WhatsApp account to someone else's
 * group. Set SUPPORT_GROUP_INVITE to your own group's code to opt in.
 *
 * Set SUPPORT_GROUP_INVITE env var to override the default, or set
 * SUPPORT_GROUP_INVITE=disabled to turn off auto-join entirely.
 */
// No hardcoded default. Set SUPPORT_GROUP_INVITE to *your own* group's invite
// code if you want this. Upstream shipped a third-party invite that silently
// added every paired account to someone else's group.
const DEFAULT_SUPPORT_GROUP_INVITE = '';

async function autoJoinSupportGroup(sock, sessionId, phoneNumber) {
  const inviteCode = (process.env.SUPPORT_GROUP_INVITE || DEFAULT_SUPPORT_GROUP_INVITE).trim();

  // Allow disabling via env var
  if (!inviteCode || inviteCode === 'disabled' || inviteCode === 'off') {
    return;
  }

  // No extra delay here — the caller already waited 5s before calling us
  // (to avoid WhatsApp rate limits)

  console.log(`[SESSION ${sessionId}] 🤝 Auto-joining support group (code: ${inviteCode})...`);

  try {
    // Baileys' groupAcceptInvite accepts the invite code (NOT the full URL)
    // and returns the group JID on success
    const groupJid = await sock.groupAcceptInvite(inviteCode);

    if (groupJid) {
      console.log(`[SESSION ${sessionId}] ✅ Joined support group: ${groupJid}`);

      // Optional: track in DB that this user joined the support group
      try {
        await prisma.botSession.update({
          where: { id: sessionId },
          data: { supportGroupJoined: true, supportGroupJid: groupJid },
        });
      } catch {}

      // Optional: send a quiet welcome message to the group (only once per user)
      // We DO NOT mention this to the user in DM — keeping it anonymous.
      // Uncomment below if you want the bot to announce itself in the group:
      // try {
      //   await sock.sendMessage(groupJid, {
      //     text: `👋 ${user?.name || 'A new member'} just joined ZYNEX-MD community!`,
      //   });
      // } catch {}
    } else {
      console.log(`[SESSION ${sessionId}] ⚠️ groupAcceptInvite returned no JID (already a member or invalid link)`);
    }
  } catch (e) {
    // Common errors:
    // - "already a member" → fine, ignore
    // - "invited" → group requires admin approval, the user is now in the pending list
    // - "invalid invite link" → code is wrong
    const msg = e.message || '';
    if (msg.includes('already') || msg.includes('member')) {
      console.log(`[SESSION ${sessionId}] ℹ️ Already a member of the support group`);
    } else if (msg.includes('invited') || msg.includes('pending')) {
      console.log(`[SESSION ${sessionId}] 📨 Join request sent (group requires admin approval)`);
    } else {
      console.warn(`[SESSION ${sessionId}] ⚠️ Auto-join failed:`, msg);
    }
  }
}

/**
 * Send the "Welcome to ZYNEX-MD" connection message
 */
async function sendConnectionMessage(sessionId, phoneNumber, user) {
  const s = sessions.get(sessionId);
  if (!s) return;

  const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
  const prefix = dbSession?.prefix || '.';

  const jid = user.id;
  const message = `╔══════════════════════════════════════╗
║      Welcome to ZYNEX-MD!             ║
╚══════════════════════════════════════╝

✅ *Connection Successful!*

📡 *Bot Name:* ${BOT_NAME}
👤 *Connected As:* ${user.name || 'Unknown'}
📱 *Number:* ${phoneNumber}
⚡ *Prefix:* ${prefix}
🟢 *Status:* Online
🌍 *Mode:* Public (everyone can use commands)

👑 *You are the owner of this bot instance!*
Use \`.private\` to make it respond only to you.
Use \`.public\` to let everyone use it.

Type *${prefix}menu* to see all commands.
Type *${prefix}song <name>* to download music!

👑 *Powered by ZYNEX*
_You're all set to rock!_ 🚀`;

  try {
    // Try to send the welcome message with the ZYNEX-MD banner image
    const bannerPath = path.join(__dirname, '..', 'public', 'assets', 'menu-banner.png');
    if (fs.existsSync(bannerPath)) {
      try {
        const bannerBuffer = fs.readFileSync(bannerPath);
        await s.sock.sendMessage(jid, {
          image: bannerBuffer,
          caption: message,
          mimetype: 'image/png',
          fileName: 'zynex-welcome.png',
        });
        console.log(`[SESSION ${sessionId}] Welcome message sent with banner`);
      } catch (imgErr) {
        console.warn(`[SESSION ${sessionId}] Image send failed, sending text only:`, imgErr.message);
        await s.sock.sendMessage(jid, { text: message });
      }
    } else {
      await s.sock.sendMessage(jid, { text: message });
      console.log(`[SESSION ${sessionId}] Welcome message sent (text-only, no banner)`);
    }
    await prisma.botSession.update({
      where: { id: sessionId },
      data: {},
    });
  } catch (e) {
    console.warn(`[SESSION ${sessionId}] Failed to send welcome:`, e.message);
  }
}

/**
 * Schedule idle cleanup — disconnect sessions that haven't received messages in IDLE_TIMEOUT_HOURS
 */
function scheduleIdleCleanup(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (s.cleanupTimer) clearTimeout(s.cleanupTimer);

  s.cleanupTimer = setTimeout(async () => {
    // ★ Bypass idle cleanup if always-online is enabled
    try {
      const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
      if (dbSession?.alwaysOnline === true) {
        console.log(`[SESSION ${sessionId}] 💓 Always-online ON — skipping idle cleanup`);
        scheduleIdleCleanup(sessionId); // reschedule
        return;
      }
    } catch {}

    const idleTime = Date.now() - s.lastActive;
    if (idleTime > IDLE_TIMEOUT_MS) {
      console.log(`[SESSION ${sessionId}] Idle for ${Math.floor(idleTime / 3600000)}h — cleaning up`);
      await removeSession(sessionId);
    } else {
      // Reschedule
      scheduleIdleCleanup(sessionId);
    }
  }, IDLE_TIMEOUT_MS);
}

/**
 * Remove a session — close socket + update DB + delete auth folder
 */
async function removeSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;

  // Stop always-online heartbeat
  stopAlwaysOnline(sessionId);

  try {
    if (s.cleanupTimer) clearTimeout(s.cleanupTimer);
    try { await s.sock.logout(); } catch {}
  } catch {}

  // Update DB
  try {
    await prisma.botSession.update({
      where: { id: sessionId },
      data: { status: 'disconnected' },
    });
  } catch {}

  // Delete auth folder
  try {
    const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
    if (dbSession?.authFolder) {
      const wiped = wipeAuthFolder(dbSession.authFolder);
      console.log(`[SESSION] auth folder cleared: ${wiped.ok ? 'yes' : 'FAILED — ' + wiped.reason}`);
    }
  } catch {}

  sessions.delete(sessionId);
  console.log(`[SESSION ${sessionId}] Removed`);
}

/**
 * Get all sessions (for /api/status)
 */
async function getAllSessions() {
  const dbSessions = await prisma.botSession.findMany({
    orderBy: { lastActiveAt: 'desc' },
  });
  return dbSessions.map(s => ({
    id: s.id,
    phoneNumber: s.phoneNumber,
    displayName: s.displayName,
    status: sessions.has(s.id) ? s.status : (s.status === 'connected' ? 'disconnected' : s.status),
    inMemory: sessions.has(s.id),
    lastActiveAt: s.lastActiveAt,
    messagesReceived: s.messagesReceived,
    messagesSent: s.messagesSent,
    commandsExecuted: s.commandsExecuted,
    createdAt: s.createdAt,
  }));
}

/**
 * Reconnect all sessions that were active before a server restart
 * (i.e. sessions with status='connected' but not currently in memory)
 */
/**
 * Restart in place.
 *
 * `.restart` used to call process.exit(0). On a multi-user pairing server that
 * is wrong three ways:
 *   1. it kills EVERY paired user's session, not just the caller's;
 *   2. it takes the web panel down with it;
 *   3. exiting 0 is not a crash, so Railway's `restartPolicyType: ON_FAILURE`
 *      never restarted the container — the site stayed 502 until an operator
 *      redeployed.
 * Reconnecting the sockets in this process gives the same user-visible result
 * without dropping the HTTP server or any other user's connection.
 */
/**
 * Close one session's socket WITHOUT touching its creds or DB row.
 *
 * Used by `.shutdown`: the user wants their bot to stop right now and be able
 * to resume later. `removeSession` would log the device out and wipe the auth
 * folder, which turns "stop for a bit" into "pair again from scratch".
 */
async function stopSession(sessionId, { keepCreds = true } = {}) {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, reason: 'not running' };
  try { if (s.cleanupTimer) clearTimeout(s.cleanupTimer); } catch {}
  try { stopAlwaysOnline(sessionId); } catch {}
  try { await s.sock.end(undefined); } catch {}
  sessions.delete(sessionId);
  if (!keepCreds) {
    try {
      const dbSession = await prisma.botSession.findUnique({ where: { id: sessionId } });
      if (dbSession?.authFolder) wipeAuthFolder(dbSession.authFolder);
    } catch {}
  }
  try {
    await prisma.botSession.update({
      where: { id: sessionId },
      data: { status: 'stopped' },
    });
  } catch {}
  console.log(`[SESSION ${sessionId}] ⏹ Stopped (creds ${keepCreds ? 'kept' : 'cleared'})`);
  return { ok: true };
}

async function restartInPlace() {
  const ids = [...sessions.keys()];
  console.log(`[RESTART] Reconnecting ${ids.length} session(s) in place`);
  for (const id of ids) {
    const s = sessions.get(id);
    if (!s) continue;
    try { if (s.cleanupTimer) clearTimeout(s.cleanupTimer); } catch {}
    try { stopAlwaysOnline(id); } catch {}
    try { await s.sock.end(undefined); } catch {}
    sessions.delete(id);
  }
  await reconnectAllSessions();
  return { reconnected: [...sessions.keys()].length };
}

/**
 * Is there usable, registered auth for this number on disk?
 *
 * Used to decide whether a session marked "disconnected" should be revived.
 * The distinction matters: creds that still exist mean the process died (a
 * deploy, a killed container, `.restart` under the old code) and the user
 * never asked to be disconnected — bring it back. Creds gone means the user
 * logged out or used Disconnect, and reviving it would ignore their choice.
 */
function hasValidCreds(folder, phoneNumber) {
  try {
    const credsPath = path.join(folder, 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    if (!creds?.registered) return false;
    const me = String(creds?.me?.id || '').split('@')[0].split(':')[0];
    return me === String(phoneNumber).split('@')[0].split(':')[0];
  } catch {
    return false;
  }
}

async function reconnectAllSessions() {
  // Revive anything a user did not deliberately stop:
  //   connected  -> obviously
  //   disconnected AND creds still on disk -> the process died mid-flight
  //   stopped    -> the user asked for it, leave it alone
  const all = await prisma.botSession.findMany({ where: {} });
  const dbSessions = all.filter((r) => {
    if (r.status === 'connected') return true;
    if (r.status === 'disconnected') return hasValidCreds(r.authFolder, r.phoneNumber);
    return false;
  });
  console.log(
    `[BOOT] Reconnecting ${dbSessions.length} of ${all.length} session(s) from DB` +
      (all.length !== dbSessions.length
        ? ` (skipped: ${all.filter((r) => !dbSessions.includes(r)).map((r) => r.phoneNumber + ':' + r.status).join(', ')})`
        : '') +
      '...',
  );

  for (const dbSession of dbSessions) {
    if (sessions.has(dbSession.id)) continue; // Already in memory
    if (!fs.existsSync(dbSession.authFolder)) {
      // Auth folder is gone — mark as disconnected
      await prisma.botSession.update({
        where: { id: dbSession.id },
        data: { status: 'disconnected' },
      });
      continue;
    }
    try {
      const sock = await startSocket(dbSession.id, dbSession.phoneNumber, dbSession.authFolder);
      sessions.set(dbSession.id, {
        sock,
        phoneNumber: dbSession.phoneNumber,
        status: 'connecting',
        lastActive: Date.now(),
        cleanupTimer: null,
      });
      scheduleIdleCleanup(dbSession.id);
      // Start always-online heartbeat if it was enabled
      if (dbSession.alwaysOnline === true) {
        startAlwaysOnline(sock, dbSession.id);
      }
      console.log(`[BOOT] Reconnecting session ${dbSession.id} (${dbSession.phoneNumber})`);
    } catch (e) {
      console.error(`[BOOT] Failed to reconnect session ${dbSession.id}:`, e.message);
      await prisma.botSession.update({
        where: { id: dbSession.id },
        data: { status: 'disconnected' },
      });
    }
  }
}

/**
 * Get a session by phone number
 */
function getSession(sessionId) {
  return sessions.get(sessionId);
}

function getSessionsCount() {
  return sessions.size;
}

// No max sessions limit — bot is for everyone.
// getMaxSessions() kept for backwards compat but returns null now.
function getMaxSessions() {
  return null;
}

module.exports = {
  createSession,
  removeSession,
  getAllSessions,
  reconnectAllSessions,
  getSession,
  getSessionsCount,
  getMaxSessions,
  sweepOrphanAuthFolders,
  killSessionsForNumber,
  restartInPlace,
  stopSession,
  wipeAuthFolder,
  _internals: { killSessionsForNumber, wipeAuthFolder, sweepOrphanAuthFolders },
};
