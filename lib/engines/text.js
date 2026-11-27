/**
 * TEXT ENGINE
 * Collapses ~90 text-transformation names into one handler, plus text logos.
 *
 *   .bold .italic .mono .strike .caps .upper .lower .reverse .upside .zalgo
 *   .bubble .fancy .style .font .neon .glitch .3dtext .blackpink ... (72 makers)
 *
 * Everything here is pure computation — no external API, no rate limit, works
 * offline. That's why it covers so many names for so little code.
 */
const axios = require('axios');
const LOGOS = require('../logostyles');

/* ── unicode alphabet maps ────────────────────────────────── */
const A = 'abcdefghijklmnopqrstuvwxyz';
const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const N = '0123456789';

function mapRange(lowerStart, upperStart, s, digitStart = null) {
  return [...s]
    .map((ch) => {
      const li = A.indexOf(ch);
      if (li >= 0) return String.fromCodePoint(lowerStart + li);
      const ui = B.indexOf(ch);
      if (ui >= 0) return String.fromCodePoint(upperStart + ui);
      const ni = N.indexOf(ch);
      if (ni >= 0 && digitStart) return String.fromCodePoint(digitStart + ni);
      return ch;
    })
    .join('');
}

const STYLES = {
  bold:        (s) => mapRange(0x1d5ee, 0x1d5d4, s, 0x1d7ec),
  italic:      (s) => mapRange(0x1d622, 0x1d608, s),
  bolditalic:  (s) => mapRange(0x1d65c, 0x1d63c, s),
  sans:        (s) => mapRange(0x1d5ba, 0x1d5a0, s, 0x1d7e2),
  sansbold:    (s) => mapRange(0x1d5ee, 0x1d5d4, s, 0x1d7ec),
  scriptstyle: (s) => mapRange(0x1d4b6, 0x1d49c, s),
  scriptbold:  (s) => mapRange(0x1d4ea, 0x1d4d0, s),
  fraktur:     (s) => mapRange(0x1d51e, 0x1d504, s),
  double:      (s) => mapRange(0x1d552, 0x1d538, s, 0x1d7d8),
  monotext:    (s) => mapRange(0x1d68a, 0x1d670, s, 0x1d7f6),
  circle:      (s) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x24d0 + A.indexOf(c)))
                     .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x24b6 + B.indexOf(c))),
  circlefill:  (s) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x1f150 + A.indexOf(c)))
                     .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f150 + B.indexOf(c))),
  square:      (s) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x1f130 + A.indexOf(c)))
                     .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f130 + B.indexOf(c))),
  squarefill:  (s) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x1f170 + A.indexOf(c)))
                     .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x1f170 + B.indexOf(c))),
  parens:      (s) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x249c + A.indexOf(c)))
                     .replace(/[A-Z]/g, (c) => String.fromCodePoint(0x249c + B.indexOf(c))),
  smallcaps:   (s) => s.toLowerCase().replace(/[a-z]/g,
                     (c) => 'ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ'[A.indexOf(c)] || c),
  upside:      (s) => [...s.toLowerCase()].reverse()
                     .map((c) => ({ a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'l',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z' }[c] || c)).join(''),
  strikethrough: (s) => [...s].map((c) => c + '\u0336').join(''),
  underline:   (s) => [...s].map((c) => c + '\u0332').join(''),
  overline:    (s) => [...s].map((c) => c + '\u0305').join(''),
  slash:       (s) => [...s].map((c) => c + '\u0338').join(''),
  wide:        (s) => [...s].map((c) => (c === ' ' ? '\u3000' : String.fromCodePoint(c.codePointAt(0) + 0xfee0))).join(''),
  zalgo:       (s) => [...s].map((c) => c + '\u0300\u0301\u0302\u0303\u0304\u0308\u030a\u030c'[Math.floor(Math.random() * 8)]).join(''),
  mirror:      (s) => [...s].reverse().join(''),
  tobits:      (s) => [...s].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' '),
  tohex:       (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '),
  backwards:   (s) => [...s].reverse().join(''),
  mock:        (s) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''),
  clap:        (s) => s.trim().split(/\s+/).join(' 👏 '),
  fullwidth:   (s) => [...s].map((c) => (c === ' ' ? '\u3000' : String.fromCodePoint(c.codePointAt(0) + 0xfee0))).join(''),
};

/* ── text-logo services (these still serve images) ────────── */
// Every textmaker name the catalogue lists, minus the ones the renderer treats
// as document cards. Membership here means "match() accepts it"; the renderer
// decides the drawing.
/**
 * Names owned by another implementation must not be claimed here.
 *
 * `logo` is a dedicated command with its own artwork pipeline, `facepalm` is
 * an overlay effect and `morse` belongs to the crypto engine. Each also
 * appears in the shared style table, so the text engine used to advertise
 * them and then fail when picked. The registry is first-come, so the loser
 * was decided by load order, not by intent.
 *
 * `rainbow` is NOT owned elsewhere: it lives in logostyles.js and no overlay
 * effect claims it. Excluding it here left `.rainbow` as a dead fallback
 * ("isn't wired up yet") while the renderer was sitting right there.
 */
const OWNED_ELSEWHERE = new Set(['logo', 'facepalm', 'morse']);

const LOGO_STYLES = new Set([
  ...Object.keys(LOGOS.STYLES).filter((n) => !OWNED_ELSEWHERE.has(n)),
  ...[...LOGOS.CARDS].filter((n) => !OWNED_ELSEWHERE.has(n)),
  'logomaker', 'logotext', 'textpro', 'ephoto']);


/* names that are just case utility */
const CASES = {
  upper: (s) => s.toUpperCase(),
  caps: (s) => s.toUpperCase(),
  lowercase: (s) => s.toLowerCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
};

const all = { ...STYLES, ...CASES };

module.exports = {
  id: 'text',
  name: 'text-engine',

  match(name) {
    return Boolean(all[name]) || LOGO_STYLES.has(name);
  },

  describe(name) {
    return LOGO_STYLES.has(name) ? `${name} text logo` : `Text style: ${name}`;
  },

  async execute({ command, args, reply, sock, from, msg }) {
    const text = args.join(' ').trim();
    // Card styles are allowed to arrive empty so they can explain the field
    // format instead of the generic usage line.
    if (!text && !LOGOS.CARDS.has(command)) {
      return reply(`Usage: \`.${command} your text here\``);
    }

    /* ── text logo → rendered locally with sharp ────────── */
    // flamingtext used to serve these, but it now answers 429 to this host and
    // the old URL returned an HTML page with HTTP 200 — so the bot was quietly
    // sending a web page as an "image". lib/logostyles.js draws every logo
    // locally instead: no network, no key, no rate limit.
    if (LOGO_STYLES.has(command)) {
      const style = LOGOS.STYLES[command]
        ? command
        : { logo: 'neon', logomaker: 'neon', logotext: 'neon', textpro: 'neon', ephoto: 'neon' }[command] || 'neon';

      if (LOGOS.CARDS.has(command)) {
        // card styles carry real information, so they take fields, not a phrase
        const bits = args.join(' ').split('|').map((x) => x.trim()).filter(Boolean);
        const title = command.replace(/_/g, ' ').toUpperCase();
        const fields = bits.map((b, i) => {
          const [k, v] = b.includes('=') ? b.split('=') : [b, ''];
          return [k.trim(), (v || '').trim() || '—'];
        });
        if (!fields.length) {
          return reply(
            `❌ *${command}* needs details. Try:\n\`.${command} Name=Ada | Role=Dev | Phone=0803...\``,
          );
        }
        try {
          const png = await LOGOS.card({ title, fields, accent: LOGOS.ACCENTS[command] || '#4f8cff' });
          return await sock.sendMessage(from, { image: png, caption: `🪪 *${title}*` }, { quoted: msg });
        } catch (e) {
          return reply(`❌ Card render failed (${e.message}). Try \`.fancy ${text}\` for styled text.`);
        }
      }

      try {
        const png = await LOGOS.render(style, text);
        const note = LOGOS.TRIBUTE.has(style)
          ? `\n_themed nameplate in that style — not the official logo_`
          : LOGOS.TRADEMARKED.has(style)
            ? `\n_custom nameplate, not the official wordmark_`
            : '';
        return await sock.sendMessage(
          from,
          { image: png, caption: `✨ *${style}* · ${text}${note}` },
          { quoted: msg },
        );
      } catch (e) {
        return reply(
          `❌ Couldn't render *${style}* (${e.message}).\n` +
            `Try \`.neon ${text}\` or \`.fancy ${text}\` — both are local and always available.`,
        );
      }
    }

    /* ── plain text styles ──────────────────────────────── */
    const fn = all[command];
    // Guard: routing normally only calls this when match() passed, but a direct
    // call with an unknown name used to throw an unhandled TypeError.
    if (typeof fn !== 'function') {
      return reply(
        `❌ *${command}* isn't a text style I know.\n\n` +
          `Try: \`.fancy\` \`.tiny\` \`.wide\` \`.circle\` \`.bubble\` \`.bold\` ` +
          `\`.italic\` \`.strike\` \`.upside\` \`.reverse\`/\`*/`,
      );
    }
    const out = fn(text);
    return reply(`${out}`);
  },
};

module.exports.STYLES = STYLES;
module.exports.LOGO_STYLES = LOGO_STYLES;

// Names this engine supports that may not appear in the catalogue.
// The registry indexes these too, so no working feature stays invisible.
module.exports.extraNames = [
  ...Object.keys(STYLES),
  ...Object.keys(CASES),
  ...LOGO_STYLES];
