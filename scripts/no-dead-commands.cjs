// For every claimed name, call the engine and see if it lands on the generic
// "Working on it" fallback. Those are effectively dead commands.
const r = require('../lib/registry');
const engines = {
  tools: require('../lib/engines/tools'),
  info: require('../lib/engines/info'),
  fun: require('../lib/engines/fun'),
  economy: require('../lib/engines/economy'),
  group: require('../lib/engines/group'),
  text: require('../lib/engines/text'),
  islamic: require('../lib/engines/islamic'),
  reactions: require('../lib/engines/reactions'),
};
const dead = {};
(async () => {
  for (const [name, eng] of Object.entries(engines)) {
    const claimed = r.ALL_NAMES.filter((n) => eng.match && eng.match(n));
    const hits = [];
    for (const cmd of claimed) {
      let out = '';
      const ctx = {
        command: cmd, args: ['test'], from: '120363d@g.us', sender: '2348111000001@s.whatsapp.net',
        msg: { key: {}, message: {} }, prefix: '.',
        sock: { sendMessage: async () => ({}), groupMetadata: async () => ({ participants: [] }) },
        reply: async (t) => { out = String(t); return {}; },
        download: async () => Buffer.from('x'),
      };
      try { await eng.execute(ctx); } catch (e) { hits.push([cmd, 'CRASH: ' + e.message.slice(0, 50)]); continue; }
      if (/Working on it|isn't available yet/i.test(out)) hits.push([cmd, 'fallback']);
    }
    dead[name] = hits;
  }
  let total = 0;
  for (const [n, h] of Object.entries(dead)) {
    if (h.length) {
      total += h.length;
      console.log(`\n${n}: ${h.length} dead`);
      h.forEach(([c, why]) => console.log(`   ${c}  (${why})`));
    }
  }
  const crashed = Object.values(dead).flat().filter(([, w]) => w.startsWith('CRASH'));
  console.log(`\nTOTAL dead/fallback commands: ${total}`);
  if (total === 0) {
    console.log('\x1b[32m✔ every implemented command produces a real answer\x1b[0m');
    process.exit(0);
  }
  console.log(`\x1b[31m✗ ${total} command(s) still return a placeholder or crash\x1b[0m`);
  process.exit(1);
})();
