/* ===========================================================
   bar.js — the room behind the high rollers room.

   There is a door in the west panelling with no plate on it. Behind
   it is a bar: low, warm, brown, and not entirely clean. The ceiling
   is a metre lower than the room you came from, the fire is real,
   and the light is the colour of a whisky nobody has ever named.

   It is kept by QUEZETRIEL QUEBOLIUS, who is a silhouette with two
   lit eyes, like Michael Beef — but taller, thinner, wearing a
   waistcoat rather than a hat, and with a cloth permanently over one
   shoulder. He and Beef have never been seen together either. He
   does not find this remarkable.

   There is a dartboard on the end wall. He will play you for money.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, sphere, tint, blankUV } from '../lib/geo.js';
import { drawText, textWidth } from '../lib/bitfont.js';

const G = (n) => new THREE.Color(n);

/* The room. Smaller and lower than the high rollers room on purpose:
   you should feel it close over you on the way in. */
export const BAR_W = 18, BAR_D = 15, BAR_H = 3.4;
/** Where you stand when you come through the door. */
export const BAR_ENTRY = { x: 7.4, y: 1.0, z: 5.2 };
export const BAR_BOX = {
  minX: -BAR_W / 2 + 0.6, maxX: BAR_W / 2 - 0.6,
  minZ: -BAR_D / 2 + 0.6, maxZ: BAR_D / 2 - 0.6, maxY: BAR_H,
};
export function barHeight() { return 0; }

/** The bar top runs along the west end. Local z of its front face. */
const BAR_X = -3.2;          // the counter's centre line, in x
const BAR_FRONT = BAR_X + 0.75;
/** Where he stands, and where the dartboard hangs. */
export const BAR_KEEP = { x: BAR_X - 1.5, z: 0 };
export const BAR_OCHE = { x: 5.6, z: -4.0 };       // where you throw from
export const BAR_BOARD = { x: 5.6, z: -BAR_D / 2 + 0.55, y: 1.73 };

/** A hand-lettered sign for behind the bar. */
function signTex(lines, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 96);
  x.fillStyle = fg; x.fillRect(3, 3, 250, 90);
  x.fillStyle = bg; x.fillRect(7, 7, 242, 82);
  lines.forEach((l, i) => {
    let sc = i === 0 ? 4 : 2;
    while (sc > 1 && textWidth(l, sc, 1) > 226) sc--;
    drawText(x, l, {
      x: 128, y: 16 + i * 34, scale: sc, align: 'center', color: fg, shadow: false,
    });
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The dartboard face, drawn rather than modelled: twenty beds and a bull. */
function boardTex() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#0a0806'; x.fillRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  const R = S / 2 - 2;
  /* Clockwise from the top, the real board order — it is the one thing
     about a dartboard everybody half knows. */
  const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const wedge = (r0, r1, i, col) => {
    const a0 = (i - 0.5) * (Math.PI * 2 / 20) - Math.PI / 2;
    const a1 = (i + 0.5) * (Math.PI * 2 / 20) - Math.PI / 2;
    x.beginPath();
    x.arc(cx, cy, r1, a0, a1);
    x.arc(cx, cy, r0, a1, a0, true);
    x.closePath();
    x.fillStyle = col; x.fill();
  };
  for (let i = 0; i < 20; i++) {
    const dark = i % 2 === 0;
    // the big single beds
    wedge(R * 0.16, R * 0.60, i, dark ? '#0e0c0a' : '#e6d8b4');
    wedge(R * 0.66, R * 0.93, i, dark ? '#0e0c0a' : '#e6d8b4');
    // treble and double rings
    wedge(R * 0.60, R * 0.66, i, dark ? '#1e7a3a' : '#b0201a');
    wedge(R * 0.93, R * 1.00, i, dark ? '#1e7a3a' : '#b0201a');
  }
  // the bull
  x.beginPath(); x.arc(cx, cy, R * 0.16, 0, 6.283);
  x.fillStyle = '#1e7a3a'; x.fill();
  x.beginPath(); x.arc(cx, cy, R * 0.07, 0, 6.283);
  x.fillStyle = '#b0201a'; x.fill();
  // the wire, and the numbers round the outside
  x.strokeStyle = 'rgba(210,200,180,.30)'; x.lineWidth = 1;
  for (let i = 0; i < 20; i++) {
    const a = (i + 0.5) * (Math.PI * 2 / 20) - Math.PI / 2;
    x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    x.stroke();
  }
  for (let i = 0; i < 20; i++) {
    const a = i * (Math.PI * 2 / 20) - Math.PI / 2;
    const lx = cx + Math.cos(a) * R * 1.0 - 3;
    const ly = cy + Math.sin(a) * R * 1.0 - 3;
    drawText(x, String(ORDER[i]), {
      x: lx + 3, y: ly, scale: 1, align: 'center', color: '#e8dcc0', shadow: false,
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ===========================================================
   THE ROOM
   =========================================================== */
export function buildBar(mats, flameFactory) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0704);
  // far enough back that the room does not fog into itself
  scene.fog = new THREE.Fog(0x2a180c, 16, 62);

  const W = BAR_W, D = BAR_D, H = BAR_H;
  const P = [];
  const WOOD = G(0x8a5c30), WOOD_D = G(0x4e3018), WOOD_L = G(0xb0793f);
  const BRASS = G(0xd8a848), FELT = G(0x2e5240);

  /* ---- the shell ----
     Panelled in the same way as the room next door, because it is the same
     ship: one atlas cell stretched over the whole wall is a smear, and a
     long thin quad seen at a grazing angle picks a mip so coarse the cell
     collapses into the whole sheet. */
  const PANEL = 1.5;
  const nx = Math.ceil(W / PANEL), nz = Math.ceil(D / PANEL);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      // bare boards, running one way, worn paler down the middle of the room
      const mid = 1 - Math.min(1, Math.abs(px) / (W / 2));
      P.push(tint(box(PANEL - 0.02, 0.5, PANEL - 0.02, 'planks', { pos: [px, -0.25, pz] }),
        WOOD_D.clone().lerp(WOOD, 0.25 + mid * 0.3 + ((i * 3 + j) % 5) / 40)));
      // and a low, dark, beamed ceiling
      P.push(tint(box(PANEL - 0.02, 0.4, PANEL - 0.02, 'planks', { pos: [px, H + 0.2, pz] }),
        G(0x2a1a10)));
    }
  }
  // the beams, running across
  for (let j = 0; j < nz; j += 2) {
    const pz = -D / 2 + j * PANEL + PANEL / 2;
    P.push(tint(box(W, 0.22, 0.28, 'driftwood', { pos: [0, H - 0.12, pz] }), G(0x3a2414)));
  }
  const rows = Math.ceil(H / PANEL);
  for (let r = 0; r < rows; r++) {
    const py = r * PANEL + PANEL / 2;
    const ph = Math.min(PANEL, H - r * PANEL) - 0.02;
    if (ph <= 0) continue;
    for (let i = 0; i < nx; i++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      for (const pz of [-D / 2, D / 2]) {
        P.push(tint(box(PANEL - 0.02, ph, 0.5, 'planks', { pos: [px, py, pz] }),
          WOOD.clone().multiplyScalar(0.72 + ((i * 5 + r * 3) % 7) / 26)));
      }
    }
    for (let j = 0; j < nz; j++) {
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      for (const px of [-W / 2, W / 2]) {
        P.push(tint(box(0.5, ph, PANEL - 0.02, 'planks', { pos: [px, py, pz] }),
          WOOD.clone().multiplyScalar(0.72 + ((j * 5 + r * 3) % 7) / 26)));
      }
    }
  }
  // a dado rail all the way round, at the height an elbow finds
  for (const pz of [-D / 2 + 0.27, D / 2 - 0.27]) {
    P.push(tint(box(W, 0.09, 0.06, 'planks', { pos: [0, 1.05, pz] }), WOOD_L));
  }
  for (const px of [-W / 2 + 0.27, W / 2 - 0.27]) {
    P.push(tint(box(0.06, 0.09, D, 'planks', { pos: [px, 1.05, 0] }), WOOD_L));
  }

  /* ---- the bar itself ----
     A long counter down the west side with a brass foot rail, a lifting
     flap at the near end, and shelves of bottles behind it. */
  const BL = 11.0;                       // how long it runs, in z
  P.push(tint(box(1.5, 1.02, BL, 'planks', { pos: [BAR_X, 0.51, 0] }), WOOD_D));
  // the top, proud of the front, and polished
  P.push(tint(box(1.72, 0.11, BL + 0.2, 'planks', { pos: [BAR_X + 0.06, 1.07, 0] }), WOOD_L));
  // its bullnose edge
  P.push(tint(cyl(0.075, 0.075, BL + 0.2, 8, 'planks', {
    pos: [BAR_FRONT + 0.17, 1.06, 0], rot: [Math.PI / 2, 0, 0],
  }), G(0xc98a4c)));
  // panelling on the customers' side
  for (let i = 0; i < 7; i++) {
    P.push(tint(box(0.05, 0.66, 1.28, 'planks', {
      pos: [BAR_FRONT + 0.14, 0.56, -BL / 2 + 0.85 + i * 1.5],
    }), WOOD));
  }
  // the brass foot rail, on little stands
  P.push(tint(cyl(0.05, 0.05, BL, 8, 'metal', {
    pos: [BAR_FRONT + 0.55, 0.24, 0], rot: [Math.PI / 2, 0, 0],
  }), BRASS));
  for (let i = 0; i < 5; i++) {
    P.push(tint(cyl(0.045, 0.045, 0.24, 6, 'metal', {
      pos: [BAR_FRONT + 0.55, 0.12, -BL / 2 + 1.2 + i * 2.4],
    }), BRASS));
  }

  /* the back fitting: shelves, a mirror, and a great many bottles */
  P.push(tint(box(0.4, 2.6, BL, 'planks', { pos: [BAR_X - 1.9, 1.3, 0] }), WOOD_D));
  for (const sy of [1.42, 1.86, 2.30]) {
    P.push(tint(box(0.52, 0.07, BL - 0.4, 'planks', { pos: [BAR_X - 1.62, sy, 0] }), WOOD));
  }
  // the mirror, in three panes, dark and not very reflective
  for (let i = 0; i < 3; i++) {
    P.push(tint(box(0.05, 0.9, 2.6, 'glass', {
      pos: [BAR_X - 1.68, 1.0, -3.2 + i * 3.2],
    }), G(0x3a3a44)));
  }

  /* ---- and the stock ----
     Every bottle is a two-part cylinder with a coloured body, because at
     this resolution that is exactly what a bottle is. */
  const BOTTLE_COLS = [
    0x6a3a18, 0x8a2018, 0x2a5a3a, 0xc8a020, 0x3a2a6a, 0x8a6a20,
    0x1a4a5a, 0xa04030, 0x5a2a5a, 0xc06020,
  ];
  let bi = 0;
  for (const sy of [1.42, 1.86, 2.30]) {
    for (let i = 0; i < 22; i++) {
      const bz = -BL / 2 + 0.5 + i * ((BL - 1.0) / 21);
      const jitter = ((i * 7 + bi * 13) % 5) / 60;
      const col = G(BOTTLE_COLS[(i + bi * 3) % BOTTLE_COLS.length]);
      const hgt = 0.26 + ((i * 3) % 4) * 0.035;
      P.push(tint(cyl(0.055, 0.06, hgt, 6, 'glass', {
        pos: [BAR_X - 1.58 + jitter, sy + 0.04 + hgt / 2, bz],
      }), col));
      P.push(tint(cyl(0.018, 0.026, 0.09, 5, 'glass', {
        pos: [BAR_X - 1.58 + jitter, sy + 0.04 + hgt + 0.045, bz],
      }), col.clone().multiplyScalar(0.7)));
    }
    bi++;
  }

  /* ---- three pump handles on the bar, which is what you actually buy ---- */
  const PUMP_Z = [-1.7, 0, 1.7];
  const pumps = [];
  for (let i = 0; i < 3; i++) {
    const g2 = new THREE.Group();
    g2.position.set(BAR_X - 0.35, 1.13, PUMP_Z[i]);
    const pp = [];
    pp.push(tint(cyl(0.075, 0.09, 0.10, 8, 'metal', { pos: [0, 0.05, 0] }), BRASS));
    pp.push(tint(cyl(0.045, 0.045, 0.52, 8, 'metal', { pos: [0, 0.36, 0] }), BRASS));
    pp.push(tint(box(0.20, 0.26, 0.07, 'metal', { pos: [0, 0.70, 0] }),
      G([0xb0201a, 0x1e7a3a, 0x2a3a7a][i])));
    g2.add(new THREE.Mesh(mergeGeos(pp), mats.opaque));
    // the lever, which is the bit that moves when he pulls you one
    const lever = new THREE.Group();
    lever.position.set(0, 0.60, 0);
    lever.add(new THREE.Mesh(mergeGeos([
      tint(cyl(0.026, 0.026, 0.34, 6, 'metal', { pos: [0, 0, 0.17], rot: [Math.PI / 2, 0, 0] }), BRASS),
      tint(sphere(0.05, 6, 5, 'planks', { pos: [0, 0, 0.36] }), G(0x2a1a10)),
    ]), mats.opaque));
    g2.add(lever);
    scene.add(g2);
    pumps.push({ node: g2, lever });
  }

  /* ---- stools along the bar ---- */
  for (let i = 0; i < 5; i++) {
    const sz = -4.4 + i * 2.2;
    const sx = BAR_FRONT + 1.35;
    P.push(tint(cyl(0.34, 0.32, 0.10, 10, 'planks', { pos: [sx, 0.78, sz] }), G(0x6a2a22)));
    P.push(tint(cyl(0.30, 0.30, 0.05, 10, 'clothTat', { pos: [sx, 0.85, sz] }), G(0x8a2a24)));
    P.push(tint(cyl(0.07, 0.09, 0.74, 6, 'metal', { pos: [sx, 0.37, sz] }), BRASS));
    P.push(tint(cyl(0.26, 0.26, 0.05, 10, 'metal', { pos: [sx, 0.03, sz] }), BRASS));
    P.push(tint(cyl(0.20, 0.20, 0.035, 8, 'metal', { pos: [sx, 0.26, sz] }), BRASS));
  }

  /* ---- booths down the far side, and two round tables ---- */
  for (let i = 0; i < 2; i++) {
    const bz = -3.6 + i * 6.0;
    const bx = W / 2 - 2.2;
    // bench, back, and a table between
    P.push(tint(box(1.5, 0.44, 2.4, 'planks', { pos: [bx, 0.22, bz - 1.5] }), G(0x4a2418)));
    P.push(tint(box(1.5, 0.10, 2.4, 'clothTat', { pos: [bx, 0.47, bz - 1.5] }), G(0x7a2018)));
    P.push(tint(box(0.22, 1.2, 2.4, 'clothTat', { pos: [bx + 0.72, 0.9, bz - 1.5] }), G(0x6a1c14)));
    P.push(tint(box(1.5, 0.44, 2.4, 'planks', { pos: [bx, 0.22, bz + 1.5] }), G(0x4a2418)));
    P.push(tint(box(1.5, 0.10, 2.4, 'clothTat', { pos: [bx, 0.47, bz + 1.5] }), G(0x7a2018)));
    P.push(tint(box(0.22, 1.2, 2.4, 'clothTat', { pos: [bx + 0.72, 0.9, bz + 1.5] }), G(0x6a1c14)));
    P.push(tint(box(1.1, 0.08, 1.5, 'planks', { pos: [bx - 0.1, 0.74, bz] }), WOOD_L));
    P.push(tint(cyl(0.09, 0.13, 0.72, 6, 'metal', { pos: [bx - 0.1, 0.37, bz] }), G(0x3a3028)));
    // a glass somebody left, and a ring under it
    P.push(tint(cyl(0.06, 0.05, 0.16, 7, 'glass', { pos: [bx - 0.3, 0.86, bz + 0.3] }), G(0x9a7a30)));
  }

  /* ---- the fire, at the far end ---- */
  const FZ = -D / 2 + 0.7;
  P.push(tint(box(2.6, 1.5, 0.5, 'stone', { pos: [-2.6, 0.75, FZ] }), G(0x6a5c50)));
  P.push(tint(box(3.0, 0.20, 0.72, 'stone', { pos: [-2.6, 1.55, FZ + 0.05] }), G(0x8a7a68)));
  P.push(tint(box(1.7, 0.95, 0.30, 'stone', { pos: [-2.6, 0.48, FZ + 0.28] }), G(0x1a1210)));
  // logs
  for (let i = 0; i < 4; i++) {
    P.push(tint(cyl(0.09, 0.10, 1.1, 6, 'driftwood', {
      pos: [-2.6 + (i - 1.5) * 0.14, 0.18 + (i % 2) * 0.13, FZ + 0.30],
      rot: [0, 0, Math.PI / 2 + (i % 2 ? 0.1 : -0.1)],
    }), G(0x3a2414)));
  }

  /* ---- the dartboard, on the end wall, with a mat on the floor ---- */
  {
    const bb = BAR_BOARD;
    // the cabinet it lives in, doors open
    P.push(tint(box(1.15, 1.15, 0.10, 'planks', { pos: [bb.x, bb.y, bb.z + 0.06] }), G(0x2a1a10)));
    for (const sx of [-1, 1]) {
      P.push(tint(box(0.06, 1.15, 0.55, 'planks', {
        pos: [bb.x + sx * 0.60, bb.y, bb.z + 0.34], rot: [0, sx * 0.5, 0],
      }), G(0x3a2414)));
    }
    // the cork, and a wire rim
    P.push(tint(cyl(0.45, 0.45, 0.06, 20, 'planks', {
      pos: [bb.x, bb.y, bb.z + 0.12], rot: [Math.PI / 2, 0, 0],
    }), G(0x8a7048)));
    P.push(tint(cyl(0.47, 0.47, 0.03, 20, 'metal', {
      pos: [bb.x, bb.y, bb.z + 0.11], rot: [Math.PI / 2, 0, 0],
    }), G(0x8a8a92)));
  }
  // the oche: a brass strip on the floor at the throwing line
  P.push(tint(box(1.6, 0.02, 0.07, 'metal', { pos: [BAR_OCHE.x, 0.02, BAR_OCHE.z] }), BRASS));

  /* ---- odds and ends, because an empty room is a corridor ---- */
  // a piano nobody plays, jammed in the corner
  P.push(tint(box(1.7, 1.15, 0.62, 'planks', { pos: [-W / 2 + 1.5, 0.58, D / 2 - 1.6] }), G(0x2a1810)));
  P.push(tint(box(1.7, 0.09, 0.28, 'planks', { pos: [-W / 2 + 1.5, 0.78, D / 2 - 1.32] }), G(0xd8d0c0)));
  for (let i = 0; i < 11; i++) {
    P.push(tint(box(0.055, 0.06, 0.16, 'planks', {
      pos: [-W / 2 + 0.78 + i * 0.145, 0.83, D / 2 - 1.38],
    }), G(0x1a1410)));
  }
  // a barrel on its side, and crates
  P.push(tint(cyl(0.42, 0.42, 0.95, 10, 'planks', {
    pos: [-W / 2 + 1.2, 0.42, -1.0], rot: [0, 0, Math.PI / 2],
  }), G(0x5a3a1c)));
  for (const [cx2, cz2, ch] of [[W / 2 - 1.3, -6.0, 0.5], [W / 2 - 1.3, -5.2, 0.5]]) {
    P.push(tint(box(0.7, ch, 0.7, 'planks', { pos: [cx2, ch / 2, cz2] }), G(0x6a4a24)));
  }

  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---- the signs ---- */
  {
    const s1 = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.9),
      new THREE.MeshLambertMaterial({ map: signTex(['QUEBOLIUS', 'NO TABS'], '#2a1006', '#ffb84a') })
    );
    s1.position.set(BAR_X - 1.66, 2.85, 0);
    s1.rotation.y = Math.PI / 2;
    scene.add(s1);

    const s2 = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.56),
      new THREE.MeshLambertMaterial({ map: signTex(['DARTS', 'WINNER TAKES IT'], '#0e1a10', '#8fe8a0') })
    );
    s2.position.set(BAR_OCHE.x, 2.65, -BAR_D / 2 + 0.28);
    scene.add(s2);
  }

  /* the board face, drawn */
  const board = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 22),
    new THREE.MeshLambertMaterial({ map: boardTex() })
  );
  board.position.set(BAR_BOARD.x, BAR_BOARD.y, BAR_BOARD.z + 0.16);
  scene.add(board);

  /* ---- what is on the bar top: a pour lands here ----
     Three glasses, hidden until he pours one, so the drink you bought is a
     thing that appears in front of you rather than a number going down. */
  const glasses = [];
  for (let i = 0; i < 3; i++) {
    const gl = new THREE.Group();
    gl.position.set(BAR_FRONT - 0.35, 1.13, PUMP_Z[i]);
    // the glass: a straight sleeve with a handle
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.072, 0.30, 10, 1, true),
      new THREE.MeshLambertMaterial({
        color: 0xcfe0e8, transparent: true, opacity: 0.32, side: THREE.DoubleSide,
      })
    );
    body.position.y = 0.15;
    gl.add(body);
    // the beer inside, which grows as it is poured
    const fill = new THREE.Mesh(
      new THREE.CylinderGeometry(0.076, 0.066, 1, 10),
      new THREE.MeshLambertMaterial({ color: 0xd8901c })
    );
    fill.position.y = 0.02;
    fill.scale.y = 0.001;
    gl.add(fill);
    // and the head on top of it
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.078, 0.078, 0.05, 10),
      new THREE.MeshLambertMaterial({ color: 0xf4ecd8 })
    );
    gl.add(head);
    gl.visible = false;
    scene.add(gl);
    glasses.push({ node: gl, fill, head, body });
  }

  /* ---- QUEZETRIEL QUEBOLIUS ----
     A silhouette, like Beef, so the two of them read as the same kind of
     thing. Where Beef is broad and wears a hat, Quezetriel is a head taller,
     narrow, stooped from a lifetime under a low beam, in a waistcoat, with a
     cloth over one shoulder and long hands he uses for everything.

     Nothing about him is lit except his eyes and the rim the fire puts on
     him, which is what makes a silhouette read as a person rather than as a
     hole in the room. */
  const q = new THREE.Group();
  q.position.set(BAR_KEEP.x, 0, BAR_KEEP.z);
  q.rotation.y = Math.PI / 2;            // facing across the bar, at you
  {
    const DARK = G(0x0e0a0c), DARK_L = G(0x1c1418), VEST = G(0x2a1a20);
    const Q = [];
    // long legs, mostly behind the bar and mostly implied
    Q.push(tint(cyl(0.15, 0.13, 0.86, 7, 'clothTat', { pos: [-0.14, 0.43, 0] }), DARK));
    Q.push(tint(cyl(0.15, 0.13, 0.86, 7, 'clothTat', { pos: [0.14, 0.43, 0] }), DARK));
    // a narrow torso, stooped forward
    Q.push(tint(cyl(0.26, 0.30, 0.62, 9, 'clothTat', { pos: [0, 1.16, 0.03] }), DARK));
    Q.push(tint(cyl(0.30, 0.26, 0.30, 9, 'clothTat', { pos: [0, 1.60, 0.06] }), DARK_L));
    // the waistcoat, a shade off the rest of him, with a watch chain
    Q.push(tint(box(0.44, 0.56, 0.30, 'clothTat', { pos: [0, 1.24, 0.10] }), VEST));
    Q.push(tint(box(0.03, 0.03, 0.03, 'metal', { pos: [-0.12, 1.14, 0.26] }), G(0xc8a040)));
    Q.push(tint(box(0.16, 0.02, 0.02, 'metal', { pos: [-0.05, 1.10, 0.26] }), G(0xc8a040)));
    // shoulders, and the cloth over the left one
    for (const sx of [-1, 1]) {
      Q.push(tint(sphere(0.13, 7, 5, 'clothTat', { pos: [sx * 0.28, 1.70, 0.04] }), DARK));
      Q.push(tint(cyl(0.085, 0.07, 0.52, 7, 'clothTat', {
        pos: [sx * 0.33, 1.42, 0.10], rot: [0, 0, sx * 0.06],
      }), DARK));
    }
    Q.push(tint(box(0.22, 0.42, 0.10, 'cloth', {
      pos: [-0.30, 1.52, 0.16], rot: [0, 0, 0.12],
    }), G(0x6a6458)));
    // a long neck and a narrow head, tipped a little to one side
    Q.push(tint(cyl(0.075, 0.085, 0.20, 7, 'clothTat', { pos: [0, 1.88, 0.03] }), DARK));
    Q.push(tint(box(0.30, 0.40, 0.28, 'clothTat', { pos: [0.02, 2.14, 0.03], rot: [0, 0, -0.07] }), DARK));
    Q.push(tint(box(0.32, 0.10, 0.30, 'clothTat', { pos: [0.02, 2.35, 0.03], rot: [0, 0, -0.07] }), DARK_L));
    q.add(new THREE.Mesh(mergeGeos(Q), mats.opaque));
  }
  // his hands: the only part of him with any light on it, and they move
  const qHands = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.09, 0.20),
      new THREE.MeshLambertMaterial({ color: 0x7a6a62 })
    );
    h.position.set(sx * 0.36, 1.14, 0.30);
    q.add(h);
    qHands.push(h);
  }
  // and his eyes, which are lit and which follow you
  const qEyes = [];
  for (const sx of [-0.075, 0.075]) {
    const e = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.030, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffd06a })
    );
    e.position.set(sx + 0.02, 2.17, 0.18);
    q.add(e);
    qEyes.push(e);
  }
  scene.add(q);

  /* ===========================================================
     LIGHT

     Every light here is created now and never added or removed, because
     the number of lights in a scene is baked into the cache key of every
     shader in it — add one mid-round and three recompiles the lot.
     =========================================================== */
  /* Bright for a dark room.

     The first pass used a 0x40200e ambient, which is a very dark brown, and
     multiplied through Lambert it made the whole bar a black rectangle with
     one green lampshade in it. A room lit by a fire and two lamps still has
     to be a room you can SEE — the warmth comes from the colour, not from
     the absence of light. These are the same intensities as the high
     rollers room next door, in a browner key. */
  scene.add(new THREE.AmbientLight(0xc08858, 1.55));
  scene.add(new THREE.HemisphereLight(0xe0a868, 0x3a2010, 1.05));

  const fire = new THREE.PointLight(0xff8c30, 5.4, 22, 1.5);
  fire.position.set(-2.6, 1.0, FZ + 0.5);
  scene.add(fire);
  const fireFlame = flameFactory ? flameFactory(mats, 5, 0.5) : null;
  if (fireFlame) { fireFlame.position.set(-2.6, 0.24, FZ + 0.30); scene.add(fireFlame); }

  // the lamp over the bar, low and shaded, which is the light you read by
  const barLamp = new THREE.PointLight(0xffc070, 4.2, 17, 1.4);
  barLamp.position.set(BAR_X + 0.2, 2.5, 0);
  scene.add(barLamp);
  {
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 0.42, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x1e6a4a, side: THREE.DoubleSide })
    );
    shade.position.set(BAR_X + 0.2, 2.72, 0);
    scene.add(shade);
    const flex = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.7, 5),
      new THREE.MeshLambertMaterial({ color: 0x1a1410 })
    );
    flex.position.set(BAR_X + 0.2, 3.2, 0);
    scene.add(flex);
  }
  // a lamp over the dartboard, so the board is the brightest thing on its wall
  const boardLamp = new THREE.PointLight(0xfff0d0, 2.4, 8, 1.7);
  boardLamp.position.set(BAR_BOARD.x, BAR_BOARD.y + 0.95, BAR_BOARD.z + 0.75);
  scene.add(boardLamp);
  // and two candles on the booth tables
  const candles = [];
  for (let i = 0; i < 2; i++) {
    const cz = -3.6 + i * 6.0;
    const L = new THREE.PointLight(0xffb060, 1.5, 6, 1.8);
    L.position.set(W / 2 - 2.3, 1.05, cz);
    scene.add(L);
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.04, 0.16, 6),
      new THREE.MeshLambertMaterial({ color: 0xe8e0c8 })
    );
    wax.position.set(W / 2 - 2.3, 0.86, cz);
    scene.add(wax);
    const fl = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.10, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd88a })
    );
    fl.position.set(W / 2 - 2.3, 1.00, cz);
    scene.add(fl);
    candles.push({ L, fl });
  }

  /* smoke: a few slow slabs under the ceiling, so the air is not empty */
  const smoke = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.6),
      new THREE.MeshBasicMaterial({
        color: 0xd8c8b0, transparent: true, opacity: 0.045,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })
    );
    m.position.set(-6 + (i * 2.7) % 13, H - 0.55 - (i % 3) * 0.12, -5 + (i * 3.1) % 10);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    smoke.push({ m, phase: i * 1.1 });
  }

  /* ---- the way back, and the way in ----
     A door on the east wall with a curtain over it. You came through it. */
  {
    const dr = [];
    dr.push(tint(box(0.16, 2.2, 1.3, 'planks', { pos: [W / 2 - 0.32, 1.1, 5.2] }), G(0x3a2414)));
    dr.push(tint(box(0.08, 0.12, 1.5, 'planks', { pos: [W / 2 - 0.40, 2.28, 5.2] }), WOOD_L));
    scene.add(new THREE.Mesh(mergeGeos(dr), mats.opaque));
    const curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.2),
      new THREE.MeshLambertMaterial({ color: 0x5a1a18, side: THREE.DoubleSide })
    );
    curtain.position.set(W / 2 - 0.52, 1.1, 5.2);
    curtain.rotation.y = -Math.PI / 2;
    scene.add(curtain);
  }

  /* ===========================================================
     HOW IT BEHAVES
     =========================================================== */
  const _look = new THREE.Vector3();
  scene.userData.glasses = glasses;
  scene.userData.pumps = pumps;
  /** Start a pour on pump `i`. The screen calls this; the room does the rest. */
  scene.userData.pour = (i, colour) => {
    const gl = glasses[i % 3];
    gl.node.visible = true;
    gl.pourT = 0;
    gl.fill.material.color.setHex(colour ?? 0xd8901c);
    pumps[i % 3].pulling = 1;
  };
  scene.userData.clearGlass = (i) => {
    const gl = glasses[i % 3];
    gl.node.visible = false;
    gl.pourT = null;
  };

  scene.userData.tick = (t, dt = 0.016, camPos = null) => {
    fire.intensity = 5.1 + Math.sin(t * 6.1) * 0.6 + Math.sin(t * 17.3) * 0.30;
    barLamp.intensity = 4.1 + Math.sin(t * 3.7) * 0.14;
    boardLamp.intensity = 2.3 + Math.sin(t * 5.1) * 0.10;
    fireFlame?.userData.tick?.(t, dt);
    for (let i = 0; i < candles.length; i++) {
      const c2 = candles[i];
      const k = 0.8 + Math.sin(t * 9.1 + i * 2.3) * 0.16 + Math.sin(t * 27 + i) * 0.06;
      c2.L.intensity = 1.5 * k;
      c2.fl.scale.set(0.9 + k * 0.2, 0.85 + k * 0.3, 0.9 + k * 0.2);
    }
    for (const s of smoke) {
      s.m.position.x += Math.sin(t * 0.21 + s.phase) * dt * 0.28;
      s.m.material.opacity = 0.035 + Math.sin(t * 0.5 + s.phase) * 0.018;
      s.m.rotation.z = t * 0.03 + s.phase;
    }

    /* Quezetriel. He is very still, then he is not. His eyes track you
       across the room, which is the whole of his personality. */
    q.position.y = Math.sin(t * 0.55) * 0.016;
    if (camPos) {
      _look.set(camPos.x, camPos.y, camPos.z);
      q.worldToLocal(_look);
      const yaw = THREE.MathUtils.clamp(Math.atan2(_look.x, _look.z), -0.6, 0.6);
      for (const e of qEyes) e.position.z = 0.18;
      q.children[0].rotation.y = yaw * 0.35;
    }
    const blink = Math.sin(t * 0.71) > 0.972;
    for (const e of qEyes) {
      e.scale.y = blink ? 0.15 : 1;
      e.material.color.setRGB(1, 0.80 + Math.sin(t * 7.3) * 0.06, 0.40);
    }
    // he polishes a glass when he has nothing else to do
    qHands[0].position.y = 1.14 + Math.sin(t * 2.1) * 0.035;
    qHands[1].position.y = 1.14 + Math.sin(t * 2.1 + 1.4) * 0.035;
    qHands[1].rotation.z = Math.sin(t * 4.2) * 0.4;

    // the pump levers spring back after a pull
    for (const p of pumps) {
      p.pulling = Math.max(0, (p.pulling || 0) - dt * 1.1);
      p.lever.rotation.x = -Math.sin(Math.min(1, p.pulling) * Math.PI) * 0.9;
    }

    // and a pour fills the glass, then the head settles on it
    for (const gl of glasses) {
      if (gl.pourT === null || gl.pourT === undefined) continue;
      gl.pourT += dt;
      const k = Math.min(1, gl.pourT / 1.15);
      const h = 0.02 + k * 0.26;
      gl.fill.scale.y = h;
      gl.fill.position.y = h / 2 + 0.01;
      gl.head.visible = k > 0.12;
      gl.head.position.y = h + 0.015;
      // the head is proud at first and settles into the glass
      const settle = THREE.MathUtils.clamp((gl.pourT - 1.15) / 1.6, 0, 1);
      gl.head.scale.y = 1.7 - settle * 0.9;
    }
  };

  return scene;
}

/** The bar, the stools, the booths, the piano and the barrel are all solid. */
export const BAR_COLLIDERS = (() => {
  const out = [];
  const BL = 11.0;
  // the counter, as a line of tight circles down its front face
  for (let i = 0; i < 13; i++) {
    out.push({ x: BAR_X + 0.1, z: -BL / 2 + i * (BL / 12), r: 0.85 });
  }
  // the back fitting
  for (let i = 0; i < 11; i++) {
    out.push({ x: BAR_X - 1.9, z: -BL / 2 + i * (BL / 10), r: 0.55 });
  }
  // stools
  for (let i = 0; i < 5; i++) out.push({ x: BAR_FRONT + 1.35, z: -4.4 + i * 2.2, r: 0.42 });
  // booths
  for (let i = 0; i < 2; i++) {
    const bz = -3.6 + i * 6.0, bx = BAR_W / 2 - 2.2;
    for (const dz of [-1.5, 1.5]) {
      for (let k = 0; k < 3; k++) out.push({ x: bx, z: bz + dz - 0.8 + k * 0.8, r: 0.62 });
    }
    out.push({ x: bx - 0.1, z: bz, r: 0.7 });
  }
  // the fire, the piano, the barrel, the crates
  out.push({ x: -2.6, z: -BAR_D / 2 + 0.9, r: 1.4 });
  out.push({ x: -BAR_W / 2 + 1.5, z: BAR_D / 2 - 1.6, r: 1.0 });
  out.push({ x: -BAR_W / 2 + 1.2, z: -1.0, r: 0.55 });
  out.push({ x: BAR_W / 2 - 1.3, z: -5.6, r: 0.6 });
  return out;
})();
