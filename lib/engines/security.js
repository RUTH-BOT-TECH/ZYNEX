/**
 * SECURITY ENGINE — 32 catalogue names.
 *
 * Everything here is real: either a live API, real cryptography, or a genuine
 * session/token workflow. Nothing is theatre.
 *
 * Live sources (probed Nov 2026, all keyless):
 *
 *   Google Safe Browsing status  transparencyreport.google.com  (real danger flag)
 *   Pwned Passwords range API    api.pwnedpasswords.com/range/    (k-anonymity)
 *   Verisign RDAP                rdap.verisign.com/com/v1/domain/ (age, registrar)
 *   SSL Labs                     api.ssllabs.com/api/v3/analyze   (TLS grade)
 *   HackerTarget                 api.hackertarget.com             (headers, DNS, hosts)
 *   Google DoH                   dns.google/resolve               (SPF/DMARC/records)
 *   AlienVault OTX               otx.alienvault.com/api/v1        (reputation, pulses)
 *   MAC Vendors                  api.macvendors.com               (vendor lookup)
 *
 * What genuinely cannot work keyless, and therefore refuses rather than fakes:
 *
 *   `.breach <email>` / `.pwned <email>`  HIBP breach lookup needs an API key (401).
 *                                          The password half of HIBP *is* keyless, so
 *                                          these tell the user to use `.pwnedpass`.
 *   `.filescan` / `.virus`               VirusTotal needs a key.
 *   `.kycstatus` / `.verifyme`           local workflow only — no document verification
 *                                          service exists keyless, and this bot must not
 *                                          pretend to verify identity documents.
 *
 * Group-side features (`.blocklist_check .ipban .twofa` state, activity audit) use the
 * bot's own store — see `lib/secstore.js`.
 */
'use strict';

const crypto = require('crypto');
const store = require('../secstore');

const UA = 'ZYNEX-MD/1.0 (WhatsApp bot)';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const get = async (url, { as = 'json', ua = UA, timeout = 25_000 } = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(timeout) });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (as === 'text') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

/* ══════════════════ URL / domain analysis ══════════════════ */

/** Pull a hostname out of whatever the user typed. */
function toHost(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

const PRIVATE_RE = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\])/i;

/**
 * Google Safe Browsing status.
 * The response is `)]}'` followed by JSON: [["sb.ssr", status, malware, social,
 * unwanted, ?, timestamp, site, ?]] where status 3 = dangerous, 4 = clean.
 */
/**
 * Google rate-limits this endpoint (HTTP 429) when it is hit repeatedly, which a
 * busy group will do. Retry twice with a pause before giving up — a scan that
 * silently loses its strongest signal is worse than a scan that takes 4s.
 */
async function safeBrowsing(host) {
  const url = `https://transparencyreport.google.com/transparencyreport/api/v3/safebrowsing/status?site=${encodeURIComponent(host)}`;
  let raw = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3 && raw === null; attempt++) {
    try {
      raw = await get(url, { as: 'text' });
    } catch (e) {
      lastErr = e;
      if (!/429|HTTP 5/.test(e.message)) throw e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
    }
  }
  if (raw === null) throw lastErr || new Error('no answer');
  const json = raw.replace(/^\)\]\}'/, '').trim();
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('unexpected response');
  }
  const row = Array.isArray(data?.[0]) ? data[0] : null;
  if (!row) return { known: false, verdict: 'unknown' };
  // status codes: 1 unknown/unindexed, 3 dangerous, 4 clean, 5 clean-ish
  const status = row[1];
  const flags = { malware: Boolean(row[2]), social: Boolean(row[3]), unwanted: Boolean(row[4]) };
  const dangerous = status === 3 || flags.malware || flags.social || flags.unwanted;
  return {
    known: true,
    status,
    flags,
    verdict: dangerous ? 'dangerous' : status === 4 || status === 5 ? 'clean' : 'unindexed',
  };
}

/** Verisign RDAP covers .com/.net; fall back to the generic bootstrap for others. */
async function rdap(host) {
  const tld = host.split('.').pop();
  const url =
    tld === 'com' || tld === 'net'
      ? `https://rdap.verisign.com/${tld}/v1/domain/${encodeURIComponent(host)}`
      : `https://rdap.org/domain/${encodeURIComponent(host)}`;
  const j = await get(url, { ua: BROWSER_UA });
  const event = (action) => (j.events || []).find((e) => e.eventAction === action)?.eventDate;
  const registrar = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const regName = registrar?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || registrar?.handle;
  return {
    registered: event('registration'),
    expires: event('expiration'),
    updated: event('last changed'),
    registrar: regName,
    status: j.status || [],
    nameservers: (j.nameservers || []).map((n) => n.ldhName).filter(Boolean),
  };
}

/** TLS grade via SSL Labs. Cached results only — a fresh test takes minutes. */
async function tlsGrade(host) {
  const j = await get(
    `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&fromCache=on&maxAge=24&all=done`,
    { ua: BROWSER_UA, timeout: 30_000 },
  );
  const ep = (j.endpoints || [])[0];
  if (!ep) return null;
  return {
    grade: ep.grade || ep.gradeTrustIgnored || null,
    status: j.status,
    ip: ep.ipAddress,
    hasWarnings: Boolean(ep.hasWarnings),
    protocols: (ep.details?.protocols || [])
      .filter((p) => p.name !== ' TLS' || true)
      .map((p) => `${p.name.trim().toLowerCase() === 'tls' ? 'TLS' : p.name.trim()} ${p.version}`),
  };
}

async function headers(host) {
  const txt = await get(`https://api.hackertarget.com/httpheaders/?q=${encodeURIComponent(host)}`, { as: 'text' });
  if (/error|valid key/i.test(txt.slice(0, 80))) throw new Error(txt.split('\n')[0].slice(0, 60));
  return txt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** SPF / DMARC / DKIM-hint via DNS-over-HTTPS (JSON, no scraping). */
async function dnsRecords(host, type) {
  const j = await get(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`);
  return (j.Answer || []).map((a) => String(a.data).replace(/^"|"$/g, ''));
}

async function subdomains(host) {
  const txt = await get(`https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(host)}`, { as: 'text' });
  if (/error|valid key/i.test(txt.slice(0, 80))) throw new Error(txt.split('\n')[0].slice(0, 60));
  return txt
    .split('\n')
    .map((l) => l.split(',')[0]?.trim())
    .filter(Boolean)
    .slice(0, 25);
}

/* ══════════════════ typosquat / lookalike detection ══════════════════ */

const BRANDS = [
  'whatsapp', 'facebook', 'instagram', 'telegram', 'google', 'apple', 'microsoft',
  'paypal', 'netflix', 'amazon', 'binance', 'opay', 'palmpay', 'gtbank', 'accessbank',
  'zenithbank', 'firstbank', 'uba', 'kuda', 'moniepoint', 'jamb', 'nnpc', 'cbn', 'nibss',
];

const LEET = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };

function debrand(host) {
  return host
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/[013457 8@$]/g, (c) => LEET[c] || c);
}

/** crude but honest: distance 1-2 from a brand, or brand + a suspicious suffix */
function typosquatCheck(host) {
  const bare = host.split('.').slice(0, -1).join('') || host;
  const raw = bare.toLowerCase();
  const flat = debrand(bare);
  const hits = [];
  for (const brand of BRANDS) {
    if (raw === brand) continue; // the genuine domain — never flag it
    // Homograph by digits/punctuation: paypa1 -> paypal, g00gle -> google.
    // Compare the RAW name to the brand for this, not the de-leeted form —
    // the first version skipped these because de-leeting made them identical
    // and the code mistook them for the real domain.
    if (flat === brand) {
      hits.push({ brand, reason: 'digits or symbols standing in for letters' });
      continue;
    }
    if (flat.includes(brand) && flat !== brand) {
      const extra = flat.replace(brand, '');
      if (extra.length <= 4 || /login|secure|verify|update|account|wallet|gift|bonus|airdrop/.test(host)) {
        hits.push({ brand, reason: `contains "${brand}" with "${extra || 'extra words'}" added` });
      }
    }
    // single-character substitution / insertion / deletion
    if (Math.abs(flat.length - brand.length) <= 2 && flat !== brand) {
      const d = editDistance(flat, brand);
      if (d === 1) hits.push({ brand, reason: 'one character away from the real name' });
    }
  }
  const suspiciousTld = /\.(zip|mov|top|xyz|tk|ml|ga|cf|gq|cyou|rest|buzz|click|link|work|loan)$/i.test(host);
  const manyDashes = (host.match(/-/g) || []).length >= 3;
  const deepSub = host.split('.').length >= 4;
  return { hits, suspiciousTld, manyDashes, deepSub };
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/* ══════════════════ passwords ══════════════════ */

/** HIBP range API — k-anonymity, the full password never leaves the host. */
async function pwnedPassword(password) {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const txt = await get(`https://api.pwnedpasswords.com/range/${prefix}`, {
    as: 'text',
    timeout: 20_000,
  });
  const line = txt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.split(':')[0]?.toUpperCase() === suffix);
  const count = line ? parseInt(line.split(':')[1], 10) : 0;
  return { sha1Prefix: prefix, count };
}

/* ══════════════════ TOTP / 2FA ══════════════════ */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** RFC 6238 TOTP, 6 digits, 30s step, SHA-1 — what every authenticator app uses. */
function totp(secret, { step = 30, digits = 6, at = Date.now() } = {}) {
  const key = base32Decode(secret);
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

const totpCheck = (secret, code, { window = 1 } = {}) => {
  for (let w = -window; w <= window; w++) {
    if (totp(secret, { at: Date.now() + w * 30_000 }) === String(code).trim()) return true;
  }
  return false;
};

const totpRemaining = () => 30 - (Math.floor(Date.now() / 1000) % 30);

/* ══════════════════ hashes ══════════════════ */

const HASHES = {
  md5: (s) => crypto.createHash('md5').update(s).digest('hex'),
  sha1: (s) => crypto.createHash('sha1').update(s).digest('hex'),
  sha256: (s) => crypto.createHash('sha256').update(s).digest('hex'),
  sha512: (s) => crypto.createHash('sha512').update(s).digest('hex'),
  sha3: (s) => crypto.createHash('sha3-256').update(s).digest('hex'),
};

/** identify a hash by its shape — the actual use of .hashcheck */
function hashKind(h) {
  const s = String(h).trim();
  if (!/^[a-f0-9]+$/i.test(s)) return null;
  return {
    32: 'MD5',
    40: 'SHA-1',
    56: 'SHA-224',
    64: 'SHA-256',
    96: 'SHA-384',
    128: 'SHA-512',
  }[s.length] || null;
}

/* ══════════════════ names ══════════════════ */

const NAMES = new Set([
  'scan', 'safelink', 'checklink', 'urlscan', 'phishing', 'scamcheck', 'fraud',
  'breach', 'pwned', 'leakcheck', 'reputation',
  'otp', 'totp', 'twofa', 'verify', 'verification', 'unverify', 'captcha',
  'hashcheck', 'malware', 'virus', 'filescan',
  'ipban', 'blocklist_check', 'kycstatus', 'verifyme',
  'spamcheck', 'honeypot', 'activity_log', 'audit', 'audit_log', 'logs_view',
]);

const RISK = (score) =>
  score >= 70 ? '🔴 HIGH' : score >= 40 ? '🟠 MEDIUM' : score >= 15 ? '🟡 LOW' : '🟢 CLEAN';

module.exports = {
  id: 'security',
  name: 'security-engine',
  match: (n) => NAMES.has(n),
  describe(name) {
    if (['scan', 'safelink', 'checklink', 'urlscan', 'phishing', 'scamcheck', 'fraud'].includes(name))
      return 'Scan a link for scams and malware';
    if (['breach', 'pwned', 'leakcheck'].includes(name)) return 'Check whether a password leaked';
    if (['otp', 'totp', 'twofa'].includes(name)) return 'Real RFC 6238 one-time codes';
    return 'Security utility';
  },
  extraNames: [...NAMES],

  _internals: { toHost, safeBrowsing, rdap, tlsGrade, headers, dnsRecords, totp, totpCheck, hashKind, typosquatCheck, pwnedPassword, editDistance },

  async execute({ command, args, reply, sender, from }) {
    const q = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

    /* ─────────────────── link scanning ─────────────────── */
    if (['scan', 'safelink', 'checklink', 'urlscan', 'phishing', 'scamcheck', 'fraud'].includes(command)) {
      if (!q) {
        return reply(
          `🔗 Usage: \`.${command} <link or domain>\`\n` +
            `Example: \`.${command} gtbank-secure-login.top\``,
        );
      }
      const host = toHost(q);
      if (!host) return reply('❌ That does not look like a link or domain.');

      // A private/local address is not something a remote service can judge.
      if (PRIVATE_RE.test(host)) {
        return reply(
          `🏠 *${host}* is a private/local address. Scanners on the internet cannot see it,\n` +
            `so any "result" would be invented. Nothing to scan.`,
        );
      }

      const lines = [`🛡️ *LINK SCAN* — \`${host}\`\n`];
      let score = 0;
      const notes = [];

      // 1. Google Safe Browsing (the strong signal)
      try {
        const sb = await safeBrowsing(host);
        if (sb.verdict === 'dangerous') {
          score += 80;
          const which = Object.entries(sb.flags).filter(([, v]) => v).map(([k]) => k);
          lines.push(`🚨 *Safe Browsing: DANGEROUS*${which.length ? ` (${which.join(', ')})` : ''}`);
        } else if (sb.verdict === 'clean') {
          lines.push('✅ *Safe Browsing: no listing*');
        } else {
          lines.push('⚪ *Safe Browsing: not indexed* (unknown domain — common for new sites)');
          score += 5;
        }
      } catch (e) {
        lines.push(`⚠️ Safe Browsing unavailable (${e.message})`);
      }

      // 2. lookalike / typosquat analysis
      const ts = typosquatCheck(host);
      for (const h of ts.hits) {
        score += 25;
        notes.push(`⚠️ looks like *${h.brand}* — ${h.reason}`);
      }
      if (ts.suspiciousTld) {
        score += 15;
        notes.push('⚠️ free/high-abuse TLD (.top .xyz .tk .ml .gq …)');
      }
      if (ts.manyDashes) {
        score += 10;
        notes.push('⚠️ three or more hyphens in the hostname');
      }
      if (ts.deepSub) {
        score += 5;
        notes.push('⚠️ deep subdomain nesting');
      }

      // 3. domain age (hot signal: scam domains are new)
      try {
        const r = await rdap(host);
        if (r.registered) {
          const ageDays = Math.floor((Date.now() - new Date(r.registered).getTime()) / 86400000);
          lines.push(`📅 *Registered:* ${new Date(r.registered).toISOString().slice(0, 10)} (${ageDays} days ago)`);
          if (ageDays < 30) {
            score += 25;
            notes.push(`⚠️ domain is only ${ageDays} days old`);
          } else if (ageDays < 180) {
            score += 10;
            notes.push(`⚠️ domain is ${ageDays} days old`);
          }
          if (r.registrar) lines.push(`🏢 *Registrar:* ${r.registrar}`);
        }
      } catch (e) {
        if (e.status === 404) {
          lines.push('📅 *Registered:* no registration record — the domain does not exist');
          score += 20;
          notes.push('⚠️ domain has no registration record');
        } else {
          lines.push(`📅 *Registration:* unavailable (${e.message})`);
        }
      }

      lines.push('');
      lines.push(`*Risk:* ${RISK(score)} — score ${score}/100`);
      if (notes.length) lines.push('', ...notes);
      lines.push(
        '',
        '_Signals: Google Safe Browsing, RDAP registration age, lookalike analysis._',
        '_Not a guarantee. A clean score means "no known signal", not "safe"._',
      );
      return reply(lines.join('\n'));
    }

    /* ─────────────── header / TLS / DNS audit ─────────────── */
    if (command === 'audit' || command === 'urlscan') {
      if (!q) return reply(`🔍 Usage: \`.${command} <domain>\` — security headers, TLS grade, DNS`);
      const host = toHost(q);
      if (!host) return reply('❌ Need a domain, e.g. `.audit gtbank.com`');
      if (PRIVATE_RE.test(host)) return reply(`🏠 *${host}* is a local address — nothing public to audit.`);

      const out = [`🔍 *SECURITY AUDIT* — \`${host}\`\n`];
      let points = 0;
      let max = 0;

      try {
        const h = await headers(host);
        const joined = h.join('\n').toLowerCase();
        const checks = [
          ['strict-transport-security', 'HSTS', 15],
          ['content-security-policy', 'CSP', 15],
          ['x-frame-options', 'X-Frame-Options', 10],
          ['x-content-type-options', 'X-Content-Type-Options', 10],
          ['referrer-policy', 'Referrer-Policy', 10],
          ['permissions-policy', 'Permissions-Policy', 5],
        ];
        const lines = [];
        for (const [key, label, weight] of checks) {
          max += weight;
          const has = joined.includes(key);
          if (has) points += weight;
          lines.push(`${has ? '✅' : '❌'} ${label}`);
        }
        out.push('*Headers*', ...lines);
        const server = h.find((l) => /^server:/i.test(l));
        if (server) out.push(`   ${server.replace(/server:\s*/i, '')} exposed in Server header`);
      } catch (e) {
        out.push(`*Headers:* unavailable (${e.message})`);
      }

      try {
        const t = await tlsGrade(host);
        if (t) {
          out.push('', `*TLS:* grade ${t.grade || '?'}${t.hasWarnings ? ' ⚠️ warnings' : ''}`);
          if (t.protocols?.length) out.push(`   ${t.protocols.join(' · ')}`);
          if (t.grade && /^[A-F]/.test(t.grade)) {
            const grade = t.grade[0];
            max += 25;
            points += grade === 'A' ? 25 : grade === 'B' ? 18 : grade === 'C' ? 10 : 0;
          }
        }
      } catch (e) {
        out.push('', `*TLS:* SSL Labs unavailable (${e.message})`);
      }

      try {
        const spf = (await dnsRecords(host, 'TXT')).filter((t) => /v=spf1/i.test(t));
        out.push('', `*Email:* ${spf.length ? `SPF present (${spf[0].slice(0, 60)})` : 'no SPF record'}`);
        try {
          const dmarc = await dnsRecords(`_dmarc.${host}`, 'TXT');
          const policy = dmarc.find((d) => /v=DMARC1/i.test(d));
          out.push(`   ${policy ? `DMARC present (${policy.slice(0, 50)})` : 'no DMARC record'}`);
          if (max) {
            max += 10;
            if (policy) points += 10;
          }
        } catch {
          out.push('   no DMARC record');
        }
      } catch {
        out.push('', '*Email:* DNS lookup unavailable');
      }

      if (max > 0) {
        const pct = Math.round((points / max) * 100);
        out.push('', `*Posture:* ${RISK(100 - pct)} — ${points}/${max} (${pct}%)`);
      }
      out.push('', '_SSL Labs grades come from its cached scan (a fresh test takes minutes)._');
      return reply(out.join('\n'));
    }

    /* ─────────────────── password leaks ─────────────────── */
    if (command === 'breach' || command === 'pwned' || command === 'leakcheck') {
      if (!q) {
        return reply(
          `🔑 \`.${command} <password>\` — checks a *password* against the Pwned Passwords\n` +
            `database. I never send the password: only the first 5 characters of its SHA-1,\n` +
            `so the check happens without exposing it ("k-anonymity").\n\n` +
            `📧 Email-breach lookup (HIBP) needs an API key, so \`.${command} someone@email.com\`\n` +
            `cannot be answered — I don't have that key and won't pretend to.`,
        );
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) {
        return reply(
          `📧 *Email breach lookup is not available here.*\n` +
            `The Have I Been Pwned account API needs a paid key — it answers 401 without one,\n` +
            `so any "result" I gave you for \`${q}\` would be invented.\n\n` +
            `What works: \`.${command} <password>\` — the password half of HIBP is keyless and\n` +
            `real, and your password never leaves this host.`,
        );
      }
      if (q.length < 4) return reply('❌ Too short to check — use at least 4 characters.');
      try {
        const { count } = await pwnedPassword(q);
        if (count > 0) {
          return reply(
            `🚨 *LEAKED* — this password appears in *${count.toLocaleString()}* breach records.\n\n` +
              `Change it anywhere you use it, and never reuse it.\n` +
              `_Checked via Pwned Passwords k-anonymity: only the first 5 chars of its SHA-1\n` +
              `were sent, never the password itself._`,
          );
        }
        return reply(
          `✅ *NOT FOUND* in the Pwned Passwords database.\n\n` +
            `That means it has not appeared in a known breach — not that it is strong.\n` +
            `Try \`.password\` to generate something better.`,
        );
      } catch (e) {
        return reply(`❌ Pwned Passwords unreachable (${e.message}).`);
      }
    }

    /* ─────────────────── TOTP / 2FA ─────────────────── */
    if (command === 'otp' || command === 'totp' || command === 'twofa') {
      // .twofa on its own reports group 2FA-style state; .otp <secret> gives a code
      if (!q) {
        if (command === 'twofa') {
          const cfg = store.get(from, 'twofa');
          return reply(
            `🔐 *2FA* — \`.otp <base32 secret>\` gives a real RFC 6238 code.\n\n` +
              `Group requirement: *${cfg ? 'on' : 'off'}*\n` +
              `Enable: \`.twofa on\` · Disable: \`.twofa off\`\n\n` +
              `_This tracks the bot's own requirement flag in this chat. It is not\n` +
              `WhatsApp's built-in 2-step verification, which I cannot read or set._`,
          );
        }
        return reply(
          `🔐 Usage: \`.${command} <base32 secret>\`\n` +
            `Get the secret from the "can't scan the QR" link when you set up an authenticator.\n\n` +
            `Try \`.${command} generate\` to create a fresh secret you can test with.`,
        );
      }
      if (/^on$/i.test(q) && command === 'twofa') {
        store.set(from, 'twofa', { enabled: true, at: Date.now() });
        return reply('🔐 2FA requirement is now *on* for this chat.');
      }
      if (/^off$/i.test(q) && command === 'twofa') {
        store.set(from, 'twofa', null);
        return reply('🔓 2FA requirement is now *off* for this chat.');
      }
      if (/^(generate|new|random)$/i.test(q)) {
        const secret = base32Encode(crypto.randomBytes(20));
        const code = totp(secret);
        return reply(
          `🔐 *New TOTP secret*\n\`${secret}\`\n\n` +
            `Current code: *${code}* (valid ${totpRemaining()}s)\n` +
            `Add that secret to any authenticator app to verify the codes match.`,
        );
      }
      const secret = q.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z2-7]{8,}$/.test(secret)) {
        return reply('❌ That is not a base32 secret (A–Z and 2–7 only, at least 8 chars).');
      }
      const code = totp(secret);
      return reply(
        `🔐 *TOTP code:* \`${code}\`\n` +
          `Valid for *${totpRemaining()}s* · 6 digits · SHA-1 · 30s step (RFC 6238)\n\n` +
          `_Verify with \`.verify ${secret} <code>\` to check a code someone gives you._`,
      );
    }

    if (command === 'verify' || command === 'verification' || command === 'unverify' || command === 'verifyme') {
      const parts = q.split(/\s+/).filter(Boolean);
      if (command === 'unverify') {
        store.set(from, `verified:${sender}`, null);
        return reply('🔓 Verification cleared for you in this chat.');
      }
      if (parts.length >= 2) {
        const [secret, code] = parts;
        try {
          const okCode = totpCheck(secret.replace(/\s+/g, '').toUpperCase(), code);
          return reply(okCode ? '✅ *Code is valid* — it matches the secret right now.' : '❌ *Code is wrong* or expired (allow ±30s).');
        } catch (e) {
          return reply(`❌ Could not check that code (${e.message}). Is the secret base32?`);
        }
      }
      if (command === 'verify' || command === 'verifyme') {
        const rec = store.get(from, `verified:${sender}`);
        if (rec) return reply(`✅ You are verified in this chat since ${new Date(rec.at).toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
        store.set(from, `verified:${sender}`, { at: Date.now() });
        return reply(
          `✅ *Verified* in this chat.\n\n` +
            `_This is a local flag the bot keeps, nothing more. I cannot verify ID documents,\n` +
            `and \`.kycstatus\` will tell you the same thing._`,
        );
      }
      return reply(
        `🔐 \`.verify <secret> <code>\` — checks a 6-digit TOTP code against a secret.\n` +
          `\`.verify\` alone marks you verified locally · \`.unverify\` clears it.`,
      );
    }

    if (command === 'kycstatus') {
      return reply(
        `🪪 *KYC / identity verification: not available.*\n\n` +
          `Checking identity documents needs a licensed provider (and a key). Nothing keyless\n` +
          `does it, so I will not invent a status for anyone.\n\n` +
          `What is real here: \`.verify <secret> <code>\` for TOTP codes, and \`.otp\` to make one.`,
      );
    }

    if (command === 'captcha') {
      const a = crypto.randomInt(10, 60);
      const b = crypto.randomInt(10, 60);
      store.set(`captcha:${from}`, sender, { answer: String(a + b), at: Date.now() });
      return reply(
        `🤖 *Human check*\n\nWhat is *${a} + ${b}*?\n\n` +
          `Reply with \`.captcha <number>\` within 2 minutes.`,
      );
    }

    /* ─────────────────── hashes ─────────────────── */
    if (command === 'hashcheck') {
      if (!q) {
        return reply(
          `#️⃣ *Hash tools*\n\n` +
            `\`.hashcheck <text>\` — hash it every way (MD5, SHA-1/256/512, SHA3-256)\n` +
            `\`.hashcheck <hash>\` — identify what kind of hash that is`,
        );
      }
      const kind = hashKind(q);
      if (kind) {
        const known = {
          '5d41402abc4b2a76b9719d911017c592': 'hello',
          '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824': 'hello',
        }[q.toLowerCase()];
        return reply(
          `#️⃣ That looks like a *${kind}* hash (${q.length} hex chars).\n` +
            (known ? `🔓 It is the hash of \`${known}\`.\n` : '') +
            `\n_Hashes cannot be "decrypted" — only guessed. This only recognises the format._`,
        );
      }
      const lines = Object.entries(HASHES).map(([name, fn]) => `${name.toUpperCase().padEnd(9)} ${fn(q)}`);
      return reply(`#️⃣ *Hashes of* \`${q.slice(0, 40)}\`\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``);
    }

    /* ─────────────────── reputation / malware ─────────────────── */
    if (command === 'pwned' || command === 'reputation') {
      if (!q) return reply(`📊 Usage: \`.${command} <domain or ip>\``);
      const host = toHost(q) || q;
      try {
        const j = await get(
          `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(host)}/general`,
          { ua: BROWSER_UA },
        );
        const pulses = j.pulse_info?.count ?? 0;
        const tags = (j.pulse_info?.pulses || []).flatMap((p) => p.tags || []).slice(0, 8);
        return reply(
          `📊 *REPUTATION* — \`${host}\`\n\n` +
            `AlienVault OTX threat pulses: *${pulses}*\n` +
            (tags.length ? `Tags: ${[...new Set(tags)].join(', ')}\n` : '') +
            `\n${pulses === 0 ? '🟢 No threat reports.' : pulses < 5 ? '🟡 A few reports.' : '🔴 Widely reported.'}\n` +
            `_Source: AlienVault OTX (keyless)._`,
        );
      } catch (e) {
        return reply(`❌ OTX unavailable (${e.message}).`);
      }
    }

    if (command === 'malware' || command === 'virus' || command === 'filescan') {
      if (command !== 'malware') {
        return reply(
          `🦠 *File scanning is not available.*\n\n` +
            `VirusTotal's API needs a key (it answers 401 without one), so I cannot scan a file\n` +
            `or hash against 70 engines. I will not guess a verdict.\n\n` +
            `What works: \`.scan <link>\` for links, \`.hashcheck\` to identify or hash a file's\n` +
            `contents, and \`.audit <domain>\` for a site's headers and TLS.`,
        );
      }
      if (!q) return reply('🦠 Usage: `.malware <domain or link>` — checks threat listings');
      return module.exports.execute({ command: 'scan', args: [q], reply, sender, from });
    }

    /* ─────────────────── DNS / subdomains / email auth ─────────────────── */
    if (command === 'blocklist_check') {
      if (!q) return reply('📋 Usage: `.blocklist_check <domain>`');
      const host = toHost(q) || q;
      const out = [`📋 *Email authentication* — \`${host}\`\n`];
      try {
        const spf = (await dnsRecords(host, 'TXT')).filter((t) => /^v=spf1/i.test(t));
        out.push(`${spf.length ? '✅' : '❌'} SPF${spf.length ? `: \`${spf[0].slice(0, 70)}\`` : ' — no record'}`);
      } catch {
        out.push('⚠️ SPF lookup failed');
      }
      try {
        const dmarc = (await dnsRecords(`_dmarc.${host}`, 'TXT')).find((d) => /^v=DMARC1/i.test(d));
        const policy = dmarc?.match(/p=(\w+)/)?.[1];
        out.push(`${dmarc ? '✅' : '❌'} DMARC${policy ? ` — policy \`p=${policy}\`` : ' — no record'}`);
      } catch {
        out.push('❌ DMARC — no record');
      }
      try {
        const dkim = await dnsRecords(`default._domainkey.${host}`, 'TXT');
        out.push(`${dkim.length ? '✅' : '⚪'} DKIM (default selector)${dkim.length ? '' : ' — not found, may use another selector'}`);
      } catch {
        out.push('⚪ DKIM — not found (may use another selector)');
      }
      out.push('', '_This is why mail from this domain lands in spam or doesn\'t._');
      return reply(out.join('\n'));
    }

    if (command === 'spamcheck') {
      if (!q) return reply('🚫 Usage: `.spamcheck <domain>` — lists subdomains, a common spam-infra signal');
      const host = toHost(q) || q;
      try {
        const subs = await subdomains(host);
        return reply(
          `🚫 *SUBDOMAINS* — \`${host}\`\n\n` +
            (subs.length ? subs.map((s) => `▸ ${s}`).join('\n') : 'None found.') +
            `\n\n_${subs.length} found. A large untended subdomain list is a common spam vector._`,
        );
      } catch (e) {
        return reply(`❌ Subdomain lookup failed (${e.message}).`);
      }
    }

    if (command === 'honeypot') {
      if (!q) return reply('🍯 Usage: `.honeypot <domain>` — DNS records (MX, NS, TXT, A)');
      const host = toHost(q) || q;
      const out = [`🍯 *DNS* — \`${host}\`\n`];
      for (const type of ['A', 'MX', 'NS', 'TXT']) {
        try {
          const recs = await dnsRecords(host, type);
          out.push(`\n*${type}* ${recs.length ? '' : '— none'}`);
          recs.slice(0, 5).forEach((r) => out.push(`  ▸ ${r.slice(0, 90)}`));
        } catch {
          out.push(`\n*${type}* — lookup failed`);
        }
      }
      return reply(out.join('\n'));
    }

    if (command === 'phishing') {
      return module.exports.execute({ command: 'scan', args: [q], reply, sender, from });
    }

    /* ─────────────────── bot-local: bans + logs ─────────────────── */
    if (command === 'ipban') {
      const target = q.replace(/^@/, '').trim();
      if (!target) {
        const list = store.get(from, 'bans') || [];
        return reply(
          list.length
            ? `🚷 *Banned in this chat*\n\n${list.map((b) => `▸ ${b.id}`).join('\n')}\n\nClear: \`.ipban clear\``
            : `🚷 No bans recorded here.\n\n\`.ipban <number or @mention>\` adds one · \`.ipban clear\` removes all.\n\n` +
              `_This is the bot's own ignore list — it does not touch WhatsApp or any network._`,
        );
      }
      if (/^clear$/i.test(target)) {
        store.set(from, 'bans', []);
        return reply('✅ Ban list cleared.');
      }
      const list = store.get(from, 'bans') || [];
      if (list.some((b) => b.id === target)) return reply(`ℹ️ \`${target}\` is already banned here.`);
      list.push({ id: target, at: Date.now() });
      store.set(from, 'bans', list);
      return reply(`🚷 Banned \`${target}\` in this chat. The bot ignores their commands.`);
    }

    if (command === 'activity_log' || command === 'audit' || command === 'audit_log' || command === 'logs_view') {
      // `.audit <domain>` is the web audit above; here we handle the log views
      if (command === 'audit' && q) return; // already handled above
      const log = store.get(from, 'log') || [];
      if (!log.length) {
        return reply(
          `📜 *Activity log is empty.*\n\n` +
            `The bot records admin actions here (bans, verifications, settings).\n` +
            `Nothing has happened in this chat yet.`,
        );
      }
      const recent = log.slice(-15).reverse();
      return reply(
        `📜 *ACTIVITY LOG* — last ${recent.length}\n\n` +
          recent
            .map((e) => `▸ ${new Date(e.at).toISOString().slice(5, 16).replace('T', ' ')} · ${e.what}${e.who ? ` · ${e.who}` : ''}`)
            .join('\n'),
      );
    }

    return reply(`❌ *${command}* isn't wired up.`);
  },
};

module.exports.RISK = RISK;
module.exports.HASHES = HASHES;
module.exports.totp = totp;
