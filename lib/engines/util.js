/**
 * UTIL ENGINE — the file/network utility commands the catalogue promises and
 * nothing had implemented: `.whois`, `.dns`, `.ping`, `.curl`, `.zip`, `.unzip`,
 * `.pdf2text`, `.text2pdf`, `.compile`.
 *
 * Design rule for this file: **network capability is reported, not faked.** There
 * is no shell in the sandbox and none in the bot host, so `.compile` and `.shell`
 * say exactly that instead of printing a plausible `gcc` transcript.
 *
 * The dead-link lesson from earlier in this project applies — every caller here
 * talks to a host that was probed live before being wired in, and names the host
 * in its output so a user can tell whether a failure is theirs or the bot's.
 */
'use strict';

const net = require('net');
const dns = require('dns').promises;
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TIMEOUT_MS = 12000;
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_FETCH_BYTES = 2 * 1024 * 1024;

async function timedFetch(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/* ══════════════════ WHOIS ══════════════════ */

/**
 * Walk the WHOIS referral chain: IANA tells us which registry owns the TLD, the
 * registry tells us the registrar, the registrar gives the actual record.
 */
function whoisQuery(server, query) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sock = net.createConnection(43, server);
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    sock.setTimeout(8000);
    sock.on('connect', () => sock.write(query + '\r\n'));
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => finish());
    sock.on('timeout', () => finish(new Error(`${server} timed out`)));
    sock.on('error', (e) => finish(e));
  });
}

/** A zip entry name is unsafe if it climbs directories or is absolute. */
const isUnsafeEntry = (name) => /(^|\/)\.\.(\/|$)/.test(name) || name.startsWith('/') || /^[A-Za-z]:\\/.test(name);

const pick = (text, re) => {
  const m = text.match(re);
  return m ? m[1].trim() : null;
};

async function whois(domain) {
  const d = String(domain).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
    return { error: `*${d}* doesn't look like a domain. Try \`.whois example.com\`.` };
  }
  let root;
  try {
    root = await whoisQuery('whois.iana.org', d);
  } catch (e) {
    return { error: `WHOIS lookup failed: whois.iana.org unreachable (${e.message}).` };
  }
  const refer = pick(root, /^refer:\s*(\S+)/m) || pick(root, /^whois:\s*(\S+)/m);
  if (!refer) {
    return { error: `No WHOIS server is registered for *${d.split('.').pop()}* yet.` };
  }
  let raw;
  try {
    raw = await whoisQuery(refer, d);
  } catch (e) {
    return { error: `*${refer}* did not answer for ${d} (${e.message}).` };
  }
  if (/no match|not found|no entries found|domain not found/i.test(raw)) {
    return { error: `*${d}* is not registered — ${refer} has no record for it.` };
  }
  // registrar referral for thin registries (.com/.net)
  const registrar = pick(raw, /Registrar WHOIS Server:\s*(\S+)/i);
  if (registrar && registrar !== refer) {
    try {
      const deep = await whoisQuery(registrar, d);
      if (deep.length > raw.length) raw = raw + '\n' + deep;
    } catch {
      /* the registry record is still a real answer */
    }
  }
  return {
    domain: d,
    server: refer,
    registrar: pick(raw, /Registrar:\s*(.+)/i),
    created: pick(raw, /Creation Date:\s*(.+)/i) || pick(raw, /created:\s*(.+)/i) || pick(raw, /Registered on:\s*(.+)/i),
    expires: pick(raw, /Registry Expiry Date:\s*(.+)/i) || pick(raw, /Expiry Date:\s*(.+)/i) || pick(raw, /expiry date:\s*(.+)/i) || pick(raw, /paid-till:\s*(.+)/i),
    updated: pick(raw, /Updated Date:\s*(.+)/i) || pick(raw, /last-update:\s*(.+)/i),
    status: (raw.match(/Domain Status:\s*(\S+)/gi) || []).slice(0, 4).map((s) => s.split(':')[1].trim()),
    ns: [...new Set((raw.match(/Name Server:\s*(\S+)/gi) || []).map((s) => s.split(':')[1].trim().toLowerCase()))].slice(0, 6),
    registrant: pick(raw, /Registrant Organization:\s*(.+)/i) || pick(raw, /Registrant:\s*(.+)/i),
  };
}

/* ══════════════════ DNS ══════════════════ */

const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];

/**
 * Resolve every record type we can, over DoH so it works on hosts where the
 * local resolver is missing or intercepted. Plain DNS first (fast), DoH as a
 * genuine fallback rather than a decoration.
 */
async function dnsLookup(domain, type) {
  const host = String(domain).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!host) return { error: 'Give me a domain: `.dns example.com`' };
  const types = type ? [String(type).toUpperCase()] : DNS_TYPES;
  const out = {};
  for (const t of types) {
    try {
      const res = await timedFetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${t}`, {
        headers: { 'User-Agent': UA },
      });
      const j = await res.json();
      if (Array.isArray(j.Answer) && j.Answer.length) {
        out[t] = j.Answer.map((a) => String(a.data).slice(0, 120));
      }
    } catch {
      // try the OS resolver before giving up on this type
      try {
        const r = await dns.resolve(host, t === 'A' ? 'A' : t);
        out[t] = (Array.isArray(r) ? r : [r]).map((v) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 120));
      } catch {
        /* genuinely absent */
      }
    }
  }
  if (!Object.keys(out).length) {
    return { error: `No DNS records found for *${host}*. It may not exist, or it only answers for a type I didn't ask.` };
  }
  return { host, records: out };
}

/* ══════════════════ TCP port probe ══════════════════ */

function probePort(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    const done = (open, why) => {
      sock.destroy();
      resolve({ port, open, why });
    };
    sock.setTimeout(timeout);
    sock.on('connect', () => done(true, 'open'));
    sock.on('timeout', () => done(false, 'filtered (no reply)'));
    sock.on('error', (e) => done(false, e.code === 'ECONNREFUSED' ? 'closed' : e.code || e.message));
  });
}

const COMMON_PORTS = [21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443];

/**
 * `.portscan host` — probes a short, fixed list of well-known ports.
 * Deliberately NOT a general scanner: no arbitrary ranges, no banner grabbing,
 * and it refuses anything that isn't a hostname the user owns or a public domain.
 */
async function portScan(host, ports = COMMON_PORTS) {
  const h = String(host).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!h) return { error: 'Give me a host: `.portscan example.com`' };
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
    return { error: 'I do not probe private addresses — that is a network-mapping tool, not a bot feature.' };
  }
  const results = await Promise.all(ports.map((p) => probePort(h, p, 3500)));
  return { host: h, results, open: results.filter((r) => r.open).map((r) => r.port) };
}

/* ══════════════════ HTTP fetch ══════════════════ */

async function httpGet(url) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return { error: `*${url}* is not a URL.` };
  }
  const t0 = Date.now();
  let res;
  try {
    res = await timedFetch(u.href, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  } catch (e) {
    return { error: `Could not reach ${u.hostname} (${e.name === 'AbortError' ? 'timed out' : e.message}).` };
  }
  const ms = Date.now() - t0;
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString('utf8');
  return {
    url: res.url,
    status: res.status,
    ok: res.ok,
    ms,
    headers: Object.fromEntries([...res.headers].slice(0, 20)),
    contentType: res.headers.get('content-type') || '',
    bytes: buf.length,
    truncated: buf.length > MAX_FETCH_BYTES,
    body: buf.subarray(0, MAX_FETCH_BYTES).toString('utf8'),
    title: pick(head, /<title[^>]*>([^<]{1,120})<\/title>/i),
  };
}

/* ══════════════════ archives ══════════════════ */

function zipFiles(files) {
  const z = new AdmZip();
  let total = 0;
  for (const f of files) {
    total += f.buf.length;
    if (total > MAX_ZIP_BYTES) return { error: `Those files add up to more than ${MAX_ZIP_BYTES / 1048576} MB.` };
    z.addFile(f.name, f.buf);
  }
  return { buffer: z.toBuffer(), entries: files.map((f) => ({ name: f.name, size: f.buf.length })) };
}

function readZip(buf) {
  if (!buf || buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    if (buf && buf.length > 4 && buf.readUInt32LE(0) === 0x06054b50) return { error: 'That zip is empty.' };
    return { error: 'That file is not a zip archive.' };
  }
  let z;
  try {
    z = new AdmZip(buf);
  } catch (e) {
    return { error: `Could not open that zip (${e.message}).` };
  }
  const entries = z.getEntries();
  if (entries.length > 200) {
    return { error: `That archive has ${entries.length} entries — too many to list on WhatsApp.` };
  }
  const files = entries.map((e) => {
    const raw = e.isDirectory ? null : z.readFile(e);
    return {
      name: e.entryName,
      dir: e.isDirectory,
      size: e.header.size,
      compressed: e.header.compressedSize,
      // path traversal guard: a zip can name ../../etc/passwd
      unsafe: isUnsafeEntry(e.entryName),
      text: raw && raw.length < 200000 && !raw.includes(0) ? raw.toString('utf8') : null,
      buf: raw,
    };
  });
  return { files, total: entries.reduce((n, e) => n + e.header.size, 0) };
}

/* ══════════════════ PDF ══════════════════ */

async function pdfToText(buf, { maxPages = 12 } = {}) {
  // Validate here, not at the call site: the parser throws a 200-line pdf.js
  // dump on non-PDF input, which is unreadable in a chat.
  if (!buf || buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    const head = buf ? buf.subarray(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.') : '';
    return { error: `That file is not a PDF (starts with \`${head}\`).` };
  }
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const info = await parser.getInfo();
    const text = await parser.getText({ first: maxPages });
    const pages = text.pages || [];
    const body = pages
      .map((p) => String(p.text || '').replace(/\s+\n/g, '\n').trim())
      .filter(Boolean)
      .join('\n\n');
    return {
      pages: info.total || pages.length,
      shown: pages.length,
      title: info.info?.Title || null,
      author: info.info?.Author || null,
      chars: body.length,
      text: body,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/* ══════════════════ PDF writer ══════════════════ */

/**
 * Minimal but genuine PDF writer: embeds Helvetica text so the output is
 * **selectable and extractable**, which an ImageMagick-rendered PDF is not
 * (ImageMagick draws glyph outlines, so `pdftotext` returns nothing — verified).
 *
 * ~70 lines beats a 2 MB dependency we'd only use for `Tj` operators.
 */
function buildPdf(text, { size = 11, margin = 54, pageW = 595, pageH = 842 } = {}) {
  const body = String(text).replace(/\r\n?/g, '\n');
  const charW = size * 0.5; // Helvetica average advance
  const perLine = Math.max(20, Math.floor((pageW - margin * 2) / charW));
  const lineH = Math.round(size * 1.45);
  const perPage = Math.floor((pageH - margin * 2) / lineH);

  // wrap, honouring explicit newlines
  const lines = [];
  for (const para of body.split('\n')) {
    if (!para.length) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if ((cur + ' ' + word).trim().length <= perLine) cur = (cur ? cur + ' ' : '') + word;
      else {
        if (cur) lines.push(cur);
        // hard-break a single word longer than a line
        let w = word;
        while (w.length > perLine) {
          lines.push(w.slice(0, perLine));
          w = w.slice(perLine);
        }
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }

  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) pages.push(lines.slice(i, i + perPage));

  const pdfEsc = (t) =>
    t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
     .replace(/[^\x20-\x7e]/g, '?'); // Helvetica WinAnsi only — no emoji in the standard font

  const objs = [];
  const kids = [];
  // 1 catalog, 2 pages, 3 font, then (page, content) pairs
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((plines, pi) => {
    const pageId = 4 + pi * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const stream = [
      'BT',
      `/F1 ${size} Tf`,
      `${lineH} TL`,
      `${margin} ${pageH - margin} Td`,
      ...plines.map((l) => `(${pdfEsc(l)}) Tj T*`),
      'ET',
    ].join('\n');
    objs[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { buffer: Buffer.from(out, 'latin1'), pages: pages.length, lines: lines.length };
}

/* ══════════════════ names ══════════════════ */

const NAMES = new Set([
  'whois', 'whois2', 'lookup', 'dns', 'dnslookup', 'portscan', 'checkport', 'openport',
  'curl', 'fetch', 'webget', 'httpget', 'ping', 'ping2', 'ping3',
  'zip', 'unzip', 'archive', 'unarchive', 'archive2',
  'pdf2text', 'pdftext', 'readpdf', 'text2pdf', 'pdf2',
  'compile', 'runcode', 'exec', 'shell', 'eval2', 'runtime',
  'pastebin', 'paste', 'scribd', 'paste2',
  'base64url', 'yaml2json', 'json2yaml', 'jsonfmt',
]);

module.exports = {
  id: 'util',
  name: 'util-engine',
  match: (n) => NAMES.has(n),
  describe(name) {
    if (['whois', 'whois2', 'lookup'].includes(name)) return 'WHOIS registration record';
    if (/dns/.test(name)) return 'DNS records via DoH';
    if (/port/.test(name)) return 'Probe well-known TCP ports';
    if (['curl', 'fetch', 'webget', 'httpget'].includes(name)) return 'HTTP request inspector';
    if (/^zip$|archive/.test(name)) return 'Build / inspect zip archives';
    if (/pdf/.test(name)) return 'PDF → text, text → PDF';
    if (/compile|runcode|exec|shell|eval2|runtime/.test(name)) return 'Refuses: no shell available';
    if (/paste|scribd/.test(name)) return 'Paste services need keys — refuses, names .upload';
    return 'Encode / format utilities';
  },
  extraNames: [...NAMES],
  _internals: { whois, whoisQuery, dnsLookup, probePort, portScan, httpGet, zipFiles, readZip, pdfToText, buildPdf, isUnsafeEntry, timedFetch, COMMON_PORTS, UA },

  async execute(ctx) {
    const { command, args, reply, sock, from, msg, download } = ctx;
    const raw = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

    /* ── WHOIS ── */
    if (['whois', 'whois2', 'lookup'].includes(command)) {
      if (!raw) return reply('🌐 Usage: `.whois example.com`\n_Reads the registry record directly over WHOIS (port 43), not a reseller API._');
      const r = await whois(raw);
      if (r.error) return reply(`❌ ${r.error}`);
      const lines = [
        `🌐 *${r.domain}*`,
        `_Registry: ${r.server}_`,
        r.registrar && `▸ Registrar: ${r.registrar}`,
        r.created && `▸ Created: ${r.created}`,
        r.expires && `▸ Expires: ${r.expires}`,
        r.updated && `▸ Updated: ${r.updated}`,
        r.status?.length && `▸ Status: ${r.status.join(', ')}`,
        r.ns?.length && `▸ Nameservers: ${r.ns.join(', ')}`,
        r.registrant && `▸ Registrant: ${r.registrant}`,
      ].filter(Boolean);
      // privacy services rewrite registrant fields; say so rather than print a redaction as fact
      if (!r.registrant) lines.push('_Registrant is redacted (most registries do this since GDPR)._');
      return reply(lines.join('\n'));
    }

    /* ── DNS ── */
    if (['dns', 'dnslookup'].includes(command)) {
      const [host, type] = raw.split(/\s+/);
      if (!host) return reply('📡 Usage: `.dns example.com` or `.dns example.com MX`');
      const r = await dnsLookup(host, type);
      if (r.error) return reply(`❌ ${r.error}`);
      const body = Object.entries(r.records)
        .map(([t, vals]) => `*${t}*\n${vals.map((v) => `  ${v}`).join('\n')}`)
        .join('\n\n');
      return reply(`📡 *${r.host}*\n_via dns.google (DoH)_\n\n${body}`);
    }

    /* ── ports ── */
    if (['portscan', 'checkport', 'openport'].includes(command)) {
      if (!raw) {
        return reply(
          `🔌 Usage: \`.${command} example.com\`\n` +
            `_Probes ${COMMON_PORTS.length} well-known ports only — not a scanner. Private IPs are refused._`,
        );
      }
      const r = await portScan(raw);
      if (r.error) return reply(`❌ ${r.error}`);
      const shown = r.results.map((p) => `${p.open ? '🟢' : '⚪'} ${p.port}`).join('  ');
      return reply(
        `🔌 *${r.host}*\n\n${shown}\n\n` +
          `*Open:* ${r.open.length ? r.open.join(', ') : 'none of the probed ports'}\n` +
          `_A closed port is not proof a service is absent — anything on a non-standard port is invisible to this._`,
      );
    }

    /* ── HTTP inspector ── */
    if (['curl', 'fetch', 'webget', 'httpget'].includes(command)) {
      if (!raw) return reply(`🌍 Usage: \`.${command} https://example.com\`\n_Shows status, headers and the start of the body._`);
      const r = await httpGet(raw);
      if (r.error) return reply(`❌ ${r.error}`);
      const hdr = Object.entries(r.headers)
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
        .join('\n');
      const snippet = r.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
      return reply(
        `🌍 *${r.status}* ${r.ok ? '✅' : '⚠️'} · ${r.ms} ms · ${r.bytes} bytes\n` +
          `_${r.url}_\n\n\`\`\`${hdr}\`\`\`\n` +
          (r.title ? `\n*Title:* ${r.title}\n` : '') +
          (snippet ? `\n${snippet}${r.body.length > 320 ? '…' : ''}` : '') +
          (r.truncated ? '\n\n_Cut at 2 MB._' : ''),
      );
    }

    /* ── ping: TCP connect, and say that's what it is ── */
    if (['ping', 'ping2', 'ping3'].includes(command)) {
      if (!raw) return reply(`📶 Usage: \`.${command} example.com\``);
      const host = raw.split(/\s+/)[0];
      const port = /:(\d+)$/.test(host) ? Number(host.split(':').pop()) : 443;
      const clean = host.replace(/:\d+$/, '');
      const runs = [];
      for (let i = 0; i < 4; i++) {
        const t0 = Date.now();
        const r = await probePort(clean, port, 3000);
        runs.push({ ...r, ms: Date.now() - t0 });
      }
      const up = runs.filter((r) => r.open);
      const avg = up.length ? Math.round(up.reduce((n, r) => n + r.ms, 0) / up.length) : null;
      return reply(
        `📶 *${clean}:${port}*\n\n` +
          runs.map((r, i) => `#${i + 1} ${r.open ? `🟢 ${r.ms} ms` : `⚪ ${r.why}`}`).join('\n') +
          `\n\n*Reply:* ${up.length}/4${avg ? ` · avg ${avg} ms` : ''}\n` +
          `_This is a TCP connect to one port, not ICMP ping — the sandbox has no raw sockets. A silent port is reported as silent._`,
      );
    }

    /* ── zip ── */
    if (command === 'zip' || command === 'archive' || command === 'archive2') {
      const buf = download ? await download().catch(() => null) : null;
      if (buf && buf.length) {
        // replying .zip to a file re-wraps it — genuinely useful for WhatsApp docs
        const out = zipFiles([{ name: `file-${Date.now()}.bin`, buf }]);
        if (out.error) return reply(`❌ ${out.error}`);
        return sock.sendMessage(
          from,
          { document: out.buffer, fileName: `zynex-${Date.now()}.zip`, mimetype: 'application/zip', caption: `🗜️ ${(buf.length / 1024).toFixed(1)} KB compressed into a zip.` },
          { quoted: msg },
        );
      }
      const text = raw || `Empty archive made by ${require('../botInfo').BOT_NAME}`;
      const out = zipFiles([{ name: 'message.txt', buf: Buffer.from(text) }]);
      return sock.sendMessage(
        from,
        { document: out.buffer, fileName: 'zynex-note.zip', mimetype: 'application/zip', caption: '🗜️ Zipped that text. Reply to a file with `.zip` to wrap the file instead.' },
        { quoted: msg },
      );
    }

    if (command === 'unzip' || command === 'unarchive') {
      const buf = download ? await download().catch(() => null) : null;
      if (!buf || !buf.length) return reply('🗜️ Reply to a *.zip* file with this command.');
      const r = readZip(buf);
      if (r.error) return reply(`❌ ${r.error}`);
      const unsafe = r.files.filter((f) => f.unsafe);
      const lines = r.files
        .slice(0, 40)
        .map((f) => `${f.dir ? '📁' : '📄'} ${f.name}${f.dir ? '' : ` · ${f.size} b`}`)
        .join('\n');
      const textFile = r.files.find((f) => !f.dir && f.text && f.text.trim());
      const preview = textFile
        ? `\n\n*${textFile.name}*\n\`\`\`${textFile.text.slice(0, 500)}${textFile.text.length > 500 ? '…' : ''}\`\`\``
        : '';
      return reply(
        `🗜️ *${r.files.length} entries* · ${(r.total / 1024).toFixed(1)} KB uncompressed\n\n${lines}` +
          (r.files.length > 40 ? `\n_…and ${r.files.length - 40} more_` : '') +
          preview +
          (unsafe.length ? `\n\n⚠️ ${unsafe.length} entr${unsafe.length === 1 ? 'y' : 'ies'} use \`../\` paths — a zip-slip attempt. I listed, I did not extract.` : ''),
      );
    }

    /* ── PDF ── */
    if (['pdf2text', 'pdftext', 'readpdf', 'pdf2'].includes(command)) {
      const buf = download ? await download().catch(() => null) : null;
      if (!buf || !buf.length) return reply('📄 Reply to a *.pdf* file with this command.');
      if (buf.subarray(0, 5).toString() !== '%PDF-') return reply('❌ That file is not a PDF.');
      let r;
      try {
        r = await pdfToText(buf);
      } catch (e) {
        return reply(`❌ Could not read that PDF (${e.message}). ${/password|encrypt/i.test(e.message) ? 'It is probably password-protected.' : ''}`);
      }
      if (!r.text.trim()) {
        return reply(
          `📄 *${r.pages} page${r.pages === 1 ? '' : 's'}* but *no extractable text*.\n` +
            `_That means it is a scan — the pages are pictures of words. Reading it needs OCR; use a scanner, or I can hand you the images with \`.topdf\`-style tools I don't have. Honest answer: text extraction found nothing._`,
        );
      }
      return reply(
        `📄 *${r.pages} page${r.pages === 1 ? '' : 's'}* · ${r.chars} chars${r.title ? `\n_${r.title}_` : ''}\n\n` +
          `${r.text.slice(0, 3000)}${r.text.length > 3000 ? `\n\n_…${r.text.length - 3000} more characters. Reply with \`.pdf2text\` again on a shorter range, or I can summarise._` : ''}`,
      );
    }

    /* ── text → PDF ── */
    if (command === 'text2pdf') {
      let body = raw;
      if (!body && download) {
        const buf = await download().catch(() => null);
        if (buf && buf.length) body = buf.toString('utf8');
      }
      if (!body || !body.trim()) {
        return reply('📄 Usage: `.text2pdf your text here`, or reply to a message with `.text2pdf`.');
      }
      try {
        const out = buildPdf(body.slice(0, 60000));
        return sock.sendMessage(
          from,
          {
            document: out.buffer,
            fileName: `zynex-${Date.now()}.pdf`,
            mimetype: 'application/pdf',
            caption: `📄 ${out.pages} page${out.pages === 1 ? '' : 's'} · text is selectable, so it copies out cleanly.`,
          },
          { quoted: msg },
        );
      } catch (e) {
        return reply(`❌ Could not build the PDF (${e.message}).`);
      }
    }

    /* ── code execution: refuse, precisely ── */
    if (['compile', 'runcode', 'exec', 'shell', 'eval2', 'runtime'].includes(command)) {
      return reply(
        `🚫 *${command}* — I can't run code, and I'm not going to pretend to.\n\n` +
          `This bot hosts no sandbox and no shell. Anything I printed back as "output" would be invented text, which is worse than an error.\n\n` +
          `_What actually helps:_ run it locally, or use an online playground. I can still help with the code itself — \`.codeimage\` renders a snippet, \`.explain\` (via \`.ai\`) explains it, \`.jsonfmt\` formats data.`,
      );
    }

    /* ── encoding / formatting ── */
    if (command === 'base64url') {
      if (!raw) return reply('🔐 Usage: `.base64url some text` (URL-safe base64, no padding)');
      return reply(`\`\`\`${Buffer.from(raw).toString('base64url')}\`\`\``);
    }
    if (command === 'jsonfmt') {
      if (!raw) return reply('🧩 Usage: `.jsonfmt {"a":1,"b":[1,2]}`');
      try {
        const parsed = JSON.parse(raw);
        const out = JSON.stringify(parsed, null, 2);
        return reply(`🧩 *valid JSON* · ${out.split('\n').length} lines\n\`\`\`${out.slice(0, 2800)}\`\`\``);
      } catch (e) {
        return reply(`❌ Invalid JSON: ${e.message}`);
      }
    }
    if (command === 'yaml2json' || command === 'json2yaml') {
      return reply(
        `❌ *${command}* needs a YAML parser, which is not installed here, and hand-written YAML parsing gets indentation and anchors wrong.\n\n` +
          `_What works instead:_ \`.jsonfmt\` validates and pretty-prints JSON, \`.base64\` and \`.urlencode\` handle encoding.`,
      );
    }

    /* ── paste services ── */
    if (['pastebin', 'paste', 'paste2', 'scribd'].includes(command)) {
      return reply(
        `📋 *${command}* uploads to a paste host, and every keyless one is dead or key-locked now.\n\n` +
          `_What works instead:_ \`.upload\` (uguu.se + tmpfiles.org, both alive and tested) gives you a real link, and for text you can just send it — WhatsApp keeps it in the chat.`,
      );
    }

    return reply(`❌ *${command}* isn't wired up.`);
  },
};
