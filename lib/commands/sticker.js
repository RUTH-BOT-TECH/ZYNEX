/**
 * .sticker — Convert image/video to a real WhatsApp WebP sticker.
 *
 * Usage:
 *   Send image with caption: .sticker
 *   Reply to an image/video: .sticker
 *   .sticker CustomPackName
 *   .sticker CustomPackName | Author
 *
 * Pack/author are written into the WebP EXIF chunk, not passed as Baileys
 * message options. Baileys ignores `{ packname, author }`; WhatsApp reads the
 * EXIF. Video is converted to an animated WebP with the bundled ffmpeg.
 */
const { BOT_NAME } = require('../botInfo');
const { createFakeContact } = require('../createFakeContact');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const ff = require('../ffmpeg');
const stickerMeta = require('../stickerMetadata');

function defaults(ctx) {
  const senderNumber = String(ctx.sender || '').split('@')[0].split(':')[0];
  return {
    pack: process.env.STICKER_PACKNAME || BOT_NAME,
    author: process.env.STICKER_AUTHOR || ctx.pushName || senderNumber || BOT_NAME,
  };
}

module.exports = {
  name: 'sticker',
  aliases: ['s', 'st'],
  desc: 'Convert image/video to a WebP sticker with pack|author EXIF metadata',
  category: 'sticker',

  async execute({ sock, msg, args, reply, sender, pushName }) {
    let mediaMessage = msg.message?.imageMessage || msg.message?.videoMessage;
    let type = msg.message?.imageMessage ? 'image' : (msg.message?.videoMessage ? 'video' : null);

    if (!mediaMessage && msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const q = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      mediaMessage = q.imageMessage || q.videoMessage;
      type = q.imageMessage ? 'image' : (q.videoMessage ? 'video' : null);
    }

    if (!mediaMessage || !type) {
      return reply(
        `❌ *Send/reply to an image or video* to convert to sticker.\n\n` +
        `*Usage:*\n` +
        `• Send image with caption: \`.sticker\`\n` +
        `• Reply to an image/video: \`.sticker\`\n` +
        `• Custom metadata: \`.sticker MyPack | Me\`\n\n` +
        `_📦 Default pack: ${BOT_NAME}_`,
      );
    }

    let buffer;
    try {
      const stream = await downloadContentFromMessage(mediaMessage, type);
      buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    } catch (e) {
      return reply(`❌ Failed to download media: ${e.message}`);
    }

    if (!buffer || buffer.length === 0) {
      return reply('❌ Downloaded media is empty. Try again.');
    }

    const { pack, author } = stickerMeta.splitPackAuthor(
      (args || []).join(' ').trim(),
      defaults({ sender, pushName }),
    );

    try {
      let stickerBuffer;

      if (type === 'image') {
        try {
          const sharp = require('sharp');
          stickerBuffer = await sharp(buffer)
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 90, alphaQuality: 100 })
            .toBuffer();
        } catch {
          // sharp may be unavailable on a stripped host; repackSticker converts
          // any still image to WebP below.
          stickerBuffer = buffer;
        }
      } else {
        const r = await ff.convert(buffer, [
          '-t', '3',
          '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:-1:-1:color=black@0',
          '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '80',
          '-loop', '0', '-an', '-vsync', '0',
        ], { inExt: '.mp4', outExt: '.webp', timeout: 60000 });
        if (!r.ok) return reply(`❌ Could not convert that video (${r.stderr}).`);
        stickerBuffer = r.buffer;
      }

      const tagged = await stickerMeta.repackSticker(stickerBuffer, { pack, author });
      await sock.sendMessage(msg.key.remoteJid, {
        sticker: tagged,
        isAnimated: stickerMeta.isAnimatedWebp(tagged),
      }, { quoted: createFakeContact(msg) });

      await reply(
        `✅ *Sticker created!*\n\n` +
        `📦 *Pack:* ${pack}\n` +
        `👤 *Author:* ${author}\n` +
        `💾 *Size:* ${(tagged.length / 1024).toFixed(1)} KB`,
      );
    } catch (e) {
      console.error('[STICKER] Error:', e);
      await reply(`❌ Failed to create sticker: ${e.message}`);
    }
  },
};
