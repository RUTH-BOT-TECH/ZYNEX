/**
 * FUN ENGINE — jokes, quotes, facts, 8ball, truth/dare, actions, love math.
 * Collapses ~150 catalogue names. Everything is local except a couple of
 * keyless APIs that still work.
 */
const axios = require('axios');

const UA = 'Mozilla/5.0 (compatible; ZYNEX-MD/1.0)';

const JOKES = [
  "Why don't programmers like nature? It has too many bugs.",
  'A SQL query walks into a bar, sees two tables and asks: “Can I join you?”',
  'There are 10 types of people: those who understand binary and those who don’t.',
  'I told my computer I needed a break — now it won’t stop sending me KitKat ads.',
  'Why did the developer go broke? Because he used up all his cache.',
  'Debugging: being the detective in a crime movie where you are also the murderer.',
];
const DARKJOKES = [
  'My wallet is like an onion — opening it makes me cry.',
  'I have a joke about time travel, but you didn’t like it.',
  'I’m on a seafood diet. I see food and I eat it.',
];
const QUOTES = [
  ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Chinese Proverb'],
  ['Success is not final, failure is not fatal: it is the courage to continue that counts.', 'Winston Churchill'],
  ['Pleasure can be supported by an illusion; but happiness rests upon truth.', 'Nicolas Chamfort'],
  ['Do not wait to strike till the iron is hot; but make it hot by striking.', 'William Butler Yeats'],
];
const FACTS = [
  'Honey never spoils — 3,000-year-old jars are still edible.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than its year.',
  'Bananas are berries, but strawberries are not.',
  'The first computer bug was a literal moth.',
];
const TRUTHS = [
  'What’s the last lie you told?', 'Who in this group do you trust least?',
  'What’s your most embarrassing search history?', 'Have you ever ghosted someone?',
  'What’s the biggest secret you’re keeping right now?',
];
const DARES = [
  'Send the 5th photo in your gallery.', 'Voice note the last thing you ate.',
  'Type your name with your eyes closed.', 'Message the 3rd person in your chats "hi".',
  'Change your status to "I lost a dare".',
];
const ROASTS = [
  'You bring everyone so much joy… when you leave the room.',
  'You’re not stupid, you just have bad luck when thinking.',
  'I’d agree with you, but then we’d both be wrong.',
  'Your secrets are safe with me — I wasn’t even listening.',
];
const COMPLIMENTS = [
  'You light up the chat more than the typing indicator does.',
  'Your energy is the kind people screenshot and send to friends.',
  'You’re the plot twist every group needed.',
  'Honestly? You make competence look easy.',
];
const PICKUPLINES = [
  'Are you a magician? Every time I look at you, everyone else disappears.',
  'Do you have a map? I keep getting lost in your replies.',
  'If you were a WiFi signal, you’d be full bars everywhere.',
];
const EIGHTBALL = [
  'It is certain.', 'Without a doubt.', 'Yes — definitely.', 'Most likely.',
  'Reply hazy, try again.', 'Cannot predict now.', 'Don’t count on it.',
  'My reply is no.', 'Very doubtful.', 'You may rely on it.',
];
const ADVICE = [
  'Sleep on it. Seriously — decisions made at 2am are rarely the ones you keep.',
  'The answer is usually the thing you’re avoiding.',
  'Do the small version first. Momentum beats planning.',
  'If you have to ask twice, you already know.',
];
const FORTUNES = [
  'A pleasant surprise arrives from an unexpected direction.',
  'The thing you are worried about will resolve faster than you expect.',
  'Someone you have not heard from will reach out this week.',
  'You will soon be offered a choice that seems hard but isn’t.',
];

// NOTE: anime GIF reactions (.hug .kiss .slap ...) live in engines/reactions.js.
// They are deliberately NOT handled here — one owner per command name.

const JOKE = new Set(['joke', 'dadjoke', 'darkjoke', 'pun', 'jokeoverhead']);
const QUOTE = new Set(['quote', 'motivate', 'inspire', 'lovequote', 'motivation', 'quote2', 'quotegen']);
const FACT = new Set(['fact', 'funfact', 'numberfact', 'fact2']);
const TRUTHDARE = new Set(['truth', 'dare', 'truthordare', 'tod']);
const EIGHT = new Set(['8ball', 'magic8', 'fortune', '8ball2']);
const ROAST = new Set(['roast', 'insult_gen', 'yomama', 'burn']);
const COMPLIMENT = new Set(['compliment', 'flirt', 'pickup', 'pickupline', 'motivate2']);
const RATE = new Set(['rate', 'beauty', 'handsome', 'cute', 'pretty', 'gay', 'lesbian', 'simp', 'sus', 'drunk', 'stupid', 'smart', 'genius', 'iq', 'cool', 'ugly', 'horny', 'beautiful', 'beautiful2', 'handsome2']);
const LOVE = new Set(['ship', 'love', 'lovemeter', 'match', 'compatible', 'compatibility', 'crush', 'friendzone', 'relationship', 'partner2']);
const PICK = new Set(['choose', 'pick', 'decide', 'random', 'random_pick', 'dicepick', 'shuffle_text']);

module.exports = {
  id: 'fun',
  name: 'fun-engine',

  match(name) {
    return (
      JOKE.has(name) || QUOTE.has(name) || FACT.has(name) || TRUTHDARE.has(name) ||
      EIGHT.has(name) || ROAST.has(name) || COMPLIMENT.has(name) || RATE.has(name) ||
      LOVE.has(name) || PICK.has(name)
    );
  },

  describe(name) {
    if (JOKE.has(name)) return 'Random joke';
    if (QUOTE.has(name)) return 'Inspirational quote';
    if (FACT.has(name)) return 'Random fact';
    if (TRUTHDARE.has(name)) return 'Truth or dare';
    if (EIGHT.has(name)) return 'Magic 8-ball';
    if (ROAST.has(name)) return 'Roast someone';
    if (LOVE.has(name)) return 'Love calculator';
    if (RATE.has(name)) return 'Rate someone';
    return 'Fun';
  },

  async execute({ command, args, reply, sender, m, sock, from }) {
    const target = m?.message?.extendedTextMessage?.contextInfo?.participant
      || m?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      || null;
    const who = target ? `@${String(target).split('@')[0]}` : 'you';
    const text = args.join(' ').trim();
    const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

    /* ── jokes ──────────────────────────────────────────── */
    if (JOKE.has(command)) {
      // try a live API, fall back to the built-in pool
      try {
        if (command === 'dadjoke') {
          const r = await axios.get('https://icanhazdadjoke.com/', {
            headers: { Accept: 'application/json', 'User-Agent': UA }, timeout: 7000,
          });
          return reply(`😂 ${r.data.joke}`);
        }
        const r = await axios.get('https://v2.jokeapi.dev/joke/Any?type=single&safe-mode', { timeout: 7000 });
        if (r.data?.joke) return reply(`😂 ${r.data.joke}`);
      } catch { /* fall through */ }
      return reply(`😂 ${pickOne(command === 'darkjoke' ? DARKJOKES : JOKES)}`);
    }

    /* ── quotes ─────────────────────────────────────────── */
    if (QUOTE.has(command)) {
      try {
        const r = await axios.get('https://zenquotes.io/api/random', { timeout: 7000 });
        const d = Array.isArray(r.data) ? r.data[0] : null;
        if (d?.q) return reply(`💬 *"${d.q}"*\n\n— *${d.a}*`);
      } catch { /* fall through */ }
      const [q, a] = pickOne(QUOTES);
      return reply(`💬 *"${q}"*\n\n— *${a}*`);
    }

    /* ── facts ──────────────────────────────────────────── */
    if (FACT.has(command)) {
      try {
        const r = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', { timeout: 7000 });
        if (r.data?.text) return reply(`📌 *Did you know?*\n\n${r.data.text}`);
      } catch { /* fall through */ }
      return reply(`📌 *Did you know?*\n\n${pickOne(FACTS)}`);
    }

    /* ── truth / dare ───────────────────────────────────── */
    if (TRUTHDARE.has(command)) {
      if (command === 'truth') return reply(`💭 *TRUTH*\n\n${pickOne(TRUTHS)}`);
      if (command === 'dare') return reply(`🔥 *DARE*\n\n${pickOne(DARES)}`);
      return reply(`🎲 *TRUTH OR DARE*\n\nYou got: *${Math.random() < 0.5 ? 'TRUTH' : 'DARE'}*\n\n${
        Math.random() < 0.5 ? pickOne(TRUTHS) : pickOne(DARES)}`);
    }

    /* ── 8ball ──────────────────────────────────────────── */
    if (EIGHT.has(command)) {
      if (!text) return reply('🎱 Ask a yes/no question.');
      const answer = pickOne(EIGHTBALL);
      return reply(`🎱 *Magic 8-Ball*\n\n❓ ${text}\n\n🔮 ${answer}`);
    }

    /* ── roast / compliment ─────────────────────────────── */
    if (ROAST.has(command)) {
      return reply(`🔥 ${who} — ${pickOne(ROASTS)}`);
    }
    if (COMPLIMENT.has(command)) {
      return reply(`💚 ${who} — ${pickOne(COMPLIMENTS)}`);
    }

    /* ── rate ───────────────────────────────────────────── */
    if (RATE.has(command)) {
      // deterministic per person so it doesn't change every message
      const seed = String(target || sender).split('@')[0];
      let h = 0;
      for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 101;
      const score = (h % 60) + 40; // 40–99
      return reply(`📊 *${command.toUpperCase()}*\n\n${who}: *${score}/100*\n${'█'.repeat(Math.round(score / 10))}${'░'.repeat(10 - Math.round(score / 10))}`);
    }

    /* ── love calculator ────────────────────────────────── */
    if (LOVE.has(command)) {
      if (!target) return reply('💘 Mention someone or `.ship name1 name2`');
      const pair = [sender, target].map((x) => String(x).split('@')[0]).sort().join('+');
      let h = 0;
      for (const c of pair) h = (h * 17 + c.charCodeAt(0)) % 101;
      const pct = h % 101;
      const verdict = pct > 85 ? 'Soulmates 💍' : pct > 65 ? 'Strong match 💕' : pct > 40 ? 'Worth a shot 😊' : pct > 20 ? 'Just friends 🫂' : 'Run. 🏃';
      return reply(
        `💘 *Love Calculator*\n\n` +
          `${String(sender).split('@')[0]} ❤️ ${String(target).split('@')[0]}\n\n` +
          `*${pct}%* — ${verdict}\n` +
          `${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}`,
      );
    }

    /* ── pick / choose ──────────────────────────────────── */
    if (PICK.has(command)) {
      if (command === 'random' && !text) return reply(`🎲 ${Math.floor(Math.random() * 100) + 1}`);
      const opts = text.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) return reply(`Usage: \`.${command} option1, option2, ...\``);
      return reply(`🎯 I choose: *${pickOne(opts)}*`);
    }

    return reply('🎮 Working on it.');
  },
};
