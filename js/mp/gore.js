/* ===========================================================
   gore.js — what a kill leaves behind.

   A body that simply appears is information; a body lying in a
   spray of blood is a scene. The spatter is a flat decal draped
   over the terrain so it follows a slope, plus a handful of
   thrown droplets that land and stay.

   It fades out over a couple of minutes, because a round that
   ends with the whole beach painted red stops meaning anything.
   =========================================================== */

import * as THREE from 'three';

const LIFE = 150;          // seconds a stain lasts
const FADE = 20;           // seconds it takes to go

/** A ragged blob, drawn once into a canvas and reused for every stain. */
function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);

  // a core blot with arms thrown out from it
  const blob = (cx, cy, r) => {
    x.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = r * (0.62 + ((Math.sin(i * 2.7) + Math.sin(i * 1.3)) * 0.5 + 1) * 0.28);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath();
    x.fill();
  };

  x.fillStyle = '#ffffff';
  blob(32, 32, 15);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const d = 15 + (i % 3) * 6;
    blob(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 3 + (i % 4));
  }
  // hard edges only: no soft gradient, or it stops matching the world
  const img = x.getImageData(0, 0, 64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i + 3] = img.data[i + 3] > 128 ? 255 : 0;
  }
  x.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class Gore {
  constructor(scene, groundAt) {
    this.scene = scene;
    this.groundAt = groundAt;
    this.tex = splatTexture();
    this.live = [];
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} tintHex  the victim's colour, mixed into the stain so
   *   you can sometimes tell who it was before you get close enough to see.
   */
  splat(x, y, z, tintHex = 0xffffff) {
    const size = 3.6;
    const g = new THREE.PlaneGeometry(size, size, 6, 6);
    g.rotateX(-Math.PI / 2);
    // drape it over whatever the ground is doing
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, this.groundAt(x + p.getX(i), z + p.getZ(i)) - y + 0.07);
    }
    p.needsUpdate = true;

    const blood = new THREE.Color(0x8c0f08).lerp(new THREE.Color(tintHex), 0.18);
    const m = new THREE.MeshBasicMaterial({
      map: this.tex, color: blood, transparent: true, opacity: 0.92,
      depthWrite: false, alphaTest: 0.4, fog: true,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.live.push({ mesh, mat: m, t: 0 });

    // and a few droplets thrown clear of the main stain
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1.6 + Math.random() * 2.4;
      const dx = x + Math.cos(a) * d, dz = z + Math.sin(a) * d;
      const dg = new THREE.PlaneGeometry(0.7 + Math.random() * 0.6, 0.7 + Math.random() * 0.6);
      dg.rotateX(-Math.PI / 2);
      const dm = new THREE.Mesh(dg, m);
      dm.position.set(dx, this.groundAt(dx, dz) + 0.06, dz);
      dm.rotation.y = Math.random() * Math.PI * 2;
      dm.renderOrder = 2;
      this.scene.add(dm);
      this.live.push({ mesh: dm, mat: m, t: 0, drop: true });
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.t += dt;
      if (s.t > LIFE - FADE) {
        s.mat.opacity = Math.max(0, 0.92 * (1 - (s.t - (LIFE - FADE)) / FADE));
      }
      if (s.t >= LIFE) {
        s.mesh.removeFromParent();
        s.mesh.geometry.dispose();
        if (!s.drop) s.mat.dispose();
        this.live.splice(i, 1);
      }
    }
  }

  /** A council clears the bodies; it clears the mess with them. */
  clear() {
    for (const s of this.live) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
    }
    this.live.length = 0;
  }
}
