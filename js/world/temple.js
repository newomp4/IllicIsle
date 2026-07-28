/* ===========================================================
   temple.js — THE SUNKEN TEMPLE OF ILLIC ISLE
   Cut limestone, not lava. You come down a stair into a pillared
   hall the jungle has been eating for four hundred years: roots
   through the ceiling, shafts of daylight, old mine timbers where
   somebody dug for the Idol and stopped digging.
   Hector holds the middle. The Idol waits on the dais at the far end.
   =========================================================== */

import * as THREE from 'three';
import { ps1ify } from '../lib/ps1.js';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, place, tint, jitterVerts, limb,
} from '../lib/geo.js';
import { makeRng, buildDetailTexture } from '../lib/textures.js';
import { buildTorch, buildFlameCluster, buildCoconutPile } from './props.js';

export const TEMPLE = {
  /* A square hall. The player and Hector are box-constrained rather than
     circle-constrained, which reads correctly for cut masonry. */
  halfX: 34,
  halfZ: 36,
  center: new THREE.Vector3(0, 0, 0),
  floorY: 0,
  entrance: new THREE.Vector3(0, 0, 30),
  daisCenter: new THREE.Vector3(0, 0, -27),
  daisHeight: 2.6,
  wallH: 17,
};

/** Ground height inside the temple. */
export function templeHeight(x, z) {
  let h = 0;

  // stepped dais at the north end
  const dx = Math.abs(x - TEMPLE.daisCenter.x);
  const dz = Math.abs(z - TEMPLE.daisCenter.z);
  const d = Math.max(dx * 0.85, dz);
  h += TEMPLE.daisHeight * (1 - THREE.MathUtils.smoothstep(d, 6.0, 10.5));

  // entrance landing you arrive on
  const de = Math.hypot(x - TEMPLE.entrance.x, z - TEMPLE.entrance.z);
  h += 2.2 * (1 - THREE.MathUtils.smoothstep(de, 4.0, 9.5));

  // the floor has settled — a shallow dish toward the middle
  const r = Math.hypot(x, z);
  h -= 0.45 * (1 - THREE.MathUtils.clamp(r / 34, 0, 1));

  return h;
}

export function buildTemple(idolMats, propMats) {
  const rng = makeRng(90210);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c08);
  scene.fog = new THREE.Fog(0x141b12, 18, 92);

  const HX = TEMPLE.halfX, HZ = TEMPLE.halfZ, WH = TEMPLE.wallH;

  /* ---------- lighting: cool daylight from above, warm torches below ---------- */
  scene.add(new THREE.AmbientLight(0x6e7563, 1.12));
  const shaft = new THREE.DirectionalLight(0xdcecd0, 0.95);
  shaft.position.set(0.2, 1, 0.15);
  scene.add(shaft);
  scene.add(new THREE.HemisphereLight(0x8a9670, 0x2c2a18, 0.78));

  // two broad fills so the fight floor and the dais both read
  const hallFill = new THREE.PointLight(0xffb478, 1.55, 78, 1.1);
  hallFill.position.set(0, 13, 6);
  scene.add(hallFill);
  const daisFill = new THREE.PointLight(0xffd8a0, 1.35, 58, 1.15);
  daisFill.position.set(0, 12, -22);
  scene.add(daisFill);

  const STONE = new THREE.Color(0x8d8770);
  const STONE_DK = new THREE.Color(0x5f5a49);
  const MOSS = new THREE.Color(0x5a6b38);

  /* ---------- floor ---------- */
  const floorGeo = new THREE.PlaneGeometry(HX * 2 + 16, HZ * 2 + 16, 76, 78);
  floorGeo.rotateX(-Math.PI / 2);
  {
    const p = floorGeo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let h = templeHeight(x, z);
      h += (rng() - 0.5) * 0.16;                       // settled flagstones
      if (Math.abs(x) > HX) h += (Math.abs(x) - HX) * 3;
      if (Math.abs(z) > HZ) h += (Math.abs(z) - HZ) * 3;
      p.setY(i, h);

      const n = rng();
      c.copy(STONE).lerp(STONE_DK, n * 0.75);
      // moss creeps in from the edges and in the damp middle
      const edge = Math.max(Math.abs(x) / HX, Math.abs(z) / HZ);
      if (n > 0.72 || edge > 0.82) c.lerp(MOSS, 0.3 + n * 0.3);
      if (h > 1.8) c.lerp(STONE, 0.3);                 // swept dais
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    floorGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    floorGeo.computeVertexNormals();
  }
  const detail = buildDetailTexture();
  detail.repeat.set(30, 30);
  const floorMat = ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }), { flat: false });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.frustumCulled = false;
  scene.add(floor);

  /* ---------- walls: coursed masonry, four flat faces ---------- */
  const wallParts = [];
  const wallSpec = [
    { x: 0, z: -HZ, w: HX * 2, rotY: 0 },
    { x: 0, z: HZ, w: HX * 2, rotY: Math.PI },
    { x: -HX, z: 0, w: HZ * 2, rotY: Math.PI / 2 },
    { x: HX, z: 0, w: HZ * 2, rotY: -Math.PI / 2 },
  ];
  for (const W of wallSpec) {
    // stacked courses so the wall has real relief
    /* Courses used to alternate DEPTH, which put two coplanar faces in the
       same place and z-fought into black bands. Keep the depth constant and
       vary tone instead. */
    const courses = 9;
    for (let c = 0; c < courses; c++) {
      const y = 0.9 + c * (WH / courses);
      const g = box(W.w, WH / courses - 0.10, 1.6, 'templeStone', {
        pos: [W.x, y, W.z], rot: [0, W.rotY, 0],
      });
      tint(g, STONE.clone().multiplyScalar(0.60 + rng() * 0.30 - c * 0.015));
      wallParts.push(g);
    }
    // pilasters
    const n = Math.round(W.w / 11);
    for (let i = 0; i <= n; i++) {
      const t = (i / n - 0.5) * W.w;
      const px = W.x + Math.cos(W.rotY) * t;
      const pz = W.z - Math.sin(W.rotY) * t;
      const g = box(1.7, WH, 1.1, 'templeStone', { pos: [px, WH / 2 + 0.6, pz], rot: [0, W.rotY, 0] });
      tint(g, STONE.clone().multiplyScalar(0.72 + rng() * 0.3));
      wallParts.push(g);
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(wallParts), propMats.opaque));

  /* ---------- ceiling: coffered slabs with holes punched through ---------- */
  const ceilParts = [];
  const holes = [
    { x: 0, z: 30, r: 6 },        // above the entrance stair
    { x: -18, z: 6, r: 5 },
    { x: 20, z: -8, r: 4.5 },
    { x: 8, z: 20, r: 4 },
  ];
  const isHole = (x, z) => holes.some((h) => (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r);
  const step = 4;
  for (let x = -HX; x < HX; x += step) {
    for (let z = -HZ; z < HZ; z += step) {
      if (isHole(x + step / 2, z + step / 2)) continue;
      const sag = (rng() - 0.5) * 0.3;
      const g = box(step + 0.15, 0.9, step + 0.15, 'templeStone', { pos: [x + step / 2, WH + 0.3 + sag, z + step / 2] });
      tint(g, STONE_DK.clone().multiplyScalar(0.62 + rng() * 0.35));
      ceilParts.push(g);
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(ceilParts), propMats.opaque));

  /* ---------- daylight through the holes ----------
     Volumetric cones were reading as solid grey prisms against the lit
     walls, and a blue-tinted floor pool made the hall look flooded. Light
     plus a warm floor patch does the job without the artefacts. */
  const shafts = [];
  for (const h of holes) {
    const l = new THREE.PointLight(0xd8ecc0, 2.2, 40, 1.4);
    l.position.set(h.x, WH - 5, h.z);
    scene.add(l);
    shafts.push({ light: l, ph: rng() * 6, base: 2.2 });

    const pool = plane(h.r * 1.9, h.r * 1.9, 'sand', {
      rot: [-Math.PI / 2, 0, 0],
      pos: [h.x, templeHeight(h.x, h.z) + 0.05, h.z],
    });
    tint(pool, new THREE.Color(0xbfd0a0));
    const pm = new THREE.Mesh(mergeGeos([pool]), new THREE.MeshBasicMaterial({
      map: propMats.opaque.map, vertexColors: true, transparent: true, opacity: 0.16,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    pm.renderOrder = 2;
    scene.add(pm);
  }

  /* ---------- columns down the hall ---------- */
  const colParts = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = sx * 17;
      const z = -20 + i * 11;
      const broken = rng() < 0.28;
      const ch = broken ? 4 + rng() * 5 : WH;

      const base = box(3.0, 0.7, 3.0, 'templeStone', { pos: [x, 0.35, z] });
      tint(base, STONE.clone().multiplyScalar(0.8)); colParts.push(base);

      const shaftG = cyl(1.0, 1.15, ch, 8, 'templeStone', { pos: [x, 0.7 + ch / 2, z] });
      tint(shaftG, STONE.clone().multiplyScalar(0.75 + rng() * 0.3)); colParts.push(shaftG);

      // carved banding
      for (let b = 1; b < Math.floor(ch / 3); b++) {
        const ring = cyl(1.12, 1.12, 0.32, 8, 'templeGlyph', { pos: [x, 0.7 + b * 3, z] });
        tint(ring, new THREE.Color(0xa89c80)); colParts.push(ring);
      }

      if (!broken) {
        const cap = box(3.2, 0.9, 3.2, 'templeStone', { pos: [x, 0.7 + ch + 0.45, z] });
        tint(cap, STONE_DK.clone().multiplyScalar(0.9)); colParts.push(cap);
      } else {
        // rubble where the top came down
        for (let r = 0; r < 4; r++) {
          const a = rng() * Math.PI * 2, rr = 1.6 + rng() * 2.4;
          const chunk = box(1.1 + rng(), 0.8, 1.1 + rng(), 'templeStone', {
            pos: [x + Math.cos(a) * rr, 0.4, z + Math.sin(a) * rr],
            rot: [(rng() - .5) * .4, rng() * 3, (rng() - .5) * .4],
          });
          tint(chunk, STONE.clone().multiplyScalar(0.6 + rng() * 0.35));
          colParts.push(chunk);
        }
      }
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(colParts), propMats.opaque));

  /* ---------- roots and vines coming through the roof ---------- */
  const growth = [];
  for (let i = 0; i < 70; i++) {
    const x = (rng() - 0.5) * HX * 2 * 0.94;
    const z = (rng() - 0.5) * HZ * 2 * 0.94;
    const len = 3 + rng() * 11;
    const v = plane(1.1, len, 'hangVine');
    v.translate(0, -len / 2, 0);
    place(v, { rot: [0, rng() * Math.PI, (rng() - .5) * 0.25], pos: [x, WH - 0.2, z] });
    tint(v, new THREE.Color(0xffffff).multiplyScalar(0.5 + rng() * 0.5));
    growth.push(v);
  }
  // low scrub in the corners only — big bright billboards on the open floor
  // read as flat green cones, which is exactly what you don't want indoors
  for (let i = 0; i < 22; i++) {
    const x = (rng() - 0.5) * HX * 2 * 0.92;
    const z = (rng() - 0.5) * HZ * 2 * 0.92;
    if (Math.hypot(x, z + 27) < 14) continue;             // keep the dais clear
    const edge = Math.max(Math.abs(x) / HX, Math.abs(z) / HZ);
    if (edge < 0.6) continue;                              // hug the walls
    const s2 = 0.42 + rng() * 0.3;
    const b = plane(2.0 * s2, 1.6 * s2, 'leafBush', {
      pos: [x, templeHeight(x, z) + 0.7 * s2, z], rot: [0, rng() * 3, 0],
    });
    tint(b, new THREE.Color(0x6f8a58).multiplyScalar(0.45 + rng() * 0.35));
    growth.push(b);
  }
  scene.add(new THREE.Mesh(mergeGeos(growth), propMats.cutoutStill));

  // thick woody roots crawling down the walls
  const rootParts = [];
  for (let i = 0; i < 26; i++) {
    const side = (rng() * 4) | 0;
    const t = (rng() - 0.5) * 2;
    let x, z;
    if (side === 0) { x = t * HX; z = -HZ + 1.2; }
    else if (side === 1) { x = t * HX; z = HZ - 1.2; }
    else if (side === 2) { x = -HX + 1.2; z = t * HZ; }
    else { x = HX - 1.2; z = t * HZ; }
    let y = WH;
    for (let s = 0; s < 5; s++) {
      const len = 2 + rng() * 3;
      const g = cyl(0.16, 0.22, len, 5, 'barkDark', {
        pos: [x + (rng() - .5) * 0.7, y - len / 2, z + (rng() - .5) * 0.7],
        rot: [(rng() - .5) * 0.4, rng() * 3, (rng() - .5) * 0.4],
      });
      tint(g, new THREE.Color(0x6a5a3e).multiplyScalar(0.8 + rng() * 0.4));
      rootParts.push(g);
      y -= len * 0.85;
      if (y < 1) break;
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(rootParts), propMats.opaque));

  /* ---------- old mine workings in the west corner ---------- */
  const mineParts = [];
  const MX = -24, MZ = 16;
  for (let i = 0; i < 4; i++) {
    const z = MZ - i * 3.4;
    for (const s of [-1, 1]) {
      const post = box(0.42, 4.2, 0.42, 'planks', { pos: [MX + s * 2.0, 2.1, z] });
      tint(post, new THREE.Color(0x6b563a)); mineParts.push(post);
    }
    const beam = box(4.8, 0.44, 0.42, 'planks', { pos: [MX, 4.2, z] });
    tint(beam, new THREE.Color(0x5e4b33)); mineParts.push(beam);
  }
  // spoil heap and abandoned tools
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 3.4;
    const g = ico(0.3 + rng() * 0.4, 0, 'dirt', {
      pos: [MX + Math.cos(a) * r, 0.2, MZ + 2.6 + Math.sin(a) * r], rot: [rng(), rng(), rng()],
    });
    tint(g, new THREE.Color(0x6a5540)); mineParts.push(g);
  }
  const cartBody = box(1.5, 0.8, 2.2, 'planks', { pos: [MX + 0.4, 0.7, MZ - 11], rot: [0, 0.3, 0.12] });
  tint(cartBody, new THREE.Color(0x6b563a)); mineParts.push(cartBody);
  for (const s of [-1, 1]) {
    const wheel = cyl(0.36, 0.36, 0.16, 8, 'metal', { pos: [MX + 0.4 + s * 0.8, 0.34, MZ - 11], rot: [0, 0, Math.PI / 2] });
    tint(wheel, new THREE.Color(0x5a5048)); mineParts.push(wheel);
  }
  const pick = cyl(0.06, 0.06, 1.3, 4, 'driftwood', { pos: [MX + 3, 0.14, MZ - 6], rot: [Math.PI / 2, 0.7, 0] });
  tint(pick, new THREE.Color(0xb8a684)); mineParts.push(pick);
  scene.add(new THREE.Mesh(mergeGeos(mineParts), propMats.opaque));

  /* ---------- wall torches ---------- */
  const torches = [];
  const torchSpots = [];
  for (let i = 0; i < 5; i++) {
    torchSpots.push({ x: -HX + 1.8, z: -24 + i * 12, ry: Math.PI / 2 });
    torchSpots.push({ x: HX - 1.8, z: -24 + i * 12, ry: -Math.PI / 2 });
  }
  for (const s of torchSpots) {
    const t = buildTorch(propMats);
    t.position.set(s.x, templeHeight(s.x, s.z) + 4.2, s.z);
    t.rotation.y = s.ry;
    t.userData.light.intensity = 1.5;
    t.userData.light.distance = 20;
    scene.add(t);
    torches.push(t);
  }

  /* ---------- Hector's camp ---------- */
  const camp = buildHectorCamp(rng, propMats);
  camp.position.set(19, templeHeight(19, 14), 14);
  camp.rotation.y = -0.7;
  scene.add(camp);

  /* ---------- entrance: stair down from the jungle ---------- */
  const entParts = [];
  {
    const ex = TEMPLE.entrance.x, ez = TEMPLE.entrance.z;
    for (let i = 0; i < 6; i++) {
      const g = box(9 - i * 0.3, 0.6, 1.7, 'templeStone', { pos: [ex, 2.2 + i * 0.55, ez + 3.2 + i * 1.6] });
      tint(g, STONE.clone().multiplyScalar(0.8 - i * 0.03));
      entParts.push(g);
    }
    for (const s of [-1, 1]) {
      const rail = box(0.8, 2.4, 11, 'templeStone', { pos: [ex + s * 4.8, 3.6, ez + 7] });
      tint(rail, STONE_DK); entParts.push(rail);
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(entParts), propMats.opaque));

  /* ---------- THE DAIS + SEAL ---------- */
  const daisParts = [];
  const D = TEMPLE.daisCenter;
  const dy = TEMPLE.daisHeight;

  for (let i = 0; i < 4; i++) {
    const s = box(15 - i * 1.8, 0.66, 2.4, 'templeStone', { pos: [D.x, dy - 0.33 - i * 0.66, D.z + 8.5 + i * 1.9] });
    tint(s, STONE.clone().multiplyScalar(0.9 - i * 0.05));
    daisParts.push(s);
  }
  const platform = box(17, 0.8, 15, 'templeStone', { pos: [D.x, dy - 0.4, D.z - 1] });
  tint(platform, STONE.clone().multiplyScalar(0.86)); daisParts.push(platform);

  const ped1 = cyl(1.9, 2.4, 0.6, 10, 'templeStone', { pos: [D.x, dy + 0.3, D.z] });
  tint(ped1, STONE); daisParts.push(ped1);
  const ped2 = cyl(1.4, 1.75, 1.5, 10, 'templeGlyph', { pos: [D.x, dy + 1.35, D.z] });
  tint(ped2, new THREE.Color(0xa89c80)); daisParts.push(ped2);
  const ped3 = cyl(1.65, 1.4, 0.35, 10, 'goldDark', { pos: [D.x, dy + 2.25, D.z] });
  tint(ped3, new THREE.Color(0xd8b45c)); daisParts.push(ped3);

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const px = D.x + Math.cos(a) * 5.8, pz = D.z + Math.sin(a) * 5.8;
    const col = cyl(0.55, 0.7, 8.5, 8, 'templeStone', { pos: [px, dy + 4.25, pz] });
    tint(col, STONE); daisParts.push(col);
    const cap = box(1.7, 0.5, 1.7, 'templeStone', { pos: [px, dy + 8.7, pz] });
    tint(cap, STONE_DK); daisParts.push(cap);
    const bowl = cyl(0.5, 0.6, 0.4, 8, 'goldDark', { pos: [px, dy + 9.1, pz] });
    tint(bowl, new THREE.Color(0xd8b45c)); daisParts.push(bowl);
  }

  // carved back wall behind the idol
  // carved back wall, panel by panel so the glyph texture keeps its scale
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      const g = box(2.9, 2.9, 1.2, 'templeGlyph', {
        pos: [D.x - 6 + i * 3.0, dy + 1.6 + j * 3.0, D.z - 7.2],
      });
      tint(g, new THREE.Color(0x9c907a).multiplyScalar(0.82 + rng() * 0.3));
      daisParts.push(g);
    }
  }
  scene.add(new THREE.Mesh(mergeGeos(daisParts), propMats.opaque));

  const braziers = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const f = buildFlameCluster(propMats, 3, 0.42);
    f.position.set(D.x + Math.cos(a) * 5.8, dy + 9.3, D.z + Math.sin(a) * 5.8);
    scene.add(f);
    braziers.push(f);
    const l = new THREE.PointLight(0xffb050, 1.4, 22, 1.7);
    l.position.copy(f.position).add(new THREE.Vector3(0, 0.5, 0));
    scene.add(l);
  }

  /* the seal: a curtain of gold light across the dais steps */
  const sealMat = new THREE.MeshBasicMaterial({
    color: 0xffcf5a, transparent: true, opacity: 0.24, side: THREE.DoubleSide,
    depthWrite: false, fog: false,
  });
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(15, 9, 6, 5), sealMat);
  seal.position.set(D.x, dy + 3.4, D.z + 8.2);
  scene.add(seal);

  const sealBars = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 9),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.6, fog: false, depthWrite: false })
    );
    g.position.set(D.x - 6.4 + i * 1.6, dy + 3.4, D.z + 8.24);
    scene.add(g);
    sealBars.push(g);
  }

  /* ---------- coconut caches around the hall ---------- */
  const caches = [];
  const cacheSpots = [
    { x: -26, z: -20 }, { x: 26, z: -20 }, { x: -26, z: 22 }, { x: 26, z: 24 },
  ];
  for (const s of cacheSpots) {
    const pile = buildCoconutPile(rng, propMats);
    pile.position.set(s.x, templeHeight(s.x, s.z), s.z);
    scene.add(pile);
    caches.push({ mesh: pile, x: s.x, z: s.z, cooldown: 0 });
  }

  /* ---------- per-frame ---------- */
  const tickers = [];
  scene.traverse((o) => { if (o.userData?.tick && o !== scene) tickers.push(o); });

  scene.userData.tick = (t, dt) => {
    for (const g of tickers) g.userData.tick(t, dt);
    for (const tr of torches) {
      tr.userData.light.intensity = 1.35 + Math.sin(t * 9 + tr.position.x) * 0.3;
    }
    for (const s of shafts) {
      s.light.intensity = s.base + Math.sin(t * 0.5 + s.ph) * 0.35;
    }
    sealMat.opacity = 0.18 + Math.sin(t * 2.4) * 0.08;
    sealBars.forEach((b, i) => {
      b.position.y = dy + 3.4 + Math.sin(t * 1.6 + i * 0.8) * 0.25;
      b.material.opacity = 0.42 + Math.sin(t * 3 + i) * 0.2;
    });
  };

  scene.userData.seal = { seal, bars: sealBars, mat: sealMat };
  scene.userData.caches = caches;
  scene.userData.torches = torches;
  return scene;
}

/** Hector's living quarters. Eleven years of takeout. */
function buildHectorCamp(rng, mats) {
  const group = new THREE.Group();
  const P = [];
  const WOOD = new THREE.Color(0x8a7048);

  const seat = box(3.0, 0.5, 2.4, 'planks', { pos: [0, 1.5, 0] });
  tint(seat, WOOD); P.push(seat);
  const backRest = box(3.0, 3.6, 0.4, 'planks', { pos: [0, 3.2, -1.1], rot: [-0.12, 0, 0] });
  tint(backRest, WOOD); P.push(backRest);
  for (const s of [-1, 1]) {
    const arm = box(0.35, 0.4, 2.4, 'planks', { pos: [s * 1.5, 1.95, 0] });
    tint(arm, WOOD); P.push(arm);
    for (const z of [0.9, -0.9]) {
      const leg = box(0.4, 1.5, 0.4, 'planks', { pos: [s * 1.3, 0.75, z] });
      tint(leg, WOOD); P.push(leg);
    }
  }
  for (let i = 0; i < 7; i++) {
    const g = cone(0.16, 0.9 + rng() * 0.8, 5, 'driftwood', {
      pos: [(i - 3) * 0.44, 5.1 + rng() * 0.3, -1.15], rot: [(rng() - .5) * 0.3, 0, (rng() - .5) * 0.3],
    });
    tint(g, new THREE.Color(0xc4b494)); P.push(g);
  }

  for (let i = 0; i < 64; i++) {
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
      g = cyl(0.2, 0.16, 0.5, 6, 'soda', { pos: [x, 0.25, z], rot: [rng() < 0.5 ? Math.PI / 2 : 0, rng() * 3, 0] });
      tint(g, new THREE.Color(0xc44a3a));
    } else if (kind < 0.8) {
      g = box(0.09, 0.5, 0.09, 'fry', { pos: [x, 0.2, z], rot: [(rng() - .5) * 2, rng() * 3, (rng() - .5) * 2] });
      tint(g, new THREE.Color(0xefc25a));
    } else {
      g = cyl(0.06, 0.05, 0.5 + rng() * 0.4, 5, 'onion', { pos: [x, 0.1, z], rot: [Math.PI / 2, rng() * 3, (rng() - .5) * 0.5] });
      tint(g, new THREE.Color(0xe8e0cc));
    }
    P.push(g);
  }

  const slab = box(3.2, 0.3, 2.2, 'templeStone', { pos: [4.5, 1.1, 3.5] });
  tint(slab, new THREE.Color(0x6a6258)); P.push(slab);
  for (const s of [-1, 1]) {
    const leg = cyl(0.14, 0.16, 1.1, 5, 'metal', { pos: [4.5 + s * 1.3, 0.55, 3.5] });
    tint(leg, new THREE.Color(0x6a5c4c)); P.push(leg);
  }
  for (let i = 0; i < 6; i++) {
    const g = cyl(0.34, 0.34, 0.12, 8, 'patty', { pos: [4.5 + (rng() - .5) * 2.4, 1.31, 3.5 + (rng() - .5) * 1.4] });
    tint(g, new THREE.Color(0x6b4127)); P.push(g);
  }

  const tally = box(2.2, 1.6, 0.12, 'runes', { pos: [-3.6, 1.4, -0.8], rot: [0, 0.5, 0.05] });
  tint(tally, new THREE.Color(0xbfae90)); P.push(tally);

  group.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  const grillFire = buildFlameCluster(mats, 3, 0.36);
  grillFire.position.set(4.5, 0.2, 3.5);
  group.add(grillFire);
  const gl = new THREE.PointLight(0xff8a30, 1.5, 15, 1.8);
  gl.position.set(4.5, 1.2, 3.5);
  group.add(gl);

  return group;
}
