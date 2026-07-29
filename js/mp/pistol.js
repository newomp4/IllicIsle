/* ===========================================================
   pistol.js — the flare pistol, and what being shot with one
   does to you.

   It does not kill. It knocks you flat, fills your head with
   stars, and calls everybody close enough to have seen it into a
   snap vote on the spot. That makes it the one item that can end
   somebody without an Agent — and the one that can go badly
   wrong, because the people who come running are whoever
   happened to be nearby, not the whole island.
   =========================================================== */

import * as THREE from 'three';

/* ---------- the weapon in your hands ---------- */
export function buildPistol() {
  const g = new THREE.Group();
  const part = (w, h, d, col, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: col })
    );
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  // a stubby brass-and-timber signal pistol
  part(0.10, 0.09, 0.34, 0x8a4a2a, 0, 0, -0.10);      // body
  part(0.085, 0.075, 0.20, 0xb0b6bc, 0, 0.005, -0.32); // barrel
  part(0.10, 0.10, 0.04, 0xe0e6ea, 0, 0.005, -0.43);   // muzzle ring
  part(0.075, 0.16, 0.10, 0x6a3a20, 0, -0.12, 0.02);   // grip
  part(0.05, 0.05, 0.05, 0xc8c8d0, 0, -0.05, -0.06);   // trigger guard
  part(0.02, 0.03, 0.02, 0xffd24a, 0, 0.055, -0.40);   // fore sight

  // the flare sitting in the breech, visible until it is spent
  const flare = part(0.05, 0.05, 0.05, 0xff7a3a, 0, 0.005, -0.22);
  g.userData.flare = flare;

  const glow = new THREE.PointLight(0xffb060, 0, 4, 2);
  glow.position.set(0, 0.02, -0.42);
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

/* ---------- the flare, once it is in the air ---------- */
export class Flare {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
  }

  fire(from, dir, onArrive) {
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd0a0, fog: false })
    );
    head.position.copy(from);
    this.scene.add(head);
    const trail = [];
    for (let i = 0; i < 9; i++) {
      const t = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.1),
        new THREE.MeshBasicMaterial({
          color: 0xff8a3a, transparent: true, opacity: 0.7 - i * 0.07, fog: false,
        })
      );
      t.position.copy(from);
      this.scene.add(t);
      trail.push(t);
    }
    this.live.push({
      head, trail, onArrive,
      pos: from.clone(), vel: dir.clone().multiplyScalar(46), t: 0,
    });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.t += dt;
      // the trail follows one step behind the one in front of it
      for (let j = f.trail.length - 1; j > 0; j--) f.trail[j].position.copy(f.trail[j - 1].position);
      if (f.trail[0]) f.trail[0].position.copy(f.pos);
      f.pos.addScaledVector(f.vel, dt);
      f.vel.y -= 5 * dt;
      f.head.position.copy(f.pos);
      if (f.t > 1.1) {
        f.onArrive?.(f.pos);
        f.head.removeFromParent();
        for (const t of f.trail) t.removeFromParent();
        this.live.splice(i, 1);
      }
    }
  }
}

/* ---------- stars, for the person on the floor ---------- */
export class Dizzy {
  constructor(scene) {
    this.scene = scene;
    this.rigs = new Map();          // playerId -> { group, bits }
  }

  add(id, colour = 0xffd24a) {
    if (this.rigs.has(id)) return;
    const group = new THREE.Group();
    const bits = [];
    for (let i = 0; i < 6; i++) {
      const star = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: i % 2 ? colour : 0xffffff, fog: false });
      // a four-point star out of two crossed bars, which is all it needs
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), m);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), m);
      star.add(a); star.add(b);
      group.add(star);
      bits.push({ star, phase: (i / 6) * Math.PI * 2, tilt: (i % 3) * 0.35 });
    }
    this.scene.add(group);
    this.rigs.set(id, { group, bits });
  }

  remove(id) {
    const r = this.rigs.get(id);
    if (!r) return;
    r.group.removeFromParent();
    this.rigs.delete(id);
  }

  update(dt, t, posOf) {
    for (const [id, r] of this.rigs) {
      const p = posOf(id);
      if (!p) { r.group.visible = false; continue; }
      r.group.visible = true;
      r.group.position.set(p.x, p.y + 2.05, p.z);
      for (const b of r.bits) {
        const a = t * 3.1 + b.phase;
        b.star.position.set(Math.cos(a) * 0.52, Math.sin(a * 2 + b.tilt) * 0.12, Math.sin(a) * 0.52);
        b.star.rotation.z = a * 2.2;
        b.star.rotation.x = b.tilt;
      }
    }
  }

  clear() {
    for (const [, r] of this.rigs) r.group.removeFromParent();
    this.rigs.clear();
  }
}
