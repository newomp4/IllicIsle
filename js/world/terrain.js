/* ===========================================================
   terrain.js — Isla Dorada itself.
   The island is one analytic height function, so collision is a
   direct evaluation instead of a raycast. Cheap and exact.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import { buildDetailTexture, buildWaterTexture, buildSkyTexture } from '../lib/textures.js';

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

/* ---------- island constants (also used for placement) ---------- */
export const SEA_LEVEL = 0;
export const ISLAND = {
  /* The coastline sits at `shore` units from the origin, wobbled by noise.
     From there inward: `beachWidth` of gentle sand, then the jungle ramps
     up between `jungleFrom` and `jungleTo`. Keeping these as an explicit
     radial profile is what gives us a real, walkable beach instead of a
     cliff straight into the sea. */
  shore: 112,
  beachWidth: 20,
  jungleFrom: 18,
  jungleTo: 58,
  playRadius: 122,
  worldRadius: 190,
  mount: { x: 4, z: -70, r: 34, h: 46 },
  lagoon: { x: 74, z: 34, r: 22, d: 13 },
};

/** The one true height function. */
export function heightAt(x, z) {
  const warp = fbm(x * 0.0072 + 31.7, z * 0.0072 - 12.3, 3);
  const d = Math.sqrt(x * x + z * z) + (warp - 0.5) * 44;
  const S = ISLAND.shore;

  // 0 at the waterline, 1 once you're up the sand
  const beach = 1 - THREE.MathUtils.smoothstep(d, S - ISLAND.beachWidth, S);
  // 0 across the whole beach, 1 well inland
  const inland = 1 - THREE.MathUtils.smoothstep(d, S - ISLAND.jungleTo, S - ISLAND.jungleFrom);

  const n = fbm(x * 0.0135, z * 0.0135, 4);
  const ridge = 1 - Math.abs(fbm(x * 0.021 + 5, z * 0.021 + 9, 3) * 2 - 1);

  let h = beach * 2.6 + inland * (2 + n * n * 1.3 * 20 + ridge * ridge * 7);

  // the northern mount, with a blown-out crater at its top
  const M = ISLAND.mount;
  const md2 = (x - M.x) ** 2 + (z - M.z) ** 2;
  const mountMask = 1 - THREE.MathUtils.smoothstep(d, S - 34, S - 4);
  h += M.h * Math.exp(-md2 / (2 * M.r * M.r)) * mountMask;
  h -= 16 * Math.exp(-md2 / (2 * 13 * 13)) * mountMask;

  // lagoon bowl on the east shore
  const L = ISLAND.lagoon;
  const ld2 = (x - L.x) ** 2 + (z - L.z) ** 2;
  h -= L.d * Math.exp(-ld2 / (2 * L.r * L.r));

  // seabed falls away outside the coast
  h -= Math.max(0, d - S) * 0.62;

  return Math.max(h, -22);
}

/** Walk outward along a bearing to find the sand. Used to beach the wreck. */
export function findBeach(angle, targetH = 1.3) {
  let best = { x: 0, z: 0, y: 0 }, bestErr = Infinity;
  for (let r = 60; r < 150; r += 0.6) {
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    const h = heightAt(x, z);
    const err = Math.abs(h - targetH);
    if (err < bestErr) { bestErr = err; best = { x, y: h, z }; }
    if (h < -3) break;
  }
  return best;
}

export function normalAt(x, z, e = 0.9) {
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
}

export function slopeAt(x, z) { return 1 - normalAt(x, z).y; }

/** Rough biome id used for prop scattering and footstep sounds. */
export function biomeAt(x, z) {
  const h = heightAt(x, z);
  if (h < 0.15) return 'water';
  if (h < 2.6) return 'sand';
  const s = slopeAt(x, z);
  if (h > 26 || s > 0.42) return 'rock';
  return 'jungle';
}

/* ===========================================================
   Terrain mesh
   =========================================================== */
const C = {
  sandLo: new THREE.Color(0xd9c184),
  sandHi: new THREE.Color(0xefe0b4),
  grassLo: new THREE.Color(0x3f6b2a),
  grassHi: new THREE.Color(0x5d8a34),
  jungle: new THREE.Color(0x2c5222),
  rock: new THREE.Color(0x6d6152),
  rockDark: new THREE.Color(0x4a4038),
  // "a black mouth in the red cliff" — the summit needs to read red
  volcanic: new THREE.Color(0x8a3b26),
  seabed: new THREE.Color(0x8a7a52),
};

export function buildTerrain(atlas) {
  const SIZE = 400;
  const SEG = 148;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.pos ?? geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);

    const slope = slopeAt(x, z);
    const noise = fbm(x * 0.09, z * 0.09, 2);

    if (h < -1.2) {
      col.copy(C.seabed).lerp(C.sandLo, THREE.MathUtils.clamp((h + 8) / 7, 0, 1));
      col.multiplyScalar(0.62);
    } else if (h < 2.4) {
      col.copy(C.sandLo).lerp(C.sandHi, noise);
    } else if (h < 4.6) {
      tmp.copy(C.grassLo).lerp(C.grassHi, noise);
      col.copy(C.sandHi).lerp(tmp, THREE.MathUtils.smoothstep(h, 2.4, 4.6));
    } else if (h > 24 || slope > 0.4) {
      col.copy(C.rock).lerp(C.rockDark, noise);
      if (h > 22) col.lerp(C.volcanic, THREE.MathUtils.clamp((h - 22) / 12, 0, 1));
    } else {
      col.copy(C.grassLo).lerp(C.jungle, noise);
      if (slope > 0.26) col.lerp(C.rock, THREE.MathUtils.smoothstep(slope, 0.26, 0.42));
    }

    // fake AO in the valleys so the jungle floor reads as shaded
    const ao = 0.78 + 0.22 * THREE.MathUtils.clamp(h / 18, 0, 1);
    col.multiplyScalar(h > 2.4 ? ao : 1);

    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const detail = buildDetailTexture();
  detail.repeat.set(70, 70);

  const mat = ps1ify(new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
  }), { flat: false }); // smooth normals; the colours carry the facets

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

/* ===========================================================
   Ocean — animated low-poly plane
   =========================================================== */
export function buildOcean() {
  const geo = new THREE.PlaneGeometry(900, 900, 60, 60);
  geo.rotateX(-Math.PI / 2);
  const tex = buildWaterTexture();
  tex.repeat.set(60, 60);

  const mat = ps1ify(new THREE.MeshLambertMaterial({
    map: tex,
    color: 0x9fd8e8,
    transparent: true,
    opacity: 0.82,
    depthWrite: true,
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
        Math.sin(x * 0.05 + t * 1.1) * 0.42 +
        Math.sin(z * 0.037 - t * 0.83) * 0.36 +
        Math.sin((x + z) * 0.021 + t * 0.5) * 0.3
      );
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    tex.offset.x = t * 0.011;
    tex.offset.y = t * 0.008;
  };
  return mesh;
}

/* Foam ring drawn just above the waterline around the coast. */
export function buildFoam() {
  const RINGS = 2;
  const group = new THREE.Group();
  for (let r = 0; r < RINGS; r++) {
    const SEGS = 200;
    const pts = [];
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      // march outward until we cross the waterline
      let rad = 60;
      for (let s = 0; s < 200; s++) {
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (heightAt(x, z) < 0.25 - r * 0.5) break;
        rad += 0.9;
      }
      pts.push(new THREE.Vector3(Math.cos(a) * rad, 0.16 + r * 0.03, Math.sin(a) * rad));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: r === 0 ? 0xffffff : 0xcfeaf5,
      transparent: true,
      opacity: r === 0 ? 0.75 : 0.4,
    }));
    line.userData.phase = r;
    group.add(line);
  }
  group.userData.tick = (t) => {
    group.children.forEach((l, i) => {
      l.position.y = Math.sin(t * 1.6 + i) * 0.14;
      l.material.opacity = (i === 0 ? 0.62 : 0.32) + Math.sin(t * 2.1 + i * 2) * 0.16;
    });
  };
  return group;
}

/* ===========================================================
   Sky
   =========================================================== */
export function buildSky(top, mid, bot) {
  /* Radius must stay INSIDE the camera's far plane (460) or the whole dome
     is clipped away and you just see the flat scene.background — which the
     CRT vignette then turns into a pale disc in the middle of the screen.
     Enough segments, too, so the gradient doesn't band. */
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
  for (let i = 0; i < 16; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + ((rng() * 3) | 0);
    for (let p = 0; p < puffs; p++) {
      const g = new THREE.IcosahedronGeometry(9 + rng() * 12, 0);
      const m = new THREE.Mesh(g, mat);
      m.position.set((p - puffs / 2) * (12 + rng() * 8), rng() * 5, rng() * 8 - 4);
      m.scale.set(1.5 + rng(), 0.55, 1);
      cloud.add(m);
    }
    const a = rng() * Math.PI * 2;
    const rad = 150 + rng() * 260;
    cloud.position.set(Math.cos(a) * rad, 105 + rng() * 65, Math.sin(a) * rad);
    cloud.userData.speed = 0.55 + rng() * 0.9;
    group.add(cloud);
  }
  group.userData.tick = (t, dt) => {
    for (const c of group.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 470) c.position.x = -470;
    }
  };
  group.frustumCulled = false;
  return group;
}
