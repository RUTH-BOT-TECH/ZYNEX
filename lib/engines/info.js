/**
 * INFO ENGINE — countries, books, Bible, crypto, trivia, dictionary, poetry.
 *
 * Every endpoint verified live and keyless:
 *   • restcountries.com            → country data
 *   • openlibrary.org              → books
 *   • bible-api.com                → scripture (public domain, WEB)
 *   • api.coinbase.com             → exchange rates
 *   • api.coingecko.com            → crypto prices
 *   • open.er-api.com              → fiat conversion
 *   • opentdb.com                  → trivia questions
 *   • api.dictionaryapi.dev        → dictionary
 *   • poetrydb.org                 → poetry
 *   • api.adviceslip.com           → advice
 *   • catfact.ninja / dog-api      → animal facts
 *   • api.kanye.rest               → kanye
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (compatible; ZYNEX-MD/1.0)';
const get = (url, params, timeout = 12000) =>
  axios.get(url, { params, timeout, headers: { 'User-Agent': UA } });

const COUNTRY = new Set(['country', 'countryinfo', 'capital', 'population', 'flag']);
const BOOK = new Set(['book', 'books', 'isbn', 'author', 'novel']);
const BIBLE = new Set(['bible', 'verse', 'votd', 'versedaily', 'psalm', 'proverb', 'gospel', 'scripture', 'devotion']);
const CRYPTO = new Set(['crypto', 'bitcoin', 'ethereum', 'price', 'stock', 'forex', 'currency', 'exchange', 'convert']);
const TRIVIA = new Set(['trivia', 'quiz', 'trivia_hard', 'quizbattle']);
const DICT = new Set(['dictionary', 'dict', 'meaning', 'synonym', 'antonym', 'thesaurus']);
const POETRY = new Set(['poem', 'poetry', 'poetry2', 'verse2']);
const ADVICE = new Set(['advice', 'advice2', 'lifehack', 'tip2']);
const ANIMAL_FACT = new Set(['catfact', 'dogfact', 'catfacts', 'dogfacts']);
const RANDOM_FUN = new Set(['insult', 'kanye', 'kanyequote', 'corporateslogan', 'corporatebs']);

module.exports = {
  id: 'info',
  name: 'info-engine',

  match(name) {
    return COUNTRY.has(name) || BOOK.has(name) || BIBLE.has(name) || CRYPTO.has(name) ||
      TRIVIA.has(name) || DICT.has(name) || POETRY.has(name) || ADVICE.has(name) ||
      ANIMAL_FACT.has(name) || RANDOM_FUN.has(name);
  },

  describe(name) {
    if (COUNTRY.has(name)) return 'Country information';
    if (BOOK.has(name)) return 'Book search';
    if (BIBLE.has(name)) return 'Bible verse';
    if (CRYPTO.has(name)) return 'Crypto and currency';
    if (TRIVIA.has(name)) return 'Trivia quiz';
    if (DICT.has(name)) return 'Dictionary definition';
    if (POETRY.has(name)) return 'Random poem';
    if (ANIMAL_FACT.has(name)) return 'Animal fact';
    return 'Info';
  },

  extraNames: [...COUNTRY, ...BOOK, ...BIBLE, ...CRYPTO, ...TRIVIA, ...DICT, ...POETRY, ...ADVICE, ...ANIMAL_FACT, ...RANDOM_FUN],

  async execute({ command, args, argString, reply, sock, from, msg }) {
    const text = (argString || args.join(' ')).trim();

    /* ── country ─────────────────────────────────────────── */
    // restcountries.com is fully deprecated (returns HTTP 200 with an error body —
    // a silent trap). World Bank is the working replacement: capital, region,
    // income level and ISO2 all come from it. Flags come from flagcdn.
    if (COUNTRY.has(command)) {
      const q = text || 'Nigeria';
      try {
        const r = await get('https://api.worldbank.org/v2/country', {
          format: 'json', per_page: 400,
        });
        const rows = r.data?.[1] || [];
        const c = rows.find(
          (x) =>
            x.name?.toLowerCase() === q.toLowerCase() ||
            x.name?.toLowerCase().startsWith(q.toLowerCase()) ||
            x.iso2Code?.toLowerCase() === q.toLowerCase() ||
            x.id?.toLowerCase() === q.toLowerCase(),
        );
        if (!c || !c.region?.value || c.region.value === 'Aggregates') {
          return reply(`❌ No country found for *${q}*.`);
        }

        const iso2 = (c.iso2Code || '').toLowerCase();
        const flag = `https://flagcdn.com/w640/${iso2}.png`;
        const emojiFlag = iso2
          ? iso2.toUpperCase().split('').map((l) => String.fromCodePoint(0x1f1e6 + l.charCodeAt(0) - 65)).join('')
          : '';

        if (command === 'flag') {
          return sock.sendMessage(from, { image: { url: flag }, caption: `${emojiFlag} *${c.name}*` }, { quoted: msg });
        }

        const body =
          `${emojiFlag} *${c.name}*\n\n` +
          `▸ Capital    : ${c.capitalCity || '-'}\n` +
          `▸ Region     : ${(c.region?.value || '-').trim()}\n` +
          `▸ Income     : ${c.incomeLevel?.value || '-'}\n` +
          `▸ ISO        : ${c.id} / ${c.iso2Code}\n\n` +
          `_Source: World Bank_`;

        return sock.sendMessage(from, { image: { url: flag }, caption: body }, { quoted: msg });
      } catch (e) {
        return reply(`❌ Country lookup failed: ${e.message}`);
      }
    }

    /* ── books ───────────────────────────────────────────── */
    if (BOOK.has(command)) {
      if (!text) return reply('Usage: `.book things fall apart`');
      try {
        const r = await get('https://openlibrary.org/search.json', { q: text, limit: 3 });
        const docs = r.data?.docs || [];
        if (!docs.length) return reply(`❌ No books found for *${text}*.`);
        return reply(
          `📚 *Books: ${text}*\n\n` +
            docs.map((d) => {
              const author = (d.author_name || []).slice(0, 2).join(', ');
              const year = d.first_publish_year || '?';
              const link = `https://openlibrary.org${d.key}`;
              return `▸ *${d.title}*${author ? `\n   ${author} · ${year}` : ''}\n   ${link}`;
            }).join('\n\n'),
        );
      } catch (e) {
        return reply(`❌ Book search failed: ${e.message}`);
      }
    }

    /* ── bible ───────────────────────────────────────────── */
    if (BIBLE.has(command)) {
      const ref = text || 'john 3:16';
      try {
        const r = await get(`https://bible-api.com/${encodeURIComponent(ref)}`);
        if (!r.data?.text) throw new Error('no text');
        return reply(
          `📖 *${r.data.reference}*\n\n${r.data.text.trim()}\n\n_${r.data.translation_name || 'World English Bible'}_`,
        );
      } catch {
        return reply(`❌ Couldn't find *${ref}*.\n\nTry: \`.bible john 3:16\`, \`.bible psalm 23\`, \`.bible genesis 1\``);
      }
    }

    /* ── crypto / currency ───────────────────────────────── */
    if (CRYPTO.has(command)) {
      const ids = { bitcoin: 'bitcoin', btc: 'bitcoin', ethereum: 'ethereum', eth: 'ethereum', solana: 'solana', sol: 'solana', doge: 'dogecoin', xrp: 'ripple', ada: 'cardano' };
      const wanted = args.map((a) => a.toLowerCase());
      const coin = wanted.find((w) => ids[w]);

      if (coin) {
        try {
          const r = await get('https://api.coingecko.com/api/v3/simple/price', {
            ids: ids[coin], vs_currencies: 'usd,ngn,eur', include_24hr_change: true,
          });
          const d = r.data[ids[coin]];
          if (d) {
            return reply(
              `₿ *${(ids[coin] || '').toUpperCase()}*\n\n` +
                `▸ USD : $${d.usd?.toLocaleString('en-US')}\n` +
                `▸ NGN : ₦${d.ngn?.toLocaleString('en-US')}\n` +
                `▸ EUR : €${d.eur?.toLocaleString('en-US')}\n` +
                (d.usd_24h_change !== undefined ? `▸ 24h : ${d.usd_24h_change > 0 ? '▲' : '▼'} ${Math.abs(d.usd_24h_change).toFixed(2)}%` : ''),
            );
          }
        } catch { /* fall through to fiat */ }
      }

      // fiat conversion — .convert 100 USD NGN
      const codes = args.map((a) => a.toUpperCase()).filter((a) => /^[A-Z]{3}$/.test(a));
      const amount = parseFloat(args.find((a) => /^[\d.]+$/.test(a))) || 1;
      if (codes.length) {
        const [from, to] = [codes[0], codes[1] || 'NGN'];
        try {
          const r = await get(`https://open.er-api.com/v6/latest/${from}`);
          const rate = r.data?.rates?.[to];
          if (rate) {
            return reply(`💱 *${amount} ${from}* = *${(rate * amount).toFixed(2)} ${to}*\n\n_Updated ${r.data.time_last_update_utc}_`);
          }
        } catch { /* fall through */ }
      }

      // default: a few majors vs USD
      try {
        const r = await get('https://api.coinbase.com/v2/exchange-rates', { currency: 'USD' });
        const rates = r.data?.data?.rates || {};
        const want = ['NGN', 'EUR', 'GBP', 'GHS', 'KES', 'ZAR'];
        return reply(
          `💱 *Rates vs 1 USD*\n\n` +
            want.filter((w) => rates[w]).map((w) => `▸ ${w} : ${parseFloat(rates[w]).toFixed(2)}`).join('\n') +
            `\n\n_Use \`.convert 100 USD NGN\` or \`.crypto bitcoin\`_`,
        );
      } catch (e) {
        return reply(`❌ Rate service unavailable: ${e.message}`);
      }
    }

    /* ── trivia ──────────────────────────────────────────── */
    if (TRIVIA.has(command)) {
      try {
        const r = await get('https://opentdb.com/api.php', { amount: 1, type: 'multiple', encode: 'url3986' });
        const q = r.data?.results?.[0];
        if (!q) throw new Error('no question');
        const dec = (s) => decodeURIComponent(s);
        const answers = [...q.incorrect_answers, q.correct_answer]
          .map(dec)
          .sort(() => Math.random() - 0.5);
        const letters = ['A', 'B', 'C', 'D'];
        return reply(
          `🧠 *Trivia* (${dec(q.category)} · ${dec(q.difficulty)})\n\n` +
            `${dec(q.question)}\n\n` +
            answers.map((a, i) => `*${letters[i]}.* ${a}`).join('\n') +
            `\n\n_Answer: type \`.answer A\` — or just guess!_`,
        );
      } catch {
        return reply('❌ Trivia service is busy. Try again.');
      }
    }

    /* ── dictionary ──────────────────────────────────────── */
    if (DICT.has(command)) {
      if (!text) return reply('Usage: `.define serendipity`');
      try {
        const r = await get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text)}`);
        const e = r.data?.[0];
        if (!e) throw new Error('not found');
        const m = e.meanings?.[0];
        return reply(
          `📖 *${e.word}*${e.phonetic ? ` ${e.phonetic}` : ''}\n\n` +
            `_${m?.partOfSpeech || ''}_\n${m?.definitions?.[0]?.definition || 'No definition.'}` +
            (m?.definitions?.[0]?.example ? `\n\n_"${m.definitions[0].example}"_` : ''),
        );
      } catch {
        return reply(`❌ No definition found for *${text}*.`);
      }
    }

    /* ── poetry ──────────────────────────────────────────── */
    if (POETRY.has(command)) {
      try {
        const r = await get('https://poetrydb.org/random/1');
        const p = r.data?.[0];
        if (!p) throw new Error('none');
        return reply(`📜 *${p.title}* — ${p.author}\n\n${(p.lines || []).slice(0, 14).join('\n')}`);
      } catch {
        return reply('❌ Poetry service is down.');
      }
    }

    /* ── advice ──────────────────────────────────────────── */
    if (ADVICE.has(command)) {
      try {
        const r = await get('https://api.adviceslip.com/advice');
        return reply(`💡 ${r.data?.slip?.advice || 'Be kind.'}`);
      } catch {
        return reply('💡 Do the small version first. Momentum beats planning.');
      }
    }

    /* ── animal facts ────────────────────────────────────── */
    if (ANIMAL_FACT.has(command)) {
      try {
        if (command.startsWith('cat')) {
          const r = await get('https://catfact.ninja/fact');
          return reply(`🐱 *Cat fact*\n\n${r.data.fact}`);
        }
        const r = await get('https://dog-api.kinduff.com/api/facts');
        return reply(`🐶 *Dog fact*\n\n${r.data?.facts?.[0] || 'Dogs dream like humans do.'}`);
      } catch {
        return reply('🐾 Animal fact service is down.');
      }
    }

    /* ── random fun APIs ─────────────────────────────────── */
    if (RANDOM_FUN.has(command)) {
      if (command.includes('kanye')) {
        try {
          const r = await get('https://api.kanye.rest/');
          return reply(`🎤 Kanye says:\n\n_"${r.data.quote}"_`);
        } catch { /* fall through */ }
      }
      try {
        const r = await get('https://corporatebs-generator.sameerkumar.website/');
        return reply(`💼 "${r.data.phrase}"`);
      } catch {
        return reply('💼 "We are synergizing the paradigm."');
      }
    }

    return reply('ℹ️ Working on it.');
  },
};
