/* ===========================================================
   cave.js — THE THROAT OF THE ISLE
   One big chamber: you drop in at the south, Hector holds the
   middle, and the idol waits on a dais at the north behind a
   seal that only breaks when he does.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, place, tint, jitterVerts, limb,
} from '../lib/geo.js';
import { makeRng, buildDetailTexture } from '../lib/textures.js';
import { buildTorch, buildFlameCluster, buildCoconutPile } from './props.js';

export const CAVE = {
  radius: 33,
  center: new THREE.Vector3(0, 0, 0),
  floorY: 0,
  entrance: new THREE.Vector3(0, 0, 27),
  daisCenter: new THREE.Vector3(0, 0, -25),
  daisHeight: 2.4,
};

/** Ground height inside the cave.
 *  NOTE: MathUtils.smoothstep(x, min, max) requires min < max — passing them
 *  the other way round returns 1 for everything past `max`, which silently
 *  inverts the feature and raises the whole floor instead. Hence the
 *  explicit `1 - smoothstep(...)` for "high here, flat elsewhere". */
export function caveHeight(x, z) {
  let h = 0;
  // raised dais at the north end
  const d = Math.hypot(x - CAVE.daisCenter.x, z - CAVE.daisCenter.z);
  h += CAVE.daisHeight * (1 - THREE.MathUtils.smoothstep(d, 6.5, 11.5));
  // entrance ledge you drop in from
  const de = Math.hypot(x - CAVE.entrance.x, z - CAVE.entrance.z);
  h += 1.4 * (1 - THREE.MathUtils.smoothstep(de, 3.5, 9));
  // shallow bowl so the arena reads as a pit
  const r = Math.hypot(x, z);
  h -= 0.5 * (1 - THREE.MathUtils.clamp(r / CAVE.radius, 0, 1));
  return h;
}

export function buildCave(mats, propMats) {
  const rng = makeRng(90210);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0705);
  scene.fog = new THREE.Fog(0x1a0e08, 16, 78);

  /* ---------- lighting ---------- */
  scene.add(new THREE.AmbientLight(0x7a5238, 1.2));
  const key = new THREE.DirectionalLight(0xffc088, 0.85);
  key.position.set(0.3, 1, 0.2);
  scene.add(key);
  const bounce = new THREE.HemisphereLight(0x9a5f2c, 0x2a1810, 0.8);
  scene.add(bounce);

  // A wide, dim fill over the arena so the fight stays readable without
  // washing out the tunnel edges.
  const arenaFill = new THREE.PointLight(0xffa860, 1.5, 62, 1.1);
  arenaFill.position.set(0, 13, 2);
  scene.add(arenaFill);

  /* ---------- floor ---------- */
  const floorGeo = new THREE.PlaneGeometry(88, 88, 72, 72);
  floorGeo.rotateX(-Math.PI / 2);
  {
    const p = floorGeo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const base = new THREE.Color(0x5c4432);
    const dark = new THREE.Color(0x33241a);
    const hot = new THREE.Color(0x7a3a1c);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      let h = caveHeight(x, z);
      // rough it up
      h += (rng() - 0.5) * 0.35;
      // wall skirt
      if (r > CAVE.radius) h += (r - CAVE.radius) * 2.4;
      p.setY(i, h);

      const n = rng();
      c.copy(base).lerp(dark, n * 0.8);
      if (r > CAVE.radius - 3) c.lerp(dark, 0.6);
      if (h > 1.6) c.lerp(hot, 0.28); // the dais catches the idol's glow
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    floorGeo.computeVertexNormals();
  }
  const detail = buildDetailTexture();
  detail.repeat.set(26, 26);
  const floorMat = ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }), { flat: false });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  scene.add(floor);

  /* ---------- walls ---------- */
  const wallGeo = new THREE.CylinderGeometry(CAVE.radius + 2, CAVE.radius + 4.5, 30, 26, 5, true);
  jitterVerts(wallGeo, 1.5, rng);
  wallGeo.translate(0, 12, 0);
  {
    const p = wallGeo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = THREE.MathUtils.clamp(p.getY(i) / 26, 0, 1);
      c.setHex(0x4e3826).multiplyScalar(1 - t * 0.62).multiplyScalar(0.8 + rng() * 0.4);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    wallGeo.computeVertexNormals();
  }
  const wallMat = ps1ify(new THREE.MeshLambertMaterial({
    vertexColors: true, map: detail, side: THREE.BackSide,
  }), { flat: true });
  const walls = new THREE.Mesh(wallGeo, wallMat);
  walls.frustumCulled = false;
  scene.add(walls);

  /* ---------- ceiling dome ---------- */
  const domeGeo = new THREE.SphereGeometry(CAVE.radius + 4, 22, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  jitterVerts(domeGeo, 1.6, rng);
  domeGeo.scale(1, 0.55, 1);
  domeGeo.translate(0, 15, 0);
  {
    /* Go through THREE.Color, not raw floats: hex is converted sRGB->linear,
       and the composite converts back, so what you type is what you see.
       Raw numbers here are linear and come out roughly twice as bright. */
    const p = domeGeo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      c.setHex(0x241710).multiplyScalar(0.75 + rng() * 0.5);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    domeGeo.computeVertexNormals();
  }
  const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: true,
  }));
  dome.frustumCulled = false;
  scene.add(dome);

  /* ---------- rock formations ---------- */
  const rockParts = [];
  const CR = new THREE.Color(0x8a6746);

  /* Nothing may grow on the dais, in the doorway, or on Hector's camp —
     a boulder in front of the idol reads as a rendering glitch. */
  const KEEP_OUT = [
    { x: CAVE.daisCenter.x, z: CAVE.daisCenter.z, r: 14 },
    { x: CAVE.entrance.x, z: CAVE.entrance.z, r: 9 },
    { x: -16, z: 12, r: 11 },
  ];
  const blocked = (x, z) => KEEP_OUT.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < k.r * k.r);

  // stalagmites around the rim
  for (let i = 0; i < 44; i++) {
    const a = rng() * Math.PI * 2;
    const r = 14 + rng() * (CAVE.radius - 15);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // keep the fighting floor clear-ish
    if (r < 22 && rng() < 0.7) continue;
    if (blocked(x, z)) continue;
    const h = 1.4 + rng() * 4.4;
    const g = cone(0.5 + rng() * 0.9, h, 6, 'caveRock', {
      pos: [x, caveHeight(x, z) + h / 2, z], rot: [(rng() - .5) * 0.2, rng() * 3, (rng() - .5) * 0.2],
    });
    jitterVerts(g, 0.22, rng);
    tint(g, CR.clone().multiplyScalar(0.72 + rng() * 0.5));
    rockParts.push(g);
  }
  // stalactites from the ceiling
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * (CAVE.radius - 3);
    const h = 1.6 + rng() * 5;
    if (blocked(Math.cos(a) * r, Math.sin(a) * r)) continue;
    const y = 12 + rng() * 5 - (r / CAVE.radius) * 4;
    const g = cone(0.35 + rng() * 0.8, h, 6, 'caveRock', {
      pos: [Math.cos(a) * r, y, Math.sin(a) * r], rot: [Math.PI + (rng() - .5) * 0.2, rng() * 3, 0],
    });
    jitterVerts(g, 0.2, rng);
    tint(g, CR.clone().multiplyScalar(0.6 + rng() * 0.4));
    rockParts.push(g);
  }
  // boulders
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = 20 + rng() * (CAVE.radius - 21);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    const s = 1 + rng() * 2.4;
    const g = ico(s, 0, 'caveRock', { pos: [x, caveHeight(x, z) + s * 0.35, z], rot: [rng() * 3, rng() * 3, rng() * 3] });
    jitterVerts(g, s * 0.35, rng);
    tint(g, CR.clone().multiplyScalar(0.7 + rng() * 0.45));
    rockParts.push(g);
  }
  scene.add(new THREE.Mesh(mergeGeos(rockParts), propMats.opaque));

  /* ---------- glowing crystals ---------- */
  const crystalParts = [];
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2;
    const r = 16 + rng() * (CAVE.radius - 14);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    const y = caveHeight(x, z) + rng() * 6;
    const cl = 2 + ((rng() * 3) | 0);
    for (let c = 0; c < cl; c++) {
      const h = 0.7 + rng() * 1.6;
      const g = cone(0.16 + rng() * 0.16, h, 5, 'crystal', {
        pos: [x + (rng() - .5) * 1.2, y + h / 2, z + (rng() - .5) * 1.2],
        rot: [(rng() - .5) * 0.7, rng() * 3, (rng() - .5) * 0.7],
      });
      tint(g, new THREE.Color(0x2f7d9c).multiplyScalar(0.7 + rng() * 0.5));
      crystalParts.push(g);
    }
  }
  const crystals = new THREE.Mesh(mergeGeos(crystalParts), new THREE.MeshBasicMaterial({
    map: propMats.opaque.map, vertexColors: true,
  }));
  scene.add(crystals);

  /* ---------- lava cracks in the floor ---------- */
  const crackParts = [];
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const r = 8 + rng() * 18;
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    let dir = rng() * Math.PI * 2;
    for (let s = 0; s < 7; s++) {
      const len = 1.6 + rng() * 2.6;
      const g = plane(0.3 + rng() * 0.4, len, 'lava', {
        rot: [-Math.PI / 2, 0, dir],
        pos: [x, caveHeight(x, z) + 0.06, z],
      });
      tint(g, new THREE.Color(0xff8a30).multiplyScalar(0.6 + rng() * 0.6));
      crackParts.push(g);
      x += Math.sin(dir) * len; z += Math.cos(dir) * len;
      dir += (rng() - 0.5) * 1.1;
      if (Math.hypot(x, z) > CAVE.radius - 2) break;
    }
  }
  const cracks = new THREE.Mesh(mergeGeos(crackParts), new THREE.MeshBasicMaterial({
    map: propMats.opaque.map, vertexColors: true, transparent: true, opacity: 0.9,
  }));
  scene.add(cracks);

  /* ---------- wall torches ---------- */
  const torches = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = CAVE.radius - 1.6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const t = buildTorch(propMats);
    t.position.set(x, caveHeight(x, z) + 3.4, z);
    t.rotation.y = -a + Math.PI / 2;
    t.userData.light.intensity = 1.6;
    t.userData.light.distance = 20;
    scene.add(t);
    torches.push(t);
  }

  /* ---------- HECTOR'S CAMP ---------- */
  const camp = buildHectorCamp(rng, propMats);
  camp.position.set(-16, caveHeight(-16, 12), 12);
  camp.rotation.y = 0.8;
  scene.add(camp);

  /* ---------- ENTRANCE ---------- */
  const entranceParts = [];
  {
    const ex = CAVE.entrance.x, ez = CAVE.entrance.z;
    const ey = caveHeight(ex, ez);
    // an arch of rock framing the way back up
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * (i / 11);
      const s = 1.2 + rng() * 1.1;
      const g = ico(s, 0, 'caveRock', {
        pos: [ex + Math.cos(a) * 4.4, ey + Math.sin(a) * 4.6 + 0.4, ez + (rng() - .5) * 1.2],
        rot: [rng() * 3, rng() * 3, rng() * 3],
      });
      jitterVerts(g, s * 0.3, rng);
      tint(g, CR.clone().multiplyScalar(0.75 + rng() * 0.4));
      entranceParts.push(g);
    }
    // daylight spilling down the shaft
    const shaft = plane(6.4, 7.4, 'crystal', { pos: [ex, ey + 3.6, ez + 1.6] });
    tint(shaft, new THREE.Color(0x9fd0e8));
    const shaftMesh = new THREE.Mesh(mergeGeos([shaft]), new THREE.MeshBasicMaterial({
      map: propMats.opaque.map, vertexColors: true, transparent: true, opacity: 0.30, depthWrite: false, fog: false,
    }));
    scene.add(shaftMesh);

    const dl = new THREE.PointLight(0xbfe0f0, 1.5, 26, 1.6);
    dl.position.set(ex, ey + 5, ez + 1);
    scene.add(dl);
  }
  scene.add(new THREE.Mesh(mergeGeos(entranceParts), propMats.opaque));

  /* ---------- THE DAIS + SEAL ---------- */
  const daisParts = [];
  const D = CAVE.daisCenter;
  const dy = CAVE.daisHeight;

  // steps up
  for (let i = 0; i < 3; i++) {
    const s = box(9 - i * 1.4, 0.55, 2.2, 'stone', { pos: [D.x, dy - 0.3 - i * 0.62, D.z + 7.2 + i * 1.5] });
    tint(s, new THREE.Color(0x8f7a5c).multiplyScalar(0.9 - i * 0.06));
    daisParts.push(s);
  }
  // pedestal
  const ped1 = cyl(2.0, 2.5, 0.6, 10, 'stone', { pos: [D.x, dy + 0.3, D.z] });
  tint(ped1, new THREE.Color(0x9c8768)); daisParts.push(ped1);
  const ped2 = cyl(1.5, 1.85, 1.5, 10, 'stone', { pos: [D.x, dy + 1.35, D.z] });
  tint(ped2, new THREE.Color(0xab9576)); daisParts.push(ped2);
  const ped3 = cyl(1.75, 1.5, 0.35, 10, 'goldDark', { pos: [D.x, dy + 2.25, D.z] });
  tint(ped3, new THREE.Color(0xd8b45c)); daisParts.push(ped3);

  // four pillars
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = D.x + Math.cos(a) * 5.6, pz = D.z + Math.sin(a) * 5.6;
    const col = cyl(0.55, 0.7, 7.5, 8, 'stone', { pos: [px, dy + 3.75, pz] });
    tint(col, new THREE.Color(0x9c8768)); daisParts.push(col);
    const cap = box(1.7, 0.45, 1.7, 'stone', { pos: [px, dy + 7.7, pz] });
    tint(cap, new THREE.Color(0x8a7660)); daisParts.push(cap);
    const bowl = cyl(0.5, 0.6, 0.4, 8, 'goldDark', { pos: [px, dy + 8.1, pz] });
    tint(bowl, new THREE.Color(0xd8b45c)); daisParts.push(bowl);
  }
  scene.add(new THREE.Mesh(mergeGeos(daisParts), propMats.opaque));

  // braziers on the pillars
  const braziers = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const f = buildFlameCluster(propMats, 3, 0.75);
    f.position.set(D.x + Math.cos(a) * 5.6, dy + 8.3, D.z + Math.sin(a) * 5.6);
    scene.add(f);
    braziers.push(f);
    const l = new THREE.PointLight(0xffb050, 1.5, 22, 1.7);
    l.position.copy(f.position).add(new THREE.Vector3(0, 0.6, 0));
    scene.add(l);
  }

  /* the seal: a wall of gold light across the dais steps */
  const sealGeo = new THREE.PlaneGeometry(11, 8, 6, 5);
  const sealMat = new THREE.MeshBasicMaterial({
    color: 0xffcf5a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, fog: false,
  });
  const seal = new THREE.Mesh(sealGeo, sealMat);
  seal.position.set(D.x, dy + 3, D.z + 8.6);
  scene.add(seal);

  const sealBars = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.65, fog: false, depthWrite: false })
    );
    g.position.set(D.x - 5 + i * 1.66, dy + 3, D.z + 8.62);
    scene.add(g);
    sealBars.push(g);
  }

  /* ---------- coconut caches for the fight ---------- */
  const caches = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const r = CAVE.radius - 8;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const pile = buildCoconutPile(rng, propMats);
    pile.position.set(x, caveHeight(x, z), z);
    scene.add(pile);
    caches.push({ mesh: pile, x, z, cooldown: 0 });
  }

  /* ---------- per-frame ---------- */
  const flameGroups = [];
  scene.traverse((o) => { if (o.userData?.tick && o !== scene) flameGroups.push(o); });

  scene.userData.tick = (t, dt) => {
    for (const g of flameGroups) g.userData.tick(t, dt);
    for (const tr of torches) {
      tr.userData.light.intensity = 1.4 + Math.sin(t * 9 + tr.position.x) * 0.32;
    }
    sealMat.opacity = 0.20 + Math.sin(t * 2.4) * 0.09;
    sealBars.forEach((b, i) => {
      b.position.y = dy + 3 + Math.sin(t * 1.6 + i * 0.8) * 0.25;
      b.material.opacity = 0.45 + Math.sin(t * 3 + i) * 0.22;
    });
  };

  scene.userData.seal = { seal, bars: sealBars, mat: sealMat };
  scene.userData.caches = caches;
  scene.userData.camp = camp;
  scene.userData.torches = torches;

  return scene;
}

/** Hector's living quarters. Eleven years of takeout. */
function buildHectorCamp(rng, mats) {
  const group = new THREE.Group();
  const P = [];
  const WOOD = new THREE.Color(0x8a7048);

  // throne of driftwood and ship's timber
  const seat = box(3.0, 0.5, 2.4, 'planks', { pos: [0, 1.5, 0] });
  tint(seat, WOOD); P.push(seat);
  const backRest = box(3.0, 3.6, 0.4, 'planks', { pos: [0, 3.2, -1.1], rot: [-0.12, 0, 0] });
  tint(backRest, WOOD); P.push(backRest);
  for (const s of [-1, 1]) {
    const arm = box(0.35, 0.4, 2.4, 'planks', { pos: [s * 1.5, 1.95, 0] });
    tint(arm, WOOD); P.push(arm);
    const leg = box(0.4, 1.5, 0.4, 'planks', { pos: [s * 1.3, 0.75, 0.9] });
    tint(leg, WOOD); P.push(leg);
    const leg2 = box(0.4, 1.5, 0.4, 'planks', { pos: [s * 1.3, 0.75, -0.9] });
    tint(leg2, WOOD); P.push(leg2);
  }
  // driftwood spikes crowning the throne
  for (let i = 0; i < 7; i++) {
    const g = cone(0.16, 0.9 + rng() * 0.8, 5, 'driftwood', {
      pos: [(i - 3) * 0.44, 5.1 + rng() * 0.3, -1.15], rot: [(rng() - .5) * 0.3, 0, (rng() - .5) * 0.3],
    });
    tint(g, new THREE.Color(0xc4b494)); P.push(g);
  }

  // a mountain of wrappers, bones and cups
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2;
    const r = 2.4 + rng() * 6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r + 1.5;
    const kind = rng();
    let g;
    if (kind < 0.35) {
      g = box(0.4 + rng() * 0.3, 0.1, 0.4 + rng() * 0.3, 'paper', {
        pos: [x, 0.08 + rng() * 0.4, z], rot: [(rng() - .5) * 0.8, rng() * 3, (rng() - .5) * 0.8],
      });
      tint(g, new THREE.Color(0xd8ccae));
    } else if (kind < 0.6) {
      g = cyl(0.2, 0.16, 0.5, 6, 'soda', {
        pos: [x, 0.25, z], rot: [rng() < 0.5 ? Math.PI / 2 : 0, rng() * 3, 0],
      });
      tint(g, new THREE.Color(0xc44a3a));
    } else if (kind < 0.8) {
      g = box(0.09, 0.5, 0.09, 'fry', { pos: [x, 0.2, z], rot: [(rng() - .5) * 2, rng() * 3, (rng() - .5) * 2] });
      tint(g, new THREE.Color(0xefc25a));
    } else {
      g = cyl(0.06, 0.05, 0.5 + rng() * 0.4, 5, 'onion', {
        pos: [x, 0.1, z], rot: [Math.PI / 2, rng() * 3, (rng() - .5) * 0.5],
      });
      tint(g, new THREE.Color(0xe8e0cc));
    }
    P.push(g);
  }

  // the grill: a stone slab over a permanent fire
  const slab = box(3.2, 0.3, 2.2, 'stone', { pos: [4.5, 1.1, 3.5] });
  tint(slab, new THREE.Color(0x6a6258)); P.push(slab);
  for (const s of [-1, 1]) {
    const leg = cyl(0.14, 0.16, 1.1, 5, 'metal', { pos: [4.5 + s * 1.3, 0.55, 3.5] });
    tint(leg, new THREE.Color(0x6a5c4c)); P.push(leg);
  }
  // patties, forever
  for (let i = 0; i < 6; i++) {
    const g = cyl(0.34, 0.34, 0.12, 8, 'patty', {
      pos: [4.5 + (rng() - .5) * 2.4, 1.31, 3.5 + (rng() - .5) * 1.4],
    });
    tint(g, new THREE.Color(0x6b4127)); P.push(g);
  }

  // tally marks scratched into a plank — eleven years of them
  const tally = box(2.2, 1.6, 0.12, 'runes', { pos: [-3.6, 1.4, -0.8], rot: [0, 0.5, 0.05] });
  tint(tally, new THREE.Color(0xbfae90)); P.push(tally);

  group.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  const grillFire = buildFlameCluster(mats, 3, 0.7);
  grillFire.position.set(4.5, 0.2, 3.5);
  group.add(grillFire);
  const gl = new THREE.PointLight(0xff8a30, 1.6, 16, 1.8);
  gl.position.set(4.5, 1.2, 3.5);
  group.add(gl);

  return group;
}
