/* ===========================================================
   taskfx.js — proof that the thing you just did happened.

   A chore that ends with a line of text and nothing else feels
   like filling in a form. What sells it is the world reacting:
   a ring of light thrown out across the sand, sparks going up,
   the frame flashing once.

   Everything here is POOLED. It used to allocate a ring
   geometry, two materials and an InstancedMesh per burst, and
   bursts fire on every chore step, every coin and every lightning
   strike in a storm — which is a steady drip of garbage and, the
   first time each new material is drawn, a shader compile. Both
   show up as the game stopping dead for a moment.
   =========================================================== */

import * as THREE from 'three';

const RING_SEGS = 18;
const SPARKS = 14;
const POOL = 12;
const UP = new THREE.Vector3(0, 1, 0);

export class TaskFx {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.free = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    // one ring and one spark cloud, built once and handed round
    this.ringGeo = new THREE.RingGeometry(0.5, 0.72, RING_SEGS, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.sparkGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);

    for (let i = 0; i < POOL; i++) this.free.push(this._make());
  }

  _make() {
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.renderOrder = 6;
    ring.visible = false;
    this.scene.add(ring);

    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, fog: false, transparent: true, opacity: 0,
    });
    const sparks = new THREE.InstancedMesh(this.sparkGeo, sparkMat, SPARKS);
    sparks.frustumCulled = false;
    sparks.renderOrder = 6;
    sparks.visible = false;
    this.scene.add(sparks);

    return { ring, ringMat, sparks, sparkMat, bits: [] };
  }

  /**
   * @param {'done'|'fail'} kind
   * @param {number} ringSize how far the ring throws itself
   */
  burst(x, y, z, colour = 0x7ec850, kind = 'done', ringSize = 5.4) {
    /* If every slot is busy, retire the oldest rather than allocating —
       a burst you cannot see is not worth a stutter. */
    const f = this.free.pop() || this._retire();
    if (!f) return;

    f.ringMat.color.setHex(colour);
    f.sparkMat.color.setHex(colour);
    f.ring.position.set(x, y + 0.08, z);
    f.ring.visible = true;
    f.sparks.position.set(x, y, z);
    f.sparks.visible = true;

    const N = kind === 'done' ? SPARKS : 8;
    f.bits.length = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 1.6 + Math.random() * 2.6;
      f.bits.push({
        px: Math.cos(a) * 0.3, py: 0.35 + Math.random() * 0.5, pz: Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp, vy: 3.4 + Math.random() * 2.8, vz: Math.sin(a) * sp,
        spin: (Math.random() - 0.5) * 9,
      });
    }
    // park the unused instances out of sight
    for (let i = N; i < SPARKS; i++) {
      this._m.makeScale(0, 0, 0);
      f.sparks.setMatrixAt(i, this._m);
    }
    f.t = 0;
    f.dur = kind === 'done' ? 1.15 : 0.7;
    f.kind = kind;
    f.reach = ringSize;
    this.live.push(f);
  }

  _retire() {
    const f = this.live.shift();
    if (f) { f.ring.visible = false; f.sparks.visible = false; }
    return f;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);

      // the ring snaps out fast then eases, which reads as impact
      const ease = 1 - Math.pow(1 - k, 3);
      const r = 0.6 + ease * (f.kind === 'done' ? f.reach : 2.2);
      f.ring.scale.set(r, 1, r);
      f.ringMat.opacity = (1 - k) * 0.9;

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
      f.sparkMat.opacity = 1 - k * k;

      if (k >= 1) {
        f.ring.visible = false;
        f.sparks.visible = false;
        this.live.splice(i, 1);
        this.free.push(f);
      }
    }
  }

  clear() {
    while (this.live.length) {
      const f = this.live.pop();
      f.ring.visible = false; f.sparks.visible = false;
      this.free.push(f);
    }
  }
}
