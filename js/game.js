/* ===========================================================
   game.js — the whole adventure, wired together.
   =========================================================== */

import * as THREE from 'three';
import { RetroPipeline, setJitterEnabled, setTime } from './lib/ps1.js';
import { buildAtlas, makeRng, buildSignTexture } from './lib/textures.js';
import { mergeGeos, tint, plane } from './lib/geo.js';
import { GameAudio } from './lib/audio.js';
import { Cutscene, setCinemaBars } from './lib/cutscene.js';
import { UI } from './ui.js';

import {
  buildTerrain, buildOcean, buildSurf, buildSky, buildClouds,
  heightAt, slopeAt, biomeAt, findBeach, ISLAND,
} from './world/terrain.js';
import {
  buildPropMaterials, scatterIsland, LANDMARKS, findGround,
  buildShipwreck, buildCampfire, buildCastawayCamp, buildSandWriting,
  buildRoguePendulum, buildCoconutPile, buildCoconutMesh, buildSatchel,
  buildBirdFlock, buildCritters, GLYPHS,
} from './world/props.js';
import { buildIdolMaterials, buildIdol, buildIdolShrine } from './world/idol.js';
import { buildTemple, templeHeight, TEMPLE } from './world/temple.js';
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

const JOURNAL_INTRO = {
  title: 'THE CASTAWAY\'S JOURNAL',
  text:
`Day one.

The storm took the ship, the crew, and most of my
good sense. It did not take the reason I came.

Somewhere on this island is the Idol of Chris
Illich, cast in gold by people who thought better
of what they'd made.

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
get you off it: the Idol of Chris Illich, and the
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

    this.input = { fwd: false, back: false, left: false, right: false, sprint: false, jump: false };
    this.mouse = { locked: false };

    this.coconuts = [];
    this.found = new Set();       // pendulum ids read
    this.hasChart = false;
    this.dialState = [0, 0, 0, 0];
    this.dialSel = 0;
    this.doorSolved = false;
    this.stats = { started: 0, deaths: 0, thrown: 0, hits: 0 };

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
    setJitterEnabled(this.settings.jitter);

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.35, 460);
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  applySettings() {
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
      this._buildIslandScene();
      this.templeDoorPos = this._findTempleSpot();
    });

    await step('PLANTING THE JUNGLE', 0.42, () => {
      this.colliders = [];
      const clearZones = Object.keys(LANDMARKS).map((k) => ({
        x: LANDMARKS[k].x, z: LANDMARKS[k].z, r: 15,
      }));
      clearZones.push({ x: this.templeDoorPos.x, z: this.templeDoorPos.z, r: 22 });
      scatterIsland(this.islandScene, this.propMats, makeRng(2468),
        this.settings.density, this.colliders, clearZones);
    });

    await step('RAISING THE PENDULUMS', 0.62, () => this._buildLandmarks());

    await step('OPENING THE TEMPLE', 0.78, () => {
      this.templeScene = buildTemple(this.idolMats, this.propMats);
      this._buildSanctum();
    });

    await step('CASTING THE IDOL', 0.90, () => this._buildTitleScene());

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

    scene.add(new THREE.AmbientLight(0x9cb8c4, 1.05));
    const sun = new THREE.DirectionalLight(0xfff0cf, 1.45);
    sun.position.set(-60, 90, 40);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xcfe8f5, 0x4a5a28, 0.75));

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
    const cg = findGround(wg.x + inX * 9 + 6, wg.z + inZ * 9, { rng, radius: 7, minH: 1.0, maxH: 4, maxSlope: 0.18 });
    const camp = buildCastawayCamp(rng, this.propMats);
    camp.position.set(cg.x, cg.y, cg.z);
    camp.rotation.y = Math.atan2(cg.x, cg.z) + 2.1;
    scene.add(camp);
    this.colliders.push({ x: cg.x, z: cg.z, r: 1.5 });

    const fire = buildCampfire(rng, this.propMats);
    const fg = findGround(wg.x + inX * 7, wg.z + inZ * 7, { rng, radius: 4, minH: 0.9, maxH: 4, maxSlope: 0.18 });
    fire.position.set(fg.x, fg.y, fg.z);
    scene.add(fire);
    this.tickers.push(fire.userData.flames);
    this.campfire = fire;

    // HELP dragged into the sand beside the camp
    const helpPos = findGround(wg.x + inX * 2 - 12, wg.z + inZ * 2 - 6,
      { rng, radius: 10, minH: 0.7, maxH: 2.4, maxSlope: 0.13 });
    const help = buildSandWriting('HELP', this.propMats, { width: 17, height: 5.5, seed: 12 });
    help.position.set(helpPos.x, helpPos.y, helpPos.z);
    help.rotation.y = Math.atan2(helpPos.x, helpPos.z) + Math.PI;
    help.userData.drape(heightAt, helpPos.x, helpPos.z);
    scene.add(help);

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
      tower.position.set(g.x, g.y - 0.3, g.z);
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

    /* ---- the temple door ---- */
    const dg = this.templeDoorPos;
    const door = this._buildTempleDoor(rng, dg);
    scene.add(door);
    this.templeDoor = door;
    this.colliders.push({ x: dg.x, z: dg.z, r: 2.4 });
    this.interactables.push({
      kind: 'templeDoor', x: dg.x, y: dg.y, z: dg.z, r: 6.5,
      prompt: 'Examine the sealed door',
    });

    this._refreshCompass();
  }

  /** A stepped stone doorway set into the ridge, with four glyph sockets. */
  _buildTempleDoor(rng, dg) {
    const group = new THREE.Group();
    const P = [];
    const STONE = new THREE.Color(0x8d8770);

    // stepped ziggurat face
    for (let i = 0; i < 4; i++) {
      const w = 17 - i * 2.4, h = 2.2, d = 4 - i * 0.5;
      const s = mergeGeos([tint(
        (() => { const g = new THREE.BoxGeometry(w, h, d); return g; })(), STONE)]);
      const mesh = new THREE.Mesh(s, this.propMats.opaque);
      mesh.position.set(0, 1.1 + i * h, -i * 1.5);
      group.add(mesh);
    }

    // the doorway itself
    const frameParts = [];
    for (const side of [-1, 1]) {
      const jamb = new THREE.BoxGeometry(1.5, 8, 2.2);
      const g = mergeGeos([tint(jamb, STONE.clone().multiplyScalar(0.9))]);
      const m = new THREE.Mesh(g, this.propMats.opaque);
      m.position.set(side * 3.2, 4, 1.4);
      group.add(m);
    }
    const lintel = new THREE.Mesh(
      mergeGeos([tint(new THREE.BoxGeometry(9, 1.8, 2.4), STONE.clone().multiplyScalar(0.8))]),
      this.propMats.opaque);
    lintel.position.set(0, 8.6, 1.4);
    group.add(lintel);

    // dark interior
    const mouth = new THREE.Mesh(
      mergeGeos([tint(new THREE.PlaneGeometry(5.2, 7.6), new THREE.Color(0x070a06))]),
      this.propMats.opaque);
    mouth.position.set(0, 3.9, 0.9);
    group.add(mouth);

    // the slab that blocks it, which sinks when solved
    const slab = new THREE.Mesh(
      mergeGeos([tint(new THREE.BoxGeometry(5.4, 7.8, 0.9), STONE.clone().multiplyScalar(1.05))]),
      this.propMats.opaque);
    slab.position.set(0, 3.9, 1.3);
    group.add(slab);
    group.userData.slab = slab;

    // four sockets across the lintel
    const sockets = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        mergeGeos([tint(new THREE.BoxGeometry(1.5, 1.5, 0.3), new THREE.Color(0x2c3038))]),
        this.propMats.opaque);
      m.position.set((i - 1.5) * 1.9, 8.6, 2.7);
      group.add(m);
      sockets.push(m);
    }
    group.userData.sockets = sockets;

    const light = new THREE.PointLight(0x8fe6d0, 1.1, 16, 1.8);
    light.position.set(0, 8.6, 3.4);
    group.add(light);
    group.userData.light = light;

    group.position.set(dg.x, dg.y - 0.6, dg.z);
    group.rotation.y = Math.atan2(dg.x - ISLAND.ridge.x, dg.z - ISLAND.ridge.z);
    group.userData.open = 0;
    group.userData.setOpen = (a) => {
      group.userData.open = a;
      slab.position.y = 3.9 - a * 8.2;
      light.intensity = 1.1 + a * 2.2;
    };
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

  _refreshCompass() {
    const pois = [{ label: 'CAMP', x: this.spawn.x, z: this.spawn.z, kind: 'poi' }];
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

    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === this.canvas;
      if (!this.mouse.locked && this.playing && !this.anyOverlayOpen() && !this.paused) {
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

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state === 'cutscene') { this.skipCutscene(); return; }
      if (!this.playing) return;
      if (!this.mouse.locked) { this._requestLock(); return; }
      if (this.paused || this.anyOverlayOpen()) return;
      if (e.button === 0) this.throwCoconut();
    });

    window.addEventListener('blur', () => { if (this.playing) this.pause(true); });
  }

  get playing() { return this.state === 'island' || this.state === 'temple'; }
  anyOverlayOpen() {
    return this.ui.readerActive || this.ui.journalOpen || this.ui.mapOpen || this.ui.dialsOpen;
  }

  _requestLock() { this.canvas.requestPointerLock?.(); }

  _key(e, down) {
    const k = e.code;
    const I = this.input;
    switch (k) {
      case 'KeyW': case 'ArrowUp': if (!this.ui.dialsOpen) I.fwd = down; break;
      case 'KeyS': case 'ArrowDown': if (!this.ui.dialsOpen) I.back = down; break;
      case 'KeyA': case 'ArrowLeft': if (!this.ui.dialsOpen) I.left = down; break;
      case 'KeyD': case 'ArrowRight': if (!this.ui.dialsOpen) I.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': I.sprint = down; break;
      case 'Space': I.jump = down; if (down) e.preventDefault(); break;
      default: break;
    }
    if (!down) return;

    if (this.state === 'cutscene') { this.skipCutscene(); return; }

    // dial puzzle grabs the arrows
    if (this.ui.dialsOpen) {
      if (k === 'ArrowLeft') { this.dialSel = (this.dialSel + 3) % 4; this.ui.renderDials(this.dialState, this.dialSel); this.audio.sfx('select'); }
      else if (k === 'ArrowRight') { this.dialSel = (this.dialSel + 1) % 4; this.ui.renderDials(this.dialState, this.dialSel); this.audio.sfx('select'); }
      else if (k === 'ArrowUp' || k === 'KeyW') { this.cycleDial(1); }
      else if (k === 'ArrowDown' || k === 'KeyS') { this.cycleDial(-1); }
      else if (k === 'KeyE' || k === 'Enter') { this.submitDials(); }
      else if (k === 'Escape') { this.closeDials(); }
      e.preventDefault();
      return;
    }

    if ((k === 'KeyE' || k === 'Enter') && this.ui.readerActive) { this.ui.advanceReader(); return; }
    if (k === 'KeyE') { this.interact(); return; }

    if (k === 'KeyC' && this.playing) {
      const third = this.player.toggleView();
      this.ui.toast(third ? 'THIRD PERSON' : 'FIRST PERSON', 'gold', 1100);
      this.audio.sfx('select');
      return;
    }
    if (k === 'Tab') { e.preventDefault(); if (this.playing) this.toggleJournal(); return; }
    if (k === 'KeyM') { if (this.playing) this.toggleMap(); return; }
    if (k === 'Escape') {
      if (this.ui.journalOpen) { this.toggleJournal(); return; }
      if (this.ui.mapOpen) { this.toggleMap(); return; }
      if (this.playing) this.pause(!this.paused);
      return;
    }
  }

  /* ===========================================================
     FLOW
     =========================================================== */
  startTitle() {
    this.state = 'title';
    this.ui.hide();
    this.audio.playMusic('title');
  }

  startGame() {
    this.paused = false;
    this.stats = { started: performance.now(), deaths: 0, thrown: 0, hits: 0 };
    this.found.clear();
    this.hasChart = false;
    this.doorSolved = false;
    this.dialState = [0, 0, 0, 0];
    this.coconutCount = 3;
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
    // world keeps breathing under the camera
    if (this.cutScene === this.islandScene) this.tickIslandWorld(dt);
    else {
      this.templeScene.userData.tick?.(this.time, dt);
      this.sanctumIdol?.userData.tick?.(this.time);
      if (this.hector) this.hector.update(dt, this.time, this.player);
    }
    this.cutsceneObj?.update(dt);
  }

  /* ---------- opening ---------- */
  playIntro() {
    const s = this.spawn;
    const out = Math.hypot(s.x, s.z) || 1;
    const seaward = new THREE.Vector3(s.x / out * (out + 62), 3.0, s.z / out * (out + 62));
    const overCamp = new THREE.Vector3(s.x + 6, s.y + 9, s.z + 12);
    const behind = new THREE.Vector3(s.x - 5, s.y + 2.6, s.z + 6);
    const wreck = this.wreckPos;

    this.pipeline.fade = 0;
    this.audio.playMusic('island');

    this.playCutscene({
      shots: [
        { // drifting in off the water toward the beach
          dur: 6.5, ease: 'linear',
          from: seaward,
          to: new THREE.Vector3().lerpVectors(seaward, new THREE.Vector3(s.x, s.y + 3, s.z), 0.62),
          look: new THREE.Vector3(s.x, s.y + 1.4, s.z),
        },
        { // sweep over the wreck
          dur: 5.5,
          from: new THREE.Vector3(wreck.x + 14, wreck.y + 7, wreck.z + 16),
          to: new THREE.Vector3(wreck.x - 8, wreck.y + 4, wreck.z + 8),
          look: new THREE.Vector3(wreck.x, wreck.y + 2, wreck.z),
        },
        { // settle behind the castaway
          dur: 5.0, ease: 'easeOut',
          from: overCamp, to: behind,
          look: () => new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.3, this.player.pos.z),
        },
      ],
      text: [
        { at: 0.6, until: 5.6, text: 'ISLA DORADA.\nNobody comes here on purpose.' },
        { at: 7.0, until: 11.6, text: 'The storm took the ship, the crew,\nand most of your good sense.' },
        { at: 12.4, until: 16.6, text: 'It did not take the reason you came.' },
      ],
      events: [
        { at: 0.0, fn: () => this.fade(1, 2400) },
        { at: 6.4, fn: () => this.audio.sfx('stinger') },
        { at: 15.8, fn: () => this.fade(0, 1000) },
      ],
      onDone: () => this.endIntro(),
    }, this.islandScene);
  }

  endIntro() {
    setCinemaBars(false);
    this.state = 'island';
    this.fade(1, 700);
    this.ui.show();
    this.ui.setObjective('Look around the camp. Somebody was here before you.');
    this._requestLock();
    setTimeout(() => this.ui.toast('WASHED ASHORE — ISLA DORADA', 'gold', 3600), 400);
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
      idol.position.y = base + k * 3.0;
      idol.rotation.y += dt * (0.5 + k * 1.6);
      idol.scale.setScalar(1.3 + k * 0.45);
    };

    this.playCutscene({
      shots: [
        { // low, reverent push-in from the steps
          dur: 4.0, ease: 'easeOut',
          from: new THREE.Vector3(D.x + 1.2, TEMPLE.daisHeight + 1.2, D.z + 13),
          to: new THREE.Vector3(D.x + 0.4, TEMPLE.daisHeight + 2.4, D.z + 6.2),
          look: idolAt(1.2),
        },
        { // orbit as it lifts
          dur: 5.0, ease: 'linear',
          from: new THREE.Vector3(D.x + 5.4, TEMPLE.daisHeight + 4.2, D.z + 5.4),
          to: new THREE.Vector3(D.x - 5.4, TEMPLE.daisHeight + 5.6, D.z + 5.0),
          lookFrom: idolAt(1.6), lookTo: idolAt(3.2),
        },
        { // close on the face, then bloom out
          dur: 3.4, ease: 'easeIn',
          from: new THREE.Vector3(D.x - 1.6, TEMPLE.daisHeight + 6.4, D.z + 4.6),
          to: new THREE.Vector3(D.x - 0.3, TEMPLE.daisHeight + 6.0, D.z + 2.4),
          look: idolAt(3.4),
        },
      ],
      text: [
        { at: 1.0, until: 5.4, text: 'THE IDOL OF CHRIS ILLICH' },
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
    document.getElementById('pause').classList.toggle('hidden', !on);
    if (on) document.exitPointerLock?.();
    else this._requestLock();
  }

  toggleJournal() {
    const entries = [{ found: true, title: JOURNAL_INTRO.title, text: JOURNAL_INTRO.text }];
    if (this.hasChart) entries.push({ found: true, title: LETTER.title, text: LETTER.text });
    for (const p of PENDULUMS) {
      entries.push({
        found: this.found.has(p.id), title: p.title, text: p.text,
        hint: this.hasChart ? p.hint : 'You have nothing to go on yet.',
      });
    }
    const open = this.ui.toggleJournal(entries);
    this.audio.sfx('page');
    if (open) document.exitPointerLock?.();
    else if (!this.paused) this._requestLock();
  }

  toggleMap() {
    if (!this.hasChart) {
      this.audio.sfx('deny');
      this.ui.toast('You have no chart.', 'bad', 1500);
      return;
    }
    const marks = PENDULUMS.map((p) => ({
      x: p.world.x, z: p.world.z,
      label: ['I', 'II', 'III', 'IV'][p.order - 1],
      found: this.found.has(p.id),
      glyph: this.found.has(p.id) ? p.glyph : null,
    }));
    const open = this.ui.toggleMap({
      heightAt, radius: ISLAND.shore + 12,
      marks,
      temple: this.templeDoorPos,
      player: this.player.pos,
      wreck: this.wreckPos,
      rogue: this.rogueSandPos,
    });
    this.audio.sfx('page');
    if (open) document.exitPointerLock?.();
    else if (!this.paused) this._requestLock();
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
        if (d < 3.0 && d < bestD && this.coconutCount < 8) {
          bestD = d; best = { kind: 'cache', cache: c, prompt: 'Gather coconuts' };
        }
      }
      if (this.hectorDefeated && !this.idolTaken) {
        const D = TEMPLE.daisCenter;
        const d = Math.hypot(p.x - D.x, p.z - D.z);
        // generous: the dais is wide and this is the last action in the game
        if (d < 8.0 && d < bestD) { bestD = d; best = { kind: 'takeIdol', prompt: 'TAKE THE IDOL OF CHRIS ILLICH' }; }
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
      if (d < 2.6 && d < bestD && this.coconutCount < 8) {
        bestD = d; best = { kind: 'coconutPile', pile, prompt: 'Gather coconuts' };
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
        this.audio.sfx('pickup');
        this.showReader(p.title, p.text);
        this.ui.setMarks(this.found.size, 4);
        this._refreshCompass();
        if (this.found.size >= 4) {
          this.ui.setObjective('All four glyphs recorded. Set the temple door in order.');
          setTimeout(() => this.ui.toast('ALL FOUR PENDULUMS READ', 'jade', 4000), 700);
        } else {
          this.ui.setObjective(`Pendulums read: ${this.found.size}/4.`);
        }
        break;
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
        const got = Math.min(8 - this.coconutCount, 3);
        this.coconutCount += got;
        it.pile.cooldown = 25;
        it.pile.mesh.visible = false;
        this.audio.sfx('coconut');
        this.ui.toast(`+${got} COCONUTS`, 'gold', 1400);
        break;
      }
      case 'cache': {
        const got = Math.min(8 - this.coconutCount, 4);
        this.coconutCount += got;
        it.cache.cooldown = 14;
        it.cache.mesh.visible = false;
        this.audio.sfx('coconut');
        this.ui.toast(`+${got} COCONUTS`, 'gold', 1400);
        break;
      }
      case 'templeExit': this.exitTemple(); break;
      case 'takeIdol': this.takeIdol(); break;
    }
  }

  showReader(head, body) {
    document.exitPointerLock?.();
    this.ui.showReader(head, body, () => { if (!this.paused) this._requestLock(); });
  }

  /* ---------- dial puzzle ---------- */
  openDials() {
    document.exitPointerLock?.();
    this.dialSel = 0;
    this.ui._onDialClick = (i) => {
      if (i === this.dialSel) this.cycleDial(1);
      else { this.dialSel = i; this.ui.renderDials(this.dialState, this.dialSel); this.audio.sfx('select'); }
    };
    this.ui.openDials(this.dialState, this.dialSel, this.knownGlyphHint());
    this.audio.sfx('page');
  }
  knownGlyphHint() {
    return PENDULUMS
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => (this.found.has(p.id) ? `${['I', 'II', 'III', 'IV'][p.order - 1]}=${p.glyph}` : '?'))
      .join('   ');
  }
  cycleDial(dir) {
    this.dialState[this.dialSel] = (this.dialState[this.dialSel] + dir + GLYPHS.length) % GLYPHS.length;
    this.ui.renderDials(this.dialState, this.dialSel);
    this.audio.sfx('select');
  }
  submitDials() {
    const ok = this.dialState.every((v, i) => GLYPHS[v] === DOOR_CODE[i]);
    if (!ok) {
      this.audio.sfx('deny');
      this.ui.shakeDials();
      this.ui.toast('The sockets grind, and settle back.', 'bad', 2000);
      return;
    }
    this.doorSolved = true;
    this.closeDials();
    this.audio.sfx('door');
    this.ui.toast('THE DOOR REMEMBERS THE ORDER', 'jade', 4000);
    this.ui.setObjective('The temple is open. Go down.');
    this.updateSockets();
  }
  closeDials() {
    this.ui.closeDials();
    if (!this.paused) this._requestLock();
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
  async fade(to, ms = 500) {
    const from = this.pipeline.fade;
    const t0 = performance.now();
    return new Promise((res) => {
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        this.pipeline.fade = from + (to - from) * k;
        if (k < 1) requestAnimationFrame(tick); else res();
      };
      tick();
    });
  }

  async enterTemple() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.player.frozen = true;
    await this.fade(0, 550);

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

  clearCoconuts() {
    for (const c of this.coconuts) c.mesh.removeFromParent();
    this.coconuts.length = 0;
  }

  updateCoconuts(dt) {
    const inTemple = this.state === 'temple';
    const groundOf = inTemple ? templeHeight : heightAt;
    for (let i = this.coconuts.length - 1; i >= 0; i--) {
      const c = this.coconuts[i];
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
    document.getElementById('death-sub').textContent = subs[Math.floor(Math.random() * subs.length)];
    setTimeout(() => {
      document.getElementById('death').classList.remove('hidden');
      this.ui.hide();
    }, 900);
  }

  respawn() {
    document.getElementById('death').classList.add('hidden');
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
    const secs = Math.round((performance.now() - this.stats.started) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const acc = this.stats.thrown ? Math.round((this.stats.hits / this.stats.thrown) * 100) : 0;
    this.endingSummary =
      `Illic Isle — cleared in ${mm}:${ss}, ${this.stats.deaths} death${this.stats.deaths === 1 ? '' : 's'}, ${acc}% coconut accuracy. El Bass Presidente has been term-limited.`;
    document.getElementById('ending-stats').innerHTML =
      `TIME <b>${mm}:${ss}</b><br>DEATHS <b>${this.stats.deaths}</b><br>` +
      `COCONUTS THROWN <b>${this.stats.thrown}</b><br>ACCURACY <b>${acc}%</b>`;
    document.getElementById('ending').classList.remove('hidden');
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

    if (!frozen) {
      this.player.update(dt, this.input, {
        groundOf: inTemple ? templeHeight : heightAt,
        water: !inTemple,
        bounds: !inTemple,
        insideBox: inTemple
          ? { minX: -TEMPLE.halfX, maxX: TEMPLE.halfX, minZ: -TEMPLE.halfZ, maxZ: TEMPLE.halfZ }
          : null,
      });
      this.updateCoconuts(dt);
    } else {
      this.player.updateCamera(dt, inTemple ? templeHeight : heightAt);
    }

    if (inTemple) this.updateTemple(dt, frozen);
    else { this.tickIslandWorld(dt); this.updateIslandLogic(dt, frozen); }

    this.ui.setHearts(this.player.hp, this.player.maxHp);
    this.ui.setStamina(this.player.stamina);
    this.ui.setAmmo(this.coconutCount);
    this.ui.setMarks(this.found.size, 4);
    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);

    const it = frozen ? null : this.nearestInteractable();
    this.ui.setPrompt(it ? it.prompt : null);
  }

  /** Ambient island motion — also runs during the intro. */
  tickIslandWorld(dt) {
    const t = this.time;
    this.ocean.userData.tick(t);
    this.surf.userData.tick(t);
    this.clouds.userData.tick(t, dt);
    this.birds.userData.tick(t, dt);
    this.critters.userData.tick(t, dt, this.player?.pos);
    this.sky.position.copy(this.camera.position);
    for (const g of this.tickers) g.userData?.tick?.(t, dt);
    if (this.campfire) {
      this.campfire.userData.light.intensity = 1.8 + Math.sin(t * 11) * 0.45 + Math.sin(t * 6.3) * 0.25;
    }
  }

  updateIslandLogic(dt, frozen) {
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
    this.titleCam.position.set(
      -0.2 + Math.sin(t * 0.11) * 0.7,
      1.15 + Math.sin(t * 0.37) * 0.16,
      6.2
    );
    this.titleCam.lookAt(-2.15, 0.55, 0);
  }

  render(dt) {
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
    const dt = Math.min(0.05, this.clock.getDelta());
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
