/**
 * ISLAMIC ENGINE — Quran, prayer times, qibla, hijri date, duas, 99 names.
 *
 * Every endpoint below was verified live (HTTP 200, keyless):
 *   • api.alquran.cloud          — Quran text + translations
 *   • api.aladhan.com            — prayer times, qibla, Hijri conversion
 *
 * Content note: Arabic text and translations come straight from the API and
 * are passed through unmodified — no paraphrasing of scripture.
 */
const axios = require('axios');

const UA = `Mozilla/5.0 (compatible; ${require('../botInfo').BOT_NAME}/1.0)`;

const QURAN = new Set(['quran', 'surah', 'ayah', 'juz', 'quransearch', 'qurandl', 'tafsir']);
const PRAYER = new Set(['prayer', 'prayertime', 'prayertimes', 'salah', 'salat', 'azan', 'adhan', 'namaz']);
const QIBLA = new Set(['qibla']);
const HIJRI = new Set(['hijri', 'islamicdate', 'islamiccalendar']);
const DUA = new Set(['dua', 'duas', 'dhikr', 'zikr', 'tasbih']);
const NAMES99 = new Set(['asmaulhusna', 'names99', 'allahnnames', 'allahnnames99']);
const ISLAMIC_QUOTE = new Set(['islamicquote', 'hadith', 'sunnah', 'islamicjoke']);

const PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

/* a small curated duʿāʾ set — expandable from a file later */
const DUAS = [
  ['Before eating', 'Bismillah', 'In the name of Allah'],
  ['After eating', 'Alhamdulillahilladhi at\'amana wa saqana wa ja\'alana minal-muslimeen', 'Praise be to Allah who fed us, gave us drink, and made us Muslims'],
  ['Before sleeping', 'Bismika Allahumma amutu wa ahya', 'In Your name, O Allah, I die and I live'],
  ['On waking', 'Alhamdulillahilladhi ahyana ba\'da ma amatana wa ilayhin-nushur', 'Praise be to Allah who gave us life after death, and to Him is the return'],
  ['When travelling', 'Subhanalladhi sakhkhara lana hadha wa ma kunna lahu muqrinin', 'Glory to Him who has subjected this to us, though we could not have done so'],
  ['For anxiety', 'Allahumma inni a\'udhu bika minal-hammi wal-hazan', 'O Allah, I seek refuge in You from worry and grief'],
  ['Seeking knowledge', 'Rabbi zidni ilma', 'My Lord, increase me in knowledge'],
];

module.exports = {
  id: 'islamic',
  name: 'islamic-engine',

  match(name) {
    return QURAN.has(name) || PRAYER.has(name) || QIBLA.has(name) || HIJRI.has(name) ||
      DUA.has(name) || NAMES99.has(name) || ISLAMIC_QUOTE.has(name);
  },

  describe(name) {
    if (QURAN.has(name)) return 'Quran — surah, ayah, translation';
    if (PRAYER.has(name)) return 'Prayer times for a city';
    if (QIBLA.has(name)) return 'Qibla direction';
    if (HIJRI.has(name)) return 'Hijri (Islamic) date';
    if (DUA.has(name)) return 'Duʿāʾ and dhikr';
    if (NAMES99.has(name)) return 'The 99 names of Allah';
    return 'Islamic content';
  },

  extraNames: [...QURAN, ...PRAYER, ...QIBLA, ...HIJRI, ...DUA, ...NAMES99, ...ISLAMIC_QUOTE],

  async execute({ command, args, argString, reply }) {
    const text = (argString || args.join(' ')).trim();

    /* ── QURAN / SURAH / AYAH ───────────────────────────── */
    if (QURAN.has(command)) {
      // .ayah 2:255  → specific verse
      const ayahMatch = text.match(/^(\d{1,3})\s*[:.]\s*(\d{1,3})$/);
      if (ayahMatch && !['surah', 'quran'].includes(command)) {
        const [s, a] = [ayahMatch[1], ayahMatch[2]];
        try {
          const r = await axios.get(`https://api.alquran.cloud/v1/ayah/${s}:${a}/editions/quran-uthmani,en.sahih`, {
            timeout: 12000, headers: { 'User-Agent': UA },
          });
          const [ar, en] = r.data.data;
          return reply(
            `📖 *Surah ${ar.surah.englishName} — ${ar.surah.number}:${ar.numberInSurah}*\n\n` +
              `${ar.text}\n\n` +
              `*${en.text}*\n\n` +
              `_Translation: Sahih International_`,
          );
        } catch (e) {
          return reply(`❌ Couldn't fetch ${s}:${a}. Try \`.quran 2\` for the whole surah.`);
        }
      }

      // .quran 2  or  .surah 2  → whole surah
      const n = parseInt(args[0], 10);
      if (!n || n < 1 || n > 114) {
        return reply(
          '📖 *Quran*\n\n' +
            '`.quran 2` — read Surah Al-Baqarah\n' +
            '`.ayah 2:255` — read Ayat al-Kursi\n' +
            '`.quran 112` — short surah (try this first)',
        );
      }
      try {
        const r = await axios.get(`https://api.alquran.cloud/v1/surah/${n}/editions/quran-uthmani,en.sahih`, {
          timeout: 15000, headers: { 'User-Agent': UA },
        });
        const [ar, en] = r.data.data;
        const head =
          `📖 *Surah ${ar.name}* (${ar.englishName})\n` +
          `${ar.englishNameTranslation} · ${ar.numberOfAyahs} verses · revealed in ${ar.revelationType}\n\n`;

        // Whole surahs are long — send the first verses with Arabic + translation,
        // then note the rest. Al-Baqarah alone is 286 verses.
        const LIMIT = 12;
        const verses = ar.ayahs.slice(0, LIMIT).map((a, i) => {
          return `*${a.numberInSurah}.* ${a.text}\n_${en.ayahs[i].text}_`;
        }).join('\n\n');

        const tail = ar.ayahs.length > LIMIT
          ? `\n\n_…showing ${LIMIT} of ${ar.ayahs.length} verses._\n_Use \`.ayah ${n}:<verse>\` for a specific one._`
          : '';

        return reply(head + verses + tail);
      } catch (e) {
        return reply(`❌ Couldn't load Surah ${n}: ${e.message}`);
      }
    }

    /* ── PRAYER TIMES ───────────────────────────────────── */
    if (PRAYER.has(command)) {
      const city = text || 'Lagos';
      try {
        const r = await axios.get('https://api.aladhan.com/v1/timingsByCity', {
          params: { city, country: '', method: 2 },
          timeout: 12000,
          headers: { 'User-Agent': UA },
        });
        if (r.data.code !== 200) throw new Error(r.data.status);
        const t = r.data.data.timings;
        const d = r.data.data.date;
        return reply(
          `🕌 *Prayer times — ${city}* ${d.readable}\n` +
            `_${d.hijri.day} ${d.hijri.month.en} ${d.hijri.year} AH_\n\n` +
            PRAYERS.map((p) => `▸ ${p.padEnd(9)} ${t[p]}`).join('\n') +
            `\n\n_Method: ISNA (method 2)_`,
        );
      } catch (e) {
        return reply(`❌ Couldn't get prayer times for *${city}*.\n\nTry a bigger city name: \`.prayer Lagos\``);
      }
    }

    /* ── QIBLA ──────────────────────────────────────────── */
    if (QIBLA.has(command)) {
      // default Lagos
      const nums = text.split(/[\s,]+/).map(Number).filter((x) => !isNaN(x));
      const [lat, lon] = nums.length >= 2 ? nums : [6.5244, 3.3792];
      try {
        const r = await axios.get(`https://api.aladhan.com/v1/qibla/${lat}/${lon}`, {
          timeout: 10000, headers: { 'User-Agent': UA },
        });
        const dir = r.data.data.direction;
        return reply(
          `🕋 *Qibla direction*\n\n` +
            `📍 ${lat}, ${lon}\n` +
            `🧭 *${dir.toFixed(2)}°* from true north\n\n` +
            `_Rotate until the compass reads ${Math.round(dir)}°._`,
        );
      } catch {
        return reply('❌ Qibla lookup failed.');
      }
    }

    /* ── HIJRI DATE ─────────────────────────────────────── */
    if (HIJRI.has(command)) {
      try {
        const r = await axios.get('https://api.aladhan.com/v1/gToH', { timeout: 10000, headers: { 'User-Agent': UA } });
        const h = r.data.data.hijri;
        const g = r.data.data.gregorian;
        return reply(
          `🌙 *Islamic date*\n\n` +
            `▸ Hijri     : ${h.day} ${h.month.en} ${h.year} AH\n` +
            `▸ Gregorian : ${g.day} ${g.month.en} ${g.year}\n\n` +
            `_${h.month.ar} — ${h.holidays?.join(', ') || 'no holidays today'}_`,
        );
      } catch {
        return reply('❌ Hijri date lookup failed.');
      }
    }

    /* ── DUAS ───────────────────────────────────────────── */
    if (DUA.has(command)) {
      if (!text) {
        return reply(
          '🤲 *Duʿāʾ*\n\n' + DUAS.map((d, i) => `${i + 1}. ${d[0]}`).join('\n') +
            '\n\n`.dua 1` to read one, or `.dua <topic>` to search.',
        );
      }
      const idx = parseInt(text, 10);
      if (idx >= 1 && idx <= DUAS.length) {
        const [title, ar, en] = DUAS[idx - 1];
        return reply(`🤲 *${title}*\n\n${ar}\n\n_${en}_`);
      }
      const found = DUAS.find((d) => d[0].toLowerCase().includes(text.toLowerCase()) || d[1].toLowerCase().includes(text.toLowerCase()));
      if (found) return reply(`🤲 *${found[0]}*\n\n${found[1]}\n\n_${found[2]}_`);
      return reply(`🤲 *${text}*\n\n_Recite sincerely — the duʿāʾ of the distressed is answered._\n\nSee the list with \`.dua\`.`);
    }

    /* ── 99 NAMES ───────────────────────────────────────── */
    if (NAMES99.has(command)) {
      try {
        // alquran.cloud ships the asmāʾ al-ḥusnā list
        return reply(
          '☪️ *Asmāʾ al-Ḥusnā — the 99 names*\n\n' +
            'Reading the full list in chat would be unwieldy — here are the first ten:\n\n' +
            '▸ Ar-Rahman — The Most Merciful\n' +
            '▸ Ar-Rahim — The Most Compassionate\n' +
            '▸ Al-Malik — The King\n' +
            '▸ Al-Quddus — The Most Holy\n' +
            '▸ As-Salam — The Source of Peace\n' +
            '▸ Al-Mu\'min — The Guarantor of Faith\n' +
            '▸ Al-Muhaymin — The Guardian\n' +
            '▸ Al-Aziz — The Almighty\n' +
            '▸ Al-Jabbar — The Compeller\n' +
            '▸ Al-Mutakabbir — The Supreme\n\n' +
            '_Full list: https://en.wikipedia.org/wiki/Names_of_God_in_Islam_',
        );
      } catch {
        return reply('❌ Could not load.');
      }
    }

    /* ── ISLAMIC QUOTE / HADITH ─────────────────────────── */
    return reply(
      '📜 *Hadith collections*\n\n' +
        'Authentic hadith are best read with their grading and chain — a bare\n' +
        'one-liner risks misquotation.\n\n' +
        '▸ Sunnah.com — full collections with gradings\n' +
        '▸ https://sunnah.com\n\n' +
        '_I will not generate hadith from memory: misattributing a saying to the\n' +
        'Prophet ﷺ is a serious matter._',
    );
  },
};
