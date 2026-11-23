/**
 * AUDIO ENGINE — real ffmpeg processing.
 *
 * 44 catalogue names, every one a genuine ffmpeg filter chain. No APIs, no keys.
 * ffmpeg comes from `ffmpeg-static`, so this works on Render/Railway with no
 * apt-get and no root.
 *
 *   .bass .nightcore .8d .reverb .earrape .chipmunk .vaporwave .lofi ...
 *
 * All commands operate on a replied-to audio message (or a voice note).
 */
const ffmpeg = require('../ffmpeg');

/* ── name → { filter, args, ext, label } ──────────────────── */
const EFFECTS = {
  bass:        { filter: 'bass=g=20,volume=1.2',            label: 'Bass boost +20dB' },
  superbass:   { filter: 'bass=g=30,volume=1.4',            label: 'Super bass' },
  blown:       { filter: 'bass=g=35,volume=2.5,alimiter',   label: 'Blown speaker' },
  deep:        { filter: 'asetrate=44100*0.85,aresample=44100,atempo=1.18', label: 'Deep voice' },
  earrape:     { filter: 'volume=8,alimiter=limit=0.8',     label: 'Earrape' },
  fast:        { filter: 'atempo=1.5',                      label: 'Speed x1.5' },
  speedup:     { filter: 'atempo=1.5',                      label: 'Speed x1.5' },
  slow:        { filter: 'atempo=0.7',                      label: 'Slow x0.7' },
  slowdown:    { filter: 'atempo=0.7',                      label: 'Slow x0.7' },
  nightcore:   { filter: 'asetrate=44100*1.25,aresample=44100,atempo=1.0', label: 'Nightcore' },
  vaporwave:   { filter: 'asetrate=44100*0.8,aresample=44100,atempo=1.0',  label: 'Vaporwave' },
  reverse:     { filter: 'areverse',                        label: 'Reversed' },
  robot:       { filter: 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75', label: 'Robot' },
  chipmunk:    { filter: 'asetrate=44100*1.35,aresample=44100,atempo=1.0', label: 'Chipmunk' },
  tupai:       { filter: 'asetrate=44100*1.45,aresample=44100,atempo=1.0', label: 'Tupai (squirrel)' },
  echo:        { filter: 'aecho=0.8:0.88:60:0.4',           label: 'Echo' },
  reverb:      { filter: 'aecho=0.8:0.9:1000:0.3',          label: 'Reverb' },
  vibrato:     { filter: 'vibrato=f=6:d=0.5',               label: 'Vibrato' },
  tremolo:     { filter: 'tremolo=f=6:d=0.7',               label: 'Tremolo' },
  flanger:     { filter: 'flanger',                         label: 'Flanger' },
  phaser:      { filter: 'aphaser',                         label: 'Phaser' },
  distort:     { filter: 'acompressor=threshold=-20dB:ratio=4,volume=2', label: 'Distortion' },
  lofi:        { filter: 'lowpass=f=3000,highpass=f=300,volume=1.1', label: 'Lo-fi' },
  '8d':        { filter: 'apulsator=hz=0.125',              label: '8D audio' },
  audio8d:     { filter: 'apulsator=hz=0.125',              label: '8D audio' },
  boost:       { filter: 'volume=2,alimiter',               label: 'Volume boost' },
  normalize:   { filter: 'loudnorm',                        label: 'Normalized' },
  smooth:      { filter: 'lowpass=f=8000,volume=1.05',      label: 'Smoothed' },
  whisper:     { filter: 'highpass=f=500,volume=0.6',       label: 'Whisper' },
  underwater:  { filter: 'lowpass=f=500,volume=1.3',        label: 'Underwater' },
  radio:       { filter: 'highpass=f=800,lowpass=f=3000,volume=1.4', label: 'Radio' },
  telephone:   { filter: 'highpass=f=300,lowpass=f=3400,volume=1.6', label: 'Telephone' },
  demon:       { filter: 'asetrate=44100*0.7,aresample=44100,atempo=1.3,volume=1.2', label: 'Demon' },
  alien:       { filter: 'asetrate=44100*1.6,aresample=44100,atempo=0.8', label: 'Alien' },
  autotune:    { filter: 'asetrate=44100*1.05,aresample=44100', label: 'Autotune-ish' },
  karaoke:     { filter: 'pan=stereo|c0=c0-c1|c1=c1-c0',    label: 'Karaoke (vocal remove)' },
  mono:        { filter: 'pan=mono|c0=0.5*c0+0.5*c1',       label: 'Mono' },
  stereo:      { filter: 'aformat=channel_layouts=stereo',  label: 'Stereo' },
  pitchup:     { filter: ffmpeg.pitchSemitones(4),          label: 'Pitch +4 semitones' },
  pitchdown:   { filter: ffmpeg.pitchSemitones(-4),         label: 'Pitch −4 semitones' },
  bassvocal:   { filter: 'bass=g=12,treble=g=-5',           label: 'Bass, less treble' },
  treble:      { filter: 'treble=g=12',                     label: 'Treble boost' },
};

const NAMES = Object.keys(EFFECTS);

/* volume / trim take a numeric argument */
const PARAMETRIC = new Set(['volume', 'vol', 'trim', 'cut']);

module.exports = {
  id: 'audio',
  name: 'audio-engine',

  match(name) {
    return Boolean(EFFECTS[name]) || PARAMETRIC.has(name);
  },

  describe(name) {
    if (EFFECTS[name]) return `Audio effect: ${EFFECTS[name].label}`;
    if (PARAMETRIC.has(name)) return 'Adjust volume or trim audio';
    return 'Audio processing';
  },

  extraNames: [...NAMES, ...PARAMETRIC],

  async execute({ command, args, reply, sock, from, msg, download }) {
    /* ── ffmpeg availability ─────────────────────────────── */
    /**
     * ★ This said `ffmpeg.available()` — a function that has never existed.
     * lib/ffmpeg.js exports hasFfmpeg(). The TypeError threw on EVERY call, so
     * all 46 audio names (.bass, .autotune, .8d, .boost, .blown …) died before
     * they ever looked at the message. One typo, 46 dead commands.
     */
    if (typeof ffmpeg.hasFfmpeg === 'function' ? !ffmpeg.hasFfmpeg() : !ffmpeg.ffmpegPath()) {
      return reply(
        '🎛️ *ffmpeg not found*\n\n' +
          `Install it with \`npm install ffmpeg-static\`, or set \`FFMPEG_PATH\` to an existing binary.`,
      );
    }

    /* ── needs audio to work on ──────────────────────────── */
    const quoted = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const own = msg?.message?.audioMessage;
    if (!quoted && !own) {
      return reply(
        `🎧 *Reply to an audio message or voice note* with \`.${command}\`.\n\n` +
          (EFFECTS[command] ? `_Effect: ${EFFECTS[command].label}_` : ''),
      );
    }
    const quotedType = quoted ? Object.keys(quoted)[0] : 'audioMessage';
    if (!/audio|ptt|voice/i.test(quotedType) && !own) {
      return reply('🎧 That message has no audio. Reply to a voice note or audio file.');
    }

    let input;
    try {
      input = await download();
    } catch (e) {
      return reply(`❌ Couldn't download the audio: ${e.message}`);
    }
    if (!input || !input.length) return reply('❌ The audio came back empty.');

    /* ── build the ffmpeg argv ───────────────────────────── */
    let filters;
    let label;

    if (PARAMETRIC.has(command)) {
      if (command === 'volume' || command === 'vol') {
        const x = parseFloat(args[0]);
        if (!x || x <= 0 || x > 10) return reply(`Usage: \`.${command} 2\` (0.1 – 10)`);
        filters = `volume=${x}`;
        label = `Volume ×${x}`;
      } else {
        // .trim 30  → first 30 seconds
        const secs = parseFloat(args[0]);
        if (!secs || secs <= 0) return reply(`Usage: \`.${command} 30\` (seconds)`);
        filters = null;
        label = `First ${secs}s`;
        const res = await ffmpeg.convert(input, ['-t', String(secs), '-vn'], { inExt: '.mp3', outExt: '.mp3' });
        if (!res.ok) return reply(`❌ ffmpeg failed:\n${(res.stderr || '').slice(-400)}`);
        return sock.sendMessage(from, {
          audio: res.buffer, mimetype: 'audio/mpeg', ptt: true,
        }, { quoted: msg }).then(() => reply(`✅ ${label}`));
      }
    } else {
      const fx = EFFECTS[command];
      filters = fx.filter;
      label = fx.label;
    }

    await reply(`🎛️ Processing: *${label}*…`);

    const res = await ffmpeg.filterAudio(input, filters, {
      inExt: '.mp3',
      ext: '.mp3',
      extra: ['-vn', '-b:a', '128k'],
    });

    if (!res.ok || !res.buffer) {
      const tail = (res.stderr || '').split('\n').filter(Boolean).slice(-3).join('\n');
      return reply(`❌ ffmpeg failed on *${label}*\n\n\`\`\`${tail || 'no output'}\`\`\``);
    }

    // keep WhatsApp happy — voice notes have a practical size ceiling
    if (res.buffer.length > 14 * 1024 * 1024) {
      return reply(`❌ Result is ${(res.buffer.length / 1048576).toFixed(1)} MB — too big for WhatsApp. Try a shorter clip.`);
    }

    return sock.sendMessage(from, {
      audio: res.buffer,
      mimetype: 'audio/mpeg',
      ptt: true,
    }, { quoted: msg }).then(() =>
      reply(`✅ *${label}*\n💾 ${(res.buffer.length / 1024).toFixed(0)} KB`),
    );
  },
};
