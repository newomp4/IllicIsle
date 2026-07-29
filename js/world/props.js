/* ===========================================================
   props.js — everything you can bump into on Illic Isle.
   Each prop type is merged into one geometry and drawn with an
   InstancedMesh, so ~2000 pieces of scenery cost ~20 draw calls.

   SCALE CONTRACT: the castaway is 1.75 units tall. Ground clutter
   must stay under ~1.2 so it never eats the camera; anything the
   player walks through should be shin-to-waist height.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, place, tint,
  limb, jitterVerts, lumpify, bendY, taper,
} from '../lib/geo.js';
import { buildSandWritingTexture, buildSignTexture, applyCell } from '../lib/textures.js';
import { heightAt, slopeAt, biomeAt, vegetationDensity, ISLAND } from './terrain.js';

export const PLAYER_HEIGHT = 1.75;

/* ---------- shared materials ---------- */
export function buildPropMaterials(atlas) {
  const opaque = ps1ify(new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true,
  }), { flat: true });

  const cutout = ps1ify(new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true,
    alphaTest: 0.5, side: THREE.DoubleSide,
  }), { flat: true, wind: 0.10 });

  const cutoutStill = ps1ify(new THREE.MeshLambertMaterial({
    map: atlas, vertexColors: true,
    alphaTest: 0.5, side: THREE.DoubleSide,
  }), { flat: true });

  const emissive = ps1ify(new THREE.MeshBasicMaterial({
    map: atlas, vertexColors: true,
    alphaTest: 0.4, side: THREE.DoubleSide,
  }), { flat: true });

  // flat-on-the-ground decals (sand writing, scorch marks)
  const decal = new THREE.MeshLambertMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });

  return { opaque, cutout, cutoutStill, emissive, decal };
}

const G = (n) => new THREE.Color(n);

/* ===========================================================
   TREES — four distinct height tiers so the canopy has structure
   ===========================================================
   sapling   3.5 -  6    waist-to-two-storey scrub
   sub       8   - 13    the bulk of the forest
   canopy    16  - 22    what you walk under
   emergent  26  - 34    rare giants that break the roof
*/
const TIERS = {
  sapling:  { h: [3.5, 6],   r: 0.16, crown: 0.55, colR: 0.30 },
  sub:      { h: [8, 13],    r: 0.30, crown: 0.85, colR: 0.55 },
  canopy:   { h: [16, 22],   r: 0.46, crown: 1.25, colR: 0.80 },
  emergent: { h: [26, 34],   r: 0.66, crown: 1.75, colR: 1.10 },
};

/* ---------- palm ----------
   A real palm frond is a long arching rib with feathered blades folded
   into a shallow V. One flat quad reads as a leaf on a stick, which is
   what these looked like before. Each frond here is a 3-column strip:
   the centre column is the rib and gets lifted, the outer columns fall
   away, and the whole thing arcs up and then droops.
*/
function buildFrond(len, wid, droop, rng) {
  /* A coconut palm frond is LONG and NARROW — roughly 8:1 — and it leaves
     the crown almost horizontally before the last third bends over. Short
     wide leaves read as a banana plant, which is what these were. */
  const SEG = 12;
  const g = new THREE.PlaneGeometry(wid, len, 2, SEG);   // 3 columns
  applyCell(g, 'palmFrond');
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const col = i % 3;                    // 0 left, 1 rib, 2 right
    const x0 = p.getX(i);
    // Clamp: float error can leave this a hair below zero, and
    // Math.pow(negative, fractional) is NaN, which poisons the whole
    // merged buffer and kills the bounding sphere.
    const t = THREE.MathUtils.clamp((p.getY(i) + len / 2) / len, 0, 1);

    // slim at the base, widest a third along, tapering to a long point
    const w = Math.sin(Math.PI * Math.pow(t, 0.5)) * 0.9 + 0.10;
    // a shallow arch that only really falls away in the last third
    const rise = Math.sin(t * Math.PI * 0.42) * len * 0.16;
    const fall = Math.pow(Math.max(0, t - 0.28) / 0.72, 2.6) * len * droop;
    // V fold along the rib, deepening toward the tip
    const fold = col === 1 ? wid * 0.26 : -wid * 0.14 * (0.25 + t * 0.9);

    p.setX(i, x0 * w);
    p.setY(i, t * len * 0.96 + rise - fall);
    p.setZ(i, fold + Math.sin(t * 4.2) * wid * 0.04);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function buildPalm(rng, tierName) {
  const T = TIERS[tierName];
  const H = T.h[0] + rng() * (T.h[1] - T.h[0]);
  const lean = (rng() - 0.5) * (H * 0.20);
  const leanZ = (rng() - 0.5) * (H * 0.16);
  const rBase = T.r * 1.9, rTop = T.r * 0.95;

  const trunk = cyl(rTop, rBase, H, 8, 'bark', { pos: [0, H / 2, 0] });
  bendY(trunk, lean, 'x', 2.1);
  bendY(trunk, leanZ, 'z', 2.1);
  tint(trunk, G(0xb59a72).multiplyScalar(0.82 + rng() * 0.3));

  // Buried footing: on a slope a flat trunk base lifts off the ground and
  // you can see under the tree. Sink a wide plug well below zero.
  const plug = cyl(rBase * 1.5, rBase * 2.4, 4.0, 8, 'bark', { pos: [0, -1.7, 0] });
  tint(plug, G(0x8d7550));

  const cx = lean, cz = leanZ;
  const opaqueParts = [trunk, plug];
  const cutoutParts = [];

  /* crownshaft: the smooth green collar under the fronds */
  const collar = cyl(rTop * 0.8, rTop * 1.25, T.crown * 1.1, 8, 'vine', {
    pos: [cx, H - T.crown * 0.4, cz],
  });
  tint(collar, G(0x7f9456));
  opaqueParts.push(collar);

  /* fronds — a proper crown of them */
  const n = tierName === 'sapling' ? 9 : 15 + ((rng() * 4) | 0);
  const frondLen = T.crown * 11.0;      // long fronds, palm proportions
  for (let i = 0; i < n; i++) {
    // even radial spacing with only a touch of jitter, or the crown
    // bunches to one side and looks like a broken umbrella
    const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.16;
    /* Three rings, but all closer to horizontal than before: a palm crown
       is a fountain, not a shuttlecock. Only a couple of young fronds
       stand up in the middle. */
    const ring = i % 3;
    const pitch = ring === 0 ? 0.55 + rng() * 0.22
                : ring === 1 ? 1.05 + rng() * 0.20
                :              1.42 + rng() * 0.22;
    const len = frondLen * (ring === 2 ? 1.0 : ring === 1 ? 0.94 : 0.76) * (0.9 + rng() * 0.2);
    const wid = T.crown * (0.62 + rng() * 0.20);

    const f = buildFrond(len, wid, 0.55 + rng() * 0.5, rng);
    // tip it out from the trunk, THEN spin it round: see place()
    place(f, { rot: [pitch, a, 0], order: 'YXZ', pos: [cx, H - T.crown * 0.15, cz] });
    tint(f, G(0xffffff).multiplyScalar(0.62 + rng() * 0.55));
    cutoutParts.push(f);
  }

  /* two or three spent fronds hanging straight down under the crown */
  if (tierName !== 'sapling') {
    for (let i = 0; i < 3; i++) {
      const a = rng() * Math.PI * 2;
      const f = buildFrond(frondLen * 0.55, T.crown * 0.5, 1.9, rng);
      place(f, { order: 'YXZ', rot: [2.5 + rng() * 0.35, a, 0], pos: [cx, H - T.crown * 0.25, cz] });
      tint(f, G(0xa79052).multiplyScalar(0.62 + rng() * 0.3));
      cutoutParts.push(f);
    }
    // two young spears standing up out of the centre
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2;
      const f = buildFrond(frondLen * 0.5, T.crown * 0.42, 0.25, rng);
      place(f, { order: 'YXZ', rot: [0.12 + rng() * 0.14, a, 0], pos: [cx, H - T.crown * 0.05, cz] });
      tint(f, G(0xffffff).multiplyScalar(0.75 + rng() * 0.35));
      cutoutParts.push(f);
    }
  }

  const knot = ico(T.crown * 0.5, 0, 'bark', { pos: [cx, H - T.crown * 0.3, cz] });
  tint(knot, G(0x8d7550));
  opaqueParts.push(knot);

  if (tierName === 'sub' || tierName === 'canopy') {
    const cn = 2 + ((rng() * 4) | 0);
    for (let i = 0; i < cn; i++) {
      const a = rng() * Math.PI * 2;
      const c = ico(0.26, 0, 'coconut', {
        pos: [cx + Math.cos(a) * T.crown * 0.45, H - T.crown * 0.5 - rng() * 0.4,
              cz + Math.sin(a) * T.crown * 0.45],
      });
      tint(c, G(0x9c7c50));
      opaqueParts.push(c);
    }
  }

  return { opaque: mergeGeos(opaqueParts), cutout: mergeGeos(cutoutParts), r: rBase * 0.85 };
}

/* ---------- broadleaf jungle tree ---------- */
function buildJungleTree(rng, tierName) {
  const T = TIERS[tierName];
  const H = T.h[0] + rng() * (T.h[1] - T.h[0]);
  const rBase = T.r * 2.4, rTop = T.r * 1.1;

  const trunk = cyl(rTop, rBase, H, 7, 'barkDark', { pos: [0, H / 2, 0] });
  bendY(trunk, (rng() - 0.5) * H * 0.10, 'x', 2);
  tint(trunk, G(0x7d6a4c).multiplyScalar(0.8 + rng() * 0.35));

  // buried footing so the trunk never lifts off a slope
  const plug = cyl(rBase * 1.4, rBase * 2.6, 4.0, 7, 'barkDark', { pos: [0, -1.7, 0] });
  tint(plug, G(0x5f4f38));

  const opaqueParts = [trunk, plug];

  // buttress roots — the signature of a big rainforest tree
  const buttresses = tierName === 'sapling' ? 0 : (tierName === 'sub' ? 3 : 5);
  for (let i = 0; i < buttresses; i++) {
    const a = (i / buttresses) * Math.PI * 2 + rng();
    const bh = H * 0.16, bl = rBase * 2.2;
    const r = box(rBase * 0.34, bh, bl, 'barkDark', {
      pos: [Math.cos(a) * rBase * 0.9, bh * 0.45, Math.sin(a) * rBase * 0.9],
      rot: [0, -a, 0.22],
    });
    tint(r, G(0x6f5c42));
    opaqueParts.push(r);
  }

  // branches on the larger tiers
  const cutoutParts = [];
  if (tierName === 'canopy' || tierName === 'emergent') {
    const nb = 3 + ((rng() * 3) | 0);
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2 + rng() * 0.6;
      const y0 = H * (0.55 + rng() * 0.3);
      const reach = T.crown * (1.6 + rng() * 1.2);
      const b = limb(
        [0, y0, 0],
        [Math.cos(a) * reach, y0 + reach * 0.42, Math.sin(a) * reach],
        T.r * 0.42, T.r * 0.18, 'barkDark', 5
      );
      tint(b, G(0x6f5c42));
      opaqueParts.push(b);
    }
  }

  const canopyBlobs = tierName === 'sapling' ? 2 : (tierName === 'sub' ? 3 : 5);
  for (let i = 0; i < canopyBlobs; i++) {
    const a = rng() * Math.PI * 2;
    const rad = rng() * T.crown * 1.5;
    const size = T.crown * (1.5 + rng() * 1.1);
    const blob = ico(size, 0, 'leafBush', {
      pos: [Math.cos(a) * rad, H - T.crown * 0.3 + rng() * T.crown * 1.3, Math.sin(a) * rad],
      scale: [1.35, 0.7, 1.35],
    });
    tint(blob, G(0xffffff).multiplyScalar(0.55 + rng() * 0.5));
    cutoutParts.push(blob);
  }

  // hanging vines off the canopy — the thing that makes jungle read as jungle
  if (tierName !== 'sapling') {
    const nv = 2 + ((rng() * 4) | 0);
    for (let i = 0; i < nv; i++) {
      const a = rng() * Math.PI * 2;
      const rad = T.crown * (0.8 + rng() * 1.3);
      const vlen = H * (0.22 + rng() * 0.34);
      const v = plane(0.7, vlen, 'hangVine');
      v.translate(0, -vlen / 2, 0);
      place(v, {
        rot: [0, a + rng(), 0],
        pos: [Math.cos(a) * rad, H - T.crown * 0.4, Math.sin(a) * rad],
      });
      tint(v, G(0xffffff).multiplyScalar(0.65 + rng() * 0.4));
      cutoutParts.push(v);
    }
  }

  return { opaque: mergeGeos(opaqueParts), cutout: mergeGeos(cutoutParts), r: rBase * 0.9 };
}

/* ===========================================================
   GROUND COVER — deliberately small
   =========================================================== */
function buildBush(rng) {
  const parts = [];
  const n = 3;
  const s = 0.40 + rng() * 0.30;          // ~0.75-1.15 tall
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + rng() * 0.5;
    const q = plane(2.0 * s, 1.7 * s, 'leafBush');
    q.translate(0, 0.85 * s, 0);
    place(q, { rot: [0, a, 0], pos: [(rng() - .5) * 0.3, 0, (rng() - .5) * 0.3] });
    tint(q, G(0xffffff).multiplyScalar(0.55 + rng() * 0.5));
    parts.push(q);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

function buildFern(rng) {
  const parts = [];
  const n = 5 + ((rng() * 3) | 0);
  const s = 0.50 + rng() * 0.28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.5;
    const len = (1.3 + rng() * 0.8) * s;
    const f = plane(0.8 * s, len, 'fernLeaf');
    f.translate(0, len / 2, 0);
    const p = f.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = p.getY(v) / len;
      p.setY(v, p.getY(v) - Math.pow(t, 2) * len * 0.55);
    }
    p.needsUpdate = true;
    place(f, { order: 'YXZ', rot: [0.8 + rng() * 0.3, a, 0] });
    tint(f, G(0xffffff).multiplyScalar(0.6 + rng() * 0.5));
    parts.push(f);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

function buildTuft(rng) {
  const parts = [];
  const s = 0.34 + rng() * 0.26;          // ankle height
  for (let i = 0; i < 2; i++) {
    const q = plane(1.2 * s, 0.9 * s, 'tuft');
    q.translate(0, 0.45 * s, 0);
    place(q, { rot: [0, (i / 2) * Math.PI + rng(), 0] });
    tint(q, G(0xffffff).multiplyScalar(0.62 + rng() * 0.45));
    parts.push(q);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

function buildFlowers(rng) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const q = plane(0.42, 0.42, 'flower');
    place(q, { rot: [0, rng() * Math.PI, 0], pos: [(rng() - .5) * 0.7, 0.26 + rng() * 0.14, (rng() - .5) * 0.7] });
    parts.push(q);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/** A big monstera-style leaf sitting low — used sparingly for silhouette. */
function buildBigLeaf(rng) {
  const parts = [];
  const n = 3 + ((rng() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const len = 0.9 + rng() * 0.5;
    const l = plane(0.75, len, 'jungleLeaf');
    l.translate(0, len / 2, 0);
    place(l, { order: 'YXZ', rot: [0.95 + rng() * 0.3, a, 0], pos: [0, 0.18, 0] });
    tint(l, G(0xffffff).multiplyScalar(0.6 + rng() * 0.45));
    parts.push(l);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/** A tall tree fern: a slim trunk with a crown of arching fronds.
 *  The jungle floor was three shapes repeated; this adds silhouette. */
function buildTreeFern(rng) {
  const opaque = [], cutout = [];
  const H = 1.6 + rng() * 1.5;
  const trunk = cyl(0.09, 0.15, H, 6, 'barkDark', { pos: [0, H / 2, 0] });
  tint(trunk, G(0x6a5a42)); opaque.push(trunk);
  const plug = cyl(0.16, 0.26, 1.4, 6, 'barkDark', { pos: [0, -0.5, 0] });
  tint(plug, G(0x5a4c36)); opaque.push(plug);

  const n = 6 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.3;
    const len = 1.0 + rng() * 0.7;
    const f = plane(0.75, len, 'fernLeaf');
    f.translate(0, len / 2, 0);
    const p = f.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = THREE.MathUtils.clamp(p.getY(v) / len, 0, 1);
      p.setY(v, p.getY(v) - t * t * len * 0.62);
    }
    p.needsUpdate = true;
    f.computeVertexNormals();
    place(f, { order: 'YXZ', rot: [0.62 + rng() * 0.3, a, 0], pos: [0, H, 0] });
    tint(f, G(0xffffff).multiplyScalar(0.6 + rng() * 0.5));
    cutout.push(f);
  }
  return { opaque: mergeGeos(opaque), cutout: mergeGeos(cutout), r: 0 };
}

/** Elephant-ear: two or three very broad low leaves. */
function buildBroadLeaf(rng) {
  const parts = [];
  const n = 2 + ((rng() * 2) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const len = 1.1 + rng() * 0.6;
    const l = plane(1.05, len, 'jungleLeaf');
    l.translate(0, len / 2, 0);
    const p = l.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = THREE.MathUtils.clamp(p.getY(v) / len, 0, 1);
      p.setZ(v, p.getZ(v) + Math.sin(t * Math.PI) * 0.22);
    }
    p.needsUpdate = true;
    l.computeVertexNormals();
    place(l, { order: 'YXZ', rot: [0.72 + rng() * 0.35, a, 0], pos: [(rng() - .5) * 0.3, 0.12, (rng() - .5) * 0.3] });
    tint(l, G(0xffffff).multiplyScalar(0.55 + rng() * 0.5));
    parts.push(l);
    // stalk
    const st = cyl(0.035, 0.045, len * 0.5, 4, 'vine', {
      pos: [0, len * 0.2, 0], rot: [0.5, a, 0],
    });
    tint(st, G(0x7fa05a)); parts.push(st);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/** A clump of tall reedy grass, waist high. */
function buildReeds(rng) {
  const parts = [];
  const s = 0.7 + rng() * 0.5;
  for (let i = 0; i < 4; i++) {
    const q = plane(0.9 * s, 1.5 * s, 'tuft');
    q.translate(0, 0.75 * s, 0);
    place(q, { order: 'YXZ', rot: [(rng() - .5) * 0.2, (i / 4) * Math.PI * 2 + rng(), 0],
      pos: [(rng() - .5) * 0.4, 0, (rng() - .5) * 0.4] });
    tint(q, G(0xffffff).multiplyScalar(0.55 + rng() * 0.45));
    parts.push(q);
  }
  return { opaque: null, cutout: mergeGeos(parts), r: 0 };
}

/* ---------- rock ---------- */
function buildRock(rng, big) {
  const s = big ? 1.4 + rng() * 2.0 : 0.32 + rng() * 0.6;
  const g = ico(s, 0, 'rock');
  lumpify(g, 0.30, rng);
  g.scale(1, 0.7 + rng() * 0.5, 1);
  g.translate(0, s * 0.3, 0);
  tint(g, G(0xffffff).multiplyScalar(0.68 + rng() * 0.45));
  return { opaque: mergeGeos([g]), cutout: null, r: big ? s * 0.8 : 0 };
}

function buildDriftwood(rng) {
  const parts = [];
  const n = 1 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const len = 1.2 + rng() * 2.2;
    const g = cyl(0.12 + rng() * 0.08, 0.15 + rng() * 0.1, len, 5, 'driftwood', {
      rot: [Math.PI / 2 + (rng() - .5) * 0.5, rng() * 3, (rng() - .5) * 0.4],
      pos: [(rng() - .5) * 1.1, 0.14, (rng() - .5) * 1.1],
    });
    tint(g, G(0xd8cbb0).multiplyScalar(0.8 + rng() * 0.3));
    parts.push(g);
  }
  return { opaque: mergeGeos(parts), cutout: null, r: 0 };
}

function buildShell(rng) {
  const g = ico(0.16 + rng() * 0.1, 0, 'shell');
  g.scale(1.4, 0.5, 1);
  g.translate(0, 0.07, 0);
  tint(g, G(0xffffff).multiplyScalar(0.85 + rng() * 0.3));
  return { opaque: mergeGeos([g]), cutout: null, r: 0 };
}

/** Ground vine strands snaking over the jungle floor. */
function buildGroundVine(rng) {
  const parts = [];
  let x = 0, z = 0, dir = rng() * Math.PI * 2;
  for (let i = 0; i < 5; i++) {
    const len = 0.9 + rng() * 1.1;
    const g = cyl(0.045, 0.055, len, 4, 'vine', {
      pos: [x + Math.sin(dir) * len / 2, 0.06, z + Math.cos(dir) * len / 2],
      rot: [Math.PI / 2, dir, 0],
    });
    tint(g, G(0x8fbf6a).multiplyScalar(0.55 + rng() * 0.4));
    parts.push(g);
    x += Math.sin(dir) * len; z += Math.cos(dir) * len;
    dir += (rng() - 0.5) * 1.3;
  }
  return { opaque: mergeGeos(parts), cutout: null, r: 0 };
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

/* Named landmarks — all verified against the height function. */
export const LANDMARKS = {
  wreck:    { x: -46, z: 154, minH: 0.7, maxH: 2.6, maxSlope: 0.14, radius: 14 },
  pend1:    { x: -108, z: 46,  minH: 10, maxH: 24, maxSlope: 0.26, radius: 14 },
  pend2:    { x: 36,  z: -116, minH: 30, maxH: 48, maxSlope: 0.28, radius: 14 },
  pend3:    { x: 128, z: -30,  minH: 8,  maxH: 22, maxSlope: 0.26, radius: 14 },
  pend4:    { x: -70, z: -122, minH: 12, maxH: 28, maxSlope: 0.26, radius: 14 },
  lagoon:   { x: 86,  z: 58,   minH: 6,  maxH: 18, maxSlope: 0.2,  radius: 14 },
  rogueSand:{ x: 128, z: -96,  minH: 0.8, maxH: 3.2, maxSlope: 0.12, radius: 16 },
  temple:   { x: 6,   z: -46,  minH: 34, maxH: 50, maxSlope: 0.30, radius: 10 },
};

/**
 * Find a spot where a whole FOOTPRINT is flat, not just its centre point.
 * `slopeAt` samples one place; a building twelve metres long can sit on a
 * perfectly gentle spot and still have its far end three metres in the air
 * — or three metres underground, which is worse.
 *
 * @param {Array<[number,number]>} foot  points in the building's own space
 */
export function findFlatGround(x, z, foot, opts = {}) {
  const { minH = 1.2, maxH = 40, radius = 26, rng = Math.random, yaw = 0, maxRise = 1.4 } = opts;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 500; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    let lo = Infinity, hi = -Infinity, wet = false;
    for (const [lx, lz] of foot) {
      const wx = px + lx * c + lz * sn;
      const wz = pz - lx * sn + lz * c;
      const h = heightAt(wx, wz);
      if (h < minH || h > maxH) { wet = true; break; }
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (wet) continue;
    const rise = hi - lo;
    // flatness first, closeness second
    const score = -rise * 12 - r * 0.35;
    if (score > bestScore) { bestScore = score; best = { x: px, y: lo, z: pz, rise }; }
    if (rise < maxRise * 0.6 && r < radius * 0.6) break;   // good enough
  }
  return best || { x, y: Math.max(heightAt(x, z), 0.5), z, rise: 99 };
}

/**
 * A trodden path between two points: a strip of bare dirt draped over the
 * terrain, wandering a little so it reads as worn rather than surveyed.
 * Returns the mesh and the centre-line, so the jungle can be cleared along
 * it — a path with trees standing in it is not a path.
 */
/**
 * A trodden path.
 *
 * The first version was three ribbons of chocolate brown with a hard edge,
 * and it read as string laid across the hill rather than ground people had
 * walked on. A real path is not a different material from what is around
 * it — it is the SAME ground, worn paler and barer, and it has no edge at
 * all, it just thins out.
 *
 * So: five ribbons wide, the colour taken from the ground it crosses
 * (bleached earth through the jungle, damp packed sand on the beach)
 * rather than a fixed brown, and the outer ribbons fade to nothing through
 * vertex alpha so there is no line anywhere.
 */
/**
 * A trodden path.
 *
 * Three rules it has to obey to stop reading as a line drawn on the map.
 * It is not a different material from the ground — it is the same ground
 * worn barer, so its colour comes from what it crosses. It has no edge,
 * it thins out. And it stops before it arrives: a path leads TO the wreck
 * and to Ferdi's, it does not run through them, so both ends taper away
 * over the last dozen metres.
 */
export function buildDirtPath(ax, az, bx, bz, mats, atlas, opts = {}) {
  const {
    width = 6.4, wobble = 8, rng = Math.random,
    fadeStart = 13, fadeEnd = 13,       // metres of taper at each end
  } = opts;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  // a vertex every two metres, so the strip lies on the ground rather than
  // spanning its humps
  const segs = Math.max(8, Math.round(len / 2));
  const nx = -dz / len, nz = dx / len;
  const phase = rng() * 6.283;

  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const sway = Math.sin(t * 3.1 + phase) * wobble * Math.sin(t * Math.PI);
    pts.push({ x: ax + dx * t + nx * sway, z: az + dz * t + nz * sway, t });
  }

  /* How present the path is at a given point along it: nothing at either
     end, full in the middle, smoothed so there is no step. */
  const along = (t) => {
    const d0 = t * len, d1 = (1 - t) * len;
    const k = Math.min(
      fadeStart > 0 ? Math.min(1, d0 / fadeStart) : 1,
      fadeEnd > 0 ? Math.min(1, d1 / fadeEnd) : 1
    );
    return k * k * (3 - 2 * k);
  };

  /* The colour of worn ground, sampled where the path actually is: packed
     damp sand on the beach, bare earth inland. Both are only a shade or
     two off what they sit on — a beaten path is a change of tone, not a
     change of material. */
  const SAND_WORN = new THREE.Color(0xc0ab7c);
  const EARTH_WORN = new THREE.Color(0x6e6748);
  const EARTH_PALE = new THREE.Color(0x847a58);
  const c = new THREE.Color();
  const wornAt = (px, pz, out) => {
    const h = heightAt(px, pz);
    if (h < 2.8) out.copy(SAND_WORN);
    else out.copy(EARTH_WORN).lerp(EARTH_PALE, 0.4 + Math.sin(px * 0.21 + pz * 0.17) * 0.3);
    return out;
  };

  const pos = [], uv = [], col = [];
  /* Seven ribbons: a bare middle and a long, gentle shoulder either side.
     The wider the taper, the less it reads as an outline. */
  const RIB = [-0.5, -0.38, -0.26, -0.10, 0.10, 0.26, 0.38, 0.5];
  const ALPHA = [0.0, 0.08, 0.24, 0.52, 0.52, 0.24, 0.08, 0.0];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const a0 = along(p0.t), a1 = along(p1.t);
    if (a0 <= 0.002 && a1 <= 0.002) continue;
    const sx = p1.x - p0.x, sz = p1.z - p0.z;
    const sl = Math.hypot(sx, sz) || 1;
    const ox = -sz / sl, oz = sx / sl;
    // the strip breathes along its length so it is not a ruler, and it
    // narrows as it fades out
    const w0 = width * (0.78 + Math.sin(i * 0.62) * 0.22) * (0.45 + a0 * 0.55);
    const w1 = width * (0.78 + Math.sin((i + 1) * 0.62) * 0.22) * (0.45 + a1 * 0.55);

    for (let r = 0; r < RIB.length - 1; r++) {
      const uA = RIB[r], uB = RIB[r + 1];
      const fA = ALPHA[r], fB = ALPHA[r + 1];
      const quad = [
        [p0.x + ox * w0 * uA, p0.z + oz * w0 * uA, fA * a0, 0, 0],
        [p0.x + ox * w0 * uB, p0.z + oz * w0 * uB, fB * a0, 1, 0],
        [p1.x + ox * w1 * uB, p1.z + oz * w1 * uB, fB * a1, 1, 1],
        [p1.x + ox * w1 * uA, p1.z + oz * w1 * uA, fA * a1, 0, 1],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [qx, qz, alpha, u, v] = quad[k];
        pos.push(qx, heightAt(qx, qz) + 0.04, qz);
        uv.push(u, v);
        wornAt(qx, qz, c);
        const n = 0.94 + rng() * 0.12;
        col.push(c.r * n, c.g * n, c.b * n, alpha);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // four components: three does read the alpha, and the alpha is the point
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeVertexNormals();
  applyCell(g, 'sand');

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true, map: atlas,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 1;

  /* ---- and what is lying on it ----
     A wash of colour with no objects in it is a stripe. Small stones
     trodden into the surface, and a few tufts that have survived along the
     margins, give the eye something to land on. Everything here is small,
     dark and mostly buried: a boulder sitting proud on a footpath reads as
     a mistake, not as detail. */
  const litter = [];
  const LC = new THREE.Color();
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const a = along(p.t);
    if (a < 0.4) continue;
    const sx = q.x - p.x, sz = q.z - p.z;
    const sl = Math.hypot(sx, sz) || 1;
    const ox = -sz / sl, oz = sx / sl;
    const halfW = width * 0.42 * (0.45 + a * 0.55);

    const n = 2 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const u = (rng() * 2 - 1);                 // -1..1 across the strip
      const v = rng();                           // along this segment
      const px = p.x + sx * v + ox * u * halfW;
      const pz = p.z + sz * v + oz * u * halfW;
      const py = heightAt(px, pz);
      const roll = rng();

      if (roll < 0.70) {
        /* A stone, sunk so only its crown shows, and coloured off the
           ground rather than off a quarry. */
        const r = 0.05 + rng() * 0.075;
        const st = ico(r, 0, 'stone', {
          pos: [px, py + r * 0.20, pz],
          rot: [rng() * 3, rng() * 3, rng() * 3],
          scale: [1, 0.42 + rng() * 0.2, 1],
        });
        const g0 = 0.30 + rng() * 0.10;
        LC.setRGB(g0 + 0.03, g0, g0 - 0.03);
        litter.push(tint(st, LC.clone()));
      } else if (roll < 0.92 && Math.abs(u) > 0.55) {
        // a tuft that has held on at the margin
        const h = 0.09 + rng() * 0.11;
        const tf = box(0.06, h, 0.06, 'jungleLeaf', {
          pos: [px, py + h / 2, pz], rot: [0, rng() * 3, (rng() - 0.5) * 0.6],
        });
        LC.setRGB(0.14 + rng() * 0.06, 0.22 + rng() * 0.08, 0.10);
        litter.push(tint(tf, LC.clone()));
      } else {
        // a twig, lying flat
        const l = 0.16 + rng() * 0.2;
        const tw = cyl(0.016, 0.016, l, 4, 'bark', {
          pos: [px, py + 0.02, pz], rot: [Math.PI / 2, rng() * 3, 0],
        });
        LC.setRGB(0.24, 0.19, 0.12);
        litter.push(tint(tw, LC.clone()));
      }
    }
  }
  if (litter.length) {
    const lm = new THREE.Mesh(mergeGeos(litter), mats.opaque);
    lm.renderOrder = 2;
    mesh.add(lm);
  }

  mesh.userData.line = pts;
  return mesh;
}

/** Find a sane spot near a target: on land, gentle slope, above water. */
export function findGround(x, z, opts = {}) {
  const { minH = 1.2, maxH = 40, maxSlope = 0.3, radius = 26, rng = Math.random } = opts;
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 300; i++) {
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
export function scatterIsland(scene, mats, rng, density, colliders, clearZones = []) {
  const B = new Batcher(mats);

  /* variant pools */
  const POOL = {
    palmSap: 2, palmSub: 4, palmCan: 3, palmEmg: 2,
    treeSap: 2, treeSub: 4, treeCan: 3, treeEmg: 2,
    bush: 3, fern: 3, tuft: 2, flowers: 2, bigleaf: 2,
    treefern: 3, broad: 3, reeds: 2,
    rock: 3, bigrock: 3, drift: 2, gvine: 2,
  };
  for (let i = 0; i < POOL.palmSap; i++) B.addVariant('palmSap' + i, buildPalm(rng, 'sapling'));
  for (let i = 0; i < POOL.palmSub; i++) B.addVariant('palmSub' + i, buildPalm(rng, 'sub'));
  for (let i = 0; i < POOL.palmCan; i++) B.addVariant('palmCan' + i, buildPalm(rng, 'canopy'));
  for (let i = 0; i < POOL.palmEmg; i++) B.addVariant('palmEmg' + i, buildPalm(rng, 'emergent'));
  for (let i = 0; i < POOL.treeSap; i++) B.addVariant('treeSap' + i, buildJungleTree(rng, 'sapling'));
  for (let i = 0; i < POOL.treeSub; i++) B.addVariant('treeSub' + i, buildJungleTree(rng, 'sub'));
  for (let i = 0; i < POOL.treeCan; i++) B.addVariant('treeCan' + i, buildJungleTree(rng, 'canopy'));
  for (let i = 0; i < POOL.treeEmg; i++) B.addVariant('treeEmg' + i, buildJungleTree(rng, 'emergent'));
  for (let i = 0; i < POOL.bush; i++) B.addVariant('bush' + i, buildBush(rng));
  for (let i = 0; i < POOL.fern; i++) B.addVariant('fern' + i, buildFern(rng));
  for (let i = 0; i < POOL.tuft; i++) B.addVariant('tuft' + i, buildTuft(rng));
  for (let i = 0; i < POOL.flowers; i++) B.addVariant('flowers' + i, buildFlowers(rng));
  for (let i = 0; i < POOL.bigleaf; i++) B.addVariant('bigleaf' + i, buildBigLeaf(rng));
  for (let i = 0; i < POOL.treefern; i++) B.addVariant('treefern' + i, buildTreeFern(rng));
  for (let i = 0; i < POOL.broad; i++) B.addVariant('broad' + i, buildBroadLeaf(rng));
  for (let i = 0; i < POOL.reeds; i++) B.addVariant('reeds' + i, buildReeds(rng));
  for (let i = 0; i < POOL.rock; i++) B.addVariant('rock' + i, buildRock(rng, false));
  for (let i = 0; i < POOL.bigrock; i++) B.addVariant('bigrock' + i, buildRock(rng, true));
  for (let i = 0; i < POOL.drift; i++) B.addVariant('drift' + i, buildDriftwood(rng));
  for (let i = 0; i < POOL.gvine; i++) B.addVariant('gvine' + i, buildGroundVine(rng));
  B.addVariant('shell0', buildShell(rng));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  /**
   * Place a prop, sunk to the LOWEST ground under its footprint.
   *
   * Everything used to sit at the height sampled dead under its centre.
   * On any slope that leaves the uphill side buried and the downhill side
   * hanging in the air — which is exactly the floating trunks and the
   * half-sunk monoliths. Sampling a ring at the prop's own radius and
   * taking the minimum means the downhill edge always meets the ground and
   * the uphill edge is simply buried, which nobody ever notices.
   *
   * @param {number} foot  radius of the thing's base, in metres. 0 skips
   *   the extra sampling for scatter that has no base worth speaking of.
   */
  const put = (key, x, y, z, yaw, s, tilt = false, foot = 0) => {
    let yy = y;
    if (foot > 0) {
      const r = foot * s;
      let lo = heightAt(x, z);
      for (let i = 0; i < 6; i++) {
        const a2 = (i / 6) * Math.PI * 2 + 0.4;
        const hh = heightAt(x + Math.cos(a2) * r, z + Math.sin(a2) * r);
        if (hh < lo) lo = hh;
      }
      yy = y - Math.max(0, heightAt(x, z) - lo);
    }
    v.set(x, yy, z);
    e.set(tilt ? (rng() - .5) * 0.12 : 0, yaw, tilt ? (rng() - .5) * 0.12 : 0);
    q.setFromEuler(e);
    m.compose(v, q, one.clone().multiplyScalar(s));
    B.add(key, m);
  };
  const pick = (base, n) => base + ((rng() * n) | 0);
  const addCollider = (x, z, r) => { if (r > 0) colliders.push({ x, z, r }); };

  const tries = Math.round(26000 * density);

  for (let i = 0; i < tries; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (ISLAND.shore + 4);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h = heightAt(x, z);
    if (h < 0.25 || h > 44) continue;
    const slope = slopeAt(x, z);
    const biome = biomeAt(x, z);

    let blocked = false;
    for (const c of clearZones) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) { blocked = true; break; }
    }
    if (blocked) continue;

    const yaw = rng() * Math.PI * 2;
    /* Patchy, not uniform: thickets you push through and glades you can
       actually navigate by. `roll` is divided by local density, so a low
       density pushes rolls past the tree thresholds into "nothing here". */
    const dens = vegetationDensity(x, z);
    const roll = rng() / Math.max(0.12, dens);

    if (biome === 'sand') {
      if (slope > 0.3) continue;
      // Beaches stay open — a thin fringe of palms and not much else.
      if (roll < 0.055) {
        const k = pick('palmSub', POOL.palmSub);
        const s = 0.9 + rng() * 0.3;
        put(k, x, h - 0.25, z, yaw, s, true, 0.55);
        addCollider(x, z, 0.6 * s);
      } else if (roll < 0.075) {
        const k = pick('palmCan', POOL.palmCan);
        put(k, x, h - 0.25, z, yaw, 0.9 + rng() * 0.25, true, 0.8);
        addCollider(x, z, 0.9);
      } else if (roll < 0.12) put(pick('tuft', POOL.tuft), x, h - 0.05, z, yaw, 0.8 + rng() * 0.5);
      else if (roll < 0.145) put(pick('drift', POOL.drift), x, h, z, yaw, 0.9 + rng() * 0.5);
      else if (roll < 0.175) put('shell0', x, h, z, yaw, 1);
      else if (roll < 0.20) {
        const s2 = 0.7 + rng() * 0.6;
        put(pick('rock', POOL.rock), x, h - 0.1, z, yaw, s2, false, 0.5);
        if (s2 > 1.05) addCollider(x, z, 0.5 * s2);
      }

    } else if (biome === 'jungle') {
      /* Dense, layered forest. Trees dominate; ground clutter is kept
         sparse and short so it never fills the camera. */
      /* Thinned out and grown up. It used to be a thicket of small trees
         packed shoulder to shoulder; now there are fewer of them and the
         ones that are there are worth looking at. */
      if (roll < 0.030) {                                   // emergent giants
        const k = rng() < 0.5 ? pick('treeEmg', POOL.treeEmg) : pick('palmEmg', POOL.palmEmg);
        put(k, x, h - 0.5, z, yaw, 1.05 + rng() * 0.30, true, 1.25);
        addCollider(x, z, 2.0);
      } else if (roll < 0.105) {                            // canopy layer
        const k = rng() < 0.55 ? pick('treeCan', POOL.treeCan) : pick('palmCan', POOL.palmCan);
        put(k, x, h - 0.4, z, yaw, 0.95 + rng() * 0.40, true, 1.0);
        addCollider(x, z, 1.3);
      } else if (roll < 0.205) {                            // sub-canopy, sparser
        const k = rng() < 0.6 ? pick('treeSub', POOL.treeSub) : pick('palmSub', POOL.palmSub);
        put(k, x, h - 0.35, z, yaw, 0.95 + rng() * 0.5, true, 0.75);
        addCollider(x, z, 0.95);
      } else if (roll < 0.255) {                            // saplings
        const k = rng() < 0.5 ? pick('treeSap', POOL.treeSap) : pick('palmSap', POOL.palmSap);
        put(k, x, h - 0.2, z, yaw, 0.85 + rng() * 0.5, true, 0.45);
      } else if (roll < 0.320) put(pick('tuft', POOL.tuft), x, h - 0.05, z, yaw, 0.8 + rng() * 0.5);
      else if (roll < 0.360) put(pick('fern', POOL.fern), x, h - 0.05, z, yaw, 0.85 + rng() * 0.4);
      else if (roll < 0.392) {
        const s2 = 0.85 + rng() * 0.4;
        put(pick('treefern', POOL.treefern), x, h - 0.2, z, yaw, s2, true, 0.5);
        addCollider(x, z, 0.42 * s2);
      }
      else if (roll < 0.420) put(pick('broad', POOL.broad), x, h - 0.05, z, yaw, 0.85 + rng() * 0.45);
      else if (roll < 0.444) put(pick('bush', POOL.bush), x, h - 0.08, z, yaw, 0.85 + rng() * 0.35);
      else if (roll < 0.466) put(pick('reeds', POOL.reeds), x, h - 0.05, z, yaw, 0.85 + rng() * 0.4);
      else if (roll < 0.482) put(pick('gvine', POOL.gvine), x, h, z, yaw, 0.9 + rng() * 0.5);
      else if (roll < 0.498) put(pick('bigleaf', POOL.bigleaf), x, h - 0.05, z, yaw, 0.9 + rng() * 0.4);
      else if (roll < 0.514) put(pick('flowers', POOL.flowers), x, h, z, yaw, 0.9 + rng() * 0.4);
      else if (roll < 0.530) {
        const s2 = 0.7 + rng() * 0.7;
        put(pick('rock', POOL.rock), x, h - 0.1, z, yaw, s2, false, 0.5);
        if (s2 > 1.05) addCollider(x, z, 0.5 * s2);
      }

    } else if (biome === 'rock') {
      if (roll < 0.045) {
        const s = 0.7 + rng() * 0.7;
        put(pick('bigrock', POOL.bigrock), x, h - 0.3, z, yaw, s, true, 1.2);
        addCollider(x, z, 1.6 * s);
      } else if (roll < 0.115) {
        /* These reach 1.8x and stand chest high. Without a collider you walk
           straight through them, which was the single most obvious way the
           island gave itself away. Small ones stay steppable. */
        const s2 = 0.8 + rng() * 1.0;
        put(pick('rock', POOL.rock), x, h - 0.15, z, yaw, s2, true, 0.5);
        if (s2 > 1.0) addCollider(x, z, 0.52 * s2);
      }
      else if (roll < 0.165) put(pick('tuft', POOL.tuft), x, h - 0.05, z, yaw, 0.6 + rng() * 0.4);
      else if (roll < 0.205) {
        const k = pick('treeSap', POOL.treeSap);
        put(k, x, h - 0.2, z, yaw, 0.8 + rng() * 0.3, true, 0.7);
      }
    }
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
  const HULL_LEN = 15;

  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const w = 3.4 * Math.sin(Math.PI * (0.18 + t * 0.72));
    const rib = box(0.32, 3.0, 0.46, 'planks', { pos: [0, 1.0, (t - 0.5) * HULL_LEN] });
    tint(rib, G(0x8b7048));
    opaque.push(rib);
    for (const side of [-1, 1]) {
      const p = box(0.28, 2.4, 0.4, 'planks', {
        pos: [side * w, 0.95 + rng() * 0.3, (t - 0.5) * HULL_LEN],
        rot: [0, 0, side * (0.35 + rng() * 0.2)],
      });
      tint(p, G(0x7d6440).multiplyScalar(0.85 + rng() * 0.35));
      opaque.push(p);
    }
  }
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const y = 0.5 + ((i / 2) | 0) * 0.5;
    const p = box(0.2, 0.46, HULL_LEN * (0.9 - i * 0.02), 'planks', {
      pos: [side * (2.8 - (i / 2) * 0.26), y, (rng() - .5) * 1.4],
      rot: [0, (rng() - .5) * 0.06, side * 0.3],
    });
    tint(p, G(0x8b7048).multiplyScalar(0.8 + rng() * 0.4));
    opaque.push(p);
  }
  const deck = box(5.0, 0.28, 9, 'planks', { pos: [0, 2.1, -1.6], rot: [0.06, 0, 0.04] });
  tint(deck, G(0x6f5a3a)); opaque.push(deck);

  const mast = cyl(0.24, 0.36, 7.5, 6, 'planks', { pos: [0, 5.0, -1.6], rot: [0.34, 0, 0.16] });
  tint(mast, G(0x7a6340)); opaque.push(mast);
  const spar = cyl(0.14, 0.17, 4.8, 5, 'planks', { pos: [-0.8, 7.4, -3.4], rot: [0, 0.3, Math.PI / 2] });
  tint(spar, G(0x7a6340)); opaque.push(spar);

  const sail = plane(4.6, 3.8, 'sail', { pos: [-0.8, 5.8, -3.2], rot: [0.2, 0.3, 0.1] });
  tint(sail, G(0xd8cdb2)); cutout.push(sail);

  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2, r = 5 + rng() * 6;
    const c = box(0.9, 0.9, 0.9, 'planks', {
      pos: [Math.cos(a) * r, 0.45, Math.sin(a) * r], rot: [(rng() - .5) * .3, rng() * 3, (rng() - .5) * .3],
    });
    tint(c, G(0x8b7048).multiplyScalar(0.8 + rng() * 0.4));
    opaque.push(c);
  }
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2, r = 6 + rng() * 5;
    const b = cyl(0.5, 0.6, 1.25, 8, 'planks', {
      pos: [Math.cos(a) * r, 0.6, Math.sin(a) * r], rot: [rng() > .5 ? Math.PI / 2 : 0, rng() * 3, 0],
    });
    tint(b, G(0x76603e)); opaque.push(b);
  }

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));
  group.add(new THREE.Mesh(mergeGeos(cutout), mats.cutoutStill));
  return group;
}

/** Campfire. Deliberately knee-high — it was towering over the player. */
export function buildCampfire(rng, mats) {
  const group = new THREE.Group();
  const opaque = [];
  /* A proper bonfire: this is where everyone spawns and where every
     council is held, so it has to read as a place from across the beach. */
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 1.35 + rng() * 0.18;
    const s = ico(0.26 + rng() * 0.14, 0, 'rock', {
      pos: [Math.cos(a) * r, 0.10, Math.sin(a) * r], rot: [rng(), rng(), rng()],
    });
    tint(s, G(0x8a8070).multiplyScalar(0.8 + rng() * 0.4));
    opaque.push(s);
  }
  // a teepee of driftwood
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.2;
    const l = cyl(0.11, 0.14, 1.9, 5, 'torchWood', {
      pos: [Math.cos(a) * 0.34, 0.62, Math.sin(a) * 0.34], rot: [0.86, a, 0],
    });
    tint(l, G(0x4a3524).multiplyScalar(0.85 + rng() * 0.4));
    opaque.push(l);
  }
  // and a couple of logs to sit on
  for (const [lx, lz, ry] of [[0, 2.4, 0], [2.3, -0.9, 1.9], [-2.2, -1.4, -2.2]]) {
    const log = cyl(0.28, 0.30, 2.6, 6, 'torchWood', { pos: [lx, 0.28, lz], rot: [0, ry, Math.PI / 2] });
    tint(log, G(0x6a5238)); opaque.push(log);
  }
  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));

  const flames = buildFlameCluster(mats, 7, 0.9);    // taller than a person's waist
  flames.position.y = 0.5;
  group.add(flames);
  group.userData.flames = flames;

  const light = new THREE.PointLight(0xff9a3c, 3.0, 26, 1.6);
  light.position.y = 1.4;
  group.add(light);
  group.userData.light = light;
  return group;
}

/** Reusable crossed-billboard flame. `scale` ≈ half the final height. */
export function buildFlameCluster(mats, count = 3, scale = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const q = plane(1.1 * scale, 1.7 * scale, 'flame');
    q.translate(0, 0.85 * scale, 0);
    place(q, { rot: [0, (i / count) * Math.PI, 0] });
    tint(q, G(0xffffff));
    const mesh = new THREE.Mesh(mergeGeos([q]), mats.emissive);
    mesh.userData.phase = i * 1.7;
    g.add(mesh);
  }
  g.userData.tick = (t) => {
    for (const m of g.children) {
      const p = m.userData.phase;
      const s = 0.82 + Math.sin(t * 9 + p) * 0.13 + Math.sin(t * 14.3 + p * 2) * 0.07;
      m.scale.set(0.9 + Math.sin(t * 11 + p) * 0.1, s, 1);
      m.position.y = Math.sin(t * 7 + p) * 0.04;
    }
  };
  return g;
}

/** Wall torch used in the temple. */
export function buildTorch(mats) {
  const group = new THREE.Group();
  const stick = cyl(0.06, 0.08, 0.9, 5, 'torchWood', { pos: [0, 0.45, 0], rot: [0.3, 0, 0] });
  tint(stick, G(0x4a3524));
  group.add(new THREE.Mesh(mergeGeos([stick]), mats.opaque));
  const f = buildFlameCluster(mats, 3, 0.34);
  f.position.set(0, 0.8, 0.14);
  group.add(f);
  group.userData.flames = f;
  const light = new THREE.PointLight(0xffa040, 1.9, 16, 1.7);
  light.position.set(0, 1.1, 0.15);
  group.add(light);
  group.userData.light = light;
  return group;
}

/* ===========================================================
   ROGUE PENDULUM
   ===========================================================
   Abandoned monolith towers left in the jungle by the Rogue
   Agents. A dark basalt shaft with a slot near the top, and a
   heavy brass bob swinging inside it — still swinging, which is
   the part nobody can explain.
*/
export const GLYPHS = ['SUN', 'MOON', 'EYE', 'SPIRAL'];

export function buildRoguePendulum(rng, mats, index, glyph, order) {
  const group = new THREE.Group();
  const opaque = [], cutout = [];
  const H = 13 + rng() * 3;

  /* A stepped plinth on a buried footing. The footing runs three metres
     below the plinth so that however the ground falls away around it,
     there is stone under the base rather than sky. */
  {
    const foot = box(4.6, 3.2, 4.6, 'templeStone', { pos: [0, -1.5, 0] });
    tint(foot, G(0x5a5648));
    opaque.push(foot);
  }
  for (let i = 0; i < 3; i++) {
    const w = 4.4 - i * 0.7;
    const s = box(w, 0.5, w, 'templeStone', { pos: [0, 0.25 + i * 0.5, 0] });
    tint(s, G(0x6f6a58).multiplyScalar(0.85 + rng() * 0.3));
    opaque.push(s);
  }

  // the shaft: tapered, faceted, very dark
  const shaft = cyl(0.85, 1.35, H, 6, 'monolith', { pos: [0, 1.5 + H / 2, 0] });
  taper(shaft, 0.82);
  tint(shaft, G(0x3a4048));
  opaque.push(shaft);

  // the slot the bob swings in
  const slotY = 1.5 + H * 0.72;
  for (const side of [-1, 1]) {
    const post = box(0.34, 3.4, 0.5, 'monolith', { pos: [side * 0.95, slotY, 0] });
    tint(post, G(0x323840)); opaque.push(post);
  }
  const lintel = box(2.5, 0.45, 0.8, 'monolith', { pos: [0, slotY + 1.8, 0] });
  tint(lintel, G(0x2c323a)); opaque.push(lintel);

  // capstone
  const cap = cone(1.5, 2.0, 6, 'monolith', { pos: [0, 1.5 + H + 0.7, 0] });
  tint(cap, G(0x2a3038)); opaque.push(cap);

  // glyph plate, front facing
  const plate = box(1.5, 1.5, 0.22, 'templeGlyph', { pos: [0, 4.6, 1.15] });
  tint(plate, G(0xbfae90)); opaque.push(plate);

  // vines reclaiming it
  for (let i = 0; i < 8; i++) {
    const a = rng() * Math.PI * 2;
    const vlen = 2.4 + rng() * 4;
    const v = plane(0.75, vlen, 'hangVine');
    v.translate(0, -vlen / 2, 0);
    place(v, { rot: [0, a, (rng() - .5) * 0.3], pos: [Math.cos(a) * 1.15, 2 + rng() * (H * 0.7), Math.sin(a) * 1.15] });
    tint(v, G(0xffffff).multiplyScalar(0.6 + rng() * 0.4));
    cutout.push(v);
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const b = plane(1.6, 1.3, 'leafBush', { pos: [Math.cos(a) * 2.1, 0.9, Math.sin(a) * 2.1], rot: [0, a, 0] });
    tint(b, G(0xffffff).multiplyScalar(0.6 + rng() * 0.4));
    cutout.push(b);
  }

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));
  group.add(new THREE.Mesh(mergeGeos(cutout), mats.cutoutStill));

  /* ---- the bob, on its own pivot so it can swing ---- */
  const pivot = new THREE.Group();
  pivot.position.set(0, slotY + 1.7, 0);
  group.add(pivot);

  const bobParts = [];
  const rod = cyl(0.05, 0.05, 3.0, 4, 'metal', { pos: [0, -1.5, 0] });
  tint(rod, G(0x8a8478)); bobParts.push(rod);
  const bob = ico(0.55, 0, 'gold', { pos: [0, -3.1, 0], scale: [1, 1.25, 1] });
  tint(bob, G(0xd9b45e)); bobParts.push(bob);
  const bobRing = new THREE.TorusGeometry(0.5, 0.08, 4, 10);
  applyCell(bobRing, 'gold');
  place(bobRing, { rot: [Math.PI / 2, 0, 0], pos: [0, -3.1, 0] });
  tint(bobRing, G(0xb08c3c)); bobParts.push(bobRing);
  pivot.add(new THREE.Mesh(mergeGeos(bobParts), mats.opaque));

  const glow = new THREE.PointLight(0x8fe6d0, 1.5, 16, 1.6);
  glow.position.set(0, slotY - 1.4, 0);
  group.add(glow);

  /* ---- activation ----
     The shockwave used to be a flat ring scaled up to nearly thirty metres
     across, lying at a fixed height. On any slope — and these all stand on
     slopes — a disc that size cuts straight through the hillside and comes
     apart as it grows, which is what made the whole thing look broken.

     A dome does not have that problem: it expands away from the base in
     every direction and the ground simply occludes its lower half, which
     is what a shockwave should do anyway. */
  const shockMat = new THREE.MeshBasicMaterial({
    color: 0x9ff0dc, transparent: true, opacity: 0, side: THREE.BackSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const shock = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    shockMat
  );
  shock.position.y = 0.6;
  group.add(shock);

  // a second, tighter one a beat behind it
  const shock2 = new THREE.Mesh(shock.geometry, shockMat.clone());
  shock2.position.y = 0.6;
  group.add(shock2);

  /* The beam. Faded out along its length with vertex alpha rather than
     running at full strength for a hundred and twenty metres, and it obeys
     the fog like everything else. */
  const beamGeo = new THREE.CylinderGeometry(0.9, 2.2, 90, 12, 6, true);
  {
    const pos2 = beamGeo.attributes.position;
    const cols = new Float32Array(pos2.count * 4);
    for (let i = 0; i < pos2.count; i++) {
      const k = THREE.MathUtils.clamp((pos2.getY(i) + 45) / 90, 0, 1);
      const a2 = Math.pow(1 - k, 1.6);
      cols[i * 4] = 0.62; cols[i * 4 + 1] = 0.94; cols[i * 4 + 2] = 0.86;
      cols[i * 4 + 3] = a2;
    }
    beamGeo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  }
  const beamMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, side: THREE.DoubleSide, vertexColors: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 45;
  group.add(beam);

  /* Motes: specks of light drawn up the shaft once it is awake. Built once
     as a single Points cloud and animated in place — nothing is created
     while the game is running. */
  const MOTES = 48;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = new Float32Array(MOTES * 3);       // radius, phase, speed
  for (let i = 0; i < MOTES; i++) {
    moteSeed[i * 3] = 0.9 + Math.random() * 2.6;
    moteSeed[i * 3 + 1] = Math.random() * 6.283;
    moteSeed[i * 3 + 2] = 0.55 + Math.random() * 0.9;
    motePos[i * 3 + 1] = Math.random() * 14;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xbdfff0, size: 0.22, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  group.add(motes);

  const phase = index * 1.3;
  let nightK = 0;
  let wake = 0;            // 0 dormant, 1 fully awake
  let wakeT = -1;          // seconds since activation began
  let jam = 0;             // Castaways: the bob is arrested and the lamp is red
  group.userData.setNight = (n) => { nightK = n; };
  group.userData.setJammed = (on) => { jam = on ? 1 : 0; };
  group.userData.activate = () => { if (wakeT < 0) wakeT = 0; };
  group.userData.wakeProgress = () => wake;

  group.userData.tick = (t, dt = 0.016) => {
    if (wakeT >= 0) { wakeT += dt; wake = Math.min(1, wakeT / 3.2); }

    /* Jammed: the bob stops dead at the top of its arc and judders there,
       and the lamp goes red. From across the island that reads as an alarm,
       which is the point — somebody has to run. */
    const speed = 0.85 + wake * 5.5;
    const swing = 0.55 + wake * 0.75;
    pivot.rotation.x = jam
      ? swing * 0.92 + Math.sin(t * 41) * 0.03
      : Math.sin(t * speed + phase) * swing;

    // the whole tower shudders during the wake
    const shudder = wake > 0 && wake < 1 ? (1 - Math.abs(wake - 0.5) * 2) * 0.10 : 0;
    group.rotation.z = Math.sin(t * 34) * (shudder + jam * 0.012);

    // a lantern in daylight, a lighthouse after dark, a flare when woken
    glow.intensity = jam
      ? 4.5 + Math.sin(t * 9) * 3.5
      : (1.1 + nightK * 3.2 + wake * 6.5) + Math.sin(t * 1.7 + phase) * (0.5 + nightK);
    glow.distance = 16 + nightK * 22 + wake * 20;
    glow.color.setHex(jam ? 0xff3020 : (wake > 0.1 ? 0xbdfff0 : 0x8fe6d0));

    /* Two domes, one chasing the other, both fading as they go. */
    if (wakeT >= 0 && wakeT < 2.8) {
      const k = Math.min(1, wakeT / 2.4);
      shock.scale.set(1 + k * 26, 1 + k * 15, 1 + k * 26);
      shockMat.opacity = 0.42 * Math.pow(1 - k, 1.4);
      const k2 = Math.max(0, Math.min(1, (wakeT - 0.35) / 2.4));
      shock2.scale.set(1 + k2 * 20, 1 + k2 * 11, 1 + k2 * 20);
      shock2.material.opacity = 0.26 * Math.pow(1 - k2, 1.4);
      shock2.visible = k2 > 0;
    } else {
      shockMat.opacity = 0;
      shock2.material.opacity = 0;
    }

    // the beam, breathing rather than blinking
    beamMat.opacity = wake * (0.30 + Math.sin(t * 2.4) * 0.07);
    beam.rotation.y = t * 0.4;

    /* The motes climb, spiral, and wrap round to the bottom. They only
       exist visually while the tower is awake, and the whole cloud is one
       buffer rewritten in place. */
    if (wake > 0.02) {
      moteMat.opacity = wake * (0.65 + Math.sin(t * 3.1) * 0.2);
      const arr = moteGeo.attributes.position.array;
      for (let i = 0; i < MOTES; i++) {
        const rr = moteSeed[i * 3], ph = moteSeed[i * 3 + 1], sp = moteSeed[i * 3 + 2];
        let y = (arr[i * 3 + 1] + dt * sp * (1.4 + wake * 2.6));
        if (y > 16) y -= 16;
        const a2 = ph + t * (0.5 + sp * 0.4) + y * 0.22;
        const shrink = 1 - Math.min(0.7, y / 22);
        arr[i * 3] = Math.cos(a2) * rr * shrink;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = Math.sin(a2) * rr * shrink;
      }
      moteGeo.attributes.position.needsUpdate = true;
    } else if (moteMat.opacity !== 0) {
      moteMat.opacity = 0;
    }
  };
  group.userData.glyph = glyph;
  group.userData.order = order;
  return group;
}

/* ===========================================================
   CASTAWAY CAMP — the ones who didn't make it
   =========================================================== */
export function buildCastawayCamp(rng, mats) {
  const group = new THREE.Group();
  const opaque = [], cutout = [];

  // lean-to shelter of driftwood and sailcloth
  for (const side of [-1, 1]) {
    const leg = cyl(0.09, 0.11, 1.9, 5, 'driftwood', { pos: [side * 1.5, 0.95, -0.9], rot: [0, 0, side * 0.12] });
    tint(leg, G(0xc4b494)); opaque.push(leg);
  }
  const ridge = cyl(0.09, 0.09, 3.3, 5, 'driftwood', { pos: [0, 1.85, -0.9], rot: [0, 0, Math.PI / 2] });
  tint(ridge, G(0xc4b494)); opaque.push(ridge);
  for (let i = 0; i < 6; i++) {
    const rafter = cyl(0.055, 0.07, 2.3, 4, 'driftwood', {
      pos: [-1.3 + i * 0.52, 1.15, -0.05], rot: [0.85, 0, 0],
    });
    tint(rafter, G(0xbcae8e)); opaque.push(rafter);
  }
  const canvasSheet = plane(3.2, 2.3, 'sail', { pos: [0, 1.2, 0.05], rot: [-0.72, 0, 0] });
  tint(canvasSheet, G(0xcfc2a4)); cutout.push(canvasSheet);

  // dead fire
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = ico(0.14 + rng() * 0.07, 0, 'rock', { pos: [1.9 + Math.cos(a) * 0.5, 0.06, 1.4 + Math.sin(a) * 0.5] });
    tint(s, G(0x7a7266)); opaque.push(s);
  }
  for (let i = 0; i < 5; i++) {
    const l = cyl(0.05, 0.07, 0.5, 4, 'torchWood', {
      pos: [1.9 + (rng() - .5) * 0.5, 0.06, 1.4 + (rng() - .5) * 0.5], rot: [Math.PI / 2, rng() * 3, 0],
    });
    tint(l, G(0x2e2318)); opaque.push(l);
  }

  // tally marks and scattered bones
  const tally = box(0.9, 1.1, 0.1, 'runes', { pos: [-1.9, 0.6, 0.4], rot: [0, 0.4, 0.06] });
  tint(tally, G(0xbfae90)); opaque.push(tally);

  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, r = 1.5 + rng() * 3;
    const bone = cyl(0.05, 0.06, 0.3 + rng() * 0.35, 4, 'bone', {
      pos: [Math.cos(a) * r, 0.06, Math.sin(a) * r],
      rot: [Math.PI / 2, rng() * 3, (rng() - .5) * 0.6],
    });
    tint(bone, G(0xd8cdb4)); opaque.push(bone);
  }
  // a skull, quietly
  const skull = ico(0.19, 0, 'bone', { pos: [-0.6, 0.16, 1.5], scale: [1, 0.9, 1.15] });
  tint(skull, G(0xd8cdb4)); opaque.push(skull);

  // a couple of stuck-upright oars marking the spot
  for (let i = 0; i < 2; i++) {
    const oar = cyl(0.06, 0.08, 2.2, 5, 'driftwood', {
      pos: [-2.6 - i * 0.6, 1.1, -1.6 + i * 0.5], rot: [0.1, 0, 0.14 - i * 0.3],
    });
    tint(oar, G(0xc4b494)); opaque.push(oar);
    const blade = box(0.32, 0.7, 0.06, 'driftwood', { pos: [-2.6 - i * 0.6 + 0.15, 2.3, -1.6 + i * 0.5], rot: [0.1, 0, 0.14 - i * 0.3] });
    tint(blade, G(0xc4b494)); opaque.push(blade);
  }

  group.add(new THREE.Mesh(mergeGeos(opaque), mats.opaque));
  group.add(new THREE.Mesh(mergeGeos(cutout), mats.cutoutStill));
  return group;
}

/** A word dragged into the sand, lying flat as a ground decal. */
export function buildSandWriting(text, mats, opts = {}) {
  const w = opts.width ?? 16;
  const h = opts.height ?? 5;
  // fine enough to actually follow a beach that is not flat
  const geo = new THREE.PlaneGeometry(w, h, 20, 8);
  geo.rotateX(-Math.PI / 2);
  const mat = mats.decal.clone();
  mat.map = buildSandWritingTexture(text, opts);
  mat.alphaTest = 0.28;
  mat.transparent = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  /* Drape over the terrain so it doesn't float or sink on a slope.
     The vertices are in the mesh's own space, so the yaw has to be applied
     before sampling — sampling the unrotated axis was why the letters
     ploughed into the ground at one end and floated at the other. */
  mesh.userData.drape = (groundAt, ox, oz) => {
    const p = geo.attributes.position;
    const c = Math.cos(mesh.rotation.y), sn = Math.sin(mesh.rotation.y);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), lz = p.getZ(i);
      const wx = ox + lx * c + lz * sn;
      const wz = oz - lx * sn + lz * c;
      p.setY(i, groundAt(wx, wz) + 0.09 - mesh.position.y);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };
  return mesh;
}

/* ===========================================================
   WILDLIFE
   =========================================================== */

/** Parrots that wheel over the canopy. Purely decorative. */
export function buildBirdFlock(rng, mats, count = 22) {
  const group = new THREE.Group();

  const bodyG = [];
  const body = ico(0.22, 0, 'bird', { scale: [1.6, 0.85, 0.85] });
  tint(body, G(0xffffff)); bodyG.push(body);
  const tail = box(0.1, 0.05, 0.5, 'bird', { pos: [-0.42, 0, 0], rot: [0, Math.PI / 2, 0] });
  tint(tail, G(0xe8e0d0)); bodyG.push(tail);
  const beak = cone(0.07, 0.16, 4, 'bun', { pos: [0.34, 0, 0], rot: [0, 0, -Math.PI / 2] });
  tint(beak, G(0xe0c060)); bodyG.push(beak);
  const bodyGeo = mergeGeos(bodyG);

  const wingGeo = mergeGeos([tint(plane(0.62, 0.34, 'birdWing', { rot: [-Math.PI / 2, 0, 0] }), G(0xffffff))]);

  const birds = [];
  for (let i = 0; i < count; i++) {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(bodyGeo, mats.opaque));
    const wl = new THREE.Mesh(wingGeo, mats.cutoutStill);
    const wr = new THREE.Mesh(wingGeo, mats.cutoutStill);
    wl.position.set(0, 0.05, -0.16); wr.position.set(0, 0.05, 0.16);
    b.add(wl); b.add(wr);
    group.add(b);
    birds.push({
      mesh: b, wl, wr,
      cx: (rng() - 0.5) * 220, cz: (rng() - 0.5) * 220,
      rad: 14 + rng() * 42,
      y: 26 + rng() * 30,
      sp: 0.18 + rng() * 0.28,
      ph: rng() * Math.PI * 2,
      flap: 6 + rng() * 5,
      bob: rng() * 6,
    });
  }

  group.userData.tick = (t) => {
    for (const b of birds) {
      const a = b.ph + t * b.sp;
      const x = b.cx + Math.cos(a) * b.rad;
      const z = b.cz + Math.sin(a) * b.rad;
      b.mesh.position.set(x, b.y + Math.sin(t * 0.6 + b.bob) * 2.2, z);
      // face along the tangent of the circle
      b.mesh.rotation.y = -a + Math.PI / 2;
      b.mesh.rotation.z = 0.32;
      const f = Math.sin(t * b.flap + b.ph);
      b.wl.rotation.x = f * 0.9;
      b.wr.rotation.x = -f * 0.9;
    }
  };
  group.frustumCulled = false;
  return group;
}

/**
 * Beetles and butterflies that only exist near the player — a small pool
 * recycled to wherever you are, so the whole island feels alive for the
 * cost of a couple of dozen quads.
 */
export function buildCritters(rng, mats, groundAt, count = 26) {
  const group = new THREE.Group();

  const beetleGeo = mergeGeos([
    tint(ico(0.07, 0, 'bug', { scale: [1.5, 0.7, 1] }), G(0xffffff)),
  ]);
  const flyGeo = mergeGeos([
    tint(plane(0.22, 0.16, 'flower', { rot: [0, 0, 0] }), G(0xffffff)),
  ]);

  const items = [];
  for (let i = 0; i < count; i++) {
    const isFly = i % 3 === 0;
    const mesh = new THREE.Mesh(isFly ? flyGeo : beetleGeo,
      isFly ? mats.cutoutStill : mats.opaque);
    group.add(mesh);
    items.push({
      mesh, isFly,
      ang: rng() * Math.PI * 2,
      rad: 3 + rng() * 12,
      sp: (rng() - 0.5) * 1.6,
      ph: rng() * 6,
      h: isFly ? 0.5 + rng() * 1.1 : 0.05,
      home: new THREE.Vector3(),
      placed: false,
    });
  }

  const tmp = new THREE.Vector3();
  group.userData.tick = (t, dt, playerPos) => {
    if (!playerPos) return;
    for (const it of items) {
      // recycle anything the player has walked away from
      const d2 = it.home.distanceToSquared(playerPos);
      if (!it.placed || d2 > 26 * 26) {
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 14;
        it.home.set(playerPos.x + Math.cos(a) * r, 0, playerPos.z + Math.sin(a) * r);
        it.home.y = groundAt(it.home.x, it.home.z);
        it.placed = true;
        it.mesh.visible = it.home.y > 0.4;   // nothing crawls on the sea
      }
      it.ang += it.sp * dt;
      const wob = it.isFly
        ? Math.sin(t * 3 + it.ph) * 0.5
        : Math.sin(t * 1.4 + it.ph) * 0.25;
      tmp.set(
        it.home.x + Math.cos(it.ang) * (it.isFly ? 1.4 : 0.5) + wob,
        it.home.y + it.h + (it.isFly ? Math.sin(t * 4 + it.ph) * 0.28 : 0),
        it.home.z + Math.sin(it.ang) * (it.isFly ? 1.4 : 0.5)
      );
      it.mesh.position.copy(tmp);
      it.mesh.rotation.y = -it.ang;
      if (it.isFly) it.mesh.rotation.z = Math.sin(t * 9 + it.ph) * 0.7;
    }
  };
  group.frustumCulled = false;
  return group;
}

/* ===========================================================
   Pickups
   =========================================================== */
export function buildCoconutPile(rng, mats) {
  const parts = [];
  const n = 4 + ((rng() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.55;
    const g = ico(0.27, 0, 'coconut', {
      pos: [Math.cos(a) * r, 0.24 + rng() * 0.22, Math.sin(a) * r], rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(g, G(0x9c7c50).multiplyScalar(0.85 + rng() * 0.3));
    parts.push(g);
  }
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeos(parts), mats.opaque));
  return group;
}

export function buildCoconutMesh(mats) {
  const g = ico(0.26, 0, 'coconut');
  tint(g, G(0xa07f52));
  return new THREE.Mesh(mergeGeos([g]), mats.opaque);
}

/** The Rogue Agents' satchel — holds the chart. */
export function buildSatchel(rng, mats) {
  const group = new THREE.Group();
  const P = [];
  const bag = box(0.6, 0.44, 0.24, 'clothTat', { pos: [0, 0.22, 0], rot: [0, 0.3, 0.06] });
  tint(bag, G(0x6a5f47)); P.push(bag);
  const flap = box(0.62, 0.24, 0.06, 'clothTat', { pos: [0, 0.36, 0.14], rot: [0.35, 0.3, 0.06] });
  tint(flap, G(0x574d3a)); P.push(flap);
  const strap = box(0.1, 0.5, 0.06, 'rope', { pos: [0.2, 0.3, -0.1], rot: [0, 0.3, 0.5] });
  tint(strap, G(0x8a7a58)); P.push(strap);
  const roll = cyl(0.07, 0.07, 0.42, 6, 'paper', { pos: [-0.1, 0.5, 0.02], rot: [0, 0.3, Math.PI / 2] });
  tint(roll, G(0xe4d6b0)); P.push(roll);
  group.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  const l = new THREE.PointLight(0xffe6a0, 1.1, 6, 2);
  l.position.set(0, 0.7, 0);
  group.add(l);
  group.userData.tick = (t) => { l.intensity = 0.8 + Math.sin(t * 3) * 0.4; };
  return group;
}
