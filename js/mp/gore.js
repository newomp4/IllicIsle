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
    /* One material, cloned once per stain only because each fades on its
       own clock. Geometry is rebuilt in place rather than reallocated —
       a kill used to make six geometries and a material, and the first
       draw of a new material is a shader compile you feel. */
    this.base = new THREE.MeshBasicMaterial({
      map: this.tex, color: 0x8c0f08, transparent: true, opacity: 0.92,
      depthWrite: false, alphaTest: 0.4, fog: true,
    });
    this.pool = [];
    this.spatterPool = [];
  }

  _take(segs) {
    const s = this.pool.pop();
    if (s) return s;
    const g = new THREE.PlaneGeometry(1, 1, segs, segs);
    g.rotateX(-Math.PI / 2);
    const m = this.base.clone();
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, mat: m };
  }

  /**
   * One mesh holding every small droplet of a single kill.
   *
   * Twenty-odd separate planes is twenty-odd draw calls per body, and
   * three bodies on the beach would cost more than the whole island does.
   * They all share one texture and one material, so they go in one
   * geometry: each droplet is its own little draped grid with its own
   * copy of the texture's corners.
   */
  _takeSpatter(n) {
    const need = n * 4 * 6;                 // four quads a droplet, six verts each
    let s = this.spatterPool.pop();
    if (!s) {
      const g = new THREE.BufferGeometry();
      const m = this.base.clone();
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 2;
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      s = { mesh, mat: m, cap: 0 };
    }
    if (s.cap < need) {
      s.mesh.geometry.setAttribute('position',
        new THREE.BufferAttribute(new Float32Array(need * 3), 3));
      s.mesh.geometry.setAttribute('uv',
        new THREE.BufferAttribute(new Float32Array(need * 2), 2));
      s.cap = need;
    }
    return s;
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} tintHex  the victim's colour, mixed into the stain so
   *   you can sometimes tell who it was before you get close enough to see.
   */
  splat(x, y, z, tintHex = 0xffffff) {
    /* Blood first, whose blood second.

       This mixes the two colours as PAINT — a straight blend of the
       eight-bit values — and not with Color.lerp, which works in linear
       space. Linear is the right space for light and the wrong one for
       this: dark red has almost no blue in it at all, so lerping a mere
       seven per cent of a blue shirt into it multiplied that channel by
       eighteen and the stain came out rose pink. Every kill on the island
       was painting the sand a different pastel. */
    const mix = (a, c, k) => {
      const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
      const cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
      return (Math.round(ar + (cr - ar) * k) << 16)
        | (Math.round(ag + (cg - ag) * k) << 8)
        | Math.round(ab + (cb - ab) * k);
    };
    const blood = new THREE.Color(mix(0x7e0d07, tintHex >>> 0, 0.14));
    /* The spray goes one way, because a body does. Everything thrown is
       weighted along this heading so the scene reads as a direction of
       travel rather than a tidy circle. */
    const away = Math.random() * Math.PI * 2;

    const put = (px, pz, size, drop) => {
      const s = this._take(6);
      const g = s.mesh.geometry;
      const p = g.attributes.position;
      // rewrite the plane in place: sized, and draped over the ground
      const half = size / 2;
      const segs = Math.round(Math.sqrt(p.count)) - 1;
      let i = 0;
      for (let r = 0; r <= segs; r++) {
        for (let c = 0; c <= segs; c++, i++) {
          const lx = -half + (c / segs) * size;
          const lz = -half + (r / segs) * size;
          p.setXYZ(i, lx, this.groundAt(px + lx, pz + lz) - y + 0.07, lz);
        }
      }
      p.needsUpdate = true;
      g.computeBoundingSphere();
      s.mat.color.copy(blood);
      s.mat.opacity = 0.92;
      s.mesh.position.set(px, y, pz);
      s.mesh.rotation.y = Math.random() * Math.PI * 2;
      s.mesh.visible = true;
      this.live.push({ ...s, t: 0, drop });
    };

    /* A pool, a spray, and a scatter.

       It used to be one stain and four droplets, which from ten metres
       away in long grass is nothing at all — and the whole job of blood
       in this game is that somebody walking past should notice before
       they trip over the body. This is five times as much of it, thrown
       mostly one way, spread far enough that the edge of it reaches you
       before the body does — and it costs three draw calls rather than
       twenty-eight, because everything small goes in one mesh. */

    // the two pools under them, big enough to drape properly over a slope
    put(x, z, 3.8, false);
    put(x + Math.cos(away) * 1.3, z + Math.sin(away) * 1.3, 2.5, false);

    // and everything thrown: the arterial fan, the scatter, and two smears
    const drops = [];
    for (let i = 0; i < 8; i++) {
      const a = away + (Math.random() - 0.5) * 0.9;
      const d = 2.0 + Math.random() * 5.5;
      drops.push([x + Math.cos(a) * d, z + Math.sin(a) * d, 0.7 + Math.random() * 1.5]);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 1.2 + Math.random() * 4.6;
      drops.push([x + Math.cos(a) * d, z + Math.sin(a) * d, 0.5 + Math.random() * 1.1]);
    }
    for (let i = 0; i < 2; i++) {
      const a = away + Math.PI + (Math.random() - 0.5) * 1.4;
      for (let k = 1; k <= 4; k++) {
        const d = k * 0.8;
        drops.push([x + Math.cos(a) * d, z + Math.sin(a) * d, 1.5 - k * 0.22]);
      }
    }
    this._spatter(drops, y, blood);
  }

  /** Every droplet of one kill, written into a single geometry. */
  _spatter(drops, y, blood) {
    const s = this._takeSpatter(drops.length);
    const g = s.mesh.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv;
    const P = pos.array, U = uv.array;
    let v = 0;
    /* Two by two: a droplet is under a metre across and does not need a
       six-segment grid to sit on a slope. */
    for (const [dx, dz, size] of drops) {
      const half = size / 2;
      const rot = Math.random() * Math.PI * 2;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          const corner = (ci, ri) => {
            const u = (c + ci) / 2, w = (r + ri) / 2;
            const lx = -half + u * size, lz = -half + w * size;
            const wx = dx + lx * cs - lz * sn, wz = dz + lx * sn + lz * cs;
            P[v * 3] = wx;
            P[v * 3 + 1] = this.groundAt(wx, wz) + 0.075;
            P[v * 3 + 2] = wz;
            U[v * 2] = u; U[v * 2 + 1] = w;
            v++;
          };
          corner(0, 0); corner(1, 0); corner(1, 1);
          corner(0, 0); corner(1, 1); corner(0, 1);
        }
      }
    }
    pos.needsUpdate = true; uv.needsUpdate = true;
    g.setDrawRange(0, v);
    g.computeBoundingSphere();
    s.mat.color.copy(blood);
    s.mat.opacity = 0.92;
    s.mesh.position.set(0, 0, 0);
    s.mesh.visible = true;
    this.live.push({ mesh: s.mesh, mat: s.mat, cap: s.cap, spatter: true, t: 0, drop: true });
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.t += dt;
      if (s.t > LIFE - FADE) {
        s.mat.opacity = Math.max(0, 0.92 * (1 - (s.t - (LIFE - FADE)) / FADE));
      }
      if (s.t >= LIFE) {
        s.mesh.visible = false;
        (s.spatter ? this.spatterPool : this.pool)
          .push({ mesh: s.mesh, mat: s.mat, cap: s.cap });
        this.live.splice(i, 1);
      }
    }
  }

  /** A council clears the bodies; it clears the mess with them. */
  clear() {
    for (const s of this.live) {
      s.mesh.visible = false;
      (s.spatter ? this.spatterPool : this.pool)
        .push({ mesh: s.mesh, mat: s.mat, cap: s.cap });
    }
    this.live.length = 0;
  }
}
