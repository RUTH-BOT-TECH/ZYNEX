process.env.PANEL_MODE = '0';
const { handleMessage } = require('../lib/handler');
const games = require('../lib/engines/games');
games._internals.reset();   // no stale quiz from an earlier run
const fs = require('fs');
const path = require('path');
const sent = [];
const sock = {
  sendMessage: async (j, c) => { sent.push({ j, c }); return {}; },
  readMessages: async () => {},
  groupMetadata: async () => ({ participants: [{ id: '2348444444444@s.whatsapp.net' }] }),
};
const CHAT = '120363777@g.us';
const USER = '2348444444444@s.whatsapp.net';
const mkMsg = (text) => ({ key: { remoteJid: CHAT, participant: USER, fromMe: false, id: 'X' }, message: { conversation: text } });
const db = { phoneNumber: '2348021016309', prefix: '.', mode: 'public' };

(async () => {
  // 1. start a quiz through the real handler
  await handleMessage(sock, mkMsg('.asahotak'), db);
  const q = String(sent[sent.length - 1].c.text || '');
  console.log('quiz started      :', /ASAH OTAK/.test(q) ? '✓' : '✗ ' + q.slice(0, 60));

  // 2. answer with NO prefix — this is the bug we fixed
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','quiz','asahotak.json'),'utf8'));
  const row = bank.find((r) => q.includes(r.soal));
  await handleMessage(sock, mkMsg(String(row.jawaban)), db);
  const a = String(sent[sent.length - 1].c.text || '');
  console.log('free-text answer  :', /CORRECT/.test(a) ? '✓ accepted through handler' : '✗ ' + a.slice(0, 80));

  // 3. ordinary chat must NOT be hijacked once the quiz is done
  const before = sent.length;
  await handleMessage(sock, mkMsg('hey guys what is up'), db);
  console.log('normal chat       :', sent.length === before ? '✓ untouched' : '✗ hijacked: ' + String(sent[sent.length-1].c.text).slice(0,50));

  // 4. unknown command still reports properly
  await handleMessage(sock, mkMsg('.notacommand'), db);
  const u = String(sent[sent.length - 1].c.text || '');
  console.log('unknown command   :', /Unknown command/.test(u) ? '✓' : '✗ ' + u.slice(0, 50));
})();
