/**
 * ZYNEX-MD — Dynamic Command Registry
 *
 * The bot ships a 1,918-name catalogue. Most of those are not separate
 * implementations — they're aliases that route into a shared engine.
 *
 *   one engine  →  many command names  →  zero duplicated code
 *
 * Priority when resolving a command name:
 *   1. A dedicated file in lib/commands/        (hand-written, wins)
 *   2. A dynamic family in lib/engines/          (covers the catalogue)
 *   3. A generic fallback                        (never silently dead)
 *
 * The fallback matters: a command that exists in the catalogue but has no
 * implementation yet must SAY SO, not vanish. Silent no-ops look like a crash
 * to the user.
 */
const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, 'commands');
const ENGINES_DIR = path.join(__dirname, 'engines');
const CATALOGUE_DIR = path.join(__dirname, 'catalogue');

/* ── 1. load the catalogue ─────────────────────────────────── */
let CATALOGUE = { commands: {}, flat: [] };
try {
  CATALOGUE = require(path.join(CATALOGUE_DIR, 'commands.js'));
} catch (e) {
  console.warn('[REGISTRY] catalogue/commands.js missing — falling back to files only');
}

// extra names that only existed in the .txt list
let EXTRA = [];
try {
  EXTRA = fs
    .readFileSync(path.join(CATALOGUE_DIR, 'union.txt'), 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
} catch { /* optional */ }

// Names the engines support directly (some may not be in the catalogue)
const ENGINES = loadEngines();
const ENGINE_EXTRA = ENGINES.flatMap((e) => e.extraNames || []);

const ALL_NAMES = [...new Set([...CATALOGUE.flat, ...EXTRA, ...ENGINE_EXTRA])].sort();

/* ── 2. category for every name (from catalogue groupings) ──── */
const NAME_TO_CATEGORY = new Map();
for (const [cat, list] of Object.entries(CATALOGUE.commands || {})) {
  for (const n of list) if (!NAME_TO_CATEGORY.has(n)) NAME_TO_CATEGORY.set(n, cat);
}
for (const n of EXTRA) if (!NAME_TO_CATEGORY.has(n)) NAME_TO_CATEGORY.set(n, 'misc');

/* ── 3. load engines (needed before ALL_NAMES) ─────────────── */
function loadEngines() {
  if (!fs.existsSync(ENGINES_DIR)) return [];
  return fs
    .readdirSync(ENGINES_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      try {
        const mod = require(path.join(ENGINES_DIR, f));
        return Array.isArray(mod) ? mod : [mod];
      } catch (e) {
        console.error(`[REGISTRY] engine ${f} failed to load: ${e.message}`);
        return [];
      }
    })
    .flat()
    .filter((e) => e && typeof e.match === 'function' && typeof e.execute === 'function');
}

/* ── 4. load hand-written commands (highest priority) ──────── */
function loadCommandFiles() {
  const map = new Map();
  if (!fs.existsSync(COMMANDS_DIR)) return map;
  for (const f of fs.readdirSync(COMMANDS_DIR)) {
    if (!f.endsWith('.js')) continue;
    try {
      const cmd = require(path.join(COMMANDS_DIR, f));
      if (!cmd?.name) continue;
      map.set(cmd.name.toLowerCase(), cmd);
      for (const a of cmd.aliases || []) map.set(String(a).toLowerCase(), cmd);
    } catch (e) {
      console.error(`[REGISTRY] command ${f} failed to load: ${e.message}`);
    }
  }
  return map;
}

/* ── 5. build the index ────────────────────────────────────── */
const FILE_COMMANDS = loadCommandFiles();
const INDEX = new Map(); // name -> entry

for (const name of ALL_NAMES) {
  const category = NAME_TO_CATEGORY.get(name) || 'misc';

  // 1. hand-written command wins
  if (FILE_COMMANDS.has(name)) {
    INDEX.set(name, { ...FILE_COMMANDS.get(name), source: 'file', catalogueName: name });
    continue;
  }

  // 2. engine that claims this name
  const engine = ENGINES.find((e) => {
    try { return e.match(name, category); } catch { return false; }
  });
  if (engine) {
    INDEX.set(name, {
      name,
      category,
      desc: engine.describe ? engine.describe(name) : `${category} · ${name}`,
      source: 'engine',
      engine: engine.id || engine.name,
      execute: (ctx) => engine.execute({ ...ctx, command: name, category }),
    });
    continue;
  }

  // 3. honest fallback
  INDEX.set(name, {
    name,
    category,
    desc: `${category} · ${name}`,
    source: 'fallback',
    execute: async ({ reply, prefix }) => {
      await reply(
        `🚧 *${prefix}${name}* isn't wired up yet.\n\n` +
          `It's in the command catalogue (${category}) but has no implementation.\n` +
          `_${prefix}menu all_ shows what works today.`,
      );
    },
  });
}

// file-only commands that aren't in the catalogue still work
for (const [name, cmd] of FILE_COMMANDS) {
  if (!INDEX.has(name)) INDEX.set(name, { ...cmd, source: 'file' });
}

/* ── 6. public API ─────────────────────────────────────────── */
const commands = [...INDEX.keys()];

const enginesUsed = new Map();
for (const [, e] of INDEX) {
  if (e.source === 'engine') enginesUsed.set(e.engine, (enginesUsed.get(e.engine) || 0) + 1);
}

const stats = {
  total: commands.length,
  catalogue: ALL_NAMES.length,
  bySource: {
    file: [...INDEX.values()].filter((e) => e.source === 'file').length,
    engine: [...INDEX.values()].filter((e) => e.source === 'engine').length,
    fallback: [...INDEX.values()].filter((e) => e.source === 'fallback').length,
  },
  byEngine: Object.fromEntries(enginesUsed),
};

const get = (name) => INDEX.get(String(name || '').toLowerCase()) || null;
const has = (name) => INDEX.has(String(name || '').toLowerCase());

function list() {
  return [...INDEX.values()].map((e) => ({
    name: e.name,
    category: e.category,
    desc: e.desc,
    source: e.source,
    engine: e.engine,
  }));
}

function byCategory() {
  const out = {};
  for (const e of INDEX.values()) (out[e.category] ||= []).push(e);
  for (const c of Object.keys(out)) out[c].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

module.exports = { get, has, list, byCategory, stats, commands, ALL_NAMES };
