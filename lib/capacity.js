/**
 * lib/capacity.js — how many bots can THIS host actually run?
 *
 * The panel is already multi-tenant: every visitor who pairs gets their own
 * Baileys instance, and there is no account model to fight. So "can my
 * deployers host other people?" was never a feature question.
 *
 * It is a memory question. Each live WhatsApp socket holds ~30-50 MB, and the
 * container this runs in reports a ~953 MB ceiling. That is roughly twenty
 * bots. Past that the kernel kills the process and EVERY paired user drops at
 * once — including the owner, with no explanation in the logs.
 *
 * A graceful refusal costs one user a message. An OOM kill costs everybody
 * their bot. So the cap is real, computed per host rather than hardcoded, and
 * it says why.
 *
 * MAX_SESSIONS overrides it. Set MAX_SESSIONS=0 for truly unlimited (accepting
 * that the host will OOM first).
 */

const fs = require('fs');

/** Bytes of memory this process may use. 0 when the host does not say. */
function memoryLimit() {
  const probe = [
    '/sys/fs/cgroup/memory.max',                    // cgroup v2
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',  // cgroup v1
  ];
  for (const f of probe) {
    try {
      const raw = fs.readFileSync(f, 'utf8').trim();
      if (raw === 'max' || !raw) continue;
      const n = Number(raw);
      // cgroup v1 reports a huge sentinel when unlimited
      if (Number.isFinite(n) && n > 0 && n < 1e15) return n;
    } catch { /* not there — try the next */ }
  }
  try {
    return require('os').totalmem();
  } catch {
    return 0;
  }
}

const MB = 1024 * 1024;

/** Reserved for Node itself, sharp/ffmpeg buffers and message handling. */
const BASE_MB = 180;
/** Conservative per-socket cost. The code comment says 30-50; plan for 50. */
const PER_SESSION_MB = 50;

/**
 * Compute the cap. Returns { limit, source, reason }.
 * limit === 0 means unlimited.
 */
function compute(opts = {}) {
  const raw = process.env.MAX_SESSIONS;
  if (raw !== undefined && raw !== '') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) {
      return {
        limit: n,
        source: 'MAX_SESSIONS',
        reason: n === 0 ? 'unlimited by config — the host will run out of memory first' : `configured to ${n}`,
      };
    }
  }

  const mem = opts.memBytes !== undefined ? opts.memBytes : memoryLimit();
  if (!mem) {
    return { limit: 20, source: 'default', reason: 'host memory unknown, assuming a 1 GB container' };
  }
  const usableMb = mem / MB - BASE_MB;
  const limit = Math.max(1, Math.floor(usableMb / PER_SESSION_MB));
  return {
    limit,
    source: 'memory',
    reason: `${Math.round(mem / MB)} MB container, ~${BASE_MB} MB base, ~${PER_SESSION_MB} MB per socket`,
  };
}

/** Live memory pressure, for /api/status. */
function pressure() {
  const mem = memoryLimit();
  let used = 0;
  try {
    used = process.memoryUsage().rss;
  } catch { /* ignore */ }
  return {
    limitMb: mem ? Math.round(mem / MB) : null,
    usedMb: Math.round(used / MB),
    percent: mem ? Math.round((used / mem) * 100) : null,
  };
}

/**
 * Can we accept one more? Returns { ok, message }.
 * The message is user-facing: it goes straight into the API error.
 */
function canAccept(activeCount) {
  const cap = compute();
  if (cap.limit === 0) return { ok: true, cap };

  // Hard cap on session count.
  if (activeCount >= cap.limit) {
    return {
      ok: false,
      cap,
      message:
        `This server is hosting ${activeCount} bots and its safe limit is ${cap.limit} ` +
        `(${cap.reason}). Nothing was lost — try again later, or ask the owner to ` +
        `raise MAX_SESSIONS or move to a larger plan.`,
    };
  }

  // Even under the session cap, memory can be tight if users are busy.
  const p = pressure();
  if (p.percent !== null && p.percent > 90) {
    return {
      ok: false,
      cap,
      message:
        `This server is at ${p.percent}% of its memory (${p.usedMb}/${p.limitMb} MB). ` +
        `Pairing now risks dropping every connected bot, so it was refused. Try again shortly.`,
    };
  }

  return { ok: true, cap };
}

module.exports = { compute, canAccept, pressure, memoryLimit, BASE_MB, PER_SESSION_MB };
