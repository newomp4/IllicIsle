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
import { buildCastaway } from '../entities/player.js';
import { COLOURS } from '../net/protocol.js';

const INTERP_DELAY = 0.14;      // seconds behind the newest snapshot
const BUFFER = 16;
const COAST = 0.22;             // how long we will guess for before giving up

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
    this.visible = true;
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
  push(t, x, y, z, yaw, anim) {
    this.buf.push({ t, x, y, z, yaw, anim });
    while (this.buf.length > BUFFER) this.buf.shift();
  }

  update(dt, nowT) {
    const target = nowT - INTERP_DELAY;
    const b = this.buf;

    if (b.length === 0) return;
    if (b.length === 1) {
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
        Avatar.coasted = (Avatar.coasted || 0) + 1;
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
        let d2 = newest.yaw - prev.yaw;
        while (d2 > Math.PI) d2 -= Math.PI * 2;
        while (d2 < -Math.PI) d2 += Math.PI * 2;
        this.yaw = newest.yaw + d2 * Math.min(1, k2);
        this.speed = Math.hypot(this.pos.x - px2, this.pos.z - pz2) / Math.max(1e-3, dt);
        this.mesh.position.copy(this.pos);
        this.mesh.rotation.y = this.yaw;
        this._animate(dt);
        this._shellFollow();
        return;
      }
      Avatar.interp = (Avatar.interp || 0) + 1;
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
      // shortest-way yaw
      let d = c.yaw - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw = a.yaw + d * k;
      this.speed = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(1e-3, dt);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this._animate(dt);

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

  _animate(dt) {
    const p = this.parts;
    const running = THREE.MathUtils.clamp(this.speed / 7, 0, 1.5);
    this.walkPhase += dt * (4.4 + running * 5) * (this.speed > 0.4 ? 1 : 0);
    const sw = Math.sin(this.walkPhase) * (0.4 + running * 0.45);
    p.legs.l.rotation.x = sw;
    p.legs.r.rotation.x = -sw;
    p.arms.l.rotation.x = -sw * 0.85;
    p.arms.r.rotation.x = sw * 0.85;
    p.arms.l.rotation.z = 0.16;
    p.arms.r.rotation.z = -0.16;
    const bob = this.speed > 0.4 ? Math.abs(Math.sin(this.walkPhase)) * 0.045 * running : 0;
    p.hips.position.y = 0.90 + bob;
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
    if (this.shell) { this.shell.removeFromParent(); this.shell = null; }
    if (this.shellRing) { this.shellRing.removeFromParent(); this.shellRing = null; }
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
    this.scene.add(shell);
    this.shell = shell;
    this.shellMat = mat;

    if (!hot) {
      // a ring on the ground, which is what actually reads at this distance
      const rg = new THREE.RingGeometry(0.62, 0.86, 16, 1);
      rg.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        color: 0xff6a5a, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false, fog: false,
      }));
      ring.renderOrder = 7;
      this.scene.add(ring);
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

  dispose() {
    this.mesh.removeFromParent();
    this.shell?.removeFromParent();
    this.shellRing?.removeFromParent();
  }
}

/* ===========================================================
   BODIES — a dead castaway, left where they fell.
   =========================================================== */
export class Body {
  constructor(scene, mats, record, x, y, z) {
    this.id = record.id;
    this.name = record.name || '';
    this.mesh = buildCastaway(mats);
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
    p.head.rotation.z = 0.4;

    dyeCastaway(this.parts, record.colour || 'red');
  }
  dispose() { this.mesh.removeFromParent(); }
}
