#!/usr/bin/env node
/**
 * harness-test.cjs — the test suites must test the SAME contract production uses.
 *
 * This exists because of a real bug that shipped: `lib/handler.js` never defined
 * `ctx.download`, so every media command in the bot (`.stiker`, `.toimage`,
 * `.toaudio`, PDF conversion, image filters) crashed in production with
 * "ctx.download is not a function".
 *
 * The suites all passed anyway, because each one built its own context object
 * with `download: async () => BUFFER` injected. Every test green, every media
 * command dead. That is the worst kind of green.
 *
 * So this suite does not test features. It tests the *harness*:
 *
 *   1. The context object handler.js builds must expose every function the
 *      engines actually call.
 *   2. Every engine that calls `ctx.X` must have `X` in that contract.
 *   3. The real handler context must be what the tests would receive.
 *
 * Run: node scripts/harness-test.cjs      (npm run test:harness)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \u2713 ${n}`); }
  else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); }
};

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * The functions/values handler.js puts on the context it hands to commands.
 * Parsed from the source because the object is built inline in an async
 * function and cannot be required without a live socket.
 */
function handlerContract() {
  const src = read('lib/handler.js');
  const start = src.indexOf('await command.execute({');
  if (start === -1) throw new Error('command.execute call not found in handler.js');
  // slice to the execute call's own closing brace by counting depth, since the
  // object literal now contains function bodies with their own braces
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = src.slice(open + 1, end);
  const keys = new Set();
  for (const raw of body.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    // `name: value` and shorthand `name`
    const paired = line.match(/^([a-zA-Z_$][\w$]*)\s*:/);
    if (paired) { keys.add(paired[1]); continue; }
    const shorthand = line.match(/^([a-zA-Z_$][\w$]*)$/);
    if (shorthand) { keys.add(shorthand[1]); continue; }
    // arrow functions / async methods: `reply: async (...) => {`
    const fn = line.match(/^([a-zA-Z_$][\w$]*)\s*:\s*(async\s*)?\(/);
    if (fn) keys.add(fn[1]);
  }
  return keys;
}

/** Every `ctx.<name>` referenced anywhere in the engines. */
function engineContextCalls() {
  const calls = new Map();
  const dir = path.join(ROOT, 'lib', 'engines');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/ctx\.([a-zA-Z_$][\w$]*)/g)) {
      if (!calls.has(m[1])) calls.set(m[1], new Set());
      calls.get(m[1]).add(file);
    }
    // engines that destructure their context directly
    for (const m of src.matchAll(/execute\(\s*\{\s*([^}]+)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':')[0].trim().split(/\s/)[0];
        if (name && /^[a-zA-Z_$]/.test(name)) {
          if (!calls.has(name)) calls.set(name, new Set());
          calls.get(name).add(file);
        }
      }
    }
  }
  return calls;
}

console.log('\n\u2550\u2550 Handler contract \u2550\u2550\n');

const contract = handlerContract();
console.log(`  handler provides ${contract.size}: ${[...contract].sort().join(', ')}\n`);

/* 1. the specific functions we know engines rely on */
for (const required of ['sock', 'msg', 'args', 'text', 'from', 'sender', 'prefix', 'reply', 'download']) {
  ok(`handler context exposes \`${required}\``, contract.has(required), 'missing');
}

/* 2. everything an engine touches must be in the contract */
const calls = engineContextCalls();
const missing = [];
// command + category are added by lib/registry.js when it dispatches:
//   execute: (ctx) => engine.execute({ ...ctx, command: name, category })
const REGISTRY_INJECTED = new Set(['command', 'category']);
const PROVIDED_VALUES = new Set([...contract, ...REGISTRY_INJECTED]);
for (const [name, files] of calls) {
  if (PROVIDED_VALUES.has(name)) continue;
  missing.push(`${name} (used by ${[...files].join(', ')})`);
}
ok('every ctx.* an engine calls is provided by the handler', missing.length === 0, missing.join(' · '));

/* 3. download must actually be implemented, not just declared */
const handlerSrc = read('lib/handler.js');
const dIdx = handlerSrc.indexOf('download: async');
ok('download is implemented (not a stub)', dIdx !== -1, 'no implementation');
if (dIdx !== -1) {
  const body = handlerSrc.slice(dIdx, dIdx + 2200);
  ok('download resolves media from the quoted message', /quotedMessage/.test(body));
  ok('download calls the real Baileys downloader', /downloadMediaMessage/.test(body));
  ok('download throws a clear error with no media', /throw new Error/.test(body));
}

/* 4. the suites must not paper over a missing download
      — any suite that fakes it must ALSO assert the engine fails cleanly without it */
console.log('');
const suites = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('-test.cjs'));
const injecting = [];
for (const file of suites) {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
  if (/download:\s*async/.test(src)) injecting.push(file);
}
ok(
  'suites that fake ctx.download do so only because production provides a real one',
  contract.has('download'),
  'production has no download, so any suite faking it is testing fiction',
);

/* 5. engines must not call ctx.download without handling the throw */
console.log('');
const converter = read('lib/engines/converter.js');
ok('converter wraps its download calls in try/catch', /try\s*\{\s*(const buf = )?await ctx\.download\(\)/.test(converter) || /return \{ error: /.test(converter));

const total = pass + fails.length;
console.log(`\n${pass}/${total} passed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((f) => console.log('  \u2022 ' + f));
  process.exit(1);
}
