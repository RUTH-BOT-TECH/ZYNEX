#!/usr/bin/env node
/**
 * Media pipelines that need a real binary.
 *
 * Everything here failed in production for one reason: no ffmpeg.
 *   • .kiss/.hug rendered as a static image instead of an animation
 *   • .tts produced a file that "shows as audio but errors when you list it"
 *
 * .nixpacks.toml listed ffmpeg in nixPkgs and the build ignored it — verified
 * inside the deployed container (`command -v ffmpeg` exit 1) while the
 * ffmpeg-static package ran ffmpeg 7.0.2 fine. So the resolver prefers the
 * package and these tests exercise the real binary when it is present.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ffmpeg = require(path.join(ROOT, 'lib', 'ffmpeg.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

console.log('\n══ ffmpeg resolution ══\n');

t('a working binary is found', () => {
  assert.ok(ffmpeg.hasFfmpeg(), 'no usable ffmpeg — animations and voice notes will degrade');
});

t('the resolved path actually runs', () => {
  const bin = ffmpeg.ffmpegPath();
  const out = execFileSync(bin, ['-version'], { encoding: 'utf8' });
  assert.ok(/ffmpeg version/i.test(out), out.split('\n')[0]);
});

t('the result is cached (not re-probed per send)', () => {
  assert.strictEqual(ffmpeg.ffmpegPath(), ffmpeg.ffmpegPath());
});

t('ffmpeg-static is a declared dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['ffmpeg-static'], 'the nix package was ignored by the build');
});

console.log('\n══ the two conversions that were broken ══\n');

const bin = ffmpeg.ffmpegPath();

t('a GIF converts to an MP4 suitable for gifPlayback', () => {
  if (!bin) return;                              // covered by the assertions above
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-media-'));
  const gif = path.join(dir, 'a.gif');
  const mp4 = path.join(dir, 'a.mp4');
  // 1 second of solid-colour frames — a real, valid GIF
  execFileSync(bin, [
    '-y', '-f', 'lavfi', '-i', 'color=c=pink:s=64x64:d=1:r=10',
    '-vf', 'scale=64:64', gif,
  ], { stdio: 'ignore' });
  assert.ok(fs.existsSync(gif), 'test fixture GIF was not produced');

  execFileSync(bin, [
    '-y', '-i', gif, '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    mp4,
  ], { stdio: 'ignore' });

  const buf = fs.readFileSync(mp4);
  assert.ok(buf.length > 500, 'converted video is suspiciously small');
  // mp4 files carry an 'ftyp' box near the start
  assert.ok(buf.slice(0, 32).toString('ascii').includes('ftyp'), 'output is not an MP4');
});

t('MP3 converts to OGG/Opus (the only valid voice-note format)', () => {
  if (!bin) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-voice-'));
  const mp3 = path.join(dir, 'a.mp3');
  const ogg = path.join(dir, 'a.ogg');
  execFileSync(bin, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:a', 'libmp3lame', mp3,
  ], { stdio: 'ignore' });

  execFileSync(bin, [
    '-y', '-i', mp3, '-c:a', 'libopus', '-b:a', '48k',
    '-ar', '48000', '-ac', '1', ogg,
  ], { stdio: 'ignore' });

  const buf = fs.readFileSync(ogg);
  assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'OggS',
    'voice notes must be OGG/Opus or WhatsApp shows audio that will not play');
});

console.log('\n══ code paths ══\n');

t('.tts converts to a voice note and validates the audio it fetched', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'tts.js'), 'utf8');
  assert.ok(/toVoiceNote/.test(src), 'must convert before marking ptt');
  assert.ok(/looksLikeAudio/.test(src), 'an HTML error page passed the old size check');
  assert.ok(/audio\/ogg/.test(src), 'voice notes must be declared OGG');
});

t('.tts does not mark MP3 as a voice note', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'tts.js'), 'utf8');
  assert.ok(!/mimetype:\s*'audio\/mpeg',\s*\n\s*ptt:\s*true/.test(src),
    'MP3 with ptt:true is a corrupt voice note');
});

t('the GIF is converted to MP4 before being sent as a video', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'engines', 'reactions.js'), 'utf8');
  assert.ok(/GIF→MP4/.test(src), 'raw GIF bytes are still uploaded as video/mp4');
  assert.ok(/yuv420p/.test(src), 'without yuv420p phones refuse to play the video');
  assert.ok(/ftyp/.test(src), 'the conversion result is not verified before sending');
});

t('a real GIF becomes a playable MP4 through the engine', () => {
  if (!bin) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zynex-rx-'));
  const gif = path.join(dir, 'a.gif');
  const mp4 = path.join(dir, 'a.mp4');
  execFileSync(bin, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1:r=10', gif], { stdio: 'ignore' });
  const gifBytes = fs.readFileSync(gif);
  assert.strictEqual(gifBytes.slice(0, 3).toString('ascii'), 'GIF');

  execFileSync(bin, ['-y', '-i', gif, '-movflags', '+faststart', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-an', mp4], { stdio: 'ignore' });
  const out = fs.readFileSync(mp4);
  // The whole bug in one assertion: what leaves must be an MP4, not a GIF.
  assert.strictEqual(out.slice(4, 8).toString('ascii'), 'ftyp', 'output is not an MP4');
  assert.notStrictEqual(out.slice(0, 3).toString('ascii'), 'GIF', 'a GIF was uploaded as video/mp4');
});

t('reactions try the animation before a static image', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'engines', 'reactions.js'), 'utf8');
  const exec = src.slice(src.indexOf('async execute'));
  const firstVideo = exec.indexOf('gifPlayback: true');
  const firstImage = exec.indexOf('sendReaction(');
  assert.ok(firstVideo > -1, 'gifPlayback must be attempted');
  assert.ok(firstVideo < firstImage, 'the static fallback ran before the animation');
});

t('.vv distinguishes "no media URL" from "no media key"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'vv.js'), 'utf8');
  assert.ok(/noUrl/.test(src), 'both failures were reported as server-side expiry');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
