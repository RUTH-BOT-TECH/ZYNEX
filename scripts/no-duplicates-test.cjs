/**
 * scripts/no-duplicates-test.cjs — every command name must have one clear owner.
 *
 * Why this exists: a name claimed twice is a coin flip decided by load order.
 * Overlaps between *aliases* are allowed when both sides are real
 * implementations, because the loser is still reachable under its own name. An
 * overlap where the loser is a stub, or where the two differ in what they need
 * (text vs image), is a bug.
 *
 * `rainbow` is the counterexample worth writing down. It used to be listed
 * here as a "photo overlay effect", but overlay.js never claimed it: the
 * renderer is a TEXT LOGO in lib/logostyles.js (`.rainbow <words>`). Overlay
 * effects need a quoted photo; rainbow needs a word. Forbidding the text
 * engine from claiming it left `.rainbow` as a dead "isn't wired up yet"
 * stub while its renderer was sitting right there.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.SILENT = '1';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`✔ ${name}`); pass++; }
  catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
};

const claims = new Map();
const add = (name, owner) => {
  const n = String(name).trim().toLowerCase();
  if (!n) return;
  if (!claims.has(n)) claims.set(n, []);
  const list = claims.get(n);
  if (!list.includes(owner)) list.push(owner);
};

for (const f of fs.readdirSync(path.join(ROOT, 'lib/commands'))) {
  if (!f.endsWith('.js')) continue;
  let mod;
  try { mod = require(path.join(ROOT, 'lib/commands', f)); } catch { continue; }
  const owner = `commands/${f}`;
  const list = Array.isArray(mod) ? mod : [mod];
  for (const m of list) {
    if (!m || !m.name) continue;
    add(m.name, owner);
    (m.aliases || []).forEach((a) => add(a, owner));
  }
}

const engines = [];
for (const f of fs.readdirSync(path.join(ROOT, 'lib/engines'))) {
  if (!f.endsWith('.js')) continue;
  let e;
  try { e = require(path.join(ROOT, 'lib/engines', f)); } catch { continue; }
  if (!e || typeof e.match !== 'function') continue;
  engines.push({ file: f, engine: e });
  for (const n of e.extraNames || []) add(n, `engines/${f}`);
}

const overlaps = [...claims.entries()].filter(([, o]) => o.length > 1);

t('no command name is claimed by two engines', () => {
  // The registry picks the first engine whose match() returns true, so two
  // engines claiming one name means one of them is invisible.
  const bad = overlaps.filter(([, owners]) => owners.filter((o) => o.startsWith('engines/')).length > 1);
  assert.deepStrictEqual(bad.map(([n, o]) => `${n}: ${o.join(' + ')}`), []);
});

t('the text engine does not claim photo-overlay effects', () => {
  const text = engines.find((e) => e.file === 'text.js');
  assert.ok(text, 'text engine not found');
  // Every one of these needs a quoted PHOTO (overlay.js owns them). rainbow
  // is a text logo drawn from a word, so it deliberately is not in this list.
  for (const n of ['wasted', 'jail', 'triggered', 'rip', 'trash', 'facepalm', 'beautiful', 'jokeoverhead']) {
    assert.ok(!text.engine.match(n), `text engine claims "${n}", which needs a quoted photo`);
  }
});

t('rainbow has exactly one owner, and it is not a stub', () => {
  const text = engines.find((e) => e.file === 'text.js');
  const ov = engines.find((e) => e.file === 'overlay.js');
  assert.ok(text.engine.match('rainbow'), 'text engine lost rainbow — the command is a dead stub again');
  assert.ok(!ov.engine.match('rainbow'), 'overlay would demand a quoted photo for a text logo');
  const registry = require(path.join(ROOT, 'lib/registry'));
  const entry = registry.get('rainbow');
  assert.notStrictEqual(entry.source, 'fallback', '.rainbow resolves to a stub');
});

t('the overlay engine does not claim text styles or existing commands', () => {
  const ov = engines.find((e) => e.file === 'overlay.js');
  assert.ok(ov, 'overlay engine not found');
  for (const n of ['bold', 'mono', 'upside', 'sticker', 'tourl', 'delete', 'kiss', 'hug', 'slap']) {
    assert.ok(!ov.engine.match(n), `overlay engine claims "${n}", which something real owns`);
  }
});

t('no claimed name resolves to a stub', () => {
  const registry = require(path.join(ROOT, 'lib/registry'));
  const stubs = [];
  for (const name of claims.keys()) {
    const e = registry.get(name);
    if (e && e.source === 'fallback') stubs.push(name);
  }
  assert.deepStrictEqual(stubs.slice(0, 10), [],
    `claimed names resolving to a stub: ${stubs.slice(0, 10).join(', ')}`);
});

t('the known-safe alias overlaps are exactly the ones we accepted', () => {
  // If a new overlap appears, this test fails and someone has to decide who
  // owns the name instead of letting load order decide.
  const ACCEPTED = new Set([
    'alive', 'caesar', 'everyone', 'open', 'ping',
    'status', 'stop', 'story', 'vigenere',
  ]);
  const unexpected = overlaps.map(([n]) => n).filter((n) => !ACCEPTED.has(n));
  assert.deepStrictEqual(unexpected, [],
    `new duplicate name(s): ${unexpected.join(', ')} — pick an owner`);
});

console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed  (${claims.size} names, ${overlaps.length} accepted overlaps)`);
process.exit(fail === 0 ? 0 : 1);
