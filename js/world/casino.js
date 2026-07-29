/* ===========================================================
   casino.js — the Lucky Flopper, moored off the west shore.

   A small, sleazy gambling boat with a plank bridge to the sand,
   two slot machines bolted to the deck and a portrait of the owner
   nailed above them. Tim Grady Flopper does not appear in person.

   Everything here is drawn in code like the rest of the island —
   the portrait is painted into a canvas at load, not loaded from
   a file, so the page still makes no external requests.
   =========================================================== */

import * as THREE from 'three';
import {
  mergeGeos, box, cyl, plane, tint, blankUV,
} from '../lib/geo.js';
import { buildSignTexture } from '../lib/textures.js';

const G = (n) => new THREE.Color(n);

/* ===========================================================
   THE PROPRIETOR
   A lumpy brown mass in a tin, framed and hung above the slots.
   =========================================================== */
function flopperPortrait() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');

  // the tin
  x.fillStyle = '#d8d4cc'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#b8b2a6';
  x.beginPath(); x.arc(32, 34, 27, 0, Math.PI * 2); x.fill();
  // the gravy it is sitting in
  x.fillStyle = '#4a3320';
  x.beginPath(); x.arc(32, 34, 24, 0, Math.PI * 2); x.fill();

  /* the mass itself: overlapping lumps, lit from the upper left,
     which is the only way to make a brown blob read as a brown blob */
  const lump = (cx, cy, rx, ry, rot, base) => {
    x.save();
    x.translate(cx, cy); x.rotate(rot);
    x.fillStyle = base;
    x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); x.fill();
    // highlight along the top-left of each lump
    x.fillStyle = 'rgba(150,116,74,.55)';
    x.beginPath(); x.ellipse(-rx * 0.22, -ry * 0.3, rx * 0.55, ry * 0.42, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(30,18,8,.45)';
    x.beginPath(); x.ellipse(rx * 0.3, ry * 0.35, rx * 0.42, ry * 0.3, 0, 0, Math.PI * 2); x.fill();
    x.restore();
  };
  lump(24, 26, 15, 7, -0.5, '#5b3f24');
  lump(40, 30, 14, 7, 0.7, '#6a4a2b');
  lump(30, 40, 17, 8, 0.15, '#553a21');
  lump(38, 20, 11, 6, -0.2, '#63452a');
  lump(20, 40, 11, 6, 0.9, '#4d351d');
  lump(33, 31, 12, 6, -1.1, '#6f4d2e');

  // a shine on the sauce
  x.fillStyle = 'rgba(220,190,140,.20)';
  x.beginPath(); x.ellipse(20, 48, 9, 3, -0.3, 0, Math.PI * 2); x.fill();

  // quantise: this is a PS1 texture, not a photograph
  const img = x.getImageData(0, 0, 64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let k = 0; k < 3; k++) img.data[i + k] = (img.data[i + k] >> 4) << 4;
  }
  x.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- a slot machine ---------- */
function buildSlot(rng, mats, index) {
  const g = new THREE.Group();
  const P = [];

  const CAB = G(0x8a2018), TRIM = G(0xc39a2c);
  P.push(tint(box(1.1, 1.5, 0.8, 'planks', { pos: [0, 0.75, 0] }), CAB));
  P.push(tint(box(1.2, 0.16, 0.9, 'planks', { pos: [0, 1.58, 0] }), TRIM));
  P.push(tint(box(1.2, 0.16, 0.9, 'planks', { pos: [0, 0.06, 0] }), TRIM));
  // legs
  for (const sx of [-0.42, 0.42]) {
    for (const sz of [-0.3, 0.3]) {
      P.push(tint(cyl(0.06, 0.07, 0.7, 5, 'metal', { pos: [sx, -0.35, sz] }), G(0x6a6a72)));
    }
  }
  // the window the reels show through
  P.push(tint(box(0.82, 0.5, 0.06, 'metal', { pos: [0, 1.0, 0.42] }), G(0x2a2018)));
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* three reels, which actually turn */
  const reels = [];
  const REEL = new THREE.CylinderGeometry(0.21, 0.21, 0.22, 12);
  REEL.rotateZ(Math.PI / 2);
  blankUV(REEL, 'goldDark');
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(REEL.clone(), new THREE.MeshLambertMaterial({
      color: i === 1 ? 0xe8dcc0 : 0xd8ccb0,
    }));
    m.position.set(-0.24 + i * 0.24, 1.0, 0.34);
    g.add(m);
    reels.push(m);
  }

  // the arm
  const armPivot = new THREE.Group();
  armPivot.position.set(0.62, 1.2, 0);
  const arm = new THREE.Mesh(
    mergeGeos([
      tint(cyl(0.045, 0.045, 0.62, 5, 'metal', { pos: [0, -0.31, 0] }), G(0xb0b6bc)),
      tint(cyl(0.11, 0.11, 0.12, 7, 'goldDark', { pos: [0, -0.66, 0] }), G(0xc02a1a)),
    ]),
    mats.opaque
  );
  armPivot.add(arm);
  g.add(armPivot);

  // a lamp on top that flashes when it pays
  const lamp = new THREE.PointLight(0xffd24a, 0, 7, 1.8);
  lamp.position.set(0, 1.9, 0);
  g.add(lamp);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x5a4a20, fog: false })
  );
  bulb.position.set(0, 1.78, 0);
  g.add(bulb);

  let spin = 0, pull = 0, win = 0;
  g.userData.spin = () => { spin = 1.6; pull = 1; };
  g.userData.payout = (on) => { win = on ? 2.2 : 0; };
  g.userData.tick = (t, dt = 0.016) => {
    if (pull > 0) pull = Math.max(0, pull - dt * 3);
    if (spin > 0) spin = Math.max(0, spin - dt);
    if (win > 0) win = Math.max(0, win - dt);
    armPivot.rotation.x = -pull * 1.1;
    reels.forEach((r, i) => {
      const speed = spin > 0 ? (26 - i * 6) * Math.min(1, spin * 2.2) : 0;
      r.rotation.x += speed * dt;
    });
    const flash = win > 0 ? (Math.floor(t * 12) % 2 ? 1 : 0.2) : 0;
    lamp.intensity = 5 * flash;
    bulb.material.color.setHex(flash > 0.5 ? 0xfff3c4 : 0x5a4a20);
  };
  g.userData.index = index;
  return g;
}

/* ===========================================================
   THE BOAT
   =========================================================== */
export function buildCasinoBoat(rng, mats, flameFactory) {
  const g = new THREE.Group();
  const P = [], C = [];
  const HULL = G(0x4a3a26), HULL_D = G(0x33281a), DECK = G(0x7a6242);
  const LEN = 15, WID = 6.4;

  /* hull: ribs and planking, sitting low */
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const w = (WID / 2) * Math.sin(Math.PI * (0.2 + t * 0.7));
    for (const side of [-1, 1]) {
      P.push(tint(box(0.26, 1.7, 0.5, 'planks', {
        pos: [side * w, 0.45, (t - 0.5) * LEN], rot: [0, 0, side * 0.16],
      }), HULL));
    }
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const y = 0.25 + ((i / 2) | 0) * 0.34;
    P.push(tint(box(0.2, 0.4, LEN * 0.94, 'planks', {
      pos: [side * (WID / 2 - 0.1 - ((i / 2) | 0) * 0.10), y, 0], rot: [0, 0, side * 0.12],
    }), HULL_D.clone().multiplyScalar(0.85 + rng() * 0.35)));
  }
  // transom and bow
  P.push(tint(box(WID * 0.8, 1.5, 0.3, 'planks', { pos: [0, 0.5, LEN / 2 - 0.2] }), HULL));
  P.push(tint(box(WID * 0.35, 1.5, 0.3, 'planks', { pos: [0, 0.5, -LEN / 2 + 0.2] }), HULL));

  /* deck */
  P.push(tint(box(WID - 0.5, 0.3, LEN - 0.8, 'planks', { pos: [0, 1.3, 0] }), DECK));
  for (let i = 0; i < 12; i++) {
    P.push(tint(box(0.16, 0.06, LEN - 1.0, 'planks', {
      pos: [-WID / 2 + 0.5 + i * ((WID - 1) / 11), 1.47, 0],
    }), G(0x5f4a2e)));
  }

  /* a low cabin at the stern with the awning over the slots */
  P.push(tint(box(WID - 1.4, 1.9, 4.2, 'planks', { pos: [0, 2.4, 4.2] }), G(0x6a5230)));
  P.push(tint(box(WID - 1.0, 0.2, 4.6, 'planks', { pos: [0, 3.45, 4.2] }), G(0x8a2018)));
  // shutters
  for (const sx of [-1, 1]) {
    P.push(tint(box(0.1, 0.9, 1.2, 'planks', { pos: [sx * (WID / 2 - 0.7), 2.5, 4.2] }), G(0x3a2a18)));
  }

  /* rail posts and rope */
  for (let i = 0; i <= 8; i++) {
    const z = -LEN / 2 + 1 + (i / 8) * (LEN - 2);
    for (const side of [-1, 1]) {
      const w = (WID / 2 - 0.35) * Math.sin(Math.PI * (0.22 + (i / 8) * 0.66)) / Math.sin(Math.PI * 0.55);
      P.push(tint(cyl(0.06, 0.07, 0.9, 5, 'driftwood', { pos: [side * w, 1.85, z] }), G(0x6a5230)));
    }
  }

  const opaque = new THREE.Mesh(mergeGeos(P), mats.opaque);
  g.add(opaque);

  /* the sign, with the proprietor's name on it in full */
  const signBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(6.0, 1.4),
    new THREE.MeshLambertMaterial({
      map: buildSignTexture(['THE LUCKY FLOPPER', 'T. GRADY FLOPPER, PROP.'],
        '#3a1410', '#ffd24a'),
      transparent: true,
    })
  );
  signBoard.position.set(0, 4.25, 4.15);
  g.add(signBoard);
  const signFrame = [
    tint(box(6.3, 0.16, 0.14, 'planks', { pos: [0, 5.02, 4.12] }), G(0x8a2018)),
    tint(box(6.3, 0.16, 0.14, 'planks', { pos: [0, 3.48, 4.12] }), G(0x8a2018)),
    tint(cyl(0.07, 0.07, 1.0, 5, 'driftwood', { pos: [-2.6, 3.9, 4.4] }), G(0x6a5230)),
    tint(cyl(0.07, 0.07, 1.0, 5, 'driftwood', { pos: [2.6, 3.9, 4.4] }), G(0x6a5230)),
  ];
  g.add(new THREE.Mesh(mergeGeos(signFrame), mats.opaque));

  /* the proprietor, framed */
  const portrait = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshLambertMaterial({ map: flopperPortrait() })
  );
  portrait.position.set(0, 2.7, 2.06);
  g.add(portrait);
  const frameParts = [
    tint(box(1.75, 0.14, 0.1, 'planks', { pos: [0, 3.48, 2.02] }), G(0xc39a2c)),
    tint(box(1.75, 0.14, 0.1, 'planks', { pos: [0, 1.92, 2.02] }), G(0xc39a2c)),
    tint(box(0.14, 1.7, 0.1, 'planks', { pos: [-0.8, 2.7, 2.02] }), G(0xc39a2c)),
    tint(box(0.14, 1.7, 0.1, 'planks', { pos: [0.8, 2.7, 2.02] }), G(0xc39a2c)),
  ];
  g.add(new THREE.Mesh(mergeGeos(frameParts), mats.opaque));

  /* two slot machines, bolted down facing the bow */
  const slots = [];
  for (let i = 0; i < 2; i++) {
    const s = buildSlot(rng, mats, i);
    s.position.set(-1.3 + i * 2.6, 1.45, 1.0);
    s.rotation.y = Math.PI;
    g.add(s);
    slots.push(s);
  }
  g.userData.slots = slots;

  /* torches along the rail — the whole point of a sleazy boat is that it
     is lit like one */
  const flames = [];
  for (const [tx, tz] of [[-2.5, -5.4], [2.5, -5.4], [-2.7, -1.0], [2.7, -1.0], [-2.6, 6.0], [2.6, 6.0]]) {
    const post = new THREE.Mesh(mergeGeos([
      tint(cyl(0.09, 0.11, 1.9, 6, 'driftwood', { pos: [0, 0.95, 0] }), G(0x6a5230)),
      tint(cyl(0.22, 0.14, 0.2, 8, 'metal', { pos: [0, 1.95, 0] }), G(0x8a6a2a)),
    ]), mats.opaque);
    post.position.set(tx, 1.45, tz);
    g.add(post);
    const f = flameFactory(mats, 3, 0.34);
    f.position.set(tx, 3.5, tz);
    g.add(f);
    flames.push(f);
    const l = new THREE.PointLight(0xffa040, 1.7, 13, 1.7);
    l.position.set(tx, 3.7, tz);
    g.add(l);
  }
  g.userData.flames = flames;

  g.userData.tick = (t, dt = 0.016) => {
    for (const f of flames) f.userData.tick?.(t, dt);
    for (const s of slots) s.userData.tick(t, dt);
    // she rolls at anchor
    g.rotation.z = Math.sin(t * 0.55) * 0.022;
    g.rotation.x = Math.sin(t * 0.41 + 1) * 0.014;
  };
  return g;
}

/* ===========================================================
   FERDI'S VENDING MACHINES
   Two of them, hidden away from the shop, stocked with whatever
   was left over. No black market, no sanctuary — just a box in
   the trees that will sell you one thing.
   =========================================================== */
export function buildVendingMachine(rng, mats) {
  const g = new THREE.Group();
  const P = [];
  const CASE = G(0x2a5a4a), TRIM = G(0xc39a2c);

  P.push(tint(box(1.3, 2.3, 0.9, 'planks', { pos: [0, 1.15, 0] }), CASE));
  P.push(tint(box(1.4, 0.14, 1.0, 'planks', { pos: [0, 2.36, 0] }), TRIM));
  P.push(tint(box(1.4, 0.14, 1.0, 'planks', { pos: [0, 0.07, 0] }), TRIM));
  // the glass front, and the shelves behind it
  P.push(tint(box(1.0, 1.3, 0.06, 'glass', { pos: [0, 1.45, 0.47] }), G(0x9fd8e8)));
  for (let i = 0; i < 3; i++) {
    P.push(tint(box(0.95, 0.05, 0.3, 'planks', { pos: [0, 0.95 + i * 0.4, 0.32] }), G(0x1a3a30)));
    for (let k = 0; k < 3; k++) {
      P.push(tint(box(0.2, 0.28, 0.2, 'planks', {
        pos: [-0.3 + k * 0.3, 1.14 + i * 0.4, 0.32],
      }), G([0xd8c69a, 0xc02a1a, 0xffd24a][(i + k) % 3])));
    }
  }
  // coin slot and the tray at the bottom
  P.push(tint(box(0.16, 0.05, 0.06, 'metal', { pos: [0.42, 1.0, 0.47] }), G(0xd8d8e0)));
  P.push(tint(box(0.9, 0.3, 0.14, 'metal', { pos: [0, 0.45, 0.44] }), G(0x1a1a1e)));
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  // a tired fluorescent tube inside
  const lamp = new THREE.PointLight(0x9fe8d8, 1.4, 9, 1.8);
  lamp.position.set(0, 1.7, 0.3);
  g.add(lamp);
  let flick = 0;
  g.userData.tick = (t) => {
    flick = (Math.sin(t * 27) > 0.86 || Math.sin(t * 3.1) > 0.99) ? 0.2 : 1;
    lamp.intensity = 1.4 * flick;
  };
  return g;
}

/* ---------- the plank bridge from the sand ---------- */
export function buildBoatBridge(rng, mats, fromX, fromZ, toX, toZ, groundAt) {
  const g = new THREE.Group();
  const P = [];
  const dx = toX - fromX, dz = toZ - fromZ;
  const len = Math.hypot(dx, dz);
  const n = Math.max(4, Math.round(len / 1.4));
  const ux = dx / len, uz = dz / len;

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = fromX + dx * t, z = fromZ + dz * t;
    // the deck rises from the sand to the gunwale
    const gy = groundAt(x, z);
    const y = Math.max(gy + 0.2, 0.25) + t * t * 1.25;
    P.push(tint(box(1.9, 0.16, 1.5, 'planks', {
      pos: [x - fromX, y, z - fromZ], rot: [0, Math.atan2(ux, uz), 0],
    }), G(0x7a6242).multiplyScalar(0.8 + rng() * 0.4)));
    // trestles down to the seabed
    if (i % 2 === 0 && i < n) {
      for (const side of [-1, 1]) {
        const px = x - fromX + (-uz) * side * 0.8;
        const pz = z - fromZ + (ux) * side * 0.8;
        const drop = y - Math.min(gy, -0.4);
        P.push(tint(cyl(0.09, 0.11, drop + 0.6, 6, 'driftwood', {
          pos: [px, y - drop / 2, pz],
        }), G(0x5a4630)));
      }
    }
    // rope rail
    if (i % 2 === 0) {
      for (const side of [-1, 1]) {
        P.push(tint(cyl(0.05, 0.05, 0.85, 4, 'driftwood', {
          pos: [x - fromX + (-uz) * side * 0.85, y + 0.45, z - fromZ + ux * side * 0.85],
        }), G(0x6a5230)));
      }
    }
  }
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));
  g.position.set(fromX, 0, fromZ);
  return g;
}
