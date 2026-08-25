/* ===========================================================
   ui.js — HUD, compass, reader, journal, chart, dial puzzle.
   All plain DOM on top of the canvas.
   =========================================================== */

import { Hud } from './lib/hud.js';
import { ScreenStack } from './lib/screens.js';

const $ = (id) => document.getElementById(id);

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class UI {
  constructor() {
    // The only DOM left is the lightning flash, which needs to cover the
    // whole viewport rather than the low-res framebuffer.
    this.el = { lightning: $('lightning') };

    /* The in-game HUD is a canvas rendered at the framebuffer's own
       resolution and composited inside the PS1 pass, so it pixelates,
       dithers and curves along with the world. The DOM nodes for it are
       gone; only full-screen panels stay in the document. */
    this.hud = new Hud();
    this.screens = null;      // ScreenStack, attached by Game

    // `readerActive` and friends are getters over the screen stack now.
    this.compassPois = [];
  }

  show() { this.hud.data.visible = true; }
  hide() { this.hud.data.visible = false; }

  /* ---------- HUD state (all drawn on canvas) ---------- */
  setHearts(hp, max) {
    hp = num(hp); max = num(max, 5);
    if (hp < this.hud.data.hp) this.hud.data.hurtT = 0.4;
    this.hud.data.hp = hp;
    this.hud.data.maxHp = max;
  }
  /* Numbers only. A stray undefined used to reach the framebuffer as the
     word "undefined" splashed across the top-right corner. */
  setStamina(v) { this.hud.data.stamina = num(v, 1); }
  setAmmo(n) { this.hud.data.ammo = num(n); }
  setMarks(n) { this.hud.data.pendulums = num(n); }
  setRelics(n) { this.hud.data.relics = num(n); }
  setCoins(n) { this.hud.data.coins = num(n); }
  setTimer(seconds) { this.hud.data.timer = num(seconds); }
  setObjective(text) { this.hud.data.objective = text || ''; }
  setPrompt(text) { this.hud.data.prompt = text || null; }
  showPopup(title, sub, icon, head) { this.hud.showPopup(title, sub, icon, head); }
  flashDamage() { this.hud.data.hurtT = 0.4; }
  flashHeal() {}

  /* ---------- boss bar ---------- */
  showBoss(on, name) {
    this.hud.data.boss = on
      ? { frac: 1, chip: 1, name: name || 'HECTOR - EL BASS PRESIDENTE', phase: 'TERM ONE' }
      : null;
  }
  setBoss(frac, phaseLabel) {
    const b = this.hud.data.boss;
    if (!b) return;
    b.frac = frac;
    b.chip = Math.max(b.frac, (b.chip ?? frac) - 0.004);
    if (phaseLabel) b.phase = phaseLabel;
  }

  /* ---------- compass ---------- */
  setCompassPois(list) {
    this.compassPois = list;
    /* -Z is north on the chart, so south sits at yaw 0. These are true
       atan2(dx, dz) bearings like the places below: they used to be stored
       negated, which only looked right where the negation cancelled. */
    const marks = [
      { label: 'N', angle: Math.PI, kind: 'card' },
      { label: 'NE', angle: Math.PI * 0.75, kind: 'inter' },
      { label: 'E', angle: Math.PI / 2, kind: 'card' },
      { label: 'SE', angle: Math.PI * 0.25, kind: 'inter' },
      { label: 'S', angle: 0, kind: 'card' },
      { label: 'SW', angle: -Math.PI * 0.25, kind: 'inter' },
      { label: 'W', angle: -Math.PI / 2, kind: 'card' },
      { label: 'NW', angle: -Math.PI * 0.75, kind: 'inter' },
    ];
    /* Each place gets the one mark object the HUD will read for as long as
       it is on the list. The list itself is rebuilt rarely; the angles
       change every frame, and a fresh object per place per frame was a
       steady drip of garbage for numbers that could just be overwritten. */
    this._poiMarks = list.map((p) => ({
      poi: p,
      out: { label: p.label, kind: p.kind || 'poi', icon: p.icon || null, angle: 0 },
    }));
    this._cardinals = marks;
    this._marks = marks.slice();          // cardinals never move, so they keep slots 0..7
    this._compass = this.hud.data.compass = { yaw: 0, marks: this._marks };
  }

  updateCompass(yaw, px, pz) {
    const out = this._marks;
    if (!out) return;                     // a frame can land before the first setCompassPois
    let n = this._cardinals.length;
    for (const m of this._poiMarks) {
      if (m.poi.hidden) continue;
      const e = m.out;
      e.angle = Math.atan2(m.poi.x - px, m.poi.z - pz);
      out[n++] = e;
    }
    out.length = n;                       // drops whatever was hidden this frame, allocating nothing
    this._compass.yaw = yaw;
  }

  /* ---------- toasts ---------- */
  toast(text, kind = 'gold', ms = 2600) { this.hud.toast(text, kind, ms); }
  clearToasts() { this.hud.clearToasts(); }


  /* ===========================================================
     Full-screen interfaces now live on the pixel canvas
     (js/lib/screens.js). What remains here is the thin API the
     game calls; everything is forwarded to the screen stack.
     =========================================================== */
  get readerActive() { return this.screens?.name === 'reader'; }
  get journalOpen() { return this.screens?.name === 'journal'; }
  get mapOpen() { return this.screens?.name === 'chart'; }
  get dialsOpen() { return this.screens?.name === 'dials'; }
  get shopOpen() { return this.screens?.name === 'shop'; }
  get anyScreen() { return !!this.screens?.open; }

  showReader(head, body, onDone) { this.screens.push('reader', { head, body, onDone }); }
  advanceReader() { if (this.readerActive) { this.screens.key('KeyE'); return true; } return false; }
  closeReader() { if (this.readerActive) this.screens.pop(); }

  flashLightning() {
    const f = this.el.lightning;
    if (!f) return;
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }
}
