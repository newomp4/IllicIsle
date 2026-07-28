/* ===========================================================
   extras.js — collectibles, the supply hut, navigation beacons
   and the storm that rolls in once the Pendulums are all read.
   =========================================================== */

import * as THREE from 'three';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, place, tint, limb, lumpify,
} from '../lib/geo.js';
import { applyCell, buildSignTexture } from '../lib/textures.js';

const G = (n) => new THREE.Color(n);

/* ===========================================================
   SYNCOIN — currency, and the oldest thing on the island
   =========================================================== */
export function buildSyncoin(mats, big = false) {
  const s = big ? 1.5 : 1;
  const P = [];
  const disc = cyl(0.24 * s, 0.24 * s, 0.045 * s, 12, 'gold', { rot: [Math.PI / 2, 0, 0] });
  tint(disc, G(0xd8c070)); P.push(disc);
  const rim = new THREE.TorusGeometry(0.235 * s, 0.028 * s, 4, 12);
  applyCell(rim, 'gold');
  tint(rim, G(0xf0dc9a)); P.push(rim);
  // the SYN sigil: two interlocking bars
  const b1 = box(0.055 * s, 0.24 * s, 0.06 * s, 'goldDark', { pos: [-0.05 * s, 0, 0] });
  tint(b1, G(0x8a6c2a)); P.push(b1);
  const b2 = box(0.055 * s, 0.24 * s, 0.06 * s, 'goldDark', { pos: [0.05 * s, 0, 0], rot: [0, 0, 0.5] });
  tint(b2, G(0x8a6c2a)); P.push(b2);

  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
  const light = new THREE.PointLight(0xffd88a, 0.7, 5, 2);
  g.add(light);
  g.userData.tick = (t) => {
    g.rotation.y = t * 1.9;
    g.position.y = (g.userData.baseY ?? 0) + 0.42 + Math.sin(t * 2.4) * 0.13;
    light.intensity = 0.5 + Math.sin(t * 4) * 0.25;
  };
  return g;
}

/* ===========================================================
   RELICS — one-off easter eggs with a story attached
   =========================================================== */
export function buildRelic(kind, rng, mats) {
  const g = new THREE.Group();
  const P = [];

  if (kind === 'tasha') {
    /* the remains of a female automaton, half buried */
    const torso = cyl(0.30, 0.36, 0.72, 8, 'metal', { pos: [0, 0.34, 0], rot: [1.35, 0.3, 0] });
    tint(torso, G(0xbfc4c8)); P.push(torso);
    const head = ico(0.24, 0, 'metal', { pos: [0.62, 0.20, 0.35], scale: [1, 1.12, 0.95] });
    tint(head, G(0xd0d6da)); P.push(head);
    // faceplate
    const face = box(0.3, 0.22, 0.05, 'glass', { pos: [0.80, 0.22, 0.42], rot: [0, 0.7, 0.2] });
    tint(face, G(0x6fd0e0)); P.push(face);
    // one arm still reaching
    const arm = limb([-0.1, 0.5, -0.1], [-0.7, 0.9, -0.5], 0.09, 0.06, 'metal');
    tint(arm, G(0xbfc4c8)); P.push(arm);
    const hand = ico(0.1, 0, 'metal', { pos: [-0.7, 0.92, -0.5] });
    tint(hand, G(0xd0d6da)); P.push(hand);
    // scattered plating
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2, r = 0.6 + rng() * 1.3;
      const pl = box(0.2 + rng() * 0.15, 0.05, 0.16 + rng() * 0.12, 'metal', {
        pos: [Math.cos(a) * r, 0.04, Math.sin(a) * r], rot: [(rng() - .5) * .6, rng() * 3, (rng() - .5) * .6],
      });
      tint(pl, G(0xa8b0b6).multiplyScalar(0.8 + rng() * 0.4)); P.push(pl);
    }
    g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
    const eye = new THREE.PointLight(0x6fd0e0, 1.0, 6, 2);
    eye.position.set(0.8, 0.25, 0.45);
    g.add(eye);
    g.userData.tick = (t) => {
      // she still flickers, occasionally
      const blink = Math.sin(t * 0.7) > 0.86 ? Math.random() : 1;
      eye.intensity = (0.5 + Math.sin(t * 3) * 0.2) * blink;
    };

  } else if (kind === 'aerlingus') {
    /* a torn section of green fuselage, half in the sand */
    const skin = cyl(1.5, 1.7, 3.4, 10, 'metal', {
      pos: [0, 0.5, 0], rot: [1.42, 0.4, 0.15],
    });
    lumpify(skin, 0.06, rng);
    tint(skin, G(0x2f7a52)); P.push(skin);
    // torn edge
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sh = box(0.34, 0.5 + rng() * 0.4, 0.06, 'metal', {
        pos: [Math.cos(a) * 1.55, 1.0 + rng() * 0.3, -1.5 + Math.sin(a) * 0.5],
        rot: [(rng() - .5) * .8, -a, (rng() - .5) * .5],
      });
      tint(sh, G(0x2f7a52).multiplyScalar(0.8 + rng() * 0.4)); P.push(sh);
    }
    // white cheatline + windows
    const line = box(0.1, 0.28, 3.2, 'metal', { pos: [1.2, 0.75, 0], rot: [1.42, 0.4, 0.15] });
    tint(line, G(0xe8ece8)); P.push(line);
    for (let i = 0; i < 4; i++) {
      const w = box(0.12, 0.2, 0.2, 'glass', { pos: [1.25, 1.05, -1.1 + i * 0.75], rot: [0, 0.4, 0] });
      tint(w, G(0x203038)); P.push(w);
    }
    // a shamrock-ish tail fragment standing up
    const fin = box(0.12, 1.6, 1.1, 'metal', { pos: [-1.5, 0.9, 1.2], rot: [0, 0.5, 0.28] });
    tint(fin, G(0x2f7a52)); P.push(fin);
    const clover = box(0.14, 0.5, 0.5, 'metal', { pos: [-1.44, 1.3, 1.2], rot: [0, 0.5, 0.28] });
    tint(clover, G(0xdfe8dc)); P.push(clover);
    g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  } else if (kind === 'watermelon') {
    const melon = ico(0.42, 1, 'lettuce', { scale: [1.25, 1, 1] });
    lumpify(melon, 0.07, rng);
    tint(melon, G(0x3f7a33)); P.push(melon);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const stripe = box(0.06, 0.8, 0.1, 'lettuce', { pos: [Math.cos(a) * 0.4, 0, Math.sin(a) * 0.34], rot: [0, -a, 0] });
      tint(stripe, G(0x1f4a20)); P.push(stripe);
    }
    const stem = cyl(0.04, 0.05, 0.16, 5, 'vine', { pos: [0, 0.44, 0] });
    tint(stem, G(0x6a8a3a)); P.push(stem);
    g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
    g.userData.tick = (t) => { g.rotation.y = Math.sin(t * 0.5) * 0.25; };
  }

  return g;
}

/* ===========================================================
   FERDI STEINMAN'S HUT
   A landmark you can navigate by, and the only shop on the island.
   =========================================================== */
export function buildFerdiHut(rng, mats) {
  const group = new THREE.Group();
  const P = [], C = [];
  const WOOD = G(0x7a6242), WOOD_D = G(0x5a4730);

  /* stilts, because everything here rots */
  for (const [sx, sz] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 2.2], [2.6, 2.2]]) {
    const leg = cyl(0.18, 0.22, 1.5, 6, 'driftwood', { pos: [sx, 0.75, sz] });
    tint(leg, WOOD_D); P.push(leg);
  }
  const deck = box(6.2, 0.28, 5.2, 'planks', { pos: [0, 1.5, 0] });
  tint(deck, WOOD); P.push(deck);

  /* walls: three sides, open to the front (+Z) */
  const wallSpec = [
    { x: 0, z: -2.5, w: 6.2, r: 0 },
    { x: -3.0, z: 0, w: 5.0, r: Math.PI / 2 },
    { x: 3.0, z: 0, w: 5.0, r: Math.PI / 2 },
  ];
  for (const W of wallSpec) {
    for (let i = 0; i < 7; i++) {
      // gappy planking — you can see the lamp through it
      if (rng() < 0.16) continue;
      const pl = box(W.w, 0.34, 0.16, 'planks', {
        pos: [W.x, 1.85 + i * 0.36, W.z], rot: [0, W.r, (rng() - .5) * 0.03],
      });
      tint(pl, WOOD.clone().multiplyScalar(0.75 + rng() * 0.4)); P.push(pl);
    }
  }
  /* counter across the front */
  const counter = box(6.0, 0.3, 0.7, 'planks', { pos: [0, 2.5, 2.3] });
  tint(counter, G(0x8a7050)); P.push(counter);
  for (const sx of [-2.6, 2.6]) {
    const post = cyl(0.14, 0.16, 2.6, 5, 'driftwood', { pos: [sx, 3.1, 2.4] });
    tint(post, WOOD_D); P.push(post);
  }

  /* roof: corrugated scrap, visibly sagging */
  for (let i = 0; i < 9; i++) {
    const t = (i / 8 - 0.5);
    const sag = Math.cos(t * 2.6) * 0.22;
    const sheet = box(0.72, 0.1, 6.4, 'metal', {
      pos: [t * 6.6, 4.45 + sag - Math.abs(t) * 0.55, 0.1],
      rot: [0, 0, -t * 0.34],
    });
    tint(sheet, G(0x8a8478).multiplyScalar(0.7 + rng() * 0.45)); P.push(sheet);
  }
  // patched with sailcloth
  const patch = plane(3.0, 2.4, 'sail', { pos: [1.4, 4.7, 1.4], rot: [-1.1, 0.2, 0.2] });
  tint(patch, G(0xcabfa0)); C.push(patch);

  /* the sign, hanging off one nail */
  const signBoard = box(3.4, 1.1, 0.12, 'planks', { pos: [-0.4, 5.35, 2.5], rot: [0, 0, -0.22] });
  tint(signBoard, G(0x9a8058)); P.push(signBoard);
  const nail = cyl(0.05, 0.05, 0.3, 4, 'metal', { pos: [1.15, 5.75, 2.5], rot: [Math.PI / 2, 0, 0] });
  tint(nail, G(0x6a6a66)); P.push(nail);

  /* stock: crates, jars, bundles, a hanging lantern */
  for (let i = 0; i < 9; i++) {
    const c = box(0.5 + rng() * 0.3, 0.5, 0.5 + rng() * 0.2, 'planks', {
      pos: [-2.4 + rng() * 4.8, 1.95 + (rng() < 0.35 ? 0.55 : 0), -1.6 + rng() * 1.6],
      rot: [0, rng() * 3, 0],
    });
    tint(c, WOOD.clone().multiplyScalar(0.7 + rng() * 0.5)); P.push(c);
  }
  for (let i = 0; i < 6; i++) {
    const j = cyl(0.14, 0.16, 0.34, 7, 'glass', { pos: [-2.2 + i * 0.9, 2.82, 2.25] });
    tint(j, G(0x8ab0a0).multiplyScalar(0.8 + rng() * 0.4)); P.push(j);
  }
  for (let i = 0; i < 5; i++) {
    const b = cyl(0.09, 0.11, 0.8, 5, 'rope', { pos: [-2.0 + i * 1.0, 3.9, -2.2], rot: [0, 0, 0.1] });
    tint(b, G(0xa08a5c)); P.push(b);
  }

  group.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
  group.add(new THREE.Mesh(mergeGeos(C), mats.cutoutStill));

  /* painted sign face */
  const signTex = buildSignTexture(['FERDI STEINMAN', "SUPPLIES  •  NO REFUNDS"], '#3a2c16', '#e8cf7a');
  const signFace = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0),
    new THREE.MeshBasicMaterial({ map: signTex }));
  signFace.position.set(-0.4, 5.35, 2.58);
  signFace.rotation.z = -0.22;
  group.add(signFace);

  /* ---------- Ferdi ---------- */
  const ferdy = new THREE.Group();
  ferdy.position.set(-0.3, 1.78, 1.1);
  const F = [];
  const coat = new THREE.LatheGeometry([
    [0.00, 0.00], [0.30, 0.02], [0.34, 0.30], [0.32, 0.62],
    [0.26, 0.82], [0.14, 0.94], [0.00, 0.97],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  applyCell(coat, 'clothTat');
  tint(coat, G(0x6b5f48)); F.push(coat);
  const head = sphere(0.19, 8, 6, 'skin', { pos: [0, 1.12, 0] });
  tint(head, G(0xc79a72)); F.push(head);
  // enormous beard, sunburnt nose
  for (let i = 0; i < 16; i++) {
    const c = ico(0.06 + rng() * 0.05, 0, 'hair', {
      pos: [(rng() - .5) * 0.34, 0.94 + rng() * 0.16, 0.06 + rng() * 0.16],
      rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(c, G(0x8a8378)); F.push(c);
  }
  for (let i = 0; i < 10; i++) {
    const c = ico(0.06 + rng() * 0.04, 0, 'hair', {
      pos: [(rng() - .5) * 0.3, 1.24 + rng() * 0.08, (rng() - .5) * 0.28],
      rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(c, G(0x9a9388)); F.push(c);
  }
  const nose = ico(0.055, 0, 'skin', { pos: [0, 1.10, 0.19] });
  tint(nose, G(0xc4614a)); F.push(nose);
  for (const s of [-1, 1]) {
    const arm = limb([s * 0.28, 0.78, 0], [s * 0.34, 0.42, 0.22], 0.07, 0.055, 'clothTat');
    tint(arm, G(0x6b5f48)); F.push(arm);
  }
  // battered hat
  const brim = cyl(0.30, 0.30, 0.04, 9, 'clothTat', { pos: [0, 1.28, 0] });
  tint(brim, G(0x54492f)); F.push(brim);
  const crown = cyl(0.17, 0.19, 0.20, 9, 'clothTat', { pos: [0, 1.38, 0] });
  tint(crown, G(0x54492f)); F.push(crown);

  ferdy.add(new THREE.Mesh(mergeGeos(F), mats.opaque));
  group.add(ferdy);
  group.userData.ferdy = ferdy;

  /* lantern */
  const lampLight = new THREE.PointLight(0xffb45a, 2.0, 16, 1.7);
  lampLight.position.set(1.6, 3.7, 1.6);
  group.add(lampLight);

  group.userData.tick = (t) => {
    ferdy.position.y = 1.78 + Math.sin(t * 1.1) * 0.03;
    ferdy.rotation.y = Math.sin(t * 0.42) * 0.28;
    lampLight.intensity = 1.7 + Math.sin(t * 8.3) * 0.35 + Math.sin(t * 3.1) * 0.2;
  };
  return group;
}

/* ===========================================================
   TIKI TORCH — the island's night lighting
   =========================================================== */
export function buildTikiTorch(rng, mats, flameFactory) {
  const g = new THREE.Group();
  const P = [];

  const pole = cyl(0.10, 0.14, 2.6, 6, 'driftwood', { pos: [0, 1.3, 0] });
  tint(pole, G(0x8a7048)); P.push(pole);
  // carved bands
  for (let i = 0; i < 3; i++) {
    const b = cyl(0.15, 0.15, 0.14, 6, 'templeGlyph', { pos: [0, 0.5 + i * 0.6, 0] });
    tint(b, G(0xb09060)); P.push(b);
  }
  // a little carved face near the top, because tiki
  const faceBlock = box(0.30, 0.42, 0.30, 'templeGlyph', { pos: [0, 2.35, 0] });
  tint(faceBlock, G(0xa8875a)); P.push(faceBlock);
  for (const sx of [-1, 1]) {
    const eye = box(0.07, 0.07, 0.05, 'monolith', { pos: [sx * 0.08, 2.45, 0.16] });
    tint(eye, G(0x2a2018)); P.push(eye);
  }
  const mouth = box(0.18, 0.05, 0.05, 'monolith', { pos: [0, 2.26, 0.16] });
  tint(mouth, G(0x2a2018)); P.push(mouth);
  // bowl
  const bowl = cyl(0.26, 0.15, 0.22, 8, 'metal', { pos: [0, 2.68, 0] });
  tint(bowl, G(0x6a5a48)); P.push(bowl);

  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  const flame = flameFactory(mats, 3, 0.30);
  flame.position.y = 2.74;
  g.add(flame);

  const light = new THREE.PointLight(0xffa040, 0, 15, 1.7);
  light.position.set(0, 3.1, 0);
  g.add(light);

  g.userData.flame = flame;
  g.userData.light = light;
  g.userData.baseIntensity = 2.0;
  g.userData.tick = (t, dt, night = 1) => {
    flame.userData.tick(t);
    const flick = 0.82 + Math.sin(t * 9.1 + g.position.x) * 0.12 + Math.sin(t * 15.7) * 0.06;
    light.intensity = g.userData.baseIntensity * flick * (0.28 + night * 0.72);
    flame.visible = true;
    flame.scale.setScalar(0.85 + night * 0.25);
  };
  return g;
}

/* ===========================================================
   PENDULUM BEACON — a shaft of light you can see over the canopy
   =========================================================== */
export function buildBeacon(color = 0x8fe6d0) {
  const g = new THREE.CylinderGeometry(0.7, 2.2, 90, 8, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
    depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.y = 45;
  m.renderOrder = 4;
  const grp = new THREE.Group();
  grp.add(m);
  grp.userData.tick = (t) => {
    mat.opacity = 0.11 + Math.sin(t * 1.6) * 0.05;
    m.rotation.y = t * 0.25;
  };
  grp.userData.setVisible = (v) => { grp.visible = v; };
  return grp;
}

/* ===========================================================
   STORM — rain, wind, lightning, once the Pendulums are read
   =========================================================== */
export function buildStorm(scene) {
  const COUNT = 1400;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  const spd = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = Math.random() * 60;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    spd[i] = 46 + Math.random() * 34;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xbcd4e0, size: 0.16, sizeAttenuation: true,
    transparent: true, opacity: 0.0, depthWrite: false, fog: true,
  });
  const rain = new THREE.Points(geo, mat);
  rain.frustumCulled = false;
  scene.add(rain);

  const flash = new THREE.DirectionalLight(0xdfeaff, 0);
  flash.position.set(0.3, 1, 0.2);
  scene.add(flash);

  const state = {
    active: false, strength: 0, nextBolt: 4, boltT: -1,
    onThunder: null,
  };

  const api = {
    start() { state.active = true; state.nextBolt = 1.2; },
    stop() { state.active = false; },
    get active() { return state.active; },
    set onThunder(fn) { state.onThunder = fn; },
    tick(t, dt, camPos) {
      const target = state.active ? 1 : 0;
      state.strength += (target - state.strength) * Math.min(1, dt * 0.35);
      mat.opacity = state.strength * 0.5;
      rain.visible = state.strength > 0.02;
      if (!rain.visible) return state.strength;

      // rain falls in a box that follows the camera
      const p = geo.attributes.position;
      for (let i = 0; i < COUNT; i++) {
        let y = p.getY(i) - spd[i] * dt;
        let x = p.getX(i), z = p.getZ(i);
        if (y < camPos.y - 22) {
          y = camPos.y + 42 + Math.random() * 14;
          x = camPos.x + (Math.random() - 0.5) * 90;
          z = camPos.z + (Math.random() - 0.5) * 90;
        }
        // wind shear
        x += dt * 9;
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;

      // lightning
      if (state.active) {
        state.nextBolt -= dt;
        if (state.nextBolt <= 0) {
          state.nextBolt = 5 + Math.random() * 11;
          state.boltT = 0.34;
          state.onThunder?.();
        }
      }
      if (state.boltT > 0) {
        state.boltT -= dt;
        // double-strike flicker
        const f = state.boltT > 0.24 ? 1 : (state.boltT > 0.19 ? 0.15 : (state.boltT > 0.13 ? 0.8 : state.boltT * 2));
        flash.intensity = Math.max(0, f) * 3.4 * state.strength;
      } else flash.intensity = 0;

      return state.strength;
    },
  };
  return api;
}
