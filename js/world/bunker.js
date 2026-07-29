/* ===========================================================
   bunker.js — the listening post under the island.

   A steel trapdoor set into the ground in one of four places,
   different every round, with a ladder down to a single concrete
   room. Whoever finds it gets the command table: a live count of
   who is still breathing, a holographic plot of the island with
   everybody on it, and the log of what the island has done to you
   so far.

   It is deliberately powerful and deliberately hard to keep — you
   have to walk there, you have to go down, and while you are down
   there you are not doing your work and nobody can see you.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, tint, blankUV } from '../lib/geo.js';

const G = (n) => new THREE.Color(n);

/** The four places it might be. Chosen per round by the host. */
export const BUNKER_SPOTS = [
  { x: -96, z: -78, name: 'THE WEST SHOULDER' },
  { x: 104, z: -58, name: 'THE EAST RIDGE' },
  { x: 38, z: 92, name: 'THE SOUTH FLAT' },
  { x: -58, z: 108, name: 'THE PALM LINE' },
];

/* ---------- the hatch, above ground ---------- */
export function buildHatch(rng, mats) {
  const g = new THREE.Group();
  const P = [];
  const STEEL = G(0x6a7076), STEEL_D = G(0x454b50), RUST = G(0x7a4a2a);

  // a concrete collar set into the earth
  P.push(tint(cyl(1.9, 2.1, 0.5, 12, 'templeStone', { pos: [0, 0.1, 0] }), G(0x8d8770)));
  P.push(tint(cyl(1.55, 1.55, 0.3, 12, 'metal', { pos: [0, 0.32, 0] }), STEEL_D));

  // bolts round the rim
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    P.push(tint(cyl(0.09, 0.09, 0.12, 5, 'metal', {
      pos: [Math.cos(a) * 1.7, 0.38, Math.sin(a) * 1.7],
    }), RUST));
  }
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* the lid, on a hinge */
  const hinge = new THREE.Group();
  hinge.position.set(-1.45, 0.42, 0);
  const lidParts = [
    tint(cyl(1.45, 1.45, 0.16, 12, 'metal', { pos: [1.45, 0, 0] }), STEEL),
    tint(box(2.4, 0.08, 0.22, 'metal', { pos: [1.45, 0.12, 0] }), STEEL_D),
    tint(box(0.22, 0.08, 2.4, 'metal', { pos: [1.45, 0.12, 0] }), STEEL_D),
    // a wheel to turn it
    tint(cyl(0.5, 0.5, 0.1, 10, 'metal', { pos: [1.45, 0.22, 0] }), RUST),
    tint(cyl(0.12, 0.12, 0.18, 6, 'metal', { pos: [1.45, 0.3, 0] }), STEEL_D),
  ];
  hinge.add(new THREE.Mesh(mergeGeos(lidParts), mats.opaque));
  g.add(hinge);
  g.userData.hinge = hinge;

  // the dark of the shaft, only visible once it is open
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide, fog: false })
  );
  shaft.position.y = -1.4;
  g.add(shaft);

  // a lamp that only comes on when it is open
  const lamp = new THREE.PointLight(0x8fe6d0, 0, 8, 2);
  lamp.position.set(0, 0.6, 0);
  g.add(lamp);

  let open = 0;
  g.userData.setOpen = (on) => { g.userData.want = on ? 1 : 0; };
  g.userData.want = 0;
  g.userData.tick = (t, dt = 0.016) => {
    const want = g.userData.want;
    open += (want - open) * Math.min(1, dt * 4);
    hinge.rotation.z = -open * 2.1;
    lamp.intensity = open * 2.6;
  };
  return g;
}

/* ===========================================================
   THE ROOM
   Its own scene, like the temple — you go down, not through.
   =========================================================== */
export function buildBunkerRoom(mats) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);
  scene.fog = new THREE.Fog(0x05070a, 6, 34);

  const P = [];
  const CONC = G(0x5a5f62), CONC_D = G(0x3e4245), STEEL = G(0x6a7076);
  const W = 18, D = 14, H = 4.4;

  // floor, ceiling, walls
  P.push(tint(box(W, 0.6, D, 'templeStone', { pos: [0, -0.3, 0] }), CONC_D));
  P.push(tint(box(W, 0.6, D, 'templeStone', { pos: [0, H, 0] }), CONC_D));
  for (const [w, h, d, x, y, z] of [
    [0.6, H, D, -W / 2, H / 2, 0], [0.6, H, D, W / 2, H / 2, 0],
    [W, H, 0.6, 0, H / 2, -D / 2], [W, H, 0.6, 0, H / 2, D / 2],
  ]) P.push(tint(box(w, h, d, 'templeStone', { pos: [x, y, z] }), CONC));

  // ribs along the ceiling
  for (let i = -2; i <= 2; i++) {
    P.push(tint(box(W - 1, 0.3, 0.4, 'metal', { pos: [0, H - 0.4, i * 2.6] }), STEEL));
  }
  // a bank of dead lockers down one wall
  for (let i = 0; i < 5; i++) {
    P.push(tint(box(0.7, 2.2, 1.1, 'metal', { pos: [-W / 2 + 0.9, 1.1, -4 + i * 2.1] }), G(0x4a5054)));
    P.push(tint(box(0.06, 0.14, 0.9, 'metal', { pos: [-W / 2 + 1.28, 1.4, -4 + i * 2.1] }), G(0x8a9096)));
  }
  // crates and a fallen chair
  for (let i = 0; i < 6; i++) {
    const cx = 4 + (i % 3) * 1.3, cz = -5 + Math.floor(i / 3) * 1.4;
    P.push(tint(box(1.1, 1.0, 1.1, 'planks', { pos: [cx, 0.5, cz] }), G(0x6a5230)));
  }

  // the ladder down from the hatch
  for (let i = 0; i < 8; i++) {
    P.push(tint(box(0.9, 0.09, 0.09, 'metal', { pos: [0, 0.5 + i * 0.55, -D / 2 + 1.0] }), STEEL));
  }
  for (const sx of [-0.45, 0.45]) {
    P.push(tint(cyl(0.06, 0.06, 5, 6, 'metal', { pos: [sx, 2.4, -D / 2 + 1.0] }), STEEL));
  }
  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* the command table: a low steel plinth with a glass top */
  const table = new THREE.Group();
  const tParts = [
    tint(box(4.6, 0.9, 3.0, 'metal', { pos: [0, 0.45, 0] }), G(0x3a4045)),
    tint(box(4.9, 0.14, 3.3, 'metal', { pos: [0, 0.95, 0] }), G(0x565c62)),
    tint(box(4.3, 0.06, 2.7, 'glass', { pos: [0, 1.04, 0] }), G(0x2a4a52)),
  ];
  // a rail of dead switches along the near edge
  for (let i = 0; i < 9; i++) {
    tParts.push(tint(box(0.16, 0.1, 0.16, 'metal', { pos: [-1.8 + i * 0.45, 1.06, 1.2] }),
      G(i % 3 === 0 ? 0xc02a1a : 0x8a9096)));
  }
  table.add(new THREE.Mesh(mergeGeos(tParts), mats.opaque));
  table.position.set(0, 0, 1.5);
  scene.add(table);

  /* the hologram over it: a wireframe island that turns */
  const holo = new THREE.Group();
  holo.position.set(0, 1.9, 1.5);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x6fd0e0, transparent: true, opacity: 0.5, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 4; i++) {
    const r = 0.5 + i * 0.42;
    const rg = new THREE.RingGeometry(r, r + 0.03, 30, 1);
    rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, ringMat);
    ring.position.y = i * 0.06;
    holo.add(ring);
  }
  // a cone of light rising off the glass
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 1.5, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x6fd0e0, transparent: true, opacity: 0.07, fog: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
  );
  cone.position.y = -0.6;
  holo.add(cone);
  scene.add(holo);

  // the pips that stand for people, made on demand
  const pipGeo = new THREE.BoxGeometry(0.11, 0.34, 0.11);
  const pips = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(pipGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    m.visible = false;
    holo.add(m);
    pips.push(m);
  }

  /* lighting: one working strip and the glow off the table */
  const strip = new THREE.PointLight(0xbfd8e0, 1.5, 22, 1.6);
  strip.position.set(0, H - 0.9, -2);
  scene.add(strip);
  const tableGlow = new THREE.PointLight(0x6fd0e0, 2.2, 12, 1.8);
  tableGlow.position.set(0, 1.6, 1.5);
  scene.add(tableGlow);
  scene.add(new THREE.AmbientLight(0x6a7a86, 0.55));

  scene.userData.table = table;
  scene.userData.holo = holo;
  scene.userData.pips = pips;
  scene.userData.tick = (t, dt = 0.016, roster = null) => {
    holo.rotation.y = t * 0.32;
    const flick = 0.85 + Math.sin(t * 9) * 0.1 + (Math.sin(t * 41) > 0.95 ? -0.35 : 0);
    ringMat.opacity = 0.42 * flick;
    tableGlow.intensity = 2.2 * flick;
    strip.intensity = 1.5 * (Math.sin(t * 31) > 0.97 ? 0.3 : 1);

    // living players plotted on the island, dead ones lying flat
    if (roster) {
      roster.forEach((p, i) => {
        const m = pips[i];
        if (!m) return;
        m.visible = true;
        m.material.color.setHex(p.colour);
        const k = 1 / 190;                    // island radius -> table radius
        m.position.set(p.x * k * 1.7, p.alive ? 0.22 : 0.03, p.z * k * 1.7);
        m.scale.set(1, p.alive ? 1 : 0.25, 1);
        m.material.opacity = p.alive ? 0.95 : 0.4;
      });
      for (let i = roster.length; i < pips.length; i++) pips[i].visible = false;
    }
  };
  return scene;
}

/** Where you stand when you climb down. */
export const BUNKER_ENTRY = { x: 0, y: 1.0, z: -5.2 };
export const BUNKER_TABLE = { x: 0, z: 1.5 };
export const BUNKER_BOX = { minX: -8.4, maxX: 8.4, minZ: -6.4, maxZ: 6.4 };
export function bunkerHeight() { return 0; }
