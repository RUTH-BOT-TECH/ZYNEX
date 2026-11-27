/**
 * TOOLS ENGINE — calculators, converters, encoding, network lookups, QR, TTS.
 * Collapses ~120 catalogue names. All keyless.
 */
const axios = require('axios');
const crypto = require('crypto');
const web = require('../webSearch');

const UA = `Mozilla/5.0 (compatible; ${require('../botInfo').BOT_NAME}/1.0)`;

const CALC = new Set(['calc', 'calculator', 'math', 'solve', 'equation', 'percentage', 'percent', 'discount', 'tip', 'split', 'bmi', 'bmr', 'tdee', 'calorie', 'age', 'agecalc']);
const ENCODE = new Set(['base64', 'debase64', 'encode', 'decode', 'binary', 'debinary', 'hex', 'dehex', 'urlencode', 'urldecode', 'jsonformat', 'jsonminify', 'beautify', 'minify', 'lorem', 'md5', 'sha1', 'sha256', 'hash', 'uuid']);
const NET = new Set(['ip', 'ipinfo', 'iplookup', 'nslookup', 'dig', 'headers', 'httpstatus', 'sslinfo', 'domain', 'domaincheck', 'subdomain', 'url', 'urlinfo', 'unshorten', 'isup', 'down', 'speedtest', 'geoip', 'location', 'sysinfo', 'neofetch', 'hostinfo', 'ping_host', 'latency', 'cpu', 'ram', 'memory', 'disk', 'storage', 'battery', 'useragent', 'browser', 'device', 'os']);
const TEXTUTIL = new Set(['wordcount', 'charcount', 'count', 'length', 'lines', 'reverse_words', 'sort', 'uniq', 'repeat', 'spell', 'parrot', 'mimic', 'spoiler', 'readmore', 'monospace', 'alwaysonline', 'password', 'passgen', 'genpass', 'randomnumber', 'strongpass', 'passcheck']);
const QR = new Set(['qr', 'qrcode', 'readqr', 'barcode']);
const TTS = new Set(['tts', 'say2', 'voice', 'voicemale', 'voicefemale', 'audio_tts', 'tts_en', 'tts_fr', 'tts_es', 'tts_ar', 'tts_hi', 'tts_sw', 'tts_pt', 'tts_ru', 'tts_ja', 'tts_zh']);
// remind* is owned by engines/personal.js (real persisted reminders).
const TIME = new Set(['time', 'date', 'today', 'tomorrow', 'yesterday', 'calendar', 'clock', 'timezone', 'timer', 'stopwatch', 'countdown']);
const SEARCH = new Set(['gsearch', 'duckduckgo', 'ddg', 'urban']);
const SEARCH_DESCRIPTIONS = {
  gsearch: 'Generic web search',
  duckduckgo: 'DuckDuckGo instant answer',
  ddg: 'DuckDuckGo instant answer',
  urban: 'Urban Dictionary definition',
};
const CURRENCY = new Set([]); // crypto/currency/country now live in engines/info.js
const TRANSLATE = new Set(['translate', 'tr', 'detectlang', 'langdetect']);

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

/* ── safe arithmetic: tokens only, no eval of arbitrary code ── */
function safeMath(expr) {
  const clean = expr.replace(/\s+/g, '');
  if (!/^[\d+\-*/().%^]+$/.test(clean)) throw new Error('Only numbers and + - * / ( ) % ^ allowed');
  // ^ → ** for exponent, then a hand-rolled shunting-yard would be overkill;
  // this is bounded to arithmetic chars so Function is safe here.
  const js = clean.replace(/\^/g, '**');
  const v = Function(`"use strict";return (${js})`)();
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Not a finite number');
  return v;
}

module.exports = {
  id: 'tools',
  name: 'tools-engine',

  match(name) {
    // dictionary / country / currency clusters deliberately excluded —
    // they belong to engines/info.js (one owner per name)
    return CALC.has(name) || ENCODE.has(name) || NET.has(name) || TEXTUTIL.has(name) ||
      QR.has(name) || TTS.has(name) || TIME.has(name) || SEARCH.has(name) ||
      TRANSLATE.has(name);
  },

  describe(name) {
    if (CALC.has(name)) return 'Calculator';
    if (ENCODE.has(name)) return 'Encode / decode / hash';
    if (NET.has(name)) return 'Network lookup';
    if (QR.has(name)) return 'QR code';
    if (TTS.has(name)) return 'Text to speech';
    if (TIME.has(name)) return 'Time and date';
    if (SEARCH.has(name)) return SEARCH_DESCRIPTIONS[name] || 'Web search';
    if (CURRENCY.has(name)) return 'Prices and conversion';
    if (TRANSLATE.has(name)) return 'Translate text';
    return 'Text utility';
  },

  async execute({ command, args, argString, reply, sock, from, msg }) {
    const text = (argString || args.join(' ')).trim();

    /* ── calculator ─────────────────────────────────────── */
    if (CALC.has(command)) {
      if (!text) return reply(`Usage: \`.${command} 12*8+4\``);

      if (command === 'bmi') {
        const [w, h] = args.map(Number);
        if (!w || !h) return reply('Usage: `.bmi <kg> <metres>` — e.g. `.bmi 70 1.75`');
        const bmi = w / (h * h);
        const cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
        return reply(`⚖️ *BMI*\n\n${bmi.toFixed(1)} — ${cat}`);
      }
      if (command === 'age' || command === 'agecalc') {
        const d = new Date(text);
        if (isNaN(d)) return reply('Usage: `.age 1998-05-14`');
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
        return reply(`🎂 You are *${age}* years old.`);
      }
      if (['percentage', 'percent', 'discount', 'tip', 'split'].includes(command)) {
        const nums = args.map(Number).filter((n) => !isNaN(n));
        if (nums.length < 2) return reply(`Usage: \`.${command} <amount> <percent>\``);
        const [amount, pct] = nums;
        const val = (amount * pct) / 100;
        return reply(`🧮 ${pct}% of ${amount} = *${val.toFixed(2)}*`);
      }

      try {
        const out = safeMath(text);
        return reply(`🧮 \`${text}\` = *${out}*`);
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── encoding / hashing ─────────────────────────────── */
    if (ENCODE.has(command)) {
      if (!text && command !== 'lorem' && command !== 'uuid') return reply(`Usage: \`.${command} <text>\``);
      switch (command) {
        case 'base64': return reply(`\`${Buffer.from(text).toString('base64')}\``);
        case 'debase64': return reply(`\`${Buffer.from(text, 'base64').toString('utf8')}\``);
        case 'encode': return reply(`\`${Buffer.from(text).toString('base64')}\``);
        case 'decode': return reply(`\`${Buffer.from(text, 'base64').toString('utf8')}\``);
        case 'binary': return reply(`\`${[...text].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ')}\``);
        case 'debinary': return reply(`\`${text.split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 2))).join('')}\``);
        case 'hex': return reply(`\`${Buffer.from(text).toString('hex')}\``);
        case 'dehex': return reply(`\`${Buffer.from(text, 'hex').toString('utf8')}\``);
        case 'urlencode': return reply(`\`${encodeURIComponent(text)}\``);
        case 'urldecode': return reply(`\`${decodeURIComponent(text)}\``);
        case 'md5': return reply(`\`${crypto.createHash('md5').update(text).digest('hex')}\``);
        case 'sha1': return reply(`\`${crypto.createHash('sha1').update(text).digest('hex')}\``);
        case 'sha256': return reply(`\`${crypto.createHash('sha256').update(text).digest('hex')}\``);
        case 'hash': return reply(`SHA-256:\n\`${crypto.createHash('sha256').update(text).digest('hex')}\``);
        case 'jsonformat': case 'beautify': {
          try { return reply(`\`\`\`${JSON.stringify(JSON.parse(text), null, 2).slice(0, 3000)}\`\`\``); }
          catch { return reply('❌ Not valid JSON.'); }
        }
        case 'jsonminify': case 'minify': {
          try { return reply(`\`${JSON.stringify(JSON.parse(text))}\``); }
          catch { return reply('❌ Not valid JSON.'); }
        }
        case 'lorem': return reply(LOREM);
        case 'uuid': return reply(`\`${crypto.randomUUID()}\``);
        default: return reply('🔐 Use `.hash <text>` for SHA-256.');
      }
    }

    /* ── text utilities ─────────────────────────────────── */
    if (TEXTUTIL.has(command)) {
      switch (command) {
        case 'echo': case 'say': case 'repeat': case 'parrot': case 'mimic':
          return reply(text ? (args[0] && /^\d+$/.test(args[0]) ? text.split(' ').slice(1).join(' ').repeat(Math.min(parseInt(args[0], 10), 10)) : text) : reply(`Usage: \`.${command} <text>\``));
        case 'wordcount': return reply(`📝 *Words:* ${text.split(/\s+/).filter(Boolean).length}`);
        case 'charcount': case 'count': case 'length': return reply(`🔤 *Characters:* ${text.length}`);
        case 'lines': return reply(`📄 *Lines:* ${text.split('\n').length}`);
        case 'reverse_words': return reply(text.split(/\s+/).reverse().join(' '));
        case 'sort': return reply(text.split(/\s+/).sort().join(' '));
        case 'uniq': return reply([...new Set(text.split(/\s+/))].join(' '));
        case 'password': case 'passgen': case 'genpass': case 'strongpass': {
          const len = Math.min(parseInt(args[0], 10) || 16, 64);
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
          let p = '';
          for (let i = 0; i < len; i++) p += chars[crypto.randomInt(chars.length)];
          return reply(`🔑 \`${p}\``);
        }
        case 'spoiler': return reply(`||${text}||`);
        case 'readmore': return reply(`${text}\n\u200e\u200e\u200e`);
        case 'monospace': return reply('```' + text + '```');
        case 'randomnumber': {
          const [a, b] = [parseInt(args[0], 10) || 1, parseInt(args[1], 10) || 100];
          return reply(`🎲 ${crypto.randomInt(Math.min(a, b), Math.max(a, b) + 1)}`);
        }
        default: return reply('🔧 Use `.help` to see text utilities.');
      }
    }

    /* ── QR ─────────────────────────────────────────────── */
    if (QR.has(command)) {
      if (!text) return reply(`Usage: \`.${command} <text or url>\``);
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`;
      return sock.sendMessage(from, { image: { url }, caption: `🔳 QR · ${text}` }, { quoted: msg });
    }

    /* ── TTS ────────────────────────────────────────────── */
    if (TTS.has(command)) {
      if (!text) return reply(`Usage: \`.tts hello world\``);
      const langMap = { tts_en: 'en', tts_fr: 'fr', tts_es: 'es', tts_ar: 'ar', tts_hi: 'hi', tts_sw: 'sw', tts_pt: 'pt', tts_ru: 'ru', tts_ja: 'ja', tts_zh: 'zh' };
      const lang = langMap[command] || 'en';
      const voice = command === 'voicefemale' ? 'Joanna' : 'Brian';
      const url = `https://api.streamelements.com/kappa/v2/speech?voice=${voice}&text=${encodeURIComponent(text)}`;
      try {
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': UA } });
        return sock.sendMessage(from, { audio: Buffer.from(r.data), mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
      } catch (e) {
        return reply(`❌ TTS failed: ${e.message}`);
      }
    }

    /* ── time / date ────────────────────────────────────── */
    if (TIME.has(command)) {
      const tz = args[0] && /^[A-Za-z/_]+$/.test(args[0]) ? args[0] : 'Africa/Lagos';
      let now;
      try {
        now = new Date().toLocaleString('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' });
      } catch {
        now = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'full', timeStyle: 'short' });
      }
      if (['timer', 'stopwatch', 'countdown'].includes(command)) {
        const mins = parseFloat(args[0]) || 1;
        if (mins > 60) return reply('❌ Max 60 minutes.');
        await reply(`⏰ Setting a ${mins}-minute reminder…`);
        setTimeout(() => {
          sock.sendMessage(from, { text: `⏰ *Reminder:* ${args.slice(1).join(' ') || 'time is up'}`, linkPreview: false }).catch(() => {});
        }, mins * 60e3);
        return;
      }
      return reply(`🕐 *${tz}*\n\n${now}`);
    }

    /* ── provider-honest search ─────────────────────────── */
    if (SEARCH.has(command)) {
      if (!text) return reply(`Usage: \`.${command} <query>\``);

      if (command === 'urban') {
        try {
          const r = await axios.get('https://api.urbandictionary.com/v0/define', { params: { term: text }, timeout: 10000 });
          const d = r.data?.list?.[0];
          if (d) return reply(`📖 *${d.word}*\n\n${d.definition.slice(0, 900)}\n\n_${(d.example || '').slice(0, 300)}_`);
        } catch { /* fallthrough */ }
        return reply(`❌ No Urban Dictionary definition for *${text}*.`);
      }

      if (['duckduckgo', 'ddg'].includes(command)) {
        try {
          const data = await web.ddgInstant(text);
          const formatted = web.formatDdgInstant(text, data, {
            provider: 'DuckDuckGo Instant Answer (keyless)',
            openUrl: web.searchUrl('duckduckgo', text),
          });
          if (formatted) return reply(formatted);
        } catch { /* link-only fallback */ }
        return reply(
          `🔎 *DuckDuckGo search: ${text}*\n\n` +
            '_No instant answer is available right now._\n\n' +
            `▸ ${web.searchUrl('duckduckgo', text)}\n\n` +
            '_Use `.bing <query>` for parsed Bing web results._',
        );
      }

      // gsearch is generic, but it still returns real results instead of a
      // link salad. Bing RSS is named as the source in the output.
      try {
        const items = await web.bingSearch(text, 5);
        const formatted = web.formatBingResults(text, items, { title: 'Web results' });
        if (formatted) return reply(formatted);
      } catch { /* link-only fallback */ }
      return reply(
        `🔎 *Web search: ${text}*\n\n` +
          '_Live result parsing is unavailable right now._\n\n' +
          `▸ Google: ${web.searchUrl('google', text)}\n` +
          `▸ Bing: ${web.searchUrl('bing', text)}\n` +
          `▸ DuckDuckGo: ${web.searchUrl('duckduckgo', text)}\n\n` +
          '_Use `.bing <query>` for parsed Bing results._',
      );
    }

    /* ── currency / crypto ──────────────────────────────── */
    if (CURRENCY.has(command)) {
      const nums = args.map((a) => a.toUpperCase());
      const fromCur = nums.find((a) => /^[A-Z]{3}$/.test(a)) || 'USD';
      const toCur = nums.filter((a) => /^[A-Z]{3}$/.test(a))[1] || 'NGN';
      const amount = parseFloat(args.find((a) => /^[\d.]+$/.test(a))) || 1;
      try {
        const r = await axios.get(`https://api.exchangerate.host/convert`, {
          params: { from: fromCur, to: toCur, amount },
          timeout: 10000,
        });
        if (r.data?.result) {
          return reply(`💱 *${amount} ${fromCur}* = *${r.data.result.toFixed(2)} ${toCur}*`);
        }
      } catch { /* fallthrough */ }
      return reply(
        `💱 *Conversion*\n\nUsage: \`.currency 100 USD NGN\`\n\n` +
          `_Live rates are unavailable right now._`,
      );
    }

    /* ── translate ──────────────────────────────────────── */
    if (TRANSLATE.has(command)) {
      const [lang, ...rest] = args;
      const target = rest.join(' ');
      if (!lang || !target) return reply('Usage: `.translate fr hello world`');
      try {
        const r = await axios.get('https://api.mymemory.translated.net/get', {
          params: { q: target, langpair: `auto|${lang}` }, timeout: 10000,
        });
        const t = r.data?.responseData?.translatedText;
        if (t) return reply(`🌍 *${lang}*\n\n${t}`);
      } catch { /* fallthrough */ }
      return reply('❌ Translation service is busy. Try again.');
    }

    /* ── network ────────────────────────────────────────── */
    if (NET.has(command)) {
      if (['ip', 'ipinfo', 'iplookup', 'geoip'].includes(command)) {
        const q = text || '';
        try {
          const r = await axios.get(`https://ipapi.co/${q ? encodeURIComponent(q) : ''}json/`, { timeout: 10000 });
          const d = r.data;
          return reply(
            `🌐 *IP Info*\n\n` +
              `▸ IP      : ${d.ip}\n▸ City    : ${d.city || '-'}\n▸ Region  : ${d.region || '-'}\n` +
              `▸ Country : ${d.country_name || '-'}\n▸ ISP     : ${d.org || '-'}`,
          );
        } catch (e) { return reply(`❌ ${e.message}`); }
      }
      if (['sysinfo', 'neofetch', 'hostinfo', 'cpu', 'ram', 'memory', 'disk', 'storage', 'os'].includes(command)) {
        const os = require('os');
        const mem = process.memoryUsage();
        return reply(
          `💻 *System*\n\n` +
            `▸ Host   : ${os.hostname()}\n▸ Platform: ${os.platform()} ${os.arch()}\n` +
            `▸ Node   : ${process.version}\n▸ CPUs   : ${os.cpus().length}\n` +
            `▸ Load   : ${os.loadavg()[0].toFixed(2)}\n` +
            `▸ RSS    : ${(mem.rss / 1048576).toFixed(1)} MB\n` +
            `▸ Uptime : ${Math.floor(process.uptime() / 60)} min`,
        );
      }
      if (['speedtest', 'ping_host', 'latency', 'isup', 'down'].includes(command)) {
        if (!text) return reply(`Usage: \`.${command} <url or host>\``);
        const t0 = Date.now();
        try {
          await axios.get(/^https?:/.test(text) ? text : `https://${text}`, { timeout: 12000, headers: { 'User-Agent': UA } });
          return reply(`✅ *${text}* is up\n\n⏱️ ${Date.now() - t0} ms`);
        } catch (e) {
          return reply(`❌ *${text}* unreachable — ${e.message}`);
        }
      }
      return reply(`🌐 \`.${command}\` needs a target. Try \`.ip\`, \`.sysinfo\`, \`.isup <url>\`.`);
    }

    return reply('🔧 Working on it.');
  },
};
