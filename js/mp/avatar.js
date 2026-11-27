/* ===========================================================
   avatar.js — the other castaways.

   Snapshots land at ~12Hz. Drawing players exactly where the last
   packet put them looks like a slideshow, so each avatar keeps a
   small buffer and renders ~120ms in the past, interpolating
   between the two snapshots that straddle that time. You trade a
   tenth of a second of latency for motion that never stutters,
   which for a game about watching where people walk is the right
   side of the trade.
   =========================================================== */

import * as THREE from 'three';
import { buildCastaway, buildSkeleton, CastawayRig, gaitRate } from '../entities/player.js';
import { COLOURS } from '../net/protocol.js';
import { heightAt } from '../world/terrain.js';

/* How far behind the newest snapshot we render.

   This used to be a fixed 0.14s against a 55ms send rate — two and a half
   snapshots of buffer, which is fine on a LAN and far too tight over the
   internet, where a single 100ms hiccup empties the buffer and the avatar
   coasts. Coasting reads as stutter, and stutter is what "not smooth with
   friends" actually is.

   So it adapts: we measure the real arrival interval and its jitter, and sit
   behind the newest packet by the interval plus a couple of jitters. A good
   connection gets a short delay and tight, responsive motion; a bad one
   quietly buys itself more buffer instead of juddering. */
const DELAY_MIN = 0.09;
const DELAY_MAX = 0.34;
const BUFFER = 24;
const COAST = 0.22;             // how long we will guess for before giving up
/* Smoothing rates, per second, all applied as 1 - exp(-rate·dt) so they
   behave the same at any frame rate. */
const ERR_DECAY = 11;           // how fast a correction is walked off
const SPEED_RATE = 9;           // how fast the gait follows a change of speed
const YAW_RATE = 16;
const _e = (rate, dt) => 1 - Math.exp(-rate * dt);

/* Arrival statistics, shared by every avatar — snapshots come in one packet,
   so the timing is a property of the connection, not of any one player. */
const net = { last: 0, mean: 0.055, jitter: 0.012, delay: 0.14, stamp: 0, tick: 0.04 };

/** A new room connection must not inherit the previous connection's jitter. */
export function resetSnapshotTiming() {
  Object.assign(net, { last: 0, mean: 0.055, jitter: 0.012, delay: 0.14, stamp: 0, tick: 0.04 });
}

/** Called once per snapshot, from whoever received it. */
export function noteSnapshot(t) {
  if (!Number.isFinite(t)) return;
  let ticks = 1;
  if (net.last) {
    const gap = Math.min(0.6, Math.max(0.005, t - net.last));
    /* The send interval itself, learned only from gaps that look like one
       tick — a dropped packet makes a gap of two, and folding that into the
       estimate is what the mean below does and this must not. */
    if (gap < net.tick * 1.6 && gap > net.tick * 0.4) net.tick += (gap - net.tick) * 0.05;
    ticks = Math.max(1, Math.round(gap / net.tick));
    // exponential means: cheap, and they forget a bad patch soon enough
    net.mean += (gap - net.mean) * 0.12;
    net.jitter += (Math.abs(gap - net.mean) - net.jitter) * 0.12;
  }
  /* The time a snapshot is filed under. Positions are sent on a steady
     tick but ARRIVE with jitter, and filing each under its arrival time
     put evenly spaced positions at uneven times: interpolating those makes
     the body speed up and slow down on every packet (a 7m/s run measured
     +-2.7m/s frame to frame), which is the judder and the twitchy legs. So
     the stamp runs on its own steady clock — the last stamp plus the mean
     interval, counting any ticks a dropped packet skipped — and is only
     nudged toward the arrival times, so it settles on their average. */
  /* Resync only when the clock has drifted far from the arrivals. A burst
     after a stall arrives slightly behind the steady clock; rewinding to it
     filed that snapshot before the newest one and every avatar dropped it. */
  if (!net.stamp || Math.abs(t - net.stamp) > 0.5) {
    net.stamp = t;
  } else {
    const predicted = net.stamp + net.tick * ticks;
    net.stamp = Math.max(net.stamp + 0.005, predicted + (t - predicted) * 0.08);
  }
  net.last = t;
  const want = net.mean + net.jitter * 2.5;
  const clamped = Math.max(DELAY_MIN, Math.min(DELAY_MAX, want));
  // ease toward it, so the delay itself never jumps and shunts everybody
  net.delay += (clamped - net.delay) * 0.15;
}

export function colourHex(id) {
  return (COLOURS.find((c) => c.id === id) || COLOURS[0]).hex;
}

/**
 * Dye a castaway's shirt so players are told apart at a glance.
 * Skin keeps its own colour — a bright red arm reads as a glitch,
 * a bright red shirt reads as a player.
 */
export function dyeCastaway(parts, colourId) {
  const c = new THREE.Color(colourHex(colourId));
  const paint = (mesh, keepSkin) => {
    if (!mesh) return;
    const attr = mesh.geometry.attributes.color;
    if (!attr) return;
    if (!mesh.userData.baseColor) mesh.userData.baseColor = attr.array.slice();
    const base = mesh.userData.baseColor;
    for (let i = 0; i < attr.count; i++) {
      const r = base[i * 3], g = base[i * 3 + 1], b = base[i * 3 + 2];
      // skin is warm, red-dominant and fairly light; leave it be
      const isSkin = keepSkin && r > g && g > b && (r - b) < 0.42 && r > 0.25;
      if (isSkin) { attr.setXYZ(i, r, g, b); continue; }
      const lum = 0.3 * r + 0.6 * g + 0.1 * b;
      const k = 0.55 + lum * 0.9;
      attr.setXYZ(i, c.r * k, c.g * k, c.b * k);
    }
    attr.needsUpdate = true;
  };
  paint(parts.torso, false);
  paint(parts.arms.l.children[0], true);
  paint(parts.arms.r.children[0], true);
}

/* Every mark draws the same ring, and setShell used to build a fresh
   RingGeometry each time an Agent's nearest victim changed — hundreds of
   orphaned geometries over a round, none of them ever disposed. One shared
   geometry costs nothing to keep: _shellFollow moves and scales the ring
   mesh, never its geometry. */
const RING_GEO = new THREE.RingGeometry(0.62, 0.86, 16, 1);
RING_GEO.rotateX(-Math.PI / 2);

export class Avatar {
  constructor(scene, mats, record) {
    this.id = record.id;
    this.name = record.name || '';
    this.colour = record.colour || 'red';
    this.alive = record.alive !== false;

    this.mesh = buildCastaway(mats);
    this.parts = this.mesh.userData.parts;
    this.scene = scene;
    scene.add(this.mesh);
    this._recolour(this.colour);

    this.shell = null;           // outline / thermal silhouette
    this.shellKind = null;
    this.buf = [];               // { t, x, y, z, yaw, anim }
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.walkPhase = 0;
    this.speed = 0;
    this.rig = new CastawayRig();
    this._pose = { phase: 0, speed: 0, grounded: true, vy: 0, task: 0, squash: 0, turn: 0, look: 0 };
    /* What is drawn is `pos` plus a correction that decays. When a late
       packet lands and the interpolated position jumps — the coast guessed
       on, and they had stopped — the jump goes into `err` and is walked off
       over a fraction of a second instead of teleporting the body back. At
       a steady speed `err` stays zero, so this costs no latency. */
    this.err = new THREE.Vector3();
    this._lastPos = new THREE.Vector3();
    this._lastVel = new THREE.Vector3();
    this._hasLast = false;
    this.vy = 0;
    this.air = false;
    this.airT = 0;
    this.drawYaw = 0;
    this.turn = 0;
    this.sink = 0;
    // A roster arrives before positions. Do not briefly spawn everyone at 0,0.
    this.visible = false;
    this.mesh.visible = false;
  }

  _recolour(colourId) {
    this.colour = colourId;
    dyeCastaway(this.parts, colourId);
  }

  setRecord(r) {
    if (r.name !== undefined) this.name = r.name;
    if (r.colour && r.colour !== this.colour) this._recolour(r.colour);
    if (r.alive !== undefined) this.alive = r.alive;
  }

  /** Push a snapshot. `t` is the local receive time. */
  push(t, x, y, z, yaw, anim, room = this.room || 0) {
    if (![t, x, y, z, yaw].every(Number.isFinite)) return;
    // filed on the de-jittered clock when this is the snapshot it was set for
    const steady = t === net.last && net.stamp;
    if (steady) t = net.stamp;
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) {
      /* The live snapshot (reliable, ordered channel) is never stale: a
         wobble in the steady clock must not throw it away. A genuinely
         older raw time is. */
      if (!steady) return;
      t = last.t + 1e-3;
    }
    // Interior coordinates are unrelated to the island. Interpolating a
    // ladder or council teleport sends a player flying through the walls.
    const jumped = last && (room !== this.room || Math.hypot(x - last.x, y - last.y, z - last.z) > 12);
    if (jumped) this.buf.length = 0;
    if (!this.buf.length) {
      this.pos.set(x, y, z);
      this.yaw = yaw;
      this.speed = 0;
      this.drawYaw = yaw;
      this.err.set(0, 0, 0);
      this._hasLast = false;
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = yaw;
    } else if (last.t === t) {
      this.buf.pop();
    }
    this.room = room;
    this.buf.push({ t, x, y, z, yaw, anim });
    while (this.buf.length > BUFFER) this.buf.shift();
  }

  update(dt, nowT) {
    const target = nowT - net.delay;
    const b = this.buf;

    if (b.length === 0) return;
    if (b.length === 1) {
      this.speed = 0;
      this.pos.set(b[0].x, b[0].y, b[0].z);
      this.yaw = b[0].yaw;
    } else {
      const newest = b[b.length - 1];
      /* If the newest packet is older than where we want to be, the buffer
         has run dry — a dropped or late snapshot. Carry on for a fifth of a
         second rather than stopping dead, because a body that freezes and
         teleports is far more obvious than one that drifts a few centimetres
         wrong — but slow to a stop over it instead of running on at full
         speed, so a player who really did stop is overshot by half as much
         and is walked back by `err` rather than snapped. */
      if (target > newest.t) {
        const prev = b[b.length - 2];
        const span = Math.max(1e-4, newest.t - prev.t);
        const over = Math.min(COAST, target - newest.t);
        const k2 = (over - (over * over) / (2 * COAST)) / span;
        this.pos.set(
          newest.x + (newest.x - prev.x) * k2,
          newest.y + (newest.y - prev.y) * k2,
          newest.z + (newest.z - prev.z) * k2
        );
        /* Shortest way round, but not by subtracting 2PI until it fits.
           Nothing between a peer's keyboard and here rejects a yaw of 1e300,
           and above ~5.6e16 `d -= Math.PI * 2` leaves d unchanged, so the
           loop that used to be here never ended: one packet froze every tab
           in the lobby. atan2 of the sine and cosine picks the same angle
           and cannot spin. */
        const d2 = Math.atan2(Math.sin(newest.yaw - prev.yaw), Math.cos(newest.yaw - prev.yaw));
        const y2 = newest.yaw + d2 * Math.min(1, k2);
        // a NaN written to rotation.y poisons the matrix and the body vanishes
        if (Number.isFinite(y2)) this.yaw = y2;
      } else {
        // find the pair straddling `target`
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > target) i--;
        const a = b[Math.max(0, i - 1)], c = b[i];
        const span = Math.max(1e-4, c.t - a.t);
        const k = THREE.MathUtils.clamp((target - a.t) / span, 0, 1);
        this.pos.set(
          THREE.MathUtils.lerp(a.x, c.x, k),
          THREE.MathUtils.lerp(a.y, c.y, k),
          THREE.MathUtils.lerp(a.z, c.z, k)
        );
        // shortest-way yaw, wrapped the way the coast branch above explains
        const d = Math.atan2(Math.sin(c.yaw - a.yaw), Math.cos(c.yaw - a.yaw));
        const y = a.yaw + d * k;
        if (Number.isFinite(y)) this.yaw = y;
      }
    }

    this._draw(dt);
    this._animate(dt, b[b.length - 1].anim);
    this._shellFollow();
  }

  /* Turn the logical position into what is drawn: the decaying correction,
     a speed and vertical speed smoothed out of the stair-step a 12Hz
     interpolation makes of them, a yaw that turns rather than ticks, and
     the same wading dip your own castaway gets. */
  _draw(dt) {
    const p = this.pos;
    const step = dt > 1e-4 ? dt : 1e-4;
    if (this._hasLast) {
      // where we would be if they had kept going as they were
      const ex = this._lastPos.x + this._lastVel.x * step - p.x;
      const ey = this._lastPos.y + this._lastVel.y * step - p.y;
      const ez = this._lastPos.z + this._lastVel.z * step - p.z;
      /* Only a real jump goes into the correction. A player stopping or
         turning also misses the prediction, by a few centimetres a frame,
         and feeding that in carried the body past where they stopped. */
      const e2 = ex * ex + ey * ey + ez * ez;
      if (e2 >= 9) this.err.set(0, 0, 0);
      else if (e2 > 0.2 * 0.2) { this.err.x += ex; this.err.y += ey; this.err.z += ez; }
      const vx = (p.x - this._lastPos.x) / step;
      const vy = (p.y - this._lastPos.y) / step;
      const vz = (p.z - this._lastPos.z) / step;
      this._lastVel.set(vx, vy, vz);
      const hs = Math.hypot(vx, vz);
      // a teleport is not a sprint
      if (hs < 40) this.speed += (hs - this.speed) * _e(SPEED_RATE, dt);
      if (Math.abs(vy) < 40) this.vy += (vy - this.vy) * _e(14, dt);
    } else {
      this.err.set(0, 0, 0);
      this._lastVel.set(0, 0, 0);
      this.vy = 0;
      this.drawYaw = this.yaw;
    }
    this._lastPos.copy(p);
    this._hasLast = true;
    if (this.buf.length === 1) this.speed = 0;
    this.err.multiplyScalar(Math.exp(-ERR_DECAY * dt));

    /* Airborne, inferred: nothing on the wire says so. A jump leaves at
       nine metres a second and a fall comes back faster than any slope
       anybody can walk; landing is the vertical speed coming back to rest. */
    if (!this.air) {
      if (this.vy > 5.5 || this.vy < -6.5) { this.air = true; this.airT = 0; }
    } else {
      this.airT += dt;
      if ((this.airT > 0.15 && Math.abs(this.vy) < 1.2) || this.airT > 2.5) this.air = false;
    }

    // yaw: turn toward the interpolated heading, the short way round
    const dy = Math.atan2(Math.sin(this.yaw - this.drawYaw), Math.cos(this.yaw - this.drawYaw));
    const turnStep = dy * _e(YAW_RATE, dt);
    this.drawYaw += turnStep;
    if (this.drawYaw > Math.PI) this.drawYaw -= Math.PI * 2;
    else if (this.drawYaw < -Math.PI) this.drawYaw += Math.PI * 2;
    this.turn = dt > 0 ? turnStep / dt : 0;

    /* Wading. Your own body drops 0.42 at full depth and theirs did not, so
       everybody else swam standing on the water. Only outdoors: every room
       has its own coordinates and no sea. */
    let sinkGoal = 0;
    if (!this.room && p.y < 0.5) {
      const depth = Math.max(0, -heightAt(p.x, p.z));
      sinkGoal = Math.min(1, depth / 1.4) * 0.42;
    }
    this.sink += (sinkGoal - this.sink) * _e(8, dt);

    this.mesh.position.set(p.x + this.err.x, p.y + this.err.y - this.sink, p.z + this.err.z);
    this.mesh.rotation.y = this.drawYaw;
  }

  _shellFollow() {
    if (this.shell) {
      for (let i = 1; i < this.shellPairs.length; i++) {
        const [src, dst] = this.shellPairs[i];
        dst.position.copy(src.position);
        dst.quaternion.copy(src.quaternion);
      }
      this.shell.position.copy(this.mesh.position);
      this.shell.rotation.y = this.mesh.rotation.y;
      if (this.shellKind === 'thermal' && this.shellMat) {
        this.shellMat.opacity = 0.7 + Math.sin(performance.now() / 260) * 0.15;
      } else if (this.shellMat) {
        this.shellMat.opacity = 0.45 + Math.sin(performance.now() / 190) * 0.18;
      }
      if (this.shellRing) {
        const p2 = performance.now() / 340;
        this.shellRing.position.set(this.mesh.position.x, this.mesh.position.y + 0.06, this.mesh.position.z);
        const sc = 1 + Math.sin(p2) * 0.12;
        this.shellRing.scale.set(sc, 1, sc);
        this.shellRing.material.opacity = 0.6 + Math.sin(p2) * 0.25;
      }
    }
  }

  /**
   * Everybody else walks the way you do — the same rig, the same IK feet,
   * driven off the smoothed speed of the interpolated body. The old copy
   * here had its own clock (a fixed rate that knew nothing about distance,
   * so feet slid), the knee and elbow signs the local walk had long since
   * fixed, and per-frame lerps that snapped between standing and walking.
   *
   * Standing at a chore (anim 1) gets hands up in front, busy with
   * something: that and standing over a body otherwise look identical, and
   * telling those two apart across the island is most of what Castaways is.
   */
  _animate(dt, anim) {
    this.walkPhase += gaitRate(this.speed) * dt;
    if (this.walkPhase > Math.PI * 1024) this.walkPhase -= Math.PI * 1024;
    const s = this._pose;
    s.phase = this.walkPhase;
    s.speed = this.speed;
    s.grounded = !this.air;
    s.vy = this.vy;
    s.task = anim === 1 ? 1 : 0;
    s.squash = 0;
    s.turn = this.turn;
    s.look = 0;
    this.rig.pose(this.parts, dt, s);
  }

  /* Unparenting the old shell left its material — and the ring's — alive on
     the GPU, and _markTarget re-marks whenever the nearest victim changes, so
     a round's worth of toggles piled up resources nothing would ever free.
     What must NOT be freed here is the shell's geometry, which clone() shares
     with the live body, and the ring's, which is the shared RING_GEO. */
  _tearDownShell() {
    if (this.shell) { this.shell.removeFromParent(); this.shell = null; }
    if (this.shellRing) {
      this.shellRing.removeFromParent();
      this.shellRing.material.dispose();
      this.shellRing = null;
    }
    if (this.shellMat) { this.shellMat.dispose(); this.shellMat = null; }
    this.shellPairs = null;
  }

  /**
   * A silhouette over the body.
   *
   * 'mark'    a cell-shaded outline, for a target you are close enough to
   *           take. It sits behind the body and is scaled up a touch, which
   *           is the cheapest outline there is and the only one that reads
   *           at this resolution.
   * 'thermal' a heat shape that ignores depth entirely, so an Agent can see
   *           people through the mist and through the hill they are behind.
   */
  setShell(kind) {
    if (this.shellKind === kind) return;
    this.shellKind = kind;
    this._tearDownShell();
    if (!kind) return;

    const hot = kind === 'thermal';
    /* A back-face shell scaled a few percent fights the depth buffer at
       every seam. Pushed out further and drawn without depth testing it is
       a clean silhouette instead of a shimmering crust. */
    const mat = new THREE.MeshBasicMaterial({
      color: hot ? 0xff5a2a : 0xffdc6a,
      side: THREE.BackSide,
      fog: false,
      transparent: true,
      opacity: hot ? 0.8 : 0.55,
      depthTest: false,
      depthWrite: false,
    });
    const shell = this.mesh.clone(true);
    shell.traverse((o) => { if (o.isMesh) { o.material = mat; o.renderOrder = hot ? 9 : 8; } });
    shell.scale.setScalar(hot ? 1.10 : 1.12);
    (this.mesh.parent || this.scene).add(shell);
    shell.visible = this.visible;
    this.shell = shell;
    this.shellMat = mat;

    if (!hot) {
      // a ring on the ground, which is what actually reads at this distance
      const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({
        color: 0xff6a5a, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      }));
      ring.renderOrder = 7;
      (this.mesh.parent || this.scene).add(ring);
      ring.visible = this.visible;
      this.shellRing = ring;
    }

    /* clone() shallow-copies userData, so the copy's `parts` still points at
       the original rig. Pair the hierarchies up by traversal order instead
       — they are identical by construction. */
    const a = [], b = [];
    this.mesh.traverse((o) => a.push(o));
    shell.traverse((o) => b.push(o));
    this.shellPairs = a.map((o, i) => [o, b[i]]).filter(([, d]) => d);
  }

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.mesh.visible = v;
    if (this.shell) this.shell.visible = v;
    if (this.shellRing) this.shellRing.visible = v;
  }

  /** Outlines and target rings occupy the same coordinate space as the body. */
  setScene(scene) {
    if (!scene) return;
    this.scene = scene;
    for (const node of [this.mesh, this.shell, this.shellRing]) {
      if (node && node.parent !== scene) scene.add(node);
    }
  }

  /**
   * The dead look dead: the same body, rendered through.
   *
   * The material is swapped rather than the opacity set, because every
   * castaway is built from the one shared `opaque` material the whole island
   * uses — turning its opacity down would take the palms and the temple with
   * it. The caller owns the ghost material and hands the same one to every
   * avatar, so all the dead match and there is one extra program in the
   * cache rather than one per player.
   *
   * @param {boolean} on
   * @param {THREE.Material} mat  shared ghost material, from the caller
   */
  setGhost(on, mat) {
    if (this.ghost === !!on) return;
    this.ghost = !!on;
    this.mesh.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (!o.userData.solidMat) o.userData.solidMat = o.material;
        o.material = mat;
      } else if (o.userData.solidMat) {
        o.material = o.userData.solidMat;
      }
    });
  }

  dispose() {
    this._tearDownShell();
    this.mesh.removeFromParent();
    /* buildCastaway merges a fresh set of geometries for every avatar, so they
       are ours to free when a player leaves the roster — the materials are the
       island's shared mats and must be left alone. */
    this.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}

/* ===========================================================
   BODIES — a dead castaway, left where they fell.
   =========================================================== */
export class Body {
  constructor(scene, mats, record, x, y, z) {
    this.id = record.id;
    this.name = record.name || '';
    /* Bones, in their own shirt. A body that is just the living model
       lying down reads as somebody having a nap, and from any distance at
       all you cannot tell it from a player sitting still. This cannot be
       anything else — and it still carries their colour on the rag, which
       is how you know who you have found. */
    this.mesh = buildSkeleton(mats, colourHex(record.colour || 'red'));
    this.parts = this.mesh.userData.parts;
    scene.add(this.mesh);

    // slumped: rolled onto one side, limbs loose
    this.mesh.position.set(x, y, z);
    this.restY = y;
    this.mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI * 0.46);
    const p = this.parts;
    p.hips.position.y = 0.55;
    p.legs.l.rotation.x = -0.5; p.legs.r.rotation.x = 0.3;
    p.arms.l.rotation.x = -1.5; p.arms.r.rotation.x = -0.4;
    p.arms.l.rotation.z = 0.7; p.arms.r.rotation.z = -0.9;
    // a body on the sand is not laid out straight
    if (p.knees) { p.knees.l.rotation.x = 0.9; p.knees.r.rotation.x = 0.25; }
    if (p.elbows) { p.elbows.l.rotation.x = 1.1; p.elbows.r.rotation.x = 0.4; }
    p.hips.rotation.z = 0; p.hips.rotation.y = 0;
    p.torso.rotation.x = 0; p.torso.rotation.z = 0;
    p.head.rotation.z = 0.4;
    // the shirt was tinted when the bones were built; nothing else to paint
  }
  dispose() {
    this.mesh.removeFromParent();
    // the bones are merged per body, so they go with it; the mats are shared
    this.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}
