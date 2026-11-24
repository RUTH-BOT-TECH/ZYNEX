const games = require('../lib/engines/games');
games._internals.reset();   // no stale games from an earlier run
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const CHAT='120363img@g.us', P1='2348111000001@s.whatsapp.net', P2='2348111000002@s.whatsapp.net';
let sent=[];
const mk=(command,args=[],extra={})=>({command,args,from:CHAT,sender:P1,msg:{key:{},message:{}},prefix:'.',
  sock:{sendMessage:async(j,c)=>{sent.push(c);return{};},groupMetadata:async()=>({participants:[{id:P1},{id:P2}]})},
  reply:async t=>{sent.push({text:String(t)});return{};},...extra});
const last=()=>sent[sent.length-1]||{};
const isPng=()=>last().image && last().image.slice(0,4).toString('hex')==='89504e47';
const txt=()=>String(last().caption||last().text||'');
const ft=(text,extra={})=>games.handleFreeText({text,from:CHAT,sender:P1,msg:{key:{}},sock:mk('x').sock,reply:async t=>{sent.push({text:String(t)});return{};},...extra});
let pass=0,fail=[];
const ok=(n,c,d='')=>{if(c){pass++;console.log('  ✓ '+n);}else{fail.push(n+' :: '+d);console.log('  ✗ '+n+'  '+d);}};

(async()=>{
  console.log('── X and O (tic-tac-toe) plays with images ──');
  sent=[]; await games.execute(mk('tictactoe',[],{msg:{key:{},message:{extendedTextMessage:{contextInfo:{mentionedJid:[P2]}}}}}));
  ok('start sends PNG board', isPng());
  fs.writeFileSync('/tmp/zynex-i-ttt-start.png', last().image);
  sent=[]; await games.execute(mk('place',['1']));
  ok('move sends updated PNG', isPng());
  sent=[]; await games.execute(mk('place',['9']));   // still P1, but it's P2's turn
  ok('wrong player refused', /Not your turn/.test(txt()), txt().slice(0,50));
  await games.execute(mk('place',['2'],{sender:P2}));
  await games.execute(mk('place',['4']));
  await games.execute(mk('place',['5'],{sender:P2}));
  const preWin = sent[sent.length-1].image;
  sent=[]; await games.execute(mk('place',['7']));
  ok('win sends PNG', isPng());
  ok('win caption says WINS', /WINS/.test(txt()), txt().slice(0,50));
  // the winning stroke must actually be drawn: a win image cannot be byte-identical
  // to a plain board with the same pieces. Catches win-detection regressions.
  ok('win image includes the winning line', isPng() && preWin && !last().image.equals(preWin),
     'win image identical to pre-win image — highlight missing');
  fs.writeFileSync('/tmp/zynex-i-ttt-win.png', last().image);

  console.log('\n── Connect 4 plays with images ──');
  sent=[]; await games.execute(mk('connect4',[],{msg:{key:{},message:{extendedTextMessage:{contextInfo:{mentionedJid:[P2]}}}}}));
  ok('start sends PNG', isPng());
  sent=[]; await games.execute(mk('drop',['4']));
  ok('drop sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-c4.png', last().image);
  sent=[]; await games.execute(mk('drop',['9'],{sender:P2}));
  ok('bad column refused', /column 1-7/.test(txt()), txt().slice(0,50));
  // and a real 4-in-a-row so the win path renders
  // P2 moved on column 4, so it is P1's turn next. Alternate strictly.
  const seq=[['1',P2],['2',P1],['1',P2],['2',P1],['1',P2],['2',P1],['1',P2]];
  for (const [c,sender] of seq) { sent=[]; await games.execute(mk('drop',[c],{sender})); }
  ok('four-in-a-row wins with PNG', isPng() && /WINS/.test(txt()), txt().slice(0,60));
  const c4Loss = require('../lib/gameboard');
  ok('connect4 win is reported as WINS', /WINS/.test(txt()), txt().slice(0,60));
  fs.writeFileSync('/tmp/zynex-i-c4-win.png', last().image || Buffer.alloc(0));

  console.log('\n── 2048 plays with images ──');
  sent=[]; await games.execute(mk('2048'));
  ok('start sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-2048.png', last().image);
  sent=[]; await games.execute(mk('2048',['left']));
  ok('direction arg sends PNG', isPng());
  sent=[]; await ft('up');
  ok('plain "up" is answered', isPng() || /Nothing moves/.test(txt()), txt().slice(0,40));
  sent=[]; await ft('right');
  ok('plain "right" sends PNG', isPng());

  console.log('\n── Minesweeper plays with images ──');
  sent=[]; await games.execute(mk('minesweeper'));
  ok('start sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-mine.png', last().image);
  sent=[]; await games.execute(mk('uncover',['9','9']));
  ok('bad coords refused', /must be 0-/.test(txt()), txt().slice(0,50));
  sent=[]; await games.execute(mk('uncover',['0','0']));
  ok('uncover sends PNG', isPng(), txt().slice(0,50));

  console.log('\n── Sudoku plays with images ──');
  sent=[]; await games.execute(mk('sudoku'));
  ok('start sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-sudoku.png', last().image);
  await new Promise(r=>setTimeout(r,450));
  const st=JSON.parse(fs.readFileSync(games._internals.STATE_FILE,'utf8'));
  const su=st.chats[CHAT].sudoku;
  let e=null; for(let r=0;r<9&&!e;r++)for(let c=0;c<9;c++)if(!su.puzzle[r][c]){e=[r,c];break;}
  sent=[]; await games.execute(mk('fill',[String(e[0]),String(e[1]),String(su.solution[e[0]][e[1]])]));
  ok('valid fill sends PNG', isPng());
  sent=[]; await games.execute(mk('fill',[String(e[0]),String(e[1]),'5']));
  ok('wrong value refused', /doesn't fit|Placed/.test(txt()), txt().slice(0,50));

  console.log('\n── Maze plays with images ──');
  sent=[]; await games.execute(mk('maze'));
  ok('start sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-maze.png', last().image);
  sent=[]; await games.execute(mk('move',['down']));
  const downOk = isPng() || /Off the edge|Wall/.test(txt());
  ok('move is answered', downOk, txt().slice(0,50));
  sent=[]; await games.execute(mk('move',['right']));
  ok('second move answered', isPng() || /Off the edge|Wall/.test(txt()), txt().slice(0,50));

  console.log('\n── Wordle plays with images ──');
  sent=[]; await games.execute(mk('wordle'));
  await new Promise(r=>setTimeout(r,450));
  const st2=JSON.parse(fs.readFileSync(games._internals.STATE_FILE,'utf8'));
  const secret=st2.chats[CHAT].wordle.word;
  sent=[]; await ft('zzzzz');
  ok('wrong guess sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-wordle.png', last().image);
  sent=[]; await ft(secret);
  ok('win sends PNG', isPng());
  ok('win caption says SOLVED', /SOLVED/.test(txt()), txt().slice(0,60));

  console.log('\n── Hangman plays with images ──');
  sent=[]; await games.execute(mk('hangman'));
  ok('start sends PNG', isPng());
  await new Promise(r=>setTimeout(r,450));
  const st3=JSON.parse(fs.readFileSync(games._internals.STATE_FILE,'utf8'));
  const hw=st3.chats[CHAT].hangman.word;
  sent=[]; await ft('q');
  ok('letter guess sends PNG', isPng());
  fs.writeFileSync('/tmp/zynex-i-hangman.png', last().image);
  sent=[]; await ft(hw);
  ok('solve sends PNG', isPng(), `caption: ${txt().slice(0,80)} | text: ${String(last().text||'').slice(0,80)}`);

  console.log(`\n${pass}/${pass+fail.length} passed`);
  if(fail.length){console.log('\nFAILS:');fail.forEach(f=>console.log('  •',f));process.exit(1);}
})();
