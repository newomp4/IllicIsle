/* ===========================================================
   cathy.js — Cathy, and the stall she runs out of a crate.

   She is on the far side of the island from the camp, behind the
   hill, where there is nothing else at all. She sells food. She
   has a cheeseburger built into her face and she has never once
   mentioned it.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, ico, sphere, tint, blankUV } from '../lib/geo.js';
import { buildSignTexture } from '../lib/textures.js';

const G = (n) => new THREE.Color(n);

/* Where she might set up. All on the opposite side of the island from the
   wreck camp at (-46, 154), behind the ridge, in the quarter of the map that
   has nothing else in it. One is chosen at random per round. */
export const CATHY_SPOTS = [
  { x: -118, z: -92, name: 'THE FAR SHOULDER' },
  { x: -142, z: -46, name: 'THE WEST HEADLAND' },
  { x: -92, z: -140, name: 'BEHIND THE RIDGE' },
  { x: -44, z: -162, name: 'THE NORTH SHINGLE' },
];

/** The footprint her stall needs to stand on. */
export const CATHY_FOOT = [
  [-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1], [0, 0],
];

/* ===========================================================
   CATHY
   =========================================================== */
export function buildCathy(rng, mats, flameFactory) {
  const g = new THREE.Group();

  const SKIN = G(0xe0b295), SKIN_D = G(0xc4917a);
  /* Her hair is painted on the DRIFTWOOD cell, not the 'hair' one.

     The hair cell is a sixteen-per-cent-lightness brown, so any brown tint
     multiplied through it lands at almost black: she came out as a dark slab
     with a cheeseburger stuck to it. Driftwood is a mid-tone grain, and a
     brown through that reads as brown. */
  const HC = 'driftwood';
  const HAIR = G(0x9a6234), HAIR_L = G(0xc08a4e), HAIR_D = G(0x6b4222);
  /* Black, but not a void. 0x1c1c20 through the cloth cell came out at four
     per cent grey: a silhouette with no folds and no shoulders in it. */
  const TEE = G(0x3c3c46), TEE_L = G(0x5a5a68), TEE_D = G(0x26262e);

  /* ---------- her, on her own pivot so she can shift her weight ---------- */
  const her = new THREE.Group();
  const P = [];

  /* Heavyset — but a person, not a barrel.

     The first version gave her a torso of radius 0.70, which is a metre and
     a half across: three times a real pair of shoulders, and next to it her
     head looked like a doorknob. These are the measurements of somebody
     genuinely heavy: a 72 cm waist through the middle, tapering up to
     shoulders under 60 cm, in a tee that hangs rather than fits. */
  P.push(tint(cyl(0.34, 0.36, 0.54, 10, 'clothTat', { pos: [0, 1.16, 0] }), TEE));
  P.push(tint(cyl(0.36, 0.34, 0.30, 10, 'clothTat', { pos: [0, 0.80, 0] }), TEE));
  P.push(tint(cyl(0.30, 0.28, 0.22, 10, 'clothTat', { pos: [0, 1.50, 0] }), TEE));
  // the hem, sitting proud of her
  P.push(tint(cyl(0.37, 0.36, 0.09, 10, 'clothTat', { pos: [0, 0.62, 0] }), TEE_D));
  // a fold of the shirt down the front, so the black is not one flat shape
  P.push(tint(box(0.06, 0.46, 0.06, 'clothTat', { pos: [0.08, 1.14, 0.31] }), TEE_L));
  // shoulders, sloped
  for (const sx of [-1, 1]) {
    P.push(tint(sphere(0.145, 8, 6, 'clothTat', { pos: [sx * 0.29, 1.55, 0] }), TEE));
    // arms, thick, hanging slightly away from her sides
    P.push(tint(cyl(0.105, 0.088, 0.42, 8, 'clothTat', {
      pos: [sx * 0.35, 1.32, 0.02], rot: [0, 0, sx * 0.09],
    }), TEE));
    P.push(tint(cyl(0.078, 0.070, 0.36, 8, 'skin', {
      pos: [sx * 0.39, 0.96, 0.05], rot: [0, 0, sx * 0.05],
    }), SKIN));
    P.push(tint(sphere(0.085, 7, 5, 'skin', { pos: [sx * 0.41, 0.77, 0.06] }), SKIN));
  }
  // legs, in dark trousers, mostly hidden behind the counter
  for (const sx of [-0.17, 0.17]) {
    P.push(tint(cyl(0.155, 0.130, 0.70, 8, 'clothTat', { pos: [sx, 0.40, 0] }), G(0x24242c)));
    P.push(tint(box(0.19, 0.09, 0.30, 'clothTat', { pos: [sx, 0.05, 0.05] }), G(0x14141a)));
  }
  // a short neck
  P.push(tint(cyl(0.095, 0.10, 0.12, 8, 'skin', { pos: [0, 1.64, 0.01] }), SKIN_D));

  /* ---------- the head ----------
     Round, full-cheeked, and the lower half of it is a cheeseburger. The
     order from the photograph, top down: a slab of melted cheese draped over
     where the top lip would be, then a frill of lettuce, then the patty,
     then tomato, then more lettuce underneath. */
  const HEAD_Y = 1.86;
  P.push(tint(sphere(0.255, 10, 8, 'skin', { pos: [0, HEAD_Y, 0] }), SKIN));
  // full cheeks
  for (const sx of [-1, 1]) {
    P.push(tint(sphere(0.105, 7, 5, 'skin', { pos: [sx * 0.170, HEAD_Y - 0.075, 0.150] }), SKIN));
  }
  // a soft jaw and a double chin, because she is heavyset and it should show
  P.push(tint(sphere(0.185, 8, 6, 'skin', { pos: [0, HEAD_Y - 0.17, 0.045] }), SKIN));
  P.push(tint(cyl(0.155, 0.185, 0.09, 10, 'skin', { pos: [0, HEAD_Y - 0.28, 0.02] }), SKIN_D));
  // the nose, snub
  P.push(tint(ico(0.048, 0, 'skin', { pos: [0, HEAD_Y + 0.015, 0.255] }), SKIN));

  g.userData.headY = HEAD_Y;

  /* ---------- her hair ----------
     Shoulder length, straight, with a heavy fringe cut level across the
     brow. The fringe is the thing that makes the face read as hers. */
  // the back and sides, a helmet that reaches her shoulders
  P.push(tint(sphere(0.278, 10, 8, HC, { pos: [0, HEAD_Y + 0.025, -0.025] }), HAIR));
  P.push(tint(sphere(0.248, 9, 7, HC, { pos: [0, HEAD_Y + 0.115, -0.03] }), HAIR_L));
  for (const sx of [-1, 1]) {
    // the length down each side of her face
    P.push(tint(box(0.125, 0.46, 0.26, HC, {
      pos: [sx * 0.225, HEAD_Y - 0.19, -0.025], rot: [0, 0, sx * -0.05],
    }), HAIR));
    // and the tips, cut blunt
    P.push(tint(box(0.135, 0.085, 0.24, HC, { pos: [sx * 0.225, HEAD_Y - 0.41, -0.02] }), HAIR_D));
  }
  P.push(tint(box(0.38, 0.40, 0.13, HC, { pos: [0, HEAD_Y - 0.10, -0.23] }), HAIR));
  /* The fringe: a slab across the brow, cut level, sitting just off the face.

     It used to hang to HEAD_Y + 0.06 while the burger reached up to
     HEAD_Y - 0.01, which left seven centimetres of face between them — her
     eyes were in there somewhere and you could not see either of them. The
     brow line is at + 0.11 now and the burger tops out at - 0.05, so there
     is sixteen centimetres of face with eyes and cheeks in it. */
  P.push(tint(box(0.44, 0.13, 0.115, HC, { pos: [0, HEAD_Y + 0.175, 0.185] }), HAIR));
  P.push(tint(box(0.47, 0.10, 0.17, HC, { pos: [0, HEAD_Y + 0.245, 0.130] }), HAIR_L));
  // the blunt cut line, a shade darker so the fringe has an edge
  P.push(tint(box(0.44, 0.028, 0.112, HC, { pos: [0, HEAD_Y + 0.115, 0.19] }), HAIR_D));
  // a couple of strands falling out of it
  P.push(tint(box(0.045, 0.10, 0.04, HC, { pos: [-0.115, HEAD_Y + 0.09, 0.235], rot: [0, 0, 0.2] }), HAIR_D));
  P.push(tint(box(0.04, 0.085, 0.04, HC, { pos: [0.14, HEAD_Y + 0.10, 0.23], rot: [0, 0, -0.3] }), HAIR_D));

  her.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---------- the burger in her face ----------
     Its own group so the layers can settle and the lettuce can wobble. */
  const burger = new THREE.Group();
  burger.position.set(0, HEAD_Y - 0.135, 0.20);
  const B = [];
  const CHEESE = G(0xf0a828), LETTUCE = G(0x5f9e34), LETTUCE_L = G(0x83c452);
  const PATTY = G(0x6b4326), PATTY_D = G(0x4a2c17), TOMATO = G(0xc8342a);

  // the cheese, draped, wider than the rest and drooping at the corners
  B.push(tint(box(0.33, 0.048, 0.12, 'cheese', { pos: [0, 0.062, 0] }), CHEESE));
  for (const sx of [-1, 1]) {
    B.push(tint(box(0.075, 0.085, 0.095, 'cheese', {
      pos: [sx * 0.165, 0.028, 0.008], rot: [0, 0, sx * -0.5],
    }), CHEESE));
  }
  // the top frill of lettuce, poking out at the sides
  B.push(tint(box(0.35, 0.042, 0.115, 'lettuce', { pos: [0, 0.020, 0.004] }), LETTUCE));
  for (let i = 0; i < 7; i++) {
    const lx = -0.20 + i * 0.067;
    B.push(tint(box(0.058, 0.038, 0.058, 'lettuce', {
      pos: [lx, 0.025, 0.046], rot: [0.2, i * 0.7, (i % 2 ? 1 : -1) * 0.3],
    }), i % 2 ? LETTUCE : LETTUCE_L));
  }
  // the patty, thick, with a browned edge
  B.push(tint(box(0.30, 0.062, 0.11, 'patty', { pos: [0, -0.030, 0] }), PATTY));
  B.push(tint(box(0.31, 0.018, 0.115, 'patty', { pos: [0, -0.060, 0] }), PATTY_D));
  // the tomato, one slice, showing at the edges
  B.push(tint(box(0.32, 0.042, 0.10, 'tomato', { pos: [0, -0.084, 0.004] }), TOMATO));
  // and the bottom lettuce
  B.push(tint(box(0.33, 0.038, 0.10, 'lettuce', { pos: [0, -0.118, 0] }), LETTUCE));
  for (let i = 0; i < 6; i++) {
    const lx = -0.175 + i * 0.071;
    B.push(tint(box(0.058, 0.034, 0.055, 'lettuce', {
      pos: [lx, -0.122, 0.042], rot: [-0.25, i * 0.8, (i % 2 ? -1 : 1) * 0.35],
    }), i % 2 ? LETTUCE_L : LETTUCE));
  }
  burger.add(new THREE.Mesh(mergeGeos(B), mats.opaque));
  her.add(burger);

  /* ---------- her eyes ----------
     Under the fringe, and they follow you, which is the funniest part of a
     person with a cheeseburger for a mouth. */
  const eyes = [];
  for (const sx of [-0.098, 0.098]) {
    const e = new THREE.Group();
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(0.047, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xf4f0e6 })
    );
    e.add(white);
    const iris = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 7, 5),
      new THREE.MeshLambertMaterial({ color: 0x4a3220 })
    );
    iris.position.z = 0.031;
    e.add(iris);
    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0x120c08 })
    );
    pupil.position.z = 0.045;
    e.add(pupil);
    e.position.set(sx, HEAD_Y + 0.030, 0.218);
    her.add(e);
    eyes.push(e);
  }
  // eyebrows, mostly hidden by the fringe
  {
    const BR = [];
    for (const sx of [-0.098, 0.098]) {
      BR.push(tint(box(0.094, 0.019, 0.026, HC, {
        pos: [sx, HEAD_Y + 0.082, 0.228], rot: [0, 0, sx > 0 ? -0.1 : 0.1],
      }), HAIR_D));
    }
    her.add(new THREE.Mesh(mergeGeos(BR), mats.opaque));
  }
  // eyelids, for blinking
  const lids = [];
  for (const sx of [-0.098, 0.098]) {
    const l = new THREE.Mesh(
      new THREE.SphereGeometry(0.050, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshLambertMaterial({ color: 0xe0b295 })
    );
    l.position.set(sx, HEAD_Y + 0.030, 0.218);
    l.scale.set(1, 0.05, 1);
    her.add(l);
    lids.push(l);
  }

  g.add(her);

  /* ---------- the stall ----------
     A crate on its end with a plank across it, a parasol out of sailcloth,
     and a hand-painted board. Everything she has is on the counter. */
  const S = [];
  const WOOD = G(0x8a6f48), WOOD_D = G(0x5f4a2e);
  // the counter, in front of her
  S.push(tint(box(2.6, 0.16, 0.90, 'planks', { pos: [0, 0.94, 0.86] }), WOOD));
  S.push(tint(box(2.6, 0.06, 0.10, 'planks', { pos: [0, 1.04, 1.28] }), WOOD_D));
  for (const sx of [-1.1, 1.1]) {
    S.push(tint(box(0.9, 0.88, 0.9, 'planks', { pos: [sx, 0.44, 0.86] }), WOOD_D));
    for (const dy of [-0.24, 0.24]) {
      S.push(tint(box(0.96, 0.10, 0.96, 'planks', { pos: [sx, 0.44 + dy, 0.86] }), WOOD));
    }
  }
  /* The parasol, on a pole at the far end of the counter.

     The first one was eight one-and-a-half metre slats laid almost flat at a
     radius of half a metre, which from any distance read as a red and white
     starfish hovering over the sand. A parasol is a CONE: short panels, a
     steep pitch, and a finial on top. */
  const POLE_X = 1.42, POLE_Z = 0.30;
  S.push(tint(cyl(0.055, 0.07, 2.55, 6, 'driftwood', { pos: [POLE_X, 1.27, POLE_Z] }), WOOD_D));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    /* Each panel is rolled down about its own Z first and yawed round the
       pole second, which is what the default Euler order does — the roll is
       the innermost rotation, so it happens in the panel's own space. */
    S.push(tint(box(1.05, 0.05, 0.40, 'sail', {
      pos: [POLE_X + Math.cos(a) * 0.50, 2.42, POLE_Z + Math.sin(a) * 0.50],
      rot: [0, -a, -0.42],
    }), i % 2 ? G(0xe4d8b4) : G(0xc85a4a)));
  }
  // the ribs showing under it, and the finial on top
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    S.push(tint(box(0.90, 0.035, 0.05, 'driftwood', {
      pos: [POLE_X + Math.cos(a) * 0.44, 2.34, POLE_Z + Math.sin(a) * 0.44],
      rot: [0, -a, -0.42],
    }), WOOD_D));
  }
  S.push(tint(cyl(0.03, 0.09, 0.20, 8, 'driftwood', { pos: [POLE_X, 2.70, POLE_Z] }), WOOD_D));

  /* Her board hangs off the FRONT of the counter, at knee height.

     It used to stand on two posts at 1.86 metres, which is four centimetres
     under the middle of her face: walk up to the stall and the sign was
     nailed across her head. */
  /* The board is 256 by 128, so the plank it is painted on wants to be about
     twice as wide as it is tall. At 2.10 by 0.66 the lettering came out
     stretched half again across. */
  S.push(tint(box(2.00, 0.88, 0.08, 'planks', { pos: [0, 0.55, 1.31], rot: [0, 0, -0.02] }), WOOD_D));
  g.add(new THREE.Mesh(mergeGeos(S), mats.opaque));

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.90, 0.80),
    new THREE.MeshLambertMaterial({
      map: buildSignTexture(['CATHY', 'HOT FOOD  ALL HOURS'], '#3a2412', '#ffd88a'),
    })
  );
  board.position.set(0, 0.55, 1.36);
  board.rotation.z = -0.02;
  g.add(board);

  /* what is actually on the counter, so the stall reads as stocked */
  {
    const F = [];
    // a stack of popcorn boxes
    for (let i = 0; i < 3; i++) {
      F.push(tint(box(0.26, 0.30, 0.20, 'planks', {
        pos: [-0.82 + i * 0.05, 1.17 + i * 0.02, 0.72 + i * 0.04], rot: [0, i * 0.3, 0],
      }), i % 2 ? G(0xe8e2d4) : G(0xc8342a)));
    }
    // a tray of eggs
    F.push(tint(box(0.44, 0.07, 0.30, 'planks', { pos: [-0.1, 1.05, 0.80] }), G(0x8a7a58)));
    for (let i = 0; i < 6; i++) {
      F.push(tint(sphere(0.055, 6, 5, 'skin', {
        pos: [-0.24 + (i % 3) * 0.14, 1.12, 0.72 + Math.floor(i / 3) * 0.14],
      }), G(0xefe6cc)));
    }
    // a bottle of her own sauce, and a jar of floss
    F.push(tint(cyl(0.075, 0.075, 0.30, 8, 'glass', { pos: [0.52, 1.17, 0.76] }), G(0xa8241a)));
    F.push(tint(cyl(0.04, 0.04, 0.07, 6, 'metal', { pos: [0.52, 1.35, 0.76] }), G(0x8a9096)));
    F.push(tint(cyl(0.13, 0.13, 0.26, 9, 'glass', { pos: [0.86, 1.15, 0.78] }), G(0xe07aa8)));
    // and a burger under a cloche, which is the one thing she is proud of
    F.push(tint(cyl(0.20, 0.20, 0.05, 10, 'planks', { pos: [1.16, 1.05, 0.80] }), G(0xc8b48a)));
    F.push(tint(box(0.24, 0.10, 0.24, 'planks', { pos: [1.16, 1.12, 0.80] }), G(0xd8a24a)));
    g.add(new THREE.Mesh(mergeGeos(F), mats.opaque));
  }

  /* a lamp so you can find the stall after dark. Built once, always present:
     adding a light to a live scene recompiles every shader in it. */
  const lamp = new THREE.PointLight(0xffd8a0, 2.1, 12, 1.5);
  lamp.position.set(0, 2.12, 0.72);
  g.add(lamp);
  const flame = flameFactory ? flameFactory(mats, 2, 0.22) : null;
  if (flame) { flame.position.set(-1.5, 1.9, 0.9); g.add(flame); }
  const post = new THREE.Mesh(
    mergeGeos([tint(cyl(0.05, 0.06, 1.8, 5, 'driftwood', { pos: [0, 0.9, 0] }), WOOD_D)]),
    mats.opaque
  );
  post.position.set(-1.5, 0, 0.9);
  g.add(post);

  /* ---------- how she behaves ---------- */
  let look = new THREE.Vector3();
  g.userData.tick = (t, dt = 0.016, camPos = null) => {
    if (flame) flame.userData.tick?.(t, dt);
    lamp.intensity = 2.0 + Math.sin(t * 6.2) * 0.25;

    // she shifts her weight, slowly, the way you do standing all day
    her.position.y = Math.sin(t * 0.7) * 0.018;
    her.rotation.z = Math.sin(t * 0.45) * 0.022;
    her.rotation.y = Math.sin(t * 0.28) * 0.10;

    // the lettuce and the cheese settle
    burger.rotation.z = Math.sin(t * 1.7) * 0.03;
    burger.position.y = g.userData.headY - 0.135 + Math.sin(t * 2.3) * 0.005;

    /* Her eyes follow you. She never says anything about the burger and
       neither should you. */
    if (camPos) {
      look.set(camPos.x, camPos.y, camPos.z);
      g.worldToLocal(look);
      const yaw = Math.atan2(look.x, look.z);
      const pitch = Math.atan2(look.y - g.userData.headY, Math.hypot(look.x, look.z));
      for (const e of eyes) {
        e.rotation.y = THREE.MathUtils.clamp(yaw - her.rotation.y, -0.5, 0.5);
        e.rotation.x = THREE.MathUtils.clamp(-pitch, -0.3, 0.3);
      }
    }
    // and she blinks
    const blink = Math.sin(t * 0.83) > 0.955 || Math.sin(t * 1.7 + 2) > 0.988;
    for (const l of lids) l.scale.y = blink ? 1.0 : 0.05;
  };
  return g;
}
