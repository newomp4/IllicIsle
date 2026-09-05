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
import { buildCastaway, buildSkeleton } from '../entities/player.js';
import { COLOURS } from '../net/protocol.js';

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
const COAST = 0.26;             // how long we will guess for before giving up

/* Arrival statistics, shared by every avatar — snapshots come in one packet,
   so the timing is a property of the connection, not of any one player. */
const net = { last: 0, mean: 0.055, jitter: 0.012, delay: 0.14 };

/** A new room connection must not inherit the previous connection's jitter. */
export function resetSnapshotTiming() {
  Object.assign(net, { last: 0, mean: 0.055, jitter: 0.012, delay: 0.14 });
}

/** Called once per snapshot, from whoever received it. */
export function noteSnapshot(t) {
  if (!Number.isFinite(t)) return;
  if (net.last) {
    const gap = Math.min(0.6, Math.max(0.005, t - net.last));
    // exponential means: cheap, and they forget a bad patch soon enough
    net.mean += (gap - net.mean) * 0.12;
    net.jitter += (Math.abs(gap - net.mean) - net.jitter) * 0.12;
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
    const last = this.buf[this.buf.length - 1];
    if (last && t < last.t) return;
    // Interior coordinates are unrelated to the island. Interpolating a
    // ladder or council teleport sends a player flying through the walls.
    const jumped = last && (room !== this.room || Math.hypot(x - last.x, y - last.y, z - last.z) > 12);
    if (jumped) this.buf.length = 0;
    if (!this.buf.length) {
      this.pos.set(x, y, z);
      this.yaw = yaw;
      this.speed = 0;
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
         has run dry — a dropped or late snapshot. Carry on at the last
         known speed for a fifth of a second rather than stopping dead,
         because a body that freezes and teleports is far more obvious than
         one that drifts a few centimetres wrong. */
      if (target > newest.t) {
        const prev = b[b.length - 2];
        const span = Math.max(1e-4, newest.t - prev.t);
        const over = Math.min(COAST, target - newest.t);
        const k2 = over / span;
        const px2 = this.pos.x, pz2 = this.pos.z;
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
        this.speed = Math.hypot(this.pos.x - px2, this.pos.z - pz2) / Math.max(1e-3, dt);
        this.mesh.position.copy(this.pos);
        this.mesh.rotation.y = this.yaw;
        this._animate(dt, newest.anim);
        this._shellFollow();
        return;
      }
      // find the pair straddling `target`
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > target) i--;
      const a = b[Math.max(0, i - 1)], c = b[i];
      const span = Math.max(1e-4, c.t - a.t);
      const k = THREE.MathUtils.clamp((target - a.t) / span, 0, 1);
      const px = this.pos.x, pz = this.pos.z;
      this.pos.set(
        THREE.MathUtils.lerp(a.x, c.x, k),
        THREE.MathUtils.lerp(a.y, c.y, k),
        THREE.MathUtils.lerp(a.z, c.z, k)
      );
      // shortest-way yaw, wrapped the way the coast branch above explains
      const d = Math.atan2(Math.sin(c.yaw - a.yaw), Math.cos(c.yaw - a.yaw));
      const y = a.yaw + d * k;
      if (Number.isFinite(y)) this.yaw = y;
      this.speed = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(1e-3, dt);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this._animate(dt, b[b.length - 1].anim);

    this._shellFollow();
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
        this.shellRing.position.set(this.pos.x, this.pos.y + 0.06, this.pos.z);
        const sc = 1 + Math.sin(p2) * 0.12;
        this.shellRing.scale.set(sc, 1, sc);
        this.shellRing.material.opacity = 0.6 + Math.sin(p2) * 0.25;
      }
    }
  }

  /**
   * Everybody else walks the way you do.
   *
   * The body is built by the same buildPlayer, so it has the same knees and
   * elbows — it would be strange to be the only person on the island who
   * bends their legs. This is the same cycle as Player._walkWeighted,
   * driven off the interpolated speed off the wire instead of your own.
   */
  _animate(dt, anim) {
    const p = this.parts;
    const running = THREE.MathUtils.clamp(this.speed / 7, 0, 1.5);
    const moving = this.speed > 0.4;
    this.walkPhase += dt * (4.4 + running * 5) * (moving ? 1 : 0);
    const ph = this.walkPhase;

    if (!moving) {
      const L = (a, b, k = 0.12) => THREE.MathUtils.lerp(a, b, k);

      /* Somebody standing at a task and somebody standing over a body look
         identical otherwise, and telling those two apart across the island is
         most of what Castaways is. The snapshot already carries the flag, so
         spend it: hands up in front, busy with something. Negative rotation.x
         is IN FRONT of the body — see the note in Player._walkWeighted. */
      if (anim === 1) {
        const w = Math.sin(performance.now() * 0.008) * 0.18;
        p.legs.l.rotation.x = L(p.legs.l.rotation.x, 0.05);
        p.legs.r.rotation.x = L(p.legs.r.rotation.x, -0.05);
        if (p.knees) {
          p.knees.l.rotation.x = L(p.knees.l.rotation.x, 0.14);
          p.knees.r.rotation.x = L(p.knees.r.rotation.x, 0.14);
        }
        p.arms.l.rotation.x = L(p.arms.l.rotation.x, -1.02 + w);
        p.arms.r.rotation.x = L(p.arms.r.rotation.x, -1.02 - w);
        p.arms.l.rotation.z = L(p.arms.l.rotation.z, 0.22);
        p.arms.r.rotation.z = L(p.arms.r.rotation.z, -0.22);
        if (p.elbows) {
          p.elbows.l.rotation.x = L(p.elbows.l.rotation.x, 0.75 - w);
          p.elbows.r.rotation.x = L(p.elbows.r.rotation.x, 0.75 + w);
        }
        p.hips.rotation.z = L(p.hips.rotation.z, 0);
        p.hips.rotation.y = L(p.hips.rotation.y, 0);
        p.torso.rotation.x = L(p.torso.rotation.x, 0.22);
        p.torso.rotation.z = L(p.torso.rotation.z, 0);
        p.torso.rotation.y = L(p.torso.rotation.y, 0);
        p.hips.position.y = L(p.hips.position.y, 0.88);
        return;
      }

      const b2 = Math.sin(ph * 0.0 + performance.now() * 0.0017) * 0.02;
      p.legs.l.rotation.x = L(p.legs.l.rotation.x, 0.02);
      p.legs.r.rotation.x = L(p.legs.r.rotation.x, -0.02);
      if (p.knees) {
        p.knees.l.rotation.x = L(p.knees.l.rotation.x, 0.07);
        p.knees.r.rotation.x = L(p.knees.r.rotation.x, 0.05);
      }
      p.arms.l.rotation.x = L(p.arms.l.rotation.x, 0.06 + b2);
      p.arms.r.rotation.x = L(p.arms.r.rotation.x, 0.06 - b2);
      p.arms.l.rotation.z = L(p.arms.l.rotation.z, 0.13);
      p.arms.r.rotation.z = L(p.arms.r.rotation.z, -0.13);
      if (p.elbows) {
        p.elbows.l.rotation.x = L(p.elbows.l.rotation.x, 0.16);
        p.elbows.r.rotation.x = L(p.elbows.r.rotation.x, 0.14);
      }
      p.hips.rotation.z = L(p.hips.rotation.z, 0);
      p.hips.rotation.y = L(p.hips.rotation.y, 0);
      p.torso.rotation.x = L(p.torso.rotation.x, 0.02);
      p.torso.rotation.z = L(p.torso.rotation.z, 0);
      p.torso.rotation.y = L(p.torso.rotation.y, 0);
      p.hips.position.y = L(p.hips.position.y, 0.90 + b2);
      return;
    }

    const amp = 0.52 + running * 0.46;
    const skew = (a) => Math.sin(a + Math.sin(a) * 0.28);
    const sl = skew(ph), sr = skew(ph + Math.PI);
    p.legs.l.rotation.x = sl * amp;
    p.legs.r.rotation.x = sr * amp;
    if (p.knees) {
      const bendL = Math.max(0, -Math.cos(ph * 2 + 0.6));
      const kAmp = 0.55 + running * 0.75;
      p.knees.l.rotation.x = (bendL * 0.55 + Math.max(0, -sl) * 0.75) * kAmp;
      p.knees.r.rotation.x = (bendL * 0.55 + Math.max(0, -sr) * 0.75) * kAmp;
    }
    const lag = 0.32;
    const aL = skew(ph + Math.PI - lag), aR = skew(ph - lag);
    const aAmp = 0.42 + running * 0.62;
    p.arms.l.rotation.x = aL * aAmp;
    p.arms.r.rotation.x = aR * aAmp;
    p.arms.l.rotation.z = 0.14 + running * 0.06;
    p.arms.r.rotation.z = -0.14 - running * 0.06;
    if (p.elbows) {
      const eAmp = 0.30 + running * 0.55;
      p.elbows.l.rotation.x = (0.18 + Math.max(0, aL) * 0.9) * eAmp;
      p.elbows.r.rotation.x = (0.18 + Math.max(0, aR) * 0.9) * eAmp;
    }
    // the same numbers as Player._walkWeighted; see the note there about
    // why they are a third of what they started at
    p.hips.rotation.z = -Math.sin(ph) * (0.014 + running * 0.016);
    const twist = Math.sin(ph) * (0.022 + running * 0.030);
    p.hips.rotation.y = twist;
    p.torso.rotation.y = -twist * 1.6;
    p.torso.rotation.z = Math.sin(ph) * (0.010 + running * 0.012);
    p.torso.rotation.x = 0.02 + running * 0.085;
    p.hips.position.y = 0.90 + Math.cos(ph * 2) * (0.013 + running * 0.020) - 0.010 * running;
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
