/**
 * .tts — Text to speech with multiple fallback sources
 *
 * Usage:
 *   .tts Hello how are you
 *   .tts fr Bonjour comment ça va    (French)
 *   .tts sw Habari yako               (Swahili)
 *
 * Voice notes are sent as proper audio (ptt: true = voice note).
 */
const { createFakeContact } = require('../createFakeContact');


const axios = require('axios');

module.exports = {
  name: 'tts',
  aliases: ['speak', 'voice', 'say'],
  desc: 'Convert text to speech audio (voice note)',
  category: 'media',
  async execute({ sock, msg, args, from, reply }) {
    // Allow optional language code: .tts fr Bonjour
    let lang = 'en';
    let text = args.join(' ');
    if (args.length > 1 && /^[a-z]{2}$/i.test(args[0])) {
      lang = args[0].toLowerCase();
      text = args.slice(1).join(' ');
    }
    if (!text) return reply('❌ Provide text.\nUsage: `.tts Hello how are you`\nOptional lang: `.tts fr Bonjour`');
    if (text.length > 500) return reply('❌ Text too long (max 500 chars)');

    await reply('⏳ Generating audio...');

    let audioBuffer = null;
    let source = '';

    // Method 1: Google Translate TTS (most reliable)
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
          'Accept': 'audio/mpeg, audio/*;q=0.9, */*;q=0.5',
        },
        maxRedirects: 5,
      });

      if (res.data && res.status === 200) {
        audioBuffer = Buffer.from(res.data);
        if (audioBuffer.length > 1000) {  // sanity check
          source = 'Google Translate';
        } else {
          audioBuffer = null;
        }
      }
    } catch (e) {
      console.warn('[TTS] Google failed:', e.message);
    }

    // Method 2: StreamElements — verified unreliable (returned 401 in testing),
    // kept as a fallback but it must never be the only source.
    if (!audioBuffer) {
      try {
        const url = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        if (res.data && res.status === 200) {
          audioBuffer = Buffer.from(res.data);
          if (audioBuffer.length > 1000) source = 'StreamElements';
          else audioBuffer = null;
        }
      } catch (e) {
        console.warn('[TTS] StreamElements failed:', e.message);
      }
    }

    // Method 3: VoiceRSS — the keyless endpoint now returns a 36-byte error
    // body, so the size check below is what rejects it.
    if (!audioBuffer) {
      try {
        const url = `https://api.voicerss.org/?key=0&hl=${lang}&src=${encodeURIComponent(text)}&c=MP3&f=48khz_16bit_mono`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        if (res.data) {
          audioBuffer = Buffer.from(res.data);
          if (audioBuffer.length > 1000) source = 'VoiceRSS';
          else audioBuffer = null;
        }
      } catch (e) {
        console.warn('[TTS] VoiceRSS failed:', e.message);
      }
    }

    // ★ Reject anything that is not audio. An error page can easily be more
    // than 1000 bytes, and sending that produces a file that "shows as audio
    // but errors when played" — exactly the reported symptom.
    const looksLikeAudio = (b) => {
      if (!b || b.length < 1000) return false;
      const head = b.slice(0, 4);
      const ascii = head.toString('ascii');
      return (
        ascii === 'OggS' ||                       // ogg/opus
        ascii.slice(0, 3) === 'ID3' ||             // mp3 with id3 tag
        (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) || // raw mpeg frame
        ascii === 'RIFF'                           // wav
      );
    };
    if (!looksLikeAudio(audioBuffer)) {
      console.log(`[TTS] rejecting non-audio payload (${audioBuffer ? audioBuffer.length : 0} bytes, head=${audioBuffer ? audioBuffer.slice(0, 8).toString('hex') : 'none'})`);
      audioBuffer = null;
    }

    if (!audioBuffer || audioBuffer.length < 1000) {
      return reply(
        `❌ All TTS services failed to generate audio.\n\n` +
        `_This usually happens when:\n` +
        `• Google blocks the request (rate limit)\n` +
        `• The text contains special characters\n` +
        `• Network issue\n\n` +
        `Please try again in a moment._`
      );
    }

    /**
     * ★ A voice note must be OGG/Opus.
     *
     * `ptt: true` marks the message as a voice note, and WhatsApp requires voice
     * notes to be OGG/Opus. Sending MP3 with ptt:true produces a message that
     * shows as audio but fails to play ("error when you list it"). Convert with
     * ffmpeg when it is available; otherwise send it as ordinary audio, which
     * MP3 is valid for, rather than as a broken voice note.
     */
    let payload = {
      audio: audioBuffer,
      mimetype: 'audio/mpeg',
      ptt: false,
      fileName: `tts-${Date.now()}.mp3`,
    };

    const converted = await toVoiceNote(audioBuffer);
    if (converted) {
      payload = { audio: converted, mimetype: 'audio/ogg; codecs=opus', ptt: true };
      console.log('[TTS] converted to OGG/Opus for a real voice note');
    } else {
      console.log('[TTS] ffmpeg unavailable — sending as ordinary audio (not a voice note)');
    }

    try {
      await sock.sendMessage(from, payload, { quoted: createFakeContact(msg) });

      await reply(
        `✅ *Voice note sent!*\n\n` +
        `📝 *Text:* ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}\n` +
        `🌐 *Language:* ${lang}\n` +
        `🔧 *Source:* ${source}${converted ? '' : ' (sent as audio — voice-note conversion needs ffmpeg)'}\n` +
        `💾 *Size:* ${(audioBuffer.length / 1024).toFixed(1)} KB`
      );
    } catch (e) {
      console.error('[TTS] Send failed:', e);
      await reply(`❌ Audio generated but failed to send: ${e.message}`);
    }
  },
};

/**
 * Convert an MP3 buffer to an OGG/Opus voice note via ffmpeg.
 * Returns null when ffmpeg is unavailable or the conversion fails.
 */
async function toVoiceNote(mp3) {
  const { execFile } = require('child_process');
  const bin = require('../ffmpeg').ffmpegPath();
  if (!bin) return null;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-tts-'));
  const inFile = path.join(dir, 'in.mp3');
  const outFile = path.join(dir, 'out.ogg');
  try {
    fs.writeFileSync(inFile, mp3);
    await new Promise((resolve, reject) => {
      execFile(
        bin,
        ['-y', '-i', inFile, '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1', outFile],
        (err) => (err ? reject(err) : resolve()),
      );
    });
    const out = fs.readFileSync(outFile);
    return out.length > 1000 ? out : null;
  } catch (e) {
    console.log(`[TTS] conversion failed: ${e.message}`);
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
