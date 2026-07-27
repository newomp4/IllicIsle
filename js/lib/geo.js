/* ===========================================================
   geo.js — geometry plumbing.
   Everything in the world is built from a handful of primitives
   that get atlas UVs stamped on them and then merged down into
   one buffer per prop, so a whole palm tree is a single draw.
   =========================================================== */

import * as THREE from 'three';
import { applyCell, applyRegion } from './textures.js';

/** Merge non-indexed geometries carrying position/normal/uv/color. */
export function mergeGeos(list) {
  const parts = [];
  let total = 0;

  for (const g of list) {
    if (!g) continue;
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!ng.attributes.uv) {
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    }
    parts.push(ng);
    total += ng.attributes.position.count;
  }
  if (!parts.length) return null;

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);

  let o = 0;
  const white = new THREE.Color(1, 1, 1);
  for (const g of parts) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const c = g.attributes.color;
    const tint = g.userData?.tint || white;
    const count = p.count;
    position.set(p.array.subarray(0, count * 3), o * 3);
    normal.set(n.array.subarray(0, count * 3), o * 3);
    uv.set(t.array.subarray(0, count * 2), o * 2);
    for (let i = 0; i < count; i++) {
      if (c) {
        color[(o + i) * 3] = c.getX(i) * tint.r;
        color[(o + i) * 3 + 1] = c.getY(i) * tint.g;
        color[(o + i) * 3 + 2] = c.getZ(i) * tint.b;
      } else {
        color[(o + i) * 3] = tint.r;
        color[(o + i) * 3 + 1] = tint.g;
        color[(o + i) * 3 + 2] = tint.b;
      }
    }
    o += count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return out;
}

/* ---------- primitive factories with atlas UVs + tint ---------- */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

/** Position / rotate / scale a geometry in place. */
export function place(geo, { pos, rot, scale } = {}) {
  const p = pos ? _v.set(pos[0], pos[1], pos[2]) : _v.set(0, 0, 0);
  const q = rot ? _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])) : _q.identity();
  const s = scale
    ? (Array.isArray(scale) ? new THREE.Vector3(...scale) : new THREE.Vector3(scale, scale, scale))
    : new THREE.Vector3(1, 1, 1);
  _m.compose(p, q, s);
  geo.applyMatrix4(_m);
  return geo;
}

export function tint(geo, color) {
  geo.userData.tint = color instanceof THREE.Color ? color : new THREE.Color(color);
  return geo;
}

export function box(w, h, d, cell, opts) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (cell) applyCell(g, cell);
  return place(g, opts);
}

export function cyl(rt, rb, h, seg, cell, opts) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
  if (cell) applyCell(g, cell);
  return place(g, opts);
}

export function cone(r, h, seg, cell, opts) {
  const g = new THREE.ConeGeometry(r, h, seg, 1);
  if (cell) applyCell(g, cell);
  return place(g, opts);
}

export function ico(r, detail, cell, opts) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  // Icosahedra have no useful UVs; just splat the cell across them.
  const uv = g.attributes.uv;
  if (!uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (cell) applyCell(g, cell);
  return place(g, opts);
}

export function sphere(r, ws, hs, cell, opts) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  if (cell) applyCell(g, cell);
  return place(g, opts);
}

export function plane(w, h, cell, opts, segsW = 1, segsH = 1) {
  const g = new THREE.PlaneGeometry(w, h, segsW, segsH);
  if (cell) applyCell(g, cell);
  return place(g, opts);
}

export function region(geo, col, row, cols, rows, flipV) {
  return applyRegion(geo, col, row, cols, rows, flipV);
}

/** A tapered cylinder stretched between two points — arms, legs, staffs. */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
export function limb(from, to, r1, r2, cell, seg = 6) {
  _a.fromArray(from); _b.fromArray(to);
  _dir.subVectors(_b, _a);
  const len = _dir.length() || 1e-4;
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1);
  if (cell) applyCell(g, cell);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, _dir.clone().normalize());
  const m = new THREE.Matrix4().compose(
    _a.clone().addScaledVector(_dir, 0.5),
    q,
    new THREE.Vector3(1, 1, 1)
  );
  g.applyMatrix4(m);
  return g;
}

/** Open cylindrical arc facing +Z — used for chest logos and panels. */
export function arcPanel(radius, height, arcRad, segs = 10) {
  const g = new THREE.CylinderGeometry(
    radius, radius, height, segs, 1, true, -arcRad / 2, arcRad
  );
  // The arc winds from -X to +X as seen from the front, which mirrors any
  // text pasted on it. Flip u so it reads the right way round.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
  return g;
}

/** Spherical patch facing +Z — used for faces. */
export function facePatch(radius, phiSpan, thetaFrom, thetaTo, segs = 8) {
  const g = new THREE.SphereGeometry(
    radius, segs, segs,
    Math.PI / 2 - phiSpan / 2, phiSpan,
    thetaFrom, thetaTo - thetaFrom
  );
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
  return g;
}

/* A stable hash from a quantised position, so two vertices that sit on top
   of each other always get the same offset. */
function posHash(x, y, z, salt) {
  const q = (v) => Math.round(v * 512);
  let h = q(x) * 374761393 ^ q(y) * 668265263 ^ q(z) * 2147483647 ^ salt * 97;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Randomly nudge vertices — instant "hand-modelled in 1997".
 *
 * IcosahedronGeometry and friends are NON-INDEXED: every triangle carries
 * its own copy of each corner. Offsetting those copies independently rips
 * the surface into loose, cracked triangles, which is what broken rocks
 * look like. So the offset is derived from the vertex POSITION rather than
 * drawn per-vertex — coincident copies move identically and the shell
 * stays watertight.
 */
export function jitterVerts(geo, amount, rng, salt) {
  const p = geo.attributes.position;
  const s = salt !== undefined ? salt : ((rng ? rng() : Math.random()) * 65536) | 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i,
      x + (posHash(x, y, z, s) - 0.5) * amount,
      y + (posHash(x, y, z, s + 1) - 0.5) * amount,
      z + (posHash(x, y, z, s + 2) - 0.5) * amount);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Push vertices out along their own radius by a hashed amount — a lumpy but
 * strictly star-shaped solid. Better than jitterVerts for boulders because
 * it can never fold the surface through itself.
 */
export function lumpify(geo, amount, rng, salt) {
  const p = geo.attributes.position;
  const s = salt !== undefined ? salt : ((rng ? rng() : Math.random()) * 65536) | 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1e-5;
    const k = 1 + (posHash(x, y, z, s) - 0.5) * 2 * amount;
    p.setXYZ(i, (x / len) * len * k, (y / len) * len * k, (z / len) * len * k);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Bend a geometry around X as a function of height — used for palm trunks. */
export function bendY(geo, amount, axis = 'x', power = 2) {
  const p = geo.attributes.position;
  let maxY = -Infinity, minY = Infinity;
  for (let i = 0; i < p.count; i++) { maxY = Math.max(maxY, p.getY(i)); minY = Math.min(minY, p.getY(i)); }
  const span = Math.max(1e-4, maxY - minY);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - minY) / span;
    const d = Math.pow(t, power) * amount;
    if (axis === 'x') p.setX(i, p.getX(i) + d);
    else p.setZ(i, p.getZ(i) + d);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Taper a geometry's XZ radius by height. */
export function taper(geo, topScale) {
  const p = geo.attributes.position;
  let maxY = -Infinity, minY = Infinity;
  for (let i = 0; i < p.count; i++) { maxY = Math.max(maxY, p.getY(i)); minY = Math.min(minY, p.getY(i)); }
  const span = Math.max(1e-4, maxY - minY);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - minY) / span;
    const s = 1 + (topScale - 1) * t;
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
