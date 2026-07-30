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
    /* How fast sprinting costs you and how fast you get it back, per second.
       These were hard-coded numbers inside update() and `staminaDrain` was a
       property three different things wrote to and nothing ever read — so
       the cane tonic, the deck boots and everything else that claimed to
       change your wind did precisely nothing. */
    this.BASE_DRAIN = 0.155;
    this.BASE_REGEN = 0.26;
    this.staminaDrain = this.BASE_DRAIN;
    this.staminaRegen = this.BASE_REGEN;

    this.walkPhase = 0;
    this.throwAnim = 0;
    this.bobT = 0;
    this.landSquash = 0;
    this.inWater = 0;
    /** How far off your own feet take you. Set by the bar. */
    this.drift = 0;

    this.SPEED = 7.0;
    this.SPRINT = 15.5;
    /* The unencumbered figures, kept so anything that slows you down (the
       cork vest) has something to restore you to rather than guessing. */
    this.BASE_SPEED = this.SPEED;
    this.BASE_SPRINT = this.SPRINT;
    this.FOV_THIRD = 66;
    this.FOV_FIRST = 78;
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
      this.stamina = Math.max(0, this.stamina - dt * this.staminaDrain);
      if (this.stamina <= 0) this.staminaLock = true;
    } else {
      // you get it back faster standing still than walking
      this.stamina = Math.min(1, this.stamina + dt * this.staminaRegen * (moving ? 1 : 2.1));
      if (this.stamina > 0.28) this.staminaLock = false;
    }
    const sprinting = wantSprint && this.stamina > 0;

    let speed = sprinting ? this.SPRINT : this.SPEED;
    if (this.inWater > 0.35) speed *= 0.52;

    /* ---------- horizontal movement ---------- */
    if (moving) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      /* Drink. `drift` is set by whatever is in you and rotates where you
         actually go away from where you pointed — so you can still get
         where you are going, you just have to keep correcting, which is
         exactly what walking home drunk is. */
      if (this.drift) {
        const c2 = Math.cos(this.drift), s2 = Math.sin(this.drift);
        const ox = mx, oz = mz;
        mx = ox * c2 - oz * s2;
        mz = ox * s2 + oz * c2;
      }
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

    /* Interior walls — an axis-aligned box you must stay inside. Kept on
       the player so updateCamera can honour it too; without that the
       camera swings through the wall the moment your back is to one. */
    this.insideBox = opts.insideBox || null;
    if (opts.insideBox) {
      const b = opts.insideBox;
      const r = this.RADIUS;
      px = THREE.MathUtils.clamp(px, b.minX + r, b.maxX - r);
      pz = THREE.MathUtils.clamp(pz, b.minZ + r, b.maxZ - r);
    }

    this.pos.x = px; this.pos.z = pz;
    this.pos.y += this.vel.y * dt;

    /* ---------- ground ---------- */
    // the third argument lets a platform decide whether you are on top of it
    const g = groundOf(this.pos.x, this.pos.z, this.pos.y);
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
    if (!this.thirdPerson) { this._buildViewHands(); this.updateViewHands(hspeed); }
    else if (this.viewHands) this.viewHands.visible = false;

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

      /* A shorter leash indoors. In a room the wall is often two metres
         behind you, and the further the camera WANTS to be the more it has to
         travel every time you turn — which is what the pumping actually is.
         Pulling it in halves the range it can swing over. */
      let dist = this.insideBox ? Math.min(this.camDist, 2.9) : this.camDist;
      const ox = this.pos.x + rightX * SHOULDER;
      const oz = this.pos.z + rightZ * SHOULDER;

      /* Terrain. Only outdoors: inside a room the floor and ceiling are flat
         and the slab test below handles them exactly, whereas this walk along
         the ray in eight steps makes the distance jump between step
         boundaries as you turn — and because the camera snaps inward
         instantly and eases outward slowly, every jump is a visible pump. */
      if (!this.insideBox) {
        for (let s = 1; s <= 8; s++) {
          const t = (s / 8) * dist;
          const sx = ox + dirX * t;
          const sz = oz + dirZ * t;
          const sy = targetY + dirY * t;
          if (sy < groundOf(sx, sz, sy) + 0.55) { dist = Math.max(2.1, t - 0.45); break; }
        }
      }

      /* Trunks, rocks and furniture — without this the camera spends the
         whole jungle buried inside a palm.

         Solved rather than sampled: the first hit along the ray comes out of
         the quadratic, so the distance changes smoothly as you turn instead
         of stepping between six sample points. */
      if (this.grid) {
        const a2 = dirX * dirX + dirZ * dirZ;
        if (a2 > 1e-6) {
          for (const c of this.nearbyColliders(this.pos.x, this.pos.z)) {
            if (c.r < 0.7) continue;   // saplings shouldn't shove the camera
            const r = c.r + 0.35;
            const ex = ox - c.x, ez = oz - c.z;
            const b2 = 2 * (ex * dirX + ez * dirZ);
            const cc = ex * ex + ez * ez - r * r;
            /* If the camera's own origin is already inside the inflated
               circle, this collider cannot usefully constrain anything —
               movement collision guarantees the BODY is outside it, so this
               only happens because we inflate by 35cm for the camera. Jamming
               the distance to its minimum here is what made the camera pop
               whenever you stood beside a big prop. Ignore it instead. */
            if (cc < 0) continue;
            const disc = b2 * b2 - 4 * a2 * cc;
            if (disc <= 0) continue;
            const t = (-b2 - Math.sqrt(disc)) / (2 * a2);
            if (t > 0 && t < dist) dist = Math.max(1.3, t - 0.15);
          }
        }
      }

      /* Indoors the camera has to respect the walls. The listening post is a
         sealed box and the ladder is right against the far wall, so without
         this the camera swings through the concrete and you are looking at
         the room from inside the rock.

         This is an exact ray-box intersection, not a walk along the ray in
         ten steps. Sampling meant the distance jumped between step
         boundaries as you turned, and because the camera snaps inward
         instantly but eases outward slowly, every jump showed up as a pump —
         that was the juddering down there. A slab test gives one stable
         number that changes smoothly with the angle. */
      const box = this.insideBox;
      if (box) {
        const M = 0.5;                       // keep this far off every surface
        const oy = targetY;
        let limit = dist;
        const slab = (o, d, lo, hi) => {
          if (Math.abs(d) < 1e-5) return Infinity;
          const bound = d > 0 ? hi : lo;
          const t = (bound - o) / d;
          return t > 0 ? t : Infinity;
        };
        limit = Math.min(limit, slab(ox, dirX, box.minX + M, box.maxX - M));
        limit = Math.min(limit, slab(oz, dirZ, box.minZ + M, box.maxZ - M));
        limit = Math.min(limit, slab(oy, dirY, 0.55, (box.maxY ?? 4.0) - 0.35));
        // never inside the body: at anything under 1.3 the camera is in the head
        dist = Math.max(1.3, Math.min(dist, limit));
      }

      if (cam.fov !== this.FOV_THIRD) {
        cam.fov = this.FOV_THIRD;
        cam.updateProjectionMatrix();
      }
      /* Snap in fast, ease out slow — avoids nauseating pops. Indoors it
         eases out faster, because in a tight room the free distance changes
         very quickly as you turn and a slow recovery reads as lag. */
      const k = dist < this.camDistCur ? 1 : Math.min(1, (this.insideBox ? 10 : 5) * dt);
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
      /* A wider lens in first person. Sixty-six degrees over the shoulder is
         comfortable; from inside your own head it feels like looking down a
         tube, and you cannot see your own feet. */
      if (cam.fov !== this.FOV_FIRST) {
        cam.fov = this.FOV_FIRST;
        cam.updateProjectionMatrix();
      }
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

  /**
   * The hands you see in first person.
   *
   * Bolted to the camera and hung mostly off the bottom of the frame — you
   * should get a suggestion of forearms swinging as you walk, not a pair of
   * gloves filling the screen. Built on demand and reused.
   */
  _buildViewHands() {
    if (this.viewHands) return this.viewHands;
    const g = new THREE.Group();
    /* Darker than you would guess. These are twenty centimetres from a
       camera standing in tropical sun, so anything pale reads as two white
       slabs at the bottom of the frame. */
    const skin = new THREE.MeshLambertMaterial({ color: 0x8f6f52 });
    const knuckle = new THREE.MeshLambertMaterial({ color: 0x9c7a5b });
    const cuff = new THREE.MeshLambertMaterial({ color: 0x6a6455 });
    const arms = [];
    /* Short, and well clear of the near plane.

       The first version had a 34cm forearm whose elbow end sat at z = -0.38
       — the camera's near plane is at 0.35, so the sleeve was clipping
       through it, and the walk cycle moved them along z as well, which drove
       them in and out of the near plane every stride. That is the "camera
       intersecting into them" and the weird movement both.

       Everything is 60cm out now, the forearm is 20cm, and nothing about the
       stride touches z. */
    for (const side of [-1, 1]) {
      const a = new THREE.Group();
      // the forearm, short: a wrist and a little sleeve, nothing more
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.20), skin);
      fore.position.set(0, 0, -0.10);
      a.add(fore);
      // a rolled cuff at the near end, which is where the arm leaves frame
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.07), cuff);
      sl.position.set(0, 0, 0.015);
      a.add(sl);
      /* The hand. A palm, four knuckles and a thumb: seen from behind at
         this size the knuckle line is the only thing that says "hand" rather
         than "block". */
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.050, 0.095), skin);
      palm.position.set(0, 0, -0.23);
      a.add(palm);
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.030, 0.055), knuckle);
        f.position.set(-0.030 + k * 0.020, -0.004, -0.305);
        f.rotation.x = 0.28 + k * 0.05;
        a.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.034, 0.058), knuckle);
      thumb.position.set(side * -0.048, -0.002, -0.245);
      thumb.rotation.y = side * -0.5;
      a.add(thumb);

      /* Out to the sides and a touch higher. At the very bottom of the frame
         they sat behind the belt and the interaction prompt, which own that
         band in Castaways — visible geometry nobody could see.

         Rolled so you are looking at the back of the hand and along the
         knuckles, not down onto the flat top of a box. */
      a.position.set(side * 0.58, -0.30, -0.62);
      a.rotation.set(-0.52, side * 0.34, side * -0.30);
      g.add(a);
      arms.push({ a, side });
    }
    g.userData.arms = arms;
    this.viewHands = g;
    this.camera.add(g);
    /* Anything parented to the camera only renders if the camera itself is
       in the scene graph being traversed. Without this the hands existed and
       were marked visible and were simply never drawn. */
    return g;
  }

  /** Swing them with your stride, and keep them out of the way otherwise. */
  updateViewHands(hspeed = 0) {
    const g = this.viewHands;
    if (!g) return;
    g.visible = !this.thirdPerson && !this.dead;
    if (!g.visible) return;
    /* Anything parented to the camera only renders if the camera is in the
       scene being traversed — and the player moves between the island, the
       temple, the listening post and the room behind the painting, so the
       camera has to follow whichever scene its own mesh is in.
       Without this the hands existed, were visible, and were never drawn. */
    const sc = this.mesh.parent;
    if (sc && this.camera.parent !== sc) sc.add(this.camera);
    /* The stride moves them up and down and rocks them, and never along z.
       Anything that changes their distance from the eye walks them through
       the near plane. */
    const run = Math.min(1.5, hspeed / Math.max(1, this.SPEED));
    for (const { a, side } of g.userData.arms) {
      const ph = this.walkPhase + (side > 0 ? Math.PI : 0);
      a.position.y = -0.30 + Math.sin(ph) * 0.026 * run;
      a.rotation.x = -0.52 + Math.sin(ph) * 0.09 * run;
      a.rotation.z = side * -0.30 + Math.cos(ph) * 0.05 * run;
    }
  }

  toggleView() {
    this.thirdPerson = !this.thirdPerson;
    this.mesh.visible = this.thirdPerson;
    if (!this.thirdPerson) this._buildViewHands();
    if (this.viewHands) this.viewHands.visible = !this.thirdPerson;
    return this.thirdPerson;
  }

  playThrow() { this.throwAnim = 1; }

  /** Knock the camera about for a moment. 0..1. */
  punch(amount = 0.5) { this.shake = Math.max(this.shake || 0, amount); }
}
