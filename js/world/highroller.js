/* ===========================================================
   highroller.js — the room behind the painting.

   Tim Grady Flopper's portrait hangs on the cabin front of the
   Lucky Flopper. Walk into it and you do not stop: the frame is
   a door, and behind it is a room that is not on the boat's
   plan — panelled in red, lit by four braziers, with a single
   baize table and a dealer who does not step out of the dark.

   He calls himself Michael Beef. He says he is an associate of
   Tim Grady Flopper. Nobody has ever seen the two of them in the
   same room, which is not evidence of anything.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, tint, blankUV } from '../lib/geo.js';
import { drawText, textWidth } from '../lib/bitfont.js';

const G = (n) => new THREE.Color(n);

/** A framed print for the walls: gilt, and something unreadable inside. */
function wallArt(seed) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const x = c.getContext('2d');
  const R = (n) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  x.fillStyle = '#2a1410'; x.fillRect(0, 0, 64, 48);
  x.fillStyle = '#4a2a1a'; x.fillRect(3, 3, 58, 42);
  // a horizon and some shapes: a seascape, more or less
  x.fillStyle = '#5a3a2a'; x.fillRect(4, 4, 56, 22);
  x.fillStyle = '#3a2418'; x.fillRect(4, 26, 56, 18);
  for (let i = 0; i < 5; i++) {
    const w = 4 + R(i) * 12;
    x.fillStyle = `rgba(200,160,110,${(0.1 + R(i + 9) * 0.2).toFixed(2)})`;
    x.fillRect(6 + R(i + 3) * 46, 8 + R(i + 5) * 14, w, 2 + R(i + 7) * 5);
  }
  x.fillStyle = '#c39a2c';
  x.fillRect(0, 0, 64, 3); x.fillRect(0, 45, 64, 3);
  x.fillRect(0, 0, 3, 48); x.fillRect(61, 0, 3, 48);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The brass plate over the door back out. */
function plate(lines) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#4a3a12'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#6a5420'; x.fillRect(4, 4, 248, 56);
  lines.forEach((l, i) => {
    let sc = i === 0 ? 4 : 2;
    while (sc > 1 && textWidth(l, sc, 1) > 236) sc--;
    drawText(x, l, {
      x: 128, y: 12 + i * 26, scale: sc, align: 'center',
      color: '#ffe9a8', shadow: false,
    });
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ===========================================================
   THE ROOM
   =========================================================== */
export function buildHighRoller(mats, flameFactory) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0304);
  scene.fog = new THREE.Fog(0x24101a, 14, 70);

  const W = 24, D = 22, H = 5.0;
  const P = [];
  /* Bright for the panelling. This is a room lit by four fires and one
     shaded lamp, and a dark-red tint under that much darkness came out as a
     black box you could not find the table in. */
  const WOOD = G(0x9a4034), WOOD_D = G(0x5e2420), GOLD = G(0xe0b44a);

  /* ---- the shell, panelled ----
     Panels rather than four big boxes: one atlas cell stretched over
     sixteen metres is a smear, and a long thin quad at a grazing angle
     picks a mip so coarse the cell collapses into the whole sheet. */
  const PANEL = 1.6;
  for (let i = 0; i < Math.ceil(W / PANEL); i++) {
    for (let j = 0; j < Math.ceil(D / PANEL); j++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      // a chequer floor, dark red and near-black
      P.push(tint(box(PANEL - 0.03, 0.5, PANEL - 0.03, 'planks', { pos: [px, -0.25, pz] }),
        ((i + j) % 2 ? G(0x7e3228) : G(0x542020))));
      P.push(tint(box(PANEL - 0.03, 0.5, PANEL - 0.03, 'planks', { pos: [px, H, pz] }), WOOD_D));
    }
  }
  const rows = Math.ceil(H / PANEL);
  for (let r = 0; r < rows; r++) {
    const py = r * PANEL + PANEL / 2;
    const ph = Math.min(PANEL, H - r * PANEL) - 0.03;
    if (ph <= 0) continue;
    for (let i = 0; i < Math.ceil(W / PANEL); i++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      for (const pz of [-D / 2, D / 2]) {
        P.push(tint(box(PANEL - 0.03, ph, 0.5, 'planks', { pos: [px, py, pz] }),
          WOOD.clone().multiplyScalar(0.8 + ((i * 5 + r * 3) % 7) / 22)));
      }
    }
    for (let j = 0; j < Math.ceil(D / PANEL); j++) {
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      for (const px of [-W / 2, W / 2]) {
        P.push(tint(box(0.5, ph, PANEL - 0.03, 'planks', { pos: [px, py, pz] }),
          WOOD.clone().multiplyScalar(0.8 + ((j * 5 + r * 3) % 7) / 22)));
      }
    }
  }
  // gilt rails: a dado at waist height and a cornice at the top
  for (const [ry, rh] of [[1.15, 0.10], [H - 0.35, 0.14]]) {
    for (let i = 0; i < Math.ceil(W / PANEL); i++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      for (const pz of [-D / 2 + 0.27, D / 2 - 0.27]) {
        P.push(tint(box(PANEL, rh, 0.07, 'metal', { pos: [px, ry, pz] }), GOLD));
      }
    }
    for (let j = 0; j < Math.ceil(D / PANEL); j++) {
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      for (const px of [-W / 2 + 0.27, W / 2 - 0.27]) {
        P.push(tint(box(0.07, rh, PANEL, 'metal', { pos: [px, ry, pz] }), GOLD));
      }
    }
  }

  /* ---- the table ---- */
  const TZ = -3.4;    // well back from the door, not on top of it
  P.push(tint(cyl(2.9, 3.1, 0.9, 14, 'planks', { pos: [0, 0.45, TZ] }), G(0x7a2c22)));
  P.push(tint(cyl(3.15, 3.15, 0.16, 16, 'planks', { pos: [0, 0.96, TZ] }), G(0xa04a2c)));
  P.push(tint(cyl(2.95, 2.95, 0.06, 16, 'clothTat', { pos: [0, 1.06, TZ] }), G(0x2f9a6c)));
  // a padded rail round the rim
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    P.push(tint(cyl(0.16, 0.16, 1.25, 6, 'clothTat', {
      pos: [Math.cos(a) * 3.02, 1.06, TZ + Math.sin(a) * 3.02], rot: [Math.PI / 2, a, 0],
    }), G(0x6a2c26)));
  }
  // the dealer's shoe, and a tray of chips
  P.push(tint(box(0.5, 0.26, 0.36, 'planks', { pos: [0, 1.20, TZ - 2.1] }), G(0x2a1410)));
  P.push(tint(box(1.5, 0.10, 0.28, 'metal', { pos: [0, 1.14, TZ - 1.6] }), GOLD));

  /* ---- five stools round the near side ---- */
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.18 + (i / 4) * 0.64);
    const sx = Math.cos(a) * 4.0, sz = TZ + Math.sin(a) * 4.0;
    P.push(tint(cyl(0.34, 0.30, 0.14, 10, 'clothTat', { pos: [sx, 0.86, sz] }), G(0xa03028)));
    P.push(tint(cyl(0.09, 0.11, 0.8, 6, 'metal', { pos: [sx, 0.42, sz] }), GOLD));
    P.push(tint(cyl(0.3, 0.3, 0.06, 10, 'metal', { pos: [sx, 0.05, sz] }), G(0x3a3a42)));
  }

  /* A runner from the door to the table. The room is big now and an empty
     floor is a corridor; a carpet tells you where to walk. */
  {
    const RUN = 9, BAY = 1.5;
    for (let i = 0; i < Math.ceil(RUN / BAY); i++) {
      const rz = D / 2 - 1.6 - i * BAY;
      P.push(tint(box(3.0, 0.05, BAY - 0.03, 'clothTat', { pos: [0, 0.03, rz] }), G(0x8a1a18)));
      for (const sx of [-1.6, 1.6]) {
        P.push(tint(box(0.16, 0.06, BAY - 0.03, 'clothTat', { pos: [sx, 0.04, rz] }), GOLD));
      }
    }
  }
  // and a pair of columns either side of the way in
  for (const sx of [-4.0, 4.0]) {
    P.push(tint(cyl(0.42, 0.48, H - 0.6, 10, 'planks', { pos: [sx, (H - 0.6) / 2, D / 2 - 3.2] }), WOOD));
    P.push(tint(cyl(0.56, 0.56, 0.3, 12, 'planks', { pos: [sx, H - 0.75, D / 2 - 3.2] }), GOLD));
    P.push(tint(cyl(0.60, 0.60, 0.24, 12, 'planks', { pos: [sx, 0.12, D / 2 - 3.2] }), GOLD));
  }

  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---- four braziers, with real fire ---- */
  const flames = [];
  const fireLights = [];
  for (const [bx, bz] of [[-8.6, -8.0], [8.6, -8.0], [-8.6, 4.6], [8.6, 4.6]]) {
    const B = [];
    B.push(tint(cyl(0.5, 0.34, 0.16, 10, 'metal', { pos: [0, 0.08, 0] }), G(0x3a2a18)));
    B.push(tint(cyl(0.10, 0.10, 1.5, 6, 'metal', { pos: [0, 0.85, 0] }), GOLD));
    B.push(tint(cyl(0.30, 0.62, 0.5, 10, 'metal', { pos: [0, 1.85, 0] }), G(0x8a6a2a)));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      B.push(tint(cyl(0.05, 0.05, 0.6, 4, 'metal', {
        pos: [Math.cos(a) * 0.5, 2.1, Math.sin(a) * 0.5], rot: [0.2 * Math.cos(a), 0, -0.2 * Math.sin(a)],
      }), GOLD));
    }
    const st = new THREE.Mesh(mergeGeos(B), mats.opaque);
    st.position.set(bx, 0, bz);
    scene.add(st);

    const f = flameFactory(mats, 5, 0.5);
    f.position.set(bx, 2.15, bz);
    scene.add(f);
    flames.push(f);

    const L = new THREE.PointLight(0xffa850, 3.6, 26, 1.5);
    L.position.set(bx, 2.6, bz);
    scene.add(L);
    fireLights.push(L);
  }

  /* ---- sconces down the long walls ----
     The room is twenty-four metres across now. Four braziers in the corners
     leave the walk from the door in the dark, and a dark corridor is not
     grand, it is just dark. */
  const sconces = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-6.0, 0, 6.0]) {
      const SC = [];
      SC.push(tint(box(0.26, 0.5, 0.22, 'metal', { pos: [0, 0, 0] }), GOLD));
      SC.push(tint(cyl(0.20, 0.30, 0.34, 8, 'metal', { pos: [0, 0.34, 0.1] }), G(0x8a6a2a)));
      const m = new THREE.Mesh(mergeGeos(SC), mats.opaque);
      m.position.set(sx * (W / 2 - 0.42), 3.1, sz);
      m.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(m);
      const L = new THREE.PointLight(0xffb060, 1.9, 18, 1.6);
      L.position.set(sx * (W / 2 - 1.0), 3.4, sz);
      scene.add(L);
      // the flame in it
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffd8a0, fog: true })
      );
      bulb.position.set(sx * (W / 2 - 0.72), 3.42, sz);
      scene.add(bulb);
      sconces.push({ L, bulb, phase: sz * 0.3 + sx });
    }
  }

  /* ---- the art, and the way out ---- */
  const arts = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.2),
      new THREE.MeshLambertMaterial({ map: wallArt(i + 1) })
    );
    const spots = [
      [-6.0, 2.6, -D / 2 + 0.28, 0], [6.0, 2.6, -D / 2 + 0.28, 0],
      [-W / 2 + 0.28, 2.6, 0, Math.PI / 2], [W / 2 - 0.28, 2.6, 0, -Math.PI / 2],
    ][i];
    m.position.set(spots[0], spots[1], spots[2]);
    m.rotation.y = spots[3];
    scene.add(m);
    arts.push(m);
  }
  {
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 0.75),
      new THREE.MeshBasicMaterial({ map: plate(['HIGH ROLLERS', 'M. BEEF PRESIDING']), fog: true })
    );
    b.position.set(0, 3.3, -D / 2 + 0.28);
    scene.add(b);
  }
  // the door back out, behind you as you arrive
  {
    const DP = [];
    DP.push(tint(box(2.2, 3.0, 0.2, 'planks', { pos: [0, 1.5, D / 2 - 0.28] }), G(0x7a2c22)));
    DP.push(tint(box(2.5, 0.2, 0.3, 'metal', { pos: [0, 3.05, D / 2 - 0.28] }), GOLD));
    DP.push(tint(cyl(0.1, 0.1, 0.3, 8, 'metal', { pos: [0.75, 1.5, D / 2 - 0.44], rot: [Math.PI / 2, 0, 0] }), GOLD));
    scene.add(new THREE.Mesh(mergeGeos(DP), mats.opaque));
  }

  /* ===========================================================
     MICHAEL BEEF
     A figure who does not step out of the dark. He is built almost
     entirely from unlit black, so what you see is a silhouette with two
     points of light in it and a pair of hands — and the hands are the only
     part of him the braziers reach.
     =========================================================== */
  const beef = new THREE.Group();
  beef.position.set(0, 0, TZ - 4.6);
  {
    const SH = new THREE.MeshBasicMaterial({ color: 0x050304, fog: true });
    const dark = [];
    // a heavy coat that reaches the floor
    dark.push(cyl(0.62, 0.86, 2.05, 10, null, { pos: [0, 1.02, 0] }));
    // shoulders, and a collar turned up past the jaw
    dark.push(box(1.30, 0.34, 0.52, null, { pos: [0, 2.02, 0] }));
    dark.push(box(0.86, 0.46, 0.44, null, { pos: [0, 2.30, -0.02] }));
    // the head, and the brim of a hat over it
    dark.push(cyl(0.25, 0.25, 0.42, 8, null, { pos: [0, 2.56, 0] }));
    dark.push(cyl(0.56, 0.56, 0.06, 12, null, { pos: [0, 2.78, 0] }));
    dark.push(cyl(0.27, 0.30, 0.26, 10, null, { pos: [0, 2.92, 0] }));
    for (const g of dark) blankUV(g);
    beef.add(new THREE.Mesh(mergeGeos(dark), SH));
  }
  // two points of light where his eyes are
  const eyes = [];
  for (const sx of [-0.10, 0.10]) {
    const e = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.035, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xffd88a, fog: false })
    );
    e.position.set(sx, 2.62, 0.245);
    beef.add(e);
    eyes.push(e);
  }
  // and the hands, which the fire does reach
  const hands = [];
  for (const sx of [-0.52, 0.52]) {
    const h = new THREE.Mesh(
      new THREE.BoxGeometry(0.20, 0.09, 0.26),
      new THREE.MeshLambertMaterial({ color: 0xc4a488 })
    );
    h.position.set(sx, 1.42, 0.42);
    beef.add(h);
    hands.push(h);
  }
  scene.add(beef);

  /* the cards on the baize: two pools of them, built once and moved */
  const cardGeo = new THREE.BoxGeometry(0.34, 0.014, 0.48);
  const cardMat = new THREE.MeshLambertMaterial({ color: 0xf2ecd8 });
  const backMat = new THREE.MeshLambertMaterial({ color: 0x8a2018 });
  const cards = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(cardGeo, i % 2 ? cardMat : cardMat.clone());
    m.visible = false;
    scene.add(m);
    cards.push(m);
  }

  /* lighting: the fire does most of it, and there is one shaded lamp low
     over the baize so the table is the brightest thing in the room */
  const tableLamp = new THREE.PointLight(0xffe0b8, 4.0, 16, 1.5);
  tableLamp.position.set(0, 2.9, TZ);
  scene.add(tableLamp);
  scene.add(new THREE.AmbientLight(0xb08880, 1.5));
  scene.add(new THREE.HemisphereLight(0xd89a86, 0x54241e, 1.15));
  // the shade it hangs in
  {
    const L = [];
    L.push(tint(cyl(0.1, 0.1, 1.8, 6, 'metal', { pos: [0, 4.1, TZ] }), GOLD));
    L.push(tint(cyl(0.78, 0.24, 0.48, 12, 'metal', { pos: [0, 3.1, TZ] }), G(0x5a2418)));
    scene.add(new THREE.Mesh(mergeGeos(L), mats.opaque));
  }

  scene.userData.cards = cards;
  scene.userData.beef = beef;
  scene.userData.table = { x: 0, z: TZ };
  scene.userData.tick = (t, dt = 0.016) => {
    for (const f of flames) f.userData.tick?.(t, dt);
    // the fire breathes, and each brazier on its own beat
    fireLights.forEach((L, i) => {
      L.intensity = 3.3 + Math.sin(t * 7.3 + i * 1.7) * 0.6 + Math.sin(t * 19 + i) * 0.26;
    });
    tableLamp.intensity = 3.9 + Math.sin(t * 4.1) * 0.22;
    for (const sc of sconces) {
      const k = 0.82 + Math.sin(t * 8.1 + sc.phase) * 0.14 + Math.sin(t * 23 + sc.phase) * 0.06;
      sc.L.intensity = 1.9 * k;
      sc.bulb.material.color.setRGB(1, 0.78 * k + 0.15, 0.5 * k + 0.1);
    }

    /* He breathes, very slightly, and his eyes catch the fire. Nothing
       else about him moves unless he is dealing. */
    beef.position.y = Math.sin(t * 0.62) * 0.022;
    beef.rotation.y = Math.sin(t * 0.31) * 0.06;
    const blink = Math.sin(t * 0.83) > 0.985;
    for (const e of eyes) {
      e.scale.y = blink ? 0.1 : 1;
      e.material.color.setRGB(1, 0.85 + Math.sin(t * 9) * 0.07, 0.55);
    }
    for (const h of hands) h.position.y = 1.42 + Math.sin(t * 1.3 + h.position.x) * 0.015;
  };
  return scene;
}

/** Where you stand when you come through the frame. */
export const HR_ENTRY = { x: 0, y: 1.0, z: 9.4 };
export const HR_BOX = { minX: -11.4, maxX: 11.4, minZ: -10.4, maxZ: 10.4 };
export function hrHeight() { return 0; }

/** The table, the stools and the braziers are all solid. */
export const HR_COLLIDERS = (() => {
  const out = [];
  const TZ = -3.4;    // well back from the door, not on top of it
  // the table: a ring of circles round its rim
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    out.push({ x: Math.cos(a) * 2.5, z: TZ + Math.sin(a) * 2.5, r: 0.95 });
  }
  for (const [bx, bz] of [[-8.6, -8.0], [8.6, -8.0], [-8.6, 4.6], [8.6, 4.6]]) {
    out.push({ x: bx, z: bz, r: 0.6 });
  }
  // the dealer keeps his side of the table
  out.push({ x: 0, z: TZ - 4.3, r: 0.9 });
  return out;
})();
