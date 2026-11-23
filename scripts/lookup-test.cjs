/**
 * scripts/lookup-test.cjs — keyless public-data commands.
 *
 * These hit real, free APIs, so tests must not fail because the network is
 * down. Offline checks cover the banding logic and the refusal paths (which is
 * where a silent wrong answer would hide); live checks are skipped, not failed,
 * when the upstream is unreachable.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'lib/engines/lookup.js'));
const { aqiBand, uvBand } = engine._internal;

let pass = 0, fail = 0, skipped = 0;

async function t(name, fn) {
  try { await fn(); console.log(`✔ ${name}`); pass++; }
  catch (e) {
    if (e && e.skipped) { console.log(`⊘ ${name} — ${e.message}`); skipped++; return; }
    console.log(`✗ ${name}  ❌ ${e.message}`); fail++;
  }
}

async function run(command, argString) {
  let said = null;
  await engine.execute({
    command,
    args: String(argString || '').split(' ').filter(Boolean),
    argString: String(argString || ''),
    reply: (x) => { said = typeof x === 'string' ? x : JSON.stringify(Object.keys(x)); return Promise.resolve(); },
  });
  return said;
}

/* ── banding: the part a user actually reads ──────────────── */
(async () => {
  await t('AQI breaks at every EPA boundary', () => {
    assert.strictEqual(aqiBand(0).label, 'Good');
    assert.strictEqual(aqiBand(50).label, 'Good');
    assert.strictEqual(aqiBand(51).label, 'Moderate');
    assert.strictEqual(aqiBand(100).label, 'Moderate');
    assert.strictEqual(aqiBand(101).label, 'Unhealthy for sensitive groups');
    assert.strictEqual(aqiBand(151).label, 'Unhealthy');
    assert.strictEqual(aqiBand(201).label, 'Very unhealthy');
    assert.strictEqual(aqiBand(301).label, 'Hazardous');
  });

  await t('every AQI band carries advice, not just a colour', () => {
    for (const v of [10, 75, 125, 175, 250, 400]) {
      assert.ok(aqiBand(v).advice.length > 10, `band ${v} has no advice`);
    }
  });

  await t('UV breaks at the WHO boundaries', () => {
    assert.strictEqual(uvBand(0).label, 'Low');
    assert.strictEqual(uvBand(2.9).label, 'Low');
    assert.strictEqual(uvBand(3).label, 'Moderate');
    assert.strictEqual(uvBand(6).label, 'High');
    assert.strictEqual(uvBand(8).label, 'Very high');
    assert.strictEqual(uvBand(11).label, 'Extreme');
  });

  /* ── refusal paths ──────────────────────────────────────── */
  await t('aqi with no city asks for one instead of guessing Lagos', async () => {
    const out = await run('aqi', '');
    assert.ok(/Give me a city|failed/i.test(out), out);
  });

  await t('pronounce rejects a non-word', async () => {
    const out = await run('pronounce', '!!!');
    assert.ok(/not look like a single word/i.test(out), out);
  });

  await t('pronounce asks which word when given none', async () => {
    const out = await run('pronounce', '');
    assert.ok(/Which word/i.test(out), out);
  });

  await t('a failure names the upstream and never says just "error"', async () => {
    const out = await run('aqi', 'zzzzqqqxxnotaplace');
    assert.ok(/failed/i.test(out), out);
    assert.ok(/Open-Meteo|could not find|timed out|HTTP/i.test(out), `no cause given: ${out}`);
  });

  /* ── live checks (skipped, not failed, when offline) ───── */
  await t('[live] aqi returns a graded reading for Lagos', async () => {
    const out = await run('aqi', 'Lagos');
    if (/failed/i.test(out)) {
      if (/timed out|ENOTFOUND|EAI_AGAIN|network/i.test(out)) throw Object.assign(new Error('network unavailable'), { skipped: true });
      throw new Error(`live aqi failed: ${out}`);
    }
    assert.match(out, /AQI: \*\d+\*/);
    assert.match(out, /(Good|Moderate|Unhealthy|Very unhealthy|Hazardous)/);
  });

  await t('[live] uv returns index and peak for Lagos', async () => {
    const out = await run('uv', 'Lagos');
    if (/failed/i.test(out)) {
      if (/timed out|ENOTFOUND|EAI_AGAIN|network/i.test(out)) throw Object.assign(new Error('network unavailable'), { skipped: true });
      throw new Error(`live uv failed: ${out}`);
    }
    assert.match(out, /Now: \*\d/);
  });

  await t('[live] earthquake returns magnitudes or an honest quiet week', async () => {
    const out = await run('earthquake', '3');
    if (/failed/i.test(out)) {
      if (/timed out|ENOTFOUND|EAI_AGAIN|network/i.test(out)) throw Object.assign(new Error('network unavailable'), { skipped: true });
      throw new Error(`live earthquake failed: ${out}`);
    }
    assert.ok(/M\d\.\d|Quiet week/.test(out), out);
  });

  await t('[live] pronounce returns phonetic text', async () => {
    const out = await run('pronounce', 'schedule');
    if (/failed/i.test(out)) {
      if (/timed out|ENOTFOUND|EAI_AGAIN|network/i.test(out)) throw Object.assign(new Error('network unavailable'), { skipped: true });
      throw new Error(`live pronounce failed: ${out}`);
    }
    assert.match(out, /schedule/);
  });

  /* ── plumbing ──────────────────────────────────────────── */
  await t('engine claims only names it implements', () => {
    for (const n of ['aqi', 'uv', 'earthquake', 'pronounce']) assert.ok(engine.match(n), `${n} unclaimed`);
    // excluded by request — must stay unclaimed
    for (const n of ['phonetic', 'ffinfolike', 'fflike', 'stalk', 'wasted', 'jail']) {
      assert.ok(!engine.match(n), `${n} must not be claimed by this engine`);
    }
  });

  await t('every claimed name replies, never silence', async () => {
    for (const name of engine.extraNames) {
      const out = await run(name, '');
      assert.ok(out !== null && out !== undefined, `${name} replied nothing`);
    }
  });

  console.log(`\n${fail === 0 ? '✔' : '✗'} ${pass}/${pass + fail} passed${skipped ? ` (${skipped} skipped — network)` : ''}`);
  process.exit(fail === 0 ? 0 : 1);
})();
