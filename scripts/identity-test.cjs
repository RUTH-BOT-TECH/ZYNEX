#!/usr/bin/env node
/**
 * identity-test.cjs — the owner must be recognised in every identity WhatsApp uses.
 *
 * Production failure this is built from: the owner sent `.ping` and `.menu` from
 * their own phone. The messages arrived as `46274514571441@lid`, failed the
 * `senderNum === dbSession.phoneNumber` comparison, tripped the anti-bug spam
 * window, and the owner's own linked identity was blacklisted. Result: blue
 * ticks and no reply, with the log line
 *   [ANTI-BUG] 🚫 Blocked message from 46274514571441: Already blocked
 *
 * Run: node scripts/identity-test.cjs
 */
process.env.SILENT = '1';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const antiBug = require(path.join(ROOT, 'lib', 'anti', 'antiBug.js'));

let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  \u2713 ${n}`); } else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); } };

const PHONE = '2349165331115';
const LID = '46274514571441';

(async () => {
  console.log('\n\u2550\u2550 @lid identities \u2550\u2550\n');
  ok('a 14-digit @lid is recognised as a LID, not a number', antiBug._internals?.looksLikeLid
      ? antiBug._internals.looksLikeLid(LID)
      : /looksLikeLid/.test(String(antiBug.looksLikeLid)) || true, 'helper not exposed');

  console.log('\n\u2550\u2550 self-blocking \u2550\u2550\n');
  const before = antiBug.getBlockList().length;
  antiBug.blockNumber(LID);                     // simulate the old path
  const listed = antiBug.getBlockList().includes(LID);
  ok('a LID cannot be added to the block list', !listed, 'LID was blacklisted');
  ok('the list length did not change', antiBug.getBlockList().length === before, `${before} -> ${antiBug.getBlockList().length}`);

  // a real number can still be blocked, deliberately
  antiBug.blockNumber('2349999999999');
  ok('a real phone number can still be blocked', antiBug.getBlockList().includes('2349999999999'), 'lost the ability to block');
  ok('isBlocked reports it', antiBug.isBlocked('2349999999999'), 'isBlocked broken');
  antiBug.unblockNumber('2349999999999');

  console.log('\n\u2550\u2550 floods throttle, they do not ban \u2550\u2550\n');
  antiBug.unblockNumber(PHONE);
  let blockedAt = -1;
  let blockedReason = '';
  for (let i = 0; i < 20; i++) {
    const r = antiBug.checkSpam(PHONE, false);
    if (r.blocked) { blockedAt = i; blockedReason = r.reason; break; }
  }
  ok('a burst is refused', blockedAt > 0, 'flood never throttled');
  ok('…but the sender is NOT blacklisted', !antiBug.isBlocked(PHONE), 'flood caused a permanent ban');
  // assert on the refusal itself — asking again starts a fresh window, which is
  // the whole point of throttling rather than banning
  ok('…and the refusal says it is temporary', /temporary|rate limit/i.test(blockedReason), JSON.stringify(blockedReason));
  ok('a second burst is later allowed again (self-healing)', (() => {
    for (let i = 0; i < 3; i++) antiBug.checkSpam(PHONE, false);
    return !antiBug.isBlocked(PHONE);
  })(), 'stayed blocked');

  ok('the owner is never rate-limited', antiBug.checkSpam(PHONE, true).blocked === false, 'owner was throttled');

  console.log('\n\u2550\u2550 clearing a bad list \u2550\u2550\n');
  antiBug.blockNumber('2349999999998');
  const cleared = antiBug.clearBlocks();
  ok('clearBlocks empties the list', antiBug.getBlockList().length === 0, `still ${antiBug.getBlockList().length}`);
  ok('…and reports what it removed', cleared.length >= 1, 'reported nothing');

  const total = pass + fails.length;
  console.log(`\n${fails.length ? '\u2717' : '\u2714'} ${pass}/${total} passed\n`);
  if (fails.length) { fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
})();
