/**
 * GAMES ENGINE
 *
 * Three families, all with real state — nothing is faked:
 *
 *  1. QUIZ  (.asahotak .caklontong .siapakahaku .susunkata .tebakkata
 *            .tebaktebakan .family100 .tebakbendera .guessnumber .mathquiz
 *            .guessflag .guesscountry)
 *     Questions come from `data/quiz/*.json` — 8,919 rows vendored into the
 *     repo, so no network call is needed at play time.
 *
 *  2. DUEL  (.tictactoe .ttt .connect4 .rps .rockpaperscissors .chess)
 *     Two-player games with a real board, real win detection and turn order.
 *
 *  3. SOLO  (.wordle .hangman .sudoku .2048 .minesweeper .typeracer .anagram
 *            .scramble .unscramble .wordchain .mathgame .guess .numberguess
 *            .guesscolor .guessanime .guesssong .wheel .uno .snake .tetris ...)
 *
 * State lives in `data/games.json`, keyed by chat so two groups never collide.
 */
const fs = require('fs');
const path = require('path');
const eco = require('./economy');
const CHESS = require('../chess');
const GB = require('../gameboard');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'games.json');
const QUIZ_DIR = path.join(DATA_DIR, 'quiz');

/* ── quiz bank (vendored, loaded once) ───────────────────── */
const QUIZ = {};
function quizBank(name) {
  if (QUIZ[name] !== undefined) return QUIZ[name];
  try {
    QUIZ[name] = JSON.parse(fs.readFileSync(path.join(QUIZ_DIR, `${name}.json`), 'utf8'));
  } catch {
    QUIZ[name] = [];
  }
  return QUIZ[name];
}

/* ── persisted state ─────────────────────────────────────── */
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { chats: {} };
  }
}
const state = loadState();
let saveTimer = null;
function writeNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[games] persist failed:', e.message);
  }
}
/** Debounced write — fine for high-frequency scratch state. */
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}
/**
 * Immediate write. Chess calls this after every move: a debounced write means
 * a restart or crash inside 300ms silently loses the move, and losing a move
 * in a two-player game is much worse than one extra disk write.
 */
function flush() {
  clearTimeout(saveTimer);
  writeNow();
}
function chat(from) {
  if (!state.chats[from]) state.chats[from] = {};
  return state.chats[from];
}

/* ── helpers ─────────────────────────────────────────────── */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const VICTORY = (n = 100) => `\n\n💰 +${eco.coins(n)} coins`;

/* ── quiz games ──────────────────────────────────────────── */
const QUIZ_GAMES = {
  asahotak: { bank: 'asahotak', title: '🧠 ASAH OTAK' },
  caklontong: { bank: 'caklontong', title: '🤣 CAK LONTONG' },
  siapakahaku: { bank: 'siapakahaku', title: '🕵️ SIAPAKAH AKU' },
  susunkata: { bank: 'susunkata', title: '🔤 SUSUN KATA' },
  tebakkata: { bank: 'tebakkata', title: '💭 TEBAK KATA' },
  tebaktebakan: { bank: 'tebaktebakan', title: '❓ TEBAK-TEBAKAN' },
  family100: { bank: 'family100', title: '👨‍👩‍👧 FAMILY 100' },
  tebakkimia: { bank: null, title: '⚗️ TEBAK KIMIA' },
};

/* Countries used by the flag games — verified against flagcdn (keyless). */
const COUNTRIES = [
  ['Nigeria', 'ng', 'Abuja', 'Africa'], ['Ghana', 'gh', 'Accra', 'Africa'],
  ['Kenya', 'ke', 'Nairobi', 'Africa'], ['Egypt', 'eg', 'Cairo', 'Africa'],
  ['Morocco', 'ma', 'Rabat', 'Africa'], ['South Africa', 'za', 'Pretoria', 'Africa'],
  ['Ethiopia', 'et', 'Addis Ababa', 'Africa'], ['Tanzania', 'tz', 'Dodoma', 'Africa'],
  ['Senegal', 'sn', 'Dakar', 'Africa'], ['Cameroon', 'cm', 'Yaounde', 'Africa'],
  ['Japan', 'jp', 'Tokyo', 'Asia'], ['China', 'cn', 'Beijing', 'Asia'],
  ['India', 'in', 'New Delhi', 'Asia'], ['Indonesia', 'id', 'Jakarta', 'Asia'],
  ['Pakistan', 'pk', 'Islamabad', 'Asia'], ['Bangladesh', 'bd', 'Dhaka', 'Asia'],
  ['South Korea', 'kr', 'Seoul', 'Asia'], ['Thailand', 'th', 'Bangkok', 'Asia'],
  ['Vietnam', 'vn', 'Hanoi', 'Asia'], ['Philippines', 'ph', 'Manila', 'Asia'],
  ['Saudi Arabia', 'sa', 'Riyadh', 'Asia'], ['Turkey', 'tr', 'Ankara', 'Asia'],
  ['France', 'fr', 'Paris', 'Europe'], ['Germany', 'de', 'Berlin', 'Europe'],
  ['Italy', 'it', 'Rome', 'Europe'], ['Spain', 'es', 'Madrid', 'Europe'],
  ['United Kingdom', 'gb', 'London', 'Europe'], ['Netherlands', 'nl', 'Amsterdam', 'Europe'],
  ['Portugal', 'pt', 'Lisbon', 'Europe'], ['Sweden', 'se', 'Stockholm', 'Europe'],
  ['Norway', 'no', 'Oslo', 'Europe'], ['Poland', 'pl', 'Warsaw', 'Europe'],
  ['United States', 'us', 'Washington DC', 'America'], ['Canada', 'ca', 'Ottawa', 'America'],
  ['Brazil', 'br', 'Brasilia', 'America'], ['Argentina', 'ar', 'Buenos Aires', 'America'],
  ['Mexico', 'mx', 'Mexico City', 'America'], ['Chile', 'cl', 'Santiago', 'America'],
  ['Colombia', 'co', 'Bogota', 'America'], ['Peru', 'pe', 'Lima', 'America'],
  ['Australia', 'au', 'Canberra', 'Oceania'], ['New Zealand', 'nz', 'Wellington', 'Oceania'],
];

/* ── words for word games (common, unambiguous) ──────────── */
const WORDS5 = [
  'about','above','abuse','actor','acute','admit','adopt','adult','after','again',
  'agent','agree','ahead','alarm','album','alert','alike','alive','allow','alone',
  'along','alter','among','anger','angle','angry','apart','apple','apply','arena',
  'argue','arise','array','aside','asset','audio','audit','avoid','awake','award',
  'aware','badly','baker','bases','basic','basis','beach','began','begin','begun',
  'being','below','bench','birth','black','blame','blind','block','blood','board',
  'brain','brand','bread','break','breed','brief','bring','broad','broke','brown',
  'build','built','buyer','cable','calif','carry','catch','cause','chain','chair',
  'chart','chase','cheap','check','chest','chief','child','china','chose','civil',
  'claim','class','clean','clear','click','clock','close','cloud','coach','coast',
  'could','count','court','cover','craft','crash','cream','crime','cross','crowd',
  'crown','curve','cycle','daily','dance','dated','dealt','death','debut','delay',
  'depth','doing','doubt','dozen','draft','drama','drawn','dream','dress','drill',
  'drink','drive','drove','dying','eager','early','earth','eight','elite','empty',
  'enemy','enjoy','enter','entry','equal','error','event','every','exact','exist',
  'extra','faith','false','fault','fiber','field','fifth','fifty','fight','final',
  'first','fixed','flash','fleet','floor','fluid','focus','force','forth','forty',
  'forum','found','frame','frank','fraud','fresh','front','fruit','fully','funny',
  'giant','given','glass','globe','going','grace','grade','grand','grant','grass',
  'great','green','gross','group','grown','guard','guess','guest','guide','happy',
  'harry','heart','heavy','hence','henry','horse','hotel','house','human','ideal',
  'image','index','inner','input','issue','japan','jimmy','joint','jones','judge',
  'known','label','large','laser','later','laugh','layer','learn','lease','least',
  'leave','legal','level','lewis','light','limit','links','lives','local','logic',
  'loose','lower','lucky','lunch','lying','magic','major','maker','march','maria',
  'match','maybe','mayor','meant','media','metal','might','minor','minus','mixed',
  'model','money','month','moral','motor','mount','mouse','mouth','movie','music',
  'needs','never','newly','night','noise','north','noted','novel','nurse','occur',
  'ocean','offer','often','order','other','ought','paint','panel','paper','party',
  'peace','peter','phase','phone','photo','piece','pilot','pitch','place','plain',
  'plane','plant','plate','point','pound','power','press','price','pride','prime',
  'print','prior','prize','proof','proud','prove','queen','quick','quiet','quite',
  'radio','raise','range','rapid','ratio','reach','ready','refer','right','rival',
  'river','robin','roger','roman','rough','round','route','royal','rural','scale',
  'scene','scope','score','sense','serve','seven','shall','shape','share','sharp',
  'sheet','shelf','shell','shift','shirt','shock','shoot','short','shown','sight',
  'since','sixth','sixty','sized','skill','sleep','slide','small','smart','smile',
  'smith','smoke','solid','solve','sorry','sound','south','space','spare','speak',
  'speed','spend','spent','split','spoke','sport','staff','stage','stake','stand',
  'start','state','steam','steel','stick','still','stock','stone','stood','store',
  'storm','story','strip','stuck','study','stuff','style','sugar','suite','super',
  'sweet','table','taken','taste','taxes','teach','teeth','terry','texas','thank',
  'theft','their','theme','there','these','thick','thing','think','third','those',
  'three','threw','throw','tight','times','tired','title','today','topic','total',
  'touch','tough','tower','track','trade','train','treat','trend','trial','tried',
  'tries','truck','truly','trust','truth','twice','under','undue','union','unity',
  'until','upper','upset','urban','usage','usual','valid','value','video','virus',
  'visit','vital','voice','waste','watch','water','wheel','where','which','while',
  'white','whole','whose','woman','women','world','worry','worse','worst','worth',
  'would','wound','write','wrong','wrote','yield','young','youth',
];
const HANGMAN_WORDS = WORDS5.filter((w) => w.length >= 5).concat([
  'elephant','computer','mountain','keyboard','telephone','university','chocolate',
  'adventure','democracy','framework','butterfly','aeroplane','basketball',
]);

/* ── board render helpers ────────────────────────────────── */
function tttBoard(b) {
  const c = (i) => (b[i] === 'X' ? '❌' : b[i] === 'O' ? '⭕' : `${i + 1}\ufe0f\u20e3`);
  return (
    `${c(0)}│${c(1)}│${c(2)}\n` +
    `─┼─┼─\n` +
    `${c(3)}│${c(4)}│${c(5)}\n` +
    `─┼─┼─\n` +
    `${c(6)}│${c(7)}│${c(8)}`
  );
}
const TTT_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];
function tttWinner(b) {
  // Returns { winner, line } so the renderer can draw the winning stroke.
  // Returning a bare 'X' silently broke the highlight — w.line was undefined.
  for (const line of TTT_LINES) {
    const [a, x, y] = line;
    if (b[a] && b[a] === b[x] && b[a] === b[y]) return { winner: b[a], line };
  }
  return b.every(Boolean) ? { winner: 'draw', line: null } : null;
}

function c4Board(b) {
  // 6 rows x 7 cols, b[r][c] = 0 | 1 | 2
  const sym = (v) => (v === 1 ? '🔴' : v === 2 ? '🟡' : '⚫');
  const rows = b.map((r) => r.map(sym).join(''));
  return rows.join('\n') + '\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';
}
function c4Drop(b, col, who) {
  for (let r = 5; r >= 0; r--) {
    if (b[r][col] === 0) { b[r][col] = who; return true; }
  }
  return false;
}
function c4Winner(b) {
  // Returns { winner, line:[[r,c],...] } so the renderer can ring the four.
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    const v = b[r][c];
    if (!v) continue;
    for (const [dr, dc] of dirs) {
      const cells = [[r, c]];
      for (let k = 1; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || b[rr][cc] !== v) break;
        cells.push([rr, cc]);
      }
      if (cells.length >= 4) return { winner: v, line: cells };
    }
  }
  return b.every((row) => row.every((v) => v)) ? { winner: 'draw', line: null } : null;
}

/* ── 2048 ────────────────────────────────────────────────── */
function b2048New() {
  const g = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  addTile(g); addTile(g);
  return g;
}
function addTile(g) {
  const empty = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!g[r][c]) empty.push([r, c]);
  if (!empty.length) return;
  const [r, c] = pick(empty);
  g[r][c] = Math.random() < 0.9 ? 2 : 4;
}
function b2048Render(g) {
  const w = (v) => String(v).padStart(5);
  return g.map((row) => row.map(w).join('│')).join('\n─────┼─────┼─────┼─────\n');
}
function slideRow(row) {
  const vals = row.filter(Boolean);
  const out = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) { out.push(vals[i] * 2); gained += vals[i] * 2; i++; }
    else out.push(vals[i]);
  }
  while (out.length < 4) out.push(0);
  return { row: out, gained };
}
function b2048Move(g, dir) {
  const before = JSON.stringify(g);
  let gained = 0;
  const rotate = (m) => m[0].map((_, i) => m.map((r) => r[i]).reverse());
  let m = g.map((r) => [...r]);
  // normalise every direction to "left"
  const turns = { left: 0, up: 1, right: 2, down: 3 }[dir];
  for (let t = 0; t < turns; t++) m = rotate(m);
  m = m.map((row) => { const s = slideRow(row); gained += s.gained; return s.row; });
  for (let t = 0; t < (4 - turns) % 4; t++) m = rotate(m);
  const moved = JSON.stringify(m) !== before;
  if (moved) addTile(m);
  return { grid: m, gained, moved };
}

/* ── minesweeper ─────────────────────────────────────────── */
function mineNew(size = 5, mines = 4) {
  const g = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ mine: false, open: false, n: 0 })));
  let placed = 0;
  while (placed < mines) {
    const r = rand(0, size - 1), c = rand(0, size - 1);
    if (!g[r][c].mine) { g[r][c].mine = true; placed++; }
  }
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < size && cc >= 0 && cc < size && g[rr][cc].mine) n++;
    }
    g[r][c].n = n;
  }
  return g;
}
function mineRender(g) {
  return g.map((row, r) =>
    row.map((c, i) => (c.open ? (c.mine ? '💥' : c.n === 0 ? '⬜' : `${c.n}\ufe0f\u20e3`) : `||${r}${i}||`)).join('')
  ).join('\n');
}

/* ── sudoku ──────────────────────────────────────────────── */
function sudokuPuzzle() {
  // generate a full valid grid by backtracking, then punch holes
  const grid = Array.from({ length: 9 }, () => Array(9).fill(0));
  const ok = (g, r, c, v) => {
    for (let i = 0; i < 9; i++) if (g[r][i] === v || g[i][c] === v) return false;
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (g[br + i][bc + j] === v) return false;
    return true;
  };
  const fill = (pos = 0) => {
    if (pos === 81) return true;
    const r = Math.floor(pos / 9), c = pos % 9;
    for (const v of shuffle([1,2,3,4,5,6,7,8,9])) {
      if (ok(grid, r, c, v)) {
        grid[r][c] = v;
        if (fill(pos + 1)) return true;
        grid[r][c] = 0;
      }
    }
    return false;
  };
  fill();
  const puzzle = grid.map((r) => [...r]);
  let holes = 45;
  while (holes > 0) {
    const r = rand(0, 8), c = rand(0, 8);
    if (puzzle[r][c]) { puzzle[r][c] = 0; holes--; }
  }
  return { puzzle, solution: grid };
}
function sudokuRender(p) {
  const rows = p.map((row, r) => {
    const cells = row.map((v) => (v ? String(v) : '·'));
    return cells.slice(0, 3).join(' ') + ' │ ' + cells.slice(3, 6).join(' ') + ' │ ' + cells.slice(6).join(' ');
  });
  return rows.slice(0, 3).join('\n') + '\n──────┼───────┼──────\n' +
    rows.slice(3, 6).join('\n') + '\n──────┼───────┼──────\n' + rows.slice(6).join('\n');
}

/* ── decks ───────────────────────────────────────────────── */
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const DICE_TABLE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/* ── engine ──────────────────────────────────────────────── */
const NAMES = new Set([
  // quiz
  'asahotak','caklontong','siapakahaku','susunkata','tebakkata','tebaktebakan','family100',
  'tebakbendera','tebakflag','guessflag','guesscountry','guessnumber','numberguess',
  'mathquiz','mathgame','tebakkimia','guesscolor','guessanime','guesssong','tebaklagu',
  // duel
  'tictactoe','ttt','connect4','rps','rockpaperscissors','suit','chess','checkers',
  // solo
  'wordle','hangman','sudoku','2048','minesweeper','typeracer','typingtest','typing',
  'anagram','scramble','unscramble','wordchain','wheel','uno','snake','tetris','maze',
  'riddlegame','adventure','dungeon','explore','mission','quest','rpg','fight',
  'pvp','who','delttt','answer','stopgame','skip','clue','hint',
  // sub-actions for the stateful games (not catalogue names, but they must route)
  'place','drop','move','uncover','fill','giveup','done','playchess','resign','undo','board',
]);

const ALIASES = {
  tebakflag: 'guessflag',
  numberguess: 'guessnumber',
  mathgame: 'mathquiz',
  suit: 'rps',
  rockpaperscissors: 'rps',
  ttt: 'tictactoe',
  typing: 'typeracer',
  typingtest: 'typeracer',
  unicorn: 'unscramble',
  explore: 'adventure',
  dungeon: 'rpg',
  mission: 'quest',
  pvp: 'fight',
  delttt: 'tictactoe',
  solo: 'delttt',
  answer: 'hint',
  playchess: 'chess',
  stopgame: 'skip',
};

function match(command) {
  return NAMES.has(command);
}

module.exports = {
  id: 'games',
  name: 'games-engine',
  match,
  describe: (n) => `games:${n}`,
  extraNames: [...NAMES],

  async execute(ctx) {
    const { command: raw, args, from, sender, msg, reply, sock } = ctx;
    const command = ALIASES[raw] || raw;
    const c = chat(from);
    const senderId = String(sender || msg?.key?.participant || from).split('@')[0].split(':')[0];

    /* ────────── quiz games ────────── */
    if (QUIZ_GAMES[command]) {
      const cfg = QUIZ_GAMES[command];

      // .answer / .hint — reveal or hint on the active quiz
      // (handled below with the shared answer path)

      if (command === 'family100') {
        const bank = quizBank('family100');
        if (!bank.length) return reply('❌ Family 100 bank not found.');
        const q = pick(bank);
        c.quiz = { type: 'family100', answers: (q.jawaban || []).map(norm), found: [], question: q.soal, rule: 'family100' };
        persist();
        return reply(
          `👨‍👩‍👧 *FAMILY 100*\n\n*${q.soal}*\n\n` +
            `There are *${c.quiz.answers.length}* answers on the board.\n` +
            `Type answers directly in chat — first to find them all wins.\n` +
            `Use *.hint* for a hint or *.answer* to give up.`,
        );
      }

      if (command === 'tebakkimia') {
        const ELEMENTS = [
          ['H','Hydrogen',1],['He','Helium',2],['Li','Lithium',3],['Be','Beryllium',4],
          ['B','Boron',5],['C','Carbon',6],['N','Nitrogen',7],['O','Oxygen',8],
          ['F','Fluorine',9],['Ne','Neon',10],['Na','Sodium',11],['Mg','Magnesium',12],
          ['Al','Aluminium',13],['Si','Silicon',14],['P','Phosphorus',15],['S','Sulfur',16],
          ['Cl','Chlorine',17],['Ar','Argon',18],['K','Potassium',19],['Ca','Calcium',20],
          ['Fe','Iron',26],['Cu','Copper',29],['Zn','Zinc',30],['Ag','Silver',47],
          ['Au','Gold',79],['Hg','Mercury',80],['Pb','Lead',82],['U','Uranium',92],
        ];
        const [sym, name, z] = pick(ELEMENTS);
        c.quiz = { type: 'text', answers: [norm(sym), norm(name)], question: `Which element has atomic number *${z}*?`, display: null };
        persist();
        return reply(`⚗️ *TEBAK KIMIA*\n\nWhich element has atomic number *${z}*?\n\n_Answer with the symbol or the name._`);
      }

      const bank = quizBank(cfg.bank);
      if (!bank.length) return reply(`❌ Quiz bank "${cfg.bank}" is empty.`);

      // avoid repeating the same question twice in a row in this chat
      let item = pick(bank);
      for (let tries = 0; tries < 10 && c.lastQuiz && item.soal === c.lastQuiz; tries++) item = pick(bank);
      c.lastQuiz = item.soal;

      const answers = Array.isArray(item.jawaban) ? item.jawaban : [item.jawaban];
      c.quiz = {
        type: 'text',
        answers: answers.map(norm),
        question: item.soal,
        display: item.deskripsi || null,
        tipe: item.tipe || null,
      };
      persist();

      let body = `${cfg.title}\n\n`;
      body += `*${item.soal}*\n`;
      if (item.tipe) body += `\n📂 Category: *${item.tipe}*`;
      body += `\n\n_Type your answer in chat._\n_*.hint* for a clue · *.answer* to give up._`;
      return reply(body);
    }

    /* ────────── flags / countries ────────── */
    if (command === 'tebakbendera' || command === 'guessflag') {
      const [name, code, capital] = pick(COUNTRIES);
      c.quiz = { type: 'text', answers: [norm(name)], question: `Which country is this flag?`, display: null };
      persist();
      return sock.sendMessage(
        from,
        {
          image: { url: `https://flagcdn.com/w640/${code}.png` },
          caption: `🏴 *TEBAK BENDERA*\n\nWhich country is this flag?\n\n_*.hint* for a clue · *.answer* to give up._`,
        },
        { quoted: msg },
      );
    }

    if (command === 'guesscountry') {
      const [name, code, capital, region] = pick(COUNTRIES);
      c.quiz = { type: 'text', answers: [norm(capital)], question: `What is the capital of ${name}?`, display: null };
      persist();
      return reply(`🌍 *CAPITAL QUIZ*\n\nWhat is the capital city of *${name}*?\n\n_Region: ${region}_`);
    }

    if (command === 'guessnumber') {
      const target = rand(1, 100);
      c.quiz = { type: 'number', target, tries: 0, answers: [String(target)] };
      persist();
      return reply(`🔢 *GUESS THE NUMBER*\n\nI'm thinking of a number from *1 to 100*.\n\nStart guessing! *(lower / higher hints included)*`);
    }

    if (command === 'mathquiz') {
      const ops = ['+', '-', '×'];
      const op = pick(ops);
      const a = rand(2, 20), b = rand(2, 20);
      const result = op === '+' ? a + b : op === '-' ? a - b : a * b;
      c.quiz = { type: 'text', answers: [String(result)], question: `What is ${a} ${op} ${b}?`, display: null };
      persist();
      return reply(`🧮 *MATH QUIZ*\n\n*${a} ${op} ${b} = ?*`);
    }

    if (command === 'guesscolor') {
      const name = pick(['RED', 'GREEN', 'BLUE']);
      const hex = { RED: 'E53935', GREEN: '43A047', BLUE: '1E88E5' }[name];
      c.quiz = { type: 'text', answers: [norm(name)], question: 'What colour is this?', display: null };
      persist();
      return sock.sendMessage(
        from,
        { image: { url: `https://dummyimage.com/400x200/${hex}/${hex}.png` }, caption: `🎨 *COLOUR QUIZ*\n\nWhat colour is this?` },
        { quoted: msg },
      );
    }

    if (command === 'guessanime' || command === 'guesssong') {
      return reply(
        `❌ *${command}* needs an image/song to guess from, and no reliable keyless source is available right now.\n\n` +
          `Working alternatives: *.guessflag* *.guesscountry* *.guessnumber* *.guesscolor* *.asahotak* *.caklontong*`,
      );
    }

    /* ══════════════ CHESS ══════════════ */
    const chessSub = ['resign', 'undo', 'board'].includes(command);
    const chessHint = command === 'hint' && !!c.chess;
    if (command === 'chess' || (c.chess && chessSub) || chessHint) {
      const { Chess } = CHESS;
      const mentioned = (msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0] || null;

      // ---- helpers that live here so they can reach reply/sock ----
      // Rebuild from the move list, not the FEN. A FEN carries no history, which
      // would silently break undo, threefold repetition and PGN export.
      const load = () => {
        const g = c.chess;
        if (!g) return null;
        const cjs = new Chess();
        for (const san of g.moves || []) {
          try { cjs.move(san, { strict: false }); } catch { break; }
        }
        return { g, cjs };
      };

      // keep g.moves in sync with the board
      const sync = (g, cjs) => {
        g.moves = cjs.history();
        g.fen = cjs.fen();
        flush(); // chess state must survive an immediate restart
      };

      const paint = async (g, cjs, title, extra = {}) => {
        const fen = cjs.fen();
        sync(g, cjs);
        const buf = await CHESS.renderBoard(fen, {
          lastMove: g.lastMove,
          checkSquare: cjs.isCheck() && !cjs.isCheckmate() ? CHESS.kingSquare(cjs) : null,
          flipped: false,
        }).catch(() => null);
        const text = CHESS.caption(g, cjs, { title, ...extra });
        const mentions = [g.white.jid, g.black.jid].filter((j) => j && !j.startsWith('cpu'));
        if (!buf) return reply(text);
        return sock.sendMessage(from, { image: buf, caption: text, mentions }, { quoted: msg });
      };

      const finish = (g, cjs, winnerJid) => {
        if (winnerJid) {
          const u = eco.user(winnerJid);
          u.wallet += 500;
          eco.save();
        }
        delete c.chess;
        flush();
      };

      /* ── challenge a friend (mention wins over the default CPU game) ── */
      if (command === 'chess' && mentioned) {
        const target = mentioned;
        c.chess = {
          mode: 'pvp',
          fen: new Chess().fen(),
          white: { id: senderId, jid: sender },
          black: { id: String(target).split('@')[0], jid: target },
          lastMove: null,
          level: 0,
          startedAt: Date.now(),
          moves: [],
        };
        persist();
        const { g, cjs } = load();
        return paint(g, cjs, '♟️ *NEW GAME — Player vs Player*', {
          note: `\n\n@${senderId} plays *White*, @${String(target).split('@')[0]} plays *Black*.`,
        });
      }

      /* ── start ── */
      if (command === 'chess' && !mentioned && (!args.length || /^(cpu|bot|ai|start)$/i.test(args[0]))) {
        if (c.chess) {
          const { g, cjs } = load();
          oka: {
            if (!g) break oka;
            return paint(g, cjs, '♟️ *GAME ALREADY RUNNING*', { note: `A game is in progress. *.resign* to stop, or *.board* to see it.` });
          }
        }
        const isCpu = !args.length || /^(cpu|bot|ai)$/i.test(args[0]);
        if (!isCpu) return reply('❌ Mention an opponent, or skip it to play the bot.\n\n*.chess* → vs CPU\n*.chess @friend* → vs a friend');

        c.chess = {
          mode: 'cpu',
          fen: new Chess().fen(),
          white: { id: senderId, jid: sender },
          black: { id: 'cpu', jid: 'cpu' },
          lastMove: null,
          level: 10,
          startedAt: Date.now(),
          moves: [],
        };
        persist();
        const { g, cjs } = load();
        return paint(g, cjs, '♟️ *NEW GAME — you are White*', {
          note: '\n\nYou have *White* and move first. Send *.move e4* to begin.',
        });
      }

      const live = c.chess;
      if (!live) return reply('❌ No chess game running. Start one with *.chess* or *.chess @friend*');
      const { g, cjs } = load();

      /* ── show board (via .board or .chess board) ── */
      if (command === 'board' || (command === 'chess' && args[0] && /^(board|show)$/i.test(args[0]))) {
        return paint(g, cjs, '♟️ *CURRENT POSITION*');
      }

      /* ── whose turn / enforce ownership ── */
      const sideTurn = cjs.turn();
      const owner = sideTurn === 'w' ? g.white : g.black;
      const isOwner = owner.id === 'cpu' ? false : owner.id === senderId;

      /* ── resign ── */
      if (raw === 'resign') {
        if (g.mode === 'pvp' && !isOwner) return reply('❌ Only the player on move can resign.');
        const winner = sideTurn === 'w' ? g.black : g.white;
        const winnerName = winner.id === 'cpu' ? require('../botInfo').BOT_NAME : `@${winner.id}`;
        finish(g, cjs, winner.id === 'cpu' ? null : winner.jid);
        return reply(`🏳️ *${g.mode === 'cpu' ? 'You resigned' : `@${senderId} resigned`}* — *${winnerName}* wins.`);
      }

      /* ── hint ── */
      if (command === 'hint') {
        if (!isOwner) return reply('❌ Wait for your turn to ask for a hint.');
        const best = await CHESS.engineMove(cjs.fen(), 12);
        if (best.error) return reply(`❌ No hint available (${best.error}).`);
        return reply(`💡 *SUGGESTED MOVE*\n\nPlay *${best.san || best.move}*\n\n_Engine evaluation: ${best.mate ? `mate in ${best.mate}` : best.eval}_`);
      }

      /* ── undo (take back your move + the reply) ── */
      if (raw === 'undo') {
        const hist = cjs.history();
        if (!hist.length) return reply('❌ Nothing to undo yet.');
        const back = g.mode === 'cpu' ? Math.min(2, hist.length) : 1;
        for (let i = 0; i < back; i++) cjs.undo();
        const verbose = cjs.history({ verbose: true });
        const tip = verbose[verbose.length - 1];
        g.lastMove = tip ? { from: tip.from, to: tip.to } : null;
        return paint(g, cjs, `↩️ *TOOK BACK ${back} MOVE${back > 1 ? 'S' : ''}*`);
      }

      /* ── the move itself (raw is 'chess' with an arg, or 'playchess') ── */
      if (!isOwner) {
        const who = owner.id === 'cpu' ? 'the computer' : `@${owner.id}`;
        return reply(`⏳ It's *${CHESS.COL_LETTER[sideTurn]}*'s turn — waiting on ${who}.`);
      }

      // the move text is args[0..] — `chess e4` or `playchess e2e4`
      const moveText = args.join(' ').trim();
      if (!moveText) {
        return paint(g, cjs, '♟️ *POSITION*', { note: '\n\nGive a move: *.chess e4* · *.move* is the maze game.' });
      }
      let mv;
      try {
        mv = cjs.move(moveText, { strict: false });
        if (!mv) throw new Error('illegal');
      } catch {
        // give a genuinely useful error: show legal-ish help
        const legal = cjs.moves({ verbose: true });
        const fromPiece = legal.filter((m) => m.from === String(moveText).slice(0, 2));
        const hint = fromPiece.length
          ? `That piece can move to: *${fromPiece.map((m) => m.to).join(', ')}*`
          : `Example: *.move e4* or *.move ${legal[0]?.from}${legal[0]?.to}*`;
        return reply(`❌ *${moveText}* is not a legal move.\n\n${hint}\n\n*.board* to see the position.`);
      }

      g.lastMove = { from: mv.from, to: mv.to };
      sync(g, cjs);
      const d = CHESS.describeMove(mv);

      if (cjs.isGameOver()) {
        const winner = cjs.isCheckmate() ? (sideTurn === 'w' ? g.white : g.black) : null;
        const won = winner ? (winner.id === 'cpu' ? null : winner.jid) : null;
        const resultText = cjs.isCheckmate()
          ? `🏆 *CHECKMATE — ${CHESS.COL_LETTER[sideTurn]} wins!*`
          : `🤝 *DRAW*`;
        finish(g, cjs, won);
        const buf = await CHESS.renderBoard(cjs.fen(), { lastMove: g.lastMove, checkSquare: null });
        return sock.sendMessage(from, {
          image: buf,
          caption: `♟️ *GAME OVER*\n\n${resultText}\n\nLast move: *${mv.san}* (${d.summary})${won ? '\n\n💰 +500 coins' : ''}`,
          mentions: [g.white.jid, g.black.jid].filter((j) => j && !j.startsWith('cpu')),
        }, { quoted: msg });
      }

      /* ── CPU replies ── */
      if (g.mode === 'cpu') {
        const opening = CHESS.BOOK[cjs.fen()];
        let replyMove = null;
        let engineNote = '';
        if (opening) {
          replyMove = opening[Math.floor(Math.random() * opening.length)];
        } else {
          const best = await CHESS.engineMove(cjs.fen(), g.level);
          if (best.move) replyMove = best.move;
          else engineNote = `\n\n_Engine offline (${best.error}) — played a random legal move._`;
        }
        if (!replyMove) {
          const legal = cjs.moves();
          replyMove = legal[Math.floor(Math.random() * legal.length)];
          if (!engineNote) engineNote = '\n\n_Played a random legal move — engine unavailable._';
        }
        const cpuMv = cjs.move(replyMove);
        g.lastMove = { from: cpuMv.from, to: cpuMv.to };
        sync(g, cjs);

        if (cjs.isGameOver()) {
          const winnerIsCpu = cjs.isCheckmate();
          delete c.chess;
          persist();
          if (!winnerIsCpu) {
            const u = eco.user(sender);
            u.wallet += 300;
            eco.save();
          }
          const buf = await CHESS.renderBoard(cjs.fen(), { lastMove: g.lastMove, checkSquare: null });
          return sock.sendMessage(from, {
            image: buf,
            caption: `♟️ *GAME OVER*\n\n${winnerIsCpu ? `💀 *Checkmate — ${require('../botInfo').BOT_NAME} wins.*` : '🤝 *Draw.*'}\n\nYour move *${mv.san}*, engine replied *${cpuMv.san}*${!winnerIsCpu ? '\n\n💰 +300 coins for the draw' : ''}`,
          }, { quoted: msg });
        }

        return paint(g, cjs, '♟️ *YOUR MOVE*', {
          lastSan: `${mv.san}, engine replied ${cpuMv.san}`,
          lastNote: engineNote,
        });
      }

      /* ── PvP: hand over to the next player ── */
      return paint(g, cjs, '♟️ *MOVE MADE*', {
        lastSan: mv.san,
        lastNote: d.summary ? `(${d.summary})` : '',
      });
    }

    /* ────────── shared answer handling ────────── */
    if (command === 'hint') {
      if (!c.quiz) return reply('❌ No active game. Start one with *.asahotak* or *.tictactoe*.');
      const a = c.quiz.answers?.[0] || '';
      const masked = a.slice(0, Math.max(1, Math.ceil(a.length / 3))).padEnd(a.length, '_');
      return reply(`💡 *HINT*\n\n📝 Length: *${a.length}* characters\n🔤 Pattern: \`${masked}\``);
    }

    if (command === 'answer' || command === 'giveup') {
      if (!c.quiz) return reply('❌ No active game.');
      const a = c.quiz.answers?.join(' / ') || '?';
      const extra = c.quiz.display ? `\n\n📖 ${c.quiz.display}` : '';
      delete c.quiz;
      persist();
      return reply(`🏳️ *GAVE UP*\n\nThe answer was *${a}*.${extra}`);
    }

    if (command === 'skip') {
      if (!c.quiz) return reply('❌ No active game to skip.');
      const a = c.quiz.answers?.join(' / ');
      delete c.quiz;
      persist();
      return reply(`⏭️ Skipped. The answer was *${a}*.`);
    }

    /* ────────── tic-tac-toe ────────── */
    if (command === 'tictactoe') {
      const target = (msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
      if (!target) return reply('❌ Mention an opponent.\n\nExample: *.tictactoe @friend*');
      c.ttt = {
        board: Array(9).fill(null),
        players: [senderId, String(target).split('@')[0]],
        jids: [sender, String(target)],
        turn: 0,
      };
      persist();
      const tttImg = await GB.renderTTT(c.ttt.board, {}).catch(() => null);
      const tttCap =
        `❌ *TIC-TAC-TOE* ⭕\n\n` +
        `@${senderId} (❌) vs @${c.ttt.players[1]} (⭕)\n\n` +
        `*@${senderId}* starts.\nSend *.place 1* to *.place 9*.`;
      if (tttImg) {
        return sock.sendMessage(from, { image: tttImg, caption: tttCap, mentions: [sender, target] }, { quoted: msg });
      }
      return reply(`${tttBoard(c.ttt.board)}\n\n${tttCap}`);
    }

    if (command === 'place') {
      if (!c.ttt) return reply('❌ No tic-tac-toe in progress. Start with *.tictactoe @friend*');
      const g = c.ttt;
      if (senderId !== g.players[g.turn]) return reply(`⏳ Not your turn — it's *@${g.players[g.turn]}*'s move.`);
      const n = parseInt(args[0], 10);
      if (!n || n < 1 || n > 9) return reply('❌ Pick a number 1-9.');
      if (g.board[n - 1]) return reply('❌ That square is taken.');
      g.board[n - 1] = g.turn === 0 ? 'X' : 'O';
      const tttJids = g.jids || [];
      const w = tttWinner(g.board);
      if (w) {
        const img = await GB.renderTTT(g.board, { winLine: w.line, lastMove: n - 1 }).catch(() => null);
        const winner = w.winner === 'draw' ? null : g.players[g.turn];
        delete c.ttt;
        persist();
        let cap;
        if (w.winner === 'draw') {
          cap = `🤝 *DRAW!* — nobody could win.`;
        } else {
          cap = `🎉 *@${winner} WINS!*${VICTORY(150)}`;
          const u = eco.user(`${winner}@s.whatsapp.net`);
          u.wallet += 150;
          eco.save();
        }
        if (img) return sock.sendMessage(from, { image: img, caption: cap, mentions: tttJids }, { quoted: msg });
        return reply(`${tttBoard(g.board)}\n\n${cap}`);
      }
      g.turn = 1 - g.turn;
      persist();
      const img = await GB.renderTTT(g.board, { lastMove: n - 1 }).catch(() => null);
      const cap = `➡️ *@${g.players[g.turn]}*'s turn\nSend *.place 1* to *.place 9*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap, mentions: tttJids }, { quoted: msg });
      return reply(`${tttBoard(g.board)}\n\n${cap}`);
    }

    /* ────────── connect4 ────────── */
    if (command === 'connect4') {
      const target = (msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
      if (!target) return reply('❌ Mention an opponent.\n\nExample: *.connect4 @friend*');
      c.c4 = {
        board: Array.from({ length: 6 }, () => Array(7).fill(0)),
        players: [senderId, String(target).split('@')[0]],
        jids: [sender, String(target)],
        turn: 0,
      };
      persist();
      const c4Img = await GB.renderConnect4(c.c4.board, {}).catch(() => null);
      const c4Cap =
        `🔴 *CONNECT 4* 🟡\n\n@${senderId} (🔴) vs @${c.c4.players[1]} (🟡)\n\n` +
        `*@${senderId}* starts.\nSend *.drop 1* to *.drop 7* to pick a column.`;
      if (c4Img) return sock.sendMessage(from, { image: c4Img, caption: c4Cap, mentions: [sender, target] }, { quoted: msg });
      return reply(`${c4Board(c.c4.board)}\n\n${c4Cap}`);
    }

    if (command === 'drop') {
      if (!c.c4) return reply('❌ No Connect 4 game. Start with *.connect4 @friend*');
      const g = c.c4;
      if (senderId !== g.players[g.turn]) return reply(`⏳ It's *@${g.players[g.turn]}*'s turn.`);
      const col = parseInt(args[0], 10) - 1;
      if (!(col >= 0 && col < 7)) return reply('❌ Pick a column 1-7.');
      if (!c4Drop(g.board, col, g.turn + 1)) return reply('❌ That column is full.');
      let landedRow = 0;
      for (let r = 0; r < 6; r++) if (g.board[r][col] === g.turn + 1) { landedRow = r; break; }
      const c4Jids = g.jids || [];
      const w = c4Winner(g.board);

      if (w) {
        const img = await GB.renderConnect4(g.board, {
          lastMove: { row: landedRow, col },
          winCells: w.line || null,
        }).catch(() => null);
        const win = w.winner === 'draw' ? null : g.players[g.turn];
        delete c.c4;
        persist();
        let cap;
        if (w.winner === 'draw') {
          cap = `🤝 *DRAW!* — the board is full.`;
        } else {
          cap = `🎉 *@${win} WINS!*${VICTORY(200)}`;
          const u = eco.user(`${win}@s.whatsapp.net`);
          u.wallet += 200;
          eco.save();
        }
        if (img) return sock.sendMessage(from, { image: img, caption: cap, mentions: c4Jids }, { quoted: msg });
        return reply(`${c4Board(g.board)}\n\n${cap}`);
      }

      g.turn = 1 - g.turn;
      persist();
      const img = await GB.renderConnect4(g.board, { lastMove: { row: landedRow, col } }).catch(() => null);
      const cap = `➡️ *@${g.players[g.turn]}*'s turn — send *.drop 1* to *.drop 7*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap, mentions: c4Jids }, { quoted: msg });
      return reply(`${c4Board(g.board)}\n\n${cap}`);
    }

    /* ────────── rps ────────── */
    if (command === 'rps') {
      const move = norm(args[0]);
      if (!RPS_BEATS[move]) return reply('❌ Use *.rock* *.paper* or *.scissors*\n\nExample: *.rps rock*');
      const bot = pick(Object.keys(RPS_BEATS));
      const emoji = { rock: '🪨', paper: '📄', scissors: '✂️' };
      let result;
      if (move === bot) result = '🤝 *DRAW!*';
      else if (RPS_BEATS[move] === bot) {
        result = `🎉 *YOU WIN!*${VICTORY(60)}`;
        const u = eco.user(`${senderId}@s.whatsapp.net`);
        u.wallet += 60;
        eco.save();
      } else result = '💀 *YOU LOSE!*';
      return reply(`${emoji[move]} vs ${emoji[bot]}\n\n${result}`);
    }

    /* ────────── word games ────────── */
    if (command === 'wordle') {
      const word = pick(WORDS5);
      c.wordle = { word, guesses: [], max: 6 };
      persist();
      return reply(
        `🟩 *WORDLE*\n\nGuess the *5-letter word* in *6* tries.\n\n` +
          `Type any 5-letter word to start.\n` +
          `\n🟩 right letter, right spot\n🟨 right letter, wrong spot\n⬛ not in the word`,
      );
    }

    if (command === 'hangman') {
      const word = pick(HANGMAN_WORDS);
      c.hangman = { word, guessed: [], wrong: 0, max: 6 };
      persist();
      const img = await GB.renderHangman(word, [], 0, 6).catch(() => null);
      const cap = `🪢 *HANGMAN*\n\n${word.length} letters, 6 lives.\nGuess a letter or the whole word in chat.`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`🪢 *HANGMAN*\n\n${word.split('').map(() => '_').join(' ')}\n\n${cap}`);
    }

    if (command === 'anagram' || command === 'scramble' || command === 'unscramble') {
      const word = pick(HANGMAN_WORDS.filter((w) => w.length <= 9));
      let mixed = shuffle(word.split('')).join('');
      if (mixed === word) mixed = shuffle(word.split('')).join('');
      c.anagram = { word, tries: 0 };
      persist();
      return reply(`🔀 *${command.toUpperCase()}*\n\nUnscramble this word:\n\n*${mixed.toUpperCase()}*\n\n_Type your answer in chat._`);
    }

    if (command === 'wordchain') {
      const start = pick(['apple', 'banana', 'orange', 'tiger', 'river', 'mountain', 'planet']);
      c.chain = { last: start, used: [start], score: 0 };
      persist();
      return reply(`⛓️ *WORD CHAIN*\n\nI'll start: *${start}*\n\nYour word must begin with the last letter (*${start.slice(-1).toUpperCase()}*).`);
    }

    /* ────────── number/logic games ────────── */
    if (command === '2048') {
      c['2048'] = { grid: b2048New(), score: 0 };
      persist();
      const img = await GB.render2048(c['2048'].grid, { score: 0 }).catch(() => null);
      const cap = `🔢 *2048*\n\nJoin the tiles to reach *2048*.\nSend *.2048 up* · *down* · *left* · *right*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`🔢 *2048*\n\n${b2048Render(c['2048'].grid)}\n\n${cap}`);
    }

    if (command === 'minesweeper') {
      c.mine = { grid: mineNew(5, 4), over: false };
      persist();
      const img = await GB.renderMinesweeper(c.mine.grid).catch(() => null);
      const cap = `💣 *MINESWEEPER* — 5×5, 4 mines\n\nOpen a square with *.uncover row col* (0-4).\nExample: *.uncover 2 3*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`💣 *MINESWEEPER*\n\n${mineRender(c.mine.grid)}\n\n${cap}`);
    }

    if (command === 'uncover') {
      if (!c.mine) return reply('❌ No minesweeper board. Start with *.minesweeper*');
      const r = parseInt(args[0], 10);
      const col = parseInt(args[1], 10);
      const g = c.mine.grid;
      if (!(r >= 0 && r < g.length && col >= 0 && col < g[0].length)) {
        return reply(`❌ Coordinates must be 0-${g.length - 1}. Example: *.uncover 2 3*`);
      }
      if (g[r][col].open) return reply('🔁 That square is already open.');
      g[r][col].open = true;
      if (g[r][col].mine) {
        g.forEach((row) => row.forEach((cell) => { if (cell.mine) cell.open = true; }));
        const shown = mineRender(g);
        const boomImg = await GB.renderMinesweeper(g).catch(() => null);
        delete c.mine;
        persist();
        const cap = `💥 *BOOM!* You hit a mine.`;
        if (boomImg) return sock.sendMessage(from, { image: boomImg, caption: cap }, { quoted: msg });
        return reply(`${cap}\n\n${shown}`);
      }
      // flood-fill zeros for a real minesweeper feel
      const flood = (rr, cc) => {
        const stack = [[rr, cc]];
        while (stack.length) {
          const [y, x] = stack.pop();
          if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) continue;
          const cell = g[y][x];
          if (cell.open || cell.mine) continue;
          cell.open = true;
          if (cell.n === 0) {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) stack.push([y + dy, x + dx]);
          }
        }
      };
      flood(r, col);
      const remaining = g.flat().filter((cell) => !cell.open && !cell.mine).length;
      persist();
      const img = await GB.renderMinesweeper(g).catch(() => null);
      if (remaining === 0) {
        const u = eco.user(`${senderId}@s.whatsapp.net`);
        u.wallet += 200;
        eco.save();
        delete c.mine;
        persist();
        const cap = `🏆 *CLEARED!* All safe squares opened.\n\n💰 +200 coins`;
        if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
        return reply(`${cap}\n\n${mineRender(g)}`);
      }
      const cap = `Safe squares left: *${remaining}*\nKeep digging: *.uncover row col*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`${mineRender(g)}\n\n${cap}`);
    }

    if (command === 'fill') {
      if (!c.sudoku) return reply('❌ No sudoku in progress. Start with *.sudoku*');
      const [r, col, val] = args.map((a) => parseInt(a, 10));
      if (![r, col, val].every((n) => Number.isFinite(n))) {
        return reply('❌ Use *.fill row col value* — e.g. *.fill 0 2 5*');
      }
      if (!(r >= 0 && r < 9 && col >= 0 && col < 9 && val >= 1 && val <= 9)) {
        return reply('❌ Row/col must be 0-8, value 1-9.');
      }
      if (c.sudoku.solution[r][col] !== val) {
        return reply(`❌ *${val}* doesn't fit at row ${r}, col ${col}.`);
      }
      const solvedPuzzle = c.sudoku.puzzle;
      solvedPuzzle[r][col] = val;
      const done = solvedPuzzle.every((row, ri) => row.every((v, ci) => v === c.sudoku.solution[ri][ci]));
      persist();
      const img = await GB.renderSudoku(solvedPuzzle).catch(() => null);
      if (done) {
        const u = eco.user(`${senderId}@s.whatsapp.net`);
        u.wallet += 400;
        eco.save();
        delete c.sudoku;
        persist();
        const cap = `🏆 *SUDOKU SOLVED!*\n\n💰 +400 coins`;
        if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
        return reply(`${cap}\n\n\`\`\`\n${sudokuRender(solvedPuzzle)}\n\`\`\``);
      }
      const cap = `✅ Placed *${val}* at row ${r}, col ${col}.\n\nNext: *.fill row col value*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`${cap}\n\n\`\`\`\n${sudokuRender(solvedPuzzle)}\n\`\`\``);
    }

    if (command === 'sudoku') {
      const { puzzle, solution } = sudokuPuzzle();
      c.sudoku = { puzzle, solution };
      persist();
      const img = await GB.renderSudoku(puzzle).catch(() => null);
      const cap =
        `🔲 *SUDOKU*\n\nRows and columns are numbered *0-8*.\n` +
        `Fill a cell with *.fill row col value* — e.g. *.fill 0 2 5*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`🔲 *SUDOKU*\n\n\`\`\`\n${sudokuRender(puzzle)}\n\`\`\`\n\n${cap}`);
    }

    if (command === 'maze') {
      const n = 9;
      const g = Array.from({ length: n }, () => Array(n).fill('⬜'));
      for (let i = 0; i < 22; i++) {
        const r = rand(0, n - 1), col = rand(0, n - 1);
        if ((r === 0 && col === 0) || (r === n - 1 && col === n - 1)) continue;
        g[r][col] = '⬛';
      }
      g[0][0] = '🟢';
      g[n - 1][n - 1] = '🏁';
      c.maze = { grid: g, pos: [0, 0], n };
      persist();
      const img = await GB.renderMaze(g, [0, 0]).catch(() => null);
      const cap = `🌀 *MAZE*\n\nGet the green dot to the flag.\nMove with *.move up* · *down* · *left* · *right*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`🌀 *MAZE*\n\n${g.map((r) => r.join('')).join('\n')}\n\n${cap}`);
    }

    if (command === 'move') {
      if (!c.maze) return reply('❌ No maze running. Start with *.maze*');
      const dir = norm(args[0]);
      const d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
      if (!d) return reply('❌ Move with *.move up|down|left|right*');
      const m = c.maze;
      const [r, cc] = m.pos;
      const nr = r + d[0], nc = cc + d[1];
      if (nr < 0 || nr >= m.n || nc < 0 || nc >= m.n) return reply('🚫 Off the edge of the maze.');
      if (m.grid[nr][nc] === '⬛') return reply('🧱 Wall — pick another direction.');
      m.grid[r][cc] = '⬜';
      m.pos = [nr, nc];
      const won = nr === m.n - 1 && nc === m.n - 1;
      m.grid[nr][nc] = won ? '🏁' : '🟢';
      persist();
      const img = await GB.renderMaze(m.grid, [nr, nc]).catch(() => null);
      if (won) {
        delete c.maze;
        persist();
        const cap = `🏆 *MAZE SOLVED!*${VICTORY(120)}`;
        if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
        return reply(cap);
      }
      const cap = `📍 Row ${nr}, Col ${nc}\nKeep going: *.move up* · *down* · *left* · *right*`;
      if (img) return sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg });
      return reply(`${m.grid.map((row) => row.join('')).join('\n')}\n\n${cap}`);
    }

    if (command === 'wheel') {
      const opts = args.length >= 2 ? args : ['Yes', 'No', 'Maybe'];
      const chosen = pick(opts);
      return reply(`🎡 *SPINNING THE WHEEL*\n\n${opts.map((o) => `• ${o}`).join('\n')}\n\n🎯 Landed on: *${chosen}*`);
    }

    if (command === 'typeracer') {
      const sentences = [
        'the quick brown fox jumps over the lazy dog',
        'a journey of a thousand miles begins with a single step',
        'knowledge is the light that guides every decision you make',
        'practice every single day and the results will follow naturally',
        'the best way to predict the future is to create it yourself',
      ];
      const s = pick(sentences);
      c.typerace = { text: s, start: Date.now() };
      persist();
      return reply(`⌨️ *TYPE RACER*\n\nType this exactly:\n\n\`${s}\`\n\nTimer started — good luck!`);
    }

    if (command === 'riddlegame') {
      const riddles = [
        ['I have keys but no locks. I have space but no room. You can enter but not go inside. What am I?', 'keyboard'],
        ['What gets wetter the more it dries?', 'towel'],
        ['I speak without a mouth and hear without ears. What am I?', 'echo'],
        ['The more you take, the more you leave behind. What am I?', 'footsteps'],
        ['I have cities but no houses, forests but no trees, water but no fish. What am I?', 'map'],
        ['What has a head, a tail, but no body?', 'coin'],
      ];
      const [q, a] = pick(riddles);
      c.quiz = { type: 'text', answers: [norm(a)], question: q, display: null };
      persist();
      return reply(`🧩 *RIDDLE*\n\n${q}\n\n_*.hint* · *.answer*_`);
    }

    if (command === 'checkers' || command === 'uno' || command === 'snake' || command === 'tetris') {
      return reply(
        `❌ *${command}* needs a full rules engine + per-turn state that WhatsApp messages can't drive reliably, so it isn't shipped.\n\n` +
          `Playable now: *.tictactoe* *.connect4* *.rps* *.wordle* *.hangman* *.2048* *.minesweeper* *.sudoku* *.maze* *.typeracer* *.asahotak* *.caklontong* *.family100*`,
      );
    }

    /* quest/adventure family */
    if (command === 'adventure' || command === 'rpg' || command === 'quest' || command === 'fight') {
      if (command === 'fight') {
        const moves = ['🗡️ Slash', '🛡️ Block', '🔥 Fireball', '💨 Dodge'];
        const me = pick(moves), foe = pick(moves);
        const power = (m) => ({ '🗡️ Slash': 22, '🛡️ Block': 8, '🔥 Fireball': 30, '💨 Dodge': 14 }[m]);
        const win = power(me) > power(foe);
        const gain = win ? rand(40, 120) : 0;
        if (win) { const u = eco.user(`${senderId}@s.whatsapp.net`); u.wallet += gain; eco.save(); }
        return reply(
          `⚔️ *BATTLE*\n\nYou: ${me} (${power(me)})\nFoe: ${foe} (${power(foe)})\n\n` +
            (win ? `🏆 *YOU WIN!*\n💰 +${eco.coins(gain)} coins` : '💀 *YOU LOSE!*\nBetter luck next time.'),
        );
      }
      if (command === 'adventure') {
        const scenes = [
          ['🌲 A dark forest', 'You find a chest with *120 coins*.', 120],
          ['🏜️ A scorching desert', 'You find a lost merchant who pays *80 coins* for directions.', 80],
          ['🏰 An abandoned castle', 'A trap wounds you — you drop *40 coins*.', -40],
          ['🌊 A stormy shore', 'You salvage *150 coins* from a wreck.', 150],
          ['🕳️ A deep cave', 'Too dark to proceed. You leave with *20 coins*.', 20],
        ];
        const [place, text, delta] = pick(scenes);
        const u = eco.user(`${senderId}@s.whatsapp.net`);
        u.wallet = Math.max(0, u.wallet + delta);
        eco.save();
        return reply(`🗺️ *ADVENTURE*\n\n${place}\n\n${text}\n\n👛 Wallet: *${eco.coins(u.wallet)}*`);
      }
      if (command === 'quest') {
        const tasks = ['Mine 10 times', 'Fish 5 times', 'Work 3 times', 'Win 2 battles'];
        const t = pick(tasks);
        c.quest = { task: t, at: Date.now() };
        persist();
        return reply(`📜 *DAILY QUEST*\n\n🎯 ${t}\n\nReward: *200 coins* — report back with *.done* when finished.`);
      }
      if (command === 'rpg') {
        const u = eco.user(`${senderId}@s.whatsapp.net`);
        const level = Math.floor(Math.sqrt(u.xp / 50)) + 1;
        return reply(
          `⚔️ *YOUR HERO*\n\n` +
            `🧙 Class: ${level > 8 ? 'Archmage' : level > 4 ? 'Knight' : 'Squire'}\n` +
            `⭐ Level: *${level}*\n✨ XP: *${u.xp}*\n` +
            `👛 Wallet: *${eco.coins(u.wallet)}*\n` +
            `📊 Battles: ${u.stats?.worked || 0}`,
        );
      }
    }

    /* who — pick a random member */
    if (command === 'who') {
      const meta = await sock.groupMetadata(from).catch(() => null);
      if (!meta) return reply('❌ This only works in a group.');
      const p = pick(meta.participants);
      const q = args.length ? args.join(' ') : 'is the chosen one';
      return reply(`🎯 *WHO ${q.toUpperCase()}?*\n\n👉 @${String(p.id).split('@')[0]}`);
    }

    return reply(
      `❌ *${raw}* isn't available yet.\n\n` +
        `Playable: *.asahotak* *.caklontong* *.siapakahaku* *.susunkata* *.tebakkata* *.family100* ` +
        `*.tictactoe* *.connect4* *.rps* *.wordle* *.hangman* *.2048* *.minesweeper* *.sudoku* ` +
        `*.maze* *.typeracer* *.adventure* *.fight* *.quest* *.wheel* *.riddlegame*`,
    );
  },
};

/* ══════════════════════════════════════════════════════════
 * FREE-TEXT HOOK
 *
 * Quiz answers arrive as plain chat messages, not `.commands`.
 * The handler calls this for every non-prefixed message and we
 * return `true` only when a game is actually waiting for input,
 * so normal chat is never hijacked.
 * ══════════════════════════════════════════════════════════ */
async function handleFreeText({ text, from, sender, msg, reply, sock }) {
  if (!text || !from) return false;
  const c = state.chats[from];
  if (!c) return false;
  const senderId = String(sender || msg?.key?.participant || from).split('@')[0].split(':')[0];
  const input = norm(text);
  if (!input) return false;

  /* ── number guessing ── */
  if (c.quiz && c.quiz.type === 'number') {
    const n = parseInt(String(text).replace(/\D/g, ''), 10);
    if (!Number.isFinite(n)) return false;
    c.quiz.tries++;
    if (n === c.quiz.target) {
      const gain = Math.max(30, 150 - c.quiz.tries * 15);
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += gain;
      eco.save();
      const triesUsed = c.quiz.tries;
      delete c.quiz;
      persist();
      await reply(`🎯 *CORRECT!* The number was *${n}*.\n\nGuesses used: *${triesUsed}*\n💰 +${eco.coins(gain)} coins`);
      return true;
    }
    const hint = n < c.quiz.target ? '📈 Higher' : '📉 Lower';
    if (c.quiz.tries >= 10) {
      const a = c.quiz.target;
      delete c.quiz;
      persist();
      await reply(`💀 *Out of tries!* The number was *${a}*.`);
      return true;
    }
    persist();
    await reply(`${hint}\n\nTries left: *${10 - c.quiz.tries}*`);
    return true;
  }

  /* ── family 100: many valid answers ── */
  if (c.quiz && c.quiz.type === 'family100') {
    const idx = c.quiz.answers.findIndex((a) => a === input || a.includes(input) || input.includes(a));
    if (idx === -1) return false;
    if (c.quiz.found.includes(idx)) { await reply('🔁 Already found — try another.'); return true; }
    c.quiz.found.push(idx);
    const total = c.quiz.answers.length;
    if (c.quiz.found.length === total) {
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += 300;
      eco.save();
      delete c.quiz;
      persist();
      await reply(`🏆 *BOARD CLEARED!* You found all *${total}* answers.\n\n💰 +300 coins`);
      return true;
    }
    persist();
    await reply(`✅ *Correct!* ${c.quiz.found.length}/${total} found on the board.`);
    return true;
  }

  /* ── wordle ── */
  if (c.wordle) {
    if (!/^[a-z]{5}$/.test(input)) {
      await reply('❌ Wordle needs a *5-letter word* (letters only).');
      return true;
    }
    const w = c.wordle;
    const target = w.word.split('');
    const guess = input.split('');
    const marks = Array(5).fill('⬛');
    const pool = [...target];
    // greens first
    for (let i = 0; i < 5; i++) if (guess[i] === target[i]) { marks[i] = '🟩'; pool[i] = null; }
    // then yellows
    for (let i = 0; i < 5; i++) {
      if (marks[i] === '🟩') continue;
      const j = pool.indexOf(guess[i]);
      if (j !== -1) { marks[i] = '🟨'; pool[j] = null; }
    }
    w.guesses.push({ word: input, marks: marks.join('') });
    const won = input === w.word;
    const outOf = !won && w.guesses.length >= w.max;
    const board = w.guesses.map((g) => `${g.marks}  ${g.word.toUpperCase()}`).join('\n');
    const wordleImg = await GB.renderWordle(w.guesses, { rows: w.max }).catch(() => null);

    if (won) {
      const gain = 100 + (w.max - w.guesses.length) * 50;
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += gain;
      eco.save();
      delete c.wordle;
      persist();
      const cap = `🟩 *SOLVED!* The word was *${w.word.toUpperCase()}*.\n\n💰 +${eco.coins(gain)} coins`;
      if (wordleImg) { await sock.sendMessage(from, { image: wordleImg, caption: cap }, { quoted: msg }); return true; }
      await reply(`${cap}\n\n${board}`);
      return true;
    }
    if (outOf) {
      const answer = w.word.toUpperCase();
      delete c.wordle;
      persist();
      const cap = `💀 *Out of guesses!* The word was *${answer}*.`;
      if (wordleImg) { await sock.sendMessage(from, { image: wordleImg, caption: cap }, { quoted: msg }); return true; }
      await reply(`${cap}\n\n${board}`);
      return true;
    }
    persist();
    const cap = `Guesses left: *${w.max - w.guesses.length}*`;
    if (wordleImg) { await sock.sendMessage(from, { image: wordleImg, caption: cap }, { quoted: msg }); return true; }
    await reply(`${board}\n\n${cap}`);
    return true;
  }

  /* ── hangman ── */
  if (c.hangman) {
    const h = c.hangman;
    const letter = input.replace(/[^a-z]/g, '');
    if (letter.length === 1) {
      if (h.guessed.includes(letter)) { await reply('🔁 You already tried that letter.'); return true; }
      h.guessed.push(letter);
      const hit = h.word.includes(letter);
      if (!hit) h.wrong++;
      const shown = h.word.split('').map((ch) => (h.guessed.includes(ch) ? ch.toUpperCase() : '_')).join(' ');
      const solved = h.word.split('').every((ch) => h.guessed.includes(ch));
      const dead = h.wrong >= h.max;
      if (solved) {
        const u = eco.user(`${senderId}@s.whatsapp.net`);
        u.wallet += 150;
        eco.save();
        delete c.hangman;
        persist();
        const img = await GB.renderHangman(h.word, h.guessed, h.wrong, h.max).catch(() => null);
        const cap = `🏆 *SOLVED!* The word was *${h.word.toUpperCase()}*.\n\n💰 +150 coins`;
        if (img) { await sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg }); return true; }
        await reply(cap);
        return true;
      }
      if (dead) {
        const answer = h.word.toUpperCase();
        const finalGuessed = [...h.guessed];
        delete c.hangman;
        persist();
        const img = await GB.renderHangman(h.word, finalGuessed, h.max, h.max).catch(() => null);
        const cap = `💀 *Hanged!* The word was *${answer}*.`;
        if (img) { await sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg }); return true; }
        await reply(cap);
        return true;
      }
      persist();
      const img = await GB.renderHangman(h.word, h.guessed, h.wrong, h.max).catch(() => null);
      const cap = `${hit ? '✅ Hit!' : '❌ Miss.'} — lives left: *${h.max - h.wrong}*`;
      if (img) { await sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg }); return true; }
      await reply(`${cap}\n\n${shown}`);
      return true;
    }
    // whole word attempted
    if (input === h.word) {
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += 150;
      eco.save();
      const fullWord = h.word;
      const finalGuessed = [...h.guessed, ...fullWord.split('')];
      delete c.hangman;
      persist();
      const img = await GB.renderHangman(fullWord, finalGuessed, h.wrong, h.max).catch(() => null);
      const cap = `🏆 *SOLVED!* The word was *${fullWord.toUpperCase()}*.\n\n💰 +150 coins`;
      if (img) { await sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg }); return true; }
      await reply(cap);
      return true;
    }
    return false;
  }

  /* ── anagram / scramble ── */
  if (c.anagram) {
    if (input === c.anagram.word) {
      const gain = Math.max(40, 120 - c.anagram.tries * 15);
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += gain;
      eco.save();
      const word = c.anagram.word;
      delete c.anagram;
      persist();
      await reply(`🎉 *CORRECT!* The word was *${word.toUpperCase()}*.\n\n💰 +${eco.coins(gain)} coins`);
      return true;
    }
    if (input.length >= 3) {
      c.anagram.tries++;
      persist();
      await reply('❌ Not quite — try again.');
      return true;
    }
    return false;
  }

  /* ── word chain ── */
  if (c.chain) {
    const word = input;
    if (word.length < 3) return false;
    if (!word.startsWith(c.chain.last.slice(-1))) {
      await reply(`❌ Must start with *${c.chain.last.slice(-1).toUpperCase()}* — your word was *${word}*.`);
      return true;
    }
    if (c.chain.used.includes(word)) { await reply('🔁 Word already used.'); return true; }
    c.chain.used.push(word);
    c.chain.last = word;
    c.chain.score++;
    const u = eco.user(`${senderId}@s.whatsapp.net`);
    u.wallet += 25;
    eco.save();
    persist();
    await reply(`✅ *${word.toUpperCase()}* — chain length *${c.chain.score}*.\nNext word must start with *${word.slice(-1).toUpperCase()}*\n💰 +25 coins`);
    return true;
  }

  /* ── typeracer ── */
  if (c.typerace) {
    if (input.length < 20) return false;
    const target = norm(c.typerace.text);
    const secs = (Date.now() - c.typerace.start) / 1000;
    if (input === target) {
      const words = target.split(' ').length;
      const wpm = Math.round((words / secs) * 60);
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += 80;
      eco.save();
      delete c.typerace;
      persist();
      await reply(`⌨️ *FINISHED!*\n\n⏱️ Time: *${secs.toFixed(1)}s*\n🚀 Speed: *${wpm} WPM*\n\n💰 +80 coins`);
      return true;
    }
    // allow a close-but-not-exact submission to be told it's wrong once
    const wrong = target.split(' ').filter((w, i) => w !== input.split(' ')[i]).length;
    if (SecsGuard(wrong, secs)) {
      await reply(`❌ Not exact — *${wrong}* word(s) differ. Keep going!`);
      return true;
    }
    return false;
  }

  /* ── 2048 via plain direction words ── */
  if (c['2048'] && ['up', 'down', 'left', 'right'].includes(input)) {
    const g = c['2048'];
    const { grid, gained, moved } = b2048Move(g.grid, input);
    if (!moved) { await reply('🚫 Nothing moves that way.'); return true; }
    g.grid = grid;
    g.score += gained;
    const dead = grid.every((row, r) =>
      row.every((v, i) => {
        if (!v) return false;
        const right = row[i + 1];
        const down = grid[r + 1]?.[i];
        return v !== right && v !== down;
      }),
    );
    persist();
    const img = await GB.render2048(grid, { score: g.score }).catch(() => null);
    if (dead) {
      const score = g.score;
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += Math.min(500, Math.floor(score / 20));
      eco.save();
      delete c['2048'];
      persist();
      const cap = `💀 *GAME OVER* — no moves left.\nFinal score: *${score}*`;
      if (img) { await sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg }); return true; }
      await reply(`${cap}\n\n${b2048Render(grid)}`);
      return true;
    }
    const cap = `Score: *${g.score}*${gained ? ` (+${gained})` : ''}\nSend *.2048 up* · *down* · *left* · *right*`;
    if (img) { await sock.sendMessage(from, { image: img, caption: cap }, { quoted: msg }); return true; }
    await reply(`${cap}\n\n${b2048Render(grid)}`);
    return true;
  }

  /* ── generic text quiz (asahotak, caklontong, …) ── */
  if (c.quiz && c.quiz.type === 'text') {
    if (c.quiz.answers.includes(input)) {
      const gain = 100;
      const u = eco.user(`${senderId}@s.whatsapp.net`);
      u.wallet += gain;
      eco.save();
      const shown = c.quiz.answers[0].toUpperCase();
      const extra = c.quiz.display ? `\n\n📖 ${c.quiz.display}` : '';
      delete c.quiz;
      persist();
      await reply(`🎉 *CORRECT!* — *${shown}*${extra}\n\n💰 +${eco.coins(gain)} coins`);
      return true;
    }
    // only answer if it looks like an attempt (>=3 chars), otherwise ignore chat
    if (input.length >= 3) {
      await reply('❌ Wrong. Try again — *.hint* for a clue.');
      return true;
    }
    return false;
  }

  return false;
}

// tiny guard so eslint doesn't flag the unused helper name
function SecsGuard(a, b) { return a > 0 && b > 0.5; }

module.exports.handleFreeText = handleFreeText;
