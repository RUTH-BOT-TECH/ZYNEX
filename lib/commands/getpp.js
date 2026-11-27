/**
 * .getpp / .pfp / .avatar / .getdp — fetch a user's profile picture.
 *
 * These names used to be routed to the media engine and returned a random
 * `neko` anime picture. PFP means *profile picture*, so that was a command-truth
 * bug. Baileys exposes `sock.profilePictureUrl(jid, 'image')` for the real,
 * high-resolution picture [Baileys chat-management docs].
 *
 * Target priority: mention → replied-message author → the command sender.
 * The caption shows the visible @number and carries the matching `mentions`
 * entry, the same rule the rest of the bot uses for tags.
 */
'use strict';

const axios = require('axios');
const { createFakeContact } = require('../createFakeContact');

module.exports = {
  name: 'getpp',
  aliases: ['pfp', 'avatar', 'getdp'],
  desc: "Get a user's profile picture",
  category: 'tools',

  async execute({ sock, msg, from, reply, mentionedJid, sender, senderJid, participant }) {
    const ci =
      msg?.message?.extendedTextMessage?.contextInfo ||
      msg?.message?.imageMessage?.contextInfo ||
      {};
    const target =
      (Array.isArray(mentionedJid) && mentionedJid[0]) ||
      ci.mentionedJid?.[0] ||
      ci.participant ||
      senderJid ||
      participant ||
      sender ||
      null;

    if (!target) {
      return reply('❌ Mention a user, reply to their message, or run this in a chat.\nUsage: `.getpp @2348012345678`');
    }

    try {
      const url = await sock.profilePictureUrl(target, 'image');
      if (!url) return reply('❌ This user has no visible profile picture (or hid it from you).');

      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10_000 });
      if (!res.data || !res.data.length) throw new Error('empty image');
      const number = String(target).split('@')[0].split(':')[0];
      await sock.sendMessage(
        from,
        {
          image: Buffer.from(res.data),
          caption: `👤 *Profile picture*\n@${number}`,
          mentions: [target],
        },
        { quoted: createFakeContact(msg) },
      );
    } catch (e) {
      return reply(`❌ Could not fetch that profile picture (${e.message}).`);
    }
  },
};
