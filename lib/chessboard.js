/**
 * CHESS BOARD RENDERER
 *
 * Produces a real PNG board from a FEN string, so `.chess` sends an image
 * instead of an ASCII grid — the way proper WhatsApp chess bots do it.
 *
 * Why this exists: WhatsApp messages are plain text. A text board needs an
 * installed monospace font on every player's phone and still looks poor. An
 * image renders identically for everyone, shows the last move, and can be
 * tapped to save.
 *
 * Rendering chain: SVG string -> sharp -> PNG buffer -> sock.sendMessage({image}).
 * sharp ships prebuilt binaries, so there is nothing to install on the host.
 */
const sharp = require('sharp');

const SQ = 58;           // square size in px
const PAD = 22;          // border for coordinate labels
const W = SQ * 8 + PAD * 2;
const H = W;

/* Board palette — high contrast, readable at WhatsApp preview size */
const LIGHT = '#edd6b0';
const DARK = '#b58863';
const BORDER = '#2b2118';
const LABEL = '#e8dcc8';
const MOVE_HL = '#f7ec5e';   // last move highlight
const CHECK_HL = '#e34b4b';  // king in check

/* DejaVu Sans (present on Debian/Render) draws these as outline shapes,
 * so colour — not glyph choice — is what separates white from black.
 * We use the solid "black" codepoints for both sides and paint them. */
const GLYPH = {
  k: '\u265A', q: '\u265B', r: '\u265C',
  b: '\u265D', n: '\u265E', p: '\u265F',
};

const FONT = 'DejaVu Sans, DejaVu Serif, sans-serif';

/** Expand a FEN rank like "rnbqkbnr" or "4k3" into 8 cells ('' = empty). */
function expandRank(rank) {
  const out = [];
  for (const ch of rank) {
    if (/\d/.test(ch)) {
      for (let i = 0; i < parseInt(ch, 10); i++) out.push('');
    } else {
      out.push(ch);
    }
  }
  while (out.length < 8) out.push('');
  return out.slice(0, 8);
}

/** FEN -> 8x8 grid, grid[0] = rank 8 (top of the image). */
function parseFen(fen) {
  const placement = String(fen || '').split(/\s+/)[0];
  const ranks = placement.split('/');
  const grid = [];
  for (let r = 0; r < 8; r++) grid.push(expandRank(ranks[r] || ''));
  return grid;
}

/** Algebraic square ("e4") -> {row, col} in image space. */
function squareToRc(sq) {
  if (!/^[a-h][1-8]$/.test(String(sq))) return null;
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1], 10);
  return { row, col };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the SVG for a position.
 * @param {string} fen
 * @param {object} opts  { lastMove:{from,to}, checkSquare:'e1', flipped:bool }
 */
function boardSvg(fen, opts = {}) {
  const grid = parseFen(fen);
  const { lastMove, checkSquare, flipped } = opts;

  const at = (row, col) => {
    if (!flipped) return grid[row]?.[col] || '';
    return grid[7 - row]?.[7 - col] || '';
  };

  let body = `<rect x="0" y="0" width="${W}" height="${H}" fill="${BORDER}"/>`;

  /* squares */
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const x = PAD + col * SQ;
      const y = PAD + row * SQ;
      const light = (row + col) % 2 === 0;
      body += `<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${light ? LIGHT : DARK}"/>`;
    }
  }

  /* last-move highlight (transparent wash so pieces stay readable) */
  if (lastMove?.from || lastMove?.to) {
    for (const sq of [lastMove.from, lastMove.to]) {
      const rc = squareToRc(sq);
      if (!rc) continue;
      const row = flipped ? 7 - rc.row : rc.row;
      const col = flipped ? 7 - rc.col : rc.col;
      body += `<rect x="${PAD + col * SQ}" y="${PAD + row * SQ}" width="${SQ}" height="${SQ}"
        fill="${MOVE_HL}" fill-opacity="0.45"/>`;
    }
  }

  /* check highlight */
  if (checkSquare) {
    const rc = squareToRc(checkSquare);
    if (rc) {
      const row = flipped ? 7 - rc.row : rc.row;
      const col = flipped ? 7 - rc.col : rc.col;
      body += `<rect x="${PAD + col * SQ}" y="${PAD + row * SQ}" width="${SQ}" height="${SQ}"
        fill="${CHECK_HL}" fill-opacity="0.6"/>`;
    }
  }

  /* pieces */
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = at(row, col);
      if (!piece) continue;
      const isWhite = piece === piece.toUpperCase();
      const glyph = GLYPH[piece.toLowerCase()];
      if (!glyph) continue;
      const cx = PAD + col * SQ + SQ / 2;
      const cy = PAD + row * SQ + SQ / 2;
      // white pieces = solid white fill + dark outline; black = solid dark + light outline
      const fill = isWhite ? '#ffffff' : '#1d1d1d';
      const stroke = isWhite ? '#3a2a1a' : '#e9e2d4';
      body +=
        `<text x="${cx}" y="${cy + 3}" font-size="${Math.round(SQ * 0.78)}" ` +
        `text-anchor="middle" dominant-baseline="central" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="1.1" ` +
        `font-family="${FONT}">${glyph}</text>`;
    }
  }

  /* coordinate labels */
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  for (let col = 0; col < 8; col++) {
    body += `<text x="${PAD + col * SQ + SQ / 2}" y="${H - 6}" font-size="12" text-anchor="middle" fill="${LABEL}" font-family="${FONT}">${files[col]}</text>`;
  }
  for (let row = 0; row < 8; row++) {
    const rank = flipped ? row + 1 : 8 - row;
    body += `<text x="10" y="${PAD + row * SQ + SQ / 2 + 4}" font-size="12" text-anchor="middle" fill="${LABEL}" font-family="${FONT}">${rank}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
}

/** Render a FEN to a PNG buffer. */
async function renderBoard(fen, opts = {}) {
  const svg = boardSvg(fen, opts);
  return sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderBoard, boardSvg, parseFen, squareToRc, W, H };
