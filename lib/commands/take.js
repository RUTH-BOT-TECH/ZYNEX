'use strict';
/**
 * .take / .steal — repack a replied sticker with your own EXIF metadata.
 *
 * Researched against Mausam WP-Bot, X-Asena, WhatsAppBotMultiDevice and
 * Tsukasa: `.take <packname>` / `.steal` mean "copy this sticker into my pack",
 * not "convert this image". `.steal` also has a genuine economy meaning in
 * other bot families, so ZYNEX keeps that meaning when there is no replied
 * sticker: `.steal` still robs coins, and `.take` asks for a sticker.
 */
const { BOT_NAME } = require('../botInfo');
const { createFakeContact } = require('../createFakeContact');
const stickerMeta = require('../stickerMetadata');

function quotedMessage(msg) {
  const m = msg?.message || {};
  return m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage ||
    m.audioMessage?.contextInfo?.quotedMessage ||
    m.documentMessage?.contextInfo?.quotedMessage ||
    m.stickerMessage?.contextInfo?.quotedMessage || null;
}

function defaults(ctx) {
  const senderNumber = String(ctx.sender || '').split('@')[0].split(':')[0];
  return {
    pack: process.env.STICKER_PACKNAME || BOT_NAME,
    author: process.env.STICKER_AUTHOR || ctx.pushName || senderNumber || BOT_NAME,
  };
}

module.exports = {
  name: 'take',
  aliases: ['steal', 'steal2'],
  desc: 'Repack a replied sticker with pack|author; .steal without a sticker still robs coins',
  category: 'converter',

  async execute(ctx) {
    const cmd = String(ctx.command || 'take').toLowerCase();
    const quoted = quotedMessage(ctx.msg);

    // No sticker to repack: preserve the economy meaning of .steal / .steal2.
    if (!quoted?.stickerMessage) {
      if (cmd.startsWith('steal')) {
        return require('../engines/economy').execute({
          ...ctx,
          command: 'steal',
          m: ctx.m || ctx.msg,
        });
      }
      return ctx.reply(
        `❌ Reply to a *sticker* with \`${ctx.prefix || '.'}${cmd} pack|author\`.\n\n` +
        `_Example:_ \`${ctx.prefix || '.'}${cmd} ${BOT_NAME} | Me\``,
      );
    }

    if (typeof ctx.download !== 'function') {
      return ctx.reply('❌ Could not download the replied sticker.');
    }

    const text = Array.isArray(ctx.args) ? ctx.args.join(' ').trim() : String(ctx.args || '').trim();
    const { pack, author } = stickerMeta.splitPackAuthor(text, defaults(ctx));

    try {
      const input = await ctx.download();
      if (!input || !input.length) return ctx.reply('❌ That sticker was empty.');
      const out = await stickerMeta.repackSticker(input, { pack, author });
      await ctx.sock.sendMessage(ctx.from, {
        sticker: out,
        isAnimated: stickerMeta.isAnimatedWebp(out),
      }, { quoted: createFakeContact(ctx.msg) });
    } catch (e) {
      return ctx.reply(`❌ Could not repack that sticker (${e.message}).`);
    }
  },
};
