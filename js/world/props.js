/* ===========================================================
   props.js — everything you can bump into on Isla Dorada.
   Each prop type is merged into one geometry and drawn with an
   InstancedMesh, so ~600 pieces of scenery cost ~12 draw calls.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import { mergeGeos, box, cyl, cone, ico, plane, place, tint, jitterVerts, bendY, taper } from '../lib/geo.js';
import { heightAt, slopeAt, biomeAt, ISLAND } from './terrain.js';

/* ---------- shared materials ---------- */
export function buildPropMaterials(atlas) {
  const opaque = ps1ify(new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true,
  }), { flat: true });

  const cutout = ps1ify(new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true,
    transparent: false, alphaTest: 0.5, side: THREE.DoubleSide,
  }), { flat: true, wind: 0.09 });

  const cutoutStill = ps1ify(new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true,
    transparent: false, alphaTest: 0.5, side: THREE.DoubleSide,
  }), { flat: true });

  const emissive = ps1ify(new THREE.MeshBasicMaterial({
    map: atlas, vertexColors: true,
    transparent: false, alphaTest: 0.4, side: THREE.DoubleSide,
  }), { flat: true });

  return { opaque, cutout, cutoutStill, emissive };
}

/* ===========================================================
   PROP GEOMETRY BUILDERS
   Each returns { opaque, cutout, r } where r is a collision radius
   (0 = walk through it).
   =========================================================== */

const G = (n) => new THREE.Color(n);

/* ---------- palm tree ---------- */
function buildPalm(rng, variant) {
  const H = 8.5 + rng() * 7 + variant * 0.8;
  const lean = (rng() - 0.5) * 3.6;
  const leanZ = (rng() - 0.5) * 3.0;

  const trunk = cyl(0.30, 0.62, H, 7, 'bark', { pos: [0, H / 2, 0] });
  bendY(trunk, lean, 'x', 2.1);
  bendY(trunk, leanZ, 'z', 2.1);
  tint(trunk, G(0xb59a72).multiplyScalar(0.86 + rng() * 0.28));

  // root flare
  const root = cyl(0.62, 1.05, 1.1, 7, 'bark', { pos: [0, 0.45, 0] });
  tint(root, G(0x9c8360));

  const crownX = lean, crownZ = leanZ;
  const opaqueParts = [trunk, root];
  const cutoutParts = [];

  // fronds
  const n = 7 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.4;
    const len = 4.6 + rng() * 2.4;
    const wid = 1.5 + rng() * 0.6;
    const droop = 0.55 + rng() * 0.55;

    const f = plane(wid, len, 'palmFrond');
    // base at the origin, blade running up +Y
    f.translate(0, len / 2, 0);
    // droop the far half downward
    const p = f.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = p.getY(v) / len;
      p.setY(v, p.getY(v) - Math.pow(t, 2) * len * droop * 0.75);
      p.setZ(v, p.getZ(v) + Math.sin(t * Math.PI) * 0.25);
    }
    p.needsUpdate = true;
    f.computeVertexNormals();

    place(f, { rot: [0.55 + rng() * 0.3, a, 0], pos: [crownX, H, crownZ] });
    tint(f, G(0xffffff).multiplyScalar(0.72 + rng() * 0.5));
    cutoutParts.push(f);
  }

  // crown knot
  const knot = ico(0.7, 0, 'bark', { pos: [crownX, H - 0.15, crownZ] });
  tint(knot, G(0x8d7550));
  opaqueParts.push(knot);

  // coconuts
  const cn = (rng() * 4) | 0;
  for (let i = 0; i < cn; i++) {
    const a = rng() * Math.PI * 2;
    const c = ico(0.36, 0, 'coconut', {
      pos: [crownX + Math.cos(a) * 0.62, H - 0.5 - rng() * 0.5, crownZ + Math.sin(a) * 0.62],
    });
    tint(c, G(0x9c7c50));
    opaqueParts.push(c);
  }

  return { opaque: mergeGeos(opaqueParts), cutout: mergeGeos(cutoutParts), r: 0.75 };
}

/* ---------- broadleaf jungle tree ---------- */
function buildJungleTree(rng) {
  const H = 7 + rng() * 6;
  const trunk = cyl(0.42, 0.85, H, 6, 'barkDark', { pos: [0, H / 2, 0] });
  bendY(trunk, (rng() - 0.5) * 1.6, 'x', 2);
  tint(trunk, G(0x7d6a4c).multiplyScalar(0.85 + rng() * 0.3));

  const opaqueParts = [trunk];
  // buttress roots
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    const r = box(0.34, 1.6, 1.0, 'barkDark', {
      pos: [Math.cos(a) * 0.62, 0.7, Math.sin(a) * 0.62], rot: [0, -a, 0.24],
    });
    tint(r, G(0x6f5c42));
    opaqueParts.push(r);
  }

  const cutoutParts = [];
  const canopy = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < canopy; i++) {
    const a = rng() * Math.PI * 2;
    const rad = rng() * 1.9;
    const blob = ico(1.9 + rng() * 1.5, 0, 'leafBush', {
      pos: [Math.cos(a) * rad, H - 0.4 + rng() * 1.7, Math.sin(a) * rad],
      scale: [1.35, 0.78, 1.35],
    });
    tint(blob, G(0xffffff).multiplyScalar(0.62 + rng() * 0.5));
    cutoutParts.push(blob);
  }
  // a few big hanging leaves
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const l = plane(1.7, 2.8, 'jungleLeaf');
    l.translate(0, 1.4, 0);
    place(l, { rot: [1.0 + rng() * 0.5, a, 0], pos: [Math.cos(a) * 1.5, H - 0.9, Math.sin(a) * 1.5] });
    tint(l, G(0xffffff).multiplyScalar(0.7 + rng() * 0.4));
    cutoutParts.push(l);
  }

  return { opaque: mergeGeos(opaqueParts), cutout: mergeGeos(cutoutParts), r: 0.95 };
}

/* ---------- bush ---------- */
function buildBush(rng) {
  const parts = [];
  const n = 3 + ((rng() * 3) | 0);
  const s = 0.85 + rng() * 0.9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + rng() * 0.5;
    const q = plane(2.2 * s, 1.9 * s, 'leafBush');
    q.translate(0, 0.95 * s, 0);
    place(q, { rot: [0, a, 0], pos: [(rng() - .5) * 0.5, 0, (rng() - .5) * 0.5] });
    tint(q, G(0xffffff).multiplyScalar(0.62 + rng() * 0.55));
    parts.push(q);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/* ---------- fern ---------- */
function buildFern(rng) {
  const parts = [];
  const n = 5 + ((rng() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.5;
    const len = 1.5 + rng() * 1.1;
    const f = plane(0.95, len, 'fernLeaf');
    f.translate(0, len / 2, 0);
    const p = f.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = p.getY(v) / len;
      p.setY(v, p.getY(v) - Math.pow(t, 2) * len * 0.55);
    }
    p.needsUpdate = true;
    place(f, { rot: [0.75 + rng() * 0.35, a, 0] });
    tint(f, G(0xffffff).multiplyScalar(0.66 + rng() * 0.5));
    parts.push(f);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/* ---------- grass tuft ---------- */
function buildTuft(rng) {
  const parts = [];
  const s = 0.8 + rng() * 0.7;
  for (let i = 0; i < 2; i++) {
    const q = plane(1.5 * s, 1.0 * s, 'tuft');
    q.translate(0, 0.5 * s, 0);
    place(q, { rot: [0, (i / 2) * Math.PI + rng(), 0] });
    tint(q, G(0xffffff).multiplyScalar(0.7 + rng() * 0.45));
    parts.push(q);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/* ---------- flower patch ---------- */
function buildFlowers(rng) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const q = plane(0.85, 0.85, 'flower');
    place(q, { rot: [0, rng() * Math.PI, 0], pos: [(rng() - .5) * 1.2, 0.42 + rng() * 0.3, (rng() - .5) * 1.2] });
    parts.push(q);
    const stem = plane(0.1, 0.5, 'vine');
    place(stem, { rot: [0, rng() * Math.PI, 0], pos: [0, 0.2, 0] });
    parts.push(stem);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/* ---------- rock ---------- */
function buildRock(rng, big) {
  const s = big ? 1.8 + rng() * 2.6 : 0.5 + rng() * 1.1;
  const g = ico(s, 0, 'rock');
  jitterVerts(g, s * 0.42, rng);
  g.scale(1, 0.72 + rng() * 0.5, 1);
  g.translate(0, s * 0.34, 0);
  tint(g, G(0xffffff).multiplyScalar(0.72 + rng() * 0.45));
  return { opaque: mergeGeos([g]), cutout: null, r: big ? s * 0.8 : 0 };
}

/* ---------- driftwood ---------- */
function buildDriftwood(rng) {
  const parts = [];
  const n = 1 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const len = 1.6 + rng() * 3;
    const g = cyl(0.16 + rng() * 0.1, 0.2 + rng() * 0.12, len, 5, 'driftwood', {
      rot: [Math.PI / 2 + (rng() - .5) * 0.5, rng() * 3, (rng() - .5) * 0.4],
      pos: [(rng() - .5) * 1.4, 0.2, (rng() - .5) * 1.4],
    });
    tint(g, G(0xd8cbb0).multiplyScalar(0.8 + rng() * 0.3));
    parts.push(g);
  }
  return { opaque: mergeGeos(parts), cutout: null, r: 0 };
}

/* ---------- shell / small beach dressing ---------- */
function buildShell(rng) {
  const g = ico(0.24 + rng() * 0.14, 0, 'shell');
  g.scale(1.4, 0.5, 1);
  g.translate(0, 0.1, 0);
  tint(g, G(0xffffff).multiplyScalar(0.85 + rng() * 0.3));
  return { opaque: mergeGeos([g]), cutout: null, r: 0 };
}

/* ===========================================================
   INSTANCED SCATTER
   =========================================================== */
class Batcher {
  constructor(mats) {
    this.mats = mats;
    this.variants = new Map();
  }
  addVariant(key, built, materialKey = 'opaque', cutoutKey = 'cutout') {
    this.variants.set(key, { built, mats: [materialKey, cutoutKey], list: [] });
  }
  add(key, m) { this.variants.get(key).list.push(m.clone()); }
  build(scene) {
    const meshes = [];
    for (const [key, v] of this.variants) {
      if (!v.list.length) continue;
      const mk = (geo, mat) => {
        const im = new THREE.InstancedMesh(geo, mat, v.list.length);
        v.list.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = false;
        im.name = key;
        scene.add(im);
        meshes.push(im);
      };
      if (v.built.opaque) mk(v.built.opaque, this.mats[v.mats[0]]);
      if (v.built.cutout) mk(v.built.cutout, this.mats[v.mats[1]]);
    }
    return meshes;
  }
}

/* Named landmarks, all verified against the height function: the wreck
   sits on real sand, the overlook on the mount's shoulder, the shrine on
   the lip of the lagoon. */
export const LANDMARKS = {
  wreck: { x: -27, z: 100, minH: 0.8, maxH: 2.6, maxSlope: 0.16, radius: 9 },
  grove: { x: -70, z: 19, minH: 6, maxH: 20, maxSlope: 0.18, radius: 8 },
  overlook: { x: -22, z: -44, minH: 24, maxH: 46, maxSlope: 0.28, radius: 9 },
  lagoon: { x: 58, z: 30, minH: 2.6, maxH: 12, maxSlope: 0.18, radius: 9 },
  hollow: { x: 70, z: -34, minH: 10, maxH: 28, maxSlope: 0.30, radius: 9 },
  caveDoor: { x: 8, z: -32, minH: 24, maxH: 42, maxSlope: 0.34, radius: 6 },
};

/** Find a sane spot near a target: on land, gentle slope, above water. */
export function findGround(x, z, opts = {}) {
  const { minH = 1.2, maxH = 30, maxSlope = 0.3, radius = 26, rng = Math.random } = opts;
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 220; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const h = heightAt(px, pz);
    const s = slopeAt(px, pz);
    if (h < minH || h > maxH || s > maxSlope) continue;
    const score = -r * 0.6 - s * 20;
    if (score > bestScore) { bestScore = score; best = { x: px, y: h, z: pz }; }
  }
  return best || { x, y: Math.max(heightAt(x, z), 0.5), z };
}

/* ===========================================================
   SCATTER THE ISLAND
   =========================================================== */
/**
 * @param {Array<{x,z,r}>} clearZones keep-out circles (landmarks, the cave
 *        mouth) so set pieces never end up buried in palm trunks.
 */
export function scatterIsland(scene, mats, rng, density, colliders, clearZones = []) {
  const B = new Batcher(mats);

  const PALMS = 5, JTREES = 4, BUSHES = 3, FERNS = 3, TUFTS = 2, ROCKS = 4;
  for (let i = 0; i < PALMS; i++) B.addVariant('palm' + i, buildPalm(rng, i));
  for (let i = 0; i < JTREES; i++) B.addVariant('jtree' + i, buildJungleTree(rng));
  for (let i = 0; i < BUSHES; i++) B.addVariant('bush' + i, buildBush(rng));
  for (let i = 0; i < FERNS; i++) B.addVariant('fern' + i, buildFern(rng));
  for (let i = 0; i < TUFTS; i++) B.addVariant('tuft' + i, buildTuft(rng));
  for (let i = 0; i < 2; i++) B.addVariant('flowers' + i, buildFlowers(rng));
  for (let i = 0; i < ROCKS; i++) B.addVariant('rock' + i, buildRock(rng, false));
  for (let i = 0; i < 3; i++) B.addVariant('bigrock' + i, buildRock(rng, true));
  for (let i = 0; i < 2; i++) B.addVariant('drift' + i, buildDriftwood(rng));
  B.addVariant('shell0', buildShell(rng));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const put = (key, x, y, z, yaw, s, tiltNormal = false) => {
    v.set(x, y, z);
    e.set(0, yaw, 0);
    if (tiltNormal) e.set((rng() - .5) * 0.16, yaw, (rng() - .5) * 0.16);
    q.setFromEuler(e);
    m.compose(v, q, one.clone().multiplyScalar(s));
    B.add(key, m);
  };

  const addCollider = (x, z, r) => { if (r > 0) colliders.push({ x, z, r }); };

  const tries = Math.round(5200 * density);

  for (let i = 0; i < tries; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (ISLAND.shore + 6);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h = heightAt(x, z);
    if (h < 0.25 || h > 34) continue;
    const slope = slopeAt(x, z);
    const biome = biomeAt(x, z);

    // keep the landmarks and the cave approach clear
    let blocked = false;
    for (const c of clearZones) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) { blocked = true; break; }
    }
    if (blocked) continue;

    const roll = rng();
    const yaw = rng() * Math.PI * 2;

    if (biome === 'sand') {
      if (slope > 0.3) continue;
      if (roll < 0.13) {
        const k = 'palm' + ((rng() * PALMS) | 0);
        const s = 0.85 + rng() * 0.4;
        put(k, x, h - 0.3, z, yaw, s, true);
        addCollider(x, z, 0.7 * s);
      } else if (roll < 0.28) put('tuft' + ((rng() * TUFTS) | 0), x, h - 0.1, z, yaw, 0.7 + rng() * 0.5);
      else if (roll < 0.34) put('drift' + ((rng() * 2) | 0), x, h, z, yaw, 0.9 + rng() * 0.6);
      else if (roll < 0.40) put('shell0', x, h, z, yaw, 1);
      else if (roll < 0.46) put('rock' + ((rng() * ROCKS) | 0), x, h - 0.15, z, yaw, 0.7 + rng() * 0.7);
    } else if (biome === 'jungle') {
      if (roll < 0.20) {
        const k = 'jtree' + ((rng() * JTREES) | 0);
        const s = 0.85 + rng() * 0.45;
        put(k, x, h - 0.3, z, yaw, s, true);
        addCollider(x, z, 0.95 * s);
      } else if (roll < 0.31) {
        const k = 'palm' + ((rng() * PALMS) | 0);
        const s = 0.8 + rng() * 0.45;
        put(k, x, h - 0.3, z, yaw, s, true);
        addCollider(x, z, 0.7 * s);
      } else if (roll < 0.58) put('bush' + ((rng() * BUSHES) | 0), x, h - 0.15, z, yaw, 0.8 + rng() * 0.7);
      else if (roll < 0.78) put('fern' + ((rng() * FERNS) | 0), x, h - 0.1, z, yaw, 0.8 + rng() * 0.6);
      else if (roll < 0.90) put('tuft' + ((rng() * TUFTS) | 0), x, h - 0.1, z, yaw, 0.8 + rng() * 0.6);
      else if (roll < 0.95) put('flowers' + ((rng() * 2) | 0), x, h, z, yaw, 0.9 + rng() * 0.5);
      else put('rock' + ((rng() * ROCKS) | 0), x, h - 0.15, z, yaw, 0.7 + rng() * 0.8);
    } else if (biome === 'rock') {
      if (roll < 0.16) {
        const s = 0.7 + rng() * 0.8;
        put('bigrock' + ((rng() * 3) | 0), x, h - 0.4, z, yaw, s, true);
        addCollider(x, z, 2.0 * s);
      } else if (roll < 0.42) put('rock' + ((rng() * ROCKS) | 0), x, h - 0.2, z, yaw, 0.8 + rng() * 1.1, true);
      else if (roll < 0.55) put('tuft' + ((rng() * TUFTS) | 0), x, h - 0.1, z, yaw, 0.6 + rng() * 0.4);
    }
  }

  /* A deliberate ring of palms marks the grove — Mark I lives here. */
  const gv = LANDMARKS.grove;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = gv.x + Math.cos(a) * 9.5, z = gv.z + Math.sin(a) * 9.5;
    const h = heightAt(x, z);
    put('palm' + (i % PALMS), x, h - 0.3, z, a + Math.PI, 1.15, false);
    addCollider(x, z, 0.85);
  }

  return B.build(scene);
}

/* ===========================================================
   ONE-OFF SET PIECES
   =========================================================== */

/** The ship that put you here. */
export function buildShipwreck(rng, mats) {
  const group = new THREE.Group();
  const opaque = [], cutout = [];

  // hull ribs
  const HULL_LEN = 15;
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const w = 3.6 * Math.sin(Math.PI * (0.18 + t * 0.72));
    const rib = box(0.34, 3.2, 0.5, 'planks', {
      pos: [0, 1.1, (t - 0.5) * HULL_LEN], rot: [0, 0, 0],
    });
    tint(rib, G(0x8b7048));
    opaque.push(rib);
    for (const side of [-1, 1]) {
      const p = box(0.3, 2.6, 0.42, 'planks', {
        pos: [side * w, 1.0 + rng() * 0.3, (t - 0.5) * HULL_LEN],
        rot: [0, 0, side * (0.35 + rng() * 0.2)],
      });
      tint(p, G(0x7d6440).multiplyScalar(0.85 + rng() * 0.35));
      opaque.push(p);
    }
  }
  // planking
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const y = 0.5 + ((i / 2) | 0) * 0.55;
    const p = box(0.22, 0.5, HULL_LEN * (0.9 - i * 0.02), 'planks', {
      pos: [side * (3.0 - (i / 2) * 0.28), y, (rng() - .5) * 1.4],
      rot: [0, (rng() - .5) * 0.06, side * 0.3],
    });
    tint(p, G(0x8b7048).multiplyScalar(0.8 + rng() * 0.4));
    opaque.push(p);
  }
  // deck
  const deck = box(5.4, 0.3, 9, 'planks', { pos: [0, 2.3, -1.6], rot: [0.06, 0, 0.04] });
  tint(deck, G(0x6f5a3a));
  opaque.push(deck);

  // snapped mast
  const mast = cyl(0.28, 0.42, 8.5, 6, 'planks', { pos: [0, 5.6, -1.6], rot: [0.34, 0, 0.16] });
  tint(mast, G(0x7a6340));
  opaque.push(mast);
  const spar = cyl(0.16, 0.2, 5.5, 5, 'planks', { pos: [-0.8, 8.4, -3.6], rot: [0, 0.3, Math.PI / 2] });
  tint(spar, G(0x7a6340));
  opaque.push(spar);

  // torn sail
  const sail = plane(5.2, 4.4, 'sail', { pos: [-0.8, 6.6, -3.4], rot: [0.2, 0.3, 0.1] });
  tint(sail, G(0xd8cdb2));
  cutout.push(sail);

  // crates and barrels
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2, r = 5 + rng() * 6;
    const c = box(1.1, 1.1, 1.1, 'planks', {
      pos: [Math.cos(a) * r, 0.55, Math.sin(a) * r], rot: [(rng() - .5) * .3, rng() * 3, (rng() - .5) * .3],
    });
    tint(c, G(0x8b7048).multiplyScalar(0.8 + rng() * 0.4));
    opaque.push(c);
  }
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2, r = 6 + rng() * 5;
    const b = cyl(0.6, 0.72, 1.5, 8, 'planks', {
      pos: [Math.cos(a) * r, 0.7, Math.sin(a) * r], rot: [Math.PI / 2 * (rng() > .5 ? 1 : 0), rng() * 3, 0],
    });
    tint(b, G(0x76603e));
    opaque.push(b);
  }

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));
  group.add(new THREE.Mesh(mergeGeos(cutout), mats.cutoutStill));
  return group;
}

/** Campfire with animated flames — your only comfort. */
export function buildCampfire(rng, mats) {
  const group = new THREE.Group();
  const opaque = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = ico(0.3 + rng() * 0.16, 0, 'rock', {
      pos: [Math.cos(a) * 1.05, 0.12, Math.sin(a) * 1.05], rot: [rng(), rng(), rng()],
    });
    tint(s, G(0x8a8070).multiplyScalar(0.8 + rng() * 0.4));
    opaque.push(s);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const l = cyl(0.11, 0.15, 1.5, 5, 'torchWood', {
      pos: [Math.cos(a) * 0.3, 0.42, Math.sin(a) * 0.3], rot: [0.9, a, 0],
    });
    tint(l, G(0x4a3524));
    opaque.push(l);
  }
  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));

  const flames = buildFlameCluster(mats, 4, 1.0);
  flames.position.y = 0.55;
  group.add(flames);
  group.userData.flames = flames;

  const light = new THREE.PointLight(0xff9a3c, 2.2, 22, 1.6);
  light.position.y = 1.3;
  group.add(light);
  group.userData.light = light;
  return group;
}

/** Reusable crossed-billboard flame. */
export function buildFlameCluster(mats, count = 3, scale = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const q = plane(1.1 * scale, 1.7 * scale, 'flame');
    q.translate(0, 0.85 * scale, 0);
    place(q, { rot: [0, (i / count) * Math.PI, 0] });
    tint(q, G(0xffffff));
    const mesh = new THREE.Mesh(mergeGeos([q]), mats.emissive);
    mesh.userData.phase = i * 1.7;
    mesh.userData.base = scale;
    g.add(mesh);
  }
  g.userData.tick = (t) => {
    for (const m of g.children) {
      const p = m.userData.phase;
      const s = 0.82 + Math.sin(t * 9 + p) * 0.13 + Math.sin(t * 14.3 + p * 2) * 0.07;
      m.scale.set(0.9 + Math.sin(t * 11 + p) * 0.1, s, 1);
      m.position.y = Math.sin(t * 7 + p) * 0.05;
    }
  };
  return g;
}

/** Wall torch used in the cave. */
export function buildTorch(mats) {
  const group = new THREE.Group();
  const stick = cyl(0.07, 0.1, 1.2, 5, 'torchWood', { pos: [0, 0.6, 0], rot: [0.3, 0, 0] });
  tint(stick, G(0x4a3524));
  group.add(new THREE.Mesh(mergeGeos([stick]), mats.opaque));
  const f = buildFlameCluster(mats, 3, 0.62);
  f.position.set(0, 1.05, 0.18);
  group.add(f);
  group.userData.flames = f;
  const light = new THREE.PointLight(0xffa040, 1.9, 17, 1.7);
  light.position.set(0, 1.4, 0.2);
  group.add(light);
  group.userData.light = light;
  return group;
}

/** A carved stone Mark. Picking one up is the core collectible loop. */
export function buildMarkStone(mats, index) {
  const group = new THREE.Group();
  const opaque = [];

  const base = cyl(1.15, 1.45, 0.5, 8, 'stone', { pos: [0, 0.25, 0] });
  tint(base, G(0x9a9184));
  opaque.push(base);

  const slab = box(1.5, 2.3, 0.34, 'runes', { pos: [0, 1.45, 0], rot: [-0.09, 0, 0] });
  tint(slab, G(0xbfb49f));
  opaque.push(slab);

  const cap = box(1.75, 0.26, 0.5, 'stone', { pos: [0, 2.66, -0.1] });
  tint(cap, G(0x8f877a));
  opaque.push(cap);

  for (let i = 0; i < 3; i++) {
    const s = ico(0.3, 0, 'moss', { pos: [(i - 1) * 0.7, 0.42, 0.5], rot: [i, i * 2, 0] });
    tint(s, G(0x7f9a5c));
    opaque.push(s);
  }

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));

  // hovering glyph so you can spot it through the ferns
  const glyph = plane(0.9, 0.9, 'crystal');
  const gm = new THREE.Mesh(mergeGeos([tint(glyph, G(0xffe27a))]), mats.emissive);
  gm.position.set(0, 3.4, 0);
  group.add(gm);
  group.userData.glyph = gm;

  const light = new THREE.PointLight(0xffd24a, 1.4, 12, 2);
  light.position.set(0, 2.6, 0.6);
  group.add(light);

  group.userData.tick = (t) => {
    gm.position.y = 3.35 + Math.sin(t * 1.9 + index) * 0.18;
    gm.rotation.y = t * 1.1;
    light.intensity = 1.2 + Math.sin(t * 3 + index) * 0.35;
  };
  return group;
}

/** Ruined shrine at the lagoon. */
export function buildShrine(rng, mats) {
  const group = new THREE.Group();
  const opaque = [], cutout = [];

  const floor = cyl(6.4, 6.8, 0.6, 10, 'stone', { pos: [0, 0.3, 0] });
  tint(floor, G(0x9c9384));
  opaque.push(floor);

  const step = cyl(7.6, 8.0, 0.4, 10, 'stone', { pos: [0, 0.05, 0] });
  tint(step, G(0x8b8375));
  opaque.push(step);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const broken = rng() < 0.45;
    const h = broken ? 1.6 + rng() * 1.8 : 4.6;
    const col = cyl(0.42, 0.52, h, 8, 'stone', {
      pos: [Math.cos(a) * 5.2, 0.6 + h / 2, Math.sin(a) * 5.2],
      rot: broken ? [(rng() - .5) * 0.2, 0, (rng() - .5) * 0.2] : [0, 0, 0],
    });
    tint(col, G(0xa79d8d).multiplyScalar(0.85 + rng() * 0.3));
    opaque.push(col);
    if (!broken) {
      const cap = box(1.3, 0.36, 1.3, 'stone', { pos: [Math.cos(a) * 5.2, 0.6 + h + 0.18, Math.sin(a) * 5.2] });
      tint(cap, G(0x968d7e));
      opaque.push(cap);
    }
    // fallen chunks
    if (broken) {
      const chunk = cyl(0.42, 0.48, 1.4, 8, 'stone', {
        pos: [Math.cos(a) * 6.8 + rng(), 0.9, Math.sin(a) * 6.8 + rng()],
        rot: [Math.PI / 2, rng() * 3, 0],
      });
      tint(chunk, G(0x8f8676));
      opaque.push(chunk);
    }
  }

  // central altar
  const altar = box(2.6, 1.3, 2.0, 'stone', { pos: [0, 1.25, 0] });
  tint(altar, G(0xb0a693));
  opaque.push(altar);
  const dish = cyl(0.9, 1.0, 0.3, 10, 'goldDark', { pos: [0, 2.05, 0] });
  tint(dish, G(0xd8b45c));
  opaque.push(dish);

  // vines + moss creeping over it
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, r = 3 + rng() * 4.6;
    const v = plane(0.5, 2.2 + rng() * 1.6, 'vine', {
      pos: [Math.cos(a) * r, 1.4, Math.sin(a) * r], rot: [0, rng() * 3, (rng() - .5) * 0.5],
    });
    tint(v, G(0xffffff).multiplyScalar(0.7 + rng() * 0.4));
    cutout.push(v);
  }
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 6.4;
    const b = plane(1.6, 1.4, 'leafBush', {
      pos: [Math.cos(a) * r, 1.2, Math.sin(a) * r], rot: [0, rng() * 3, 0],
    });
    tint(b, G(0xffffff).multiplyScalar(0.6 + rng() * 0.4));
    cutout.push(b);
  }

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));
  group.add(new THREE.Mesh(mergeGeos(cutout), mats.cutoutStill));
  return group;
}

/** Stone cairn at the overlook. */
export function buildCairn(rng, mats) {
  const parts = [];
  let y = 0;
  for (let i = 0; i < 7; i++) {
    const s = 1.15 - i * 0.12;
    const g = ico(s, 0, 'rock', { pos: [(rng() - .5) * 0.3, y + s * 0.4, (rng() - .5) * 0.3], rot: [rng(), rng(), rng()] });
    g.scale(1, 0.6, 1);
    jitterVerts(g, s * 0.2, rng);
    tint(g, G(0xffffff).multiplyScalar(0.72 + rng() * 0.4));
    parts.push(g);
    y += s * 0.75;
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeos(parts), mats.opaque));
  return group;
}

/** The sealed cave mouth in the red cliff. */
export function buildCaveDoor(rng, mats, signTex) {
  const group = new THREE.Group();
  const opaque = [], cutout = [];

  // rock frame
  for (let i = 0; i < 16; i++) {
    const a = Math.PI * (i / 15);
    const r = 5.6;
    const s = 1.5 + rng() * 1.4;
    const g = ico(s, 0, 'caveRock', {
      pos: [Math.cos(a) * r * 1.15, Math.sin(a) * r + 0.4, (rng() - .5) * 1.6],
      rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    jitterVerts(g, s * 0.3, rng);
    tint(g, G(0x8a5a42).multiplyScalar(0.75 + rng() * 0.45));
    opaque.push(g);
  }
  // side buttresses
  for (const side of [-1, 1]) {
    const g = box(2.6, 8, 3, 'caveRock', { pos: [side * 6.6, 4, 0], rot: [0, 0, side * 0.06] });
    jitterVerts(g, 0.5, rng);
    tint(g, G(0x7d5340));
    opaque.push(g);
  }

  // the dark throat behind the door
  const mouth = plane(9.4, 10, 'caveRock', { pos: [0, 4.6, -1.4] });
  tint(mouth, G(0x0a0806));
  const mouthMesh = new THREE.Mesh(mergeGeos([mouth]), mats.opaque);
  group.add(mouthMesh);

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));

  /* ---- the door itself: two halves that grind apart ---- */
  const doorGroup = new THREE.Group();
  for (const side of [-1, 1]) {
    const parts = [];
    const d = box(4.4, 9.2, 1.1, 'stone', { pos: [side * 2.25, 4.6, -0.4] });
    tint(d, G(0x9c8a70));
    parts.push(d);
    // carved rune panels
    for (let i = 0; i < 4; i++) {
      const p = box(2.6, 1.5, 0.28, 'runes', { pos: [side * 2.25, 1.7 + i * 2.0, -1.05] });
      tint(p, G(0xd8c8a0));
      parts.push(p);
    }
    const edge = box(0.4, 9.2, 1.3, 'stone', { pos: [side * 0.2, 4.6, -0.4] });
    tint(edge, G(0x776850));
    parts.push(edge);
    const half = new THREE.Mesh(mergeGeos(parts), mats.opaque);
    half.userData.side = side;
    doorGroup.add(half);
  }

  // four keyhole sockets that light up as you find Marks
  const sockets = [];
  for (let i = 0; i < 4; i++) {
    const g = plane(0.8, 0.8, 'crystal', { pos: [(i - 1.5) * 1.5, 7.4, -1.1] });
    tint(g, G(0x30404a));
    const mesh = new THREE.Mesh(mergeGeos([g]), mats.emissive);
    doorGroup.add(mesh);
    sockets.push(mesh);
  }
  doorGroup.userData.sockets = sockets;
  group.add(doorGroup);
  group.userData.door = doorGroup;

  // plaque
  if (signTex) {
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), signMat);
    sign.position.set(0, 9.8, -0.9);
    group.add(sign);
  }

  // torches either side
  for (const side of [-1, 1]) {
    const t = buildTorch(mats);
    t.position.set(side * 5.4, 3.4, 0.6);
    group.add(t);
    group.userData.torches = group.userData.torches || [];
    group.userData.torches.push(t);
  }

  group.userData.openAmount = 0;
  group.userData.setOpen = (a) => {
    group.userData.openAmount = a;
    for (const half of doorGroup.children) {
      if (half.userData.side === undefined) continue;
      half.position.x = half.userData.side * a * 4.6;
      half.position.y = -a * 0.4;
    }
    sockets.forEach((s) => { s.visible = a < 0.98; });
  };
  group.userData.setSockets = (n) => {
    sockets.forEach((s, i) => {
      const on = i < n;
      s.material = on ? mats.emissive : mats.emissive;
      s.scale.setScalar(on ? 1.25 : 0.8);
      // tint via geometry colour swap
      const c = s.geometry.attributes.color;
      const col = on ? [1.0, 0.82, 0.28] : [0.18, 0.24, 0.28];
      for (let v = 0; v < c.count; v++) c.setXYZ(v, col[0], col[1], col[2]);
      c.needsUpdate = true;
    });
  };
  return group;
}

/** A pile of coconuts you can harvest for ammo. */
export function buildCoconutPile(rng, mats) {
  const parts = [];
  const n = 4 + ((rng() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.8;
    const g = ico(0.36, 0, 'coconut', {
      pos: [Math.cos(a) * r, 0.3 + rng() * 0.3, Math.sin(a) * r], rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(g, G(0x9c7c50).multiplyScalar(0.85 + rng() * 0.3));
    parts.push(g);
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeos(parts), mats.opaque));
  group.userData.tick = (t) => { group.rotation.y = Math.sin(t * 0.5) * 0.1; };
  return group;
}

/** Single thrown coconut. */
export function buildCoconutMesh(mats) {
  const g = ico(0.34, 0, 'coconut');
  tint(g, G(0xa07f52));
  return new THREE.Mesh(mergeGeos([g]), mats.opaque);
}
