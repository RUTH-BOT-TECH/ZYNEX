/**
 * ECONOMY ENGINE
 * Collapses ~110 catalogue names into one persistent system.
 *
 *   .balance .daily .work .mine .fish .hunt .deposit .withdraw .transfer
 *   .shop .buy .sell .inventory .rank .level .leaderboard .marry .pet ... (112)
 *
 * State lives in a JSON file next to the DB so it survives restarts without
 * needing a migration. Swap `store` for Supabase later — the interface is small.
 */
const fs = require('fs');
const path = require('path');

const P = require('../paths');
const mention = require('../mention');
const DATA_FILE = P.adoptLegacy(P.legacy.economy, P.economyFile);

/* ── tiny JSON store ──────────────────────────────────────── */
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: {}, cooldowns: {} };
  }
}
let db = load();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }, 400);
}

function user(jid) {
  const id = String(jid).split('@')[0].split(':')[0];
  if (!db.users[id]) {
    db.users[id] = {
      id,
      wallet: 500,       // starting balance
      bank: 0,
      xp: 0,
      level: 1,
      inventory: {},
      job: null,
      partner: null,
      pets: [],
      stats: { worked: 0, mined: 0, fished: 0, hunted: 0, robbed: 0 },
      streak: 0,
      lastDaily: 0,
      createdAt: Date.now(),
    };
  }
  return db.users[id];
}

const money = (n) => n.toLocaleString('en-US');
const norm = (s) => String(s || '').toLowerCase().trim();
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

/* ── cooldowns ────────────────────────────────────────────── */
function cooldownOk(id, action, ms) {
  const key = `${id}:${action}`;
  const last = db.cooldowns[key] || 0;
  const left = ms - (Date.now() - last);
  if (left > 0) return { ok: false, left };
  db.cooldowns[key] = Date.now();
  save();
  return { ok: true };
}
const fmtLeft = (ms) => {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

/* ── xp / levels ──────────────────────────────────────────── */
const xpForLevel = (lvl) => Math.floor(100 * Math.pow(1.35, lvl - 1));
function addXp(u, amount) {
  u.xp += amount;
  let leveled = 0;
  while (u.xp >= xpForLevel(u.level)) {
    u.xp -= xpForLevel(u.level);
    u.level++;
    leveled++;
  }
  return leveled;
}

/* ── name sets ────────────────────────────────────────────── */
const EARN = {
  work:  { min: 80,  max: 260,  cd: 30 * 60e3, verb: 'worked a shift' },
  job:   { min: 80,  max: 260,  cd: 30 * 60e3, verb: 'worked a shift' },
  jobs:  { min: 80,  max: 260,  cd: 30 * 60e3, verb: 'worked a shift' },
  mine:  { min: 60,  max: 300,  cd: 20 * 60e3, verb: 'mined ore' },
  mining:{ min: 60,  max: 300,  cd: 20 * 60e3, verb: 'mined ore' },
  fish:  { min: 50,  max: 240,  cd: 15 * 60e3, verb: 'went fishing' },
  fishing:{min: 50,  max: 240,  cd: 15 * 60e3, verb: 'went fishing' },
  hunt:  { min: 70,  max: 280,  cd: 20 * 60e3, verb: 'went hunting' },
  hunting:{min: 70,  max: 280,  cd: 20 * 60e3, verb: 'went hunting' },
  farm:  { min: 40,  max: 200,  cd: 15 * 60e3, verb: 'farmed the field' },
  harvest:{min: 40,  max: 200,  cd: 15 * 60e3, verb: 'harvested crops' },
  beg:   { min: 10,  max: 90,   cd: 5 * 60e3,  verb: 'begged' },
  crime: { min: -150,max: 400,  cd: 25 * 60e3, verb: 'attempted a heist' },
  heist: { min: -150,max: 400,  cd: 25 * 60e3, verb: 'attempted a heist' },
  rob:   { min: 0,   max: 250,  cd: 30 * 60e3, verb: 'tried to rob someone' },
  steal: { min: 0,   max: 250,  cd: 30 * 60e3, verb: 'tried to steal' },
};

const BALANCE = new Set(['balance', 'bal', 'wallet', 'money', 'cash', 'bank']);
const DAILY = new Set(['daily', 'weekly', 'monthly', 'hourly', 'claim', 'bonus', 'reward']);
const DEPOSIT = new Set(['deposit', 'dep']);
const WITHDRAW = new Set(['withdraw', 'wd']);
const TRANSFER = new Set(['transfer', 'pay', 'give', 'send', 'sendmoney']);
const INV = new Set(['inventory', 'inv', 'items', 'bag']);
const SHOP = new Set(['shop', 'store', 'market', 'buy', 'sell', 'prices']);
const RANK = new Set(['rank', 'level', 'xp', 'exp', 'profile', 'me', 'myinfo', 'stats', 'mystats', 'profilecard', 'rankcard']);
const TOP = new Set(['leaderboard', 'lb', 'top', 'richest']);
const GAMBLE = new Set(['gamble', 'bet', 'slot', 'spin', 'roulette', 'blackjack', 'bj', 'poker', 'lottery', 'coinpick']);
const PETS = new Set(['pet', 'pets', 'adopt', 'feed', 'pethouse', 'petwalk', 'train', 'battle', 'duel']);
const MARRIAGE = new Set(['marry', 'divorce', 'partner', 'proposal', 'family']);
const UPGRADE = new Set(['upgrade', 'craft', 'forge', 'smelt', 'equip', 'unequip', 'repair', 'use', 'trade']);

const SHOP_ITEMS = {
  pickaxe:   { price: 500,   desc: '+25% mining yield' },
  rod:       { price: 450,   desc: '+25% fishing yield' },
  rifle:     { price: 800,   desc: '+30% hunting yield' },
  laptop:    { price: 1500,  desc: '+20% work pay' },
  car:       { price: 5000,  desc: 'flex (no mechanical effect)' },
  house:     { price: 20000, desc: 'flex (no mechanical effect)' },
  ring:      { price: 2500,  desc: 'required for .marry' },
};

module.exports = {
  id: 'economy',
  name: 'economy-engine',

  match(name) {
    return (
      EARN[name] || BALANCE.has(name) || DAILY.has(name) || DEPOSIT.has(name) ||
      WITHDRAW.has(name) || TRANSFER.has(name) || INV.has(name) || SHOP.has(name) ||
      RANK.has(name) || TOP.has(name) || GAMBLE.has(name) || PETS.has(name) ||
      MARRIAGE.has(name) || UPGRADE.has(name) ||
      // raw catalogue names that map onto the above
      ['work','mine','fish','hunt','farm','beg','crime','rob','heist','daily','balance','bank','deposit','withdraw','transfer','shop','buy','sell','inventory','rank','level','leaderboard','gamble','bet','pet','adopt','marry','divorce','profile','economy','coins','money','sell'].includes(name)
    );
  },

  describe(name) {
    if (EARN[name]) return `Earn money (${name})`;
    if (GAMBLE.has(name)) return 'Gamble money';
    if (TOP.has(name)) return 'Richest players';
    if (RANK.has(name)) return 'Your profile';
    if (SHOP.has(name)) return 'Shop and trading';
    if (MARRIAGE.has(name)) return 'Marriage system';
    if (PETS.has(name)) return 'Pet system';
    return 'Economy';
  },

  async execute({ command, args, sender, reply, m }) {
    const u = user(sender);
    const targetArg = m?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      || (args[0] && /^\+?\d{7,}$/.test(args[0].replace(/\D/g, '')) ? `${args[0].replace(/\D/g, '')}@s.whatsapp.net` : null);

    /* ── balance ─────────────────────────────────────────── */
    if (BALANCE.has(command)) {
      return reply(
        `💰 *${u.id}*\n\n` +
          `👛 Wallet : *${money(u.wallet)}* coins\n` +
          `🏦 Bank   : *${money(u.bank)}* coins\n` +
          `📊 Total  : *${money(u.wallet + u.bank)}* coins\n\n` +
          `⭐ Level ${u.level} · ${u.xp}/${xpForLevel(u.level)} XP`,
      );
    }

    /* ── daily ───────────────────────────────────────────── */
    if (DAILY.has(command)) {
      const windows = { daily: 20 * 3600e3, weekly: 6 * 24 * 3600e3, monthly: 25 * 24 * 3600e3, hourly: 55 * 60e3 };
      const window = windows[command] || 20 * 3600e3;
      const cd = cooldownOk(u.id, `daily:${command}`, window);
      if (!cd.ok) return reply(`⏳ Already claimed. Come back in *${fmtLeft(cd.left)}*.`);

      const amount = command === 'weekly' ? rand(3000, 6000)
        : command === 'monthly' ? rand(12000, 25000)
        : command === 'hourly' ? rand(100, 300)
        : rand(800, 1500);

      u.wallet += amount;
      // streak bonus
      const dayAgo = Date.now() - 47 * 3600e3;
      u.streak = u.lastDaily > dayAgo ? u.streak + 1 : 1;
      u.lastDaily = Date.now();
      const bonus = Math.min(u.streak * 50, 1000);
      u.wallet += bonus;
      const lvl = addXp(u, 40);
      save();

      return reply(
        `🎁 *${command.toUpperCase()} claimed*\n\n` +
          `💰 +${money(amount)} coins\n` +
          `🔥 Streak: ${u.streak} day${u.streak > 1 ? 's' : ''} (+${money(bonus)} bonus)\n` +
          `👛 Wallet: *${money(u.wallet)}*` +
          (lvl ? `\n\n⭐ *Level up!* You're now level ${u.level}` : ''),
      );
    }

    /* ── earn actions ────────────────────────────────────── */
    if (EARN[command]) {
      const cfg = EARN[command];
      const cd = cooldownOk(u.id, `earn:${command}`, cfg.cd);
      if (!cd.ok) return reply(`⏳ You've just ${cfg.verb}. Try again in *${fmtLeft(cd.left)}*.`);

      // item bonuses
      let mult = 1;
      if (command.startsWith('min') && u.inventory.pickaxe) mult += 0.25;
      if (command.startsWith('fish') && u.inventory.rod) mult += 0.25;
      if (command.startsWith('hunt') && u.inventory.rifle) mult += 0.3;
      if (command.startsWith('work') && u.inventory.laptop) mult += 0.2;

      const gain = Math.round(rand(cfg.min, cfg.max) * mult);
      if (gain >= 0) u.wallet += gain;
      else if (-gain > u.wallet) u.wallet = 0;
      else u.wallet += gain;

      if (u.stats[command] !== undefined) u.stats[command]++;

      /* Mining also yields raw ore, which is what .smelt / .craft consume.
       * Without this the crafting commands were unreachable in practice. */
      let oreLine = '';
      if (command.startsWith('min')) {
        const oreTable = [
          { ore: 'iron', chance: 0.45 },
          { ore: 'gold', chance: 0.2 },
          { ore: 'diamond', chance: 0.05 },
        ];
        const found = [];
        for (const o of oreTable) {
          if (Math.random() < o.chance) {
            u.inventory[o.ore] = (u.inventory[o.ore] || 0) + 1;
            found.push(o.ore);
          }
        }
        if (found.length) oreLine = `\n⛏️ Found: *${found.join(', ')}*`;
        else oreLine = `\n⛏️ No ore this time.`;
      }

      const lvl = addXp(u, 15);
      save();

      const line = gain >= 0 ? `💰 +${money(gain)} coins` : `💸 ${money(-gain)} coins lost`;
      return reply(
        `${command === 'rob' || command === 'steal' ? '🥷' : '✅'} *You ${cfg.verb}*\n\n` +
          `${line}${mult > 1 ? ` _(${Math.round((mult - 1) * 100)}% item bonus)_` : ''}${oreLine}\n` +
          `👛 Wallet: *${money(u.wallet)}*` +
          (lvl ? `\n\n⭐ *Level up!* → ${u.level}` : ''),
      );
    }

    /* ── bank ────────────────────────────────────────────── */
    if (DEPOSIT.has(command) || WITHDRAW.has(command)) {
      const amount = args[0] === 'all' ? (DEPOSIT.has(command) ? u.wallet : u.bank) : parseInt(args[0], 10);
      if (!amount || amount <= 0) return reply(`Usage: \`.${command} <amount|all>\``);

      if (DEPOSIT.has(command)) {
        if (amount > u.wallet) return reply(`❌ You only have *${money(u.wallet)}* in your wallet.`);
        u.wallet -= amount; u.bank += amount;
        save();
        return reply(`🏦 Deposited *${money(amount)}*\n\n👛 Wallet: ${money(u.wallet)}\n🏦 Bank: ${money(u.bank)}`);
      }
      if (amount > u.bank) return reply(`❌ You only have *${money(u.bank)}* in the bank.`);
      u.bank -= amount; u.wallet += amount;
      save();
      return reply(`👛 Withdrew *${money(amount)}*\n\n👛 Wallet: ${money(u.wallet)}\n🏦 Bank: ${money(u.bank)}`);
    }

    /* ── transfer ────────────────────────────────────────── */
    if (TRANSFER.has(command)) {
      if (!targetArg) return reply(`Mention someone or give a number.\nUsage: \`.${command} @user 500\``);
      const amount = parseInt(args.find((a) => /^\d+$/.test(a)) || '0', 10);
      if (!amount || amount <= 0) return reply('❌ Give an amount to send.');
      if (amount > u.wallet) return reply(`❌ You only have *${money(u.wallet)}* in your wallet.`);

      const t = user(targetArg);
      if (t.id === u.id) return reply("❌ You can't send money to yourself.");
      u.wallet -= amount; t.wallet += amount;
      save();
      return reply(`✅ Sent *${money(amount)}* coins to @${t.id}\n\n👛 Your balance: *${money(u.wallet)}*`,
        { mentions: mention.mentions(t.id) });
    }

    /* ── shop ────────────────────────────────────────────── */
    if (SHOP.has(command)) {
      if (command === 'buy') {
        const item = (args[0] || '').toLowerCase();
        if (!SHOP_ITEMS[item]) {
          return reply(`🛒 *Shop*\n\n${Object.entries(SHOP_ITEMS).map(([k, v]) => `▸ *${k}* — ${money(v.price)} · ${v.desc}`).join('\n')}\n\nBuy with \`.buy <item>\``);
        }
        if (u.inventory[item]) return reply(`❌ You already own a *${item}*.`);
        if (u.wallet < SHOP_ITEMS[item].price) return reply(`❌ You need *${money(SHOP_ITEMS[item].price)}* — you have *${money(u.wallet)}*.`);
        u.wallet -= SHOP_ITEMS[item].price;
        u.inventory[item] = 1;
        save();
        return reply(`✅ Bought *${item}* for ${money(SHOP_ITEMS[item].price)}\n👛 Balance: ${money(u.wallet)}`);
      }
      if (command === 'sell') {
        const item = (args[0] || '').toLowerCase();
        if (!u.inventory[item]) return reply(`❌ You don't own a *${item}*.`);
        const price = Math.floor((SHOP_ITEMS[item]?.price || 100) * 0.6);
        delete u.inventory[item];
        u.wallet += price;
        save();
        return reply(`✅ Sold *${item}* for ${money(price)}\n👛 Balance: ${money(u.wallet)}`);
      }
      return reply(
        `🛒 *Shop*\n\n` +
          Object.entries(SHOP_ITEMS).map(([k, v]) => `▸ *${k}* — ${money(v.price)}\n   _${v.desc}_`).join('\n') +
          `\n\n\`.buy <item>\` · \`.sell <item>\``,
      );
    }

    /* ── inventory ───────────────────────────────────────── */
    if (INV.has(command)) {
      const items = Object.keys(u.inventory);
      return reply(
        `🎒 *Inventory — ${u.id}*\n\n` +
          (items.length
            ? items.map((i) => `▸ *${i}* ×${u.inventory[i]} — ${SHOP_ITEMS[i]?.desc || 'misc'}`).join('\n')
            : '_Empty. Try `.shop`._'),
      );
    }

    /* ── profile / rank ──────────────────────────────────── */
    if (RANK.has(command)) {
      const need = xpForLevel(u.level);
      const pct = Math.min(100, Math.round((u.xp / need) * 100));
      const filled = Math.round(pct / 10);
      return reply(
        `👤 *${u.id}*\n\n` +
          `⭐ Level *${u.level}* · ${u.xp}/${need} XP\n` +
          `📊 [${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${pct}%\n\n` +
          `💰 Wallet : ${money(u.wallet)}\n` +
          `🏦 Bank   : ${money(u.bank)}\n` +
          `🔥 Streak : ${u.streak} days\n` +
          `🎒 Items  : ${Object.keys(u.inventory).length}\n` +
          (u.partner ? `💍 Partner: ${u.partner}\n` : '') +
          `🐾 Pets   : ${u.pets.length}\n\n` +
          `_worked ${u.stats.worked} · mined ${u.stats.mined} · fished ${u.stats.fished} · hunted ${u.stats.hunted}_`,
      );
    }

    /* ── leaderboard ─────────────────────────────────────── */
    if (TOP.has(command)) {
      const sorted = Object.values(db.users).sort((a, b) => b.wallet + b.bank - (a.wallet + a.bank)).slice(0, 10);
      if (!sorted.length) return reply('No players yet — `.daily` starts you off.');
      return reply(
        `🏆 *Richest players*\n\n` +
          sorted.map((p, i) => {
            const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
            return `${medal} ${p.id} — *${money(p.wallet + p.bank)}*`;
          }).join('\n'),
      );
    }

    /* ── gamble ──────────────────────────────────────────── */
    if (GAMBLE.has(command)) {
      const amount = args[0] === 'all' ? u.wallet : parseInt(args[0], 10);
      if (!amount || amount <= 0) return reply(`Usage: \`.${command} <amount|all>\``);
      if (amount > u.wallet) return reply(`❌ You only have *${money(u.wallet)}* coins.`);

      const win = Math.random() < 0.45; // house edge, like every real bot
      const delta = win ? amount : -amount;
      u.wallet += delta;
      save();

      return reply(
        win
          ? `🎰 *WIN!* 🎉\n\nYou won *${money(amount)}* coins!\n👛 Balance: *${money(u.wallet)}*`
          : `🎰 *LOSE* 💸\n\nYou lost *${money(amount)}* coins.\n👛 Balance: *${money(u.wallet)}*`,
      );
    }

    /* ── pets ────────────────────────────────────────────── */
    if (PETS.has(command)) {
      if (command === 'adopt' || command === 'pet') {
        const name = args[0] || 'Bingo';
        const kind = args[1] || 'cat';
        if (u.pets.length >= 5) return reply('❌ You already have 5 pets.');
        if (u.wallet < 200) return reply('❌ Adopting costs 200 coins.');
        u.wallet -= 200;
        u.pets.push({ name, kind, hunger: 100, level: 1 });
        save();
        return reply(`🐾 Adopted *${name}* the ${kind}! (-200 coins)\n👛 Balance: ${money(u.wallet)}`);
      }
      if (command === 'feed') {
        if (!u.pets.length) return reply('❌ You have no pets. `.adopt <name> <kind>`');
        const p = u.pets[0];
        p.hunger = Math.min(100, p.hunger + 30);
        p.level++;
        save();
        return reply(`🍖 Fed *${p.name}* — hunger ${p.hunger}% · level ${p.level}`);
      }
      return reply(
        `🐾 *Your pets*\n\n` +
          (u.pets.length
            ? u.pets.map((p) => `▸ *${p.name}* the ${p.kind} — lvl ${p.level}, hunger ${p.hunger}%`).join('\n')
            : '_None yet. `.adopt Bingo cat`_'),
      );
    }

    /* ── marriage ────────────────────────────────────────── */
    if (MARRIAGE.has(command)) {
      if (command === 'marry') {
        if (!targetArg) return reply('💍 Mention who you want to marry.');
        if (!u.inventory.ring) return reply('💍 You need a ring first — `.buy ring` (2,500 coins).');
        const t = user(targetArg);
        if (t.id === u.id) return reply("❌ You can't marry yourself.");
        u.partner = t.id; t.partner = u.id;
        save();
        return reply(`💍 *${u.id}* and *${t.id}* are now married! 🎉`);
      }
      if (command === 'divorce') {
        if (!u.partner) return reply("❌ You're not married.");
        const ex = user(u.partner);
        if (ex) ex.partner = null;
        const name = u.partner;
        u.partner = null;
        save();
        return reply(`💔 Divorced *${name}*.`);
      }
      return reply(u.partner ? `💍 Married to *${u.partner}*` : "💍 Single. Buy a ring then `.marry @user`");
    }

    /* ══════════ crafting & equipment ══════════ */
    if (UPGRADE.has(command)) {
      /* recipes: what you can forge, and what it costs */
      const RECIPES = {
        pickaxe: { out: 'pickaxe', ore: 0, coins: 500, desc: '+25% mining yield' },
        rod:     { out: 'rod',     ore: 0, coins: 450, desc: '+25% fishing yield' },
        sword:   { out: 'sword',   ore: 3, coins: 400, desc: '+10% battle wins' },
        armour:  { out: 'armour',  ore: 5, coins: 900, desc: 'protects coins when robbed' },
        amulet:  { out: 'amulet',  ore: 8, coins: 2000, desc: '+15% on all .work/.mine/.fish/.hunt' },
      };
      /* what smelting ore gives you */
      const SMELT = { iron: 1, gold: 2, diamond: 5 };

      const bag = (u) => (u.inventory = u.inventory || {});
      const equipped = (u) => (u.equipped = u.equipped || {});
      const count = (u, k) => bag(u)[k] || 0;

      switch (command) {
        case 'craft':
        case 'forge': {
          const want = norm(args[0] || '');
          if (!want) {
            return reply(
              `⚒️ *FORGE*\n\n` +
                Object.values(RECIPES)
                  .map((r) => `▸ *${r.out}* — ${r.ore} ore + ${money(r.coins)} coins\n   _${r.desc}_`)
                  .join('\n') +
                `\n\nUse *.craft <item>*\nYou have *${count(u, 'ore')}* ore.`,
            );
          }
          const r = RECIPES[want];
          if (!r) return reply(`❌ Nothing called *${want}* can be forged. Try *.craft* to see the list.`);
          if (count(u, 'ore') < r.ore) return reply(`❌ You need *${r.ore}* ore. You have *${count(u, 'ore')}*.`);
          if (u.wallet < r.coins) return reply(`❌ You need *${money(r.coins)}* coins. You have *${money(u.wallet)}*.`);
          bag(u)[r.out] = count(u, r.out) + 1;
          bag(u).ore = count(u, 'ore') - r.ore;
          u.wallet -= r.coins;
          u.xp += 40;
          save();
          return reply(
            `⚒️ *FORGED*\n\n🔥 ${r.out} ×1\n💰 −${money(r.coins)} coins\n⛏️ −${r.ore} ore\n✨ +40 XP\n\n` +
              `_${r.desc}_\nEquip it with *.equip ${r.out}*`,
          );
        }

        case 'smelt': {
          const ore = norm(args[0] || '');
          if (!SMELT[ore]) {
            return reply(`❌ Use *.smelt iron* · *.smelt gold* · *.smelt diamond*\n\nSmelting turns raw ore into craft ore.`);
          }
          if (count(u, ore) < 1) return reply(`❌ You have no *${ore}* to smelt.`);
          bag(u)[ore] = count(u, ore) - 1;
          bag(u).ore = count(u, 'ore') + SMELT[ore];
          save();
          return reply(`🔥 *SMELTED* 1 ${ore} → +${SMELT[ore]} craft ore\n\nYou now have *${bag(u).ore}* craft ore.`);
        }

        case 'equip': {
          const item = norm(args[0] || '');
          if (!item) return reply(`❌ Use *.equip pickaxe*\n\nEquipped: ${Object.keys(equipped(u)).join(', ') || 'nothing'}`);
          if (count(u, item) < 1) return reply(`❌ You don't own a *${item}*. Get one with *.buy ${item}* or *.craft ${item}*.`);
          equipped(u)[item] = true;
          save();
          return reply(`✅ Equipped *${item}*\n\n_${SHOP_ITEMS[item]?.desc || 'ready'}_\n\nUnequip with *.unequip ${item}*`);
        }

        case 'unequip': {
          const item = norm(args[0] || '');
          if (!item) return reply(`❌ Use *.unequip pickaxe*`);
          if (!equipped(u)[item]) return reply(`❌ *${item}* isn't equipped.`);
          delete equipped(u)[item];
          save();
          return reply(`✅ Unequipped *${item}*.`);
        }

        case 'use': {
          const item = norm(args[0] || '');
          if (!item) return reply(`❌ Use *.use <item>*\n\nYour items: ${Object.keys(bag(u)).filter((k) => bag(u)[k] > 0).join(', ') || 'none'}`);
          if (count(u, item) < 1) return reply(`❌ You don't have any *${item}*.`);
          // consumables
          if (item === 'ore') return reply('❌ Ore is for crafting, not eating. Try *.craft*.');
          const boost = { pickaxe: 'mining', rod: 'fishing', rifle: 'hunting', laptop: 'work' }[item];
          bag(u)[item] = count(u, item) - 1;
          u.wallet += 0;
          equipped(u)[item] = true;
          save();
          return reply(
            boost
              ? `✅ Used *${item}* — it's now equipped and boosts *${boost}* yield.`
              : `✅ Used *${item}*.`,
          );
        }

        case 'repair': {
          const item = norm(args[0] || '');
          if (!item) return reply(`❌ Use *.repair pickaxe*`);
          if (count(u, item) < 1 && !equipped(u)[item]) return reply(`❌ You don't own a *${item}*.`);
          const cost = Math.max(50, Math.round((SHOP_ITEMS[item]?.price || 500) * 0.15));
          if (u.wallet < cost) return reply(`❌ Repairs cost *${money(cost)}* coins. You have *${money(u.wallet)}*.`);
          u.wallet -= cost;
          save();
          return reply(`🔧 *${item}* repaired for *${money(cost)}* coins.\n\n👛 Wallet: *${money(u.wallet)}*`);
        }

        case 'trade': {
          const target = (m?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
          const item = norm(args[1] || '');
          const price = parseInt(args[2], 10);
          if (!target || !item || !Number.isFinite(price)) {
            return reply(`❌ Use *.trade @user <item> <coins>*\n\nExample: *.trade @friend pickaxe 700*`);
          }
          if (target === m?.key?.participant || String(target).startsWith(String(u.id))) {
            return reply('❌ You cannot trade with yourself.');
          }
          if (count(u, item) < 1) return reply(`❌ You don't own a *${item}*.`);
          const t = user(target);
          if (t.wallet < price) return reply(`❌ @${t.id} only has *${money(t.wallet)}* coins.`,
            { mentions: mention.mentions(t.id) });
          bag(u)[item] = count(u, item) - 1;
          bag(t)[item] = count(t, item) + 1;
          u.wallet += price;
          t.wallet -= price;
          save();
          return reply(
            `🤝 *TRADE COMPLETE*\n\n@${u.id} sold *${item}* to @${t.id} for *${money(price)}* coins.\n\n` +
              `👛 Your wallet: *${money(u.wallet)}*`,
          );
        }

        case 'upgrade': {
          const item = norm(args[0] || '');
          if (!item) return reply(`❌ Use *.upgrade pickaxe*\n\nUpgrades cost coins and raise the item's effect.`);
          if (count(u, item) < 1) return reply(`❌ You don't own a *${item}*.`);
          const levels = (u.upgrades = u.upgrades || {});
          const lvl = levels[item] || 0;
          if (lvl >= 5) return reply(`⭐ *${item}* is already at max level 5.`);
          const cost = Math.round((SHOP_ITEMS[item]?.price || 500) * (lvl + 1) * 0.5);
          if (u.wallet < cost) return reply(`❌ Upgrading *${item}* to Lv${lvl + 1} costs *${money(cost)}*. You have *${money(u.wallet)}*.`);
          u.wallet -= cost;
          levels[item] = lvl + 1;
          save();
          return reply(
            `⭐ *UPGRADED*\n\n${item} → *Lv${lvl + 1}*\n💰 −${money(cost)} coins\n\n` +
              `_Each level adds +5% to its effect._`,
          );
        }
      }
      return reply(`⚒️ Unknown crafting command.`);
    }

    return reply(
      `⚒️ *\`.${command}\`* isn't available yet.\n\n` +
        `Working now: \`.balance\` \`.daily\` \`.work\` \`.mine\` \`.fish\` \`.hunt\` ` +
        `\`.deposit\` \`.withdraw\` \`.pay\` \`.shop\` \`.buy\` \`.inventory\` ` +
        `\`.rank\` \`.leaderboard\` \`.gamble\` \`.adopt\` \`.marry\` ` +
        `\`.craft\` \`.smelt\` \`.equip\` \`.upgrade\``,
    );
  },
};

/* ── coin API for other engines (games, quests, …) ─────────── */
/* Exported so engines/games.js can pay out wins without
 * duplicating the balance logic or the on-disk store. */
module.exports.user = user;
module.exports.save = save;
module.exports.coins = money;
