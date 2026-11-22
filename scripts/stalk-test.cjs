#!/usr/bin/env node
/**
 * stalk-test.cjs — public-profile lookups must return real data, and the
 * private-person lookups must refuse rather than invent.
 *
 * The important assertions here are the boundaries:
 *   - `.waexists` / `.waprofile` / `.checkwa` / `.wanumber` must NEVER claim to
 *     know whether a number is on WhatsApp.
 *   - Instagram / TikTok / Twitter / Telegram / PUBG / Genshin must say they have
 *     no keyless source, and point at the ones that work.
 *   - `.numinfo` may report a country and a network prefix, and must not claim to
 *     identify an owner.
 *
 * Run: node scripts/stalk-test.cjs      (npm run test:stalk)
 */
process.env.SILENT = '1';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const stalk = require(path.join(ROOT, 'lib', 'engines', 'stalk.js'));
const registry = require(path.join(ROOT, 'lib', 'registry.js'));

let pass = 0;
const fails = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log(`  \u2713 ${n}`); }
  else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); }
};

let sent = [];
async function run(command, args = []) {
  sent = [];
  await stalk.execute({
    command, args, from: '120363400000000002@g.us', sender: '2348111000006@s.whatsapp.net',
    msg: { key: {}, message: {} }, prefix: '.',
    sock: { sendMessage: async (j, c) => { sent.push(c); return {}; } },
    reply: async (t) => { sent.push({ text: String(t) }); return {}; },
  });
  const m = sent[sent.length - 1] || {};
  return String(m.caption || m.text || '');
}

(async () => {
  console.log('\n\u2550\u2550 Stalk engine \u2550\u2550\n');

  /* ── 1. routing ── */
  const cat = registry.byCategory()['stalk'] || [];
  const missing = cat.filter((o) => o.source === 'fallback').map((o) => o.name);
  ok(`all ${cat.length} catalogue stalk names are implemented`, missing.length === 0, missing.join(' '));
  const misrouted = stalk.extraNames.filter((n) => {
    const o = registry.get(n);
    return !o || (o.engine || o.source) !== 'stalk';
  });
  ok(`every declared name routes here (${stalk.extraNames.length})`, misrouted.length === 0, misrouted.join(' '));

  /* ── 2. number parsing (offline) ── */
  console.log('');
  const { parseNumber, numberShape } = stalk._internals;
  const ng = parseNumber('08031234567');
  ok('parses a Nigerian local number to +234', ng.country === 'Nigeria' && ng.e164 === '+2348031234567', JSON.stringify(ng));
  const uk = parseNumber('+447700900123');
  ok('parses +44 as UK', uk.country === 'UK' && uk.cc === '44');
  ok('rejects an all-same-digit number', numberShape('1111111').ok === false);
  ok('rejects a too-short number', numberShape('123').ok === false);

  /* ── 3. WhatsApp lookups must refuse, always ── */
  console.log('');
  for (const cmd of ['waexists', 'waprofile', 'checkwa', 'wanumber', 'wastalk']) {
    const out = await run(cmd, ['2348031234567']);
    const refuses = /cannot do|deliberate|not something/i.test(out);
    // It may *discuss* registration; what it must never do is assert an answer
    // about this specific number.
    const assertsResult = /(is|is not|isn't) (on|registered on) whatsapp|found: yes|exists: (true|yes)|status:\s*(active|registered)/i.test(out);
    const namesAlt = /numinfo|scan/.test(out);
    ok(`.${cmd} refuses and asserts nothing about the number`, refuses && !assertsResult && namesAlt, out.replace(/\n/g, ' ').slice(0, 70));
  }

  /* ── 4. private social platforms must refuse ── */
  console.log('');
  for (const cmd of ['igstalk', 'ttstalk', 'twstalk', 'tgstalk', 'pinstalk', 'redditstalk', 'steamstalk', 'robloxstalk', 'pubgstalk', 'genshinstalk', 'ffstalk', 'mlstalk']) {
    const out = await run(cmd, ['someuser']);
    const refuses = /cannot be read|no keyless public API|403/i.test(out);
    const namesAlt = /ghstalk|npmstalk|chessstalk|lichestalk|spotifystalk|telestalk/.test(out);
    ok(`.${cmd} refuses and points at working lookups`, refuses && namesAlt, out.replace(/\n/g, ' ').slice(0, 70));
  }

  /* ── 5. live public profiles ── */
  console.log('');
  const checks = [
    ['ghstalk', ['torvalds'], /Linus Torvalds/, /Followers/],
    ['npmstalk', ['express'], /express/, /Latest/],
    ['chessstalk', ['hikaru'], /Hikaru|hikaru/, /Blitz/],
    ['lichestalk', ['thibault'], /thibault/, /Games/],
  ];
  for (const [cmd, args, who, field] of checks) {
    const out = await run(cmd, args);
    ok(`.${cmd} ${args[0]} returns the real profile`, who.test(out) && field.test(out) && !/failed|❌/.test(out), out.replace(/\n/g, ' ').slice(0, 80));
    ok(`.${cmd} labels itself as public-profile data`, /public profile data only/i.test(out));
  }

  /* ── 6. a handle that doesn't exist says so, it doesn't crash ── */
  console.log('');
  const missingUser = await run('ghstalk', ['this-user-should-not-exist-zz9x7q']);
  ok('.ghstalk on a missing handle says not found', /No .*account|not found/i.test(missingUser), missingUser.slice(0, 60));

  /* ── 7. .numinfo reports digits only, and says what it will not do ── */
  console.log('');
  const info = await run('numinfo', ['08031234567']);
  ok('.numinfo identifies the country', /Nigeria/.test(info));
  ok('.numinfo names the network prefix for a Nigerian number', /MTN/.test(info));
  ok('.numinfo explicitly refuses ownership lookup', /not.*tell you who owns|does \*not\* do/i.test(info), info.slice(-80));
  ok('.numinfo does not print a person name', !/owner:|name:/i.test(info));

  /* ── 8. country codes (offline) ── */
  console.log('');
  ok('.countrycode nigeria -> +234', /\+234/.test(await run('countrycode', ['nigeria'])));
  ok('.countrycode kenya -> +254', /\+254/.test(await run('countrycode', ['kenya'])));
  ok('.countrycode on nonsense says so', /no dial code/i.test(await run('countrycode', ['zzzznotacountry'])));

  const total = pass + fails.length;
  console.log(`\n${pass}/${total} passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    fails.forEach((f) => console.log('  \u2022 ' + f));
    process.exit(1);
  }
})();
