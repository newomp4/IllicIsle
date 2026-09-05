/* ===========================================================
   ufo.js — the thing that comes at night, and the room inside it.

   TASHA — UNIT 03 has been lying on her side in the jungle since
   the first day of this island. This is where she came from.

   Once a night a saucer stands off above the temple, drops a
   column of green light onto the sand, and waits three minutes.
   Walk into the light and it takes you up. Inside are the rest of
   her make — the same painted steel, the same panel seams, the
   same visor instead of a face — upright, working, and entirely
   uninterested in you. There is a cradle on the wall with her
   number on it and nothing in it.

   The room has two things in it that matter: a pressure plate on
   the floor, and a plinth in the middle. The plate takes a whole
   person's weight to hold down, and the plinth only opens while it
   is held. Whoever is standing on the plate cannot be the one who
   picks the scanner up. That is the entire design.

   Nothing in here decides anything. The host owns the visit, the
   scanner and every result; this file owns steel, light and the
   fact that a plate goes down when it is stood on.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, cone, ico, sphere, tint } from '../lib/geo.js';
import { ps1Clone } from '../lib/ps1.js';
import { drawText } from '../lib/bitfont.js';
import { heightAt } from './terrain.js';

const G = (n) => new THREE.Color(n);

/* Tasha's palette, unchanged. She reads as a machine because her
   plates, her seams and her joints are three different values, and
   anything built from the same shipyard has to keep that spread. */
const STEEL = G(0xd8e0e6), STEEL_L = G(0xf0f6fa), STEEL_D = G(0x8a949c);
const DARK = G(0x2a3036), VOID = G(0x14181c);
const BRASS = G(0xd8b464), HAZARD = G(0xe0a828);
const GREEN = G(0x6cff9a), RUST = G(0x8a3a2a);

/* ===========================================================
   THE NUMBERS
   =========================================================== */

/** How long it stays, in seconds. The host counts; this is the figure. */
export const UFO_SECS = 180;

/** Hull radius — and the radius of the beam's footprint on the ground,
    which is the same number on purpose. The beam is exactly as wide as
    the saucer, so "am I under it" and "am I in it" are one test, and a
    player can answer it by looking up. */
export const UFO_R = 7.0;

/** How high the hull floats above the ground under it. Well over the
    emergent trees, which top out around 34, so it is a silhouette
    against the sky rather than something in the canopy. */
export const UFO_ALT = 34;

/* ---------- the interior ---------- */
const RAD = 10.4;             // inner face of the wall
const UFO_H = 4.2;            // wall height; the dome above is scenery
const WALL_M = RAD + 0.25;    // wall panel centre line

/** The room's bounds, in the shape the player's insideBox wants. The
    walls are round and the box is square, so the corners are held by
    UFO_COLLIDERS instead; this is the ceiling and the backstop. */
export const UFO_BOX = {
  minX: -9.6, maxX: 9.6,
  minZ: -9.6, maxZ: 9.6, maxY: UFO_H,
};

/** The floor is flat, like every other interior in the game. */
export function ufoHeight() { return 0; }

/** Where the beam puts you down: over the aperture by the south wall,
    looking straight up the room at the plinth. */
export const UFO_ENTRY = { x: 0, y: 1.0, z: 7.0 };

/** The pressure plate, out on the open floor where it can be seen from
    the plinth — the two people doing this have to be able to watch each
    other work. */
export const UFO_PLATE = { x: -6.2, z: 2.4, r: 1.15 };

/** Where the scanner sits once the plate exposes it: the top of the
    plinth in the middle of the room, not its base. */
export const UFO_PLINTH = { x: 0, y: 1.18, z: 0 };

/* The console banks run round the far arc. Both the build and the
   collider list below are laid out from these, so a bank cannot be in
   one and missing from the other. */
const BANK_A = [-0.74, -0.37, 0, 0.37, 0.74].map((a) => Math.PI + a);
const BANK_R = 9.0;    // the desks
const DESK_FACE = BANK_R - 0.425;   // the face of one, on the room's side
const BOT_STAND = 0.725;            // how far off it a Tashabot works
/* Not square on to its desk. Three machines with their backs flat to the
   room are three grey rectangles at the dark end of it; thirty degrees
   off, each one shows the hazard chevrons down its flank and the line of
   its shoulders, which is the difference between a shape and a machine
   at fifteen metres. It still works its desk — it stands the same
   distance off the face, just not on the normal to it. */
const BOT_TURN = -0.52;
/* Three of them are at consoles; the fourth is at the holo table with
   its back to the room, which is where the one that notices you is. */
const BOT_BANKS = [1, 2, 3];
const HOLO = { x: 5.0, z: 3.6 };
const HOLO_BOT = { x: 5.0, z: 5.1, yaw: Math.PI };
const CRADLE_A = 0.85;   // the charging rack, on the south-east wall

/** Where a Tashabot stands to work the bank at angle `a`, and which way
    it is pointed while it does. The build and the collider list both go
    through here, so one cannot drift from the other. */
function botStand(a) {
  const yaw = a + BOT_TURN;
  return {
    x: Math.sin(a) * DESK_FACE - Math.sin(yaw) * BOT_STAND,
    z: Math.cos(a) * DESK_FACE - Math.cos(yaw) * BOT_STAND,
    yaw,
  };
}

/* ===========================================================
   SMALL TEXTURES
   =========================================================== */

/** One strip for the whole charging rack: four bays, four numbers, and
    the one in the middle that nobody has come back for. */
function cradleTex() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 40;
  const x = c.getContext('2d');
  x.fillStyle = '#1a2226'; x.fillRect(0, 0, 256, 40);
  for (let i = 0; i < 4; i++) {
    const ox = i * 64;
    const dead = i === 2;
    x.fillStyle = dead ? '#3a2018' : '#2a3a34';
    x.fillRect(ox + 3, 3, 58, 34);
    x.fillStyle = dead ? '#6a3020' : '#4a7a60';
    x.fillRect(ox + 3, 3, 58, 2);
    drawText(x, 'UNIT', {
      x: ox + 32, y: 9, scale: 1, align: 'center',
      color: dead ? '#e08a60' : '#9fe8c0', shadow: false,
    });
    drawText(x, '0' + (i + 1), {
      x: ox + 32, y: 21, scale: 2, align: 'center',
      color: dead ? '#ffb060' : '#d8fff0', shadow: false,
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A console face: rows of glyphs nobody is meant to read, and a couple
    of bars that could be anything. Seeded so the three banks differ. */
function consoleTex(seed) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const x = c.getContext('2d');
  const R = (n) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  x.fillStyle = '#06120e'; x.fillRect(0, 0, 64, 48);
  x.fillStyle = '#0c2a20'; x.fillRect(2, 2, 60, 44);
  // glyph rows: ticks of varying length, which is what alien text is
  for (let r = 0; r < 9; r++) {
    let px = 4;
    while (px < 58) {
      const w = 1 + Math.floor(R(r * 7 + px) * 4);
      if (R(r * 3 + px) > 0.34) {
        const bright = R(r + px * 2) > 0.8;
        x.fillStyle = bright ? '#c8ffe0' : '#4aa87a';
        x.fillRect(px, 5 + r * 4, w, 2);
      }
      px += w + 2;
    }
  }
  // and two readouts that are obviously readouts
  x.fillStyle = '#1e4a38'; x.fillRect(4, 41, 56, 4);
  x.fillStyle = '#8fffc0'; x.fillRect(4, 41, 8 + R(2) * 40, 4);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ===========================================================
   PLUMBING
   =========================================================== */

/* Sub-assemblies are built in their own space and then dropped into the
   room's, so a console can be laid out facing +z once and stood at five
   different angles without anybody doing trigonometry in their head. */
const _M = new THREE.Matrix4();
function drop(into, parts, x, y, z, ry = 0) {
  _M.makeRotationY(ry);
  _M.setPosition(x, y, z);
  for (const g of parts) { g.applyMatrix4(_M); into.push(g); }
  return into;
}

/* A tiny deterministic source, so the cabling and the wear land in the
   same place every time the room is built. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Every telltale on every Tashabot, in one material. They are lights,
   not surfaces: the gloom in that room is the point of the room, and it
   is not allowed to take the crew with it. */
const LAMP_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

/* ===========================================================
   A TASHABOT

   Everything Tasha is, standing up. Same plates, same seams, same
   visor slit, same brass actuators, same loom of cable out of the back
   of the neck. She is 03; these are the ones still on shift.

   Built at its own feet, facing +z, so the room can stand it anywhere.
   =========================================================== */
function buildTashabot(mats, n, rng) {
  const g = new THREE.Group();
  const B = [];

  // ---- legs: two of them, and they are obviously jointed ----
  for (const sx of [-1, 1]) {
    B.push(tint(box(0.19, 0.09, 0.31, 'metal', { pos: [sx * 0.16, 0.045, 0.03] }), STEEL_D));
    B.push(tint(cyl(0.085, 0.075, 0.44, 6, 'metal', { pos: [sx * 0.16, 0.32, 0] }), STEEL));
    B.push(tint(cyl(0.10, 0.10, 0.13, 8, 'metal', {
      pos: [sx * 0.16, 0.57, 0], rot: [0, 0, Math.PI / 2],
    }), DARK));
    B.push(tint(cyl(0.10, 0.09, 0.40, 6, 'metal', { pos: [sx * 0.16, 0.83, 0] }), STEEL));
    // the actuator down the front of the thigh, rod part way out
    B.push(tint(cyl(0.026, 0.026, 0.26, 4, 'metal', { pos: [sx * 0.16, 0.84, 0.13] }), BRASS));
    B.push(tint(cyl(0.014, 0.014, 0.14, 4, 'metal', { pos: [sx * 0.16, 0.66, 0.13] }), STEEL_L));
  }

  // ---- hips and a panelled chassis ----
  B.push(tint(box(0.46, 0.17, 0.36, 'metal', { pos: [0, 1.07, 0] }), STEEL_D));
  B.push(tint(box(0.50, 0.62, 0.38, 'metal', { pos: [0, 1.40, 0] }), STEEL));
  for (const sy of [1.20, 1.40, 1.60]) {
    B.push(tint(box(0.52, 0.025, 0.40, 'metal', { pos: [0, sy, 0] }), STEEL_D));
  }
  B.push(tint(box(0.045, 0.62, 0.40, 'metal', { pos: [0, 1.40, 0] }), STEEL_D));
  // the chest hatch, shut on these, with its four rivets
  B.push(tint(box(0.26, 0.24, 0.05, 'metal', { pos: [0, 1.46, 0.20] }), STEEL_D));
  B.push(tint(box(0.20, 0.18, 0.03, 'metal', { pos: [0, 1.46, 0.22] }), DARK));
  for (const [rx, ry] of [[-0.11, 1.36], [0.11, 1.36], [-0.11, 1.56], [0.11, 1.56]]) {
    B.push(tint(box(0.022, 0.022, 0.022, 'metal', { pos: [rx, ry, 0.225] }), BRASS));
  }
  // hazard chevrons down the flank, the one colour on this island that
  // only ever means MADE
  for (let i = 0; i < 4; i++) {
    B.push(tint(box(0.06, 0.12, 0.40, 'metal', {
      pos: [-0.26, 1.16 + i * 0.13, 0], rot: [0, 0, 0.5],
    }), i % 2 ? HAZARD : DARK));
  }
  // a maker's plate, riveted on where hers is
  B.push(tint(box(0.18, 0.10, 0.03, 'metal', { pos: [0.13, 1.63, 0.20] }), BRASS));

  // ---- shoulders ----
  for (const sx of [-1, 1]) {
    B.push(tint(box(0.18, 0.19, 0.40, 'metal', { pos: [sx * 0.31, 1.66, 0] }), STEEL_D));
    B.push(tint(cyl(0.10, 0.10, 0.15, 8, 'metal', {
      pos: [sx * 0.34, 1.66, 0], rot: [0, 0, Math.PI / 2],
    }), DARK));
  }

  // ---- the loom out of the back of the neck ----
  B.push(tint(cyl(0.085, 0.085, 0.14, 8, 'metal', { pos: [0, 1.80, 0] }), DARK));
  for (let i = 0; i < 4; i++) {
    const a = -0.14 + i * 0.09;
    B.push(tint(cyl(0.018, 0.018, 0.42, 4, 'metal', {
      pos: [a, 1.60, -0.20 - (i % 2) * 0.03], rot: [0.28, 0, a * 0.5],
    }), i % 2 ? RUST : G(0x2a2e32)));
  }

  g.add(new THREE.Mesh(mergeGeos(B), mats.opaque));

  /* ---- the head, which turns ----
     A visor, not a face. It is the single thing that decides whether a
     box on a stick reads as a robot or as a box on a stick. */
  const head = new THREE.Group();
  head.position.set(0, 1.86, 0);
  {
    const H = [];
    H.push(tint(box(0.30, 0.27, 0.32, 'metal', { pos: [0, 0.14, 0] }), STEEL));
    H.push(tint(box(0.32, 0.06, 0.34, 'metal', { pos: [0, 0.27, 0] }), STEEL_D));
    H.push(tint(box(0.28, 0.13, 0.03, 'metal', { pos: [0, 0.15, 0.165] }), STEEL_D));
    H.push(tint(box(0.24, 0.09, 0.045, 'metal', { pos: [0, 0.15, 0.175] }), VOID));
    // a hinged jaw plate, shut
    H.push(tint(box(0.22, 0.08, 0.14, 'metal', { pos: [0, 0.02, 0.11] }), STEEL_D));
    // the collar plate her number is stamped on
    H.push(tint(box(0.24, 0.07, 0.04, 'metal', { pos: [0, -0.04, 0.175] }), BRASS));
    // antenna, straight — hers is the bent one
    H.push(tint(cyl(0.016, 0.016, 0.30, 4, 'metal', {
      pos: [0.09, 0.44, -0.05], rot: [0.18, 0, 0.12],
    }), BRASS));
    H.push(tint(ico(0.032, 0, 'metal', { pos: [0.12, 0.60, -0.08] }), G(0xffd24a)));
    head.add(new THREE.Mesh(mergeGeos(H), mats.opaque));
  }
  // the optic itself: lit, and its own material so it can flicker alone
  const visorMat = new THREE.MeshBasicMaterial({ color: 0x8fffc0 });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.055, 0.02), visorMat);
  visor.position.set(0, 0.15, 0.195);
  head.add(visor);
  g.add(head);

  /* ---- arms, which is where the work happens ---- */
  const arms = [];
  for (const sx of [-1, 1]) {
    const up = new THREE.Group();
    up.position.set(sx * 0.34, 1.66, 0);
    const U = [];
    U.push(tint(cyl(0.075, 0.065, 0.36, 6, 'metal', { pos: [0, -0.18, 0] }), STEEL));
    U.push(tint(cyl(0.026, 0.026, 0.24, 4, 'metal', { pos: [sx * 0.06, -0.18, 0.02] }), BRASS));
    U.push(tint(cyl(0.085, 0.085, 0.12, 8, 'metal', {
      pos: [0, -0.37, 0], rot: [0, 0, Math.PI / 2],
    }), DARK));
    up.add(new THREE.Mesh(mergeGeos(U), mats.opaque));

    const fore = new THREE.Group();
    fore.position.set(0, -0.37, 0);
    const F = [];
    F.push(tint(cyl(0.06, 0.055, 0.32, 6, 'metal', { pos: [0, -0.16, 0] }), STEEL));
    F.push(tint(cyl(0.02, 0.02, 0.22, 4, 'metal', { pos: [0, -0.16, 0.055] }), BRASS));
    F.push(tint(cyl(0.065, 0.065, 0.08, 8, 'metal', { pos: [0, -0.33, 0] }), DARK));
    // three fingers, because a hand with five is a person's hand
    for (let i = 0; i < 3; i++) {
      const a = -0.4 + i * 0.4;
      F.push(tint(box(0.032, 0.10, 0.032, 'metal', {
        pos: [Math.sin(a) * 0.05, -0.41, 0.03 + Math.cos(a) * 0.02], rot: [0.4, a, 0],
      }), STEEL_D));
    }
    fore.add(new THREE.Mesh(mergeGeos(F), mats.opaque));
    up.add(fore);
    g.add(up);
    arms.push({ up, fore, sx });
  }

  /* ---- the telltales ----
     Three of these stand at the far bank with their optics at the wall,
     and the back of a Tashabot is the one side of it with nothing on it:
     a plain panel, three ribs and a loom. A machine that is serviced from
     behind carries its status lamps where the engineer stands, so that is
     where these are — a column of three proud of the back panel and a
     running light at the nape. Warm one in the middle of a cold pair, the
     same alternation as the ports round the hull, because that is what
     says instrument rather than decoration. */
  {
    const T = [];
    for (let i = 0; i < 3; i++) {
      T.push(tint(box(0.08, 0.045, 0.035, 'metal', { pos: [0, 1.28 + i * 0.16, -0.205] }),
        i === 1 ? G(0xffd24a) : GREEN));
    }
    T.push(tint(box(0.11, 0.04, 0.03, 'metal', { pos: [0, 1.795, -0.10] }), G(0xffd24a)));
    g.add(new THREE.Mesh(mergeGeos(T), LAMP_MAT));
  }

  /* Its number, painted on the collar exactly the way hers is. */
  {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 16;
    const cx = c.getContext('2d');
    cx.fillStyle = '#8a6a2a'; cx.fillRect(0, 0, 64, 16);
    drawText(cx, 'UNIT ' + String(n).padStart(2, '0'), {
      x: 32, y: 4, scale: 1, align: 'center', color: '#2a1c08', shadow: false,
    });
    const tx = new THREE.CanvasTexture(c);
    tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestFilter;
    tx.generateMipmaps = false; tx.colorSpace = THREE.SRGBColorSpace;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.06),
      new THREE.MeshLambertMaterial({ map: tx }));
    pl.position.set(0, -0.04, 0.198);
    head.add(pl);
  }

  /* Idle. Machines do not fidget; they repeat. The head sweeps its
     console, the arms work, and the optic sits at a steady value with
     the mains ripple on it — the same once-a-minute stutter Tasha's
     has, because it is the same optic. */
  const ph = rng() * 6.283;
  const rate = 0.72 + rng() * 0.5;
  const _look = new THREE.Vector3();
  g.userData.tick = (t, camPos, watch = false) => {
    const s = t * rate + ph;
    g.position.y = Math.sin(s * 0.8) * 0.008;
    head.rotation.y = Math.sin(s * 0.5) * 0.34;
    head.rotation.x = Math.sin(s * 0.31) * 0.06;
    /* The one at the holo table looks up when somebody is in the room.
       It does not stop what it is doing. */
    if (watch && camPos) {
      _look.set(camPos.x, camPos.y, camPos.z);
      g.worldToLocal(_look);
      head.rotation.y = THREE.MathUtils.clamp(Math.atan2(_look.x, _look.z), -1.1, 1.1);
      head.rotation.x = -0.10;
    }
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      const w = s * 1.7 + i * 2.1;
      a.up.rotation.x = -0.86 + Math.sin(w) * 0.14;
      a.up.rotation.z = a.sx * (0.16 + Math.sin(w * 0.6) * 0.05);
      a.fore.rotation.x = -0.58 + Math.sin(w * 1.9 + 0.8) * 0.22;
    }
    const ripple = 0.86 + Math.sin(t * 21 + ph) * 0.05;
    const stutter = Math.sin(t * 0.63 + ph) > 0.985 ? 0.25 : 1;
    visorMat.color.setRGB(0.56 * ripple * stutter, 1.0 * ripple * stutter, 0.75 * ripple * stutter);
  };
  return g;
}

/* ===========================================================
   THE SCANNER

   A hand tool of the same make: a steel wedge, a brass grip, a lens
   at the sharp end and a screen on top. Exported on its own as well
   as on the plinth, so whatever ends up holding it — a hand, a
   pedestal, a dropped prop — can have one without cloning a scene.
   =========================================================== */
export function buildScannerProp(mats) {
  const g = new THREE.Group();
  const S = [];
  // the body, tapering toward the lens
  S.push(tint(box(0.15, 0.10, 0.28, 'metal', { pos: [0, 0, 0] }), STEEL));
  S.push(tint(box(0.155, 0.022, 0.29, 'metal', { pos: [0, 0.015, 0] }), STEEL_D));
  S.push(tint(box(0.11, 0.075, 0.09, 'metal', { pos: [0, 0, 0.17] }), STEEL_D));
  // the lens housing
  S.push(tint(cyl(0.05, 0.055, 0.05, 8, 'metal', {
    pos: [0, 0, 0.225], rot: [Math.PI / 2, 0, 0],
  }), DARK));
  S.push(tint(cyl(0.058, 0.058, 0.02, 8, 'metal', {
    pos: [0, 0, 0.20], rot: [Math.PI / 2, 0, 0],
  }), BRASS));
  // two prongs either side of it, which is what makes it read as a scanner
  for (const sx of [-1, 1]) {
    S.push(tint(cyl(0.012, 0.012, 0.13, 4, 'metal', {
      pos: [sx * 0.075, 0.02, 0.22], rot: [Math.PI / 2, 0, sx * 0.12],
    }), BRASS));
  }
  // the brass grip, under the back
  S.push(tint(box(0.055, 0.13, 0.07, 'metal', { pos: [0, -0.10, -0.07], rot: [0.22, 0, 0] }), BRASS));
  // the screen bezel on top, and a cable tail
  S.push(tint(box(0.10, 0.018, 0.09, 'metal', { pos: [0, 0.052, -0.05] }), DARK));
  S.push(tint(cyl(0.015, 0.015, 0.10, 4, 'metal', { pos: [0, -0.02, -0.17], rot: [1.1, 0, 0] }), RUST));
  g.add(new THREE.Mesh(mergeGeos(S), mats.opaque));

  // the two lit parts: the lens, and the screen you read the answer off
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x8fffc0 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.042, 10), lensMat);
  lens.position.set(0, 0, 0.252);
  g.add(lens);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x3ad088 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.075), screenMat);
  screen.position.set(0, 0.062, -0.05);
  screen.rotation.x = -Math.PI / 2;
  g.add(screen);

  g.userData.lensMat = lensMat;
  g.userData.screenMat = screenMat;
  /** Idle glow. The readout is the HUD's job; this is just a live lamp. */
  g.userData.tick = (t) => {
    const k = 0.80 + Math.sin(t * 3.1) * 0.14 + Math.sin(t * 19) * 0.05;
    lensMat.color.setRGB(0.42 * k, 1.0 * k, 0.62 * k);
    screenMat.color.setRGB(0.16 * k, 0.78 * k, 0.48 * k);
  };
  return g;
}

/* ===========================================================
   THE EXTERIOR — saucer and beam

   One group. The game gives it a position and a fade; everything
   else about it happens in here.
   =========================================================== */
export function buildUfoHull(mats) {
  const root = new THREE.Group();
  const rng = makeRng(0x0f0);

  /* Its own material, not the shared one: a fade means writing opacity,
     and writing opacity on mats.opaque would fade the whole island. */
  const hullMat = ps1Clone(mats.opaque);
  hullMat.transparent = true;
  hullMat.opacity = 1;

  /* Everything that bobs and turns hangs off this, so the beam below can
     stay bolted to the ground while the saucer moves over it. */
  const body = new THREE.Group();
  root.add(body);

  const P = [];
  const R = UFO_R;

  /* ---- the hull: a rim, a dish under it, a stepped dome over it ----
     Few sides, hard edges, no smooth shading anywhere. A saucer at this
     fidelity is three tapered cylinders and a lot of nerve. */
  P.push(tint(cyl(R, R, 0.55, 16, 'metal', { pos: [0, 0, 0] }), STEEL));
  P.push(tint(cyl(R * 1.005, R * 1.005, 0.14, 16, 'metal', { pos: [0, 0.30, 0] }), STEEL_D));
  P.push(tint(cyl(R * 1.005, R * 1.005, 0.14, 16, 'metal', { pos: [0, -0.30, 0] }), DARK));
  // the underside, falling away to the aperture
  P.push(tint(cyl(R * 0.72, R * 0.40, 1.20, 16, 'metal', { pos: [0, -0.86, 0] }), STEEL_D));
  P.push(tint(cyl(R * 0.40, R * 0.34, 0.40, 16, 'metal', { pos: [0, -1.62, 0] }), DARK));
  // the dome, in steps
  P.push(tint(cyl(R * 0.74, R * 0.96, 0.85, 16, 'metal', { pos: [0, 0.70, 0] }), STEEL));
  P.push(tint(cyl(R * 0.50, R * 0.74, 0.70, 12, 'metal', { pos: [0, 1.47, 0] }), STEEL_L));
  P.push(tint(cyl(R * 0.26, R * 0.50, 0.60, 10, 'metal', { pos: [0, 2.10, 0] }), STEEL));
  P.push(tint(sphere(R * 0.26, 10, 5, 'metal', { pos: [0, 2.36, 0], scale: [1, 0.55, 1] }), STEEL_L));

  /* Panel seams. Sixteen of them, radial, over the dome and the rim —
     the seams are what say this was riveted together by somebody. */
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    P.push(tint(box(0.10, 0.10, R * 0.98, 'metal', {
      pos: [Math.sin(a) * R * 0.50, 0.34, Math.cos(a) * R * 0.50], rot: [0, a, 0],
    }), STEEL_D));
    P.push(tint(box(0.09, 0.62, 0.16, 'metal', {
      pos: [Math.sin(a) * R * 0.99, 0, Math.cos(a) * R * 0.99], rot: [0, a, 0],
    }), DARK));
    // brass ribs over the dome, running up to the cap
    if (i % 2 === 0) {
      P.push(tint(box(0.075, 0.075, R * 0.62, 'metal', {
        pos: [Math.sin(a) * R * 0.44, 1.12, Math.cos(a) * R * 0.44], rot: [0.30, a, 0],
      }), BRASS));
    }
  }
  // hazard chevrons round the rim, in Tasha's yellow
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    if (i % 3 === 0) continue;
    P.push(tint(box(0.34, 0.16, 0.10, 'metal', {
      pos: [Math.sin(a) * R * 1.01, 0.16, Math.cos(a) * R * 1.01], rot: [0, a, 0.55],
    }), i % 2 ? HAZARD : DARK));
  }
  // three pods under it, at the points of a triangle
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const px = Math.sin(a) * R * 0.66, pz = Math.cos(a) * R * 0.66;
    P.push(tint(cyl(0.34, 0.42, 0.85, 8, 'metal', { pos: [px, -1.35, pz] }), STEEL_D));
    P.push(tint(cyl(0.44, 0.30, 0.30, 8, 'metal', { pos: [px, -1.90, pz] }), DARK));
    P.push(tint(cyl(0.10, 0.10, 0.40, 6, 'metal', { pos: [px, -0.80, pz] }), BRASS));
  }
  // a mast on top, because a thing with an aerial is a thing that is talking
  P.push(tint(cyl(0.09, 0.09, 2.2, 6, 'metal', { pos: [0, 3.6, 0] }), BRASS));
  P.push(tint(ico(0.30, 0, 'metal', { pos: [0, 4.8, 0] }), STEEL_L));

  const hull = new THREE.Mesh(mergeGeos(P), hullMat);
  body.add(hull);

  /* ---- the ring of lit ports ----
     Their own basic material so they stay bright at three in the morning
     from four hundred metres, which is the whole point of them. */
  const portMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1, fog: false,
  });
  const PORTS = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    // warm and cold alternating, so the ring reads as instruments
    const col = i % 4 === 0 ? G(0xffd24a) : G(0x8fffc0);
    PORTS.push(tint(box(0.62, 0.26, 0.16, 'metal', {
      pos: [Math.sin(a) * R * 1.0, -0.06, Math.cos(a) * R * 1.0], rot: [0, a, 0],
    }), col));
  }
  // and the aperture the beam comes out of, glowing on the underside
  PORTS.push(tint(cyl(R * 0.32, R * 0.32, 0.06, 14, 'metal', { pos: [0, -1.80, 0] }), GREEN));
  const ports = new THREE.Mesh(mergeGeos(PORTS), portMat);
  body.add(ports);

  /* ===========================================================
     THE BEAM

     Centred under the hull, and not a child of the part that turns:
     the saucer can rotate all night and the column stays exactly where
     it landed, which is what makes it a place you can stand.
     =========================================================== */
  /** World offset of the beam's centre from the hull. Dead centre — see above. */
  const beamAt = { x: 0, z: 0 };
  const beam = new THREE.Group();
  beam.position.set(beamAt.x, 0, beamAt.z);
  root.add(beam);

  const TOP = -1.85;                 // just under the aperture
  const BOT = -UFO_ALT;              // the ground under the middle of the foot
  const LEN = TOP - BOT;
  const TOP_R = 2.3;
  /* How far the column carries on below the height it was aimed at. The
     saucer stands over a hillside — the spot it picks is the flattest
     going, not flat — and a cone that stops dead at the height of its own
     centre hangs metres clear of the downhill side of its own footprint.

     One footprint radius was the old figure and it was not enough: the
     ground is only refused at a slope of 0.4, which is a normal leaning
     four in three, so the rim of an accepted footprint can be that far
     below its middle. Measured over every spot on the temple side the
     picker would take, the ground under the footprint spans eight and a
     half metres. Overshoot costs nothing — a heightfield cannot be seen
     through, so everything below the surface is occluded from anywhere a
     player can stand — while falling short is a cone hanging in the air. */
  const SINK = UFO_R * (4 / 3);

  /* Everything that has to stretch between a hull that bobs and a foot that
     does not. Kept apart from the two marks on the sand below, which are
     cut to the ground and must not be stretched with it. */
  const column = new THREE.Group();
  beam.add(column);

  /* The cone's full run and its radius anywhere down it, so the rings and
     the motes inside it agree with the walls they are travelling between
     instead of each carrying their own copy of the taper. */
  const RUN = LEN + SINK;
  const coneR = (u) => TOP_R + (UFO_R - TOP_R) * (u * RUN / LEN);

  const beamMats = [];
  const shaft = (rTop, rBot, colour, op) => {
    const m = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: op, fog: false,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    m.userData.baseOp = op;
    beamMats.push(m);
    // the taper carried on past the foot, so the buried part is still the cone
    const rEnd = rTop + (rBot - rTop) * (RUN / LEN);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rEnd, RUN, 14, 1, true), m
    );
    mesh.position.y = TOP - RUN / 2;
    mesh.renderOrder = 3;
    column.add(mesh);
    return mesh;
  };
  shaft(TOP_R, UFO_R, 0x3cff88, 0.13);                       // the column
  shaft(TOP_R * 0.46, UFO_R * 0.44, 0x9fffc8, 0.20);         // a brighter core

  /* Rings running DOWN the column. A tractor beam that only glows is a
     green cone; a tractor beam with something travelling in it is
     machinery. They sweep down, the motes below drift up. */
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xbfffd8, transparent: true, opacity: 0.30, fog: false,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  ringMat.userData.baseOp = 0.30;
  beamMats.push(ringMat);
  const rings = [];
  /* Seven of them down the drop, and now that they run on past the foot
     as well, as many more as the overshoot is worth — otherwise deepening
     the cone thins out the part of it anybody can see. */
  const NRING = Math.round(7 * RUN / LEN);
  for (let i = 0; i < NRING; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 20), ringMat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 4;
    column.add(m);
    rings.push({ m, u: i / NRING });
  }

  /* Motes lifting. Small, few, and never billboarded — a solid lump
     catches the light from every angle and costs nothing. */
  const moteMat = new THREE.MeshBasicMaterial({
    color: 0xd8ffe8, transparent: true, opacity: 0.55, fog: false,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  moteMat.userData.baseOp = 0.55;
  beamMats.push(moteMat);
  const motes = [];
  const moteGeo = new THREE.IcosahedronGeometry(0.16, 0);
  for (let i = 0; i < Math.round(14 * RUN / LEN); i++) {
    const m = new THREE.Mesh(moteGeo, moteMat);
    m.renderOrder = 4;
    column.add(m);
    motes.push({ m, u: rng(), a: rng() * 6.283, rr: 0.15 + rng() * 0.8, sp: 0.06 + rng() * 0.10 });
  }

  /* ---- where it lands ----

     A disc and a ring lying flat at one height were right on sand and
     right nowhere else. Across every spot on the temple side the saucer
     is allowed to stand over, the ground under this footprint spans eight
     and a half metres — so a flat mark this wide is metres deep in the
     hill along its uphill edge and metres clear of it along its downhill
     one, a pale green sheet lying across the slope and through the trees.
     That is what the foot of the beam looked like from the terraces.

     Both marks are the same radial lattice now, every vertex dropped onto
     heightAt, so the foot is exactly where the ground is however the
     ground runs. The cone above wants none of this: it already overshoots
     by SINK, and the hillside writes depth, so the surface itself cuts
     the column off where it arrives. */
  const FOOT_SP = 20;                       // spokes
  const FOOT_RN = 8;                        // rings, out to the footprint
  const FOOT_STEP = UFO_R / (FOOT_RN - 1);
  /* The ground mesh samples heightAt every 2.8m and joins the samples
     with straight chords, so between them it hangs a good handspan below
     the surface it was cut from. A mark laid on the true height alone
     spends half its area inside the hill it is lying on. */
  const FOOT_LIFT = 0.30;

  const footPos = new THREE.BufferAttribute(new Float32Array(FOOT_SP * FOOT_RN * 3), 3);
  const footIdx = [];
  for (let k = 0; k < FOOT_RN; k++) {
    for (let s = 0; s < FOOT_SP; s++) {
      const a = (s / FOOT_SP) * Math.PI * 2;
      const i = k * FOOT_SP + s;
      footPos.setXYZ(i, Math.sin(a) * k * FOOT_STEP, 0, Math.cos(a) * k * FOOT_STEP);
      if (k === 0) continue;
      const j = k * FOOT_SP + ((s + 1) % FOOT_SP);
      footIdx.push(i - FOOT_SP, i, j, i - FOOT_SP, j, j - FOOT_SP);
    }
  }
  /* One set of vertices under both marks: the pool and the ring going out
     of it are lying on the same ground, and sharing the positions is what
     stops them ever disagreeing about where it is. */
  const footMesh = (colour, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', footPos);
    g.setAttribute('color', colour);
    g.setIndex(footIdx);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 5;
    beam.add(m);
    return m;
  };
  const footMat = (colour, op) => {
    const m = new THREE.MeshBasicMaterial({
      color: colour, vertexColors: true, transparent: true, opacity: op, fog: false,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    m.userData.baseOp = op;
    beamMats.push(m);
    return m;
  };

  /* Brightest under the column and gone by the rim, so the pool has no
     edge left to catch on the slope and read as a lid. */
  const poolCol = new THREE.BufferAttribute(new Float32Array(FOOT_SP * FOOT_RN * 3), 3);
  for (let k = 0; k < FOOT_RN; k++) {
    const u = k / (FOOT_RN - 1);
    const w = 1 - u * u;
    for (let s = 0; s < FOOT_SP; s++) poolCol.setXYZ(k * FOOT_SP + s, w, w, w);
  }
  const splashMat = footMat(0x6cff9a, 0.34);
  const pool = footMesh(poolCol, splashMat);

  /* The ring is painted into the lattice rather than scaled over it,
     which is the only way it can climb the slope with the pool. Wider
     than the gap between rings, so it crosses them instead of blinking
     from one to the next. */
  const PULSE_W = FOOT_STEP * 1.6;
  const pulseCol = new THREE.BufferAttribute(new Float32Array(FOOT_SP * FOOT_RN * 3), 3);
  const pulseMat = footMat(0xd8ffe8, 0.4);
  const pulse = footMesh(pulseCol, pulseMat);

  /* Sampled when the saucer has been given its place, and again only if
     it is ever given another: heightAt is the most expensive function on
     the island and this is a hundred and sixty of them. */
  const _bw = new THREE.Vector3();
  let footAt = null;
  const conformFoot = () => {
    beam.getWorldPosition(_bw);
    if (footAt && Math.abs(footAt.x - _bw.x) < 0.01 && Math.abs(footAt.z - _bw.z) < 0.01) return;
    footAt = { x: _bw.x, z: _bw.z };
    for (let i = 0; i < footPos.count; i++) {
      const y = heightAt(_bw.x + footPos.getX(i), _bw.z + footPos.getZ(i));
      footPos.setY(i, y - _bw.y + FOOT_LIFT);
    }
    footPos.needsUpdate = true;
    // the lattice only has an extent in y once the ground has been read
    pool.geometry.computeBoundingSphere();
    pulse.geometry.computeBoundingSphere();
  };

  /* Two lights, so the beam is something the ground knows about. The rig
     will pick them up on its next scan and take them off duty like any
     other emitter, so adding them here costs nothing. */
  const groundLight = new THREE.PointLight(0x5cff96, 0, 30, 1.6);
  groundLight.position.set(0, BOT + 3.0, 0);
  beam.add(groundLight);
  const hullLight = new THREE.PointLight(0x8fffc0, 0, 22, 1.7);
  hullLight.position.set(0, -2.4, 0);
  beam.add(hullLight);

  /* ===========================================================
     HOW IT BEHAVES
     =========================================================== */
  let visit = 0;            // 0..1, the arrival fade
  let beamOn = 0;           // 0..1, eased so it opens rather than snaps
  let beamWant = 0;

  /** k 0..1 — the arrival and departure. 0 hides it completely. */
  root.userData.setVisit = (k) => {
    visit = THREE.MathUtils.clamp(k || 0, 0, 1);
    root.visible = visit > 0.002;
    hullMat.opacity = visit;
    portMat.opacity = visit;
    /* It comes in from above and settles, and leaves the same way. The
       fade alone reads as a bug; the fade plus a metre and a half of
       drift reads as something arriving. */
    body.position.y = (1 - visit) * 7.0;
    const s = 0.82 + visit * 0.18;
    body.scale.set(s, s, s);
  };
  /** The column, on or off. */
  root.userData.setBeam = (on) => { beamWant = on ? 1 : 0; };
  /** Where the column lands, relative to the hull. */
  root.userData.beamAt = beamAt;

  root.userData.tick = (t, dt = 0.016) => {
    if (!root.visible) return;
    // the idle: a slow bob and a slower turn, both of them barely there
    body.position.y = (1 - visit) * 7.0 + Math.sin(t * 0.42) * 0.55;
    body.rotation.y = t * 0.11;
    body.rotation.z = Math.sin(t * 0.33) * 0.022;
    body.rotation.x = Math.cos(t * 0.27) * 0.018;

    // the ports breathe, and one in four runs on a different clock
    const pk = 0.72 + Math.sin(t * 1.7) * 0.20 + Math.sin(t * 9.3) * 0.06;
    portMat.opacity = visit * THREE.MathUtils.clamp(pk, 0.25, 1);

    beamOn += (beamWant - beamOn) * Math.min(1, dt * 2.2);
    const bk = beamOn * visit;
    beam.visible = bk > 0.01;
    if (!beam.visible) { groundLight.intensity = 0; hullLight.intensity = 0; return; }
    conformFoot();

    for (const m of beamMats) m.opacity = m.userData.baseOp * bk;

    /* Rings sweeping down, each one sized to the cone at whatever height
       it has got to. They share one material, so a ring that has reached
       either end of the run is hidden rather than faded — at this
       fidelity, over that distance, the two look the same. They run the
       whole length of the cone, overshoot included, so on a slope they go
       into the hill instead of stopping short above it. */
    for (const r of rings) {
      r.u = (r.u + dt * 0.16) % 1;
      r.m.position.y = TOP - r.u * RUN;
      r.m.scale.setScalar(coneR(r.u));
      r.m.visible = r.u > 0.03 && r.u < 0.97;
    }
    // motes climbing, up out of the ground rather than out of a height
    for (const p of motes) {
      p.u += dt * p.sp;
      if (p.u > 1) p.u -= 1;
      const y = TOP - (1 - p.u) * RUN;
      const rad = coneR(1 - p.u) * p.rr;
      const a = p.a + t * 0.3;
      p.m.position.set(Math.sin(a) * rad, y, Math.cos(a) * rad);
      p.m.rotation.set(a, a * 1.3, 0);
    }
    // the landing: a steady pool with a ring going out across it
    splashMat.opacity = splashMat.userData.baseOp * bk * (0.78 + Math.sin(t * 2.6) * 0.22);
    const pu = (t * 0.55) % 1;
    pulseMat.opacity = pulseMat.userData.baseOp * bk * (1 - pu);
    const pr = pu * UFO_R;
    for (let k = 0; k < FOOT_RN; k++) {
      const w = Math.max(0, 1 - Math.abs(k * FOOT_STEP - pr) / PULSE_W);
      for (let s = 0; s < FOOT_SP; s++) pulseCol.setXYZ(k * FOOT_SP + s, w, w, w);
    }
    pulseCol.needsUpdate = true;

    groundLight.intensity = 5.5 * bk * (0.85 + Math.sin(t * 3.3) * 0.15);
    hullLight.intensity = 3.2 * bk;
  };

  root.userData.setVisit(0);
  return root;
}

/* ===========================================================
   THE INTERIOR
   =========================================================== */
export function buildUfo(mats) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03090a);
  scene.fog = new THREE.Fog(0x0a2020, 16, 58);

  const rng = makeRng(0x03);
  const P = [];

  /* ---- the floor: concentric plating ----
     Four discs, each a few millimetres over the last and a shade off it.
     Raised seams would be something to trip over at this scale; a change
     of value reads as plating and clips through nobody's boot. */
  const FLOOR = [
    [RAD, 0.000, G(0x3a4448)], [8.2, 0.004, G(0x46525a)],
    [5.6, 0.008, G(0x3e4a50)], [3.0, 0.012, G(0x4c5a62)],
  ];
  for (const [r, y, col] of FLOOR) {
    P.push(tint(cyl(r, r, 0.36, 24, 'metal', { pos: [0, y - 0.18, 0] }), col));
  }
  // radial seams, sixteen of them, running out from under the plinth
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    P.push(tint(box(0.09, 0.02, RAD - 1.2, 'metal', {
      pos: [Math.sin(a) * (RAD / 2 + 0.4), 0.018, Math.cos(a) * (RAD / 2 + 0.4)], rot: [0, a, 0],
    }), DARK));
  }

  /* ---- the wall: twenty panels round a circle ---- */
  const NSEG = 20;
  const CHORD = (Math.PI * 2 * WALL_M) / NSEG + 0.06;
  for (let i = 0; i < NSEG; i++) {
    const a = (i / NSEG) * Math.PI * 2;
    const px = Math.sin(a) * WALL_M, pz = Math.cos(a) * WALL_M;
    P.push(tint(box(CHORD, UFO_H, 0.5, 'metal', { pos: [px, UFO_H / 2, pz], rot: [0, a, 0] }),
      STEEL.clone().multiplyScalar(0.62 + ((i * 5) % 7) / 30)));
    // the seam between this panel and the next
    const sa = ((i + 0.5) / NSEG) * Math.PI * 2;
    P.push(tint(box(0.14, UFO_H, 0.62, 'metal', {
      pos: [Math.sin(sa) * WALL_M, UFO_H / 2, Math.cos(sa) * WALL_M], rot: [0, sa, 0],
    }), DARK));
    // a kick band at the bottom and a service rail at chest height
    P.push(tint(box(CHORD, 0.34, 0.60, 'metal', { pos: [px, 0.17, pz], rot: [0, a, 0] }), STEEL_D));
    P.push(tint(box(CHORD, 0.10, 0.60, 'metal', { pos: [px, 1.22, pz], rot: [0, a, 0] }), BRASS));
    // conduit running up every third panel
    if (i % 3 === 0) {
      P.push(tint(cyl(0.06, 0.06, UFO_H - 0.5, 6, 'metal', {
        pos: [Math.sin(a) * (RAD - 0.12), UFO_H / 2, Math.cos(a) * (RAD - 0.12)],
      }), i % 2 ? BRASS : RUST));
    }
  }

  /* ---- the ceiling: a stepped dome on twelve ribs ---- */
  P.push(tint(cyl(8.6, RAD, 0.55, 20, 'metal', { pos: [0, UFO_H + 0.28, 0] }), STEEL_D));
  P.push(tint(cyl(6.2, 8.6, 0.50, 18, 'metal', { pos: [0, UFO_H + 0.78, 0] }), G(0x5a666e)));
  P.push(tint(cyl(3.4, 6.2, 0.45, 14, 'metal', { pos: [0, UFO_H + 1.23, 0] }), STEEL_D));
  P.push(tint(cone(3.4, 0.80, 14, 'metal', { pos: [0, UFO_H + 1.85, 0] }), G(0x4a565e)));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    P.push(tint(box(0.12, 0.14, 7.4, 'metal', {
      pos: [Math.sin(a) * 3.9, UFO_H + 0.62, Math.cos(a) * 3.9], rot: [0.22, a, 0],
    }), BRASS));
  }

  /* ---- the pad the beam sets you down on ----
     Flush with the floor and ringed with chevrons. Nothing stands up out
     of it: this is the one square metre of the room where somebody
     materialises, and a rail there would be a rail to walk through. */
  {
    const E = UFO_ENTRY;
    P.push(tint(cyl(2.15, 2.15, 0.34, 16, 'metal', { pos: [E.x, -0.15, E.z] }), STEEL_D));
    P.push(tint(cyl(1.72, 1.72, 0.34, 16, 'metal', { pos: [E.x, -0.14, E.z] }), VOID));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      P.push(tint(box(0.42, 0.07, 0.20, 'metal', {
        pos: [E.x + Math.sin(a) * 1.95, 0.035, E.z + Math.cos(a) * 1.95], rot: [0, a, 0],
      }), i % 2 ? HAZARD : DARK));
    }
  }

  /* ---- the consoles ---- */
  const screens = [];
  for (let b = 0; b < BANK_A.length; b++) {
    const a = BANK_A[b];
    const C = [];
    // desk: a slab with a slanted top and a stack of gear behind it
    C.push(tint(box(3.0, 0.90, 0.85, 'metal', { pos: [0, 0.45, 0] }), STEEL_D));
    C.push(tint(box(3.1, 0.10, 0.95, 'metal', { pos: [0, 0.93, 0.03] }), G(0x5a666e)));
    C.push(tint(box(2.8, 0.14, 0.60, 'metal', { pos: [0, 1.10, -0.22], rot: [-0.55, 0, 0] }), DARK));
    C.push(tint(box(3.0, 1.30, 0.55, 'metal', { pos: [0, 1.55, -0.60] }), STEEL));
    C.push(tint(box(3.05, 0.10, 0.60, 'metal', { pos: [0, 2.22, -0.60] }), BRASS));
    // the bank of switches on the desk top, which is what a hand goes to
    for (let i = 0; i < 9; i++) {
      C.push(tint(box(0.11, 0.07, 0.11, 'metal', { pos: [-1.1 + i * 0.275, 1.01, 0.14] }),
        i % 3 === 0 ? HAZARD : BRASS));
    }
    // seams and rivets, because a flat slab is a flat slab
    for (const sy of [0.30, 0.62]) {
      C.push(tint(box(3.02, 0.03, 0.87, 'metal', { pos: [0, sy, 0] }), DARK));
    }
    for (const sx of [-1.45, 1.45]) {
      C.push(tint(box(0.10, 1.30, 0.58, 'metal', { pos: [sx, 1.55, -0.60] }), STEEL_D));
    }
    // cable loom dropping out of the back into the floor
    for (let i = 0; i < 3; i++) {
      C.push(tint(cyl(0.035, 0.035, 1.5, 4, 'metal', {
        pos: [-0.5 + i * 0.5, 0.75, -0.92], rot: [0.16, 0, (rng() - 0.5) * 0.3],
      }), i % 2 ? RUST : G(0x2a2e32)));
    }
    drop(P, C, Math.sin(a) * BANK_R, 0, Math.cos(a) * BANK_R, a + Math.PI);

    /* The face of it. Only the three manned banks get a live screen —
       the outer two are dark racks, which stops the arc reading as
       wallpaper. */
    if (BOT_BANKS.includes(b)) {
      /* The only thing in the far arc that makes its own light was
         waiting for the room to light it, so it sat at the same value as
         the steel around it and the crew standing in front of it had
         nothing to stand against. It is a screen: the glyphs carry
         themselves and the plate behind them stays as dark as it is
         drawn, which is what puts a machine's outline into the picture. */
      const tex = consoleTex(b * 17 + 3);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(2.3, 1.0),
        new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex })
      );
      /* Just inside the face of the back stack, not floating over the
         desk: the stack's inward face is at BANK_R + 0.325. */
      const rr = BANK_R + 0.30;
      m.position.set(Math.sin(a) * rr, 1.60, Math.cos(a) * rr);
      m.rotation.y = a + Math.PI;
      scene.add(m);
      screens.push(m);
    }
  }

  /* ---- the charging rack ----
     Four bays. Three of them are live. The third has a dead lamp, a torn
     loom hanging out of it, and nothing standing in it, and it has been
     like that for as long as there has been a wreck on that beach. */
  {
    const a = CRADLE_A;
    const K = [];
    K.push(tint(box(4.2, 2.6, 0.55, 'metal', { pos: [0, 1.30, 0] }), STEEL_D));
    K.push(tint(box(4.3, 0.14, 0.70, 'metal', { pos: [0, 2.60, 0] }), BRASS));
    for (let i = 0; i < 4; i++) {
      const bx = -1.575 + i * 1.05;
      // the bay itself, recessed
      K.push(tint(box(0.86, 2.10, 0.30, 'metal', { pos: [bx, 1.20, 0.16] }), VOID));
      K.push(tint(box(0.10, 2.20, 0.42, 'metal', { pos: [bx - 0.48, 1.22, 0.10] }), STEEL));
      K.push(tint(box(0.10, 2.20, 0.42, 'metal', { pos: [bx + 0.48, 1.22, 0.10] }), STEEL));
      // the clamp that holds a unit's shoulders
      K.push(tint(box(0.80, 0.12, 0.26, 'metal', { pos: [bx, 1.90, 0.22] }), STEEL_D));
      K.push(tint(cyl(0.05, 0.05, 0.60, 5, 'metal', { pos: [bx, 0.35, 0.24] }), BRASS));
      // and its umbilical: coiled on the live bays, torn out on 03
      if (i === 2) {
        for (let k = 0; k < 4; k++) {
          K.push(tint(cyl(0.028, 0.028, 0.7 + rng() * 0.5, 4, 'metal', {
            pos: [bx - 0.2 + k * 0.13, 1.0 - rng() * 0.4, 0.30 + rng() * 0.1],
            rot: [1.0 + rng() * 0.8, rng() * 3, (rng() - 0.5) * 0.8],
          }), k % 2 ? RUST : G(0x2a2e32)));
        }
      } else {
        K.push(tint(cyl(0.05, 0.05, 0.9, 5, 'metal', {
          pos: [bx, 1.55, 0.30], rot: [0, 0, 0.3],
        }), G(0x2a2e32)));
      }
    }
    drop(P, K, Math.sin(a) * (RAD - 0.30), 0, Math.cos(a) * (RAD - 0.30), a + Math.PI);
  }

  /* ---- the holo table ----
     A pedestal with a green wireframe of something above it. What it is
     showing is not a question this file answers. */
  {
    const T = [];
    T.push(tint(cyl(0.95, 1.15, 0.75, 12, 'metal', { pos: [0, 0.37, 0] }), STEEL_D));
    T.push(tint(cyl(1.05, 1.05, 0.10, 12, 'metal', { pos: [0, 0.78, 0] }), BRASS));
    T.push(tint(cyl(0.90, 0.90, 0.06, 12, 'metal', { pos: [0, 0.84, 0] }), VOID));
    for (let i = 0; i < 6; i++) {
      const a2 = (i / 6) * Math.PI * 2;
      T.push(tint(box(0.16, 0.08, 0.16, 'metal', {
        pos: [Math.sin(a2) * 0.95, 0.86, Math.cos(a2) * 0.95], rot: [0, a2, 0],
      }), i % 2 ? HAZARD : BRASS));
    }
    drop(P, T, HOLO.x, 0, HOLO.z, 0);
  }

  /* ---- the plinth ----
     A column in the middle of the room with a shut iris on top of it.
     Empty and shut is the room's resting state; the plate is the only
     thing that changes it. */
  const PL = [];
  PL.push(tint(cyl(0.52, 0.78, 1.00, 10, 'metal', { pos: [0, 0.50, 0] }), STEEL_D));
  PL.push(tint(cyl(0.60, 0.60, 0.10, 10, 'metal', { pos: [0, 0.42, 0] }), BRASS));
  PL.push(tint(cyl(0.66, 0.54, 0.14, 10, 'metal', { pos: [0, 1.05, 0] }), STEEL));
  PL.push(tint(cyl(0.50, 0.50, 0.05, 10, 'metal', { pos: [0, 1.13, 0] }), VOID));
  for (let i = 0; i < 5; i++) {
    const a2 = (i / 5) * Math.PI * 2;
    PL.push(tint(box(0.10, 1.0, 0.10, 'metal', {
      pos: [Math.sin(a2) * 0.68, 0.50, Math.cos(a2) * 0.68], rot: [0, a2, 0],
    }), i % 2 ? BRASS : STEEL_D));
  }
  drop(P, PL, UFO_PLINTH.x, 0, UFO_PLINTH.z, 0);

  /* ---- the pressure plate ----
     Its housing is part of the room; the disc that sinks is not. */
  {
    const H = [];
    H.push(tint(cyl(UFO_PLATE.r + 0.42, UFO_PLATE.r + 0.42, 0.34, 14, 'metal', {
      pos: [0, -0.14, 0],
    }), STEEL_D));
    H.push(tint(cyl(UFO_PLATE.r + 0.18, UFO_PLATE.r + 0.18, 0.30, 14, 'metal', {
      pos: [0, -0.10, 0],
    }), VOID));
    // hazard teeth round the rim, so it looks like something that moves
    for (let i = 0; i < 12; i++) {
      const a2 = (i / 12) * Math.PI * 2;
      H.push(tint(box(0.34, 0.06, 0.22, 'metal', {
        pos: [Math.sin(a2) * (UFO_PLATE.r + 0.32), 0.04, Math.cos(a2) * (UFO_PLATE.r + 0.32)],
        rot: [0, a2, 0],
      }), i % 2 ? HAZARD : DARK));
    }
    drop(P, H, UFO_PLATE.x, 0, UFO_PLATE.z, 0);
  }

  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---- everything that is lit, in one basic material ---- */
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  {
    const L = [];
    // the ring of ports round the wall, at head height
    for (let i = 0; i < NSEG; i++) {
      const a = (i / NSEG) * Math.PI * 2;
      L.push(tint(box(1.10, 0.34, 0.10, 'metal', {
        pos: [Math.sin(a) * (RAD - 0.06), 2.55, Math.cos(a) * (RAD - 0.06)], rot: [0, a, 0],
      }), i % 5 === 0 ? G(0xffd24a) : GREEN));
    }
    // the boss in the middle of the dome, over the plinth
    L.push(tint(cyl(1.5, 1.5, 0.08, 14, 'metal', { pos: [0, UFO_H + 1.40, 0] }), GREEN));
    /* A strip over each manned bench, hung where its lamp is: light in
       this room comes out of something, and a lit bar above head height
       is also the thing a Tashabot's shoulders are seen against. */
    for (const b of BOT_BANKS) {
      const a2 = BANK_A[b];
      L.push(tint(box(2.6, 0.10, 0.22, 'metal', {
        pos: [Math.sin(a2) * DESK_FACE, UFO_H - 0.5, Math.cos(a2) * DESK_FACE], rot: [0, a2, 0],
      }), G(0xd8ffe8)));
    }
    // the aperture, lit from below
    L.push(tint(cyl(1.68, 1.68, 0.05, 16, 'metal', {
      pos: [UFO_ENTRY.x, 0.05, UFO_ENTRY.z],
    }), GREEN));
    scene.add(new THREE.Mesh(mergeGeos(L), glowMat));
  }

  // the rack's four numbers, one strip, one draw
  {
    const a = CRADLE_A;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(4.0, 0.62),
      new THREE.MeshLambertMaterial({ map: cradleTex() })
    );
    const rr = RAD - 0.52;
    m.position.set(Math.sin(a) * rr, 2.42, Math.cos(a) * rr);
    m.rotation.y = a + Math.PI;
    scene.add(m);
  }

  /* The holo itself: three rings and a cone of light over the table. */
  const holoMat = new THREE.MeshBasicMaterial({
    color: 0x7fffc0, transparent: true, opacity: 0.30, fog: false,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const holo = new THREE.Group();
  holo.position.set(HOLO.x, 0.88, HOLO.z);
  {
    const cn = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.5, 10, 1, true), holoMat);
    cn.position.y = 0.75;
    holo.add(cn);
    for (let i = 0; i < 3; i++) {
      const r2 = new THREE.Mesh(new THREE.RingGeometry(0.30 + i * 0.18, 0.36 + i * 0.18, 16), holoMat);
      r2.rotation.x = -Math.PI / 2;
      r2.position.y = 0.35 + i * 0.34;
      holo.add(r2);
    }
  }
  scene.add(holo);

  /* ===========================================================
     THE PLATE AND THE PLINTH — the two moving parts
     =========================================================== */

  /* The disc. It sits proud of its housing and sinks flush when there is
     somebody on it, and its eight lamps go from amber to green, which is
     the tell the person on the far side of the room reads. */
  const plateNode = new THREE.Group();
  plateNode.position.set(UFO_PLATE.x, 0, UFO_PLATE.z);
  const plateLampMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
  {
    const D = [];
    D.push(tint(cyl(UFO_PLATE.r, UFO_PLATE.r - 0.06, 0.22, 14, 'metal', { pos: [0, 0.11, 0] }), STEEL));
    D.push(tint(cyl(UFO_PLATE.r - 0.10, UFO_PLATE.r - 0.10, 0.05, 14, 'metal', { pos: [0, 0.23, 0] }), STEEL_D));
    // a tread pattern, because a plate you stand on has one
    for (let i = 0; i < 4; i++) {
      D.push(tint(box(0.14, 0.05, UFO_PLATE.r * 1.85, 'metal', {
        pos: [0, 0.26, 0], rot: [0, (i / 4) * Math.PI, 0],
      }), DARK));
    }
    D.push(tint(cyl(0.30, 0.30, 0.06, 10, 'metal', { pos: [0, 0.28, 0] }), BRASS));
    plateNode.add(new THREE.Mesh(mergeGeos(D), mats.opaque));

    const lamps = [];
    for (let i = 0; i < 8; i++) {
      const a2 = (i / 8) * Math.PI * 2 + 0.2;
      lamps.push(tint(box(0.16, 0.07, 0.16, 'metal', {
        pos: [Math.sin(a2) * (UFO_PLATE.r - 0.22), 0.26, Math.cos(a2) * (UFO_PLATE.r - 0.22)],
        rot: [0, a2, 0],
      }), G(0xffffff)));
    }
    const lm = new THREE.Mesh(mergeGeos(lamps), plateLampMat);
    plateNode.add(lm);
  }
  scene.add(plateNode);

  /* The plinth's iris: five petals that fold back. Shut is the default,
     and shut is what it goes back to the moment the plate comes up. */
  const iris = new THREE.Group();
  iris.position.set(UFO_PLINTH.x, 1.10, UFO_PLINTH.z);
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const a2 = (i / 5) * Math.PI * 2;
    const hinge = new THREE.Group();
    hinge.rotation.y = a2;
    const p = new THREE.Mesh(mergeGeos([
      tint(box(0.34, 0.05, 0.44, 'metal', { pos: [0, 0, 0.22] }), STEEL_L),
      tint(box(0.36, 0.03, 0.10, 'metal', { pos: [0, 0.02, 0.05] }), BRASS),
    ]), mats.opaque);
    hinge.add(p);
    iris.add(hinge);
    petals.push(hinge);
  }
  scene.add(iris);

  /* The scanner, on the plinth. It is only ever animated while it is
     still standing on the plinth — if the game lifts this node into a
     hand, the spin stops and it becomes a held object. */
  const scannerNode = buildScannerProp(mats);
  scannerNode.position.set(UFO_PLINTH.x, UFO_PLINTH.y, UFO_PLINTH.z);
  scannerNode.visible = false;
  scene.add(scannerNode);
  const scannerHome = scene;

  /* ===========================================================
     THE TASHABOTS
     =========================================================== */
  const bots = [];
  for (let i = 0; i < BOT_BANKS.length; i++) {
    const a = BANK_A[BOT_BANKS[i]];
    const b = buildTashabot(mats, i + 4, rng);
    const st = botStand(a);
    b.position.set(st.x, 0, st.z);
    b.rotation.y = st.yaw;
    scene.add(b);
    bots.push({ node: b, watch: false });
  }
  {
    const b = buildTashabot(mats, 7, rng);
    b.position.set(HOLO_BOT.x, 0, HOLO_BOT.z);
    b.rotation.y = HOLO_BOT.yaw;
    scene.add(b);
    bots.push({ node: b, watch: true });
  }

  /* ===========================================================
     LIGHT

     Every light is made now and never added or removed. The count is
     baked into every shader's cache key, and a light appearing when the
     scanner does would recompile the room in the middle of a round.
     =========================================================== */
  scene.add(new THREE.AmbientLight(0x86c0a8, 1.45));
  scene.add(new THREE.HemisphereLight(0xa8ffd8, 0x102420, 1.00));

  const bossLight = new THREE.PointLight(0x6cff9a, 2.4, 20, 1.6);
  bossLight.position.set(0, UFO_H + 0.9, 0);
  scene.add(bossLight);

  const entryLight = new THREE.PointLight(0x8fffc0, 2.4, 12, 1.7);
  entryLight.position.set(UFO_ENTRY.x, 0.7, UFO_ENTRY.z);
  scene.add(entryLight);

  const holoLight = new THREE.PointLight(0x7fffc0, 1.8, 10, 1.7);
  holoLight.position.set(HOLO.x, 1.5, HOLO.z);
  scene.add(holoLight);

  /* A lamp over each manned bench. There were two, and both of them
     stood at BANK_R - 1.2 and head height, which is a finger's breadth
     from where a Tashabot's head actually is: the two crew that had a
     lamp were standing inside it and came out flat white, and the one in
     the middle of the arc — the one you look straight at, walking in —
     had none at all. Hung over the working edge of the desk instead and
     well above anybody's head, each lamp lights its own console and rakes
     down the back and shoulders of the machine at it, so the crew read as
     lit edges in front of a lit wall rather than as more wall. */
  const conLights = [];
  for (const b of BOT_BANKS) {
    const a = BANK_A[b];
    const L = new THREE.PointLight(0x9fffd0, 3.2, 13, 1.7);
    L.position.set(Math.sin(a) * DESK_FACE, UFO_H - 0.6, Math.cos(a) * DESK_FACE);
    scene.add(L);
    conLights.push(L);
  }

  const plateLight = new THREE.PointLight(0xffb060, 1.7, 9, 1.8);
  plateLight.position.set(UFO_PLATE.x, 1.1, UFO_PLATE.z);
  scene.add(plateLight);

  // starts dark: there is nothing on the plinth until the plate says so
  const plinthLight = new THREE.PointLight(0x6cff9a, 0, 12, 1.6);
  plinthLight.position.set(UFO_PLINTH.x, 1.9, UFO_PLINTH.z);
  scene.add(plinthLight);

  /* ===========================================================
     HOW IT BEHAVES
     =========================================================== */
  let plateWant = 0, plateK = 0;      // 0 up, 1 flush
  let irisWant = 0, irisK = 0;        // 0 shut, 1 open

  scene.userData.plateNode = plateNode;
  scene.userData.scannerNode = scannerNode;
  scene.userData.plinthNode = iris;
  scene.userData.bots = bots.map((b) => b.node);

  /** Somebody is standing on it, or is not. */
  scene.userData.setPlate = (down) => { plateWant = down ? 1 : 0; };
  /** The scanner is on its plinth, or is not. */
  scene.userData.setScanner = (shown) => {
    irisWant = shown ? 1 : 0;
    scannerNode.visible = !!shown;
  };

  scene.userData.tick = (t, dt = 0.016, camPos = null) => {
    // the plate: a short travel with the last of it slow, like a hydraulic
    plateK += (plateWant - plateK) * Math.min(1, dt * 7);
    plateNode.position.y = -plateK * 0.17;
    const pk = plateK;
    plateLampMat.color.setRGB(
      1.0 - pk * 0.58, 0.69 + pk * 0.31, 0.38 + pk * 0.22
    );
    plateLight.color.setRGB(1.0 - pk * 0.58, 0.69 + pk * 0.31, 0.38 + pk * 0.22);
    plateLight.intensity = 1.7 + pk * 1.9 + Math.sin(t * 8) * 0.1 * pk;

    // the iris, and the light that comes up out of it
    irisK += (irisWant - irisK) * Math.min(1, dt * 5);
    for (let i = 0; i < petals.length; i++) {
      petals[i].rotation.x = -irisK * 1.65;
      petals[i].position.y = irisK * 0.05;
    }
    plinthLight.intensity = irisK * (3.6 + Math.sin(t * 3.4) * 0.5);

    // the scanner, while it is still standing where it was put
    if (scannerNode.visible) {
      scannerNode.userData.tick?.(t);
      if (scannerNode.parent === scannerHome) {
        scannerNode.position.y = UFO_PLINTH.y + Math.sin(t * 1.9) * 0.035;
        scannerNode.rotation.y = t * 0.55;
        scannerNode.rotation.x = 0.12;
      }
    }

    // the room's own pulse
    bossLight.intensity = 2.3 + Math.sin(t * 1.3) * 0.35;
    entryLight.intensity = 2.3 + Math.sin(t * 2.7) * 0.30;
    holoLight.intensity = 1.7 + Math.sin(t * 4.1) * 0.28;
    for (let i = 0; i < conLights.length; i++) {
      conLights[i].intensity = 3.1 + Math.sin(t * 5.3 + i * 2.1) * 0.45;
    }
    // the holo turns and breathes
    holo.rotation.y = t * 0.35;
    holoMat.opacity = 0.24 + Math.sin(t * 2.2) * 0.07;
    // the screens tick over
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      const k = 0.86 + Math.sin(t * 6.1 + i * 1.7) * 0.10 + (Math.sin(t * 31 + i) > 0.96 ? -0.3 : 0);
      s.material.color.setRGB(k, k, k);
      // the glow ticks over with the picture, or the flicker is only half there
      s.material.emissiveIntensity = k;
    }

    for (const b of bots) b.node.userData.tick?.(t, camPos, b.watch);
  };

  scene.userData.setPlate(false);
  scene.userData.setScanner(false);
  return scene;
}

/* ===========================================================
   WHAT YOU CANNOT WALK THROUGH

   The wall is a circle and insideBox is a square, so the ring below is
   what actually holds you in: thirty overlapping circles just outside
   the panelling, whose inner edges describe the wall. Everything else
   is furniture.
   =========================================================== */
export const UFO_COLLIDERS = (() => {
  const out = [];
  // the wall
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    out.push({ x: Math.sin(a) * 11.4, z: Math.cos(a) * 11.4, r: 1.5 });
  }
  /* The console banks. Five small overlapping circles along each desk
     rather than three big ones: the desk face is at BANK_R - 0.43, and a
     circle wide enough to be spaced out is a circle that holds you a
     metre back from a desk you are supposed to be able to stand at. */
  for (const a of BANK_A) {
    for (let k = -2; k <= 2; k++) {
      const t = a + k * (0.70 / BANK_R);
      out.push({ x: Math.sin(t) * BANK_R, z: Math.cos(t) * BANK_R, r: 0.50 });
    }
  }
  // the Tashabots, who are machines and do not step aside
  for (const b of BOT_BANKS) {
    const st = botStand(BANK_A[b]);
    out.push({ x: st.x, z: st.z, r: 0.42 });
  }
  out.push({ x: HOLO_BOT.x, z: HOLO_BOT.z, r: 0.42 });
  // the plinth and the holo table
  out.push({ x: UFO_PLINTH.x, z: UFO_PLINTH.z, r: 0.85 });
  out.push({ x: HOLO.x, z: HOLO.z, r: 1.15 });
  /* The charging rack sits against the wall, so the ring already covers
     it. The pressure plate is deliberately absent: it is the one thing
     in the room you are meant to stand on. */
  return out;
})();
