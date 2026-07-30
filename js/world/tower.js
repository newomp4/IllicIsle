/* ===========================================================
   tower.js — the radio mast on the back shoulder, and the
   cameras that answer to it.

   Somebody put a lattice mast up here a long time ago and
   never came back for it. It is forty metres of angle iron
   with a ladder up one leg, a red lamp on the top that has
   not stopped blinking, and a hut at the head of the ladder
   with a working terminal in it.

   The terminal talks to a set of small cameras. You carry
   them up, you carry them out, and where they go is up to
   you — which is the whole point: a camera is only worth
   anything if the people it is watching do not know it is
   there.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, sphere, tint, blankUV } from '../lib/geo.js';
import { drawText, textWidth } from '../lib/bitfont.js';

const G = (n) => new THREE.Color(n);

/* Where the mast stands. The back shoulder of the island, high enough to
   be seen from most of it and far enough from everything else that
   walking to it is a decision. */
export const TOWER_SPOT = { x: -96, z: -78 };
export const TOWER_H = 38;            // to the lamp
export const CAB_Y = 15.5;            // the hut, up the ladder

/** How many cameras there are, and where they start: in the hut. */
export const CAMERA_COUNT = 4;

/* The room at the head of the ladder. Small, and it is meant to be. */
export const CAB_BOX = { minX: -2.2, maxX: 2.2, minZ: -2.2, maxZ: 2.2, maxY: 2.6 };
export const CAB_ENTRY = { x: 0, y: 0.1, z: 1.5 };
export function cabHeight() { return 0; }

/* ===========================================================
   ONE CAMERA

   Deliberately small and deliberately dull: a body the size of a fist,
   a lens, a bracket, and one red pinhole that blinks. From ten metres
   in a bush it is a red pixel that comes and goes.
   =========================================================== */
export function buildCamera(mats) {
  const g = new THREE.Group();
  const P = [];
  const SHELL = G(0x3a4038), SHELL_D = G(0x22261f), LENS = G(0x0e1214);

  // the bracket it hangs off
  P.push(tint(box(0.05, 0.16, 0.05, 'metal', { pos: [0, 0.10, -0.10] }), SHELL_D));
  P.push(tint(box(0.10, 0.04, 0.14, 'metal', { pos: [0, 0.02, -0.08] }), SHELL_D));
  // the body: a stubby box with a hood over the lens
  P.push(tint(box(0.15, 0.13, 0.24, 'metal', { pos: [0, 0.02, 0] }), SHELL));
  P.push(tint(box(0.16, 0.03, 0.20, 'metal', { pos: [0, 0.09, 0.01] }), SHELL_D));
  P.push(tint(box(0.17, 0.09, 0.05, 'metal', { pos: [0, 0.02, 0.13] }), SHELL_D));
  // the lens, black and slightly proud
  P.push(tint(cyl(0.045, 0.05, 0.06, 8, 'glass', {
    pos: [0, 0.02, 0.15], rot: [Math.PI / 2, 0, 0],
  }), LENS));
  // a stub aerial, because it has to talk to something
  P.push(tint(cyl(0.008, 0.008, 0.16, 4, 'metal', { pos: [0.05, 0.16, -0.04] }), SHELL_D));
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* The tell: one red pinhole. Unlit for most of a second, so from any
     distance it is a pixel that appears and is gone before you are sure
     you saw it. */
  const led = new THREE.Mesh(
    new THREE.PlaneGeometry(0.035, 0.035),
    new THREE.MeshBasicMaterial({
      color: 0xff2a1a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  led.position.set(0.055, 0.055, 0.13);
  g.add(led);

  g.userData.led = led;
  g.userData.tick = (t, dt = 0.016, camPos = null) => {
    // one blink every 2.4 seconds, and it lasts about a tenth of one
    const ph = (t + (g.userData.phase || 0)) % 2.4;
    const on = ph < 0.11;
    led.material.opacity = on ? 0.9 : 0;
    if (on && camPos) {
      // it faces you so the pinhole is never edge-on and invisible
      led.rotation.y = Math.atan2(camPos.x - g.position.x, camPos.z - g.position.z)
        - g.rotation.y;
    }
  };
  return g;
}

/* ===========================================================
   THE MAST
   =========================================================== */
export function buildTower(rng, mats, flameFactory) {
  const g = new THREE.Group();
  const P = [];
  const IRON = G(0x6a6258), IRON_D = G(0x453f38), RUST = G(0x7a4a2a);

  /* ---- the legs ----
     Four, splayed at the foot and drawn in, so it reads as a mast and
     not as a chimney. The batter is what makes it look tall. */
  const foot = 3.4, headSpread = 0.9;
  const legAt = (i, y) => {
    const k = y / TOWER_H;
    const r = foot + (headSpread - foot) * k;
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };
  const SEG = 2.0;
  for (let i = 0; i < 4; i++) {
    for (let y = 0; y < TOWER_H; y += SEG) {
      const a0 = legAt(i, y), a1 = legAt(i, Math.min(TOWER_H, y + SEG));
      const dx = a1.x - a0.x, dz = a1.z - a0.z, dy = SEG;
      const len = Math.hypot(dx, dy, dz);
      const leg = box(0.20, len, 0.20, 'metal', {
        pos: [(a0.x + a1.x) / 2, y + SEG / 2, (a0.z + a1.z) / 2],
        rot: [Math.atan2(dz, dy), 0, -Math.atan2(dx, dy)],
      });
      tint(leg, y < 6 ? RUST : IRON);
      P.push(leg);
    }
  }
  /* ---- the bracing ----
     A horizontal ring every two metres and a diagonal in every bay, which
     is what a lattice actually is and what makes it read at a distance. */
  for (let y = SEG; y < TOWER_H; y += SEG) {
    for (let i = 0; i < 4; i++) {
      const a = legAt(i, y), bq = legAt((i + 1) % 4, y);
      const dx = bq.x - a.x, dz = bq.z - a.z;
      P.push(tint(box(Math.hypot(dx, dz), 0.10, 0.10, 'metal', {
        pos: [(a.x + bq.x) / 2, y, (a.z + bq.z) / 2],
        rot: [0, Math.atan2(dz, dx), 0],
      }), IRON_D));
      // the diagonal, up from this corner to the next one a bay higher
      if (y + SEG <= TOWER_H) {
        const c = legAt((i + 1) % 4, y + SEG);
        const ddx = c.x - a.x, ddz = c.z - a.z, ddy = SEG;
        const dl = Math.hypot(ddx, ddy, ddz);
        P.push(tint(box(0.075, dl, 0.075, 'metal', {
          pos: [(a.x + c.x) / 2, y + SEG / 2, (a.z + c.z) / 2],
          rot: [Math.atan2(ddz, ddy), 0, -Math.atan2(ddx, ddy)],
        }), IRON_D));
      }
    }
  }

  /* ---- the ladder, up the south leg, with a hoop cage round it ---- */
  const LAD_A = Math.PI / 4 + Math.PI;      // which corner it runs up
  const ladAt = (y) => {
    const k = y / TOWER_H;
    const r = (foot + (headSpread - foot) * k) - 0.42;
    return { x: Math.cos(LAD_A) * r, z: Math.sin(LAD_A) * r };
  };
  for (let y = 0.4; y < CAB_Y + 1.2; y += 0.34) {
    const a = ladAt(y);
    P.push(tint(box(0.52, 0.05, 0.05, 'metal', {
      pos: [a.x, y, a.z], rot: [0, LAD_A, 0],
    }), IRON));
  }
  for (const s of [-0.26, 0.26]) {
    for (let y = 0; y < CAB_Y + 1.2; y += 2.0) {
      const a = ladAt(y + 1.0);
      P.push(tint(box(0.06, 2.0, 0.06, 'metal', {
        pos: [a.x - Math.sin(LAD_A) * s, y + 1.0, a.z + Math.cos(LAD_A) * s],
      }), IRON));
    }
  }
  // the safety hoops, which are the detail that says "you climb this"
  for (let y = 2.4; y < CAB_Y; y += 1.2) {
    const a = ladAt(y);
    for (let k = 0; k < 7; k++) {
      const th = -0.5 + (k / 6) * Math.PI * 2 * 0.62;
      P.push(tint(box(0.07, 0.07, 0.07, 'metal', {
        pos: [a.x + Math.cos(th + LAD_A) * 0.42, y, a.z + Math.sin(th + LAD_A) * 0.42],
      }), IRON_D));
    }
  }

  /* ---- the hut at the head of the ladder ---- */
  {
    const H = [];
    const CW = 2.6, CH = 2.5;
    // floor, walls, roof
    H.push(tint(box(CW + 0.5, 0.18, CW + 0.5, 'metal', { pos: [0, CAB_Y - 0.1, 0] }), IRON_D));
    for (const [sx, sz, w, d] of [[0, -CW / 2, CW, 0.16], [0, CW / 2, CW, 0.16],
      [-CW / 2, 0, 0.16, CW], [CW / 2, 0, 0.16, CW]]) {
      // the doorway is a gap in the south wall
      if (sz === CW / 2) {
        H.push(tint(box(0.8, CH, d, 'metal', { pos: [-0.9, CAB_Y + CH / 2, sz] }), IRON));
        H.push(tint(box(0.8, CH, d, 'metal', { pos: [0.9, CAB_Y + CH / 2, sz] }), IRON));
        H.push(tint(box(1.0, 0.5, d, 'metal', { pos: [0, CAB_Y + CH - 0.25, sz] }), IRON));
        continue;
      }
      H.push(tint(box(w, CH, d, 'metal', { pos: [sx, CAB_Y + CH / 2, sz] }), IRON));
    }
    H.push(tint(box(CW + 0.7, 0.16, CW + 0.7, 'metal', { pos: [0, CAB_Y + CH, 0] }), IRON_D));
    // a corrugated look, and rust down the seams
    for (let i = -3; i <= 3; i++) {
      H.push(tint(box(0.05, CH, 0.05, 'metal', {
        pos: [i * 0.4, CAB_Y + CH / 2, -CW / 2 - 0.08],
      }), i % 2 ? RUST : IRON_D));
    }
    // a window on the seaward side, and the walkway round the outside
    H.push(tint(box(1.5, 0.9, 0.06, 'glass', { pos: [0, CAB_Y + 1.5, -CW / 2 - 0.09] }), G(0x2a3a3a)));
    H.push(tint(box(CW + 1.6, 0.10, CW + 1.6, 'metal', { pos: [0, CAB_Y - 0.22, 0] }), IRON_D));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      H.push(tint(box(0.06, 0.7, 0.06, 'metal', {
        pos: [Math.cos(a) * (CW / 2 + 0.72), CAB_Y + 0.2, Math.sin(a) * (CW / 2 + 0.72)],
      }), IRON_D));
    }
    P.push(...H);
  }

  /* ---- the head: dishes, a whip aerial, and the lamp ---- */
  P.push(tint(cyl(0.10, 0.14, TOWER_H - CAB_Y - 2.5, 6, 'metal', {
    pos: [0, CAB_Y + 2.5 + (TOWER_H - CAB_Y - 2.5) / 2, 0],
  }), IRON));
  for (const [dy, dr, da] of [[8, 0.9, 0.4], [13, 0.7, 2.6], [18, 0.8, 4.4]]) {
    const y = CAB_Y + dy;
    P.push(tint(cyl(dr, dr * 0.55, 0.16, 10, 'metal', {
      pos: [Math.cos(da) * 0.7, y, Math.sin(da) * 0.7],
      rot: [Math.PI / 2 - 0.35, 0, da],
    }), G(0x8a8880)));
    P.push(tint(box(0.09, 0.09, 0.8, 'metal', {
      pos: [Math.cos(da) * 0.35, y, Math.sin(da) * 0.35], rot: [0, -da, 0],
    }), IRON_D));
  }
  P.push(tint(cyl(0.035, 0.02, 4.2, 4, 'metal', { pos: [0, TOWER_H + 1.6, 0] }), G(0xa8a49a)));
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---- the red lamp, which has never stopped ---- */
  const lampGlass = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a18 })
  );
  lampGlass.position.y = TOWER_H - 0.3;
  g.add(lampGlass);
  const lampHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 4.4),
    new THREE.MeshBasicMaterial({
      color: 0xff3020, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    })
  );
  lampHalo.position.y = TOWER_H - 0.3;
  g.add(lampHalo);
  /* One light, present from the start, never added or removed — the count
     of lights in a scene is baked into every shader's cache key. */
  const lampLight = new THREE.PointLight(0xff3020, 0, 26, 1.5);
  lampLight.position.y = TOWER_H - 0.3;
  g.add(lampLight);

  // a lamp in the hut too, so the doorway reads from the ground at night
  const cabLight = new THREE.PointLight(0xffd8a0, 1.6, 12, 1.6);
  cabLight.position.set(0, CAB_Y + 1.9, 0);
  g.add(cabLight);

  const _v = new THREE.Vector3();
  g.userData.tick = (t, dt = 0.016, camPos = null) => {
    /* Two seconds dark, a third of a second lit. An aircraft warning lamp
       is a beat you can set your watch by, and from across the island it
       is the only thing that tells you the mast is there at all. */
    const ph = t % 2.3;
    const k = ph < 0.34 ? Math.sin((ph / 0.34) * Math.PI) : 0;
    lampGlass.material.color.setRGB(0.32 + k * 0.68, 0.06 + k * 0.10, 0.05);
    lampHalo.material.opacity = k * 0.55;
    lampLight.intensity = k * 5.2;
    if (camPos) {
      lampHalo.lookAt(camPos.x, lampHalo.getWorldPosition(_v).y, camPos.z);
    }
    cabLight.intensity = 1.5 + Math.sin(t * 3.1) * 0.12;
  };
  return g;
}

/* ===========================================================
   THE HUT, INSIDE

   Its own little scene, like the bunker and the bar: four walls, a
   window with the island behind it, and one terminal.
   =========================================================== */
export function buildCab(mats) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e0c);
  scene.fog = new THREE.Fog(0x141a16, 6, 30);

  const P = [];
  const IRON = G(0x5a6058), IRON_D = G(0x343a32), RUST = G(0x7a4a2a);
  const W = 5.0, H = 2.7;

  // floor: steel plate, worn through in the middle
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const px = -W / 2 + 0.5 + i, pz = -W / 2 + 0.5 + j;
      const mid = 1 - Math.min(1, Math.hypot(px, pz) / 3);
      P.push(tint(box(0.98, 0.3, 0.98, 'metal', { pos: [px, -0.15, pz] }),
        IRON_D.clone().lerp(G(0x6a6258), 0.2 + mid * 0.4)));
    }
  }
  // ceiling and walls
  P.push(tint(box(W, 0.3, W, 'metal', { pos: [0, H + 0.15, 0] }), G(0x22261f)));
  for (const [px, pz, bw, bd] of [[0, -W / 2, W, 0.3], [-W / 2, 0, 0.3, W], [W / 2, 0, 0.3, W]]) {
    P.push(tint(box(bw, H, bd, 'metal', { pos: [px, H / 2, pz] }), IRON));
  }
  // the south wall, with the doorway out to the ladder
  P.push(tint(box(1.6, H, 0.3, 'metal', { pos: [-1.7, H / 2, W / 2] }), IRON));
  P.push(tint(box(1.6, H, 0.3, 'metal', { pos: [1.7, H / 2, W / 2] }), IRON));
  P.push(tint(box(1.8, 0.7, 0.3, 'metal', { pos: [0, H - 0.35, W / 2] }), IRON));
  // ribs down the walls, and rust where the water gets in
  for (let i = -2; i <= 2; i++) {
    P.push(tint(box(0.08, H, 0.08, 'metal', { pos: [i * 1.0, H / 2, -W / 2 + 0.18] }),
      i % 2 ? RUST : IRON_D));
  }
  // the window, looking out over the island
  P.push(tint(box(2.6, 0.12, 0.10, 'metal', { pos: [0, 1.05, -W / 2 + 0.16] }), IRON_D));
  P.push(tint(box(2.6, 0.12, 0.10, 'metal', { pos: [0, 2.05, -W / 2 + 0.16] }), IRON_D));

  /* ---- the desk and the terminal ---- */
  P.push(tint(box(3.0, 0.10, 0.9, 'metal', { pos: [0, 0.78, -1.5] }), G(0x4a5048)));
  for (const sx of [-1.3, 1.3]) {
    P.push(tint(box(0.10, 0.78, 0.10, 'metal', { pos: [sx, 0.39, -1.2] }), IRON_D));
    P.push(tint(box(0.10, 0.78, 0.10, 'metal', { pos: [sx, 0.39, -1.8] }), IRON_D));
  }
  // the rack the monitor sits in
  P.push(tint(box(1.5, 1.15, 0.7, 'metal', { pos: [0, 1.42, -1.7] }), G(0x3a4038)));
  P.push(tint(box(1.6, 0.10, 0.8, 'metal', { pos: [0, 2.02, -1.7] }), IRON_D));
  // cable trays and a loom of cable going up through the roof
  P.push(tint(box(0.3, 0.14, W - 0.6, 'metal', { pos: [-1.9, H - 0.4, 0] }), IRON_D));
  for (let i = 0; i < 6; i++) {
    P.push(tint(cyl(0.03, 0.03, W - 0.8, 4, 'rope', {
      pos: [-1.9 + (i % 3) * 0.09, H - 0.32 + ((i / 3) | 0) * 0.07, 0],
      rot: [Math.PI / 2, 0, 0],
    }), G([0x8a2018, 0x2a4a8a, 0x8a7a20, 0x2a2a2a, 0x6a6a6a, 0x2a6a3a][i])));
  }
  // a chair, a mug, and a shelf of spares
  P.push(tint(cyl(0.32, 0.30, 0.09, 8, 'metal', { pos: [0, 0.48, -0.5] }), G(0x5a2a24)));
  P.push(tint(cyl(0.07, 0.09, 0.46, 6, 'metal', { pos: [0, 0.23, -0.5] }), IRON_D));
  P.push(tint(box(0.42, 0.06, 0.42, 'metal', { pos: [0, 0.02, -0.5] }), IRON_D));
  P.push(tint(cyl(0.055, 0.05, 0.10, 7, 'planks', { pos: [1.1, 0.88, -1.4] }), G(0xd8d0c0)));
  P.push(tint(box(1.6, 0.08, 0.34, 'metal', { pos: [1.6, 1.9, -W / 2 + 0.35], rot: [0, 0, 0] }), IRON_D));

  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* the monitor's own glass, which glows whether or not you are using it */
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.86),
    new THREE.MeshBasicMaterial({ color: 0x1a4a34 })
  );
  glass.position.set(0, 1.45, -1.34);
  scene.add(glass);

  scene.add(new THREE.AmbientLight(0x8a9a90, 1.2));
  scene.add(new THREE.HemisphereLight(0xa8c0b0, 0x2a3028, 0.8));
  const tube = new THREE.PointLight(0xd8f0e0, 2.4, 10, 1.6);
  tube.position.set(0, H - 0.4, 0.4);
  scene.add(tube);
  const screenGlow = new THREE.PointLight(0x40c080, 1.6, 6, 1.8);
  screenGlow.position.set(0, 1.45, -1.0);
  scene.add(screenGlow);

  scene.userData.tick = (t) => {
    // the strip light has a flicker it has had for years
    const bad = Math.sin(t * 37) > 0.986 ? 0.35 : 1;
    tube.intensity = (2.3 + Math.sin(t * 5.1) * 0.1) * bad;
    screenGlow.intensity = 1.5 + Math.sin(t * 2.3) * 0.2;
    glass.material.color.setRGB(0.09, 0.28 + Math.sin(t * 2.3) * 0.03, 0.20);
  };
  return scene;
}

/** The desk, the rack and the chair are solid. */
export const CAB_COLLIDERS = [
  { x: 0, z: -1.6, r: 1.5 },
  { x: -1.4, z: -1.5, r: 0.5 },
  { x: 1.4, z: -1.5, r: 0.5 },
  { x: 0, z: -0.5, r: 0.42 },
];
