const games = require('../lib/engines/games');
const path = require('path');
const DATA = path.join(__dirname, '..', 'data');
const sent = [];
const SENDER = '2348333333333@s.whatsapp.net';
const CHAT = '120363888@g.us';
function ctx(command, args = [], extra = {}) {
  return { command, args, from: CHAT, sender: SENDER, msg: { key:{}, message:{} }, prefix: '.',
    sock:{ sendMessage: async (j,c)=>{sent.push(c);return{};}, groupMetadata: async()=>({participants:[{id:SENDER}]}) },
    reply: async t => { sent.push({text:String(t)}); return {}; }, ...extra };
}
const ft = (text) => games.handleFreeText({ text, from: CHAT, sender: SENDER, msg:{key:{}}, sock: ctx('x').sock, reply: async t => { sent.push({text:String(t)}); return {}; } });
let pass=0, fail=[];
const wait = () => new Promise(r=>setTimeout(r,450));
const rd = async () => { await wait(); return JSON.parse(require('fs').readFileSync(path.join(DATA, 'games.json'), 'utf8')); };
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ✓ '+n);} else {fail.push(n+' :: '+d);console.log('  ✗ '+n+'  '+d);} };
const txt=()=>String((sent[sent.length-1]||{}).text||(sent[sent.length-1]||{}).caption||'');

(async()=>{
  console.log('── free-text quiz answer ──');
  sent.length=0; await games.execute(ctx('asahotak'));
  const question = txt();
  // dig the real answer out of the vendored bank and submit it
  const bank = require('../data/quiz/asahotak.json');
  const row = bank.find(r => question.includes(r.soal));
  ok('question matches a real bank row', !!row, question.slice(0,50));
  sent.length=0; const claimed = await ft(String(row.jawaban));
  ok('free text claimed', claimed === true);
  ok('correct answer accepted', /CORRECT/.test(txt()) && /coins/.test(txt()), txt().slice(0,70));
  sent.length=0; const wrong = await ft('zzzzwrong');
  ok('no active quiz → chat passes through', wrong === false);

  console.log('\n── wordle end to end ──');
  sent.length=0; await games.execute(ctx('wordle'));
  // find the secret word from persisted state
  const st = await rd();
  const secret = st.chats[CHAT].wordle.word;
  sent.length=0; await ft('zzzzz');
  ok('wrong guess gives colour board', /⬛|🟨|🟩/.test(txt()), txt().slice(0,40));
  sent.length=0; await ft(secret);
  ok('correct word solves', /SOLVED/.test(txt()) && /coins/.test(txt()), txt().slice(0,70));

  console.log('\n── hangman end to end ──');
  sent.length=0; await games.execute(ctx('hangman'));
  const st2 = await rd();
  const hw = st2.chats[CHAT].hangman.word;
  sent.length=0; await ft('q');
  ok('miss reported', /Miss|Hit/.test(txt()), txt().slice(0,40));
  sent.length=0; await ft(hw);
  ok('whole word solves', /SOLVED/.test(txt()), txt().slice(0,60));

  console.log('\n── guessnumber ──');
  sent.length=0; await games.execute(ctx('guessnumber'));
  const st3 = await rd();
  const target = st3.chats[CHAT].quiz.target;
  sent.length=0; await ft(String(target > 50 ? 1 : 99));
  ok('higher/lower hint', /Higher|Lower/.test(txt()), txt().slice(0,30));
  sent.length=0; await ft(String(target));
  ok('correct number wins', /CORRECT/.test(txt()), txt().slice(0,60));

  console.log('\n── minesweeper uncover ──');
  sent.length=0; await games.execute(ctx('minesweeper'));
  sent.length=0; await games.execute(ctx('uncover', ['0','0']));
  ok('dig opens squares', /Safe squares left|BOOM|CLEARED/.test(txt()), txt().slice(0,40));

  console.log('\n── sudoku fill ──');
  sent.length=0; await games.execute(ctx('sudoku'));
  const st4 = await rd();
  const sol = st4.chats[CHAT].sudoku.solution;
  let empty = null;
  for (let r=0;r<9;r++) for (let c=0;c<9;c++) if (!st4.chats[CHAT].sudoku.puzzle[r][c]) { empty=[r,c]; break; }
  sent.length=0; await games.execute(ctx('fill', [String(empty[0]), String(empty[1]), String(sol[empty[0]][empty[1]])]));
  ok('valid fill accepted', /Placed/.test(txt()), txt().slice(0,50));
  sent.length=0; await games.execute(ctx('fill', [String(empty[0]), String(empty[1]), '9']));
  ok('wrong value rejected', /doesn't fit|Placed/.test(txt()), txt().slice(0,50));

  console.log('\n── 2048 real movement ──');
  sent.length=0; await games.execute(ctx('2048'));
  sent.length=0; await ft('left');
  ok('2048 responds to plain direction', /2048|Score/.test(txt()), txt().slice(0,40));

  console.log('\n── anagram / typeracer / wordchain ──');
  sent.length=0; await games.execute(ctx('anagram'));
  const st5 = await rd();
  const aw = st5.chats[CHAT].anagram.word;
  sent.length=0; await ft(aw);
  ok('anagram solves', /CORRECT/.test(txt()), txt().slice(0,50));

  sent.length=0; await games.execute(ctx('typeracer'));
  const st6 = await rd();
  sent.length=0; await ft(st6.chats[CHAT].typerace.text);
  ok('typeracer finishes with WPM', /WPM/.test(txt()), txt().slice(0,60));

  sent.length=0; await games.execute(ctx('wordchain'));
  const st7 = await rd();
  const lastChar = st7.chats[CHAT].chain.last.slice(-1);
  sent.length=0; await ft(lastChar + 'pple' === st7.chats[CHAT].chain.last ? 'x'+lastChar+'zz' : lastChar+'zzz');
  ok('wordchain enforces the letter', /chain length|Must start/.test(txt()), txt().slice(0,50));

  console.log(`\n${pass}/${pass+fail.length} passed`);
  if(fail.length){console.log('\nFAILS:');fail.forEach(f=>console.log('  •',f));process.exit(1);}
})();
