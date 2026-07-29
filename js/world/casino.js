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
import { drawText, textWidth } from '../lib/bitfont.js';

const G = (n) => new THREE.Color(n);

/* ===========================================================
   THE PROPRIETOR
   A lumpy brown mass in a tin, framed and hung above the slots.
   =========================================================== */
function flopperPortrait() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');

  /* The backing the tin is presented on, because it is a PORTRAIT */
  x.fillStyle = '#3a2418'; x.fillRect(0, 0, 128, 128);
  const vig = x.createRadialGradient(64, 56, 10, 64, 64, 78);
  vig.addColorStop(0, '#6a4a30'); vig.addColorStop(1, '#241408');
  x.fillStyle = vig; x.fillRect(0, 0, 128, 128);

  const CX = 64, CY = 66, R = 44;

  // the shadow it casts
  x.fillStyle = 'rgba(0,0,0,.45)';
  x.beginPath(); x.ellipse(CX + 4, CY + R * 0.55, R * 0.98, R * 0.34, 0, 0, 6.29); x.fill();

  /* ---- the tin ---- */
  // the body, seen slightly from above: a squat cylinder
  x.fillStyle = '#8a8f94';
  x.fillRect(CX - R, CY - R * 0.30, R * 2, R * 0.62);
  x.beginPath(); x.ellipse(CX, CY + R * 0.32, R, R * 0.34, 0, 0, 6.29); x.fill();
  // a band of shade down the right of the can
  x.fillStyle = 'rgba(30,36,42,.42)';
  x.fillRect(CX + R * 0.34, CY - R * 0.30, R * 0.66, R * 0.62);
  // and a highlight down the left
  x.fillStyle = 'rgba(240,246,250,.42)';
  x.fillRect(CX - R * 0.86, CY - R * 0.30, R * 0.22, R * 0.62);

  // the rolled rim
  x.fillStyle = '#c8ced4';
  x.beginPath(); x.ellipse(CX, CY - R * 0.30, R, R * 0.36, 0, 0, 6.29); x.fill();
  x.fillStyle = '#6f757b';
  x.beginPath(); x.ellipse(CX, CY - R * 0.30, R * 0.90, R * 0.31, 0, 0, 6.29); x.fill();

  /* ---- what is in it ---- */
  // the gravy the loaf sits in
  x.fillStyle = '#3e2a14';
  x.beginPath(); x.ellipse(CX, CY - R * 0.28, R * 0.84, R * 0.29, 0, 0, 6.29); x.fill();

  /* A single moulded loaf rather than a heap of lumps: it holds the shape
     of the tin, it has a flat top with the ring of the mould pressed into
     it, and it glistens. */
  const loaf = (dy, fill) => {
    x.fillStyle = fill;
    x.beginPath(); x.ellipse(CX, CY - R * 0.42 + dy, R * 0.74, R * 0.26, 0, 0, 6.29); x.fill();
  };
  // the side of the loaf standing proud of the gravy
  x.fillStyle = '#5c3f22';
  x.fillRect(CX - R * 0.74, CY - R * 0.44, R * 1.48, R * 0.18);
  x.beginPath(); x.ellipse(CX, CY - R * 0.26, R * 0.74, R * 0.26, 0, 0, 6.29); x.fill();
  loaf(0, '#6d4c2b');
  // the pressed ring on top
  x.strokeStyle = 'rgba(40,24,10,.55)'; x.lineWidth = 2;
  x.beginPath(); x.ellipse(CX, CY - R * 0.42, R * 0.52, R * 0.18, 0, 0, 6.29); x.stroke();
  // grain: short strokes, all lying the same way, the way pressed meat does
  for (let i = 0; i < 90; i++) {
    const a = (i * 2.399) % 6.283;
    const rr = Math.sqrt((i % 17) / 17);
    const px = CX + Math.cos(a) * rr * R * 0.68;
    const py = CY - R * 0.42 + Math.sin(a) * rr * R * 0.22;
    x.fillStyle = i % 3 ? 'rgba(120,88,52,.5)' : 'rgba(52,34,16,.5)';
    x.fillRect(px, py, 3, 1);
  }
  // fat, in little pale flecks
  for (let i = 0; i < 26; i++) {
    const a = (i * 1.77) % 6.283;
    const rr = Math.sqrt((i % 11) / 11);
    x.fillStyle = 'rgba(226,206,170,.62)';
    x.fillRect(CX + Math.cos(a) * rr * R * 0.62, CY - R * 0.44 + Math.sin(a) * rr * R * 0.2, 2, 2);
  }
  // the jelly, catching the light
  x.fillStyle = 'rgba(255,232,180,.30)';
  x.beginPath(); x.ellipse(CX - R * 0.26, CY - R * 0.52, R * 0.26, R * 0.08, -0.25, 0, 6.29); x.fill();
  x.fillStyle = 'rgba(255,246,214,.22)';
  x.beginPath(); x.ellipse(CX + R * 0.28, CY - R * 0.36, R * 0.16, R * 0.05, 0.2, 0, 6.29); x.fill();

  /* ---- the lid, peeled back on its ring ---- */
  x.save();
  x.translate(CX + R * 0.52, CY - R * 0.86);
  x.rotate(-0.42);
  x.fillStyle = '#dfe5ea';
  x.beginPath(); x.ellipse(0, 0, R * 0.72, R * 0.24, 0, 0, 6.29); x.fill();
  x.fillStyle = '#a8b0b6';
  x.beginPath(); x.ellipse(0, 2, R * 0.72, R * 0.20, 0, 0, 6.29); x.fill();
  // curl marks across it
  x.strokeStyle = 'rgba(120,130,138,.7)'; x.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    x.beginPath(); x.moveTo(i * 8, -R * 0.18); x.lineTo(i * 8, R * 0.18); x.stroke();
  }
  x.restore();
  // the pull ring
  x.strokeStyle = '#e8eef2'; x.lineWidth = 3;
  x.beginPath(); x.ellipse(CX + R * 0.96, CY - R * 1.04, 7, 5, 0.3, 0, 6.29); x.stroke();

  // a label band round the can with nothing legible on it
  x.fillStyle = '#8a2018';
  x.fillRect(CX - R, CY - R * 0.06, R * 2, R * 0.20);
  x.fillStyle = 'rgba(0,0,0,.35)';
  x.fillRect(CX + R * 0.34, CY - R * 0.06, R * 0.66, R * 0.20);
  x.fillStyle = '#ffd88a';
  for (let i = 0; i < 9; i++) x.fillRect(CX - R * 0.72 + i * 9, CY + R * 0.01, 5, 2);

  // the gilt frame's inner shadow, so it sits IN a frame
  x.strokeStyle = 'rgba(0,0,0,.5)'; x.lineWidth = 6;
  x.strokeRect(3, 3, 122, 122);

  // quantise: this is a PS1 texture, not a photograph
  const img = x.getImageData(0, 0, 128, 128);
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

/* ---------- the marquee: a canvas of glowing letters ---------- */
function marqueeTexture(word, hue) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#120410'; x.fillRect(0, 0, 256, 96);
  // an inner field, so the tubes sit on something
  x.fillStyle = '#1d0720'; x.fillRect(8, 8, 240, 80);

  /* The scale has to come from the word, not from a guess. CASINO at
     scale 7 is 280px wide on a 256px canvas, and the C and the O fell off
     the ends of the sign. */
  const TRACK = 2;
  let scale = 8;
  while (scale > 2 && textWidth(word, scale, TRACK) > 224) scale--;
  const top = Math.round((96 - 7 * scale) / 2);

  /* Neon is a bright core inside a wide, dim halo. Drawn as three passes
     of the same glyphs at falling alpha and rising offset — a blur would
     be smooth, and nothing on this island is smooth. */
  for (const [spread, alpha] of [[3, 0.10], [2, 0.18], [1, 0.34]]) {
    for (let dy = -spread; dy <= spread; dy++) {
      for (let dx = -spread; dx <= spread; dx++) {
        if (dx * dx + dy * dy > spread * spread) continue;
        drawText(x, word, {
          x: 128 + dx, y: top + dy, scale, tracking: TRACK,
          align: 'center', color: `rgba(${hue},${alpha})`, shadow: false,
        });
      }
    }
  }
  drawText(x, word, {
    x: 128, y: top, scale, tracking: TRACK, align: 'center',
    color: '#ffffff', shadow: false,
  });

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The sign: a board of glowing letters ringed by bulbs that chase.
 * Returns a group with a tick that runs the lights.
 */
function buildMarquee(mats, word, w, h, hue) {
  const g = new THREE.Group();

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: marqueeTexture(word, hue), fog: false })
  );
  g.add(board);
  // the same face on the back, so it reads from the water too
  const back = board.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.16;
  g.add(back);

  // the frame it is bolted into
  const F = [];
  for (const [bw, bh, by] of [[w + 0.5, 0.22, h / 2 + 0.12], [w + 0.5, 0.22, -h / 2 - 0.12]]) {
    F.push(tint(box(bw, bh, 0.3, 'metal', { pos: [0, by, -0.08] }), G(0x3a1a2a)));
  }
  for (const sx of [-w / 2 - 0.18, w / 2 + 0.18]) {
    F.push(tint(box(0.24, h + 0.5, 0.3, 'metal', { pos: [sx, 0, -0.08] }), G(0x3a1a2a)));
  }
  g.add(new THREE.Mesh(mergeGeos(F), mats.opaque));

  /* The bulbs. One shared sphere, one material per bulb because each is on
     its own beat — twelve materials is nothing, and the chase is the whole
     reason anybody looks at a marquee. */
  const bulbGeo = new THREE.SphereGeometry(0.13, 6, 5);
  const bulbs = [];
  const ring = [];
  const NX = Math.max(3, Math.round(w / 0.75)), NY = Math.max(2, Math.round(h / 0.75));
  for (let i = 0; i < NX; i++) {
    const bx = -w / 2 + (i / (NX - 1)) * w;
    ring.push([bx, h / 2 + 0.12], [bx, -h / 2 - 0.12]);
  }
  for (let i = 1; i < NY; i++) {
    const by = -h / 2 + (i / NY) * h;
    ring.push([-w / 2 - 0.18, by], [w / 2 + 0.18, by]);
  }
  ring.forEach(([bx, by], i) => {
    const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0x2a1015, fog: false }));
    m.position.set(bx, by, 0.02);
    g.add(m);
    bulbs.push({ m, phase: i });
  });

  // two floodlights so the sign throws colour onto the deck
  const glowA = new THREE.PointLight(0xff3aa0, 2.6, 20, 1.6);
  glowA.position.set(-w / 3, 0, 1.2);
  const glowB = new THREE.PointLight(0x3ad0ff, 2.2, 20, 1.6);
  glowB.position.set(w / 3, 0, 1.2);
  g.add(glowA, glowB);

  const ON = new THREE.Color(0xfff0d0), OFF = new THREE.Color(0x2a1015);
  g.userData.tick = (t) => {
    const step = Math.floor(t * 7);
    for (const b of bulbs) {
      const lit = ((b.phase + step) % 3) === 0;
      b.m.material.color.copy(lit ? ON : OFF);
    }
    const pulse = 0.75 + Math.sin(t * 2.3) * 0.25;
    glowA.intensity = 2.6 * pulse;
    glowB.intensity = 2.2 * (1.5 - pulse);
    // a tube that never quite settled
    board.material.opacity = 1;
    const brownout = Math.sin(t * 37) > 0.965 ? 0.35 : 1;
    board.material.color.setScalar(brownout);
    back.material.color.setScalar(brownout);
  };
  return g;
}

/* ---------- a slot machine ---------- */
function buildSlot(rng, mats, index) {
  const g = new THREE.Group();
  const P = [];

  const CAB = G(0x8a2018), TRIM = G(0xc39a2c);
  P.push(tint(box(1.1, 1.5, 0.8, 'planks', { pos: [0, 0.75, 0] }), CAB));
  P.push(tint(box(1.2, 0.16, 0.9, 'planks', { pos: [0, 1.58, 0] }), TRIM));
  P.push(tint(box(1.2, 0.16, 0.9, 'planks', { pos: [0, 0.06, 0] }), TRIM));
  // a curved crown so they are not just boxes in a row
  P.push(tint(box(1.0, 0.5, 0.5, 'planks', { pos: [0, 1.85, 0], rot: [0.2, 0, 0] }), CAB));
  // legs
  for (const sx of [-0.42, 0.42]) {
    for (const sz of [-0.3, 0.3]) {
      P.push(tint(cyl(0.06, 0.07, 0.7, 5, 'metal', { pos: [sx, -0.35, sz] }), G(0x6a6a72)));
    }
  }
  // the bezel around the window the reels show through
  P.push(tint(box(0.98, 0.1, 0.1, 'metal', { pos: [0, 1.27, 0.44] }), TRIM));
  P.push(tint(box(0.98, 0.1, 0.1, 'metal', { pos: [0, 0.73, 0.44] }), TRIM));
  for (const sx of [-0.49, 0.49]) {
    P.push(tint(box(0.1, 0.64, 0.1, 'metal', { pos: [sx, 1.0, 0.44] }), TRIM));
  }
  P.push(tint(box(0.82, 0.5, 0.06, 'metal', { pos: [0, 1.0, 0.40] }), G(0x2a2018)));
  // a coin tray at the bottom
  P.push(tint(box(0.6, 0.16, 0.24, 'metal', { pos: [0, 0.36, 0.46] }), G(0x2a2a30)));
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* Three reels that actually turn, each carrying its symbols as painted
     bands so you can see them blur past rather than watching a blank drum. */
  const reels = [];
  const bandTex = reelTexture();
  const REEL = new THREE.CylinderGeometry(0.21, 0.21, 0.22, 12);
  REEL.rotateZ(Math.PI / 2);
  blankUV(REEL, 'goldDark');
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.CylinderGeometry(0.21, 0.21, 0.21, 14, 1, true);
    geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: bandTex, color: 0xffffff, side: THREE.DoubleSide,
    }));
    m.position.set(-0.24 + i * 0.24, 1.0, 0.34);
    g.add(m);
    // the drum ends, so it does not read as an open tube
    const cap = new THREE.Mesh(REEL.clone(), new THREE.MeshLambertMaterial({ color: 0xb8ac90 }));
    cap.position.copy(m.position);
    cap.scale.set(0.98, 0.96, 0.96);
    g.add(cap);
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
  lamp.position.set(0, 2.1, 0);
  g.add(lamp);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x5a4a20, fog: false })
  );
  bulb.position.set(0, 2.12, 0);
  g.add(bulb);

  let spin = 0, pull = 0, win = 0;
  const stopAt = [0, 0, 0];
  /**
   * @param {number[]} [result] the three symbol indices to land on, so the
   *   drums agree with the numbers the game already decided.
   */
  g.userData.spin = (result) => {
    spin = 1.6; pull = 1;
    if (result) for (let i = 0; i < 3; i++) stopAt[i] = result[i];
  };
  g.userData.payout = (on) => { win = on ? 2.2 : 0; };
  g.userData.tick = (t, dt = 0.016) => {
    if (pull > 0) pull = Math.max(0, pull - dt * 3);
    if (spin > 0) spin = Math.max(0, spin - dt);
    if (win > 0) win = Math.max(0, win - dt);
    armPivot.rotation.x = -pull * 1.1;
    reels.forEach((r, i) => {
      if (spin > 0) {
        // each drum runs down at its own rate, so they settle left to right
        r.rotation.x += (26 - i * 6) * Math.min(1, spin * 2.2) * dt;
      } else {
        // ease onto the face that was decided
        const want = -(stopAt[i] / SYMBOLS.length) * Math.PI * 2;
        const cur = r.rotation.x % (Math.PI * 2);
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        r.rotation.x += d * Math.min(1, dt * 9);
      }
    });
    const flash = win > 0 ? (Math.floor(t * 12) % 2 ? 1 : 0.2) : 0;
    lamp.intensity = 5 * flash;
    bulb.material.color.setHex(flash > 0.5 ? 0xfff3c4 : 0x5a4a20);
  };
  g.userData.index = index;
  return g;
}

/** The symbols on the drums, in order. Shared with the game's own odds. */
export const SYMBOLS = ['COCONUT', 'ANCHOR', 'SKULL', 'IDOL', 'FISH', 'SEVEN'];
const SYM_COL = ['#8a6a3a', '#9aa6b0', '#e0dcd0', '#ffd24a', '#5aa0c0', '#e04a3a'];

/** A strip of the six symbols, wrapped round a drum. */
function reelTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 192;
  const x = c.getContext('2d');
  SYMBOLS.forEach((name, i) => {
    const y = i * 32;
    x.fillStyle = i % 2 ? '#efe6cc' : '#e2d7b8';
    x.fillRect(0, y, 32, 32);
    x.fillStyle = '#00000022'; x.fillRect(0, y + 30, 32, 2);
    // a blunt pictogram per symbol — five colours and a shape is enough
    x.fillStyle = SYM_COL[i];
    if (name === 'COCONUT') { x.beginPath(); x.arc(16, y + 16, 9, 0, 6.29); x.fill(); }
    else if (name === 'ANCHOR') { x.fillRect(14, y + 6, 4, 20); x.fillRect(8, y + 10, 16, 3); x.fillRect(7, y + 22, 18, 3); }
    else if (name === 'SKULL') { x.fillRect(8, y + 7, 16, 13); x.fillRect(11, y + 20, 10, 5); x.fillStyle = '#221a14'; x.fillRect(11, y + 11, 4, 4); x.fillRect(17, y + 11, 4, 4); }
    else if (name === 'IDOL') { x.fillRect(12, y + 5, 8, 8); x.fillRect(9, y + 13, 14, 13); }
    else if (name === 'FISH') { x.beginPath(); x.ellipse(15, y + 16, 10, 6, 0, 0, 6.29); x.fill(); x.beginPath(); x.moveTo(24, y + 16); x.lineTo(30, y + 9); x.lineTo(30, y + 23); x.fill(); }
    else { x.fillRect(7, y + 6, 18, 4); x.fillRect(17, y + 10, 5, 6); x.fillRect(13, y + 16, 5, 10); }
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ===========================================================
   THE BOAT
   =========================================================== */
export function buildCasinoBoat(rng, mats, flameFactory) {
  const g = new THREE.Group();
  const P = [], C = [];
  const HULL = G(0x4a3a26), HULL_D = G(0x33281a), DECK = G(0x7a6242);
  /* She was a two-slot skiff and she looked like one. A gambling barge
     wants to be the biggest thing on the water, so you can see her lit up
     from the ridge and know the night has started. */
  const LEN = 26, WID = 10.5;

  /* hull: ribs and planking, sitting low */
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const w = (WID / 2) * Math.sin(Math.PI * (0.2 + t * 0.7));
    for (const side of [-1, 1]) {
      P.push(tint(box(0.3, 2.3, 0.5, 'planks', {
        pos: [side * w, 0.55, (t - 0.5) * LEN], rot: [0, 0, side * 0.16],
      }), HULL));
    }
  }
  // strakes, in lengths — see the note on the deck about long thin quads
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const y = 0.25 + ((i / 2) | 0) * 0.36;
    const runs = 8, RL = (LEN * 0.94) / runs;
    for (let k = 0; k < runs; k++) {
      const sz = -(LEN * 0.94) / 2 + RL / 2 + k * RL;
      P.push(tint(box(0.22, 0.42, RL - 0.03, 'planks', {
        pos: [side * (WID / 2 - 0.1 - ((i / 2) | 0) * 0.10), y, sz], rot: [0, 0, side * 0.12],
      }), HULL_D.clone().multiplyScalar(0.85 + rng() * 0.35)));
    }
  }
  // transom and bow
  P.push(tint(box(WID * 0.8, 2.0, 0.35, 'planks', { pos: [0, 0.7, LEN / 2 - 0.2] }), HULL));
  P.push(tint(box(WID * 0.35, 2.0, 0.35, 'planks', { pos: [0, 0.7, -LEN / 2 + 0.2] }), HULL));
  // a white boot-top stripe, because she is trying
  for (let k = 0; k < 10; k++) {
    const sz = -(LEN * 0.9) / 2 + (LEN * 0.9) / 20 + k * (LEN * 0.9) / 10;
    P.push(tint(box(WID + 0.1, 0.22, (LEN * 0.9) / 10 - 0.02, 'planks', { pos: [0, 1.12, sz] }),
      G(0xd8cfae)));
  }

  /* ---------- deck ----------
     Built in bays rather than as three twenty-five-metre slivers. The
     atlas is mipmapped, and a quad that is twenty-five metres long and
     sixteen centimetres wide, seen at a grazing angle down the deck,
     selects a mip so coarse that a cell collapses to one texel of the
     WHOLE sheet — you get rainbow stripes of jungle green and glass blue
     running away from you. Keep every face roughly square and it cannot
     happen. */
  const BAYS = 12, BAY = (LEN - 0.8) / BAYS;
  for (let i = 0; i < BAYS; i++) {
    const bz = -(LEN - 0.8) / 2 + BAY / 2 + i * BAY;
    P.push(tint(box(WID - 0.5, 0.3, BAY - 0.02, 'planks', { pos: [0, 1.3, bz] }),
      DECK.clone().multiplyScalar(0.9 + rng() * 0.2)));
    // caulked seams between the bays, which is what reads as planking
    P.push(tint(box(WID - 0.5, 0.05, 0.06, 'planks', { pos: [0, 1.46, bz + BAY / 2] }), G(0x3f3018)));
  }
  // a red carpet up the middle, in runners rather than one long strip
  const CARPET = LEN - 5, CBAYS = 9, CB = CARPET / CBAYS;
  for (let i = 0; i < CBAYS; i++) {
    const bz = 0.4 - CARPET / 2 + CB / 2 + i * CB;
    P.push(tint(box(2.2, 0.06, CB - 0.02, 'clothTat', { pos: [0, 1.5, bz] }),
      G(0x8a1a18).multiplyScalar(0.88 + rng() * 0.24)));
    for (const sx of [-1.15, 1.15]) {
      P.push(tint(box(0.14, 0.08, CB - 0.02, 'clothTat', { pos: [sx, 1.51, bz] }), G(0xc39a2c)));
    }
  }

  /* the cabin at the stern: two storeys now, with a balcony */
  P.push(tint(box(WID - 1.8, 2.6, 6.0, 'planks', { pos: [0, 2.75, 7.0] }), G(0x6a5230)));
  P.push(tint(box(WID - 1.2, 0.25, 6.4, 'planks', { pos: [0, 4.18, 7.0] }), G(0x8a2018)));
  P.push(tint(box(WID - 3.4, 2.0, 4.4, 'planks', { pos: [0, 5.35, 7.4] }), G(0x7a5c38)));
  P.push(tint(box(WID - 2.8, 0.22, 4.8, 'planks', { pos: [0, 6.46, 7.4] }), G(0x8a2018)));
  // balcony rail round the upper deck
  for (let i = 0; i <= 10; i++) {
    const bz = 4.3 + (i / 10) * 5.4;
    for (const side of [-1, 1]) {
      P.push(tint(cyl(0.05, 0.06, 0.8, 4, 'driftwood',
        { pos: [side * (WID / 2 - 1.0), 4.7, bz] }), G(0x6a5230)));
    }
  }
  // portholes down the cabin sides
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      P.push(tint(cyl(0.28, 0.28, 0.12, 8, 'metal', {
        pos: [side * (WID / 2 - 0.9), 3.0, 5.0 + i * 1.3], rot: [0, 0, Math.PI / 2],
      }), G(0xc39a2c)));
      P.push(tint(cyl(0.2, 0.2, 0.16, 8, 'glass', {
        pos: [side * (WID / 2 - 0.94), 3.0, 5.0 + i * 1.3], rot: [0, 0, Math.PI / 2],
      }), G(0xffd8a0)));
    }
  }
  // shutters
  for (const sx of [-1, 1]) {
    P.push(tint(box(0.1, 1.2, 1.6, 'planks', { pos: [sx * (WID / 2 - 1.1), 2.9, 4.0] }), G(0x3a2a18)));
  }

  /* rail posts down both sides */
  for (let i = 0; i <= 12; i++) {
    const z = -LEN / 2 + 1.4 + (i / 12) * (LEN - 2.8);
    for (const side of [-1, 1]) {
      const w = (WID / 2 - 0.4) * Math.sin(Math.PI * (0.22 + (i / 12) * 0.66)) / Math.sin(Math.PI * 0.55);
      P.push(tint(cyl(0.06, 0.07, 1.0, 5, 'driftwood', { pos: [side * w, 1.9, z] }), G(0x6a5230)));
      P.push(tint(cyl(0.035, 0.035, (LEN - 2.8) / 12 + 0.2, 4, 'rope', {
        pos: [side * w, 2.3, z + (LEN - 2.8) / 24], rot: [Math.PI / 2, 0, 0],
      }), G(0x9a8a66)));
    }
  }

  const opaque = new THREE.Mesh(mergeGeos(P), mats.opaque);
  g.add(opaque);

  /* ---------- THE SIGN ----------
     A marquee over the bow that you can read from the beach, and a
     vertical blade on the cabin so she is legible side-on too. */
  const marquee = buildMarquee(mats, 'CASINO', 7.2, 2.4, '255,60,160');
  marquee.position.set(0, 7.9, 6.0);
  g.add(marquee);
  // the mast it hangs from
  {
    const M = [];
    for (const sx of [-3.6, 3.6]) {
      M.push(tint(cyl(0.13, 0.16, 3.6, 6, 'metal', { pos: [sx, 8.3, 6.4] }), G(0x4a2a3a)));
    }
    M.push(tint(box(8.0, 0.2, 0.25, 'metal', { pos: [0, 9.5, 6.4] }), G(0x4a2a3a)));
    g.add(new THREE.Mesh(mergeGeos(M), mats.opaque));
  }
  const blade = buildMarquee(mats, 'LUCKY', 4.4, 1.7, '60,220,255');
  blade.position.set(-(WID / 2 - 0.6), 5.4, 7.4);
  blade.rotation.y = -Math.PI / 2;
  g.add(blade);
  const blade2 = buildMarquee(mats, 'FLOPPER', 5.0, 1.7, '255,190,60');
  blade2.position.set(WID / 2 - 0.6, 5.4, 7.4);
  blade2.rotation.y = Math.PI / 2;
  g.add(blade2);

  /* a string of bulbs from the mast down to the bow, which is what
     actually sells a boat as lit up */
  const strings = [];
  {
    const bulbGeo = new THREE.SphereGeometry(0.1, 5, 4);
    const COLS = [0xff4a8a, 0x4ad0ff, 0xffd24a, 0x8aff6a];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const z = 6.0 - t * (LEN / 2 + 4.5);
        const sag = Math.sin(t * Math.PI) * 0.9;
        const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({
          color: COLS[i % 4], fog: false,
        }));
        m.position.set(side * (0.6 + t * (WID / 2 - 1.2)), 9.2 - t * 6.4 - sag, z);
        g.add(m);
        strings.push({ m, base: COLS[i % 4], phase: i + (side > 0 ? 2 : 0) });
      }
    }
  }

  /* ---------- THE PROPRIETOR ----------
     Life-size, in a gilt frame on the cabin front where you cannot miss
     him, with a plaque under it you can walk up and read. */
  const portrait = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshLambertMaterial({ map: flopperPortrait() })
  );
  portrait.position.set(0, 3.1, 3.94);
  /* A PlaneGeometry faces +Z, and +Z here is INTO the cabin — he was
     hanging with his back to the room, looking at a wall. The deck is
     forward of the cabin, so he has to face -Z. */
  portrait.rotation.y = Math.PI;
  g.add(portrait);
  const frameParts = [];
  for (const [fw, fh, fx, fy] of [[3.1, 0.24, 0, 4.52], [3.1, 0.24, 0, 1.68],
    [0.24, 3.1, -1.43, 3.1], [0.24, 3.1, 1.43, 3.1]]) {
    frameParts.push(tint(box(fw, fh, 0.16, 'planks', { pos: [fx, fy, 3.92] }), G(0xc39a2c)));
  }
  // a scrolled crest over the top of the frame
  frameParts.push(tint(box(1.2, 0.4, 0.2, 'planks', { pos: [0, 4.82, 3.92] }), G(0xd8b23a)));
  frameParts.push(tint(cyl(0.2, 0.2, 0.2, 8, 'goldDark', { pos: [0, 5.06, 3.92], rot: [Math.PI / 2, 0, 0] }), G(0xffd24a)));
  g.add(new THREE.Mesh(mergeGeos(frameParts), mats.opaque));

  // the brass plaque, which is the thing you actually interact with
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.62),
    new THREE.MeshBasicMaterial({
      map: buildSignTexture(['TIM GRADY FLOPPER', 'PROPRIETOR'], '#4a3410', '#ffd88a'),
      fog: false,
    })
  );
  plaque.position.set(0, 1.34, 3.95);
  plaque.rotation.y = Math.PI;
  g.add(plaque);
  // two picture lights on the frame
  const picLight = new THREE.PointLight(0xffd8a0, 1.8, 9, 2);
  picLight.position.set(0, 4.9, 4.6);
  g.add(picLight);

  /* where you stand to look at him — used for the walk-up prompt */
  g.userData.portrait = { x: 0, z: 5.6 };

  /* four slot machines, two to a side, all of them live */
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const s = buildSlot(rng, mats, i);
    const side = i < 2 ? -1 : 1;
    s.position.set(side * 2.9, 1.45, -1.0 + (i % 2) * 2.6);
    // they face inward across the carpet, so you play with your back to the rail
    s.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(s);
    slots.push(s);
  }
  g.userData.slots = slots;

  /* torches along the rail — the whole point of a sleazy boat is that it
     is lit like one */
  const flames = [];
  for (const [tx, tz] of [[-3.9, -9.4], [3.9, -9.4], [-4.4, -4.0], [4.4, -4.0],
    [-4.3, 1.6], [4.3, 1.6], [-4.0, 10.4], [4.0, 10.4]]) {
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

  const OFF = new THREE.Color(0x201018);
  const _c = new THREE.Color();
  g.userData.tick = (t, dt = 0.016) => {
    for (const f of flames) f.userData.tick?.(t, dt);
    for (const s of slots) s.userData.tick(t, dt);
    marquee.userData.tick(t);
    blade.userData.tick(t + 0.7);
    blade2.userData.tick(t + 1.4);
    picLight.intensity = 1.6 + Math.sin(t * 5.1) * 0.3;
    // the festoon runs the other way to the marquee, so they never sync up
    const step = Math.floor(t * 5);
    for (const b of strings) {
      const lit = ((b.phase + step) % 4) !== 0;
      b.m.material.color.copy(lit ? _c.setHex(b.base) : OFF);
    }
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
