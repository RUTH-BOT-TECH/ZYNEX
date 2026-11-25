/** .tagall — Mention everyone in the group (owner only) */
const { BOT_NAME } = require('../botInfo');
const { createFakeContact } = require('../createFakeContact');

const { isBotOwner } = require('../utils/permissions');

module.exports = {
  name: 'tagall',
  aliases: ['everyone', 'mentionall', 'hidetag'],
  desc: 'Mention everyone in the group (owner only)',
  category: 'group',
  async execute({ sock, msg, args, from, isGroup, reply, dbSession }) {
    // isGroup is supplied by the handler, but fall back to the JID suffix so
    // direct/alias invocations and tests never get a false "group only" refusal.
    const inGroup = isGroup !== undefined ? isGroup : String(from || '').endsWith('@g.us');
    if (!inGroup) return reply('❌ Group only command.');
    if (!isBotOwner(msg, dbSession)) return reply('❌ *Only the bot owner can use this command.*');

    const metadata = await sock.groupMetadata(from);
    const message = args.length ? args.join(' ') : '📢 Attention everyone!';
    const mentions = metadata.participants.map(p => p.id);

    let body = `╔════════════════════════════╗
║   📢 *GROUP ANNOUNCEMENT*     ║
╚════════════════════════════╝

${message}

`;
    for (const id of mentions) body += `@${id.split('@')[0]} `;
    body += `\n\n_— via ${BOT_NAME}_`;

    await sock.sendMessage(from, { text: body, mentions, linkPreview: false }, { quoted: createFakeContact(msg) });
  },
};
