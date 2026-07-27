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
    const el = document.getElementById('intro-text');
    if (el) {
      let active = -1;
      this.text.forEach((c, i) => { if (this.t >= c.at && this.t < c.until) active = i; });
      if (active !== this._shownCard) {
        this._shownCard = active;
        if (active >= 0) { el.textContent = this.text[active].text; el.classList.add('on'); }
        else el.classList.remove('on');
      }
    }

    if (this.t >= this.duration) this.finish();
    return this.done;
  }

  /** Fire anything left, then close out. Used by skip and by natural end. */
  finish() {
    if (this.done) return;
    this.done = true;
    for (const e of this.events) if (!e.fired) { e.fired = true; e.fn?.(); }
    const el = document.getElementById('intro-text');
    if (el) el.classList.remove('on');
    this.onDone?.();
  }

  skip() { if (this.skippable) this.finish(); }
}

/** Show/hide the letterbox bars + card layer. */
export function setCinemaBars(on) {
  document.getElementById('intro').classList.toggle('hidden', !on);
  const skip = document.getElementById('intro-skip');
  if (skip) skip.style.display = on ? '' : 'none';
}
