/* ===========================================================
   game.js — the whole adventure, wired together.
   =========================================================== */

import * as THREE from 'three';
import { RetroPipeline, setJitterEnabled, setTime, ps1ify } from './lib/ps1.js';
import { buildAtlas, makeRng, buildSignTexture } from './lib/textures.js';
import { mergeGeos, ico, tint, plane } from './lib/geo.js';
import { GameAudio } from './lib/audio.js';
import { UI } from './ui.js';

import {
  buildTerrain, buildOcean, buildFoam, buildSky, buildClouds,
  heightAt, slopeAt, biomeAt, findBeach, ISLAND,
} from './world/terrain.js';
import {
  buildPropMaterials, scatterIsland, LANDMARKS, findGround,
  buildShipwreck, buildCampfire, buildMarkStone, buildShrine, buildCairn,
  buildCaveDoor, buildCoconutPile, buildCoconutMesh, buildTorch,
} from './world/props.js';
import { buildIdolMaterials, buildIdol, buildIdolShrine } from './world/idol.js';
import { buildCave, caveHeight, CAVE } from './world/cave.js';
import { Player } from './entities/player.js';
import { Hector } from './entities/boss.js';

/* ===========================================================
   STORY
   =========================================================== */
export const MARKS = [
  {
    id: 0, title: 'MARK I — THE GROVE',
    place: 'grove',
    hint: 'A ring of palms, planted by hands. Nothing on this island grows in a circle by accident.',
    text:
`"MARK I. Set at the ring of palms, where the isle feeds
those who look up.

The fruit is heavy. The fruit is hard. The fruit is,
if you are clever, a weapon.

Take all you can carry. You will not be reasoning
with what waits below."`,
  },
  {
    id: 1, title: 'MARK II — THE OVERLOOK',
    place: 'overlook',
    hint: 'High ground. Somewhere the whole island lies flat beneath you.',
    text:
`"MARK II. Set at the high stone, where the isle
shows its own face.

From here you may see the throat: a black mouth
in the red cliff to the north.

It is sealed. Four marks, four lights. Find them all
and it will open for you, whether or not it wants to."`,
  },
  {
    id: 2, title: 'MARK III — THE SUNKEN SHRINE',
    place: 'lagoon',
    hint: 'They built something at the water on the eastern shore. The jungle has been eating it ever since.',
    text:
`"MARK III. Set at the shrine, which we built for the
Idol and then could not keep.

Understand what you are taking. The Idol of Chris
Illich was cast by people who loved him more than
was strictly advisable.

It is gold. It is heavy. It is smiling. Isla Dorada
is named for it and not the other way around."`,
  },
  {
    id: 3, title: 'MARK IV — THE HOLLOW',
    place: 'hollow',
    hint: 'Something is tucked away in the northeast, down among the rocks where the light gives up.',
    text:
`"MARK IV. Set at the hollow, and set here last,
because I did not want to write it.

A man came ashore eleven years ago. He found a staff
in the dark and the staff feeds him and it has never
once stopped.

He calls himself EL BASS PRESIDENTE. He has held
every office on this island, all of them at the same
time, all of them uncontested.

He is not hungry. He is not sorry. He is not going
to let you past.

Aim for the orb. That's where it all comes from."`,
  },
];

const JOURNAL_INTRO = {
  id: -1, title: 'THE CASTAWAY\'S JOURNAL',
  text:
`Day one.

The storm took the ship, the crew, and most of my
good sense. It did not take my purpose.

Somewhere on this rock sleeps the Idol of Chris
Illich, cast in gold, hidden by people who thought
better of what they'd made.

Four stone marks guard the way to it. Find them all
and the isle opens its throat.

Do not eat anything you did not personally climb for.`,
};

/* ===========================================================
   GAME
   =========================================================== */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.state = 'boot';   // boot | title | island | cave | dead | ending
    this.paused = false;

    this.settings = {
      res: 224,
      jitter: true,
      crt: true,
      density: 1,
      audio: true,
    };
    this.loadSettings();

    this.audio = new GameAudio();
    this.ui = new UI(this.audio);

    this.input = {
      fwd: false, back: false, left: false, right: false,
      sprint: false, jump: false,
    };
    this.mouse = { locked: false };

    this.coconuts = [];
    this.pickups = [];
    this.marksFound = new Set();
    this.stats = { started: 0, deaths: 0, thrown: 0, hits: 0 };

    this._initRenderer();
    this._bindEvents();
  }

  /* ---------- settings ---------- */
  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('illicisle.settings') || '{}');
      Object.assign(this.settings, s);
    } catch (e) { /* first run */ }
  }
  saveSettings() {
    try { localStorage.setItem('illicisle.settings', JSON.stringify(this.settings)); } catch (e) { /* private mode */ }
  }

  /* ---------- renderer ---------- */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);

    this.pipeline = new RetroPipeline(this.renderer, this.settings.res);
    this.pipeline.setCRT(this.settings.crt);
    setJitterEnabled(this.settings.jitter);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.35, 460);

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

    await step('GENERATING TEXTURES', 0.08, () => {
      this.atlas = buildAtlas();
      this.propMats = buildPropMaterials(this.atlas);
      this.idolMats = buildIdolMaterials(this.atlas);
    });

    await step('RAISING ISLA DORADA', 0.22, () => {
      this._buildIslandScene();
      // Resolve the cave mouth before anything is planted, so the jungle can
      // be told to leave room for it.
      this.caveDoorPos = this._findCliffSpot(LANDMARKS.caveDoor.x, LANDMARKS.caveDoor.z);
    });

    await step('PLANTING JUNGLE', 0.42, () => {
      this.colliders = [];
      const clearZones = Object.keys(LANDMARKS).map((k) => ({
        x: LANDMARKS[k].x, z: LANDMARKS[k].z, r: 12,
      }));
      // a generous apron in front of the arch so you can see it coming
      clearZones.push({ x: this.caveDoorPos.x, z: this.caveDoorPos.z, r: 20 });
      scatterIsland(this.islandScene, this.propMats, makeRng(2468),
        this.settings.density, this.colliders, clearZones);
    });

    await step('PLACING RUINS', 0.62, () => {
      this._buildLandmarks();
    });

    await step('CARVING THE THROAT', 0.78, () => {
      this.caveScene = buildCave(this.idolMats, this.propMats);
      this._buildSanctum();
    });

    await step('CASTING THE IDOL', 0.90, () => {
      this._buildTitleScene();
    });

    await step('READY', 1.0, () => {
      this.player = new Player(this.islandScene, this.propMats, this.camera);
      this.player.setColliders(this.colliders);
      this.player.bounds = ISLAND.playRadius;
      this.player.onFootstep = (b) => this.audio.sfx(`step_${b === 'water' ? 'water' : b === 'sand' ? 'sand' : b === 'rock' ? 'rock' : 'jungle'}`);
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
    const FOG = 0xbfd8dd;
    scene.background = new THREE.Color(0x8fc4dd);
    scene.fog = new THREE.Fog(FOG, 70, 300);

    scene.add(new THREE.AmbientLight(0xa8c8d8, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0cf, 1.5);
    sun.position.set(-60, 90, 40);
    scene.add(sun);
    const bounce = new THREE.HemisphereLight(0xcfe8f5, 0x6a7a3a, 0.7);
    scene.add(bounce);

    this.terrain = buildTerrain(this.atlas);
    scene.add(this.terrain);

    this.ocean = buildOcean();
    scene.add(this.ocean);

    this.foam = buildFoam();
    scene.add(this.foam);

    this.sky = buildSky('#2f74ab', '#93c8de', '#f6dfae');
    scene.add(this.sky);

    this.clouds = buildClouds(makeRng(31));
    scene.add(this.clouds);

    this.islandScene = scene;
  }

  _buildLandmarks() {
    const scene = this.islandScene;
    const rng = makeRng(555);
    this.interactables = [];
    this.tickers = [];

    /* ---- shipwreck + camp (spawn) ---- */
    const W = LANDMARKS.wreck;
    let wg = findGround(W.x, W.z, { rng, ...W });
    // hard guarantee: if the search drifted off the sand, walk the bearing
    // out to the waterline instead. You always wake up on a beach.
    if (wg.y < 0.7 || wg.y > 3.0) wg = findBeach(Math.atan2(W.z, W.x), 1.5);

    const wreck = buildShipwreck(rng, this.propMats);
    wreck.position.set(wg.x, wg.y - 0.3, wg.z);
    wreck.rotation.y = Math.atan2(wg.x, wg.z) + 1.2;
    scene.add(wreck);
    this.colliders.push({ x: wg.x, z: wg.z, r: 3.4 });

    // everything else in camp goes *inland* of the wreck, never seaward
    const inX = -wg.x / Math.hypot(wg.x, wg.z);
    const inZ = -wg.z / Math.hypot(wg.x, wg.z);
    // Only a few paces up the sand — far enough to be clear of the hull,
    // close enough that you still open your eyes on a beach.
    const sx = wg.x + inX * 3.5, sz = wg.z + inZ * 3.5;
    this.spawn = { x: sx, y: Math.max(heightAt(sx, sz), 0.6) + 1, z: sz };

    const fire = buildCampfire(rng, this.propMats);
    const fg = findGround(wg.x + inX * 7, wg.z + inZ * 7, { rng, radius: 4, minH: 0.9, maxH: 4.5, maxSlope: 0.18 });
    fire.position.set(fg.x, fg.y, fg.z);
    scene.add(fire);
    this.tickers.push(fire.userData.flames);
    this.campfire = fire;

    // the journal, sitting by the fire
    this.interactables.push({
      kind: 'journal',
      x: fg.x + 1.6, z: fg.z + 1.2, y: fg.y,
      r: 3.0,
      prompt: 'Read your journal',
      once: false,
      mesh: this._makeJournalProp(fg.x + 1.6, fg.y + 0.25, fg.z + 1.2, scene),
    });

    /* ---- the four marks ---- */
    this.markMeshes = [];
    MARKS.forEach((m, i) => {
      const L = LANDMARKS[m.place];
      const g = findGround(L.x, L.z, { rng, ...L });
      const stone = buildMarkStone(this.propMats, i);
      stone.position.set(g.x, g.y - 0.2, g.z);
      stone.rotation.y = rng() * Math.PI * 2;
      scene.add(stone);
      this.tickers.push(stone);
      this.markMeshes.push(stone);
      this.colliders.push({ x: g.x, z: g.z, r: 1.1 });
      this.interactables.push({
        kind: 'mark', index: i,
        x: g.x, y: g.y, z: g.z, r: 3.4,
        prompt: 'Read the mark',
        once: true, taken: false,
        mesh: stone,
      });
      m.world = { x: g.x, z: g.z };
    });

    /* ---- shrine at the lagoon (dressing for Mark III) ---- */
    const S = LANDMARKS.lagoon;
    const sg = findGround(S.x - 6, S.z + 6, { rng, ...S, radius: 11 });
    const shrine = buildShrine(rng, this.propMats);
    shrine.position.set(sg.x, sg.y - 0.4, sg.z);
    scene.add(shrine);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.colliders.push({ x: sg.x + Math.cos(a) * 5.2, z: sg.z + Math.sin(a) * 5.2, r: 0.6 });
    }

    /* ---- cairn at the overlook ---- */
    const O = LANDMARKS.overlook;
    const og = findGround(O.x, O.z, { rng, ...O, radius: 12 });
    const cairn = buildCairn(rng, this.propMats);
    cairn.position.set(og.x + 4, og.y, og.z + 3);
    scene.add(cairn);
    this.colliders.push({ x: og.x + 4, z: og.z + 3, r: 1.2 });

    /* ---- coconut piles ---- */
    this.coconutPiles = [];
    const groveL = LANDMARKS.grove;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const px = groveL.x + Math.cos(a) * (4 + rng() * 3);
      const pz = groveL.z + Math.sin(a) * (4 + rng() * 3);
      this._addCoconutPile(scene, px, pz, rng);
    }
    // a few more scattered near the beach so you're never stranded
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      const r = 60 + rng() * 45;
      const g = findGround(Math.cos(a) * r, Math.sin(a) * r, { rng, radius: 14, minH: 1.2, maxSlope: 0.22 });
      this._addCoconutPile(scene, g.x, g.z, rng);
    }

    /* ---- the sealed cave door (position resolved during terrain build) ---- */
    const dg = this.caveDoorPos;
    const signTex = buildSignTexture(['THE THROAT', 'OF THE ISLE'], '#2e1a10', '#ffcf5a');
    const door = buildCaveDoor(rng, this.propMats, signTex);
    door.position.set(dg.x, dg.y - 0.5, dg.z);
    // Face the arch down-slope, away from the mount's centre, so you meet it
    // head-on walking up. Aiming it at the world origin instead points it
    // into the hillside.
    door.rotation.y = Math.atan2(dg.x - ISLAND.mount.x, dg.z - ISLAND.mount.z);
    scene.add(door);
    this.caveDoor = door;
    this.caveDoorPos = dg;
    door.userData.setSockets(0);
    door.userData.torches.forEach((t) => this.tickers.push(t.userData.flames));
    this.colliders.push({ x: dg.x, z: dg.z, r: 2.2 });

    this.interactables.push({
      kind: 'caveDoor',
      x: dg.x, y: dg.y, z: dg.z, r: 6.0,
      prompt: 'Examine the seal',
      once: false,
      mesh: door,
    });

    /* ---- compass points of interest ---- */
    this.ui.setCompassPois([
      { label: '⌂', x: this.spawn.x, z: this.spawn.z, kind: 'poi' },
      ...MARKS.map((m, i) => ({
        label: `✦${i + 1}`, x: m.world.x, z: m.world.z, kind: 'goal', hidden: false, markIndex: i,
      })),
      { label: '▼CAVE', x: dg.x, z: dg.z, kind: 'goal' },
    ]);
  }

  _addCoconutPile(scene, x, z, rng) {
    const g = findGround(x, z, { rng, radius: 6, minH: 1.0, maxSlope: 0.28 });
    const pile = buildCoconutPile(rng, this.propMats);
    pile.position.set(g.x, g.y, g.z);
    scene.add(pile);
    this.coconutPiles.push({ mesh: pile, x: g.x, z: g.z, y: g.y, cooldown: 0 });
  }

  _makeJournalProp(x, y, z, scene) {
    const g = plane(0.5, 0.36, 'paper');
    g.rotateX(-Math.PI / 2 + 0.2);
    tint(g, new THREE.Color(0xe8dcb8));
    const m = new THREE.Mesh(mergeGeos([g]), this.propMats.opaque);
    m.position.set(x, y, z);
    m.rotation.y = 0.6;
    scene.add(m);
    return m;
  }

  /** Find a spot on the mount's south face for the cave mouth: high enough
   *  to read as "up the volcano", steep enough that an arch looks set into
   *  the hillside, and facing south so you can actually see it coming. */
  _findCliffSpot(hintX, hintZ) {
    let best = null, bestScore = -Infinity;
    for (let a = -1.1; a <= 1.1; a += 0.05) {
      for (let r = 26; r < 52; r += 1.0) {
        const x = ISLAND.mount.x + Math.sin(a) * r;
        const z = ISLAND.mount.z + Math.cos(a) * r;   // +Z from the mount = south face
        const h = heightAt(x, z);
        if (h < 19 || h > 31) continue;
        const s = slopeAt(x, z);
        if (s > 0.32) continue;                        // must be walkable up to

        // The mountain has to keep climbing behind the arch, otherwise the
        // door ends up silhouetted on a ridge line instead of set into a
        // cliff face.
        const rise = heightAt(x - Math.sin(a) * 12, z - Math.cos(a) * 12) - h;
        if (rise < 7) continue;

        const score = -Math.abs(h - 25) * 1.2 - Math.abs(a) * 6
          - Math.abs(s - 0.20) * 22 + Math.min(rise, 18) * 1.4;
        if (score > bestScore) { bestScore = score; best = { x, y: h, z }; }
      }
    }
    return best || { x: hintX, y: heightAt(hintX, hintZ), z: hintZ };
  }

  /* ===========================================================
     CAVE SANCTUM
     =========================================================== */
  _buildSanctum() {
    const D = CAVE.daisCenter;
    this.sanctumIdol = buildIdolShrine(this.idolMats, this.propMats, { curls: 62 });
    this.sanctumIdol.position.set(D.x, CAVE.daisHeight + 2.45, D.z);
    this.sanctumIdol.scale.setScalar(1.35);
    this.caveScene.add(this.sanctumIdol);

    this.caveCaches = this.caveScene.userData.caches;
    this.caveSeal = this.caveScene.userData.seal;
  }

  _buildTitleScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x140d16);
    scene.fog = new THREE.Fog(0x140d16, 8, 30);
    scene.add(new THREE.AmbientLight(0x8a7a68, 1.5));

    // three-point rig: warm key, cool fill, hot rim to pop the curls
    const key = new THREE.DirectionalLight(0xfff4d8, 2.6);
    key.position.set(3, 5, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc0e0, 1.0);
    fill.position.set(-5, 1, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffb05a, 2.0);
    rim.position.set(-3, 4, -5);
    scene.add(rim);

    this.titleIdol = buildIdolShrine(this.idolMats, this.propMats, { curls: 76, keyIntensity: 0.7 });
    // The bust runs y 0..2.5, so drop it so its middle sits on the origin.
    this.titleIdol.position.set(0, -1.25, 0);
    scene.add(this.titleIdol);

    this.titleCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.titleScene = scene;
  }

  /* ===========================================================
     EVENTS
     =========================================================== */
  _bindEvents() {
    const kd = (e) => this._key(e, true);
    const ku = (e) => this._key(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);

    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === this.canvas;
      if (!this.mouse.locked && (this.state === 'island' || this.state === 'cave')
        && !this.ui.readerActive && !this.ui.journalOpen && !this.paused) {
        this.pause(true);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.locked || this.paused) return;
      const s = 0.0024;
      this.player?.addPitchYaw(e.movementX * s, e.movementY * s);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'island' && this.state !== 'cave') return;
      if (!this.mouse.locked) { this._requestLock(); return; }
      if (this.paused || this.ui.readerActive) return;
      if (e.button === 0) this.throwCoconut();
    });

    window.addEventListener('blur', () => {
      if (this.state === 'island' || this.state === 'cave') this.pause(true);
    });
  }

  _requestLock() {
    this.canvas.requestPointerLock?.();
  }

  _key(e, down) {
    const k = e.code;
    const I = this.input;
    switch (k) {
      case 'KeyW': case 'ArrowUp': I.fwd = down; break;
      case 'KeyS': case 'ArrowDown': I.back = down; break;
      case 'KeyA': case 'ArrowLeft': I.left = down; break;
      case 'KeyD': case 'ArrowRight': I.right = down; break;
      case 'ShiftLeft': case 'ShiftRight': I.sprint = down; break;
      case 'Space':
        I.jump = down;
        if (down) e.preventDefault();
        break;
      default: break;
    }

    if (!down) return;

    if (k === 'KeyE' || k === 'Space' || k === 'Enter') {
      if (this.ui.readerActive) { this.ui.advanceReader(); return; }
    }
    if (k === 'KeyE') { this.interact(); return; }
    if (k === 'KeyC') {
      if (this.state === 'island' || this.state === 'cave') {
        const third = this.player.toggleView();
        this.ui.toast(third ? 'THIRD PERSON' : 'FIRST PERSON', 'gold', 1200);
        this.audio.sfx('select');
      }
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      if (this.state === 'island' || this.state === 'cave') this.toggleJournal();
      return;
    }
    if (k === 'Escape') {
      if (this.ui.journalOpen) { this.toggleJournal(); return; }
      if (this.state === 'island' || this.state === 'cave') this.pause(!this.paused);
      return;
    }
  }

  /* ===========================================================
     FLOW
     =========================================================== */
  startTitle() {
    this.state = 'title';
    this.ui.hide();
    this.audio.playMusic('island');
  }

  startGame() {
    this.state = 'island';
    this.paused = false;
    this.stats.started = performance.now();
    this.marksFound.clear();
    this.coconutCount = 3;
    this.scene = this.islandScene;

    this.player.hp = this.player.maxHp;
    this.player.stamina = 1;
    this.player.teleport(this.spawn.x, this.spawn.y + 2, this.spawn.z, Math.PI * 0.85);
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);

    this.interactables.forEach((i) => { if (i.once) i.taken = false; });
    this.markMeshes.forEach((m) => (m.visible = true));
    this.caveDoor.userData.setOpen(0);
    this.caveDoor.userData.setSockets(0);
    this.caveOpen = false;
    this.hectorDefeated = false;
    this.idolTaken = false;
    this.clearCoconuts();

    this.ui.show();
    this.ui.showBoss(false);
    this.ui.setObjective('Get your bearings. Read your journal by the fire.');
    this.audio.playMusic('island');
    this._requestLock();

    setTimeout(() => this.ui.toast('YOU WASHED ASHORE', 'gold', 3200), 400);
    setTimeout(() => this.ui.toast('Find the four Marks · press TAB for your journal', 'gold', 4200), 2600);
  }

  pause(on) {
    if (this.state !== 'island' && this.state !== 'cave') return;
    this.paused = on;
    document.getElementById('pause').classList.toggle('hidden', !on);
    if (on) {
      document.exitPointerLock?.();
    } else {
      this._requestLock();
    }
  }

  toggleJournal() {
    const entries = [
      { found: true, title: JOURNAL_INTRO.title, text: JOURNAL_INTRO.text },
      ...MARKS.map((m) => ({
        found: this.marksFound.has(m.id),
        title: m.title,
        text: m.text,
        hint: m.hint,
      })),
    ];
    const open = this.ui.toggleJournal(entries);
    this.audio.sfx('page');
    if (open) document.exitPointerLock?.();
    else if (!this.paused) this._requestLock();
  }

  /* ===========================================================
     INTERACTION
     =========================================================== */
  nearestInteractable() {
    if (this.state === 'cave') return this.caveInteractable();
    const p = this.player.pos;
    let best = null, bestD = Infinity;
    for (const it of this.interactables) {
      if (it.once && it.taken) continue;
      const d = Math.hypot(p.x - it.x, p.z - it.z);
      if (d < it.r && d < bestD) { bestD = d; best = it; }
    }
    // coconut piles
    for (const pile of this.coconutPiles) {
      if (pile.cooldown > 0) continue;
      const d = Math.hypot(p.x - pile.x, p.z - pile.z);
      if (d < 2.8 && d < bestD && this.coconutCount < 8) {
        bestD = d;
        best = { kind: 'coconutPile', pile, prompt: 'Gather coconuts' };
      }
    }
    return best;
  }

  caveInteractable() {
    const p = this.player.pos;
    let best = null, bestD = Infinity;

    // exit
    const de = Math.hypot(p.x - CAVE.entrance.x, p.z - CAVE.entrance.z);
    if (de < 4.5) { bestD = de; best = { kind: 'caveExit', prompt: 'Climb back to the surface' }; }

    // coconut caches
    for (const c of this.caveCaches) {
      if (c.cooldown > 0) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < 3.0 && d < bestD && this.coconutCount < 8) {
        bestD = d;
        best = { kind: 'caveCache', cache: c, prompt: 'Gather coconuts' };
      }
    }

    // the idol
    if (this.hectorDefeated && !this.idolTaken) {
      const D = CAVE.daisCenter;
      const d = Math.hypot(p.x - D.x, p.z - D.z);
      if (d < 4.5 && d < bestD) {
        bestD = d;
        best = { kind: 'takeIdol', prompt: 'TAKE THE IDOL OF CHRIS ILLICH' };
      }
    }
    return best;
  }

  interact() {
    if (this.paused || this.ui.journalOpen) return;
    if (this.state !== 'island' && this.state !== 'cave') return;

    const it = this.nearestInteractable();
    if (!it) return;

    switch (it.kind) {
      case 'journal':
        this.audio.sfx('page');
        this.showReader(JOURNAL_INTRO.title, JOURNAL_INTRO.text);
        this.ui.setObjective('Find the four Marks scattered across the island.');
        break;

      case 'mark': {
        const m = MARKS[it.index];
        if (this.marksFound.has(m.id)) return;
        it.taken = true;
        this.marksFound.add(m.id);
        this.audio.sfx('pickup');
        this.showReader(m.title, m.text);
        this.ui.setMarks(this.marksFound.size, 4);
        this.caveDoor.userData.setSockets(this.marksFound.size);

        // fade the mark's compass pip
        const poi = this.ui.compassPois.find((p) => p.markIndex === it.index);
        if (poi) poi.hidden = true;

        it.mesh.userData.taken = true;
        const glyph = it.mesh.userData.glyph;
        if (glyph) glyph.visible = false;

        if (this.marksFound.size >= 4) {
          this.caveOpen = true;
          this.ui.setObjective('All four Marks found. The seal in the red cliff has opened.');
          setTimeout(() => {
            this.ui.toast('THE THROAT OF THE ISLE HAS OPENED', 'gold', 4500);
            this.audio.sfx('door');
          }, 900);
        } else {
          this.ui.setObjective(`Marks found: ${this.marksFound.size}/4. Keep searching.`);
        }
        break;
      }

      case 'caveDoor':
        if (this.caveOpen && this.caveDoor.userData.openAmount > 0.85) {
          this.enterCave();
        } else {
          this.audio.sfx('deny');
          const n = this.marksFound.size;
          this.showReader('THE SEAL',
            `Four sockets. ${n} of them are lit.\n\n` +
            (n === 0
              ? 'Nothing here will move for you yet.'
              : `Find ${4 - n} more Mark${4 - n === 1 ? '' : 's'} and come back.`));
        }
        break;

      case 'coconutPile': {
        const got = Math.min(8 - this.coconutCount, 3);
        this.coconutCount += got;
        it.pile.cooldown = 25;
        it.pile.mesh.visible = false;
        this.audio.sfx('coconut');
        this.ui.toast(`+${got} COCONUTS`, 'gold', 1500);
        break;
      }

      case 'caveCache': {
        const got = Math.min(8 - this.coconutCount, 4);
        this.coconutCount += got;
        it.cache.cooldown = 14;
        it.cache.mesh.visible = false;
        this.audio.sfx('coconut');
        this.ui.toast(`+${got} COCONUTS`, 'gold', 1400);
        break;
      }

      case 'caveExit':
        this.exitCave();
        break;

      case 'takeIdol':
        this.takeIdol();
        break;
    }
  }

  showReader(head, body) {
    document.exitPointerLock?.();
    this.ui.showReader(head, body, () => {
      if (!this.paused) this._requestLock();
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
        if (k < 1) requestAnimationFrame(tick);
        else res();
      };
      tick();
    });
  }

  async enterCave() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.player.frozen = true;
    await this.fade(0, 550);

    this.state = 'cave';
    this.scene = this.caveScene;
    this.player.mesh.removeFromParent();
    this.caveScene.add(this.player.mesh);
    this.player.setColliders([]);
    this.player.teleport(CAVE.entrance.x, caveHeight(CAVE.entrance.x, CAVE.entrance.z) + 0.5, CAVE.entrance.z - 1, Math.PI);

    // clear anything mid-air
    this.clearCoconuts();

    if (!this.hector) {
      this.hector = new Hector(this.caveScene, this.propMats, {
        center: CAVE.center,
        radius: CAVE.radius,
        floorY: caveHeight(0, 0),
        groundAt: caveHeight,
      }, {
        onDamagePlayer: (n, src) => this.hurtPlayer(n, src),
        onSay: (t, ms) => this.ui.toast(t, 'bad', ms),
        onPhase: (p) => this.onBossPhase(p),
        onDefeat: () => this.onBossDefeat(),
        sfx: (n) => this.audio.sfx(n),
      });
    }

    this.audio.playMusic('cave');
    this.ui.setObjective('Descend. Something down here has been eating for eleven years.');
    this.ui.setCompassPois([
      { label: '↑OUT', x: CAVE.entrance.x, z: CAVE.entrance.z, kind: 'poi' },
      { label: '★IDOL', x: CAVE.daisCenter.x, z: CAVE.daisCenter.z, kind: 'goal' },
    ]);

    this.player.frozen = false;
    await this.fade(1, 650);
    this.transitioning = false;
    this._requestLock();
  }

  async exitCave() {
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
    const d = this.caveDoorPos;
    const out = new THREE.Vector3(d.x, d.z).normalize();
    this.player.teleport(d.x * 1.06, d.y + 2, d.z * 1.06, Math.atan2(d.x, d.z));
    this.clearCoconuts();

    this.audio.playMusic('island');
    this.ui.showBoss(false);
    this._restoreIslandCompass();

    this.player.frozen = false;
    await this.fade(1, 600);
    this.transitioning = false;
    this._requestLock();
  }

  _restoreIslandCompass() {
    this.ui.setCompassPois([
      { label: '⌂', x: this.spawn.x, z: this.spawn.z, kind: 'poi' },
      ...MARKS.map((m, i) => ({
        label: `✦${i + 1}`, x: m.world.x, z: m.world.z, kind: 'goal',
        hidden: this.marksFound.has(m.id), markIndex: i,
      })),
      { label: '▼CAVE', x: this.caveDoorPos.x, z: this.caveDoorPos.z, kind: 'goal' },
    ]);
  }

  /* ===========================================================
     COMBAT
     =========================================================== */
  throwCoconut() {
    if (this.coconutCount <= 0) {
      this.audio.sfx('deny');
      this.ui.toast('OUT OF COCONUTS', 'bad', 1200);
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
      mesh,
      pos: pos.clone(),
      vel: dir.multiplyScalar(30),
      life: 5,
      spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
    });
  }

  clearCoconuts() {
    for (const c of this.coconuts) c.mesh.removeFromParent();
    this.coconuts.length = 0;
  }

  updateCoconuts(dt) {
    const inCave = this.state === 'cave';
    const groundOf = inCave ? caveHeight : heightAt;

    for (let i = this.coconuts.length - 1; i >= 0; i--) {
      const c = this.coconuts[i];
      c.vel.y -= 24 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.life -= dt;
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;

      let done = false;

      if (inCave && this.hector) {
        const hit = this.hector.testHit(c.pos, 0.45);
        if (hit) {
          done = true;
          this.stats.hits++;
          if (hit.kind === 'gem') {
            this.audio.sfx('gemHit');
            this.ui.toast('THE ORB! CRITICAL!', 'gold', 1100);
          } else if (hit.kind === 'nugget') {
            this.ui.toast('NUGGET DOWN', 'gold', 800);
          }
        }
      }

      if (!done && c.pos.y < groundOf(c.pos.x, c.pos.z) - 0.1) {
        done = true;
        this.audio.sfx('splat');
      }
      if (!done && c.life <= 0) done = true;

      if (done) {
        c.mesh.removeFromParent();
        this.coconuts.splice(i, 1);
      }
    }
  }

  hurtPlayer(n, source) {
    if (!this.player.damage(n)) return;
    this.audio.sfx('hurt');
    this.ui.flashDamage();
    this.pipeline.tint.setRGB(0.7, 0.05, 0.02);
    this.pipeline.tintAmt = 0.45;
    if (this.player.dead) this.onDeath();
  }

  onBossPhase(p) {
    if (p === 2) {
      this.hector.say('YOU HAVEN\'T EVEN SEEN THE SIDES.', 3000);
      this.ui.setBoss(this.hector.hpFrac, 'TERM TWO');
    } else if (p === 3) {
      this.hector.say('I HAVEN\'T BEEN HUNGRY IN ELEVEN YEARS!', 3400);
      this.ui.setBoss(this.hector.hpFrac, 'TERM THREE — NO LIMITS');
    }
    this.audio.sfx('bossIntro');
  }

  async onBossDefeat() {
    this.hectorDefeated = true;
    this.audio.sfx('bossDie');
    this.audio.stopMusic();
    this.ui.showBoss(false);
    this.ui.setObjective('Take the Idol.');

    setTimeout(() => this.ui.toast('the staff rolls away. the orb goes out.', 'gold', 4200), 1800);
    setTimeout(() => {
      this.showReader('HECTOR — EL BASS PRESIDENTE',
`"...fine.

Take it. Take the little gold man. He was never
much company anyway — always smiling, never
once said a word about the food.

Eleven years I held every office on this island.
Eleven years. Unopposed.

Go on. I'll be fine.

I have snacks."`);
    }, 4200);

    setTimeout(() => {
      // drop the seal
      const s = this.caveSeal;
      s.seal.visible = false;
      s.bars.forEach((b) => (b.visible = false));
      this.audio.sfx('door');
      this.audio.playMusic('cave');
    }, 3000);
  }

  onDeath() {
    this.audio.sfx('die');
    this.audio.stopMusic();
    this.stats.deaths++;
    this.state = 'dead';
    document.exitPointerLock?.();
    const subs = [
      'The isle keeps what it takes.',
      'El Bass Presidente remains in office.',
      'You were out-catered.',
      'Democracy is a delicious idea.',
      'He did not even use the good staff.',
    ];
    document.getElementById('death-sub').textContent =
      subs[Math.floor(Math.random() * subs.length)];
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
      // restart the fight, fully
      this.hector.hp = this.hector.maxHp;
      this.hector.phase = 1;
      this.hector.state = 'sleep';
      this.hector.active = false;
      this.hector.clearProjectiles();
      this.hector.pos.set(CAVE.center.x, 0, CAVE.center.z - 9);
      this.ui.showBoss(false);
      this.bossTriggered = false;
    }

    if (this.state === 'dead') {
      if (this.scene === this.caveScene) {
        this.state = 'cave';
        this.player.teleport(CAVE.entrance.x, caveHeight(CAVE.entrance.x, CAVE.entrance.z) + 0.5, CAVE.entrance.z - 1, Math.PI);
        this.audio.playMusic('cave');
      } else {
        this.state = 'island';
        this.player.teleport(this.spawn.x, this.spawn.y + 2, this.spawn.z, Math.PI * 0.85);
        this.audio.playMusic('island');
      }
    }
    this.coconutCount = Math.max(this.coconutCount, 3);
    this._requestLock();
  }

  async takeIdol() {
    if (this.idolTaken) return;
    this.idolTaken = true;
    this.audio.sfx('victory');
    this.player.frozen = true;
    document.exitPointerLock?.();

    this.ui.toast('THE IDOL OF CHRIS ILLICH', 'gold', 4000);
    // lift it off the pedestal
    const idol = this.sanctumIdol;
    const t0 = performance.now();
    const startY = idol.position.y;
    const lift = () => {
      const k = Math.min(1, (performance.now() - t0) / 2600);
      idol.position.y = startY + k * 2.6;
      idol.rotation.y += 0.02;
      idol.scale.setScalar(1.35 + k * 0.5);
      if (k < 1) requestAnimationFrame(lift);
    };
    lift();

    await new Promise((r) => setTimeout(r, 2800));
    await this.fade(0, 1200);
    this.showEnding();
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
      `IllicIsle — cleared in ${mm}:${ss}, ${this.stats.deaths} death${this.stats.deaths === 1 ? '' : 's'}, ${acc}% coconut accuracy. El Bass Presidente has been term-limited.`;
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

    // fade the damage tint out
    if (this.pipeline.tintAmt > 0) {
      this.pipeline.tintAmt = Math.max(0, this.pipeline.tintAmt - dt * 1.4);
    }
    if (this.throwCooldown > 0) this.throwCooldown -= dt;
    if (this._boundsCd > 0) this._boundsCd -= dt;

    if (this.state === 'title') { this.updateTitle(dt); return; }
    if (this.state === 'ending') { this.updateTitle(dt); return; }
    if (this.state !== 'island' && this.state !== 'cave') return;

    const frozen = this.paused || this.ui.readerActive || this.ui.journalOpen;

    if (!frozen) {
      const inCave = this.state === 'cave';
      this.player.update(dt, this.input, {
        groundOf: inCave ? caveHeight : heightAt,
        water: !inCave,
        bounds: !inCave,
        insideRadius: inCave ? CAVE.radius - 1.5 : 0,
        insideCenter: CAVE.center,
      });
      this.updateCoconuts(dt);
    } else {
      // still keep the camera glued to the player
      this.player.updateCamera(dt, this.state === 'cave' ? caveHeight : heightAt);
    }

    if (this.state === 'island') this.updateIsland(dt, frozen);
    else this.updateCave(dt, frozen);

    /* ---------- HUD ---------- */
    this.ui.setHearts(this.player.hp, this.player.maxHp);
    this.ui.setStamina(this.player.stamina);
    this.ui.setAmmo(this.coconutCount);
    this.ui.setMarks(this.marksFound.size, 4);
    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);

    const it = frozen ? null : this.nearestInteractable();
    this.ui.setPrompt(it ? it.prompt : null);
  }

  updateIsland(dt, frozen) {
    const t = this.time;
    this.ocean.userData.tick(t);
    this.foam.userData.tick(t);
    this.clouds.userData.tick(t, dt);
    this.sky.position.copy(this.camera.position);

    for (const g of this.tickers) g.userData?.tick?.(t, dt);

    // campfire flicker
    if (this.campfire) {
      this.campfire.userData.light.intensity = 2.0 + Math.sin(t * 11) * 0.5 + Math.sin(t * 6.3) * 0.3;
    }

    // coconut pile respawns
    for (const p of this.coconutPiles) {
      if (p.cooldown > 0) {
        p.cooldown -= dt;
        if (p.cooldown <= 0) p.mesh.visible = true;
      }
    }

    // the seal grinds open once all four Marks are in
    const door = this.caveDoor.userData;
    const want = this.caveOpen ? 1 : 0;
    if (door.openAmount !== want) {
      const next = THREE.MathUtils.clamp(door.openAmount + dt * 0.28 * (want ? 1 : -1), 0, 1);
      door.setOpen(next);
    }

    // walking into an open cave mouth takes you in
    if (this.caveOpen && door.openAmount > 0.85 && !this.transitioning && !frozen) {
      const d = Math.hypot(this.player.pos.x - this.caveDoorPos.x, this.player.pos.z - this.caveDoorPos.z);
      if (d < 3.0) this.enterCave();
    }
  }

  updateCave(dt, frozen) {
    const t = this.time;
    this.caveScene.userData.tick?.(t, dt);
    this.sanctumIdol.userData.tick?.(t);

    for (const c of this.caveCaches) {
      if (c.cooldown > 0) {
        c.cooldown -= dt;
        if (c.cooldown <= 0) c.mesh.visible = true;
      }
    }

    if (!this.hector) return;

    // wake him when you commit to the arena
    if (!this.bossTriggered && !this.hectorDefeated) {
      const d = Math.hypot(this.player.pos.x, this.player.pos.z - 6);
      if (d < 17) {
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
      // standing on him hurts
      const d = Math.hypot(this.player.pos.x - this.hector.pos.x, this.player.pos.z - this.hector.pos.z);
      if (d < 2.3 && this.hector.state !== 'defeat') this.hurtPlayer(1, 'touch');
    }
  }

  updateTitle(dt) {
    const t = this.time;
    this.titleIdol.rotation.y += dt * 0.28;
    this.titleIdol.userData.tick?.(t);
    // Aim left of the bust so it composes into the right third of frame,
    // leaving the left clear for the logo and menu.
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
