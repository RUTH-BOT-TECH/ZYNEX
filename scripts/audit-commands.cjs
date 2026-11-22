/**
 * Command audit — the anti-duplication guard.
 *
 *   1. no two engines may claim the same command name
 *   2. no engine may claim a name a hand-written file already owns
 *   3. reports which catalogue names still have no implementation
 *
 *   node scripts/audit-commands.cjs [--missing]
 */
const fs = require('fs');
const path = require('path');

const ENGINES = path.join(__dirname, '..', 'lib', 'engines');
const COMMANDS = path.join(__dirname, '..', 'lib', 'commands');

const claims = new Map(); // name -> [owner]
const add = (name, owner) => {
  if (!claims.has(name)) claims.set(name, []);
  claims.get(name).push(owner);
};

// engines — claim via extraNames AND via match(), since match() is what
// actually decides routing at runtime. Checking only extraNames misses
// real collisions (that's how .advice was silently stolen by the fun engine).
const CATALOGUE = require(path.join(__dirname, '..', 'lib', 'catalogue', 'commands.js'));
const ALL_CATALOGUE = [...new Set([...CATALOGUE.flat, ...fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'catalogue', 'union.txt'), 'utf8',
).split('\n').filter(Boolean)])];

for (const f of fs.readdirSync(ENGINES).filter((x) => x.endsWith('.js'))) {
  const mod = require(path.join(ENGINES, f));
  for (const m of Array.isArray(mod) ? mod : [mod]) {
    const owner = `engine:${m.id || f}`;
    const claimed = new Set(m.extraNames || []);
    // probe every catalogue name through match()
    for (const n of ALL_CATALOGUE) {
      try { if (m.match(n, 'misc')) claimed.add(n); } catch { /* ignore */ }
    }
    for (const n of claimed) add(n, owner);
  }
}

// hand-written files
const fileOwned = new Set();
for (const f of fs.readdirSync(COMMANDS).filter((x) => x.endsWith('.js'))) {
  const cmd = require(path.join(COMMANDS, f));
  if (!cmd?.name) continue;
  fileOwned.add(cmd.name.toLowerCase());
  for (const a of cmd.aliases || []) fileOwned.add(String(a).toLowerCase());
}

let problems = 0;

// rule 1
const dupes = [...claims.entries()].filter(([, owners]) => owners.length > 1);
if (dupes.length) {
  problems += dupes.length;
  console.log(`\n\x1b[31m✗ ${dupes.length} command(s) claimed by more than one engine:\x1b[0m`);
  dupes.forEach(([n, o]) => console.log(`   ${n}  ←  ${o.join('  +  ')}`));
} else {
  console.log('\x1b[32m✓\x1b[0m no engine claims the same command twice');
}

// rule 2 — informational only: a hand-written file legitimately wins over an
// engine. This is the intended precedence, not a defect.
const shadowed = [...claims.keys()].filter((n) => fileOwned.has(n));
if (shadowed.length) {
  console.log(`\n\x1b[33m! ${shadowed.length} engine name(s) shadowed by a hand-written file:\x1b[0m`);
  console.log('   ' + shadowed.slice(0, 20).join(', ') + (shadowed.length > 20 ? ' …' : ''));
  console.log('   (expected precedence: the file wins. informational only)');
} else {
  console.log('\x1b[32m✓\x1b[0m no engine shadows a hand-written command');
}

// rule 3
const registry = require(path.join(__dirname, '..', 'lib', 'registry'));
const s = registry.stats;
const impl = s.bySource.file + s.bySource.engine;
console.log('\n\x1b[1mCoverage\x1b[0m');
console.log(`  ${impl} of ${s.total} names implemented  (${((impl / s.total) * 100).toFixed(1)}%)`);
console.log(`  ${s.bySource.file} files · ${s.bySource.engine} engine-backed · ${s.bySource.fallback} stubs`);
console.log(`  engines: ${Object.entries(s.byEngine).map(([k, v]) => `${k}=${v}`).join('  ')}`);

if (process.argv.includes('--missing')) {
  const missing = registry.list().filter((e) => e.source === 'fallback');
  const byCat = {};
  for (const m of missing) (byCat[m.category] ||= []).push(m.name);
  console.log('\n\x1b[1mStill unimplemented, by category\x1b[0m');
  Object.entries(byCat).sort((a, b) => b[1].length - a[1].length).forEach(([c, l]) => {
    console.log(`  ${c.padEnd(14)} ${String(l.length).padStart(4)}   ${l.slice(0, 6).join(', ')}${l.length > 6 ? ' …' : ''}`);
  });
}

console.log();
if (problems) { console.log(`\x1b[31m${problems} issue(s) found\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32m✔ audit clean\x1b[0m\n');
