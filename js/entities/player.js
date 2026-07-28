/* ===========================================================
   player.js — the castaway and the camera that follows them.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, ico, sphere, plane, place, tint, limb, facePatch } from '../lib/geo.js';
import { applyRegion, CELLS, makeRng } from '../lib/textures.js';
import { heightAt, slopeAt, biomeAt } from '../world/terrain.js';

const UP = new THREE.Vector3(0, 1, 0);

/* ===========================================================
   MODEL
   =========================================================== */
export function buildCastaway(mats) {
  const rng = makeRng(4242);
  const root = new THREE.Group();
  const parts = {};

  const SKIN = new THREE.Color(0xd6a273);
  const SHIRT = new THREE.Color(0xc9bda0);
  const SHORT = new THREE.Color(0x6a5f4a);
  const HAIR = new THREE.Color(0x4a3520);

  /* hips: everything hangs off this so the whole body can bob */
  const hips = new THREE.Group();
  hips.position.y = 0.90;
  root.add(hips);
  parts.hips = hips;

  /* ---- torso ---- */
  const torsoParts = [];
  const chest = new THREE.LatheGeometry([
    [0.00, 0.00], [0.20, 0.00], [0.235, 0.16], [0.245, 0.34],
    [0.225, 0.50], [0.175, 0.60], [0.09, 0.66], [0.00, 0.67],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  chest.scale(1.1, 1, 0.72);
  applyRegion(chest, CELLS.clothTat[0], CELLS.clothTat[1]);
  tint(chest, SHIRT);
  torsoParts.push(chest);

  // torn hem
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const f = box(0.09, 0.10 + rng() * 0.09, 0.05, 'clothTat', {
      pos: [Math.cos(a) * 0.21, -0.04, Math.sin(a) * 0.15], rot: [(rng() - .5) * .4, -a, 0],
    });
    tint(f, SHIRT); torsoParts.push(f);
  }
  // shorts
  const shorts = cyl(0.235, 0.215, 0.26, 8, 'clothTat', { pos: [0, -0.14, 0] });
  shorts.scale(1.1, 1, 0.8);
  tint(shorts, SHORT); torsoParts.push(shorts);

  // rope belt
  const belt = new THREE.TorusGeometry(0.225, 0.028, 4, 10);
  applyRegion(belt, CELLS.rope[0], CELLS.rope[1]);
  place(belt, { rot: [Math.PI / 2, 0, 0], pos: [0, -0.02, 0] });
  belt.scale(1.1, 1, 0.8);
  tint(belt, new THREE.Color(0xa08a5c)); torsoParts.push(belt);

  const torso = new THREE.Mesh(mergeGeos(torsoParts), mats.opaque);
  hips.add(torso);
  parts.torso = torso;

  /* ---- head ---- */
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.70;
  hips.add(headGroup);
  parts.head = headGroup;

  const headParts = [];
  const skull = sphere(0.175, 8, 6, 'skin');
  skull.scale(1, 1.1, 0.95);
  tint(skull, SKIN); headParts.push(skull);

  const neck = cyl(0.075, 0.085, 0.09, 6, 'skin', { pos: [0, -0.16, 0] });
  tint(neck, SKIN); headParts.push(neck);

  // shaggy hair
  for (let i = 0; i < 16; i++) {
    const th = Math.pow(rng(), 0.7) * 1.5;
    const ph = rng() * Math.PI * 2;
    const c = ico(0.055 + rng() * 0.035, 0, 'hair', {
      pos: [
        Math.sin(th) * Math.cos(ph) * 0.175,
        Math.cos(th) * 0.19 + 0.03,
        Math.sin(th) * Math.sin(ph) * 0.17 - 0.01,
      ],
      rot: [rng() * 3, rng() * 3, rng() * 3],
    });
    tint(c, HAIR); headParts.push(c);
  }
  // a beard, because nobody shaves out here
  for (let i = 0; i < 7; i++) {
    const c = ico(0.04 + rng() * 0.025, 0, 'hair', {
      pos: [(rng() - .5) * 0.2, -0.10 - rng() * 0.05, 0.10 + rng() * 0.05],
    });
    tint(c, HAIR); headParts.push(c);
  }
  const head = new THREE.Mesh(mergeGeos(headParts), mats.opaque);
  headGroup.add(head);

  /* ---- arms ---- */
  parts.arms = {};
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(side * 0.255, 0.54, 0);
    hips.add(g);

    const armParts = [];
    const upper = limb([0, 0, 0], [side * 0.03, -0.27, 0], 0.072, 0.062, 'clothTat');
    tint(upper, SHIRT); armParts.push(upper);
    const fore = limb([side * 0.03, -0.27, 0], [side * 0.04, -0.52, 0.02], 0.058, 0.05, 'skin');
    tint(fore, SKIN); armParts.push(fore);
    const hand = ico(0.062, 0, 'skin', { pos: [side * 0.04, -0.56, 0.02] });
    tint(hand, SKIN); armParts.push(hand);

    const mesh = new THREE.Mesh(mergeGeos(armParts), mats.opaque);
    g.add(mesh);
    parts.arms[side < 0 ? 'l' : 'r'] = g;
  }

  /* ---- legs ---- */
  parts.legs = {};
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(side * 0.115, -0.22, 0);
    hips.add(g);

    const legParts = [];
    const thigh = limb([0, 0, 0], [side * 0.01, -0.34, 0], 0.095, 0.078, 'skin');
    tint(thigh, SKIN); legParts.push(thigh);
    const shin = limb([side * 0.01, -0.34, 0], [side * 0.01, -0.66, 0.01], 0.072, 0.055, 'skin');
    tint(shin, SKIN); legParts.push(shin);
    const foot = box(0.11, 0.07, 0.22, 'skin', { pos: [side * 0.01, -0.69, 0.05] });
    tint(foot, new THREE.Color(0xb08a5e)); legParts.push(foot);

    const mesh = new THREE.Mesh(mergeGeos(legParts), mats.opaque);
    g.add(mesh);
    parts.legs[side < 0 ? 'l' : 'r'] = g;
  }

  root.userData.parts = parts;
  return root;
}

/* ===========================================================
   PLAYER
   =========================================================== */
export class Player {
  constructor(scene, mats, camera) {
    this.scene = scene;
    this.camera = camera;

    this.mesh = buildCastaway(mats);
    this.parts = this.mesh.userData.parts;
    scene.add(this.mesh);

    this.pos = new THREE.Vector3(0, 5, 0);
    this.vel = new THREE.Vector3();
    this.shake = 0;
    this.yaw = 0;         // camera yaw
    this.pitch = -0.12;   // camera pitch
    this.facing = 0;      // body yaw
    this.grounded = false;
    this.thirdPerson = true;
    this.camDist = 4.6;
    this.camDistCur = 4.6;

    this.maxHp = 5;
    this.hp = 5;
    this.invuln = 0;
    this.stamina = 1;
    this.staminaLock = false;

    this.walkPhase = 0;
    this.throwAnim = 0;
    this.bobT = 0;
    this.landSquash = 0;
    this.inWater = 0;

    this.SPEED = 7.0;
    this.SPRINT = 15.5;
    this.RADIUS = 0.42;
    this.EYE = 1.55;

    this.sensitivity = 1.4;
    this.invertY = false;
    this.propColliders = null;   // for camera collision against trunks

    this.colliders = null;   // set by the scene
    this.bounds = 128;       // how far from the origin you may swim
    this.footTimer = 0;
    this.onFootstep = null;
    this.frozen = false;
  }

  setColliders(list) {
    // bucket colliders into a grid so lookups stay O(1)
    this.colliders = list;
    this.grid = new Map();
    this.cell = 8;
    for (const c of list) {
      const k = `${Math.floor(c.x / this.cell)},${Math.floor(c.z / this.cell)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(c);
    }
  }

  nearbyColliders(x, z) {
    if (!this.grid) return [];
    const out = [];
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const a = this.grid.get(`${cx + i},${cz + j}`);
        if (a) out.push(...a);
      }
    }
    return out;
  }

  teleport(x, y, z, facing = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.yaw = facing;
    this.grounded = false;
    this.camDistCur = this.camDist;
  }

  /** Raw mouse delta in pixels; sensitivity and invert are applied here. */
  addPitchYaw(dxPx, dyPx) {
    const s = this.sensitivity * 0.0016;
    this.yaw -= dxPx * s;
    const dy = dyPx * s * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.05, 0.92);
    // keep yaw bounded so it never loses float precision in a long session
    if (this.yaw > Math.PI * 4) this.yaw -= Math.PI * 4;
    if (this.yaw < -Math.PI * 4) this.yaw += Math.PI * 4;
  }

  damage(n = 1) {
    if (this.invuln > 0 || this.hp <= 0) return false;
    this.hp = Math.max(0, this.hp - n);
    this.invuln = 1.15;
    return true;
  }

  heal(n = 1) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  get dead() { return this.hp <= 0; }

  /** Forward vector on the ground plane, from the camera yaw. */
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Where a thrown item should spawn and head. */
  throwOrigin(out = new THREE.Vector3()) {
    const f = this.forward();
    out.copy(this.pos);
    out.y += 1.35;
    return out.addScaledVector(f, 0.55);
  }

  throwDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, sp + 0.16, Math.cos(this.yaw) * cp).normalize();
  }

  update(dt, input, opts = {}) {
    const groundOf = opts.groundOf || heightAt;
    const water = opts.water !== false;

    if (this.invuln > 0) this.invuln -= dt;

    /* ---------- intent ---------- */
    let mx = 0, mz = 0;
    if (!this.frozen && !this.dead) {
      if (input.fwd) mz += 1;
      if (input.back) mz -= 1;
      if (input.left) mx -= 1;
      if (input.right) mx += 1;
    }
    const moving = mx !== 0 || mz !== 0;

    // stamina / sprint
    const wantSprint = input.sprint && moving && !this.staminaLock;
    if (wantSprint) {
      this.stamina = Math.max(0, this.stamina - dt * 0.155);
      if (this.stamina <= 0) this.staminaLock = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (moving ? 0.26 : 0.55));
      if (this.stamina > 0.28) this.staminaLock = false;
    }
    const sprinting = wantSprint && this.stamina > 0;

    let speed = sprinting ? this.SPRINT : this.SPEED;
    if (this.inWater > 0.35) speed *= 0.52;

    /* ---------- horizontal movement ---------- */
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
      /* Camera-relative basis. Forward is (sin yaw, cos yaw); looking down
         +Z with +Y up, screen-right is -X, so the right vector is
         (-cos yaw, sin yaw). Getting this backwards is what made D strafe
         left and the whole thing feel mirrored. */
      const wx = mz * sinY - mx * cosY;
      const wz = mz * cosY + mx * sinY;

      const target = new THREE.Vector3(wx * speed, 0, wz * speed);
      const accel = this.grounded ? 15 : 6;
      this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);

      // face the direction of travel
      const want = Math.atan2(wx, wz);
      let d = want - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * Math.min(1, 13 * dt);
    } else {
      const damp = this.grounded ? 14 : 3;
      this.vel.x -= this.vel.x * Math.min(1, damp * dt);
      this.vel.z -= this.vel.z * Math.min(1, damp * dt);
    }

    /* ---------- gravity + jump ---------- */
    this.vel.y -= 26 * dt;
    if (input.jump && this.grounded && !this.frozen && !this.dead) {
      this.vel.y = 9.2;
      this.grounded = false;
      if (this.onJump) this.onJump();
    }

    /* ---------- integrate + resolve ---------- */
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    let px = nx, pz = nz;

    // prop collision — push out of overlapping cylinders
    for (const c of this.nearbyColliders(px, pz)) {
      const dx = px - c.x, dz = pz - c.z;
      const rr = c.r + this.RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        px = c.x + (dx / d) * rr;
        pz = c.z + (dz / d) * rr;
      }
    }

    // world bounds — the sea sends you back
    if (opts.bounds !== false) {
      const dr = Math.hypot(px, pz);
      if (dr > this.bounds) {
        px = (px / dr) * this.bounds;
        pz = (pz / dr) * this.bounds;
        if (this.onBounds) this.onBounds();
      }
    }

    // interior walls — an axis-aligned box you must stay inside
    if (opts.insideBox) {
      const b = opts.insideBox;
      const r = this.RADIUS;
      px = THREE.MathUtils.clamp(px, b.minX + r, b.maxX - r);
      pz = THREE.MathUtils.clamp(pz, b.minZ + r, b.maxZ - r);
    }

    this.pos.x = px; this.pos.z = pz;
    this.pos.y += this.vel.y * dt;

    /* ---------- ground ---------- */
    const g = groundOf(this.pos.x, this.pos.z);
    const floor = water ? Math.max(g, -1.35) : g;

    if (this.pos.y <= floor) {
      if (!this.grounded && this.vel.y < -9) {
        this.landSquash = Math.min(1, -this.vel.y / 24);
        if (this.onLand) this.onLand(-this.vel.y);
      }
      this.pos.y = floor;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.pos.y > floor + 0.06) {
      this.grounded = false;
    }

    // wading
    if (water) {
      const depth = Math.max(0, 0 - g);
      this.inWater = THREE.MathUtils.clamp(depth / 1.4, 0, 1) * (this.pos.y < 0.5 ? 1 : 0);
    } else {
      this.inWater = 0;
    }

    /* ---------- footsteps ---------- */
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hspeed > 1.2) {
      this.footTimer -= dt * hspeed;
      if (this.footTimer <= 0) {
        this.footTimer = 3.4;
        if (this.onFootstep) {
          this.onFootstep(this.inWater > 0.25 ? 'water' : biomeAt(this.pos.x, this.pos.z));
        }
      }
    } else {
      this.footTimer = 0.6;
    }

    /* ---------- animate ---------- */
    this.animate(dt, hspeed, sprinting);

    /* ---------- camera ---------- */
    this.updateCamera(dt, groundOf);

    return { sprinting, hspeed };
  }

  animate(dt, hspeed, sprinting) {
    const p = this.parts;
    this.bobT += dt;

    const running = THREE.MathUtils.clamp(hspeed / this.SPEED, 0, 1.5);
    this.walkPhase += dt * (4.6 + running * 5.2) * (hspeed > 0.4 ? 1 : 0);
    const ph = this.walkPhase;

    const swing = Math.sin(ph) * (0.45 + running * 0.45);
    const swing2 = Math.sin(ph + Math.PI) * (0.45 + running * 0.45);

    if (this.grounded) {
      p.legs.l.rotation.x = swing;
      p.legs.r.rotation.x = swing2;
      p.arms.l.rotation.x = swing2 * 0.85;
      p.arms.r.rotation.x = swing * 0.85;
      p.arms.l.rotation.z = 0.16;
      p.arms.r.rotation.z = -0.16;
    } else {
      // airborne tuck
      const t = THREE.MathUtils.clamp(-this.vel.y / 12 + 0.5, 0, 1);
      p.legs.l.rotation.x = THREE.MathUtils.lerp(p.legs.l.rotation.x, -0.5 + t * 0.7, 0.2);
      p.legs.r.rotation.x = THREE.MathUtils.lerp(p.legs.r.rotation.x, 0.35 - t * 0.5, 0.2);
      p.arms.l.rotation.x = THREE.MathUtils.lerp(p.arms.l.rotation.x, -1.6, 0.2);
      p.arms.r.rotation.x = THREE.MathUtils.lerp(p.arms.r.rotation.x, -1.6, 0.2);
    }

    // throw pose overrides the right arm
    if (this.throwAnim > 0) {
      this.throwAnim -= dt * 3.4;
      const t = THREE.MathUtils.clamp(this.throwAnim, 0, 1);
      p.arms.r.rotation.x = -Math.PI * 1.05 * t + (1 - t) * 0.5;
      p.arms.r.rotation.z = -0.4 * t;
      p.torso.rotation.y = -0.35 * t;
    } else {
      p.torso.rotation.y *= 0.85;
    }

    // body bob + landing squash
    const bob = this.grounded ? Math.abs(Math.sin(ph)) * 0.045 * running : 0;
    this.landSquash *= 0.86;
    p.hips.position.y = 0.90 + bob - this.landSquash * 0.28;
    p.hips.scale.y = 1 - this.landSquash * 0.18;
    p.hips.scale.x = p.hips.scale.z = 1 + this.landSquash * 0.12;

    // idle breathing
    if (hspeed < 0.4 && this.grounded) {
      const b = Math.sin(this.bobT * 1.7) * 0.02;
      p.hips.position.y = 0.90 + b;
      p.legs.l.rotation.x *= 0.85;
      p.legs.r.rotation.x *= 0.85;
      p.arms.l.rotation.x = THREE.MathUtils.lerp(p.arms.l.rotation.x, 0.06 + b, 0.12);
      p.arms.r.rotation.x = THREE.MathUtils.lerp(p.arms.r.rotation.x, 0.06 - b, 0.12);
    }

    // head looks where the camera looks
    p.head.rotation.x = THREE.MathUtils.clamp(-this.pitch * 0.45, -0.4, 0.5);

    // wading dip
    const sink = this.inWater * 0.42;
    this.mesh.position.set(this.pos.x, this.pos.y - sink, this.pos.z);
    this.mesh.rotation.y = this.facing;

    // blink while invulnerable
    const blink = this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0;
    this.mesh.visible = this.thirdPerson && !blink;
  }

  updateCamera(dt, groundOf) {
    const cam = this.camera;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // a short, decaying jolt — enough to register as an impact, not enough
    // to make anybody seasick
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);

    if (this.thirdPerson) {
      const targetY = this.pos.y + 1.42;
      // orbit direction, pointing back from the player
      const dirX = -Math.sin(this.yaw) * cp;
      const dirZ = -Math.cos(this.yaw) * cp;
      const dirY = -sp;

      // shoulder offset, perpendicular to view, so the body isn't dead centre
      const rightX = -Math.cos(this.yaw), rightZ = Math.sin(this.yaw);
      const SHOULDER = 0.5;

      let dist = this.camDist;

      // terrain
      for (let s = 1; s <= 8; s++) {
        const t = (s / 8) * this.camDist;
        const sx = this.pos.x + dirX * t + rightX * SHOULDER;
        const sz = this.pos.z + dirZ * t + rightZ * SHOULDER;
        const sy = targetY + dirY * t;
        if (sy < groundOf(sx, sz) + 0.55) { dist = Math.max(2.1, t - 0.45); break; }
      }

      // tree trunks and rocks — without this the camera spends the whole
      // jungle buried inside a palm
      if (this.grid) {
        for (const c of this.nearbyColliders(this.pos.x, this.pos.z)) {
          if (c.r < 0.7) continue;   // saplings shouldn't shove the camera
          const r = c.r + 0.35;
          for (let s = 1; s <= 6; s++) {
            const t = (s / 6) * dist;
            const sx = this.pos.x + dirX * t + rightX * SHOULDER;
            const sz = this.pos.z + dirZ * t + rightZ * SHOULDER;
            if ((sx - c.x) ** 2 + (sz - c.z) ** 2 < r * r) {
              // never inside the body: at 1.2 the camera sat in the head
              dist = Math.max(2.1, t - 0.4);
              break;
            }
          }
        }
      }

      // snap in fast, ease out slow — avoids nauseating pops
      const k = dist < this.camDistCur ? 1 : Math.min(1, 5 * dt);
      this.camDistCur += (dist - this.camDistCur) * k;

      cam.position.set(
        this.pos.x + dirX * this.camDistCur + rightX * SHOULDER,
        targetY + dirY * this.camDistCur,
        this.pos.z + dirZ * this.camDistCur + rightZ * SHOULDER
      );
      cam.lookAt(
        this.pos.x + rightX * SHOULDER * 0.45,
        targetY + 0.22,
        this.pos.z + rightZ * SHOULDER * 0.45
      );
    } else {
      const bob = Math.sin(this.walkPhase * 2) * 0.035 * (this.grounded ? 1 : 0);
      const j = this.shake > 0 ? this.shake * 0.09 : 0;
      cam.position.set(
        this.pos.x + (j ? Math.sin(this.shake * 47) * j : 0),
        this.pos.y + this.EYE - this.inWater * 0.4 + bob + (j ? Math.sin(this.shake * 31) * j : 0),
        this.pos.z
      );
      const lx = this.pos.x + Math.sin(this.yaw) * cp;
      const ly = cam.position.y + sp;
      const lz = this.pos.z + Math.cos(this.yaw) * cp;
      cam.lookAt(lx, ly, lz);
    }
  }

  toggleView() {
    this.thirdPerson = !this.thirdPerson;
    this.mesh.visible = this.thirdPerson;
    return this.thirdPerson;
  }

  playThrow() { this.throwAnim = 1; }

  /** Knock the camera about for a moment. 0..1. */
  punch(amount = 0.5) { this.shake = Math.max(this.shake || 0, amount); }
}
