/* ===========================================================
   idol.js — THE GOLDEN IDOL OF CHRIS ILLICH
   Built to match the reference bust: curly crown, hood up behind
   the neck, CATHOLIC UNIVERSITY across the chest, hands in the
   pouch, hibiscus-and-frond wreath, ISLA DORADA plinth.
   Roughly 2.5 units tall at scale 1.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, place, tint,
  limb, arcPanel, facePatch,
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
  const hood = new THREE.SphereGeometry(0.44, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  applyCell(hood, 'gold');
  hood.scale(1.06, 0.78, 0.92);
  place(hood, { rot: [-0.5, 0, 0], pos: [0, 1.60, -0.24] });
  tint(hood, GOLD_MID); S.push(hood);

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
  const head = new THREE.SphereGeometry(0.375, 12, 10);
  applyCell(head, 'gold');
  head.scale(1.0, 1.08, 0.94);
  head.translate(0, 2.03, 0.015);
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
  const faceGeo = facePatch(0.402, 1.62, 0.74, 1.98, 8);
  applyRegion(faceGeo, CELLS.face[0], CELLS.face[1], 2, 1);
  faceGeo.scale(1.0, 1.08, 0.94);
  faceGeo.translate(0, 2.03, 0.015);
  tint(faceGeo, GOLD_LT);
  S.push(faceGeo);

  // a soft jaw/chin block so the profile isn't a perfect ball
  const jaw = ico(0.20, 0, 'gold', { pos: [0, 1.86, 0.13], scale: [1.25, 0.7, 1.0] });
  tint(jaw, GOLD); P.push(jaw);

  /* ==========================================================
     7. THE HAIR — the whole point of the sculpt
     ========================================================== */
  const HR = { x: 0.44, y: 0.41, z: 0.43 };
  const HC = new THREE.Vector3(0, 2.14, -0.02);

  for (let i = 0; i < curlCount; i++) {
    const phi = rng() * Math.PI * 2;
    // How far forward this curl points: +1 dead ahead, -1 at the back.
    const forward = Math.sin(phi);
    // A real hairline — curls stop high at the front and run low at the back,
    // so the face never gets buried.
    const maxTheta = 1.62 - 0.66 * Math.max(0, forward);
    const theta = Math.pow(rng(), 0.6) * maxTheta;
    const bulge = 0.97 + rng() * 0.11;

    const px = HC.x + Math.sin(theta) * Math.cos(phi) * HR.x * bulge;
    const py = HC.y + Math.cos(theta) * HR.y * bulge - 0.03;
    const pz = HC.z + Math.sin(theta) * Math.sin(phi) * HR.z * bulge;

    // belt-and-braces: nothing sits over the eyes or the smirk
    if (pz > 0.06 && py < 2.24 && Math.abs(px) < 0.30) continue;

    const r = 0.072 + rng() * 0.038;
    const curl = ico(r, 0, 'gold', {
      pos: [px, py, pz],
      rot: [rng() * 3, rng() * 3, rng() * 3],
      scale: [1, 0.88 + rng() * 0.24, 1],
    });
    tint(curl, rng() < 0.40 ? GOLD_LT : (rng() < 0.55 ? GOLD : GOLD_MID));
    P.push(curl);
  }

  // an inner mass so you never see through the curls to the skull
  const hairCore = new THREE.SphereGeometry(0.405, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.60);
  applyCell(hairCore, 'gold');
  hairCore.scale(1.02, 0.98, 1.0);
  hairCore.translate(0, 2.12, -0.05);
  tint(hairCore, GOLD_MID);
  S.push(hairCore);

  // sideburn clusters framing the face, kept out to the sides
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const r = 0.068 + rng() * 0.032;
      const c = ico(r, 0, 'gold', {
        pos: [side * (0.33 + rng() * 0.08), 2.10 - i * 0.085, 0.02 + rng() * 0.10],
        rot: [rng() * 3, rng() * 3, rng() * 3],
      });
      tint(c, GOLD_MID);
      P.push(c);
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
