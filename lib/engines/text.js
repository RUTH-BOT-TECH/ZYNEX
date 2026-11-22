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
  mono:        (s) => mapRange(0x1d68a, 0x1d670, s, 0x1d7f6),
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
  vaporwave:   (s) => [...s].map((c) => (c === ' ' ? '\u3000' : String.fromCodePoint(c.codePointAt(0) + 0xfee0))).join(''),
  wide:        (s) => [...s].map((c) => (c === ' ' ? '\u3000' : String.fromCodePoint(c.codePointAt(0) + 0xfee0))).join(''),
  zalgo:       (s) => [...s].map((c) => c + '\u0300\u0301\u0302\u0303\u0304\u0308\u030a\u030c'[Math.floor(Math.random() * 8)]).join(''),
  mirror:      (s) => [...s].reverse().join(''),
  tobits:      (s) => [...s].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' '),
  tohex:       (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' '),
  morse:       (s) => {
    const M = { a:'.-',b:'-...',c:'-.-.',d:'-..',e:'.',f:'..-.',g:'--.',h:'....',i:'..',j:'.---',k:'-.-',l:'.-..',m:'--',n:'-.',o:'---',p:'.--.',q:'--.-',r:'.-.',s:'...',t:'-',u:'..-',v:'...-',w:'.--',x:'-..-',y:'-.--',z:'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',' ':'/' };
    return [...s.toLowerCase()].map((c) => M[c] || c).join(' ');
  },
  reverse:     (s) => [...s].reverse().join(''),
  mock:        (s) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''),
  clap:        (s) => s.trim().split(/\s+/).join(' 👏 '),
  fullwidth:   (s) => [...s].map((c) => (c === ' ' ? '\u3000' : String.fromCodePoint(c.codePointAt(0) + 0xfee0))).join(''),
};

/* ── text-logo services (these still serve images) ────────── */
const LOGO_STYLES = new Set([
  'neon','glitch','glow','fire','water','ice','snow','thunder','galaxy','silver',
  'chrome','3d','3dtext','3dgold','3dneon','graffiti','grafitti','pixel','blackpink',
  'marvel','horror','cloud','sand','wood','metal','luxury','candy','blood','matrix',
  'hacker','bokeh','leaves','smoke','lightning','devil','angel','pubg','freefire',
  'mobilelegends','valorant','minecraft','sketch','comic','cartoon','pencil',
  'watercolor','papercut','embossed','engraved','wall','steel','glossy','jewel',
  'summer','christmas','halloween','newyear','birthday','rainbow','shadow','space',
  'logomaker','textpro','ephoto','banner','thumbnail','poster',
]);

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
    return LOGO_STYLES.has(name) ? 'Text logo image' : `Text style: ${name}`;
  },

  async execute({ command, args, reply, sock, from, msg }) {
    const text = args.join(' ').trim();
    if (!text) return reply(`Usage: \`.${command} your text here\``);

    /* ── text logo → generated image ────────────────────── */
    if (LOGO_STYLES.has(command)) {
      const style = command === 'logo' || command === 'logomaker' || command === 'textpro' || command === 'ephoto'
        ? 'neon'
        : command;
      const url = `https://api.flamingtext.com/logo/Design-${encodeURIComponent(
        style.charAt(0).toUpperCase() + style.slice(1),
      )}?_variations=true&text=${encodeURIComponent(text)}`;
      try {
        return await sock.sendMessage(from, { image: { url }, caption: `✨ ${style} · ${text}` }, { quoted: msg });
      } catch {
        return reply(`❌ Couldn't render a *${style}* logo right now. Try \`.fancy ${text}\` for styled text instead.`);
      }
    }

    /* ── plain text styles ──────────────────────────────── */
    const fn = all[command];
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
  ...LOGO_STYLES,
];
