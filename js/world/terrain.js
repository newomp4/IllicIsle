/* ===========================================================
   terrain.js — Illic Isle itself.
   The island is one analytic height function, so collision is a
   direct evaluation instead of a raycast. Cheap and exact.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import { buildDetailTexture, buildWaterTexture, buildSkyTexture, buildFoamTexture } from '../lib/textures.js';

/* ---------- value noise ---------- */
function hash2(ix, iy) {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}
function smooth(t) { return t * t * (3 - 2 * t); }

function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function fbm(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

/* ---------- island constants ---------- */
export const SEA_LEVEL = 0;
export const ISLAND = {
  /* Radial profile: coastline at `shore`, then `beachWidth` of sand, then
     the jungle ramps up between `jungleFrom` and `jungleTo`. A big island
     with a proportionally thin beach — you should be in trees almost
     immediately after leaving the wreck. */
  shore: 168,
  beachWidth: 42,
  jungleFrom: 40,
  jungleTo: 104,
  playRadius: 178,
  worldRadius: 260,

  /* The high jungle ridge the temple is buried in. No volcano — this is
     overgrown limestone, green all the way up. */
  ridge: { x: 6, z: -96, r: 52, h: 40 },
  /* A second, lower shoulder so the interior isn't one dome */
  knoll: { x: -86, z: -34, r: 38, h: 20 },
  lagoon: { x: 108, z: 44, r: 30, d: 14 },
};

/**
 * Ground the builders cut away.
 *
 * The temple is a flat-backed facade with terraces climbing behind it,
 * dropped onto a mountainside — so the mountain used to come straight
 * through the masonry. Rather than fight it in geometry, the hill itself
 * is excavated: an oriented ellipse levelled to the doorway's height,
 * blending back to the natural slope at its rim. Because it lives inside
 * heightAt, the mesh, the collision and every prop placed afterwards all
 * agree about where the ground now is.
 */
let CARVES = [];

/** @param {Array<{x,z,y,rx,rz,yaw}>} list  set before the terrain is built. */
export function setCarves(list) {
  CARVES = (list || []).map((c) => ({
    ...c, cos: Math.cos(c.yaw || 0), sin: Math.sin(c.yaw || 0),
  }));
}

/** The one true height function. */
export function heightAt(x, z) {
  const warp = fbm(x * 0.0050 + 31.7, z * 0.0050 - 12.3, 3);
  const d = Math.sqrt(x * x + z * z) + (warp - 0.5) * 62;
  const S = ISLAND.shore;

  // 0 at the waterline, 1 once you're up the sand
  const beach = 1 - THREE.MathUtils.smoothstep(d, S - ISLAND.beachWidth, S);
  // 0 across the whole beach, 1 well inland
  const inland = 1 - THREE.MathUtils.smoothstep(d, S - ISLAND.jungleTo, S - ISLAND.jungleFrom);

  const n = fbm(x * 0.0102, z * 0.0102, 4);
  const ridgeN = 1 - Math.abs(fbm(x * 0.016 + 5, z * 0.016 + 9, 3) * 2 - 1);

  let h = beach * 2.8 + inland * (2 + n * n * 1.35 * 22 + ridgeN * ridgeN * 9);

  // rolling hills so the interior reads as varied jungle, not a plate
  h += inland * fbm(x * 0.028 + 71, z * 0.028 - 19, 3) * 7;

  const coastMask = 1 - THREE.MathUtils.smoothstep(d, S - 46, S - 8);

  // the temple ridge
  const R = ISLAND.ridge;
  const rd2 = (x - R.x) ** 2 + (z - R.z) ** 2;
  h += R.h * Math.exp(-rd2 / (2 * R.r * R.r)) * coastMask;

  // a lower shoulder to the west
  const K = ISLAND.knoll;
  const kd2 = (x - K.x) ** 2 + (z - K.z) ** 2;
  h += K.h * Math.exp(-kd2 / (2 * K.r * K.r)) * coastMask;

  // lagoon bowl on the east shore
  const L = ISLAND.lagoon;
  const ld2 = (x - L.x) ** 2 + (z - L.z) ** 2;
  h -= L.d * Math.exp(-ld2 / (2 * L.r * L.r));

  // seabed falls away outside the coast
  h -= Math.max(0, d - S) * 0.55;

  for (let i = 0; i < CARVES.length; i++) {
    const c = CARVES[i];
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const q = Math.hypot(lx / c.rx, lz / c.rz);
    if (q >= 1.45) continue;
    const k = 1 - THREE.MathUtils.smoothstep(q, 0.70, 1.45);
    h = THREE.MathUtils.lerp(h, c.y, k);
  }

  return Math.max(h, -24);
}

export function normalAt(x, z, e = 0.9) {
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
}

export function slopeAt(x, z) { return 1 - normalAt(x, z).y; }

/**
 * How thick the vegetation should be here, 0..1.
 * Uniform scatter makes every part of the jungle look identical and
 * impossible to navigate. This gives real clearings, thickets, and
 * open glades you can recognise and steer by.
 */
export function vegetationDensity(x, z) {
  const big = fbm(x * 0.0065 + 401, z * 0.0065 - 233, 3);     // regions
  const fine = fbm(x * 0.021 - 77, z * 0.021 + 55, 2);        // local breakup
  let d = THREE.MathUtils.smoothstep(big, 0.32, 0.72);
  d = d * 0.78 + fine * 0.32;
  // hard clearings where the big noise bottoms out
  if (big < 0.30) d *= 0.18;
  return THREE.MathUtils.clamp(d, 0, 1.25);
}

/** Rough biome id used for prop scattering and footstep sounds. */
export function biomeAt(x, z) {
  const h = heightAt(x, z);
  if (h < 0.15) return 'water';
  if (h < 2.5) return 'sand';
  const s = slopeAt(x, z);
  if (h > 34 || s > 0.44) return 'rock';
  return 'jungle';
}

/** Walk outward along a bearing to find the sand. Used to beach the wreck. */
export function findBeach(angle, targetH = 1.3) {
  let best = { x: 0, z: 0, y: 0 }, bestErr = Infinity;
  for (let r = 90; r < 230; r += 0.6) {
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const h = heightAt(x, z);
    const err = Math.abs(h - targetH);
    if (err < bestErr) { bestErr = err; best = { x, y: h, z }; }
    if (h < -3) break;
  }
  return best;
}

/* ===========================================================
   Terrain mesh
   =========================================================== */
const C = {
  sandLo: new THREE.Color(0xd6bd80),
  sandHi: new THREE.Color(0xeddfb2),
  sandWet: new THREE.Color(0xa89066),
  grassLo: new THREE.Color(0x3a6626),
  grassHi: new THREE.Color(0x54802e),
  jungle: new THREE.Color(0x24491d),
  jungleDeep: new THREE.Color(0x18361a),
  rock: new THREE.Color(0x6d6152),
  rockMoss: new THREE.Color(0x4e5c36),
  seabed: new THREE.Color(0x8a7a52),
};

export function buildTerrain(atlas) {
  const SIZE = 560;
  const SEG = 200;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    const slope = slopeAt(x, z);
    const noise = fbm(x * 0.09, z * 0.09, 2);
    const patch = fbm(x * 0.021 + 300, z * 0.021 - 120, 2);

    if (h < -1.0) {
      col.copy(C.seabed).lerp(C.sandLo, THREE.MathUtils.clamp((h + 8) / 7, 0, 1));
      col.multiplyScalar(0.6);
    } else if (h < 0.7) {
      // wet sand at the waterline
      col.copy(C.sandWet).lerp(C.sandLo, THREE.MathUtils.clamp(h / 0.7, 0, 1));
    } else if (h < 2.3) {
      col.copy(C.sandLo).lerp(C.sandHi, noise);
    } else if (h < 4.6) {
      tmp.copy(C.grassLo).lerp(C.grassHi, noise);
      col.copy(C.sandHi).lerp(tmp, THREE.MathUtils.smoothstep(h, 2.3, 4.6));
    } else if (h > 32 || slope > 0.42) {
      col.copy(C.rock).lerp(C.rockMoss, patch);
    } else {
      // jungle floor: deep, mottled green
      col.copy(C.jungle).lerp(C.jungleDeep, noise);
      col.lerp(C.grassLo, patch * 0.45);
      if (slope > 0.28) col.lerp(C.rock, THREE.MathUtils.smoothstep(slope, 0.28, 0.44));
    }

    // canopy shade — the jungle floor should read dark
    if (h > 3.2) {
      const shade = 0.62 + 0.30 * patch + 0.10 * THREE.MathUtils.clamp(h / 40, 0, 1);
      col.multiplyScalar(shade);
    }

    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const detail = buildDetailTexture();
  detail.repeat.set(96, 96);

  const mat = ps1ify(new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
  }), { flat: false });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.frustumCulled = false;
  return mesh;
}

/* ===========================================================
   Ocean — animated low-poly plane
   =========================================================== */
export function buildOcean() {
  const geo = new THREE.PlaneGeometry(1200, 1200, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const tex = buildWaterTexture();
  tex.repeat.set(70, 70);

  const mat = ps1ify(new THREE.MeshLambertMaterial({
    map: tex,
    color: 0x9fd8e8,
    transparent: true,
    opacity: 0.84,
  }), { flat: true });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.name = 'ocean';

  const base = geo.attributes.position.array.slice();
  mesh.userData.tick = (t) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      p.setY(i,
        Math.sin(x * 0.045 + t * 1.0) * 0.45 +
        Math.sin(z * 0.033 - t * 0.78) * 0.38 +
        Math.sin((x + z) * 0.019 + t * 0.46) * 0.32
      );
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    tex.offset.x = t * 0.010;
    tex.offset.y = t * 0.007;
  };
  return mesh;
}

/* ===========================================================
   SURF — foam that actually runs up the sand and drains back
   ===========================================================
   Three concentric bands sampled along the real coastline. Each
   band sweeps between its low-tide and high-tide radius on its own
   phase, so the waterline is never a static ring.
*/
export function buildSurf() {
  const SEGS = 260;
  const BANDS = 3;
  const group = new THREE.Group();
  const tex = buildFoamTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 1);

  // Sample the shoreline once: for each bearing, find the radius where the
  // land crosses a few reference heights.
  const rings = [];
  for (let s = 0; s <= SEGS; s++) {
    const a = (s / SEGS) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    let rLow = 150, rHigh = 150;
    // waterline (h = 0)
    for (let r = 250; r > 60; r -= 1.0) {
      if (heightAt(cos * r, sin * r) > 0) { rLow = r; break; }
    }
    // run-up limit (h = 1.5, a bit up the sand)
    for (let r = rLow; r > 60; r -= 1.0) {
      if (heightAt(cos * r, sin * r) > 1.5) { rHigh = r; break; }
    }
    rings.push({ a, cos, sin, rLow, rHigh: Math.min(rHigh, rLow - 1) });
  }

  const meshes = [];
  for (let b = 0; b < BANDS; b++) {
    const geo = new THREE.PlaneGeometry(1, 1, SEGS, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.7,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
      color: b === 0 ? 0xffffff : 0xd8f0fa,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 3;
    group.add(m);
    meshes.push({
      mesh: m, geo, mat, index: b,
      phase: b * (Math.PI * 2 / BANDS),
      width: 5 + b * 3,
      y: 0.10 + b * 0.02,
    });
  }

  group.userData.tick = (t) => {
    for (const band of meshes) {
      const p = band.geo.attributes.position;
      // 0 = fully drained, 1 = fully run up
      const k = 0.5 + 0.5 * Math.sin(t * 0.55 + band.phase);
      const ease = k * k * (3 - 2 * k);
      band.mat.opacity = (0.30 + 0.45 * Math.sin(t * 0.55 + band.phase + 1.1)) * 0.9;

      for (let s = 0; s <= SEGS; s++) {
        const R = rings[s];
        // a little per-bearing variation so the foam edge isn't a clean circle
        const wob = Math.sin(R.a * 7 + t * 1.3) * 1.6 + Math.sin(R.a * 13 - t * 0.9) * 0.9;
        const r = THREE.MathUtils.lerp(R.rLow + 2, R.rHigh, ease) + wob;
        const rIn = r - band.width;
        // vertex row 0 = outer edge, row 1 = inner edge
        p.setXYZ(s, R.cos * r, band.y, R.sin * r);
        p.setXYZ(SEGS + 1 + s, R.cos * rIn, band.y, R.sin * rIn);
      }
      p.needsUpdate = true;
    }
    tex.offset.x = t * 0.05;
  };

  return group;
}

/* ===========================================================
   Sky
   =========================================================== */
export function buildSky(top, mid, bot) {
  /* Radius must stay INSIDE the camera's far plane or the whole dome is
     clipped away and you just see the flat scene.background — which the
     CRT vignette then turns into a pale disc in the middle of the screen. */
  const geo = new THREE.SphereGeometry(400, 32, 20);
  const mat = new THREE.MeshBasicMaterial({
    map: buildSkyTexture(top, mid, bot),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/* Chunky low-poly clouds that drift. */
export function buildClouds(rng) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf4f0e4, fog: false, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 18; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + ((rng() * 3) | 0);
    for (let p = 0; p < puffs; p++) {
      const g = new THREE.IcosahedronGeometry(10 + rng() * 14, 0);
      const m = new THREE.Mesh(g, mat);
      m.position.set((p - puffs / 2) * (14 + rng() * 9), rng() * 5, rng() * 8 - 4);
      m.scale.set(1.6 + rng(), 0.5, 1);
      cloud.add(m);
    }
    const a = rng() * Math.PI * 2;
    const rad = 180 + rng() * 180;
    cloud.position.set(Math.cos(a) * rad, 120 + rng() * 70, Math.sin(a) * rad);
    cloud.userData.speed = 0.5 + rng() * 0.8;
    group.add(cloud);
  }
  group.userData.tick = (t, dt, night = 0) => {
    for (const c of group.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 380) c.position.x = -380;
    }
    // white cumulus at midnight looks like a bug; take them down with the sky
    const k = 1 - night * 0.86;
    mat.color.setRGB(0.957 * k, 0.941 * k, 0.894 * k + night * 0.06);
    mat.opacity = 0.85 - night * 0.35;
  };
  group.frustumCulled = false;
  return group;
}
