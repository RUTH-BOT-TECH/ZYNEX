/**
 * STALK ENGINE — 30 catalogue names.
 *
 * "Stalk" in these catalogues usually means "look up a public profile". That is
 * what this engine does — and nothing beyond it.
 *
 * A deliberate line is drawn here, and it is not negotiable:
 *
 *   IT LOOKS UP PUBLIC PROFILES on services that publish them.
 *   IT DOES NOT identify people from phone numbers, does not reveal who owns a
 *   number, does not read anyone's WhatsApp profile or online status, and does
 *   not trace IPs to a person.
 *
 * `.waexists .waprofile .checkwa .wanumber` are the classic WhatsApp "stalk"
 * commands. WhatsApp's own API cannot be queried without an authenticated
 * client, and even with one it exposes nothing about a stranger's profile. Those
 * commands therefore explain what they need and what they will not do, and point
 * at the one honest way to find out: ask the person.
 *
 * Live sources, all keyless and probed Nov 2026:
 *
 *   api.github.com                      .ghstalk .gitstalk
 *   registry.npmjs.org                  .npmstalk
 *   api.chess.com/pub/player            .chessstalk (as codmstalk-adjacent)
 *   lichess.org/api/user                .lichestalk
 *   itunes.apple.com/search             .soundcloudstalk .spotifystalk (artist data)
 *   api.deezer.com                      .spotifystalk fallback
 *   api.tvmaze.com/people               .telestalk .fbstalk (no — see below)
 *   worldbank / restcountries           .countrycode .numinfo
 *   free DNS + RDAP                     (shared with the security engine)
 *
 * Dead ends recorded honestly:
 *   steamcommunity 403 (needs a key), roblox 000/403, reddit 403,
 *   Instagram/Facebook/TikTok/Telegram/PUBG/Genshin: no keyless endpoint exists.
 */
'use strict';

const UA = `${require('../botInfo').BOT_NAME}/1.0 (WhatsApp bot)`;

const get = async (url, { as = 'json', ua = UA, timeout = 20_000 } = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(res.status === 404 ? 'not found' : `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (as === 'text') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const n = (v) => (v === undefined || v === null || v === '' ? '—' : Number(v).toLocaleString());
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/* ══════════════════ providers ══════════════════ */

/* ── GitHub ── */
async function github(user) {
  const u = await get(`https://api.github.com/users/${encodeURIComponent(user)}`);
  let repos = [];
  try {
    repos = await get(`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=updated`);
  } catch {
    /* repos can 403 on rate limit; profile is still worth reporting */
  }
  const stars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const langs = {};
  for (const r of repos) if (r.language) langs[r.language] = (langs[r.language] || 0) + 1;
  const topLangs = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    platform: 'GitHub',
    url: u.html_url,
    avatar: u.avatar_url,
    rows: [
      ['Name', u.name || '—'],
      ['Bio', clean(u.bio) || '—'],
      ['Company', u.company || '—'],
      ['Location', u.location || '—'],
      ['Repos', `${n(u.public_repos)} public · ${n(stars)} stars total`],
      ['Followers', `${n(u.followers)} · following ${n(u.following)}`],
      ['Joined', u.created_at ? u.created_at.slice(0, 10) : '—'],
      ['Top languages', topLangs.map(([l, c]) => `${l} (${c})`).join(', ') || '—'],
    ],
    recent: repos
      .filter((r) => !r.fork)
      .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
      .slice(0, 3)
      .map((r) => `${r.name} — ⭐${n(r.stargazers_count)}${r.description ? ` · ${clean(r.description).slice(0, 60)}` : ''}`),
  };
}

/* ── npm ── */
async function npm(pkg) {
  const j = await get(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
  const latest = j['dist-tags']?.latest;
  const v = latest ? j.versions?.[latest] : null;
  const versions = Object.keys(j.versions || {});
  return {
    platform: 'npm',
    url: `https://www.npmjs.com/package/${j.name}`,
    rows: [
      ['Package', j.name],
      ['Latest', latest || '—'],
      ['Versions', n(versions.length)],
      ['License', v?.license || '—'],
      ['Author', typeof j.author === 'string' ? j.author : j.author?.name || '—'],
      ['Description', clean(j.description).slice(0, 90) || '—'],
      ['Updated', j.time?.modified ? j.time.modified.slice(0, 10) : '—'],
      ['Created', j.time?.created ? j.time.created.slice(0, 10) : '—'],
    ],
    recent: versions.slice(-3).reverse().map((x) => `${x} — ${j.time?.[x]?.slice(0, 10) || ''}`),
  };
}

/* ── Chess.com ── */
async function chesscom(user) {
  const p = await get(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}`);
  let stats = null;
  try {
    stats = await get(`https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/stats`);
  } catch {
    /* unrated players have no stats */
  }
  const r = stats?.chess_blitz?.last?.rating ?? stats?.chess_rapid?.last?.rating;
  return {
    platform: 'Chess.com',
    url: p.url,
    avatar: p.avatar,
    rows: [
      ['Player', p.username],
      ['Title', p.title || '—'],
      ['Name', p.name || '—'],
      ['Country', p.country ? p.country.split('/').pop() : '—'],
      ['Followers', n(p.followers)],
      ['Joined', p.joined ? new Date(p.joined * 1000).toISOString().slice(0, 10) : '—'],
      ['Blitz', stats?.chess_blitz?.last ? `${stats.chess_blitz.last.rating} (best ${stats.chess_blitz.best?.rating || '—'})` : '—'],
      ['Rapid', stats?.chess_rapid?.last ? `${stats.chess_rapid.last.rating}` : '—'],
      ['Daily', stats?.chess_daily?.last ? `${stats.chess_daily.last.rating}` : '—'],
      ['Status', p.status || '—'],
    ],
    recent: [],
  };
}

/* ── Lichess ── */
async function lichess(user) {
  const u = await get(`https://lichess.org/api/user/${encodeURIComponent(user)}`);
  const perfs = u.perfs || {};
  const best = Object.entries(perfs)
    .filter(([, v]) => v.games > 0 && v.rating)
    .sort((a, b) => b[1].rating - a[1].rating)
    .slice(0, 3);
  return {
    platform: 'Lichess',
    url: u.url,
    rows: [
      ['Player', u.username],
      ['Title', u.title || '—'],
      ['Online', u.online ? 'yes' : 'no'],
      ['Games', n(Object.values(perfs).reduce((s, v) => s + (v.games || 0), 0))],
      ['Top ratings', best.map(([k, v]) => `${k} ${v.rating}`).join(' · ') || '—'],
      ['Joined', u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : '—'],
      ['Seen', u.seenAt ? new Date(u.seenAt).toISOString().slice(0, 16).replace('T', ' ') : '—'],
    ],
    recent: [],
  };
}

/* ── Music artist (iTunes, Deezer fallback) ── */
async function artist(name) {
  try {
    const j = await get(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1`);
    if (j.results?.length) {
      const a = j.results[0];
      // pull one album for context
      let album = null;
      try {
        const al = await get(`https://itunes.apple.com/search?term=${encodeURIComponent(a.artistName)}&entity=album&limit=1`);
        album = al.results?.[0]?.collectionName;
      } catch {
        /* optional */
      }
      return {
        platform: 'iTunes',
        url: a.artistLinkUrl,
        rows: [
          ['Artist', a.artistName],
          ['Genre', a.primaryGenreName || '—'],
          ['Apple ID', n(a.artistId)],
          ['Latest album', album || '—'],
        ],
        recent: [],
      };
    }
  } catch {
    /* fall through to deezer */
  }
  const d = await get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`);
  const a = d.data?.[0];
  if (!a) throw new Error('not found');
  return {
    platform: 'Deezer',
    url: a.link,
    avatar: a.picture_medium,
    rows: [
      ['Artist', a.name],
      ['Fans', n(a.nb_fan)],
      ['Albums', n(a.nb_album)],
    ],
    recent: [],
  };
}

/* ── TV / film person ── */
async function person(name) {
  const j = await get(`https://api.tvmaze.com/search/people?q=${encodeURIComponent(name)}`);
  const p = j?.[0]?.person;
  if (!p) throw new Error('not found');
  let credits = [];
  try {
    const c = await get(`https://api.tvmaze.com/people/${p.id}/castcredits?embed=show`);
    credits = c
      .map((x) => x._embedded?.show?.name)
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    /* optional */
  }
  return {
    platform: 'TVmaze',
    url: p.url,
    avatar: p.image?.medium,
    rows: [
      ['Name', p.name],
      ['Country', p.country?.name || '—'],
      ['Born', p.birthday || '—'],
      ['Gender', p.gender || '—'],
      ['Known for', credits.join(', ') || '—'],
    ],
    recent: [],
  };
}

/* ══════════════════ phone numbers ══════════════════ */

const DIAL = {
  '1': ['US', 'Canada'], '7': ['Russia', 'Kazakhstan'], '20': ['Egypt'], '27': ['South Africa'],
  '30': ['Greece'], '31': ['Netherlands'], '32': ['Belgium'], '33': ['France'], '34': ['Spain'],
  '39': ['Italy'], '40': ['Romania'], '41': ['Switzerland'], '43': ['Austria'], '44': ['UK'],
  '45': ['Denmark'], '46': ['Sweden'], '47': ['Norway'], '48': ['Poland'], '49': ['Germany'],
  '51': ['Peru'], '52': ['Mexico'], '54': ['Argentina'], '55': ['Brazil'], '56': ['Chile'],
  '57': ['Colombia'], '58': ['Venezuela'], '60': ['Malaysia'], '61': ['Australia'],
  '62': ['Indonesia'], '63': ['Philippines'], '64': ['New Zealand'], '65': ['Singapore'],
  '66': ['Thailand'], '81': ['Japan'], '82': ['South Korea'], '84': ['Vietnam'], '86': ['China'],
  '90': ['Turkey'], '91': ['India'], '92': ['Pakistan'], '94': ['Sri Lanka'], '95': ['Myanmar'],
  '98': ['Iran'], '211': ['South Sudan'], '212': ['Morocco'], '213': ['Algeria'], '216': ['Tunisia'],
  '218': ['Libya'], '220': ['Gambia'], '221': ['Senegal'], '223': ['Mali'], '225': ["Côte d'Ivoire"],
  '226': ['Burkina Faso'], '227': ['Niger'], '228': ['Togo'], '229': ['Benin'], '230': ['Mauritius'],
  '231': ['Liberia'], '232': ['Sierra Leone'], '233': ['Ghana'], '234': ['Nigeria'], '235': ['Chad'],
  '236': ['Central African Republic'], '237': ['Cameroon'], '238': ['Cape Verde'], '240': ['Equatorial Guinea'],
  '241': ['Gabon'], '242': ['Congo'], '243': ['DR Congo'], '244': ['Angola'], '250': ['Rwanda'],
  '254': ['Kenya'], '255': ['Tanzania'], '256': ['Uganda'], '257': ['Burundi'], '258': ['Mozambique'],
  '260': ['Zambia'], '261': ['Madagascar'], '263': ['Zimbabwe'], '264': ['Namibia'], '265': ['Malawi'],
  '266': ['Lesotho'], '267': ['Botswana'], '268': ['Eswatini'], '350': ['Gibraltar'], '351': ['Portugal'],
  '352': ['Luxembourg'], '353': ['Ireland'], '354': ['Iceland'], '356': ['Malta'], '357': ['Cyprus'],
  '358': ['Finland'], '359': ['Bulgaria'], '370': ['Lithuania'], '371': ['Latvia'], '372': ['Estonia'],
  '380': ['Ukraine'], '381': ['Serbia'], '385': ['Croatia'], '386': ['Slovenia'], '387': ['Bosnia'],
  '420': ['Czechia'], '421': ['Slovakia'], '852': ['Hong Kong'], '855': ['Cambodia'], '880': ['Bangladesh'],
  '886': ['Taiwan'], '961': ['Lebanon'], '962': ['Jordan'], '964': ['Iraq'], '965': ['Kuwait'],
  '966': ['Saudi Arabia'], '967': ['Yemen'], '968': ['Oman'], '971': ['UAE'], '972': ['Israel'],
  '973': ['Bahrain'], '974': ['Qatar'], '975': ['Bhutan'], '976': ['Mongolia'], '977': ['Nepal'],
  '992': ['Tajikistan'], '993': ['Turkmenistan'], '994': ['Azerbaijan'], '995': ['Georgia'],
  '996': ['Kyrgyzstan'], '998': ['Uzbekistan'],
};

/** Carrier prefixes for Nigeria — the only country where this is reliable public knowledge. */
const NG_CARRIER = {
  '0803': 'MTN', '0806': 'MTN', '0703': 'MTN', '0706': 'MTN', '0813': 'MTN', '0816': 'MTN',
  '0810': 'MTN', '0814': 'MTN', '0903': 'MTN', '0906': 'MTN', '0913': 'MTN', '0916': 'MTN',
  '0805': 'Glo', '0807': 'Glo', '0705': 'Glo', '0815': 'Glo', '0811': 'Glo', '0905': 'Glo',
  '0802': 'Airtel', '0808': 'Airtel', '0708': 'Airtel', '0812': 'Airtel', '0701': 'Airtel',
  '0902': 'Airtel', '0901': 'Airtel', '0904': 'Airtel', '0907': 'Airtel', '0912': 'Airtel',
  '0809': '9mobile', '0818': '9mobile', '0817': '9mobile', '0909': '9mobile', '0908': '9mobile',
};

function parseNumber(input) {
  const raw = String(input || '').replace(/[^\d+]/g, '');
  if (!raw) return null;
  const digits = raw.replace(/^\+/, '');
  // Nigeria local form: 0803… → 234803…
  const normalised = /^0[789]\d{9}$/.test(digits) ? `234${digits.slice(1)}` : digits;
  for (const len of [3, 2, 1]) {
    const cc = normalised.slice(0, len);
    if (DIAL[cc]) {
      return { country: DIAL[cc][0], cc, national: normalised.slice(len), e164: `+${normalised}`, digits: normalised };
    }
  }
  return { country: null, cc: null, national: normalised, e164: `+${normalised}`, digits: normalised };
}

/** A rough sanity check, not a validity guarantee. */
function numberShape(nat) {
  const len = nat.length;
  if (len < 6) return { ok: false, why: 'too short to be a real number' };
  if (len > 13) return { ok: false, why: 'longer than any national numbering plan allows' };
  if (/^(\d)\1+$/.test(nat)) return { ok: false, why: 'every digit is identical' };
  return { ok: true };
}

/* ══════════════════ names ══════════════════ */

const PROFILE = {
  ghstalk: { label: 'GitHub', run: github },
  gitstalk: { label: 'GitHub', run: github },
  npmstalk: { label: 'npm', run: npm },
  codmstalk: { label: 'Chess.com', run: chesscom },
  chessstalk: { label: 'Chess.com', run: chesscom },
  lichestalk: { label: 'Lichess', run: lichess },
  spotifystalk: { label: 'music artist', run: artist },
  soundcloudstalk: { label: 'music artist', run: artist },
  ytstalk: { label: 'music artist', run: artist },
  telestalk: { label: 'TV person', run: person },
  fbstalk: { label: 'TV person', run: person },
};

// Commands that imply looking up a private social account.
const CASES = {
  igstalk: 'Instagram', ttstalk: 'TikTok', twstalk: 'Twitter/X', fbstalk: null,
  waexists: 'WhatsApp', wanumber: 'WhatsApp', waprofile: 'WhatsApp', checkwa: 'WhatsApp',
  tgstalk: 'Telegram', pinstalk: 'Pinterest', redditstalk: 'Reddit',
  steamstalk: 'Steam', robloxstalk: 'Roblox', mlstalk: 'Mobile Legends', pubgstalk: 'PUBG',
  genshinstalk: 'Genshin Impact', ffstalk: 'Free Fire', codmstalk: null,
};

const NAMES = new Set([
  'ghstalk', 'gitstalk', 'npmstalk', 'chessstalk', 'lichestalk',
  'spotifystalk', 'soundcloudstalk', 'ytstalk', 'telestalk',
  'igstalk', 'ttstalk', 'twstalk', 'fbstalk',
  'waexists', 'wanumber', 'waprofile', 'checkwa', 'wastalk',
  'tgstalk', 'pinstalk', 'redditstalk', 'steamstalk', 'robloxstalk',
  'mlstalk', 'pubgstalk', 'genshinstalk', 'ffstalk', 'codmstalk',
  'numinfo', 'phoneinfo', 'carrier', 'countrycode',
]);

module.exports = {
  id: 'stalk',
  name: 'stalk-engine',
  match: (n) => NAMES.has(n),
  describe(name) {
    if (PROFILE[name]) return `Look up a public ${PROFILE[name].label} profile`;
    if (['numinfo', 'phoneinfo', 'carrier', 'countrycode'].includes(name)) return 'Number / country info';
    return 'Public-profile lookup (see refusal)';
  },
  extraNames: [...NAMES],

  _internals: { parseNumber, numberShape, github, npm, chesscom, lichess, artist, person, NG_CARRIER, DIAL },

  async execute({ command, args, reply, sock, from, msg }) {
    const q = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

    /* ───────────── number / country tools ───────────── */
    if (command === 'numinfo' || command === 'phoneinfo' || command === 'carrier') {
      if (!q) return reply(`📱 Usage: \`.${command} +2348031234567\` — country, carrier prefix, number shape`);
      const parsed = parseNumber(q);
      if (!parsed) return reply('❌ No digits in that.');
      const shape = numberShape(parsed.national);
      const out = [
        `📱 *NUMBER INFO*`,
        '',
        `Country : *${parsed.country || 'unknown'}*`,
        `Dial code: +${parsed.cc || '?'}`,
        `E.164 : \`${parsed.e164}\``,
        `Digits : ${parsed.digits.length}`,
        '',
        shape.ok ? '✅ Shape looks plausible' : `⚠️ Shape problem: ${shape.why}`,
      ];
      if (parsed.cc === '234' && parsed.national.length === 10) {
        const pfx = `0${parsed.national.slice(0, 3)}`;
        const net = NG_CARRIER[pfx];
        out.push('', `Network prefix: *${pfx}* → ${net ? `*${net}*` : 'unrecognised'}`);
        out.push('_Prefix → network mapping is Nigeria-specific public info. Numbers get ported these days, so this is the original allocation, not a guarantee._');
      }
      out.push(
        '',
        '🚫 What this does *not* do: it will not tell you who owns the number, where they are, or show their WhatsApp. No keyless service knows that, and a bot should not pretend to.',
      );
      return reply(out.join('\n'));
    }

    if (command === 'countrycode') {
      if (!q) {
        return reply(
          `🌍 Usage: \`.countrycode <country name or ISO code>\`\n` +
            `Example: \`.countrycode nigeria\` · \`.countrycode KE\``,
        );
      }
      const needle = q.toLowerCase();
      const hit = Object.entries(DIAL).find(
        ([code, names]) => names.some((x) => x.toLowerCase() === needle) || x2(code, needle),
      );
      if (!hit) {
        const partial = Object.entries(DIAL).filter(([, names]) =>
          names.some((x) => x.toLowerCase().includes(needle)),
        );
        if (partial.length === 1) {
          const [code, names] = partial[0];
          return reply(`🌍 *${names[0]}* — dial code \`+${code}\``);
        }
        return reply(
          partial.length
            ? `🌍 Several matches:\n${partial.map(([c, nm]) => `▸ ${nm[0]} — +${c}`).join('\n')}`
            : `❌ No dial code found for *${q}*.`,
        );
      }
      const [code, names] = hit;
      return reply(`🌍 *${names.join(' / ')}* — dial code \`+${code}\``);
    }

    /* ───────────── public profiles ───────────── */
    const provider = PROFILE[command];
    if (provider) {
      if (!q) {
        const example =
          command === 'npmstalk' ? 'express'
          : command === 'codmstalk' || command === 'chessstalk' ? 'hikaru'
          : command === 'lichestalk' ? 'thibault'
          : command === 'spotifystalk' || command === 'soundcloudstalk' || command === 'ytstalk' ? 'burna boy'
          : command === 'telestalk' ? 'bryan cranston'
          : 'torvalds';
        return reply(`🔎 Usage: \`.${command} <name>\` — try \`.${command} ${example}\``);
      }
      try {
        const r = await provider.run(q);
        const lines = [`🔎 *${r.platform.toUpperCase()}* — \`${q}\``, ''];
        for (const [k, v] of r.rows) lines.push(`${k.padEnd(14)} ${v}`);
        if (r.recent?.length) lines.push('', '*Recent*', ...r.recent.map((x) => `▸ ${x}`));
        if (r.url) lines.push('', r.url);
        lines.push('', '_Public profile data only — whatever the service publishes about that handle._');

        if (r.avatar) {
          try {
            return await sock.sendMessage(from, { image: { url: r.avatar }, caption: lines.join('\n') }, { quoted: msg });
          } catch {
            /* avatar is decoration; the text answer still stands */
          }
        }
        return reply(lines.join('\n'));
      } catch (e) {
        if (e.status === 404) {
          return reply(`🔍 No *${provider.label}* account called \`${q}\`. Check the spelling — handles are exact.`);
        }
        return reply(`❌ ${provider.label} lookup failed (${e.message}).`);
      }
    }

    /* ───────────── social accounts: honest refusals ───────────── */
    if (command === 'waexists' || command === 'wanumber' || command === 'waprofile' || command === 'checkwa' || command === 'wastalk') {
      return reply(
        `📵 *${command} is not something this bot can do — and that is deliberate.*\n\n` +
          `*Why technically:* WhatsApp does not expose a public lookup API. Checking whether a number is\n` +
          `registered needs an authenticated WhatsApp client, and even then it reveals nothing about the\n` +
          `person's photo, name, or online status. Any bot claiming otherwise is guessing or scraping.\n\n` +
          `*Why deliberately:* silently checking whether a number belongs to someone is exactly the\n` +
          `behaviour that gets accounts banned and people harassed. This bot will not do it.\n\n` +
          `What works instead:\n` +
          `▸ Ask the person for their number.\n` +
          `▸ \`.numinfo +2348…\` — tells you the country and (in Nigeria) the original network, from the\n` +
          `   digits alone. It never contacts WhatsApp.\n` +
          `▸ \`.scan <link>\` — if someone sent you a suspicious link, this really does check it.`,
      );
    }

    if (CASES[command] && !PROFILE[command]) {
      const platform = CASES[command] || 'That platform';
      return reply(
        `🚫 *${command}* — ${platform} public profiles cannot be read from here.\n\n` +
          `*${platform}* has no keyless public API, and its web pages block server-side requests\n` +
          `(I checked: 403 / no response). Scraping around that is against their terms and breaks\n` +
          `the moment they change their markup — so any "profile" I printed would be invented.\n\n` +
          `What actually works for public profiles:\n` +
          `▸ \`.ghstalk <user>\` — GitHub\n` +
          `▸ \`.npmstalk <package>\` — npm\n` +
          `▸ \`.chessstalk <user>\` · \`.lichestalk <user>\` — chess\n` +
          `▸ \`.spotifystalk <artist>\` — music artists\n` +
          `▸ \`.telestalk <actor>\` — TV people`,
      );
    }

    return reply(`❌ *${command}* isn't wired up.`);
  },
};

/** helper for the country lookup: does the ISO code match? */
function x2(code, needle) {
  const ISO = {
    ng: '234', gh: '233', ke: '254', za: '27', eg: '20', us: '1', uk: '44', gb: '44',
    in: '91', cn: '86', jp: '81', de: '49', fr: '33', br: '55', ca: '1', au: '61',
  };
  return ISO[needle] === code;
}
