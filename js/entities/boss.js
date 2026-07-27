/* ===========================================================
   boss.js — HECTOR, "EL BASS PRESIDENTE"
   Washed up eleven years before you. Found a staff. Has not
   been hungry since. Considers the island a democracy in which
   he holds every office.
   =========================================================== */

import * as THREE from 'three';
import {
  mergeGeos, box, cyl, cone, ico, sphere, plane, place, tint,
  limb, jitterVerts, facePatch,
} from '../lib/geo.js';
import { applyRegion, applyCell, CELLS, makeRng } from '../lib/textures.js';

const SKIN = new THREE.Color(0xc98d5e);
const SKIN_BURN = new THREE.Color(0xd08055);
const RAG = new THREE.Color(0x9a8c6e);
const RAG_DK = new THREE.Color(0x6d6047);
const HAIRC = new THREE.Color(0x3c2a16);

/* ===========================================================
   FOOD GEOMETRY — his entire vocabulary
   =========================================================== */
export function foodBurger(rng, scale = 1) {
  const P = [];
  const top = sphere(0.50, 8, 5, 'bun', { pos: [0, 0.28, 0] });
  top.scale(1, 0.66, 1);
  tint(top, new THREE.Color(0xe0ae6a)); P.push(top);

  const cheese = box(0.98, 0.06, 0.98, 'cheese', { pos: [0, 0.06, 0], rot: [0, 0.4, 0] });
  tint(cheese, new THREE.Color(0xffc846)); P.push(cheese);

  const patty = cyl(0.46, 0.46, 0.17, 9, 'patty', { pos: [0, -0.03, 0] });
  tint(patty, new THREE.Color(0x6b4127)); P.push(patty);

  const let1 = cyl(0.52, 0.52, 0.05, 9, 'lettuce', { pos: [0, -0.14, 0] });
  jitterVerts(let1, 0.09, rng);
  tint(let1, new THREE.Color(0x86c05a)); P.push(let1);

  const bot = cyl(0.46, 0.42, 0.20, 9, 'bun', { pos: [0, -0.28, 0] });
  tint(bot, new THREE.Color(0xcf9d5e)); P.push(bot);

  const g = mergeGeos(P);
  if (scale !== 1) g.scale(scale, scale, scale);
  return g;
}

function foodFry(rng) {
  const g = box(0.15, 0.95, 0.15, 'fry');
  tint(g, new THREE.Color(0xf2c85a));
  return mergeGeos([g]);
}

function foodNugget(rng) {
  const P = [];
  const body = ico(0.42, 0, 'nugget');
  jitterVerts(body, 0.16, rng);
  body.scale(1.15, 0.85, 1);
  tint(body, new THREE.Color(0xd9a45c));
  P.push(body);
  // beady little eyes
  for (const s of [-1, 1]) {
    const e = ico(0.07, 0, 'patty', { pos: [s * 0.16, 0.10, 0.36] });
    tint(e, new THREE.Color(0x2a1a0e));
    P.push(e);
  }
  return mergeGeos(P);
}

/* ===========================================================
   HECTOR'S MODEL
   =========================================================== */
export function buildHector(sharedMats) {
  const rng = makeRng(1111);
  const root = new THREE.Group();
  const parts = {};

  // Hector owns his materials so flashing him white on a hit doesn't
  // flash the entire island white with him.
  const mats = {
    opaque: sharedMats.opaque.clone(),
    cutoutStill: sharedMats.cutoutStill.clone(),
  };
  parts.mats = mats;

  /* body pivot */
  const body = new THREE.Group();
  body.position.y = 2.05;
  root.add(body);
  parts.body = body;

  /* ---- the belly: the man is mostly belly ---- */
  const torsoParts = [];
  const gut = new THREE.LatheGeometry([
    [0.00, -1.05], [0.62, -1.02], [0.90, -0.78], [1.05, -0.42],
    [1.10, -0.05], [1.05, 0.32], [0.92, 0.62], [0.74, 0.84],
    [0.50, 0.99], [0.26, 1.06], [0.00, 1.08],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 12);
  gut.scale(1.0, 1, 0.88);
  applyCell(gut, 'skin');
  tint(gut, SKIN);
  torsoParts.push(gut);

  // a shirt that gave up years ago — a vest of rags over the top half
  const shirt = new THREE.LatheGeometry([
    [0.78, 0.86], [0.96, 0.60], [1.09, 0.30], [1.13, -0.02], [1.10, -0.22],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 12);
  shirt.scale(1.02, 1, 0.90);
  applyCell(shirt, 'clothTat');
  tint(shirt, RAG);
  torsoParts.push(shirt);

  // torn strips hanging off the hem
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const f = box(0.16, 0.22 + rng() * 0.3, 0.06, 'clothTat', {
      pos: [Math.cos(a) * 1.06, -0.30 - rng() * 0.1, Math.sin(a) * 0.95],
      rot: [(rng() - .5) * 0.5, -a, (rng() - .5) * 0.4],
    });
    tint(f, RAG_DK); torsoParts.push(f);
  }

  // ragged shorts
  const shorts = cyl(1.02, 0.86, 0.62, 12, 'clothTat', { pos: [0, -1.10, 0] });
  shorts.scale(1, 1, 0.9);
  tint(shorts, RAG_DK); torsoParts.push(shorts);

  // navel, because we are committed
  const navel = ico(0.10, 0, 'skin', { pos: [0, -0.16, 0.94] });
  tint(navel, new THREE.Color(0xa9714a)); torsoParts.push(navel);

  parts.torso = new THREE.Mesh(mergeGeos(torsoParts), mats.opaque);
  body.add(parts.torso);

  /* ---- cape: a scrap of the ship's sail, worn as office ---- */
  const capeGroup = new THREE.Group();
  capeGroup.position.set(0, 0.75, -0.55);
  body.add(capeGroup);
  const capeParts = [];
  for (let i = 0; i < 5; i++) {
    const w = 1.9 - i * 0.05;
    const p = plane(w, 0.62, 'sail', { pos: [0, -i * 0.56, -i * 0.10], rot: [0.12 * i, 0, 0] });
    tint(p, new THREE.Color(0xd6c9a8).multiplyScalar(0.92 - i * 0.05));
    capeParts.push(p);
  }
  parts.cape = new THREE.Mesh(mergeGeos(capeParts), mats.cutoutStill);
  capeGroup.add(parts.cape);
  parts.capeGroup = capeGroup;

  /* ---- head ---- */
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.32, 0.02);
  body.add(headGroup);
  parts.head = headGroup;

  const headParts = [];
  const neck = cyl(0.34, 0.44, 0.30, 8, 'skin', { pos: [0, -0.30, 0] });
  tint(neck, SKIN); headParts.push(neck);
  // jowls
  // scale via place(), not geometry.scale() — see the note in idol.js
  const jowl = sphere(0.30, 6, 5, 'skin', { pos: [0, -0.26, 0.12], scale: [1.5, 0.7, 1] });
  tint(jowl, SKIN); headParts.push(jowl);

  const skull = sphere(0.46, 10, 8, 'skin');
  skull.scale(1.05, 1.02, 0.98);
  tint(skull, SKIN_BURN);
  headParts.push(skull);

  // wild hair
  for (let i = 0; i < 22; i++) {
    const th = Math.pow(rng(), 0.6) * 1.55;
    const ph = rng() * Math.PI * 2;
    const c = ico(0.11 + rng() * 0.07, 0, 'hair', {
      pos: [
        Math.sin(th) * Math.cos(ph) * 0.46,
        Math.cos(th) * 0.48 + 0.04,
        Math.sin(th) * Math.sin(ph) * 0.45 - 0.03,
      ],
      rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(c, HAIRC); headParts.push(c);
  }
  // beard
  for (let i = 0; i < 16; i++) {
    const c = ico(0.09 + rng() * 0.06, 0, 'hair', {
      pos: [(rng() - .5) * 0.6, -0.22 - rng() * 0.30, 0.22 + rng() * 0.16],
      rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(c, HAIRC); headParts.push(c);
  }

  parts.headMesh = new THREE.Mesh(mergeGeos(headParts), mats.opaque);
  headGroup.add(parts.headMesh);

  // face decal
  const faceGeo = facePatch(0.472, 1.5, 0.68, 1.9, 8);
  applyRegion(faceGeo, CELLS.hectorFace[0], CELLS.hectorFace[1], 2, 1);
  faceGeo.scale(1.05, 1.02, 0.98);
  tint(faceGeo, new THREE.Color(0xffffff));
  headGroup.add(new THREE.Mesh(mergeGeos([faceGeo]), mats.opaque));

  /* ---- crown of fries ---- */
  const crownParts = [];
  const band = new THREE.TorusGeometry(0.42, 0.06, 4, 12);
  applyCell(band, 'gold');
  place(band, { rot: [Math.PI / 2, 0, 0], pos: [0, 0.42, 0] });
  tint(band, new THREE.Color(0xe8c25a)); crownParts.push(band);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const f = box(0.10, 0.34 + rng() * 0.16, 0.10, 'fry', {
      pos: [Math.cos(a) * 0.40, 0.58, Math.sin(a) * 0.40],
      rot: [(rng() - .5) * 0.35, -a, (rng() - .5) * 0.35],
    });
    tint(f, new THREE.Color(0xf0c250)); crownParts.push(f);
  }
  parts.crown = new THREE.Mesh(mergeGeos(crownParts), mats.opaque);
  headGroup.add(parts.crown);

  /* ---- arms ---- */
  parts.arms = {};
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(side * 1.00, 0.72, 0);
    body.add(g);
    const ap = [];
    const upper = limb([0, 0, 0], [side * 0.30, -0.62, 0.05], 0.26, 0.22, 'skin');
    tint(upper, SKIN); ap.push(upper);
    const fore = limb([side * 0.30, -0.62, 0.05], [side * 0.34, -1.22, 0.18], 0.22, 0.17, 'skin');
    tint(fore, SKIN); ap.push(fore);
    const hand = ico(0.24, 0, 'skin', { pos: [side * 0.34, -1.30, 0.20] });
    tint(hand, SKIN); ap.push(hand);
    const shoulderRag = ico(0.30, 0, 'clothTat', { pos: [0, 0.02, 0] });
    tint(shoulderRag, RAG); ap.push(shoulderRag);
    g.add(new THREE.Mesh(mergeGeos(ap), mats.opaque));
    parts.arms[side < 0 ? 'l' : 'r'] = g;
  }

  /* ---- legs: short, overworked ---- */
  parts.legs = {};
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(side * 0.48, -1.30, 0);
    body.add(g);
    const lp = [];
    const thigh = limb([0, 0, 0], [side * 0.05, -0.42, 0], 0.34, 0.27, 'skin');
    tint(thigh, SKIN); lp.push(thigh);
    const shin = limb([side * 0.05, -0.42, 0], [side * 0.05, -0.78, 0.02], 0.24, 0.19, 'skin');
    tint(shin, SKIN); lp.push(shin);
    const foot = box(0.34, 0.18, 0.56, 'skin', { pos: [side * 0.05, -0.86, 0.13] });
    tint(foot, new THREE.Color(0xb07a4e)); lp.push(foot);
    g.add(new THREE.Mesh(mergeGeos(lp), mats.opaque));
    parts.legs[side < 0 ? 'l' : 'r'] = g;
  }

  /* ---- THE STAFF ---- */
  const staffGroup = new THREE.Group();
  staffGroup.position.set(0.34, -1.28, 0.20);
  parts.arms.r.add(staffGroup);
  parts.staffGroup = staffGroup;

  const staffParts = [];
  const shaft = cyl(0.09, 0.11, 4.2, 6, 'driftwood', { pos: [0, 1.1, 0] });
  jitterVerts(shaft, 0.05, rng);
  tint(shaft, new THREE.Color(0xb8a684)); staffParts.push(shaft);
  // bindings
  for (let i = 0; i < 4; i++) {
    const b = cyl(0.13, 0.13, 0.12, 6, 'rope', { pos: [0, 0.2 + i * 0.7, 0] });
    tint(b, new THREE.Color(0xa08a5c)); staffParts.push(b);
  }
  // crown of prongs holding the orb
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const p = limb([Math.cos(a) * 0.13, 2.95, Math.sin(a) * 0.13],
                   [Math.cos(a) * 0.30, 3.42, Math.sin(a) * 0.30], 0.05, 0.035, 'driftwood');
    tint(p, new THREE.Color(0xb8a684)); staffParts.push(p);
  }
  staffGroup.add(new THREE.Mesh(mergeGeos(staffParts), mats.opaque));

  // the orb — his whole deal
  const orbGeo = ico(0.34, 1, 'staffGem', { pos: [0, 3.30, 0] });
  const orbMat = new THREE.MeshBasicMaterial({
    map: mats.opaque.map, vertexColors: true, fog: false,
  });
  tint(orbGeo, new THREE.Color(0xffe08a));
  const orb = new THREE.Mesh(mergeGeos([orbGeo]), orbMat);
  staffGroup.add(orb);
  parts.orb = orb;

  const orbLight = new THREE.PointLight(0xffc850, 2.6, 20, 1.8);
  orbLight.position.set(0, 3.30, 0);
  staffGroup.add(orbLight);
  parts.orbLight = orbLight;

  root.userData.parts = parts;
  return root;
}

/* ===========================================================
   PROJECTILES / MINIONS
   =========================================================== */
class Pool {
  constructor(scene, geo, mat, size) {
    this.scene = scene;
    this.mesh = new THREE.InstancedMesh(geo, mat, size);
    this.mesh.frustumCulled = false;
    this.mesh.count = size;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.items = [];
    this.size = size;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.hide();
  }
  hide() {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.size; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  sync() {
    const n = Math.min(this.items.length, this.size);
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      this._v.copy(it.pos);
      this._e.set(it.rot?.x || 0, it.rot?.y || 0, it.rot?.z || 0);
      this._q.setFromEuler(this._e);
      const s = it.scale ?? 1;
      this._s.set(s, s, s);
      this._m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    const zero = this._m.makeScale(0, 0, 0);
    for (let i = n; i < this.size; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

/* ===========================================================
   THE FIGHT
   =========================================================== */
export class Hector {
  constructor(scene, mats, arena, hooks = {}) {
    this.scene = scene;
    this.mats = mats;
    this.arena = arena;            // { center, radius, floorY, groundAt(x,z) }
    this.hooks = hooks;            // { onDamagePlayer, onSay, onPhase, onDefeat, sfx }
    this.rng = makeRng(31337);

    this.mesh = buildHector(mats);
    this.parts = this.mesh.userData.parts;
    scene.add(this.mesh);

    this.pos = new THREE.Vector3(arena.center.x, 0, arena.center.z - 9);
    this.pos.y = arena.groundAt ? arena.groundAt(this.pos.x, this.pos.z) : arena.floorY;
    this.facing = 0;
    this.vel = new THREE.Vector3();

    this.maxHp = 150;
    this.hp = 150;
    this.phase = 1;
    this.state = 'sleep';
    this.timer = 0;
    this.hitFlash = 0;
    this.winded = 0;
    this.dead = false;
    this.active = false;
    this.walkPhase = 0;
    this.bob = 0;
    this.castCharge = 0;

    this.burgers = [];
    this.fries = [];
    this.waves = [];
    this.nuggets = [];
    this.telegraphs = [];

    this.burgerPool = new Pool(scene, foodBurger(this.rng, 1), mats.opaque, 24);
    this.fryPool = new Pool(scene, foodFry(this.rng), mats.opaque, 60);
    this.nuggetPool = new Pool(scene, foodNugget(this.rng), mats.opaque, 12);

    // ground telegraph rings
    this.ringGeo = new THREE.RingGeometry(0.86, 1.0, 18);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5a2a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, fog: false, depthWrite: false,
    });
    this.ringPool = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
      m.visible = false;
      scene.add(m);
      this.ringPool.push(m);
    }

    // grease shockwave rings
    this.waveMat = new THREE.MeshBasicMaterial({
      color: 0xffb03a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false, depthWrite: false,
    });
    this.waveGeo = new THREE.RingGeometry(0.9, 1.0, 30);
    this.waveGeo.rotateX(-Math.PI / 2);
  }

  get hpFrac() { return this.hp / this.maxHp; }

  wake() {
    this.active = true;
    this.state = 'intro';
    this.timer = 0;
  }

  say(text, ms) { this.hooks.onSay?.(text, ms); }

  /* ---------- damage ---------- */
  hit(amount, wasGem) {
    if (this.dead || !this.active) return 0;
    let dmg = amount;
    if (wasGem) dmg *= 2.6;
    if (this.winded > 0) dmg *= 2;
    this.hp = Math.max(0, this.hp - dmg);
    this.hitFlash = 0.22;
    this.hooks.sfx?.('bossHit');

    const wasPhase = this.phase;
    if (this.hpFrac <= 0.34) this.phase = 3;
    else if (this.hpFrac <= 0.67) this.phase = 2;
    if (this.phase !== wasPhase) {
      this.state = 'phaseShift';
      this.timer = 0;
      this.hooks.onPhase?.(this.phase);
    }
    if (this.hp <= 0) {
      this.dead = true;
      this.state = 'defeat';
      this.timer = 0;
      this.clearProjectiles();
      this.hooks.onDefeat?.();
    }
    return dmg;
  }

  clearProjectiles() {
    this.burgers.length = 0;
    this.fries.length = 0;
    this.nuggets.length = 0;
    this.waves.forEach((w) => this.scene.remove(w.mesh));
    this.waves.length = 0;
    this.telegraphs.length = 0;
    this.ringPool.forEach((r) => (r.visible = false));
  }

  /** Where a coconut must land to count as a gem hit. */
  gemWorldPos(out = new THREE.Vector3()) {
    this.parts.orb.getWorldPosition(out);
    return out;
  }

  bodyWorldPos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 2.05, this.pos.z);
  }

  /* ---------- attacks ---------- */
  fireBurgers(target, n, speed = 15) {
    const from = new THREE.Vector3();
    this.gemWorldPos(from);
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.24;
      const dir = new THREE.Vector3().subVectors(target, from);
      const dist = dir.length();
      dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z) + spread;
      const flat = Math.hypot(dir.x, dir.z);
      const vel = new THREE.Vector3(
        Math.sin(yaw) * flat * speed,
        speed * 0.42 + dist * 0.16,
        Math.cos(yaw) * flat * speed
      );
      this.burgers.push({
        pos: from.clone(),
        vel,
        rot: { x: 0, y: 0, z: 0 },
        spin: (this.rng() - 0.5) * 9,
        life: 5,
        scale: 0.9 + this.rng() * 0.35,
      });
    }
    this.hooks.sfx?.('throw');
  }

  fryRain(target, count) {
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * 7.5;
      this.telegraphs.push({
        x: target.x + Math.cos(a) * r,
        z: target.z + Math.sin(a) * r,
        t: 0,
        warn: 1.05 + this.rng() * 0.4,
        radius: 1.9,
        kind: 'fry',
      });
    }
    this.hooks.sfx?.('cast');
  }

  spawnNuggets(n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng();
      this.nuggets.push({
        pos: new THREE.Vector3(
          this.pos.x + Math.cos(a) * 2.6,
          this.groundAt(this.pos.x + Math.cos(a) * 2.6, this.pos.z + Math.sin(a) * 2.6) + 0.4,
          this.pos.z + Math.sin(a) * 2.6
        ),
        vel: new THREE.Vector3(),
        rot: { x: 0, y: 0, z: 0 },
        hop: this.rng() * 6,
        life: 26,
        hp: 1,
        scale: 1,
      });
    }
    this.hooks.sfx?.('cast');
  }

  greaseWave() {
    const mesh = new THREE.Mesh(this.waveGeo, this.waveMat.clone());
    mesh.position.set(this.pos.x, this.groundAt(this.pos.x, this.pos.z) + 0.12, this.pos.z);
    this.scene.add(mesh);
    this.waves.push({ mesh, r: 1, life: 3.4, hitPlayer: false });
    this.hooks.sfx?.('slam');
  }

  /* ---------- main update ---------- */
  update(dt, t, player) {
    const P = this.parts;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.winded = Math.max(0, this.winded - dt);
    this.timer += dt;

    const toPlayer = new THREE.Vector3().subVectors(player.pos, this.pos);
    const dist = toPlayer.length();
    const dirYaw = Math.atan2(toPlayer.x, toPlayer.z);

    if (this.active && !this.dead) this.runAI(dt, player, dist, dirYaw);

    this.updateProjectiles(dt, player);
    this.animate(dt, t, dist);
  }

  runAI(dt, player, dist, dirYaw) {
    const targetPos = player.pos;

    /* turn to face the player, always */
    if (this.state !== 'charge' && this.state !== 'defeat') {
      let d = dirYaw - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * Math.min(1, 3.2 * dt);
    }

    switch (this.state) {
      case 'intro': {
        if (this.timer > 3.2) { this.state = 'idle'; this.timer = 0; }
        break;
      }

      case 'idle': {
        // shuffle toward a comfortable distance
        const want = 9;
        const move = THREE.MathUtils.clamp((dist - want) * 0.4, -2.4, 3.0);
        this.vel.x = Math.sin(this.facing) * move;
        this.vel.z = Math.cos(this.facing) * move;
        this.stepMove(dt);

        const gap = this.phase === 1 ? 2.1 : this.phase === 2 ? 1.6 : 1.15;
        if (this.timer > gap) {
          this.timer = 0;
          this.pickAttack(dist);
        }
        break;
      }

      case 'toss': {
        this.castCharge = Math.min(1, this.timer / 0.55);
        if (this.timer > 0.55 && !this._fired) {
          this._fired = true;
          const n = this.phase === 1 ? 1 : this.phase === 2 ? 2 : 3;
          this.fireBurgers(targetPos.clone().setY(targetPos.y + 0.9), n);
        }
        if (this.timer > 1.15) { this.state = 'idle'; this.timer = 0; this._fired = false; this.castCharge = 0; }
        break;
      }

      case 'rain': {
        this.castCharge = Math.min(1, this.timer / 0.7);
        if (this.timer > 0.7 && !this._fired) {
          this._fired = true;
          this.fryRain(targetPos, this.phase === 3 ? 9 : 6);
          this.say('SIDES!', 1400);
        }
        if (this.timer > 1.6) { this.state = 'idle'; this.timer = 0; this._fired = false; this.castCharge = 0; }
        break;
      }

      case 'summon': {
        this.castCharge = Math.min(1, this.timer / 0.9);
        if (this.timer > 0.9 && !this._fired) {
          this._fired = true;
          this.spawnNuggets(this.phase === 3 ? 4 : 3);
          this.say('MY CABINET!', 1500);
        }
        if (this.timer > 1.9) {
          this.state = 'idle'; this.timer = 0; this._fired = false; this.castCharge = 0;
          this.winded = 1.6;   // summoning tires him out — punish window
        }
        break;
      }

      case 'windup': {
        // telegraph the charge
        if (this.timer > 0.85) {
          this.state = 'charge';
          this.timer = 0;
          this.chargeDir = new THREE.Vector3(
            Math.sin(this.facing), 0, Math.cos(this.facing)
          );
          this.say('EXECUTIVE ORDER!', 1200);
          this.hooks.sfx?.('charge');
        }
        break;
      }

      case 'charge': {
        const sp = 15.5;
        this.vel.x = this.chargeDir.x * sp;
        this.vel.z = this.chargeDir.z * sp;
        this.stepMove(dt);

        // body check
        const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        if (d < 2.6) this.hooks.onDamagePlayer?.(1, 'charge');

        const edge = Math.hypot(this.pos.x - this.arena.center.x, this.pos.z - this.arena.center.z);
        if (this.timer > 1.5 || edge > this.arena.radius - 4.5) {
          this.state = 'recover';
          this.timer = 0;
          this.winded = 2.6;
          this.hooks.sfx?.('slam');
          if (this.phase >= 3) this.greaseWave();
        }
        break;
      }

      case 'recover': {
        this.vel.multiplyScalar(1 - Math.min(1, 5 * dt));
        this.stepMove(dt);
        if (this.timer > 2.2) { this.state = 'idle'; this.timer = 0; }
        break;
      }

      case 'wave': {
        this.castCharge = Math.min(1, this.timer / 0.6);
        if (this.timer > 0.6 && !this._fired) { this._fired = true; this.greaseWave(); }
        if (this.timer > 1.4) { this.state = 'idle'; this.timer = 0; this._fired = false; this.castCharge = 0; }
        break;
      }

      case 'phaseShift': {
        this.castCharge = Math.min(1, this.timer / 0.5);
        if (this.timer > 1.9) { this.state = 'idle'; this.timer = 0; this.castCharge = 0; }
        break;
      }
    }
  }

  pickAttack(dist) {
    const r = this.rng();
    if (this.phase === 1) {
      if (dist < 7 && r < 0.32) this.state = 'windup';
      else this.state = 'toss';
    } else if (this.phase === 2) {
      if (r < 0.30) this.state = 'toss';
      else if (r < 0.55) this.state = 'rain';
      else if (r < 0.78) this.state = 'windup';
      else this.state = 'summon';
    } else {
      if (r < 0.24) this.state = 'toss';
      else if (r < 0.46) this.state = 'rain';
      else if (r < 0.64) this.state = 'windup';
      else if (r < 0.82) this.state = 'summon';
      else this.state = 'wave';
    }
    this.timer = 0;
    this._fired = false;
  }

  stepMove(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // stay in the arena
    const dx = this.pos.x - this.arena.center.x;
    const dz = this.pos.z - this.arena.center.z;
    const d = Math.hypot(dx, dz);
    const lim = this.arena.radius - 3.2;
    if (d > lim) {
      this.pos.x = this.arena.center.x + dx / d * lim;
      this.pos.z = this.arena.center.z + dz / d * lim;
    }
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
  }

  /** Follow the real cave floor, not a flat plane, so he never sinks. */
  groundAt(x, z) {
    return this.arena.groundAt ? this.arena.groundAt(x, z) : this.arena.floorY;
  }

  /* ---------- projectiles ---------- */
  updateProjectiles(dt, player) {
    const floor = this.arena.floorY;   // reference plane for projectile lifetimes
    const pp = player.pos;

    /* burgers */
    for (let i = this.burgers.length - 1; i >= 0; i--) {
      const b = this.burgers[i];
      b.vel.y -= 22 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.rot.x += b.spin * dt;
      b.rot.z += b.spin * 0.6 * dt;
      b.life -= dt;

      const dx = b.pos.x - pp.x, dy = b.pos.y - (pp.y + 0.9), dz = b.pos.z - pp.z;
      if (dx * dx + dy * dy + dz * dz < 1.5) {
        this.hooks.onDamagePlayer?.(1, 'burger');
        this.burgers.splice(i, 1);
        continue;
      }
      if (b.pos.y < floor - 0.2 || b.life <= 0) {
        if (b.life > 0) this.hooks.sfx?.('splat');
        this.burgers.splice(i, 1);
      }
    }

    /* telegraph rings -> fries */
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const g = this.telegraphs[i];
      g.t += dt;
      if (g.t >= g.warn) {
        for (let f = 0; f < 3; f++) {
          this.fries.push({
            pos: new THREE.Vector3(
              g.x + (this.rng() - .5) * 1.6,
              floor + 16 + this.rng() * 4,
              g.z + (this.rng() - .5) * 1.6
            ),
            vel: new THREE.Vector3(0, -20 - this.rng() * 8, 0),
            rot: { x: this.rng() * 3, y: this.rng() * 3, z: this.rng() * 3 },
            spin: (this.rng() - .5) * 6,
            life: 3,
            scale: 0.9 + this.rng() * 0.5,
          });
        }
        this.telegraphs.splice(i, 1);
      }
    }

    /* draw telegraphs */
    this.ringPool.forEach((r) => (r.visible = false));
    this.telegraphs.forEach((g, i) => {
      if (i >= this.ringPool.length) return;
      const m = this.ringPool[i];
      m.visible = true;
      m.position.set(g.x, floor + 0.08, g.z);
      const k = g.t / g.warn;
      m.scale.setScalar(g.radius * (1.35 - k * 0.35));
      m.material.opacity = 0.35 + Math.abs(Math.sin(g.t * 18)) * 0.5;
    });

    /* fries */
    for (let i = this.fries.length - 1; i >= 0; i--) {
      const f = this.fries[i];
      f.vel.y -= 18 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.rot.x += f.spin * dt;
      f.life -= dt;

      const dx = f.pos.x - pp.x, dy = f.pos.y - (pp.y + 0.9), dz = f.pos.z - pp.z;
      if (dx * dx + dz * dz < 1.1 && Math.abs(dy) < 1.3) {
        this.hooks.onDamagePlayer?.(1, 'fry');
        this.fries.splice(i, 1);
        continue;
      }
      if (f.pos.y < floor - 0.3 || f.life <= 0) this.fries.splice(i, 1);
    }

    /* grease waves */
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += dt * 15;
      w.life -= dt;
      w.mesh.scale.setScalar(w.r);
      w.mesh.material.opacity = Math.max(0, 0.8 * (w.life / 3.4));
      const d = Math.hypot(pp.x - w.mesh.position.x, pp.z - w.mesh.position.z);
      const onGround = pp.y < this.groundAt(pp.x, pp.z) + 0.9;
      if (!w.hitPlayer && Math.abs(d - w.r) < 1.3 && onGround) {
        w.hitPlayer = true;
        this.hooks.onDamagePlayer?.(1, 'wave');
      }
      if (w.life <= 0 || w.r > this.arena.radius * 1.4) {
        this.scene.remove(w.mesh);
        w.mesh.material.dispose();
        this.waves.splice(i, 1);
      }
    }

    /* nuggets */
    for (let i = this.nuggets.length - 1; i >= 0; i--) {
      const n = this.nuggets[i];
      n.life -= dt;
      n.hop += dt * 7;
      const dx = pp.x - n.pos.x, dz = pp.z - n.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = 5.4;
      n.pos.x += (dx / d) * sp * dt;
      n.pos.z += (dz / d) * sp * dt;
      n.pos.y = floor + 0.42 + Math.abs(Math.sin(n.hop)) * 0.55;
      n.rot.y = Math.atan2(dx, dz);
      n.rot.z = Math.sin(n.hop) * 0.25;

      if (d < 1.25) {
        this.hooks.onDamagePlayer?.(1, 'nugget');
        this.nuggets.splice(i, 1);
        continue;
      }
      if (n.life <= 0) this.nuggets.splice(i, 1);
    }

    this.burgerPool.items = this.burgers;
    this.fryPool.items = this.fries;
    this.nuggetPool.items = this.nuggets;
    this.burgerPool.sync();
    this.fryPool.sync();
    this.nuggetPool.sync();
  }

  /** Test a coconut against Hector and his minions. Returns hit info. */
  testHit(pos, radius = 0.55) {
    // nuggets first — they're in the way
    for (let i = this.nuggets.length - 1; i >= 0; i--) {
      const n = this.nuggets[i];
      if (pos.distanceToSquared(n.pos) < (radius + 0.7) ** 2) {
        this.nuggets.splice(i, 1);
        this.hooks.sfx?.('splat');
        return { kind: 'nugget' };
      }
    }
    if (!this.active || this.dead) return null;

    const gem = this.gemWorldPos(new THREE.Vector3());
    if (pos.distanceToSquared(gem) < (radius + 0.75) ** 2) {
      const dmg = this.hit(7, true);
      return { kind: 'gem', dmg };
    }
    const body = this.bodyWorldPos(new THREE.Vector3());
    // his hitbox is a fat capsule
    const dxz = Math.hypot(pos.x - body.x, pos.z - body.z);
    const dy = Math.abs(pos.y - body.y);
    if (dxz < radius + 1.5 && dy < 2.4) {
      const dmg = this.hit(7, false);
      return { kind: 'body', dmg };
    }
    return null;
  }

  /* ---------- animation ---------- */
  animate(dt, t, dist) {
    const P = this.parts;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += dt * (2.6 + speed * 0.55);

    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.facing;

    const walking = speed > 0.4 ? 1 : 0;
    const sw = Math.sin(this.walkPhase) * (0.28 + Math.min(0.5, speed * 0.05));

    P.legs.l.rotation.x = sw * walking;
    P.legs.r.rotation.x = -sw * walking;

    // waddle: hips roll side to side
    P.body.rotation.z = Math.sin(this.walkPhase) * 0.09 * walking;
    P.body.position.y = 2.05 + Math.abs(Math.sin(this.walkPhase)) * 0.09 * walking
      + Math.sin(t * 1.4) * 0.05;

    // belly jiggle
    const jig = 1 + Math.sin(t * 7.3) * 0.017 + Math.sin(this.walkPhase * 2) * 0.02 * walking;
    P.torso.scale.set(jig, 1 / jig, jig);

    // free arm swings, staff arm holds high while casting
    P.arms.l.rotation.x = -sw * 0.7 * walking;
    P.arms.l.rotation.z = 0.30;

    const raise = this.castCharge;
    P.arms.r.rotation.x = -0.2 - raise * 2.0;
    P.arms.r.rotation.z = -0.32 - raise * 0.25;

    // during a charge he leans in
    if (this.state === 'charge') {
      P.body.rotation.x = 0.28;
      P.arms.l.rotation.x = -1.9;
      P.arms.r.rotation.x = -1.7;
    } else if (this.state === 'recover' || this.winded > 0) {
      P.body.rotation.x = 0.42 + Math.sin(t * 9) * 0.05;
      P.head.rotation.x = 0.3;
    } else if (this.state === 'windup') {
      P.body.rotation.x = -0.16;
    } else {
      P.body.rotation.x *= 0.85;
      P.head.rotation.x *= 0.85;
    }

    // intro: staff raised, orb blazing
    if (this.state === 'intro') {
      const k = Math.min(1, this.timer / 1.2);
      P.arms.r.rotation.x = -2.4 * k;
      P.body.rotation.x = -0.2 * k;
    }

    // defeat: drop to knees, orb dies
    if (this.state === 'defeat') {
      const k = Math.min(1, this.timer / 2.0);
      P.body.rotation.x = 0.55 * k;
      P.body.position.y = 2.05 - 1.15 * k;
      P.legs.l.rotation.x = -1.1 * k;
      P.legs.r.rotation.x = -1.1 * k;
      P.arms.l.rotation.x = 0.4 * k;
      P.arms.r.rotation.x = 0.9 * k;
      P.head.rotation.x = 0.5 * k;
      P.orbLight.intensity = 2.6 * (1 - k);
    }

    // orb pulse
    const cast = 0.5 + this.castCharge * 1.6;
    const pulse = 1 + Math.sin(t * 6) * 0.08 + this.castCharge * 0.4;
    P.orb.scale.setScalar(pulse);
    P.orbLight.intensity = this.dead ? P.orbLight.intensity : 2.2 + cast + Math.sin(t * 5) * 0.5;
    P.orbLight.distance = 18 + this.castCharge * 10;

    // cape drift
    P.capeGroup.rotation.x = -0.1 + Math.sin(t * 2.2) * 0.06 + speed * 0.012;

    /* Hit flash, and a shimmer while winded so the punish window reads.
       These only touch Hector's own cloned materials. */
    let em = 0;
    if (this.hitFlash > 0) em = 0.5;
    else if (this.winded > 0 && !this.dead) em = 0.10 + Math.sin(t * 22) * 0.06;
    em = Math.max(0, em);
    for (const key of ['opaque', 'cutoutStill']) {
      const m = P.mats[key];
      if (m?.emissive) m.emissive.setScalar(em);
    }
  }

  dispose() {
    this.clearProjectiles();
    this.burgerPool.dispose();
    this.fryPool.dispose();
    this.nuggetPool.dispose();
    this.ringPool.forEach((r) => this.scene.remove(r));
    this.scene.remove(this.mesh);
  }
}
