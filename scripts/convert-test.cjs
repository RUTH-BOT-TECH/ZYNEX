#!/usr/bin/env node
/**
 * The converter / devtool commands, tested through the real dispatcher.
 *
 * These were missing entirely. The comparison that found them: list every
 * command name another implementation exposes, subtract ours, and check each
 * gap by hand. Most "missing" names turned out to be engine-backed and fine —
 * the ones here genuinely were not implemented.
 *
 * Every case runs `execute()` with a real command name, because the modules
 * dispatch on the command that was used rather than on their own `name`. A test
 * that only checked the module loads would miss a wrong branch entirely.
 */
process.env.SILENT = '1';
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const convert = require(path.join(ROOT, 'lib', 'commands', 'convert.js'));
const devtools = require(path.join(ROOT, 'lib', 'commands', 'devtools.js'));

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}  ❌ ${e.message}`); fail++; }
}

/** Run a command and return the reply text. */
async function run(mod, command, args, extra = {}) {
  let out = null;
  await mod.execute({
    command,
    args,
    reply: async (text) => { out = text; },
    msg: { message: {} },
    ...extra,
  });
  return String(out || '');
}

(async () => {
  console.log('\n══ converters ══\n');

  await t('num2roman converts 1994 → MCMXCIV', async () => {
    const r = await run(convert, 'num2roman', ['1994']);
    assert.ok(/MCMXCIV/.test(r), r);
  });

  await t('roman2num converts back', async () => {
    const r = await run(convert, 'roman2num', ['MCMXCIV']);
    assert.ok(/1994/.test(r), r);
  });

  await t('num2roman refuses out-of-range with a reason', async () => {
    const r = await run(convert, 'num2roman', ['5000']);
    assert.ok(/1–3999|1-3999/.test(r), r);
  });

  await t('number2words handles compounds', async () => {
    const r = await run(convert, 'number2words', ['1250']);
    assert.ok(/one thousand two hundred fifty/.test(r), r);
  });

  await t('number2words handles zero', async () => {
    const r = await run(convert, 'number2words', ['0']);
    assert.ok(/zero/.test(r), r);
  });

  await t('datasize picks the right unit', async () => {
    const r = await run(convert, 'datasize', ['1048576']);
    assert.ok(/1 MB/.test(r), r);
  });

  await t('distance converts with explicit units', async () => {
    const r = await run(convert, 'distance', ['5', 'km', 'mi']);
    assert.ok(/3\.1069 mi/.test(r), r);
  });

  await t('distance rejects unknown units', async () => {
    const r = await run(convert, 'distance', ['5', 'furlong', 'mi']);
    assert.ok(/Unknown unit/.test(r), r);
  });

  await t('caesar shifts and unshifts', async () => {
    const enc = await run(convert, 'caesar', ['3', 'hello']);
    assert.ok(/khoor/.test(enc), enc);
    const dec = await run(convert, 'caesar', ['-3', 'khoor']);
    assert.ok(/hello/.test(dec), dec);
  });

  await t('vigenere encode/decode are inverse', async () => {
    const enc = await run(convert, 'vigenere', ['encode', 'key', 'hello', 'world']);
    const cipher = /```([\s\S]*?)```/.exec(enc)[1].trim();
    const dec = await run(convert, 'vigenere', ['decode', 'key', ...cipher.split(' ')]);
    assert.ok(/hello world/.test(dec), dec);
  });

  await t('moonphase reports a real phase and illumination', async () => {
    const r = await run(convert, 'moonphase', []);
    assert.ok(/Moon phase/.test(r), r);
    assert.ok(/\d+%/.test(r), r);
  });

  await t('color converts hex → rgb and hsl', async () => {
    const r = await run(convert, 'color', ['#ff8800']);
    assert.ok(/255, 136, 0/.test(r), r);
    assert.ok(/32°/.test(r), r);
  });

  await t('color rejects a non-hex value', async () => {
    const r = await run(convert, 'color', ['octarine']);
    assert.ok(/not a hex colour/.test(r), r);
  });

  console.log('\n══ devtools ══\n');

  await t('jwt decodes header and payload', async () => {
    const tok = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiWllORVgifQ.sig';
    const r = await run(devtools, 'jwt', [tok]);
    assert.ok(/"name": "ZYNEX"/.test(r), r);
    assert.ok(/NOT verified/.test(r), 'decoding must not imply verification');
  });

  await t('jwt rejects a malformed token instead of throwing', async () => {
    const r = await run(devtools, 'jwt', ['not.a.jwt.token']);
    assert.ok(/❌/.test(r), r);
  });

  await t('json validates and formats', async () => {
    const r = await run(devtools, 'json', ['{"a":1,"b":[2,3]}']);
    assert.ok(/Valid JSON/.test(r), r);
  });

  await t('json rejects invalid input', async () => {
    const r = await run(devtools, 'json', ['{broken']);
    assert.ok(/Invalid JSON/.test(r), r);
  });

  await t('uuid generates the requested count', async () => {
    const r = await run(devtools, 'uuid', ['3']);
    const found = r.match(/[0-9a-f]{8}-[0-9a-f]{4}-/g) || [];
    assert.strictEqual(found.length, 3, `got ${found.length}`);
  });

  await t('uuid caps the count so it cannot flood a chat', async () => {
    const r = await run(devtools, 'uuid', ['999']);
    const found = r.match(/[0-9a-f]{8}-[0-9a-f]{4}-/g) || [];
    assert.ok(found.length <= 10, `generated ${found.length}`);
  });

  await t('entropy rates a weak password low', async () => {
    const r = await run(devtools, 'entropy', ['abc']);
    assert.ok(/very weak/.test(r), r);
  });

  await t('entropy rates a long mixed password high', async () => {
    const r = await run(devtools, 'entropy', ['Tr0ub4dor&3xyz!']);
    assert.ok(/strong/.test(r), r);
  });

  await t('timestamp accepts seconds', async () => {
    const r = await run(devtools, 'timestamp', ['1700000000']);
    assert.ok(/2023-11-14/.test(r), r);
  });

  await t('timestamp accepts milliseconds too', async () => {
    const r = await run(devtools, 'timestamp', ['1700000000000']);
    assert.ok(/2023-11-14/.test(r), r);
  });

  await t('base64 round-trips', async () => {
    const enc = await run(devtools, 'base64', ['encode', 'hello']);
    assert.ok(/aGVsbG8=/.test(enc), enc);
    const dec = await run(devtools, 'base64', ['decode', 'aGVsbG8=']);
    assert.ok(/hello/.test(dec), dec);
  });

  await t('base64 decode refuses binary, not the user', async () => {
    const r = await run(devtools, 'base64', ['decode', '//79']);
    assert.ok(/not valid base64 text/.test(r), r);
  });

  await t('devtools can read a quoted message instead of an argument', async () => {
    const r = await run(devtools, 'json', [], {
      msg: { message: { extendedTextMessage: { contextInfo: { quotedMessage: { conversation: '{"x":9}' } } } } },
    });
    assert.ok(/"x": 9/.test(r), r);
  });

  console.log('\n══ registration ══\n');

  await t('every command name is dispatched, not just the module name', async () => {
    // A module can export name 'num2roman' while handling 'caesar' internally;
    // if the alias list omits a name the command is unreachable.
    const names = new Set([convert.name, ...convert.aliases, devtools.name, ...devtools.aliases]);
    for (const n of ['num2roman', 'roman2num', 'number2words', 'datasize', 'distance',
      'caesar', 'vigenere', 'moonphase', 'color', 'jwt', 'json', 'uuid', 'entropy',
      'timestamp', 'base64']) {
      assert.ok(names.has(n), `${n} is implemented but not registered`);
    }
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
