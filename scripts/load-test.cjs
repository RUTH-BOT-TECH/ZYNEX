#!/usr/bin/env node
/**
 * Every engine and command must actually load.
 *
 * Production showed:
 *   [REGISTRY] engine audio.js failed to load: ffmpeg.pitchSemitones is not a function
 *
 * The audio engine built its effect table at require time, calling a function
 * lib/ffmpeg.js never exported. The TypeError happened during module load, so
 * the entire engine was dropped — every audio effect command was dead, while the
 * test suites stayed green because none of them import the engines.
 *
 * A broken module must fail here, not at runtime in front of a user.
 */
process.env.SILENT = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

function loadAll(dir) {
  const full = path.join(ROOT, dir);
  const files = fs.readdirSync(full).filter((f) => f.endsWith('.js'));
  const broken = [];
  const loaded = [];
  for (const f of files) {
    try {
      const m = require(path.join(full, f));
      if (!m.id && !m.name) throw new Error('exports neither id nor name');
      loaded.push(f);
    } catch (e) {
      broken.push(`${f}: ${e.message.split('\n')[0]}`);
    }
  }
  return { files, broken, loaded };
}

console.log('\n══ modules ══\n');

const engines = loadAll('lib/engines');
t(`all ${engines.files.length} engines load`, () => {
  assert.strictEqual(engines.broken.length, 0, engines.broken.join('; '));
});

const commands = loadAll('lib/commands');
t(`all ${commands.files.length} commands load`, () => {
  assert.strictEqual(commands.broken.length, 0, commands.broken.join('; '));
});

console.log('\n══ the specific breakage ══\n');

t('lib/ffmpeg exports every helper the engines call', () => {
  const ffmpeg = require(path.join(ROOT, 'lib', 'ffmpeg.js'));
  for (const fn of ['ffmpegPath', 'hasFfmpeg', 'pitchSemitones']) {
    assert.strictEqual(typeof ffmpeg[fn], 'function', `lib/ffmpeg.${fn} is not exported`);
  }
});

t('pitchSemitones produces a valid ffmpeg chain', () => {
  const { pitchSemitones } = require(path.join(ROOT, 'lib', 'ffmpeg.js'));
  const up = pitchSemitones(4);
  assert.ok(/^asetrate=\d+,aresample=44100,atempo=[\d.]+$/.test(up), up);
  // atempo only accepts 0.5–2.0
  const tempo = Number(up.split('atempo=')[1]);
  assert.ok(tempo >= 0.5 && tempo <= 2, `atempo ${tempo} is outside the range ffmpeg accepts`);
});

t('the audio engine actually registers its effects', () => {
  const audio = require(path.join(ROOT, 'lib', 'engines', 'audio.js'));
  assert.ok(audio.match('pitchup'), 'pitchup must be a usable effect');
  assert.ok(audio.match('demon'), 'and so must the rest of the table');
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);
