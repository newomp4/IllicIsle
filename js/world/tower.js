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

/* Where the mast stands.

   It was at (-96, -78), which is byte-for-byte BUNKER_SPOTS[0] — I picked
   the coordinates by hand and landed exactly on the west shoulder hatch,
   so the mast grew out of the listening post. Then it went to (70, -100),
   which is off to one side.

   This is the point diametrically opposite the campfire at (-39, 134):
   bearing 2.85 against the fire's -0.28, which is a straight line through
   the middle of the island and out the other side. 241 metres from the
   fire, 87 from the nearest hatch, on the highest ground on that side at
   49 metres, and 16 clear of anything solid. */
export const TOWER_SPOT = { x: 28, z: -96 };
export const TOWER_H = 38;            // to the lamp
export const CAB_Y = 15.5;            // the hut, up the ladder

/** How many are already up when you get there, and how many you may own. */
export const CAMERA_FITTED = 4;
export const CAMERA_MAX = 10;
/* Ferdi sells them three to a box. Six of the ten channels are yours, so
   two boxes fills the relay and there is no third box worth buying. */
export const CAMERA_BUNDLE = 3;

/* What the terminal renders a feed at. It was 128x88 drawn into a 180x124
   window, so every camera pixel covered about two screen pixels and the
   picture was a mosaic. This is the size of the window itself, which makes
   it one for one and as sharp as the interface canvas can be. */
export const FEED_W = 242;
export const FEED_H = 150;

/* And the postage stamps down the side of the terminal, at the size the
   strip actually draws them. */
export const THUMB_W = 20;
export const THUMB_H = 13;

/* Where the four that came with the mast are pointing.

   Whoever put them up was watching the ways ON to this island, not the
   pretty bits: the camp, the shop, the pier and the temple door. They are
   fixed, they are already on the feed when you first climb the ladder, and
   they are the reason the terminal is worth finding at all — a bank of
   dead channels tells you nothing. */
export const FITTED_CAMS = [
  { at: [-46, 140], look: [-46, 154], name: 'CAM 1  CAMP', short: 'CAMP' },
  { at: [-30, 34], look: [-30, 46], name: 'CAM 2  SHOP', short: 'SHOP' },
  { at: [-118, 96], look: [-132, 110], name: 'CAM 3  PIER', short: 'PIER' },
  { at: [0, 0], look: [0, 0], name: 'CAM 4  TEMPLE', short: 'TMPL' },
];

/* The room at the head of the ladder.

   It was five metres square with the walls at 2.2, which is not enough to
   stand a third-person camera in — it ended up in the wall and you were
   looking at the grey outside of the world. Seven and a half now, with the
   box well inside the walls so the camera has somewhere to be. */
export const CAB_BOX = { minX: -3.0, maxX: 3.0, minZ: -3.0, maxZ: 3.0, maxY: 3.1 };
export const CAB_ENTRY = { x: 0, y: 0.1, z: 2.2 };
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
  scene.fog = new THREE.Fog(0x141a16, 9, 40);

  const P = [];
  const IRON = G(0x6a7068), IRON_D = G(0x3a4038), RUST = G(0x8a5230);
  const W = 7.6, H = 3.4;

  /* ---- the floor: steel plate, worn through where people stood ---- */
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const px = -W / 2 + 0.475 + i * 0.95, pz = -W / 2 + 0.475 + j * 0.95;
      const mid = 1 - Math.min(1, Math.hypot(px, pz) / 4.2);
      P.push(tint(box(0.93, 0.3, 0.93, 'metal', { pos: [px, -0.15, pz] }),
        IRON_D.clone().lerp(G(0x8a9088), 0.15 + mid * 0.45)));
      // the diamond tread on each plate
      if ((i + j) % 2 === 0) {
        P.push(tint(box(0.5, 0.03, 0.5, 'metal', { pos: [px, 0.015, pz], rot: [0, 0.78, 0] }),
          G(0x9aa098)));
      }
    }
  }
  // ceiling, with a girder across it
  P.push(tint(box(W, 0.3, W, 'metal', { pos: [0, H + 0.15, 0] }), G(0x262a22)));
  P.push(tint(box(W, 0.34, 0.30, 'metal', { pos: [0, H - 0.18, 0] }), IRON_D));
  P.push(tint(box(0.30, 0.34, W, 'metal', { pos: [0, H - 0.18, 0] }), IRON_D));

  /* ---- the walls ----
     Half a metre thick, because a third-person camera backed into a
     twenty-centimetre wall sees straight through it and out into the grey. */
  for (const [px, pz, bw, bd] of [[0, -W / 2, W, 0.5], [-W / 2, 0, 0.5, W], [W / 2, 0, 0.5, W]]) {
    P.push(tint(box(bw, H, bd, 'metal', { pos: [px, H / 2, pz] }), IRON));
  }
  // the south wall, with the doorway out to the ladder
  P.push(tint(box(2.9, H, 0.5, 'metal', { pos: [-2.35, H / 2, W / 2] }), IRON));
  P.push(tint(box(2.9, H, 0.5, 'metal', { pos: [2.35, H / 2, W / 2] }), IRON));
  P.push(tint(box(1.9, 0.9, 0.5, 'metal', { pos: [0, H - 0.45, W / 2] }), IRON));
  // ribs, and rust running down from where the roof leaks
  for (let i = -3; i <= 3; i++) {
    for (const pz of [-W / 2 + 0.28, W / 2 - 0.28]) {
      P.push(tint(box(0.09, H, 0.09, 'metal', { pos: [i * 1.0, H / 2, pz] }),
        i % 2 ? RUST : IRON_D));
    }
    P.push(tint(box(0.09, H, 0.09, 'metal', { pos: [-W / 2 + 0.28, H / 2, i * 1.0] }), IRON_D));
    P.push(tint(box(0.09, H, 0.09, 'metal', { pos: [W / 2 - 0.28, H / 2, i * 1.0] }), IRON_D));
  }

  /* ---- the window, and what is behind it ----
     A long strip across the north wall with the island painted on it, so
     the room has somewhere to be rather than being a box in the void. */
  P.push(tint(box(4.6, 0.14, 0.12, 'metal', { pos: [0, 1.15, -W / 2 + 0.24] }), IRON_D));
  P.push(tint(box(4.6, 0.14, 0.12, 'metal', { pos: [0, 2.35, -W / 2 + 0.24] }), IRON_D));
  for (const mx of [-1.5, 0, 1.5]) {
    P.push(tint(box(0.10, 1.2, 0.12, 'metal', { pos: [mx, 1.75, -W / 2 + 0.24] }), IRON_D));
  }

  /* ---- the desk, running the length of the north wall ---- */
  P.push(tint(box(5.6, 0.12, 1.0, 'metal', { pos: [0, 0.80, -2.6] }), G(0x5a6058)));
  P.push(tint(box(5.6, 0.10, 0.14, 'metal', { pos: [0, 0.88, -2.14] }), G(0x7a8078)));
  for (const sx of [-2.4, 0, 2.4]) {
    P.push(tint(box(0.12, 0.80, 0.12, 'metal', { pos: [sx, 0.40, -2.2] }), IRON_D));
    P.push(tint(box(0.12, 0.80, 0.12, 'metal', { pos: [sx, 0.40, -3.0] }), IRON_D));
  }
  // the monitor rack in the middle of it
  P.push(tint(box(1.9, 1.35, 0.8, 'metal', { pos: [0, 1.55, -2.8] }), G(0x424840)));
  P.push(tint(box(2.0, 0.12, 0.9, 'metal', { pos: [0, 2.26, -2.8] }), IRON_D));
  // a keyboard shelf, and a chunky keyboard on it
  P.push(tint(box(1.1, 0.06, 0.36, 'metal', { pos: [0, 0.88, -2.05] }), G(0x3a4038)));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 11; c++) {
      P.push(tint(box(0.07, 0.03, 0.07, 'metal', {
        pos: [-0.42 + c * 0.085, 0.93, -2.14 + r * 0.09],
      }), G(0xc8c8c0)));
    }
  }

  /* ---- the racks down the east wall, which is what a relay hut IS ---- */
  for (let r = 0; r < 3; r++) {
    const rz = -1.6 + r * 1.6;
    P.push(tint(box(0.9, 2.4, 1.3, 'metal', { pos: [W / 2 - 0.9, 1.2, rz] }), G(0x3a4038)));
    P.push(tint(box(0.05, 2.3, 1.2, 'metal', { pos: [W / 2 - 1.36, 1.2, rz] }), G(0x2a2e28)));
    // slot fronts, with their own little lamps
    for (let u = 0; u < 7; u++) {
      P.push(tint(box(0.06, 0.24, 1.1, 'metal', {
        pos: [W / 2 - 1.38, 0.3 + u * 0.31, rz],
      }), G(0x4a5048)));
    }
  }
  // a spares shelf on the west wall, with cameras on it
  P.push(tint(box(0.7, 0.08, 3.0, 'metal', { pos: [-W / 2 + 0.7, 1.15, -0.4] }), IRON_D));
  P.push(tint(box(0.7, 0.08, 3.0, 'metal', { pos: [-W / 2 + 0.7, 1.75, -0.4] }), IRON_D));
  for (let i = 0; i < 5; i++) {
    P.push(tint(box(0.16, 0.14, 0.24, 'metal', {
      pos: [-W / 2 + 0.7, 1.26, -1.5 + i * 0.6], rot: [0, 0.3 + i * 0.4, 0],
    }), G(0x3a4038)));
  }
  // cable trays round three walls and a loom going up through the roof
  for (const [tx, tz, tw2, td] of [[0, -W / 2 + 0.5, W - 1, 0.34], [-W / 2 + 0.5, 0, 0.34, W - 1]]) {
    P.push(tint(box(tw2, 0.16, td, 'metal', { pos: [tx, H - 0.5, tz] }), IRON_D));
  }
  for (let i = 0; i < 8; i++) {
    P.push(tint(cyl(0.032, 0.032, W - 1.2, 4, 'rope', {
      pos: [-W / 2 + 0.42 + (i % 4) * 0.1, H - 0.40 + ((i / 4) | 0) * 0.08, 0],
      rot: [Math.PI / 2, 0, 0],
    }), G([0x8a2018, 0x2a4a8a, 0x8a7a20, 0x2a2a2a, 0x6a6a6a, 0x2a6a3a, 0x8a4a8a, 0xc06020][i])));
  }
  // a chair on castors, pushed back from the desk
  P.push(tint(cyl(0.36, 0.34, 0.10, 8, 'clothTat', { pos: [0.4, 0.50, -1.5] }), G(0x5a2a24)));
  P.push(tint(box(0.62, 0.60, 0.12, 'clothTat', { pos: [0.4, 0.85, -1.2] }), G(0x5a2a24)));
  P.push(tint(cyl(0.07, 0.09, 0.48, 6, 'metal', { pos: [0.4, 0.24, -1.5] }), IRON_D));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    P.push(tint(box(0.28, 0.05, 0.07, 'metal', {
      pos: [0.4 + Math.cos(a) * 0.16, 0.04, -1.5 + Math.sin(a) * 0.16], rot: [0, -a, 0],
    }), IRON_D));
  }
  // and the things people leave: a mug, a clipboard, a fan
  P.push(tint(cyl(0.055, 0.05, 0.11, 7, 'planks', { pos: [1.5, 0.92, -2.4] }), G(0xd8d0c0)));
  P.push(tint(box(0.30, 0.02, 0.40, 'paper', { pos: [-1.6, 0.87, -2.4], rot: [0, 0.3, 0] }), G(0xd8d2b8)));
  P.push(tint(cyl(0.22, 0.22, 0.10, 10, 'metal', {
    pos: [-2.6, 0.98, -2.5], rot: [Math.PI / 2, 0, 0.3],
  }), G(0x4a5048)));

  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---- the view out of the window ----
     A painted backdrop: sky, sea, a headland and the tree line, so looking
     out of the window is looking at the island and not at nothing. */
  {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 40;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 40);
    sky.addColorStop(0, '#3a6a9a'); sky.addColorStop(0.55, '#7ab0d0');
    x.fillStyle = sky; x.fillRect(0, 0, 128, 40);
    x.fillStyle = '#2a5a7a'; x.fillRect(0, 21, 128, 19);
    x.fillStyle = '#1e4a66'; x.fillRect(0, 21, 128, 1);
    // a headland and a tree line on it
    x.fillStyle = '#2a3a24';
    for (let i = 0; i < 128; i++) {
      const h = 4 + Math.sin(i * 0.09) * 3 + Math.sin(i * 0.31) * 2;
      x.fillRect(i, 21 - h, 1, h);
    }
    x.fillStyle = '#1a2a18';
    for (let i = 0; i < 26; i++) {
      const px = (i * 37) % 128;
      x.fillRect(px, 14 - (i % 4), 2, 6 + (i % 4));
    }
    // clouds
    x.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 6; i++) x.fillRect((i * 43) % 120, 3 + (i % 3) * 3, 14, 2);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const view = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 1.15),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    view.position.set(0, 1.75, -W / 2 + 0.26);
    scene.add(view);
  }

  /* ---- the monitor's own glass ---- */
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.05),
    new THREE.MeshBasicMaterial({ color: 0x1a4a34 })
  );
  glass.position.set(0, 1.58, -2.38);
  scene.add(glass);

  /* ---- the rack lamps: two rows of them, blinking on their own clocks ---- */
  const lamps = [];
  for (let r = 0; r < 3; r++) {
    const rz = -1.6 + r * 1.6;
    for (let u = 0; u < 7; u++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.05, 0.05),
        new THREE.MeshBasicMaterial({
          color: u % 3 === 0 ? 0xff3020 : (u % 3 === 1 ? 0x30ff70 : 0xffc030),
          transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      m.position.set(W / 2 - 1.42, 0.3 + u * 0.31, rz - 0.42);
      m.rotation.y = -Math.PI / 2;
      scene.add(m);
      lamps.push({ m, rate: 0.7 + ((r * 7 + u) % 9) * 0.31, phase: (r * 3 + u) * 0.7 });
    }
  }

  scene.add(new THREE.AmbientLight(0x9aa8a0, 1.35));
  scene.add(new THREE.HemisphereLight(0xb8ccc0, 0x30382e, 0.9));
  const tube = new THREE.PointLight(0xd8f0e0, 3.0, 14, 1.5);
  tube.position.set(0, H - 0.5, 0.6);
  scene.add(tube);
  const screenGlow = new THREE.PointLight(0x40c080, 1.8, 7, 1.8);
  screenGlow.position.set(0, 1.55, -1.9);
  scene.add(screenGlow);

  /* the strip light itself, so the flicker has something to come from */
  {
    const t2 = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.10, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xe8fff0 })
    );
    t2.position.set(0, H - 0.42, 0.6);
    scene.add(t2);
    scene.userData.tubeMesh = t2;
  }

  scene.userData.tick = (t) => {
    // a flicker it has had for years
    const bad = Math.sin(t * 37) > 0.984 ? 0.3 : 1;
    tube.intensity = (2.9 + Math.sin(t * 5.1) * 0.12) * bad;
    if (scene.userData.tubeMesh) {
      const v = 0.75 + 0.25 * bad;
      scene.userData.tubeMesh.material.color.setRGB(v, v, v * 0.97);
    }
    screenGlow.intensity = 1.7 + Math.sin(t * 2.3) * 0.22;
    glass.material.color.setRGB(0.09, 0.30 + Math.sin(t * 2.3) * 0.04, 0.22);
    for (const L of lamps) {
      const k = Math.sin(t * L.rate + L.phase);
      L.m.material.opacity = k > 0.4 ? 0.95 : 0.14;
    }
  };
  return scene;
}

/** The desk, the rack and the chair are solid. */
export const CAB_COLLIDERS = (() => {
  const out = [];
  // the desk, along the north wall
  for (let i = 0; i < 6; i++) out.push({ x: -2.4 + i * 0.96, z: -2.7, r: 0.62 });
  // the racks down the east wall
  for (let r = 0; r < 3; r++) out.push({ x: 3.0, z: -1.6 + r * 1.6, r: 0.8 });
  // the spares shelf and the chair
  out.push({ x: -3.1, z: -0.4, r: 0.5 });
  out.push({ x: 0.4, z: -1.4, r: 0.45 });
  return out;
})();
