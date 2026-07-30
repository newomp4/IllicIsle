/* ===========================================================
   screens.js — every full-screen interface, drawn as pixels.

   The journal, pause menu, title, shop, chart and reader all used
   to be DOM. However you style DOM it renders at native resolution
   with antialiased type, so it sat on top of the game looking
   modern and artificial. These are drawn into the same low-res
   canvas as the HUD and composited inside the PS1 pass, so they
   pixelate, dither, band and curve exactly like the world does.
   =========================================================== */

import { drawText, textWidth, wrapText, panel, ditherRect, normalize } from './bitfont.js';
import { drawRelicIcon, drawShopIcon } from './hud.js';
import { COLOURS } from '../net/protocol.js';
import { SABOTAGE_DEFS } from '../mp/tasks.js';
import { MINIGAMES, bindText } from '../mp/minigames.js';
import * as DARTS from '../mp/darts.js';
import {
  STOCK, FOOD, DRINKS, stockFor, shelf, SANCTUARY_R, VENDOR_IDS, SCHLARNA_N,
} from '../mp/market.js';

// the minigames borrow the one font everything else is set in
bindText(drawText);

/** A small deterministic RNG, so a chore looks the same to whoever opens it. */
function mulberryLocal(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hex string for a player colour id, for the lobby and council lists. */
function colourOf(id) {
  const c = COLOURS.find((k) => k.id === id) || COLOURS[0];
  return '#' + c.hex.toString(16).padStart(6, '0');
}

const GOLD = '#ffd24a';
const GOLD_LT = '#fff3c4';
const GOLD_DK = '#a8761c';
const DIM = '#8a7a52';
const RED = '#e0453a';
const JADE = '#63c6a8';
const PAPER = '#e2cfa2';
const INK = '#2b1d0c';

/* ---------- shared chrome ---------- */
function frame(x, W, H, title, sub) {
  // full-screen scrim with scanline weave
  x.fillStyle = 'rgba(6,4,2,.86)';
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(0,0,0,.35)';
  for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

  const m = 10;
  panel(x, m, m, W - m * 2, H - m * 2, { border: 2, dither: 0.45, hi: GOLD_DK, lo: '#241708' });
  if (title) {
    drawText(x, title, { x: W / 2, y: m + 7, scale: 1, align: 'center', color: GOLD });
    x.fillStyle = GOLD_DK;
    x.fillRect(m + 8, m + 18, W - m * 2 - 16, 1);
  }
  if (sub) drawText(x, sub, { x: W / 2, y: m + 22, scale: 1, align: 'center', color: DIM });
  return { m, top: m + (sub ? 32 : 24), bottom: H - m - 12 };
}

/** A sunken input box. Darker inside than out, so it reads as a hole. */
function field(x, ox, oy, w, h, active) {
  x.fillStyle = active ? '#3a2a10' : '#241708';
  x.fillRect(ox - 1, oy - 1, w + 2, h + 2);
  ditherRect(x, ox, oy, w, h, '#120c06', '#1c1208', active ? 0.6 : 0.3);
  x.fillStyle = active ? GOLD : GOLD_DK;
  x.fillRect(ox - 1, oy - 1, w + 2, 1);
  x.fillRect(ox - 1, oy + h, w + 2, 1);
  x.fillRect(ox - 1, oy, 1, h);
  x.fillRect(ox + w, oy, 1, h);
}

/**
 * A counter button that actually goes down when you press it.
 *
 * `hit` is 0..1 and decays. At 1 the whole button drops a pixel, loses its
 * top highlight, gains its bottom shadow and inverts — which is all a
 * pressed key does, and all it needs to do.
 */
/**
 * A stake, as a thing rather than a number.
 *
 * Both tables were a figure in a box with two triangles beside it, which
 * reads as a spinner on a form. This is a chip tray: the stake is broken
 * into denominations and stacked, the top chip of the tallest stack lifts
 * when the figure changes, the arrows are keycaps rather than pixels, and
 * what you will have left is on the rail underneath.
 *
 * Returns the rows it drew, so the tray can be clicked.
 */
const CHIPS = [
  { v: 25, face: '#2a2a36', edge: '#585874', pip: '#c8c8d8' },
  { v: 10, face: '#1e5a3a', edge: '#36936a', pip: '#a8e0c0' },
  { v: 5,  face: '#8a2018', edge: '#c04030', pip: '#ffb0a0' },
  { v: 1,  face: '#c8b48a', edge: '#efe0bc', pip: '#6a5432' },
];

/**
 * One chip, seen slightly from above: a face with a rim under it.
 *
 * `face` prints the denomination on it, which is how a real chip tells you
 * what it is — the value used to be printed on the FELT under each pile,
 * where it collided with whatever was written along the bottom of the tray.
 */
function drawChip(x, cx, cy, c, w = 15, face = null) {
  const h = 7;
  x.fillStyle = '#050704';
  x.fillRect(cx - w / 2, cy, w, h + 1);
  x.fillStyle = c.face;
  x.fillRect(cx - w / 2, cy + 1, w, h - 1);
  x.fillStyle = c.edge;
  x.fillRect(cx - w / 2, cy + 1, w, 1);
  // the notches round the rim, which is what makes it a chip
  x.fillStyle = c.pip;
  x.fillRect(cx - w / 2 + 1, cy + 2, 2, 1);
  x.fillRect(cx + w / 2 - 3, cy + 2, 2, 1);
  if (face) {
    drawText(x, face, {
      x: cx, y: cy + 1, scale: 1, align: 'center', color: c.pip, shadow: false,
    });
  }
  x.fillStyle = 'rgba(0,0,0,.34)';
  x.fillRect(cx - w / 2, cy + h, w, 1);
}

/**
 * A stake, as a thing rather than a number.
 *
 * The first version had two faults you could see from across the room: the
 * up and down keycaps were drawn at a fixed offset from the right edge and
 * a three-digit figure was drawn straight through them, and the middle
 * third of the tray was empty. This one gives every part its own column and
 * the keycaps sit OUTSIDE the figure, not on it.
 *
 *   ┌────────────────────────────────────────┐
 *   │ YOUR STAKE                             │
 *   │  ▤▤▤  25 x8              ▲             │
 *   │  ▤▤▤  10 x2            2 0 0           │
 *   │  ▤▤▤   5 x1              ▼             │
 *   │ ────────────────────────────────────── │
 *   │ AFTER 799                 LIMIT 5-200  │
 *   └────────────────────────────────────────┘
 *
 * Returns the rows it drew, so the caps can be clicked.
 */
function stakeTray(x, cx, cy, w, stake, purse, t, opts = {}) {
  const kick = Math.round((opts.kick || 0) * 3);
  const accent = opts.accent || GOLD;
  const rows = [];
  const W2 = Math.max(176, w);
  const bx = Math.round(cx - W2 / 2);
  const H = 72;
  const MIN = opts.min ?? 1, MAX = opts.max ?? 999;

  /* ---- the well ---- */
  x.fillStyle = 'rgba(4,8,6,.86)'; x.fillRect(bx - 2, cy - 2, W2 + 4, H + 4);
  x.fillStyle = opts.felt || '#123a2c'; x.fillRect(bx, cy, W2, H);
  ditherRect(x, bx, cy, W2, H, opts.felt || '#123a2c', opts.feltHi || '#17503c', 0.5, 2);
  // a gilt rule top and bottom, and a lit inner lip
  x.fillStyle = accent; x.fillRect(bx, cy, W2, 1); x.fillRect(bx, cy + H - 1, W2, 1);
  x.fillStyle = 'rgba(255,240,190,.12)'; x.fillRect(bx, cy + 1, W2, 1);
  x.fillStyle = 'rgba(0,0,0,.40)'; x.fillRect(bx, cy + H - 3, W2, 2);
  x.fillStyle = accent; x.fillRect(bx, cy, 1, H); x.fillRect(bx + W2 - 1, cy, 1, H);

  drawText(x, opts.label || 'YOUR STAKE', {
    x: bx + 6, y: cy + 4, scale: 1, color: opts.dim || '#7fb8a0',
  });

  /* ---- the chips, in piles, the way they sit on a real tray ----
     One row per denomination left three quarters of the well empty when the
     stake happened to be a round number of twenty-fives. Piles standing side
     by side fill the space and, more to the point, a tall pile LOOKS like a
     lot of money, which is the only job this has. */
  let left = stake;
  const stacks = [];
  for (const c of CHIPS) {
    const n = Math.floor(left / c.v);
    if (n > 0) { stacks.push({ c, n }); left -= n * c.v; }
  }
  const BASE = cy + 45;
  const PILE_W = 22;
  const CX0 = bx + 22;
  stacks.slice(0, 4).forEach((st, si) => {
    const px2 = CX0 + si * PILE_W;
    const show = Math.min(st.n, 7);
    for (let i = 0; i < show; i++) {
      // the top chip of the biggest pile lifts when the figure moves
      const lift = (si === 0 && i === show - 1) ? kick : 0;
      // only the top chip of a pile shows its face; the rest are edges
      drawChip(x, px2, BASE - i * 3 - lift, st.c, 18,
        i === show - 1 ? String(st.c.v) : null);
    }
    if (st.n > show) {
      drawText(x, `x${st.n}`, {
        x: px2, y: BASE - 9 - show * 3, scale: 1, align: 'center',
        color: opts.dim || '#6a9a86',
      });
    }
  });
  if (!stacks.length) {
    drawText(x, 'NOTHING DOWN', { x: CX0 - 8, y: BASE, scale: 1, color: RED });
  }

  /* the felt line the piles stand on, so they are on something */
  x.fillStyle = 'rgba(0,0,0,.24)';
  x.fillRect(bx + 10, BASE + 9, Math.max(30, stacks.length * PILE_W) + 6, 1);

  /* ---- the figure, with the caps clear of it on the right ---- */
  const capX = bx + W2 - 17;
  const numRight = capX - 6;
  drawText(x, String(stake), {
    x: numRight, y: cy + 28 - kick, scale: 2, align: 'right',
    color: stake > purse ? RED : (opts.figure || GOLD_LT),
  });
  const canUp = stake < Math.min(MAX, purse);
  const canDn = stake > MIN;
  const cap = (ky, up, live) => {
    x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(capX, ky + 1, 12, 11);
    x.fillStyle = live ? '#3a2a10' : '#161208';
    x.fillRect(capX, ky, 12, 11);
    x.fillStyle = live ? accent : '#463822';
    x.fillRect(capX, ky, 12, 1); x.fillRect(capX, ky + 10, 12, 1);
    x.fillRect(capX, ky, 1, 11); x.fillRect(capX + 11, ky, 1, 11);
    /* An up arrow is a point at the TOP with the base under it. Both of
       these were drawn the other way round, so the cap that raised your
       stake had a downward triangle on it. */
    const col = live ? (up ? '#8fe8a0' : '#ffb08a') : '#3a3226';
    for (let r = 0; r < 4; r++) {
      x.fillStyle = col;
      if (up) x.fillRect(capX + 6 - r, ky + 3 + r, r * 2 + 1, 1);
      else x.fillRect(capX + 6 - r, ky + 7 - r, r * 2 + 1, 1);
    }
    return { x: capX, y: ky, w: 12, h: 11 };
  };
  rows.push({ ...cap(cy + 15, true, canUp), stakeUp: true });
  rows.push({ ...cap(cy + 40, false, canDn), stakeDown: true });

  /* ---- the rail ---- */
  x.fillStyle = 'rgba(255,255,255,.10)';
  x.fillRect(bx + 5, cy + H - 14, W2 - 10, 1);
  const after = purse - stake;
  const leftTxt = `AFTER  ${Math.max(0, after)}`;
  const rightTxt = opts.rail || `LIMIT ${MIN} - ${MAX}`;
  drawText(x, leftTxt, {
    x: bx + 6, y: cy + H - 11, scale: 1,
    color: after < 0 ? RED : (opts.dim || '#6a9a86'),
  });
  /* The right-hand note only goes on if there is room for it. "AFTER 50"
     and "HE TAKES 50 AT MOST" on a hundred and eighty pixel rail printed
     straight through each other. */
  if (textWidth(leftTxt, 1) + textWidth(rightTxt, 1) + 20 < W2) {
    drawText(x, rightTxt, {
      x: bx + W2 - 6, y: cy + H - 11, scale: 1, align: 'right',
      color: opts.dim2 || '#4a7a6a',
    });
  }
  return rows;
}

function pressButton(x, bx, by, bw, label, opts = {}) {
  const hit = Math.max(0, Math.min(1, opts.hit || 0));
  const on = opts.enabled !== false;
  const accent = opts.accent || GOLD;
  const down = hit > 0.35 ? 1 : 0;
  const h = 12;
  // the shadow it sits on, which is what it drops into
  x.fillStyle = 'rgba(0,0,0,.55)';
  x.fillRect(bx, by + 1, bw, h);
  x.fillStyle = down ? accent : (on ? (opts.fill || '#3a2a10') : '#1a1208');
  x.fillRect(bx, by + down, bw, h - down);
  x.fillStyle = on ? accent : '#5a4a30';
  x.fillRect(bx, by + down, bw, 1);
  x.fillRect(bx, by + h - 1, bw, 1);
  x.fillRect(bx, by + down, 1, h - down);
  x.fillRect(bx + bw - 1, by + down, 1, h - down);
  if (!down && on) {
    // a lit top edge while it is up
    x.fillStyle = 'rgba(255,240,190,.22)';
    x.fillRect(bx + 1, by + 1, bw - 2, 1);
  }
  drawText(x, label, {
    x: bx + bw / 2, y: by + 3 + down, scale: 1, align: 'center',
    color: down ? '#160c04' : (on ? (opts.text || GOLD_LT) : '#7a6a4a'),
  });
  return { x: bx, y: by, w: bw, h };
}

function footer(x, W, H, text) {
  drawText(x, text, { x: W / 2, y: H - 17, scale: 1, align: 'center', color: DIM });
}

/**
 * Ferdi, framed, for the single-player shop counter.
 *
 * This went missing when drawShopIcon was moved out to hud.js — the two
 * were adjacent and the extraction took one brace too many, which is why
 * opening the shop in single player threw.
 */
function drawFerdiPortrait(x, ox, oy, t) {
  const u = 2;
  const px = (gx, gy, w, h, col) => { x.fillStyle = col; x.fillRect(ox + gx * u, oy + gy * u, w * u, h * u); };
  const blink = Math.sin(t * 0.9) > 0.93;
  px(0, 0, 18, 18, '#0d0906');
  px(1, 1, 16, 16, '#231708');
  // hat
  px(3, 2, 12, 2, '#54492f');
  px(5, 0, 8, 2, '#54492f');
  // face
  px(5, 4, 8, 5, '#c79a72');
  px(6, 5, 2, 1, blink ? '#c79a72' : '#2a1a10');
  px(10, 5, 2, 1, blink ? '#c79a72' : '#2a1a10');
  px(8, 6, 2, 1, '#c4614a');          // nose
  // beard
  px(4, 8, 10, 6, '#9a9388');
  px(5, 9, 8, 4, '#8a8378');
  px(7, 10, 4, 1, '#3a2f22');         // mouth
  // shoulders
  px(2, 14, 14, 4, '#6b5f48');
}

/**
 * Ferdi, drawn in the corner of his own shop.
 *
 * In the back room he is not there at all — a lantern hangs where he
 * would be and a shadow of him falls on the block work, which is the
 * whole conceit of the place.
 */
function drawFerdi(x, ox, oy, black, t) {
  const p = (gx, gy, w, h, col) => { x.fillStyle = col; x.fillRect(ox + gx, oy + gy, w, h); };
  const sway = Math.round(Math.sin(t * 0.9) * 1.5);
  const blink = Math.sin(t * 0.7) > 0.965;

  if (black) {
    // only his shadow, thrown up the wall and swaying with the bulb
    const sh = 'rgba(0,0,0,.55)';
    p(sway * 2 - 4, 0, 26, 4, sh);
    p(sway * 2 - 1, 4, 20, 30, sh);
    p(sway * 2 + 2, -8, 14, 9, sh);
    return;
  }

  // coat
  p(2 + sway, 12, 20, 34, '#5f5540');
  p(2 + sway, 12, 20, 2, '#7a6e52');
  p(0 + sway, 16, 3, 22, '#4a4132');
  p(21 + sway, 16, 3, 22, '#4a4132');
  // an arm leaning on the counter
  p(20 + sway, 30, 12, 4, '#5f5540');
  p(30 + sway, 30, 5, 5, '#c79a72');
  // head
  p(6 + sway, 0, 12, 12, '#c79a72');
  // the beard, most of him
  p(4 + sway, 8, 16, 10, '#9a9388');
  p(6 + sway, 16, 12, 5, '#8a8378');
  // sunburnt nose
  p(11 + sway, 6, 3, 3, '#c4614a');
  // eyes
  if (!blink) {
    p(8 + sway, 4, 2, 2, '#1a1208');
    p(14 + sway, 4, 2, 2, '#1a1208');
  } else {
    p(8 + sway, 5, 2, 1, '#1a1208');
    p(14 + sway, 5, 2, 1, '#1a1208');
  }
  // the hat
  p(3 + sway, -3, 18, 3, '#54492f');
  p(6 + sway, -8, 12, 5, '#54492f');
  p(6 + sway, -5, 12, 1, '#3a3220');
}

/**
 * Cathy, at her own counter.
 *
 * Shoulder-length brown hair with a heavy level fringe, a cheeseburger where
 * her mouth should be, and a black t-shirt. She is drawn big — she is the
 * only thing on the far side of the island and the screen belongs to her.
 *
 * Layered from the back forward: hair, then head, then the burger over the
 * lower half of the face, because that is the order the thing reads in.
 */
function drawCathy(x, ox, oy, t) {
  const p = (gx, gy, w, h, col) => { x.fillStyle = col; x.fillRect(ox + gx, oy + gy, w, h); };
  const sway = Math.round(Math.sin(t * 0.8) * 1.5);
  const blink = Math.sin(t * 0.73) > 0.955;
  const chew = Math.round(Math.abs(Math.sin(t * 1.9)) * 1.4);   // the burger settling

  const SKIN = '#d8a882', SKIN_D = '#b8845e', HAIR = '#4a2c1a', HAIR_L = '#633c22';
  const TEE = '#1c1c20', TEE_L = '#2c2c32';

  /* ---- her, from the shoulders down ---- */
  // a wide, soft shape: she is heavyset and the silhouette says so first
  p(-4 + sway, 34, 44, 40, TEE);
  p(-7 + sway, 40, 4, 30, TEE);            // the arm nearest us
  p(39 + sway, 40, 4, 30, TEE);
  p(-4 + sway, 34, 44, 2, TEE_L);          // light along the shoulder seam
  p(-2 + sway, 44, 3, 24, TEE_L);          // a fold down the front
  p(-8 + sway, 66, 8, 6, SKIN);            // a forearm on the counter
  p(-8 + sway, 66, 8, 1, SKIN_D);

  /* ---- the hair, behind everything ---- */
  p(1 + sway, 2, 34, 40, HAIR);            // the whole helmet, down to her shoulders
  p(-2 + sway, 12, 5, 28, HAIR);           // and the fall either side of her face
  p(33 + sway, 12, 5, 28, HAIR);
  p(3 + sway, 1, 30, 3, HAIR_L);           // the sheen on the crown
  // it thins to points where it ends, rather than stopping square
  p(-2 + sway, 40, 4, 3, HAIR);
  p(34 + sway, 40, 4, 3, HAIR);

  /* ---- the face ---- */
  p(5 + sway, 8, 26, 26, SKIN);
  p(3 + sway, 14, 3, 14, SKIN);            // full cheeks, wider than the brow
  p(32 + sway, 14, 3, 14, SKIN);
  p(8 + sway, 32, 20, 5, SKIN);            // a soft jaw
  p(11 + sway, 36, 14, 3, SKIN_D);         // and the second chin under it

  /* ---- the fringe: heavy, level, and low ---- */
  p(2 + sway, 4, 32, 9, HAIR);
  p(2 + sway, 12, 32, 2, HAIR_L);          // the blunt cut line across her brow
  for (let i = 0; i < 8; i++) {            // strand ends, all the same length
    p(3 + sway + i * 4, 14, 2, 1, HAIR);
  }

  /* ---- eyes, just under the fringe ---- */
  if (!blink) {
    p(9 + sway, 16, 6, 4, '#f2ece0');
    p(21 + sway, 16, 6, 4, '#f2ece0');
    p(11 + sway, 17, 3, 3, '#5a3a1e');
    p(23 + sway, 17, 3, 3, '#5a3a1e');
    p(12 + sway, 18, 1, 1, '#100a06');
    p(24 + sway, 18, 1, 1, '#100a06');
  } else {
    p(9 + sway, 18, 6, 1, '#7a5236');
    p(21 + sway, 18, 6, 1, '#7a5236');
  }
  p(10 + sway, 21, 5, 1, SKIN_D);          // a crease under each
  p(21 + sway, 21, 5, 1, SKIN_D);

  /* ---- and the burger, built into her face where her mouth is ----
     Top to bottom in the order it is stacked: cheese draped over the edge,
     a lettuce frill poking out sideways, the patty, tomato, more lettuce. */
  const bx = 6 + sway, by = 22 + chew;
  // cheese, hanging over both corners
  p(bx, by, 24, 4, '#f0a828');
  p(bx - 1, by + 3, 4, 4, '#e09818');
  p(bx + 21, by + 3, 4, 4, '#e09818');
  p(bx + 2, by, 20, 1, '#ffc860');
  // the lettuce frill, wider than everything else
  p(bx - 2, by + 5, 28, 3, '#5f9e34');
  for (let i = 0; i < 7; i++) p(bx - 2 + i * 4, by + 4, 3, 2, '#83c452');
  // the patty
  p(bx, by + 8, 24, 5, '#6b4326');
  p(bx, by + 12, 24, 1, '#4a2c18');
  // tomato
  p(bx + 2, by + 13, 20, 2, '#c8342a');
  p(bx + 4, by + 13, 16, 1, '#e0503a');
  // and the bottom leaf
  p(bx + 1, by + 15, 22, 2, '#5f9e34');
}

/**
 * QUEZETRIEL QUEBOLIUS, drawn behind his own bar.
 *
 * A silhouette with two lit eyes, like Michael Beef — deliberately, because
 * they are the same kind of thing. What makes him a different man is the
 * shape: Beef is broad and wears a hat, Quezetriel is a head taller, narrow,
 * stooped from a lifetime under a low beam, in a waistcoat, with a cloth
 * over one shoulder and hands he never stops using.
 */
function drawQuez(x, ox, oy, t, pulling) {
  const p = (gx, gy, w, h, col) => { x.fillStyle = col; x.fillRect(ox + gx, oy + gy, w, h); };
  const sway = Math.round(Math.sin(t * 0.6) * 1.2);
  const blink = Math.sin(t * 0.71) > 0.972;
  const SH = '#0b0709', SH_L = '#181016', VEST = '#2c1a22';

  // long legs and a narrow body, leaning in over the bar
  p(6 + sway, 44, 8, 34, SH);
  p(18 + sway, 44, 8, 34, SH);
  p(4 + sway, 14, 24, 34, SH);
  p(6 + sway, 16, 20, 26, VEST);
  p(6 + sway, 16, 20, 1, SH_L);
  // the watch chain, the one bright thing on him
  p(9 + sway, 30, 8, 1, '#c8a040');
  p(8 + sway, 30, 2, 2, '#e0bc58');
  // shoulders, and the cloth over the left one
  p(1 + sway, 12, 30, 6, SH);
  p(-1 + sway, 14, 6, 20, '#6a6458');
  // arms: the near one reaches for the pump, the far one polishes
  const reach = Math.round(pulling * 6);
  p(28 + sway, 18, 6, 20 + reach, SH);
  p(31 + sway, 36 + reach, 6, 5, '#7a6a62');
  const pol = Math.round(Math.sin(t * 4.2) * 2);
  p(-2 + sway, 20, 6, 18, SH);
  p(-3 + sway + pol, 37, 6, 5, '#7a6a62');
  // a long neck and a narrow head, tipped a little
  p(13 + sway, 8, 6, 6, SH);
  p(9 + sway, -6, 14, 16, SH);
  p(8 + sway, -8, 16, 3, SH_L);
  /* And the eyes, which are the only thing about him you will remember.
     Two pixels of light on a black head is not a face at anything under a
     hand's width — they get a halo and a highlight. */
  if (!blink) {
    x.fillStyle = 'rgba(255,190,90,.16)';
    x.fillRect(ox + 8 + sway, oy - 4, 16, 8);
    p(10 + sway, -2, 6, 4, '#c8903a');
    p(17 + sway, -2, 6, 4, '#c8903a');
    p(11 + sway, -1, 4, 2, '#ffe0a0');
    p(18 + sway, -1, 4, 2, '#ffe0a0');
    p(12 + sway, -1, 1, 1, '#fffbe8');
    p(19 + sway, -1, 1, 1, '#fffbe8');
  } else {
    p(10 + sway, 0, 6, 1, '#8a6a30');
    p(17 + sway, 0, 6, 1, '#8a6a30');
  }
  // a rim of firelight down one side of him, so he is not a hole in the wall
  p(-2 + sway, 12, 1, 24, '#3a2418');
  p(9 + sway, -6, 1, 16, '#33222a');
}

/** A vertical list of choices with a blinking selector. */
/* ===========================================================
   THE SELECTOR

   Every menu in the game draws through menuList, so this is the one place
   worth making feel like something. What it does now that it did not:

   - the highlight SLIDES to the new row rather than teleporting, on its own
     spring, so moving down a list has weight;
   - the chosen row sits a pixel to the right of the others, the way a
     pressed key does;
   - a band of light sweeps across the highlight every couple of seconds;
   - the arrow breathes in and out instead of blinking on and off;
   - and a row that has just been chosen flashes and squashes.

   The state has nowhere to live — draw is a pure function of the screen's
   own object — so it is kept per-list in a small map keyed by the list's
   identity. A menu that vanishes takes its entry with it on the next sweep.
   =========================================================== */
const _menuState = new Map();
let _menuSweep = 0;

/**
 * The same sliding highlight for lists that draw their own rows — the shops,
 * Cathy's counter, the bar. Returns where the highlight has got to, in rows,
 * and how recently something was bought off it.
 */
function listCursor(key, sel, rowCount) {
  let m = _menuState.get(key);
  if (!m) { m = { at: sel, want: sel, vel: 0, hit: 0, seen: _menuSweep }; _menuState.set(key, m); }
  m.want = sel;
  m.seen = _menuSweep;
  if (m.snap || Math.abs(m.at - sel) > rowCount) { m.at = sel; m.vel = 0; m.snap = false; }
  return m;
}

/** Call once a frame. Ages every selector and drops the ones nobody drew. */
function menuTick(dt) {
  _menuSweep++;
  for (const [k, m] of _menuState) {
    if (_menuSweep - m.seen > 240) { _menuState.delete(k); continue; }
    // a critically-damped spring: it arrives, and it does not wobble past
    const d = m.want - m.at;
    m.vel += d * 260 * dt;
    m.vel *= Math.exp(-14 * dt);
    m.at += m.vel * dt;
    if (Math.abs(d) < 0.002 && Math.abs(m.vel) < 0.02) { m.at = m.want; m.vel = 0; }
    if (m.hit > 0) m.hit = Math.max(0, m.hit - dt * 4);
  }
}

/* The screens do not know which selector is theirs, and they do not need
   to: there is only ever one menu on screen at a time, so these speak to
   whichever selectors were drawn on the last frame. */
/** A row was chosen. Flash and squash. */
function menuFlash() { for (const m of _menuState.values()) m.hit = 1; }
/* The selection wrapped round the end, so the highlight should appear there
   rather than sliding the length of the list. It cannot just be set here:
   `want` is only told about the new row on the next draw, so this leaves a
   note for the draw to act on. */
function menuSnap() { for (const m of _menuState.values()) m.snap = true; }

function menuList(x, items, sel, cx, top, t, opts = {}) {
  const gap = opts.gap ?? 14;
  const w = opts.width ?? 130;
  const key = opts.key || `${cx}:${top}:${items.length}`;
  let m = _menuState.get(key);
  if (!m) { m = { at: sel, want: sel, vel: 0, hit: 0, seen: _menuSweep }; _menuState.set(key, m); }
  m.want = sel;
  m.seen = _menuSweep;
  if (m.snap) { m.at = sel; m.vel = 0; m.snap = false; }
  // a list that changes length under the selector should not slide across it
  if (Math.abs(m.at - sel) > items.length) m.at = sel;

  const rows = [];
  // the highlight, drawn once at wherever it has got to
  {
    /* The highlight used to squash and grow when you chose a row. It reads
       as a bouncing button on a phone; this is a set from 1998. It flashes
       and that is all. */
    const hy = Math.round(top + m.at * gap) - 3;
    const hx = Math.round(cx - w / 2);
    x.fillStyle = m.hit > 0.5 ? '#7a5420' : '#3a2a10';
    x.fillRect(hx, hy, w, 11);
    // the rails either side
    x.fillStyle = m.hit > 0.5 ? '#fff3c4' : GOLD;
    x.fillRect(hx, hy, 1, 11);
    x.fillRect(hx + w - 1, hy, 1, 11);
    /* A band of light running across it. Two seconds apart, a third of a
       second long, and it only touches the highlighted row — which is what
       makes it read as the selection being alive rather than the screen. */
    const sw = (t % 2.2) / 0.34;
    if (sw < 1) {
      const bx = Math.round(hx + sw * (w + 16)) - 8;
      for (let i = 0; i < 8; i++) {
        const a = (0.13 * (1 - Math.abs(i - 3.5) / 4)).toFixed(3);
        x.fillStyle = `rgba(255,230,150,${a})`;
        x.fillRect(bx + i, hy + 1, 1, 9);
      }
    }
  }

  items.forEach((it, i) => {
    const y = top + i * gap;
    const on = i === sel;
    const label = typeof it === 'string' ? it : it.label;
    const dis = typeof it === 'object' && it.disabled;
    /* The chosen row steps a pixel to the right, like a key going down, and
       the nearer rows lean toward it a little. */
    const near = Math.max(0, 1 - Math.abs(i - m.at));
    const off = Math.round(near * 2);
    if (on) {
      // the arrow breathes rather than blinking, and it points
      const br = 0.55 + Math.sin(t * 4.4) * 0.45;
      const ax = Math.round(cx - w / 2 + 4 + br * 2);
      x.fillStyle = m.hit > 0 ? '#fff3c4' : GOLD;
      x.fillRect(ax, y + 1, 1, 3);
      x.fillRect(ax + 1, y + 2, 1, 1);
      x.fillRect(ax - 1, y, 1, 5);
    }
    drawText(x, label, {
      x: cx + off, y, scale: 1, align: 'center',
      color: dis ? '#6a5c40' : (on ? (m.hit > 0.5 ? '#fffbe8' : GOLD_LT) : DIM),
    });
    rows.push({ y: y - 3, h: 11, x: cx - w / 2, w });
  });
  return rows;
}

/* ===========================================================
   SCREEN STACK
   =========================================================== */
/** clamp, without dragging three into this file for one line. */
const THREE_CLAMP = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));

const EMPTY_MODS = Object.freeze({ shift: false, ctrl: false, alt: false });

export class ScreenStack {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.t = 0;
    this._rows = [];
  }

  get open() { return this.stack.length > 0; }
  get top() { return this.stack[this.stack.length - 1] || null; }
  get name() { return this.top ? this.top.name : null; }

  push(name, data = {}) {
    /* `name` identifies the screen. A caller that puts its own `name` in
       the data renames the screen out of existence and the stack stops
       being able to find it — it has happened twice, so it is guarded now. */
    if (data && data.name !== undefined) {
      console.warn(`[screens] "${name}" was passed a name in its data; ignoring it`);
      data = { ...data };
      delete data.name;
    }
    const s = { name, sel: 0, scroll: 0, t: 0, ...data, name };
    if (SCREENS[name]?.init) SCREENS[name].init(s, this.game);
    this.stack.push(s);
    this.game.audio?.sfx('page');
    return s;
  }
  pop() { const s = this.stack.pop(); this.game.audio?.sfx('select'); return s; }
  clear() { this.stack.length = 0; }
  replace(name, data) { this.stack.length = 0; return this.push(name, data); }
  has(name) { return this.stack.some((s) => s.name === name); }

  /**
   * `mods` carries shift/ctrl/alt for the few screens that want a chord —
   * the title's shift+enter into the old single-player story, for one.
   * Everything else ignores it, and a caller that passes nothing gets an
   * empty object rather than undefined.
   */
  key(code, mods = EMPTY_MODS) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    if (!def) return false;
    return def.key ? def.key(code, s, this.game, this, mods) !== false : false;
  }

  /** Screen-space click, already converted to canvas pixels. */
  click(cx, cy) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    for (let i = 0; i < this._rows.length; i++) {
      const r = this._rows[i];
      if (!r) continue;
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        /* Some screens have rows that are not menu entries — a chat box, a
           confirm button — so they get told which row was hit rather than
           having the index forced into `sel`. */
        if (def?.click) { def.click(r, i, s, this.game, this); return true; }
        s.sel = i;
        this.key('Enter');
        return true;
      }
    }
    return false;
  }

  /**
   * Pointer press / drag / release, in canvas pixels.
   *
   * Screens are mostly lists, so a click is enough for them — but the slot
   * machine has an arm, and an arm you cannot pull is a picture of an arm.
   */
  pointer(kind, cx, cy) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    if (!def?.pointer) return false;
    return !!def.pointer(kind, cx, cy, s, this.game, this);
  }

  /** Clipboard text, handed to the top screen if it takes any. */
  paste(text) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    return def?.paste ? !!def.paste(text, s, this.game, this) : false;
  }

  update(dt) {
    this.t += dt;
    menuTick(dt);
    const s = this.top;
    if (!s) return;
    s.t += dt;
    /* A screen that runs a state machine (a slot spinning down, a reveal
       counting itself out) needs a clock that is not the draw call — draw
       must stay a pure function of state or it misbehaves the moment a
       frame is dropped. */
    SCREENS[s.name]?.tick?.(s, this.game, dt, s.t);
  }

  draw(x, W, H) {
    this._rows = [];
    const s = this.top;
    if (!s) return;
    const def = SCREENS[s.name];
    if (!def?.draw) return;

    /* ---- a screen arriving ----
       This used to squash in from a twelfth of its height with an
       overshoot on the way, which is a cartoon and read as one. A CRT
       switching a page in does not bounce; it comes up over a couple of
       frames with the beam still settling. So: no scaling at all, a very
       short fade, and one bright line running down the picture as it
       arrives. Ten frames, and you feel it rather than watch it. */
    const OPEN = 0.11;
    this._rows = def.draw(x, W, H, s, this.game, this.t) || [];
    if (s.t < OPEN) {
      const k = s.t / OPEN;
      // the page fading up out of black
      x.fillStyle = `rgba(4,3,2,${(Math.pow(1 - k, 1.6) * 0.85).toFixed(3)})`;
      x.fillRect(0, 0, W, H);
      // and the beam settling: one bright line sweeping down it, once
      const by = Math.round(k * (H + 12)) - 6;
      const a = (1 - k) * 0.30;
      x.fillStyle = `rgba(255,244,214,${a.toFixed(3)})`;
      x.fillRect(0, by, W, 2);
      x.fillStyle = `rgba(255,244,214,${(a * 0.4).toFixed(3)})`;
      x.fillRect(0, by - 3, W, 1);
      x.fillRect(0, by + 3, W, 1);
    }
  }
}

/* ===========================================================
   SCREENS
   =========================================================== */
/** What Michael Beef says while he waits for you. */
/* The table limits. Five is the chip, a hundred is as much as Beef will take
   without going to ask somebody. */
const BJ_MIN = 5, BJ_MAX = 200;

/* What Cathy says while you read her board. She talks about the food and
   nothing else, which is either because that is all she thinks about or
   because it is all she is willing to discuss. */
const CATHY_LINES = [
  "NOBODY COMES OUT THIS FAR. TAKE YOUR TIME.",
  "THE POPCORN IS MINE. THE RECIPE IS ALSO MINE.",
  "FERDI SELLS TOOLS. I SELL FOOD. WE HAVE AN UNDERSTANDING.",
  "EVERYTHING IS HOT. DO NOT ASK HOW.",
  "THE EGGS FIND MONEY. I DO NOT KNOW WHY EITHER.",
  "IF YOU ARE LOST, EAT SOMETHING FIRST.",
];
/* What you can put on a leg of darts. He will not take more than fifty. */
const DARTS_MIN = 2, DARTS_MAX = 50;
const QUEZ_DARTS_WIN = [
  "THAT IS THE LEG. THANK YOU.",
  "I HAVE HAD A LOT OF PRACTICE AND NOTHING ELSE TO DO.",
  "THE BOARD DOES NOT CARE WHO YOU ARE.",
];

/** A tiny coin, for the Schlarna card's own diagram. */
function drawCoinPipLocal(x, ox, oy, ink, face) {
  x.fillStyle = ink; x.fillRect(ox, oy, 8, 8);
  x.fillStyle = face; x.fillRect(ox + 1, oy + 1, 6, 6);
  x.fillStyle = ink; x.fillRect(ox + 3, oy + 2, 2, 4);
}

/** Pop a screen that has found itself with nothing to show. */
function st_popSafe(s, g) { g?.screens?.pop?.(); }

/** Settle a finished leg. The stake was taken when it started. */
function DARTS_PAY(s, g) {
  if (s.paid) return;
  s.paid = true;
  if (s.leg?.over === 'you') g.dartsSettle?.(s.stake * 2);
  else g.dartsSettle?.(0);
}

/* What Quezetriel says. He does not chat; he states things. */
const QUEZ_LINES = [
  "YOU CAME THROUGH THE DOOR. MOST DO NOT SEE IT.",
  "I HAVE BEEN HERE LONGER THAN THE BOAT HAS.",
  "BEEF DEALS. I POUR. WE DO NOT DISCUSS IT.",
  "THE BOARD IS THERE IF YOU FANCY LOSING SOMETHING.",
  "NO TABS. NOT FOR ANYBODY. NOT EVEN FOR HIM.",
  "IF THE ROOM MOVES, THAT IS THE DRINK AND NOT THE SEA.",
  "I DO NOT ASK WHAT YOU ARE. DO NOT ASK WHAT I AM.",
];
const QUEZ_SOLD = [
  "THAT ONE TAKES A MOMENT. SIT IF YOU LIKE.",
  "MIND HOW YOU GO.",
  "IT IS SUPPOSED TO TASTE LIKE THAT.",
  "YOU WILL FEEL IT SHORTLY.",
];

const CATHY_SOLD = [
  "GOOD CHOICE. EAT IT WALKING.",
  "THAT IS THE ONE I WOULD HAVE PICKED.",
  "NO REFUNDS AND NO NAPKINS.",
  "TELL THE OTHERS WHERE I AM.",
];

const BEEF_PROMPTS = [
  'YOUR CALL.',
  'TAKE YOUR TIME. THE BOAT IS NOT GOING ANYWHERE.',
  'I HAVE SEEN WORSE HANDS PLAYED WORSE.',
  'TIM SENDS HIS REGARDS. TIM SENDS NOTHING ELSE.',
  'THE ODDS ARE THE ODDS. I ONLY DEAL THEM.',
];
const BEEF_WINS = [
  'THE HOUSE TAKES IT.',
  'THAT IS THE GAME. IT HAS ALWAYS BEEN THE GAME.',
  'KEEP YOUR CHIN UP. KEEP YOUR STAKE SMALLER.',
  'I DID NOT WRITE THE RULES. I JUST NEVER LOSE BY THEM.',
];

/**
 * The host's dials. Each knows how to read itself, how to print itself and
 * how to step, so the screen that draws them holds no rules at all.
 */
const SETTING_ROWS = [
  {
    name: 'ROGUE AGENTS',
    blurb: 'How many of you are working for the other side. Automatic scales with '
      + 'the size of the lobby: one up to five players, two up to eight, three above that.',
    get: (S, auto) => (S.agents > 0 ? String(S.agents) : `AUTOMATIC (${auto})`),
    step: (S, d) => { S.agents = Math.max(0, Math.min(4, (S.agents | 0) + d)); },
  },
  {
    name: 'THE STRANGER',
    blurb: 'Once a round, somebody who is not on the roster comes out of the trees. '
      + 'Reach him and he tells you one true thing about a Rogue Agent, in riddles. '
      + 'Turn him off for a straight game of deduction.',
    get: (S) => (S.stranger ? 'COMES ASHORE' : 'STAYS AWAY'),
    step: (S) => { S.stranger = !S.stranger; },
  },
  {
    name: 'KILL COOLDOWN',
    blurb: 'Seconds an Agent must wait between strikes. Shorter is frantic; longer '
      + 'gives the Castaways time to notice a pattern.',
    get: (S) => `${S.killCooldown}S`,
    step: (S, d) => { S.killCooldown = Math.max(12, Math.min(90, S.killCooldown + d * 4)); },
  },
  {
    name: 'GRACE PERIOD',
    blurb: 'Seconds at the start of the round in which nobody can be killed. It gives '
      + 'everybody a chance to build a picture of where people are.',
    get: (S) => `${S.graceSeconds}S`,
    step: (S, d) => { S.graceSeconds = Math.max(0, Math.min(240, S.graceSeconds + d * 15)); },
  },
  {
    name: 'COUNCIL LENGTH',
    blurb: 'Seconds a council runs for. Talking and voting happen together, so this '
      + 'is the whole meeting.',
    get: (S) => `${S.councilSeconds}S`,
    step: (S, d) => { S.councilSeconds = Math.max(20, Math.min(180, S.councilSeconds + d * 10)); },
  },
  {
    name: 'JOBS EACH',
    blurb: 'How many chores every Castaway is dealt. More jobs is a longer round and '
      + 'more chances to be caught somewhere you should not be.',
    get: (S) => String(S.tasksPerPlayer),
    step: (S, d) => { S.tasksPerPlayer = Math.max(2, Math.min(9, S.tasksPerPlayer + d)); },
  },
  {
    name: 'EMERGENCY MEETINGS',
    blurb: 'How many times each player may ring the bell at the camp without a body '
      + 'to report.',
    get: (S) => String(S.emergencyPerPlayer),
    step: (S, d) => { S.emergencyPerPlayer = Math.max(0, Math.min(3, S.emergencyPerPlayer + d)); },
  },
  {
    name: 'REVEAL ON EXILE',
    blurb: 'Whether the island tells you what somebody was after you vote them off. '
      + 'Hiding it makes every vote a leap.',
    get: (S) => (S.revealOnExile ? 'YES' : 'NEVER'),
    step: (S) => { S.revealOnExile = !S.revealOnExile; },
  },
  {
    name: 'AGENTS STRIKE ONLY AT NIGHT',
    blurb: 'Agents cannot kill in daylight at all. It makes the day safe and the '
      + 'night unbearable.',
    get: (S) => (S.nightOnly ? 'YES' : 'ANY TIME'),
    step: (S) => { S.nightOnly = !S.nightOnly; },
  },
];

/** How long the command table takes to wake up. */
const BOOT_LEN = 1.9;

/* Every menu shares one navigator, so this is the one place that has to
   tell the selector something happened: choosing a row makes it flash and
   squash. Wrapping past either end nudges it the short way rather than
   sliding the whole list, which looked like the menu falling over. */
const nav = (code, s, len, onOk, onBack) => {
  if (code === 'ArrowUp' || code === 'KeyW') {
    const was = s.sel;
    s.sel = (s.sel + len - 1) % len;
    if (was === 0) menuSnap();
    return true;
  }
  if (code === 'ArrowDown' || code === 'KeyS') {
    const was = s.sel;
    s.sel = (s.sel + 1) % len;
    if (was === len - 1) menuSnap();
    return true;
  }
  if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
    menuFlash();
    onOk?.(s.sel);
    return true;
  }
  if (code === 'Escape' || code === 'Backspace') { onBack?.(); return true; }
  return false;
};

export const SCREENS = {

  /* ---------------- MODE SELECT ---------------- */
  mode: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'ILLIC ISLE');
      drawText(x, 'CHOOSE A WAY TO PLAY', { x: W / 2, y: b.top, scale: 1, align: 'center', color: DIM });
      const rows = menuList(x, ['CASTAWAYS  (3-10 PLAYERS)', 'THE OLD STORY  (ALONE)'],
        s.sel, W / 2, b.top + 18, t, { width: 180, gap: 16 });
      const blurb = s.sel === 1
        ? 'Wash ashore alone. Wake four Pendulums,\nopen the temple, take the Idol.\nThe game this was before it was this one.'
        : 'Wash ashore together. Some of you are\nRogue Agents, and nobody knows who.\nDo the work. Watch the paths people take.';
      x.fillStyle = GOLD_DK;
      x.fillRect(W / 2 - 60, b.top + 48, 120, 1);
      let y = b.top + 56;
      for (const ln of blurb.split('\n')) {
        drawText(x, ln, { x: W / 2, y, scale: 1, align: 'center', color: GOLD_LT }); y += 10;
      }
      footer(x, W, H, 'ESC BACK');
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 2, (i) => {
        if (i === 1) { st.clear(); g.beginGame(); }
        else st.replace('mpMenu');
      }, () => st.replace('title'));
    },
  },

  /* ---------------- HOST OR JOIN ---------------- */
  mpMenu: {
    init(s, g) {
      s.who = (localStorage.getItem('illicisle.name') || '').toUpperCase();
      /* A room code in the address bar fills the box in and puts the caret
         on your name, which is the only thing left to type. That is what
         the LINK button in the lobby copies. */
      const hash = (location.hash || '').replace('#', '').toUpperCase()
        .replace(/[^A-Z0-9]/g, '').slice(0, 4);
      s.code = hash;
      s.field = hash ? 0 : 0;
      s.invited = !!hash;
      s.busy = false;
      s.err = '';
      s.status = '';
    },
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, s.invited ? 'YOU WERE INVITED' : 'CASTAWAYS');
      const caret = (on) => (on && Math.floor(t * 3) % 2 ? '_' : '');

      // name
      const rows = [];
      let y = b.top + 4;
      const nw = 120, nx = Math.round((W - nw) / 2);
      drawText(x, 'YOUR NAME', { x: W / 2, y, scale: 1, align: 'center', color: s.field === 0 ? GOLD : DIM });
      field(x, nx, y + 10, nw, 15, s.field === 0);
      drawText(x, s.who + caret(s.field === 0), {
        x: W / 2, y: y + 14, scale: 1, align: 'center', color: GOLD_LT,
      });
      rows.push({ x: nx - 4, y: y + 7, w: nw + 8, h: 21, focus: 0 });

      // room
      y += 36;
      drawText(x, 'ROOM CODE', { x: W / 2, y, scale: 1, align: 'center', color: s.field === 1 ? GOLD : DIM });
      const rw = 78, rx = Math.round((W - rw) / 2);
      field(x, rx, y + 10, rw, 20, s.field === 1);
      drawText(x, s.code + caret(s.field === 1), {
        x: W / 2, y: y + 16, scale: 2, align: 'center', color: GOLD_LT,
      });
      rows.push({ x: rx - 4, y: y + 7, w: rw + 8, h: 26, focus: 1 });
      drawText(x, 'CLICK A BOX TO TYPE IN IT   CTRL V PASTES', {
        x: W / 2, y: y + 36, scale: 1, align: 'center', color: DIM,
      });
      drawText(x, 'LEAVE THE CODE BLANK TO OPEN A ROOM OF YOUR OWN', {
        x: W / 2, y: y + 45, scale: 1, align: 'center', color: '#6a5c40',
      });

      y += 60;
      for (const r of menuList(x, [s.code ? 'JOIN THAT ROOM' : 'OPEN A NEW ROOM'],
        0, W / 2, y, t, { width: 150 })) rows.push({ ...r, go: true });
      if (!s.busy && !s.err) {
        x.fillStyle = GOLD_DK; x.fillRect(W / 2 - 70, y + 22, 140, 1);
        const rules = [
          'THREE TO TEN CASTAWAYS. SOME ARE ROGUE AGENTS.',
          'CASTAWAYS FINISH THE WORK. AGENTS CUT THEM DOWN.',
          'FIND A BODY, CALL A COUNCIL, THROW SOMEBODY TO THE SEA.',
        ];
        let ry = y + 28;
        for (const r of rules) {
          drawText(x, r, { x: W / 2, y: ry, scale: 1, align: 'center', color: DIM });
          ry += 10;
        }
      }
      if (s.busy) drawText(x, s.status || 'CONNECTING', { x: W / 2, y: y + 20, scale: 1, align: 'center', color: JADE });
      if (s.err) {
        let ey = y + 20;
        for (const ln of wrapText(s.err, W - 50, 1, 1)) {
          drawText(x, ln, { x: W / 2, y: ey, scale: 1, align: 'center', color: RED }); ey += 9;
        }
      }
      footer(x, W, H, 'TAB SWITCH FIELD   ENTER GO   ESC BACK');
      return rows;
    },

    /** Clicking a box puts the caret in it. */
    click(row, i, s, g, st) {
      if (row?.focus !== undefined) { s.field = row.focus; g.audio?.sfx('select'); return true; }
      if (row?.go) this.key('Enter', s, g, st);
      return true;
    },

    /** Ctrl/Cmd+V. Room codes get read out loud and pasted, not retyped. */
    paste(text, s) {
      const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
      if (!clean) return true;
      if (s.field === 1) s.code = (s.code + clean).replace(/\s/g, '').slice(0, 6);
      else s.who = (s.who + clean).replace(/^\s+/, '').slice(0, 12);
      return true;
    },

    key(code, s, g, st) {
      if (s.busy) return true;
      if (code === 'Tab') { s.field = 1 - s.field; return true; }
      if (code === 'Escape') { st.replace('mode'); return true; }
      if (code === 'Backspace') {
        if (s.field === 0) s.who = s.who.slice(0, -1); else s.code = s.code.slice(0, -1);
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter') {
        s.busy = true; s.err = '';
        const name = s.who.trim() || 'CASTAWAY';
        localStorage.setItem('illicisle.name', name);
        const go = s.code
          ? g.joinGame(name, s.code.trim().toUpperCase())
          : g.hostGame(name, null);
        go.then(() => st.replace('mpLobby'))
          .catch((e) => { s.busy = false; s.err = e.message || String(e); });
        return true;
      }
      // typed characters
      const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
      if (m) {
        const ch = m[1];
        if (s.field === 0) { if (s.who.length < 12) s.who += ch; }
        else if (s.code.length < 6) s.code += ch;
        return true;
      }
      if (code === 'Space' && s.field === 0 && s.who.length < 12) { s.who += ' '; return true; }
      return true;
    },
  },

  /* ---------------- LOBBY ---------------- */
  mpLobby: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'THE BEACH');
      const players = [...g.mp.view.players.values()];

      /* The code, big, with two ways of getting it to somebody: COPY puts
         the code on the clipboard, LINK puts a whole URL on it that opens
         the game and fills the code in. Reading four characters down a
         voice call was the only way to do this and it is the one part of
         starting a game that people got wrong. */
      const code = g.mp.room || '----';
      const cw = textWidth(code, 3) + 22;
      const cx = Math.round((W - cw) / 2);
      field(x, cx, b.top - 1, cw, 29, true);
      drawText(x, code, { x: W / 2, y: b.top + 3, scale: 3, align: 'center', color: GOLD });

      const rows = [];
      {
        const BW = 54, GAP = 6;
        const by = b.top + 32;
        const bx0 = Math.round(W / 2 - (BW * 2 + GAP) / 2);
        const fresh = s.copied && s.t - s.copied < 1.6;
        rows.push({
          ...pressButton(x, bx0, by, BW, fresh && s.copiedWhat === 'code' ? 'COPIED' : 'C  COPY', {
            hit: fresh && s.copiedWhat === 'code' ? 1 - (s.t - s.copied) / 1.6 : 0,
          }),
          copyCode: true,
        });
        rows.push({
          ...pressButton(x, bx0 + BW + GAP, by, BW,
            fresh && s.copiedWhat === 'link' ? 'COPIED' : 'L  LINK', {
              hit: fresh && s.copiedWhat === 'link' ? 1 - (s.t - s.copied) / 1.6 : 0,
            }),
          copyLink: true,
        });
        const failed = fresh && s.copiedWhat === 'failed';
        drawText(x, failed ? 'THE CLIPBOARD SAID NO - READ IT OUT'
          : (fresh
            ? (s.copiedWhat === 'link' ? 'A LINK IS ON YOUR CLIPBOARD' : 'THE CODE IS ON YOUR CLIPBOARD')
            : 'SEND THIS TO YOUR FRIENDS'),
        { x: W / 2, y: by + 15, scale: 1, align: 'center',
          color: failed ? RED : (fresh ? JADE : DIM) });
      }

      let y = b.top + 62;
      drawText(x, `${players.length} ASHORE`, { x: 30, y, scale: 1, color: DIM });
      y += 12;
      for (const p of players) {
        const hex = colourOf(p.colour);
        x.fillStyle = hex; x.fillRect(30, y, 7, 7);
        x.fillStyle = '#000'; x.fillRect(30, y + 7, 7, 1);
        drawText(x, p.name || '?', { x: 42, y, scale: 1, color: p.id === g.mp.view.selfId ? GOLD : GOLD_LT });
        if (p.id === 'host') drawText(x, 'HOST', { x: W - 30, y, scale: 1, align: 'right', color: JADE });
        y += 11;
      }
      // people want to know what they are walking into
      const n = players.length;
      const agents = n >= 9 ? 3 : n >= 6 ? 2 : 1;
      if (n >= 3) {
        drawText(x, `${agents} ROGUE AGENT${agents === 1 ? '' : 'S'} AMONG YOU`,
          { x: W - 30, y: b.top + 62, scale: 1, align: 'right', color: RED });
      }

      if (g.mp.dev) {
        drawText(x, 'DEV MODE', { x: W - 14, y: b.top + 4, scale: 1, align: 'right', color: JADE });
      }
      if (g.isHost) {
        const can = players.length >= (g.mp.dev ? 1 : 3);
        rows.push(...menuList(x, [can ? 'PUT TO SEA' : 'NEED 3 PLAYERS', 'ROUND SETTINGS'],
          s.sel, W / 2, b.bottom - 40, t, { width: 150, gap: 15 }));
        if (!can) drawText(x, 'THREE ASHORE AT LEAST, TEN AT MOST',
          { x: W / 2, y: b.bottom - 52, scale: 1, align: 'center', color: DIM });
      } else {
        // something that moves, so a wait does not look like a hang
        const dots = '.'.repeat(1 + (Math.floor(t * 1.6) % 3));
        drawText(x, `WAITING FOR THE HOST${dots}`,
          { x: W / 2, y: b.bottom - 22, scale: 1, align: 'center', color: JADE });
      }
      footer(x, W, H, g.isHost
        ? 'C COPY   L LINK   ENTER PICK   ESC LEAVE'
        : 'C COPY   L LINK   ESC LEAVE');
      return rows;
    },
    /**
     * Put something on the clipboard and say so.
     *
     * navigator.clipboard only exists in a secure context, and playing on a
     * LAN means somebody is on http://192.168.something — where it is not
     * there at all. So: try the modern one, and fall back to the old
     * hidden-textarea trick, which works anywhere. If BOTH fail, say so
     * rather than flashing COPIED at somebody whose clipboard is empty.
     */
    _copy(s, g, what) {
      const code = g.mp.room || '';
      if (!code) { g.audio?.sfx('deny'); return; }
      const text = what === 'link'
        ? `${location.origin}${location.pathname}#${code}`
        : code;

      const ok = () => { s.copied = s.t; s.copiedWhat = what; g.audio?.sfx('confirm'); };
      const oldWay = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          const done = document.execCommand('copy');
          document.body.removeChild(ta);
          if (done) { ok(); return true; }
        } catch (e) { /* fall through to saying it did not work */ }
        return false;
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(ok).catch(() => {
          if (!oldWay()) {
            s.copied = s.t;
            s.copiedWhat = 'failed';
            s.failedText = text;
            g.audio?.sfx('deny');
          }
        });
        // assume it worked until told otherwise, so the press feels instant
        ok();
        return;
      }
      if (!oldWay()) {
        s.copied = s.t;
        s.copiedWhat = 'failed';
        s.failedText = text;
        g.audio?.sfx('deny');
      }
    },
    key(code, s, g, st) {
      if (code === 'Escape') { location.reload(); return true; }
      if (code === 'KeyC') { this._copy(s, g, 'code'); return true; }
      if (code === 'KeyL') { this._copy(s, g, 'link'); return true; }
      if (!g.isHost) return true;
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + 1) % 2; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % 2; g.audio?.sfx('select'); return true; }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        if (s.sel === 1) { st.push('mpSettings'); return true; }
        g.startMatch();
      }
      return true;
    },
    click(row, i, s, g, st) {
      if (row?.copyCode) { this._copy(s, g, 'code'); return true; }
      if (row?.copyLink) { this._copy(s, g, 'link'); return true; }
      /* The menu rows are no longer the first thing in the list — the two
         copy buttons are — so they cannot be found by index any more. */
      if (!g.isHost) return true;
      const menuAt = i - 2;
      if (menuAt === 1) { st.push('mpSettings'); return true; }
      if (menuAt === 0) g.startMatch();
      return true;
    },
  },

  /* ===========================================================
     ROUND SETTINGS

     The host's dials, before anybody puts to sea. Every one of these
     changes how the round actually plays, so they are all in one place
     with what they do written next to them.
     =========================================================== */
  mpSettings: {
    init(s) { s.sel = s.sel || 0; },
    draw(x, W, H, s, g, t) {
      const S2 = g.mp.host?.settings;
      if (!S2) return [];
      const n = [...g.mp.view.players.values()].length;
      const auto = n >= 9 ? 3 : n >= 6 ? 2 : 1;

      const b = frame(x, W, H, 'ROUND SETTINGS');
      const ROWS = SETTING_ROWS;
      const rows = [];
      let y = b.top + 4;
      ROWS.forEach((r, i) => {
        const on = i === s.sel;
        const val = r.get(S2, auto);
        if (on) {
          x.fillStyle = '#3a2a10';
          x.fillRect(22, y - 2, W - 44, 13);
          x.fillStyle = GOLD; x.fillRect(22, y - 2, 2, 13);
        }
        drawText(x, r.name, { x: 30, y, scale: 1, color: on ? GOLD_LT : '#c9b98a' });
        drawText(x, val, {
          x: W - 30, y, scale: 1, align: 'right',
          color: on ? GOLD : '#8a7a52',
        });
        rows.push({ x: 22, y: y - 2, w: W - 44, h: 12, pick: i });
        y += 12;
      });

      /* What the highlighted one does. The row pitch is tight on purpose so
         there is room for three lines of explanation down here — at fourteen
         pixels a row the description was clipped to one. */
      const cur = ROWS[s.sel];
      x.fillStyle = '#5c3f1c'; x.fillRect(30, y + 2, W - 60, 1);
      let by = y + 8;
      for (const ln of wrapText(cur.blurb.toUpperCase(), W - 60, 1, 1)) {
        if (by > b.bottom - 8) break;
        drawText(x, ln, { x: 30, y: by, scale: 1, color: DIM });
        by += 9;
      }

      footer(x, W, H, 'UP DOWN PICK   LEFT RIGHT CHANGE   ESC BACK TO THE BEACH');
      return rows;
    },
    key(code, s, g, st) {
      const S2 = g.mp.host?.settings;
      if (!S2) return true;
      const ROWS = SETTING_ROWS;
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + ROWS.length - 1) % ROWS.length; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % ROWS.length; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowLeft' || code === 'KeyA') { ROWS[s.sel].step(S2, -1); g.audio?.sfx('confirm'); return true; }
      if (code === 'ArrowRight' || code === 'KeyD'
        || code === 'Enter' || code === 'KeyE' || code === 'Space') {
        ROWS[s.sel].step(S2, 1); g.audio?.sfx('confirm'); return true;
      }
      if (code === 'Escape' || code === 'Backspace') { st.pop(); return true; }
      return true;
    },
    click(row, i, s, g) {
      const S2 = g.mp.host?.settings;
      if (!S2 || row?.pick === undefined) return true;
      if (row.pick !== s.sel) { s.sel = row.pick; g.audio?.sfx('select'); return true; }
      SETTING_ROWS[s.sel].step(S2, 1);
      g.audio?.sfx('confirm');
      return true;
    },
  },

  /* ---------------- ROLE CARD ---------------- */
  mpRole: {
    draw(x, W, H, s, g, t) {
      const agent = g.amAgent;
      const HOT = agent ? '#ff6a5a' : '#8fe8c8';
      const DK = agent ? '#8a2018' : '#2f6a5c';

      /* Four beats, so it lands like a reveal instead of a box sliding up:
         the dark closes in, a slot opens, the card turns over, and then it
         settles and the words arrive. */
      const T1 = 0.55, T2 = 1.25, T3 = 2.0;
      const e = (a2, b2) => Math.max(0, Math.min(1, (s.t - a2) / (b2 - a2)));
      const easeOut = (k) => 1 - Math.pow(1 - k, 3);

      // 1. the world drains away
      const drain = easeOut(e(0, T1));
      x.fillStyle = agent ? '#180404' : '#04090e';
      x.globalAlpha = drain;
      x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
      if (drain > 0.02) ditherRect(x, 0, 0, W, H, agent ? '#180404' : '#04090e',
        agent ? '#240707' : '#071018', 0.5 * drain, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = `rgba(0,0,0,${(0.42 * drain).toFixed(2)})`; x.fillRect(0, y, W, 1); }

      const CW = 226, CH = 104;
      const cx = Math.round((W - CW) / 2), cy = Math.round((H - CH) / 2) - 4;

      // 2. a slot of light opens across the middle
      const slot = easeOut(e(T1 * 0.7, T2));
      if (slot > 0 && s.t < T2) {
        const sh = Math.max(1, Math.round(CH * slot));
        const sy = Math.round(cy + (CH - sh) / 2);
        x.fillStyle = DK;
        x.fillRect(cx - 2, sy - 1, CW + 4, sh + 2);
        x.fillStyle = agent ? '#2c0a08' : '#07131a';
        x.fillRect(cx, sy, CW, sh);
        ditherRect(x, cx, sy, CW, sh, agent ? '#2c0a08' : '#07131a',
          agent ? '#3a0f0c' : '#0b1c26', 0.4, 2);
        // a hot line racing along the opening edges
        if (slot < 1) {
          x.fillStyle = HOT;
          x.fillRect(cx, sy, CW, 1);
          x.fillRect(cx, sy + sh - 1, CW, 1);
        }
      }
      if (s.t < T2) return [];

      // 3. the card turns over: squash horizontally through the halfway point
      const flip = e(T2, T3);
      const face = flip < 0.5 ? Math.cos(flip * Math.PI) : Math.cos((1 - flip) * Math.PI) * -1;
      const squash = Math.max(0.04, Math.abs(Math.cos(flip * Math.PI)));
      const fw = Math.round(CW * (flip < 1 ? squash : 1));
      const fx = Math.round(W / 2 - fw / 2);

      x.fillStyle = agent ? '#2c0a08' : '#07131a';
      x.fillRect(fx, cy, fw, CH);
      ditherRect(x, fx, cy, fw, CH, agent ? '#2c0a08' : '#07131a',
        agent ? '#3a0f0c' : '#0b1c26', 0.4, 2);
      x.fillStyle = DK;
      x.fillRect(fx, cy, fw, 1); x.fillRect(fx, cy + CH - 1, fw, 1);
      x.fillRect(fx, cy, 1, CH); x.fillRect(fx + fw - 1, cy, 1, CH);

      if (flip < 1 && face < 0) {
        // the back of the card, mid-turn: a blank plate with a seal on it
        if (fw > 22) {
          x.fillStyle = DK;
          const bx = Math.round(W / 2 - Math.min(14, fw / 3) / 2);
          x.fillRect(bx, cy + CH / 2 - 7, Math.min(14, fw / 3), 14);
        }
        return [];
      }
      if (flip < 1) return [];

      // 4. settled: the words arrive line by line
      const line = (i) => e(T3 + 0.12 * i, T3 + 0.12 * i + 0.18);
      const fade = (k, c1, c2) => (k > 0.66 ? c1 : k > 0.25 ? c2 : DK);

      if (line(0) > 0) {
        drawText(x, 'YOU ARE', { x: W / 2, y: cy + 13, scale: 1, align: 'center',
          color: fade(line(0), DIM, '#5a4a34') });
      }
      if (line(1) > 0) {
        // the title stamps in: oversized for a frame, then settles
        const k = line(1);
        const sc = k < 0.55 ? 3 : 2;
        drawText(x, agent ? 'A ROGUE AGENT' : 'A CASTAWAY', {
          x: W / 2, y: cy + 26 + (sc === 3 ? -4 : 0), scale: sc, align: 'center',
          color: k < 0.55 ? '#ffffff' : HOT,
        });
        if (k > 0.7) {
          x.fillStyle = DK;
          const rw = Math.round((CW - 70) * Math.min(1, (k - 0.7) / 0.3));
          x.fillRect(Math.round(W / 2 - rw / 2), cy + 48, rw, 1);
        }
      }
      const blurb = agent
        ? ['CUT THEM DOWN. DO NOT BE SEEN.', 'JAM THE ISLAND WHEN IT SUITS YOU.']
        : ['DO YOUR WORK. WATCH THE OTHERS.', 'SOMEBODY HERE IS NOT WHAT THEY SAY.'];
      blurb.forEach((ln, i) => {
        const k = line(2 + i);
        if (k <= 0) return;
        drawText(x, ln, { x: W / 2, y: cy + 57 + i * 11, scale: 1, align: 'center',
          color: fade(k, GOLD_LT, '#8a7a52') });
      });

      const k4 = line(4);
      if (k4 > 0) {
        const mates = g.mp.view.mates;
        const txt = agent
          ? (mates && mates.length > 1 ? 'WITH YOU: ' + mates.join('  ') : 'YOU WORK ALONE')
          : `${[...g.mp.view.players.values()].length} ASHORE. TRUST NOBODY.`;
        drawText(x, txt, { x: W / 2, y: cy + 84, scale: 1, align: 'center',
          color: fade(k4, agent ? '#ff9a8a' : '#9fd8c4', DK) });
      }

      // a slow pulse on the border once it is all up
      if (k4 >= 1) {
        const p = 0.5 + Math.sin(s.t * 3.1) * 0.5;
        x.fillStyle = p > 0.6 ? HOT : DK;
        x.fillRect(cx, cy, 6, 1); x.fillRect(cx + CW - 6, cy, 6, 1);
        x.fillRect(cx, cy + CH - 1, 6, 1); x.fillRect(cx + CW - 6, cy + CH - 1, 6, 1);
      }
      return [];
    },
    key() { return true; },
  },

  /* ---------------- COUNCIL + VOTE ---------------- */
  mpCouncil: {
    init(s) { s.sel = 0; s.typing = ''; s.talking = false; s.cast = null; s.stampT = 0; },
    draw(x, W, H, s, g, t) {
      const players = [...g.mp.view.players.values()];
      const alive = players.filter((p) => p.alive !== false);
      const total = Math.max(0.001, g.mp.view.phaseTotal || 60);
      const left = Math.max(0, (g.mp.view.phaseEndsAt || 0) - performance.now() / 1000);

      /* the fire everyone is sitting around */
      x.fillStyle = '#080604'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#080604', '#120c06', 0.5, 2);
      const flick = 0.82 + Math.sin(t * 11) * 0.09 + Math.sin(t * 6.3) * 0.09;
      for (let i = 6; i >= 0; i--) {
        x.fillStyle = `rgba(${88 - i * 6},${42 - i * 3},10,${(0.045 * flick).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H - 4, 34 + i * 13, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* header */
      drawText(x, 'THE COUNCIL', { x: W / 2, y: 6, scale: 2, align: 'center', color: GOLD });
      drawText(x, g.mp.councilHeader || '', { x: W / 2, y: 22, scale: 1, align: 'center', color: GOLD_LT });

      const bw = W - 52, bx = 26, by = 32;
      x.fillStyle = INK; x.fillRect(bx - 1, by - 1, bw + 2, 5);
      x.fillStyle = '#1c1208'; x.fillRect(bx, by, bw, 3);
      const n = Math.round((left / total) * bw);
      const urgent = left < 10;
      for (let i = 0; i < n; i += 3) {
        x.fillStyle = urgent ? (Math.floor(t * 6) % 2 ? '#ff6a5a' : '#8a2018') : (i % 6 ? '#c39a2c' : GOLD);
        x.fillRect(bx + i, by, 2, 3);
      }
      drawText(x, `${Math.ceil(left)}`, { x: W - 26, y: by - 9, scale: 1, align: 'right', color: urgent ? RED : DIM });
      const voted = new Set(g.mp.view.votes?.voted || []);
      drawText(x, `${voted.size}/${alive.length} VOTED`, { x: 26, y: by - 9, scale: 1, color: DIM });

      /* the ballot — every living name, votable from the moment you arrive */
      s.targets = alive.map((p) => p.id);
      s.targets.push('skip');
      if (s.sel >= s.targets.length) s.sel = 0;

      const LX = 10, LW = 118, ROW = 10;
      let y = 42;
      const rows = [];
      const canPick = g.amAlive && !s.cast;

      const line = (id, label, swatch, dead, tag, tagCol) => {
        const idx = s.targets.indexOf(id);
        const on = idx >= 0 && idx === s.sel && !s.talking;
        if (on && canPick) {
          x.fillStyle = '#5a1810'; x.fillRect(LX, y - 1, LW, ROW);
          x.fillStyle = RED; x.fillRect(LX, y - 1, 2, ROW);
        } else if (on) {
          x.fillStyle = '#2e2210'; x.fillRect(LX, y - 1, LW, ROW);
        }
        if (swatch) { x.fillStyle = dead ? '#4a4a4a' : swatch; x.fillRect(LX + 4, y, 6, 6); }
        const tagW = tag ? textWidth(tag, 1) + 5 : 0;
        let shown = label;
        while (shown.length > 1 && textWidth(shown, 1) > LW - 16 - tagW) shown = shown.slice(0, -1);
        drawText(x, shown, { x: LX + 14, y, scale: 1,
          color: dead ? '#6a6a6a' : (on ? GOLD_LT : '#c9b98a') });
        if (tag) drawText(x, tag, { x: LX + LW - 4, y, scale: 1, align: 'right', color: tagCol });
        if (idx >= 0 && canPick) rows[idx] = { x: LX, y: y - 1, w: LW, h: ROW, pick: idx };
        y += ROW;
      };

      for (const p of players) {
        const dead = p.alive === false;
        let tag = '', col = DIM;
        if (dead) { tag = 'X'; col = '#5a4a3a'; }
        else {
          const c = g.mp.view.votes?.counts?.[p.id] || 0;
          if (c) { tag = '*'.repeat(Math.min(c, 5)); col = GOLD; }
          else if (voted.has(p.id)) { tag = 'IN'; col = '#5f7a4a'; }
        }
        line(p.id, (p.name || '?'), colourOf(p.colour), dead, tag, col);
      }
      const skips = g.mp.view.votes?.counts?.skip || 0;
      line('skip', 'NOBODY', null, false, skips ? '*'.repeat(Math.min(skips, 5)) : '', GOLD);

      /* one button, and it says who it is for */
      y += 3;
      if (!g.amAlive) {
        drawText(x, 'THE DEAD DO NOT VOTE', { x: LX, y, scale: 1, color: '#6a6a6a' });
      } else if (s.cast) {
        const who = s.cast === 'skip' ? 'NOBODY'
          : (players.find((p) => p.id === s.cast)?.name || '?');
        s.stampT += 0.016;
        const k = Math.min(1, s.stampT / 0.2);
        const over = 1 + (1 - k) * 0.3;
        x.save();
        x.translate(LX + LW / 2, y + 8); x.scale(over, over); x.translate(-(LX + LW / 2), -(y + 8));
        x.fillStyle = '#12301f'; x.fillRect(LX, y, LW, 17);
        x.fillStyle = JADE;
        x.fillRect(LX, y, LW, 1); x.fillRect(LX, y + 16, LW, 1);
        x.fillRect(LX, y, 1, 17); x.fillRect(LX + LW - 1, y, 1, 17);
        let shown = who;
        while (shown.length > 1 && textWidth(shown, 1) > LW - 40) shown = shown.slice(0, -1);
        drawText(x, `VOTED  ${shown}`, { x: LX + LW / 2, y: y + 5, scale: 1,
          align: 'center', color: k < 0.6 ? '#ffffff' : GOLD_LT });
        x.restore();
      } else {
        const who = s.targets[s.sel] === 'skip' ? 'NOBODY'
          : (players.find((p) => p.id === s.targets[s.sel])?.name || '?');
        let lbl = `ENTER  VOTE ${who}`;
        while (lbl.length > 8 && textWidth(lbl, 1) > LW - 10) lbl = lbl.slice(0, -1);
        x.fillStyle = '#2a0a08'; x.fillRect(LX, y, LW, 13);
        x.fillStyle = RED;
        x.fillRect(LX, y, LW, 1); x.fillRect(LX, y + 12, LW, 1);
        x.fillRect(LX, y, 1, 13); x.fillRect(LX + LW - 1, y, 1, 13);
        drawText(x, lbl, { x: LX + LW / 2, y: y + 3, scale: 1, align: 'center', color: '#ffd8ce' });
        rows.push({ x: LX, y, w: LW, h: 13, vote: true });
      }

      /* chat, alongside — not before */
      const cx = LX + LW + 6;
      const cw = W - cx - 10;
      const ctop = 42, cbot = H - 33;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(cx, ctop, cw, cbot - ctop);
      x.fillStyle = s.talking ? JADE : '#3a2a10';
      x.fillRect(cx, ctop, cw, 1); x.fillRect(cx, cbot - 1, cw, 1);
      x.fillRect(cx, ctop, 1, cbot - ctop); x.fillRect(cx + cw - 1, ctop, 1, cbot - ctop);

      const lines = [];
      for (const m of g.mp.chat.slice(-16)) {
        wrapText(`${m.from}: ${m.text}`, cw - 7, 1, 1).forEach((ln, i) => lines.push({
          ln, kind: m.kind, from: i === 0 ? m.from : null, colour: m.colour,
        }));
      }
      const fit = Math.floor((cbot - ctop - 5) / 8);
      let cy = ctop + 3;
      for (const l of lines.slice(-fit)) {
        drawText(x, l.ln, { x: cx + 3, y: cy, scale: 1, color: l.kind === 'ghost' ? '#8fb0c8' : GOLD_LT });
        if (l.from) drawText(x, l.from + ':', { x: cx + 3, y: cy, scale: 1, color: colourOf(l.colour) });
        cy += 8;
      }
      if (!lines.length) {
        drawText(x, 'NOBODY HAS SPOKEN YET', { x: cx + cw / 2, y: ctop + 6, scale: 1, align: 'center', color: '#4a3f2a' });
      }

      field(x, cx, H - 31, cw, 11, s.talking);
      if (s.talking) {
        drawText(x, s.typing + (Math.floor(t * 3) % 2 ? '_' : ''), {
          x: cx + 3, y: H - 28, scale: 1, color: g.amAlive ? JADE : '#8fb0c8' });
      } else {
        drawText(x, 'T  TO TALK', { x: cx + 3, y: H - 28, scale: 1, color: '#5a4a30' });
        rows.push({ x: cx, y: H - 31, w: cw, h: 11, talk: true });
      }

      footer(x, W, H, s.talking ? 'ENTER SENDS   ESC STOPS TYPING'
        : (s.cast ? 'YOUR VOTE IS IN   T TALKS'
          : 'CLICK A NAME OR ARROW TO IT   ENTER VOTES   T TALKS'));
      return rows;
    },

    paste(text, s) {
      if (!s.talking) return false;
      s.typing = (s.typing + String(text || '').toUpperCase().replace(/[^A-Z0-9 .,'?-]/g, '')).slice(0, 60);
      return true;
    },

    key(code, s, g, st) {
      if (s.talking) {
        if (code === 'Escape') { s.talking = false; s.typing = ''; return true; }
        if (code === 'Enter' || code === 'NumpadEnter') {
          if (s.typing.trim()) g.sendChat(s.typing.trim());
          s.typing = ''; s.talking = false;
          return true;
        }
        if (code === 'Backspace') { s.typing = s.typing.slice(0, -1); return true; }
        const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
        if (m && s.typing.length < 60) { s.typing += m[1]; return true; }
        const punct = { Space: ' ', Period: '.', Comma: ',', Slash: '?', Minus: '-', Quote: "'" };
        if (punct[code] && s.typing.length < 60) { s.typing += punct[code]; return true; }
        return true;
      }
      if (code === 'KeyT') { s.talking = true; return true; }
      if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyW' || code === 'KeyS') {
        const n2 = s.targets?.length || 1;
        s.sel = (s.sel + ((code === 'ArrowUp' || code === 'KeyW') ? n2 - 1 : 1)) % n2;
        g.audio?.sfx('select');
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE' || code === 'Space') {
        if (!g.amAlive || s.cast) return true;
        s.cast = s.targets?.[s.sel] || 'skip';
        s.stampT = 0;
        g.sendVote(s.cast);
        return true;
      }
      return true;
    },

    /** Click a name to pick it, click it again (or the button) to send it. */
    click(row, i, s, g) {
      if (row?.talk) { s.talking = true; return true; }
      if (!g.amAlive || s.cast) return true;
      if (row?.vote) {
        s.cast = s.targets?.[s.sel] || 'skip';
        s.stampT = 0;
        g.sendVote(s.cast);
        return true;
      }
      if (row?.pick !== undefined) {
        if (row.pick === s.sel) {
          s.cast = s.targets[s.sel];
          s.stampT = 0;
          g.sendVote(s.cast);
        } else { s.sel = row.pick; g.audio?.sfx('select'); }
      }
      return true;
    },
  },

  /* ---------------- THE COMMAND TABLE ---------------- */
  mpTable: {
    init(s) {
      s.tab = s.tab || 0;
      s.boot = 0;            // seconds since the terminal was woken
      s.asked = 0;
      s.beeped = 0;
      s.zoom = 1;            // the plot zooms, like the paper map
      s.cx = 0;
      s.cz = 0;
    },
    tick(s, g, dt) {
      const was = s.boot;
      s.boot = Math.min(BOOT_LEN + 1, s.boot + dt);
      // one clack per line of the start-up log, and a chime when it lands
      const lineNow = Math.floor(s.boot / 0.16);
      if (s.boot < BOOT_LEN && lineNow !== Math.floor(was / 0.16)) g.audio?.sfx('reel');
      if (was < BOOT_LEN && s.boot >= BOOT_LEN) g.audio?.sfx('ping');
    },
    draw(x, W, H, s, g, t) {
      const d = g.bunkerReadout ? g.bunkerReadout() : null;
      if (!d) return [];
      /* Two pages, not four. VITALS was a column of heartbeats that fitted
         beside the plot anyway, and LEDGER and LOG are both records. */
      const TABS = ['THE ISLAND', 'THE RECORD'];

      /* Ask the host for the ledger the moment the table is open, and keep
         it fresh. The request is answered privately; nobody upstairs learns
         that anybody looked. */
      if (!s.asked || t - s.asked > 3) { s.asked = t; g.requestLedger?.(); }

      /* ---- somebody has pulled the plug on it remotely ----
         A hacking device does not make the table lie, it takes the table
         away: garbage, a dead carrier tone and a countdown. */
      if (d.chaff) {
        x.fillStyle = '#04100c'; x.fillRect(0, 0, W, H);
        // rolling bands of nonsense
        const CH = '0123456789ABCDEF/\\|-_=+*#%@';
        for (let row = 0; row < 18; row++) {
          const ry = 8 + row * 12 + ((t * 90) % 12);
          if (ry > H - 8) continue;
          let line = '';
          const seed = Math.floor(t * 7) * 31 + row * 17;
          for (let i = 0; i < 44; i++) {
            line += CH[(seed * (i + 3) * 2654435761) % CH.length | 0];
          }
          x.fillStyle = row % 3 === 0 ? 'rgba(111,224,184,.5)' : 'rgba(47,122,96,.35)';
          drawText(x, line, { x: 8, y: Math.round(ry), scale: 1, color: x.fillStyle, shadow: false });
        }
        // tear bands, so it reads as a signal being interfered with
        for (let i = 0; i < 4; i++) {
          const ty = ((t * 140 + i * 61) % H) | 0;
          x.fillStyle = 'rgba(0,0,0,.7)'; x.fillRect(0, ty, W, 3);
          x.fillStyle = 'rgba(190,255,220,.18)'; x.fillRect(0, ty + 3, W, 1);
        }
        for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }
        // and the one legible thing on it
        const msg = 'LINK SEVERED';
        const mw = textWidth(msg, 2) + 20;
        x.fillStyle = 'rgba(4,16,12,.92)';
        x.fillRect(Math.round(W / 2 - mw / 2), H / 2 - 18, mw, 34);
        x.fillStyle = '#ff6a5a';
        x.fillRect(Math.round(W / 2 - mw / 2), H / 2 - 18, mw, 1);
        x.fillRect(Math.round(W / 2 - mw / 2), H / 2 + 15, mw, 1);
        drawText(x, msg, {
          x: W / 2, y: H / 2 - 14, scale: 2, align: 'center',
          color: Math.floor(t * 6) % 2 ? '#ff6a5a' : '#8a2018',
        });
        drawText(x, 'SOMEBODY IS DOING THIS ON PURPOSE', {
          x: W / 2, y: H / 2 + 5, scale: 1, align: 'center', color: '#c8ffe8',
        });
        footer(x, W, H, 'ESC  STEP BACK');
        return [];
      }

      /* ---- the terminal waking up ----
         Thirty years on standby and it still runs its self-test. It is a
         second and a bit of theatre, and it is the difference between a
         menu and a machine. */
      if (s.boot < BOOT_LEN) {
        x.fillStyle = '#02100b'; x.fillRect(0, 0, W, H);
        const k = s.boot / BOOT_LEN;

        // the tube striking: a hairline that opens out into the picture
        if (k < 0.18) {
          const o = k / 0.18;
          const hh = Math.max(1, Math.round(o * o * H));
          x.fillStyle = `rgba(150,255,215,${(0.5 + o * 0.5).toFixed(2)})`;
          x.fillRect(0, Math.round((H - hh) / 2), W, hh);
          return [];
        }

        // the log, one line at a time
        const LOG = [
          'SCHWAB TECHNOLOGY LTD',
          'FIELD TERMINAL  MK IV',
          '',
          'CORE ............ OK',
          'AERIAL MAST ..... OK',
          'PLOT TABLE ...... OK',
          'VITALS LOOP ..... OK',
          'LEDGER LINK ..... OK',
          'ARCHIVE ......... DEGRADED',
          '',
          'WARMING PHOSPHOR',
        ];
        const shown = Math.min(LOG.length, Math.floor((s.boot - 0.2) / 0.16));
        for (let i = 0; i < shown; i++) {
          const ln = LOG[i];
          if (!ln) continue;
          const bad = ln.includes('DEGRADED');
          drawText(x, ln, {
            x: 16, y: 16 + i * 10, scale: 1,
            color: bad ? '#ff6a5a' : (i < 2 ? '#c8ffe8' : '#6fe0b8'),
          });
        }
        // a cursor on the line still arriving
        if (shown < LOG.length && Math.floor(s.boot * 8) % 2 === 0) {
          x.fillStyle = '#c8ffe8';
          x.fillRect(16, 16 + shown * 10, 5, 7);
        }
        // and a bar that fills as it goes
        const bw = W - 32;
        x.fillStyle = '#0d3227'; x.fillRect(16, H - 26, bw, 6);
        x.fillStyle = '#6fe0b8';
        x.fillRect(16, H - 26, Math.round(bw * Math.min(1, k * 1.05)), 6);
        drawText(x, `${Math.min(100, Math.round(k * 105))}%`, {
          x: W - 16, y: H - 38, scale: 1, align: 'right', color: '#2f7a60',
        });
        // the picture rolling into sync
        const roll = Math.round((1 - k) * 40);
        for (let i = 0; i < 3; i++) {
          x.fillStyle = 'rgba(150,255,215,.05)';
          x.fillRect(0, ((s.boot * 260 + i * 90) % (H + roll)) - roll, W, 2 + roll / 8);
        }
        for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }
        return [];
      }

      // and a beat of settling after it lands
      const settle = Math.min(1, (s.boot - BOOT_LEN) * 4);

      /* A screen from a room nobody has been in for thirty years: phosphor
         green, a scanline crawl, and a bloom that never quite settles. */
      x.fillStyle = '#03100c'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#03100c', '#061a14', 0.5, 2);
      const crawl = ((t * 24) % (H + 40)) - 20;
      for (let i = 0; i < 18; i++) {
        const yy = Math.round(crawl + i);
        if (yy < 0 || yy >= H) continue;
        x.fillStyle = `rgba(90,240,190,${(0.030 * (1 - i / 18)).toFixed(3)})`;
        x.fillRect(0, yy, W, 1);
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      const GRN = '#6fe0b8', GRN_D = '#2f7a60', GRN_L = '#c8ffe8';
      const RED = '#ff6a5a', AMB = '#ffd24a';
      x.fillStyle = GRN_D;
      x.fillRect(6, 6, W - 12, 1); x.fillRect(6, H - 7, W - 12, 1);
      x.fillRect(6, 6, 1, H - 13); x.fillRect(W - 7, 6, 1, H - 13);

      /* ---- the header, with the sponsor nobody asked for ---- */
      if (settle < 1) {
        // one last horizontal roll as the picture locks
        x.fillStyle = `rgba(150,255,215,${(0.16 * (1 - settle)).toFixed(3)})`;
        x.fillRect(0, Math.round((1 - settle) * H), W, 3);
      }
      drawText(x, 'LISTENING POST', { x: 14, y: 11, scale: 2, color: GRN });
      drawText(x, 'SCHWAB TECHNOLOGY', { x: 14, y: 25, scale: 1, color: GRN_D });
      drawText(x, d.bunker || '', { x: W - 14, y: 10, scale: 1, align: 'right', color: GRN_D });
      drawText(x, 'SIGNAL NOMINAL', {
        x: W - 14, y: 19, scale: 1, align: 'right', color: GRN_D,
      });
      drawText(x, `FLOPPER ${d.flopper}`, {
        x: W - 14, y: 28, scale: 1, align: 'right', color: GRN_D,
      });

      /* ---- tabs ---- */
      let tx = 14;
      const TOP = 40;
      TABS.forEach((name, i) => {
        const wd = textWidth(name, 1) + 12;
        const on = s.tab === i;
        if (on) { x.fillStyle = '#0d3227'; x.fillRect(tx, TOP - 3, wd, 12); }
        x.fillStyle = on ? GRN : GRN_D;
        x.fillRect(tx, TOP + 8, wd, 1);
        drawText(x, name, { x: tx + 6, y: TOP, scale: 1, color: on ? GRN_L : GRN_D });
        tx += wd + 4;
      });
      x.fillStyle = GRN_D; x.fillRect(14, TOP + 8, W - 28, 1);

      const BODY_T = TOP + 16, BODY_B = H - 44;

      /* =====================================================
         PLOT — the island, everybody on it, and where the last
         sabotage came from.
         ===================================================== */
      if (s.tab === 0) {
        /* Vitals live down the right of the plot now rather than on a page of
           their own: a colour, a name and a trace each, which is all the old
           page ever said. */
        const VW = 86;
        const PW = W - 28 - VW - 4, PH = BODY_B - BODY_T;
        const px0 = 14, py0 = BODY_T;
        {
          const vx = px0 + PW + 4;
          x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(vx, py0, VW, PH);
          x.fillStyle = GRN_D;
          x.fillRect(vx, py0, VW, 1); x.fillRect(vx, py0 + PH - 1, VW, 1);
          x.fillRect(vx, py0, 1, PH); x.fillRect(vx + VW - 1, py0, 1, PH);
          drawText(x, `${d.alive}/${d.total} ALIVE`, {
            x: vx + 4, y: py0 + 3, scale: 1, color: d.alive <= 2 ? RED : GRN,
          });
          let vy = py0 + 14;
          for (const p of d.roster) {
            if (vy > py0 + PH - 10) break;
            const hex = '#' + (p.colour >>> 0).toString(16).padStart(6, '0');
            x.fillStyle = p.alive ? hex : '#2a3a34';
            x.fillRect(vx + 4, vy, 5, 6);
            let nm = p.name;
            while (nm.length > 1 && textWidth(nm, 1) > VW - 44) nm = nm.slice(0, -1);
            drawText(x, nm, {
              x: vx + 12, y: vy, scale: 1, color: p.alive ? GRN_L : '#3f5a52',
            });
            // a trace, or a flat line
            const bx = vx + VW - 26;
            x.fillStyle = p.alive ? GRN : '#3f5a52';
            if (p.alive) {
              const ph = (t * 2.2 + p.name.length) % 1;
              for (let k = 0; k < 22; k++) {
                const u = k / 22;
                const dd = Math.abs(u - ph);
                const hh = dd < 0.05 ? 3 : (dd < 0.10 ? 2 : 0);
                if (hh) x.fillRect(bx + k, vy + 3 - hh, 1, hh * 2);
                else x.fillRect(bx + k, vy + 3, 1, 1);
              }
            } else x.fillRect(bx, vy + 3, 22, 1);
            vy += 10;
          }
        }
        x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(px0, py0, PW, PH);

        const cx = px0 + PW / 2, cy = py0 + PH / 2;
        const R = Math.min(PW, PH) / 2 - 4;
        /* The plot zooms and pans, exactly like the paper map. At one scale
           everything within thirty metres of anything else printed on top of
           it and the table was less use than the compass. */
        const zoom = Math.max(1, Math.min(5, s.zoom || 1));
        const span = 205 / zoom;
        const reach = 205 * (1 - 1 / zoom);
        if (zoom <= 1) { s.cx = 0; s.cz = 0; }
        s.cx = Math.max(-reach, Math.min(reach, s.cx || 0));
        s.cz = Math.max(-reach, Math.min(reach, s.cz || 0));
        const K = R / span;                      // world units -> screen
        const wx0 = s.cx, wz0 = s.cz;
        const onPlot = (qx, qy) => qx > px0 + 2 && qx < px0 + PW - 2
          && qy > py0 + 2 && qy < py0 + PH - 2;

        /* The half the sabotage came from, washed red and pulsing. Drawn
           under everything else so the pips still read on top of it. */
        if (d.half) {
          const pulse = 0.10 + Math.abs(Math.sin(t * 2.6)) * 0.14;
          x.fillStyle = `rgba(200,40,30,${pulse.toFixed(3)})`;
          // the dividing line is the world axis, so it moves with the pan
          const ax = Math.round(cx - wx0 * K), az = Math.round(cy - wz0 * K);
          const lx = Math.max(px0, Math.min(px0 + PW, ax));
          const lz = Math.max(py0, Math.min(py0 + PH, az));
          if (d.half === 'EAST') x.fillRect(lx, py0, px0 + PW - lx, PH);
          else if (d.half === 'WEST') x.fillRect(px0, py0, lx - px0, PH);
          else if (d.half === 'SOUTH') x.fillRect(px0, lz, PW, py0 + PH - lz);
          else x.fillRect(px0, py0, PW, lz - py0);
          // a hatched edge along the dividing line
          x.fillStyle = `rgba(255,90,70,${(0.4 + pulse).toFixed(2)})`;
          if (d.half === 'EAST' || d.half === 'WEST') {
            for (let yy = py0; yy < py0 + PH; yy += 3) x.fillRect(lx - 1, yy, 2, 2);
          } else {
            for (let xx = px0; xx < px0 + PW; xx += 3) x.fillRect(xx, lz - 1, 2, 2);
          }
        }

        // the coastline: a lumpy ring, not a circle
        x.strokeStyle = 'rgba(47,122,96,.85)'; x.lineWidth = 1;
        x.save();
        x.beginPath(); x.rect(px0 + 1, py0 + 1, PW - 2, PH - 2); x.clip();
        x.beginPath();
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          const rr = 185 * (0.98 + Math.sin(a * 3 + 0.7) * 0.05 + Math.sin(a * 5 - 1.2) * 0.033);
          const qx = cx + (Math.cos(a) * rr - wx0) * K, qy = cy + (Math.sin(a) * rr - wz0) * K;
          if (i === 0) x.moveTo(qx, qy); else x.lineTo(qx, qy);
        }
        x.closePath(); x.stroke();
        // the interior, one shade up from the sea
        x.fillStyle = 'rgba(20,70,54,.5)'; x.fill();
        // the ridge, as a couple of contours
        x.strokeStyle = 'rgba(47,122,96,.45)';
        for (const rr of [108, 62]) {
          x.beginPath();
          for (let i = 0; i <= 30; i++) {
            const a = (i / 30) * Math.PI * 2;
            const q = rr * (1 + Math.sin(a * 4 + 2) * 0.12);
            const qx = cx + (-25 + Math.cos(a) * q - wx0) * K;
            const qy = cy + (-33 + Math.sin(a) * q - wz0) * K;
            if (i === 0) x.moveTo(qx, qy); else x.lineTo(qx, qy);
          }
          x.closePath(); x.stroke();
        }
        x.restore();
        /* Compass letters in the corners rather than on the axes. On the
           axes the S sat exactly where the CAMP label lands. */
        drawText(x, 'N', { x: px0 + 4, y: py0 + 3, scale: 1, color: GRN_D });
        drawText(x, 'E', { x: px0 + PW - 9, y: py0 + 3, scale: 1, color: GRN_D });
        drawText(x, 'W', { x: px0 + 4, y: py0 + PH - 10, scale: 1, color: GRN_D });
        drawText(x, 'S', { x: px0 + PW - 9, y: py0 + PH - 10, scale: 1, color: GRN_D });

        // the sweep, from wherever the aerial actually is
        const swx = Math.round(cx - wx0 * K), swy = Math.round(cy - wz0 * K);
        const a0 = t * 1.1;
        x.save();
        x.beginPath(); x.rect(px0 + 1, py0 + 1, PW - 2, PH - 2); x.clip();
        for (let i = 0; i < 22; i++) {
          const a = a0 - i * 0.045;
          x.strokeStyle = `rgba(111,224,184,${(0.26 * (1 - i / 22)).toFixed(3)})`;
          x.beginPath(); x.moveTo(swx, swy);
          x.lineTo(swx + Math.cos(a) * R * zoom, swy + Math.sin(a) * R * zoom);
          x.stroke();
        }
        x.restore();

        /* The places worth knowing. Labels are placed by hand against
           each other: two names printed on the same eight pixels is not a
           map, it is a smear. */
        /* The sabotage bar owns the bottom of the plot, so it goes into the
           taken list before anything else — a place name printed behind it
           is a place name you cannot read. */
        const taken = [];
        if (d.half) taken.push({ x: px0, y: py0 + PH - 13, w: PW });
        const freeRow = (lx, ly, lw) => {
          for (let tries = 0; tries < 6; tries++) {
            const clash = taken.some((r) => Math.abs(r.y - ly) < 10 && lx < r.x + r.w && r.x < lx + lw);
            if (!clash) break;
            // move UP out of the way; the bottom of the plot is committed
            ly -= 10;
          }
          taken.push({ x: lx, y: ly, w: lw });
          return ly;
        };
        for (const m of (d.marks || [])) {
          const mx = Math.round(cx + (m.x - wx0) * K), my = Math.round(cy + (m.z - wz0) * K);
          if (!onPlot(mx, my)) continue;
          x.fillStyle = m.kind === 'post' ? AMB : 'rgba(120,190,165,.75)';
          if (m.kind === 'post') {
            const pulse = Math.floor(t * 3) % 2 === 0;
            x.fillStyle = pulse ? '#ffe9a8' : AMB;
            x.fillRect(mx - 3, my - 3, 7, 1); x.fillRect(mx - 3, my + 3, 7, 1);
            x.fillRect(mx - 3, my - 3, 1, 7); x.fillRect(mx + 3, my - 3, 1, 7);
          } else {
            x.fillRect(mx - 1, my - 1, 3, 3);
          }
          if (!m.label) continue;
          const lw = textWidth(m.label, 1);
          const lx = Math.round(Math.min(px0 + PW - lw - 3, Math.max(px0 + 3, mx - lw / 2)));
          const ly = freeRow(lx, my + 5, lw);
          // a dark bed, so a name over the coastline is still readable
          x.fillStyle = 'rgba(3,16,12,.78)';
          x.fillRect(lx - 1, ly - 1, lw + 2, 9);
          drawText(x, m.label, {
            x: lx, y: ly, scale: 1,
            color: m.kind === 'post' ? AMB : 'rgba(120,190,165,.95)', shadow: false,
          });
        }

        // and everybody on it
        for (const p of d.roster) {
          const qx = Math.round(cx + (p.x - wx0) * K), qy = Math.round(cy + (p.z - wz0) * K);
          if (!onPlot(qx, qy)) continue;
          const hex = '#' + (p.colour >>> 0).toString(16).padStart(6, '0');
          if (p.alive) {
            // a soft return that breathes, so live pips read as live
            const br = 2 + (Math.sin(t * 3 + qx) > 0 ? 1 : 0);
            x.fillStyle = hex;
            x.fillRect(qx - br, qy - br, br * 2 + 1, br * 2 + 1);
            x.fillStyle = GRN_L;
            x.fillRect(qx - 1, qy - 1, 3, 3);
          } else {
            x.fillStyle = '#8a2018';
            x.fillRect(qx - 3, qy, 7, 1);
            x.fillRect(qx, qy - 3, 1, 7);
          }
          if (p.me) {
            x.strokeStyle = GRN_L; x.lineWidth = 1;
            x.strokeRect(qx - 4.5, qy - 4.5, 9, 9);
          }
        }

        // what scale you are looking at
        if (zoom > 1) {
          drawText(x, `x${zoom}`, {
            x: px0 + PW - 4, y: py0 + PH - 11, scale: 1, align: 'right', color: AMB,
          });
        }
        if (d.half) {
          // on its own bar, so it never lands on top of a place name
          const msg2 = `LAST SABOTAGE ORIGINATED ${d.half}`;
          const mw = textWidth(msg2, 1) + 10;
          x.fillStyle = 'rgba(4,14,10,.92)';
          x.fillRect(Math.round(cx - mw / 2), py0 + PH - 12, mw, 11);
          x.fillStyle = 'rgba(200,60,45,.6)';
          x.fillRect(Math.round(cx - mw / 2), py0 + PH - 12, mw, 1);
          drawText(x, msg2, {
            x: cx, y: py0 + PH - 10, scale: 1, align: 'center',
            color: Math.floor(t * 4) % 2 ? RED : '#a83a2a',
          });
        }
      }

      /* =====================================================
         THE RECORD — what everybody is carrying, and what the
         island has had done to it. Two columns, so neither can
         run into the other however long the round gets.
         ===================================================== */
      if (s.tab === 1) {
        const COL = Math.floor((W - 32) / 2);
        const LX2 = 14, RX2 = 14 + COL + 4;

        /* ---- left: the ledger ---- */
        drawText(x, 'SYNCOIN LEDGER', { x: LX2, y: BODY_T, scale: 1, color: GRN });
        x.fillStyle = GRN_D; x.fillRect(LX2, BODY_T + 9, COL, 1);
        let ly = BODY_T + 14;
        if (!d.ledger) {
          drawText(x, 'QUERYING . . .', { x: LX2, y: ly, scale: 1, color: GRN_D });
        } else {
          const sorted = [...d.roster].sort((a2, b2) => (b2.coins || 0) - (a2.coins || 0));
          const top = Math.max(1, sorted[0]?.coins || 1);
          for (const p of sorted) {
            if (ly > BODY_B - 9) break;
            const hex = '#' + (p.colour >>> 0).toString(16).padStart(6, '0');
            x.fillStyle = p.alive ? hex : '#2a3a34';
            x.fillRect(LX2, ly, 5, 7);
            let nm = p.name + (p.me ? '*' : '');
            while (nm.length > 1 && textWidth(nm, 1) > COL - 62) nm = nm.slice(0, -1);
            drawText(x, nm, { x: LX2 + 8, y: ly, scale: 1, color: p.alive ? GRN_L : '#3f5a52' });
            // a bar, because a column of numbers is not a picture
            const bw = Math.round(((p.coins || 0) / top) * 30);
            x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(LX2 + COL - 54, ly + 1, 30, 5);
            x.fillStyle = p.alive ? GRN : '#3f5a52';
            x.fillRect(LX2 + COL - 54, ly + 1, bw, 5);
            drawText(x, p.coins == null ? '--' : String(p.coins), {
              x: LX2 + COL - 2, y: ly, scale: 1, align: 'right',
              color: p.alive ? AMB : '#5a6a62',
            });
            ly += 10;
          }
        }

        /* ---- right: the incident log ---- */
        drawText(x, 'INCIDENT LOG', { x: RX2, y: BODY_T, scale: 1, color: GRN });
        x.fillStyle = GRN_D; x.fillRect(RX2, BODY_T + 9, COL, 1);
        let ry = BODY_T + 14;
        const log = d.log || [];
        if (!log.length) {
          drawText(x, 'NOTHING YET.', { x: RX2, y: ry, scale: 1, color: '#3f5a52' });
        }
        log.forEach((e, i) => {
          /* Two lines per entry, both clipped to the column. The old version
             printed a name and a direction on the SAME line at opposite ends
             of the full screen width, which on a narrow buffer overlapped
             into each other — that was the glitch. */
          if (ry > BODY_B - 20) return;
          x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(RX2, ry - 2, COL, 21);
          x.fillStyle = i === 0 ? RED : '#5a2018'; x.fillRect(RX2, ry - 2, 2, 21);
          let nm = e.name || 'SABOTAGE';
          while (nm.length > 1 && textWidth(nm, 1) > COL - 12) nm = nm.slice(0, -1);
          drawText(x, nm, { x: RX2 + 6, y: ry, scale: 1, color: GRN_L });
          drawText(x, e.half ? `FROM THE ${e.half}` : 'ORIGIN UNKNOWN', {
            x: RX2 + 6, y: ry + 9, scale: 1, color: e.half ? AMB : '#3f5a52',
          });
          ry += 23;
        });
        if (log.length) {
          drawText(x, 'A HALF, NOT A NAME.', {
            x: RX2, y: Math.min(ry + 2, BODY_B - 8), scale: 1, color: '#3f5a52',
          });
        }
      }

      /* the strip along the bottom */
      const cell = (label, val, ox, colour) => {
        drawText(x, label, { x: ox, y: H - 38, scale: 1, color: GRN_D });
        drawText(x, val, { x: ox, y: H - 28, scale: 1, color: colour || GRN_L });
      };
      cell('WORK', d.work, 14);
      cell('WEATHER', d.weather, 76, d.weather === 'CLEAR' ? GRN_L : AMB);
      cell("FERDI'S", d.shop, 148, d.shop === 'TRADING' ? GRN_L : RED);
      cell('ISLAND', d.sabotage || 'NOMINAL', 214, d.sabotage ? RED : GRN_L);

      footer(x, W, H, s.tab === 0
        ? '+ -  ZOOM   WASD  PAN   C  CENTRE   TAB  PAGE   ESC  BACK'
        : 'TAB  THE ISLAND      ESC  STEP BACK');
      return [];
    },
    key(code, s, g, st) {
      /* On the plot page the arrows and WASD pan, so paging moves to Tab and
         the bracket keys. Everywhere else they still change page. */
      const onPlot = s.tab === 0;
      if (code === 'Tab' || code === 'BracketRight') {
        s.tab = (s.tab + 1) % 2; g.audio?.sfx('terminal'); return true;
      }
      if (code === 'BracketLeft') {
        s.tab = (s.tab + 1) % 2; g.audio?.sfx('terminal'); return true;
      }
      if (onPlot) {
        const step = (205 / (s.zoom || 1)) * 0.22;
        if (code === 'Equal' || code === 'NumpadAdd') {
          s.zoom = Math.min(5, (s.zoom || 1) + 1); g.audio?.sfx('terminal'); return true;
        }
        if (code === 'Minus' || code === 'NumpadSubtract') {
          s.zoom = Math.max(1, (s.zoom || 1) - 1); g.audio?.sfx('terminal'); return true;
        }
        if (code === 'KeyC') { s.cx = 0; s.cz = 0; g.audio?.sfx('ping'); return true; }
        if (code === 'KeyA' || code === 'ArrowLeft') { s.cx -= step; return true; }
        if (code === 'KeyD' || code === 'ArrowRight') { s.cx += step; return true; }
        if (code === 'KeyW' || code === 'ArrowUp') { s.cz -= step; return true; }
        if (code === 'KeyS' || code === 'ArrowDown') { s.cz += step; return true; }
      } else {
        if (code === 'ArrowRight' || code === 'KeyD') {
          s.tab = (s.tab + 1) % 2; g.audio?.sfx('terminal'); return true;
        }
        if (code === 'ArrowLeft' || code === 'KeyA') {
          s.tab = (s.tab + 1) % 2; g.audio?.sfx('terminal'); return true;
        }
      }
      if (code === 'Escape' || code === 'Backspace' || code === 'KeyE') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
  },

  /* ===========================================================
     WHAT HE TOLD YOU

     Three lines, typed out one character at a time, on nothing. No frame,
     no panel — he is not part of the interface any more than he is part of
     the roster.
     =========================================================== */
  mpRiddle: {
    init(s) { s.shown = 0; s.line = 0; s.done = false; },
    draw(x, W, H, s, g, t) {
      const lines = s.lines || [''];

      // the world dims almost to nothing behind him
      x.fillStyle = 'rgba(2,4,6,.90)'; x.fillRect(0, 0, W, H);
      // a slow blue drift, like light through leaves
      for (let i = 0; i < 5; i++) {
        const a2 = (0.014 + i * 0.002).toFixed(3);
        const yy = ((t * 12 + i * 47) % (H + 40)) - 20;
        x.fillStyle = `rgba(120,200,230,${a2})`;
        x.fillRect(0, yy, W, 12);
      }

      /* his eyes, at the top, watching while he talks */
      {
        const bx = W / 2, by = 26;
        const glow = 0.7 + Math.sin(t * 5.3) * 0.3;
        x.fillStyle = `rgba(140,230,255,${(0.5 + glow * 0.5).toFixed(2)})`;
        x.fillRect(bx - 9, by, 4, 2);
        x.fillRect(bx + 5, by, 4, 2);
        // and the suggestion of a hood round them
        x.fillStyle = 'rgba(20,28,36,.9)';
        x.fillRect(bx - 16, by - 10, 32, 8);
        x.fillRect(bx - 13, by - 4, 26, 3);
      }

      /* the lines, typed */
      const SPEED = 34;                       // characters a second
      let budget = Math.floor((s.t || 0) * SPEED);
      let y = 52;
      lines.forEach((ln, i) => {
        const wrapped = wrapText(String(ln), W - 48, 1, 1);
        for (const w of wrapped) {
          const take = Math.max(0, Math.min(w.length, budget));
          budget -= w.length;
          if (take <= 0) return;
          drawText(x, w.slice(0, take), {
            x: 24, y, scale: 1,
            color: i === 1 ? '#bdf0ff' : '#6a8a9a',
          });
          // a cursor on the line still arriving
          if (take < w.length && Math.floor(t * 8) % 2 === 0) {
            x.fillStyle = '#bdf0ff';
            x.fillRect(24 + textWidth(w.slice(0, take), 1) + 1, y, 4, 7);
          }
          y += 11;
        }
        y += 6;
      });
      s.done = budget >= 0;

      if (s.done) {
        drawText(x, 'HE IS ALREADY GONE.', {
          x: W / 2, y: H - 46, scale: 1, align: 'center',
          color: Math.floor(t * 2) % 2 ? '#4a6a7a' : '#31485a',
        });
      }
      footer(x, W, H, s.done ? 'E  ENOUGH' : '');
      return [];
    },
    key(code, s, g, st) {
      if (!s.done) {
        // let people skip the typing
        s.t = 99;
        return true;
      }
      if (code === 'KeyE' || code === 'Enter' || code === 'Space'
        || code === 'Escape' || code === 'Backspace') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
  },

  /* ===========================================================
     ONE OF FERDI'S MACHINES

     Not a shop. You put six Syncoin in the slot, the drum turns, and it
     gives you whichever of his leftovers it feels like. It has one thing
     in it and once you have taken it, it has nothing.
     =========================================================== */
  mpVend: {
    init(s) {
      s.phase = 'idle';       // idle | turning | out | empty
      s.t0 = 0;
      s.got = null;
      s.reel = 0;
    },
    draw(x, W, H, s, g, t) {
      const COST = 6;
      const coins = g.coins || 0;
      const pool = VENDOR_IDS.map((id) => STOCK.find((i) => i.id === id)).filter(Boolean);

      x.fillStyle = '#08120f'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#08120f', '#0e1c18', 0.5, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* the cabinet, seen straight on */
      /* The cabinet has to stop far enough up the screen that the message
         underneath it clears the key hints — at 168 tall the message was
         printed straight through the footer. */
      const CW = 150, CH = 156;
      const cx0 = Math.round((W - CW) / 2), cy0 = 24;
      x.fillStyle = '#1c4034'; x.fillRect(cx0 - 3, cy0 - 3, CW + 6, CH + 6);
      x.fillStyle = '#2a5a4a'; x.fillRect(cx0, cy0, CW, CH);
      x.fillStyle = '#c39a2c';
      x.fillRect(cx0 - 3, cy0 - 3, CW + 6, 3); x.fillRect(cx0 - 3, cy0 + CH, CW + 6, 3);

      // the header
      x.fillStyle = '#8a2018'; x.fillRect(cx0 + 6, cy0 + 5, CW - 12, 16);
      drawText(x, 'FERDI STEINMAN', {
        x: W / 2, y: cy0 + 9, scale: 1, align: 'center', color: '#ffd24a',
      });

      /* the window, and the drum turning behind it */
      const GX = cx0 + 12, GY = cy0 + 26, GW = CW - 24, GH = 84;
      x.fillStyle = '#071410'; x.fillRect(GX - 2, GY - 2, GW + 4, GH + 4);
      x.fillStyle = '#12302a'; x.fillRect(GX, GY, GW, GH);
      // the lit interior
      for (let i = 5; i >= 0; i--) {
        x.fillStyle = `rgba(159,232,216,${(0.020 + i * 0.004).toFixed(3)})`;
        x.fillRect(GX + i * 3, GY + i * 3, GW - i * 6, GH - i * 6);
      }

      if (s.phase === 'turning' || s.phase === 'idle') {
        /* Three of his leftovers going past on the coil. Spinning while it
           decides, still while it waits for your coin. */
        const spin = s.phase === 'turning';
        const off = spin ? (s.t - s.t0) * 260 : 0;
        for (let k = -1; k <= 2; k++) {
          const it = pool[(((s.reel + k) % pool.length) + pool.length) % pool.length];
          const iy = GY + GH / 2 - 16 + k * 34 - (off % 34);
          if (iy < GY - 20 || iy > GY + GH) continue;
          x.save();
          x.beginPath(); x.rect(GX, GY, GW, GH); x.clip();
          drawShopIcon(x, it.icon, GX + GW / 2 - 14, iy, 28, !spin, t);
          if (!spin) {
            drawText(x, it.name, {
              x: GX + GW / 2, y: iy + 31, scale: 1, align: 'center', color: '#8fd8c0',
            });
          }
          x.restore();
        }
        if (spin) {
          // a blur of motion across the glass
          for (let i = 0; i < 5; i++) {
            x.fillStyle = 'rgba(159,232,216,.07)';
            x.fillRect(GX, GY + ((off * 1.7 + i * 21) % GH), GW, 2);
          }
        }
      } else if (s.got) {
        // what you got, sitting in the tray with a light on it
        const puls = 0.6 + Math.abs(Math.sin(t * 4)) * 0.4;
        for (let i = 7; i >= 0; i--) {
          x.fillStyle = `rgba(255,210,74,${(0.03 * puls).toFixed(3)})`;
          x.beginPath(); x.arc(GX + GW / 2, GY + GH / 2, 10 + i * 6, 0, 6.283); x.fill();
        }
        drawShopIcon(x, s.got.icon, GX + GW / 2 - 18, GY + GH / 2 - 24, 36, true, t);
        drawText(x, s.got.name, {
          x: GX + GW / 2, y: GY + GH / 2 + 16, scale: 1, align: 'center', color: GOLD_LT,
        });
        drawText(x, s.got.tag, {
          x: GX + GW / 2, y: GY + GH / 2 + 26, scale: 1, align: 'center', color: '#8a7a52',
        });
      } else {
        drawText(x, 'EMPTY', {
          x: GX + GW / 2, y: GY + GH / 2 - 4, scale: 2, align: 'center', color: '#3f5a52',
        });
      }

      /* the slot and the knob */
      const KY = cy0 + CH - 34;
      x.fillStyle = '#3a3a42'; x.fillRect(cx0 + CW - 44, KY, 34, 26);
      x.fillStyle = '#e8eef2'; x.fillRect(cx0 + CW - 38, KY + 5, 16, 3);
      const knobA = s.phase === 'turning' ? (s.t - s.t0) * 9 : 0;
      const kx = cx0 + CW - 27, ky = KY + 17;
      x.fillStyle = '#c39a2c';
      x.fillRect(kx - 6, ky - 6, 12, 12);
      x.fillStyle = '#24242a';
      x.fillRect(Math.round(kx + Math.cos(knobA) * 4) - 1, Math.round(ky + Math.sin(knobA) * 4) - 1, 3, 3);

      // the hopper
      x.fillStyle = '#14141a'; x.fillRect(cx0 + 12, cy0 + CH - 32, 78, 22);
      x.fillStyle = '#8a9096'; x.fillRect(cx0 + 12, cy0 + CH - 34, 78, 2);
      if (s.phase === 'out' && s.got) {
        const bob = Math.round(Math.sin(t * 5) * 1);
        drawShopIcon(x, s.got.icon, cx0 + 42, cy0 + CH - 28 + bob, 14, true, t);
      }

      /* the strip along the top and the prompt along the bottom */
      drawText(x, `PURSE ${coins}`, {
        x: 14, y: 12, scale: 1, color: coins >= COST ? GOLD : RED,
      });
      drawText(x, `${COST} SYNCOIN A PULL`, {
        x: W - 14, y: 12, scale: 1, align: 'right', color: '#8fd8c0',
      });

      let msg, mcol;
      if (s.phase === 'turning') { msg = 'THINKING ABOUT IT'; mcol = '#8fd8c0'; }
      else if (s.phase === 'out') { msg = 'TAKE IT'; mcol = GOLD_LT; }
      else if (s.phase === 'empty') { msg = 'NOTHING LEFT IN IT'; mcol = '#7a6a52'; }
      else if (coins < COST) { msg = 'NOT ENOUGH SYNCOIN'; mcol = RED; }
      else { msg = 'PUT SIX IN'; mcol = GOLD_LT; }
      drawText(x, msg, {
        x: W / 2, y: cy0 + CH + 5, scale: 2, align: 'center', color: mcol,
      });

      footer(x, W, H, s.phase === 'turning' ? ''
        : (s.phase === 'out' ? 'E  TAKE IT' : 'E  PAY      ESC  WALK AWAY'));
      return [];
    },
    tick(s, g, dt) {
      if (s.phase === 'turning') {
        // keep the drum index moving so the icons cycle
        s.reel = (s.reel + (dt > 0 ? 1 : 0)) % 64;
        if (s.t - s.t0 > 1.5) {
          s.phase = 'out';
          g.audio?.sfx('coin');
          g.vendDeliver?.(s.got);
        }
      }
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (code !== 'KeyE' && code !== 'Enter' && code !== 'Space') return true;
      if (s.phase === 'turning') return true;
      if (s.phase === 'out') { st.pop(); g.afterOverlayClose(); return true; }
      if (s.phase === 'empty') { g.audio?.sfx('deny'); return true; }
      const out = g.vendPay?.(s.vendor);
      if (!out) { g.audio?.sfx('deny'); return true; }
      s.got = out;
      s.phase = 'turning';
      s.t0 = s.t;
      g.audio?.sfx('lever');
      return true;
    },
  },

  /* ===========================================================
     THE LUCKY FLOPPER — a slot machine you can actually read.

     The cabinet on the deck turns its drums, but from standing height
     you could never see what landed. This is the machine's face: three
     windows, six symbols, a paytable and an arm.
     =========================================================== */
  mpSlot: {
    init(s) {
      s.phase = 'idle';     // idle | spin | land | paid
      s.drag = 0;
      s.dragging = false;
      s.pulled = false;
      s.t0 = 0;
      s.reels = [0, 0, 0];
      s.result = null;
      s.win = 0;
      s.arm = 0;
      s.flash = 0;
    },
    draw(x, W, H, s, g, t) {
      const SYM = ['COCONUT', 'ANCHOR', 'SKULL', 'IDOL', 'FISH', 'SEVEN'];
      const COL = ['#a8843c', '#9aa6b0', '#e8e2d2', '#ffd24a', '#5aa0c0', '#e0453a'];
      const coins = g.coins || 0;

      /* the cabinet */
      x.fillStyle = '#1a0a08'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#1a0a08', '#2a0f0c', 0.5, 2);
      const CW = 188, CH = 158;
      const cx0 = Math.round((W - CW) / 2), cy0 = 26;
      // body
      x.fillStyle = '#8a2018'; x.fillRect(cx0, cy0, CW, CH);
      x.fillStyle = '#6a1410'; x.fillRect(cx0 + 3, cy0 + 3, CW - 6, CH - 6);
      x.fillStyle = '#c39a2c';
      x.fillRect(cx0, cy0, CW, 3); x.fillRect(cx0, cy0 + CH - 3, CW, 3);
      x.fillRect(cx0, cy0, 3, CH); x.fillRect(cx0 + CW - 3, cy0, 3, CH);

      // the crown, with lamps that chase
      drawText(x, 'THE LUCKY FLOPPER', {
        x: W / 2, y: cy0 + 8, scale: 1, align: 'center', color: '#ffd24a',
      });
      for (let i = 0; i < 14; i++) {
        const lit = ((i + Math.floor(t * (s.phase === 'paid' ? 14 : 5))) % 3) === 0;
        x.fillStyle = lit ? '#fff3c4' : '#5a2018';
        x.fillRect(cx0 + 8 + i * 12, cy0 + 18, 4, 3);
      }

      /* --- the three windows --- */
      const RW = 46, RH = 52, RY = cy0 + 26;
      const gap = 6;
      const totalW = RW * 3 + gap * 2;
      const rx0 = Math.round(cx0 + (CW - totalW) / 2);
      for (let i = 0; i < 3; i++) {
        const wx = rx0 + i * (RW + gap);
        x.fillStyle = '#0a0604'; x.fillRect(wx - 2, RY - 2, RW + 4, RH + 4);
        x.fillStyle = '#e6dcc0'; x.fillRect(wx, RY, RW, RH);

        /* Spinning: the strip is scrolling, so three neighbouring symbols
           are drawn at an offset. Landed: one symbol, centred, still. */
        const spinning = s.phase === 'spin' && s.t - s.t0 < 0.55 + i * 0.45;
        const idx = s.reels[i];
        const off = spinning ? ((t * (17 - i * 3)) % 1) : 0;
        for (let k = -1; k <= 1; k++) {
          const sym = SYM[(((idx + k) % 6) + 6) % 6];
          const sy = RY + RH / 2 + k * RH - off * RH;
          if (sy < RY - 12 || sy > RY + RH + 12) continue;
          x.save();
          x.beginPath(); x.rect(wx, RY, RW, RH); x.clip();
          // the symbol's colour block, then its name under it
          const c = COL[(((idx + k) % 6) + 6) % 6];
          x.fillStyle = c;
          const bw = 22, bh = 14;
          x.fillRect(Math.round(wx + RW / 2 - bw / 2), Math.round(sy - 12), bw, bh);
          x.fillStyle = 'rgba(0,0,0,.28)';
          x.fillRect(Math.round(wx + RW / 2 - bw / 2), Math.round(sy - 12 + bh - 3), bw, 3);
          drawText(x, sym, {
            x: wx + RW / 2, y: Math.round(sy + 5), scale: 1, align: 'center',
            color: '#2a1a10', shadow: false,
          });
          x.restore();
        }
        // the pay line across the middle
        x.fillStyle = s.phase === 'paid' && s.win > 0
          ? (Math.floor(t * 10) % 2 ? '#ffd24a' : '#8a2018') : 'rgba(140,40,30,.55)';
        x.fillRect(wx, RY + RH / 2 - 1, RW, 1);
      }

      /* --- the arm: a handle you actually pull --- */
      {
        const ax = cx0 + CW + 8;
        const TOP = cy0 + 38, THROW = 46;          // how far it travels
        const k = Math.max(s.arm || 0, s.drag || 0);
        const kn = Math.round(TOP + k * THROW);
        // the slot the arm runs in
        x.fillStyle = '#2a1a14'; x.fillRect(ax - 1, TOP - 4, 6, THROW + 22);
        // the shaft
        x.fillStyle = '#b0b6bc'; x.fillRect(ax, kn + 8, 4, cy0 + CH - 14 - kn);
        // the ball on top
        const grabbed = s.dragging;
        x.fillStyle = grabbed ? '#ff5a44' : '#c02a1a';
        x.fillRect(ax - 5, kn, 14, 12);
        x.fillStyle = grabbed ? '#ff9a88' : '#e06a58';
        x.fillRect(ax - 5, kn, 14, 3);
        x.fillStyle = '#7a1810'; x.fillRect(ax - 5, kn + 10, 14, 2);
        s.armBox = { x: ax - 9, y: TOP - 6, w: 22, h: THROW + 24, top: TOP, throwLen: THROW };
        // tell people it is draggable, until they have done it once
        if (s.phase === 'idle' && !s.pulled) {
          const puls = Math.floor(t * 3) % 2 === 0;
          drawText(x, 'PULL', {
            x: ax + 2, y: cy0 + CH + 4, scale: 1, align: 'center',
            color: puls ? '#ffd24a' : '#8a7a52',
          });
        }
      }

      /* --- the paytable --- */
      const py0 = RY + RH + 8;
      const PAY_H = 46;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(cx0 + 8, py0, CW - 16, PAY_H);
      x.fillStyle = 'rgba(195,154,44,.5)'; x.fillRect(cx0 + 8, py0, CW - 16, 1);
      const pay = [
        ['3 SEVEN', '120'], ['3 IDOL', '60'], ['ANY 3 ALIKE', '30'], ['ANY 2 ALIKE', '2'],
      ];
      /* One column with the figures hard right. Two columns did not fit:
         "ANY 3 ALIKE" ran under its own payout. */
      pay.forEach((row, i) => {
        const ry = py0 + 4 + i * 10;
        drawText(x, row[0], { x: cx0 + 14, y: ry, scale: 1, color: '#c9b98a' });
        // a dotted leader, so the eye gets from the name to the number
        const lx0 = cx0 + 16 + textWidth(row[0], 1);
        const lx1 = cx0 + CW - 16 - textWidth(row[1], 1) - 4;
        x.fillStyle = 'rgba(195,154,44,.30)';
        for (let dx = lx0; dx < lx1; dx += 4) x.fillRect(dx, ry + 5, 2, 1);
        drawText(x, row[1], {
          x: cx0 + CW - 14, y: ry, scale: 1, align: 'right', color: '#ffd24a',
        });
      });

      /* --- purse and stake --- */
      drawText(x, `PURSE ${coins}`, { x: 14, y: 12, scale: 1, color: coins >= 3 ? '#ffd24a' : '#e0453a' });
      drawText(x, 'STAKE 3', { x: W - 14, y: 12, scale: 1, align: 'right', color: '#c9b98a' });

      /* --- the result line --- */
      let msg = coins >= 3 ? 'PULL THE ARM' : 'TIM DOES NOT EXTEND CREDIT';
      let mcol = coins >= 3 ? '#c9b98a' : '#e0453a';
      if (s.phase === 'spin') { msg = 'ROUND SHE GOES'; mcol = '#c9b98a'; }
      if (s.phase === 'paid') {
        if (s.win > 0) {
          msg = `${s.win} SYNCOIN`;
          mcol = Math.floor(t * 8) % 2 ? '#fff3c4' : '#ffd24a';
        } else { msg = 'NOTHING'; mcol = '#8a7a52'; }
      }
      drawText(x, msg, { x: W / 2, y: cy0 + CH + 6, scale: 2, align: 'center', color: mcol });

      footer(x, W, H, s.phase === 'spin' ? '' : 'DRAG THE ARM  OR  E      ESC  WALK AWAY');
      return [];
    },
    /**
     * The arm. Grab the ball, drag it down, and it goes when you have
     * pulled it far enough — released early it springs back and nothing
     * happens, which is the whole pleasure of the thing.
     */
    pointer(kind, cx, cy, s, g, st) {
      const box = s.armBox;
      if (!box) return false;
      if (kind === 'down') {
        if (s.phase === 'spin') return true;
        if (cx < box.x || cx > box.x + box.w || cy < box.y || cy > box.y + box.h) return false;
        s.dragging = true;
        s.dragFrom = cy;
        s.drag = 0;
        return true;
      }
      if (!s.dragging) return false;
      if (kind === 'move') {
        s.drag = Math.max(0, Math.min(1, (cy - s.dragFrom) / box.throwLen));
        return true;
      }
      // released
      s.dragging = false;
      const far = s.drag >= 0.75;
      s.drag = 0;
      if (far) { s.pulled = true; SCREENS.mpSlot._pull(s, g); }
      else g.audio?.sfx('select');
      return true;
    },

    /** Shared by the arm and the key. */
    _pull(s, g) {
      if (s.phase === 'spin') return;
      const out = g.pullSlot?.(s.slot);
      if (!out) { g.audio?.sfx('deny'); return; }
      s.phase = 'spin';
      s.t0 = s.t;
      s.result = out.result;
      s.win = out.win;
      s.arm = 1;
      s.pulled = true;
    },

    tick(s, g, dt, t) {
      if (s.arm > 0) s.arm = Math.max(0, s.arm - dt * 3);
      if (s.phase === 'spin' && s.t - s.t0 > 1.9) {
        s.phase = 'paid';
        s.reels = s.result.slice();
        // the coins land exactly when the last drum does
        g.settleSlot?.(s.slot, s.win);
        if (s.win > 0) g.audio?.sfx(s.win >= 60 ? 'jackpot' : 'coin');
        else g.audio?.sfx('deny');
      }
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
        SCREENS.mpSlot._pull(s, g);
        return true;
      }
      return true;
    },
  },

  /* ===========================================================
     MICHAEL BEEF'S TABLE

     Six decks, dealer stands on all seventeens, blackjack pays three to
     two, double and split on the first two cards. The rules are in
     mp/blackjack.js and this only draws them.
     =========================================================== */
  mpBlackjack: {
    init(s, g) {
      /* A quarter of the purse, rounded down to a five, and never more than
         you are holding. Opening on a stake you cannot cover was the reason
         the arrows felt broken: you pressed DEAL and he refused. */
      const purse = g.coins || 0;
      s.stake = Math.max(BJ_MIN,
        Math.min(BJ_MAX, purse, Math.floor(purse / 4 / 5) * 5 || BJ_MIN));
      s.bump = 0;             // the little kick when the stake changes
      s.st = null;
      s.phase = 'bet';        // bet | dealing | player | dealer | paid
      s.t0 = 0;
      s.dealt = 0;
      s.said = 0;
      /* When each card arrived, keyed by where it sits. Every card flies out
         of the shoe from the moment it is stamped, so a hit in the middle of
         a hand animates exactly like a card off the deal. */
      s.at = {};
      s.holeShown = false;
      s.chips = 0;
      s.line = "SIT DOWN. SIX DECKS, I STAND ON ALL SEVENTEENS.";
      s.flash = 0;
      s.won = 0;
    },
    draw(x, W, H, s, g, t) {
      const coins = g.coins || 0;
      const BJ = g.bjRules;
      if (!BJ) return [];
      let stakeRows = [];

      /* ---- the room, behind the felt ---- */
      x.fillStyle = '#12060a'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#12060a', '#20090e', 0.5, 2);
      // firelight from either side, breathing on its own beat
      for (let side = 0; side < 2; side++) {
        const fx = side ? W + 10 : -10;
        const flick = 0.55 + Math.abs(Math.sin(t * (6.1 + side * 1.7))) * 0.45;
        for (let i = 9; i >= 0; i--) {
          x.fillStyle = `rgba(255,140,50,${(0.012 * flick).toFixed(3)})`;
          x.beginPath(); x.arc(fx, H * 0.42, 24 + i * 15, 0, 6.283); x.fill();
        }
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.30)'; x.fillRect(0, y, W, 1); }

      /* ---- the baize ----
         The layout is a set of explicit bands with nothing sharing one.
         The printed rules used to sit at the top and bottom of the felt,
         which is exactly where the dealer's total and your chips go. */
      const TY = 34, TH = H - TY - 48;
      const DEAL_LBL = TY + 4, DEAL_CARDS = TY + 15;
      const YOU_CARDS = TY + TH - 62, YOU_LBL = TY + TH - 30, YOU_CHIPS = TY + TH - 19;
      x.fillStyle = '#0d3a2a'; x.fillRect(10, TY, W - 20, TH);
      ditherRect(x, 10, TY, W - 20, TH, '#0d3a2a', '#12503a', 0.5, 2);
      // the arc of the table edge, and the gilt rail on it
      x.fillStyle = '#5a2418'; x.fillRect(10, TY - 3, W - 20, 3);
      x.fillStyle = '#c39a2c'; x.fillRect(10, TY - 4, W - 20, 1);


      /* ---- a card ----
         Cards are dealt, not placed. Each one flies out of the shoe at the
         dealer's left, spinning, arrives face down, and flips over as it
         settles with a little overshoot. `key` is where it lives, so the same
         card keeps its own clock across frames. */
      const CW = 20, CH = 28;
      const SHOE_X = 20, SHOE_Y = TY + 6;

      /* the shoe itself, which is where they all come from */
      const shoe = () => {
        x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(SHOE_X + 1, SHOE_Y + 2, 26, 20);
        x.fillStyle = '#3a1a14'; x.fillRect(SHOE_X, SHOE_Y, 26, 20);
        x.fillStyle = '#5a2418'; x.fillRect(SHOE_X, SHOE_Y, 26, 2);
        x.fillStyle = '#c39a2c'; x.fillRect(SHOE_X, SHOE_Y + 18, 26, 2);
        // the deck showing through the top
        x.fillStyle = '#e6dcc0'; x.fillRect(SHOE_X + 3, SHOE_Y + 3, 20, 6);
        x.fillStyle = '#b8ae92';
        for (let i = 0; i < 6; i++) x.fillRect(SHOE_X + 3, SHOE_Y + 3 + i, 20, 1);
      };

      const faceUp = (c, px, yy, w) => {
        x.fillStyle = '#f2ecd8'; x.fillRect(px, yy, w, CH);
        x.fillStyle = '#c8c0a4'; x.fillRect(px, yy + CH - 1, w, 1);
        if (w < 9) return;                       // mid-flip, no room for the face
        const red = c.s === 'H' || c.s === 'D';
        const col = red ? '#b02418' : '#1a1410';
        drawText(x, c.r === '10' ? '10' : c.r, {
          x: px + 2, y: yy + 3, scale: 1, color: col, shadow: false,
        });
        const sx = px + w - 8, sy = yy + CH - 11;
        x.fillStyle = col;
        if (c.s === 'H') {
          x.fillRect(sx, sy + 1, 2, 3); x.fillRect(sx + 3, sy + 1, 2, 3);
          x.fillRect(sx, sy + 3, 5, 2); x.fillRect(sx + 1, sy + 5, 3, 1); x.fillRect(sx + 2, sy + 6, 1, 1);
        } else if (c.s === 'D') {
          x.fillRect(sx + 2, sy, 1, 1); x.fillRect(sx + 1, sy + 1, 3, 1);
          x.fillRect(sx, sy + 2, 5, 2); x.fillRect(sx + 1, sy + 4, 3, 1); x.fillRect(sx + 2, sy + 5, 1, 1);
        } else if (c.s === 'S') {
          x.fillRect(sx + 2, sy, 1, 2); x.fillRect(sx + 1, sy + 1, 3, 2);
          x.fillRect(sx, sy + 2, 5, 2); x.fillRect(sx + 2, sy + 4, 1, 2);
        } else {
          x.fillRect(sx + 1, sy, 3, 2); x.fillRect(sx, sy + 2, 2, 2);
          x.fillRect(sx + 3, sy + 2, 2, 2); x.fillRect(sx + 2, sy + 4, 1, 2);
        }
      };

      const faceDown = (px, yy, w) => {
        x.fillStyle = '#8a2018'; x.fillRect(px, yy, w, CH);
        if (w < 7) return;
        x.fillStyle = '#5a1410'; x.fillRect(px + 2, yy + 2, w - 4, CH - 4);
        x.fillStyle = '#c39a2c';
        for (let i = 4; i < CH - 4; i += 4) x.fillRect(px + 3, yy + i, w - 6, 1);
      };

      /**
       * @param key  a stable name for this card's slot
       * @param hold true to keep it face down after it lands (the hole card)
       */
      const card = (key, c, tx, ty2, hold) => {
        if (s.at[key] === undefined) s.at[key] = s.t;
        const age = Math.max(0, s.t - s.at[key]);
        const FLY = 0.30;
        const k = Math.min(1, age / FLY);
        const e = 1 - Math.pow(1 - k, 3);
        // a touch of overshoot so it settles rather than stopping dead
        const over = k >= 1 ? 0 : Math.sin(k * Math.PI) * 3;
        const px = Math.round(SHOE_X + (tx - SHOE_X) * e);
        const py = Math.round(SHOE_Y + (ty2 - SHOE_Y) * e - over);

        // its shadow, which shrinks as it lands
        x.fillStyle = `rgba(0,0,0,${(0.45 - (1 - k) * 0.2).toFixed(2)})`;
        x.fillRect(px + 2 + Math.round((1 - k) * 3), py + 3 + Math.round((1 - k) * 3), CW, CH);

        /* In flight it is face down and spinning — the spin is a horizontal
           squash, which is all a card needs in two dimensions. Then it flips
           once, unless it is the hole card. */
        if (k < 1) {
          const spin = Math.abs(Math.cos(age * 26));
          const w = Math.max(2, Math.round(CW * (0.25 + spin * 0.75)));
          faceDown(px + Math.round((CW - w) / 2), py, w);
          return;
        }
        const flipT = age - FLY;
        const FLIP = 0.22;
        if (hold) { faceDown(px, py, CW); return; }
        if (flipT < FLIP) {
          const f = flipT / FLIP;
          const w = Math.max(2, Math.round(CW * Math.abs(Math.cos(f * Math.PI))));
          const ox2 = px + Math.round((CW - w) / 2);
          if (f < 0.5) faceDown(ox2, py, w); else faceUp(c, ox2, py, w);
          return;
        }
        faceUp(c, px, py, CW);
      };

      /* ---- the dealer's hand ---- */
      const st = s.st;
      const dy = DEAL_CARDS;
      shoe();
      if (st) {
        const dn = st.dealer.length;
        const dx0 = Math.round(W / 2 - (dn * (CW + 3) - 3) / 2);
        st.dealer.forEach((c, i) => {
          // his second card stays down until it is his turn
          const down = i === 1 && st.phase === 'player';
          const shown = s.phase === 'dealing' ? (s.dealt > i * 2 + 1) : true;
          if (!shown) return;
          card(`d${i}`, c, dx0 + i * (CW + 3), dy, down);
        });
        drawText(x, st.phase === 'player' ? 'DEALER' : `DEALER  ${BJ.handText(st.dealer)}`, {
          x: W / 2, y: DEAL_LBL, scale: 1, align: 'center',
          color: st.phase !== 'player' && BJ.score(st.dealer).bust ? '#ff8a7a' : '#9fd8c0',
        });
      }

      /* ---- your hands ---- */
      const py0 = YOU_CARDS;
      if (st) {
        const hn = st.hands.length;
        const slotW = (W - 28) / hn;
        st.hands.forEach((h, hi) => {
          const cxh = 14 + slotW * hi + slotW / 2;
          const n = h.cards.length;
          const px0 = Math.round(cxh - (n * (CW + 3) - 3) / 2);
          const live = hi === st.active && st.phase === 'player';
          if (live) {
            // a pool of light under the hand you are playing
            x.fillStyle = 'rgba(255,210,74,.10)';
            x.fillRect(px0 - 5, py0 - 4, n * (CW + 3) + 7, CH + 12);
            x.fillStyle = Math.floor(t * 4) % 2 ? '#ffd24a' : '#8a7a2a';
            x.fillRect(px0 - 5, py0 + CH + 7, n * (CW + 3) + 7, 1);
          }
          h.cards.forEach((c, i) => {
            const shown = s.phase === 'dealing' ? (s.dealt > i * 2) : true;
            if (!shown) return;
            card(`p${hi}_${i}`, c, px0 + i * (CW + 3), py0, false);
          });
          const sc = BJ.score(h.cards);
          const res = st.results && st.results[hi];
          let txt = BJ.handText(h.cards);
          let col = sc.bust ? '#ff8a7a' : (live ? GOLD_LT : '#c9b98a');
          if (res) {
            txt = { blackjack: 'BLACKJACK', win: 'WIN', push: 'PUSH', lose: 'LOSE', bust: 'BUST' }[res.outcome];
            col = res.pays > res.staked ? '#8fe8a0' : (res.pays === res.staked ? GOLD_LT : '#ff8a7a');
          }
          drawText(x, txt, {
            x: cxh, y: YOU_LBL, scale: 1, align: 'center', color: col,
          });
          /* The chips, dropping in one at a time from above rather than all
             appearing at once. */
          const chipKey = `c${hi}`;
          if (s.at[chipKey] === undefined) s.at[chipKey] = s.t;
          const chipAge = s.t - s.at[chipKey];
          const nChips = Math.min(6, Math.ceil(h.bet / 5));
          for (let k = 0; k < Math.min(nChips, Math.floor(chipAge / 0.07) + 1); k++) {
            // stacked downward: growing upward, the top chip landed on the
            // hand's own label
            const drop = Math.max(0, 1 - (chipAge - k * 0.07) / 0.14);
            const chx = Math.round(cxh - 4);
            const chy = Math.round(YOU_CHIPS + k * 2 - drop * drop * 14);
            x.fillStyle = '#0a0604'; x.fillRect(chx - 1, chy - 1, 10, 4);
            x.fillStyle = h.doubled ? '#c39a2c' : '#8a2018'; x.fillRect(chx, chy, 8, 3);
            x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(chx, chy, 8, 1);
          }
        });
      }

      /* ---- the betting box ----
         A chip tray on the felt, not a number in the corner with two
         triangles beside it. Everything about the stake is in one place:
         what it is made of, what it comes to, which way the keys move it,
         and what you will be sitting on afterwards. */
      if (s.phase === 'bet') {
        const ty = Math.round(TY + (TH - 68) / 2);
        // the painted betting circle it sits in
        x.strokeStyle = 'rgba(255,255,255,.09)'; x.lineWidth = 1;
        x.beginPath(); x.ellipse(W / 2, ty + 34, 104, 45, 0, 0, 6.283); x.stroke();
        x.strokeStyle = 'rgba(195,154,44,.20)';
        x.beginPath(); x.ellipse(W / 2, ty + 34, 99, 41, 0, 0, 6.283); x.stroke();
        stakeRows = stakeTray(x, W / 2, ty, 182, s.stake, coins, t, {
          kick: s.bump || 0, min: BJ_MIN, max: BJ_MAX,
        });
      }

      /* ---- Michael Beef, a portrait beside his own name ----
         He used to be drawn across the middle of the header, where the
         dealer's total lands. He sits in the corner now, out of everything's
         way, and the house rules go on the line under his name. */
      {
        const bx = 18, by = 4;
        x.fillStyle = '#050304';
        x.fillRect(bx - 8, by + 9, 17, 12);       // shoulders
        x.fillRect(bx - 4, by + 3, 9, 7);         // head
        x.fillRect(bx - 8, by + 1, 17, 2);        // hat brim
        x.fillRect(bx - 4, by - 2, 9, 3);         // crown
        const blink = Math.sin(t * 0.83) > 0.985;
        x.fillStyle = blink ? '#3a2a10' : '#ffd88a';
        x.fillRect(bx - 3, by + 5, 2, blink ? 1 : 2);
        x.fillRect(bx + 1, by + 5, 2, blink ? 1 : 2);
      }
      drawText(x, 'MICHAEL BEEF', { x: 32, y: 4, scale: 1, color: '#c08078' });
      drawText(x, 'ASSOCIATE OF T. G. FLOPPER', { x: 32, y: 13, scale: 1, color: '#6a4a44' });
      drawText(x, '6 DECKS . PAYS 3 TO 2 . STANDS ON ALL 17', {
        x: 32, y: 22, scale: 1, color: '#4a7a6a',
      });
      drawText(x, `PURSE ${coins}`, {
        x: W - 14, y: 4, scale: 1, align: 'right', color: coins > 0 ? GOLD : RED,
      });
      drawText(x, `STAKE ${s.stake}`, {
        x: W - 14, y: 13, scale: 1, align: 'right', color: '#c9b98a',
      });

      /* ---- what he is saying ---- */
      {
        const lw = textWidth(s.line, 1);
        const lx = Math.round(Math.max(6, Math.min(W - lw - 6, W / 2 - lw / 2)));
        x.fillStyle = 'rgba(6,3,4,.86)';
        x.fillRect(lx - 4, H - 42, lw + 8, 12);
        x.fillStyle = '#8a2018'; x.fillRect(lx - 4, H - 42, 2, 12);
        drawText(x, s.line, { x: lx, y: H - 39, scale: 1, color: '#e0c8b8' });
      }

      /* ---- the keys, and what they do right now ---- */
      let hint;
      if (s.phase === 'bet') {
        /* No plus-or-minus sign: the font has not got one and it printed as
           a question mark. */
        /* Short enough to fit. At 320 pixels the footer holds about fifty
           characters, and the first version ran off both ends. */
        hint = 'UP DN 5   LEFT RIGHT 1   A ALL IN   E DEAL';
      }
      else if (s.phase === 'dealing' || s.phase === 'dealer') hint = '';
      else if (s.phase === 'player') {
        const bits = ['H  HIT', 'S  STAND'];
        if (BJ.canDouble(st)) bits.push('D  DOUBLE');
        if (BJ.canSplit(st) && coins >= st.hands[st.active].bet) bits.push('P  SPLIT');
        hint = bits.join('     ');
      } else hint = 'E  AGAIN      ESC  LEAVE';
      footer(x, W, H, hint);

      // the win flourish
      if (s.flash > 0 && s.won > 0) {
        /* In the gap between his cards and yours, which is the one band on
           the felt that never has anything in it. */
        const a2 = Math.min(0.26, s.flash * 0.26);
        x.fillStyle = `rgba(255,210,74,${a2.toFixed(3)})`;
        x.fillRect(0, 0, W, H);
        const bw = textWidth(`+${s.won}`, 3) + 20;
        const by2 = DEAL_CARDS + CH + 8;
        x.fillStyle = 'rgba(8,20,14,.86)';
        x.fillRect(Math.round(W / 2 - bw / 2), by2 - 3, bw, 27);
        x.fillStyle = GOLD;
        x.fillRect(Math.round(W / 2 - bw / 2), by2 - 3, bw, 1);
        x.fillRect(Math.round(W / 2 - bw / 2), by2 + 23, bw, 1);
        drawText(x, `+${s.won}`, {
          x: W / 2, y: by2, scale: 3, align: 'center',
          color: Math.floor(t * 10) % 2 ? '#fff3c4' : GOLD,
        });
      }
      return stakeRows;
    },
    tick(s, g, dt, t) {
      const BJ = g.bjRules;
      if (!BJ) return;
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 1.4);
      if (s.bump > 0) s.bump = Math.max(0, s.bump - dt * 6);

      if (s.phase === 'dealing') {
        // four cards, one at a time, with a sound each
        const want = Math.min(4, Math.floor((t - s.t0) / 0.26) + 1);
        while (s.dealt < want) { s.dealt++; g.audio?.sfx('page'); }
        if (s.dealt >= 4 && t - s.t0 > 1.2) {
          s.phase = s.st.phase === 'dealer' ? 'dealer' : 'player';
          if (s.st.hands[0] && BJ.score(s.st.hands[0].cards).blackjack) {
            s.line = 'TWENTY-ONE ON THE DEAL. THAT PAYS THREE TO TWO.';
          } else {
            s.line = BEEF_PROMPTS[(s.said++) % BEEF_PROMPTS.length];
          }
          s.t0 = t;
        }
        return;
      }
      if (s.phase === 'dealer') {
        /* His hole card turns over the moment it becomes his turn, on its own
           clock, so the flip reads as a deliberate reveal rather than the
           card silently changing. */
        if (s.at.d1 !== undefined && !s.holeShown) {
          s.holeShown = true;
          s.at.d1 = s.t;
          g.audio?.sfx('page');
          return;
        }
        // one card a beat, so you can watch him go over
        if (t - s.t0 < 0.5) return;
        s.t0 = t;
        const done = BJ.dealerStep(s.st);
        g.audio?.sfx('page');
        if (done) {
          s.phase = 'paid';
          const pays = BJ.payout(s.st);
          const stk = BJ.staked(s.st);
          s.won = pays;
          g.bjSettle?.(pays);
          if (pays > stk) {
            s.line = 'THE HOUSE PAYS. THE HOUSE ALWAYS PAYS WHEN IT MUST.';
            s.flash = 1;
            g.audio?.sfx(pays >= stk * 2.4 ? 'jackpot' : 'coin');
          } else if (pays === stk) {
            s.line = 'A PUSH. NOBODY LEARNS ANYTHING FROM A PUSH.';
            g.audio?.sfx('select');
          } else {
            s.line = BEEF_WINS[(s.said++) % BEEF_WINS.length];
            g.audio?.sfx('deny');
          }
        }
      }
    },
    click(row, i, s, g, st2) {
      if (row?.stakeUp) return this.key('ArrowUp', s, g, st2);
      if (row?.stakeDown) return this.key('ArrowDown', s, g, st2);
      return true;
    },
    key(code, s, g, st2) {
      const BJ = g.bjRules;
      if (!BJ) return true;
      const coins = g.coins || 0;

      if (code === 'Escape' || code === 'Backspace') {
        if (s.phase === 'player' || s.phase === 'dealing' || s.phase === 'dealer') {
          s.line = 'YOU DO NOT WALK AWAY MID-HAND.';
          g.audio?.sfx('deny');
          return true;
        }
        st2.pop(); g.afterOverlayClose(); return true;
      }

      if (s.phase === 'bet') {
        /* Add or take away, and never leave the stake somewhere the purse
           cannot follow. The ceiling is whichever is lower: the table limit
           or what you are carrying. */
        const setStake = (n) => {
          const top = Math.min(BJ_MAX, Math.max(BJ_MIN, coins));
          const v = Math.max(BJ_MIN, Math.min(top, n));
          if (v === s.stake) { g.audio?.sfx('deny'); return true; }
          s.stake = v;
          s.bump = 1;
          g.audio?.sfx('select');
          return true;
        };
        if (code === 'ArrowUp' || code === 'KeyW') return setStake(s.stake + 5);
        if (code === 'ArrowDown' || code === 'KeyS') return setStake(s.stake - 5);
        if (code === 'ArrowRight') return setStake(s.stake + 1);
        if (code === 'ArrowLeft') return setStake(s.stake - 1);
        if (code === 'KeyA') {
          s.line = 'ALL OF IT. HE LIKES YOU ALREADY.';
          return setStake(coins);
        }
        if (code === 'KeyM') return setStake(BJ_MIN);
        if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
          if (coins < s.stake) {
            s.line = 'NOT AT THAT STAKE. NOT WITH THAT PURSE.';
            g.audio?.sfx('deny'); return true;
          }
          if (!g.bjStake?.(s.stake)) { g.audio?.sfx('deny'); return true; }
          s.st = BJ.deal({ bet: s.stake, rand: Math.random, shoe: g.bjShoe || null });
          if (s.st.reshuffled) s.line = 'NEW SHOE. SIX DECKS. WATCH IF YOU LIKE.';
          g.bjShoe = s.st.shoe;
          s.phase = 'dealing';
          s.dealt = 0;
          s.t0 = s.t;
          g.audio?.sfx('lever');
          return true;
        }
        return true;
      }

      if (s.phase === 'paid') {
        if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
          SCREENS.mpBlackjack.init(s, g);
          s.line = 'AGAIN, THEN.';
          return true;
        }
        return true;
      }

      if (s.phase !== 'player') return true;

      if (code === 'KeyH' || code === 'ArrowRight') {
        BJ.hit(s.st); g.audio?.sfx('page');
        const h = s.st.hands[Math.min(s.st.active, s.st.hands.length - 1)];
        if (h && BJ.score(h.cards).bust) s.line = 'OVER. THAT IS THAT.';
        if (s.st.phase === 'dealer') { s.phase = 'dealer'; s.t0 = s.t; }
        return true;
      }
      if (code === 'KeyS' || code === 'ArrowLeft') {
        BJ.stand(s.st); g.audio?.sfx('select');
        if (s.st.phase === 'dealer') { s.phase = 'dealer'; s.t0 = s.t; }
        return true;
      }
      if (code === 'KeyD') {
        if (!BJ.canDouble(s.st)) { g.audio?.sfx('deny'); return true; }
        const extra = s.st.hands[s.st.active].bet;
        if (coins < extra) {
          s.line = 'YOU CANNOT COVER IT.'; g.audio?.sfx('deny'); return true;
        }
        g.bjStake?.(extra);
        BJ.double(s.st);
        s.line = 'DOUBLED. ONE CARD, AND NO MORE.';
        g.audio?.sfx('charge');
        if (s.st.phase === 'dealer') { s.phase = 'dealer'; s.t0 = s.t; }
        return true;
      }
      if (code === 'KeyP') {
        if (!BJ.canSplit(s.st)) { g.audio?.sfx('deny'); return true; }
        const extra = s.st.hands[s.st.active].bet;
        if (coins < extra) {
          s.line = 'A SPLIT COSTS THE SAME AGAIN.'; g.audio?.sfx('deny'); return true;
        }
        g.bjStake?.(extra);
        BJ.split(s.st);
        s.line = 'SPLIT. TWO HANDS, TWO STAKES.';
        g.audio?.sfx('confirm');
        if (s.st.phase === 'dealer') { s.phase = 'dealer'; s.t0 = s.t; }
        return true;
      }
      return true;
    },
  },

  /* ===========================================================
     TIM GRADY FLOPPER — the portrait, up close.
     =========================================================== */
  mpFlopper: {
    init(s) { s.scroll = s.scroll || 0; },
    draw(x, W, H, s, g, t) {
      x.fillStyle = '#160a06'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#160a06', '#241009', 0.5, 2);

      // the gilt frame
      const FW = 108, FH = 108;
      const fx = 18, fy = 30;
      x.fillStyle = '#c39a2c'; x.fillRect(fx - 6, fy - 6, FW + 12, FH + 12);
      x.fillStyle = '#8a6a1c'; x.fillRect(fx - 3, fy - 3, FW + 6, FH + 6);

      /* The man himself, painted here rather than sampled off the model —
         the same lumps, at a size you can actually look at. */
      x.fillStyle = '#d8d4cc'; x.fillRect(fx, fy, FW, FH);
      const cxp = fx + FW / 2, cyp = fy + FH / 2;
      x.fillStyle = '#b8b2a6';
      x.beginPath(); x.arc(cxp, cyp + 3, 46, 0, 6.29); x.fill();
      x.fillStyle = '#4a3320';
      x.beginPath(); x.arc(cxp, cyp + 3, 41, 0, 6.29); x.fill();
      const lump = (lx, ly, rx, ry, rot, base) => {
        x.save(); x.translate(cxp + lx, cyp + ly); x.rotate(rot);
        x.fillStyle = base;
        x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, 6.29); x.fill();
        x.fillStyle = 'rgba(150,116,74,.55)';
        x.beginPath(); x.ellipse(-rx * 0.22, -ry * 0.3, rx * 0.55, ry * 0.42, 0, 0, 6.29); x.fill();
        x.fillStyle = 'rgba(30,18,8,.45)';
        x.beginPath(); x.ellipse(rx * 0.3, ry * 0.35, rx * 0.42, ry * 0.3, 0, 0, 6.29); x.fill();
        x.restore();
      };
      lump(-13, -13, 25, 12, -0.5, '#5b3f24');
      lump(14, -6, 24, 12, 0.7, '#6a4a2b');
      lump(-3, 11, 29, 14, 0.15, '#553a21');
      lump(10, -22, 19, 10, -0.2, '#63452a');
      lump(-20, 11, 19, 10, 0.9, '#4d351d');
      lump(2, -2, 20, 10, -1.1, '#6f4d2e');
      x.fillStyle = 'rgba(220,190,140,.20)';
      x.beginPath(); x.ellipse(cxp - 20, cyp + 25, 15, 5, -0.3, 0, 6.29); x.fill();
      // a picture light that never quite settles
      const glare = 0.06 + Math.abs(Math.sin(t * 1.6)) * 0.05;
      x.fillStyle = `rgba(255,220,150,${glare.toFixed(3)})`;
      x.fillRect(fx, fy, FW, 34);

      // the plaque
      x.fillStyle = '#4a3410'; x.fillRect(fx - 6, fy + FH + 10, FW + 12, 16);
      x.fillStyle = '#c39a2c'; x.fillRect(fx - 6, fy + FH + 10, FW + 12, 1);
      drawText(x, 'T. GRADY FLOPPER', {
        x: fx + FW / 2, y: fy + FH + 15, scale: 1, align: 'center', color: '#ffd88a',
      });

      /* the copy, to the right */
      const TX = fx + FW + 22, TW = W - TX - 16;
      drawText(x, 'THE PROPRIETOR', { x: TX, y: 22, scale: 2, color: '#ffd24a' });
      x.fillStyle = '#8a6a1c'; x.fillRect(TX, 38, TW, 1);

      const body = [
        'TIM GRADY FLOPPER CAME ASHORE WITH A CRATE OF '
        + 'FRUIT MACHINES AND NO EXPLANATION FOR EITHER.',
        'HE HAS NEVER BEEN SEEN ON THIS DECK. THE PORTRAIT '
        + 'IS CONSIDERED SUFFICIENT.',
        'HOUSE RULES: THREE SYNCOIN A PULL. THE HOUSE PAYS '
        + 'IN COIN. THE HOUSE DOES NOT PAY IN ADVICE.',
      ];
      let y = 46;
      for (const para of body) {
        for (const line of wrapText(para, TW, 1)) {
          drawText(x, line, { x: TX, y, scale: 1, color: '#c9b98a' });
          y += 9;
        }
        y += 5;
      }
      x.fillStyle = '#8a6a1c'; x.fillRect(TX, y, TW, 1); y += 6;
      drawText(x, 'NO CREDIT.  NO REFUNDS.', { x: TX, y, scale: 1, color: '#e0453a' });
      y += 11;
      drawText(x, 'SHE WORKS NIGHTS ONLY.', { x: TX, y, scale: 1, color: '#63c6a8' });

      footer(x, W, H, 'ESC  STEP BACK');
      return [];
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace' || code === 'KeyE') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
  },

  /* ---------------- THE SNAP VOTE ---------------- */
  mpSnap: {
    init(s) { s.sel = 0; },
    draw(x, W, H, s, g, t) {
      const snap = g.mp.snap;
      if (!snap) return [];
      const left = Math.max(0, snap.endsAt - performance.now() / 1000);
      const who = g.mp.view.players.get(snap.victimId);
      const by = g.mp.view.players.get(snap.byId);

      /* Deliberately not the council. This is a handful of people standing
         over somebody in the sand, deciding on the spot. */
      x.fillStyle = '#140803'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#140803', '#20100a', 0.5, 2);
      // the flare still burning
      const flick = 0.7 + Math.sin(t * 17) * 0.3;
      for (let i = 7; i >= 0; i--) {
        x.fillStyle = `rgba(255,150,60,${(0.035 * flick).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H * 0.62, 22 + i * 15, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      drawText(x, 'A FLARE WENT UP', { x: W / 2, y: 14, scale: 2, align: 'center', color: '#ffb060' });
      drawText(x, `${(by?.name || '?').toUpperCase()} PUT ${(who?.name || '?').toUpperCase()} ON THE SAND`, {
        x: W / 2, y: 32, scale: 1, align: 'center', color: GOLD_LT,
      });
      drawText(x, `${snap.voters.length} OF YOU SAW IT. ${snap.need} DECIDE.`, {
        x: W / 2, y: 44, scale: 1, align: 'center', color: DIM,
      });

      // the clock
      const bw = W - 80, bx = 40;
      x.fillStyle = INK; x.fillRect(bx - 1, 55, bw + 2, 5);
      x.fillStyle = '#20100c'; x.fillRect(bx, 56, bw, 3);
      const n = Math.round((left / 12) * bw);
      for (let i = 0; i < n; i += 3) {
        x.fillStyle = left < 4 ? (Math.floor(t * 6) % 2 ? '#ff6a5a' : '#8a2018') : '#ffb060';
        x.fillRect(bx + i, 56, 2, 3);
      }

      // the person on the floor, with their stars
      const cx = W / 2, cy = H * 0.62;
      x.fillStyle = '#0b0f14';
      x.fillRect(cx - 16, cy, 32, 7);
      x.fillRect(cx + 15, cy - 5, 8, 8);
      for (let i = 0; i < 5; i++) {
        const a = t * 3 + (i / 5) * Math.PI * 2;
        const sx = Math.round(cx + 19 + Math.cos(a) * 11);
        const sy = Math.round(cy - 12 + Math.sin(a) * 4);
        x.fillStyle = i % 2 ? '#ffd24a' : '#ffffff';
        x.fillRect(sx - 2, sy, 5, 1);
        x.fillRect(sx, sy - 2, 1, 5);
      }

      const rows = [];
      const btn = (label, colour, ox, mine) => {
        const w = 76, bxx = ox - w / 2, byy = H - 48;
        x.fillStyle = mine ? colour : '#1a1208';
        x.fillRect(bxx, byy, w, 18);
        x.fillStyle = colour;
        x.fillRect(bxx, byy, w, 1); x.fillRect(bxx, byy + 17, w, 1);
        x.fillRect(bxx, byy, 1, 18); x.fillRect(bxx + w - 1, byy, 1, 18);
        drawText(x, label, { x: ox, y: byy + 6, scale: 1, align: 'center',
          color: mine ? '#160c04' : colour });
        rows.push({ x: bxx, y: byy, w, h: 18 });
      };
      if (snap.mine === null) {
        btn('Y  THROW OUT', RED, W / 2 - 41, false);
        btn('N  LET THEM UP', JADE, W / 2 + 41, false);
      } else {
        btn('THREW THEM OUT', RED, W / 2 - 41, snap.mine === true);
        btn('LET THEM UP', JADE, W / 2 + 41, snap.mine === false);
      }

      drawText(x, `${snap.yes} OUT   -   ${snap.no} STAY`, {
        x: W / 2, y: H - 27, scale: 1, align: 'center', color: GOLD_LT,
      });
      footer(x, W, H, snap.mine === null ? 'Y OR N' : 'WAITING ON THE REST');
      return rows;
    },
    key(code, s, g) {
      const snap = g.mp.snap;
      if (!snap || snap.mine !== null) return true;
      if (code === 'KeyY') { g.sendSnap(true); return true; }
      if (code === 'KeyN') { g.sendSnap(false); return true; }
      return true;
    },
    click(row, i, s, g) {
      const snap = g.mp.snap;
      if (!snap || snap.mine !== null) return true;
      g.sendSnap(i === 0);
      return true;
    },
  },

  /* ---------------- FERDI'S, AND THE ROOM BEHIND IT ---------------- */
  mpShop: {
    init(s) {
      /* Defaults, not resets. init() runs after the pushed data has been
         merged in, so assigning unconditionally threw away whatever the
         caller asked for — pushing this screen straight to the back room
         landed you on the front counter every time. */
      s.sel = s.sel || 0;
      s.side = s.side || 0;
      s.flash = 0;
      s.wipe = 0;             // the shutter, 1 down to 0 up
      s.wipeTo = null;
    },
    /** The shutter comes down, the side changes behind it, and it goes up. */
    tick(s, g, dt) {
      if (!s.wipe) return;
      s.wipe = Math.max(0, s.wipe - dt * 1.5);
      if (s.wipeTo !== null && s.wipe <= 0.5) {
        s.side = s.wipeTo;
        s.wipeTo = null;
        s.sel = 0;
        g.audio?.sfx('door');
      }
    },
    draw(x, W, H, s, g, t) {
      const agent = g.amAgent;
      const black = agent && s.side === 1 && !s.vendor;
      /* One of Ferdi's machines in the trees is not Ferdi's shop. It holds
         whatever did not sell, it has no back room, and once it has taken
         your coin it is empty for the rest of the round. */
      const isNight = (g.night || 0) > 0.5;
      const list = s.vendor
        ? STOCK.filter((i) => VENDOR_IDS.includes(i.id) && (!i.night || isNight))
        : shelf(black ? 'black' : 'open', isNight);
      if (s.sel >= list.length) s.sel = 0;
      const d = list[s.sel];
      if (s.flash > 0) s.flash -= 0.016;

      /* Two rooms, and they do not look alike. The front is lamplight on
         old timber; the back is a shuttered lock-up lit by one bulb. */
      if (black) {
        /* ---- THE BACK ROOM ----
           A shuttered lock-up behind the shop: one bulb on a flex that has
           never stopped swinging, a roller shutter half down, hazard paint
           on the threshold and a stencil on the wall telling you what did
           not happen here. It should feel like somewhere you are not
           supposed to be standing. */
        x.fillStyle = '#080506'; x.fillRect(0, 0, W, H);
        ditherRect(x, 0, 0, W, H, '#080506', '#160b0d', 0.5, 2);

        // breeze-block courses on the back wall
        for (let ry = 0; ry < H; ry += 11) {
          const off = ((ry / 11) | 0) % 2 ? 13 : 0;
          x.fillStyle = 'rgba(180,120,110,.035)';
          x.fillRect(0, ry, W, 10);
          x.fillStyle = 'rgba(0,0,0,.30)';
          x.fillRect(0, ry + 10, W, 1);
          for (let rx = off; rx < W; rx += 26) x.fillRect(rx, ry, 1, 10);
        }

        /* The roller shutter, most of the way down, stopped just above
           where the header sits. Chrome never goes where type goes. */
        const drop = 8;
        for (let sy = 0; sy < drop; sy += 3) {
          x.fillStyle = sy % 6 ? 'rgba(46,34,32,.95)' : 'rgba(70,52,48,.95)';
          x.fillRect(0, sy, W, 3);
        }
        x.fillStyle = '#1a1210'; x.fillRect(0, drop, W, 1);
        for (let hx = 0; hx < W; hx += 10) {
          x.fillStyle = (hx / 10) % 2 ? 'rgba(200,160,42,.75)' : 'rgba(42,26,16,.9)';
          x.fillRect(hx, drop + 1, 10, 2);
        }

        // the bulb hangs down the side of the room, out of the type
        const swing = Math.sin(t * 1.4) * 4;
        const bulbX = 26, bulbY = 62;
        for (let i = 9; i >= 0; i--) {
          x.fillStyle = `rgba(170,50,36,${(0.026 + i * 0.001).toFixed(3)})`;
          x.beginPath(); x.arc(bulbX + swing, bulbY, 20 + i * 15, 0, Math.PI * 2); x.fill();
        }
        x.fillStyle = '#2a1c12';
        x.fillRect(Math.round(bulbX + swing / 2), drop + 3, 1, bulbY - drop - 7);
        x.fillStyle = '#4a3420';
        x.fillRect(Math.round(bulbX + swing) - 3, bulbY - 4, 7, 3);
        const glow = 0.75 + Math.sin(t * 11) * 0.12 + (Math.sin(t * 47) > 0.94 ? -0.4 : 0);
        x.fillStyle = `rgba(255,216,138,${glow.toFixed(2)})`;
        x.fillRect(Math.round(bulbX + swing) - 2, bulbY - 1, 5, 5);

        // a chain hanging in one corner, because the room needs weight
        for (let cy2 = drop + 6; cy2 < H - 46; cy2 += 5) {
          x.fillStyle = 'rgba(120,110,104,.45)';
          x.fillRect(W - 16 + (((cy2 / 5) | 0) % 2), cy2, 3, 4);
        }

        // and the light dies at the edges
        for (let i = 0; i < 22; i++) {
          const a = (0.055 * (1 - i / 22)).toFixed(3);
          x.fillStyle = `rgba(0,0,0,${a})`;
          x.fillRect(i, 0, 1, H); x.fillRect(W - 1 - i, 0, 1, H);
          x.fillRect(0, H - 1 - i, W, 1);
        }
      } else {
        x.fillStyle = '#120c06'; x.fillRect(0, 0, W, H);
        ditherRect(x, 0, 0, W, H, '#120c06', '#1c1208', 0.5, 2);
        // planking behind the counter
        for (let i = 0; i < H; i += 7) {
          x.fillStyle = 'rgba(90,64,28,.10)'; x.fillRect(0, i, W, 1);
        }
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* The man himself, leaning on the end of his own counter. A shop with
         nobody in it is a menu; a shop with a shopkeeper watching you pick
         things up is a shop. */
      if (!s.vendor) drawFerdi(x, W - 34, H - 74, black, t);

      const accent = black ? RED : GOLD;
      x.fillStyle = accent;
      x.fillRect(6, 6, W - 12, 1); x.fillRect(6, H - 7, W - 12, 1);
      x.fillRect(6, 6, 1, H - 13); x.fillRect(W - 7, 6, 1, H - 13);

      drawText(x, s.vendor ? "FERDI'S MACHINE" : (black ? 'THE BACK ROOM' : "FERDI STEINMAN'S"), {
        x: 14, y: 11, scale: 2, color: accent,
      });
      if (black) {
        // painted on the block work, well below the list
        drawText(x, 'NOTHING WAS SOLD HERE', {
          x: 14, y: H - 66, scale: 1, color: 'rgba(160,66,54,.55)', shadow: false,
        });
        drawText(x, 'NO NAMES.  NO NOTES.', {
          x: 14, y: H - 56, scale: 1, color: 'rgba(160,66,54,.40)', shadow: false,
        });
        drawText(x, 'HE IS NOT HERE.', {
          x: 14, y: H - 42, scale: 1, color: 'rgba(200,120,110,.55)', shadow: false,
        });
      }
      if (s.vendor) {
        drawText(x, 'WHATEVER DID NOT SELL', { x: 14, y: 26, scale: 1, color: '#8a7a52' });
      }
      drawText(x, `${g.coins || 0} SYNCOIN`, {
        x: W - 14, y: 10, scale: 1, align: 'right', color: GOLD_LT,
      });
      if (agent && !s.vendor) {
        drawText(x, black ? 'TAB  BACK TO THE SHOP' : 'TAB  THE OTHER LIST', {
          x: W - 14, y: 21, scale: 1, align: 'right', color: black ? '#c08078' : '#8a5a52',
        });
      }
      x.fillStyle = black ? '#5a1a14' : '#5c3f1c';
      x.fillRect(14, 28, W - 28, 1);

      /* the stock list */
      const LX = 10, LW = 138, ROW = 15;
      let y = 36;
      const rows = [];
      /* The highlight slides between rows on a spring and the icon on the
         chosen line lifts a pixel, so running down a shelf has some weight
         to it. Drawn before the rows, so the type is never under it. */
      const cur = listCursor(`shop:${black ? 'b' : 'o'}`, s.sel, list.length);
      {
        const hy = Math.round(36 + cur.at * ROW) - 1;
        x.fillStyle = cur.hit > 0.5 ? (black ? '#7a2016' : '#7a5420') : (black ? '#3a0e0b' : '#3a2a10');
        x.fillRect(LX, hy, LW, ROW - 1);
        x.fillStyle = cur.hit > 0.5 ? '#fff3c4' : accent;
        x.fillRect(LX, hy, 2, ROW - 1);
        const sw = (t % 2.4) / 0.36;
        if (sw < 1) {
          const bx2 = Math.round(LX + sw * (LW + 16)) - 8;
          for (let i = 0; i < 8; i++) {
            x.fillStyle = `rgba(255,230,150,${(0.11 * (1 - Math.abs(i - 3.5) / 4)).toFixed(3)})`;
            x.fillRect(bx2 + i, hy + 1, 1, ROW - 3);
          }
        }
      }
      list.forEach((it, i) => {
        const on = i === s.sel;
        /* Only permanent things read as HELD. A consumable you are carrying
           can be bought again, and showing HELD next to a button that says
           BUY FOR 13 just made the list look broken. */
        const held = it.tag === 'PASSIVE' && g.hasItem?.(it.id);
        const carrying = it.tag !== 'PASSIVE' && g.hasItem?.(it.id);
        const owned = held;
        const afford = (g.coins || 0) >= (g.priceOf ? g.priceOf(it.id) : it.cost);
        drawShopIcon(x, it.icon, LX + 5, y - (on ? 1 : 0), 12, on, t);
        /* Trim against the width of the label that is actually going to sit
           on the right. "HELD" is wider than a two-digit price, and the
           names used to run straight into it. */
        /* A dot means "you have one already"; a count only appears when it
           is worth knowing. "x1 13" next to every line was noise. */
        const n = (g.carry || []).filter((q) => q === it.id).length;
        const price = g.priceOf ? g.priceOf(it.id) : it.cost;
        const onSale = price < it.cost;
        const right = held ? 'HELD'
          : (n > 1 ? `x${n}  ${price}` : (n === 1 ? `. ${price}` : String(price)));
        const room = LW - 26 - textWidth(right, 1) - 6;
        let nm = it.name;
        while (nm.length > 3 && textWidth(nm, 1) > room) nm = nm.slice(0, -1);
        if (nm !== it.name) nm = nm.slice(0, -1) + '.';
        drawText(x, nm, {
          x: LX + 21, y: y + 1, scale: 1,
          color: owned ? '#5f7a4a' : (on ? GOLD_LT : (afford ? '#c9b98a' : '#7a6a52')),
        });
        /* A marked-down line gets its own tag and a struck-through original,
           so a sale is something you SEE rather than something you have to
           remember the old price to notice. */
        if (onSale && !held) {
          const oldW = textWidth(String(it.cost), 1);
          const px2 = LX + LW - 6 - textWidth(right, 1) - oldW - 4;
          drawText(x, String(it.cost), { x: px2, y: y + 1, scale: 1, color: '#7a5a44' });
          x.fillStyle = '#c02a1a';
          x.fillRect(px2 - 1, y + 4, oldW + 2, 1);
        }
        drawText(x, right, {
          x: LX + LW - 4, y: y + 1, scale: 1, align: 'right',
          color: held ? JADE
            : (onSale ? (Math.floor(t * 5) % 2 ? '#fff3c4' : '#8fe8a0')
              : (carrying ? '#8fd8b8' : (afford ? GOLD : '#8a4a44'))),
        });
        /* A pink pip on the line the reader will take, so you can see there
           is a plan on without opening every item. */
        if (g.schlarnaOn?.(it.id)) {
          x.fillStyle = Math.floor(t * 3) % 2 ? '#f4a6bd' : '#c46f8c';
          x.fillRect(LX + LW - 2, y + 1, 2, 5);
        }
        rows.push({ x: LX, y: y - 1, w: LW, h: ROW - 1, pick: i });
        y += ROW;
      });

      /* what it is, and what it does */
      const RX = LX + LW + 8;
      // a strip on the right for the shopkeeper, so he is not half off the edge
      const MAN = s.vendor ? 0 : 34;
      const RW = W - RX - 12 - MAN;
      const RB = H - 30;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(RX, 36, RW, RB - 36);
      x.fillStyle = black ? '#5a1a14' : '#5c3f1c';
      x.fillRect(RX, 36, RW, 1); x.fillRect(RX, RB - 1, RW, 1);
      x.fillRect(RX, 36, 1, RB - 36); x.fillRect(RX + RW - 1, 36, 1, RB - 36);

      /* Is today's afterpay line the one you are looking at? Ferdi's reader
         only handles one item a day and one plan at a time. */
      const sch = !!(d && g.schlarnaOn?.(d.id));

      if (d) {
        /* The thing itself, stood on the counter with a light on it and a
           price tag tied round it — not an icon floating in a box. */
        const ICX = RX + RW / 2;
        // the pool of lamplight it stands in
        for (let i = 6; i >= 0; i--) {
          x.fillStyle = black ? `rgba(180,60,44,.03)` : `rgba(255,200,110,.035)`;
          x.beginPath(); x.arc(ICX, 58, 12 + i * 6, 0, 6.283); x.fill();
        }
        drawShopIcon(x, d.icon, ICX - 16, 40, 32, true, t);
        // the counter it stands on
        x.fillStyle = black ? '#2a1a16' : '#4a3418';
        x.fillRect(RX + 8, 73, RW - 16, 3);
        x.fillStyle = 'rgba(0,0,0,.45)';
        x.fillRect(ICX - 15, 71, 30, 2);

        // a tag, hand-lettered, tilted
        {
          const dPrice = g.priceOf ? g.priceOf(d.id) : d.cost;
          const dSale = dPrice < d.cost;
          const tagW = textWidth(String(dPrice), 1) + 16;
          const tx0 = ICX + 18, ty0 = 52;
          x.fillStyle = '#3a2a12'; x.fillRect(tx0 - 1, ty0 - 1, tagW + 2, 13);
          x.fillStyle = dSale ? '#f0e0a8' : '#d8c69a'; x.fillRect(tx0, ty0, tagW, 11);
          x.fillStyle = '#3a2a12'; x.fillRect(tx0 + 2, ty0 + 4, 3, 3);
          drawText(x, String(dPrice), {
            x: tx0 + 8, y: ty0 + 2, scale: 1, color: dSale ? '#8a1a10' : '#2a1c08', shadow: false,
          });
          if (dSale) {
            /* A paper flash pinned across the corner of the panel, wobbling
               on its pin. You should be able to see there is a sale on from
               the moment the shop opens. */
            const cut = g.mp?.sale?.cut || 0;
            const txt = `${cut}% OFF`;
            const tw = textWidth(txt, 1) + 14;
            x.save();
            x.translate(RX + RW - 4, 40);
            x.rotate(-0.38 + Math.sin(t * 2.1) * 0.03);
            x.fillStyle = '#8a1a10'; x.fillRect(-tw, -1, tw, 13);
            x.fillStyle = Math.floor(t * 4) % 2 ? '#ffd24a' : '#c39a2c';
            x.fillRect(-tw, -1, tw, 1); x.fillRect(-tw, 11, tw, 1);
            drawText(x, txt, {
              x: -tw / 2, y: 2, scale: 1, align: 'center', color: '#fff3c4', shadow: false,
            });
            x.restore();
            // the pin
            x.fillStyle = '#e8eef2';
            x.fillRect(RX + RW - 7, 38, 3, 3);
          }
        }

        let by = 80;
        for (const ln of wrapText(d.name, RW - 10, 1, 1)) {
          drawText(x, ln, { x: ICX, y: by, scale: 1, align: 'center', color: GOLD_LT });
          by += 9;
        }
        // tag line, plus a badge if it is only out after dark
        drawText(x, d.tag, {
          x: ICX, y: by, scale: 1, align: 'center',
          color: black ? '#c08078' : '#8a7a52',
        });
        by += 11;
        if (d.night) {
          const nw = textWidth('AFTER DARK ONLY', 1) + 12;
          x.fillStyle = 'rgba(30,44,78,.85)';
          x.fillRect(ICX - nw / 2, by - 2, nw, 11);
          x.fillStyle = '#6fa8e0'; x.fillRect(ICX - nw / 2, by - 2, nw, 1);
          // a little moon
          x.fillStyle = '#cfe4ff';
          x.fillRect(ICX - nw / 2 + 3, by + 1, 4, 4);
          x.fillStyle = 'rgba(30,44,78,.95)';
          x.fillRect(ICX - nw / 2 + 5, by, 4, 4);
          drawText(x, 'AFTER DARK ONLY', {
            x: ICX + 5, y: by, scale: 1, align: 'center', color: '#9fc8ff',
          });
          by += 13;
        }
        x.fillStyle = black ? '#5a1a14' : '#5c3f1c';
        x.fillRect(RX + 8, by - 3, RW - 16, 1);
        by += 3;
        for (const ln of wrapText(d.blurb.toUpperCase(), RW - 12, 1, 1)) {
          /* With a Schlarna offer there are two buttons and a line of
             explanation under this panel, not one button. At 42 the last
             line of the blurb printed straight through "PAY 3 NOW". */
          if (by > RB - (sch ? 54 : 26)) break;
          drawText(x, ln, { x: RX + 6, y: by, scale: 1, color: '#c9b98a' });
          by += 9;
        }
      }

      // the counter itself: price and the buy key
      const owned = d && g.hasItem?.(d.id);
      const dPrice2 = d ? (g.priceOf ? g.priceOf(d.id) : d.cost) : 0;
      const afford = d && (g.coins || 0) >= dPrice2;
      const label = owned && d.tag === 'PASSIVE' ? 'ALREADY YOURS'
        : (afford ? `E   BUY FOR ${dPrice2}` : 'NOT ENOUGH SYNCOIN');
      const bw = RW - 12, bx = RX + 6, byy = RB - (sch ? 32 : 16);
      pressButton(x, bx, byy, bw, label, {
        hit: s.flash / 0.3, enabled: afford && !owned, accent,
        fill: black ? '#3a0e0b' : '#3a2a10',
      });
      rows.push({ x: bx, y: byy, w: bw, h: 12, buy: true });

      /* ---- SCHLARNA ----
         A card reader appeared in Ferdi's stock one morning with nobody's
         name on the box. It handles one line a day. The badge is pink
         because whoever made it wanted it to look like something you have
         seen before. */
      if (sch) {
        const each = g.schlarnaEach(d.id);
        const total = g.schlarnaTotal(d.id);
        const sy = RB - 16;
        const PINK = '#f4a6bd', PINK_D = '#c46f8c';
        const lit = (g.coins || 0) >= each;

        x.fillStyle = lit ? PINK : '#6a4a56';
        x.fillRect(bx, sy, bw, 12);
        // the soft corners of the badge, faked by knocking the pixels out
        x.fillStyle = black ? '#080506' : '#120c06';
        x.fillRect(bx, sy, 1, 1); x.fillRect(bx + bw - 1, sy, 1, 1);
        x.fillRect(bx, sy + 11, 1, 1); x.fillRect(bx + bw - 1, sy + 11, 1, 1);
        x.fillStyle = lit ? '#ffd4e2' : '#8a6a76';
        x.fillRect(bx + 1, sy, bw - 2, 1);
        x.fillStyle = PINK_D;
        x.fillRect(bx + 1, sy + 11, bw - 2, 1);

        // the wordmark, and the offer beside it
        drawText(x, 'SCHLARNA', {
          x: bx + 4, y: sy + 3, scale: 1, color: '#2a0a16', shadow: false,
        });
        const off = `${SCHLARNA_N}x${each}`;
        drawText(x, off, {
          x: bx + bw - 4, y: sy + 3, scale: 1, align: 'right',
          color: lit ? '#4a1226' : '#3a2a30', shadow: false,
        });
        rows.push({ x: bx, y: sy, w: bw, h: 12, plan: true });

        // and what it actually means, in words, above the buy button
        drawText(x, 'K  WHAT IS SCHLARNA?', {
          x: RX + RW / 2, y: byy - 11, scale: 1, align: 'center',
          color: Math.floor(t * 2) % 2 ? PINK : '#c46f8c',
        });
      }

      /* If you are already on a plan, you are told, wherever you are in the
         shop. Money vanishing out of your purse with no explanation is not
         an installment, it is a bug. */
      if (g.plan) {
        const pl = g.plan;
        const txt = `SCHLARNA: ${pl.owed} STILL OWED ON ${pl.name}`;
        const tw = textWidth(txt, 1);
        x.fillStyle = 'rgba(60,14,32,.9)';
        x.fillRect(LX, H - 28, Math.min(W - LX * 2, tw + 8), 11);
        x.fillStyle = '#f4a6bd'; x.fillRect(LX, H - 28, 2, 11);
        drawText(x, txt, { x: LX + 5, y: H - 25, scale: 1, color: '#f4a6bd' });
      }

      /* ---- the shutter ----
         Going through to the back room used to be an instant swap, which
         read as a bug. Now a roller shutter comes down over the counter, the
         room changes behind it, and it goes back up. */
      if (s.wipe > 0) {
        /* How much of the counter you can still see. It is 1 at either end of
           the wipe and 0 in the middle, where the shutter is fully down.

           The first version worked out "closing" and then used (1 - wipe),
           which is zero on the very first frame — so the shutter appeared
           already shut, then opened, then shut again. That was the glitch. */
        const open = Math.abs(s.wipe - 0.5) * 2;
        const hgt = Math.round(H * (1 - open));
        // the slats
        for (let sy = 0; sy < hgt; sy += 4) {
          x.fillStyle = (sy / 4) % 2 ? 'rgba(46,34,32,.97)' : 'rgba(72,54,50,.97)';
          x.fillRect(0, sy, W, 4);
        }
        // the lip, with hazard paint on it
        if (hgt > 0) {
          x.fillStyle = '#1a1210'; x.fillRect(0, hgt, W, 2);
          for (let hx = 0; hx < W; hx += 10) {
            x.fillStyle = (hx / 10) % 2 ? '#c8a02a' : '#2a1a10';
            x.fillRect(hx, hgt + 2, 10, 3);
          }
          // a hairline of light under it
          x.fillStyle = 'rgba(255,214,140,.16)';
          x.fillRect(0, hgt + 5, W, 2);
        }
        // and what it says on the way
        if (hgt > 40) {
          drawText(x, s.side === 0 ? 'THROUGH THE BACK' : 'BACK TO THE COUNTER', {
            x: W / 2, y: Math.min(hgt - 20, H / 2), scale: 2, align: 'center',
            color: s.side === 0 ? '#c08078' : GOLD,
          });
        }
      }

      footer(x, W, H, sch ? 'UP DOWN CHOOSE   E BUY   K SCHLARNA   ESC LEAVE'
        : 'UP DOWN CHOOSE   E BUY   ESC LEAVE');
      return rows;
    },
    key(code, s, g, st) {
      const agent = g.amAgent;
      const black = agent && s.side === 1 && !s.vendor;
      const isNight = (g.night || 0) > 0.5;
      const list = s.vendor
        ? STOCK.filter((i) => VENDOR_IDS.includes(i.id) && (!i.night || isNight))
        : shelf(black ? 'black' : 'open', isNight);
      if (code === 'ArrowUp' || code === 'KeyW') {
        if (s.sel === 0) menuSnap();
        s.sel = (s.sel + list.length - 1) % list.length; g.audio?.sfx('select'); return true;
      }
      if (code === 'ArrowDown' || code === 'KeyS') {
        if (s.sel === list.length - 1) menuSnap();
        s.sel = (s.sel + 1) % list.length; g.audio?.sfx('select'); return true;
      }
      if (code === 'Tab' && agent && !s.vendor) {
        if (!s.wipe) {
          s.wipe = 1;
          s.wipeTo = 1 - s.side;
          g.audio?.sfx('slam');
          g.audio?.sfx('rumble');
        }
        return true;
      }
      // nothing else works while the shutter is moving
      if (s.wipe > 0) return true;
      if (code === 'Escape' || code === 'Backspace') { st.pop(); g.afterOverlayClose(); return true; }
      if (code === 'KeyK') {
        /* The badge is an advertisement, not a purchase. Pressing it opens
           the card, which is where the four payments are actually explained
           — "4x3" beside a button was arithmetic, not an offer. */
        const it = list[s.sel];
        if (it && g.schlarnaOn?.(it.id)) {
          st.push('mpSchlarna', { id: it.id });
          g.audio?.sfx('page');
        } else g.audio?.sfx('deny');
        return true;
      }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        menuFlash();
        if (list[s.sel] && g.buyItem(list[s.sel].id)) {
          s.flash = 0.3;
          /* A machine in the trees holds one thing. Once it has taken your
             coin it is a box, and whoever comes next gets nothing — which
             is what makes finding one first worth something. */
          if (s.vendor && typeof s.vendor === 'object') {
            s.vendor.spent = true;
            st.pop();
            g.afterOverlayClose();
            g.ui?.toast('THE MACHINE IS EMPTY NOW', 'gold', 2400);
          }
        }
        return true;
      }
      return true;
    },
    click(row, i, s, g, st) {
      if (row?.plan) { this.key('KeyK', s, g, st); return true; }
      if (row?.buy) { this.key('Enter', s, g, st); return true; }
      if (row?.pick !== undefined) {
        if (row.pick === s.sel) this.key('Enter', s, g, st);
        else { s.sel = row.pick; g.audio?.sfx('select'); }
      }
      return true;
    },
  },

  /* ---------------- CATHY'S STALL ---------------- */
  /* She is on the far side of the island with a counter, a parasol and a
     board she painted herself. Ferdi does not stock food and has never been
     asked why. */
  mpCathy: {
    init(s) {
      if (s.sel === undefined) s.sel = 0;
      s.flash = 0;
      s.line = CATHY_LINES[0];
      s.said = 0;
      s.lineAt = 0;
    },
    tick(s, g, dt, t) {
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3);
      // she keeps talking, whether or not you buy anything
      if (t - s.lineAt > 7) {
        s.lineAt = t;
        s.line = CATHY_LINES[(++s.said) % CATHY_LINES.length];
      }
    },
    draw(x, W, H, s, g, t) {
      const list = g.foodList ? g.foodList() : FOOD;
      if (s.sel >= list.length) s.sel = 0;
      const d = list[s.sel];

      /* ---- her pitch: sand, sea behind it, and the parasol overhead ---- */
      x.fillStyle = '#1a1408'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#1a1408', '#241a0c', 0.5, 2);
      // the water on the horizon, because she is on the shore side
      x.fillStyle = '#123040'; x.fillRect(0, 30, W, 16);
      for (let i = 0; i < 5; i++) {
        const wy = 32 + i * 3;
        x.fillStyle = `rgba(140,200,220,${(0.05 + i * 0.012).toFixed(3)})`;
        x.fillRect((Math.sin(t * 0.6 + i) * 20 + W / 2 - 40) | 0, wy, 80, 1);
      }
      x.fillStyle = '#3a2c14'; x.fillRect(0, 46, W, H - 46);
      ditherRect(x, 0, 46, W, H - 46, '#3a2c14', '#4a3a1c', 0.5, 2);
      // the striped sailcloth over the top of everything
      for (let i = 0; i * 14 < W; i++) {
        x.fillStyle = i % 2 ? '#a83c34' : '#e0d4b0';
        x.fillRect(i * 14, 0, 14, 9);
      }
      x.fillStyle = '#6a2c24'; x.fillRect(0, 9, W, 2);
      // its scalloped edge
      for (let i = 0; i * 8 < W; i++) {
        x.fillStyle = (i % 2) ? '#a83c34' : '#c8bc98';
        x.fillRect(i * 8, 11, 8, 2);
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.30)'; x.fillRect(0, y, W, 1); }

      // her, behind the counter, on the right where nothing else goes
      drawCathy(x, W - 58, 42, t);
      // the counter she is stood behind, in front of her
      x.fillStyle = '#5a4020'; x.fillRect(W - 72, 110, 68, 5);
      x.fillStyle = '#7a5a2c'; x.fillRect(W - 72, 110, 68, 1);
      x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(W - 72, 115, 68, 4);

      /* ---- her board ----
         Her name at double height needs its own band. The first version put
         the strap line nine pixels under a fourteen-pixel word, and the two
         printed straight through each other. */
      x.fillStyle = '#e0d4b0'; x.fillRect(8, 16, 130, 30);
      x.fillStyle = '#8a6a3c'; x.fillRect(8, 16, 130, 1);
      x.fillStyle = '#6a4a24'; x.fillRect(8, 45, 130, 1);
      drawText(x, 'CATHY', { x: 13, y: 19, scale: 2, color: '#a83c34', shadow: false });
      x.fillStyle = '#c8b890'; x.fillRect(12, 34, 122, 1);
      drawText(x, 'HOT FOOD ALL HOURS', { x: 13, y: 37, scale: 1, color: '#3a2c14', shadow: false });
      drawText(x, `${g.coins || 0} SYNCOIN`, {
        x: W - 8, y: 16, scale: 1, align: 'right', color: GOLD_LT,
      });

      /* ---- the list, on the left ---- */
      /* Wide enough for the longest thing she sells. At 118 the names came
         out as "BAG OF PICKL." and "CATHY'S OWN .", which tells you nothing
         about either. */
      const LX = 8, LW = 172, ROW = 15;
      let y = 52;
      const rows = [];
      const cur = listCursor('cathy', s.sel, list.length);
      {
        const hy = Math.round(52 + cur.at * ROW) - 1;
        x.fillStyle = cur.hit > 0.5 ? '#7a5420' : '#3a2a10';
        x.fillRect(LX, hy, LW, ROW - 1);
        x.fillStyle = cur.hit > 0.5 ? '#fff3c4' : GOLD;
        x.fillRect(LX, hy, 2, ROW - 1);
      }
      list.forEach((it, i) => {
        const on = i === s.sel;
        const held = it.once && g.hasItem?.(it.id);
        const price = g.priceOf ? g.priceOf(it.id) : it.cost;
        const afford = (g.coins || 0) >= price;
        drawShopIcon(x, it.icon, LX + 5, y - (on ? 1 : 0), 12, on, t);
        const right = held ? 'EATEN' : String(price);
        const room = LW - 26 - textWidth(right, 1) - 6;
        let nm = it.name;
        while (nm.length > 3 && textWidth(nm, 1) > room) nm = nm.slice(0, -1);
        if (nm !== it.name) nm = nm.slice(0, -1) + '.';
        drawText(x, nm, {
          x: LX + 21, y: y + 1, scale: 1,
          color: held ? '#5f7a4a' : (on ? GOLD_LT : (afford ? '#c9b98a' : '#7a6a52')),
        });
        drawText(x, right, {
          x: LX + LW - 4, y: y + 1, scale: 1, align: 'right',
          color: held ? JADE : (afford ? GOLD : '#8a4a44'),
        });
        rows.push({ x: LX, y: y - 1, w: LW, h: ROW - 1, pick: i });
        y += ROW;
      });

      /* ---- what it does, under the list rather than beside it, so her half
              of the screen stays hers ---- */
      const PY = y + 4, PB = H - 32;
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(LX, PY, W - LX * 2, PB - PY);
      x.fillStyle = '#5c3f1c';
      x.fillRect(LX, PY, W - LX * 2, 1); x.fillRect(LX, PB - 1, W - LX * 2, 1);
      if (d) {
        let by = PY + 4;
        drawText(x, d.tag, { x: LX + 5, y: by, scale: 1, color: '#8a7a52' });
        by += 10;
        for (const ln of wrapText(d.blurb.toUpperCase(), W - LX * 2 - 12, 1, 1)) {
          if (by > PB - 12) break;
          drawText(x, ln, { x: LX + 5, y: by, scale: 1, color: '#c9b98a' });
          by += 9;
        }
      }

      /* ---- what she is saying ---- */
      {
        const lw = Math.min(W - 16, textWidth(s.line, 1));
        x.fillStyle = 'rgba(10,6,4,.86)';
        x.fillRect(8, PB + 2, lw + 8, 12);
        x.fillStyle = '#a83c34'; x.fillRect(8, PB + 2, 2, 12);
        drawText(x, s.line, { x: 13, y: PB + 5, scale: 1, color: '#e8d8b8' });
      }

      /* ---- the counter ---- */
      const owned = d && d.once && g.hasItem?.(d.id);
      const price = d ? (g.priceOf ? g.priceOf(d.id) : d.cost) : 0;
      const afford = d && (g.coins || 0) >= price;
      const label = owned ? 'YOU HAVE EATEN THAT'
        : (afford ? `E   BUY FOR ${price}` : 'NOT ENOUGH SYNCOIN');
      const bw = W - 16, bx = 8, byy = H - 16;
      pressButton(x, bx, byy, bw, label, { hit: s.flash, enabled: afford && !owned });
      rows.push({ x: bx, y: byy, w: bw, h: 12, buy: true });
      return rows;
    },
    key(code, s, g, st) {
      const list = g.foodList ? g.foodList() : FOOD;
      if (code === 'ArrowUp' || code === 'KeyW') {
        if (s.sel === 0) menuSnap();
        s.sel = (s.sel + list.length - 1) % list.length; g.audio?.sfx('select'); return true;
      }
      if (code === 'ArrowDown' || code === 'KeyS') {
        if (s.sel === list.length - 1) menuSnap();
        s.sel = (s.sel + 1) % list.length; g.audio?.sfx('select'); return true;
      }
      if (code === 'Escape' || code === 'Backspace') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        menuFlash();
        const it = list[s.sel];
        if (it && g.buyItem(it.id)) {
          s.flash = 1;
          s.line = CATHY_SOLD[(s.said++) % CATHY_SOLD.length];
          s.lineAt = s.t;
        } else {
          s.line = 'COME BACK WHEN YOU HAVE GOT IT.';
          s.lineAt = s.t;
        }
        return true;
      }
      return true;
    },
    click(row, i, s, g, st) {
      if (row?.buy) { this.key('Enter', s, g, st); return true; }
      if (row?.pick !== undefined) {
        if (row.pick === s.sel) this.key('Enter', s, g, st);
        else { s.sel = row.pick; g.audio?.sfx('select'); }
      }
      return true;
    },
  },

  /* ---------------- THE MAST TERMINAL ----------------
     Four feeds off four cameras you placed yourself. The one you are
     looking at is rendered live, every frame, from a real camera standing
     where you left it — so what is on it is what is actually happening,
     bodies and all. The other three are stills, refreshed one at a time on
     a rotation, which is exactly how a four-channel multiplexer worked and
     is also the only honest way to afford four extra render passes.

     Everything on this screen is either a control or a fact. */
  mpCams: {
    init(s, g) {
      if (s.sel === undefined) s.sel = 0;
      s.boot = 0;
      s.rot = 0;              // which thumbnail gets refreshed next
      s.thumbs = [null, null, null, null];
      s.contacts = [];
      s.glitch = 0;
      s.rec = 0;
      s.log = [];
      s.lastSeen = '';
    },
    tick(s, g, dt, t) {
      s.boot = Math.min(1, s.boot + dt * 0.9);
      s.rec = (s.rec + dt) % 2;
      if (s.glitch > 0) s.glitch = Math.max(0, s.glitch - dt * 3);

      /* Who the selected camera can see, and a line in the log when that
         changes — the log is what makes this a tool rather than a window. */
      const before = s.lastSeen;
      g.feedContacts?.(s.sel, s.contacts);
      const nowSeen = s.contacts.map((c) => c.name).join(',');
      if (nowSeen && nowSeen !== before) {
        const cam = g.cams?.[s.sel];
        for (const c of s.contacts) {
          if (before.includes(c.name)) continue;
          s.log.unshift({ t: s.t, cam: cam ? cam.name : '?', who: c.name, d: c.dist });
        }
        if (s.log.length > 6) s.log.length = 6;
        s.glitch = 0.5;
        g.audio?.sfx('select');
      }
      s.lastSeen = nowSeen;
    },
    draw(x, W, H, s, g, t) {
      const cams = g.cams || [];
      const rows = [];
      const boot = s.boot;

      /* ---- the set itself ---- */
      x.fillStyle = '#080b09'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#080b09', '#0e130f', 0.5, 2);

      /* ---- the header ---- */
      x.fillStyle = '#0d1a12'; x.fillRect(0, 0, W, 15);
      x.fillStyle = '#1e7a4a'; x.fillRect(0, 15, W, 1);
      drawText(x, 'ISLE RELAY', { x: 6, y: 4, scale: 1, color: '#5ae08a' });
      const live = cams.filter((c) => c.placed).length;
      drawText(x, `${live}/${cams.length} ONLINE`, {
        x: W - 6, y: 4, scale: 1, align: 'right',
        color: live ? '#5ae08a' : '#c04a3a',
      });
      /* The recording pip lives on the LEFT, beside the name. On the right
         it sat inside "4/4 ONLINE", which is right-aligned and grows to the
         left as the number of channels changes. */
      if (s.rec < 1) {
        x.fillStyle = '#e02a1a';
        x.fillRect(72, 5, 4, 4);
        drawText(x, 'REC', { x: 79, y: 4, scale: 1, color: '#e05a4a' });
      }

      /* ---- the big feed ---- */
      const FX = 6, FY = 20, FW = 180, FH = 124;
      x.fillStyle = '#000'; x.fillRect(FX - 2, FY - 2, FW + 4, FH + 4);
      x.fillStyle = '#1e7a4a'; x.fillRect(FX - 2, FY - 2, FW + 4, 1);
      x.fillRect(FX - 2, FY + FH + 1, FW + 4, 1);

      const sel = cams[s.sel];
      if (!sel || !sel.placed) {
        // a dead channel: noise, and it says why
        for (let i = 0; i < 900; i++) {
          const px = FX + ((i * 37 + Math.floor(t * 190)) % FW);
          const py = FY + ((i * 53 + Math.floor(t * 97)) % FH);
          const v = ((i * 29 + Math.floor(t * 60)) % 5) * 14;
          x.fillStyle = `rgb(${v},${v + 6},${v + 2})`;
          x.fillRect(px, py, 2, 1);
        }
        drawText(x, 'NO CAMERA ON THIS CHANNEL', {
          x: FX + FW / 2, y: FY + FH / 2 - 8, scale: 1, align: 'center', color: '#5ae08a',
        });
        drawText(x, 'TAKE ONE FROM THE SHELF AND SET IT', {
          x: FX + FW / 2, y: FY + FH / 2 + 2, scale: 1, align: 'center', color: '#2e6a48',
        });
      } else {
        /* The live pass. It comes back as a flipped RGBA buffer, and it is
           drawn a pixel at a time into the same canvas as everything else
           so it picks up the dither, the scanlines and the barrel curve
           with the rest of the interface. */
        const feed = g.feedPixels?.(s.sel);
        if (feed) {
          const { buf, w, h } = feed;
          const sx = FW / w, sy = FH / h;
          /* AUTO-GAIN. A camera under a tree at dusk sees almost nothing,
             and a straight luminance conversion of that is a black
             rectangle — which is exactly what this was. Every camera of
             this kind opens its iris until the picture averages out to
             something usable, so: measure the frame, scale it to land
             around 0.42, and clamp how far it is allowed to push so a
             genuinely dark shot still reads as a dark shot. */
          let sum = 0;
          for (let k = 0; k < buf.length; k += 16) {
            sum += buf[k] * 0.3 + buf[k + 1] * 0.6 + buf[k + 2] * 0.1;
          }
          const mean = (sum / (buf.length / 16)) / 255 || 0.01;
          const gain = THREE_CLAMP(0.42 / Math.max(0.02, mean), 0.8, 5.5);
          s.gain = s.gain === undefined ? gain : s.gain + (gain - s.gain) * 0.10;

          for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
              // readRenderTargetPixels gives bottom-up rows
              const o = ((h - 1 - py) * w + px) * 4;
              /* Green phosphor: a security monitor of this vintage did not
                 have colour, and the brightness is what matters. */
              const lum = (buf[o] * 0.3 + buf[o + 1] * 0.6 + buf[o + 2] * 0.1) / 255;
              const q = Math.min(1, Math.pow(lum * s.gain, 0.78));
              x.fillStyle = `rgb(${Math.round(q * 60)},${Math.round(q * 245)},${Math.round(q * 135)})`;
              x.fillRect(FX + Math.floor(px * sx), FY + Math.floor(py * sy),
                Math.ceil(sx), Math.ceil(sy));
            }
          }
        }
        // scanlines and a roll bar over the top of it
        for (let yy = 0; yy < FH; yy += 2) {
          x.fillStyle = 'rgba(0,0,0,.30)'; x.fillRect(FX, FY + yy, FW, 1);
        }
        const roll = Math.round(((t * 0.22) % 1) * FH);
        x.fillStyle = 'rgba(150,255,190,.05)';
        x.fillRect(FX, FY + roll, FW, 6);
        if (s.glitch > 0) {
          // a tear across the picture when something walks into shot
          const gy = Math.round((1 - s.glitch) * FH);
          x.fillStyle = 'rgba(180,255,210,.18)';
          x.fillRect(FX, FY + gy, FW, 3);
          x.fillStyle = 'rgba(0,0,0,.5)';
          x.fillRect(FX, FY + gy + 3, FW, 2);
        }
        // the burned-in caption every camera has
        drawText(x, sel.name, { x: FX + 4, y: FY + 3, scale: 1, color: '#a8ffc8' });
        const clock = `${String(Math.floor(g.clock24 / 60) % 24).padStart(2, '0')}:`
          + `${String(Math.floor(g.clock24) % 60).padStart(2, '0')}`;
        drawText(x, clock, {
          x: FX + FW - 4, y: FY + 3, scale: 1, align: 'right', color: '#a8ffc8',
        });
        drawText(x, `${Math.round(sel.x)} ${Math.round(sel.z)}`, {
          x: FX + 4, y: FY + FH - 10, scale: 1, color: '#5ae08a',
        });
        // crosshair, because every one of these had one
        x.fillStyle = 'rgba(168,255,200,.30)';
        x.fillRect(FX + FW / 2 - 4, FY + FH / 2, 9, 1);
        x.fillRect(FX + FW / 2, FY + FH / 2 - 4, 1, 9);
      }

      /* ---- the channel strip down the right ---- */
      const CX = FX + FW + 8, CW2 = W - CX - 6;
      for (let i = 0; i < cams.length; i++) {
        const c = cams[i];
        const cy = 20 + i * 27;
        const on = i === s.sel;
        x.fillStyle = on ? '#12301e' : '#0c1610';
        x.fillRect(CX, cy, CW2, 24);
        x.fillStyle = on ? '#5ae08a' : '#1e4a32';
        x.fillRect(CX, cy, CW2, 1); x.fillRect(CX, cy + 23, CW2, 1);
        x.fillRect(CX, cy, 1, 24); x.fillRect(CX + CW2 - 1, cy, 1, 24);
        // a thumbnail: a still, kept from the last time it was refreshed
        const tw = 30, th = 20;
        x.fillStyle = '#000'; x.fillRect(CX + 2, cy + 2, tw, th);
        const th2 = s.thumbs[i];
        if (c.placed && th2) {
          for (let k = 0; k < th2.length; k++) {
            const q = th2[k] / 255;
            x.fillStyle = `rgb(${Math.round(q * 60)},${Math.round(q * 210)},${Math.round(q * 115)})`;
            x.fillRect(CX + 2 + (k % 10) * 3, cy + 2 + ((k / 10) | 0) * 3, 3, 3);
          }
          // the one being refreshed right now gets a corner mark
          if (s.thumbNext === i) { x.fillStyle = '#a8ffc8'; x.fillRect(CX + 2, cy + 2, 2, 2); }
        } else if (c.placed) {
          x.fillStyle = '#0e2a1a'; x.fillRect(CX + 2, cy + 2, tw, th);
        } else {
          for (let k = 0; k < 40; k++) {
            const v = ((k * 31 + Math.floor(t * 40) + i * 7) % 4) * 16;
            x.fillStyle = `rgb(${v},${v + 4},${v})`;
            x.fillRect(CX + 2 + (k % 10) * 3, cy + 2 + ((k / 10) | 0) * 5, 3, 5);
          }
        }
        drawText(x, c.name, {
          x: CX + 36, y: cy + 4, scale: 1, color: on ? '#a8ffc8' : '#4a8a64',
        });
        drawText(x, c.placed ? 'LIVE' : 'NO SIG', {
          x: CX + 36, y: cy + 14, scale: 1,
          color: c.placed ? (Math.floor(t * 2) % 2 ? '#5ae08a' : '#2e7a4a') : '#8a4a3a',
        });
        rows.push({ x: CX, y: cy, w: CW2, h: 24, pick: i });
      }
      // how many are still in your hands
      {
        const hy = 20 + cams.length * 27 + 2;
        const held = g.camsHeld || 0;
        drawText(x, `${held} IN HAND`, {
          x: CX, y: hy, scale: 1, color: held ? '#5ae08a' : '#2e6a48',
        });
        drawText(x, 'V TO SET ONE', { x: CX, y: hy + 9, scale: 1, color: '#2e6a48' });
      }

      /* ---- what the selected camera can see, and the log ---- */
      const LY = FY + FH + 6;
      x.fillStyle = '#0c1610'; x.fillRect(FX - 2, LY, FW + 4, H - LY - 14);
      x.fillStyle = '#1e4a32'; x.fillRect(FX - 2, LY, FW + 4, 1);
      if (s.contacts.length) {
        drawText(x, 'IN SHOT', { x: FX + 2, y: LY + 3, scale: 1, color: '#5ae08a' });
        let cx2 = FX + 44;
        for (const c of s.contacts.slice(0, 3)) {
          const col = c.colour ? colourOf(c.colour) : '#a8ffc8';
          x.fillStyle = col; x.fillRect(cx2, LY + 3, 5, 5);
          drawText(x, `${c.name} ${c.dist}M`, { x: cx2 + 8, y: LY + 3, scale: 1, color: '#a8ffc8' });
          cx2 += 12 + textWidth(`${c.name} ${c.dist}M`, 1);
          if (cx2 > FX + FW - 30) break;
        }
      } else {
        drawText(x, 'NOTHING IN SHOT', { x: FX + 2, y: LY + 3, scale: 1, color: '#2e6a48' });
      }
      // the log, newest first
      let ly = LY + 13;
      for (const e of s.log.slice(0, 2)) {
        drawText(x, `${e.cam}  ${e.who} AT ${e.d}M`, {
          x: FX + 2, y: ly, scale: 1, color: '#3e8a5c',
        });
        ly += 9;
      }

      /* ---- the set warming up, over the top of everything ---- */
      if (boot < 1) {
        const k = boot;
        x.fillStyle = `rgba(4,8,6,${(1 - k).toFixed(2)})`;
        x.fillRect(0, 0, W, H);
        if (k < 0.75) {
          const ly2 = Math.round(H / 2);
          const hgt = Math.round((1 - Math.min(1, k / 0.55)) * H);
          x.fillStyle = '#040806';
          x.fillRect(0, 0, W, Math.max(0, ly2 - (H - hgt) / 2));
          x.fillRect(0, ly2 + (H - hgt) / 2, W, H);
          x.fillStyle = `rgba(168,255,200,${(0.5 * (1 - k)).toFixed(2)})`;
          x.fillRect(0, ly2 - 1, W, 2);
        }
        const msg = ['RELAY POWER', 'SYNC', 'CHANNELS', 'READY'][Math.min(3, Math.floor(k * 4))];
        drawText(x, msg, {
          x: W / 2, y: H / 2 + 14, scale: 1, align: 'center',
          color: '#5ae08a',
        });
      }

      footer(x, W, H, 'UP DOWN CHANNEL   V SET A CAMERA   ESC AWAY');
      return rows;
    },
    key(code, s, g, st) {
      const n = (g.cams || []).length || 1;
      if (code === 'Escape' || code === 'Backspace') { st.pop(); g.afterOverlayClose(); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') {
        s.sel = (s.sel + n - 1) % n; s.glitch = 0.6; g.audio?.sfx('select'); return true;
      }
      if (code === 'ArrowDown' || code === 'KeyS') {
        s.sel = (s.sel + 1) % n; s.glitch = 0.6; g.audio?.sfx('select'); return true;
      }
      if (/^Digit[1-9]$/.test(code)) {
        const i = +code.slice(5) - 1;
        if (i < n) { s.sel = i; s.glitch = 0.6; g.audio?.sfx('select'); }
        return true;
      }
      return true;
    },
    click(row, i, s, g) {
      if (row?.pick !== undefined) { s.sel = row.pick; s.glitch = 0.6; g.audio?.sfx('select'); }
      return true;
    },
  },

  /* ---------------- SCHLARNA ----------------
     A card reader appeared in Ferdi's stock one morning with nobody's name
     on the box. The pink badge on the shelf is an advertisement; this is
     what happens when you press it — a card that comes down over the shop
     and explains itself in four payments you can count.

     It exists because the badge alone was four characters of arithmetic
     ("4x3") next to a button, which is not an explanation of anything. */
  mpSchlarna: {
    init(s) {
      s.drop = 0;          // how far the card has come down
      s.pulse = 0;
      s.demo = 0;          // the loop that shows you how it works
      s.done = false;
      s.coins = [];        // the coins the demo throws
    },
    tick(s, g, dt) {
      s.drop = Math.min(1, s.drop + dt * 4.6);
      s.pulse += dt;
      if (s.drop < 1) return;
      /* The demonstration runs on a loop of its own: a coin leaves your
         purse and lands in the next box, four times, then it resets. This
         is the whole explanation — you should be able to look away from
         the words and still understand it. */
      s.demo += dt * 0.62;
      if (s.demo > SCHLARNA_N + 1.4) { s.demo = 0; s.coins.length = 0; }
      const want = Math.floor(s.demo);
      if (want < SCHLARNA_N && !s.coins[want]) s.coins[want] = { t: 0 };
      for (const c of s.coins) if (c) c.t += dt;
    },
    draw(x, W, H, s, g, t) {
      const id = s.id;
      const it = id ? STOCK.find((q) => q.id === id) : null;
      if (!it) return [];
      const cash = g.priceOf(id);
      const total = g.schlarnaTotal(id);
      const each = g.schlarnaEach(id);
      const n = SCHLARNA_N;
      const coins = g.coins || 0;
      const rows = [];

      /* ---- the shop, dimmed and pushed back ---- */
      x.fillStyle = 'rgba(6,4,2,.86)'; x.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* ---- the card, arriving on a spring ---- */
      const ease = 1 - Math.pow(1 - s.drop, 3);
      const over = Math.sin(Math.min(1, s.drop) * Math.PI) * 6;
      const CW = W - 28, CH = 176;
      const cx0 = Math.round((W - CW) / 2);
      const cy0 = Math.round(-CH + (H / 2 - CH / 2 + CH) * ease - over);
      const cxm = cx0 + CW / 2;

      const PINK = '#f4a6bd', PINK_D = '#c46f8c', PINK_L = '#ffd4e2', INK = '#2a0a16';

      // its shadow on the shop behind
      x.fillStyle = 'rgba(0,0,0,.60)'; x.fillRect(cx0 + 3, cy0 + 4, CW, CH);
      x.fillStyle = PINK; x.fillRect(cx0, cy0, CW, CH);
      /* Diagonal banding in the pink, very faint — a flat field of one
         colour this size reads as a bug rather than as a card. */
      for (let d = -CH; d < CW; d += 8) {
        x.fillStyle = 'rgba(255,255,255,.045)';
        for (let yy = 0; yy < CH; yy++) {
          const xx = d + yy;
          if (xx >= 0 && xx < CW) x.fillRect(cx0 + xx, cy0 + yy, 3, 1);
        }
      }
      // corners knocked off, a lit top edge and a shaded bottom
      x.fillStyle = 'rgba(6,4,2,.86)';
      for (const [qx, qy] of [[cx0, cy0], [cx0 + CW - 2, cy0],
        [cx0, cy0 + CH - 2], [cx0 + CW - 2, cy0 + CH - 2]]) x.fillRect(qx, qy, 2, 2);
      x.fillStyle = PINK_L; x.fillRect(cx0 + 2, cy0, CW - 4, 1);
      x.fillStyle = PINK_D; x.fillRect(cx0 + 2, cy0 + CH - 1, CW - 4, 1);

      /* ---- the wordmark, in its own dark band ---- */
      x.fillStyle = INK; x.fillRect(cx0 + 6, cy0 + 5, CW - 12, 22);
      drawText(x, 'SCHLARNA', {
        x: cx0 + 12, y: cy0 + 9, scale: 2, color: PINK, shadow: false,
      });
      drawText(x, 'PAY IN FOUR', {
        x: cx0 + CW - 12, y: cy0 + 15, scale: 1, align: 'right',
        color: PINK_D, shadow: false,
      });
      {
        // a shine travelling across the band
        const sw = (s.pulse % 2.6) / 0.42;
        if (sw < 1) {
          const bxs = Math.round(cx0 + 4 + sw * (CW - 4));
          for (let i = 0; i < 7; i++) {
            x.fillStyle = `rgba(255,214,232,${(0.22 * (1 - Math.abs(i - 3) / 3.5)).toFixed(3)})`;
            x.fillRect(bxs + i, cy0 + 6, 1, 20);
          }
        }
      }

      /* ---- what you are buying, and what it comes to ---- */
      const IY = cy0 + 32;
      /* Twenty-eight pixels, not twenty-four: a scale-2 figure is fourteen
         tall and the premium line under it is seven, and at twenty-four the
         two printed into each other. */
      x.fillStyle = 'rgba(42,10,22,.14)'; x.fillRect(cx0 + 6, IY, CW - 12, 28);
      drawShopIcon(x, it.icon, cx0 + 10, IY + 5, 16, true, t);
      drawText(x, it.name, { x: cx0 + 30, y: IY + 4, scale: 1, color: INK, shadow: false });
      drawText(x, `CASH TODAY  ${cash}`, {
        x: cx0 + 30, y: IY + 15, scale: 1, color: '#7a3050', shadow: false,
      });
      // the total, big, on the right, with the premium under it
      drawText(x, String(total), {
        x: cx0 + CW - 12, y: IY + 2, scale: 2, align: 'right', color: INK, shadow: false,
      });
      drawText(x, `+${total - cash} FOR THE PLAN`, {
        x: cx0 + CW - 12, y: IY + 19, scale: 1, align: 'right',
        color: '#7a3050', shadow: false,
      });

      /* ---- the four payments, and a coin going into each ----
         The purse is on the left, the four boxes run across, and the demo
         throws a coin from one to the next on a loop. */
      const PY = cy0 + 68;
      const PURSE_X = cx0 + 18, PURSE_Y = PY + 14;
      // your purse
      x.fillStyle = INK; x.fillRect(PURSE_X - 11, PY + 2, 22, 26);
      x.fillStyle = '#6a2a44'; x.fillRect(PURSE_X - 9, PY + 4, 18, 22);
      drawText(x, 'YOURS', {
        x: PURSE_X, y: PY - 8, scale: 1, align: 'center', color: INK, shadow: false,
      });
      for (let i = 0; i < 3; i++) {
        drawCoinPipLocal(x, PURSE_X - 4, PY + 18 - i * 4, INK, PINK);
      }

      const BX0 = cx0 + 40, BW = Math.floor((CW - 52 - (n - 1) * 5) / n);
      const paid = g.plan && g.plan.id === id ? n - Math.ceil(g.plan.owed / each) : 0;
      for (let i = 0; i < n; i++) {
        const bx2 = BX0 + i * (BW + 5);
        const first = i === 0;
        const donePay = i < paid;
        // has the demo coin landed in this one yet?
        const c2 = s.coins[i];
        const landed = c2 && c2.t > 0.42;
        x.fillStyle = donePay || landed ? '#6a2a44' : (first ? INK : 'rgba(42,10,22,.16)');
        x.fillRect(bx2, PY, BW, 30);
        x.fillStyle = INK;
        x.fillRect(bx2, PY, BW, 1); x.fillRect(bx2, PY + 29, BW, 1);
        x.fillRect(bx2, PY, 1, 30); x.fillRect(bx2 + BW - 1, PY, 1, 30);
        drawText(x, String(each), {
          x: bx2 + BW / 2, y: PY + 5, scale: 2, align: 'center',
          color: donePay || landed || first ? PINK : INK, shadow: false,
        });
        drawText(x, first ? 'NOW' : (donePay ? 'PAID' : 'LATER'), {
          x: bx2 + BW / 2, y: PY + 20, scale: 1, align: 'center',
          color: donePay || landed || first ? PINK_L : '#7a3050', shadow: false,
        });
        // an arrow on to the next one
        if (i < n - 1) {
          x.fillStyle = INK;
          x.fillRect(bx2 + BW + 1, PY + 14, 3, 1);
          x.fillRect(bx2 + BW + 2, PY + 13, 1, 3);
        }
        /* the coin in flight, on an arc from the purse to this box */
        if (c2 && c2.t < 0.42) {
          const k = c2.t / 0.42;
          const tx = bx2 + BW / 2 - 4;
          const px2 = PURSE_X - 4 + (tx - (PURSE_X - 4)) * k;
          const py2 = PURSE_Y - 4 - Math.sin(k * Math.PI) * 20 + (PY + 8 - (PURSE_Y - 4)) * k;
          drawCoinPipLocal(x, Math.round(px2), Math.round(py2), INK, '#ffe08a');
        }
      }

      /* ---- and where the payments come from, in one line ---- */
      const SY = PY + 38;
      x.fillStyle = INK; x.fillRect(cx0 + 8, SY, CW - 16, 1);
      drawText(x, 'HALF OF EVERY SYNCOIN YOU EARN GOES TO IT', {
        x: cxm, y: SY + 5, scale: 1, align: 'center', color: INK, shadow: false,
      });
      drawText(x, 'UNTIL IT IS SETTLED. YOU KEEP THE OTHER HALF.', {
        x: cxm, y: SY + 15, scale: 1, align: 'center', color: '#7a3050', shadow: false,
      });
      // a bar showing the split, which is the whole deal in one picture
      {
        const bw2 = CW - 40, bx3 = cx0 + 20, by3 = SY + 26;
        x.fillStyle = INK; x.fillRect(bx3 - 1, by3 - 1, bw2 + 2, 8);
        x.fillStyle = '#6a2a44'; x.fillRect(bx3, by3, bw2 / 2, 6);
        x.fillStyle = '#e8c860'; x.fillRect(bx3 + bw2 / 2, by3, bw2 / 2, 6);
        // it breathes, so the eye goes to it
        const w3 = Math.round(Math.sin(s.pulse * 2) * 2);
        x.fillStyle = PINK_L; x.fillRect(bx3 + bw2 / 2 - 1 + w3, by3, 2, 6);
        drawText(x, 'TO SCHLARNA', {
          x: bx3, y: by3 + 10, scale: 1, color: '#7a3050', shadow: false,
        });
        drawText(x, 'YOU KEEP', {
          x: bx3 + bw2, y: by3 + 10, scale: 1, align: 'right',
          color: '#7a3050', shadow: false,
        });
      }

      /* ---- the buttons ---- */
      const canStart = coins >= each && g.schlarnaOn?.(id);
      const bw4 = Math.floor((CW - 22) / 2);
      const byy = cy0 + CH - 22;
      rows.push({ ...pressButton(x, cx0 + 8, byy, bw4,
        canStart ? `E   PAY ${each} NOW` : (g.plan ? 'ONE PLAN AT A TIME' : `YOU NEED ${each}`), {
          hit: s.done ? 1 : 0, enabled: canStart,
          accent: INK, fill: '#e88cb0', text: INK,
        }), take: true });
      rows.push({ ...pressButton(x, cx0 + 14 + bw4, byy, bw4, 'ESC   NO THANK YOU', {
        enabled: true, accent: '#7a3050', fill: 'rgba(42,10,22,.22)', text: INK,
      }), leave: true });

      return rows;
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace') { st.pop(); return true; }
      if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
        if (g.buySchlarna?.(s.id)) { s.done = true; setTimeout(() => st.pop(), 300); }
        return true;
      }
      return true;
    },
    click(row, i, s, g, st) {
      if (row?.take) return this.key('KeyE', s, g, st);
      if (row?.leave) return this.key('Escape', s, g, st);
      return true;
    },
  },

  /* ---------------- THE SALOON ---------------- */
  /* Quezetriel's bar. The list is on the left, he is on the right, and the
     drink you buy is POURED: the pump comes down, the glass fills, the head
     settles, and only then does it do anything. */
  mpBar: {
    init(s) {
      if (s.sel === undefined) s.sel = 0;
      s.line = QUEZ_LINES[0];
      s.said = 0;
      s.lineAt = 0;
      s.pour = null;          // {id, t, colour} while one is being poured
      s.pull = 0;             // how far down the pump handle is
      s.flash = 0;
    },
    tick(s, g, dt, t) {
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3);
      s.pull = Math.max(0, s.pull - dt * 1.6);
      if (s.pour) {
        s.pour.t += dt;
        // three seconds from the pull to the drink being yours
        if (s.pour.t > 2.9 && !s.pour.done) {
          s.pour.done = true;
          g.buyDrink?.(s.pour.id);
          g.audio?.sfx('gulp');
          s.line = QUEZ_SOLD[(s.said++) % QUEZ_SOLD.length];
          s.lineAt = t;
        }
        if (s.pour.t > 4.2) s.pour = null;
      } else if (t - s.lineAt > 8) {
        s.lineAt = t;
        s.line = QUEZ_LINES[(++s.said) % QUEZ_LINES.length];
      }
    },
    draw(x, W, H, s, g, t) {
      const list = DRINKS;
      if (s.sel >= list.length) s.sel = 0;
      const d = list[s.sel];
      const coins = g.coins || 0;

      /* ---- the room: brown, low, and lit by one lamp ---- */
      x.fillStyle = '#140b06'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#140b06', '#241408', 0.5, 2);
      // the pool of lamplight over the bar, breathing
      {
        const lx = W - 62, ly = 30;
        for (let i = 12; i >= 0; i--) {
          const a = (0.016 + Math.sin(t * 3.7) * 0.002).toFixed(3);
          x.fillStyle = `rgba(255,176,80,${a})`;
          x.beginPath(); x.arc(lx, ly, 14 + i * 9, 0, 6.283); x.fill();
        }
      }
      // the fire, off to the left, throwing its own light up the wall
      {
        const flick = 0.6 + Math.abs(Math.sin(t * 5.3)) * 0.4;
        for (let i = 9; i >= 0; i--) {
          x.fillStyle = `rgba(255,120,40,${(0.011 * flick).toFixed(3)})`;
          x.beginPath(); x.arc(-6, H - 40, 20 + i * 13, 0, 6.283); x.fill();
        }
      }
      // panelling, and the beams across the ceiling
      for (let i = 0; i < H; i += 9) {
        x.fillStyle = 'rgba(120,74,32,.055)'; x.fillRect(0, i, W, 8);
        x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(0, i + 8, W, 1);
      }
      x.fillStyle = '#2a1a10'; x.fillRect(0, 0, W, 7);
      for (let i = 0; i < W; i += 46) { x.fillStyle = '#3a2414'; x.fillRect(i, 0, 5, 7); }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.32)'; x.fillRect(0, y, W, 1); }

      /* The back fitting behind him: shelves of bottles, lit, so his
         silhouette has something to be a silhouette against. Drawn before
         he is. */
      {
        const bx0 = W - 116, bw0 = 108;
        x.fillStyle = '#3a2412'; x.fillRect(bx0, 36, bw0, 74);
        ditherRect(x, bx0, 36, bw0, 74, '#3a2412', '#4e3018', 0.5, 2);
        for (const sy of [52, 74, 96]) {
          // the shelf, and the bottles on it
          x.fillStyle = '#6a4420'; x.fillRect(bx0 + 2, sy, bw0 - 4, 2);
          x.fillStyle = '#2a1a0c'; x.fillRect(bx0 + 2, sy + 2, bw0 - 4, 2);
          for (let i = 0; i < 13; i++) {
            const col = ['#6a3a18', '#8a2018', '#2a5a3a', '#c8a020', '#3a2a6a',
              '#8a6a20', '#1a4a5a'][(i + sy) % 7];
            const bh = 10 + ((i * 3 + sy) % 4);
            x.fillStyle = col;
            x.fillRect(bx0 + 4 + i * 8, sy - bh, 5, bh);
            x.fillStyle = 'rgba(255,255,255,.16)';
            x.fillRect(bx0 + 4 + i * 8, sy - bh, 1, bh);
            x.fillStyle = col;
            x.fillRect(bx0 + 5 + i * 8, sy - bh - 3, 2, 3);
          }
        }
        // the mirror strip along the back, catching the lamp
        x.fillStyle = 'rgba(180,200,215,.06)'; x.fillRect(bx0 + 4, 38, bw0 - 8, 12);
      }

      // him, in front of it
      drawQuez(x, W - 74, 34, t, s.pull);

      /* ---- the bar top, which everything happens on ---- */
      const BY = 112;                     // the top of the counter
      x.fillStyle = '#5a3a1c'; x.fillRect(W - 116, BY, 116, 7);
      x.fillStyle = '#a06c34'; x.fillRect(W - 116, BY, 116, 2);
      x.fillStyle = '#c98a4c'; x.fillRect(W - 116, BY + 1, 116, 1);
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(W - 116, BY + 7, 116, 5);
      // the brass rail below it
      x.fillStyle = '#8a6a28'; x.fillRect(W - 116, BY + 14, 116, 2);

      /* the pump: a brass column with a handle that comes down when he pulls */
      {
        const px = W - 92, py = BY - 34;
        x.fillStyle = '#3a2a10'; x.fillRect(px - 5, py + 26, 12, 8);
        x.fillStyle = '#c8a040'; x.fillRect(px - 4, py + 27, 10, 6);
        x.fillStyle = '#8a6a28'; x.fillRect(px - 1, py, 5, 28);
        x.fillStyle = '#d8b858'; x.fillRect(px - 1, py, 2, 28);
        // the badge on top
        x.fillStyle = d ? `#${(d.colour || 0xc07820).toString(16).padStart(6, '0')}` : '#c07820';
        x.fillRect(px - 6, py - 10, 15, 10);
        x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(px - 6, py - 10, 15, 1);
        // the handle, hinged at the top, pulled toward you
        const ang = s.pull * 0.9;
        x.save();
        x.translate(px + 1, py + 4);
        x.rotate(-ang);
        x.fillStyle = '#c8a040'; x.fillRect(0, 0, 3, 20);
        x.fillStyle = '#2a1a10'; x.fillRect(-2, 19, 7, 6);
        x.restore();
      }

      /* the glass, which only exists while there is something in it */
      if (s.pour) {
        const gx = W - 62, gy = BY - 30;
        const k = Math.min(1, s.pour.t / 2.2);
        const col = `#${(s.pour.colour || 0xd8901c).toString(16).padStart(6, '0')}`;
        // the glass itself
        x.fillStyle = 'rgba(190,215,225,.20)'; x.fillRect(gx, gy, 15, 30);
        // what is in it, rising
        const fh = Math.round(k * 26);
        x.fillStyle = col; x.fillRect(gx + 1, gy + 29 - fh, 13, fh);
        // a lighter face down one side, so it reads as glass
        x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(gx + 1, gy + 29 - fh, 3, fh);
        // the head, which is proud and then settles
        if (k > 0.12) {
          const settle = Math.max(0, Math.min(1, (s.pour.t - 2.2) / 1.4));
          const hh = Math.round(5 - settle * 2);
          x.fillStyle = '#f4ecd8';
          x.fillRect(gx + 1, gy + 28 - fh - hh, 13, hh);
          x.fillStyle = '#fffaf0';
          x.fillRect(gx + 1, gy + 28 - fh - hh, 13, 1);
        }
        // bubbles on the way up
        if (k < 1) {
          for (let i = 0; i < 5; i++) {
            const bt = (t * 1.6 + i * 0.37) % 1;
            x.fillStyle = 'rgba(255,255,255,.35)';
            x.fillRect(gx + 3 + ((i * 5) % 10), gy + 29 - Math.round(bt * fh), 1, 1);
          }
        }
        // the stream from the pump while it is still coming
        if (s.pour.t < 2.2) {
          x.fillStyle = col;
          x.fillRect(W - 91, BY - 30, 2, Math.round(8 + Math.sin(t * 30) * 2));
        }
        // the outline last, so it sits over the beer
        x.strokeStyle = 'rgba(220,235,245,.45)'; x.lineWidth = 1;
        x.strokeRect(gx + 0.5, gy + 0.5, 14, 29);
        // and a handle
        x.fillStyle = 'rgba(190,215,225,.28)';
        x.fillRect(gx + 15, gy + 8, 4, 2); x.fillRect(gx + 17, gy + 10, 2, 8);
        x.fillRect(gx + 15, gy + 18, 4, 2);
      }

      /* ---- the sign over the bar ----
         Two lines of seven-pixel type need more than eighteen pixels of
         board: the first version put NO TABS through the bottom rule. */
      x.fillStyle = '#2a1006'; x.fillRect(W - 116, 10, 108, 22);
      x.fillStyle = '#ffb84a'; x.fillRect(W - 116, 10, 108, 1);
      x.fillRect(W - 116, 31, 108, 1);
      drawText(x, 'QUEBOLIUS', { x: W - 62, y: 12, scale: 1, align: 'center', color: '#ffb84a' });
      drawText(x, 'NO TABS', { x: W - 62, y: 22, scale: 1, align: 'center', color: '#8a6a30' });

      drawText(x, `${coins} SYNCOIN`, {
        x: 8, y: 8, scale: 1, color: GOLD_LT,
      });

      /* ---- the list ---- */
      const LX = 6, LW = 146, ROW = 14;
      let y = 22;
      const rows = [];
      const cur = listCursor('bar', s.sel, list.length);
      {
        const hy = Math.round(22 + cur.at * ROW) - 1;
        x.fillStyle = cur.hit > 0.5 ? '#7a5018' : '#3a2410';
        x.fillRect(LX, hy, LW, ROW - 1);
        x.fillStyle = cur.hit > 0.5 ? '#fff3c4' : '#ffb84a';
        x.fillRect(LX, hy, 2, ROW - 1);
      }
      list.forEach((it, i) => {
        const on = i === s.sel;
        const afford = coins >= it.cost;
        const live = g.tab && g.tab[it.id];
        drawShopIcon(x, it.icon, LX + 4, y - 1 - (on ? 1 : 0), 12, on, t);
        const right = live ? 'ON' : String(it.cost);
        const room = LW - 24 - textWidth(right, 1) - 6;
        let nm = it.name;
        while (nm.length > 3 && textWidth(nm, 1) > room) nm = nm.slice(0, -1);
        if (nm !== it.name) nm = nm.slice(0, -1) + '.';
        drawText(x, nm, {
          x: LX + 19, y: y + 1, scale: 1,
          color: on ? '#ffd8a0' : (afford ? '#c9b98a' : '#7a6a52'),
        });
        drawText(x, right, {
          x: LX + LW - 4, y: y + 1, scale: 1, align: 'right',
          color: live ? JADE : (afford ? GOLD : '#8a4a44'),
        });
        // a pink-brown pip on the ones that will have you over
        if (it.drunk) {
          x.fillStyle = Math.floor(t * 3) % 2 ? '#c86a3a' : '#7a3a1a';
          x.fillRect(LX + LW - 2, y + 1, 2, 5);
        }
        rows.push({ x: LX, y: y - 1, w: LW, h: ROW - 1, pick: i });
        y += ROW;
      });

      /* ---- what it does ---- */
      const PY = y + 3, PB = H - 30;
      x.fillStyle = 'rgba(0,0,0,.52)'; x.fillRect(LX, PY, LW, PB - PY);
      x.fillStyle = '#6a4420';
      x.fillRect(LX, PY, LW, 1); x.fillRect(LX, PB - 1, LW, 1);
      if (d) {
        let by = PY + 4;
        drawText(x, d.tag, { x: LX + 5, y: by, scale: 1, color: d.drunk ? '#e08a4a' : '#8a7a52' });
        by += 10;
        for (const ln of wrapText(d.blurb.toUpperCase(), LW - 12, 1, 1)) {
          if (by > PB - 11) break;
          drawText(x, ln, { x: LX + 5, y: by, scale: 1, color: '#c9b98a' });
          by += 9;
        }
      }

      /* ---- the strip between the list and the bar ----
         There was a hand's width of empty brown here doing nothing, which
         made the two halves of the screen read as two screens. It is the
         room now: the fire at the bottom, the dartboard on the wall, a
         drinker in a booth who never looks up, and smoke going across. */
      {
        const gx0 = LX + LW + 3, gw = (W - 118) - gx0;
        if (gw > 10) {
          const gcx = gx0 + gw / 2;
          // the far wall, a shade darker than the near one
          x.fillStyle = 'rgba(0,0,0,.32)'; x.fillRect(gx0, 20, gw, PB - 20);
          for (let i = 22; i < PB; i += 9) {
            x.fillStyle = 'rgba(120,74,32,.06)'; x.fillRect(gx0, i, gw, 8);
          }

          // the dartboard on it, small and lit
          {
            const by2 = 40, r = 11;
            for (let i = 6; i >= 0; i--) {
              x.fillStyle = 'rgba(255,232,170,.018)';
              x.beginPath(); x.arc(gcx, by2, 6 + i * 4, 0, 6.283); x.fill();
            }
            x.fillStyle = '#241408'; x.fillRect(gcx - r - 3, by2 - r - 3, r * 2 + 6, r * 2 + 6);
            for (let i = 0; i < 20; i++) {
              const a0 = (i - 0.5) * 0.3142 - 1.5708, a1 = (i + 0.5) * 0.3142 - 1.5708;
              x.beginPath(); x.arc(gcx, by2, r, a0, a1);
              x.lineTo(gcx, by2); x.closePath();
              x.fillStyle = i % 2 ? '#e2d4b0' : '#100d0a'; x.fill();
            }
            x.beginPath(); x.arc(gcx, by2, 3, 0, 6.283);
            x.fillStyle = '#b0201a'; x.fill();
            // three darts in it, which somebody left
            for (const [dx2, dy2] of [[-4, -5], [3, -2], [1, 5]]) {
              x.fillStyle = '#c8c8d0'; x.fillRect(gcx + dx2, by2 + dy2, 3, 1);
              x.fillStyle = '#e8e0c8'; x.fillRect(gcx + dx2 + 3, by2 + dy2 - 1, 2, 3);
            }
          }

          // a drinker in the booth below it, in silhouette, who never turns round
          {
            const py2 = 78;
            const lean = Math.round(Math.sin(t * 0.5) * 1);
            x.fillStyle = '#0e0a08';
            x.fillRect(gcx - 9 + lean, py2 + 10, 18, 22);      // back
            x.fillRect(gcx - 5 + lean, py2, 10, 11);           // head
            x.fillRect(gcx - 12 + lean, py2 + 14, 5, 12);      // an arm on the table
            // the table, and his glass on it, which very slowly empties
            x.fillStyle = '#4a3018'; x.fillRect(gcx - 16, py2 + 30, 32, 3);
            x.fillStyle = '#5f3f20'; x.fillRect(gcx - 16, py2 + 30, 32, 1);
            const lvl = 6 - Math.floor((t / 9) % 5);
            x.fillStyle = 'rgba(190,215,225,.22)'; x.fillRect(gcx + 8, py2 + 22, 5, 8);
            x.fillStyle = '#a8681c'; x.fillRect(gcx + 9, py2 + 30 - lvl, 3, lvl);
            // and a candle on the table
            const fl = 0.7 + Math.abs(Math.sin(t * 7.3)) * 0.3;
            x.fillStyle = '#e8e0c8'; x.fillRect(gcx - 13, py2 + 25, 2, 5);
            x.fillStyle = `rgba(255,200,110,${fl.toFixed(2)})`;
            x.fillRect(gcx - 13, py2 + 22, 2, 3);
            for (let i = 5; i >= 0; i--) {
              x.fillStyle = `rgba(255,176,80,${(0.03 * fl).toFixed(3)})`;
              x.beginPath(); x.arc(gcx - 12, py2 + 24, 3 + i * 3, 0, 6.283); x.fill();
            }
          }

          // smoke drifting across the whole strip
          for (let i = 0; i < 4; i++) {
            const sy2 = 26 + i * 27;
            const sx2 = gx0 + ((t * (5 + i * 2) + i * 31) % (gw + 24)) - 12;
            x.fillStyle = `rgba(216,200,176,${(0.028 + Math.sin(t + i) * 0.012).toFixed(3)})`;
            x.fillRect(Math.round(sx2), sy2, 16, 2);
            x.fillRect(Math.round(sx2) + 4, sy2 - 1, 8, 1);
          }
          // a rail of light down each edge, so it is a view and not a hole
          x.fillStyle = 'rgba(255,180,74,.16)';
          x.fillRect(gx0, 20, 1, PB - 20);
          x.fillRect(gx0 + gw - 1, 20, 1, PB - 20);
        }
      }

      /* ---- what he is saying ---- */
      {
        const txt = s.line;
        const lw = Math.min(W - 16, textWidth(txt, 1));
        x.fillStyle = 'rgba(10,6,4,.88)';
        x.fillRect(6, PB + 2, lw + 8, 12);
        x.fillStyle = '#ffb84a'; x.fillRect(6, PB + 2, 2, 12);
        drawText(x, txt, { x: 11, y: PB + 5, scale: 1, color: '#e8d0a8' });
      }

      /* ---- the counter ---- */
      const afford = d && coins >= d.cost;
      const busy = !!s.pour;
      const label = busy ? 'HE IS POURING' : (afford ? `E   ${d.cost} SYNCOIN` : 'NOT ENOUGH SYNCOIN');
      const bw = W - 12, bx = 6, byy = H - 16;
      pressButton(x, bx, byy, bw, label, {
        hit: s.flash / 0.35, enabled: afford && !busy,
        accent: '#ffb84a', fill: '#3a2410', text: '#ffd8a0',
      });
      rows.push({ x: bx, y: byy, w: bw, h: 12, buy: true });
      return rows;
    },
    key(code, s, g, st) {
      const list = DRINKS;
      if (code === 'ArrowUp' || code === 'KeyW') {
        if (s.sel === 0) menuSnap();
        s.sel = (s.sel + list.length - 1) % list.length; g.audio?.sfx('select'); return true;
      }
      if (code === 'ArrowDown' || code === 'KeyS') {
        if (s.sel === list.length - 1) menuSnap();
        s.sel = (s.sel + 1) % list.length; g.audio?.sfx('select'); return true;
      }
      if (code === 'Escape' || code === 'Backspace') {
        if (s.pour) { g.audio?.sfx('deny'); return true; }
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        if (s.pour) { g.audio?.sfx('deny'); return true; }
        menuFlash();
        const it = list[s.sel];
        if (!it) return true;
        if ((g.coins || 0) < it.cost) {
          s.line = 'NO TABS. IT IS ON THE SIGN.';
          s.lineAt = s.t;
          g.audio?.sfx('deny');
          return true;
        }
        /* He pulls it, and it takes as long as it takes. Nothing is charged
           and nothing happens to you until the glass is full — which is
           what makes buying a drink feel like buying a drink. */
        s.pour = { id: it.id, t: 0, colour: it.colour, done: false };
        s.pull = 1;
        s.flash = 0.35;
        s.line = 'COMING UP.';
        s.lineAt = s.t;
        g.audio?.sfx('lever');
        g.audio?.sfx('pour');
        setTimeout(() => g.audio?.sfx('fizz'), 500);
        setTimeout(() => g.audio?.sfx('glass'), 2300);
        // the room pours one too, on the bar top you are standing at
        const idx = list.indexOf(it) % 3;
        g.barScene?.userData.pour?.(idx, it.colour);
        setTimeout(() => g.barScene?.userData.clearGlass?.(idx), 9000);
        return true;
      }
      return true;
    },
    click(row, i, s, g, st) {
      if (row?.buy) { this.key('Enter', s, g, st); return true; }
      if (row?.pick !== undefined) {
        if (row.pick === s.sel) this.key('Enter', s, g, st);
        else { s.sel = row.pick; g.audio?.sfx('select'); }
      }
      return true;
    },
  },

  /* ---------------- DARTS ---------------- */
  /* 301, straight in, double out, against Quezetriel for money.

     Two decisions per dart, never one: a line sweeps across the board and
     you stop it, then a line sweeps down it and you stop that. Where they
     cross is where the dart goes. Nothing is random until you have
     committed to both — and then only your own hand, which is worse the
     more he has sold you. */
  mpDarts: {
    init(s, g) {
      s.phase = 'stake';        // stake | aimX | aimY | fly | his | turnend | over
      s.stake = Math.max(DARTS_MIN, Math.min(DARTS_MAX, g?.coins || 0));
      if (s.stake < DARTS_MIN) s.stake = DARTS_MIN;
      s.leg = null;
      s.sweep = 0;
      s.aimX = 0;
      s.aimY = 0;
      s.fly = 0;
      s.last = null;
      s.hisT = 0;
      s.line = `${DARTS.START} UP. STRAIGHT IN, DOUBLE OUT.`;
      s.said = 0;
      s.bump = 0;
      s.shake = 0;
    },
    tick(s, g, dt, t) {
      if (s.bump > 0) s.bump = Math.max(0, s.bump - dt * 6);
      if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 3);
      const drunk = g?.pipeline?.drunk || 0;

      if (s.phase === 'aimX' || s.phase === 'aimY') {
        /* The sweep speeds up as the leg gets tighter, and drink makes it
           worse. Twenty per cent slower than the first pass all round —
           two decisions per dart at the old rate was less aiming than
           guessing. */
        const base = 1.24 + (s.leg && s.leg.you < 60 ? 0.4 : 0) + drunk * 1.05;
        s.sweep = (s.sweep + dt * base) % 1;
      }
      if (s.phase === 'fly') {
        s.fly += dt;
        if (s.fly > 0.42 && !s.landed) {
          s.landed = true;
          const wob = 0.055 + drunk * 0.16;
          const dx = s.aimX + (Math.random() - 0.5) * wob;
          const dy = s.aimY + (Math.random() - 0.5) * wob;
          const r = DARTS.throwDart(s.leg, dx, dy);
          s.last = r;
          s.shake = r.hit.ring === 'treble' || r.hit.ring === 'inner' ? 1 : 0.4;
          g.audio?.sfx(r.hit.ring === 'miss' ? 'wire' : 'dart');
          if (r.out) {
            s.line = 'GAME. THAT IS A FINISH.';
            g.audio?.sfx('victory');
          } else if (r.bust) {
            s.line = 'BUST. THE WHOLE TURN GOES.';
            g.audio?.sfx('deny');
          } else if (r.hit.ring === 'treble') {
            s.line = `${r.hit.label}. HE SAW THAT.`;
            g.audio?.sfx('confirm');
          } else if (r.hit.ring === 'miss') {
            s.line = 'OFF THE BOARD ENTIRELY.';
          }
        }
        if (s.fly > 0.95) {
          if (s.leg.over) { s.phase = 'over'; DARTS_PAY(s, g); return; }
          if (DARTS.turnDone(s.leg)) {
            DARTS.endTurn(s.leg);
            s.phase = 'his';
            s.hisT = 0;
            s.hisThrown = 0;
            s.line = 'HIS THROW.';
          } else {
            s.phase = 'aimX';
          }
          s.fly = 0;
          s.landed = false;
        }
      }
      if (s.phase === 'his') {
        s.hisT += dt;
        // one dart a second, so you can watch him do it to you
        if (s.hisT > 0.62) {
          s.hisT = 0;
          const th = DARTS.hisThrow(s.leg.him);
          const r = DARTS.throwDart(s.leg, th.x, th.y);
          s.last = r;
          s.shake = r.hit.ring === 'treble' ? 0.9 : 0.35;
          g.audio?.sfx(r.hit.ring === 'miss' ? 'wire' : 'dart');
          if (r.out) {
            s.line = QUEZ_DARTS_WIN[(s.said++) % QUEZ_DARTS_WIN.length];
            s.phase = 'over';
            DARTS_PAY(s, g);
            return;
          }
          if (DARTS.turnDone(s.leg)) {
            DARTS.endTurn(s.leg);
            s.phase = 'aimX';
            s.line = s.leg.you <= 40 && s.leg.you % 2 === 0
              ? `YOU ARE ON DOUBLE ${s.leg.you / 2}.` : 'YOUR THROW.';
          }
        }
      }
    },
    draw(x, W, H, s, g, t) {
      const coins = g.coins || 0;
      const leg = s.leg;
      let stakeRows = [];
      const sh = s.shake > 0 ? Math.round(Math.sin(s.shake * 40) * s.shake * 2) : 0;

      /* ---- the corner of the bar the board is in ---- */
      x.fillStyle = '#120a05'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#120a05', '#20130a', 0.5, 2);
      for (let i = 0; i < H; i += 9) {
        x.fillStyle = 'rgba(120,74,32,.05)'; x.fillRect(0, i, W, 8);
        x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(0, i + 8, W, 1);
      }
      // the lamp over the board
      const CX = Math.round(W * 0.62) + sh, CY = Math.round(H * 0.47);
      const R = 62;
      for (let i = 12; i >= 0; i--) {
        x.fillStyle = `rgba(255,224,170,${(0.013 + Math.sin(t * 4) * 0.001).toFixed(3)})`;
        x.beginPath(); x.arc(CX, CY - 18, 20 + i * 8, 0, 6.283); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.30)'; x.fillRect(0, y, W, 1); }

      /* ---- the board ----
         Not while you are choosing a stake: the board and its twenty
         numbers behind a scrim is a busy backdrop for a decision, and the
         numbers printed through the caption on the tray. */
      const showBoard = s.phase !== 'stake';
      if (showBoard) {
      // the cabinet behind it
      x.fillStyle = '#241408'; x.fillRect(CX - R - 10, CY - R - 10, (R + 10) * 2, (R + 10) * 2);
      x.fillStyle = '#3a2414'; x.fillRect(CX - R - 10, CY - R - 10, (R + 10) * 2, 3);
      const wedge = (r0, r1, i, col) => {
        const a0 = (i - 0.5) * (Math.PI * 2 / 20) - Math.PI / 2;
        const a1 = (i + 0.5) * (Math.PI * 2 / 20) - Math.PI / 2;
        x.beginPath();
        x.arc(CX, CY, r1, a0, a1);
        x.arc(CX, CY, r0, a1, a0, true);
        x.closePath();
        x.fillStyle = col; x.fill();
      };
      for (let i = 0; i < 20; i++) {
        const dark = i % 2 === 0;
        wedge(R * DARTS.R_OUTER, R * DARTS.R_TREBLE_IN, i, dark ? '#100d0a' : '#e2d4b0');
        wedge(R * DARTS.R_TREBLE_OUT, R * DARTS.R_DOUBLE_IN, i, dark ? '#100d0a' : '#e2d4b0');
        wedge(R * DARTS.R_TREBLE_IN, R * DARTS.R_TREBLE_OUT, i, dark ? '#1e7a3a' : '#b0201a');
        wedge(R * DARTS.R_DOUBLE_IN, R * DARTS.R_DOUBLE_OUT, i, dark ? '#1e7a3a' : '#b0201a');
      }
      x.beginPath(); x.arc(CX, CY, R * DARTS.R_OUTER, 0, 6.283);
      x.fillStyle = '#1e7a3a'; x.fill();
      x.beginPath(); x.arc(CX, CY, R * DARTS.R_BULL, 0, 6.283);
      x.fillStyle = '#b0201a'; x.fill();
      // the wire
      x.strokeStyle = 'rgba(220,210,190,.22)'; x.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        const a = (i + 0.5) * (Math.PI * 2 / 20) - Math.PI / 2;
        x.beginPath();
        x.moveTo(CX + Math.cos(a) * R * DARTS.R_OUTER, CY + Math.sin(a) * R * DARTS.R_OUTER);
        x.lineTo(CX + Math.cos(a) * R, CY + Math.sin(a) * R);
        x.stroke();
      }
      // and the numbers round the outside
      for (let i = 0; i < 20; i++) {
        const a = i * (Math.PI * 2 / 20) - Math.PI / 2;
        drawText(x, String(DARTS.ORDER[i]), {
          x: CX + Math.cos(a) * (R + 7), y: CY + Math.sin(a) * (R + 7) - 3,
          scale: 1, align: 'center', color: '#c8b894', shadow: false,
        });
      }

      }

      /* ---- darts already in it this turn ---- */
      if (leg && showBoard) {
        for (const d of leg.darts) {
          const dx = CX + d.x * R, dy = CY + d.y * R;
          // the flight, then the shaft, then the point
          x.fillStyle = '#e8e0c8'; x.fillRect(dx + 3, dy - 5, 5, 5);
          x.fillStyle = '#8a8a92'; x.fillRect(dx, dy - 1, 5, 2);
          x.fillStyle = '#fff4d0'; x.fillRect(dx - 1, dy - 1, 2, 2);
        }
      }

      /* ---- the sights ---- */
      if (s.phase === 'aimX' || s.phase === 'aimY') {
        // where the across-sweep is, or where it stopped
        const ax = s.phase === 'aimX'
          ? Math.sin(s.sweep * Math.PI * 2) * 1.05 : s.aimX;
        x.fillStyle = s.phase === 'aimX' ? '#ffd24a' : '#6a5a2a';
        x.fillRect(Math.round(CX + ax * R), CY - R - 8, 1, (R + 8) * 2);
        if (s.phase === 'aimY') {
          const ay = Math.sin(s.sweep * Math.PI * 2) * 1.05;
          x.fillStyle = '#8fe8a0';
          x.fillRect(CX - R - 8, Math.round(CY + ay * R), (R + 8) * 2, 1);
          // and the point they cross, blinking
          if (Math.floor(t * 8) % 2) {
            x.fillStyle = '#fff3c4';
            x.fillRect(Math.round(CX + ax * R) - 1, Math.round(CY + ay * R) - 1, 3, 3);
          }
        }
      }

      /* ---- a dart in flight ---- */
      if (s.phase === 'fly' && !s.landed) {
        const k = Math.min(1, s.fly / 0.42);
        const dx = CX + s.aimX * R, dy = CY + s.aimY * R;
        const fx = Math.round(20 + (dx - 20) * k);
        const fy = Math.round(H - 14 + (dy - (H - 14)) * k);
        const sz = Math.round(7 - k * 3);
        x.fillStyle = '#e8e0c8'; x.fillRect(fx + 3, fy - 3, sz, sz);
        x.fillStyle = '#c8c8d0'; x.fillRect(fx, fy - 1, sz, 2);
      }

      /* ---- the scores ---- */
      const SX = 8;
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(SX - 2, 6, 96, 46);
      x.fillStyle = '#8a6a30'; x.fillRect(SX - 2, 6, 96, 1); x.fillRect(SX - 2, 51, 96, 1);
      /* Three letters each. "QUEBOLIUS" at scale 1 and "301" at scale 2 do
         not both fit on a ninety-pixel row, and they printed through each
         other. The log below already calls him HIM. */
      drawText(x, 'YOU', { x: SX + 2, y: 10, scale: 1, color: leg && leg.turn === 'you' ? GOLD_LT : '#8a7a52' });
      drawText(x, String(leg ? leg.you : DARTS.START), {
        x: SX + 90, y: 8, scale: 2, align: 'right',
        color: leg && leg.you <= 40 ? '#8fe8a0' : GOLD,
      });
      drawText(x, 'HIM', { x: SX + 2, y: 32, scale: 1, color: leg && leg.turn === 'him' ? '#ffb84a' : '#8a7a52' });
      drawText(x, String(leg ? leg.him : DARTS.START), {
        x: SX + 90, y: 30, scale: 2, align: 'right',
        color: leg && leg.him <= 40 ? '#ff8a7a' : '#c08078',
      });
      // whose throw it is, as an arrow rather than a word
      if (leg && !leg.over) {
        const ay2 = leg.turn === 'you' ? 12 : 34;
        x.fillStyle = Math.floor(t * 4) % 2 ? '#ffd24a' : '#8a6a30';
        x.fillRect(SX - 6, ay2, 1, 3); x.fillRect(SX - 7, ay2 + 1, 3, 1);
      }

      /* the three darts in hand */
      if (leg && !leg.over) {
        for (let i = 0; i < 3; i++) {
          const gone = i < leg.thrown;
          x.fillStyle = gone ? '#3a3020' : '#c8c8d0';
          x.fillRect(SX + i * 7, 56, 2, 9);
          x.fillStyle = gone ? '#4a4030' : '#e8e0c8';
          x.fillRect(SX + i * 7 - 1, 54, 4, 3);
        }
        drawText(x, 'DARTS', { x: SX + 24, y: 57, scale: 1, color: '#7a6a4a' });
      }

      /* the last few turns */
      if (leg && leg.log.length) {
        let ly = 72;
        for (const e of leg.log.slice(0, 5)) {
          const txt = `${e.who === 'you' ? 'YOU' : 'HIM'}  ${e.bust ? 'BUST' : e.scored}`;
          drawText(x, txt, {
            x: SX, y: ly, scale: 1,
            color: e.bust ? '#8a4a44' : (e.who === 'you' ? '#8a9a6a' : '#7a6a52'),
          });
          drawText(x, String(e.left), {
            x: SX + 58, y: ly, scale: 1, align: 'right', color: '#6a5a3a',
          });
          ly += 9;
        }
      }

      /* ---- the stake, before the first dart ---- */
      if (s.phase === 'stake') {
        // a plain wall to choose against, with the lamp still on it
        x.fillStyle = 'rgba(6,4,2,.55)'; x.fillRect(0, 0, W, H);
        const ty = Math.round(H / 2 - 40);
        stakeRows = stakeTray(x, W / 2, ty, 182, s.stake, coins, t, {
          kick: s.bump || 0, min: DARTS_MIN, max: DARTS_MAX,
          label: 'PLAY HIM FOR', accent: '#ffb84a',
          felt: '#2a1a0c', feltHi: '#3a2412', dim: '#c9a870', dim2: '#8a6a40',
          figure: GOLD_LT, rail: `MOST HE TAKES  ${DARTS_MAX}`,
        });
        // the pot, which is the whole reason you are choosing
        const pot = s.stake * 2;
        drawText(x, coins >= s.stake ? `THE POT IS ${pot}` : 'YOU CANNOT COVER IT', {
          x: W / 2, y: ty + 74, scale: 1, align: 'center',
          color: coins >= s.stake ? '#8fe8a0' : RED,
        });
      }

      /* ---- and the result ---- */
      if (s.phase === 'over' && leg) {
        const won = leg.over === 'you';
        const bw = 150, bh = 34;
        const bx = Math.round(W / 2 - bw / 2), by = Math.round(H * 0.72);
        x.fillStyle = 'rgba(8,5,3,.92)'; x.fillRect(bx, by, bw, bh);
        x.fillStyle = won ? '#8fe8a0' : '#c04a3a';
        x.fillRect(bx, by, bw, 1); x.fillRect(bx, by + bh - 1, bw, 1);
        drawText(x, won ? `YOU WIN ${s.stake * 2}` : `HE TAKES ${s.stake}`, {
          x: W / 2, y: by + 5, scale: 2, align: 'center',
          color: won ? (Math.floor(t * 8) % 2 ? '#fff3c4' : GOLD) : '#ff8a7a',
        });
        drawText(x, 'E  AGAIN     ESC  LEAVE IT', {
          x: W / 2, y: by + 24, scale: 1, align: 'center', color: '#8a7a52',
        });
      }

      /* ---- what he is saying ---- */
      {
        const lw = Math.min(W - 16, textWidth(s.line, 1));
        x.fillStyle = 'rgba(10,6,4,.88)';
        x.fillRect(6, H - 30, lw + 8, 12);
        x.fillStyle = '#ffb84a'; x.fillRect(6, H - 30, 2, 12);
        drawText(x, s.line, { x: 11, y: H - 27, scale: 1, color: '#e8d0a8' });
      }

      /* ---- and the keys ---- */
      let hint;
      if (s.phase === 'stake') hint = 'UP DN  STAKE     E  THROW FIRST     ESC  LEAVE';
      else if (s.phase === 'aimX') hint = 'E  STOP THE LINE  (ACROSS)';
      else if (s.phase === 'aimY') hint = 'E  STOP THE LINE  (UP AND DOWN)';
      else if (s.phase === 'his') hint = '';
      else if (s.phase === 'over') hint = '';
      else hint = '';
      footer(x, W, H, hint);
      return stakeRows;
    },
    click(row, i, s, g, st) {
      if (row?.stakeUp) return this.key('ArrowUp', s, g, st);
      if (row?.stakeDown) return this.key('ArrowDown', s, g, st);
      return true;
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace') {
        if (s.phase === 'aimX' || s.phase === 'aimY' || s.phase === 'fly' || s.phase === 'his') {
          s.line = 'FINISH THE LEG. YOU PUT MONEY ON IT.';
          g.audio?.sfx('deny');
          return true;
        }
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (s.phase === 'stake') {
        const top = Math.min(DARTS_MAX, Math.max(DARTS_MIN, g.coins || 0));
        const set = (n) => {
          const v = Math.max(DARTS_MIN, Math.min(top, n));
          if (v === s.stake) { g.audio?.sfx('deny'); return true; }
          s.stake = v; s.bump = 1; g.audio?.sfx('select'); return true;
        };
        if (code === 'ArrowUp' || code === 'KeyW') return set(s.stake + 5);
        if (code === 'ArrowDown' || code === 'KeyS') return set(s.stake - 5);
        if (code === 'ArrowRight') return set(s.stake + 1);
        if (code === 'ArrowLeft') return set(s.stake - 1);
        if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
          if ((g.coins || 0) < s.stake) {
            s.line = 'NO TABS. NOT FOR DARTS EITHER.';
            g.audio?.sfx('deny'); return true;
          }
          g.dartsStake?.(s.stake);
          s.leg = DARTS.newLeg(s.stake);
          s.phase = 'aimX';
          s.sweep = 0;
          s.line = 'STRAIGHT IN. DOUBLE OUT. YOUR THROW.';
          g.audio?.sfx('confirm');
          return true;
        }
        return true;
      }
      if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
        if (s.phase === 'aimX') {
          s.aimX = Math.sin(s.sweep * Math.PI * 2) * 1.05;
          s.phase = 'aimY';
          s.sweep = 0;
          g.audio?.sfx('select');
          return true;
        }
        if (s.phase === 'aimY') {
          s.aimY = Math.sin(s.sweep * Math.PI * 2) * 1.05;
          s.phase = 'fly';
          s.fly = 0;
          s.landed = false;
          g.audio?.sfx('throw');
          return true;
        }
        if (s.phase === 'over') {
          const keep = s.stake;
          SCREENS.mpDarts.init(s, g);
          s.stake = Math.max(DARTS_MIN, Math.min(g.coins || 0, keep));
          s.line = 'AGAIN, THEN.';
          return true;
        }
      }
      return true;
    },
  },

  /* ---------------- A CHORE THAT IS ACTUALLY A TASK ---------------- */
  mpMinigame: {
    init(s, g) {
      const G = MINIGAMES[s.game];
      s.rng = mulberryLocal((s.seed || 1) * 2654435761);
      s.done = false;
      s.doneT = 0;
      G?.init?.(s, s.rng);
    },
    draw(x, W, H, s, g, t) {
      const G = MINIGAMES[s.game];
      const dt = Math.min(0.05, s.t - (s._last ?? s.t));
      s._last = s.t;

      const b = frame(x, W, H, s.title || G?.name || 'WORK',
        s.hard ? 'STORM DAMAGE - THIS ONE IS WORSE' : null);
      if (!G) { footer(x, W, H, 'ESC'); return []; }

      let rows = [];
      if (!s.done) {
        s.sfx = s.sfx || ((n) => g.audio?.sfx(n));
        rows = G.draw.call(G, x, W, H, s, t, dt) || [];
        footer(x, W, H, `${G.hint}   ESC WALK AWAY`);
      } else {
        // it lands, rather than the window simply closing
        s.doneT += dt;
        const k = Math.min(1, s.doneT / 0.45);
        const r = Math.round(6 + k * 90);
        x.strokeStyle = `rgba(126,200,80,${(1 - k).toFixed(2)})`;
        x.lineWidth = 2;
        x.beginPath(); x.arc(W / 2, H / 2, r, 0, Math.PI * 2); x.stroke();
        drawText(x, 'DONE', {
          x: W / 2, y: H / 2 - 10, scale: k < 0.4 ? 3 : 2, align: 'center',
          color: k < 0.4 ? '#ffffff' : JADE,
        });
        footer(x, W, H, '');
      }
      // a strip showing this is one step of possibly several
      if (s.step && s.steps > 1) {
        for (let i = 0; i < s.steps; i++) {
          const mx = W - 22 - (s.steps - 1 - i) * 10;
          x.fillStyle = i < s.step ? JADE : '#3a2a10';
          x.fillRect(mx, 13, 7, 4);
        }
      }
      return rows;
    },
    key(code, s, g, st) {
      if (s.done) return true;
      if (code === 'Escape') { st.pop(); g.afterOverlayClose(); g.cancelMinigame?.(); return true; }
      const G = MINIGAMES[s.game];
      /* Minigames get a way to make a noise. They should not know about the
         game object, so they are handed one function. */
      s.sfx = s.sfx || ((n) => g.audio?.sfx(n));
      if (G?.key && G.key.call(G, code, s)) this._win(s, g, st);
      return true;
    },
    click(row, i, s, g, st) {
      if (s.done) return true;
      const G = MINIGAMES[s.game];
      s.sfx = s.sfx || ((n) => g.audio?.sfx(n));
      if (G?.click && G.click.call(G, row, i, s)) this._win(s, g, st);
      return true;
    },
    _win(s, g, st) {
      s.done = true;
      s.doneT = 0;
      g.audio?.sfx('confirm');
      setTimeout(() => {
        if (st.name === 'mpMinigame') { st.pop(); g.afterOverlayClose(); }
        g.finishMinigame?.(s.taskId);
      }, 620);
    },
  },

  /* ---------------- SABOTAGE CONSOLE ---------------- */
  mpSabotage: {
    init(s) { s.sel = s.sel || 0; s.pull = 0; s.arm = 0; },
    draw(x, W, H, s, g, t) {
      const defs = Object.values(SABOTAGE_DEFS);
      const d = defs[s.sel] || defs[0];
      const cool = g.mp.cool || {};
      const now = performance.now() / 1000;
      const left = (id) => Math.max(0, (cool[id] || 0) - now);
      const sab = g.mp.view.sabotage;
      if (s.pull > 0) s.pull = Math.max(0, s.pull - 0.035);
      const locked = (def) => left(def.id) > 0 || !!sab;

      /* ---- the terminal itself ---- */
      x.fillStyle = '#0c0303'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#0c0303', '#170606', 0.5, 2);
      // a beam sweeping down the tube
      const sweep = ((t * 46) % (H + 70)) - 35;
      for (let i = 0; i < 26; i++) {
        const yy = Math.round(sweep + i);
        if (yy < 0 || yy >= H) continue;
        x.fillStyle = `rgba(190,44,32,${(0.055 * (1 - i / 26)).toFixed(3)})`;
        x.fillRect(0, yy, W, 1);
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, y, W, 1); }

      // frame with riveted corners
      x.fillStyle = '#8a2018';
      x.fillRect(6, 6, W - 12, 1); x.fillRect(6, H - 7, W - 12, 1);
      x.fillRect(6, 6, 1, H - 13); x.fillRect(W - 7, 6, 1, H - 13);
      for (const [rx, ry] of [[6, 6], [W - 10, 6], [6, H - 10], [W - 10, H - 10]]) {
        x.fillStyle = RED; x.fillRect(rx, ry, 4, 4);
        x.fillStyle = '#3a0e0b'; x.fillRect(rx + 1, ry + 1, 2, 2);
      }

      drawText(x, 'SABOTAGE', { x: 14, y: 11, scale: 2, color: RED });
      const alive = [...g.mp.view.players.values()].filter((p) => p.alive !== false).length;
      drawText(x, sab ? 'ONE IS ALREADY RUNNING' : 'ISLAND NOMINAL', {
        x: W - 14, y: 10, scale: 1, align: 'right', color: sab ? '#ff6a5a' : '#6a8a5a',
      });
      drawText(x, `${alive} STILL BREATHING`, { x: W - 14, y: 20, scale: 1, align: 'right', color: '#8a5a52' });
      x.fillStyle = '#5a1a14'; x.fillRect(14, 31, W - 28, 1);

      /* ---- left: the rack of switches ---- */
      const LX = 14, LW = 106, ROW = 17;
      let y = 38;
      const rows = [];
      defs.forEach((def, i) => {
        const on = i === s.sel;
        const cd = left(def.id);
        const off = locked(def);
        if (on) {
          x.fillStyle = off ? '#2a1210' : '#4a1410';
          x.fillRect(LX, y - 1, LW, ROW - 2);
          x.fillStyle = off ? '#6a3a34' : RED;
          x.fillRect(LX, y - 1, 2, ROW - 2);
        }
        drawSabotageIcon(x, def.id, LX + 5, y, 13, on && !off, t);
        // short names, because the status column owns the right of the row
        const tag = cd > 0 ? `${Math.ceil(cd)}` : (def.fatal ? 'FATAL' : 'READY');
        // trimmed against the tag that sits to its right, not against a guess
        let nm2 = def.short || def.name;
        const room2 = LW - 22 - textWidth(tag, 1) - 14;
        while (nm2.length > 3 && textWidth(nm2, 1) > room2) nm2 = nm2.slice(0, -1);
        drawText(x, nm2, { x: LX + 22, y: y + 1, scale: 1,
          color: off ? '#6a4a44' : (on ? '#ffd8ce' : '#a86a60') });
        drawText(x, tag, { x: LX + LW - 9, y: y + 1, scale: 1, align: 'right',
          color: cd > 0 ? '#7a5a54' : (def.fatal ? '#ff6a5a' : '#5f8a4a') });
        // a little indicator lamp that blinks when ready
        x.fillStyle = off ? '#3a1a16'
          : (Math.floor(t * 2 + i) % 2 ? '#ff6a5a' : '#8a2018');
        x.fillRect(LX + LW - 6, y + 2, 3, 3);
        rows.push({ x: LX, y: y - 1, w: LW, h: ROW - 2, pick: i });
        y += ROW;
      });

      /* ---- right: what the selected switch does ----
         It gets the full height of the panel now that the lever has moved
         out of it. */
      const RX = LX + LW + 8, RW = W - RX - 14;
      const RB = H - 26;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(RX, 38, RW, RB - 38);
      x.fillStyle = locked(d) ? '#4a2a26' : '#8a2018';
      x.fillRect(RX, 38, RW, 1); x.fillRect(RX, RB - 1, RW, 1);
      x.fillRect(RX, 38, 1, RB - 38); x.fillRect(RX + RW - 1, 38, 1, RB - 38);

      /* The right-hand panel is a set of bands with a hard floor. The prose
         used to be allowed to run down until it hit an arbitrary number,
         which on the longer descriptions put it straight through the timings
         and the plot underneath. */
      const PLOT_H = 54;
      const FIG_TOP = RB - PLOT_H - 6;          // where the figures begin
      const PROSE_END = FIG_TOP - 5;            // and the hard floor for prose

      drawSabotageIcon(x, d.id, RX + RW / 2 - 14, 42, 28, !locked(d), t);
      let by = 72;
      for (const ln of wrapText(d.name, RW - 12, 1, 1)) {
        drawText(x, ln, { x: RX + RW / 2, y: by, scale: 1, align: 'center', color: '#ffd8ce' });
        by += 10;
      }
      x.fillStyle = '#5a1a14'; x.fillRect(RX + 8, by + 1, RW - 16, 1);
      by += 6;

      /* One list, drawn top-down until it runs out of room.

         The previous version reserved space for the tell by moving it up,
         which on a long description put it above the divider and straight
         through the name. Now the lines simply queue: the tell is first in
         the queue because what gives you away is the most useful thing on
         the panel, then as much of the description as fits. Nothing is ever
         drawn outside the band. */
      const lines = [];
      if (d.tell) for (const ln of wrapText(d.tell.toUpperCase(), RW - 12, 1, 1)) {
        lines.push({ t: ln, c: '#8fb0c8' });
      }
      if (d.tell) lines.push({ t: '', c: null });
      for (const ln of wrapText(d.blurb.toUpperCase(), RW - 12, 1, 1)) {
        lines.push({ t: ln, c: '#e2b0a4' });
      }
      for (const L of lines) {
        if (by + 8 > PROSE_END) break;
        if (L.t) drawText(x, L.t, { x: RX + 6, y: by, scale: 1, color: L.c });
        by += L.t ? 9 : 4;
      }

      /* ---- where it has to be put right, plotted rather than listed ----
         A list of place names tells you nothing about how far apart they
         are. This is the island with the repair points on it, so you can
         see at a glance whether pulling this one splits the island in half
         or sends everybody to the same corner. */
      const WHERE = {
        camp: 'THE FIRE', hut: "FERDI'S", wreck: 'THE WRECK',
        pend1: 'W PENDULUM', pend2: 'RIDGE PENDULUM',
        pend3: 'E PENDULUM', pend4: 'N PENDULUM',
      };
      const spots = (d.fixAt || []).map((k) => WHERE[k] || k.toUpperCase());
      const PLOT = PLOT_H;
      const plx = RX + RW - PLOT - 5, ply = FIG_TOP;
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(plx, ply, PLOT, PLOT);
      x.fillStyle = '#4a1a16';
      x.fillRect(plx, ply, PLOT, 1); x.fillRect(plx, ply + PLOT - 1, PLOT, 1);
      x.fillRect(plx, ply, 1, PLOT); x.fillRect(plx + PLOT - 1, ply, 1, PLOT);
      {
        // the island as a lumpy ring
        const pcx = plx + PLOT / 2, pcy = ply + PLOT / 2, pr = PLOT / 2 - 4;
        x.strokeStyle = 'rgba(170,80,70,.55)'; x.lineWidth = 1;
        x.beginPath();
        for (let i = 0; i <= 26; i++) {
          const a2 = (i / 26) * Math.PI * 2;
          const rr = pr * (0.92 + Math.sin(a2 * 3 + 0.7) * 0.06);
          const qx = pcx + Math.cos(a2) * rr, qy = pcy + Math.sin(a2) * rr;
          if (i === 0) x.moveTo(qx, qy); else x.lineTo(qx, qy);
        }
        x.closePath(); x.stroke();
        x.fillStyle = 'rgba(90,30,26,.35)'; x.fill();
        // and the points, blinking
        const sites = g.sabotageSites?.(d.id) || [];
        const K = pr / 205;
        for (const st2 of sites) {
          const qx = Math.round(pcx + st2.x * K), qy = Math.round(pcy + st2.z * K);
          const on = Math.floor(t * 3) % 2 === 0;
          x.fillStyle = on ? '#ff8a7a' : '#8a2018';
          x.fillRect(qx - 3, qy - 1, 7, 3);
          x.fillRect(qx - 1, qy - 3, 3, 7);
        }
        if (!sites.length) {
          drawText(x, 'ISLAND-WIDE', {
            x: pcx, y: pcy - 3, scale: 1, align: 'center', color: '#c08078',
          });
        }
      }

      /* the numbers, to the left of the plot */
      let fy = FIG_TOP + 4;
      const NW = plx - RX - 12;
      drawText(x, `RUNS ${d.secs}S`, { x: RX + 6, y: fy, scale: 1, color: '#c08078' });
      fy += 9;
      drawText(x, `COOLS ${d.cooldown}S`, { x: RX + 6, y: fy, scale: 1, color: '#7a4a44' });
      fy += 9;
      drawText(x, d.sites > 1 ? `${d.sites} POINTS` : 'ONE POINT', {
        x: RX + 6, y: fy, scale: 1, color: '#7a4a44',
      });
      fy += 11;
      for (const ln of wrapText(spots.join(', '), NW, 1, 1).slice(0, 3)) {
        drawText(x, ln, { x: RX + 6, y: fy, scale: 1, color: '#8a5a52' });
        fy += 9;
      }

      /* ---- the lever ----
         Under the rack, in the left column, directly beneath the switch you
         have selected. It used to hang off the right-hand edge of the panel
         where it sat on top of the plot and ran down past the panel into the
         key hints — the one control on the screen and it was the worst
         placed thing on it.

         It is a caged handle you drag, or hold E on. */
      {
        /* Right of centre in the well, so the label beside it has clear
           room — centred, the knob at the top of its travel printed over
           the word telling you what it is. */
        const LVX = LX + Math.round(LW * 0.70);
        const LVY = 38 + defs.length * ROW + 10; // straight under the rack
        const LVH = Math.min(46, (H - 34) - LVY);
        // the cage
        x.fillStyle = '#1a0605'; x.fillRect(LX, LVY, LW, LVH);
        x.fillStyle = '#5a1a14';
        x.fillRect(LX, LVY, LW, 1); x.fillRect(LX, LVY + LVH - 1, LW, 1);
        x.fillRect(LX, LVY, 1, LVH); x.fillRect(LX + LW - 1, LVY, 1, LVH);
        // hazard stripes down the throat
        const THROAT = LVH - 16;
        for (let i = 0; i < THROAT; i += 6) {
          x.fillStyle = (i / 6) % 2 ? 'rgba(200,160,42,.26)' : 'rgba(40,10,8,.6)';
          x.fillRect(LVX - 6, LVY + 8 + i, 12, Math.min(6, THROAT - i));
        }
        // what it is for
        drawText(x, locked(d) ? 'COOLING' : 'THROW', {
          x: LX + 6, y: LVY + 6, scale: 1,
          color: locked(d) ? '#6a3a34' : (Math.floor(t * 3) % 2 ? RED : '#8a3a34'),
        });
        if (!locked(d)) {
          drawText(x, 'IT', {
            x: LX + 6, y: LVY + 16, scale: 1,
            color: Math.floor(t * 3) % 2 ? RED : '#8a3a34',
          });
        }

        const pull = Math.max(s.pull || 0, s.drag || 0);
        const top = LVY + 8;
        const knobY = Math.round(top + pull * (THROAT - 9));
        // the shaft, and the knob
        x.fillStyle = '#8a9096'; x.fillRect(LVX - 2, top, 4, knobY - top + 4);
        const hot = pull > 0.7;
        x.fillStyle = locked(d) ? '#4a2a26' : (hot ? '#ff6a5a' : '#c03a2c');
        x.fillRect(LVX - 9, knobY, 19, 9);
        x.fillStyle = locked(d) ? '#6a3a34' : (hot ? '#ffd8ce' : '#e06a58');
        x.fillRect(LVX - 9, knobY, 19, 2);
        x.fillStyle = '#7a1810'; x.fillRect(LVX - 9, knobY + 7, 19, 2);
        s.leverBox = { x: LX, y: LVY, w: LW, h: LVH, top, throwLen: THROAT - 9 };

        // sparks once it is most of the way down
        if (pull > 0.55 && !locked(d)) {
          for (let i = 0; i < 6; i++) {
            const a2 = (t * 40 + i * 13) % 1;
            x.fillStyle = i % 2 ? '#ffd8a0' : '#ff8a4a';
            x.fillRect(
              Math.round(LVX - 9 + a2 * 19 + Math.sin(t * 31 + i) * 4),
              Math.round(knobY + 8 + a2 * 8), 2, 2
            );
          }
        }
        // and the contact it closes at the bottom
        x.fillStyle = pull > 0.8 ? '#ffd8ce' : '#3a1a16';
        x.fillRect(LVX - 7, LVY + LVH - 6, 15, 3);
      }

      /* a hazard band across the header when the fatal one is selected */
      if (d.fatal && !locked(d)) {
        /* Across the top, above both columns, on a band of its own — not
           printed over the divider where the rack starts. */
        for (let hx = 8; hx < W - 8; hx += 8) {
          x.fillStyle = (hx / 8) % 2 ? 'rgba(200,160,42,.55)' : 'rgba(120,20,14,.75)';
          x.fillRect(hx, 25, 8, 3);
        }
        /* On the divider's own row, not over the header. Printed at y = 22 it
           sat squarely on "N STILL BREATHING" in the top right. */
        if (Math.floor(t * 2) % 2 === 0) {
          const warn = 'THIS ONE ENDS THE ROUND IF IT RUNS OUT';
          const ww = textWidth(warn, 1) + 10;
          x.fillStyle = 'rgba(12,3,3,.94)';
          x.fillRect(Math.round(W / 2 - ww / 2), 29, ww, 10);
          drawText(x, warn, { x: W / 2, y: 31, scale: 1, align: 'center', color: '#ffd24a' });
        }
      }

      footer(x, W, H, locked(d)
        ? 'UP DOWN CHOOSE      Q OR ESC AWAY'
        : 'UP DOWN CHOOSE   DRAG THE LEVER OR HOLD E   Q OR ESC AWAY');
      return rows;
    },

    /** The lever is a handle. Drag it down and it throws. */
    pointer(kind, cx, cy, s, g, st) {
      const box = s.leverBox;
      if (!box) return false;
      if (kind === 'down') {
        if (cx < box.x || cx > box.x + box.w || cy < box.y || cy > box.y + box.h) return false;
        s.dragging = true; s.dragFrom = cy; s.drag = 0;
        return true;
      }
      if (!s.dragging) return false;
      if (kind === 'move') {
        s.drag = Math.max(0, Math.min(1, (cy - s.dragFrom) / box.throwLen));
        return true;
      }
      s.dragging = false;
      const far = s.drag >= 0.8;
      s.drag = 0;
      if (far) SCREENS.mpSabotage._throw(s, g, st);
      else g.audio?.sfx('select');
      return true;
    },

    /** Throw the selected switch, if it can be thrown. */
    _throw(s, g, st) {
      const defs = Object.values(SABOTAGE_DEFS);
      const d = defs[s.sel];
      if (!d) return;
      const cool = g.mp.cool || {};
      const nowS = performance.now() / 1000;
      if ((cool[d.id] || 0) > nowS || g.mp.view.sabotage) { g.audio?.sfx('deny'); return; }
      s.pull = 1;
      g.sendSabotage(d.id);
      g.audio?.sfx('slam');
      st.pop();
      g.afterOverlayClose();
    },

    key(code, s, g, st) {
      const defs = Object.values(SABOTAGE_DEFS);
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + defs.length - 1) % defs.length; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % defs.length; g.audio?.sfx('select'); return true; }
      if (code === 'Escape' || code === 'Backspace') { st.pop(); g.afterOverlayClose(); return true; }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        const def = defs[s.sel];
        const cd = Math.max(0, ((g.mp.cool || {})[def.id] || 0) - performance.now() / 1000);
        if (cd > 0 || g.mp.view.sabotage) { g.audio?.sfx('deny'); return true; }
        s.pull = 1;
        g.sendSabotage(def.id);
        setTimeout(() => { if (st.name === 'mpSabotage') { st.pop(); g.afterOverlayClose(); } }, 300);
        return true;
      }
      return true;
    },

    click(row, i, s, g, st) {
      if (row && row.pick !== undefined && row.pick !== s.sel) {
        s.sel = row.pick; g.audio?.sfx('select'); return true;
      }
      this.key('Enter', s, g, st);
      return true;
    },
  },

  /* ---------------- BODY FOUND ---------------- */
  mpBodyFound: {
    draw(x, W, H, s, g, t) {
      /* A hard cut to red, a shape on the ground and a name. It runs for a
         couple of seconds before the council, so the meeting starts with
         everyone having seen the same thing. */
      const k = Math.min(1, s.t / 0.14);
      const beat = s.t;

      x.fillStyle = '#120403'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#120403', '#1e0605', 0.5, 2);
      // a pulse of red from the middle
      const pr = 30 + Math.sin(beat * 4) * 8;
      for (let i = 6; i >= 0; i--) {
        x.fillStyle = `rgba(150,20,14,${(0.05 * k).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H / 2 + 8, pr + i * 16, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.36)'; x.fillRect(0, y, W, 1); }

      // the body, in silhouette, in its own mess
      const cx = W / 2, cy = H / 2 + 16;
      x.fillStyle = '#5a0d07';
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const r = 16 + ((i * 7) % 13);
        x.fillRect(Math.round(cx + Math.cos(a) * r) - 2, Math.round(cy + Math.sin(a) * r * 0.4) - 1, 5, 3);
      }
      x.fillStyle = '#7d1109';
      x.fillRect(cx - 26, cy - 5, 52, 11);
      x.fillStyle = '#0b0f14';
      x.fillRect(cx - 18, cy - 4, 30, 8);            // torso
      x.fillRect(cx + 12, cy - 7, 8, 8);             // head
      x.fillRect(cx - 24, cy - 1, 8, 3);             // legs
      x.fillRect(cx - 8, cy + 4, 12, 3);             // an arm thrown out

      // the words, arriving hard
      if (beat > 0.10) {
        const kk = Math.min(1, (beat - 0.10) / 0.16);
        drawText(x, 'BODY FOUND', {
          x: W / 2, y: 40, scale: kk < 0.5 ? 3 : 2, align: 'center',
          color: kk < 0.5 ? '#ffffff' : RED,
        });
      }
      if (beat > 0.45) {
        drawText(x, (s.who || '?').toUpperCase(), {
          x: W / 2, y: 62, scale: 1, align: 'center', color: GOLD_LT,
        });
      }
      if (beat > 0.85) {
        drawText(x, `${(s.by || '?').toUpperCase()} RAISED THE ALARM`, {
          x: W / 2, y: H - 40, scale: 1, align: 'center', color: DIM,
        });
      }
      if (beat > 1.4 && Math.floor(beat * 2) % 2 === 0) {
        drawText(x, 'EVERYONE TO THE FIRE', {
          x: W / 2, y: H - 26, scale: 1, align: 'center', color: '#8a5a52',
        });
      }
      return [];
    },
    key() { return true; },
  },

  /* ---------------- EXILE ---------------- */
  mpExile: {
    init(s, g) { s.beat = -1; },
    draw(x, W, H, s, g, t) {
      /* Five beats. The verdict, the walk, the water closing, a held
         silence, and only then what they actually were. The silence is the
         part that does the work — an instant reveal has no stakes in it. */
      const T = { verdict: 0.0, walk: 1.1, splash: 2.7, hold: 3.3, reveal: 5.0 };
      const at = (k) => s.t >= T[k];
      const since = (k) => s.t - T[k];

      const sea = Math.round(H * 0.62);
      // sky: bruise-dark, lifting a little at the horizon
      for (let yy = 0; yy < sea; yy++) {
        const k = yy / sea;
        const v = Math.round(5 + k * k * 46);
        x.fillStyle = `rgb(${Math.round(v * 0.55)},${Math.round(v * 0.7)},${v})`;
        x.fillRect(0, yy, W, 1);
      }
      ditherRect(x, 0, 0, W, sea, 'rgba(0,0,0,0)', 'rgba(0,0,0,.30)', 0.5, 2);

      // sea
      for (let yy = sea; yy < H; yy++) {
        const k = (yy - sea) / (H - sea);
        const r = Math.round(18 - k * 13), gg = Math.round(42 - k * 32), bl = Math.round(78 - k * 58);
        x.fillStyle = `rgb(${r},${gg},${bl})`;
        x.fillRect(0, yy, W, 1);
      }
      x.fillStyle = '#7fa8c4'; x.fillRect(0, sea, W, 1);
      for (let i = 0; i < 9; i++) {
        const yy = sea + 4 + i * 7;
        if (yy > H - 3) break;
        const off = Math.round(Math.sin(t * 1.1 + i * 1.7) * (10 + i * 3));
        const w = 26 - i * 2;
        x.fillStyle = `rgba(150,190,215,${(0.32 - i * 0.03).toFixed(2)})`;
        x.fillRect((((i * 71 + off) % W) + W) % W, yy, w, 1);
      }

      // the figure, walked to the edge and dropped
      if (s.targetId && at('walk')) {
        const k = Math.min(1, since('walk') / (T.splash - T.walk));
        const fx = Math.round(W * 0.22 + k * W * 0.28);
        const fy = sea - 16 + Math.round(k * 4);
        const drop = at('splash') ? Math.min(1, since('splash') / 0.5) : 0;
        const dy = Math.round(drop * drop * 34);
        if (drop < 1) {
          x.fillStyle = '#0b0f14';
          x.fillRect(fx - 2, fy + dy, 5, 11);          // body
          x.fillRect(fx - 1, fy - 4 + dy, 3, 4);       // head
          const sw = Math.sin(k * 22) * 2;
          x.fillRect(fx - 4 + sw, fy + 3 + dy, 2, 5);  // arms
          x.fillRect(fx + 3 - sw, fy + 3 + dy, 2, 5);
        }
      }
      // the splash, and the rings going out
      if (at('splash')) {
        const k = Math.min(1, since('splash') / 1.4);
        const cx2 = Math.round(W * 0.5), cy2 = sea + 8;
        for (let i = 0; i < 3; i++) {
          const rk = Math.max(0, k - i * 0.16);
          if (rk <= 0 || rk >= 1) continue;
          const rr = Math.round(4 + rk * 40);
          x.fillStyle = `rgba(190,225,240,${(0.5 * (1 - rk)).toFixed(2)})`;
          x.fillRect(cx2 - rr, cy2, rr * 2, 1);
          x.fillRect(cx2 - Math.round(rr * 0.5), cy2 - 1, rr, 1);
        }
      }

      /* ---- the words ---- */
      drawText(x, s.targetId ? 'THE COUNCIL HAS DECIDED' : 'THE COUNCIL COULD NOT AGREE', {
        x: W / 2, y: 22, scale: 1, align: 'center', color: DIM,
      });
      if (!s.targetId) {
        drawText(x, 'NOBODY GOES IN THE WATER', {
          x: W / 2, y: 40, scale: 2, align: 'center', color: GOLD_LT,
        });
      } else {
        drawText(x, (s.who || '?').toUpperCase(), {
          x: W / 2, y: 36, scale: 2, align: 'center', color: GOLD_LT,
        });
        drawText(x, 'THROWN TO THE SEA', {
          x: W / 2, y: 56, scale: 1, align: 'center', color: '#8a7a52',
        });
      }

      // the held silence, then the verdict
      if (s.targetId) {
        if (at('hold') && !at('reveal')) {
          const dots = 1 + (Math.floor((s.t - T.hold) * 2.2) % 3);
          drawText(x, '.'.repeat(dots), {
            x: W / 2, y: 76, scale: 2, align: 'center', color: '#5a4a34',
          });
        }
        if (at('reveal')) {
          const k = Math.min(1, since('reveal') / 0.3);
          const good = s.wasAgent;
          const col = good ? JADE : RED;
          const label = good ? 'THEY WERE A ROGUE AGENT' : 'THEY WERE NOT A ROGUE AGENT';
          // a plate slams down behind the verdict
          const w = Math.min(W - 24, textWidth(label, 1) + 24);
          const hh = Math.round(20 * (0.4 + k * 0.6));
          const bx = Math.round((W - w) / 2), by = Math.round(70 + (20 - hh) / 2);
          x.fillStyle = good ? '#0d2a20' : '#2a0a08';
          x.fillRect(bx, by, w, hh);
          x.fillStyle = col;
          x.fillRect(bx, by, w, 1); x.fillRect(bx, by + hh - 1, w, 1);
          if (k > 0.5) {
            drawText(x, label, { x: W / 2, y: by + 6, scale: 1, align: 'center',
              color: k < 0.7 ? '#ffffff' : col });
          }
          if (s.beat !== 1) { s.beat = 1; g.audio?.sfx(good ? 'victory' : 'deny'); }
        } else if (at('splash') && s.beat !== 0) {
          s.beat = 0; g.audio?.sfx('splat');
        }
      }

      const left = [...g.mp.view.players.values()].filter((p) => p.alive !== false).length;
      drawText(x, `${left} STILL ASHORE`, { x: W / 2, y: sea - 12, scale: 1, align: 'center', color: DIM });
      return [];
    },
    key() { return true; },
  },

  /* ---------------- GAME OVER ---------------- */
  mpEnd: {
    draw(x, W, H, s, g, t) {
      const win = s.winner === 'castaways';
      x.fillStyle = win ? '#04120c' : '#160404';
      x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, win ? '#04120c' : '#160404', win ? '#071c12' : '#200707', 0.5, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, y, W, 1); }

      drawText(x, s.winner ? (win ? 'THE CASTAWAYS' : 'THE ROGUE AGENTS') : 'GAME OVER', {
        x: W / 2, y: 22, scale: 2, align: 'center', color: win ? '#8fe8c8' : '#ff6a5a',
      });
      if (s.winner) drawText(x, 'WIN', { x: W / 2, y: 42, scale: 2, align: 'center', color: GOLD });
      x.fillStyle = win ? '#2f6a5c' : '#8a2018';
      x.fillRect(W / 2 - 80, 62, 160, 1);
      drawText(x, s.reason || '', { x: W / 2, y: 68, scale: 1, align: 'center', color: GOLD_LT });

      /* Everybody's role, revealed. Half the fun of losing is finding out
         how close you were. */
      const agents = new Set(s.agents || []);
      const players = [...g.mp.view.players.values()];
      let y = 86;
      for (const p of players) {
        const wasAgent = agents.has(p.name);
        x.fillStyle = colourOf(p.colour); x.fillRect(W / 2 - 92, y, 7, 7);
        drawText(x, p.name || '?', { x: W / 2 - 80, y, scale: 1, color: GOLD_LT });
        drawText(x, wasAgent ? 'ROGUE AGENT' : 'CASTAWAY', {
          x: W / 2 - 4, y, scale: 1, color: wasAgent ? '#ff6a5a' : '#8fb0c8',
        });
        drawText(x, p.alive === false ? 'LOST' : 'ALIVE', {
          x: W / 2 + 92, y, scale: 1, align: 'right', color: p.alive === false ? '#6a5c40' : JADE,
        });
        y += 10;
      }

      const rows = menuList(x, ['BACK TO THE BEACH'], s.sel, W / 2, H - 34, t, { width: 150 });
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 1, () => location.reload());
    },
  },


  /* ---------------- TITLE ---------------- */
  title: {
    draw(x, W, H, s, g, t) {
      // the idol renders behind; scrim only the left third
      const grad = Math.round(W * 0.52);
      for (let i = 0; i < grad; i++) {
        const a = 0.86 * (1 - i / grad);
        x.fillStyle = `rgba(6,4,2,${a.toFixed(3)})`;
        x.fillRect(i, 0, 1, H);
      }
      x.fillStyle = 'rgba(0,0,0,.30)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

      const L = 14;
      drawText(x, 'THE LEGEND OF', { x: L, y: 30, scale: 1, color: DIM });
      drawText(x, 'ILLIC', { x: L, y: 42, scale: 4, color: GOLD_LT });
      drawText(x, 'ISLE', { x: L, y: 74, scale: 4, color: GOLD });
      // rule
      x.fillStyle = GOLD_DK; x.fillRect(L, 106, 108, 2);
      x.fillStyle = GOLD; x.fillRect(L + 108, 105, 4, 4);
      drawText(x, 'THE IDOL OF ILLIC ISLE', { x: L, y: 114, scale: 1, color: GOLD });

      const rows = menuList(x, ['PLAY', 'CONTROLS', 'OPTIONS', 'THE LEGEND'],
        s.sel, L + 66, 136, t, { width: 132 });
      drawText(x, '(C) 1998 SCHWAB TECHNOLOGY', { x: L, y: H - 22, scale: 1, color: '#6a5c40' });
      if (Math.floor(t * 1.5) % 2 === 0) {
        drawText(x, 'PRESS ENTER', { x: L, y: H - 13, scale: 1, color: GOLD });
      }
      /* The castaway story is still in here, but it is not the front door
         any more. Holding shift on PLAY takes you to it, and the hint only
         appears once you are sitting on PLAY. */
      if (s.sel === 0) {
        drawText(x, 'SHIFT+ENTER  THE OLD STORY', {
          x: L, y: H - 32, scale: 1,
          color: Math.floor(t * 2) % 2 ? '#6a5c40' : '#4a4030',
        });
      }
      return rows;
    },
    key(code, s, g, st, mods) {
      /* PLAY is Castaways. That is the game now; the single-player hunt for
         the Idol is the thing that was here first and it is kept on a key
         combination rather than given half the front page. */
      if ((code === 'Enter' || code === 'KeyE' || code === 'Space') && s.sel === 0
          && mods && mods.shift) {
        menuFlash();
        g.screens.clear();
        g.beginGame();
        return true;
      }
      return nav(code, s, 4, (i) => {
        if (i === 0) g.screens.replace('mpMenu');
        else if (i === 1) g.screens.push('controls');
        else if (i === 2) g.screens.push('options');
        else g.screens.push('lore');
      });
    },
  },

  /* ---------------- THE LEGEND (lore codex) ---------------- */
  lore: {
    init(s, g) { s.page = 0; },
    draw(x, W, H, s, g, t) {
      const L = LORE_PAGES[s.page];
      const b = frame(x, W, H, 'THE LEGEND', `${s.page + 1} / ${LORE_PAGES.length}`);
      drawText(x, L.title, { x: W / 2, y: b.top + 2, scale: 1, align: 'center', color: GOLD });
      let y = b.top + 16;
      for (const ln of wrapText(L.text, W - 44, 1, 1)) {
        drawText(x, ln, { x: 22, y, scale: 1, color: GOLD_LT });
        y += 9;
      }
      if (L.icon) drawRelicIcon(x, L.icon, W - 52, b.bottom - 44, 32, Math.sin(t * 2) * 0.4);
      footer(x, W, H, '< > TURN PAGE   ESC BACK');
      return [];
    },
    key(code, s, g, st) {
      if (code === 'ArrowLeft' || code === 'KeyA') { s.page = (s.page + LORE_PAGES.length - 1) % LORE_PAGES.length; return true; }
      if (code === 'ArrowRight' || code === 'KeyD' || code === 'Enter' || code === 'KeyE') {
        s.page = (s.page + 1) % LORE_PAGES.length; return true;
      }
      if (code === 'Escape' || code === 'Tab') { st.pop(); return true; }
      return true;
    },
  },

  /* ---------------- CONTROLS ---------------- */
  controls: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'CONTROLS');
      const rows = [
        ['W A S D', 'MOVE'], ['MOUSE', 'LOOK'], ['SHIFT', 'SPRINT'],
        ['SPACE', 'JUMP'], ['E', 'INTERACT'], ['CLICK', 'THROW COCONUT'],
        ['M', 'MAP'], ['TAB', 'JOURNAL'], ['C', 'VIEW'], ['ESC', 'PAUSE'],
      ];
      let y = b.top + 2;
      for (const [k, v] of rows) {
        drawText(x, k, { x: W / 2 - 8, y, scale: 1, align: 'right', color: GOLD });
        drawText(x, v, { x: W / 2 + 8, y, scale: 1, color: GOLD_LT });
        y += 11;
      }
      drawText(x, 'COCONUTS GROW UNDER THE PALMS.', {
        x: W / 2, y: y + 4, scale: 1, align: 'center', color: DIM,
      });
      footer(x, W, H, 'ESC BACK');
      return [];
    },
    key(code, s, g, st) { if (code === 'Escape' || code === 'Enter' || code === 'KeyE') st.pop(); return true; },
  },

  /* ---------------- OPTIONS ---------------- */
  options: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'OPTIONS');
      const O = OPTION_DEFS;
      let y = b.top + 2;
      const rows = [];
      O.forEach((o, i) => {
        const on = i === s.sel;
        if (on) { x.fillStyle = '#3a2a10'; x.fillRect(16, y - 3, W - 32, 12); }
        drawText(x, o.label, { x: 22, y, scale: 1, color: on ? GOLD_LT : DIM });
        const cur = o.get(g);
        const vi = o.values.findIndex((v) => String(v.v) === String(cur));
        const name = vi >= 0 ? o.values[vi].n : '?';
        drawText(x, `< ${name} >`, { x: W - 22, y, scale: 1, align: 'right', color: on ? GOLD : DIM });
        rows.push({ x: 16, y: y - 3, w: W - 32, h: 12 });
        y += 13;
      });
      footer(x, W, H, 'UP DOWN SELECT   < > CHANGE   ESC BACK');
      return rows;
    },
    key(code, s, g, st) {
      const O = OPTION_DEFS;
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + O.length - 1) % O.length; return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % O.length; return true; }
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Enter' || code === 'KeyE') {
        const o = O[s.sel];
        const cur = String(o.get(g));
        let vi = o.values.findIndex((v) => String(v.v) === cur);
        if (vi < 0) vi = 0;
        vi = (vi + (code === 'ArrowLeft' ? o.values.length - 1 : 1)) % o.values.length;
        o.set(g, o.values[vi].v);
        g.applySettings();
        g.audio?.sfx('select');
        return true;
      }
      if (code === 'Escape') { st.pop(); return true; }
      return true;
    },
  },

  /* ---------------- PAUSE ---------------- */
  pause: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'PAUSED');
      const rows = menuList(x, ['RESUME', 'JOURNAL', 'MAP', 'CONTROLS', 'OPTIONS', 'QUIT TO TITLE'],
        s.sel, W / 2, b.top + 10, t, { width: 140 });
      const mm = String(Math.floor(g.runTime / 60)).padStart(2, '0');
      const ss = String(Math.floor(g.runTime % 60)).padStart(2, '0');
      drawText(x, `TIME ${mm}:${ss}`, { x: W / 2, y: H - 28, scale: 1, align: 'center', color: DIM });
      footer(x, W, H, 'ESC RESUME');
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 6, (i) => {
        if (i === 0) g.pause(false);
        else if (i === 1) st.push('journal');
        else if (i === 2) g.openChart();
        else if (i === 3) st.push('controls');
        else if (i === 4) st.push('options');
        else g.quitToTitle();
      }, () => g.pause(false));
    },
  },

  /* ---------------- JOURNAL ---------------- */
  journal: {
    init(s, g) { s.entries = g.journalEntries(); s.sel = 0; s.scroll = 0; },
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, "CASTAWAY'S JOURNAL", `${s.sel + 1} / ${s.entries.length}`);
      const e = s.entries[s.sel];
      drawText(x, e.found ? e.title : 'NOT YET FOUND', {
        x: W / 2, y: b.top, scale: 1, align: 'center', color: e.found ? GOLD : '#6a5c40',
      });
      x.fillStyle = '#4a3a1c';
      x.fillRect(20, b.top + 11, W - 40, 1);

      const body = e.found ? e.text : e.hint;
      const lines = [];
      for (const para of String(body).split('\n')) {
        if (!para.trim()) { lines.push(''); continue; }
        lines.push(...wrapText(para, W - 46, 1, 1));
      }
      const visible = Math.floor((b.bottom - b.top - 24) / 9);
      s.scroll = Math.max(0, Math.min(s.scroll, Math.max(0, lines.length - visible)));
      let y = b.top + 17;
      for (let i = s.scroll; i < Math.min(lines.length, s.scroll + visible); i++) {
        drawText(x, lines[i], { x: 23, y, scale: 1, color: e.found ? GOLD_LT : '#7a6a48' });
        y += 9;
      }
      if (lines.length > visible) {
        const barH = Math.max(6, (visible / lines.length) * (b.bottom - b.top - 20));
        const barY = b.top + 17 + (s.scroll / lines.length) * (b.bottom - b.top - 20);
        x.fillStyle = '#3a2a10'; x.fillRect(W - 17, b.top + 16, 3, b.bottom - b.top - 18);
        x.fillStyle = GOLD_DK; x.fillRect(W - 17, barY, 3, barH);
      }
      footer(x, W, H, '< > ENTRY   UP DOWN SCROLL   TAB CLOSE');
      return [];
    },
    key(code, s, g, st) {
      const n = s.entries.length;
      if (code === 'ArrowLeft' || code === 'KeyA') { s.sel = (s.sel + n - 1) % n; s.scroll = 0; return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { s.sel = (s.sel + 1) % n; s.scroll = 0; return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { s.scroll = Math.max(0, s.scroll - 1); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.scroll += 1; return true; }
      if (code === 'Tab' || code === 'Escape') { st.pop(); g.afterOverlayClose(); return true; }
      return true;
    },
  },

  /* ---------------- THE MAP ---------------- */
  chart: {
    draw(x, W, H, s, g, t) {
      /* It unrolls. Two rods part and the paper comes out between them,
         with the roll still visible at each edge until it is fully open —
         a panel that simply grows reads as a dialog box, not a chart
         somebody has been carrying in their shirt. */
      const k = Math.min(1, s.t / 0.40);
      const ease = 1 - Math.pow(1 - k, 3);

      x.fillStyle = `rgba(6,4,2,${(0.86 * Math.min(1, k * 2)).toFixed(3)})`;
      x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

      const m = 10;
      const fullH = H - m * 2;
      const openH = Math.max(2, Math.round(fullH * ease));
      const top = Math.round(m + (fullH - openH) / 2);
      const PW = W - m * 2;

      // the paper
      ditherRect(x, m, top, PW, openH, '#d8c69a', PAPER, 0.5, 1);
      // a soft curl of shadow at each rolled edge
      for (let i = 0; i < 5; i++) {
        const a2 = (0.16 - i * 0.03).toFixed(3);
        x.fillStyle = `rgba(90,64,28,${a2})`;
        x.fillRect(m, top + i, PW, 1);
        x.fillRect(m, top + openH - 1 - i, PW, 1);
      }
      // the rods
      const rod = (ry) => {
        x.fillStyle = '#4a3418'; x.fillRect(m - 3, ry - 2, PW + 6, 5);
        x.fillStyle = '#6b4c22'; x.fillRect(m - 3, ry - 2, PW + 6, 1);
        x.fillStyle = '#2a1c0c'; x.fillRect(m - 5, ry - 3, 3, 7);
        x.fillRect(m + PW + 2, ry - 3, 3, 7);
      };
      rod(top - 1);
      rod(top + openH);

      if (k < 0.82) return [];

      // and the chart itself, once there is room for it
      const alpha = Math.min(1, (k - 0.82) / 0.18);
      x.save();
      x.globalAlpha = alpha;
      const title = s.data?.agentSide ? "MAP  -  ROGUE AGENTS' COPY" : 'MAP OF ILLIC ISLE';
      drawText(x, title, { x: W / 2, y: top + 5, scale: 1, align: 'center', color: '#3f2f14' });
      x.fillStyle = '#8a6a34';
      x.fillRect(m + 10, top + 15, PW - 20, 1);
      const b = { top: top + 21, bottom: top + openH - 12 };
      const size = Math.min(W - 34, b.bottom - b.top - 12);
      const ox = Math.round((W - size) / 2), oy = b.top + 1;

      /* Zoom and pan live on the screen, not the data, so opening the map
         again puts you back where you were looking. Panning is clamped to
         the island so you cannot lose it off the edge. */
      s.zoom = s.zoom || 1;
      if (s.cx === undefined) {
        // first open: centred on you, not on the origin
        s.cx = s.data?.player?.x || 0;
        s.cz = s.data?.player?.z || 0;
      }
      const R = s.data?.radius || 200;
      const reach = R * (1 - 1 / s.zoom);
      s.cx = Math.max(-reach, Math.min(reach, s.cx));
      s.cz = Math.max(-reach, Math.min(reach, s.cz));
      if (s.zoom <= 1) { s.cx = 0; s.cz = 0; }
      /* A map with no chart behind it is a blank map, not a crash. It only
         happens if something pushes this screen without data, but a screen
         that throws takes the whole frame with it. */
      if (!s.data) {
        drawText(x, 'NO CHART', {
          x: W / 2, y: oy + size / 2, scale: 2, align: 'center', color: DIM,
        });
        footer(x, W, H, 'ESC  CLOSE');
        return [];
      }
      s.data.zoom = s.zoom;
      s.data.cx = s.cx;
      s.data.cz = s.cz;
      s.data._size = size;
      drawChart(x, ox, oy, size, s.data, t);
      /* The pendulum tally belongs to the single-player hunt. Castaways
         puts its own marks on this chart — the listening post — and used
         to inherit "ALL FOUR READ" underneath them. */
      /* On the paper, above its bottom rod — printed at b.bottom it landed
         squarely on the key hints underneath. */
      const subY = oy + size + 3;
      if (s.data.marks.length && !s.subtitle) {
        const left = s.data.marks.filter((mk) => !mk.found).length;
        drawText(x, left ? `${left} PENDULUM${left === 1 ? '' : 'S'} STILL UNREAD` : 'ALL FOUR READ',
          { x: W / 2, y: subY, scale: 1, align: 'center', color: left ? '#7a2418' : '#2f6a4a' });
      } else if (s.subtitle) {
        drawText(x, s.subtitle, { x: W / 2, y: subY, scale: 1, align: 'center', color: '#2f6a4a' });
      }
      x.restore();
      footer(x, W, H, s.zoom > 1
        ? '+ -  ZOOM     ARROWS  PAN     C  CENTRE ON YOU     M  CLOSE'
        : '+  ZOOM IN     M OR TAB  CLOSE');
      return [];
    },
    key(code, s, g, st) {
      const R = s.data?.radius || 200;
      const step = () => (R / (s.zoom || 1)) * 0.22;
      if (code === 'Equal' || code === 'NumpadAdd' || code === 'KeyZ') {
        if (s.zoom < 5) {
          // zooming in from the wide view starts on you
          if (s.zoom === 1) { s.cx = s.data?.player?.x || 0; s.cz = s.data?.player?.z || 0; }
          s.zoom = Math.min(5, (s.zoom || 1) + 1);
          g.audio?.sfx('select');
        }
        return true;
      }
      if (code === 'Minus' || code === 'NumpadSubtract' || code === 'KeyX') {
        s.zoom = Math.max(1, (s.zoom || 1) - 1);
        g.audio?.sfx('select');
        return true;
      }
      if (code === 'KeyC') {
        s.cx = s.data?.player?.x || 0; s.cz = s.data?.player?.z || 0;
        g.audio?.sfx('confirm');
        return true;
      }
      if (code === 'ArrowLeft' || code === 'KeyA') { s.cx -= step(); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { s.cx += step(); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { s.cz -= step(); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.cz += step(); return true; }
      if (code === 'KeyM' || code === 'Escape' || code === 'Tab' || code === 'KeyF') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
    /** Drag to pan, and the wheel is handled by the game's own listener. */
    pointer(kind, cx, cy, s) {
      if (kind === 'down') { s._drag = [cx, cy]; return true; }
      if (kind === 'move' && s._drag) {
        const R = s.data?.radius || 200;
        const size = Math.min((s.data?._size || 180), 400);
        const perPx = (R / (s.zoom || 1)) / (size / 2);
        s.cx -= (cx - s._drag[0]) * perPx;
        s.cz -= (cy - s._drag[1]) * perPx;
        s._drag = [cx, cy];
        return true;
      }
      if (kind === 'up') { s._drag = null; return true; }
      return false;
    },
  },

  /* ---------------- FERDI'S SHOP ---------------- */
  shop: {
    init(s) { s.sel = s.sel || 0; s.shake = 0; },
    draw(x, W, H, s, g, t) {
      if (s.shake > 0) s.shake -= 0.016;
      const jitter = s.shake > 0 ? Math.round(Math.sin(s.shake * 60) * 2) : 0;
      const b = frame(x, W, H, "FERDI STEINMAN'S SUPPLIES");

      // Ferdi himself, drawn in the corner
      drawFerdiPortrait(x, 16, b.top + 2, t);
      const bubbleX = 58;
      panel(x, bubbleX, b.top + 2, W - bubbleX - 16, 26, { border: 1, dither: 0.35 });
      const quip = FERDI_LINES[Math.floor(t / 4) % FERDI_LINES.length];
      let qy = b.top + 7;
      for (const ln of wrapText(quip, W - bubbleX - 26, 1, 1).slice(0, 2)) {
        drawText(x, ln, { x: bubbleX + 5, y: qy, scale: 1, color: GOLD_LT }); qy += 9;
      }

      // purse
      drawRelicIcon(x, 'coin', W - 44, b.top + 32, 14);
      drawText(x, `${g.coins}`, { x: W - 18, y: b.top + 35, scale: 1, align: 'right', color: GOLD });

      const rows = [];
      let y = b.top + 50;
      g.shopStock().forEach((it, i) => {
        const on = i === s.sel;
        const bx = 16 + (on ? jitter : 0);
        panel(x, bx, y, W - 32, 22, {
          border: 2, dither: on ? 0.6 : 0.35,
          hi: it.owned ? '#2f5a48' : (on ? GOLD : GOLD_DK),
          lo: '#241708',
        });
        drawText(x, it.name, { x: bx + 6, y: y + 4, scale: 1, color: it.owned ? '#7a9a8c' : (on ? GOLD_LT : DIM) });
        drawText(x, it.desc, { x: bx + 6, y: y + 13, scale: 1, color: '#8a7a52' });
        drawText(x, it.owned ? 'SOLD' : `${it.cost}`, {
          x: bx + W - 38, y: y + 8, scale: 1, align: 'right',
          color: it.owned ? JADE : (g.coins >= it.cost ? GOLD : RED),
        });
        if (!it.owned) drawRelicIcon(x, 'coin', bx + W - 34, y + 4, 12);
        rows.push({ x: bx, y, w: W - 32, h: 22 });
        y += 25;
      });
      /* There is no Schlarna reader in the castaway story — Ferdi has not
         been sold one yet. (This line was collateral from the same edit that
         added it to the Castaways counter, and it threw the moment the
         single-player shop opened.) */
      footer(x, W, H, 'UP DOWN CHOOSE   E BUY   ESC LEAVE');
      return rows;
    },
    key(code, s, g, st) {
      const stock = g.shopStock();
      return nav(code, s, stock.length,
        () => { if (!g.buy(stock[s.sel].id)) s.shake = 0.28; },
        () => { st.pop(); g.afterOverlayClose(); });
    },
  },

  /* ---------------- READER ---------------- */
  reader: {
    init(s) { s.shown = 0; s.done = false; s.scroll = 0; },
    draw(x, W, H, s, g, t) {
      const full = String(s.body);
      s.shown = Math.min(full.length, s.shown + 2);
      s.done = s.shown >= full.length;

      const boxH = Math.min(H - 24, 116);
      const top = H - boxH - 8;
      panel(x, 8, top, W - 16, boxH, { border: 2, dither: 0.30, hi: '#f4e8c4', lo: '#7a5a24', fill: '#d8c79a', fill2: '#e6d6ac' });

      drawText(x, s.head, { x: 15, y: top + 6, scale: 1, color: '#6b4a18', shadowColor: '#e6d6ac' });
      x.fillStyle = '#a8946a'; x.fillRect(14, top + 16, W - 28, 1);

      const shownText = full.slice(0, s.shown);
      const lines = [];
      for (const para of shownText.split('\n')) {
        if (!para.trim()) { lines.push(''); continue; }
        lines.push(...wrapText(para, W - 34, 1, 1));
      }
      const visible = Math.floor((boxH - 34) / 9);
      const start = Math.max(0, lines.length - visible);
      let y = top + 22;
      for (let i = start; i < lines.length; i++) {
        drawText(x, lines[i], { x: 16, y, scale: 1, color: INK, shadow: false });
        y += 9;
      }
      if (s.done && Math.floor(t * 2) % 2 === 0) {
        drawText(x, 'E', { x: W - 18, y: top + boxH - 11, scale: 1, color: '#6b4a18', shadow: false });
      }
      return [];
    },
    key(code, s, g, st) {
      if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
        if (!s.done) { s.shown = String(s.body).length; s.done = true; return true; }
        st.pop();
        s.onDone?.();
        g.afterOverlayClose();
        return true;
      }
      return true;
    },
  },

  /* ---------------- DIAL PUZZLE ---------------- */
  dials: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'THE SEALED DOOR');
      if (s.shake > 0) s.shake -= 0.016;
      const jit = s.shake > 0 ? Math.round(Math.sin(s.shake * 70) * 3) : 0;

      drawText(x, 'RECORDED FROM THE PENDULUMS', { x: W / 2, y: b.top, scale: 1, align: 'center', color: DIM });
      drawText(x, g.knownGlyphHint(), { x: W / 2, y: b.top + 11, scale: 1, align: 'center', color: JADE });

      const GW = 36, GAP = 8;
      const total = 4 * GW + 3 * GAP;
      const left = Math.round((W - total) / 2) + jit;
      const y = b.top + 30;
      const rows = [];
      for (let i = 0; i < 4; i++) {
        const bx = left + i * (GW + GAP);
        const on = i === g.dialSel;
        panel(x, bx, y, GW, GW + 10, { border: 2, dither: on ? 0.6 : 0.3, hi: on ? GOLD : GOLD_DK });
        drawGlyphPixels(x, GLYPH_NAMES[g.dialState[i]], bx + 3, y + 3, GW - 6, on ? GOLD_LT : '#c8a94a');
        drawText(x, ['I', 'II', 'III', 'IV'][i], {
          x: bx + GW / 2, y: y + GW + 1, scale: 1, align: 'center', color: on ? GOLD : DIM,
        });
        if (on) {
          drawText(x, '^', { x: bx + GW / 2, y: y - 8, scale: 1, align: 'center', color: GOLD });
          drawText(x, 'v', { x: bx + GW / 2, y: y + GW + 11, scale: 1, align: 'center', color: GOLD });
        }
        rows.push({ x: bx, y, w: GW, h: GW + 10 });
      }
      footer(x, W, H, '< > SOCKET   UP DOWN GLYPH   E CONFIRM   ESC BACK');
      return rows;
    },
    key(code, s, g, st) {
      if (code === 'ArrowLeft' || code === 'KeyA') { g.dialSel = (g.dialSel + 3) % 4; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { g.dialSel = (g.dialSel + 1) % 4; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { g.cycleDial(1); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { g.cycleDial(-1); return true; }
      if (code === 'KeyE' || code === 'Enter') { if (!g.submitDials()) s.shake = 0.3; return true; }
      if (code === 'Escape') { st.pop(); g.afterOverlayClose(); return true; }
      return true;
    },
  },

  /* ---------------- DEATH ---------------- */
  death: {
    draw(x, W, H, s, g, t) {
      x.fillStyle = 'rgba(30,4,2,.88)'; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,.4)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);
      const wob = Math.round(Math.sin(t * 4) * 1);
      drawText(x, 'YOU DIED', { x: W / 2 + wob, y: H / 2 - 34, scale: 3, align: 'center', color: '#c8352a' });
      drawText(x, s.sub || '', { x: W / 2, y: H / 2 - 6, scale: 1, align: 'center', color: '#c9a89a' });
      const rows = menuList(x, ['WASH ASHORE AGAIN', 'QUIT TO TITLE'], s.sel, W / 2, H / 2 + 14, t, { width: 130 });
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 2, (i) => { if (i === 0) g.respawn(); else g.quitToTitle(); });
    },
  },

  /* ---------------- ENDING ---------------- */
  ending: {
    draw(x, W, H, s, g, t) {
      x.fillStyle = '#100a04'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        const a = (i * 2.399 + t * 0.2);
        const r = (i % 20) * 6 + 10;
        x.fillStyle = i % 3 ? 'rgba(255,210,74,.12)' : 'rgba(255,240,180,.2)';
        x.fillRect(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * 0.6, 1, 1);
      }
      drawText(x, 'YOU FOUND IT', { x: W / 2, y: 22, scale: 1, align: 'center', color: GOLD });
      drawText(x, 'THE IDOL OF', { x: W / 2, y: 36, scale: 2, align: 'center', color: GOLD_LT });
      drawText(x, 'KING ILLIC', { x: W / 2, y: 54, scale: 2, align: 'center', color: GOLD });

      const st2 = s.stats || {};
      drawText(x, st2.time || '00:00.00', { x: W / 2, y: 78, scale: 2, align: 'center', color: GOLD_LT });
      let y = 100;
      for (const [k, v] of (st2.rows || [])) {
        drawText(x, k, { x: W / 2 - 6, y, scale: 1, align: 'right', color: DIM });
        drawText(x, v, { x: W / 2 + 6, y, scale: 1, color: GOLD_LT });
        y += 10;
      }
      const rows = menuList(x, ['PLAY AGAIN', 'COPY BRAG', 'TITLE'], s.sel, W / 2, y + 8, t, { width: 120 });
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 3, (i) => {
        if (i === 0) g.beginGame();
        else if (i === 1) g.copyBrag();
        else g.quitToTitle();
      });
    },
  },
};

/* ===========================================================
   CONTENT
   =========================================================== */
export const LORE_PAGES = [
  {
    title: 'ILLIC ISLE',
    text: `A rock in a warm sea that nobody visits twice.\n\nIt was named for the man who owned it, and he owned it the way a fist owns a coin.`,
  },
  {
    title: 'KING ILLIC',
    text: `He ruled badly and at length.\n\nHe took a third of everything anyone grew, and when the wells failed he took a third of the water too. He built no roads. He built one temple, and he built it for himself.`,
    icon: 'coin',
  },
  {
    title: 'SYNERGY HOLDINGS',
    text: `Before the king there was a company.\n\nThey dug here for something they never named, paid the diggers in their own coin, and left so completely that only the coins remain.`,
    icon: 'syncoin',
  },
  {
    title: 'THE ROGUE AGENTS',
    text: `They came at night and they came for him.\n\nNobody agrees who sent them. They ended the king, sealed what was left of him in gold, and buried the gold under his own temple.\n\nThen they built four Pendulums to mark the way, and stayed, and grew old.`,
  },
  {
    title: 'TASHA — UNIT 03',
    text: `The Agents did not come alone.\n\nOne of them was not a person. She is still on the west shore, and her optic still flickers about once a minute, which is worse than if it did not.`,
    icon: 'tasha',
  },
  {
    title: 'HECTOR',
    text: `The king's brother.\n\nHe arrived eleven years ago, killed every Rogue Agent on the island, found a staff that makes food out of nothing, and sat down on top of his brother's corpse.\n\nHe has not been hungry since. He calls the temple his LAYER.`,
    icon: 'watermelon',
  },
  {
    title: 'AND YOU',
    text: `The storm took the ship, the crew, and most of your good sense.\n\nIt did not take the reason you came.`,
    icon: 'aerlingus',
  },
];

const FERDI_LINES = [
  '"Everything here fell off a boat. Some of it twice."',
  '"No refunds. Not because of policy. Because of physics."',
  '"You want the boots? Everyone wants the boots."',
  '"I have been open eleven years. You are the fourth."',
  '"Do not go in the temple. You are going in the temple."',
];

export const GLYPH_NAMES = ['SUN', 'MOON', 'EYE', 'SPIRAL'];

const OPTION_DEFS = [
  { label: 'MOUSE SENS', values: [{ v: 0.9, n: 'LOW' }, { v: 1.4, n: 'NORMAL' }, { v: 2.1, n: 'HIGH' }, { v: 3.0, n: 'V.HIGH' }],
    get: (g) => g.settings.sens, set: (g, v) => (g.settings.sens = v) },
  { label: 'INVERT LOOK', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.invert, set: (g, v) => (g.settings.invert = v) },
  { label: 'RESOLUTION', values: [{ v: 180, n: '240x180' }, { v: 224, n: '320x224' }, { v: 320, n: '427x320' }, { v: 0, n: 'NATIVE' }],
    get: (g) => g.settings.res, set: (g, v) => (g.settings.res = v) },
  { label: 'VERTEX JITTER', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.jitter, set: (g, v) => (g.settings.jitter = v) },
  { label: 'CRT / DITHER', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.crt, set: (g, v) => (g.settings.crt = v) },
  { label: 'FOLIAGE', values: [{ v: 0.55, n: 'LOW' }, { v: 1, n: 'NORMAL' }, { v: 1.45, n: 'LUSH' }],
    get: (g) => g.settings.density, set: (g, v) => (g.settings.density = v) },
  { label: 'DAY LENGTH', values: [{ v: 360, n: '6 MIN' }, { v: 240, n: '4 MIN' }, { v: 600, n: '10 MIN' }, { v: 99999, n: 'ALWAYS DAY' }],
    get: (g) => g.DAY_LEN, set: (g, v) => (g.DAY_LEN = v) },
  /* The old walk is kept in the code, not just in the history, so it can
     be put back without a build. WEIGHTED has knees, hip sway and
     counter-rotation; PLAIN is the original pendulum. */
  { label: 'WALK CYCLE', values: [{ v: 'weighted', n: 'WEIGHTED' }, { v: 'plain', n: 'PLAIN' }],
    get: (g) => (g.settings.walk || 'weighted'),
    set: (g, v) => { g.settings.walk = v; g.applyWalkStyle?.(); } },
  { label: 'AUDIO', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.audio, set: (g, v) => (g.settings.audio = v) },
];

/* ===========================================================
   PIXEL GLYPHS (shared by dials and the chart)
   =========================================================== */

/** Hand-drawn 24px marks for the three sabotages. */
function drawSabotageIcon(x, kind, ox, oy, size, lit, t) {
  const u = size / 12;
  const p = (gx, gy, w, h, col) => {
    x.fillStyle = col;
    x.fillRect(Math.round(ox + gx * u), Math.round(oy + gy * u), Math.ceil(w * u), Math.ceil(h * u));
  };
  const hot = lit ? 1 : 0.45;
  const C = (a, b) => (lit ? a : b);

  if (kind === 'douse') {
    // a torch head with the flame guttering out
    p(5, 6, 2, 6, C('#8a6a3c', '#4a3a22'));
    p(4, 11, 4, 1, C('#6a4a28', '#3a2a18'));
    if (lit && Math.floor(t * 6) % 2 === 0) {
      p(5, 3, 2, 3, '#e0703a');
      p(5, 1, 2, 2, '#f0b050');
    } else {
      p(5, 4, 2, 2, C('#5a3a2a', '#3a2418'));
    }
    // smoke curling off
    const w = Math.sin(t * 3) * 1;
    p(5 + w, 0, 1, 1, C('#6a6a6a', '#3a3a3a'));
    p(6 - w, 2, 1, 1, C('#5a5a5a', '#333'));
  } else if (kind === 'storm') {
    // cloud with a bolt through it
    p(2, 3, 8, 3, C('#4a5a6a', '#2a323c'));
    p(3, 2, 6, 1, C('#5a6a7a', '#333c46'));
    p(1, 5, 10, 1, C('#3a4a5a', '#242c34'));
    for (let i = 0; i < 4; i++) {
      const rx = 2 + i * 2.4;
      p(rx, 7 + (i % 2), 1, 2, C('#7fa8c4', '#3a4a58'));
    }
    if (!lit || Math.floor(t * 4) % 2 === 0) {
      p(6, 6, 1, 3, C('#ffe07a', '#5a4a20'));
      p(5, 9, 2, 1, C('#ffe07a', '#5a4a20'));
      p(5, 10, 1, 2, C('#ffd24a', '#4a3c18'));
    }
  } else if (kind === 'blind') {
    // an eye with the fog rolling over it
    p(1, 5, 10, 1, C('#8fa0a8', '#3a444a'));
    p(2, 4, 8, 1, C('#8fa0a8', '#3a444a'));
    p(2, 6, 8, 1, C('#8fa0a8', '#3a444a'));
    p(4, 4, 4, 4, C('#d8e4e8', '#4a5458'));
    p(5, 5, 2, 2, C('#1a2024', '#12181c'));
    for (let i = 0; i < 4; i++) {
      const w = Math.sin(t * 2.2 + i) * 1.4;
      p(1 + w, 8 + i * 1.2, 10, 1, C('#7a8a92', '#333c42'));
    }
  } else if (kind === 'scatter') {
    // tools thrown across the floor
    const j = lit ? Math.sin(t * 6) * 0.6 : 0;
    p(1 + j, 2, 5, 1, C('#b0a488', '#4a463a'));
    p(5 + j, 3, 1, 3, C('#8a7a52', '#3c3626'));
    p(7, 5 - j, 4, 1, C('#b0a488', '#4a463a'));
    p(7, 6 - j, 1, 3, C('#8a7a52', '#3c3626'));
    p(2, 8 + j, 1, 3, C('#8a7a52', '#3c3626'));
    p(1, 10 + j, 4, 1, C('#b0a488', '#4a463a'));
    p(8, 9, 3, 3, C('#6a6a72', '#2e2e34'));
    p(9, 10, 1, 1, C('#c8c8d0', '#4a4a52'));
  } else {
    // a pendulum arrested mid-swing, with a bar jammed through it
    p(5, 0, 2, 1, C('#8a7a52', '#453d29'));
    p(6, 1, 1, 6, C('#8a7a52', '#453d29'));
    p(4, 7, 5, 4, C('#c39a2c', '#5f4c16'));
    p(5, 8, 3, 2, C('#ffd24a', '#7a6522'));
    const jitter = lit ? (Math.floor(t * 12) % 2 ? 1 : 0) : 0;
    p(1 + jitter, 5, 10, 1, C('#e0453a', '#6a2018'));
    p(1 + jitter, 6, 10, 1, C('#8a2018', '#3a100c'));
  }
}

export function drawGlyphPixels(x, name, ox, oy, size, color) {
  const u = size / 16;
  const px = (gx, gy, w = 1, h = 1) => x.fillRect(
    Math.round(ox + gx * u), Math.round(oy + gy * u), Math.ceil(w * u), Math.ceil(h * u));
  x.fillStyle = color;
  if (name === 'SUN') {
    px(6, 6, 4, 4);
    for (const [a, b] of [[7, 1], [7, 13], [1, 7], [13, 7]]) px(a, b, 2, 2);
    for (const [a, b] of [[3, 3], [11, 3], [3, 11], [11, 11]]) px(a, b, 2, 2);
  } else if (name === 'MOON') {
    for (let gy = 2; gy < 14; gy++) {
      const dy = gy - 8;
      const half = Math.sqrt(Math.max(0, 36 - dy * dy));
      const bx0 = Math.round(11 - Math.sqrt(Math.max(0, 30 - dy * dy)));
      for (let gx = Math.round(8 - half); gx < bx0; gx++) px(gx, gy);
    }
  } else if (name === 'EYE') {
    for (let gy = 5; gy < 11; gy++) {
      const tt = Math.abs(gy - 7.5) / 3;
      const half = Math.round(7 * (1 - tt * tt));
      if (half > 0) px(8 - half, gy, half * 2, 1);
    }
    x.fillStyle = '#1a1006'; px(6, 6, 4, 4);
    x.fillStyle = color; px(7, 7, 2, 2);
  } else if (name === 'SPIRAL') {
    const seen = new Set();
    for (let i = 0; i < 48; i++) {
      const a = i * 0.42, r = 0.8 + i * 0.135;
      const gx = Math.round(8 + Math.cos(a) * r), gy = Math.round(8 + Math.sin(a) * r);
      const k = gx + ',' + gy;
      if (seen.has(k) || gx < 0 || gy < 0 || gx > 15 || gy > 15) continue;
      seen.add(k); px(gx, gy);
    }
  }
}

/* ===========================================================
   THE MAP — drawn from the real height function
   =========================================================== */
/**
 * The island, drawn on paper.
 *
 * Three things it has to do that it did not. Zoom, because at one fixed
 * scale everything within thirty metres of anything else prints on top of
 * it. Place its labels against each other rather than blindly. And show
 * enough — contours, a scale, the shoreline, every place worth knowing —
 * to be worth opening.
 *
 * @param {object} data  needs heightAt and radius; everything else optional.
 *   `zoom` (1..4) and `cx`/`cz` (the world point at the centre) pan it.
 */
export function drawChart(x, ox, oy, S, data, t) {
  if (!data) return;
  const R = data.radius;
  const zoom = Math.max(1, Math.min(5, data.zoom || 1));
  const cx = data.cx || 0, cz = data.cz || 0;
  const span = R / zoom;                       // world half-extent on screen
  const half = S / 2 - 6;
  const toPx = (wx, wz) => [
    ox + S / 2 + ((wx - cx) / span) * half,
    oy + S / 2 + ((wz - cz) / span) * half,
  ];
  const onMap = (sx, sy) => sx > ox + 2 && sx < ox + S - 2 && sy > oy + 2 && sy < oy + S - 2;

  // parchment with a dithered grain
  ditherRect(x, ox, oy, S, S, '#d8c69a', PAPER, 0.5, 1);

  /* Land. Sampled coarsely so it reads as something drawn, with a finer
     step as you zoom in — there is no point sampling every two pixels of a
     view that only covers forty metres. */
  const STEP = zoom >= 3 ? 1 : 2;
  for (let py = 0; py < S; py += STEP) {
    for (let pxx = 0; pxx < S; pxx += STEP) {
      const wx = cx + ((pxx - S / 2) / half) * span;
      const wz = cz + ((py - S / 2) / half) * span;
      const h = data.heightAt(wx, wz);
      if (h < 0) continue;
      /* Seven bands, not four. With four the whole interior came out as
         one flat grey-green mass and the island had no shape on paper. */
      x.fillStyle = h < 1.2 ? '#d5c08a'
        : h < 3.0 ? '#c9b078'
        : h < 8 ? '#a8b070'
        : h < 16 ? '#8b9c62'
        : h < 24 ? '#758a54'
        : h < 33 ? '#647a4a'
        : h < 42 ? '#7e7a5e'
        : '#95907a';
      x.fillRect(ox + pxx, oy + py, STEP, STEP);
    }
  }

  /* Contours, so the interior has shape instead of being three flat
     greens. Drawn by testing whether a sample crosses a height band. */
  const BANDS = zoom >= 2 ? [4, 10, 18, 26, 34] : [10, 24];
  x.fillStyle = 'rgba(70,56,26,.20)';
  for (let py = 0; py < S; py += 1) {
    for (let pxx = 0; pxx < S; pxx += 1) {
      const wx = cx + ((pxx - S / 2) / half) * span;
      const wz = cz + ((py - S / 2) / half) * span;
      const h = data.heightAt(wx, wz);
      if (h < 0) continue;
      const wx2 = cx + ((pxx + 1 - S / 2) / half) * span;
      const h2 = data.heightAt(wx2, wz);
      for (const bnd of BANDS) {
        if ((h < bnd) !== (h2 < bnd)) { x.fillRect(ox + pxx, oy + py, 1, 1); break; }
      }
    }
  }

  // coast stipple, only worth drawing when the coast is in view
  if (zoom < 3) {
    x.fillStyle = 'rgba(70,52,26,.55)';
    for (let a = 0; a < Math.PI * 2; a += 0.012) {
      let rr = R;
      for (let r = R; r > 20; r -= 2) {
        if (data.heightAt(Math.cos(a) * r, Math.sin(a) * r) > 0) { rr = r; break; }
      }
      const [sx, sy] = toPx(Math.cos(a) * rr, Math.sin(a) * rr);
      if (onMap(sx, sy)) x.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    }
  }

  /* A grid, faint, in hundred-metre squares. Gives the eye something to
     measure against and makes the zoom legible. */
  x.fillStyle = 'rgba(90,64,28,.12)';
  const GRID = zoom >= 3 ? 25 : 50;
  for (let g0 = -Math.ceil(R / GRID) * GRID; g0 <= R; g0 += GRID) {
    const [gx] = toPx(g0, 0);
    const [, gy] = toPx(0, g0);
    if (gx > ox + 2 && gx < ox + S - 2) x.fillRect(Math.round(gx), oy + 2, 1, S - 4);
    if (gy > oy + 2 && gy < oy + S - 2) x.fillRect(ox + 2, Math.round(gy), S - 4, 1);
  }

  /* ---- labels are collected and placed at the end ---- */
  const labels = [];
  const label = (txt, sx, sy, col) => {
    if (!txt) return;
    labels.push({ txt, x: sx, y: sy, col: col || '#3f2f14' });
  };

  if (data.wreck) {
    const [sx, sy] = toPx(data.wreck.x, data.wreck.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a3a18';
      x.fillRect(sx - 4, sy, 9, 2); x.fillRect(sx + 1, sy - 4, 2, 5);
      label('WRECK', sx, sy + 5);
    }
  }
  // Ferdi's, marked as a shop rather than a place name
  if (data.shop) {
    const [sx, sy] = toPx(data.shop.x, data.shop.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a3a18';
      x.fillRect(sx - 6, sy - 2, 13, 7);
      x.fillStyle = '#8a5a24';
      x.fillRect(sx - 7, sy - 5, 15, 3);
      x.fillStyle = '#ffd24a';
      x.fillRect(sx - 2, sy, 5, 5);
      x.fillStyle = '#3a2410';
      x.fillRect(sx - 1, sy + 1, 3, 3);
      label("FERDI'S", sx, sy + 8, '#5a3a18');
    }
  }
  if (data.hut && !data.shop) {
    const [sx, sy] = toPx(data.hut.x, data.hut.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#6a5a48';
      x.fillRect(sx - 6, sy - 2, 13, 7); x.fillRect(sx - 7, sy - 5, 15, 3);
      x.fillStyle = '#3a2f22';
      for (let i = -6; i < 7; i += 3) x.fillRect(sx + i, sy - 2, 2, 7);
      label('SHUT', sx, sy + 8, '#6a5a48');
    }
  }
  /* The X, once somebody has found it. It is not on the chart before that:
     the whole thing is walking into it. */
  if (data.buried) {
    const [sx, sy] = toPx(data.buried.x, data.buried.z);
    if (onMap(sx, sy)) {
      const done = data.buried.taken;
      x.fillStyle = done ? '#5a5a4a' : '#8a1a10';
      for (let i = -4; i <= 4; i++) {
        x.fillRect(sx + i, sy + i, 2, 2);
        x.fillRect(sx + i, sy - i, 2, 2);
      }
      label(done ? 'DUG' : 'X', sx, sy + 7, done ? '#5a5a4a' : '#8a1a10');
    }
  }

  /* Cathy's stall. She is out on her own on the far side, so the map is the
     only reasonable way to find her — a striped parasol over a counter. */
  if (data.cathy) {
    const [sx, sy] = toPx(data.cathy.x, data.cathy.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a4020';
      x.fillRect(sx - 5, sy, 11, 3);              // the counter
      x.fillStyle = '#a83c34';
      x.fillRect(sx - 6, sy - 4, 13, 2);          // the parasol
      x.fillStyle = '#e0d4b0';
      x.fillRect(sx - 3, sy - 4, 2, 2); x.fillRect(sx + 2, sy - 4, 2, 2);
      x.fillStyle = '#5a4020';
      x.fillRect(sx, sy - 3, 1, 3);               // its pole
      label('CATHY', sx, sy + 6, '#8a2a22');
    }
  }
  // the Lucky Flopper, and her pier
  if (data.casino) {
    const [sx, sy] = toPx(data.casino.x, data.casino.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a2a44';
      x.fillRect(sx - 6, sy - 1, 13, 4);
      x.fillRect(sx - 3, sy - 5, 7, 4);
      x.fillStyle = Math.floor(t * 3) % 2 ? '#ff5aa8' : '#8a3a68';
      x.fillRect(sx - 2, sy - 7, 5, 2);
      label('FLOPPER', sx, sy + 6, '#7a2a54');
    }
  }
  if (data.rogue) {
    const [sx, sy] = toPx(data.rogue.x, data.rogue.z);
    if (onMap(sx, sy)) label('"ROGUE"', sx, sy, '#7a2418');
  }
  for (const m of data.marks) {
    const [sx, sy] = toPx(m.x, m.z);
    if (!onMap(sx, sy)) continue;
    const col = m.found ? '#2f6a4a' : '#8a2418';
    x.fillStyle = col;
    for (let i = -4; i <= 4; i++) { x.fillRect(sx + i, sy + i, 2, 2); x.fillRect(sx + i, sy - i, 2, 2); }
    if (!m.found && Math.floor(t * 2) % 2 === 0) {
      x.fillStyle = '#c02a1a';
      x.fillRect(sx - 6, sy - 6, 13, 1); x.fillRect(sx - 6, sy + 6, 13, 1);
      x.fillRect(sx - 6, sy - 6, 1, 13); x.fillRect(sx + 6, sy - 6, 1, 13);
    }
    label(m.label, sx, sy - 13, col);
    if (m.glyph) drawGlyphPixels(x, m.glyph, sx - 5, sy + 7, 11, '#2f6a4a');
  }
  for (const r of (data.relics || [])) {
    const [sx, sy] = toPx(r.x, r.z);
    if (!onMap(sx, sy)) continue;
    if (r.found) {
      drawRelicIcon(x, r.kind, sx - 6, sy - 6, 13);
    } else {
      x.fillStyle = '#6b4a8a';
      x.fillRect(sx - 3, sy - 4, 6, 2); x.fillRect(sx + 1, sy - 2, 2, 3);
      x.fillRect(sx - 1, sy + 1, 3, 2); x.fillRect(sx - 1, sy + 4, 3, 2);
    }
  }
  if (data.temple) {
    const [sx, sy] = toPx(data.temple.x, data.temple.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#4a3a1a';
      x.fillRect(sx - 6, sy - 1, 13, 6); x.fillRect(sx - 4, sy - 4, 9, 3); x.fillRect(sx - 2, sy - 6, 5, 2);
      x.fillStyle = '#1a1206'; x.fillRect(sx - 1, sy + 1, 3, 4);
      label('TEMPLE', sx, sy + 8);
    }
  }
  /* Castaways: your own chores, ticked as you go, and named once you are
     zoomed in far enough for the name to fit. */
  for (const j of (data.jobs || [])) {
    const [sx, sy] = toPx(j.x, j.z);
    if (!onMap(sx, sy)) continue;
    if (j.done) {
      x.fillStyle = '#2f6a4a';
      x.fillRect(sx - 3, sy, 2, 2); x.fillRect(sx - 1, sy + 2, 2, 2);
      x.fillRect(sx + 1, sy - 1, 2, 2); x.fillRect(sx + 3, sy - 3, 2, 2);
    } else {
      const pulse = Math.floor(t * 2) % 2 === 0;
      x.fillStyle = '#8a2418';
      x.fillRect(sx - 4, sy - 1, 9, 3); x.fillRect(sx - 1, sy - 4, 3, 9);
      if (pulse) {
        x.fillStyle = '#c02a1a';
        x.fillRect(sx - 6, sy - 6, 13, 1); x.fillRect(sx - 6, sy + 5, 13, 1);
        x.fillRect(sx - 6, sy - 6, 1, 12); x.fillRect(sx + 6, sy - 6, 1, 12);
      }
    }
    if (j.name && zoom >= 2) label(j.name, sx, sy + 7, j.done ? '#2f6a4a' : '#7a2418');
  }
  // where the current sabotage has to be put right
  for (const f of (data.fixes || [])) {
    const [sx, sy] = toPx(f.x, f.z);
    if (!onMap(sx, sy)) continue;
    const on = Math.floor(t * 3) % 2 === 0;
    x.fillStyle = on ? '#c02a1a' : '#7a2418';
    x.fillRect(sx - 5, sy - 1, 11, 3);
    x.fillRect(sx - 1, sy - 5, 3, 11);
    if (on) {
      x.fillStyle = '#ffd0c0';
      x.fillRect(sx - 8, sy - 8, 17, 1); x.fillRect(sx - 8, sy + 7, 17, 1);
      x.fillRect(sx - 8, sy - 8, 1, 16); x.fillRect(sx + 8, sy - 8, 1, 16);
    }
    label('REPAIR', sx, sy + 8, '#7a2418');
  }
  // ghosts get to watch the living move about
  for (const o of (data.others || [])) {
    const [sx, sy] = toPx(o.x, o.z);
    if (!onMap(sx, sy)) continue;
    x.fillStyle = '#000'; x.fillRect(sx - 3, sy - 3, 6, 6);
    x.fillStyle = '#' + (o.colour >>> 0).toString(16).padStart(6, '0');
    x.fillRect(sx - 2, sy - 2, 4, 4);
  }
  if (data.player) {
    const [sx, sy] = toPx(data.player.x, data.player.z);
    if (onMap(sx, sy)) {
      // a proper "you are here", with a heading pip
      x.fillStyle = '#c02a1a'; x.fillRect(sx - 3, sy - 3, 7, 7);
      x.fillStyle = '#fff'; x.fillRect(sx - 1, sy - 1, 3, 3);
      if (data.facing !== undefined) {
        const fx = sx + Math.sin(data.facing) * 7, fy = sy + Math.cos(data.facing) * 7;
        x.fillStyle = '#c02a1a'; x.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 3);
      }
    }
  }

  /* ---- and now the labels, none of them on top of each other ----
     Each is nudged down a row at a time until it has clear space. If it
     cannot find any within a few rows it is dropped rather than printed
     over something else. */
  const placed = [];
  for (const L of labels) {
    const w = textWidth(L.txt, 1);
    let lx = Math.round(Math.max(ox + 3, Math.min(ox + S - w - 3, L.x - w / 2)));
    let ly = Math.round(L.y);
    let ok = false;
    for (let tries = 0; tries < 7; tries++) {
      const clash = placed.some((r) => ly < r.y + 9 && r.y < ly + 9 && lx < r.x + r.w + 2 && r.x < lx + w + 2);
      if (!clash) { ok = true; break; }
      ly += 9;
      if (ly > oy + S - 10) { ly = Math.round(L.y) - 9 * (tries + 1); }
    }
    if (!ok || ly < oy + 2 || ly > oy + S - 9) continue;
    placed.push({ x: lx, y: ly, w });
    drawText(x, L.txt, { x: lx, y: ly, scale: 1, color: L.col, shadowColor: PAPER });
  }

  /* ---- furniture: compass rose, scale bar, the zoom you are at ---- */
  x.fillStyle = '#3f2f14';
  drawText(x, 'N', { x: ox + S - 12, y: oy + 5, scale: 1, align: 'center', color: '#3f2f14', shadowColor: PAPER });
  x.fillRect(ox + S - 13, oy + 14, 3, 8);
  x.fillRect(ox + S - 15, oy + 16, 7, 2);

  // a scale bar, so the zoom means something
  {
    const metres = zoom >= 3 ? 20 : (zoom >= 2 ? 50 : 100);
    const px = Math.round((metres / span) * half);
    const bx = ox + 8, by = oy + S - 10;
    x.fillStyle = '#3f2f14';
    x.fillRect(bx, by, px, 2);
    x.fillRect(bx, by - 3, 2, 8); x.fillRect(bx + Math.max(4, px) - 2, by - 3, 2, 8);
    drawText(x, `${metres}M`, {
      x: bx + Math.max(4, px) / 2, y: by - 12, scale: 1, align: 'center',
      color: '#3f2f14', shadowColor: PAPER,
    });
  }
  if (zoom > 1) {
    drawText(x, `x${zoom}`, {
      x: ox + S - 8, y: oy + S - 12, scale: 1, align: 'right',
      color: '#5a3a18', shadowColor: PAPER,
    });
  }

  x.fillStyle = '#5c3f1c';
  x.fillRect(ox, oy, S, 2); x.fillRect(ox, oy + S - 2, S, 2);
  x.fillRect(ox, oy, 2, S); x.fillRect(ox + S - 2, oy, 2, S);
}
