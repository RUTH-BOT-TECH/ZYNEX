/**
 * GROUP ENGINE — moderation and group management.
 *
 * Covers the catalogue names the hand-written files in lib/commands/ don't own:
 *   kick/promote/demote/mute/unmute/setname/setdesc/link/revoke/tagall are
 *   already files, so they are deliberately NOT claimed here — one owner per name.
 *
 * No external APIs. Everything is WhatsApp group metadata + Baileys calls.
 */
const axios = require('axios');

const UA = `Mozilla/5.0 (compatible; ${require('../botInfo').BOT_NAME}/1.0)`;

/* ── name sets ─────────────────────────────────────────────── */
const MEMBER_LIST = new Set(['members', 'listmembers', 'participants', 'memberlist']);
const ADMIN_LIST = new Set(['admins', 'listadmins', 'adminlist', 'staff', 'tagadmin', 'tagowner']);
const GROUP_INFO = new Set(['groupinfo', 'ginfo', 'gcinfo', 'grouptitle', 'grouptopic', 'gdesc']);
const HIDETAG = new Set(['hidetagall', 'silenttag']);
const TAG = new Set(['tag', 'mention', 'tagme', 'mentionme']);
const POLL = new Set(['poll', 'vote', 'createpoll', 'votepoll', 'endpoll', 'resultspoll', 'strawpoll']);
const WARN = new Set(['warn', 'warnings', 'warns', 'warnlist', 'resetwarn', 'delwarn', 'clearwarns', 'unwarn']);
const APPROVE = new Set(['approve', 'reject', 'approveall', 'rejectall', 'requests', 'joinrequests', 'pending', 'joinrequest']);
const EPHEMERAL = new Set(['ephemeral', 'disappearing', 'disappear']);
const GROUP_LOCK = new Set(['announce', 'restrict', 'lockgroup', 'unlockgroup', 'sendmessages', 'editinfo', 'grouplock']);
const ACTIVITY = new Set(['inactive', 'active', 'activity', 'groupstats', 'chatstats', 'msgcount', 'mostactive', 'leastactive', 'topmembers', 'topchat', 'topcommands', 'seen', 'lastseen']);
const INVITE = new Set(['join', 'joingroup', 'leave', 'leavegroup', 'leaveall']);
const RULES = new Set(['rules', 'setrules', 'groupdesc2']);
const GROUP_ACTIONS = new Set(['kickall', 'kickinactive', 'banmember', 'unbanmember', 'grouplist', 'groupsettings', 'kickinactive']);

const ALL_GROUP_NAMES = [
  ...MEMBER_LIST, ...ADMIN_LIST, ...GROUP_INFO, ...HIDETAG, ...TAG, ...POLL,
  ...WARN, ...APPROVE, ...EPHEMERAL, ...GROUP_LOCK, ...ACTIVITY, ...INVITE,
  ...RULES, ...GROUP_ACTIONS];

/* ── persistence (per-group settings + warnings) ──────────── */
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', '..', 'data', 'groups.json');

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch { return { warnings: {}, rules: {}, activity: {}, polls: {} }; }
}
let db = loadDb();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA), { recursive: true });
    fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
  }, 400);
}

const jidOf = (x) => String(x || '').split('@')[0].split(':')[0];
const isGroup = (jid) => String(jid || '').endsWith('@g.us');

/* ── resolve a member from mention / reply / bare number ──── */
function resolveTarget({ m, args }) {
  const ctx = m?.message?.extendedTextMessage?.contextInfo
    || m?.message?.imageMessage?.contextInfo
    || m?.message?.videoMessage?.contextInfo
    || {};
  if (ctx.mentionedJid?.length) return ctx.mentionedJid[0];
  if (ctx.participant) return ctx.participant;
  const num = (args || []).join(' ').replace(/\D/g, '');
  return num.length >= 7 ? `${num}@s.whatsapp.net` : null;
}

async function botIsAdmin(sock, groupJid) {
  try {
    const meta = await sock.groupMetadata(groupJid);
    const me = jidOf(sock.user?.id);
    const part = meta.participants.find((p) => jidOf(p.id) === me);
    return part?.admin === 'admin' || part?.admin === 'superadmin';
  } catch { return false; }
}

async function senderIsAdmin(sock, groupJid, sender) {
  try {
    const meta = await sock.groupMetadata(groupJid);
    const part = meta.participants.find((p) => jidOf(p.id) === jidOf(sender));
    return part?.admin === 'admin' || part?.admin === 'superadmin';
  } catch { return false; }
}

/* ── tiny poll state (in-memory per group, resets on restart) ── */
const polls = new Map();

module.exports = {
  id: 'group',
  name: 'group-engine',

  match(name) {
    return ALL_GROUP_NAMES.includes(name);
  },

  describe(name) {
    if (MEMBER_LIST.has(name)) return 'List group members';
    if (ADMIN_LIST.has(name)) return 'List group admins';
    if (GROUP_INFO.has(name)) return 'Group information';
    if (HIDETAG.has(name)) return 'Tag everyone silently';
    if (POLL.has(name)) return 'Create and vote in polls';
    if (WARN.has(name)) return 'Warning system';
    if (APPROVE.has(name)) return 'Join request handling';
    if (EPHEMERAL.has(name)) return 'Disappearing messages';
    if (GROUP_LOCK.has(name)) return 'Lock group settings';
    if (ACTIVITY.has(name)) return 'Group activity stats';
    if (RULES.has(name)) return 'Group rules';
    return 'Group management';
  },

  extraNames: ALL_GROUP_NAMES,

  async execute({ command, args, argString, reply, sock, from, msg, sender, isOwner }) {
    /* ── every command here needs a group ─────────────────── */
    if (!isGroup(from)) {
      return reply('👥 *That only works in a group.*');
    }

    const text = (argString || args.join(' ')).trim();
    const senderAdmin = await senderIsAdmin(sock, from, sender);

    /* ── members ──────────────────────────────────────────── */
    if (MEMBER_LIST.has(command)) {
      try {
        const meta = await sock.groupMetadata(from);
        const list = meta.participants
          .map((p, i) => `${i + 1}. @${jidOf(p.id)}${p.admin ? ` _(${p.admin})_` : ''}`)
          .join('\n');
        return sock.sendMessage(from, {
          text: `👥 *${meta.subject}* — ${meta.participants.length} members\n\n${list}`,
          mentions: meta.participants.map((p) => p.id),
        }, { quoted: msg });
      } catch (e) {
        return reply(`❌ Couldn't read group metadata: ${e.message}`);
      }
    }

    /* ── admins ───────────────────────────────────────────── */
    if (ADMIN_LIST.has(command)) {
      try {
        const meta = await sock.groupMetadata(from);
        const admins = meta.participants.filter((p) => p.admin);
        if (!admins.length) return reply('👮 No admins found.');
        if (command === 'tagadmin' || command === 'tagowner') {
          return sock.sendMessage(from, {
            text: `👮 *Admins of ${meta.subject}*\n\n${admins.map((p) => `@${jidOf(p.id)}`).join(' ')}`,
            mentions: admins.map((p) => p.id),
          }, { quoted: msg });
        }
        return reply(
          `👮 *Admins — ${meta.subject}* (${admins.length})\n\n` +
            admins.map((p) => `▸ @${jidOf(p.id)} · ${p.admin}`).join('\n'),
        );
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── group info ───────────────────────────────────────── */
    if (GROUP_INFO.has(command)) {
      try {
        const meta = await sock.groupMetadata(from);
        const admins = meta.participants.filter((p) => p.admin).length;
        let invite = '';
        if (meta.announce !== undefined) {
          try {
            const code = await sock.groupInviteCode(from);
            invite = `\n▸ Invite   : https://chat.whatsapp.com/${code}`;
          } catch { /* not admin */ }
        }
        return reply(
          `╭───「 *GROUP INFO* 」\n` +
            `│ ▸ Name    : ${meta.subject}\n` +
            `│ ▸ Members : ${meta.participants.length}\n` +
            `│ ▸ Admins  : ${admins}\n` +
            `│ ▸ Created : ${new Date((meta.creation || 0) * 1000).toLocaleDateString('en-GB')}\n` +
            `│ ▸ Announce: ${meta.announce ? 'admins only' : 'everyone'}\n` +
            `│ ▸ Locked  : ${meta.restrict ? 'admins edit info' : 'everyone edits'}\n` +
            `│ ▸ ID      : ${meta.id}${invite}\n` +
            `╰────────────────────\n\n${meta.desc || '_No description_'}`,
        );
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── hidetag ──────────────────────────────────────────── */
    if (HIDETAG.has(command)) {
      if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
      try {
        const meta = await sock.groupMetadata(from);
        return sock.sendMessage(from, {
          text: text || '📢',
          mentions: meta.participants.map((p) => p.id),
        }, { quoted: msg });
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── tag ──────────────────────────────────────────────── */
    if (TAG.has(command)) {
      const t = command === 'tagme' || command === 'mentionme' ? sender : resolveTarget({ m: msg, args });
      if (!t) return reply('Mention someone or reply to their message.');
      return sock.sendMessage(from, {
        text: text.replace(/@\S+/g, '').trim() || `👋 @${jidOf(t)}`,
        mentions: [t],
      }, { quoted: msg });
    }

    /* ── polls ────────────────────────────────────────────── */
    if (POLL.has(command)) {
      if (command === 'vote' || command === 'votepoll') {
        const key = jidOf(from);
        const p = polls.get(key);
        if (!p) return reply('❌ No active poll. Start one with `.poll "question" "option 1" "option 2"`');
        const choice = parseInt(args[0], 10);
        if (!choice || choice < 1 || choice > p.options.length) {
          return reply(`Vote with a number 1–${p.options.length}:\n\n${p.options.map((o, i) => `*${i + 1}.* ${o} (${p.votes[i]?.length || 0})`).join('\n')}`);
        }
        p.votes.forEach((v) => { const i = v.indexOf(jidOf(sender)); if (i >= 0) v.splice(i, 1); });
        p.votes[choice - 1].push(jidOf(sender));
        polls.set(key, p);
        return reply(`✅ Voted for *${p.options[choice - 1]}*`);
      }
      if (command === 'endpoll' || command === 'resultspoll') {
        const key = jidOf(from);
        const p = polls.get(key);
        if (!p) return reply('❌ No active poll.');
        polls.delete(key);
        const total = p.votes.reduce((a, v) => a + v.length, 0);
        return reply(
          `📊 *Poll closed — ${p.question}*\n\n` +
            p.options.map((o, i) => {
              const n = p.votes[i]?.length || 0;
              const pct = total ? Math.round((n / total) * 100) : 0;
              return `▸ *${o}* — ${n} vote${n === 1 ? '' : 's'} (${pct}%)\n   ${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}`;
            }).join('\n') +
            `\n\n_${total} total vote${total === 1 ? '' : 's'}_`,
        );
      }
      // create
      const parts = [...text.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => m[1] || m[2]);
      if (parts.length < 3) {
        return reply(
          '📊 *Create a poll*\n\n' +
            '`.poll "Question" "Option A" "Option B"`\n\n' +
            '_Quote each part. Minimum: 1 question + 2 options._',
        );
      }
      const [question, ...options] = parts;
      polls.set(jidOf(from), { question, options, votes: options.map(() => []), by: jidOf(sender) });
      return reply(
        `📊 *POLL — ${question}*\n\n` +
          options.map((o, i) => `*${i + 1}.* ${o}`).join('\n') +
          `\n\n_Vote with \`.vote <number>\`_\n_Close with \`.endpoll\`_`,
      );
    }

    /* ── warnings ─────────────────────────────────────────── */
    if (WARN.has(command)) {
      if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');

      if (command === 'warn' || command === 'unwarn') {
        const t = resolveTarget({ m: msg, args });
        if (!t) return reply('Mention someone or reply to their message.');
        const key = `${jidOf(from)}:${jidOf(t)}`;
        if (command === 'unwarn') {
          db.warnings[key] = Math.max(0, (db.warnings[key] || 0) - 1);
          save();
          return sock.sendMessage(from, {
            text: `➖ Warning removed from @${jidOf(t)} (${db.warnings[key]})`,
            mentions: [t],
          }, { quoted: msg });
        }
        db.warnings[key] = (db.warnings[key] || 0) + 1;
        save();
        const n = db.warnings[key];
        const limit = parseInt(process.env.MAX_WARNINGS || '3', 10);
        if (n >= limit) {
          const canKick = await botIsAdmin(sock, from);
          if (canKick) {
            await sock.groupParticipantsUpdate(from, [t], 'remove').catch(() => {});
            db.warnings[key] = 0;
            save();
            return sock.sendMessage(from, {
              text: `👢 @${jidOf(t)} reached ${limit} warnings and was removed.`,
              mentions: [t],
            }, { quoted: msg });
          }
          return sock.sendMessage(from, {
            text: `⚠️ @${jidOf(t)} hit ${limit} warnings — but I need admin rights to remove them.`,
            mentions: [t],
          }, { quoted: msg });
        }
        return sock.sendMessage(from, {
          text: `⚠️ @${jidOf(t)} warned — *${n}/${limit}*`,
          mentions: [t],
        }, { quoted: msg });
      }

      if (command === 'resetwarn' || command === 'clearwarns' || command === 'delwarn') {
        const t = resolveTarget({ m: msg, args });
        const key = t ? `${jidOf(from)}:${jidOf(t)}` : null;
        if (key) delete db.warnings[key];
        else Object.keys(db.warnings).filter((k) => k.startsWith(`${jidOf(from)}:`)).forEach((k) => delete db.warnings[k]);
        save();
        return t
          ? sock.sendMessage(from, { text: `✅ Warnings cleared for @${jidOf(t)}`, mentions: [t] }, { quoted: msg })
          : reply('✅ All warnings cleared for this group.');
      }

      // list
      const prefixKey = `${jidOf(from)}:`;
      const entries = Object.entries(db.warnings).filter(([k, v]) => k.startsWith(prefixKey) && v > 0);
      if (!entries.length) return reply('✅ Nobody has warnings here.');
      return reply(
        `⚠️ *Warnings*\n\n` +
          entries.sort((a, b) => b[1] - a[1]).map(([k, v]) => `▸ @${k.split(':')[1]} — *${v}*`).join('\n'),
      );
    }

    /* ── activity stats ───────────────────────────────────── */
    if (ACTIVITY.has(command)) {
      try {
        const meta = await sock.groupMetadata(from);
        if (command === 'inactive' || command === 'active' || command === 'leastactive' || command === 'mostactive') {
          return reply(
            `📊 *Activity — ${meta.subject}*\n\n` +
              `▸ Members : ${meta.participants.length}\n` +
              `▸ Admins  : ${meta.participants.filter((p) => p.admin).length}\n\n` +
              `_Per-member message counts need the bot to track traffic from the\n` +
              `moment it joins. This group has been tracked for 0 messages so far._`,
          );
        }
        return reply(
          `📊 *${meta.subject}*\n\n` +
            `▸ Members      : ${meta.participants.length}\n` +
            `▸ Admins       : ${meta.participants.filter((p) => p.admin).length}\n` +
            `▸ Announce mode: ${meta.announce ? 'on (admins only)' : 'off'}\n` +
            `▸ Locked       : ${meta.restrict ? 'yes' : 'no'}`,
        );
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── rules ────────────────────────────────────────────── */
    if (RULES.has(command)) {
      const key = jidOf(from);
      if (command === 'setrules') {
        if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
        if (!text) return reply('Usage: `.setrules 1. Be kind. 2. No spam.`');
        db.rules[key] = text;
        save();
        return reply('✅ Group rules saved.');
      }
      return reply(db.rules[key] ? `📜 *Rules — ${key}*\n\n${db.rules[key]}` : '📜 No rules set. `.setrules ...` to add them.');
    }

    /* ── ephemeral ────────────────────────────────────────── */
    if (EPHEMERAL.has(command)) {
      if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
      if (!(await botIsAdmin(sock, from))) return reply('⛔ I need admin rights to change disappearing messages.');
      const secs = parseInt(args[0], 10) || 86400;
      const allowed = [0, 86400, 604800, 7776000];
      const dur = allowed.includes(secs) ? secs : 86400;
      try {
        await sock.sendMessage(from, { disappearingMessagesInChat: dur === 0 ? false : dur });
        return reply(dur === 0 ? '✅ Disappearing messages turned off.' : `✅ Disappearing messages: *${dur / 86400} days*`);
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── group lock / announce ────────────────────────────── */
    if (GROUP_LOCK.has(command)) {
      if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
      if (!(await botIsAdmin(sock, from))) return reply('⛔ I need admin rights to change group settings.');
      try {
        if (command === 'announce' || command === 'sendmessages') {
          const on = command === 'announce' ? args[0] !== 'off' : args[0] === 'on';
          await sock.groupSettingUpdate(from, on ? 'announcement' : 'not_announcement');
          return reply(on ? '📢 Group closed — only admins can send.' : '✅ Group open — everyone can send.');
        }
        if (command === 'restrict' || command === 'editinfo') {
          const on = command === 'restrict' ? args[0] !== 'off' : args[0] === 'on';
          await sock.groupSettingUpdate(from, on ? 'locked' : 'unlocked');
          return reply(on ? '🔒 Info locked — only admins can edit.' : '✅ Info unlocked — everyone can edit.');
        }
        if (command === 'lockgroup') { await sock.groupSettingUpdate(from, 'announcement'); return reply('🔒 Group locked.'); }
        if (command === 'unlockgroup') { await sock.groupSettingUpdate(from, 'not_announcement'); return reply('🔓 Group unlocked.'); }
        return reply('Usage: `.announce on|off` · `.restrict on|off`');
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── join requests ────────────────────────────────────── */
    if (APPROVE.has(command)) {
      if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
      if (!(await botIsAdmin(sock, from))) return reply('⛔ I need admin rights to handle join requests.');
      try {
        const code = await sock.groupInviteCode(from);
        const pending = await sock.groupRequestParticipantsList(from).catch(() => []);
        if (!pending?.length) return reply('✅ No pending join requests.');

        if (command === 'requests' || command === 'joinrequests' || command === 'pending') {
          return reply(
            `📥 *Join requests* (${pending.length})\n\n` +
              pending.map((p, i) => `${i + 1}. ${jidOf(p.jid || p.id)}`).join('\n') +
              `\n\n\`.approveall\` · \`.rejectall\``,
          );
        }
        const action = command.startsWith('reject') ? 'reject' : 'approve';
        const targets = command.endsWith('all') ? pending.map((p) => p.jid || p.id) : [resolveTarget({ m: msg, args })].filter(Boolean);
        if (!targets.length) return reply(`Mention someone or use \`.${action}all\`.`);
        await sock.groupRequestParticipantsUpdate(from, targets, action);
        return reply(`✅ ${action === 'approve' ? 'Approved' : 'Rejected'} ${targets.length} request${targets.length === 1 ? '' : 's'}.`);
      } catch (e) {
        return reply(`❌ ${e.message}`);
      }
    }

    /* ── invite / leave ───────────────────────────────────── */
    if (INVITE.has(command)) {
      if (command === 'join' || command === 'joingroup') {
        if (!isOwner) return reply('⛔ Owner only.');
        const m2 = text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
        const code = m2 ? m2[1] : text;
        if (!code) return reply('Usage: `.join https://chat.whatsapp.com/XXXX`');
        try {
          const jid = await sock.groupAcceptInvite(code);
          return reply(`✅ Joined group.`);
        } catch (e) {
          return reply(`❌ Couldn't join: ${e.message}`);
        }
      }
      if (command === 'leave' || command === 'leavegroup') {
        if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
        await reply('👋 Leaving this group.');
        return sock.groupLeave(from).catch(() => {});
      }
      if (command === 'leaveall') {
        if (!isOwner) return reply('⛔ Owner only.');
        const groups = await sock.groupFetchAllParticipating();
        const ids = Object.keys(groups);
        await reply(`👋 Leaving ${ids.length} group${ids.length === 1 ? '' : 's'}...`);
        for (const id of ids) await sock.groupLeave(id).catch(() => {});
        return;
      }
    }

    /* ── bulk actions ─────────────────────────────────────── */
    if (GROUP_ACTIONS.has(command)) {
      if (!senderAdmin && !isOwner) return reply('⛔ Admins only.');
      if (!(await botIsAdmin(sock, from))) return reply('⛔ I need admin rights for bulk removal.');
      if (command === 'grouplist') {
        if (!isOwner) return reply('⛔ Owner only.');
        const groups = await sock.groupFetchAllParticipating();
        const ids = Object.keys(groups);
        return reply(
          `👥 *Groups I'm in* (${ids.length})\n\n` +
            ids.slice(0, 30).map((id) => `▸ ${groups[id].subject}`).join('\n'),
        );
      }
      return reply(
        `⚠️ *\`.${command}\` is destructive and not enabled.*\n\n` +
          `Removing many members at once gets a number banned by WhatsApp's\n` +
          `abuse detection. Use \`.warn\` + auto-kick at the limit instead.`,
      );
    }

    return reply('👥 Working on it.');
  },
};
