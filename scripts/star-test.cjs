/**
 * scripts/star-test.cjs — the star affordance must be honest.
 *
 * GitHub has no anonymous star endpoint: PUT /user/starred/{owner}/{repo}
 * answers 401 without a token, and buttons.github.io is a link with a count.
 * So the only correct implementation is a live count plus a link to the repo.
 *
 * These tests fail if anything starts pretending to star on a visitor's behalf,
 * or if the page points somewhere other than the real repository.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const star = require(path.join(ROOT, 'lib/star.js'));
const info = require(path.join(ROOT, 'lib/botInfo.js'));
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

t('slug is parsed from the real repo URL', () => {
  assert.strictEqual(star.repoSlug(), 'RUTH-BOT-TECH/ZYNEX');
});

t('slug parsing tolerates .git and trailing slashes', () => {
  assert.strictEqual(star.repoSlug('https://github.com/a/b.git'), 'a/b');
  assert.strictEqual(star.repoSlug('https://github.com/a/b/'), 'a/b');
  assert.strictEqual(star.repoSlug('git@github.com:a/b.git'), 'a/b');
  assert.strictEqual(star.repoSlug('https://gitlab.com/a/b'), null);
});

t('the star link is the repository, not a fake star endpoint', () => {
  assert.strictEqual(star.starUrl(), info.REPO_URL);
});

t('no code claims it can star without a token', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/star.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // A PUT to /user/starred from this module would 401 for every visitor.
  assert.ok(!/method:\s*['"]PUT['"]/i.test(code), 'star.js performs an unauthenticated PUT');
  assert.ok(!/user\/starred/.test(code), 'star.js calls the authenticated star endpoint');
});

t('the page links to the real repository', () => {
  const m = PAGE.match(/id="repoLink"[^>]*href="([^"]+)"/);
  assert.ok(m, 'no repoLink on the page');
  assert.strictEqual(m[1], info.REPO_URL);
});

t('the page renders a live count, not a hardcoded one', () => {
  assert.ok(/id="repoLabel"/.test(PAGE), 'no label element to update');
  assert.ok(/paintRepo/.test(PAGE), 'no paint function');
  assert.ok(/info\.stars/.test(PAGE), 'the count does not come from the API');
});

t('the page does not invent a count when the API gives none', () => {
  // null must mean "no number", not fall back to 0 or a guess
  assert.ok(/n === null/.test(PAGE), 'no null branch for a missing count');
});

t('the count is painted before the password gate', () => {
  const fn = PAGE.slice(PAGE.indexOf('async function loadSessions'));
  const paintAt = fn.indexOf('paintRepo(d)');
  const gateAt = fn.indexOf('!d.authorized');
  assert.ok(paintAt !== -1 && gateAt !== -1 && paintAt < gateAt,
    'the star count is hidden behind the password prompt');
});

t('/api/status exposes repo and stars', () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/repo:\s*REPO_URL/.test(srv), 'server does not expose the repo URL');
  assert.ok(/stars:\s*star\s*\?/.test(srv), 'server does not expose the star count');
});

t('[live] the count is a real number from GitHub', async () => {
  star._clear();
  const v = await star.starCount();
  if (v === null) { console.log('   ⊘ skipped — GitHub unreachable or rate limited'); return; }
  assert.strictEqual(v.slug, 'RUTH-BOT-TECH/ZYNEX');
  assert.strictEqual(typeof v.stars, 'number');
  assert.ok(v.stars >= 0);
});

t('a missing repo yields null, never a wrong number', async () => {
  // simulate the API being unreachable
  const axios = require('axios');
  const orig = axios.get;
  axios.get = async () => { throw new Error('simulated network failure'); };
  star._clear();
  try {
    const v = await star.starCount();
    assert.strictEqual(v, null, 'a failed lookup must not produce a count');
  } finally { axios.get = orig; star._clear(); }
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`✔ ${name}`); pass++; }
    catch (e) { console.log(`✗ ${name}  ❌ ${e.message}`); fail++; }
  }
  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
