/* ===========================================================
   extras.js — collectibles, the supply hut, navigation beacons
   and the storm that rolls in once the Pendulums are all read.
   =========================================================== */

import * as THREE from 'three';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, tint, limb, lumpify, blankUV,
} from '../lib/geo.js';
import { applyCell, buildSignTexture } from '../lib/textures.js';
import { drawText } from '../lib/bitfont.js';

const G = (n) => new THREE.Color(n);

/* ===========================================================
   SYNCOIN — currency, and the oldest thing on the island
   =========================================================== */
/* ===========================================================
   THE COIN BEACON

   Cathy sells a bag of pickled eggs that lets you see money through the
   island. That is drawn here, on the coin itself, rather than by fiddling
   with the coin's own materials: those are shared with half the props, and
   turning depth testing off on them would put the whole island in front of
   itself.

   One material and one geometry for all thirty-eight beacons, made once at
   module load so nothing is ever compiled mid-round.
   =========================================================== */
let _SENSE_MAT = null, _SENSE_GEO = null, _SENSE_TIP = null;
function senseParts() {
  if (_SENSE_MAT) return { mat: _SENSE_MAT, geo: _SENSE_GEO, tip: _SENSE_TIP };
  _SENSE_MAT = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    fog: false, side: THREE.DoubleSide,
  });
  /* A column of light with a hard bright core.

     The first version faded as (1 - f)^2.2 over seven and a half metres,
     which meant the top four-fifths of it was invisible and the whole thing
     read as a small pale smear on the hillside. The point of this is to be
     seen from the other side of the island, so: a nearly linear fade, a
     narrow white-hot core, and a wider soft flank around it. */
  const H = 9.0;
  /* Six segments across, not one.

     The fade is computed per VERTEX, and with a single segment the only x
     values in the geometry are the two edges — so the bright core term was
     evaluated at |x| = half-width every time, came out as zero, and the whole
     column drew at twelve per cent alpha. That is why it read as a faint
     smear rather than a beam. There has to be a vertex in the middle for the
     middle to be bright. */
  const seg = new THREE.PlaneGeometry(1.5, H, 6, 10);
  seg.translate(0, H / 2, 0);
  {
    const pc = seg.attributes.position;
    const cols = new Float32Array(pc.count * 4);
    for (let i = 0; i < pc.count; i++) {
      const f = pc.getY(i) / H;                    // 0 at the foot, 1 at the top
      // 1 in the middle 20 per cent, falling away to 0 at the flanks
      const core = Math.max(0, 1 - Math.abs(pc.getX(i)) / 0.75);
      cols[i * 4] = 1;
      cols[i * 4 + 1] = 0.80 + core * 0.18;
      cols[i * 4 + 2] = 0.34 + core * 0.40;
      cols[i * 4 + 3] = (1 - f * 0.86) * (0.12 + Math.pow(core, 2.2) * 1.05);
    }
    seg.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  }
  _SENSE_GEO = seg;
  // and a diamond floating well clear of the trees, so it is findable at range
  // two segments each way, for the same reason: the middle needs a vertex
  _SENSE_TIP = new THREE.PlaneGeometry(0.9, 0.9, 2, 2);
  _SENSE_TIP.rotateZ(Math.PI / 4);
  _SENSE_TIP.translate(0, 6.0, 0);
  {
    const pc = _SENSE_TIP.attributes.position;
    const cols = new Float32Array(pc.count * 4);
    for (let i = 0; i < pc.count; i++) {
      const r = Math.hypot(pc.getX(i), pc.getY(i) - 6.0) / 0.64;
      cols[i * 4] = 1; cols[i * 4 + 1] = 0.94; cols[i * 4 + 2] = 0.70;
      cols[i * 4 + 3] = Math.max(0, 1 - r) * 1.1;
    }
    _SENSE_TIP.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  }
  return { mat: _SENSE_MAT, geo: _SENSE_GEO, tip: _SENSE_TIP };
}

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

  /* A glow, not a light.

     Every one of the thirty-eight coins on the island used to carry its own
     PointLight. Thirty-eight extra iterations of the lighting loop for
     every lit fragment, and — far worse — the number of lights in a scene
     is baked into the cache key of every shader, so hiding a coin when you
     picked it up made three recompile EVERY material in the scene. That was
     the freeze that arrived every ten or twenty seconds.

     The first replacement was an additive sphere, which read as exactly
     what it was: a ball around the coin. What a coin lying in the grass
     actually does is put a small pool of light on the ground under itself
     and catch the sun on its rim. So: a flat pool below, a soft upright
     gleam that always faces the camera, and four sparkle pips that blink in
     turn. No sphere, and no light. */
  // the pool on the ground
  const poolGeo = new THREE.CircleGeometry(1.15 * s, 22);
  poolGeo.rotateX(-Math.PI / 2);
  {
    // fades to nothing at the rim, so it has no edge
    const pc = poolGeo.attributes.position;
    const cols = new Float32Array(pc.count * 4);
    for (let i = 0; i < pc.count; i++) {
      const d = Math.min(1, Math.hypot(pc.getX(i), pc.getZ(i)) / (1.15 * s));
      cols[i * 4] = 1; cols[i * 4 + 1] = 0.86; cols[i * 4 + 2] = 0.55;
      cols[i * 4 + 3] = Math.pow(Math.max(0, 1 - d), 3.2);
    }
    poolGeo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  }
  const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  }));
  pool.renderOrder = 1;
  g.add(pool);

  /* A soft upright gleam, billboarded so it is never seen edge-on — and a
     DISC with a radial fade, not a square. A flat quad with a uniform
     additive colour is a square of light, which is exactly what it looked
     like. */
  /* Wide and very soft. A tight disc with a fast falloff still has a rim,
     and a rim on a symmetrical shape reads as an orb — which is what it kept
     looking like. This one reaches nearly three times the coin's radius and
     is almost entirely gradient: the brightest part is a small core and the
     rest is a long tail into nothing. Two rings of vertices rather than one
     so the falloff is a curve rather than a straight ramp. */
  const GR = 1.25 * s;
  const gleamGeo = new THREE.CircleGeometry(GR, 28, 0, Math.PI * 2);
  {
    const gc = gleamGeo.attributes.position;
    const cols = new Float32Array(gc.count * 4);
    for (let i = 0; i < gc.count; i++) {
      const d = Math.min(1, Math.hypot(gc.getX(i), gc.getY(i)) / GR);
      cols[i * 4] = 1; cols[i * 4 + 1] = 0.88; cols[i * 4 + 2] = 0.62;
      cols[i * 4 + 3] = Math.pow(Math.max(0, 1 - d), 4.0);
    }
    gleamGeo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  }
  const gleam = new THREE.Mesh(gleamGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    side: THREE.DoubleSide,
  }));
  gleam.renderOrder = 2;
  g.add(gleam);

  // four sparkle pips on the rim
  /* Glints, not squares: a four-point star is two crossed slivers, and at
     this size that is all the eye needs. */
  const pipGeo = new THREE.PlaneGeometry(0.075 * s, 0.075 * s);
  pipGeo.rotateZ(Math.PI / 4);
  const pips = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(pipGeo, new THREE.MeshBasicMaterial({
      color: 0xfff6d0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    }));
    g.add(m);
    pips.push({ m, a: (i / 4) * Math.PI * 2 });
  }

  /* the through-the-island beacon, off until somebody eats something */
  const sp = senseParts();
  const beacon = new THREE.Group();
  beacon.add(new THREE.Mesh(sp.geo, sp.mat));
  beacon.add(new THREE.Mesh(sp.tip, sp.mat));
  beacon.renderOrder = 40;
  beacon.visible = false;
  g.add(beacon);
  g.userData.setSense = (on) => { beacon.visible = !!on; };

  const _up = new THREE.Vector3();
  /* Every coin is nine separate meshes — the body, the pool of light on the
     ground, the upright gleam, four sparkle pips and the two halves of the
     beacon. Thirty-eight coins is over three hundred draw calls, and at
     thirty metres not one of the decorations is more than a pixel.
     Everything but the coin itself is switched off past that, which is a
     third of the island's draw calls back for nothing you can see. Hiding a
     MESH is free — it is hiding a LIGHT that recompiles shaders, and there
     are none here. */
  const DECOR_R2 = 34 * 34;
  let decorOn = true;

  g.userData.tick = (t, dt = 0.016, camPos = null) => {
    if (g.userData.flourish) return;      // the pickup animation owns it

    if (camPos) {
      const dx = camPos.x - g.position.x, dz = camPos.z - g.position.z;
      const near = dx * dx + dz * dz < DECOR_R2;
      if (near !== decorOn) {
        decorOn = near;
        pool.visible = near;
        gleam.visible = near;
        for (const p of pips) p.m.visible = near;
      }
      if (!near) {
        // the body still turns and bobs, because that is what catches the eye
        g.rotation.y = t * 1.9;
        const bob2 = 0.42 + Math.sin(t * 2.4) * 0.13;
        g.position.y = (g.userData.baseY ?? 0) + bob2;
        /* The beacon is meant to be seen from seventy metres, so it still
           has to face you out here — a flat quad seen edge-on is nothing. */
        if (beacon.visible) {
          beacon.position.y = -bob2;
          beacon.rotation.y = Math.atan2(dx, dz) - g.rotation.y;
        }
        return;
      }
    }

    if (beacon.visible) {
      // stood on the ground, not on the bobbing coin, and always facing you
      beacon.position.y = -(g.userData.baseY !== undefined
        ? g.position.y - g.userData.baseY : 0);
      if (camPos) beacon.rotation.y = Math.atan2(camPos.x - g.position.x,
        camPos.z - g.position.z) - g.rotation.y;
      beacon.scale.y = 1 + Math.sin(t * 3.1) * 0.05;
    }
    g.rotation.y = t * 1.9;
    const baseY = g.userData.baseY ?? 0;
    const bob = 0.42 + Math.sin(t * 2.4) * 0.13;
    g.position.y = baseY + bob;

    // the pool stays on the ground however high the coin is bobbing
    pool.position.y = -bob + 0.05;
    pool.material.opacity = 0.26 + Math.sin(t * 2.4) * 0.08;

    /* The gleam faces the camera. The group spins, so the billboard has to
       cancel the group's own rotation as well as aim at the eye. */
    if (camPos) {
      _up.set(camPos.x - g.position.x, 0, camPos.z - g.position.z);
      gleam.rotation.y = Math.atan2(_up.x, _up.z) - g.rotation.y;
      for (const p of pips) gleam.rotation.x = 0;
    }
    gleam.material.opacity = 0.30 + Math.sin(t * 4) * 0.10;

    // the pips wink round the rim, one at a time
    const lead = (t * 1.9) % (Math.PI * 2);
    for (const p of pips) {
      const a2 = p.a;
      p.m.position.set(Math.cos(a2) * 0.30 * s, Math.sin(a2 * 1.3 + t) * 0.10, Math.sin(a2) * 0.30 * s);
      if (camPos) p.m.rotation.y = Math.atan2(_up.x, _up.z) - g.rotation.y;
      // brightest when this pip is on the side the light is coming from
      const d = Math.abs(((a2 - lead + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      p.m.material.opacity = Math.max(0, 0.9 - d * 0.9);
    }
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
    /* TASHA — UNIT 03, on her side where she fell.

       She used to be a lumpy cylinder with an icosahedron for a head, which
       read as scrap rather than as a machine. A thing reads as a robot
       because of its SEAMS: panel lines, a visor rather than a face, joints
       that are obviously joints, and cabling coming out of where it broke.

       Everything below is built in her own space with her lying on her left
       side, head toward +X, and then tipped over as one piece. */
    /* Brighter than she was. She is painted steel lying in a jungle, and
       at the old values she read as a dark lump you walked past — the
       thing that makes a machine legible is CONTRAST between its plates,
       its seams and its joints, and all three were within a shade of each
       other. */
    const STEEL = G(0xd8e0e6), STEEL_D = G(0x8a949c), DARK = G(0x2a3036);
    const BRASS = G(0xd8b464), HAZARD = G(0xe0a828);
    const body = [];

    // ---- the chassis: a panelled box, not a tube ----
    body.push(tint(box(0.52, 0.68, 0.40, 'metal', { pos: [0, 0.34, 0] }), STEEL));
    // panel seams down the front and round the waist
    for (const sy of [0.16, 0.34, 0.52]) {
      body.push(tint(box(0.54, 0.025, 0.42, 'metal', { pos: [0, sy, 0] }), STEEL_D));
    }
    body.push(tint(box(0.045, 0.68, 0.42, 'metal', { pos: [0, 0.34, 0] }), STEEL_D));
    // a chest hatch, hanging open, with the works showing
    body.push(tint(box(0.30, 0.30, 0.03, 'metal', { pos: [0.16, 0.44, 0.22], rot: [0, -0.9, 0] }), STEEL_D));
    body.push(tint(box(0.26, 0.26, 0.06, 'metal', { pos: [0, 0.44, 0.19] }), DARK));
    for (let i = 0; i < 4; i++) {
      body.push(tint(cyl(0.022, 0.022, 0.22, 4, 'metal', {
        pos: [-0.09 + i * 0.06, 0.44, 0.20], rot: [0, 0, 0.1 * i],
      }), i % 2 ? G(0x8a4a2a) : BRASS));
    }
    // shoulders
    for (const sx of [-1, 1]) {
      body.push(tint(box(0.20, 0.20, 0.44, 'metal', { pos: [sx * 0.32, 0.60, 0] }), STEEL_D));
      body.push(tint(cyl(0.11, 0.11, 0.16, 8, 'metal', {
        pos: [sx * 0.34, 0.60, 0], rot: [0, 0, Math.PI / 2],
      }), DARK));
    }
    // hips, and one leg still attached
    body.push(tint(box(0.46, 0.16, 0.38, 'metal', { pos: [0, 0.06, 0] }), STEEL_D));
    body.push(tint(cyl(0.10, 0.10, 0.46, 8, 'metal', { pos: [-0.14, -0.18, 0.02] }), STEEL));
    body.push(tint(cyl(0.11, 0.11, 0.14, 8, 'metal', { pos: [-0.14, -0.42, 0.02], rot: [0, 0, Math.PI / 2] }), DARK));
    body.push(tint(box(0.16, 0.10, 0.30, 'metal', { pos: [-0.14, -0.52, 0.08] }), STEEL_D));
    // the other hip is a torn socket with cable spilling out
    body.push(tint(cyl(0.12, 0.12, 0.08, 8, 'metal', { pos: [0.14, -0.04, 0.02], rot: [0, 0, Math.PI / 2] }), DARK));
    for (let i = 0; i < 5; i++) {
      const a2 = rng() * 6.283;
      body.push(tint(cyl(0.02, 0.02, 0.3 + rng() * 0.3, 4, 'metal', {
        pos: [0.16 + rng() * 0.1, -0.06 - rng() * 0.05, 0.02 + Math.sin(a2) * 0.08],
        rot: [1.2 + rng() * 0.6, a2, 0],
      }), i % 2 ? G(0x8a3a2a) : G(0x2a2e32)));
    }

    /* Hazard chevrons along the flank, in the yellow every piece of plant
       machinery in the world wears. Nothing on this island is that colour
       except her, and it is the fastest way to say MADE. */
    for (let i = 0; i < 4; i++) {
      body.push(tint(box(0.06, 0.12, 0.42, 'metal', {
        pos: [-0.20 + i * 0.13, 0.20, 0.01], rot: [0, 0, 0.5],
      }), i % 2 ? HAZARD : DARK));
    }
    // a maker's plate, riveted on
    body.push(tint(box(0.20, 0.12, 0.03, 'metal', { pos: [-0.14, 0.56, 0.21] }), STEEL_D));
    for (const [rx, ry] of [[-0.22, 0.51], [-0.06, 0.51], [-0.22, 0.61], [-0.06, 0.61]]) {
      body.push(tint(box(0.02, 0.02, 0.02, 'metal', { pos: [rx, ry, 0.23] }), BRASS));
    }
    // a shoulder actuator, exposed, with its rod part way out
    for (const sx of [-1, 1]) {
      body.push(tint(cyl(0.035, 0.035, 0.20, 6, 'metal', {
        pos: [sx * 0.26, 0.48, 0.16], rot: [0.2, 0, sx * 0.3],
      }), BRASS));
      body.push(tint(cyl(0.018, 0.018, 0.12, 4, 'metal', {
        pos: [sx * 0.28, 0.60, 0.19], rot: [0.2, 0, sx * 0.3],
      }), G(0xe8eef2)));
    }

    // ---- the head: a visor, not a face ----
    body.push(tint(cyl(0.09, 0.09, 0.14, 8, 'metal', { pos: [0, 0.74, 0] }), DARK));      // neck
    body.push(tint(box(0.30, 0.28, 0.34, 'metal', { pos: [0, 0.92, 0] }), STEEL));
    body.push(tint(box(0.32, 0.06, 0.36, 'metal', { pos: [0, 1.05, 0] }), STEEL_D));      // crown seam
    // the visor slit, recessed, with a bezel round it
    body.push(tint(box(0.28, 0.13, 0.03, 'metal', { pos: [0, 0.94, 0.175] }), STEEL_D));
    body.push(tint(box(0.24, 0.09, 0.04, 'metal', { pos: [0, 0.94, 0.18] }), G(0x14181c)));
    // a hinged jaw plate, dropped open
    body.push(tint(box(0.22, 0.10, 0.16, 'metal', { pos: [0, 0.80, 0.12], rot: [0.5, 0, 0] }), STEEL_D));
    // an antenna, bent
    body.push(tint(cyl(0.018, 0.018, 0.34, 4, 'metal', { pos: [0.10, 1.18, -0.06], rot: [0.3, 0, 0.2] }), BRASS));
    body.push(tint(ico(0.035, 0, 'metal', { pos: [0.16, 1.32, -0.12] }), G(0xffd24a)));
    // the collar plate, where her number is stamped
    body.push(tint(box(0.26, 0.08, 0.04, 'metal', { pos: [0, 0.70, 0.19] }), BRASS));

    // ---- the arm still reaching ----
    body.push(tint(cyl(0.075, 0.065, 0.38, 6, 'metal', { pos: [0.42, 0.66, 0], rot: [0, 0, -0.9] }), STEEL));
    body.push(tint(cyl(0.09, 0.09, 0.12, 8, 'metal', { pos: [0.58, 0.80, 0], rot: [Math.PI / 2, 0, 0] }), DARK));
    body.push(tint(cyl(0.06, 0.05, 0.34, 6, 'metal', { pos: [0.70, 0.98, -0.06], rot: [0.3, 0, -0.5] }), STEEL));
    // a piston alongside the forearm
    body.push(tint(cyl(0.026, 0.026, 0.26, 4, 'metal', { pos: [0.72, 0.96, 0.04], rot: [0.3, 0, -0.5] }), BRASS));
    // three fingers, open
    for (let i = 0; i < 3; i++) {
      const a2 = -0.4 + i * 0.4;
      body.push(tint(box(0.035, 0.11, 0.035, 'metal', {
        pos: [0.84 + Math.sin(a2) * 0.05, 1.14, -0.10 + Math.cos(a2) * 0.05], rot: [0.5, a2, 0],
      }), STEEL_D));
    }

    /* Her own frame, tipped onto her side. Doing it here rather than
       rotating every part means the anatomy above stays readable. */
    const her = new THREE.Group();
    her.add(new THREE.Mesh(mergeGeos(body), mats.opaque));
    her.rotation.set(0.15, 0.4, 1.42);
    g.add(her);
    /* MEASURE where she ends up, do not guess at it.
       She is built standing and then tipped eighty degrees about two axes,
       so where her lowest corner lands is the product of a rotation nobody
       is going to do in their head — and the two previous guesses left her
       buried to the shoulder and then to the knee. Take the bounding box
       after the rotation and set her down on it. */
    her.position.set(0, 0, 0);
    her.updateMatrixWorld(true);
    {
      const bb = new THREE.Box3().setFromObject(her);
      her.position.y = -bb.min.y + 0.04;
    }
    g.userData.her = her;

    // the number, painted on the collar plate
    {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 16;
      const cx2 = c.getContext('2d');
      cx2.fillStyle = '#8a6a2a'; cx2.fillRect(0, 0, 64, 16);
      drawText(cx2, 'UNIT 03', { x: 32, y: 4, scale: 1, align: 'center', color: '#2a1c08', shadow: false });
      const tx = new THREE.CanvasTexture(c);
      tx.magFilter = THREE.NearestFilter; tx.minFilter = THREE.NearestFilter;
      tx.generateMipmaps = false; tx.colorSpace = THREE.SRGBColorSpace;
      const plate2 = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.065),
        new THREE.MeshLambertMaterial({ map: tx }));
      plate2.position.set(0, 0.70, 0.215);
      her.add(plate2);
    }

    /* ---- her plating, scattered where she came apart ---- */
    const S = [];
    for (let i = 0; i < 9; i++) {
      const a2 = rng() * Math.PI * 2, r = 0.7 + rng() * 1.5;
      const pl = box(0.22 + rng() * 0.16, 0.045, 0.17 + rng() * 0.13, 'metal', {
        pos: [Math.cos(a2) * r, 0.03, Math.sin(a2) * r],
        rot: [(rng() - .5) * .5, rng() * 3, (rng() - .5) * .5],
      });
      tint(pl, G(0xa8b0b6).multiplyScalar(0.75 + rng() * 0.4));
      S.push(pl);
      // a couple of bolts beside each panel, because detail is what sells it
      if (rng() < 0.6) {
        S.push(tint(cyl(0.02, 0.02, 0.03, 5, 'metal', {
          pos: [Math.cos(a2) * r + 0.14, 0.02, Math.sin(a2) * r - 0.1],
          rot: [Math.PI / 2, 0, 0],
        }), BRASS));
      }
    }
    g.add(new THREE.Mesh(mergeGeos(S), mats.opaque));

  } else if (kind === 'aerlingus') {  } else if (kind === 'aerlingus') {
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

  /* Something visible has to change when a castaway works on one of
     these, or "RESTART TASHA'S OPTIC" is a progress bar next to a prop. */
  if (kind === 'tasha') {
    /* One eye light, not two. The first version of this prop added a
       PointLight at full intensity AND defined userData.tick, then this
       block added a second light and overwrote the tick — so her optic
       glowed before anybody had repaired it, and the flicker was dead code.
       There is one light, it starts at zero, and one tick. */
    const eye = new THREE.PointLight(0x6fd0e0, 0, 7, 1.8);
    /* Where her visor actually is once she is lying on her side. It is
       carried on her own frame so it stays with her however she is tipped. */
    const her = g.userData.her;
    const eyeLocal = new THREE.Vector3(0, 0.94, 0.19);
    (her || g).add(eye);
    eye.position.copy(eyeLocal);
    /* The beam is pivoted at the eye, not floating beside it: a cone
       apex-first from the lens, so it reads as light coming OUT of her
       rather than a blue shape that happens to be nearby. */
    const beamPivot = new THREE.Group();
    beamPivot.position.copy(eyeLocal);
    (her || g).add(beamPivot);
    const LEN = 4.2;
    const cone = new THREE.ConeGeometry(0.62, LEN, 9, 1, true);
    // apex at the origin, opening away down +Z
    cone.translate(0, -LEN / 2, 0);
    cone.rotateX(Math.PI / 2);
    const beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({
      color: 0x6fd0e0, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    beamPivot.add(beam);
    // a bright lens right at the source, so the origin is unmistakable
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xcdf6ff, transparent: true, opacity: 0, fog: false })
    );
    beamPivot.add(lens);

    let lit = 0;
    g.userData.setFixed = (on) => { lit = on ? 1 : 0; };
    g.userData.tick = (t) => {
      const flick = lit ? 0.75 + Math.sin(t * 9) * 0.25 : 0;
      eye.intensity = 3.4 * flick;
      beam.material.opacity = 0.17 * flick;
      lens.material.opacity = 0.95 * flick;
      // she sweeps the treeline
      beamPivot.rotation.y = 0.4 + Math.sin(t * 0.55) * 0.75;
      beamPivot.rotation.x = -0.18 + Math.sin(t * 0.31) * 0.07;
    };
  }
  if (kind === 'aerlingus') {
    // a panel that comes off, and the hole it leaves
    const panel = box(1.5, 0.1, 1.1, 'metal', { pos: [0.2, 1.15, 0.1] });
    tint(panel, G(0x9aa6ae));
    const pm = new THREE.Mesh(mergeGeos([panel]), mats.opaque);
    g.add(pm);
    const holeInner = box(1.4, 0.06, 1.0, 'metal', { pos: [0.2, 1.06, 0.1] });
    tint(holeInner, G(0x1a2026));
    const hm = new THREE.Mesh(mergeGeos([holeInner]), mats.opaque);
    hm.visible = false;
    g.add(hm);
    // and the salvage, stacked beside it
    const pile = [];
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const pl = box(0.7 + rng() * 0.4, 0.09, 0.5 + rng() * 0.3, 'metal', {
        pos: [-2.2 + Math.cos(a) * 0.4, 0.10 + i * 0.10, 1.6 + Math.sin(a) * 0.4],
        rot: [0, a, (rng() - 0.5) * 0.14],
      });
      tint(pl, G(0x9aa6ae).multiplyScalar(0.8 + rng() * 0.4));
      pile.push(pl);
    }
    const pileM = new THREE.Mesh(mergeGeos(pile), mats.opaque);
    pileM.visible = false;
    g.add(pileM);
    g.userData.setFixed = (on) => { pm.visible = !on; hm.visible = on; pileM.visible = on; };
  }

  return g;
}

/* ===========================================================
   FERDI STEINMAN'S HUT
   A landmark you can navigate by, and the only shop on the island.
   =========================================================== */
/**
 * @param {(lx:number, lz:number) => number} groundAt  terrain height in the
 *   hut's own space, relative to the hut's origin. Without it the walkway
 *   is a flat plank that ploughs into any slope it runs up.
 */
export function buildFerdiHut(rng, mats, flameFactory, groundAt = () => 0) {
  const group = new THREE.Group();
  const P = [], C = [];
  const WOOD = G(0x7a6242), WOOD_D = G(0x5a4730);

  /* Stilts, because everything here rots. They run well below the origin:
     the clearing is not a table, and a leg that stops at ground level leaves
     the uphill side of the hut buried and the downhill side in mid-air. */
  for (const [sx, sz] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 2.2], [2.6, 2.2]]) {
    const gp = groundAt(sx, sz);
    const len = Math.max(1.2, 1.5 - gp + 1.4);          // deck at 1.5, buried 1.4 below the ground
    const leg = cyl(0.18, 0.24, len, 6, 'driftwood', { pos: [sx, 1.5 - len / 2, sz] });
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

  /* a stack of crates round the side, which is where the collection
     chore actually happens — you take one off the top */
  {
    const crates = [];
    const spots = [[-4.6, -0.6, 0], [-4.6, -0.6, 1], [-4.4, 1.4, 0], [-5.0, -2.4, 0], [-4.2, 0.4, 2]];
    for (const [cx2, cz2, lvl] of spots) {
      const y = 0.55 + lvl * 1.05;
      const bx2 = box(1.0, 0.95, 1.0, 'planks', { pos: [cx2, y, cz2], rot: [0, (rng() - 0.5) * 0.5, 0] });
      tint(bx2, G(0x9a7a4c).multiplyScalar(0.82 + rng() * 0.35));
      crates.push(bx2);
      // slats, so they read as crates and not blocks
      for (const dy of [-0.3, 0.3]) {
        const sl = box(1.06, 0.12, 1.06, 'planks', { pos: [cx2, y + dy, cz2], rot: [0, (rng() - 0.5) * 0.5, 0] });
        tint(sl, G(0x6a5230)); crates.push(sl);
      }
    }
    const stack = new THREE.Mesh(mergeGeos(crates), mats.opaque);
    group.add(stack);
    group.userData.crates = stack;
    // the one you take, on its own so it can vanish
    const one = [];
    const top = box(1.0, 0.95, 1.0, 'planks', { pos: [-4.4, 2.55, 0.5], rot: [0, 0.3, 0] });
    tint(top, G(0xb08a58)); one.push(top);
    for (const dy of [-0.3, 0.3]) {
      const sl = box(1.06, 0.12, 1.06, 'planks', { pos: [-4.4, 2.55 + dy, 0.5], rot: [0, 0.3, 0] });
      tint(sl, G(0x7a5f38)); one.push(sl);
    }
    const loose = new THREE.Mesh(mergeGeos(one), mats.opaque);
    group.add(loose);
    group.userData.crate = loose;
  }

  /* the sign, hanging off one nail */
  const signBoard = box(3.4, 1.1, 0.12, 'planks', { pos: [-0.4, 5.35, 2.5], rot: [0, 0, -0.22] });
  tint(signBoard, G(0x9a8058)); P.push(signBoard);
  const nail = cyl(0.05, 0.05, 0.3, 4, 'metal', { pos: [1.15, 5.75, 2.5], rot: [Math.PI / 2, 0, 0] });
  tint(nail, G(0x6a6a66)); P.push(nail);

  /* --- a proper shopfront: boardwalk, steps, awning, hanging wares --- */
  /* A staircase down from the deck, then a flat landing. Overlapping
     planks at slightly different heights read as a skewed heap and
     z-fight; risers and treads read as stairs. */
  const STEPS = 5, RISE = 0.30, TREAD = 0.85;
  const deckY = 1.5;
  for (let i = 0; i < STEPS; i++) {
    const z = 3.0 + i * TREAD;
    const top = deckY - (i + 1) * RISE;
    // tread
    const tr = box(5.4, 0.16, TREAD + 0.06, 'planks', { pos: [0, top, z] });
    tint(tr, WOOD.clone().multiplyScalar(0.86 + rng() * 0.2)); P.push(tr);
    // riser, closing the gap to the step above so you cannot see under it
    const rs = box(5.4, RISE + 0.1, 0.16, 'planks', {
      pos: [0, top - RISE / 2 + 0.05, z - TREAD / 2],
    });
    tint(rs, WOOD_D.clone().multiplyScalar(0.9 + rng() * 0.2)); P.push(rs);
    // stringers either side, buried at the bottom
    for (const sx of [-2.8, 2.8]) {
      const gp = groundAt(sx, z);
      const len = Math.max(0.6, top - gp + 1.2);
      const post = cyl(0.13, 0.16, len, 5, 'driftwood', { pos: [sx, top - len / 2 + 0.08, z] });
      tint(post, WOOD_D); P.push(post);
    }
  }
  // a landing that meets whatever the ground is doing out front
  {
    const z0 = 3.0 + STEPS * TREAD;
    const g0 = groundAt(0, z0 + 0.9);
    const y0 = Math.max(g0 + 0.12, deckY - (STEPS + 1) * RISE);
    const pad = box(5.4, 0.16, 2.0, 'planks', { pos: [0, y0, z0 + 0.9] });
    tint(pad, WOOD.clone().multiplyScalar(0.78)); P.push(pad);
    for (const sx of [-2.5, 2.5]) {
      const gp = groundAt(sx, z0 + 0.9);
      const len = Math.max(0.6, y0 - gp + 1.2);
      const post = cyl(0.12, 0.15, len, 5, 'driftwood', { pos: [sx, y0 - len / 2 + 0.08, z0 + 0.9] });
      tint(post, WOOD_D); P.push(post);
    }
  }
  /* Banisters down the steps. The rail has to FALL with the treads: a bar
     pitched the other way reads as crooked, which is exactly what it was.
     Newel posts sit on the tread they belong to, so nothing floats. */
  {
    const PITCH = Math.atan2(RISE, TREAD);          // 0.34 rad, the stair angle
    for (const sx of [-2.85, 2.85]) {
      // a post per step, each standing on its own tread
      for (let i = 0; i <= STEPS; i++) {
        const z = 3.0 + i * TREAD;
        const treadY = deckY - i * RISE;
        const h = 1.05;
        const post = cyl(0.085, 0.105, h, 5, 'driftwood', { pos: [sx, treadY + h / 2, z] });
        tint(post, WOOD_D); P.push(post);
      }
      // the handrail, running from the top post to the bottom one
      const zTop = 3.0, zBot = 3.0 + STEPS * TREAD;
      const yTop = deckY + 1.05, yBot = deckY - STEPS * RISE + 1.05;
      const run = Math.hypot(zBot - zTop, yBot - yTop);
      const bar = cyl(0.06, 0.06, run + 0.2, 5, 'driftwood', {
        pos: [sx, (yTop + yBot) / 2, (zTop + zBot) / 2],
        rot: [Math.PI / 2 + PITCH, 0, 0],
      });
      tint(bar, WOOD_D); P.push(bar);
    }
  }

  /* The awning. It used to be a fan of slats that drooped at the ends and
     pitched down through its own poles; you were looking at the underside of
     a broken umbrella. Now it is a flat canvas with a gentle forward fall,
     and the poles are cut to meet its leading edge exactly. */
  {
    const BACK_Y = 4.25, FRONT_Y = 3.78;            // a shallow, deliberate fall
    const Z0 = 2.6, Z1 = 4.9;
    const SPAN = Z1 - Z0;
    const drop = BACK_Y - FRONT_Y;
    const pitch = Math.atan2(drop, SPAN);
    const midY = (BACK_Y + FRONT_Y) / 2, midZ = (Z0 + Z1) / 2;
    const sheetLen = Math.hypot(SPAN, drop);
    for (let i = 0; i < 8; i++) {
      // even stripes, all in the same plane — no per-slat height wobble
      const x = -3.06 + i * 0.875;
      const aw = box(0.885, 0.09, sheetLen, 'sail', {
        pos: [x, midY, midZ], rot: [-pitch, 0, 0],
      });
      tint(aw, i % 2 ? G(0xd6cbaa) : G(0xa8563c)); P.push(aw);
    }
    // a scalloped valance hanging off the front lip
    for (let i = 0; i < 8; i++) {
      const x = -3.06 + i * 0.875;
      const v = box(0.885, 0.30, 0.07, 'sail', { pos: [x, FRONT_Y - 0.17, Z1 - 0.04] });
      tint(v, i % 2 ? G(0xc6bb9a) : G(0x994d35)); P.push(v);
    }
    // the front bar, and poles that stop under it rather than through it
    const barY = FRONT_Y - 0.06;
    const bar = cyl(0.055, 0.055, 6.5, 5, 'driftwood', {
      pos: [0, barY, Z1 - 0.04], rot: [0, 0, Math.PI / 2],
    });
    tint(bar, WOOD_D); P.push(bar);
    for (const sx of [-3.15, 3.15]) {
      const foot = deckY + 0.14;                    // stands on the deck
      const h = barY - foot;
      const pole = cyl(0.075, 0.095, h, 5, 'driftwood', { pos: [sx, foot + h / 2, Z1 - 0.04] });
      tint(pole, WOOD_D); P.push(pole);
      // a diagonal brace back to the wall, so it does not look propped up
      const bh = Math.hypot(Z1 - 2.4, 0.9);
      const br = cyl(0.04, 0.04, bh, 4, 'driftwood', {
        pos: [sx, barY - 0.45, (Z1 + 2.4) / 2],
        rot: [Math.PI / 2 - Math.atan2(0.9, Z1 - 2.4), 0, 0],
      });
      tint(br, WOOD_D); P.push(br);
    }
    group.userData.awningFront = { y: FRONT_Y, z: Z1 };
  }
  // wares hanging off the awning bar
  for (let i = 0; i < 8; i++) {
    const hx = -2.7 + i * 0.78;
    const len = 0.34 + rng() * 0.4;
    const top = 3.66;                       // just under the awning bar
    const str = cyl(0.02, 0.02, len, 4, 'rope', { pos: [hx, top - len / 2, 4.82] });
    tint(str, G(0x8a7a58)); P.push(str);
    const kind = rng();
    let item;
    if (kind < 0.4) {
      item = ico(0.16, 0, 'coconut', { pos: [hx, top - len - 0.14, 4.82] });
      tint(item, G(0x9c7c50));
    } else if (kind < 0.7) {
      item = box(0.14, 0.34, 0.14, 'driftwood', { pos: [hx, top - len - 0.18, 4.82] });
      tint(item, G(0xc4b494));
    } else {
      item = cyl(0.11, 0.09, 0.3, 6, 'glass', { pos: [hx, top - len - 0.16, 4.82] });
      tint(item, G(0x8ab0a0));
    }
    P.push(item);
  }
  // fishing net slung across one gable
  for (let i = 0; i < 9; i++) {
    const nx = -2.4 + i * 0.6;
    const n1 = cyl(0.018, 0.018, 2.2, 4, 'rope', { pos: [nx, 3.1, -2.62], rot: [0, 0, 0.12] });
    tint(n1, G(0x9a8a66)); P.push(n1);
  }
  for (let i = 0; i < 5; i++) {
    const n2 = cyl(0.018, 0.018, 5.4, 4, 'rope', { pos: [0, 2.3 + i * 0.42, -2.62], rot: [0, 0, Math.PI / 2] });
    tint(n2, G(0x9a8a66)); P.push(n2);
  }
  // a barrel and a stack of crates on the deck
  const barrel = cyl(0.42, 0.48, 1.0, 9, 'planks', { pos: [2.2, 2.0, 1.4] });
  tint(barrel, G(0x6f5a3a)); P.push(barrel);
  for (let i = 0; i < 2; i++) {
    const hoop = cyl(0.44, 0.44, 0.08, 9, 'metal', { pos: [2.2, 1.75 + i * 0.55, 1.4] });
    tint(hoop, G(0x6a6a60)); P.push(hoop);
  }
  // a hammock strung in the back corner
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const sag = Math.sin(t * Math.PI) * 0.42;
    const hm = box(1.5, 0.07, 0.22, 'clothTat', { pos: [-1.9, 2.9 - sag, -1.9 + t * 1.4], rot: [0, 0, 0] });
    tint(hm, G(0x8a7f62)); P.push(hm);
  }

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

  // a storm lantern hanging over the counter, and its flame
  const lantern = flameFactory ? null : null;
  const frontLight = new THREE.PointLight(0xffc070, 2.4, 20, 1.6);
  frontLight.position.set(0, 3.5, 4.2);
  group.add(frontLight);
  group.userData.frontLight = frontLight;

  group.userData.tick = (t) => {
    ferdy.position.y = 1.78 + Math.sin(t * 1.1) * 0.03;
    ferdy.rotation.y = Math.sin(t * 0.42) * 0.28;
    lampLight.intensity = 1.7 + Math.sin(t * 8.3) * 0.35 + Math.sin(t * 3.1) * 0.2;
    frontLight.intensity = 2.0 + Math.sin(t * 6.1) * 0.4;
  };
  return group;
}

/* ===========================================================
   CUTSCENE STAGE — figures that only exist for the opening.
   A little pocket set built off in the dark at y = -400, so the
   camera can cut to it without disturbing the island.
   =========================================================== */
export function buildIntroStage(rng, mats, flameFactory) {
  const stage = new THREE.Group();
  stage.position.set(0, -400, 0);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x04050a, fog: false });

  /* =========================================================
     SET A — THE THRONE (x ≈ 0): King Illic on his seat, and the
     Agents closing in around him out of the dark.
     ========================================================= */
  const throneSet = new THREE.Group();
  stage.add(throneSet);

  {
    const P = [];
    // a heavy stone seat on a stepped plinth
    for (let i = 0; i < 3; i++) {
      P.push(tint(box(7 - i * 1.4, 0.5, 6 - i * 1.2, 'templeStone',
        { pos: [0, 0.25 + i * 0.5, 0] }), G(0x6f6a58)));
    }
    P.push(tint(box(2.6, 0.6, 2.4, 'templeStone', { pos: [0, 1.8, 0] }), G(0x7d7867)));
    P.push(tint(box(2.6, 4.0, 0.5, 'templeStone', { pos: [0, 3.6, -1.1] }), G(0x6f6a58)));
    for (const sx of [-1, 1]) {
      P.push(tint(box(0.5, 1.6, 2.4, 'templeStone', { pos: [sx * 1.3, 2.5, 0] }), G(0x6f6a58)));
      P.push(tint(cyl(0.28, 0.34, 5.5, 8, 'templeGlyph', { pos: [sx * 3.4, 2.75, -0.6] }), G(0xa89c80)));
    }
    throneSet.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
  }

  // the king: a seated silhouette, crowned
  const king = new THREE.Group();
  {
    const K = [];
    K.push(blankUV(new THREE.LatheGeometry([
      [0.00, 0.00], [0.46, 0.04], [0.52, 0.5], [0.46, 0.95], [0.24, 1.2], [0.00, 1.25],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 8), 'monolith'));
    const kh = new THREE.SphereGeometry(0.26, 8, 6); kh.translate(0, 1.42, 0);
    K.push(blankUV(kh, 'monolith'));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      K.push(blankUV(new THREE.BoxGeometry(0.07, 0.26, 0.07)
        .translate(Math.cos(a) * 0.24, 1.72, Math.sin(a) * 0.24), 'monolith'));
    }
    for (const sx of [-1, 1]) K.push(limb([sx * 0.34, 1.0, 0], [sx * 0.42, 0.42, 0.42], 0.09, 0.07));
    king.add(new THREE.Mesh(mergeGeos(K), shadowMat));
    king.position.set(0, 2.4, 0);
    throneSet.add(king);
  }
  // a cold rim light so he reads against the black
  const kingRim = new THREE.PointLight(0xbfd0ff, 2.2, 14, 1.8);
  kingRim.position.set(0, 4.6, 3.2);
  throneSet.add(kingRim);

  /* the Agents: six silhouettes, red eyes, closing in */
  const AGENT = [];
  for (let i = 0; i < 6; i++) {
    const a = new THREE.Group();
    const P = [];
    const coat = new THREE.LatheGeometry([
      [0.00, 0.00], [0.34, 0.02], [0.40, 0.55], [0.36, 1.05],
      [0.28, 1.35], [0.14, 1.50], [0.00, 1.53],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 7);
    blankUV(coat, 'monolith'); P.push(coat);
    const hood = new THREE.SphereGeometry(0.26, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.72);
    hood.translate(0, 1.46, 0.02);
    blankUV(hood, 'monolith'); P.push(hood);
    for (const sgn of [-1, 1]) P.push(limb([sgn * 0.30, 1.20, 0], [sgn * 0.34, 0.55, 0.10], 0.08, 0.06));
    P.push(limb([0.34, 0.55, 0.10], [0.62, 0.30, 0.55], 0.035, 0.015));   // blade
    a.add(new THREE.Mesh(mergeGeos(P), shadowMat));
    const ang = (i / 6) * Math.PI * 2;
    a.userData.ang = ang;
    a.userData.phase = rng() * 6;
    a.position.set(Math.cos(ang) * 11, 0, Math.sin(ang) * 11);
    const eye = new THREE.PointLight(0xff3a2a, 1.0, 5, 2);
    eye.position.set(0, 1.46, 0.22);
    a.add(eye);
    a.userData.eye = eye;
    throneSet.add(a);
    AGENT.push(a);
  }

  /* =========================================================
     SET B — THE POUR (x = -60): the Idol on a plinth in fog,
     lit from below, the Agents' work finished.
     ========================================================= */
  const idolSet = new THREE.Group();
  idolSet.position.set(-220, 0, 0);
  stage.add(idolSet);
  {
    const P = [];
    for (let i = 0; i < 3; i++) {
      P.push(tint(cyl(2.4 - i * 0.4, 2.8 - i * 0.4, 0.5, 12, 'templeStone',
        { pos: [0, 0.25 + i * 0.5, 0] }), G(0x6f6a58)));
    }
    // four braziers around it
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.7;
      P.push(tint(cyl(0.4, 0.24, 0.4, 8, 'goldDark',
        { pos: [Math.cos(a) * 4.4, 1.9, Math.sin(a) * 4.4] }), G(0xc8a44c)));
      P.push(tint(cyl(0.14, 0.18, 1.8, 6, 'templeStone',
        { pos: [Math.cos(a) * 4.4, 0.9, Math.sin(a) * 4.4] }), G(0x5f5a49)));
    }
    idolSet.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.7;
      const f = flameFactory(mats, 3, 0.34);
      f.position.set(Math.cos(a) * 4.4, 2.05, Math.sin(a) * 4.4);
      idolSet.add(f);
      const l = new THREE.PointLight(0xffb050, 1.5, 14, 1.7);
      l.position.set(Math.cos(a) * 4.4, 2.6, Math.sin(a) * 4.4);
      idolSet.add(l);
    }
  }
  const fogMat = new THREE.MeshBasicMaterial({
    color: 0x8fa098, transparent: true, opacity: 0.17,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const fogQuads = [];
  for (let i = 0; i < 22; i++) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(7 + rng() * 7, 3 + rng() * 3), fogMat);
    q.position.set((rng() - 0.5) * 14, 0.5 + rng() * 3.8, 2 + rng() * 6);
    q.userData.sp = 0.5 + rng() * 1.1;
    idolSet.add(q);
    fogQuads.push(q);
  }
  const idolKey = new THREE.PointLight(0xffd88a, 3.4, 22, 1.5);
  idolKey.position.set(0, 1.4, 2.4);
  idolSet.add(idolKey);
  stage.userData.idolSet = idolSet;

  /* =========================================================
     SET C — THE ARRIVAL (x = +60): Hector's boat on open water.
     ========================================================= */
  const boatSet = new THREE.Group();
  boatSet.position.set(220, 0, 0);
  stage.add(boatSet);

  // a patch of sea so he isn't sailing on nothing
  {
    const sea = new THREE.PlaneGeometry(120, 120, 24, 24);
    sea.rotateX(-Math.PI / 2);
    blankUV(sea, 'water');
    const seaMesh = new THREE.Mesh(
      mergeGeos([tint(sea, G(0x24404e))]),
      mats.opaque);
    seaMesh.position.y = -0.4;
    boatSet.add(seaMesh);
    boatSet.userData.sea = seaMesh;
  }

  const boat = new THREE.Group();
  {
    const B = [];
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const w = 1.6 * Math.sin(Math.PI * (0.18 + t * 0.72));
      for (const sgn of [-1, 1]) {
        B.push(tint(box(0.18, 0.8, 1.0, 'planks', {
          pos: [sgn * w, 0.4, (t - 0.5) * 7.4], rot: [0, 0, sgn * 0.34],
        }), G(0x7d6440)));
      }
    }
    B.push(tint(box(1.4, 0.22, 7.2, 'planks', { pos: [0, 0.12, 0] }), G(0x6f5a3a)));
    B.push(tint(cyl(0.10, 0.14, 5.0, 5, 'planks', { pos: [0, 2.6, -0.6] }), G(0x7a6340)));
    B.push(tint(cyl(0.07, 0.08, 2.4, 4, 'planks', { pos: [0, 4.4, -0.6], rot: [0, 0, Math.PI / 2] }), G(0x7a6340)));
    boat.add(new THREE.Mesh(mergeGeos(B), mats.opaque));
    const sail = plane(3.0, 3.4, 'sail', { pos: [0, 3.0, -0.45] });
    tint(sail, G(0xcabfa0));
    boat.add(new THREE.Mesh(mergeGeos([sail]), mats.cutoutStill));

    // Hector at the tiller: bulky, crowned, unmistakable
    const HB = [];
    HB.push(blankUV(new THREE.LatheGeometry([
      [0.00, 0.00], [0.62, 0.05], [0.72, 0.55], [0.62, 1.0], [0.3, 1.28], [0.00, 1.34],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 8), 'monolith'));
    const hh = new THREE.SphereGeometry(0.32, 7, 5); hh.translate(0, 1.52, 0);
    HB.push(blankUV(hh, 'monolith'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      HB.push(blankUV(new THREE.BoxGeometry(0.08, 0.28, 0.08)
        .translate(Math.cos(a) * 0.28, 1.86, Math.sin(a) * 0.28), 'monolith'));
    }
    HB.push(limb([0.5, 1.0, 0], [1.0, 1.9, -0.3], 0.10, 0.07));    // arm up on the staff
    const hect = new THREE.Mesh(mergeGeos(HB), shadowMat);
    hect.position.set(0, 0.3, 2.4);
    boat.add(hect);
    // his staff, already lit
    const staff = new THREE.Mesh(
      mergeGeos([tint(cyl(0.07, 0.09, 4.4, 5, 'driftwood', { pos: [0, 2.2, 0] }), G(0xb8a684))]),
      mats.opaque);
    staff.position.set(1.05, 0.3, 2.1);
    staff.rotation.z = -0.2;
    boat.add(staff);
    const orb = new THREE.Mesh(
      mergeGeos([tint(ico(0.3, 1, 'staffGem', { pos: [0, 4.5, 0] }), G(0xffe08a))]),
      new THREE.MeshBasicMaterial({ map: mats.opaque.map, vertexColors: true, fog: false }));
    orb.position.copy(staff.position);
    orb.rotation.z = -0.2;
    boat.add(orb);
    const orbLight = new THREE.PointLight(0xffc850, 3.0, 20, 1.7);
    orbLight.position.set(1.9, 4.7, 2.1);
    boat.add(orbLight);
    boat.userData.orbLight = orbLight;
  }
  boat.position.set(0, 0, 0);
  boatSet.add(boat);
  stage.userData.boat = boat;

  /* ---------- per-frame ---------- */
  const flames = [];
  stage.traverse((o) => { if (o.userData?.tick && o !== stage) flames.push(o); });

  stage.userData.closeIn = 0;          // 0 = Agents far, 1 = on top of him
  stage.userData.tick = (t, dt, cam) => {
    for (const f of flames) f.userData.tick(t, dt);

    const k = stage.userData.closeIn;
    for (const a of AGENT) {
      const r = THREE.MathUtils.lerp(11, 2.6, k);
      a.position.x = Math.cos(a.userData.ang) * r;
      a.position.z = Math.sin(a.userData.ang) * r;
      a.position.y = Math.abs(Math.sin(t * 2.6 + a.userData.phase)) * 0.10;
      a.rotation.y = -a.userData.ang + Math.PI / 2 + Math.sin(t * 0.7 + a.userData.phase) * 0.12;
      a.userData.eye.intensity = (0.5 + Math.sin(t * 7 + a.userData.phase) * 0.35) * (0.4 + k);
    }
    king.rotation.y = Math.sin(t * 0.5) * 0.10;
    kingRim.intensity = 2.2 * (1 - k * 0.75);

    for (const q of fogQuads) {
      q.position.x += q.userData.sp * dt;
      if (q.position.x > 9) q.position.x = -9;
      if (cam) q.lookAt(cam.position);
    }
    idolKey.intensity = 3.0 + Math.sin(t * 2.2) * 0.7;

    boat.position.y = Math.sin(t * 1.05) * 0.24;
    boat.rotation.z = Math.sin(t * 0.85) * 0.055;
    boat.rotation.x = Math.sin(t * 1.25 + 1) * 0.04;
    boat.userData.orbLight.intensity = 2.6 + Math.sin(t * 5) * 0.6;
  };
  return stage;
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
      /* Fast in, slow out. A sabotage that takes eight seconds to become
         visible is a sabotage nobody notices. */
      const rate = target > state.strength ? 1.4 : 0.5;
      state.strength += (target - state.strength) * Math.min(1, dt * rate);
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
