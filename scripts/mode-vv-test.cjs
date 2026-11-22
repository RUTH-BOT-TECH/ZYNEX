#!/usr/bin/env node
/**
 * mode-vv-test.cjs — two commands that looked dead, and the invariants behind them.
 *
 * `.vv` recognised one of six wrappers WhatsApp actually uses, and even that one
 * failed to download. `.private` ignored non-owners *silently*, which is
 * indistinguishable from a broken bot.
 *
 * Run: node scripts/mode-vv-test.cjs
 */
process.env.SILENT = '1';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const vv = require(path.join(ROOT, 'lib', 'commands', 'vv.js'));
const { handleMessage } = require(path.join(ROOT, 'lib', 'handler.js'));

let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  \u2713 ${n}`); } else { fails.push(`${n} :: ${d}`); console.log(`  \u2717 ${n}   ${d}`); } };

const MEDIA = Buffer.from('x'.repeat(64));
const wrap = (q) => ({ message: { extendedTextMessage: { contextInfo: { quotedMessage: q } } }, pushName: 'T' });

async function runVV(quoted, args = []) {
  const sent = []; const txt = [];
  await vv.execute({
    sock: { sendMessage: async (jid, p) => { sent.push({ jid, ...p }); } },
    msg: wrap(quoted), from: '123@g.us',
    reply: async (t) => txt.push(String(t)),
    download: async () => MEDIA,
    dbSession: { phoneNumber: '2348021016309' },
    args,
  });
  return { sent, txt };
}
const kindOf = (p) => p && ['image', 'video', 'audio', 'document'].find((k) => p[k]);

(async () => {
  console.log('\n\u2550\u2550 .vv wrappers \u2550\u2550\n');
  const shapes = {
    viewOnceMessageV2Extension: { viewOnceMessageV2Extension: { message: { imageMessage: {} } } },
    viewOnceMessageV2: { viewOnceMessageV2: { message: { imageMessage: {} } } },
    viewOnceMessage: { viewOnceMessage: { message: { imageMessage: {} } } },
    'ephemeral wrapper': { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: {} } } } } },
    'documentWithCaption wrapper': { documentWithCaptionMessage: { message: { viewOnceMessageV2: { message: { imageMessage: {} } } } } },
  };
  for (const [name, q] of Object.entries(shapes)) {
    const { sent } = await runVV(q);
    ok(`.vv handles ${name}`, kindOf(sent[0]) === 'image', sent[0] ? 'wrong payload' : 'nothing sent');
  }

  const { sent: vid } = await runVV({ viewOnceMessageV2: { message: { videoMessage: { mimetype: 'video/mp4' } } } });
  ok('.vv sends video as video, not as a broken image', kindOf(vid[0]) === 'video', String(kindOf(vid[0])));

  const { sent: here } = await runVV({ viewOnceMessageV2Extension: { message: { imageMessage: {} } } });
  ok('.vv replies in the same chat by default', here[0]?.jid === '123@g.us', String(here[0]?.jid));

  const { sent: dm, txt: dmTxt } = await runVV({ viewOnceMessageV2Extension: { message: { imageMessage: {} } } }, ['dm']);
  ok('.vv dm sends to the owner privately', dm[0]?.jid === '2348021016309@s.whatsapp.net', String(dm[0]?.jid || dmTxt[0]));
  ok('.vv dm does NOT post the media in the group', !dm.some((m) => m.jid === '123@g.us'), 'leaked to the group');

  const { sent: none, txt: noneTxt } = await runVV({ extendedTextMessage: { text: 'hi' } });
  ok('.vv on a plain text message explains itself', none.length === 0 && /no view-once/i.test(noneTxt[0] || ''), String(noneTxt[0]).slice(0, 50));

  const fail = [];
  await vv.execute({
    sock: { sendMessage: async () => {} }, msg: wrap({ viewOnceMessageV2: { message: { imageMessage: {} } } }),
    from: '123@g.us', reply: async (t) => fail.push(String(t)),
    download: async () => { throw new Error('media expired'); }, dbSession: {}, args: [],
  });
  ok('.vv reports a download failure instead of going quiet', /could not download/i.test(fail[0] || ''), String(fail[0]).slice(0, 50));

  console.log('\n\u2550\u2550 private mode \u2550\u2550\n');
  const mkMsg = (participant) => ({ key: { remoteJid: '120363@g.us', participant, fromMe: false, id: 'X' }, message: { conversation: '.ping' }, pushName: 'T' });
  const fakeSock = (sent) => ({ sendMessage: async (j, p) => { sent.push(String(p.text || '')); }, readMessages: async () => {}, sendPresenceUpdate: async () => {} });

  const ownerSent = [];
  await handleMessage(fakeSock(ownerSent), mkMsg('2348021016309@s.whatsapp.net'), { mode: 'private', phoneNumber: '2348021016309', id: 'S', prefix: '.' });
  ok('the owner can use commands in private mode', ownerSent.length > 0 && !/private mode/.test(ownerSent[0]), ownerSent[0]?.slice(0, 40) || 'silence');

  const devSent = [];
  await handleMessage(fakeSock(devSent), mkMsg('2348021016309:12@s.whatsapp.net'), { mode: 'private', phoneNumber: '2348021016309', id: 'S', prefix: '.' });
  ok('the owner is still recognised with a :device suffix', devSent.length > 0 && !/private mode/.test(devSent[0]), devSent[0]?.slice(0, 40) || 'silence');

  const otherSent = [];
  await handleMessage(fakeSock(otherSent), mkMsg('2349999999999@s.whatsapp.net'), { mode: 'private', phoneNumber: '2348021016309', id: 'S', prefix: '.' });
  ok('a stranger is told the bot is private, not ignored', /private mode/i.test(otherSent[0] || ''), 'silence — indistinguishable from dead');
  ok('…and the notice does not run the command', !/Pinging/.test(otherSent[0] || ''), 'command leaked past the gate');

  const pubSent = [];
  await handleMessage(fakeSock(pubSent), mkMsg('2349999999999@s.whatsapp.net'), { mode: 'public', phoneNumber: '2348021016309', id: 'S', prefix: '.' });
  ok('public mode still answers strangers', pubSent.length > 0 && !/private mode/i.test(pubSent[0]), 'public mode blocked someone');

  const noOwner = [];
  await handleMessage(fakeSock(noOwner), mkMsg('2349999999999@s.whatsapp.net'), { mode: 'private', id: 'S', prefix: '.' });
  ok('private mode with no owner number does not lock everyone out', noOwner.length > 0, 'locked out with no way back');

  const total = pass + fails.length;
  console.log(`\n${fails.length ? '\u2717' : '\u2714'} ${pass}/${total} passed\n`);
  if (fails.length) { fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
})();
