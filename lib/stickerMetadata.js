'use strict';
/**
 * stickerMetadata.js — real WhatsApp sticker pack/author metadata.
 *
 * Many bot families use `.take`, `.steal`, `.swm` or `.exif` to "rebrand" a
 * sticker. That is not a Baileys message option: WhatsApp reads JSON out of a
 * WebP EXIF chunk. Sending `{ packname, author }` beside `{ sticker }` looks
 * convincing in code and does nothing on the wire.
 *
 * The EXIF payload below is the same TIFF/IFD layout used by node-webpmux,
 * wa-sticker-formatter and whatsapp-web.js: one UNDEFINED tag 0x5741 ("WA")
 * whose value is the JSON object with `sticker-pack-id`,
 * `sticker-pack-name`, `sticker-pack-publisher` and `emojis`.
 *
 * node-webpmux rewrites the RIFF container correctly for both static and
 * animated WebP (VP8X / ANIM / ANMF), so we do not reimplement WebP muxing.
 */
const sharp = require('sharp');
const crypto = require('crypto');
const { Image } = require('node-webpmux');
const { BOT_NAME } = require('./botInfo');

const MAX_PACK = 80;
const MAX_AUTHOR = 80;

function isWebp(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP';
}

/** Walk RIFF chunks without decoding the image. */
function riffChunks(buf) {
  const out = [];
  if (!isWebp(buf)) return out;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.slice(off, off + 4).toString('ascii');
    const size = buf.readUInt32LE(off + 4);
    out.push({ id, size });
    off += 8 + size + (size % 2);
  }
  return out;
}

function isAnimatedWebp(buf) {
  return riffChunks(buf).some((c) => c.id === 'ANIM' || c.id === 'ANMF');
}

function clean(value, fallback, max) {
  const s = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  return (s || fallback).slice(0, max);
}

/** Parse `pack|author`, `pack | author`, or just `pack`. */
function splitPackAuthor(input, defaults = {}) {
  const text = String(input || '').trim();
  const parts = text.split('|');
  const pack = clean(parts.shift(), defaults.pack || BOT_NAME, MAX_PACK);
  const author = clean(parts.join('|'), defaults.author || BOT_NAME, MAX_AUTHOR);
  return { pack, author };
}

function buildStickerExif({ pack, author, id, emojis } = {}) {
  const json = {
    'sticker-pack-id': String(id || crypto.randomBytes(32).toString('hex')),
    'sticker-pack-name': clean(pack, BOT_NAME, MAX_PACK),
    'sticker-pack-publisher': clean(author, BOT_NAME, MAX_AUTHOR),
    emojis: Array.isArray(emojis) && emojis.length ? emojis : ['✨'],
  };
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUInt32LE(jsonBuffer.length, 14);
  return exif;
}

async function setWebpExif(webp, exif) {
  const img = new Image();
  await img.load(webp);
  img.exif = exif;
  const saved = await img.save(null);
  return Buffer.isBuffer(saved) ? saved : Buffer.from(saved);
}

async function readStickerMetadata(webp) {
  if (!isWebp(webp)) return null;
  try {
    const img = new Image();
    await img.load(webp);
    if (!img.exif || !img.exif.length) return null;
    const raw = img.exif.toString('utf8');
    const start = raw.indexOf('{');
    if (start < 0) return null;
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

/** Convert any still image to a 512×512 WebP sticker, preserving alpha. */
async function toStickerWebp(buf) {
  return sharp(buf)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 4 })
    .toBuffer();
}

/**
 * Repack an existing sticker — or convert an image — and write real EXIF.
 * Animated WebP is preserved; static WebP is kept as WebP.
 */
async function repackSticker(input, { pack, author, emojis, id } = {}) {
  if (!Buffer.isBuffer(input) || !input.length) throw new Error('empty sticker');
  const webp = isWebp(input) ? input : await toStickerWebp(input);
  return setWebpExif(webp, buildStickerExif({ pack, author, emojis, id }));
}

module.exports = {
  isWebp,
  isAnimatedWebp,
  riffChunks,
  splitPackAuthor,
  buildStickerExif,
  setWebpExif,
  readStickerMetadata,
  toStickerWebp,
  repackSticker,
};
