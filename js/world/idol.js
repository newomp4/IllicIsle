/* ===========================================================
   idol.js — THE GOLDEN IDOL OF CHRIS ILLIC
   Built to match the reference bust: curly crown, hood up behind
   the neck, CATHOLIC UNIVERSITY across the chest, hands in the
   pouch, hibiscus-and-frond wreath, ISLA DORADA plinth.
   Roughly 2.5 units tall at scale 1.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import {
  mergeGeos, cyl, ico, place, tint, limb, arcPanel, facePatch,
} from '../lib/geo.js';
import { applyCell, applyRegion, CELLS, makeRng, buildChestTexture, buildBaseBandTexture } from '../lib/textures.js';

const GOLD = new THREE.Color(0xffdf92);
const GOLD_MID = new THREE.Color(0xf0c664);
const GOLD_DK = new THREE.Color(0xcf9c3c);
const GOLD_LT = new THREE.Color(0xfff6d2);

/* Cast metal wants a bright diffuse, a hot specular and enough self-glow
   that it still reads as gold in the dark of the sanctum. */
const GOLD_MAT = { specular: 0xcdb184, shininess: 26, emissive: 0x6b4e12 };

export function buildIdolMaterials(atlas) {
  const gold = ps1ify(new THREE.MeshPhongMaterial({
    map: atlas, vertexColors: true, ...GOLD_MAT,
  }), { flat: true });

  const goldSmooth = ps1ify(new THREE.MeshPhongMaterial({
    map: atlas, vertexColors: true, ...GOLD_MAT, shininess: 32,
  }), { flat: false });

  const band = ps1ify(new THREE.MeshPhongMaterial({
    map: buildBaseBandTexture(), ...GOLD_MAT,
  }), { flat: false });

  const chest = ps1ify(new THREE.MeshPhongMaterial({
    map: buildChestTexture(), ...GOLD_MAT, side: THREE.DoubleSide,
  }), { flat: false });

  return { gold, goldSmooth, band, chest };
}

/**
 * @param {object} mats from buildIdolMaterials
 * @param {object} opts { curls: number }
 */
export function buildIdol(mats, opts = {}) {
  const rng = makeRng(opts.seed ?? 8891);
  const curlCount = opts.curls ?? 58;
  const group = new THREE.Group();
  const P = []; // faceted gold parts
  const S = []; // smooth gold parts

  /* ==========================================================
     1. PLINTH
     ========================================================== */
  const rimBot = cyl(0.98, 1.02, 0.14, 14, 'gold', { pos: [0, 0.07, 0] });
  tint(rimBot, GOLD_DK); P.push(rimBot);

  const rimTop = cyl(1.00, 0.96, 0.12, 14, 'gold', { pos: [0, 0.62, 0] });
  tint(rimTop, GOLD_MID); P.push(rimTop);

  const lip = cyl(0.90, 0.99, 0.09, 14, 'gold', { pos: [0, 0.15, 0] });
  tint(lip, GOLD_MID); P.push(lip);

  // The engraved band gets its own texture so ISLA DORADA is legible.
  const bandGeo = new THREE.CylinderGeometry(0.93, 0.93, 0.42, 16, 1, true);
  const bandMesh = new THREE.Mesh(bandGeo, mats.band);
  bandMesh.position.y = 0.38;
  group.add(bandMesh);

  /* ==========================================================
     2. WREATH — fronds and hibiscus around the base of the bust
     ========================================================== */
  const LEAVES = 9;
  for (let i = 0; i < LEAVES; i++) {
    const a = (i / LEAVES) * Math.PI * 2 + 0.2;
    const len = 0.52 + rng() * 0.26;
    const wid = 0.20 + rng() * 0.10;

    // a leaf blade: flattened, tapered, tilted outward
    const blade = new THREE.CylinderGeometry(0.005, wid, len, 4, 2);
    applyCell(blade, 'gold');
    blade.scale(1, 1, 0.34);
    blade.translate(0, len / 2, 0);
    // curl the tip down
    const p = blade.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = p.getY(v) / len;
      p.setY(v, p.getY(v) - t * t * len * 0.35);
    }
    p.needsUpdate = true;
    blade.computeVertexNormals();

    place(blade, {
      rot: [1.15 + rng() * 0.3, -a, 0],
      pos: [Math.cos(a) * 0.62, 0.68, Math.sin(a) * 0.62],
    });
    tint(blade, rng() < 0.5 ? GOLD_MID : GOLD);
    P.push(blade);
  }

  // three hibiscus blooms, front and sides
  for (const fa of [-0.55, 0.28, 1.9, 3.6]) {
    const fx = Math.cos(fa) * 0.66, fz = Math.sin(fa) * 0.66;
    for (let pIdx = 0; pIdx < 5; pIdx++) {
      const pa = (pIdx / 5) * Math.PI * 2;
      const petal = new THREE.SphereGeometry(0.13, 5, 4);
      applyCell(petal, 'gold');
      petal.scale(1, 0.32, 1.25);
      place(petal, {
        rot: [0.25, -fa, 0],
        pos: [fx + Math.cos(pa) * 0.11, 0.75, fz + Math.sin(pa) * 0.11],
      });
      tint(petal, GOLD_LT);
      P.push(petal);
    }
    const center = ico(0.055, 0, 'gold', { pos: [fx, 0.79, fz] });
    tint(center, GOLD_DK); P.push(center);
    const stamen = cyl(0.012, 0.02, 0.16, 4, 'gold', { pos: [fx, 0.85, fz + 0.04], rot: [-0.4, 0, 0] });
    tint(stamen, GOLD_LT); P.push(stamen);
  }

  /* ==========================================================
     3. TORSO — hoodie, lathed for sloping shoulders
     ========================================================== */
  const profile = [
    [0.00, 0.66], [0.575, 0.66], [0.615, 0.78], [0.625, 0.95],
    [0.610, 1.12], [0.575, 1.28], [0.515, 1.42], [0.425, 1.53],
    [0.300, 1.61], [0.190, 1.65], [0.000, 1.66],
  ].map(([r, y]) => new THREE.Vector2(r, y));

  const torso = new THREE.LatheGeometry(profile, 14);
  applyCell(torso, 'gold');
  torso.scale(1, 1, 0.86);
  tint(torso, GOLD);
  S.push(torso);

  // hem lip at the cut-off
  const hem = cyl(0.60, 0.585, 0.10, 14, 'gold', { pos: [0, 0.68, 0] });
  hem.scale(1, 1, 0.86);
  tint(hem, GOLD_MID); P.push(hem);

  /* chest logo panel — sits just proud of the lathe so it never z-fights */
  const chestGeo = arcPanel(0.655, 0.50, 1.40, 12);
  chestGeo.scale(1, 1, 0.90);
  chestGeo.translate(0, 1.14, 0.02);
  const chestMesh = new THREE.Mesh(chestGeo, mats.chest);
  group.add(chestMesh);

  /* kangaroo pouch */
  const pouch = arcPanel(0.665, 0.30, 1.5, 12);
  applyCell(pouch, 'gold');
  pouch.scale(1, 1, 0.90);
  pouch.translate(0, 0.83, 0.02);
  tint(pouch, GOLD_MID); P.push(pouch);

  const pouchLip = arcPanel(0.675, 0.05, 1.55, 12);
  applyCell(pouchLip, 'gold');
  pouchLip.scale(1, 1, 0.90);
  pouchLip.translate(0, 0.99, 0.02);
  tint(pouchLip, GOLD_DK); P.push(pouchLip);

  /* ==========================================================
     4. ARMS — down and in, hands buried in the pouch
     ========================================================== */
  for (const side of [-1, 1]) {
    // The lathe is ~0.58 wide at shoulder height, so the arm chain has to
    // start outside that or it disappears into the body.
    const shoulder = [side * 0.58, 1.40, 0.02];
    const elbow = [side * 0.67, 1.02, 0.12];
    const wrist = [side * 0.46, 0.82, 0.34];
    const hand = [side * 0.22, 0.80, 0.50];

    const upper = limb(shoulder, elbow, 0.22, 0.185, 'gold');
    tint(upper, GOLD); P.push(upper);
    const fore = limb(elbow, wrist, 0.185, 0.145, 'gold');
    tint(fore, GOLD); P.push(fore);
    const cuff = limb(wrist, hand, 0.15, 0.13, 'gold');
    tint(cuff, GOLD_MID); P.push(cuff);

    // shoulder cap so the joint doesn't read as a stick
    const cap = ico(0.235, 0, 'gold', { pos: shoulder });
    tint(cap, GOLD); P.push(cap);
    const elb = ico(0.185, 0, 'gold', { pos: elbow });
    tint(elb, GOLD); P.push(elb);
  }

  /* ==========================================================
     5. HOOD + NECK + DRAWSTRINGS
     ========================================================== */
  const neck = cyl(0.175, 0.20, 0.20, 8, 'gold', { pos: [0, 1.70, 0.01] });
  tint(neck, GOLD_MID); P.push(neck);

  // the hood lying back behind the shoulders
  const hood = new THREE.SphereGeometry(0.46, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  applyCell(hood, 'gold');
  hood.scale(1.12, 0.80, 0.96);
  place(hood, { rot: [-0.55, 0, 0], pos: [0, 1.58, -0.28] });
  tint(hood, GOLD_MID); S.push(hood);

  // the bunched roll where the hood gathers on the shoulders
  for (let i = 0; i < 9; i++) {
    const a = -1.5 + (i / 8) * 3.0;
    const r = 0.42;
    const b = ico(0.115 + rng() * 0.035, 0, 'gold', {
      pos: [Math.sin(a) * r, 1.56 + Math.cos(a) * 0.06, -0.30 - Math.abs(Math.sin(a)) * 0.05],
      rot: [rng() * 3, rng() * 3, rng() * 3],
      scale: [1.15, 0.85, 1],
    });
    tint(b, i % 2 ? GOLD_MID : GOLD);
    P.push(b);
  }

  // bunched collar ring
  const collar = new THREE.TorusGeometry(0.30, 0.105, 5, 12);
  applyCell(collar, 'gold');
  place(collar, { rot: [Math.PI / 2 - 0.22, 0, 0], pos: [0, 1.63, -0.03] });
  collar.scale(1.12, 1, 1);
  tint(collar, GOLD_MID); P.push(collar);

  // hood front lip, sitting proud of the collar
  const lip2 = new THREE.TorusGeometry(0.33, 0.075, 5, 12, Math.PI * 1.25);
  applyCell(lip2, 'gold');
  place(lip2, { rot: [Math.PI / 2 - 0.3, 0, Math.PI * 0.86], pos: [0, 1.66, -0.10] });
  tint(lip2, GOLD_LT); P.push(lip2);

  // drawstrings
  for (const side of [-1, 1]) {
    const top = [side * 0.13, 1.60, 0.34];
    const mid = [side * 0.155, 1.34, 0.50];
    const end = [side * 0.14, 1.08, 0.52];
    const s1 = limb(top, mid, 0.026, 0.026, 'gold');
    tint(s1, GOLD_LT); P.push(s1);
    const s2 = limb(mid, end, 0.026, 0.024, 'gold');
    tint(s2, GOLD_LT); P.push(s2);
    const aglet = cyl(0.038, 0.038, 0.07, 6, 'gold', { pos: [side * 0.14, 1.04, 0.52] });
    tint(aglet, GOLD_DK); P.push(aglet);
  }

  /* ==========================================================
     6. HEAD
     ========================================================== */
  const head = new THREE.SphereGeometry(0.385, 12, 10);
  applyCell(head, 'gold');
  head.scale(1.0, 1.02, 0.97);       // rounder, less egg-like
  head.translate(0, 2.02, 0.02);
  tint(head, GOLD);
  S.push(head);

  // Ears. Note: geometry.scale() scales about the ORIGIN, so scaling after
  // positioning would fling these up off the skull — pass the scale through
  // place() instead, which composes T*R*S and so scales in local space.
  for (const side of [-1, 1]) {
    const ear = ico(0.075, 0, 'gold', {
      pos: [side * 0.36, 2.02, -0.01], scale: [0.6, 1.3, 1],
    });
    tint(ear, GOLD_MID); P.push(ear);
  }

  // the face, as a texture patch standing proud of the skull
  const faceGeo = facePatch(0.412, 1.70, 0.76, 2.02, 9);
  applyRegion(faceGeo, CELLS.face[0], CELLS.face[1], 2, 1);
  faceGeo.scale(1.0, 1.02, 0.97);
  faceGeo.translate(0, 2.02, 0.02);
  tint(faceGeo, GOLD_LT);
  S.push(faceGeo);

  // a soft jaw/chin block so the profile isn't a perfect ball
  // full cheeks and a soft chin — the sculpt is a round-faced young man
  const jaw = ico(0.22, 0, 'gold', { pos: [0, 1.85, 0.12], scale: [1.30, 0.72, 1.05] });
  tint(jaw, GOLD); P.push(jaw);
  for (const side of [-1, 1]) {
    const cheek = ico(0.13, 0, 'gold', { pos: [side * 0.19, 1.95, 0.26], scale: [1.1, 0.85, 0.8] });
    tint(cheek, GOLD); P.push(cheek);
  }

  /* ==========================================================
     7. THE HAIR — the whole point of the sculpt
     ==========================================================
     The reference is a deep cap of tight ringlets: a mass roughly
     half a head tall sitting proud of the skull, wider than the
     skull, coming down over the ears and stopping in a clean line
     above the brows. Scattering loose spheres on a shell gave a
     lumpy helmet. Real ringlets read as CLUSTERS — a knot of three
     or four beads following a short curl path — so that's what
     these are.
     ========================================================== */
  // The crown in the reference is big: noticeably wider than the skull and
  // about half a head tall above it.
  // Shell the ringlets sit on. Pushed back off the brow so the crown
  // never overhangs the face.
  const HC = new THREE.Vector3(0, 2.16, -0.09);
  const HR = { x: 0.525, y: 0.500, z: 0.510 };

  /** One ringlet: a few beads spiralling outward from a root. */
  const ringlet = (root, outward, size, turns) => {
    const beads = 3 + ((rng() * 2) | 0);
    const axis = new THREE.Vector3(
      outward.z * 0.6 + (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.5, -outward.x * 0.6
    ).normalize();
    for (let b = 0; b < beads; b++) {
      const f = b / beads;
      const swirl = f * turns * Math.PI;
      const pos = root.clone()
        .addScaledVector(outward, f * size * 1.5)
        .addScaledVector(axis, Math.sin(swirl) * size * 0.85);
      pos.y += Math.cos(swirl) * size * 0.5 - f * size * 0.2;
      const r = size * (1.0 - f * 0.28);
      const bead = ico(r, 0, 'gold', {
        pos: [pos.x, pos.y, pos.z],
        rot: [rng() * 3, rng() * 3, rng() * 3],
        scale: [1, 0.9 + rng() * 0.22, 1],
      });
      tint(bead, b === 0 ? GOLD_LT : (rng() < 0.45 ? GOLD : GOLD_MID));
      P.push(bead);
    }
  };

  const CLUSTERS = Math.max(34, Math.round(curlCount / 1.9));
  for (let i = 0; i < CLUSTERS; i++) {
    const phi = rng() * Math.PI * 2;
    const forward = Math.sin(phi);
    /* Hairline: stops cleanly above the brows at the front, runs down
       over the ears and well down the nape at the back. */
    const maxTheta = forward > 0
      ? 1.28 - 0.32 * forward          // front
      : 1.62 - 0.42 * forward;         // sides and back, lower
    const theta = Math.pow(rng(), 0.55) * maxTheta;

    const nx = Math.sin(theta) * Math.cos(phi);
    const nz = Math.sin(theta) * Math.sin(phi);
    const ny = Math.cos(theta);
    const root = new THREE.Vector3(
      HC.x + nx * HR.x, HC.y + ny * HR.y, HC.z + nz * HR.z
    );
    // never over the eyes or the smirk
    if (root.z > 0.16 && root.y < 2.30 && Math.abs(root.x) < 0.32) continue;

    const outward = new THREE.Vector3(nx, ny * 0.55, nz).normalize();
    ringlet(root, outward, 0.078 + rng() * 0.034, 1.2 + rng() * 1.1);
  }

  // A solid cap under the ringlets so no daylight shows through to the skull.
  /* Backing cap. It must stay INSIDE the ringlet shell, or it swallows the
     curls and reads as a smooth dome, and it must not reach below the brow
     line or it covers the face. */
  const cap = new THREE.SphereGeometry(0.425, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56);
  applyCell(cap, 'gold');
  cap.scale(1.05, 0.98, 1.02);
  cap.translate(HC.x, HC.y - 0.02, HC.z + 0.02);
  tint(cap, GOLD_DK);
  S.push(cap);

  // a second, lower backing at the nape so the back of the head is solid
  const nape = new THREE.SphereGeometry(0.40, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
  applyCell(nape, 'gold');
  nape.scale(1.02, 1.05, 0.9);
  place(nape, { rot: [1.15, 0, 0], pos: [0, 2.02, -0.16] });
  tint(nape, GOLD_DK);
  S.push(nape);

  // Fill the very top of the crown, which otherwise shows a bald notch
  // between the ring of clusters and the backing cap.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng() * 0.4;
    const rr = 0.10 + rng() * 0.16;
    const root = new THREE.Vector3(
      HC.x + Math.cos(a) * rr, HC.y + HR.y * 0.97, HC.z + Math.sin(a) * rr
    );
    ringlet(root, new THREE.Vector3(Math.cos(a) * 0.5, 0.85, Math.sin(a) * 0.5).normalize(),
      0.072 + rng() * 0.026, 1.1);
  }

  // Sideburns down past the ears, and a short fringe over the temples.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const root = new THREE.Vector3(side * (0.345 + rng() * 0.05), 2.08 - i * 0.085, 0.02 + rng() * 0.08);
      ringlet(root, new THREE.Vector3(side * 0.9, -0.35, 0.2).normalize(), 0.058 + rng() * 0.022, 1.0);
    }
    for (let i = 0; i < 2; i++) {
      const root = new THREE.Vector3(side * (0.20 + rng() * 0.10), 2.30, 0.20 + rng() * 0.06);
      ringlet(root, new THREE.Vector3(side * 0.5, 0.3, 0.8).normalize(), 0.058, 0.9);
    }
  }

  /* ==========================================================
     assemble
     ========================================================== */
  const faceted = mergeGeos(P);
  const smooth = mergeGeos(S);
  if (faceted) group.add(new THREE.Mesh(faceted, mats.gold));
  if (smooth) group.add(new THREE.Mesh(smooth, mats.goldSmooth));

  group.userData.height = 2.5;
  return group;
}

/* ===========================================================
   Presentation shell: idol + rotating plinth light + sparkles
   =========================================================== */
export function buildIdolShrine(mats, propMats, opts = {}) {
  const group = new THREE.Group();
  const idol = buildIdol(mats, opts);
  group.add(idol);
  group.userData.idol = idol;

  // sparkles
  const sparkGeo = new THREE.BufferGeometry();
  const N = 26;
  const pos = new Float32Array(N * 3);
  const seeds = [];
  for (let i = 0; i < N; i++) {
    seeds.push({
      a: Math.random() * Math.PI * 2,
      r: 0.5 + Math.random() * 0.9,
      y: 0.5 + Math.random() * 2.2,
      sp: 0.4 + Math.random() * 1.2,
      ph: Math.random() * 6,
    });
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // Points are drawn into a 224px-tall buffer and then upscaled, so anything
  // above ~0.03 world units turns into a fistful of confetti.
  const sparkMat = new THREE.PointsMaterial({
    color: 0xfff3c0, size: 0.032, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  group.add(sparks);

  // Scenes that already light the idol (the title rig) should turn this
  // right down, or it blows the face out to white.
  const keyI = opts.keyIntensity ?? 2.4;
  const key = new THREE.PointLight(0xffe08a, keyI, 16, 1.8);
  key.position.set(0, 3.0, 1.2);
  group.add(key);

  group.userData.tick = (t) => {
    const p = sparkGeo.attributes.position;
    for (let i = 0; i < N; i++) {
      const s = seeds[i];
      const a = s.a + t * s.sp * 0.5;
      const y = s.y + ((t * s.sp * 0.35) % 2.4);
      p.setXYZ(i, Math.cos(a) * s.r, (y % 2.6) + 0.4, Math.sin(a) * s.r);
    }
    p.needsUpdate = true;
    sparkMat.opacity = 0.55 + Math.sin(t * 3) * 0.3;
    key.intensity = keyI * (0.88 + Math.sin(t * 2.2) * 0.2);
  };
  return group;
}
