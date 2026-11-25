/**
 * lib/commandHint.js — keep usage hints honest when PREFIX is not ".".
 *
 * The bot supports `dbSession.prefix` / `PREFIX`, but ~100 engine strings
 * hardcoded example commands as `*.menu*`, `` `.play` ``, `Use .resize 800`,
 * etc. A user who changed the prefix saw instructions that could never work.
 *
 * We don't rewrite every dot: URLs (`example.com`), decimals (`1.5`) and
 * filenames (`.env`) must survive. Only a dot followed by a KNOWN command
 * name, in a position that looks like a command hint, is replaced. With the
 * default prefix "." the text is returned untouched (zero behaviour change).
 */
// registry.ALL_NAMES includes the catalogue AND engine-only subcommands
// (.place, .drop, .hint, .answer, .board, .resign, .fill, …) — those are the
// ones most often printed in usage hints.
const { ALL_NAMES } = require('./registry');
const { flat } = require('./catalogue/commands');

const KNOWN = new Set([
  ...ALL_NAMES,
  ...flat,
].map((x) => String(x).toLowerCase()));

/** A hint starts at a word boundary, or inside `*bold*` / `` `code` ``. */
const HINT = /(^|[\s(*`])\.([a-z][a-z0-9_]*)(?=[\s*`.,!?:;)\]}]|$)/g;

function withPrefix(text, prefix = '.') {
  if (typeof text !== 'string' || !prefix || prefix === '.') return text;
  return text.replace(HINT, (whole, lead, name) => (
    KNOWN.has(name) ? `${lead}${prefix}${name}` : whole
  ));
}

module.exports = { withPrefix, KNOWN };
