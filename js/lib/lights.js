/* ===========================================================
   lights.js — a fixed rig of point lights, shared out.

   The island had eighty-one point lights in it: a lamp on every
   vending machine, a torch at every task, neon down both sides of
   the Flopper, the fire, the lantern in your hand. They were all
   real lights, all in the scene at once, and that costs far more
   than it looks.

   Three things go wrong with a number like that. The light count is
   baked into every shader's cache key, so every material in the game
   was compiled to loop over eighty-one lights per vertex — for a
   quarter of a million vertices that is twenty million light
   calculations a frame, nearly all of them for a torch two hundred
   metres away contributing nothing. The renderer rebuilds and
   re-uploads the whole light block every frame, for every program it
   touches. And because the count is part of the cache key, walking
   into the bunker — a room with four — recompiled every shared
   material on the way in and again on the way out.

   So: the lights the world builds are kept exactly as they are, and
   go on being animated exactly as they were, but they stop being
   lights. They become emitters — position, colour, intensity, reach —
   and a fixed rig of twelve real lights is dealt out to whichever
   twelve matter most from where you are standing. A point light with a
   distance has no reach beyond it, so the ones left out were
   contributing nothing anyway.

   Every scene gets the same rig, which means every scene presents the
   renderer with the same light counts, which means a material
   compiled on the island is still valid in the bar.
   =========================================================== */

import * as THREE from 'three';

/** Real lights per scene. Twelve rather than ten because the High
    Roller room has eleven — four braziers, six sconces and the table
    lamp — and its walls are close enough that every one of them is in
    reach of everywhere on the floor, so ten left a sconce permanently
    losing the last slot to whichever one happened to be flaring. */
export const POOL = 12;

/* Every scene presents these counts, so a shader compiled for one is
   valid in all of them. Directional is three because the title screen
   has key, fill and rim; the island has the sun and the storm flash. */
const HEMI = 1;
const DIR = 3;

/* Fallback reach for a light built without one. Three.js treats
   distance 0 as unbounded, which no light in this game means. */
const NO_LIMIT = 50;

/* How often the rig re-picks, and how far you have to walk to make it
   re-pick sooner. Picking every frame is wasted work — the answer only
   changes when you move. */
const RESORT_S = 0.12;
const MOVED = 1.5;
/* How often we look for lights that were built after the rig was. */
const RESCAN_S = 0.25;
/* An emitter already on the rig has to be beaten by this much before it
   is dropped, so two similar lights cannot flicker back and forth. */
const HYSTERESIS = 1.3;
/* Seconds for a light coming onto the rig to reach full strength, and
   for one that has lost its slot to go dark again. */
const FADE_S = 0.18;
/* How quickly the brightness a light is ranked by follows the brightness
   it renders at. Slowly: a flickering emitter must not be able to swing
   further than HYSTERESIS over a second or two, or it beats and loses to
   its neighbour over and over. */
const RANK_LAG = 0.02;

const _v = new THREE.Vector3();

class LightRig {
  constructor(scene) {
    this.scene = scene;
    this.emitters = [];
    this.slots = [];
    this.on = [];             // emitter currently in each slot
    this.k = [];              // fade level for each slot
    this.off = [];            // slot is fading its emitter out
    this._sortT = 0;
    this._scanT = 0;
    this._at = new THREE.Vector3(1e9, 0, 1e9);

    let hemi = 0, dir = 0;
    scene.traverse((o) => {
      if (o.isHemisphereLight) hemi++;
      else if (o.isDirectionalLight) dir++;
    });
    /* Fillers at zero. They light nothing; they are here so the counts
       match everywhere and nothing is ever recompiled for walking
       through a door. */
    for (let i = hemi; i < HEMI; i++) scene.add(new THREE.HemisphereLight(0x000000, 0x000000, 0));
    for (let i = dir; i < DIR; i++) {
      const d = new THREE.DirectionalLight(0x000000, 0);
      d.position.set(0, 1, 0);
      scene.add(d);
    }

    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.7);
      l.userData.rigSlot = true;
      scene.add(l);
      this.slots.push(l);
      this.on.push(null);
      this.k.push(0);
      this.off.push(false);
    }

    this.scan();
    scene.userData.rig = this;
  }

  /**
   * Find every point light in the scene and take it off duty.
   *
   * Safe to call again at any time: anything built after the rig — the
   * pistol's muzzle flash, a camera dropped on a tripod — is caught the
   * next time round, before the renderer ever sees it as a light.
   */
  scan() {
    const found = [];
    this.scene.traverse((o) => {
      if (!o.isPointLight || o.userData.rigSlot) return;
      if (o.visible) {
        /* A light is a node like any other and can have things hanging
           off it. Taking it out of the render walk would take them with
           it, so they move up to its parent first, keeping their place
           in the world. */
        while (o.children.length && o.parent) o.parent.attach(o.children[0]);
        o.visible = false;
      }
      /* Anything that walks the scene turning hidden things on — the
         shader warm-ups do exactly that — has to leave these alone, or
         the renderer sees ninety lights and compiles for ninety. */
      o.userData.rigOff = true;
      found.push(o);
    });
    this.emitters = found;
    return found.length;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Camera} camera the eye the rig is being dealt for
   * @param {boolean} force re-pick now, whatever the timers say
   */
  update(dt, camera, force = false) {
    if (!this.slots.length) return;
    const cam = camera.position;

    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = RESCAN_S; this.scan(); }

    this._sortT -= dt;
    if (force || this._sortT <= 0 || this._at.distanceToSquared(cam) > MOVED * MOVED) {
      this._sortT = RESORT_S;
      this._at.copy(cam);
      this._pick(cam);
      /* A forced deal is somebody rendering one frame from somewhere else
         entirely — a security camera. There is no next frame for it to
         fade up in, so it arrives at full — and anything already on its
         way out is let go here rather than drawn at full strength for
         the one frame and then disappearing. */
      if (force) for (let i = 0; i < this.k.length; i++) {
        if (this.off[i]) { this.on[i] = null; this.off[i] = false; this.k[i] = 0; }
        else this.k[i] = this.on[i] ? 1 : 0;
      }
    }

    /* Follow whatever each slot is carrying. Emitters move — the
       lantern is on you, the Flopper's neon sails in and out — so the
       copy happens every frame even when the choice does not change. */
    for (let i = 0; i < this.slots.length; i++) {
      const l = this.slots[i], e = this.on[i];
      if (!e) { l.intensity = 0; continue; }
      /* A slot that has lost its emitter walks it back down rather than
         cutting it, and only lets go once it is dark. Dropping it in one
         frame put a wall in shadow while its bulb mesh stayed lit. */
      if (this.off[i]) {
        this.k[i] -= dt / FADE_S;
        if (this.k[i] <= 0) { this.on[i] = null; this.off[i] = false; this.k[i] = 0; l.intensity = 0; continue; }
      } else this.k[i] = Math.min(1, this.k[i] + dt / FADE_S);
      e.getWorldPosition(_v);
      l.position.copy(_v);
      l.color.copy(e.color);
      l.distance = e.distance || NO_LIMIT;
      l.decay = e.decay;
      l.intensity = e.intensity * this.k[i];
    }
  }

  /** Score every emitter from where the eye is and deal out the rig. */
  _pick(cam) {
    const list = this.emitters;
    const best = this._best || (this._best = []);
    best.length = 0;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.intensity <= 0.001) continue;
      /* Its own visible flag is ours now, but anything it hangs off is
         still the world's — a light inside a hidden prop is off. */
      let p = e.parent, shown = true;
      while (p) { if (!p.visible) { shown = false; break; } p = p.parent; }
      if (!shown) continue;

      e.getWorldPosition(_v);
      const reach = (e.distance || NO_LIMIT) + 14;
      const d = _v.distanceTo(cam);
      if (d >= reach) continue;
      /* Ranked on a brightness that lags what it renders at. A brazier
         or a guttering sconce swings wider than HYSTERESIS, so scoring on
         the live value let two evenly-placed sconces take the last slot
         off each other several times a second while you stood still.

         Lag the fall only. Lagging the rise as well is what flicker-thrash
         does not need and what everything that comes UP from nothing
         cannot afford: the chest glow, the bunker lamp, the mast's warning
         light and the Flopper's neon are all driven from zero, and the
         guard above skips them entirely while they are dark — so rigI is
         first seeded partway up the ramp and then crawls at RANK_LAG per
         pick, a pick being at most every RESORT_S. That is seconds of a
         light being visibly bright and ranked as though it were not. */
      let b = e.userData.rigI;
      if (b === undefined || e.intensity > b) b = e.intensity;
      else b += (e.intensity - b) * RANK_LAG;
      e.userData.rigI = b;
      let score = b * (1 - d / reach);
      if (this.on.indexOf(e) >= 0) score *= HYSTERESIS;
      best.push(e, score);
    }

    /* A partial selection sort: we only want the top ten of a list that
       is usually eighty long, so there is no reason to sort the tail. */
    const n = best.length / 2;
    const take = Math.min(this.slots.length, n);
    for (let s = 0; s < take; s++) {
      let bi = s;
      for (let j = s + 1; j < n; j++) if (best[j * 2 + 1] > best[bi * 2 + 1]) bi = j;
      if (bi !== s) {
        const e = best[s * 2], k = best[s * 2 + 1];
        best[s * 2] = best[bi * 2]; best[s * 2 + 1] = best[bi * 2 + 1];
        best[bi * 2] = e; best[bi * 2 + 1] = k;
      }
    }

    /* Keep everything that is staying exactly where it is. Moving a
       light between slots would make it fade in again for no reason. */
    const chosen = this._chosen || (this._chosen = new Set());
    chosen.clear();
    for (let s = 0; s < take; s++) chosen.add(best[s * 2]);
    for (let i = 0; i < this.on.length; i++) {
      /* Set both ways round: an emitter picked up again while it was on
         its way out has to be told to stop leaving, or it keeps fading
         and hands back a slot it never actually lost. */
      if (this.on[i]) this.off[i] = !chosen.has(this.on[i]);
    }
    for (let s = 0; s < take; s++) {
      const e = best[s * 2];
      if (this.on.indexOf(e) >= 0) continue;
      let free = this.on.indexOf(null);
      /* Nothing empty, so take the slot furthest through its fade-out and
         come up from wherever it had got to. Waiting for it to go dark
         first would run the scene a light short for a fifth of a second
         and turn one snap into two. */
      if (free < 0) for (let i = 0; i < this.on.length; i++) {
        if (this.off[i] && (free < 0 || this.k[i] < this.k[free])) free = i;
      }
      if (free < 0) break;
      this.on[free] = e;
      /* From nothing, not from wherever the last one had got to. On a full
         rig the slots this very pick has just marked for fade-out are still
         sitting at k = 1, and they are exactly the ones the search above
         hands back — so inheriting k lit the incoming emitter at full on
         its first frame and cut the outgoing one at full on the same one.
         Taking the slot now rather than waiting for it to go dark is what
         keeps the scene from running a light short; starting the new one
         at zero is what makes it fade in. */
      this.k[free] = 0;
      this.off[free] = false;
    }
  }
}

/** Rig a scene, or re-scan the one it already has. */
export function rigScene(scene) {
  if (!scene) return null;
  if (scene.userData.rig) { scene.userData.rig.scan(); return scene.userData.rig; }
  return new LightRig(scene);
}
