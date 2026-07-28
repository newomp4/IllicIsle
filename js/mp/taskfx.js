/* ===========================================================
   taskfx.js — proof that the thing you just did happened.

   A chore that ends with a line of text and nothing else feels
   like filling in a form. What sells it is the world reacting:
   a ring of light thrown out across the sand, sparks going up,
   the frame flashing once. All of it is flat, hard-edged and
   untextured, because that is what the rest of the island is.
   =========================================================== */

import * as THREE from 'three';

const RING_SEGS = 18;

/** A flat ring on the ground that snaps outward and fades. */
function makeRing(colour) {
  const g = new THREE.RingGeometry(0.5, 0.72, RING_SEGS, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0.9,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 6;
  return mesh;
}

/** Chunky sparks — boxes, not points, so they survive the low resolution. */
function makeSparks(colour, n) {
  const g = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const m = new THREE.MeshBasicMaterial({ color: colour, fog: false, transparent: true });
  const inst = new THREE.InstancedMesh(g, m, n);
  inst.frustumCulled = false;
  inst.renderOrder = 6;
  return inst;
}

export class TaskFx {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} colour  hex
   * @param {'done'|'fail'} kind
   */
  burst(x, y, z, colour = 0x7ec850, kind = 'done') {
    const N = kind === 'done' ? 14 : 8;
    const ring = makeRing(colour);
    ring.position.set(x, y + 0.08, z);
    this.scene.add(ring);

    const sparks = makeSparks(colour, N);
    sparks.position.set(x, y, z);
    this.scene.add(sparks);

    const bits = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 1.6 + Math.random() * 2.6;
      bits.push({
        px: Math.cos(a) * 0.3, py: 0.35 + Math.random() * 0.5, pz: Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp, vy: 3.4 + Math.random() * 2.8, vz: Math.sin(a) * sp,
        spin: (Math.random() - 0.5) * 9,
      });
    }
    this.live.push({ ring, sparks, bits, t: 0, dur: kind === 'done' ? 1.15 : 0.7, kind });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);

      // the ring snaps out fast then eases, which reads as impact
      const ease = 1 - Math.pow(1 - k, 3);
      const r = 0.6 + ease * (f.kind === 'done' ? 5.4 : 2.2);
      f.ring.scale.set(r, 1, r);
      f.ring.material.opacity = (1 - k) * 0.9;

      for (let j = 0; j < f.bits.length; j++) {
        const b = f.bits[j];
        b.vy -= 13 * dt;
        b.px += b.vx * dt; b.py += b.vy * dt; b.pz += b.vz * dt;
        b.vx *= 0.96; b.vz *= 0.96;
        this._v.set(b.px, Math.max(0.05, b.py), b.pz);
        this._q.setFromAxisAngle(UP, f.t * b.spin);
        const sc = Math.max(0.001, 1 - k);
        this._s.set(sc, sc, sc);
        this._m.compose(this._v, this._q, this._s);
        f.sparks.setMatrixAt(j, this._m);
      }
      f.sparks.instanceMatrix.needsUpdate = true;
      f.sparks.material.opacity = 1 - k * k;

      if (k >= 1) {
        f.ring.removeFromParent();
        f.ring.geometry.dispose(); f.ring.material.dispose();
        f.sparks.removeFromParent();
        f.sparks.geometry.dispose(); f.sparks.material.dispose();
        this.live.splice(i, 1);
      }
    }
  }

  clear() {
    for (const f of this.live) {
      f.ring.removeFromParent(); f.sparks.removeFromParent();
    }
    this.live.length = 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
