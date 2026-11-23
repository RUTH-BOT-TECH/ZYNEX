/**
 * CHESS MODULE — real playable chess in WhatsApp
 *
 * Why not hand-rolled rules: castling rights, en passant, promotion, pin
 * detection, checkmate/stalemate/threefold/50-move all interact. `chess.js`
 * (BSD-2-Clause) implements the full FIDE rule set, so we delegate legality to
 * it and spend our effort on the parts users actually notice — a rendered
 * board image, clear turn ownership, and a proper opponent.
 *
 * Opponent:
 *   • vs CPU  → Stockfish via chess-api.com (keyless, verified working)
 *   • vs PvP  → two humans in the same chat, enforced by JID
 *
 * If the engine API is unreachable we fall back to a random legal move and
 * say so in the caption — never a silent hang.
 */
const { Chess } = require('chess.js');
const { renderBoard } = require('./chessboard');

const API = 'https://chess-api.com/v1';

/* ── helpers ─────────────────────────────────────────────── */
const PIECE_NAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
const COL_LETTER = { w: 'White', b: 'Black' };

function kingSquare(game) {
  const turn = game.turn();
  const board = game.board(); // row 0 = rank 8, row 7 = rank 1
  for (let r = 0; r < board.length; r++) {
    for (let i = 0; i < 8; i++) {
      const p = board[r][i];
      if (p && p.type === 'k' && p.color === turn) {
        return 'abcdefgh'[i] + (8 - r);
      }
    }
  }
  return null;
}

/** Describe a move result in plain words. */
function describeMove(mv) {
  const bits = [];
  const piece = PIECE_NAME[mv.piece] || 'Piece';
  if (mv.san.includes('#')) bits.push('Checkmate!');
  if (mv.san.includes('+') && !mv.san.includes('#')) bits.push('Check!');
  if (mv.captured) bits.push(`captures ${PIECE_NAME[mv.captured] || 'a piece'}`);
  if (mv.flags.includes('k') || mv.flags.includes('q')) bits.push('castles');
  if (mv.flags.includes('e')) bits.push('en passant');
  if (mv.promotion) bits.push(`promotes to ${PIECE_NAME[mv.promotion]}`);
  return { piece, summary: bits.join(', ') };
}

/** Ask Stockfish for a move. Returns { move } or { error }. */
async function engineMove(fen, level) {
  const depth = Math.max(4, Math.min(15, Number(level) || 8));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, depth, maxThinkingTime: 60 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `engine HTTP ${res.status}` };
    const data = await res.json();
    // chess-api returns {type:'bestmove', move:'e2e4', san:'e4', ...}
    const best = Array.isArray(data) ? data.find((d) => d && d.move) : data;
    if (!best?.move) return { error: 'engine returned no move' };
    return { move: best.move, san: best.san || '', eval: best.eval, mate: best.mate };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'engine timed out' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Very light opening book so the first moves are instant and sensible. */
const BOOK = {
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1': ['e2e4', 'd2d4', 'c2c4', 'g1f3'],
};

/* ── state ───────────────────────────────────────────────── */
/**
 * game = {
 *   fen, pgn,
 *   mode: 'cpu' | 'pvp',
 *   white: { id, jid }, black: { id, jid } | { id:'cpu' },
 *   players: [jidWhite, jidBlack],
 *   lastMove: {from,to},
 *   level, startedAt
 * }
 */

/** Build the caption block shown under every board image. */
function caption(game, cjs, opts = {}) {
  const turn = cjs.turn();
  const side = COL_LETTER[turn];
  const who = turn === 'w' ? game.white : game.black;
  const label = who.id === 'cpu' ? `${require('./botInfo').BOT_NAME} (CPU)` : `@${who.id}`;
  let out = '';
  if (opts.title) out += `${opts.title}\n\n`;

  const moveNo = Math.floor((cjs.history().length) / 2) + 1;
  out += `♟️ *CHESS* — ${game.mode === 'cpu' ? 'vs CPU' : 'Player vs Player'}\n`;
  out += `Move ${moveNo} · ${side} to play: *${label}*\n`;

  if (cjs.isCheckmate()) {
    const winner = turn === 'w' ? 'Black' : 'White';
    out += `\n🏆 *CHECKMATE — ${winner} wins!*`;
  } else if (cjs.isDraw()) {
    const why = cjs.isStalemate()
      ? 'stalemate'
      : cjs.isThreefoldRepetition()
        ? 'threefold repetition'
        : cjs.isInsufficientMaterial()
          ? 'insufficient material'
          : '50-move rule';
    out += `\n🤝 *DRAW* — ${why}`;
  } else if (cjs.isCheck()) {
    out += `\n⚠️ *${side} is in check!*`;
  }

  if (opts.lastSan) out += `\n\nLast move: *${opts.lastSan}*${opts.lastNote ? ` — ${opts.lastNote}` : ''}`;
  if (opts.note) out += `\n${opts.note}`;

  if (!cjs.isGameOver() && !opts.hideHelp) {
    out += `\n\nReply with your move: *.move e4* or *.move e2e4*`;
    out += `\n\`.board\` · \`.hint\` · \`.resign\` · \`.undo\``;
  }
  return out;
}

module.exports = {
  name: 'chess-module',
  Chess,
  renderBoard,
  engineMove,
  describeMove,
  caption,
  kingSquare,
  BOOK,
  PIECE_NAME,
  COL_LETTER,
};
