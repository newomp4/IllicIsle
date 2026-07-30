/* ===========================================================
   ui.js — HUD, compass, reader, journal, chart, dial puzzle.
   All plain DOM on top of the canvas.
   =========================================================== */

import { Hud } from './lib/hud.js';
import { ScreenStack } from './lib/screens.js';

const $ = (id) => document.getElementById(id);

/* ===========================================================
   GLYPHS — drawn as chunky pixel icons, shared by the chart
   and the door dials so the puzzle reads the same in both.
   =========================================================== */
export function drawGlyph(ctx, name, x, y, size, color = '#ffd24a') {
  const u = size / 16;                       // one "pixel" of the 16x16 grid
  const px = (gx, gy, w = 1, h = 1) => ctx.fillRect(x + gx * u, y + gy * u, w * u, h * u);
  ctx.fillStyle = color;

  switch (name) {
    case 'SUN': {
      px(6, 6, 4, 4);
      for (const [gx, gy] of [[7, 2], [7, 12], [2, 7], [12, 7]]) px(gx, gy, 2, 2);
      for (const [gx, gy] of [[3, 3], [11, 3], [3, 11], [11, 11]]) px(gx, gy, 2, 2);
      break;
    }
    case 'MOON': {
      // crescent: a disc with a bite taken out of it
      for (let gy = 2; gy < 14; gy++) {
        const dy = gy - 8;
        const half = Math.sqrt(Math.max(0, 36 - dy * dy));
        const x0 = Math.round(8 - half), x1 = Math.round(8 + half);
        const bx0 = Math.round(11 - Math.sqrt(Math.max(0, 30 - dy * dy)));
        for (let gx = x0; gx < x1; gx++) {
          if (gx >= bx0) continue;
          px(gx, gy);
        }
      }
      break;
    }
    case 'EYE': {
      for (let gy = 5; gy < 11; gy++) {
        const t = Math.abs(gy - 7.5) / 3;
        const half = Math.round(7 * (1 - t * t));
        px(8 - half, gy, half * 2, 1);
      }
      ctx.fillStyle = '#1a1006';
      px(6, 6, 4, 4);
      ctx.fillStyle = color;
      px(7, 7, 2, 2);
      break;
    }
    case 'SPIRAL': {
      const pts = [];
      for (let i = 0; i < 46; i++) {
        const a = i * 0.42;
        const r = 0.8 + i * 0.135;
        pts.push([Math.round(8 + Math.cos(a) * r), Math.round(8 + Math.sin(a) * r)]);
      }
      const seen = new Set();
      for (const [gx, gy] of pts) {
        const k = gx + ',' + gy;
        if (seen.has(k) || gx < 0 || gy < 0 || gx > 15 || gy > 15) continue;
        seen.add(k);
        px(gx, gy);
      }
      break;
    }
  }
}

/* A 9x8 pixel heart, drawn once and used as a background image so the HUD
   is genuinely pixel art rather than a CSS clip-path silhouette. */
function makeHeartSprite(full) {
  const M = [
    '.XX.XX...',
    'XOOXOOX..',
    'XOOOOOOX.',
    'XOOOOOOX.',
    '.XOOOOX..',
    '..XOOX...',
    '...XX....',
  ];
  const S = 4, W = 9, H = 7;
  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const ch = M[j][i];
      if (ch === '.') continue;
      if (ch === 'X') x.fillStyle = full ? '#7a1410' : '#2e1210';
      else x.fillStyle = full ? (j < 2 ? '#ff6a5a' : '#e0453a') : '#4a1c18';
      x.fillRect(i * S, j * S, S, S);
    }
  }
  // highlight glint
  if (full) { x.fillStyle = '#ffb0a4'; x.fillRect(S, S, S, S); x.fillRect(S * 2, S, S, S); }
  return c.toDataURL();
}

let HEART_FULL = null, HEART_EMPTY = null;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class UI {
  constructor(audio) {
    if (!HEART_FULL) { HEART_FULL = makeHeartSprite(true); HEART_EMPTY = makeHeartSprite(false); }
    this.audio = audio;
    // The only DOM left is the lightning flash, which needs to cover the
    // whole viewport rather than the low-res framebuffer.
    this.el = { lightning: $('lightning') };

    /* The in-game HUD is a canvas rendered at the framebuffer's own
       resolution and composited inside the PS1 pass, so it pixelates,
       dithers and curves along with the world. The DOM nodes for it are
       gone; only full-screen panels stay in the document. */
    this.hud = new Hud();
    this.screens = null;      // ScreenStack, attached by Game
    $('hud')?.remove();

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
    /* -Z is north on the chart, so south sits at yaw 0. */
    const marks = [
      { label: 'N', angle: Math.PI, kind: 'card' },
      { label: 'NE', angle: -Math.PI * 0.75, kind: 'inter' },
      { label: 'E', angle: -Math.PI / 2, kind: 'card' },
      { label: 'SE', angle: -Math.PI * 0.25, kind: 'inter' },
      { label: 'S', angle: 0, kind: 'card' },
      { label: 'SW', angle: Math.PI * 0.25, kind: 'inter' },
      { label: 'W', angle: Math.PI / 2, kind: 'card' },
      { label: 'NW', angle: Math.PI * 0.75, kind: 'inter' },
    ];
    this._poiMarks = list.map((p) => ({ poi: p, label: p.label, kind: p.kind || 'poi' }));
    this._cardinals = marks;
    this.hud.data.compass = { yaw: 0, marks };
  }

  updateCompass(yaw, px, pz) {
    const marks = this._cardinals ? this._cardinals.slice() : [];
    for (const m of (this._poiMarks || [])) {
      if (m.poi.hidden) continue;
      marks.push({
        label: m.label, kind: m.kind,
        angle: Math.atan2(m.poi.x - px, m.poi.z - pz),
      });
    }
    this.hud.data.compass = { yaw, marks };
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
