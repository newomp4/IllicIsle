/* ===========================================================
   bitfont.js — a hand-built 5x7 bitmap font.

   Why not just use the webfont? Because canvas and CSS always
   antialias glyph edges, however small you set them. A PS1 UI
   was blitted sprites: hard pixels, no grey fringe, and it
   wobbled with the rest of the frame. The only way to get that
   is to own the glyphs, so here they are as bit rows.

   Each glyph is 7 rows of 5 bits, MSB first.
   =========================================================== */

const F = {
  'A': [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  'B': [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  'C': [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  'D': [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
  'E': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  'F': [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  'G': [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  'H': [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  'I': [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  'M': [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  'N': [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  'O': [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  'P': [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  'Q': [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
  'R': [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  'S': [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  'T': [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
  'X': [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
  'Y': [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
  'Z': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
  '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0C, 0x0C],
  ',': [0, 0, 0, 0, 0x0C, 0x0C, 0x08],
  ':': [0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0],
  ';': [0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0x08],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0E, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  "'": [0x04, 0x04, 0, 0, 0, 0, 0],
  '"': [0x0A, 0x0A, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x1F, 0, 0, 0],
  '_': [0, 0, 0, 0, 0, 0, 0x1F],
  '+': [0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '\\': [0x10, 0x10, 0x08, 0x04, 0x02, 0x01, 0x01],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '[': [0x0E, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0E],
  ']': [0x0E, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0E],
  '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  '=': [0, 0, 0x1F, 0, 0x1F, 0, 0],
  '*': [0, 0x0A, 0x04, 0x1F, 0x04, 0x0A, 0],
  '%': [0x11, 0x01, 0x02, 0x04, 0x08, 0x10, 0x11],
  '#': [0x0A, 0x1F, 0x0A, 0x0A, 0x0A, 0x1F, 0x0A],
  '&': [0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D],
  '@': [0x0E, 0x11, 0x17, 0x15, 0x17, 0x10, 0x0E],
  '$': [0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04],
  // arrows and pips
  '▶': [0x08, 0x0C, 0x0E, 0x0F, 0x0E, 0x0C, 0x08],  // ▶
  '◀': [0x02, 0x06, 0x0E, 0x1E, 0x0E, 0x06, 0x02],  // ◀
  '●': [0, 0x0E, 0x1F, 0x1F, 0x1F, 0x0E, 0],        // ●
  '•': [0, 0, 0x0E, 0x0E, 0x0E, 0, 0],              // •
  '↑': [0x04, 0x0E, 0x15, 0x04, 0x04, 0x04, 0x04],  // ↑
  '↓': [0x04, 0x04, 0x04, 0x04, 0x15, 0x0E, 0x04],  // ↓
  '←': [0, 0x04, 0x08, 0x1F, 0x08, 0x04, 0],        // ←
  '→': [0, 0x04, 0x02, 0x1F, 0x02, 0x04, 0],        // →
};

/* Characters the game's copy actually uses that aren't in the table.
   Without this an em-dash renders as "?" in the middle of a sentence. */
const SUBS = {
  '\u2014': '-', '\u2013': '-', '\u2212': '-',
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
  '\u00B7': '.', '\u2026': '...', '\u00D7': 'X',
  '\u25CF': '\u25CF', '\u25C9': '\u25CF',
};

/** Fold text down to glyphs the font can actually draw. */
export function normalize(text) {
  let out = '';
  for (const ch of String(text).toUpperCase()) {
    out += SUBS[ch] !== undefined ? SUBS[ch] : ch;
  }
  return out;
}

export const GLYPH_W = 5;
export const GLYPH_H = 7;

/** Width in pixels of `text` at scale `s` with `tracking` px between glyphs. */
export function textWidth(text, s = 1, tracking = 1) {
  if (!text) return 0;
  const n = normalize(text).length;
  return n * (GLYPH_W + tracking) * s - tracking * s;
}

/**
 * Blit text with hard pixels. Every "pixel" is an integer-aligned rect, so
 * nothing is ever half-covered and there is no grey fringe.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o { x, y, scale, color, tracking, align, shadow }
 */
/* ===========================================================
   AN OPT-IN RECORDER

   Text drawn on top of other text is the one layout fault a screenshot
   sweep keeps missing — at a glance a collision just looks like a slightly
   wrong glyph. So drawText can record the rectangle it occupies, and a test
   can render a frame and ask which pairs overlap.

   Off unless something turns it on, and one branch when off.
   =========================================================== */
export let textBoxes = null;

/** @param {boolean} on @returns {Array|null} the live list */
export function recordText(on) {
  textBoxes = on ? [] : null;
  return textBoxes;
}

/* ===========================================================
   A BAKED GLYPH ATLAS

   Every string used to be walked bit by bit and painted as a rect per run
   of set pixels — around eleven a glyph, and twice over because the shadow
   is a second pass — which put the Castaways HUD on its own into the
   thousands of fills a frame. The bitmaps never change, so bake them: one
   white mask, then a tinted copy per colour and scale, and a string becomes
   one drawImage a character.
   =========================================================== */
const ATLAS_CHARS = Object.keys(F);
const ATLAS_INDEX = {};
ATLAS_CHARS.forEach((ch, i) => { ATLAS_INDEX[ch] = i; });
let _glyphMask = null;
const _glyphAtlases = new Map();

function glyphMask() {
  if (_glyphMask) return _glyphMask;
  const c = document.createElement('canvas');
  c.width = ATLAS_CHARS.length * GLYPH_W; c.height = GLYPH_H;
  const cx = c.getContext('2d');
  cx.fillStyle = '#fff';
  for (let n = 0; n < ATLAS_CHARS.length; n++) {
    const g = F[ATLAS_CHARS[n]];
    for (let r = 0; r < GLYPH_H; r++) {
      const bits = g[r];
      if (!bits) continue;
      for (let c2 = 0; c2 < GLYPH_W; c2++) {
        if ((bits >> (GLYPH_W - 1 - c2)) & 1) cx.fillRect(n * GLYPH_W + c2, r, 1, 1);
      }
    }
  }
  _glyphMask = c;
  return c;
}

/* Baked at the scale it will be blitted at, so the draw into the caller's
   canvas is 1:1 and cannot pick up whatever smoothing that context has set. */
function glyphAtlas(col, s) {
  const key = col + '|' + s;
  let a = _glyphAtlases.get(key);
  if (a) return a;
  const m = glyphMask();
  a = document.createElement('canvas');
  a.width = m.width * s; a.height = m.height * s;
  const ax = a.getContext('2d');
  ax.imageSmoothingEnabled = false;
  ax.drawImage(m, 0, 0, a.width, a.height);
  ax.globalCompositeOperation = 'source-in';
  ax.fillStyle = col;
  ax.fillRect(0, 0, a.width, a.height);
  _glyphAtlases.set(key, a);
  return a;
}

export function drawText(ctx, text, o = {}) {
  const s = o.scale ?? 2;
  const tracking = o.tracking ?? 1;
  const str = normalize(text);
  /* normalize is idempotent, so str.length is already the glyph count —
     handing str back to textWidth would just walk and rebuild it a second
     time, and every drawText call pays for it. */
  const w = str.length ? str.length * (GLYPH_W + tracking) * s - tracking * s : 0;
  let x = Math.round(o.x ?? 0);
  const y = Math.round(o.y ?? 0);
  if (o.align === 'center') x -= Math.round(w / 2);
  else if (o.align === 'right') x -= Math.round(w);
  if (textBoxes && str.trim()) textBoxes.push({ x, y, w, h: GLYPH_H * s, t: str });

  const cell = (GLYPH_W + tracking) * s;

  const blit = (col, dx, dy) => {
    ctx.fillStyle = col;
    for (let i = 0; i < str.length; i++) {
      const g = F[str[i]] || F['?'];
      const gx = x + i * cell + dx;
      for (let r = 0; r < GLYPH_H; r++) {
        const bits = g[r];
        if (!bits) continue;
        // collapse runs of set bits into single rects — fewer fills, and
        // adjacent pixels never seam
        let run = 0;
        for (let c = 0; c < GLYPH_W; c++) {
          const on = (bits >> (GLYPH_W - 1 - c)) & 1;
          if (on) { run++; continue; }
          if (run) { ctx.fillRect(gx + (c - run) * s, y + r * s + dy, run * s, s); run = 0; }
        }
        if (run) ctx.fillRect(gx + (GLYPH_W - run) * s, y + r * s + dy, run * s, s);
      }
    }
  };

  /* A fractional scale would put the atlas' glyph slots on half pixels and
     drawImage would sample across into the letter next door, so the rare
     caller that asks for one keeps the old per-run fills. */
  if (!Number.isInteger(s) || s < 1) {
    if (o.shadow !== false) blit(o.shadowColor ?? '#000', s, s);
    blit(o.color ?? '#fff3c4', 0, 0);
    return w;
  }

  const gw = GLYPH_W * s, gh = GLYPH_H * s;
  const stamp = (col, dx, dy) => {
    const a = glyphAtlas(col, s);
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === ' ') continue;
      const n = ATLAS_INDEX[ch] ?? ATLAS_INDEX['?'];
      ctx.drawImage(a, n * gw, 0, gw, gh, x + i * cell + dx, y + dy, gw, gh);
    }
  };

  if (o.shadow !== false) stamp(o.shadowColor ?? '#000', s, s);
  stamp(o.color ?? '#fff3c4', 0, 0);
  return w;
}

/** Wrap `text` to `maxPx` and return the lines. */
export function wrapText(text, maxPx, s = 2, tracking = 1) {
  const words = normalize(text).split(/\s+/);
  const lines = [];
  const cell = (GLYPH_W + tracking) * s;
  /* The words came out of an already-normalized string, so measuring with
     textWidth would re-normalize the whole accumulated line once per word. */
  const widthOf = (t) => (t.length ? t.length * cell - tracking * s : 0);
  /* Most glyphs that fit on one line, from n * cell - tracking * s <= maxPx.
     Floored at 1 so an absurdly narrow box cannot spin the cut below forever. */
  const perLine = Math.max(1, Math.floor((maxPx + tracking * s) / cell));
  let line = '';
  for (let word of words) {
    /* A single word wider than the box used to be emitted whole, so a
       spaceless chat message drew straight through the panel border and off
       the frame. Cut it into box-width chunks instead. */
    while (word.length > perLine) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, perLine));
      word = word.slice(perLine);
    }
    if (!word) continue;
    const test = line ? line + ' ' + word : word;
    if (widthOf(test) > maxPx && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/* ===========================================================
   PANEL CHROME — dithered fills and chunky bevels
   =========================================================== */

const _ditherTiles = new Map();

/** 2x2 ordered dither between two colours; `amount` 0..1 picks the mix. */
export function ditherRect(ctx, x, y, w, h, colA, colB, amount, px = 2) {
  const M = [[0, 2], [3, 1]];
  /* A full-screen dither is fifteen thousand fills a frame, repainted every
     frame for as long as a menu is up, and only the ordering of `amount`
     against {0,.25,.5,.75} changes what comes out — so a continuously
     animated amount still lands in one of five cached tiles. */
  const lvl = (amount > 0) + (amount > 0.25) + (amount > 0.5) + (amount > 0.75);
  const ix = Math.round(x), iy = Math.round(y);
  // A sub-pixel origin would resample the tile; keep the old path for those
  // and for rects too small for the setup to pay for itself.
  if (ix !== x || iy !== y || w < px * 4 || h < px * 4) {
    for (let j = 0; j < h; j += px) {
      for (let i = 0; i < w; i += px) {
        const t = M[(j / px) & 1][(i / px) & 1] / 4;
        ctx.fillStyle = amount > t ? colB : colA;
        ctx.fillRect(x + i, y + j, px, px);
      }
    }
    return;
  }
  const key = colA + '|' + colB + '|' + lvl + '|' + px;
  let pat = _ditherTiles.get(key);
  if (!pat) {
    const t = document.createElement('canvas');
    t.width = px * 2; t.height = px * 2;
    const tx = t.getContext('2d');
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const th = M[j][i] / 4;
        tx.fillStyle = amount > th ? colB : colA;
        tx.fillRect(i * px, j * px, px, px);
      }
    }
    pat = ctx.createPattern(t, 'repeat');
    _ditherTiles.set(key, pat);
  }
  ctx.save();
  ctx.translate(ix, iy);          // the phase is measured from the rect, as before
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * A beveled PS1 window: hard 1px outline, light top-left, dark bottom-right,
 * dithered interior. No gradients, no rounded corners, no blur.
 */
export function panel(ctx, x, y, w, h, o = {}) {
  const b = o.border ?? 2;
  const fill = o.fill ?? '#1a1108';
  const fill2 = o.fill2 ?? '#2a1c0e';
  const lo = o.lo ?? '#5c3f1c';
  const hi = o.hi ?? '#b08a3c';

  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ditherRect(ctx, x + b, y + b, w - b * 2, h - b * 2, fill, fill2, o.dither ?? 0.5, 2);

  // bevel
  ctx.fillStyle = hi;
  ctx.fillRect(x + 1, y + 1, w - 2, b - 1);
  ctx.fillRect(x + 1, y + 1, b - 1, h - 2);
  ctx.fillStyle = lo;
  ctx.fillRect(x + 1, y + h - b, w - 2, b - 1);
  ctx.fillRect(x + w - b, y + 1, b - 1, h - 2);
}
