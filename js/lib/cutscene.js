/* ===========================================================
   cutscene.js — a tiny scripted-camera player.

   A cutscene is a list of SHOTS (camera moves) plus timed EVENTS
   (sfx, model changes) and TEXT cards. Positions may be plain
   arrays or functions returning a Vector3, so a shot can track
   something that is still moving.
   =========================================================== */

import * as THREE from 'three';

const smooth = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const EASES = { linear: (t) => t, smooth, easeOut, easeIn };

export class Cutscene {
  /**
   * @param {THREE.Camera} camera
   * @param {object} spec { shots, events, text, letterbox, onDone }
   */
  constructor(camera, spec) {
    this.cam = camera;
    this.shots = spec.shots || [];
    this.events = (spec.events || []).map((e) => ({ ...e, fired: false }));
    this.text = spec.text || [];
    this.onDone = spec.onDone;
    this.skippable = spec.skippable !== false;

    this.t = 0;
    this.duration = this.shots.reduce((a, s) => a + s.dur, 0);
    this._shownCard = -1;
    this.done = false;

    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._la = new THREE.Vector3();
    this._lb = new THREE.Vector3();
  }

  _vec(v, out) {
    if (typeof v === 'function') { const r = v(); return out.set(r.x, r.y, r.z); }
    if (Array.isArray(v)) return out.set(v[0], v[1], v[2]);
    return out.set(v.x, v.y, v.z);
  }

  update(dt) {
    if (this.done) return true;
    this.t += dt;

    /* ---- events ---- */
    for (const e of this.events) {
      if (!e.fired && this.t >= e.at) { e.fired = true; e.fn?.(); }
    }

    /* ---- which shot are we in ---- */
    let acc = 0, shot = null, local = 0;
    for (const s of this.shots) {
      if (this.t < acc + s.dur || s === this.shots[this.shots.length - 1]) {
        shot = s; local = (this.t - acc) / s.dur;
        break;
      }
      acc += s.dur;
    }

    if (shot) {
      const k = EASES[shot.ease || 'smooth'](THREE.MathUtils.clamp(local, 0, 1));
      this._vec(shot.from, this._a);
      this._vec(shot.to ?? shot.from, this._b);
      this.cam.position.lerpVectors(this._a, this._b, k);

      this._vec(shot.lookFrom ?? shot.look, this._la);
      this._vec(shot.lookTo ?? shot.look ?? shot.lookFrom, this._lb);
      this._la.lerp(this._lb, k);
      this.cam.lookAt(this._la);

      if (shot.shake) {
        const s = shot.shake * (1 - k);
        this.cam.position.x += (Math.random() - 0.5) * s;
        this.cam.position.y += (Math.random() - 0.5) * s;
      }
    }

    /* ---- text cards ---- */
    if (HUD) {
      let active = -1;
      this.text.forEach((c, i) => { if (this.t >= c.at && this.t < c.until) active = i; });
      if (active !== this._shownCard) {
        this._shownCard = active;
        HUD.data.cinemaText = active >= 0 ? this.text[active].text : '';
      }
      // fade the caption in and out at its own edges
      let f = 0;
      if (active >= 0) {
        const c = this.text[active];
        f = Math.min(1, (this.t - c.at) / 0.4, (c.until - this.t) / 0.4);
      }
      HUD.data.cinemaFade = Math.max(0, f);
    }

    if (this.t >= this.duration) this.finish();
    return this.done;
  }

  /**
   * Fire anything left, then close out.
   * Events marked `visualOnly` are cosmetic (fades, stingers) — firing them
   * from a skip would stomp the state the onDone handler is about to set,
   * so they're dropped. State-changing events always run, otherwise
   * skipping a cutscene would leave the world half-updated.
   */
  finish(skipped = false) {
    if (this.done) return;
    this.done = true;
    for (const e of this.events) {
      if (e.fired) continue;
      e.fired = true;
      if (skipped && e.visualOnly) continue;
      e.fn?.();
    }
    if (HUD) { HUD.data.cinemaText = ''; HUD.data.cinemaFade = 0; }
    this.onDone?.();
  }

  skip() { if (this.skippable) this.finish(true); }
}

/* The cutscene layer lives on the HUD canvas so captions and mattes
   pixelate with everything else. Game hands us the Hud on boot. */
let HUD = null;
export function attachHud(hud) { HUD = hud; }

/** Show/hide the letterbox bars + caption layer. */
export function setCinemaBars(on, skippable = true) {
  if (!HUD) return;
  HUD.data.cinema = on;
  HUD.data.cinemaSkip = on && skippable;
  if (!on) { HUD.data.cinemaText = ''; HUD.data.cinemaFade = 0; }
}
