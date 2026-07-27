/* ===========================================================
   textures.js — every pixel in this game is drawn at runtime.
   No image files, nothing to download, nothing to 404 on Pages.
   Cells are 32x32 in a 256x256 atlas, which is roughly what a
   real PSX disc would have budgeted.
   =========================================================== */

import * as THREE from 'three';

/* ---------- tiny seeded RNG so the island looks the same twice ---------- */
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------- canvas helpers ---------- */
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return { c, x };
}

function hsl(h, s, l) { return `hsl(${h|0} ${s|0}% ${l|0}%)`; }

/** Blocky value noise fill — the bread and butter of every tile here. */
function noiseFill(x, ox, oy, w, h, hue, sat, light, spread, rng, block = 2) {
  for (let j = 0; j < h; j += block) {
    for (let i = 0; i < w; i += block) {
      const n = (rng() - 0.5) * 2;
      x.fillStyle = hsl(hue + n * spread * 0.35, sat + n * spread * 0.5, light + n * spread);
      x.fillRect(ox + i, oy + j, block, block);
    }
  }
}

function speck(x, ox, oy, w, h, count, color, rng, size = 1) {
  x.fillStyle = color;
  for (let i = 0; i < count; i++) {
    x.fillRect(ox + ((rng() * w) | 0), oy + ((rng() * h) | 0), size, size);
  }
}

/* ===========================================================
   ATLAS LAYOUT
   =========================================================== */
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
const CELL = 32;

/* name -> [col, row] */
export const CELLS = {
  bark:      [0, 0], palmFrond: [1, 0], jungleLeaf: [2, 0], rock:      [3, 0],
  sand:      [4, 0], grass:     [5, 0], planks:     [6, 0], stone:     [7, 0],

  caveRock:  [0, 1], gold:      [1, 1], goldDark:   [2, 1], dirt:      [3, 1],
  bun:       [4, 1], patty:     [5, 1], lettuce:    [6, 1], cheese:    [7, 1],

  cloth:     [0, 2], clothTat:  [1, 2], skin:       [2, 2], hair:      [3, 2],
  fry:       [4, 2], nugget:    [5, 2], ketchup:    [6, 2], coconut:   [7, 2],

  paper:     [0, 3], runes:     [1, 3], crystal:    [2, 3], moss:      [3, 3],
  sail:      [4, 3], rope:      [5, 3], ember:      [6, 3], water:     [7, 3],

  face:      [0, 4], /* 2x1 cells wide handled separately */
  hectorFace:[2, 4],
  bossCloth: [4, 4], staffGem:  [5, 4], leafBush:   [6, 4], flower:    [7, 4],

  barkDark:  [0, 5], vine:      [1, 5], shell:      [2, 5], lava:      [3, 5],
  metal:     [4, 5], glass:     [5, 5], torchWood:  [6, 5], soda:      [7, 5],

  tuft:      [0, 6], fernLeaf:  [1, 6], driftwood:  [2, 6], flame:     [3, 6],
  pickle:    [4, 6], onion:     [5, 6], tomato:     [6, 6], bacon:     [7, 6],
};

/* Cells that need real transparency (cut-out foliage, flames, …). */
const ALPHA_CELLS = new Set([
  'palmFrond', 'jungleLeaf', 'leafBush', 'flower', 'vine', 'tuft', 'fernLeaf', 'flame',
]);

export function cellUV(name) {
  const [c, r] = CELLS[name];
  const cs = 1 / ATLAS_COLS, rs = 1 / ATLAS_ROWS;
  const inset = 0.5 / (ATLAS_COLS * CELL); // half-texel guard band
  return {
    u0: c * cs + inset,
    u1: (c + 1) * cs - inset,
    v0: 1 - (r + 1) * rs + inset,
    v1: 1 - r * rs - inset,
  };
}

/** Remap UVs into an arbitrary rectangular region of the atlas
 *  (some art, like faces, is wider than a single cell). */
export function applyRegion(geometry, col, row, cols = 1, rows = 1, flipV = false) {
  const cs = 1 / ATLAS_COLS, rs = 1 / ATLAS_ROWS;
  const inset = 0.5 / (ATLAS_COLS * CELL);
  const u0 = col * cs + inset, u1 = (col + cols) * cs - inset;
  const v0 = 1 - (row + rows) * rs + inset, v1 = 1 - row * rs - inset;
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    let v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
    if (flipV) v = 1 - v;
    uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Remap a geometry's existing [0..1] UVs into one atlas cell. */
export function applyCell(geometry, name, flipV = false) {
  const { u0, u1, v0, v1 } = cellUV(name);
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    let v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
    if (flipV) v = 1 - v;
    uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geometry;
}

/* ===========================================================
   CELL PAINTERS
   =========================================================== */
function paintCell(x, name, painter) {
  const [c, r] = CELLS[name];
  const ox = c * CELL, oy = r * CELL;
  x.save();
  x.beginPath();
  x.rect(ox, oy, CELL, CELL);
  x.clip();
  if (ALPHA_CELLS.has(name)) x.clearRect(ox, oy, CELL, CELL);
  painter(x, ox, oy, CELL);
  x.restore();
}

export function buildAtlas() {
  const { c, x } = cv(ATLAS_COLS * CELL, ATLAS_ROWS * CELL);
  const rng = makeRng(20260727);
  x.fillStyle = '#ff00ff';
  x.fillRect(0, 0, c.width, c.height);

  const P = (n, f) => paintCell(x, n, f);

  /* ---- bark: vertical fibrous stripes ---- */
  P('bark', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 28, 34, 34, 8, rng, 2);
    for (let i = 0; i < 9; i++) {
      const px = ox + ((rng() * s) | 0);
      x.fillStyle = hsl(26, 30, 20 + rng() * 14);
      x.fillRect(px, oy, 1 + ((rng() * 2) | 0), s);
    }
    // palm trunk ring scars
    for (let j = 3; j < s; j += 6) {
      x.fillStyle = 'rgba(30,18,8,.5)';
      x.fillRect(ox, oy + j, s, 1);
      x.fillStyle = 'rgba(190,150,95,.22)';
      x.fillRect(ox, oy + j + 1, s, 1);
    }
  });

  P('barkDark', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 22, 28, 22, 8, rng, 2);
    for (let i = 0; i < 14; i++) {
      x.fillStyle = hsl(20, 26, 12 + rng() * 10);
      x.fillRect(ox + ((rng() * s) | 0), oy, 1, s);
    }
  });

  /* ---- palm frond: rib down the middle, feathered blades either side.
         Base at the bottom of the cell, tip at the top. ---- */
  P('palmFrond', (x, ox, oy, s) => {
    const mid = ox + s / 2;
    for (let j = 0; j < s; j++) {
      const t = 1 - j / s;                      // 0 at tip (top), 1 at base
      // widest around 40% up, tapering to a point
      const half = (s * 0.46) * Math.sin(Math.PI * Math.pow(t, 0.72)) + 0.6;
      const blade = 3 + ((j / 3) | 0) % 2;      // alternate blade lengths
      const w = half * (blade === 3 ? 1 : 0.86);
      if (j % 3 === 2) continue;                // gap between blades = alpha
      x.fillStyle = hsl(98 + rng() * 20, 46 + rng() * 18, 22 + rng() * 14 + t * 6);
      x.fillRect(Math.round(mid - w), oy + j, Math.round(w * 2), 1);
      x.fillStyle = 'rgba(12,26,8,.35)';
      x.fillRect(Math.round(mid - w), oy + j, 1, 1);
      x.fillRect(Math.round(mid + w) - 1, oy + j, 1, 1);
    }
    x.fillStyle = hsl(52, 40, 34);              // rib
    x.fillRect(mid - 1, oy + 1, 2, s - 1);
    x.fillStyle = hsl(56, 44, 46);
    x.fillRect(mid - 1, oy + 1, 1, s - 1);
  });

  /* ---- broad jungle leaf: pointed oval silhouette ---- */
  P('jungleLeaf', (x, ox, oy, s) => {
    const mid = ox + s / 2;
    for (let j = 0; j < s; j++) {
      const t = 1 - j / s;
      const half = (s * 0.42) * Math.sin(Math.PI * Math.pow(t, 0.62));
      if (half < 0.5) continue;
      x.fillStyle = hsl(112 + rng() * 16, 44 + rng() * 14, 18 + rng() * 12 + t * 8);
      x.fillRect(Math.round(mid - half), oy + j, Math.round(half * 2), 1);
    }
    x.fillStyle = hsl(94, 38, 34);
    x.fillRect(mid - 1, oy + 2, 1, s - 3);
    x.strokeStyle = 'rgba(150,200,110,.3)'; x.lineWidth = 1;
    for (let j = 5; j < s - 3; j += 4) {
      const t = 1 - j / s;
      const half = (s * 0.4) * Math.sin(Math.PI * Math.pow(t, 0.62));
      x.beginPath(); x.moveTo(mid, oy + j); x.lineTo(mid - half, oy + j + 3); x.stroke();
      x.beginPath(); x.moveTo(mid, oy + j); x.lineTo(mid + half, oy + j + 3); x.stroke();
    }
  });

  /* ---- bush: lumpy blob, flat bottom ---- */
  P('leafBush', (x, ox, oy, s) => {
    for (let j = 0; j < s; j++) {
      const t = 1 - j / s;
      let half = (s * 0.5) * Math.sin(Math.PI * Math.pow(Math.min(1, t * 1.28), 0.55));
      half += (rng() - 0.5) * 3;
      if (j > s - 3) half = s * 0.44;
      if (half < 0.5) continue;
      x.fillStyle = hsl(104 + rng() * 22, 42 + rng() * 16, 16 + rng() * 16 + t * 6);
      x.fillRect(Math.round(ox + s / 2 - half), oy + j, Math.round(half * 2), 1);
    }
  });

  /* ---- fern frond ---- */
  P('fernLeaf', (x, ox, oy, s) => {
    const mid = ox + s / 2;
    for (let j = 1; j < s; j += 2) {
      const t = 1 - j / s;
      const half = (s * 0.42) * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.5;
      x.fillStyle = hsl(106 + rng() * 18, 48, 20 + rng() * 14 + t * 8);
      x.fillRect(Math.round(mid - half), oy + j, Math.round(half * 2), 2);
    }
    x.fillStyle = hsl(70, 36, 30);
    x.fillRect(mid, oy, 1, s);
  });

  /* ---- grass tuft: vertical blades ---- */
  P('tuft', (x, ox, oy, s) => {
    for (let i = 0; i < 16; i++) {
      const bx = ox + 2 + ((rng() * (s - 4)) | 0);
      const bh = 8 + rng() * (s - 10);
      const lean = (rng() - 0.5) * 3;
      x.fillStyle = hsl(88 + rng() * 26, 44 + rng() * 16, 20 + rng() * 18);
      for (let j = 0; j < bh; j++) {
        x.fillRect(bx + (lean * j / bh) | 0, oy + s - 1 - j, 1, 1);
      }
    }
  });

  /* ---- hanging vine ---- */
  P('vine', (x, ox, oy, s) => {
    const mid = ox + s / 2;
    for (let j = 0; j < s; j++) {
      const w = 1 + ((j % 7 === 0) ? 1 : 0);
      x.fillStyle = hsl(100 + rng() * 14, 40, 16 + rng() * 12);
      x.fillRect(mid + Math.sin(j * 0.4) * 2, oy + j, w, 1);
      if (j % 6 === 3) {
        x.fillStyle = hsl(108, 44, 24);
        x.fillRect(mid + Math.sin(j * 0.4) * 2 - 3, oy + j, 7, 2);
      }
    }
  });

  /* ---- flame billboard ---- */
  P('flame', (x, ox, oy, s) => {
    const mid = ox + s / 2;
    for (let j = 0; j < s; j++) {
      const t = 1 - j / s;                       // 1 at tip
      const half = (s * 0.34) * Math.sin(Math.PI * Math.pow(t, 0.4)) * (0.8 + rng() * 0.4);
      if (half < 0.4) continue;
      const heat = Math.pow(t, 0.6);
      x.fillStyle = hsl(6 + (1 - heat) * 46, 96, 34 + (1 - heat) * 46);
      x.fillRect(Math.round(mid - half), oy + j, Math.round(half * 2), 1);
      if (half > 3) {
        x.fillStyle = hsl(48, 100, 74);
        x.fillRect(Math.round(mid - half * 0.35), oy + j, Math.round(half * 0.7), 1);
      }
    }
  });

  P('rock', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 30, 8, 42, 12, rng, 2);
    speck(x, ox, oy, s, s, 26, hsl(30, 8, 30), rng, 2);
    speck(x, ox, oy, s, s, 16, hsl(34, 10, 56), rng, 1);
  });

  P('sand', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 44, 44, 72, 7, rng, 2);
    speck(x, ox, oy, s, s, 30, hsl(40, 40, 62), rng, 1);
    speck(x, ox, oy, s, s, 14, hsl(48, 30, 84), rng, 1);
  });

  P('grass', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 96, 42, 28, 10, rng, 2);
    for (let i = 0; i < 30; i++) {
      x.fillStyle = hsl(90 + rng() * 24, 44, 20 + rng() * 20);
      x.fillRect(ox + ((rng() * s) | 0), oy + ((rng() * s) | 0), 1, 2);
    }
  });

  P('moss', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 88, 36, 24, 10, rng, 2);
    speck(x, ox, oy, s, s, 34, hsl(80, 34, 32), rng, 2);
  });

  P('planks', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 30, 30, 34, 7, rng, 2);
    for (let j = 0; j < s; j += 8) {
      x.fillStyle = 'rgba(20,12,6,.75)'; x.fillRect(ox, oy + j, s, 1);
      x.fillStyle = 'rgba(200,160,110,.14)'; x.fillRect(ox, oy + j + 1, s, 1);
      for (let i = 0; i < 4; i++) { // wood grain
        x.fillStyle = 'rgba(20,12,6,.3)';
        x.fillRect(ox + ((rng() * s) | 0), oy + j + 2 + ((rng() * 5) | 0), 3 + rng() * 6, 1);
      }
    }
  });

  P('stone', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 40, 8, 48, 8, rng, 2);
    for (let j = 0; j < s; j += 8) {
      const off = (j / 8) % 2 ? 8 : 0;
      x.fillStyle = 'rgba(20,18,14,.7)';
      x.fillRect(ox, oy + j, s, 1);
      for (let i = 0; i < s; i += 16) x.fillRect(ox + ((i + off) % s), oy + j, 1, 8);
    }
  });

  P('caveRock', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 20, 14, 20, 10, rng, 2);
    speck(x, ox, oy, s, s, 26, hsl(18, 16, 11), rng, 3);
    speck(x, ox, oy, s, s, 12, hsl(26, 14, 30), rng, 1);
  });

  P('dirt', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 26, 34, 26, 9, rng, 2);
    speck(x, ox, oy, s, s, 22, hsl(24, 30, 17), rng, 2);
  });

  /* ---- gold: the star of the show ---- */
  P('gold', (x, ox, oy, s) => {
    for (let j = 0; j < s; j++) {
      // vertical sheen ramp so the idol reads as polished metal
      const t = j / s;
      const l = 44 + 30 * Math.sin(t * Math.PI * 1.1) + (rng() - 0.5) * 7;
      x.fillStyle = hsl(43 + (rng() - 0.5) * 5, 74, l);
      x.fillRect(ox, oy + j, s, 1);
    }
    speck(x, ox, oy, s, s, 20, hsl(50, 90, 88), rng, 1);
    speck(x, ox, oy, s, s, 14, hsl(36, 66, 30), rng, 1);
  });

  P('goldDark', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 40, 66, 32, 8, rng, 2);
    speck(x, ox, oy, s, s, 12, hsl(46, 70, 56), rng, 1);
  });

  P('crystal', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 186, 56, 44, 14, rng, 2);
    speck(x, ox, oy, s, s, 18, hsl(190, 70, 78), rng, 1);
  });

  /* ---- food ---- */
  P('bun', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 32, 62, 56, 8, rng, 2);
    speck(x, ox, oy, s, s, 26, hsl(46, 60, 88), rng, 1); // sesame
    speck(x, ox, oy, s, s, 10, hsl(28, 56, 40), rng, 2);
  });

  P('patty', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 18, 44, 20, 8, rng, 2);
    speck(x, ox, oy, s, s, 30, hsl(16, 40, 13), rng, 2);
    speck(x, ox, oy, s, s, 12, hsl(24, 40, 30), rng, 1);
  });

  P('lettuce', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 92, 58, 42, 12, rng, 2);
    speck(x, ox, oy, s, s, 30, hsl(88, 60, 56), rng, 2);
  });

  P('cheese', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 44, 92, 56, 6, rng, 2);
    speck(x, ox, oy, s, s, 16, hsl(40, 94, 66), rng, 2);
  });

  P('fry', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 44, 82, 56, 8, rng, 2);
    x.fillStyle = hsl(40, 80, 44);
    for (let j = 0; j < s; j += 7) x.fillRect(ox, oy + j, s, 1);
  });

  P('nugget', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 38, 66, 50, 10, rng, 2);
    speck(x, ox, oy, s, s, 28, hsl(34, 60, 38), rng, 2);
  });

  P('ketchup', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 2, 74, 34, 8, rng, 2);
    speck(x, ox, oy, s, s, 18, hsl(6, 78, 48), rng, 2);
  });

  P('soda', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 6, 60, 40, 8, rng, 2);
    x.fillStyle = '#e8e0d0';
    x.fillRect(ox, oy + 4, s, 3);
    x.fillRect(ox, oy + s - 8, s, 2);
  });

  /* ---- cloth / character ---- */
  P('cloth', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 38, 24, 62, 7, rng, 2);
    for (let j = 0; j < s; j += 3) { x.fillStyle = 'rgba(120,100,70,.12)'; x.fillRect(ox, oy + j, s, 1); }
  });

  P('clothTat', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 34, 20, 48, 10, rng, 2);
    // holes and grime
    for (let i = 0; i < 7; i++) {
      x.fillStyle = 'rgba(24,16,10,.75)';
      x.fillRect(ox + ((rng() * s) | 0), oy + ((rng() * s) | 0), 2 + rng() * 4, 2 + rng() * 3);
    }
    speck(x, ox, oy, s, s, 18, hsl(30, 26, 30), rng, 2);
  });

  P('bossCloth', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 8, 34, 40, 10, rng, 2);
    for (let i = 0; i < 9; i++) {
      x.fillStyle = 'rgba(30,10,8,.7)';
      x.fillRect(ox + ((rng() * s) | 0), oy + ((rng() * s) | 0), 2 + rng() * 5, 1 + rng() * 3);
    }
    speck(x, ox, oy, s, s, 14, hsl(40, 40, 56), rng, 1);
  });

  P('skin', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 26, 46, 58, 5, rng, 2);
    speck(x, ox, oy, s, s, 12, hsl(20, 44, 48), rng, 1);
  });

  P('hair', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 24, 40, 16, 7, rng, 2);
    speck(x, ox, oy, s, s, 20, hsl(28, 40, 26), rng, 2);
  });

  P('sail', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 42, 18, 74, 5, rng, 2);
    speck(x, ox, oy, s, s, 14, hsl(36, 20, 56), rng, 2);
  });

  P('rope', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 38, 36, 46, 6, rng, 2);
    for (let j = 0; j < s; j += 3) {
      x.fillStyle = 'rgba(30,20,10,.5)';
      x.fillRect(ox, oy + j, s, 1);
    }
  });

  P('vine', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 100, 40, 22, 8, rng, 2);
  });

  P('coconut', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 26, 40, 26, 8, rng, 2);
    for (let i = 0; i < 22; i++) {
      x.fillStyle = hsl(30, 34, 16 + rng() * 12);
      x.fillRect(ox + ((rng() * s) | 0), oy + ((rng() * s) | 0), 1, 2 + rng() * 3);
    }
  });

  P('shell', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 20, 40, 80, 6, rng, 2);
    x.strokeStyle = 'rgba(200,150,140,.6)';
    for (let i = 2; i < s; i += 4) { x.beginPath(); x.arc(ox + s / 2, oy + s, i, Math.PI, 0); x.stroke(); }
  });

  P('paper', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 44, 30, 76, 5, rng, 2);
    speck(x, ox, oy, s, s, 16, hsl(34, 34, 58), rng, 2);
  });

  /* ---- carved runes: the four marks ---- */
  P('runes', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 38, 10, 44, 8, rng, 2);
    x.fillStyle = 'rgba(24,18,10,.85)';
    const glyph = (gx, gy) => {
      x.fillRect(ox + gx, oy + gy, 1, 7);
      x.fillRect(ox + gx, oy + gy + (rng() * 5 | 0), 4, 1);
      x.fillRect(ox + gx + 4, oy + gy + 2, 1, 5);
    };
    for (let j = 3; j < s - 8; j += 9) for (let i = 3; i < s - 6; i += 8) glyph(i, j);
    x.fillStyle = 'rgba(255,210,74,.20)';
    for (let j = 3; j < s - 8; j += 9) for (let i = 3; i < s - 6; i += 8) x.fillRect(ox + i + 1, oy + j, 1, 7);
  });

  P('ember', (x, ox, oy, s) => {
    for (let j = 0; j < s; j++) {
      const t = 1 - j / s;
      x.fillStyle = hsl(10 + t * 40, 95, 30 + t * 45);
      x.fillRect(ox, oy + j, s, 1);
    }
    speck(x, ox, oy, s, s, 24, '#fff0a0', rng, 1);
  });

  P('lava', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 14, 90, 40, 16, rng, 2);
    speck(x, ox, oy, s, s, 20, hsl(44, 100, 68), rng, 2);
  });

  P('water', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 192, 56, 42, 8, rng, 2);
    for (let j = 0; j < s; j += 4) {
      x.fillStyle = 'rgba(200,240,255,.16)';
      x.fillRect(ox + ((rng() * s) | 0), oy + j, 4 + rng() * 8, 1);
    }
  });

  P('metal', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 210, 6, 40, 8, rng, 2);
    speck(x, ox, oy, s, s, 14, hsl(20, 40, 30), rng, 2); // rust
  });

  P('glass', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 190, 30, 56, 6, rng, 2);
  });

  P('torchWood', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 28, 30, 26, 8, rng, 2);
  });

  P('staffGem', (x, ox, oy, s) => {
    for (let j = 0; j < s; j++) {
      x.fillStyle = hsl(38 + (rng() - .5) * 12, 96, 40 + 34 * Math.sin(j / s * Math.PI));
      x.fillRect(ox, oy + j, s, 1);
    }
    speck(x, ox, oy, s, s, 18, '#fff6c0', rng, 1);
  });

  /* ---- hibiscus: five petals + stamen, cut out ---- */
  P('flower', (x, ox, oy, s) => {
    const cx = ox + s / 2, cy = oy + s / 2;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * 7, py = cy + Math.sin(a) * 7;
      x.fillStyle = hsl(348 + rng() * 14, 74, 52 + rng() * 10);
      x.beginPath(); x.ellipse(px, py, 7, 5.5, a, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,220,220,.30)';
      x.beginPath(); x.ellipse(px, py, 3.4, 2.6, a, 0, Math.PI * 2); x.fill();
    }
    x.fillStyle = hsl(2, 78, 34);
    x.beginPath(); x.arc(cx, cy, 4, 0, 7); x.fill();
    x.fillStyle = hsl(48, 96, 68);
    x.fillRect(cx - 1, cy - 10, 2, 11);
    x.fillRect(cx - 3, cy - 11, 6, 3);
  });

  /* ---- Hector's arsenal ---- */
  P('pickle', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 78, 52, 32, 10, rng, 2);
    speck(x, ox, oy, s, s, 26, hsl(72, 56, 44), rng, 2);
    speck(x, ox, oy, s, s, 12, hsl(84, 48, 20), rng, 3);
  });

  P('onion', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 40, 12, 82, 5, rng, 2);
    x.strokeStyle = 'rgba(180,170,150,.6)'; x.lineWidth = 1;
    for (let i = 4; i < s; i += 5) { x.beginPath(); x.arc(ox + s / 2, oy + s / 2, i, 0, 7); x.stroke(); }
  });

  P('tomato', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 4, 72, 42, 8, rng, 2);
    x.fillStyle = hsl(8, 60, 62);
    x.beginPath(); x.arc(ox + s / 2, oy + s / 2, 8, 0, 7); x.fill();
    speck(x, ox, oy, s, s, 14, hsl(52, 70, 74), rng, 1);
  });

  P('bacon', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 8, 56, 34, 8, rng, 2);
    for (let j = 0; j < s; j += 8) {
      x.fillStyle = hsl(30, 30, 76);
      x.fillRect(ox, oy + j + (rng() * 3 | 0), s, 3);
    }
  });

  P('driftwood', (x, ox, oy, s) => {
    noiseFill(x, ox, oy, s, s, 34, 12, 56, 8, rng, 2);
    for (let i = 0; i < 12; i++) {
      x.fillStyle = hsl(32, 10, 34 + rng() * 20);
      x.fillRect(ox, oy + ((rng() * s) | 0), s, 1);
    }
  });

  /* ---- FACE: the idol's smile, drawn across cells (0,4)-(1,4) ---- */
  paintFace(x, CELLS.face[0] * CELL, CELLS.face[1] * CELL, CELL * 2, CELL, rng);

  /* ---- HECTOR'S FACE ---- */
  paintHectorFace(x, CELLS.hectorFace[0] * CELL, CELLS.hectorFace[1] * CELL, CELL * 2, CELL, rng);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* The idol's face gets its own 64x32 region — PSX characters wore
   their expressions as textures, not geometry. */
function paintFace(x, ox, oy, w, h, rng) {
  // gold base with sheen
  for (let j = 0; j < h; j++) {
    const l = 46 + 26 * Math.sin((j / h) * Math.PI * 1.05) + (rng() - .5) * 5;
    x.fillStyle = hsl(43, 74, l);
    x.fillRect(ox, oy + j, w, 1);
  }
  const cx = ox + w / 2;
  const dk = 'rgba(96,62,10,.92)';
  const lt = 'rgba(255,244,190,.85)';

  // brows
  x.fillStyle = dk;
  x.fillRect(cx - 20, oy + 8, 11, 2);
  x.fillRect(cx + 9, oy + 8, 11, 2);

  // eyes — half-lidded, pleased
  x.fillRect(cx - 19, oy + 12, 9, 2);
  x.fillRect(cx + 10, oy + 12, 9, 2);
  x.fillStyle = '#3a2606';
  x.fillRect(cx - 17, oy + 13, 4, 3);
  x.fillRect(cx + 12, oy + 13, 4, 3);
  x.fillStyle = lt;
  x.fillRect(cx - 17, oy + 13, 1, 1);
  x.fillRect(cx + 12, oy + 13, 1, 1);

  // nose
  x.fillStyle = 'rgba(120,80,16,.6)';
  x.fillRect(cx - 2, oy + 15, 4, 5);
  x.fillStyle = lt;
  x.fillRect(cx - 1, oy + 15, 1, 4);

  // the smirk
  x.fillStyle = dk;
  x.fillRect(cx - 8, oy + 24, 16, 2);
  x.fillRect(cx - 10, oy + 23, 2, 1);
  x.fillRect(cx + 8, oy + 22, 2, 2);
  // cheeks
  x.fillStyle = 'rgba(255,240,180,.35)';
  x.fillRect(cx - 24, oy + 18, 5, 4);
  x.fillRect(cx + 19, oy + 18, 5, 4);
}

function paintHectorFace(x, ox, oy, w, h, rng) {
  noiseFill(x, ox, oy, w, h, 24, 44, 52, 6, rng, 2);
  const cx = ox + w / 2;
  // sunburn
  x.fillStyle = 'rgba(190,80,50,.35)';
  x.fillRect(ox, oy + 6, w, 10);
  // wild eyes
  x.fillStyle = '#f4ecd8';
  x.fillRect(cx - 18, oy + 9, 10, 7);
  x.fillRect(cx + 8, oy + 9, 10, 7);
  x.fillStyle = '#1a1008';
  x.fillRect(cx - 15, oy + 11, 4, 4);
  x.fillRect(cx + 11, oy + 11, 4, 4);
  // heavy brows
  x.fillStyle = '#2a1a0c';
  x.fillRect(cx - 19, oy + 6, 12, 3);
  x.fillRect(cx + 7, oy + 6, 12, 3);
  // grin
  x.fillStyle = '#2a1408';
  x.fillRect(cx - 12, oy + 21, 24, 4);
  x.fillStyle = '#e8dcc0';
  for (let i = 0; i < 6; i++) x.fillRect(cx - 11 + i * 4, oy + 21, 3, 2);
  // beard
  x.fillStyle = 'rgba(40,26,14,.9)';
  x.fillRect(ox, oy + 25, w, h - 25);
  for (let i = 0; i < 26; i++) {
    x.fillStyle = hsl(26, 34, 12 + rng() * 12);
    x.fillRect(ox + ((rng() * w) | 0), oy + 23 + ((rng() * 8) | 0), 2, 3);
  }
}

/* ===========================================================
   STANDALONE TILING TEXTURES (terrain / water / big surfaces)
   =========================================================== */

export function buildDetailTexture() {
  const S = 64;
  const { c, x } = cv(S, S);
  const rng = makeRng(99);
  // seamless-ish grayscale detail, multiplied over vertex colours
  for (let j = 0; j < S; j += 2) {
    for (let i = 0; i < S; i += 2) {
      const v = 168 + (rng() - 0.5) * 62;
      x.fillStyle = `rgb(${v|0},${v|0},${v|0})`;
      x.fillRect(i, j, 2, 2);
    }
  }
  for (let i = 0; i < 120; i++) {
    const v = 120 + rng() * 40;
    x.fillStyle = `rgba(${v|0},${v|0},${v|0},.5)`;
    x.fillRect((rng() * S) | 0, (rng() * S) | 0, 1 + rng() * 3, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildWaterTexture() {
  const S = 64;
  const { c, x } = cv(S, S);
  const rng = makeRng(4242);
  for (let j = 0; j < S; j += 2) {
    for (let i = 0; i < S; i += 2) {
      const n = Math.sin(i * 0.35) * Math.cos(j * 0.28) * 0.5 + 0.5;
      x.fillStyle = hsl(196 + n * 12, 62, 30 + n * 16 + (rng() - .5) * 6);
      x.fillRect(i, j, 2, 2);
    }
  }
  for (let i = 0; i < 46; i++) {
    x.fillStyle = 'rgba(220,250,255,.30)';
    x.fillRect((rng() * S) | 0, (rng() * S) | 0, 3 + rng() * 7, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Sky gradient used as a dome texture. */
export function buildSkyTexture(top = '#2a6fa8', mid = '#8fc4dd', bot = '#f2d9a8') {
  const { c, x } = cv(8, 64);
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bot);
  x.fillStyle = g;
  x.fillRect(0, 0, 8, 64);
  // banding — 15-bit skies always banded
  const rng = makeRng(7);
  for (let j = 0; j < 64; j += 2) {
    x.fillStyle = `rgba(255,255,255,${rng() * 0.05})`;
    x.fillRect(0, j, 8, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ===========================================================
   TEXT TEXTURES — hoodie chest + idol base band
   =========================================================== */

/** "CATHOLIC UNIVERSITY" embossed in gold, for the idol's hoodie. */
export function buildChestTexture() {
  const W = 128, H = 64;
  const { c, x } = cv(W, H);
  const rng = makeRng(555);
  for (let j = 0; j < H; j++) {
    const l = 44 + 24 * Math.sin((j / H) * Math.PI) + (rng() - .5) * 4;
    x.fillStyle = hsl(43, 74, l);
    x.fillRect(0, j, W, 1);
  }
  x.textAlign = 'center';
  const emboss = (text, y, size, weight = 'bold') => {
    x.font = `${weight} ${size}px "Arial Black", Impact, sans-serif`;
    x.fillStyle = 'rgba(92,58,8,.85)';
    x.fillText(text, W / 2 + 1, y + 1);
    x.fillStyle = 'rgba(255,244,196,.95)';
    x.fillText(text, W / 2 - 1, y - 1);
    x.fillStyle = hsl(45, 78, 58);
    x.fillText(text, W / 2, y);
  };
  emboss('CATHOLIC', 26, 21);
  emboss('UNIVERSITY', 44, 14);

  // hoodie pouch seam at the bottom
  x.fillStyle = 'rgba(92,58,8,.55)';
  x.fillRect(0, H - 8, W, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** "ISLA DORADA" band with chevron panels, wrapped around the plinth. */
export function buildBaseBandTexture() {
  const W = 256, H = 48;
  const { c, x } = cv(W, H);
  const rng = makeRng(777);
  for (let j = 0; j < H; j++) {
    const l = 40 + 26 * Math.sin((j / H) * Math.PI) + (rng() - .5) * 4;
    x.fillStyle = hsl(43, 72, l);
    x.fillRect(0, j, W, 1);
  }

  // recessed rectangular panels, front and back
  const panel = (px, pw) => {
    x.fillStyle = 'rgba(90,56,8,.45)';
    x.fillRect(px, 9, pw, H - 18);
    x.strokeStyle = 'rgba(255,240,180,.55)';
    x.lineWidth = 1;
    x.strokeRect(px + .5, 9.5, pw - 1, H - 19);
  };
  panel(28, 84);
  panel(156, 84);

  // chevrons in the side panels
  const chevrons = (x0, x1) => {
    x.strokeStyle = 'rgba(96,60,8,.8)';
    x.lineWidth = 2;
    for (let px = x0; px < x1; px += 9) {
      x.beginPath();
      x.moveTo(px, 12); x.lineTo(px + 4.5, H / 2); x.lineTo(px, H - 12);
      x.stroke();
    }
    x.strokeStyle = 'rgba(255,240,180,.45)';
    x.lineWidth = 1;
    for (let px = x0 + 1; px < x1; px += 9) {
      x.beginPath();
      x.moveTo(px, 12); x.lineTo(px + 4.5, H / 2); x.lineTo(px, H - 12);
      x.stroke();
    }
  };
  chevrons(118, 152);
  chevrons(246, 260);
  chevrons(0, 26);

  x.textAlign = 'center';
  x.font = 'bold 17px "Arial Narrow", Impact, sans-serif';
  const label = (text, cx) => {
    x.fillStyle = 'rgba(92,58,8,.9)';
    x.fillText(text, cx + 1, H / 2 + 7);
    x.fillStyle = 'rgba(255,246,206,.98)';
    x.fillText(text, cx - 1, H / 2 + 5);
    x.fillStyle = hsl(46, 80, 62);
    x.fillText(text, cx, H / 2 + 6);
  };
  label('ISLA DORADA', 70);
  label('ISLA DORADA', 198);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* Loose sign/plaque text, e.g. the cave door and Hector's throne. */
export function buildSignTexture(lines, bg = '#3a2a14', fg = '#ffd24a') {
  const W = 128, H = 64;
  const { c, x } = cv(W, H);
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.strokeStyle = fg; x.lineWidth = 2; x.strokeRect(3, 3, W - 6, H - 6);
  x.textAlign = 'center';
  x.fillStyle = fg;
  const n = lines.length;
  lines.forEach((l, i) => {
    x.font = `bold ${n > 2 ? 12 : 15}px "Courier New", monospace`;
    x.fillText(l, W / 2, H / 2 + (i - (n - 1) / 2) * (n > 2 ? 14 : 17) + 5);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
