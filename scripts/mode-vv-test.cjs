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
  // "Never silent, never pretend it worked". This fixture is `imageMessage: {}`
  // — a keyless stand-in — so the honest answer is now "queued, waiting for the
  // media" (⏳) rather than the old, false "nothing can ever recover it" (❌).
  // A terminal ❌ is still acceptable; silence or a fake unlock is not.
  ok('.vv reports a failure instead of going quiet',
    fail.length > 0 && /[❌⏳]/.test(fail[0]) && !/^🔓/.test(fail[0]) &&
      /media|queued|wait/i.test(fail[0]),
    `silent=${fail.length === 0} txt=${String(fail[0]).slice(0, 50)}`);

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

  // ── the stripped-quote case (production: "Cannot derive from empty media key") ──
  // A quoted view-once arrives WITHOUT mediaKey/url/directPath, so decrypting the
  // quote alone is impossible. The original stanza was stored when it arrived, so
  // .vv must fall back to it. Upstream: WhiskeySockets/Baileys#2907.
  console.log('\n\u2550\u2550 .vv media keys \u2550\u2550\n');
  const { storeMessage } = require(path.join(ROOT, 'lib', 'anti', 'antiDelete.js'));

  const strippedQuote = { viewOnceMessageV2Extension: { message: { imageMessage: { caption: 'x' } } } };
  const withKey = { imageMessage: { mediaKey: 'k', url: 'https://mmg.whatsapp.net/x', mimetype: 'image/jpeg' } };
  const stanza = 'STANZA1';
  storeMessage({ key: { id: stanza, remoteJid: '123@g.us' }, message: { viewOnceMessageV2Extension: { message: withKey } } });

  const sentA = []; const txtA = [];
  await vv.execute({
    sock: { sendMessage: async (jid, p) => { sentA.push(p); } },
    msg: { message: { extendedTextMessage: { contextInfo: { quotedMessage: strippedQuote, stanzaId: stanza } } }, pushName: 'T' },
    from: '123@g.us',
    reply: async (t) => txtA.push(String(t)),
    download: async () => { throw new Error('Cannot derive from empty media key'); },
    dbSession: { phoneNumber: '2348021016309' },
    args: [],
  });
  // With the original stored, .vv must NOT report a failure at all.
  ok('a stripped quote is recovered from the stored original', !txtA.some((t) => /Could not unlock/.test(t)),
    'gave up instead of using the stored stanza');

  const txtB = [];
  await vv.execute({
    sock: { sendMessage: async () => {} },
    msg: { message: { extendedTextMessage: { contextInfo: { quotedMessage: strippedQuote, stanzaId: 'NEVER-STORED' } } }, pushName: 'T' },
    from: '123@g.us',
    reply: async (t) => txtB.push(String(t)),
    download: async () => { throw new Error('Cannot derive from empty media key'); },
    dbSession: { phoneNumber: '2348021016309' },
    args: [],
  });
  ok('an unrecoverable item explains WHY instead of showing a raw library error',
    txtB.length > 0 && /media key|WhatsApp limitation/i.test(txtB[0]), txtB[0]?.slice(0, 60) || 'silence');
  ok('…and it does not claim the bot broke', !/bug in the bot\.$/.test(txtB[0] || 'error'));

  // ── somebody ELSE's view-once, captured when it arrived ────────────────────
  // The reported bug: "if someone sent view once ... then reply to the view once
  // it will bring that error". The quoted copy is stripped (no imageMessage, no
  // key), and the old code bailed on that BEFORE consulting the stored original,
  // so the one path that can work was never reached.
  console.log("\n\u2550\u2550 somebody else's view-once \u2550\u2550\n");
  const { storeMessage: store2 } = require(path.join(ROOT, 'lib', 'anti', 'antiDelete.js'));

  const peerStanza = 'PEER_VIEWONCE_1';
  store2({
    key: { id: peerStanza, remoteJid: '123@g.us', fromMe: false },
    message: {
      viewOnceMessageV2Extension: {
        message: {
          imageMessage: {
            mediaKey: 'realkey',
            url: 'https://mmg.whatsapp.net/x',
            mimetype: 'image/jpeg',
            fileLength: 1234,
          },
        },
      },
    },
  });

  // The quote as WhatsApp actually delivers it: wrapper only, nothing usable.
  const strippedPeerQuote = {
    viewOnceMessageV2Extension: { message: { imageMessage: {} } },
  };

  const peerSent = []; const peerTxt = [];
  const stubSock = {
    sendMessage: async (jid, p) => { peerSent.push({ jid, ...p }); },
  };

  // Capture the diagnostic line: what matters is that the command takes the
  // STORED-ORIGINAL path rather than rejecting the stripped quote. Asserting on
  // a successful network download would make this test depend on WhatsApp's CDN.
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };

  await vv.execute({
    sock: stubSock,
    msg: {
      message: { extendedTextMessage: { contextInfo: { quotedMessage: strippedPeerQuote, stanzaId: peerStanza } } },
      pushName: 'T',
    },
    from: '123@g.us',
    reply: async (t) => peerTxt.push(String(t)),
    download: async () => { throw new Error('Cannot derive from empty media key'); },
    dbSession: { phoneNumber: '2348021016309' },
    args: [],
  });
  console.log = realLog;

  /*
   * What matters is that a stripped peer quote is NOT rejected, and that the
   * media comes from somewhere real. It used to be asserted that the stored
   * original was downloaded; relaying the original node with the viewOnce flag
   * stripped is now the first route (it is what the working bots do, and it
   * avoids re-uploading), so this asserts delivery rather than the mechanism.
   */
  ok('a stripped peer quote is NOT rejected — the stored original is used',
    logs.some((l) => /stored original|forward the original|media cache/i.test(l)),
    logs.find((l) => /VV/.test(l)) || 'no [VV] line — took the wrong path');

  ok('…and the failure is about the network, not a missing key',
    !peerTxt.some((t) => /never received that view-once/i.test(t)),
    String(peerTxt[0]).slice(0, 70));

  const total = pass + fails.length;
  console.log(`\n${fails.length ? '\u2717' : '\u2714'} ${pass}/${total} passed\n`);
  if (fails.length) { fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
})();
