/* ===========================================================
   treasure.js — the X, and what is under it.

   Somewhere on the island, in one of twenty places, two lengths of
   driftwood are laid across each other in the sand. Nobody put a
   sign on it. Stand on it and you can dig.

   Digging is held, not tapped: the sand comes up in a ring round
   your feet, the hole deepens, and about two thirds of the way down
   the corner of a chest breaks the surface and starts to rise. When
   it is all the way out you can open it.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, sphere, tint } from '../lib/geo.js';

const G = (n) => new THREE.Color(n);

/* Twenty places, all of them out on the low ground near the water.

   You dig treasure out of SAND. The first set of spots was scattered right
   across the island and one of them came out fourteen metres up a hillside,
   where a chest rising out of the turf reads as a bug. These are all on the
   ring where the beaches are, well away from the camp, from Ferdi's
   clearing and from the temple door.

   buildIsland picks whichever of these is actually low and flat, so a spot
   that has ended up under a rock this time round is simply not used. */
export const X_SPOTS = [
  { x: 118, z: 40 }, { x: 96, z: 92 }, { x: 44, z: 128 }, { x: -26, z: 134 },
  { x: -88, z: 108 }, { x: -128, z: 66 }, { x: -142, z: 10 }, { x: -132, z: -52 },
  { x: -96, z: -104 }, { x: -40, z: -132 }, { x: 22, z: -136 }, { x: 82, z: -110 },
  { x: 124, z: -62 }, { x: 136, z: -8 }, { x: 70, z: 60 }, { x: -60, z: 70 },
  { x: -74, z: -74 }, { x: 60, z: -74 }, { x: 106, z: 6 }, { x: -104, z: 42 },
];

/** Is this a place a chest could plausibly be buried? Low, flat, and dry. */
export function goodXSpot(heightAt, x, z) {
  const h = heightAt(x, z);
  if (h < 0.8 || h > 5.5) return false;       // in the sea, or up a hill
  let lo = h, hi = h;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const hh = heightAt(x + Math.cos(a) * 3.0, z + Math.sin(a) * 3.0);
    if (hh < lo) lo = hh;
    if (hh > hi) hi = hh;
  }
  return hi - lo < 2.2 && lo > 0.4;
}

/** How long it takes to dig one out, in seconds of holding E. */
export const DIG_SECONDS = 4.2;

/* ===========================================================
   THE MARK
   =========================================================== */
export function buildX(rng, mats) {
  const g = new THREE.Group();
  const WOOD = G(0x6a5230), WOOD_D = G(0x453320);
  const P = [];

  /* Two lengths of driftwood, crossed, half buried and bleached. They are
     not neat: one is longer, they do not cross in the middle, and both are
     a few degrees off square, because somebody laid them there in a hurry. */
  P.push(tint(box(3.1, 0.16, 0.34, 'driftwood', {
    pos: [0, 0.07, 0], rot: [0, 0.72, 0.02],
  }), WOOD));
  P.push(tint(box(2.7, 0.16, 0.30, 'driftwood', {
    pos: [0.15, 0.10, -0.1], rot: [0, -0.78, -0.03],
  }), WOOD_D));
  // grain along the top of each, so they read as timber at a glance
  for (const [len, yaw, off] of [[3.1, 0.72, 0], [2.7, -0.78, -0.1]]) {
    for (let i = 0; i < 6; i++) {
      const u = -len / 2 + 0.3 + i * (len - 0.6) / 5;
      P.push(tint(box(0.22, 0.03, 0.05, 'driftwood', {
        pos: [Math.cos(yaw) * u, 0.17, off - Math.sin(yaw) * u], rot: [0, yaw, 0],
      }), G(0x8a6f48)));
    }
  }
  /* Sand banked against them on the windward side, and a scatter of shells
     — the detail that says this has been here a while. */
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, r = 1.1 + rng() * 1.5;
    P.push(tint(sphere(0.06 + rng() * 0.07, 5, 4, 'sand', {
      pos: [Math.cos(a) * r, 0.03, Math.sin(a) * r],
    }), G(0xcfbe94)));
  }
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2, r = 1.4 + rng() * 1.2;
    P.push(tint(box(0.14, 0.05, 0.11, 'shell', {
      pos: [Math.cos(a) * r, 0.03, Math.sin(a) * r], rot: [0, rng() * 3, 0],
    }), G(0xe4dcc8)));
  }
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* The hole: a ring of spoil that grows as you dig, and a dark shaft under
     it. Both are here from the start, at nothing, so no geometry and no
     material ever arrives in the middle of a round. */
  const spoil = new THREE.Mesh(
    mergeGeos((() => {
      const S = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = 1.35 + ((i * 7) % 5) * 0.06;
        S.push(tint(sphere(0.26 + ((i * 3) % 4) * 0.04, 6, 5, 'sand', {
          pos: [Math.cos(a) * r, 0.04, Math.sin(a) * r],
        }), G(0xd8c79c)));
      }
      return S;
    })()),
    mats.opaque
  );
  spoil.scale.set(0.01, 0.01, 0.01);
  spoil.visible = false;
  g.add(spoil);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 0.85, 2.2, 14, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x6a5636, side: THREE.BackSide })
  );
  shaft.position.y = -1.1;
  shaft.visible = false;
  g.add(shaft);
  const shaftFloor = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 14),
    new THREE.MeshLambertMaterial({ color: 0x3a2c18 })
  );
  shaftFloor.rotation.x = -Math.PI / 2;
  shaftFloor.position.y = -2.2;
  shaftFloor.visible = false;
  g.add(shaftFloor);

  /* ---- the chest ---- */
  const chest = new THREE.Group();
  const C = [];
  const OAK = G(0x6a4526), OAK_D = G(0x4a2f18), IRON = G(0x5a5a62), BRASS = G(0xc8a040);
  // the body, banded
  C.push(tint(box(1.30, 0.68, 0.86, 'planks', { pos: [0, 0.34, 0] }), OAK));
  C.push(tint(box(1.34, 0.10, 0.90, 'planks', { pos: [0, 0.05, 0] }), OAK_D));
  for (const bx of [-0.42, 0.42]) {
    C.push(tint(box(0.11, 0.72, 0.92, 'metal', { pos: [bx, 0.34, 0] }), IRON));
  }
  // feet, and a handle at each end
  for (const fx of [-0.55, 0.55]) {
    for (const fz of [-0.34, 0.34]) {
      C.push(tint(box(0.16, 0.10, 0.16, 'metal', { pos: [fx, 0.05, fz] }), IRON));
    }
    C.push(tint(cyl(0.05, 0.05, 0.34, 6, 'metal', {
      pos: [fx * 1.24, 0.40, 0], rot: [Math.PI / 2, 0, 0],
    }), BRASS));
  }
  // a plate and a keyhole on the front
  C.push(tint(box(0.24, 0.26, 0.05, 'metal', { pos: [0, 0.52, 0.45] }), BRASS));
  C.push(tint(box(0.06, 0.10, 0.03, 'metal', { pos: [0, 0.50, 0.48] }), G(0x1a1410)));
  chest.add(new THREE.Mesh(mergeGeos(C), mats.opaque));

  // the lid, on its own hinge line at the back, so it can swing
  const lid = new THREE.Group();
  lid.position.set(0, 0.68, -0.43);
  {
    const L = [];
    L.push(tint(box(1.30, 0.16, 0.86, 'planks', { pos: [0, 0.08, 0.43] }), OAK));
    // a domed top, faked with three courses
    L.push(tint(box(1.24, 0.13, 0.66, 'planks', { pos: [0, 0.19, 0.43] }), OAK));
    L.push(tint(box(1.14, 0.11, 0.42, 'planks', { pos: [0, 0.28, 0.43] }), OAK));
    for (const bx of [-0.42, 0.42]) {
      L.push(tint(box(0.11, 0.34, 0.90, 'metal', { pos: [bx, 0.14, 0.43] }), IRON));
    }
    L.push(tint(box(0.26, 0.10, 0.10, 'metal', { pos: [0, 0.10, 0.86] }), BRASS));
    lid.add(new THREE.Mesh(mergeGeos(L), mats.opaque));
  }
  chest.add(lid);

  /* What is inside, which you never see until the lid is up: a bed of coins
     and three or four things that are not coins. */
  const hoard = new THREE.Group();
  hoard.position.y = 0.30;
  {
    const Hh = [];
    for (let i = 0; i < 34; i++) {
      const a = rng() * Math.PI * 2, r = rng() * 0.52;
      Hh.push(tint(cyl(0.075, 0.075, 0.022, 8, 'gold', {
        pos: [Math.cos(a) * r, 0.02 + rng() * 0.10, Math.sin(a) * r * 0.62],
        rot: [Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * 3, 0],
      }), G(0xe8c65c)));
    }
    // a cup on its side, a string of beads, and something in a wrapper
    Hh.push(tint(cyl(0.10, 0.07, 0.20, 8, 'gold', {
      pos: [-0.34, 0.14, 0.06], rot: [0, 0, Math.PI / 2 + 0.3],
    }), G(0xd8b84c)));
    for (let i = 0; i < 9; i++) {
      Hh.push(tint(sphere(0.035, 5, 4, 'shell', {
        pos: [0.18 + i * 0.045, 0.13 + Math.sin(i) * 0.02, -0.16],
      }), G(0xc8d8e0)));
    }
    Hh.push(tint(box(0.20, 0.09, 0.14, 'cloth', { pos: [0.34, 0.12, 0.14], rot: [0, 0.4, 0] }), G(0x8a2a24)));
    hoard.add(new THREE.Mesh(mergeGeos(Hh), mats.opaque));
  }
  chest.add(hoard);

  // the light that comes out of it, present from the start at nothing
  const glow = new THREE.PointLight(0xffd88a, 0, 9, 1.6);
  glow.position.set(0, 0.9, 0);
  chest.add(glow);

  chest.position.y = -2.4;              // buried, until it is not
  chest.visible = false;
  g.add(chest);

  /* ---- state ---- */
  const st = {
    dug: 0,            // 0..1, how far down you have got
    open: 0,           // 0..1, how far the lid has swung
    taken: false,
  };
  g.userData.state = st;
  g.userData.chest = chest;

  g.userData.tick = (t, dt = 0.016) => {
    const d = st.dug;
    /* How far the chest has come up. It starts at 0.62 of the dig, so the
       first two thirds are sand and the last third is the thing itself. */
    const rise = Math.max(0, Math.min(1, (d - 0.62) / 0.38));
    const e = rise * rise * (3 - 2 * rise);

    spoil.visible = d > 0.02;
    if (spoil.visible) {
      const k = Math.min(1, d * 1.3);
      spoil.scale.set(k, 0.4 + k * 0.6, k);
    }

    /* The hole. It deepens while you are digging DOWN to the chest, and
       then fills back in behind it as the chest comes up — otherwise you
       end up with a chest sitting proudly on the sand above a two-metre
       shaft you can see straight down, which is what it looked like. */
    const depth = (0.4 + Math.min(d, 0.62) * 2.1) * (1 - e * 0.72);
    shaft.visible = shaftFloor.visible = depth > 0.14;
    if (shaft.visible) {
      shaft.scale.y = depth / 2.2;
      shaft.position.y = -depth / 2;
      shaftFloor.position.y = -depth + 0.02;
    }

    /* And the chest itself. It used to become visible at rise > 0.001 while
       still at -2.4, which is a metre below the bottom of its own hole —
       so for one frame there was a chest inside the terrain. It starts at
       the floor of the hole and comes up from there. */
    chest.visible = rise > 0.004;
    if (chest.visible) {
      const floor = -Math.max(0.4, depth) + 0.05;
      chest.position.y = floor + e * (0.02 - floor);
      // it shrugs itself free rather than sliding up on rails
      chest.rotation.z = Math.sin(t * 7) * 0.03 * (1 - e);
      chest.rotation.y = Math.sin(t * 1.1) * 0.05 * (1 - e) + 0.12;
      glow.intensity = st.open > 0 ? 2.6 * st.open + Math.sin(t * 5) * 0.3 : 0;
    } else {
      glow.intensity = 0;
    }

    // the lid, once it is open
    lid.rotation.x = -st.open * 2.0;
    hoard.visible = st.open > 0.15;
    if (hoard.visible) hoard.position.y = 0.30 + Math.sin(t * 2.2) * 0.008;
  };

  /* Once it is out it is a solid object, so you cannot stand inside it.
     The game asks for this and adds it to its own collider list. */
  g.userData.colliderAt = (wx, wz) => ({ x: wx, z: wz, r: 0.95 });

  return g;
}
