/* ===========================================================
   bunker.js — the listening post under the island.

   A steel trapdoor set into the ground in one of four places,
   different every round, with a ladder down to a single concrete
   room. Whoever finds it gets the command table: a live count of
   who is still breathing, a holographic plot of the island with
   everybody on it, and the log of what the island has done to you
   so far.

   It is deliberately powerful and deliberately hard to keep — you
   have to walk there, you have to go down, and while you are down
   there you are not doing your work and nobody can see you.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, tint, blankUV } from '../lib/geo.js';
import { drawText, textWidth } from '../lib/bitfont.js';

const G = (n) => new THREE.Color(n);

/** The four places it might be. Chosen per round by the host. */
export const BUNKER_SPOTS = [
  { x: -96, z: -78, name: 'THE WEST SHOULDER' },
  { x: 104, z: -58, name: 'THE EAST RIDGE' },
  { x: 38, z: 92, name: 'THE SOUTH FLAT' },
  { x: -58, z: 108, name: 'THE PALM LINE' },
];

/* ---------- the hatch, above ground ---------- */
export function buildHatch(rng, mats) {
  const g = new THREE.Group();
  const P = [];
  const STEEL = G(0x6a7076), STEEL_D = G(0x454b50), RUST = G(0x7a4a2a);

  // a concrete collar set into the earth
  P.push(tint(cyl(1.9, 2.1, 0.5, 12, 'templeStone', { pos: [0, 0.1, 0] }), G(0x8d8770)));
  P.push(tint(cyl(1.55, 1.55, 0.3, 12, 'metal', { pos: [0, 0.32, 0] }), STEEL_D));

  // bolts round the rim
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    P.push(tint(cyl(0.09, 0.09, 0.12, 5, 'metal', {
      pos: [Math.cos(a) * 1.7, 0.38, Math.sin(a) * 1.7],
    }), RUST));
  }
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* the lid, on a hinge */
  const hinge = new THREE.Group();
  hinge.position.set(-1.45, 0.42, 0);
  const lidParts = [
    tint(cyl(1.45, 1.45, 0.16, 12, 'metal', { pos: [1.45, 0, 0] }), STEEL),
    tint(box(2.4, 0.08, 0.22, 'metal', { pos: [1.45, 0.12, 0] }), STEEL_D),
    tint(box(0.22, 0.08, 2.4, 'metal', { pos: [1.45, 0.12, 0] }), STEEL_D),
    // a wheel to turn it
    tint(cyl(0.5, 0.5, 0.1, 10, 'metal', { pos: [1.45, 0.22, 0] }), RUST),
    tint(cyl(0.12, 0.12, 0.18, 6, 'metal', { pos: [1.45, 0.3, 0] }), STEEL_D),
  ];
  hinge.add(new THREE.Mesh(mergeGeos(lidParts), mats.opaque));
  g.add(hinge);
  g.userData.hinge = hinge;

  // the dark of the shaft, only visible once it is open
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.BackSide, fog: false })
  );
  shaft.position.y = -1.4;
  g.add(shaft);

  // a lamp that only comes on when it is open
  const lamp = new THREE.PointLight(0x8fe6d0, 0, 8, 2);
  lamp.position.set(0, 0.6, 0);
  g.add(lamp);

  let open = 0;
  g.userData.setOpen = (on) => { g.userData.want = on ? 1 : 0; };
  g.userData.want = 0;
  g.userData.tick = (t, dt = 0.016) => {
    const want = g.userData.want;
    open += (want - open) * Math.min(1, dt * 4);
    hinge.rotation.z = -open * 2.1;
    lamp.intensity = open * 2.6;
  };
  return g;
}

/* ===========================================================
   THE ROOM
   Its own scene, like the temple — you go down, not through.
   =========================================================== */

/** A stencilled sign, painted rather than printed. */
function stencil(lines, fg = '#c8b06a', bg = '#2a2f31', w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = 'rgba(0,0,0,.25)';
  for (let i = 0; i < 140; i++) {
    x.fillRect((i * 37) % w, (i * 53) % h, 3 + (i % 4), 2 + (i % 2));
  }
  // a painted border, the way a stencil crew would have done it
  x.fillStyle = fg;
  x.globalAlpha = 0.45;
  x.fillRect(5, 5, w - 10, 2); x.fillRect(5, h - 7, w - 10, 2);
  x.fillRect(5, 5, 2, h - 10); x.fillRect(w - 7, 5, 2, h - 10);
  x.globalAlpha = 1;
  /* Lay the lines out from their real heights. The old formula advanced by
     eleven pixels a line regardless of scale, so a scale-2 heading
     (fourteen pixels tall) sat on top of the line under it and the sign
     came out as one illegible smear. */
  const scales = lines.map((_, i) => (i === 0 ? 5 : 3));
  const heights = scales.map((sc) => 7 * sc);
  const GAP = 9;
  const block = heights.reduce((a, b2) => a + b2, 0) + GAP * (lines.length - 1);
  let ly = Math.round((h - block) / 2);
  lines.forEach((l, i) => {
    // shrink anything that would run off the ends of the plate
    let sc = scales[i];
    while (sc > 1 && textWidth(l, sc, 1) > w - 20) sc--;
    drawText(x, l, {
      x: w / 2, y: ly, scale: sc, align: 'center', color: fg, shadow: false,
    });
    ly += heights[i] + GAP;
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildBunkerRoom(mats) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);
  scene.fog = new THREE.Fog(0x05070a, 6, 34);

  const P = [];
  /* Bright for concrete, because the room is lit by four bulbs and a
     hologram — a dark grey tint under that much darkness is a black box
     with a glow in it. These read as pale grey under the strip lights and
     drop to near black at the corners, which is what you want. */
  const CONC = G(0xa8adb2), CONC_D = G(0x7e858a), STEEL = G(0x9aa2a8);
  const W = 18, D = 14, H = 4.4;

  /* ---------- the shell ----------
     The walls used to be four enormous boxes. One atlas cell stretched
     across eighteen metres of concrete is a smear, which is exactly what
     they looked like. They are built out of panels now — the cell repeats
     at a sane size, each panel carries its own shade, and the seams
     between them do the work the texture could not. */
  const PANEL = 1.5;
  const panelShade = (i, j) => CONC.clone().multiplyScalar(
    0.80 + ((i * 7 + j * 13) % 11) / 40
  );

  // floor and ceiling, also panelled
  for (let i = 0; i < Math.ceil(W / PANEL); i++) {
    for (let j = 0; j < Math.ceil(D / PANEL); j++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      P.push(tint(box(PANEL - 0.04, 0.6, PANEL - 0.04, 'templeStone',
        { pos: [px, -0.3, pz] }), CONC_D.clone().multiplyScalar(0.85 + ((i + j) % 5) / 22)));
      P.push(tint(box(PANEL - 0.04, 0.6, PANEL - 0.04, 'templeStone',
        { pos: [px, H, pz] }), CONC_D.clone().multiplyScalar(0.7 + ((i * 3 + j) % 4) / 20)));
    }
  }
  // the four walls
  const rows = Math.ceil(H / PANEL);
  for (let r = 0; r < rows; r++) {
    const py = r * PANEL + PANEL / 2;
    const ph = Math.min(PANEL, H - r * PANEL) - 0.04;
    if (ph <= 0) continue;
    for (let i = 0; i < Math.ceil(W / PANEL); i++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      for (const pz of [-D / 2, D / 2]) {
        P.push(tint(box(PANEL - 0.04, ph, 0.6, 'templeStone',
          { pos: [px, py, pz] }), panelShade(i, r)));
      }
    }
    for (let j = 0; j < Math.ceil(D / PANEL); j++) {
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      for (const px of [-W / 2, W / 2]) {
        P.push(tint(box(0.6, ph, PANEL - 0.04, 'templeStone',
          { pos: [px, py, pz] }), panelShade(j + 3, r)));
      }
    }
  }
  /* Steel channel over every seam. Concrete panels alone still read as a
     grid of tiles; the channel is what makes it read as built. */
  for (let i = 1; i < Math.ceil(W / PANEL); i++) {
    const px = -W / 2 + i * PANEL;
    for (const pz of [-D / 2 + 0.28, D / 2 - 0.28]) {
      P.push(tint(box(0.1, H, 0.08, 'metal', { pos: [px, H / 2, pz] }), STEEL));
    }
  }
  /* The horizontal channels run in lengths, not as one eighteen-metre
     sliver. A quad that long and that thin picks a mip so coarse that the
     atlas cell collapses to a single texel of the whole sheet, and the
     strip comes out banded in colours from unrelated cells. */
  for (let r = 1; r < rows; r++) {
    const py = r * PANEL;
    const segs = Math.ceil(W / PANEL);
    for (const pz of [-D / 2 + 0.28, D / 2 - 0.28]) {
      for (let i = 0; i < segs; i++) {
        const px = -W / 2 + i * PANEL + PANEL / 2;
        P.push(tint(box(PANEL - 0.02, 0.08, 0.08, 'metal', { pos: [px, py, pz] }), STEEL));
      }
    }
    const dsegs = Math.ceil(D / PANEL);
    for (const px of [-W / 2 + 0.28, W / 2 - 0.28]) {
      for (let j = 0; j < dsegs; j++) {
        const pz = -D / 2 + j * PANEL + PANEL / 2;
        P.push(tint(box(0.08, 0.08, PANEL - 0.02, 'metal', { pos: [px, py, pz] }), STEEL));
      }
    }
  }
  // a skirting of rust where the damp got in, again in lengths
  for (const pz of [-D / 2 + 0.31, D / 2 - 0.31]) {
    for (let i = 0; i < Math.ceil(W / PANEL); i++) {
      const px = -W / 2 + i * PANEL + PANEL / 2;
      P.push(tint(box(PANEL - 0.02, 0.5, 0.06, 'metal', { pos: [px, 0.25, pz] }), G(0x5a4030)));
    }
  }
  for (const px of [-W / 2 + 0.31, W / 2 - 0.31]) {
    for (let j = 0; j < Math.ceil(D / PANEL); j++) {
      const pz = -D / 2 + j * PANEL + PANEL / 2;
      P.push(tint(box(0.06, 0.5, PANEL - 0.02, 'metal', { pos: [px, 0.25, pz] }), G(0x5a4030)));
    }
  }

  // ribs along the ceiling
  for (let i = -2; i <= 2; i++) {
    P.push(tint(box(W - 1, 0.3, 0.4, 'metal', { pos: [0, H - 0.4, i * 2.6] }), STEEL));
  }
  // conduit running the length of one wall, because a bunker is plumbing
  for (const [cy, cr] of [[H - 0.75, 0.11], [H - 1.05, 0.08]]) {
    for (let j = 0; j < 6; j++) {
      const pz = -(D - 1) / 2 + (D - 1) / 12 + j * (D - 1) / 6;
      P.push(tint(cyl(cr, cr, (D - 1) / 6 + 0.02, 6, 'metal', {
        pos: [-W / 2 + 0.75, cy, pz], rot: [Math.PI / 2, 0, 0],
      }), G(0x6a5a48)));
    }
  }
  for (let i = -2; i <= 2; i++) {
    P.push(tint(box(0.3, 0.5, 0.14, 'metal', { pos: [-W / 2 + 0.75, H - 0.6, i * 2.6] }), STEEL));
  }
  // a bank of dead lockers down one wall
  for (let i = 0; i < 5; i++) {
    P.push(tint(box(0.7, 2.2, 1.1, 'metal', { pos: [-W / 2 + 0.9, 1.1, -4 + i * 2.1] }), G(0x4a5054)));
    P.push(tint(box(0.06, 0.14, 0.9, 'metal', { pos: [-W / 2 + 1.28, 1.4, -4 + i * 2.1] }), G(0x8a9096)));
  }
  // crates and a fallen chair
  for (let i = 0; i < 6; i++) {
    const cx = 4 + (i % 3) * 1.3, cz = -5 + Math.floor(i / 3) * 1.4;
    P.push(tint(box(1.1, 1.0, 1.1, 'planks', { pos: [cx, 0.5, cz] }), G(0x6a5230)));
  }

  // the ladder down from the hatch
  for (let i = 0; i < 8; i++) {
    P.push(tint(box(0.9, 0.09, 0.09, 'metal', { pos: [0, 0.5 + i * 0.55, -D / 2 + 1.0] }), STEEL));
  }
  for (const sx of [-0.45, 0.45]) {
    P.push(tint(cyl(0.06, 0.06, 5, 6, 'metal', { pos: [sx, 2.4, -D / 2 + 1.0] }), STEEL));
  }
  scene.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* ---------- WHO BUILT IT ----------
     Somebody paid for this room, and they were never going to let you
     forget it. The branding is stencilled on the concrete and screen
     printed on everything that could hold a logo. */
  const signs = [];
  const putSign = (tex, w2, h2, pos, rotY) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w2, h2),
      new THREE.MeshBasicMaterial({ map: tex, fog: true })
    );
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.y = rotY;
    scene.add(m);
    signs.push(m);
    return m;
  };
  putSign(stencil(['SCHWAB', 'TECHNOLOGY'], '#d8bc72', '#33383a', 256, 128),
    5.0, 2.5, [0, 2.9, -D / 2 + 0.32], 0);
  putSign(stencil(['LISTENING POST', 'AUTHORISED HANDS ONLY'], '#c8b06a', '#2a2f31', 256, 96),
    3.8, 1.42, [-5.6, 2.4, -D / 2 + 0.32], 0);
  putSign(stencil(['A SCHWAB', 'INSTALLATION'], '#8aa6b0', '#242a2c', 256, 96),
    3.4, 1.28, [W / 2 - 0.32, 2.6, -3.2], -Math.PI / 2);
  putSign(stencil(['NO SMOKING', 'OXYGEN IN USE'], '#e0a84a', '#2e2622', 256, 80),
    2.6, 0.82, [-W / 2 + 0.32, 3.1, 3.6], Math.PI / 2);
  putSign(stencil(['PROPERTY OF', 'SCHWAB TECHNOLOGY LTD', 'REMOVAL IS THEFT'], '#9aa6ac', '#232729', 256, 112),
    3.4, 1.5, [0, 1.5, D / 2 - 0.32], Math.PI);
  // and on the table's own maker's plate
  putSign(stencil(['SCHWAB', 'MK IV COMMAND TABLE'], '#c8b06a', '#2f3538', 256, 96),
    1.15, 0.28, [0, 0.55, 3.06], 0);

  /* the command table: a low steel plinth with a glass top */
  const table = new THREE.Group();
  const tParts = [
    tint(box(4.6, 0.9, 3.0, 'metal', { pos: [0, 0.45, 0] }), G(0x3a4045)),
    tint(box(4.9, 0.14, 3.3, 'metal', { pos: [0, 0.95, 0] }), G(0x565c62)),
    tint(box(4.3, 0.06, 2.7, 'glass', { pos: [0, 1.04, 0] }), G(0x2a4a52)),
    // a maker's plate on the front skirt
    tint(box(1.2, 0.3, 0.06, 'metal', { pos: [0, 0.55, 1.53] }), G(0x8a7a4a)),
  ];
  table.add(new THREE.Mesh(mergeGeos(tParts), mats.opaque));
  table.position.set(0, 0, 1.5);
  scene.add(table);

  /* Switches you can watch working. They used to be nine dead cubes; now
     each throws when the table is being read, which is the difference
     between a prop and a machine. */
  const switches = [];
  const swGeo = new THREE.BoxGeometry(0.14, 0.22, 0.1);
  for (let i = 0; i < 9; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(-1.8 + i * 0.45, 1.06, 1.2);
    const m = new THREE.Mesh(swGeo, new THREE.MeshLambertMaterial({
      color: i % 3 === 0 ? 0xc02a1a : 0x8a9096,
    }));
    m.position.y = 0.09;
    pivot.add(m);
    table.add(pivot);
    switches.push({ pivot, phase: i * 0.7 });
  }
  // a row of indicator lamps along the back edge
  const lamps = [];
  const lampGeo = new THREE.SphereGeometry(0.055, 5, 4);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x1a2a24, fog: false }));
    m.position.set(-2.0 + i * 0.36, 1.09, -1.2);
    table.add(m);
    lamps.push({ m, phase: i });
  }

  /* the hologram over it: a wireframe island that turns */
  const holo = new THREE.Group();
  holo.position.set(0, 1.9, 1.5);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x6fd0e0, transparent: true, opacity: 0.5, fog: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 4; i++) {
    const r = 0.5 + i * 0.42;
    const rg = new THREE.RingGeometry(r, r + 0.03, 30, 1);
    rg.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rg, ringMat);
    ring.position.y = i * 0.06;
    holo.add(ring);
  }
  // a cone of light rising off the glass
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(1.9, 1.5, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x6fd0e0, transparent: true, opacity: 0.025, fog: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  cone.position.y = -0.6;
  cone.renderOrder = -1;               // behind the plot, never over it
  holo.add(cone);
  scene.add(holo);

  /* The half of the island the last sabotage came from, drawn in the air
     as a red wedge over the plot. It turns with the hologram, so you have
     to read it against the compass ring rather than the room. */
  const wedgeMat = new THREE.MeshBasicMaterial({
    color: 0xff3a24, transparent: true, opacity: 0.16, fog: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const wedgeGeo = new THREE.CircleGeometry(1.8, 18, 0, Math.PI);
  wedgeGeo.rotateX(-Math.PI / 2);
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.position.y = 0.02;
  wedge.visible = false;
  holo.add(wedge);

  // a compass ring that does NOT turn, so north stays north
  const compass = new THREE.Group();
  compass.position.copy(holo.position);
  {
    const cg = new THREE.RingGeometry(1.86, 1.94, 40, 1);
    cg.rotateX(-Math.PI / 2);
    compass.add(new THREE.Mesh(cg, new THREE.MeshBasicMaterial({
      color: 0x9fe0f0, transparent: true, opacity: 0.35, fog: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.02, 0.24),
        new THREE.MeshBasicMaterial({ color: 0xc8f4ff, fog: false })
      );
      tick.position.set(Math.sin(a) * 2.02, 0, Math.cos(a) * 2.02);
      tick.rotation.y = a;
      compass.add(tick);
    }
  }
  scene.add(compass);

  // the pips that stand for people, made on demand
  const pipGeo = new THREE.BoxGeometry(0.11, 0.34, 0.11);
  const pips = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(pipGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    m.visible = false;
    holo.add(m);
    pips.push(m);
  }

  /* ---------- lighting ----------
     Four tubes down the spine, one of which is on its way out, plus the
     glow off the table. The room used to be lit by a single point light
     at a fifth of the strength it needed and read as a black hole with a
     hologram floating in it. */
  const tubes = [];
  for (let i = 0; i < 4; i++) {
    const tz = -D / 2 + 2.2 + i * ((D - 4.4) / 3);
    const L = new THREE.PointLight(0xcfe4ec, 2.6, 26, 1.5);
    L.position.set(0, H - 0.85, tz);
    scene.add(L);
    // the fitting it hangs in, so the light has a source you can see
    const fit = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.12, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xdff0f6, fog: false })
    );
    fit.position.set(0, H - 0.72, tz);
    scene.add(fit);
    tubes.push({ L, fit, bad: i === 2, phase: i * 1.7 });
  }
  const strip = tubes[0].L;
  const tableGlow = new THREE.PointLight(0x6fd0e0, 2.6, 14, 1.7);
  tableGlow.position.set(0, 1.6, 1.5);
  scene.add(tableGlow);
  scene.add(new THREE.AmbientLight(0x8fa2ae, 1.05));
  // a little bounce off the floor so nothing below waist height is a void
  const floorFill = new THREE.HemisphereLight(0xbfd4de, 0x2a3034, 0.9);
  scene.add(floorFill);
  // one red bulb over the ladder that never stopped turning
  const beacon = new THREE.PointLight(0xff3a24, 0.9, 10, 2);
  beacon.position.set(0, H - 1.0, -D / 2 + 1.4);
  scene.add(beacon);

  const HALF_YAW = { NORTH: Math.PI, EAST: -Math.PI / 2, SOUTH: 0, WEST: Math.PI / 2 };
  const LAMP_ON = new THREE.Color(0x6fe0b8), LAMP_OFF = new THREE.Color(0x1a2a24);

  scene.userData.table = table;
  scene.userData.holo = holo;
  scene.userData.pips = pips;
  /**
   * @param {object[]} roster  who is where
   * @param {string|null} half  which half the last sabotage came from
   * @param {boolean} reading   somebody is at the table right now
   */
  scene.userData.tick = (t, dt = 0.016, roster = null, half = null, reading = false) => {
    holo.rotation.y = t * 0.32;
    const flick = 0.85 + Math.sin(t * 9) * 0.1 + (Math.sin(t * 41) > 0.95 ? -0.35 : 0);
    ringMat.opacity = 0.42 * flick;
    tableGlow.intensity = (reading ? 3.6 : 2.6) * flick;
    for (const tb of tubes) {
      // one of them has been failing for thirty years and never quite goes
      const k = tb.bad
        ? (Math.sin(t * 23 + tb.phase) > 0.2 ? 1 : 0.15)
        : (Math.sin(t * 31 + tb.phase) > 0.97 ? 0.45 : 1);
      tb.L.intensity = 2.6 * k;
      tb.fit.material.color.setScalar(0.35 + k * 0.65);
    }
    beacon.intensity = 0.55 + Math.abs(Math.sin(t * 1.4)) * 0.75;

    // the switches work while somebody is reading, and rest when nobody is
    for (const sw of switches) {
      const want = reading ? Math.sin(t * 2.2 + sw.phase) * 0.5 : 0;
      sw.pivot.rotation.x += (want - sw.pivot.rotation.x) * Math.min(1, dt * 6);
    }
    // and the lamps run a chase
    const step = Math.floor(t * (reading ? 9 : 3));
    for (const L of lamps) {
      L.m.material.color.copy(((L.phase + step) % 5) === 0 ? LAMP_ON : LAMP_OFF);
    }

    // the sabotage wedge
    if (half && HALF_YAW[half] !== undefined) {
      wedge.visible = true;
      wedge.rotation.y = HALF_YAW[half] - holo.rotation.y;
      wedgeMat.opacity = 0.10 + Math.abs(Math.sin(t * 2.6)) * 0.13;
    } else {
      wedge.visible = false;
    }

    // living players plotted on the island, dead ones lying flat
    if (roster) {
      roster.forEach((p, i) => {
        const m = pips[i];
        if (!m) return;
        m.visible = true;
        m.material.color.setHex(p.colour);
        const k = 1 / 190;                    // island radius -> table radius
        m.position.set(p.x * k * 1.7, p.alive ? 0.22 : 0.03, p.z * k * 1.7);
        m.scale.set(1, p.alive ? 1 : 0.25, 1);
        m.material.opacity = p.alive ? 0.95 : 0.4;
      });
      for (let i = roster.length; i < pips.length; i++) pips[i].visible = false;
    }
  };
  return scene;
}

/** Where you stand when you climb down. */
export const BUNKER_ENTRY = { x: 0, y: 1.0, z: -5.2 };
export const BUNKER_TABLE = { x: 0, z: 1.5 };
export const BUNKER_BOX = { minX: -8.4, maxX: 8.4, minZ: -6.4, maxZ: 6.4 };
export function bunkerHeight() { return 0; }
