const games = require('../lib/engines/games');
games._internals.reset();   // no stale games from an earlier run
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const CHAT = '120363chess@g.us';
const P1 = '2348111000001@s.whatsapp.net';
const P2 = '2348111000002@s.whatsapp.net';
let sent = [];
function ctx(command, args = [], extra = {}) {
  return { command, args, from: CHAT, sender: P1, msg: { key:{}, message:{ extendedTextMessage:{ contextInfo:{ mentionedJid: [] } } } }, prefix: '.',
    sock: { sendMessage: async (j,c)=>{ sent.push(c); return {}; }, groupMetadata: async()=>({participants:[{id:P1},{id:P2}]}) },
    reply: async t => { sent.push({ text: String(t) }); return {}; }, ...extra };
}
const last = () => sent[sent.length-1] || {};
const txt = () => String(last().caption || last().text || '');
let pass=0, fail=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ✓ '+n);} else {fail.push(n+' :: '+d);console.log('  ✗ '+n+'  '+d);} };

(async () => {
  console.log('── start vs CPU ──');
  sent=[]; await games.execute(ctx('chess'));
  ok('board image sent', !!last().image, 'no image field');
  ok('caption says you are White', /you are White/i.test(txt()), txt().slice(0,80));
  ok('image is a real PNG', last().image && last().image.slice(0,4).toString('hex') === '89504e47', 'not png');
  fs.writeFileSync('/tmp/zynex-chess-start.png', last().image);

  console.log('\n── play a move, engine replies ──');
  sent=[]; await games.execute(ctx('playchess', ['e4']));
  ok('engine replied with its own move', /engine replied/.test(txt()), txt().slice(0,110));
  ok('new board image', !!last().image);
  fs.writeFileSync('/tmp/zynex-chess-after.png', last().image);
  const movere = txt().match(/replied (\S+?)[)\n]/);

  console.log('\n── illegal move handling ──');
  sent=[]; await games.execute(ctx('playchess', ['Qh9']));
  ok('illegal move rejected', /not a legal move/.test(txt()), txt().slice(0,90));
  ok('error is helpful', /Example|can move to/.test(txt()), txt().slice(0,90));

  console.log('\n── turn ownership ──');
  sent=[]; await games.execute(ctx('playchess', ['Nf3'], { sender: P2 }));
  ok('non-player blocked in CPU game', /turn|waiting/i.test(txt()), txt().slice(0,90));

  console.log('\n── resign ──');
  sent=[]; await games.execute(ctx('resign'));
  ok('resign ends game', /wins|resigned/i.test(txt()), txt().slice(0,90));

  console.log('\n── PvP: two humans, alternating turns ──');
  sent=[]; await games.execute(ctx('chess', [], { msg:{ key:{}, message:{ extendedTextMessage:{ contextInfo:{ mentionedJid:[P2] } } } } }));
  ok('pvp starts', /Player vs Player/.test(txt()), txt().slice(0,90));
  sent=[]; await games.execute(ctx('playchess', ['e4']));
  ok('white moved', /MOVE MADE|Black to play/.test(txt()), txt().slice(0,90));
  sent=[]; await games.execute(ctx('playchess', ['e5']));
  ok('white cannot move on black turn', /turn|waiting/i.test(txt()), txt().slice(0,90));
  sent=[]; await games.execute(ctx('playchess', ['e5'], { sender: P2 }));
  ok('black can move', /MOVE MADE|White to play/.test(txt()), txt().slice(0,90));
  sent=[]; await games.execute(ctx('playchess', ['Nf3']));
  ok('white can move again', /MOVE MADE|Black to play/.test(txt()), txt().slice(0,90));

  console.log('\n── board on demand ──');
  sent=[]; await games.execute(ctx('board'));
  ok('.board renders current position', !!last().image && /CURRENT POSITION/.test(txt()), txt().slice(0,60));

  console.log('\n── undo ──');
  sent=[]; await games.execute(ctx('undo'));
  ok('undo takes back a move', /TOOK BACK/.test(txt()), txt().slice(0,60));

  console.log('\n── hint ──');
  sent=[]; await games.execute(ctx('resign'));  // clear the PvP game
  sent=[]; await games.execute(ctx('chess'));   // fresh CPU game, we are White and to move
  sent=[]; await games.execute(ctx('hint'));
  ok('hint suggests a move', /SUGGESTED MOVE/.test(txt()), txt().slice(0,80));
  sent=[]; await games.execute(ctx('hint', [], { sender: P2 }));
  ok('hint refused for non-player', /Wait for your turn/.test(txt()), txt().slice(0,60));

  console.log(`\n${pass}/${pass+fail.length} passed`);
  if(fail.length){console.log('\nFAILS:');fail.forEach(f=>console.log('  •',f));process.exit(1);}
})();
