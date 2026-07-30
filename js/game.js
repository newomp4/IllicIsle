/* ===========================================================
   game.js — the whole adventure, wired together.
   =========================================================== */

import * as THREE from 'three';
import { RetroPipeline, setJitterEnabled, setTime } from './lib/ps1.js';
import { buildAtlas, makeRng, buildSignTexture } from './lib/textures.js';
import { mergeGeos, tint, plane, box, cyl, ico, lumpify, blankUV } from './lib/geo.js';
import { GameAudio } from './lib/audio.js';
import { Cutscene, setCinemaBars, attachHud } from './lib/cutscene.js';
import { UI } from './ui.js';
import { ScreenStack, GLYPH_NAMES } from './lib/screens.js';

import {
  buildTerrain, buildOcean, buildSurf, buildSky, buildClouds,
  heightAt, slopeAt, biomeAt, findBeach, ISLAND, setCarves,
} from './world/terrain.js';
import {
  buildPropMaterials, scatterIsland, LANDMARKS, findGround, findFlatGround, buildDirtPath,
  buildShipwreck, buildCampfire, buildCastawayCamp, buildSandWriting,
  buildRoguePendulum, buildCoconutPile, buildCoconutMesh, buildSatchel,
  buildBirdFlock, buildCritters, buildFlameCluster, GLYPHS,
} from './world/props.js';
import {
  buildSyncoin, buildRelic, buildFerdiHut, buildBeacon, buildStorm, buildTikiTorch,
  buildIntroStage,
} from './world/extras.js';
import { buildIdolMaterials, buildIdol, buildIdolShrine } from './world/idol.js';
import { buildTemple, templeHeight, TEMPLE } from './world/temple.js';
import { buildCasinoBoat, buildBoatBridge, buildVendingMachine } from './world/casino.js';
import {
  BUNKER_SPOTS, buildHatch, buildBunkerRoom, BUNKER_ENTRY, BUNKER_BOX, bunkerHeight,
} from './world/bunker.js';
import {
  buildHighRoller, HR_ENTRY, HR_BOX, HR_COLLIDERS, hrHeight, HR_BAR_DOOR, HR_BAR_RETURN,
} from './world/highroller.js';
import {
  buildBar, BAR_ENTRY, BAR_BOX, BAR_COLLIDERS, barHeight, BAR_KEEP, BAR_OCHE, BAR_BOARD,
} from './world/bar.js';
import { buildCathy, CATHY_SPOTS } from './world/cathy.js';
import { buildX, X_SPOTS, DIG_SECONDS, goodXSpot } from './world/treasure.js';
import { FOOD, itemById } from './mp/market.js';
import { Player } from './entities/player.js';
import { Hector } from './entities/boss.js';

/* ===========================================================
   STORY
   ===========================================================
   Four Rogue Pendulums stand in the jungle. Each carries a glyph
   and a position in the sequence. Read all four, then set the
   temple door's sockets to match.
*/
export const PENDULUMS = [
  {
    id: 0, place: 'pend2', order: 1, glyph: 'EYE',
    title: 'PENDULUM I — THE LONG COUNT',
    hint: 'North, high on the ridge, where the trees give up.',
    text:
`ROGUE PENDULUM 01 — "THE LONG COUNT"
Installed by the Rogue Agents. Do not stop it.

The bob has not stopped in four hundred years and
nobody who works here knows what it is counting
down to.

Struck into the plate beneath the slot:
    POSITION  I
    GLYPH     THE EYE`,
  },
  {
    id: 1, place: 'pend3', order: 2, glyph: 'SPIRAL',
    title: 'PENDULUM II — THE DROWNED BELL',
    hint: 'East, past the lagoon, where the ground goes soft.',
    text:
`ROGUE PENDULUM 02 — "THE DROWNED BELL"

Half sunk. Still swinging. When the water is high
it rings against its own housing, once, and the
birds go quiet for a full minute afterwards.

    POSITION  II
    GLYPH     THE SPIRAL`,
  },
  {
    id: 2, place: 'pend1', order: 3, glyph: 'SUN',
    title: 'PENDULUM III — THE LISTENING POST',
    hint: 'West, deep in, under the heaviest canopy on the island.',
    text:
`ROGUE PENDULUM 03 — "THE LISTENING POST"

There is a chair bolted to the inside of this one.
Somebody sat here a long time. There are eleven
years of tally marks on the door frame and then
they stop.

    POSITION  III
    GLYPH     THE SUN`,
  },
  {
    id: 3, place: 'pend4', order: 4, glyph: 'MOON',
    title: 'PENDULUM IV — THE LAST TRANSMISSION',
    hint: 'Northwest, the far shoulder, where nothing grows straight.',
    text:
`ROGUE PENDULUM 04 — "THE LAST TRANSMISSION"

Scratched into the basalt, recent, by hand:

  "we were never supposed to find the idol
   we were supposed to make sure nobody else did
   i am sorry about the door
   set them in order and it opens
   - R.A."

    POSITION  IV
    GLYPH     THE MOON`,
  },
];

/** Left-to-right solution for the temple door. */
export const DOOR_CODE = ['EYE', 'SPIRAL', 'SUN', 'MOON'];

/* ---------- easter eggs ---------- */
export const RELICS = {
  syncoin: {
    title: 'THE FIRST SYNCOIN',
    text:
`A coin, heavier than it has any right to be.
One face is worn smooth. The other still reads:

        SYNERGY HOLDINGS
        ISLA SYN — COMPANY SCRIP
        NOT LEGAL TENDER ASHORE

Before King Illic, before the Rogue Agents, a
corporation owned this island outright and paid
the people who dug here in its own money.

Nobody has ever explained where they went. The
coins keep turning up.`,
  },
  tasha: {
    title: 'THE REMAINS OF TASHA',
    text:
`Something mechanical, and shaped like a woman,
lying where she fell.

A plate on her collar reads TASHA — UNIT 03.
Her optic still flickers about once a minute,
which is worse than if it didn't.

Scratched into her forearm, by hand, not by
machine:

        "i asked to stay"`,
  },
  aerlingus: {
    title: 'AER LINGUS FLIGHT DEBRIS',
    text:
`Twelve feet of green and white fuselage, folded
into the sand like a dropped can.

The shamrock is still perfectly legible. The
windows are intact. There is no other wreckage
anywhere on this island, no engines, no wings,
no seats.

Just this piece. Facing inland.`,
  },
  watermelon: {
    title: "HECTOR'S WATERMELON",
    text:
`Tucked into the corner of the temple, behind a
column, entirely alone: one watermelon.

A note is propped against it in careful capitals:

        PROPERTY OF HECTOR
        DO NOT EAT
        THIS IS FOR MY LAYER

He has written LAYER. He has underlined LAYER.
Somebody, at some point, has corrected it to
LAIR in a different hand, and Hector has crossed
that out and written LAYER again, larger.`,
  },
};

/* ---------- Ferdi's stock ---------- */
export const SHOP = [
  { id: 'heart',  name: 'A SPARE HEART',      cost: 4, desc: 'One more heart. No questions.' },
  { id: 'satchel', name: 'BIGGER SATCHEL',    cost: 3, desc: 'Carry 14 coconuts instead of 8.' },
  { id: 'boots',  name: "STURDY BOOTS",       cost: 3, desc: 'Sprint harder, tire slower.' },
];

const JOURNAL_INTRO = {
  title: 'THE CASTAWAY\'S JOURNAL',
  text:
`Day one.

The storm took the ship, the crew, and most of my
good sense. It did not take the reason I came.

Somewhere on this island is the Idol of King
Illic, and the Idol is the King: the Rogue Agents
poured what was left of him into gold and buried
it under his own temple.

There are others here. There were, anyway.`,
};

const LETTER = {
  title: 'A LETTER FROM THE ROGUE AGENTS',
  text:
`To whoever gets this far —

We are the Rogue Agents. We were posted to Isla
Dorada to keep the Idol lost. We built four
Pendulums to mark the way in, and then we sealed
the way in, and then we could not get back out.

There are only two things on this island that will
get you off it: the Idol of King Illic, and the
man who is sitting on it.

The chart is enclosed. Four Pendulums, four glyphs,
four positions. Read all four and the temple door
will take the order.

Do not eat anything he offers you.

                                        - R.A.`,
};

/* ===========================================================
   GAME
   =========================================================== */
/**
 * Where the easter-egg relics live. Declared up here because the jungle is
 * scattered before they are placed, and it has to leave them room.
 */
/** Where Ferdi's two outlying machines stand. */
const VENDOR_SPOTS = [{ x: 92, z: -74 }, { x: -118, z: 8 }];

const RELIC_SPOTS = [
  { x: -140, z: -20 },     // TASHA Unit 03
  { x: 108, z: 118 },      // the Aer Lingus fuselage
  { x: -86, z: 95 },       // the First Syncoin's cairn
];

/**
 * Standing on things the terrain knows nothing about.
 *
 * The ground function is analytic and only describes the island, so a boat
 * deck or a bridge is scenery you fall through. A platform is a rotated
 * rectangle at a fixed height; the ground under you becomes the highest
 * platform you are inside and standing above, or the terrain.
 */
/**
 * Show or hide a group WITHOUT hiding any light inside it.
 *
 * three skips an invisible object's whole subtree, so a hidden group's
 * lights stop counting — and the number of lights is baked into every
 * shader's cache key. Revealing a group with a lamp in it therefore makes
 * three recompile every material in the scene, which is a second or more
 * of nothing at all. The lights stay visible and present for the whole
 * session; only their intensity moves.
 *
 * @param {THREE.Object3D} node
 * @param {boolean} hidden
 */
export function setHidden(node, hidden) {
  if (!node) return;
  node.visible = true;                       // the group itself never hides
  for (const child of node.children) {
    if (child.isLight) {
      if (hidden) {
        if (child.userData._lit === undefined) child.userData._lit = child.intensity;
        child.intensity = 0;
      } else if (child.userData._lit !== undefined) {
        child.intensity = child.userData._lit;
      }
      continue;
    }
    if (child.children.length) setHidden(child, hidden);
    else child.visible = !hidden;
  }
  node.userData.hidden = hidden;
}

export function makeGroundWith(platforms, base) {
  if (!platforms || !platforms.length) return base;
  return (x, z, y) => {
    let h = base(x, z);
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const dx = x - p.x, dz = z - p.z;
      const lx = dx * p.cos - dz * p.sin;
      const lz = dx * p.sin + dz * p.cos;
      if (Math.abs(lx) > p.hw || Math.abs(lz) > p.hd) continue;
      // only if you are at or above it; you cannot stand on the underside
      if (y !== undefined && y < p.y - 0.6) continue;
      if (p.y > h) h = p.y;
    }
    return h;
  };
}

/** The footprint one of Ferdi's machines needs to stand on. */
const VENDOR_FOOT = [
  [-1.05, -0.65], [1.05, -0.65], [-1.05, 0.65], [1.05, 0.65], [0, 0],
];

/** The footprint Ferdi's hut actually occupies, in its own space. */
const HUT_FOOT = [
  [-3.2, -2.8], [3.2, -2.8], [-3.2, 2.6], [3.2, 2.6],
  [-2.9, 5.0], [2.9, 5.0], [-2.9, 7.6], [2.9, 7.6], [0, 0],
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.state = 'boot';   // boot|title|intro|island|temple|dead|ending
    this.paused = false;

    this.settings = {
      res: 224, jitter: true, crt: true, density: 1, audio: true,
      sens: 1.4, invert: false,
    };
    this.loadSettings();

    this.audio = new GameAudio();
    this.ui = new UI(this.audio);
    this.screens = new ScreenStack(this);
    this.ui.screens = this.screens;
    attachHud(this.ui.hud);

    this.input = { fwd: false, back: false, left: false, right: false, sprint: false, jump: false };
    this.mouse = { locked: false };

    this.coconuts = [];
    this.found = new Set();       // pendulum ids read
    this.hasChart = false;
    this.dialState = [0, 0, 0, 0];
    this.dialSel = 0;
    this.doorSolved = false;
    this.coins = 0;
    this.relics = new Set();
    this.bought = new Set();
    this.coconutMax = 8;
    /* Speedrun clock. Only advances while you actually have control, so
       cutscenes, menus, the chart and the reader are all excluded. */
    this.runTime = 0;
    /* Day/night: 2 minutes light, 2 minutes dark, with a short dawn and
       dusk either side so it doesn't snap. */
    this.clock24 = 0;
    /* Six minutes round the clock: about two and a quarter minutes of day,
       a bit over three of night, and twenty seconds of dusk and dawn either
       side of them. The old cycle was four minutes flat and the night was
       gone before you had walked anywhere in it. */
    this.DAY_LEN = 360;
    this.night = 0;
    this.stats = { deaths: 0, thrown: 0, hits: 0 };

    this._initRenderer();
    this._bindEvents();
  }

  /* ---------- settings ---------- */
  loadSettings() {
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('illicisle.settings') || '{}')); }
    catch (e) { /* first run */ }
  }
  saveSettings() {
    try { localStorage.setItem('illicisle.settings', JSON.stringify(this.settings)); }
    catch (e) { /* private mode */ }
  }

  /* ---------- renderer ---------- */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: false,
      powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);

    this.pipeline = new RetroPipeline(this.renderer, this.settings.res);
    this.pipeline.setCRT(this.settings.crt);
    this.pipeline.setHudCanvas(this.ui.hud.c);
    setJitterEnabled(this.settings.jitter);

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.35, 460);
    this._resize();

    /* Resize arrives as a storm of events during a window drag, and each
       one used to reallocate the framebuffer. Coalesce them into the next
       animation frame so at most one resize happens per drawn frame, and
       watch the canvas itself as well as the window so a layout change
       (devtools opening, a panel appearing) is caught too. */
    const schedule = () => {
      if (this._resizePending) return;
      this._resizePending = true;
      requestAnimationFrame(() => { this._resizePending = false; this._resize(); });
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(schedule);
      this._ro.observe(this.canvas);
    }
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || window.innerWidth));
    const h = Math.max(1, Math.round(r.height || window.innerHeight));
    if (this._lastW === w && this._lastH === h) return;
    this._lastW = w; this._lastH = h;
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    /* Match the interface canvas here rather than waiting for render(). On a
       slow frame that left the HUD at the old size for as long as the frame
       took, which is what made the interface look stretched for a moment
       after every resize. */
    const int = this.pipeline.internal;
    if (int) this.ui?.hud?.setSize(int.w, int.h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    /* The title diorama has its own camera; without this it keeps the old
       aspect until you happen to open a menu. */
    if (this.titleCam) {
      this.titleCam.aspect = this.camera.aspect;
      this.titleCam.updateProjectionMatrix();
    }
  }

  applySettings() {
    this._lastW = this._lastH = -1;          // force the next _resize through
    this.pipeline.setBaseHeight(this.settings.res);
    this.pipeline.setCRT(this.settings.crt);
    setJitterEnabled(this.settings.jitter);
    this.audio.setEnabled(this.settings.audio);
    if (this.player) {
      this.player.sensitivity = this.settings.sens;
      this.player.invertY = this.settings.invert;
    }
    this.saveSettings();
  }

  /* ===========================================================
     LOADING
     =========================================================== */
  async load(onProgress) {
    const step = async (label, frac, fn) => {
      onProgress(frac, label);
      await new Promise((r) => setTimeout(r, 16));
      return fn();
    };

    await step('GENERATING TEXTURES', 0.06, () => {
      this.atlas = buildAtlas();
      this.propMats = buildPropMaterials(this.atlas);
      this.idolMats = buildIdolMaterials(this.atlas);
    });

    await step('RAISING ISLA DORADA', 0.18, () => {
      /* The temple site is chosen against the natural hill, then the hill
         is excavated around it, and only then is the mesh built — so the
         ground, the collision and everything planted later all agree. */
      this.templeDoorPos = this._findTempleSpot();
      const dg = this.templeDoorPos;
      const yaw = Math.atan2(dg.x - ISLAND.ridge.x, dg.z - ISLAND.ridge.z);
      /* Not a flat disc. A flat disc levelled the ground BEHIND the temple
         too, so the hill fell away and the terrace stack stood in mid-air
         with nothing at its back. The profile is a plaza in front at the
         height of the threshold, rising behind at the same pitch as the
         terraces so the hillside meets the top course. */
      const THRESH = dg.y + 0.10;          // top of the doorway's threshold slab
      /* Ferdi's clearing is levelled, so the shack can stand in the middle
         of it instead of being pushed up onto the shoulder of the hill
         looking for somewhere flat enough. */
      const FX = -30, FZ = 46;
      const FY = heightAt(FX, FZ);
      /* Every hatch gets its own level apron. A steel collar two metres
         across, dropped onto a hillside, buries its uphill lip and leaves
         the downhill one hanging in the air — you were looking at half a
         manhole. Carving the pad means the mesh, the collision and the
         hatch all agree on one height. */
      const hatchPads = BUNKER_SPOTS.map((sp) => ({
        x: sp.x, z: sp.z, rx: 5.5, rz: 5.5, yaw: 0, y: heightAt(sp.x, sp.z),
      }));
      /* Cathy's pitch, chosen now rather than later so her ground can be
         levelled before the mesh is built.

         Sinking her to the lowest point under her footprint — the rule for
         anything with a base — put her standing in a dip with the sand up to
         her waist on the uphill side, and left you looking down on the top of
         her head from six metres away. A person is not a crate: she needs
         flat ground, so she gets a level pad of her own like Ferdi's
         clearing and every hatch. */
      {
        const crng = makeRng(4242);
        const sp = CATHY_SPOTS[(crng() * CATHY_SPOTS.length) | 0];
        this.cathyPad = { x: sp.x, z: sp.z, y: heightAt(sp.x, sp.z), name: sp.name };
        hatchPads.push({ x: sp.x, z: sp.z, rx: 10, rz: 10, yaw: 0, y: this.cathyPad.y });
        /* And the X, for the same reason: it has to be chosen before the
           jungle is planted so nothing grows through it, and its ground has
           to be level or the chest comes up out of a slope. */
        const xrng = makeRng(9119);
        // only the ones that are low, flat and dry this time round
        const good = X_SPOTS.filter((q) => goodXSpot(heightAt, q.x, q.z));
        const pool = good.length ? good : X_SPOTS;
        const xp = pool[(xrng() * pool.length) | 0];
        this.xPad = { x: xp.x, z: xp.z, y: heightAt(xp.x, xp.z) };
        hatchPads.push({ x: xp.x, z: xp.z, rx: 7, rz: 7, yaw: 0, y: this.xPad.y });
      }
      setCarves([...hatchPads, {
        x: FX, z: FZ, rx: 21, rz: 21, yaw: 0, y: FY,
      }, {
        x: dg.x, z: dg.z, rx: 25, rz: 27, yaw,
        h: (lx, lz) => {
          const into = Math.max(0, -lz);   // 0 at the doorway, grows into the hill
          const shoulder = Math.max(0, Math.abs(lx) - 9) * 0.35;
          return THRESH + Math.min(14.5, into * 0.80) + shoulder;
        },
      }]);
      this._buildIslandScene();
    });

    await step('PLANTING THE JUNGLE', 0.42, () => {
      this.colliders = [];
      const clearZones = Object.keys(LANDMARKS).map((k) => ({
        x: LANDMARKS[k].x, z: LANDMARKS[k].z, r: 18,
      }));
      /* The camp is derived from the wreck and sits well inland of it, so
         the wreck's own clearing has to reach far enough to cover the fire
         everyone spawns around. A bonfire behind a tree trunk is no use to
         anybody. */
      clearZones.push({ x: LANDMARKS.wreck.x, z: LANDMARKS.wreck.z, r: 30 });
      clearZones.push({ x: this.templeDoorPos.x, z: this.templeDoorPos.z, r: 30 });
      clearZones.push({ x: -30, z: 46, r: 24 });   // Ferdi's clearing
      /* A wide clearing at every place Cathy might set up. Sixteen metres
         left a palm standing directly behind her head from the only angle you
         ever approach her stall from. */
      for (const c of CATHY_SPOTS) clearZones.push({ x: c.x, z: c.z, r: 24 });
      // and nothing grows over the X
      if (this.xPad) clearZones.push({ x: this.xPad.x, z: this.xPad.z, r: 9 });
      /* Every place a chore happens needs a clearing. TASHA sat inside a
         thicket you could walk past three times without seeing her, which
         is not a puzzle, it is a bad map. */
      for (const z of RELIC_SPOTS) clearZones.push({ x: z.x, z: z.z, r: 17 });
      for (const z of VENDOR_SPOTS) clearZones.push({ x: z.x, z: z.z, r: 12 });
      for (const z of BUNKER_SPOTS) clearZones.push({ x: z.x, z: z.z, r: 13 });

      /* Trodden paths between the places people actually go, and the jungle
         is kept off them — a path with a tree standing in it is not a path.
         They are the difference between an island you learn and an island
         you get lost in. */
      this.paths = [];
      /* The camp is derived from the wreck, and neither exists yet — the
         jungle is scattered before the landmarks are placed — so the routes
         are drawn between the fixed points the landmarks are found near. */
      const FERDI = { x: -30, z: 46 };
      const routes = [
        [LANDMARKS.wreck, FERDI],
        [FERDI, this.templeDoorPos],
        [LANDMARKS.wreck, LANDMARKS.lagoon],
        [FERDI, LANDMARKS.pend1],
        [FERDI, LANDMARKS.rogueSand],
      ];
      for (const [a, b] of routes) {
        if (!a || !b) continue;
        const path = buildDirtPath(a.x, a.z, b.x, b.z, this.propMats, this.atlas,
          { rng: makeRng(7717 + this.paths.length * 13), width: 6.4, wobble: 8 });
        this.islandScene.add(path);
        this.paths.push(path);
        for (const p of path.userData.line) clearZones.push({ x: p.x, z: p.z, r: 3.4 });
      }
      scatterIsland(this.islandScene, this.propMats, makeRng(2468),
        this.settings.density, this.colliders, clearZones);
    });

    await step('RAISING THE PENDULUMS', 0.62, () => this._buildLandmarks());

    await step('OPENING THE TEMPLE', 0.78, () => {
      this.templeScene = buildTemple(this.idolMats, this.propMats);
      this._buildSanctum();
      this.bunkerScene = buildBunkerRoom(this.propMats);
      /* The room behind Tim Grady's portrait. Built at load like the temple
         and the listening post, so walking through the frame is instant and
         its shaders are warmed with everything else. */
      this.hrScene = buildHighRoller(this.propMats, buildFlameCluster);
      /* And the bar behind it. Built at load with everything else so the
         door is instant and its shaders are warmed in the same pass. */
      this.barScene = buildBar(this.propMats, buildFlameCluster);
    });

    await step('CASTING THE IDOL', 0.90, () => {
      this._buildTitleScene();
      // the Idol itself, standing on the plinth in the opening's pour scene
      const st = this.introStage;
      const shrine = buildIdol(this.idolMats, { curls: 66, seed: 12 });
      shrine.position.set(0, 1.5, 0);
      shrine.scale.setScalar(1.35);
      st.userData.idolSet.add(shrine);
      st.userData.idol = shrine;
    });

    await step('MEASURING THE DECKS', 0.94, () => {
      // everything walkable that the height function does not know about
      this.groundOf = makeGroundWith(this.platforms, heightAt);
    });

    await step('WARMING THE PIPES', 0.96, () => {
      /* Compile every shader the game will ever need, now, while the
         loading bar is up. The first draw of a material configuration
         compiles its program, and a compile mid-round is exactly the
         one-second freeze that has no obvious cause.

         Two things this has to get right that the obvious version does
         not. renderer.compile() walks the scene graph and SKIPS anything
         with visible === false, so every pooled effect, every hidden
         hatch and the boombox — all the things that appear for the first
         time in the middle of a round — were missed by it. And the light
         count is baked into every program's cache key, so the scene has
         to be holding all of its lights before anything is compiled. */
      const revealed = [];
      const showAll = (root) => {
        root.traverse((o) => {
          if (o.visible === false) { o.visible = true; revealed.push(o); }
        });
      };
      try {
        /* The one light that is created on demand. It lives here from now
           on with its intensity at zero, so numPointLights never changes
           and nothing ever has to be recompiled because of it. */
        this._lanternLight = new THREE.PointLight(0xffc070, 0, 20, 1.7);
        this._lanternLight.position.set(0, 4, 0);
        this.islandScene.add(this._lanternLight);

        for (const sc of [this.islandScene, this.templeScene, this.bunkerScene,
          this.hrScene, this.barScene, this.titleScene]) {
          if (!sc) continue;
          showAll(sc);
          this.renderer.compile(sc, this.camera);
        }
      } catch (e) { /* a warm-up that fails is not worth failing the load over */ }
      for (const o of revealed) o.visible = false;
    });

    await step('READY', 1.0, () => {
      this.player = new Player(this.islandScene, this.propMats, this.camera);
      this.player.setColliders(this.colliders);
      this.player.bounds = ISLAND.playRadius;
      this.player.sensitivity = this.settings.sens;
      this.player.invertY = this.settings.invert;
      this.player.onFootstep = (b) => this.audio.sfx(
        `step_${b === 'water' ? 'water' : b === 'sand' ? 'sand' : b === 'rock' ? 'rock' : 'jungle'}`);
      this.player.onJump = () => this.audio.sfx('jump');
      this.player.onLand = (v) => { if (v > 11) this.audio.sfx('land'); };
      this.player.onBounds = () => this._boundsWarn();
      this.coconutProto = buildCoconutMesh(this.propMats);
    });
  }

  /* ===========================================================
     ISLAND
     =========================================================== */
  _buildIslandScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fc4dd);
    // Tight enough that the jungle feels enclosed, open enough to see surf.
    scene.fog = new THREE.Fog(0xb4d0d4, 46, 235);

    this.ambient = new THREE.AmbientLight(0x9cb8c4, 1.05);
    scene.add(this.ambient);
    const sun = new THREE.DirectionalLight(0xfff0cf, 1.45);
    sun.position.set(-60, 90, 40);
    scene.add(sun);
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0xcfe8f5, 0x4a5a28, 0.75);
    scene.add(this.hemi);

    this.terrain = buildTerrain(this.atlas);
    scene.add(this.terrain);

    this.ocean = buildOcean();
    scene.add(this.ocean);

    this.surf = buildSurf();
    scene.add(this.surf);

    this.sky = buildSky('#2f74ab', '#93c8de', '#f6dfae');
    scene.add(this.sky);

    this.clouds = buildClouds(makeRng(31));
    scene.add(this.clouds);

    this.birds = buildBirdFlock(makeRng(77), this.propMats, 22);
    scene.add(this.birds);

    this.critters = buildCritters(makeRng(88), this.propMats, heightAt, 26);
    scene.add(this.critters);

    // a pocket set for the opening, parked far below the island
    this.introStage = buildIntroStage(makeRng(303), this.propMats, buildFlameCluster);
    this.introStage.visible = false;
    scene.add(this.introStage);

    this.islandScene = scene;
  }

  _buildLandmarks() {
    const scene = this.islandScene;
    const rng = makeRng(555);
    this.interactables = [];
    this.tickers = [];

    /* ---- shipwreck + castaway camp (spawn) ---- */
    const W = LANDMARKS.wreck;
    let wg = findGround(W.x, W.z, { rng, ...W });
    if (wg.y < 0.7 || wg.y > 3.0) wg = findBeach(Math.atan2(W.z, W.x), 1.5);

    const wreck = buildShipwreck(rng, this.propMats);
    wreck.position.set(wg.x, wg.y - 0.3, wg.z);
    wreck.rotation.y = Math.atan2(wg.x, wg.z) + 1.2;
    scene.add(wreck);
    this.colliders.push({ x: wg.x, z: wg.z, r: 3.2 });

    const inX = -wg.x / Math.hypot(wg.x, wg.z);
    const inZ = -wg.z / Math.hypot(wg.x, wg.z);
    const sx = wg.x + inX * 4, sz = wg.z + inZ * 4;
    this.spawn = { x: sx, y: Math.max(heightAt(sx, sz), 0.6) + 1, z: sz };
    this.wreckPos = wg;

    // the camp of the ones who got here first
    const cg = findGround(wg.x + inX * 16 + 8, wg.z + inZ * 16, { rng, radius: 6, minH: 1.0, maxH: 5, maxSlope: 0.18 });
    const camp = buildCastawayCamp(rng, this.propMats);
    camp.position.set(cg.x, cg.y, cg.z);
    camp.rotation.y = Math.atan2(cg.x, cg.z) + 2.1;
    scene.add(camp);
    this.colliders.push({ x: cg.x, z: cg.z, r: 1.5 });
    this.campPos = cg;

    const fire = buildCampfire(rng, this.propMats);
    /* Well clear of the wreck and up towards the treeline: it is the social
       centre of the whole mode, so it wants space around it rather than
       being tucked against the hull. */
    const fg = findGround(wg.x + inX * 13, wg.z + inZ * 13,
      { rng, radius: 6, minH: 1.0, maxH: 4.5, maxSlope: 0.12 });
    fire.position.set(fg.x, fg.y, fg.z);
    scene.add(fire);
    this.tickers.push(fire.userData.flames);
    this.campfire = fire;
    this.campfirePos = fg;
    this.flameGroups = this.flameGroups || [];
    this.flameGroups.push(fire.userData.flames);

    // HELP dragged into the sand beside the camp
    /* Along the beach rather than under everyone's feet: it used to sit
       between the wreck and the fire where it was permanently walked over. */
    const alongX = -inZ, alongZ = inX;               // tangent to the shore
    const helpPos = findGround(
      wg.x + alongX * 34 + inX * 3, wg.z + alongZ * 34 + inZ * 3,
      { rng, radius: 12, minH: 0.7, maxH: 2.6, maxSlope: 0.12 });
    const help = buildSandWriting('HELP', this.propMats, { width: 17, height: 5.5, seed: 12 });
    help.position.set(helpPos.x, helpPos.y, helpPos.z);
    help.rotation.y = Math.atan2(helpPos.x, helpPos.z) + Math.PI;
    help.userData.drape(heightAt, helpPos.x, helpPos.z);
    scene.add(help);
    this.helpPos = helpPos;

    // the Rogue Agents' own mark, on a far beach
    const RS = LANDMARKS.rogueSand;
    const rsg = findGround(RS.x, RS.z, { rng, ...RS });
    const rogueWord = buildSandWriting('ROGUE', this.propMats, { width: 22, height: 6, seed: 99 });
    rogueWord.position.set(rsg.x, rsg.y, rsg.z);
    rogueWord.rotation.y = Math.atan2(rsg.x, rsg.z) + Math.PI;
    rogueWord.userData.drape(heightAt, rsg.x, rsg.z);
    scene.add(rogueWord);
    this.rogueSandPos = rsg;

    // journal by the fire
    this.interactables.push({
      kind: 'journal', x: fg.x + 1.2, z: fg.z + 0.9, y: fg.y, r: 2.6,
      prompt: 'Read your journal',
    });

    // the satchel with the chart
    const satPos = findGround(cg.x + 1.6, cg.z + 1.4, { rng, radius: 3, minH: 0.9, maxH: 4, maxSlope: 0.2 });
    const satchel = buildSatchel(rng, this.propMats);
    satchel.position.set(satPos.x, satPos.y, satPos.z);
    scene.add(satchel);
    this.tickers.push(satchel);
    this.satchel = satchel;
    this.interactables.push({
      kind: 'letter', x: satPos.x, z: satPos.z, y: satPos.y, r: 2.6,
      prompt: 'Take the Rogue Agents\' satchel', once: true, taken: false, mesh: satchel,
    });

    /* ---- the four Rogue Pendulums ---- */
    this.pendulumMeshes = [];
    PENDULUMS.forEach((p, i) => {
      const L = LANDMARKS[p.place];
      const g = findGround(L.x, L.z, { rng, ...L });
      const tower = buildRoguePendulum(rng, this.propMats, i, p.glyph, p.order);
      /* Sunk to the lowest ground under its plinth. A four-metre stone base
         set at the height under its own centre buries its uphill corner and
         leaves the downhill one standing in mid-air — which is what these
         have been doing on every slope they landed on. */
      let lo = g.y;
      for (let k = 0; k < 8; k++) {
        const a2 = (k / 8) * Math.PI * 2;
        const hh = heightAt(g.x + Math.cos(a2) * 2.4, g.z + Math.sin(a2) * 2.4);
        if (hh < lo) lo = hh;
      }
      tower.position.set(g.x, lo - 0.3, g.z);
      tower.rotation.y = Math.atan2(-g.x, -g.z) + (rng() - 0.5) * 0.5;
      scene.add(tower);
      this.tickers.push(tower);
      this.pendulumMeshes.push(tower);
      this.colliders.push({ x: g.x, z: g.z, r: 2.0 });
      this.interactables.push({
        kind: 'pendulum', index: i, x: g.x, y: g.y, z: g.z, r: 4.2,
        prompt: 'Read the Pendulum plate', once: true, taken: false, mesh: tower,
      });
      p.world = { x: g.x, z: g.z };
    });

    /* ---- coconut piles ---- */
    this.coconutPiles = [];
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const r = 50 + rng() * 110;
      const g = findGround(Math.cos(a) * r, Math.sin(a) * r,
        { rng, radius: 16, minH: 1.0, maxH: 30, maxSlope: 0.24 });
      const pile = buildCoconutPile(rng, this.propMats);
      pile.position.set(g.x, g.y, g.z);
      scene.add(pile);
      this.coconutPiles.push({ mesh: pile, x: g.x, z: g.z, y: g.y, cooldown: 0 });
    }

    /* ---- Ferdi Steinman's hut: the one landmark you can steer by ---- */
    /* The counter is on the hut's +Z face; aim it at the wreck camp so you
       come out of the trees looking straight at Ferdi. The yaw has to be
       decided before the site, because "is this ground flat" depends on
       which way the building is pointing. */
    const hutYaw = Math.atan2(this.spawn.x - (-30), this.spawn.z - 46);
    /* The clearing is carved flat, so search a small radius right in the
       middle of it rather than ranging out over the hillside. */
    const fh = findFlatGround(-30, 46, HUT_FOOT, {
      rng, radius: 7, minH: 3, maxH: 30, yaw: hutYaw, maxRise: 0.8,
    });
    // terrain height in the hut's own space, relative to its origin
    const hutGround = (lx, lz) => {
      const c = Math.cos(hutYaw), sn = Math.sin(hutYaw);
      return heightAt(fh.x + lx * c + lz * sn, fh.z - lx * sn + lz * c) - fh.y;
    };
    const hut = buildFerdiHut(rng, this.propMats, buildFlameCluster, hutGround);
    hut.rotation.y = hutYaw;
    // its origin is the lowest ground under the whole footprint
    hut.position.set(fh.x, fh.y, fh.z);
    scene.add(hut);
    this.tickers.push(hut);
    this.hutPos = fh;
    this.hutNode = hut;
    // where the crates are stacked, in world space
    {
      const c2 = Math.cos(hutYaw), s2 = Math.sin(hutYaw);
      this.cratePos = { x: fh.x + (-4.5) * c2 + 0.5 * s2, z: fh.z - (-4.5) * s2 + 0.5 * c2 };
    }
    /* ---- what you can stand on, and what stops you ----
       There was one 3.4-metre circle at the middle of the building. It was
       wrong in both directions: it left the corners and the whole stair run
       open so you could walk in through the back wall, and it reached far
       enough forward to shove you off the bottom step so you could never
       get up onto the deck properly.

       Now the deck and every tread are platforms you walk up, and the three
       walls plus the counter are what stop you. */
    {
      const c2 = Math.cos(hutYaw), s2 = Math.sin(hutYaw);
      const toWorld = (lx, lz) => ({
        x: fh.x + lx * c2 + lz * s2,
        z: fh.z - lx * s2 + lz * c2,
      });
      this.platforms = this.platforms || [];
      const plat = (lx, lz, hw, hd, ly) => {
        const w = toWorld(lx, lz);
        this.platforms.push({ x: w.x, z: w.z, y: fh.y + ly, hw, hd, cos: c2, sin: s2 });
      };
      // the deck itself
      plat(0, 0, 3.1, 2.6, 1.64);
      // five treads down the front, then the landing
      const STEPS = 5, RISE = 0.30, TREAD = 0.85;
      for (let i = 0; i < STEPS; i++) {
        plat(0, 3.0 + i * TREAD, 2.7, TREAD / 2 + 0.06, 1.5 - (i + 1) * RISE + 0.08);
      }
      {
        const z0 = 3.0 + STEPS * TREAD;
        const g0 = hutGround(0, z0 + 0.9);
        plat(0, z0 + 0.9, 2.7, 1.0, Math.max(g0 + 0.12, 1.5 - (STEPS + 1) * RISE) + 0.08);
      }
      // the three walls, and the counter across the front
      const wall = (lx, lz, r) => {
        const w = toWorld(lx, lz);
        this.colliders.push({ x: w.x, z: w.z, r });
      };
      for (const lx of [-2.8, -1.4, 0, 1.4, 2.8]) wall(lx, -2.55, 0.85);
      for (const lz of [-2.2, -0.8, 0.6, 2.0]) { wall(-3.05, lz, 0.85); wall(3.05, lz, 0.85); }
      // you come up the steps and you stop at the counter, which is correct
      for (const lx of [-2.4, -0.8, 0.8, 2.4]) wall(lx, 2.35, 0.7);
      // the awning poles and the stair newels, so they read as solid
      for (const lx of [-3.15, 3.15]) wall(lx, 4.86, 0.35);
      for (const lx of [-2.85, 2.85]) { wall(lx, 3.0, 0.3); wall(lx, 7.25, 0.3); }
    }

    const fwdX = Math.sin(hut.rotation.y), fwdZ = Math.cos(hut.rotation.y);
    this.interactables.push({
      kind: 'ferdi', x: fh.x + fwdX * 3.6, z: fh.z + fwdZ * 3.6,
      y: fh.y, r: 5.2, prompt: 'Talk to Ferdi Steinman',
    });

    /* trodden dirt, so the clearing reads as somewhere people come */
    {
      const R = 13;
      const g = new THREE.PlaneGeometry(R * 2, R * 2, 24, 24);
      g.rotateX(-Math.PI / 2);
      // one flat texel, or a 26-unit plane samples the whole atlas
      blankUV(g, 'dirt');
      const pos = g.attributes.position;
      /* Four components, not three. Fading the RGB towards zero at the rim
         painted a 26-unit disc of black around the hut instead of letting
         the ground show through; the fade belongs in alpha. */
      const colors = new Float32Array(pos.count * 4);
      const col = new THREE.Color();
      const dirt = new THREE.Color(0x6b563a), dirt2 = new THREE.Color(0x8a7050);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i), lz = pos.getZ(i);
        pos.setY(i, heightAt(fh.x + lx, fh.z + lz) - fh.y + 0.07);
        col.copy(dirt).lerp(dirt2, rng());
        const d = Math.hypot(lx, lz) / R;
        const fade = d > 0.55 ? Math.max(0, 1 - (d - 0.55) / 0.45) : 1;
        colors[i * 4] = col.r;
        colors[i * 4 + 1] = col.g;
        colors[i * 4 + 2] = col.b;
        colors[i * 4 + 3] = fade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      g.computeVertexNormals();
      const dirtMat = this.propMats.decal.clone();
      dirtMat.vertexColors = true;
      dirtMat.map = this.atlas;
      dirtMat.transparent = true;
      dirtMat.opacity = 0.92;
      const patch = new THREE.Mesh(g, dirtMat);
      patch.position.set(fh.x, fh.y, fh.z);
      patch.renderOrder = 1;
      scene.add(patch);
    }

    /* tiki torches: the island's night lighting, and a breadcrumb trail */
    this.tikis = [];
    const addTiki = (tx, tz) => {
      const ty = heightAt(tx, tz);
      if (ty < 1.0) return;
      const tk = buildTikiTorch(rng, this.propMats, buildFlameCluster);
      tk.position.set(tx, ty - 0.25, tz);
      scene.add(tk);
      this.tikis.push(tk);
      this.colliders.push({ x: tx, z: tz, r: 0.34 });
    };
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      addTiki(fh.x + Math.cos(a) * 9.5, fh.z + Math.sin(a) * 9.5);
    }
    // and a lit path between camp, hut and temple
    const trail = [this.spawn, fh, this.templeDoorPos];
    for (let seg = 0; seg < trail.length - 1; seg++) {
      const A = trail[seg], B = trail[seg + 1];
      for (let k = 1; k <= 7; k++) {
        const f = k / 8;
        addTiki(A.x + (B.x - A.x) * f + (rng() - 0.5) * 7,
                A.z + (B.z - A.z) * f + (rng() - 0.5) * 7);
      }
    }

    /* ---- syncoins scattered as currency ----
       Placed against the colliders, not just against the terrain. findGround
       only asks whether the ground is flat enough; it has no idea there is a
       boulder standing on it, which is how one of these ended up embedded in
       a rock near the camp. */
    this.syncoins = [];
    const clearOfProps = (x, z, need = 1.4) => {
      for (const c of this.colliders) {
        const rr = c.r + need;
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < rr * rr) return false;
      }
      return true;
    };
    /* A coin has to be somewhere you can WALK to, which is not the same as
       somewhere flat. findGround only asks about the slope at the point
       itself, so it will happily put one on the crown of a boulder or on a
       ledge with a wall on every side — and one always ended up on a rock
       near the flag, three feet in the air, where you could see it and see
       it and never reach it.

       So: the ground has to be flat AND every approach to it has to be
       walkable. Sixteen bearings, and the rise over the last metre and a
       half of each has to be something a pair of legs can manage. */
    const reachable = (x, z) => {
      const h = heightAt(x, z);
      let ways = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        // walk out three metres; it must not need a climb on the way
        let ok = true;
        let prev = h;
        for (let step = 1; step <= 4; step++) {
          const hh = heightAt(x + dx * step * 0.8, z + dz * step * 0.8);
          if (Math.abs(hh - prev) > 0.75) { ok = false; break; }
          prev = hh;
        }
        if (ok && prev < h + 1.4 && prev > 0.35) ways++;
      }
      return ways >= 5;
    };
    for (let i = 0; i < 38; i++) {
      let g = null;
      for (let attempt = 0; attempt < 22; attempt++) {
        const a = rng() * Math.PI * 2;
        const r = 26 + rng() * 132;
        const cand = findGround(Math.cos(a) * r, Math.sin(a) * r,
          { rng, radius: 18, minH: 1.0, maxH: 34, maxSlope: 0.26 });
        if (clearOfProps(cand.x, cand.z, 2.0) && reachable(cand.x, cand.z)) { g = cand; break; }
      }
      if (!g) continue;                       // rather no coin than one in a rock
      const coin = buildSyncoin(this.propMats);
      coin.position.set(g.x, g.y, g.z);
      coin.userData.baseY = g.y;
      scene.add(coin);
      this.tickers.push(coin);
      this.syncoins.push({ mesh: coin, x: g.x, z: g.z, taken: false });
    }

    /* ---- the three overworld relics ---- */
    this.relicNodes = [];
    const placeRelic = (kind, hintX, hintZ, opts) => {
      const g = findGround(hintX, hintZ, { rng, radius: 16, ...opts });
      const m = buildRelic(kind, rng, this.propMats);
      // sunk to the lowest ground under it, like everything else with a base
      let lo = g.y;
      for (let k = 0; k < 8; k++) {
        const a2 = (k / 8) * Math.PI * 2;
        const hh = heightAt(g.x + Math.cos(a2) * 1.8, g.z + Math.sin(a2) * 1.8);
        if (hh < lo) lo = hh;
      }
      m.position.set(g.x, lo, g.z);
      m.rotation.y = rng() * Math.PI * 2;
      scene.add(m);
      if (m.userData.tick) this.tickers.push(m);
      this.relicNodes.push({ kind, mesh: m });
      if (m.userData.tick && !this.tickers.includes(m)) this.tickers.push(m);
      // These are set pieces the size of a car; walking through one reads
      // as the world being made of cardboard.
      this.colliders.push({ x: g.x, z: g.z, r: kind === 'aerlingus' ? 2.8 : 1.5 });
      this.interactables.push({
        kind: 'relic', relic: kind, x: g.x, y: g.y, z: g.z, r: 3.6,
        prompt: 'Examine', once: true, taken: false,
      });
      return g;
    };
    placeRelic('tasha', -140, -20, { minH: 2, maxH: 20, maxSlope: 0.24 });
    placeRelic('aerlingus', 108, 118, { minH: 0.8, maxH: 4, maxSlope: 0.14 });

    // the First Syncoin sits on a little cairn deep in the west
    {
      const g = findGround(-86, 96, { rng, radius: 16, minH: 4, maxH: 24, maxSlope: 0.22 });
      const big = buildSyncoin(this.propMats, true);
      big.position.set(g.x, g.y + 0.6, g.z);
      big.userData.baseY = g.y + 0.6;
      scene.add(big);
      this.tickers.push(big);
      const plinth = new THREE.Mesh(
        mergeGeos([tint(cyl(0.7, 0.95, 0.9, 8, 'stone', { pos: [0, 0.45, 0] }), new THREE.Color(0x8f8674))]),
        this.propMats.opaque);
      plinth.position.set(g.x, g.y, g.z);
      scene.add(plinth);
      this.firstSyncoin = big;
      this.interactables.push({
        kind: 'relic', relic: 'syncoin', x: g.x, y: g.y, z: g.z, r: 3.4,
        prompt: 'Take the coin', once: true, taken: false, mesh: big,
      });
    }

    /* ---- beacons over each Pendulum: the only reliable way to find
            them in a jungle this size. They light up with the chart. ---- */
    this.beacons = [];
    PENDULUMS.forEach((p) => {
      const b = buildBeacon(0x8fe6d0);
      b.position.set(p.world.x, heightAt(p.world.x, p.world.z), p.world.z);
      b.visible = false;
      scene.add(b);
      this.tickers.push(b);
      this.beacons.push({ node: b, id: p.id });
    });
    // and one over the temple, warmer
    const tb = buildBeacon(0xffd070);
    tb.position.set(this.templeDoorPos.x, this.templeDoorPos.y, this.templeDoorPos.z);
    tb.visible = false;
    scene.add(tb);
    this.tickers.push(tb);
    this.templeBeacon = tb;

    /* ---- THE LUCKY FLOPPER, moored off the west shore ----
       Out past the surf on the far side of the island from the wreck, so
       getting to her is a walk somebody can see you take. */
    {
      const shore = findBeach ? null : null;
      // find a shallow spot: sand under the boat, deep enough to float
      let bx = 0, bz = 0, best = -Infinity;
      for (let a = Math.PI * 0.55; a < Math.PI * 1.15; a += 0.03) {
        for (let r = ISLAND.shore - 6; r < ISLAND.shore + 22; r += 2) {
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          const h = heightAt(x, z);
          if (h > -2.6 || h < -6.5) continue;
          // want land within reach for the bridge
          const inx = Math.cos(a) * (r - 26), inz = Math.sin(a) * (r - 26);
          if (heightAt(inx, inz) < 0.7) continue;
          const score = -Math.abs(h + 4.2) * 3 - Math.abs(a - Math.PI * 0.85) * 6;
          if (score > best) { best = score; bx = x; bz = z; }
        }
      }
      this.platforms = this.platforms || [];
      if (best > -Infinity) {
        const boat = buildCasinoBoat(rng, this.propMats, buildFlameCluster);
        boat.position.set(bx, -0.55, bz);
        boat.rotation.y = Math.atan2(bx, bz) + Math.PI / 2;
        scene.add(boat);
        this.tickers.push(boat);
        this.casino = boat;
        this.casinoPos = { x: bx, z: bz };
        /* She works nights. During the day she stands well out in the
           offing, and the bridge ends in empty water — walk it in daylight
           and there is nothing at the end but the sound of her engines. */
        const od = Math.hypot(bx, bz) || 1;
        this.casinoDock = { x: bx, z: bz };
        this.casinoOffing = { x: (bx / od) * (od + 96), z: (bz / od) * (od + 96) };
        this.casinoIn = 1;                 // 0 = out at sea, 1 = alongside

        // and the bridge in from whatever sand is nearest
        const d = Math.hypot(bx, bz) || 1;
        const sx = (bx / d) * (d - 24), sz = (bz / d) * (d - 24);
        const bridge = buildBoatBridge(rng, this.propMats, sx, sz, bx, bz, heightAt);
        scene.add(bridge);
        this.casinoShore = { x: sx, z: sz };

        /* A board at the shore end. In daylight the pier runs out into
           empty water, and without this it reads as something broken
           rather than as a boat that keeps her own hours. */
        {
          /* Beside the pier head, not across it. Planted on the centre line
             it was a gate you had to walk round to get aboard. */
          const ang = Math.atan2(bx - sx, bz - sz);
          const offX = Math.cos(ang) * 3.4, offZ = -Math.sin(ang) * 3.4;
          const px2 = sx + offX, pz2 = sz + offZ;
          const post = new THREE.Group();
          post.position.set(px2, heightAt(px2, pz2), pz2);
          post.rotation.y = ang + Math.PI - 0.35;
          const legs = [
            tint(cyl(0.09, 0.11, 2.6, 5, 'driftwood', { pos: [-0.9, 1.3, 0] }), new THREE.Color(0x6a5230)),
            tint(cyl(0.09, 0.11, 2.6, 5, 'driftwood', { pos: [0.9, 1.3, 0] }), new THREE.Color(0x6a5230)),
            tint(box(2.4, 0.12, 0.14, 'planks', { pos: [0, 2.5, 0] }), new THREE.Color(0x8a2018)),
            tint(box(2.4, 0.12, 0.14, 'planks', { pos: [0, 1.45, 0] }), new THREE.Color(0x8a2018)),
          ];
          post.add(new THREE.Mesh(mergeGeos(legs), this.propMats.opaque));
          const board = new THREE.Mesh(
            new THREE.PlaneGeometry(2.3, 1.0),
            new THREE.MeshLambertMaterial({
              map: buildSignTexture(['THE LUCKY FLOPPER', 'NIGHTS ONLY'], '#3a1410', '#ffd24a'),
            })
          );
          board.position.set(0, 1.98, 0.09);
          post.add(board);
          const back = board.clone();
          back.position.z = -0.09;
          back.rotation.y = Math.PI;
          post.add(back);
          scene.add(post);
          this.colliders.push({ x: px2, z: pz2, r: 0.7 });
        }
        /* The deck is a platform: without one you walk out along the
           bridge and drop straight through the boat into the sea. */
        const byaw = boat.rotation.y;
        this.casinoPlat = {
          x: bx, z: bz, y: 0.90, hw: 4.7, hd: 12.4,
          cos: Math.cos(byaw), sin: Math.sin(byaw),
        };
        this.platforms.push(this.casinoPlat);
        // the bridge, from the sand out to her
        const mx = (sx + bx) / 2, mz = (sz + bz) / 2;
        const byaw2 = Math.atan2(bx - sx, bz - sz);
        this.platforms.push({
          x: mx, z: mz, y: 0.62, hw: 1.1, hd: Math.hypot(bx - sx, bz - sz) / 2,
          cos: Math.cos(byaw2), sin: Math.sin(byaw2),
        });
      }
    }

    /* ---- the listening post: four hatches built, one of them real ----
       Which one it is comes from the host at the start of the round, so
       nobody can learn the map and walk straight to it. */
    this.hatches = [];
    BUNKER_SPOTS.forEach((spot, i) => {
      /* Dead centre of its carved apron. There is no need to search for
         flat ground when the ground was made flat on purpose. */
      const hg = { x: spot.x, z: spot.z, y: heightAt(spot.x, spot.z) };
      const h = buildHatch(rng, this.propMats);
      h.position.set(hg.x, hg.y - 0.05, hg.z);
      setHidden(h, true);
      scene.add(h);
      this.tickers.push(h);
      this.hatches.push({ x: hg.x, z: hg.z, y: hg.y, node: h, index: i, name: spot.name });
    });

    /* ---- two of Ferdi's machines, tucked away from the shop ----
       On a proper flat footing, and sunk to the lowest ground under it. A
       cabinet a metre and a half wide, set at the height under its own
       middle, stands with one corner in the air and the other in the hill —
       which is what both of these were doing. */
    this.vendors = [];
    for (const [hx, hz] of [[92, -74], [-118, 8]]) {
      const vg = findFlatGround(hx, hz, VENDOR_FOOT, {
        rng, radius: 20, minH: 2, maxH: 30, maxRise: 0.45, yaw: 0,
      });
      let lo = vg.y;
      for (let k = 0; k < 8; k++) {
        const a2 = (k / 8) * Math.PI * 2;
        const hh = heightAt(vg.x + Math.cos(a2) * 1.35, vg.z + Math.sin(a2) * 1.35);
        if (hh < lo) lo = hh;
      }
      const vm = buildVendingMachine(rng, this.propMats);
      vm.position.set(vg.x, lo - 0.06, vg.z);
      /* Facing outward from the island so you come on it front-first rather
         than walking into its back panel. */
      vm.rotation.y = Math.atan2(vg.x, vg.z);
      scene.add(vm);
      this.tickers.push(vm);
      this.colliders.push({ x: vg.x, z: vg.z, r: 1.15 });
      this.vendors.push({ x: vg.x, z: vg.z, y: lo, node: vm });
    }

    /* ---- Cathy, on the far side of the island ----
       One of four spots, chosen per world, all of them on the opposite side
       from the wreck camp and behind the ridge. There is nothing else out
       there, which is the point: finding her should feel like finding
       something. */
    {
      const pad = this.cathyPad;
      // she faces the middle of the island, so you meet her front-on
      const yaw = Math.atan2(-pad.x, -pad.z);
      const y = heightAt(pad.x, pad.z);     // her pad is level, so this is flat
      const cathy = buildCathy(rng, this.propMats, buildFlameCluster);
      cathy.position.set(pad.x, y, pad.z);
      cathy.rotation.y = yaw;
      scene.add(cathy);
      this.tickers.push(cathy);
      this.cathy = { x: pad.x, z: pad.z, y, node: cathy, name: pad.name, yaw };
      // her counter is solid, and so is she
      const cc = Math.cos(yaw), cs = Math.sin(yaw);
      for (const [lx, lz] of [[-1.3, 1.0], [0, 1.0], [1.3, 1.0], [0, -0.1]]) {
        this.colliders.push({
          x: pad.x + lx * cc + lz * cs,
          z: pad.z - lx * cs + lz * cc,
          r: 0.8,
        });
      }
    }

    /* ---- the X ----
       One of twenty places, chosen per world. Two lengths of driftwood laid
       across each other in the sand with nothing to say what they are. */
    {
      const pad = this.xPad;
      const y = heightAt(pad.x, pad.z);        // its pad is carved level
      const node = buildX(rng, this.propMats);
      node.position.set(pad.x, y + 0.02, pad.z);
      node.rotation.y = rng() * Math.PI * 2;
      scene.add(node);
      this.tickers.push(node);
      this.buried = {
        x: pad.x, z: pad.z, y, node,
        state: node.userData.state, digging: 0,
      };
    }

    /* ---- the storm, dormant until the Pendulums are read ---- */
    this.storm = buildStorm(scene);
    this.storm.onThunder = () => {
      this.audio.sfx('thunder');
      this.ui.flashLightning?.();
    };

    /* ---- the temple door ---- */
    const dg = this.templeDoorPos;
    const door = this._buildTempleDoor(rng, dg);
    scene.add(door);
    this.templeDoor = door;
    /* The facade is geometry the ground knows nothing about, so without
       these you walk straight through it. Laid out along the actual boxes
       rather than at a handful of guessed points — a sparse ring left gaps
       you could squeeze between. */
    {
      const yaw2 = Math.atan2(dg.x - ISLAND.ridge.x, dg.z - ISLAND.ridge.z);
      const c2 = Math.cos(yaw2), s2 = Math.sin(yaw2);
      const at = (lx, lz, r) => this.colliders.push({
        x: dg.x + lx * c2 + lz * s2, z: dg.z - lx * s2 + lz * c2, r,
      });
      // a run of colliders along a box's width
      const wall = (cxL, lz, width, r, step = 2.2) => {
        const n = Math.max(1, Math.round(width / step));
        for (let i = 0; i <= n; i++) at(cxL - width / 2 + (i / n) * width, lz, r);
      };

      // doorway jambs, leaving the passage between them open
      wall(-3.5, 1.8, 2.2, 1.3); wall(3.5, 1.8, 2.2, 1.3);
      // the terrace stack, course by course
      for (let i = 0; i < 5; i++) {
        const w = 26 - i * 3.6;
        wall(0, -1.2 - i * 3.2, w, 2.4, 2.6);
      }
      // flanking stair-blocks
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          wall(side * (6.2 + i * 0.5), 1.6 - i * 1.0, 4.4, 1.6, 2.0);
        }
      }
      // the braziers, which are waist high and solid
      at(-7.0, 4.2, 0.8); at(7.0, 4.2, 0.8);
    }

    this.interactables.push({
      kind: 'templeDoor', x: dg.x, y: dg.y, z: dg.z, r: 6.5,
      prompt: 'Examine the sealed door',
    });

    this._refreshCompass();
  }

  /** A proper Mesoamerican-style temple face cut into the ridge: stepped
   *  terraces, a corbelled doorway, carved jambs, flanking braziers and
   *  four glyph sockets across the lintel. */
  _buildTempleDoor(rng, dg) {
    const group = new THREE.Group();
    const P = [];
    const STONE = new THREE.Color(0x8d8770);
    const STONE_D = new THREE.Color(0x625d4c);
    const M = this.propMats;

    const put = (geo, color) => { tint(geo, color); P.push(geo); };

    /* --- stepped terraces rising behind the door --- */
    for (let i = 0; i < 5; i++) {
      const w = 26 - i * 3.6;
      const h = 2.6;
      const d = 5.0;
      put(box(w, h, d, 'templeStone', { pos: [0, 1.3 + i * h, -1.2 - i * 3.2] }),
        STONE.clone().multiplyScalar(0.92 - i * 0.05));
      // riser lip so each terrace reads as cut masonry
      put(box(w + 0.7, 0.5, d + 0.5, 'templeStone', { pos: [0, 1.3 + i * h + h / 2, -1.2 - i * 3.2] }),
        STONE_D.clone().multiplyScalar(0.95 - i * 0.04));
    }

    /* --- flanking stair-blocks either side of the entrance --- */
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        put(box(4.4, 1.5, 2.4 + i * 0.6, 'templeStone', {
          pos: [side * (6.2 + i * 0.5), 0.75 + i * 1.5, 1.6 - i * 1.0],
        }), STONE.clone().multiplyScalar(0.86 - i * 0.04));
      }
    }

    /* --- carved doorway: jambs, corbel, threshold --- */
    for (const side of [-1, 1]) {
      put(box(2.2, 8.4, 3.0, 'templeStone', { pos: [side * 3.5, 4.2, 1.8] }),
        STONE.clone().multiplyScalar(1.02));
      // glyph band down each jamb
      for (let i = 0; i < 4; i++) {
        put(box(1.3, 1.5, 0.3, 'templeGlyph', { pos: [side * 3.5, 1.6 + i * 1.9, 3.35] }),
          new THREE.Color(0xa89c80));
      }
    }
    // corbelled head: three courses stepping inward
    for (let i = 0; i < 3; i++) {
      put(box(9.6 - i * 1.4, 1.0, 3.0 - i * 0.3, 'templeStone', { pos: [0, 8.9 + i * 1.0, 1.8] }),
        STONE_D.clone().multiplyScalar(1 - i * 0.05));
    }
    // threshold slab you step over
    put(box(6.0, 0.7, 2.6, 'templeStone', { pos: [0, 0.35, 3.0] }), STONE.clone().multiplyScalar(0.8));

    /* --- the dark of the passage --- */
    const mouth = new THREE.Mesh(
      mergeGeos([tint(blankUV(new THREE.PlaneGeometry(5.0, 8.4), 'caveRock'), new THREE.Color(0x05070a))]),
      M.opaque);
    mouth.position.set(0, 4.2, 0.9);
    group.add(mouth);
    // ceiling and floor of the short passage, so it has depth
    put(box(5.0, 0.5, 3.4, 'templeStone', { pos: [0, 8.5, 1.2] }), STONE_D);
    put(box(5.0, 0.4, 3.4, 'templeStone', { pos: [0, 0.5, 1.2] }), STONE_D);

    group.add(new THREE.Mesh(mergeGeos(P), M.opaque));

    /* --- the slab that seals it --- */
    const slabParts = [];
    const slabBody = blankUV(new THREE.BoxGeometry(4.9, 8.2, 0.9), 'templeStone');
    slabParts.push(tint(slabBody, STONE.clone().multiplyScalar(1.08)));
    for (let i = 0; i < 3; i++) {
      slabParts.push(tint(box(3.2, 1.8, 0.24, 'templeGlyph', { pos: [0, -2.2 + i * 2.4, 0.55] }),
        new THREE.Color(0xb0a488)));
    }
    const slab = new THREE.Mesh(mergeGeos(slabParts), M.opaque);
    slab.position.set(0, 4.2, 2.0);
    group.add(slab);
    group.userData.slab = slab;

    /* --- four glyph sockets across the lintel --- */
    const sockets = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        mergeGeos([tint(blankUV(new THREE.BoxGeometry(1.5, 1.5, 0.34), 'monolith'), new THREE.Color(0x2c3038))]),
        M.opaque);
      m.position.set((i - 1.5) * 2.1, 9.6, 3.5);
      group.add(m);
      sockets.push(m);
    }
    group.userData.sockets = sockets;

    /* --- braziers either side of the threshold --- */
    const fires = [];
    for (const side of [-1, 1]) {
      const bowl = new THREE.Mesh(mergeGeos([
        tint(cyl(0.7, 0.45, 0.6, 8, 'goldDark'), new THREE.Color(0xc8a44c)),
        tint(cyl(0.16, 0.2, 1.8, 6, 'templeStone', { pos: [0, -1.2, 0] }), STONE_D),
      ]), M.opaque);
      bowl.position.set(side * 7.0, 2.4, 4.2);
      group.add(bowl);
      const f = buildFlameCluster(M, 3, 0.45);
      f.position.set(side * 7.0, 2.6, 4.2);
      group.add(f);
      fires.push(f);
      const l = new THREE.PointLight(0xffa040, 1.6, 14, 1.7);
      l.position.set(side * 7.0, 3.4, 4.2);
      group.add(l);
    }
    group.userData.fires = fires;

    const light = new THREE.PointLight(0x8fe6d0, 1.1, 18, 1.8);
    light.position.set(0, 9.6, 4.4);
    group.add(light);
    group.userData.light = light;

    /* The facade is a flat slab dropped onto a sloped hillside, so its
       downhill corners used to hang in mid-air. Skirt it with rock that
       reaches from each corner down to whatever the terrain is actually
       doing there, and pack the sides into the cliff. */
    const yaw = Math.atan2(dg.x - ISLAND.ridge.x, dg.z - ISLAND.ridge.z);
    const skirt = [];
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const toWorld = (lx, lz) => ({
      x: dg.x + lx * cs + lz * sn,
      z: dg.z - lx * sn + lz * cs,
    });
    for (let lx = -17; lx <= 17; lx += 2.2) {
      for (let lz = -8; lz <= 7; lz += 2.2) {
        const w = toWorld(lx, lz);
        const gh = heightAt(w.x, w.z);
        const localTop = dg.y - 0.6 + 1.0;
        const drop = localTop - gh;
        if (drop < 0.2) continue;                  // ground is already high
        const h = drop + 3.0;                      // always bury the bottom
        const b = box(2.5, h, 2.5, 'templeStone', {
          pos: [lx, (localTop - h / 2) - (dg.y - 0.6), lz],
        });
        tint(b, new THREE.Color(0x7b7360).multiplyScalar(0.7 + rng() * 0.35));
        skirt.push(b);
      }
    }
    /* Scree along the rim of the cut, masking the join between dressed
       stone and hillside. Same stone as the temple so they read as spoil
       from the excavation rather than as holes in the world. */
    for (let i = 0; i < 30; i++) {
      const lx = -21 + rng() * 42;
      const lz = -11 + rng() * 20;
      if (Math.abs(lx) < 7 && lz > -1) continue;   // keep the doorway clear
      if (Math.abs(lx) < 13 && Math.abs(lz) < 4) continue;
      const w = toWorld(lx, lz);
      const gh = heightAt(w.x, w.z) - (dg.y - 0.6);
      const sSize = 0.8 + rng() * 1.5;
      const r = ico(sSize, 0, 'templeStone', {
        pos: [lx, gh + sSize * 0.05, lz], rot: [rng() * 3, rng() * 3, rng() * 3],
      });
      lumpify(r, 0.26, rng);
      tint(r, new THREE.Color(0x8d8770).multiplyScalar(0.78 + rng() * 0.34));
      skirt.push(r);
    }
    group.add(new THREE.Mesh(mergeGeos(skirt), M.opaque));

    group.position.set(dg.x, dg.y - 0.6, dg.z);
    group.rotation.y = yaw;
    group.userData.open = 0;
    group.userData.setOpen = (a) => {
      group.userData.open = a;
      slab.position.y = 4.2 - a * 8.6;
      light.intensity = 1.1 + a * 2.4;
    };
    group.userData.tick = (t) => { for (const f of fires) f.userData.tick(t); };
    return group;
  }

  /** Somewhere on the ridge's south face, high but climbable. */
  _findTempleSpot() {
    let best = null, bestScore = -Infinity;
    for (let a = -1.0; a <= 1.0; a += 0.04) {
      for (let r = 30; r < 74; r += 1.0) {
        const x = ISLAND.ridge.x + Math.sin(a) * r;
        const z = ISLAND.ridge.z + Math.cos(a) * r;
        const h = heightAt(x, z);
        // The ridge's south face runs roughly 38 (low) to 60 (high); sit the
        // doorway partway up it so there's still mountain overhead.
        if (h < 34 || h > 50) continue;
        const s = slopeAt(x, z);
        if (s > 0.30) continue;
        const rise = heightAt(x - Math.sin(a) * 14, z - Math.cos(a) * 14) - h;
        if (rise < 4) continue;
        const score = -Math.abs(h - 41) * 1.2 - Math.abs(a) * 6
          - Math.abs(s - 0.16) * 20 + Math.min(rise, 16) * 1.3;
        if (score > bestScore) { bestScore = score; best = { x, y: h, z }; }
      }
    }
    return best || { x: LANDMARKS.temple.x, y: heightAt(LANDMARKS.temple.x, LANDMARKS.temple.z), z: LANDMARKS.temple.z };
  }

  /* ===========================================================
     THE TIDE

     Step off the end of the pier, or off the Flopper's deck while she is
     under way, and you used to tread water a hundred metres out with
     nothing to do about it but swim — and swimming is slow, and there is
     nothing to aim at. The sea brings you in now.

     It waits a second and a half first, so a deliberate swim still works,
     and it builds rather than snatching, so it reads as a current and not
     as the game moving you. It stops the moment there is ground under you.
     Standing on the deck or the bridge is not being in the sea: the check
     is against groundOf, which knows about platforms.
     =========================================================== */
  _tide(dt) {
    if (!this.player) return;
    const p = this.player.pos;
    const under = (this.groundOf || heightAt)(p.x, p.z, p.y);
    /* Driven off the sea floor alone, not off how wet you are. Using
       inWater as well meant the two thresholds disagreed in the shallows and
       it let go of you in three feet of water, a swim short of the sand. */
    if (under > -0.25 || p.y > 0.7) {
      if ((this._adrift || 0) > 2.0) this.ui.toast('BACK ON THE SAND', 'jade', 1600);
      this._adrift = 0;
      return;
    }
    this._adrift = (this._adrift || 0) + dt;
    if (this._adrift < 1.5) return;
    if (!this._tideSaid) {
      this._tideSaid = true;
      this.ui.toast('THE TIDE IS TAKING YOU IN', 'gold', 2600);
      this.audio?.sfx?.('wave');
      setTimeout(() => { this._tideSaid = false; }, 9000);
    }
    /* Straight at the middle of the island, which is the shortest line to
       some beach from anywhere in this sea. */
    const d = Math.hypot(p.x, p.z) || 1;
    /* Strong in deep water, easing off as the bottom comes up, so you are
       set down on the sand rather than thrown at it. */
    const shallow = THREE.MathUtils.clamp((-under - 0.25) / 1.6, 0.25, 1);
    const pull = Math.min(8.5, 1.8 + (this._adrift - 1.5) * 2.6) * shallow * dt;
    p.x -= (p.x / d) * pull;
    p.z -= (p.z / d) * pull;
    // and a swell, so it feels like water rather than a conveyor
    p.y += Math.sin(this.time * 2.3) * 0.05 * dt;
  }

  /* ===========================================================
     CATHY'S FOOD

     The stall is on the island in both modes, so what her food does lives
     here and the Castaways client calls into it. Three of the five are
     about finding loose Syncoin, which is the one thing on this island
     nobody will tell you the location of.
     =========================================================== */

  /** What is on her counter. The double-pay burger needs paid work to exist. */
  foodList() { return FOOD.filter((i) => i.id !== 'burger'); }

  /** Whether you have already eaten a permanent one. */
  hasFood(id) { return !!this.ate?.has(id); }

  /** Do what the label says. Shared by both modes. */
  applyFood(id) {
    this.ate = this.ate || new Set();
    if (id === 'tonic') {
      // a fifth of the cost, five times the recovery, which is what it says
      this.player.staminaDrain = this.player.BASE_DRAIN * 0.2;
      this.player.staminaRegen = this.player.BASE_REGEN * 5;
      this.ate.add(id);
      this.ui.toast('SPRINTING COSTS ALMOST NOTHING NOW', 'jade', 3000);
    }
    if (id === 'eggs') {
      this.coinSense = true;
      this._coinPoiAt = 0;
      this.ate.add(id);
      this.ui.toast('YOU CAN SEE COINS THROUGH THE HILLS - 70 METRES', 'jade', 3400);
    }
    if (id === 'sauce') {
      this.coinNeedle = true;
      this._coinPoiAt = 0;
      this.ate.add(id);
      this.ui.toast('THE COMPASS HAS A COIN NEEDLE NOW', 'jade', 3000);
    }
    if (id === 'burger') {
      this.bigMeals = true;
      this.ate.add(id);
      this.ui.toast('EVERY JOB PAYS DOUBLE NOW', 'jade', 3000);
    }
    if (id === 'floss') {
      // the one that wears off, so it never goes into `ate`
      this.flossUntil = performance.now() / 1000 + 90;
      this.player.SPEED = this.player.BASE_SPEED * 1.30;
      this.player.SPRINT = this.player.BASE_SPRINT * 1.30;
      this.ui.toast('30% FASTER FOR NINETY SECONDS', 'jade', 3000);
    }
  }

  /**
   * The food, ticking.
   *
   * "Every coin within seventy metres" and "the nearest coin" both change
   * with every step, so both are recomputed twice a second — thirty-eight
   * distance checks, which costs nothing.
   */
  _tickFood() {
    /* One clock. This used to be handed this.time in single player and
       performance.now() in a round, so candy floss either expired the
       instant you ate it or never expired at all. */
    const t = performance.now() / 1000;
    if (this.flossUntil && t > this.flossUntil) {
      this.flossUntil = 0;
      const vest = this.hasItem?.('vest') ? 0.75 : 1;
      this.player.SPEED = this.player.BASE_SPEED * vest;
      this.player.SPRINT = this.player.BASE_SPRINT * vest;
      this.ui.toast('THE SUGAR HAS GONE', 'bad', 2400);
    }
    if (!this.coinSense && !this.coinNeedle) return;
    if (t - (this._coinPoiAt || 0) < 0.5) return;
    this._coinPoiAt = t;
    const p = this.player.pos;
    let near = null, nearD = Infinity;
    for (const c of (this.syncoins || [])) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (this.coinSense) c.mesh?.userData.setSense?.(!c.taken && d < 70);
      if (!c.taken && d < nearD) { nearD = d; near = c; }
    }
    const key = `${this.coinSense ? 1 : 0}${near ? `${near.x | 0},${near.z | 0}` : '-'}`;
    if (key === this._coinPoiKey) return;
    this._coinPoiKey = key;
    this._refreshCompass();
  }

  /** Every compass tick her food is responsible for. Used by both modes. */
  _coinPois(out = []) {
    if (!this.coinSense && !this.coinNeedle) return out;
    const p = this.player.pos;
    let near = null, nearD = Infinity;
    for (const c of (this.syncoins || [])) {
      if (c.taken) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (this.coinSense && d < 70) out.push({ label: '', x: c.x, z: c.z, kind: 'coin' });
      if (d < nearD) { nearD = d; near = c; }
    }
    if (this.coinNeedle && near) out.push({ label: 'COIN', x: near.x, z: near.z, kind: 'coin' });
    return out;
  }

  /* ===========================================================
     THE X, IN SINGLE PLAYER

     The same hole and the same chest. There is no market here, so what is
     in it is Syncoin and a coconut haul rather than one of Ferdi's lines.
     =========================================================== */
  _tickDig(dt) {
    const bu = this.buried;
    if (!bu) return;
    const st = bu.state;
    if (st.dug >= 1 || st.taken) { bu.digging = 0; return; }
    const p = this.player.pos;
    const near = Math.hypot(p.x - bu.x, p.z - bu.z) < 3.2;
    if (!(near && this.holdingE && !this.anyOverlayOpen() && !this.paused)) {
      bu.digging = 0;
      return;
    }
    bu.digging += dt;
    st.dug = Math.min(1, st.dug + dt / DIG_SECONDS);
    if (bu.digging - (bu.lastSpade || 0) > 0.34) {
      bu.lastSpade = bu.digging;
      this.audio.sfx('step_sand');
      this.player.punch?.(0.05);
    }
    if (st.dug >= 1 && !bu.said) {
      bu.said = true;
      this.audio.sfx('confirm');
      if (!bu.solid) {
        bu.solid = true;
        this.colliders.push({ x: bu.x, z: bu.z, r: 0.95 });
        this.player.setColliders(this.colliders);
      }
      this.ui.toast('A CHEST. IT IS NOT LOCKED.', 'gold', 3200);
    }
  }

  openChestSP() {
    const bu = this.buried;
    if (!bu || bu.state.taken || bu.state.dug < 1) { this.audio.sfx('deny'); return; }
    bu.state.taken = true;
    const swing = setInterval(() => {
      bu.state.open = Math.min(1, bu.state.open + 0.06);
      if (bu.state.open >= 1) clearInterval(swing);
    }, 16);
    this.audio.sfx('hatch');
    this.audio.sfx('victory');
    const gold = 20 + ((Math.random() * 21) | 0);
    this.coins += gold;
    this.coconutCount = Math.min(this.coconutMax, this.coconutCount + 4);
    this.ui.showPopup(`${gold} SYNCOIN`, 'AND FOUR COCONUTS', 'coin', 'THE CHEST');
  }

  /* ---- her counter, in single player ---- */
  openCathy() {
    if (!this.metCathy) {
      this.metCathy = true;
      this._refreshCompass();
      this.ui.toast(`CATHY IS ON YOUR COMPASS - ${this.cathy.name}`, 'jade', 3400);
    }
    document.exitPointerLock?.();
    this.screens.push('mpCathy', { sel: 0 });
    this.audio.sfx('page');
  }

  /** Single player has no market, so her prices are her prices. */
  priceOf(id) { return itemById(id)?.cost || 0; }

  hasItem(id) { return this.hasFood(id); }

  /** Buy and eat, in single player. */
  buyItem(id) {
    const it = itemById(id);
    if (!it) return false;
    if (it.once && this.hasFood(id)) { this.audio.sfx('deny'); return false; }
    if (this.coins < it.cost) {
      this.audio.sfx('deny');
      this.ui.toast('NOT ENOUGH SYNCOIN', 'bad', 1600);
      return false;
    }
    this.coins -= it.cost;
    this.audio.sfx('confirm');
    this.audio.sfx('coin');
    this.applyFood(id);
    return true;
  }

  _refreshCompass() {
    const pois = [{ label: 'CAMP', x: this.spawn.x, z: this.spawn.z, kind: 'poi' }];
    if (this.metCathy && this.cathy) {
      pois.push({ label: 'CATHY', x: this.cathy.x, z: this.cathy.z, kind: 'poi' });
    }
    if (this.foundX && this.buried && !this.buried.state.taken) {
      pois.push({ label: 'X', x: this.buried.x, z: this.buried.z, kind: 'goal' });
    }
    this._coinPois(pois);
    if (this.hasChart) {
      PENDULUMS.forEach((p, i) => pois.push({
        label: ['I', 'II', 'III', 'IV'][p.order - 1],
        x: p.world.x, z: p.world.z, kind: 'goal',
        hidden: this.found.has(p.id), pendIndex: i,
      }));
      pois.push({ label: 'TEMPLE', x: this.templeDoorPos.x, z: this.templeDoorPos.z, kind: 'goal' });
    }
    this.ui.setCompassPois(pois);
  }

  /* ===========================================================
     SANCTUM / TITLE
     =========================================================== */
  _buildSanctum() {
    const D = TEMPLE.daisCenter;
    this.sanctumIdol = buildIdolShrine(this.idolMats, this.propMats, { curls: 74 });
    this.sanctumIdol.position.set(D.x, TEMPLE.daisHeight + 2.45, D.z);
    this.sanctumIdol.scale.setScalar(1.3);
    this.templeScene.add(this.sanctumIdol);
    this.templeCaches = this.templeScene.userData.caches;
    this.templeSeal = this.templeScene.userData.seal;

    // Hector's watermelon, alone in the corner of his "layer"
    const melon = buildRelic('watermelon', makeRng(4), this.propMats);
    const mx = -TEMPLE.halfX + 5, mz = TEMPLE.halfZ - 6;
    melon.position.set(mx, templeHeight(mx, mz) + 0.42, mz);
    this.templeScene.add(melon);
    this.melonNode = { mesh: melon, x: mx, z: mz };
  }

  _buildTitleScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x140d16);
    scene.fog = new THREE.Fog(0x140d16, 8, 30);
    scene.add(new THREE.AmbientLight(0x8a7a68, 1.5));

    const key = new THREE.DirectionalLight(0xfff4d8, 2.6);
    key.position.set(3, 5, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc0e0, 1.0);
    fill.position.set(-5, 1, 3); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffb05a, 2.0);
    rim.position.set(-3, 4, -5); scene.add(rim);

    this.titleIdol = buildIdolShrine(this.idolMats, this.propMats, { curls: 78, keyIntensity: 0.7 });
    this.titleIdol.position.set(0, -1.25, 0);
    scene.add(this.titleIdol);

    this.titleCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.titleScene = scene;
  }

  /* ===========================================================
     EVENTS
     =========================================================== */
  _bindEvents() {
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));

    /* There is no <input> anywhere in this game, so the browser will never
       hand a paste to anything on its own. Catch it at the document and
       offer it to whichever screen is open. */
    window.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      if (this.screens.paste(text)) e.preventDefault();
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.mouse.locked;
      this.mouse.locked = document.pointerLockElement === this.canvas;
      /* Only pause on a lock we actually had. A request that is refused —
         no user gesture yet, or the browser simply says no — used to read
         as "the player pressed Escape" and dropped them into the pause
         menu they never asked for, over and over. */
      if (was && !this.mouse.locked && this.playing && !this.anyOverlayOpen() && !this.paused) {
        this.pause(true);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.locked || this.paused) return;
      if (this.anyOverlayOpen()) return;
      const dx = Math.abs(e.movementX) > 220 ? 0 : e.movementX;
      const dy = Math.abs(e.movementY) > 220 ? 0 : e.movementY;
      this.player?.addPitchYaw(dx, dy);
    });

    /* Screens get the pointer in the coordinates they are drawn in. Most
       of them only want a click, but anything with a handle on it — the
       slot machine's arm — needs the whole press-drag-release. */
    const toHud = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [
        ((e.clientX - r.left) / r.width) * this.ui.hud.c.width,
        ((e.clientY - r.top) / r.height) * this.ui.hud.c.height,
      ];
    };
    window.addEventListener('mousemove', (e) => {
      if (!this.screens.open) return;
      const [hx, hy] = toHud(e);
      this.screens.pointer('move', hx, hy);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.screens.open) return;
      const [hx, hy] = toHud(e);
      this.screens.pointer('up', hx, hy);
    });
    // the wheel zooms the map
    this.canvas.addEventListener('wheel', (e) => {
      if (!this.screens.open) return;
      e.preventDefault();
      this.screens.key(e.deltaY < 0 ? 'Equal' : 'Minus');
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.screens.open) {
        const [hx, hy] = toHud(e);
        // a handle takes precedence over a list row underneath it
        if (this.screens.pointer('down', hx, hy)) return;
        this.screens.click(hx, hy);
        return;
      }
      if (this.state === 'cutscene') { this.skipCutscene(); return; }
      if (!this.playing) return;
      if (!this.mouse.locked) { this._requestLock(); return; }
      if (this.paused || this.anyOverlayOpen()) return;
      if (e.button === 0) this.throwCoconut();
    });

    /* Alt-tabbing out of a menu should do nothing; there is nothing to
       pause, and pausing on top of an open screen stacks two of them. */
    window.addEventListener('blur', () => {
      if (this.playing && !this.paused && !this.anyOverlayOpen()) this.pause(true);
    });
  }

  get playing() {
    return this.state === 'island' || this.state === 'temple'
      || this.state === 'bunker' || this.state === 'highroller';
  }
  anyOverlayOpen() { return this.screens.open; }

  /** Re-grab the pointer once the last overlay closes. */
  afterOverlayClose() {
    if (!this.screens.open && this.playing && !this.paused) this._requestLock();
  }

  _requestLock() {
    // Chrome returns a promise here and rejects it when there is no user
    // gesture, or when the canvas is not in the active document.
    try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) { /* not available */ }
  }

  _key(e, down) {
    const k = e.code;
    const I = this.input;

    /* Canvas screens take priority over everything, including movement,
       so arrow keys drive menus instead of walking you into the sea. */
    if (down && this.screens.open) {
      // let the browser's own paste through; we listen for it above
      if ((e.metaKey || e.ctrlKey) && k === 'KeyV') {
        navigator.clipboard?.readText?.()
          .then((t) => { if (t) this.screens.paste(t); })
          .catch(() => {});
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      this.screens.key(k);
      return;
    }
    switch (k) {
      case 'KeyW': case 'ArrowUp': if (!this.ui.dialsOpen) I.fwd = down; break;
      case 'KeyS': case 'ArrowDown': if (!this.ui.dialsOpen) I.back = down; break;
      case 'KeyA': case 'ArrowLeft': if (!this.ui.dialsOpen) I.left = down; break;
      case 'KeyD': case 'ArrowRight': if (!this.ui.dialsOpen) I.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': I.sprint = down; break;
      case 'Space': I.jump = down; if (down) e.preventDefault(); break;
      default: break;
    }
    /* E is HELD for digging as well as tapped for everything else, so it has
       to be tracked on the way up too — above the guard that throws every
       key-up away. */
    if (k === 'KeyE') this.holdingE = down;

    if (!down) return;

    if (this.state === 'cutscene') { this.skipCutscene(); return; }

    if (k === 'KeyE') { if (!e.repeat) this.interact(); return; }

    if (k === 'KeyC' && this.playing) {
      const third = this.player.toggleView();
      this.ui.toast(third ? 'THIRD PERSON' : 'FIRST PERSON', 'gold', 1100);
      this.audio.sfx('select');
      return;
    }
    if (k === 'Tab') { e.preventDefault(); if (this.playing) this.toggleJournal(); return; }
    if (k === 'KeyF') { if (this.playing) this.openChart(); return; }
    if (k === 'KeyM') { if (this.playing) this.openChart(); return; }
    if (k === 'Escape') { if (this.playing) this.pause(!this.paused); return; }
  }

  /* ===========================================================
     FLOW
     =========================================================== */
  startTitle() {
    this.state = 'title';
    this.ui.hide();
    this.screens.replace('title');
    this.audio.playMusic('title');
  }

  beginGame() {
    this.screens.clear();
    this.audio.resume();
    this.audio.sfx('confirm');
    this.startGame();
  }

  quitToTitle() {
    this.paused = false;
    document.exitPointerLock?.();
    this.ui.hide();
    this.ui.showBoss(false);
    this.pipeline.fade = 1;
    this.pipeline.tintAmt = 0;
    if (this.hector) { this.hector.dispose(); this.hector = null; }
    this.bossTriggered = false;
    this.startTitle();
  }

  copyBrag() {
    const txt = this.endingSummary || 'I found the Idol of King Illic on Illic Isle.';
    navigator.clipboard?.writeText(`${txt}\n${location.href}`)
      .then(() => this.ui.toast('COPIED TO CLIPBOARD', 'jade', 2000))
      .catch(() => this.ui.toast('CLIPBOARD BLOCKED', 'bad', 2000));
    this.audio.sfx('confirm');
  }

  startGame() {
    this.paused = false;
    this.stats = { started: performance.now(), deaths: 0, thrown: 0, hits: 0 };
    this.found.clear();
    this.hasChart = false;
    this.doorSolved = false;
    this.dialState = [0, 0, 0, 0];
    this.coconutCount = 3;
    this.coconutMax = 8;
    this.coins = 0;
    this.relics.clear();
    this.bought.clear();
    this.runTime = 0;
    this.clock24 = 0;
    this.night = 0;
    this.player.maxHp = 5;
    this.player.SPRINT = 15.5;
    if (this.syncoins) this.syncoins.forEach((c) => { c.taken = false; c.mesh.visible = true; });
    if (this.relicNodes) this.relicNodes.forEach((r) => (r.mesh.visible = true));
    if (this.firstSyncoin) this.firstSyncoin.visible = true;
    if (this.melonNode) this.melonNode.mesh.visible = true;
    if (this.storm) this.storm.stop();
    this.scene = this.islandScene;

    this.player.hp = this.player.maxHp;
    this.player.stamina = 1;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    this.player.teleport(this.spawn.x, this.spawn.y + 1, this.spawn.z,
      Math.atan2(-this.spawn.x, -this.spawn.z));

    this.interactables.forEach((i) => { if (i.once) i.taken = false; });
    this.pendulumMeshes.forEach((m) => (m.visible = true));
    if (this.satchel) this.satchel.visible = true;
    this.templeDoor.userData.setOpen(0);
    this.hectorDefeated = false;
    this.idolTaken = false;
    this.bossTriggered = false;
    this.seenDescent = false;
    this.introClearing = false;
    this.introStorm = 1;
    this.clearCoconuts();
    this._refreshCompass();
    this.updateSockets();

    this.playIntro();
  }

  /* ===========================================================
     CUTSCENES
     =========================================================== */

  /** Enter a scripted-camera sequence. `scene` is what to render under it. */
  playCutscene(spec, scene) {
    this.cutScene = scene || this.scene;
    this.state = 'cutscene';
    this.ui.hide();
    this.ui.setPrompt(null);
    document.exitPointerLock?.();
    setCinemaBars(true);
    this.cutsceneObj = new Cutscene(this.camera, spec);
  }

  skipCutscene() {
    if (this.state !== 'cutscene') return;
    this.cutsceneObj?.skip();
  }

  updateCutscene(dt) {
    dt = this.rawDt ?? dt;
    // world keeps breathing under the camera
    if (this.cutScene === this.islandScene) {
      this.tickIslandWorld(dt);
      if (this.introStage?.visible) {
        this._introClose?.(dt);
        this.introStage.userData.tick(this.time, dt, this.camera);
      }
      if (this.introStorm != null && this.state === 'cutscene') this.updateIntroWeather(dt);
    }
    else {
      this.templeScene.userData.tick?.(this.time, dt);
      this.sanctumIdol?.userData.tick?.(this.time);
      if (this.hector) this.hector.update(dt, this.time, this.player);
    }
    this.cutsceneObj?.update(dt);
  }

  /* ---------- opening ----------
     Seven beats, each framed on the thing its caption is about:
     the king on his throne, the Agents closing in, the pour, Hector
     arriving, the storm, the wreck, dawn.
     The first four play on a pocket stage parked below the world.
  */
  playIntro() {
    const s = this.spawn;
    const out = Math.hypot(s.x, s.z) || 1;
    const nx = s.x / out, nz = s.z / out;
    const wreck = this.wreckPos;
    const sea = (d, y) => new THREE.Vector3(nx * (out + d), y, nz * (out + d));

    const ST = this.introStage;
    ST.visible = true;
    ST.userData.closeIn = 0;
    this.setStageMode(true);
    const P = ST.position;
    const at = (lx, ly, lz) => new THREE.Vector3(P.x + lx, P.y + ly, P.z + lz);

    this.pipeline.fade = 0;
    this.introStorm = 1;
    this.introClearing = false;
    this.audio.playMusic('storm');

    // the Agents walk in over shots II-III
    this._introClose = (dt) => {
      const want = this._introCloseWant || 0;
      ST.userData.closeIn += (want - ST.userData.closeIn) * Math.min(1, dt * 0.9);
    };
    this._introCloseWant = 0;

    this.playCutscene({
      shots: [
        { // I — the throne. Slow push onto the king.
          dur: 6.0, ease: 'smooth',
          from: at(0, 5.6, 17), to: at(0, 3.9, 8.4),
          lookFrom: at(0, 3.4, 0), lookTo: at(0, 3.5, 0),
        },
        { // II — low and behind, the Agents arriving out of the dark
          dur: 6.0, ease: 'linear',
          from: at(-9.5, 1.5, 9.5), to: at(-4.4, 1.9, 5.0),
          lookFrom: at(0, 2.6, 0), lookTo: at(0, 3.0, 0),
        },
        { // III — the circle tightens on him
          dur: 5.0, ease: 'easeOut', shake: 0.10,
          from: at(3.6, 2.6, 6.4), to: at(1.6, 3.2, 3.6),
          lookFrom: at(0, 3.2, 0), lookTo: at(0, 3.4, 0),
        },
        { // IV — the pour: the Idol on its plinth, fog drifting past
          dur: 6.5, ease: 'smooth',
          from: at(-220 + 1.5, 4.6, 13), to: at(-220 + 0.4, 2.6, 6.2),
          lookFrom: at(-220, 2.6, 0), lookTo: at(-220, 2.3, 0),
        },
        { // V — Hector, coming in across open water
          dur: 6.0, ease: 'linear',
          from: at(220 + 13, 3.6, 13), to: at(220 + 4.5, 2.4, 8.5),
          lookFrom: at(220, 2.4, 1.5), lookTo: at(220, 2.2, 1.5),
        },
        { // VI — black water, the ship going over
          dur: 6.5, ease: 'linear', shake: 0.3,
          from: sea(104, 6.0), to: sea(58, 3.0),
          look: sea(36, 1.6),
        },
        { // VII — dawn, then down onto the body
          dur: 6.0, ease: 'smooth',
          from: sea(40, 24), to: sea(4, 13),
          look: new THREE.Vector3(0, 10, 0),
        },
        {
          dur: 5.5, ease: 'easeOut',
          from: new THREE.Vector3(wreck.x + 15, wreck.y + 11, wreck.z + 17),
          to: new THREE.Vector3(s.x - 4.5, s.y + 2.4, s.z + 5.5),
          lookFrom: new THREE.Vector3(wreck.x, wreck.y + 3, wreck.z),
          lookTo: () => new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.3, this.player.pos.z),
        },
      ],
      text: [
        { at: 0.7, until: 5.6, text: 'KING ILLIC held this island\nfor thirty years, and badly.' },
        { at: 6.6, until: 11.6, text: 'The ROGUE AGENTS came for him\nout of the dark, and they were thorough.' },
        { at: 12.6, until: 16.6, text: 'They did not bury him.' },
        { at: 17.8, until: 23.6, text: 'They poured what was left of him into gold,\nand set four Pendulums to mark where\nthey put it.' },
        { at: 24.6, until: 30.0, text: 'Eleven years ago his brother HECTOR\nsailed in with a staff that makes food\nfrom nothing.\nHe killed every Agent on the rock.' },
        { at: 31.6, until: 36.4, text: 'Last night a storm took a ship\nthat had no business out here.' },
        { at: 38.4, until: 43.0, text: 'This morning the sea gives you back.' },
      ],
      events: [
        { at: 0.0, visualOnly: true, fn: () => this.fade(1, 2000) },
        { at: 0.5, fn: () => this.audio.sfx('bossIntro') },
        { at: 6.2, fn: () => { this._introCloseWant = 0.45; this.audio.sfx('cast'); } },
        { at: 9.0, fn: () => { this.audio.sfx('thunder'); this.ui.flashLightning(); } },
        { at: 12.2, fn: () => { this._introCloseWant = 1.0; this.audio.sfx('charge'); } },
        { at: 15.4, fn: () => { this.audio.sfx('slam'); this.ui.flashLightning(); } },
        { at: 17.6, fn: () => this.audio.sfx('idolRise') },
        { at: 22.0, fn: () => this.audio.sfx('stinger') },
        { at: 24.4, fn: () => this.audio.sfx('surfWash') },
        { at: 28.6, fn: () => this.audio.sfx('orbShatter') },
        { at: 30.6, fn: () => { ST.visible = false; this.setStageMode(false); this.audio.sfx('stormAmbience'); } },
        { at: 31.8, fn: () => { this.audio.sfx('thunder'); this.ui.flashLightning(); } },
        { at: 34.0, fn: () => this.audio.sfx('shipBreak') },
        { at: 36.0, fn: () => { this.audio.sfx('thunder'); this.ui.flashLightning(); } },
        { at: 37.0, fn: () => this.audio.sfx('shipBreak') },
        { at: 37.8, fn: () => { this.introClearing = true; this.audio.playMusic('island'); } },
        { at: 38.2, fn: () => this.audio.sfx('dawn') },
        { at: 42.4, fn: () => this.audio.sfx('surfWash') },
        { at: 44.6, visualOnly: true, fn: () => this.fade(0, 1200) },
      ],
      onDone: () => { ST.visible = false; this.setStageMode(false); this._introClose = null; this.endIntro(); },
    }, this.islandScene);
  }

  /**
   * The legend beats are lit theatre in a black void. The island's sky
   * dome follows the camera and its ocean stretches to the horizon, so
   * both show up behind the pocket stage unless we strike the set.
   */
  setStageMode(on) {
    if (this._stageMode === on) return;
    this._stageMode = on;
    const sc = this.islandScene;
    for (const o of [this.ocean, this.sky, this.terrain, this.surf, this.clouds,
                     this.birds, this.critters]) {
      if (o) o.visible = !on;
    }
    if (on) {
      this._savedFog = { near: sc.fog.near, far: sc.fog.far, color: sc.fog.color.getHex(),
                         bg: sc.background.getHex() };
      sc.fog.color.setHex(0x000000);
      sc.fog.near = 14; sc.fog.far = 46;
      sc.background.setHex(0x000000);
      if (this.sun) this.sun.intensity = 0.12;
      if (this.ambient) this.ambient.intensity = 0.16;
      if (this.hemi) this.hemi.intensity = 0.08;
    } else if (this._savedFog) {
      sc.fog.color.setHex(this._savedFog.color);
      sc.fog.near = this._savedFog.near;
      sc.fog.far = this._savedFog.far;
      sc.background.setHex(this._savedFog.bg);
      if (this.sun) this.sun.intensity = 1.45;
      if (this.ambient) this.ambient.intensity = 1.05;
      if (this.hemi) this.hemi.intensity = 0.75;
    }
  }

  /** Drive the sky/sea between squall and morning during the opening. */
  updateIntroWeather(dt) {
    // While the camera is on the pocket stage the sky is irrelevant and the
    // storm dimming just crushes the sets, so hold off until we cut to sea.
    if (this.introStage?.visible) return;
    const target = this.introClearing ? 0 : 1;
    this.introStorm += (target - this.introStorm) * Math.min(1, dt * 0.42);
    const k = this.introStorm;
    const f = this.islandScene.fog;
    f.color.setRGB(
      THREE.MathUtils.lerp(0.706, 0.11, k),
      THREE.MathUtils.lerp(0.816, 0.13, k),
      THREE.MathUtils.lerp(0.831, 0.17, k));
    f.near = THREE.MathUtils.lerp(46, 8, k);
    f.far = THREE.MathUtils.lerp(235, 90, k);
    this.islandScene.background.setRGB(
      THREE.MathUtils.lerp(0.561, 0.07, k),
      THREE.MathUtils.lerp(0.769, 0.09, k),
      THREE.MathUtils.lerp(0.867, 0.13, k));
    if (this.sun) this.sun.intensity = THREE.MathUtils.lerp(1.45, 0.18, k);
    this.sky.material.opacity = 1 - k * 0.95;
    this.sky.material.transparent = k > 0.02;
    if (this.storm) {
      if (k > 0.5 && !this.storm.active) this.storm.start();
      if (k < 0.25 && this.storm.active && this.found.size < 4) this.storm.stop();
      this.storm.tick(this.time, dt, this.camera.position);
    }
  }

  /** You come round on the sand: blur, first light, getting up. */
  playWakeCutscene() {
    const P = () => this.player.pos;
    const eye = (h) => new THREE.Vector3(P().x, P().y + h, P().z);

    this.playCutscene({
      shots: [
        { // face down in the sand, half-lidded
          dur: 3.6, ease: 'linear',
          from: () => eye(0.22).add(new THREE.Vector3(0.4, 0, 0.5)),
          to: () => eye(0.30).add(new THREE.Vector3(0.1, 0, 0.3)),
          lookFrom: () => eye(0.16).add(new THREE.Vector3(2.2, 0, 1.4)),
          lookTo: () => eye(0.26).add(new THREE.Vector3(2.6, 0.3, 1.0)),
        },
        { // pushing up onto the knees
          dur: 3.2, ease: 'easeOut',
          from: () => eye(0.34).add(new THREE.Vector3(1.6, 0, 2.0)),
          to: () => eye(1.0).add(new THREE.Vector3(2.0, 0, 2.6)),
          lookFrom: () => eye(0.5), lookTo: () => eye(1.0),
        },
        { // upright, and the island is looking back
          dur: 4.0, ease: 'smooth',
          from: () => eye(1.4).add(new THREE.Vector3(2.4, 0.4, 3.2)),
          to: () => eye(1.5).add(new THREE.Vector3(-2.2, 0.6, 4.4)),
          lookFrom: () => eye(1.2), lookTo: () => eye(1.3),
        },
      ],
      text: [
        { at: 0.5, until: 3.4, text: 'You are alive.\nThat was not the plan either way.' },
        { at: 4.4, until: 7.6, text: 'Salt, sand, and somebody else\'s campfire\nsomewhere behind you.' },
        { at: 8.4, until: 10.6, text: 'ILLIC ISLE' },
      ],
      events: [
        { at: 0.0, visualOnly: true, fn: () => this.fade(1, 1800) },
        { at: 0.3, fn: () => this.audio.sfx('surfWash') },
        { at: 3.4, fn: () => this.audio.sfx('step_sand') },
        { at: 3.9, fn: () => this.audio.sfx('land') },
        { at: 8.2, fn: () => this.audio.sfx('stinger') },
        { at: 5.6, fn: () => this.audio.sfx('surfWash') },
      ],
      onDone: () => this.finishOpening(),
    }, this.islandScene);
  }

  finishOpening() {
    setCinemaBars(false);
    this.state = 'island';
    this.fade(1, 600);
    this.ui.show();
    this.ui.setObjective('Look around the camp. Somebody was here before you.');
    this._requestLock();
    setTimeout(() => this.ui.toast('WASHED ASHORE - ILLIC ISLE', 'gold', 3600), 400);
  }

  endIntro() {
    setCinemaBars(false);
    this.introClearing = true;
    this.introStorm = 0;
    if (this.storm && this.found.size < 4) this.storm.stop();
    // restore fair weather explicitly, in case the lerp hasn't settled
    this.islandScene.fog.color.setHex(0xb4d0d4);
    this.islandScene.fog.near = 46;
    this.islandScene.fog.far = 235;
    this.islandScene.background.setHex(0x8fc4dd);
    if (this.sun) this.sun.intensity = 1.45;
    this.sky.material.opacity = 1;
    this.sky.material.transparent = false;

    // the storm hands straight over to coming round on the sand
    this.playWakeCutscene();
  }

  /* ---------- descending into the temple ---------- */
  playDescentCutscene() {
    const d = this.templeDoorPos;
    const yaw = this.templeDoor.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const outside = (n, y) => new THREE.Vector3(d.x + fx * n, d.y + y, d.z + fz * n);

    this.playCutscene({
      shots: [
        { dur: 3.4, ease: 'easeOut',
          from: outside(20, 7), to: outside(9, 4.2),
          look: outside(0, 4.0) },
        { dur: 3.2, ease: 'easeIn',
          from: outside(9, 4.0), to: outside(-2.5, 3.4),
          look: outside(-9, 2.6) },
      ],
      text: [
        { at: 0.6, until: 3.2, text: 'THE STAIR GOES DOWN A LONG WAY.' },
        { at: 4.0, until: 6.4, text: 'Something below has been cooking\nfor eleven years.' },
      ],
      events: [
        { at: 0.2, visualOnly: true, fn: () => this.audio.sfx('rumble') },
        { at: 3.6, fn: () => this.audio.sfx('descend') },
        { at: 5.9, visualOnly: true, fn: () => this.fade(0, 700) },
      ],
      onDone: () => {
        setCinemaBars(false);
        this._doEnterTemple();
      },
    }, this.islandScene);
  }

  /** Each Pendulum wakes up when you read its plate. */

  /* ---------- Hector goes down ---------- */
  /** Each Pendulum wakes up when you read its plate. */
  playPendulumCutscene(index, p) {
    const tower = this.pendulumMeshes[index];
    const base = tower.position.clone();
    const top = base.clone().add(new THREE.Vector3(0, 12, 0));
    const glyphY = base.clone().add(new THREE.Vector3(0, 4.6, 0));

    tower.userData.activate();
    this._pendBoost = null;

    this.playCutscene({
      shots: [
        { // up the shaft to the glyph plate
          dur: 3.0, ease: 'easeOut',
          from: base.clone().add(new THREE.Vector3(7, 2.0, 9)),
          to: base.clone().add(new THREE.Vector3(2.6, 4.4, 4.4)),
          look: glyphY,
        },
        { // climb to the slot; the bob is swinging hard now
          dur: 3.4, ease: 'smooth', shake: 0.06,
          from: base.clone().add(new THREE.Vector3(3.0, 6, 6)),
          to: base.clone().add(new THREE.Vector3(-1.4, 13, 7.5)),
          lookFrom: glyphY,
          lookTo: base.clone().add(new THREE.Vector3(0, 12.5, 0)),
        },
        { // wide, as the beam goes up
          dur: 3.0, ease: 'smooth',
          from: base.clone().add(new THREE.Vector3(-6, 14, 14)),
          to: base.clone().add(new THREE.Vector3(-12, 22, 22)),
          look: top,
        },
      ],
      text: [
        { at: 0.5, until: 3.0, text: `ROGUE PENDULUM ${['I', 'II', 'III', 'IV'][p.order - 1]}` },
        { at: 4.0, until: 6.6, text: `GLYPH RECORDED - THE ${p.glyph}` },
        { at: 7.2, until: 9.4, text: `${this.found.size} OF 4` },
      ],
      events: [
        { at: 0.2, fn: () => this.audio.sfx('cast') },
        { at: 2.9, fn: () => this.audio.sfx('rumble') },
        { at: 6.2, fn: () => this.audio.sfx('pickup') },
        { at: 6.4, fn: () => this.audio.sfx('door') },
      ],
      onDone: () => {
        this._pendBoost = null;
        if (tower.userData.setNight) tower.userData.setNight(this.night);
        setCinemaBars(false);
        this.state = 'island';
        this.ui.show();
        this.ui.setMarks(this.found.size, 4);
        this._refreshCompass();
        if (this.found.size >= 4) {
          this.ui.setObjective('All four glyphs recorded. Set the temple door in order.');
          setTimeout(() => this.ui.toast('ALL FOUR PENDULUMS READ', 'jade', 4000), 500);
        } else {
          this.ui.setObjective(`Pendulums read: ${this.found.size}/4.`);
        }
        this.showReader(p.title, p.text);
      },
    }, this.islandScene);
  }

  /* ---------- Hector goes down ---------- */
  playDefeatCutscene() {
    const H = this.hector;
    const hp = () => new THREE.Vector3(H.pos.x, H.pos.y, H.pos.z);
    const chest = () => new THREE.Vector3(H.pos.x, H.pos.y + 2.4, H.pos.z);
    const orb = () => H.gemWorldPos(new THREE.Vector3());
    const D = TEMPLE.daisCenter;

    this.playCutscene({
      shots: [
        { // hard in on the orb as it fails
          dur: 3.0, ease: 'easeOut', shake: 0.10,
          from: () => orb().add(new THREE.Vector3(2.6, 0.8, 3.4)),
          to: () => orb().add(new THREE.Vector3(1.4, 0.2, 1.8)),
          lookFrom: orb, lookTo: orb,
        },
        { // pull back: the man himself, folding up
          dur: 4.0,
          from: () => hp().add(new THREE.Vector3(5, 3.4, 9)),
          to: () => hp().add(new THREE.Vector3(-1, 5.6, 13)),
          lookFrom: chest,
          lookTo: () => hp().add(new THREE.Vector3(0, 1.2, 0)),
        },
        { // the seal lets go and the dais opens up
          dur: 4.6, ease: 'smooth',
          from: new THREE.Vector3(D.x + 10, 9, D.z + 22),
          to: new THREE.Vector3(D.x, 6.5, D.z + 12),
          look: new THREE.Vector3(D.x, TEMPLE.daisHeight + 3.4, D.z),
        },
      ],
      text: [
        { at: 3.4, until: 7.2, text: 'THE ETERNAL COMBO IS BROKEN.' },
        { at: 8.2, until: 11.4, text: 'The seal remembers whose it was.' },
      ],
      events: [
        {
          at: 0.7, fn: () => {
            this.audio.sfx('orbShatter');
            const orbMesh = H.parts.orb;
            orbMesh.visible = false;
            H.parts.orbLight.intensity = 0;
          },
        },
        { at: 1.0, fn: () => this.audio.sfx('bossDie') },
        { at: 3.2, fn: () => this.audio.sfx('rumble') },
        {
          at: 7.6, fn: () => {
            const s = this.templeSeal;
            s.seal.visible = false;
            s.bars.forEach((b) => (b.visible = false));
            this.audio.sfx('door');
          },
        },
      ],
      onDone: () => {
        setCinemaBars(false);
        this.state = 'temple';
        this.ui.show();
        this.ui.setObjective('Take the Idol.');
        this.audio.playMusic('temple');
        this._requestLock();
        setTimeout(() => {
          this.showReader('HECTOR — EL BASS PRESIDENTE',
`"...fine.

Take it. Take the little gold man. He was never
much company anyway — always smiling, never once
said a word about the food.

Eleven years I held every office on this island.
Eleven years. Unopposed.

Go on. I'll be fine.

I have snacks."`);
        }, 900);
      },
    }, this.templeScene);
  }

  /* ---------- claiming the Idol ---------- */
  playIdolCutscene() {
    const D = TEMPLE.daisCenter;
    const idol = this.sanctumIdol;
    const base = TEMPLE.daisHeight + 2.45;
    const idolAt = (h) => new THREE.Vector3(D.x, base + h, D.z);
    const t0 = { v: 0 };

    // drive the idol's own rise from the cutscene clock
    this._idolRise = (dt) => {
      t0.v = Math.min(1, t0.v + dt / 5.0);
      const k = t0.v;
      // Modest lift only — it used to climb 3 units and leave frame.
      idol.position.y = base + k * 1.15;
      idol.rotation.y += dt * (0.5 + k * 1.4);
      idol.scale.setScalar(1.3 + k * 0.30);
    };

    this.playCutscene({
      shots: [
        { // low, reverent push-in from the steps
          dur: 4.0, ease: 'easeOut',
          from: new THREE.Vector3(D.x + 1.2, TEMPLE.daisHeight + 2.2, D.z + 13),
          to: new THREE.Vector3(D.x + 0.4, TEMPLE.daisHeight + 3.2, D.z + 6.4),
          lookFrom: idolAt(1.1), lookTo: idolAt(1.3),
        },
        { // orbit as it lifts — camera stays level with the bust
          dur: 5.0, ease: 'linear',
          from: new THREE.Vector3(D.x + 5.2, TEMPLE.daisHeight + 3.9, D.z + 5.2),
          to: new THREE.Vector3(D.x - 5.2, TEMPLE.daisHeight + 4.3, D.z + 5.0),
          lookFrom: idolAt(1.4), lookTo: idolAt(1.9),
        },
        { // close on the face, then bloom out
          dur: 3.4, ease: 'easeIn',
          from: new THREE.Vector3(D.x - 1.5, TEMPLE.daisHeight + 4.6, D.z + 4.4),
          to: new THREE.Vector3(D.x - 0.3, TEMPLE.daisHeight + 4.4, D.z + 2.9),
          lookFrom: idolAt(2.0), lookTo: idolAt(2.15),
        },
      ],
      text: [
        { at: 1.0, until: 5.4, text: 'THE IDOL OF CHRIS ILLIC' },
        { at: 6.4, until: 10.4, text: 'Cast by people who loved him\nmore than was strictly advisable.' },
      ],
      events: [
        { at: 0.2, fn: () => this.audio.sfx('idolRise') },
        { at: 4.2, fn: () => this.audio.sfx('stinger') },
        { at: 9.6, fn: () => this.audio.sfx('victory') },
        {
          at: 10.4, fn: () => {
            this.pipeline.tint.setRGB(1, 0.92, 0.7);
            this.pipeline.tintAmt = 0;
            this._bloom = 0.001;
          },
        },
      ],
      onDone: () => {
        this._idolRise = null;
        this._bloom = null;
        this.pipeline.tintAmt = 0;
        setCinemaBars(false);
        this.showEnding();
      },
    }, this.templeScene);
  }

  pause(on) {
    if (!this.playing) return;
    this.paused = on;
    if (on) {
      if (this.screens.name !== 'pause') this.screens.push('pause');
      document.exitPointerLock?.();
    } else {
      /* Pop the pause card, do not clear the stack. Clearing took the
         council down with it, which left you standing in the world during
         a meeting with no interface and no way to move or vote. */
      while (this.screens.name === 'pause') this.screens.pop();
      if (!this.screens.open) this._requestLock();
    }
  }

  journalEntries() {
    const out = [{ found: true, title: JOURNAL_INTRO.title, text: JOURNAL_INTRO.text }];
    if (this.hasChart) out.push({ found: true, title: LETTER.title, text: LETTER.text });
    for (const p of PENDULUMS) {
      out.push({
        found: this.found.has(p.id), title: p.title, text: p.text,
        hint: this.hasChart ? p.hint : 'You have nothing to go on yet.',
      });
    }
    for (const k of Object.keys(RELICS)) {
      const R = RELICS[k];
      out.push({
        found: this.relics.has(k), title: R.title, text: R.text,
        hint: 'Something on this island you have not picked up yet.',
      });
    }
    return out;
  }

  toggleJournal() {
    if (this.screens.name === 'journal') { this.screens.pop(); this.afterOverlayClose(); return; }
    document.exitPointerLock?.();
    this.screens.push('journal');
  }

  openChart() {
    if (this.screens.name === 'chart') { this.screens.pop(); this.afterOverlayClose(); return; }
    if (!this.hasChart) {
      this.audio.sfx('deny');
      this.ui.toast('YOU HAVE NO CHART', 'bad', 1500);
      return;
    }
    this.audio.sfx('page');
    this.screens.push('chart', {
      data: {
        heightAt, radius: ISLAND.shore + 14,
        marks: PENDULUMS.map((p) => ({
          x: p.world.x, z: p.world.z,
          label: ['I', 'II', 'III', 'IV'][p.order - 1],
          found: this.found.has(p.id),
          glyph: this.found.has(p.id) ? p.glyph : null,
        })),
        temple: this.templeDoorPos,
        player: this.player.pos,
        facing: this.player.facing,
        casino: this.casinoIn > 0.5 ? this.casinoPos : null,
        wreck: this.wreckPos,
        rogue: this.rogueSandPos,
        hut: this.hutPos,
        cathy: this.cathy ? { x: this.cathy.x, z: this.cathy.z } : null,
        buried: (this.foundX && this.buried)
          ? { x: this.buried.x, z: this.buried.z, taken: this.buried.state.taken } : null,
        // relics get a "?" on the chart until you pick them up — without
        // this they are three specks on a 340-unit island
        relics: this.interactables
          .filter((i) => i.kind === 'relic')
          .map((i) => ({ x: i.x, z: i.z, found: this.relics.has(i.relic), kind: i.relic })),
      },
    });
    document.exitPointerLock?.();
  }

  /* ===========================================================
     INTERACTION
     =========================================================== */
  nearestInteractable() {
    const p = this.player.pos;
    let best = null, bestD = Infinity;

    if (this.state === 'temple') {
      const de = Math.hypot(p.x - TEMPLE.entrance.x, p.z - TEMPLE.entrance.z);
      if (de < 5.5) { bestD = de; best = { kind: 'templeExit', prompt: 'Climb back to the jungle' }; }
      for (const c of this.templeCaches) {
        if (c.cooldown > 0) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < 3.0 && d < bestD && this.coconutCount < this.coconutMax) {
          bestD = d; best = { kind: 'cache', cache: c, prompt: 'Gather coconuts' };
        }
      }
      if (this.melonNode && !this.relics.has('watermelon')) {
        const d = Math.hypot(p.x - this.melonNode.x, p.z - this.melonNode.z);
        if (d < 3.2 && d < bestD) {
          bestD = d;
          best = { kind: 'relic', relic: 'watermelon', mesh: this.melonNode.mesh,
                   once: true, taken: false, prompt: 'Examine the watermelon' };
        }
      }
      if (this.hectorDefeated && !this.idolTaken) {
        const D = TEMPLE.daisCenter;
        const d = Math.hypot(p.x - D.x, p.z - D.z);
        // generous: the dais is wide and this is the last action in the game
        if (d < 8.0 && d < bestD) { bestD = d; best = { kind: 'takeIdol', prompt: 'TAKE THE IDOL OF CHRIS ILLIC' }; }
      }
      return best;
    }

    for (const it of this.interactables) {
      if (it.once && it.taken) continue;
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      if (d < it.r && d < bestD) { bestD = d; best = it; }
    }
    for (const pile of this.coconutPiles) {
      if (pile.cooldown > 0) continue;
      const d = Math.hypot(p.x - pile.x, p.z - pile.z);
      if (d < 2.6 && d < bestD && this.coconutCount < this.coconutMax) {
        bestD = d; best = { kind: 'coconutPile', pile, prompt: 'Gather coconuts' };
      }
    }
    for (const c of this.syncoins) {
      if (c.taken) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < 4.2 && d < bestD) { bestD = d; best = { kind: 'coin', coin: c, prompt: 'Take Syncoin' }; }
    }
    if (this.cathy) {
      const d = Math.hypot(p.x - this.cathy.x, p.z - this.cathy.z);
      if (d < 5.0 && d < bestD) { bestD = d; best = { kind: 'cathy', prompt: 'Cathy' }; }
    }
    if (this.buried) {
      const bu = this.buried;
      const d = Math.hypot(p.x - bu.x, p.z - bu.z);
      if (d < 3.2 && d < bestD) {
        bestD = d;
        if (!this.foundX) { this.foundX = true; this._refreshCompass(); }
        if (bu.state.taken) best = { kind: 'dug', prompt: 'Nothing left in it' };
        else if (bu.state.dug >= 1) best = { kind: 'chest', prompt: 'Open it' };
        else best = { kind: 'dig', prompt: bu.state.dug > 0.02 ? 'Keep digging' : 'Dig' };
      }
    }
    return best;
  }

  interact() {
    if (this.paused || this.anyOverlayOpen() || !this.playing) return;
    const it = this.nearestInteractable();
    if (!it) return;

    switch (it.kind) {
      case 'journal':
        this.audio.sfx('page');
        this.showReader(JOURNAL_INTRO.title, JOURNAL_INTRO.text);
        break;

      case 'letter': {
        it.taken = true;
        this.hasChart = true;
        if (it.mesh) it.mesh.visible = false;
        this.audio.sfx('pickup');
        this.showReader(LETTER.title, LETTER.text);
        this.ui.setObjective('Find all four Rogue Pendulums. Press M for the chart.');
        this._refreshCompass();
        setTimeout(() => this.ui.toast('CHART ACQUIRED — PRESS M', 'jade', 3600), 600);
        break;
      }

      case 'pendulum': {
        const p = PENDULUMS[it.index];
        if (this.found.has(p.id)) return;
        it.taken = true;
        this.found.add(p.id);
        this.playPendulumCutscene(it.index, p);
        return;
      }

      case 'templeDoor':
        if (this.doorSolved) { this.enterTemple(); return; }
        if (this.found.size < 4) {
          this.audio.sfx('deny');
          this.showReader('THE SEALED DOOR',
            `Four sockets in the lintel, each worn into a shallow ring.\n\n` +
            `You have read ${this.found.size} of the four Pendulums. ` +
            `Without all of them you have no idea what order these go in.`);
          return;
        }
        this.openDials();
        break;

      case 'coconutPile': {
        const got = Math.min(this.coconutMax - this.coconutCount, 3);
        this.coconutCount += got;
        it.pile.cooldown = 25;
        it.pile.mesh.visible = false;
        this.audio.sfx('coconut');
        this.ui.toast(`+${got} COCONUTS`, 'gold', 1400);
        break;
      }
      case 'cache': {
        const got = Math.min(this.coconutMax - this.coconutCount, 4);
        this.coconutCount += got;
        it.cache.cooldown = 14;
        it.cache.mesh.visible = false;
        this.audio.sfx('coconut');
        this.ui.toast(`+${got} COCONUTS`, 'gold', 1400);
        break;
      }
      case 'ferdi': this.openShop(); break;

      case 'relic': {
        it.taken = true;
        if (it.mesh) it.mesh.visible = false;
        this.relics.add(it.relic);
        if (it.relic === 'syncoin') this.coins += 3;
        this.audio.sfx('pickup');
        const R = RELICS[it.relic];
        this.ui.showPopup(R.title, `RELIC ${this.relics.size} OF 4`, it.relic);
        this.showReader(R.title, R.text);
        break;
      }

      case 'coin': {
        it.coin.taken = true;
        this.coins++;
        this.audio.sfx('coin');
        this.startCoinFlourish(it.coin);
        this.ui.toast(`SYNCOIN  x${this.coins}`, 'gold', 1400);
        break;
      }

      case 'cathy': this.openCathy(); break;
      case 'dig': case 'dug': break;      // held, not pressed
      case 'chest': this.openChestSP(); break;
      case 'templeExit': this.exitTemple(); break;
      case 'takeIdol': this.takeIdol(); break;
    }
  }

  shopStock() {
    return SHOP.map((it) => ({
      ...it, owned: this.bought.has(it.id), afford: this.coins >= it.cost,
    }));
  }

  openShop() {
    document.exitPointerLock?.();
    this.screens.push('shop');
  }

  buy(id) {
    const item = SHOP.find((i) => i.id === id);
    if (!item || this.bought.has(id)) return false;
    if (this.coins < item.cost) { this.audio.sfx('deny'); return false; }
    this.coins -= item.cost;
    this.bought.add(id);
    this.audio.sfx('confirm');

    if (id === 'heart') { this.player.maxHp += 1; this.player.hp = this.player.maxHp; }
    if (id === 'satchel') { this.coconutMax = 14; }
    if (id === 'boots') { this.player.SPRINT = 19.5; this.player.staminaDrain = this.player.BASE_DRAIN * 0.65; }

    this.ui.toast(`FERDI: ${item.name}. NO REFUNDS.`, 'jade', 3000);
    return true;
  }

  closeShop() {
    if (this.screens.name === 'shop') this.screens.pop();
    this.afterOverlayClose();
  }

  showReader(head, body, onDone) {
    document.exitPointerLock?.();
    this.ui.showReader(head, body, onDone);
  }

  /* ---------- dial puzzle ---------- */
  openDials() {
    document.exitPointerLock?.();
    this.dialSel = 0;
    this.screens.push('dials', { shake: 0 });
  }
  knownGlyphHint() {
    return PENDULUMS
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => (this.found.has(p.id) ? `${['I', 'II', 'III', 'IV'][p.order - 1]}=${p.glyph}` : '?'))
      .join('   ');
  }
  cycleDial(dir) {
    this.dialState[this.dialSel] =
      (this.dialState[this.dialSel] + dir + GLYPH_NAMES.length) % GLYPH_NAMES.length;
    this.audio.sfx('select');
  }
  submitDials() {
    const ok = this.dialState.every((v, i) => GLYPH_NAMES[v] === DOOR_CODE[i]);
    if (!ok) {
      this.audio.sfx('deny');
      this.ui.toast('THE SOCKETS GRIND, AND SETTLE BACK.', 'bad', 2000);
      return false;
    }
    this.doorSolved = true;
    this.closeDials();
    this.audio.sfx('door');
    this.ui.toast('THE DOOR REMEMBERS THE ORDER', 'jade', 4000);
    this.ui.setObjective('The temple is open. Go down.');
    this.updateSockets();
    return true;
  }
  closeDials() {
    if (this.screens.name === 'dials') this.screens.pop();
    this.afterOverlayClose();
  }
  updateSockets() {
    const socks = this.templeDoor.userData.sockets;
    socks.forEach((s, i) => {
      const on = this.doorSolved;
      const c = s.geometry.attributes.color;
      const col = on ? [1.0, 0.84, 0.30] : [0.17, 0.19, 0.22];
      for (let v = 0; v < c.count; v++) c.setXYZ(v, col[0], col[1], col[2]);
      c.needsUpdate = true;
    });
  }

  /* ===========================================================
     SCENE TRANSITIONS
     =========================================================== */
  /** Fade the composite in/out. A new call cancels any fade already in
   *  flight — otherwise a skipped cutscene can leave a stale fade-to-black
   *  running underneath the fade-to-clear and the screen stays dark. */
  async fade(to, ms = 500) {
    const token = (this._fadeToken = (this._fadeToken || 0) + 1);
    const from = this.pipeline.fade;
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => {
        if (this._fadeToken !== token) { res(); return; }
        const k = Math.min(1, (performance.now() - t0) / ms);
        this.pipeline.fade = from + (to - from) * k;
        if (k < 1) requestAnimationFrame(tick); else res();
      };
      tick();
    });
  }

  enterTemple() {
    if (this.transitioning) return;
    if (!this.seenDescent) {
      this.seenDescent = true;
      this.playDescentCutscene();
      return;
    }
    this._doEnterTemple();
  }

  async _doEnterTemple() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.player.frozen = true;
    await this.fade(0, 400);

    this.state = 'temple';
    this.scene = this.templeScene;
    this.player.mesh.removeFromParent();
    this.templeScene.add(this.player.mesh);
    this.player.setColliders([]);
    this.player.teleport(TEMPLE.entrance.x, templeHeight(TEMPLE.entrance.x, TEMPLE.entrance.z) + 0.5,
      TEMPLE.entrance.z - 2, Math.PI);
    this.clearCoconuts();

    if (!this.hector) {
      this.hector = new Hector(this.templeScene, this.propMats, {
        box: { minX: -TEMPLE.halfX, maxX: TEMPLE.halfX, minZ: -TEMPLE.halfZ, maxZ: TEMPLE.halfZ },
        floorY: templeHeight(0, 0),
        groundAt: templeHeight,
      }, {
        onDamagePlayer: (n, src) => this.hurtPlayer(n, src),
        onSay: (t, ms) => this.ui.toast(t, 'bad', ms),
        onPhase: (p) => this.onBossPhase(p),
        onDefeat: () => this.onBossDefeat(),
        sfx: (n) => this.audio.sfx(n),
      });
    }

    this.audio.playMusic('temple');
    // The descent cutscene hid the HUD; nothing was bringing it back, which
    // is why the temple looked like it had no UI at all.
    this.ui.show();
    this.ui.setObjective('Something has been living down here for eleven years.');
    this.ui.setCompassPois([
      { label: 'OUT', x: TEMPLE.entrance.x, z: TEMPLE.entrance.z, kind: 'poi' },
      { label: 'IDOL', x: TEMPLE.daisCenter.x, z: TEMPLE.daisCenter.z, kind: 'goal' },
    ]);

    this.player.frozen = false;
    await this.fade(1, 650);
    this.transitioning = false;
    this._requestLock();
  }

  async exitTemple() {
    if (this.transitioning) return;
    if (this.hector?.active && !this.hector.dead) {
      this.ui.toast('HE IS NOT DONE TALKING', 'bad', 1800);
      this.audio.sfx('deny');
      return;
    }
    this.transitioning = true;
    this.player.frozen = true;
    await this.fade(0, 500);

    this.state = 'island';
    this.scene = this.islandScene;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    const d = this.templeDoorPos;
    this.player.teleport(d.x * 1.03, d.y + 2, d.z * 1.03, Math.atan2(d.x, d.z));
    this.clearCoconuts();

    this.audio.playMusic('island');
    this.ui.showBoss(false);
    this._refreshCompass();

    this.player.frozen = false;
    await this.fade(1, 600);
    this.transitioning = false;
    this._requestLock();
  }

  /* ===========================================================
     COMBAT
     =========================================================== */
  throwCoconut() {
    if (this.coconutCount <= 0) {
      this.audio.sfx('deny');
      this.ui.toast('OUT OF COCONUTS', 'bad', 1100);
      return;
    }
    if (this.throwCooldown > 0) return;
    this.throwCooldown = 0.35;
    this.coconutCount--;
    this.stats.thrown++;
    this.player.playThrow();
    this.audio.sfx('throw');

    const mesh = this.coconutProto.clone();
    const pos = this.player.throwOrigin();
    const dir = this.player.throwDir();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.coconuts.push({
      mesh, pos: pos.clone(), vel: dir.multiplyScalar(30), life: 5,
      spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
    });
  }

  /** The coin leaps, spins up and shrinks away — you should see it go. */
  startCoinFlourish(coin) {
    this.coinFx = this.coinFx || [];
    const m = coin.mesh;
    m.userData.flourish = true;
    this.coinFx.push({
      mesh: m, t: 0, dur: 0.85,
      from: m.position.clone(),
      spin: 14 + Math.random() * 6,
    });
  }

  updateCoinFx(dt) {
    if (!this.coinFx || !this.coinFx.length) return;
    for (let i = this.coinFx.length - 1; i >= 0; i--) {
      const f = this.coinFx[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const ease = 1 - Math.pow(1 - k, 2);
      f.mesh.position.set(
        f.from.x,
        f.from.y + 0.4 + Math.sin(k * Math.PI) * 2.4,
        f.from.z
      );
      f.mesh.rotation.y += f.spin * dt;
      f.mesh.scale.setScalar(Math.max(0.001, 1 - ease * 0.95));
      if (k >= 1) {
        f.mesh.visible = false;
        f.mesh.scale.setScalar(1);
        f.mesh.userData.flourish = false;
        this.coinFx.splice(i, 1);
      }
    }
  }

  clearCoconuts() {
    for (const c of this.coconuts) c.mesh.removeFromParent();
    this.coconuts.length = 0;
  }

  updateCoconuts(dt) {
    const inTemple = this.state === 'temple';
    const groundOf = inTemple ? templeHeight : heightAt;
    for (let i = this.coconuts.length - 1; i >= 0; i--) {
      /* The killing blow on Hector clears every coconut in flight from
         inside this very loop, so by the next iteration the array is
         shorter than the index we are walking down from. */
      const c = this.coconuts[i];
      if (!c) continue;
      c.vel.y -= 24 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.life -= dt;
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;

      let done = false;
      if (inTemple && this.hector) {
        const hit = this.hector.testHit(c.pos, 0.45);
        if (hit) {
          done = true;
          this.stats.hits++;
          if (hit.kind === 'gem') { this.audio.sfx('gemHit'); this.ui.toast('THE ORB! CRITICAL!', 'gold', 1000); }
          else if (hit.kind === 'nugget') this.ui.toast('NUGGET DOWN', 'gold', 700);
        }
      }
      if (!done && c.pos.y < groundOf(c.pos.x, c.pos.z) - 0.1) { done = true; this.audio.sfx('splat'); }
      if (!done && c.life <= 0) done = true;
      if (done) { c.mesh.removeFromParent(); this.coconuts.splice(i, 1); }
    }
  }

  hurtPlayer(n) {
    if (!this.player.damage(n)) return;
    this.audio.sfx('hurt');
    this.ui.flashDamage();
    this.pipeline.tint.setRGB(0.7, 0.05, 0.02);
    this.pipeline.tintAmt = 0.45;
    if (this.player.dead) this.onDeath();
  }

  onBossPhase(p) {
    if (p === 2) {
      this.hector.say("YOU HAVEN'T EVEN SEEN THE SIDES.", 3000);
      this.ui.setBoss(this.hector.hpFrac, 'TERM TWO');
    } else if (p === 3) {
      this.hector.say("I HAVEN'T BEEN HUNGRY IN ELEVEN YEARS!", 3400);
      this.ui.setBoss(this.hector.hpFrac, 'TERM THREE — NO LIMITS');
    }
    this.audio.sfx('bossIntro');
  }

  onBossDefeat() {
    this.hectorDefeated = true;
    this.audio.stopMusic();
    this.ui.showBoss(false);
    this.clearCoconuts();
    // let his collapse animation get a beat in before the camera takes over
    setTimeout(() => this.playDefeatCutscene(), 700);
  }

  onDeath() {
    this.audio.sfx('die');
    this.audio.stopMusic();
    this.stats.deaths++;
    this.deathScene = this.scene;
    this.state = 'dead';
    document.exitPointerLock?.();
    const subs = [
      'The isle keeps what it takes.',
      'El Bass Presidente remains in office.',
      'You were out-catered.',
      'Democracy is a delicious idea.',
      'He did not even use the good staff.',
    ];
    const sub = subs[Math.floor(Math.random() * subs.length)];
    setTimeout(() => {
      this.ui.hide();
      this.screens.replace('death', { sub });
    }, 900);
  }

  respawn() {
    this.screens.clear();
    this.ui.show();
    this.player.hp = this.player.maxHp;
    this.player.invuln = 2;
    this.player.stamina = 1;

    if (this.hector && this.hector.active && !this.hector.dead) {
      this.hector.hp = this.hector.maxHp;
      this.hector.phase = 1;
      this.hector.state = 'sleep';
      this.hector.active = false;
      this.hector.clearProjectiles();
      this.hector.pos.set(0, templeHeight(0, -6), -6);
      this.ui.showBoss(false);
      this.bossTriggered = false;
    }

    if (this.deathScene === this.templeScene) {
      this.state = 'temple';
      this.player.teleport(TEMPLE.entrance.x, templeHeight(TEMPLE.entrance.x, TEMPLE.entrance.z) + 0.5,
        TEMPLE.entrance.z - 2, Math.PI);
      this.audio.playMusic('temple');
    } else {
      this.state = 'island';
      this.player.teleport(this.spawn.x, this.spawn.y + 1, this.spawn.z, Math.atan2(-this.spawn.x, -this.spawn.z));
      this.audio.playMusic('island');
    }
    this.coconutCount = Math.max(this.coconutCount, 3);
    this._requestLock();
  }

  takeIdol() {
    if (this.idolTaken) return;
    this.idolTaken = true;
    this.player.frozen = true;
    this.playIdolCutscene();
  }

  showEnding() {
    this.state = 'ending';
    this.ui.hide();
    this.audio.stopMusic();
    const t = this.runTime;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    const cs = String(Math.floor((t * 100) % 100)).padStart(2, '0');
    const acc = this.stats.thrown ? Math.round((this.stats.hits / this.stats.thrown) * 100) : 0;
    this.endingSummary =
      `Illic Isle cleared in ${mm}:${ss}.${cs} — ${this.stats.deaths} death${this.stats.deaths === 1 ? '' : 's'}, ` +
      `${this.relics.size}/4 relics, ${acc}% coconut accuracy. El Bass Presidente has been term-limited.`;
    this.screens.replace('ending', {
      stats: {
        time: `${mm}:${ss}.${cs}`,
        rows: [
          ['DEATHS', String(this.stats.deaths)],
          ['RELICS', `${this.relics.size}/4`],
          ['SYNCOINS', String(this.coins)],
          ['THROWN', String(this.stats.thrown)],
          ['ACCURACY', `${acc}%`],
        ],
      },
    });
    this.pipeline.fade = 1;
    this.audio.sfx('victory');
  }

  _boundsWarn() {
    if (this._boundsCd > 0) return;
    this._boundsCd = 4;
    this.ui.toast('The current pushes you back to shore.', 'bad', 2200);
  }

  /* ===========================================================
     MAIN LOOP
     =========================================================== */
  update(dt) {
    this.time += dt;
    setTime(this.time);

    if (this.pipeline.tintAmt > 0) this.pipeline.tintAmt = Math.max(0, this.pipeline.tintAmt - dt * 1.4);
    if (this.throwCooldown > 0) this.throwCooldown -= dt;
    if (this._boundsCd > 0) this._boundsCd -= dt;

    if (this.state === 'title' || this.state === 'ending') { this.updateTitle(dt); return; }
    if (this.state === 'cutscene') {
      if (this._idolRise) this._idolRise(dt);
      if (this._pendBoost) this._pendBoost(dt);
      if (this._bloom != null) {
        this._bloom = Math.min(1, this._bloom + dt * 1.6);
        this.pipeline.tintAmt = this._bloom;
      }
      this.updateCutscene(dt);
      return;
    }
    if (!this.playing) return;

    const frozen = this.paused || this.anyOverlayOpen();
    const inTemple = this.state === 'temple';
    // whatever Cathy sold you, keeping up with where you are
    if (!frozen && !inTemple) this._tickFood();

    // Speedrun clock: only while you actually have control.
    if (!frozen && !this.transitioning) this.runTime += dt;
    this.ui.setTimer(this.runTime);

    if (!frozen) {
      this.player.update(dt, this.input, {
        /* Not raw terrain: the shop's deck and steps, the casino's deck and
           her bridge are all platforms the terrain knows nothing about.
           Single player used heightAt directly, so Ferdi's steps were a
           picture of steps. */
        groundOf: inTemple ? templeHeight : (this.groundOf || heightAt),
        water: !inTemple,
        bounds: !inTemple,
        insideBox: inTemple
          ? { minX: -TEMPLE.halfX, maxX: TEMPLE.halfX, minZ: -TEMPLE.halfZ, maxZ: TEMPLE.halfZ }
          : null,
      });
      if (!inTemple) { this._tide(dt); this._tickDig(dt); }
      this.updateCoconuts(dt);
      this.updateCoinFx(dt);
    } else {
      this.player.updateCamera(dt, inTemple ? templeHeight : heightAt);
    }

    if (inTemple) this.updateTemple(dt, frozen);
    else { this.tickIslandWorld(dt); this.updateIslandLogic(dt, frozen); }

    this.ui.setHearts(this.player.hp, this.player.maxHp);
    this.ui.setStamina(this.player.stamina);
    this.ui.setAmmo(this.coconutCount);
    this.ui.setMarks(this.found.size, 4);
    this.ui.setRelics(this.relics.size);
    this.ui.setCoins(this.coins);
    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);

    const it = frozen ? null : this.nearestInteractable();
    this.ui.setPrompt(it ? it.prompt : null);
  }

  /** Ambient island motion — also runs during the intro. */
  tickIslandWorld(dt) {
    const t = this.time;
    this.ocean.userData.tick(t);
    this.surf.userData.tick(t);
    this.clouds.userData.tick(t, dt, this.night || 0);
    this.birds.userData.tick(t, dt);
    this.critters.userData.tick(t, dt, this.player?.pos);
    this.sky.position.copy(this.camera.position);
    /* The camera goes to every ticker: anything that billboards needs to
       know where the eye is, and passing it here is cheaper than every
       prop reaching back into the game for it. */
    const eye = this.camera.position;
    for (const g of this.tickers) g.userData?.tick?.(t, dt, eye);
    if (this.campfire && !this.doused) {
      this.campfire.userData.light.intensity = 1.8 + Math.sin(t * 11) * 0.45 + Math.sin(t * 6.3) * 0.25;
    }
  }

  /**
   * Day/night. Two minutes of light, two of dark, with dawn and dusk
   * ramps either side. `night` is 0..1 and everything that emits light
   * reads off it.
   */
  /**
   * The Lucky Flopper keeps her own hours. She comes alongside as the light
   * goes and pulls out again at dawn, under her own power, with a wake and
   * a horn — so the night has an event in it that everybody can see from
   * anywhere on the island.
   */
  _sailCasino(dt) {
    if (!this.casino || !this.casinoDock) return;
    const want = this.night > 0.34 ? 1 : 0;
    const prev = this.casinoIn;
    // she is slow: about twenty seconds either way, which is long enough
    // to watch and short enough not to be a wait
    this.casinoIn += (want - this.casinoIn) * Math.min(1, dt * 0.30);
    if (Math.abs(want - this.casinoIn) < 0.002) this.casinoIn = want;

    const k = this.casinoIn;
    // ease-in-out, so she does not snap away from the pier
    const e = k * k * (3 - 2 * k);
    const D = this.casinoDock, O = this.casinoOffing;
    const x = THREE.MathUtils.lerp(O.x, D.x, e);
    const z = THREE.MathUtils.lerp(O.z, D.z, e);
    const dx = x - this.casino.position.x, dz = z - this.casino.position.z;
    this.casino.position.x = x;
    this.casino.position.z = z;

    /* Anyone standing on the deck rides with her for the first few
       seconds, and is then put ashore. Without the ride the boat slides
       out from under your feet; without the eviction you are carried past
       the edge of the playable water, the bounds clamp hauls you back, and
       you drop into the sea for the crime of playing a slot at dawn. */
    const plat = this.casinoPlat;
    if (plat && this.player) {
      const p = this.player.pos;
      const rx = p.x - plat.x, rz = p.z - plat.z;
      const lx = rx * plat.cos - rz * plat.sin;
      const lz = rx * plat.sin + rz * plat.cos;
      const aboard = Math.abs(lx) <= plat.hw && Math.abs(lz) <= plat.hd && p.y > plat.y - 0.8;
      if (aboard && want === 0 && k < 0.80) {
        // over the side, onto the sand at the shore end of the bridge
        const sh = this.casinoShore;
        if (sh) {
          this.player.teleport(sh.x, heightAt(sh.x, sh.z) + 1.0, sh.z, this.player.facing);
          this.audio?.sfx?.('splat');
          this.ui?.toast?.('PUT ASHORE. SHE LEAVES WITHOUT YOU.', 'bad', 3000);
        }
      } else if (aboard && (dx || dz)) {
        // move the position only — teleport() would zero the velocity and
        // snap the camera back in every single frame of the crossing
        p.x += dx; p.z += dz;
      }
    }
    if (plat) { plat.x = x; plat.z = z; }
    this.casinoPos.x = x; this.casinoPos.z = z;

    /* Under way she heels and settles; alongside she just rolls. The tick
       inside the boat handles the roll, so all this adds is the list. */
    const moving = Math.abs(want - k) > 0.01;
    this.casino.position.y = -0.55 - (moving ? 0.12 : 0);

    // the horn, once, on each turn of the tide
    if (prev !== undefined && ((prev < 0.02 && k >= 0.02) || (prev > 0.98 && k <= 0.98))) {
      this.audio?.sfx?.('horn');
      this.ui?.toast?.(want ? 'THE LUCKY FLOPPER IS COMING IN' : 'THE LUCKY FLOPPER IS LEAVING', 'gold', 3200);
    }
  }

  updateDayNight(dt) {
    this.clock24 = (this.clock24 + dt) % this.DAY_LEN;
    const t = this.clock24;                        // seconds through the cycle
    /* Written in seconds rather than fractions, because that is the unit the
       length of a night is actually argued about in. */
    const DAY = 131, DUSK = 19, NIGHT = 191;       // and DAWN is the remainder
    let n;
    if (t < DAY) n = 0;
    else if (t < DAY + DUSK) n = (t - DAY) / DUSK;
    else if (t < DAY + DUSK + NIGHT) n = 1;
    else n = 1 - (t - DAY - DUSK - NIGHT) / (this.DAY_LEN - DAY - DUSK - NIGHT);
    this.night = n * n * (3 - 2 * n);                 // smooth the ramp

    this._sailCasino(dt);

    /* A new day. The clock wraps at DAY_LEN, so a dawn is the moment the
       phase steps backwards — Ferdi marks a different line down each one. */
    {
      const ph = this.clock24 / this.DAY_LEN;
      if (this._lastDawn !== undefined && ph < this._lastDawn - 0.5) this.rollSale?.();
      this._lastDawn = ph;
    }

    const k = this.night;
    const storm = this.storm && this.storm.active ? 1 : 0;
    /* A sabotaged storm is far darker than the scripted one — the point of
       calling it is that nobody can see. */
    let dark = Math.max(k, storm * (this.stormOn ? 0.86 : 0.55));
    /* Night glass. Bought at Ferdi's after dark, it stops the night from
       dimming anything for the person carrying it — the sky still turns,
       the torches still burn, but they can see. */
    // the nightglass, or the Lamplighter, which does the same thing by the
    // hour rather than for good
    if (this.hasItem?.('nightglass') || this.nightEyes) dark *= 0.15;

    // sky and fog
    const f = this.islandScene.fog;
    f.color.setRGB(
      THREE.MathUtils.lerp(0.706, 0.055, dark),
      THREE.MathUtils.lerp(0.816, 0.070, dark),
      THREE.MathUtils.lerp(0.831, 0.115, dark));
    f.far = THREE.MathUtils.lerp(235, 110, dark);
    this.islandScene.background.setRGB(
      THREE.MathUtils.lerp(0.561, 0.030, dark),
      THREE.MathUtils.lerp(0.769, 0.042, dark),
      THREE.MathUtils.lerp(0.867, 0.082, dark));

    // sun becomes a cold moon
    if (this.sun) {
      this.sun.intensity = THREE.MathUtils.lerp(1.45, 0.18, dark);
      this.sun.color.setRGB(
        THREE.MathUtils.lerp(1.0, 0.55, k),
        THREE.MathUtils.lerp(0.94, 0.66, k),
        THREE.MathUtils.lerp(0.81, 1.0, k));
    }
    if (this.ambient) this.ambient.intensity = THREE.MathUtils.lerp(1.05, 0.28, dark);
    if (this.hemi) this.hemi.intensity = THREE.MathUtils.lerp(0.75, 0.20, dark);
    this.sky.material.opacity = 1 - dark * 0.92;
    this.sky.material.transparent = dark > 0.02;
    /* The scene background is what shows THROUGH the sky dome, so it has to
       darken too — otherwise the horizon stays a bright blue band during a
       storm and none of the rest of it convinces. */
    if (this.islandScene.background?.setRGB) {
      this.islandScene.background.setRGB(
        THREE.MathUtils.lerp(0.561, 0.035, dark),
        THREE.MathUtils.lerp(0.769, 0.045, dark),
        THREE.MathUtils.lerp(0.867, 0.070, dark));
    }

    /* Everything that burns. `doused` is the Castaways sabotage: without
       this guard the day/night pass would relight every torch on the next
       frame and the sabotage would be a number on the HUD and nothing else. */
    if (this.doused) {
      for (const t of (this.tikis || [])) {
        if (t.userData.flame) t.userData.flame.visible = false;
        if (t.userData.light) t.userData.light.intensity = 0;
      }
      if (this.campfire) {
        if (this.campfire.userData.flames) this.campfire.userData.flames.visible = false;
        if (this.campfire.userData.light) this.campfire.userData.light.intensity = 0;
      }
      return;
    }
    for (const t of (this.tikis || [])) {
      if (t.userData.flame) t.userData.flame.visible = true;
      t.userData.tick(this.time, dt, dark);
    }
    if (this.campfire) {
      if (this.campfire.userData.flames) this.campfire.userData.flames.visible = true;
      this.campfire.userData.light.intensity =
        (1.4 + dark * 1.6) + Math.sin(this.time * 11) * 0.4;
    }
  }

  updateIslandLogic(dt, frozen) {
    this.updateDayNight(dt);

    /* beacons: on once you have the chart, off as each is read */
    if (this.hasChart) {
      for (const b of this.beacons) b.node.visible = !this.found.has(b.id);
      this.templeBeacon.visible = this.found.size >= 4;
    }
    // the Pendulums themselves burn brighter after dark
    for (const m of (this.pendulumMeshes || [])) {
      if (m.userData.setNight) m.userData.setNight(this.night);
    }

    /* the storm rolls in when the last Pendulum is read */
    if (this.found.size >= 4 && !this.storm.active) {
      this.storm.start();
      this.stormLerp = 0;
      this.ui.toast('THE SKY TURNS OVER', 'bad', 4200);
      this.audio.sfx('thunder');
    }
    // updateDayNight already folds storm darkness into the palette; this
    // just advances the rain and the lightning.
    this.storm.tick(this.time, dt, this.camera.position);

    for (const p of this.coconutPiles) {
      if (p.cooldown > 0) { p.cooldown -= dt; if (p.cooldown <= 0) p.mesh.visible = true; }
    }
    const door = this.templeDoor.userData;
    const want = this.doorSolved ? 1 : 0;
    if (door.open !== want) door.setOpen(THREE.MathUtils.clamp(door.open + dt * 0.4 * (want ? 1 : -1), 0, 1));

    if (this.doorSolved && door.open > 0.85 && !this.transitioning && !frozen) {
      const d = Math.hypot(this.player.pos.x - this.templeDoorPos.x, this.player.pos.z - this.templeDoorPos.z);
      if (d < 3.2) this.enterTemple();
    }
  }

  updateTemple(dt, frozen) {
    const t = this.time;
    this.templeScene.userData.tick?.(t, dt);
    this.sanctumIdol.userData.tick?.(t);

    for (const c of this.templeCaches) {
      if (c.cooldown > 0) { c.cooldown -= dt; if (c.cooldown <= 0) c.mesh.visible = true; }
    }
    if (!this.hector) return;

    if (!this.bossTriggered && !this.hectorDefeated) {
      const d = Math.hypot(this.player.pos.x, this.player.pos.z - 8);
      if (d < 20) {
        this.bossTriggered = true;
        this.hector.wake();
        this.audio.sfx('bossIntro');
        this.audio.playMusic('boss');
        this.ui.showBoss(true);
        this.ui.setBoss(1, 'TERM ONE');
        this.ui.setObjective('Hit the orb on his staff. That is where the food comes from.');
        this.ui.toast('HECTOR — "EL BASS PRESIDENTE"', 'bad', 4000);
        setTimeout(() => this.ui.toast('AH. ANOTHER GUEST.', 'bad', 3000), 1200);
        setTimeout(() => this.ui.toast('THIS ISLAND IS A DEMOCRACY AND I AM ALL OF IT.', 'bad', 3600), 3400);
      }
    }

    if (!frozen) this.hector.update(dt, t, this.player);
    if (this.hector.active && !this.hector.dead) {
      this.ui.setBoss(this.hector.hpFrac);
      const d = Math.hypot(this.player.pos.x - this.hector.pos.x, this.player.pos.z - this.hector.pos.z);
      if (d < 2.3 && this.hector.state !== 'defeat') this.hurtPlayer(1);
    }
  }

  updateTitle(dt) {
    const t = this.time;
    this.titleIdol.rotation.y += dt * 0.28;
    this.titleIdol.userData.tick?.(t);
    // The idol lives in the middle grid track, between the menu and the
    // lore column, so it frames dead centre.
    this.titleCam.position.set(
      Math.sin(t * 0.11) * 0.5,
      1.05 + Math.sin(t * 0.37) * 0.15,
      7.4
    );
    this.titleCam.lookAt(-1.15, 0.42, 0);
  }

  render(dt) {
    // keep the HUD canvas matched to the framebuffer and re-upload it
    const int = this.pipeline.internal;
    if (int) this.ui.hud.setSize(int.w, int.h);
    this.ui.hud.update(dt);
    this.ui.hud.render(this.time);
    this.screens.update(dt);
    this.screens.draw(this.ui.hud.x, this.ui.hud.c.width, this.ui.hud.c.height);
    this.ui.hud.renderCinema(this.time);
    this.pipeline.markHudDirty();

    if (this.state === 'title' || this.state === 'ending') {
      this.titleCam.aspect = this.camera.aspect;
      this.titleCam.updateProjectionMatrix();
      this.pipeline.render(this.titleScene, this.titleCam, dt);
    } else if (this.state === 'cutscene' && this.cutScene) {
      this.pipeline.render(this.cutScene, this.camera, dt);
    } else if (this.scene) {
      this.pipeline.render(this.scene, this.camera, dt);
    }
  }

  loop() {
    const raw = this.clock.getDelta();
    /* Physics wants a capped step so a stall cannot tunnel the player
       through the island. A scripted camera wants real time, or the whole
       shot list stretches out on a slow machine and drifts away from the
       music and the phase timer it is supposed to fit inside. */
    this.rawDt = Math.min(0.25, raw);
    const dt = Math.min(0.05, raw);
    this.update(dt);
    this.render(dt);
    this._fpsAccum = (this._fpsAccum || 0) + dt;
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    if (this._fpsAccum > 0.5) {
      this._fpsSample = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0; this._fpsFrames = 0;
    }
    requestAnimationFrame(() => this.loop());
  }
}
