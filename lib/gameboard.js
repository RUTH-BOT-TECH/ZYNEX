/**
 * GAME BOARD RENDERERS
 *
 * Every board game sends a PNG instead of an ASCII grid, for the same reasons
 * as the chess board:
 *   • identical on every phone (no monospace font dependency)
 *   • works with WhatsApp's image preview and can be tapped to save
 *   • far more legible than emoji grids at small sizes
 *
 * All shapes are drawn with SVG primitives (lines, circles, rects) rather than
 * glyphs wherever possible, so rendering never depends on a font shipping the
 * right Unicode codepoint. Text is used only for digits and A-Z, which every
 * font has.
 */
const sharp = require('sharp');

const FONT = 'DejaVu Sans, sans-serif';

/* ── shared helpers ──────────────────────────────────────── */
async function toPng(svg, density = 144) {
  return sharp(Buffer.from(svg), { density }).png({ compressionLevel: 9 }).toBuffer();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function roundRect(x, y, w, h, r, fill, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" ${extra}/>`;
}

/** Draw an X made of two strokes (font-independent). */
function drawX(cx, cy, size, colour, width) {
  const a = size / 2;
  return (
    `<line x1="${cx - a}" y1="${cy - a}" x2="${cx + a}" y2="${cy + a}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>` +
    `<line x1="${cx + a}" y1="${cy - a}" x2="${cx - a}" y2="${cy + a}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`
  );
}

/** Draw an O as a stroked circle. */
function drawO(cx, cy, size, colour, width) {
  return `<circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="none" stroke="${colour}" stroke-width="${width}"/>`;
}

/* ══════════════════════════════════════════════════════════
 * TIC-TAC-TOE / X AND O
 * ══════════════════════════════════════════════════════════ */
function tttSvg(board, opts = {}) {
  const SQ = 132, PAD = 26, GAP = 8;
  const W = SQ * 3 + GAP * 2 + PAD * 2;
  const H = W;
  const BG = '#141a24';
  const CELL = '#223044';
  const CELL_ALT = '#1b2636';
  const X_COLOUR = '#ff5c7a';
  const O_COLOUR = '#4cc9f0';
  const HL = '#f7d94c';

  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  const cellXY = (i) => {
    const r = Math.floor(i / 3), c = i % 3;
    return { x: PAD + c * (SQ + GAP), y: PAD + r * (SQ + GAP) };
  };

  for (let i = 0; i < 9; i++) {
    const { x, y } = cellXY(i);
    const isLast = opts.lastMove === i;
    body += roundRect(x, y, SQ, SQ, 14, isLast ? HL : (i % 2 === 0 ? CELL : CELL_ALT));
  }

  // winning line
  if (Array.isArray(opts.winLine) && opts.winLine.length === 3) {
    const [a, , c] = opts.winLine;
    const p1 = cellXY(a), p2 = cellXY(c);
    body += `<line x1="${p1.x + SQ / 2}" y1="${p1.y + SQ / 2}" x2="${p2.x + SQ / 2}" y2="${p2.y + SQ / 2}" stroke="#39d98a" stroke-width="12" stroke-linecap="round" stroke-opacity="0.85"/>`;
  }

  for (let i = 0; i < 9; i++) {
    const { x, y } = cellXY(i);
    const cx = x + SQ / 2, cy = y + SQ / 2;
    if (board[i] === 'X') body += drawX(cx, cy, SQ * 0.5, X_COLOUR, 14);
    else if (board[i] === 'O') body += drawO(cx, cy, SQ * 0.42, O_COLOUR, 14);
    else {
      // faint square numbers so new players know what to type
      body += `<text x="${cx}" y="${cy + 9}" font-size="30" text-anchor="middle" fill="#4a5c74" font-family="${FONT}">${i + 1}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderTTT(board, opts = {}) {
  return toPng(tttSvg(board, opts));
}

/* ══════════════════════════════════════════════════════════
 * CONNECT 4
 * ══════════════════════════════════════════════════════════ */
function c4Svg(board, opts = {}) {
  const S = 92, PAD = 22, GAP = 6;
  const COLS = 7, ROWS = 6;
  const W = COLS * S + (COLS + 1) * GAP + PAD * 2 - GAP;
  const H = ROWS * S + (ROWS + 1) * GAP + PAD * 2 - GAP + 30;
  const BG = '#101826';
  const BOARD = '#1f4fd8';
  const EMPTY = '#0d1a33';
  const RED = '#ff4757';
  const YELLOW = '#ffd93d';

  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  const gridW = COLS * S + (COLS - 1) * GAP;
  const gridH = ROWS * S + (ROWS - 1) * GAP;
  body += roundRect(PAD - GAP, PAD - GAP, gridW + GAP * 2, gridH + GAP * 2, 16, BOARD);

  const cellXY = (r, c) => ({ x: PAD + c * (S + GAP), y: PAD + r * (S + GAP) });

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = cellXY(r, c);
      const v = board[r][c];
      const isLast = opts.lastMove && opts.lastMove.row === r && opts.lastMove.col === c;
      const fill = v === 1 ? RED : v === 2 ? YELLOW : EMPTY;
      body += `<circle cx="${x + S / 2}" cy="${y + S / 2}" r="${S / 2 - 2}" fill="${fill}"/>`;
      if (isLast) {
        body += `<circle cx="${x + S / 2}" cy="${y + S / 2}" r="${S / 2 - 8}" fill="none" stroke="#ffffff" stroke-width="4" stroke-opacity="0.9"/>`;
      }
    }
  }

  // highlight the winning four
  if (Array.isArray(opts.winCells)) {
    for (const [r, c] of opts.winCells) {
      const { x, y } = cellXY(r, c);
      body += `<circle cx="${x + S / 2}" cy="${y + S / 2}" r="${S / 2 - 10}" fill="none" stroke="#39d98a" stroke-width="6"/>`;
    }
  }

  // column numbers
  for (let c = 0; c < COLS; c++) {
    const { x } = cellXY(0, c);
    body += `<text x="${x + S / 2}" y="${H - 8}" font-size="20" text-anchor="middle" fill="#7f93b0" font-family="${FONT}">${c + 1}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderConnect4(board, opts = {}) {
  return toPng(c4Svg(board, opts));
}

/* ══════════════════════════════════════════════════════════
 * 2048
 * ══════════════════════════════════════════════════════════ */
const TILE_COLOURS = {
  0: '#1e2733', 2: '#3b4a5e', 4: '#4a5f7a', 8: '#e8a33d',
  16: '#e8873d', 32: '#e86b3d', 64: '#e84f3d', 128: '#d9c04a',
  256: '#d9a84a', 512: '#c98be0', 1024: '#8b7ce8', 2048: '#e84fd9',
};

function b2048Svg(grid, opts = {}) {
  const S = 108, PAD = 22, GAP = 10;
  const W = 4 * S + 3 * GAP + PAD * 2;
  const H = W + 34;
  const BG = '#12171f';

  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = grid[r][c];
      const x = PAD + c * (S + GAP);
      const y = PAD + r * (S + GAP);
      const fill = TILE_COLOURS[v] || TILE_COLOURS[2048];
      body += roundRect(x, y, S, S, 10, fill);
      if (v) {
        const size = v >= 1000 ? 34 : v >= 100 ? 42 : 48;
        body += `<text x="${x + S / 2}" y="${y + S / 2 + size / 3}" font-size="${size}" text-anchor="middle" font-weight="bold" fill="${v >= 8 ? '#1a1005' : '#dce6f2'}" font-family="${FONT}">${v}</text>`;
      }
    }
  }
  body += `<text x="${PAD}" y="${H - 10}" font-size="19" fill="#8fa3bb" font-family="${FONT}">Score ${opts.score || 0}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function render2048(grid, opts = {}) {
  return toPng(b2048Svg(grid, opts));
}

/* ══════════════════════════════════════════════════════════
 * MINESWEEPER
 * ══════════════════════════════════════════════════════════ */
const NUM_COLOURS = ['#8fa3bb', '#4da3ff', '#39d98a', '#ff6b6b', '#b47cff', '#ff9f43', '#39d6d6', '#e0e0e0', '#c0c0c0'];

function mineSvg(grid) {
  const S = 78, PAD = 22, GAP = 5;
  const N = grid.length;
  const W = N * S + (N - 1) * GAP + PAD * 2;
  const H = W;
  const BG = '#12171f';
  const CLOSED = '#2b3a4f';
  const OPEN = '#3c4f6b';

  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = grid[r][c];
      const x = PAD + c * (S + GAP);
      const y = PAD + r * (S + GAP);
      body += roundRect(x, y, S, S, 9, cell.open ? OPEN : CLOSED);
      const cx = x + S / 2, cy = y + S / 2;
      if (!cell.open) {
        body += `<text x="${cx}" y="${cy + 7}" font-size="22" text-anchor="middle" fill="#5f7691" font-family="${FONT}">?</text>`;
      } else if (cell.mine) {
        // draw a mine: spiked circle, no glyph dependency
        body += `<circle cx="${cx}" cy="${cy}" r="${S * 0.22}" fill="#1b1b1b"/>`;
        for (let a = 0; a < 8; a++) {
          const ang = (Math.PI / 4) * a;
          const x1 = cx + Math.cos(ang) * S * 0.2, y1 = cy + Math.sin(ang) * S * 0.2;
          const x2 = cx + Math.cos(ang) * S * 0.34, y2 = cy + Math.sin(ang) * S * 0.34;
          body += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1b1b1b" stroke-width="5" stroke-linecap="round"/>`;
        }
        body += `<circle cx="${cx - 6}" cy="${cy - 6}" r="3.5" fill="#8a8a8a"/>`;
      } else if (cell.n > 0) {
        body += `<text x="${cx}" y="${cy + 10}" font-size="34" font-weight="bold" text-anchor="middle" fill="${NUM_COLOURS[cell.n]}" font-family="${FONT}">${cell.n}</text>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderMinesweeper(grid) {
  return toPng(mineSvg(grid));
}

/* ══════════════════════════════════════════════════════════
 * SUDOKU
 * ══════════════════════════════════════════════════════════ */
function sudokuSvg(puzzle) {
  const S = 56, PAD = 20;
  const W = 9 * S + PAD * 2;
  const H = W;
  const BG = '#12171f';

  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  body += roundRect(PAD, PAD, 9 * S, 9 * S, 8, '#1e2836');

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = puzzle[r][c];
      const x = PAD + c * S, y = PAD + r * S;
      // alternate 3x3 block shading
      const blockDark = (Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 0;
      body += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${blockDark ? '#243244' : '#1b2532'}"/>`;
      if (v) {
        body += `<text x="${x + S / 2}" y="${y + S / 2 + 10}" font-size="30" text-anchor="middle" fill="#e8eef7" font-family="${FONT}">${v}</text>`;
      }
    }
  }

  // grid lines
  for (let i = 0; i <= 9; i++) {
    const thick = i % 3 === 0;
    const pos = PAD + i * S;
    const col = thick ? '#7f93b0' : '#33465e';
    const wdt = thick ? 3 : 1;
    body += `<line x1="${pos}" y1="${PAD}" x2="${pos}" y2="${PAD + 9 * S}" stroke="${col}" stroke-width="${wdt}"/>`;
    body += `<line x1="${PAD}" y1="${pos}" x2="${PAD + 9 * S}" y2="${pos}" stroke="${col}" stroke-width="${wdt}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderSudoku(puzzle) {
  return toPng(sudokuSvg(puzzle));
}

/* ══════════════════════════════════════════════════════════
 * MAZE
 * ══════════════════════════════════════════════════════════ */
function mazeSvg(grid, pos) {
  const S = 58, PAD = 18;
  const N = grid.length;
  const W = N * S + PAD * 2;
  const H = W;

  let body = `<rect width="${W}" height="${H}" fill="#12171f"/>`;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = grid[r][c];
      const x = PAD + c * S, y = PAD + r * S;
      const isWall = v === '\u2b1b';
      body += `<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="${isWall ? '#2b3a4f' : '#141c27'}"/>`;
      if (!isWall) body += `<rect x="${x + 1}" y="${y + 1}" width="${S - 2}" height="${S - 2}" fill="none" stroke="#1d2942" stroke-width="1"/>`;

      const cx = x + S / 2, cy = y + S / 2;
      if (v === '\ud83d\udfe2') {
        body += `<circle cx="${cx}" cy="${cy}" r="${S * 0.28}" fill="#39d98a"/>`;
      } else if (v === '\ud83c\udfc1') {
        body += `<rect x="${cx - 3}" y="${cy - S * 0.3}" width="4" height="${S * 0.6}" fill="#c9d4e3"/>`;
        body += `<path d="M ${cx + 1} ${cy - S * 0.3} l ${S * 0.34} ${S * 0.13} l ${-S * 0.34} ${S * 0.13} z" fill="#ff4757"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderMaze(grid, pos) {
  return toPng(mazeSvg(grid, pos));
}

/* ══════════════════════════════════════════════════════════
 * WORDLE
 * ══════════════════════════════════════════════════════════ */
function wordleSvg(guesses, opts = {}) {
  const S = 74, GAP = 8, PAD = 22;
  const ROWS = opts.rows || 6;
  const W = 5 * S + 4 * GAP + PAD * 2;
  const H = ROWS * S + (ROWS - 1) * GAP + PAD * 2;
  const BG = '#12171f';
  const COLOURS = { '\ud83d\udfe9': '#2f9e5f', '\ud83d\udfe8': '#c9a227', '\u2b1b': '#2b3a4f' };

  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  for (let r = 0; r < ROWS; r++) {
    const guess = guesses[r];
    for (let c = 0; c < 5; c++) {
      const x = PAD + c * (S + GAP);
      const y = PAD + r * (S + GAP);
      const mark = guess ? [...guess.marks][c] : null;
      const fill = mark ? COLOURS[mark] || '#2b3a4f' : '#1a2230';
      body += roundRect(x, y, S, S, 7, fill);
      if (guess) {
        body += `<text x="${x + S / 2}" y="${y + S / 2 + 12}" font-size="34" font-weight="bold" text-anchor="middle" fill="#ffffff" font-family="${FONT}">${esc(guess.word[c].toUpperCase())}</text>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderWordle(guesses, opts = {}) {
  return toPng(wordleSvg(guesses, opts));
}

/* ══════════════════════════════════════════════════════════
 * HANGMAN
 * ══════════════════════════════════════════════════════════ */
function hangmanSvg(word, guessed, wrong, max) {
  const W = 560, H = 300, PAD = 24;
  const BG = '#12171f';

  // gallows
  let body = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  const gx = 90, gy = 44, gh = 190;
  body += `<line x1="${gx}" y1="${gy + gh}" x2="${gx + 130}" y2="${gy + gh}" stroke="#7f93b0" stroke-width="6" stroke-linecap="round"/>`;
  body += `<line x1="${gx + 40}" y1="${gy + gh}" x2="${gx + 40}" y2="${gy}" stroke="#7f93b0" stroke-width="6" stroke-linecap="round"/>`;
  body += `<line x1="${gx + 40}" y1="${gy}" x2="${gx + 110}" y2="${gy}" stroke="#7f93b0" stroke-width="6" stroke-linecap="round"/>`;
  body += `<line x1="${gx + 110}" y1="${gy}" x2="${gx + 110}" y2="${gy + 34}" stroke="#7f93b0" stroke-width="4"/>`;

  const hx = gx + 110, hy = gy + 34;
  const C = '#ff6b6b';
  if (wrong > 0) body += `<circle cx="${hx}" cy="${hy + 22}" r="21" fill="none" stroke="${C}" stroke-width="5"/>`;
  if (wrong > 1) body += `<line x1="${hx}" y1="${hy + 43}" x2="${hx}" y2="${hy + 100}" stroke="${C}" stroke-width="5" stroke-linecap="round"/>`;
  if (wrong > 2) body += `<line x1="${hx}" y1="${hy + 55}" x2="${hx - 28}" y2="${hy + 82}" stroke="${C}" stroke-width="5" stroke-linecap="round"/>`;
  if (wrong > 3) body += `<line x1="${hx}" y1="${hy + 55}" x2="${hx + 28}" y2="${hy + 82}" stroke="${C}" stroke-width="5" stroke-linecap="round"/>`;
  if (wrong > 4) body += `<line x1="${hx}" y1="${hy + 100}" x2="${hx - 24}" y2="${hy + 140}" stroke="${C}" stroke-width="5" stroke-linecap="round"/>`;
  if (wrong > 5) body += `<line x1="${hx}" y1="${hy + 100}" x2="${hx + 24}" y2="${hy + 140}" stroke="${C}" stroke-width="5" stroke-linecap="round"/>`;

  // word blanks
  const n = word.length;
  const slotW = Math.min(46, (W - 300) / n);
  const startX = 270;
  const baseY = 250;
  for (let i = 0; i < n; i++) {
    const ch = word[i];
    const shown = guessed.includes(ch);
    const x = startX + i * slotW;
    body += `<line x1="${x}" y1="${baseY}" x2="${x + slotW - 8}" y2="${baseY}" stroke="#3f5371" stroke-width="3"/>`;
    if (shown) {
      body += `<text x="${x + (slotW - 8) / 2}" y="${baseY - 12}" font-size="32" font-weight="bold" text-anchor="middle" fill="#39d98a" font-family="${FONT}">${esc(ch.toUpperCase())}</text>`;
    }
  }

  // lives
  body += `<text x="${W - PAD}" y="${PAD + 16}" font-size="17" text-anchor="end" fill="#8fa3bb" font-family="${FONT}">Lives ${max - wrong}/${max}</text>`;

  // letters used
  const wrongLetters = guessed.filter((g) => !word.includes(g));
  if (wrongLetters.length) {
    body += `<text x="${W - PAD}" y="${PAD + 46}" font-size="16" text-anchor="end" fill="#ff6b6b" font-family="${FONT}">Missed: ${esc(wrongLetters.join(' ').toUpperCase())}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

async function renderHangman(word, guessed, wrong, max) {
  return toPng(hangmanSvg(word, guessed, wrong, max));
}

module.exports = {
  renderTTT,
  renderConnect4,
  render2048,
  renderMinesweeper,
  renderSudoku,
  renderMaze,
  renderWordle,
  renderHangman,
  // svg builders exposed for tests / other renderers
  tttSvg, c4Svg, b2048Svg, mineSvg, sudokuSvg, mazeSvg, wordleSvg, hangmanSvg,
  toPng,
};
