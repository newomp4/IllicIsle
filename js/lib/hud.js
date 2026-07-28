/* ===========================================================
   hud.js — the in-game HUD, drawn as pixels.

   This canvas is sized to the renderer's INTERNAL resolution
   (320x224 by default) and composited inside the PS1 pass, so
   the interface gets the same nearest-neighbour upscale, the
   same 15-bit dither, the same scanlines and the same barrel
   curve as the world. It also inherits a tiny per-frame wobble,
   because a PSX framebuffer was never perfectly still.
   =========================================================== */

import { drawText, textWidth, wrapText, panel, ditherRect, normalize, GLYPH_H } from './bitfont.js';
import { COLOURS } from '../net/protocol.js';

/** id -> 6-digit hex, for the Castaways roster pips. */
const COLOUR_HEX = Object.fromEntries(
  COLOURS.map((c) => [c.id, c.hex.toString(16).padStart(6, '0')])
);

const GOLD = '#ffd24a';
const GOLD_LT = '#fff3c4';
const GOLD_DK = '#a8761c';
const RED = '#e0453a';
const JADE = '#63c6a8';
const INK = '#0a0704';

/* 9x7 heart, 1 = outline, 2 = body, 3 = shine */
const HEART = [
  '.11.11...',
  '13322211',
  '132222221',
  '.2222222.',
  '..22222..',
  '...222...',
  '....2....',
].map((r) => r.padEnd(9, '.'));

export class Hud {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = 320; this.c.height = 224;
    this.x = this.c.getContext('2d');
    this.x.imageSmoothingEnabled = false;

    this.data = {
      visible: false,
      hp: 5, maxHp: 5, stamina: 1,
      ammo: 0, ammoMax: 8,
      pendulums: 0, relics: 0, coins: 0,
      objective: '', prompt: null, timer: 0,
      boss: null,           // { frac, chip, name, phase }
      toasts: [],
      compass: null,        // { yaw, marks:[{label,angle,kind}] }
      popup: null,          // { title, sub, icon, t }
      cinema: false, cinemaText: '', cinemaFade: 0, cinemaSkip: false,
      hurtT: 0, night: 0,
    };
    this._wobble = 0;
  }

  setSize(w, h) {
    if (this.c.width === w && this.c.height === h) return;
    this.c.width = w; this.c.height = h;
    this.x.imageSmoothingEnabled = false;
  }

  toast(text, kind = 'gold', ms = 2600) {
    this.data.toasts.push({ text: normalize(text), kind, life: ms / 1000, max: ms / 1000 });
    while (this.data.toasts.length > 4) this.data.toasts.shift();
  }

  /** A collectible card that slides in with its own drawn icon. */
  showPopup(title, sub, icon) {
    this.data.popup = { title, sub, icon, t: 0, dur: 4.6 };
  }

  update(dt) {
    const d = this.data;
    for (let i = d.toasts.length - 1; i >= 0; i--) {
      d.toasts[i].life -= dt;
      if (d.toasts[i].life <= 0) d.toasts.splice(i, 1);
    }
    if (d.popup) {
      d.popup.t += dt;
      if (d.popup.t > d.popup.dur) d.popup = null;
    }
    if (d.hurtT > 0) d.hurtT -= dt;
    this._wobble += dt;
  }

  /* ===========================================================
     DRAW
     =========================================================== */
  render(time) {
    const x = this.x;
    const W = this.c.width, H = this.c.height;
    x.clearRect(0, 0, W, H);
    // Screens draw onto this same canvas afterwards, so we clear
    // unconditionally but only paint the HUD when it's meant to show.
    if (!this.data.visible) return this.c;

    const d = this.data;
    // one-pixel drift, so the HUD breathes with the framebuffer
    const wob = Math.round(Math.sin(time * 1.7) * 0.5 + Math.sin(time * 0.9) * 0.5);

    if (d.mp) {
      // Castaways draws its own left and right columns; hearts and a
      // coconut count mean nothing when you are alive or you are not.
      this._mpTags(d.mp);
      this._mpLeft(4, 4 + wob, d.mp);
      this._mpRight(W - 4, 4 + wob, d.mp, W, H);
      this._compass(W / 2, 3, d.compass);
      this._mpBanner(W, H, d.mp);
      this._timer(W - 4, H - 4);
      if (d.prompt) this._prompt(W / 2, H - 44, d.prompt);
      this._toasts(W / 2, Math.round(H * 0.30));
      if (d.popup) this._popup(W, H, d.popup);
      return this.c;
    }

    this._hearts(4, 4 + wob);
    this._stamina(4, 4 + HEART.length * 2 + 5 + wob);
    this._right(W - 4, 4 + wob);
    this._compass(W / 2, 3, d.compass);
    if (d.boss) this._boss(W / 2, 26, d.boss);
    this._objective(4, H - 4);
    this._timer(W - 4, H - 4);
    if (d.prompt) this._prompt(W / 2, H - 44, d.prompt);
    this._toasts(W / 2, Math.round(H * 0.30));
    if (d.popup) this._popup(W, H, d.popup);
    return this.c;
  }

  /* Letterbox + cutscene caption, drawn after everything else so it
     always sits on top. Called separately from render() because the
     HUD proper is hidden during cutscenes. */
  renderCinema(time) {
    const d = this.data;
    if (!d.cinema) return;
    const x = this.x, W = this.c.width, H = this.c.height;
    const bar = Math.round(H * 0.11);
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, bar);
    x.fillRect(0, H - bar, W, bar);
    // a hairline of dust on the mattes
    x.fillStyle = 'rgba(255,240,200,.10)';
    x.fillRect(0, bar - 1, W, 1);
    x.fillRect(0, H - bar, W, 1);

    if (d.cinemaText && d.cinemaFade > 0.01) {
      const lines = String(d.cinemaText).split('\n');
      const a = Math.min(1, d.cinemaFade);
      const dim = (c) => (a > 0.66 ? c : (a > 0.33 ? '#c9b98a' : '#7a6a48'));
      let y = H - bar - 12 - lines.length * 10;
      for (const raw of lines) {
        for (const ln of wrapText(raw, W - 40, 1, 1)) {
          drawText(x, ln, { x: W / 2, y, scale: 1, align: 'center', color: dim(GOLD_LT) });
          y += 10;
        }
      }
    }
    if (d.cinemaSkip && Math.floor(time * 1.4) % 2 === 0) {
      drawText(x, 'ANY KEY TO SKIP', { x: W - 6, y: H - bar + 3, scale: 1, align: 'right', color: '#6a5c40' });
    }
  }

  /* ===========================================================
     CASTAWAYS
     =========================================================== */

  /** Name tags, already projected into HUD pixels by the game. */
  _mpTags(mp) {
    const x = this.x;
    for (const t of (mp.tags || [])) {
      const hex = '#' + (t.colour >>> 0).toString(16).padStart(6, '0');
      const w = textWidth(t.name, 1) + 4;
      const bx = Math.round(t.x - w / 2), by = t.y - 9;
      if (t.fade < 0.35) continue;
      // a dark plate so a pale name never vanishes into the sky
      x.fillStyle = 'rgba(8,6,4,.62)';
      x.fillRect(bx, by, w, 9);
      x.fillStyle = t.dead ? '#7a2018' : hex;
      x.fillRect(bx, by + 8, w, 1);
      drawText(x, t.name, {
        x: Math.round(t.x), y: by + 2, scale: 1, align: 'center',
        color: t.dead ? '#e0453a' : (t.fade > 0.7 ? '#fff3c4' : '#c9b98a'),
      });
    }
  }

  /** Left column: your own chore list, ticked off as you go. */
  _mpLeft(ox, oy, mp) {
    const x = this.x;
    const agent = mp.role === 'agent';
    const lines = [agent ? 'ROGUE AGENT' : 'CASTAWAY', ...(mp.myTasks || []).map((t) => t.name)];
    if (agent) lines.push('THESE ARE FOR SHOW', 'KNIFE COLD  00', 'Q  SABOTAGE');
    const pw = Math.max(74, lines.reduce((w, l) => Math.max(w, textWidth(l, 1)), 0) + 24);
    const ph = 18 + ((mp.myTasks?.length || 0) + (agent ? 3 : 0)) * 10;
    plate(x, ox - 3, oy - 3, pw, ph);
    drawText(x, agent ? 'ROGUE AGENT' : 'CASTAWAY', {
      x: ox, y: oy, scale: 1, color: agent ? '#ff6a5a' : '#8fe8c8',
    });
    let y = oy + 11;
    for (const t of (mp.myTasks || [])) {
      const done = t.done;
      // a hard pixel checkbox rather than a glyph
      x.fillStyle = INK; x.fillRect(ox, y, 7, 7);
      x.fillStyle = done ? '#3a5a2c' : '#2a1c0c';
      x.fillRect(ox + 1, y + 1, 5, 5);
      if (done) {
        x.fillStyle = '#7ec850';
        x.fillRect(ox + 2, y + 4, 1, 1);
        x.fillRect(ox + 3, y + 5, 1, 1);
        x.fillRect(ox + 4, y + 3, 1, 1);
        x.fillRect(ox + 5, y + 2, 1, 1);
      }
      drawText(x, t.name, {
        x: ox + 11, y: y + 1, scale: 1,
        color: done ? '#5f7a4a' : (agent ? '#d8a898' : '#e2d2a4'),
      });
      y += 10;
    }
    if (agent) {
      drawText(x, 'THESE ARE FOR SHOW', { x: ox, y: y + 2, scale: 1, color: '#b06a5c' });
      y += 12;
      const cd = mp.killIn || 0;
      drawText(x, cd > 0 ? `KNIFE COLD  ${Math.ceil(cd)}` : 'KNIFE READY', {
        x: ox, y: y + 2, scale: 1, color: cd > 0 ? '#a87a70' : '#ff6a5a',
      });
      // the sabotage wheel has nothing to do with the knife's cooldown, so
      // the hint stays put rather than blinking in and out
      drawText(x, 'Q  SABOTAGE', { x: ox, y: y + 12, scale: 1, color: '#a89872' });
    }
  }

  /** Right column: the shared work bar and who is still ashore. */
  _mpRight(ox, oy, mp, W, H) {
    const x = this.x;
    plate(x, ox - 62, oy - 3, 65, 22 + (mp.players?.length || 0) * 10);
    const total = mp.tasksTotal || 0;
    const frac = total ? Math.min(1, (mp.tasksDone || 0) / total) : 0;
    drawText(x, 'WORK', { x: ox, y: oy, scale: 1, align: 'right', color: '#c9b98a' });
    const bw = 56, bh = 5, bx = ox - bw;
    x.fillStyle = INK; x.fillRect(bx - 1, oy + 9, bw + 2, bh + 2);
    x.fillStyle = '#231708'; x.fillRect(bx, oy + 10, bw, bh);
    const n = Math.round(frac * bw);
    for (let i = 0; i < n; i += 3) {
      x.fillStyle = i % 6 ? '#c39a2c' : GOLD;
      x.fillRect(bx + i, oy + 10, 2, bh);
    }

    // roster pips: one square per player, dark when they are gone
    let py = oy + 20;
    for (const p of (mp.players || [])) {
      const hex = '#' + (COLOUR_HEX[p.colour] || '888888');
      const dead = p.alive === false;
      const px = ox - 7;
      x.fillStyle = INK; x.fillRect(px - 1, py - 1, 9, 9);
      x.fillStyle = dead ? '#241a16' : hex;
      x.fillRect(px, py, 7, 7);
      if (dead) {
        x.fillStyle = '#6a2a22';
        for (let i = 0; i < 7; i++) { x.fillRect(px + i, py + i, 1, 1); x.fillRect(px + 6 - i, py + i, 1, 1); }
      }
      if (p.id === mp.selfId) { x.fillStyle = GOLD; x.fillRect(px - 2, py + 3, 1, 1); }
      py += 10;
    }
  }

  /** Centre-bottom: whatever is currently urgent. */
  _mpBanner(W, H, mp) {
    const x = this.x;

    // task hold
    if (mp.task) {
      const bw = 96, bx = Math.round((W - bw) / 2), by = H - 62;
      panelBar(x, bx, by, bw, mp.task.k, mp.task.verb);
    }

    // sabotage countdown
    if (mp.sabotage) {
      const s = mp.sabotage;
      const flash = s.fatal && Math.floor(performance.now() / 220) % 2 === 0;
      const label = `${s.name}  ${Math.ceil(s.left)}`;
      const w = textWidth(label, 1) + 12;
      const bx = Math.round((W - w) / 2), by = H - 26;
      x.fillStyle = s.fatal ? 'rgba(60,8,6,.82)' : 'rgba(30,20,6,.8)';
      x.fillRect(bx, by, w, 12);
      x.fillStyle = s.fatal ? (flash ? '#e0453a' : '#8a2018') : '#a8761c';
      x.fillRect(bx, by, w, 1); x.fillRect(bx, by + 11, w, 1);
      drawText(x, label, {
        x: W / 2, y: by + 3, scale: 1, align: 'center',
        color: s.fatal ? (flash ? '#fff3c4' : '#ffb0a4') : GOLD_LT,
      });
    }

    if (!mp.alive) {
      drawText(x, 'YOU ARE A GHOST - WATCH, AND WAIT', {
        x: W / 2, y: mp.sabotage ? H - 38 : H - 26, scale: 1, align: 'center', color: '#8fb0c8',
      });
    }
  }

  /* ---------- hearts ---------- */
  _hearts(ox, oy) {
    const x = this.x, d = this.data;
    const S = 2, GW = 9 * S, GAP = 3;
    for (let i = 0; i < d.maxHp; i++) {
      const full = i < d.hp;
      const bx = ox + i * (GW + GAP);
      const pop = (d.hurtT > 0 && i === d.hp) ? Math.round(Math.sin(d.hurtT * 30) * 1) : 0;
      for (let r = 0; r < HEART.length; r++) {
        for (let c = 0; c < 9; c++) {
          const ch = HEART[r][c];
          if (ch === '.') continue;
          x.fillStyle = ch === '1' ? (full ? '#5a0f0c' : '#2a100e')
            : ch === '3' ? (full ? '#ffb0a4' : '#4a1c18')
              : (full ? (r < 3 ? '#e0453a' : '#b8302a') : '#3f1714');
          x.fillRect(bx + c * S + pop, oy + r * S, S, S);
        }
      }
    }
  }

  _stamina(ox, oy) {
    const x = this.x, d = this.data;
    const W = 58, H = 5;
    x.fillStyle = INK; x.fillRect(ox - 1, oy - 1, W + 2, H + 2);
    x.fillStyle = '#231708'; x.fillRect(ox, oy, W, H);
    const n = Math.round(d.stamina * W);
    const low = d.stamina < 0.3;
    // segmented, not a smooth bar
    for (let i = 0; i < n; i += 3) {
      x.fillStyle = low ? (i % 6 ? '#c03a30' : '#e0453a') : (i % 6 ? '#5fa838' : '#7ec850');
      x.fillRect(ox + i, oy, 2, H);
    }
  }

  /* ---------- top right: ammo, counters ---------- */
  _right(ox, oy) {
    const x = this.x, d = this.data;
    // coconut pip
    x.fillStyle = INK; x.fillRect(ox - 9, oy + 1, 8, 8);
    x.fillStyle = '#a0763c'; x.fillRect(ox - 8, oy + 2, 6, 6);
    x.fillStyle = '#6b4a24'; x.fillRect(ox - 7, oy + 4, 2, 2);
    drawText(x, String(d.ammo), { x: ox - 12, y: oy + 1, scale: 2, color: GOLD_LT, align: 'right' });

    let y = oy + 14;
    drawText(x, `PEND ${d.pendulums}/4`, {
      x: ox, y, scale: 1, align: 'right',
      color: d.pendulums >= 4 ? GOLD : '#c9b98a',
    });
    y += 10;
    drawText(x, `RELIC ${d.relics}/4`, { x: ox, y, scale: 1, align: 'right', color: '#9fd8c4' });
    y += 10;
    drawText(x, `SYN ${d.coins}`, { x: ox, y, scale: 1, align: 'right', color: '#d8c070' });
  }

  /* ---------- compass ----------
     Wider arc and a tick strip, so it visibly sweeps as you turn. With
     only four cardinals and a narrow window it showed one letter at a
     time and read as stuck. */
  _compass(cx, oy, c) {
    if (!c) return;
    const x = this.x;
    const W = 150, H = 15;
    const left = Math.round(cx - W / 2);
    x.fillStyle = INK; x.fillRect(left - 1, oy - 1, W + 2, H + 2);
    ditherRect(x, left, oy, W, H, '#140d06', '#241708', 0.5, 1);

    const HALF = 1.9;                       // radians visible either side
    const toX = (dA) => Math.round(left + W / 2 + (dA / HALF) * (W / 2));
    const wrap = (a) => {
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    };

    // degree ticks every 15 degrees, taller every 45
    for (let deg = 0; deg < 360; deg += 15) {
      const dA = wrap(deg * Math.PI / 180 - c.yaw);
      if (Math.abs(dA) > HALF) continue;
      const tx = toX(dA);
      const major = deg % 45 === 0;
      x.fillStyle = major ? '#7a6a3c' : '#4a3a1c';
      x.fillRect(tx, oy + H - (major ? 5 : 3), 1, major ? 5 : 3);
    }

    for (const m of c.marks) {
      const dA = wrap(m.angle - c.yaw);
      if (Math.abs(dA) > HALF) continue;
      const px = toX(dA);
      const near = 1 - Math.abs(dA) / HALF;
      const col = m.kind === 'card' ? GOLD
        : m.kind === 'inter' ? '#8a7a52'
          : m.kind === 'goal' ? '#ffe07a'
            : m.kind === 'job' ? '#7ec850' : '#8fd8ff';
      if (near < 0.10) continue;
      if (m.kind === 'job') {
        // a small diamond, low in the strip, clear of the lettering
        x.fillStyle = col;
        x.fillRect(px, oy + 7, 1, 1);
        x.fillRect(px - 1, oy + 8, 3, 1);
        x.fillRect(px - 2, oy + 9, 5, 1);
        x.fillRect(px - 1, oy + 10, 3, 1);
        x.fillRect(px, oy + 11, 1, 1);
        continue;
      }
      drawText(x, m.label, { x: px, y: oy + 2, scale: 1, align: 'center', color: col, shadow: false });
      if (m.kind !== 'card' && m.kind !== 'inter') {
        x.fillStyle = col;
        x.fillRect(px, oy + H - 7, 1, 2);
      }
    }

    // needle and frame
    x.fillStyle = GOLD_LT;
    x.fillRect(Math.round(cx), oy - 3, 1, H + 5);
    x.fillRect(Math.round(cx) - 1, oy - 3, 3, 1);
    x.fillStyle = GOLD_DK;
    x.fillRect(left, oy, 1, H); x.fillRect(left + W - 1, oy, 1, H);
  }

  /* ---------- boss bar ---------- */
  _boss(cx, oy, b) {
    const x = this.x;
    const W = 150, H = 8;
    const left = Math.round(cx - W / 2);
    drawText(x, b.name, { x: cx, y: oy, scale: 1, align: 'center', color: '#ffb46a' });
    const by = oy + 11;
    x.fillStyle = INK; x.fillRect(left - 2, by - 2, W + 4, H + 4);
    x.fillStyle = '#2a1006'; x.fillRect(left, by, W, H);
    const chip = Math.round(W * Math.max(0, Math.min(1, b.chip ?? b.frac)));
    x.fillStyle = '#8a5a2a'; x.fillRect(left, by, chip, H);
    const n = Math.round(W * Math.max(0, Math.min(1, b.frac)));
    for (let i = 0; i < n; i += 2) {
      x.fillStyle = i % 4 ? '#d4622a' : '#ffd24a';
      x.fillRect(left + i, by, 1, H);
    }
    x.fillStyle = GOLD_DK;
    x.fillRect(left - 1, by - 1, W + 2, 1);
    x.fillRect(left - 1, by + H, W + 2, 1);
    if (b.phase) drawText(x, b.phase, { x: cx, y: by + H + 3, scale: 1, align: 'center', color: GOLD });
  }

  /* ---------- objective ---------- */
  _objective(ox, byBottom) {
    const d = this.data;
    if (!d.objective) return;
    const x = this.x;
    const lines = wrapText(d.objective, 150, 1, 1);
    let y = byBottom - lines.length * 9 - 10;
    drawText(x, 'OBJECTIVE', { x: ox, y, scale: 1, color: GOLD_DK });
    y += 10;
    for (const ln of lines) { drawText(x, ln, { x: ox, y, scale: 1, color: GOLD_LT }); y += 9; }
  }

  _timer(ox, byBottom) {
    const x = this.x, t = Math.max(0, this.data.timer);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    const cs = String(Math.floor((t * 100) % 100)).padStart(2, '0');
    drawText(x, 'TIME', { x: ox, y: byBottom - 20, scale: 1, align: 'right', color: GOLD_DK });
    drawText(x, `${mm}:${ss}.${cs}`, { x: ox, y: byBottom - 11, scale: 1, align: 'right', color: GOLD_LT });
  }

  /* ---------- interaction prompt ---------- */
  _prompt(cx, cy, text) {
    const x = this.x;
    const label = String(text).toUpperCase();
    const w = textWidth(label, 1, 1) + 34;
    const h = 15;
    const left = Math.round(cx - w / 2);
    panel(x, left, cy, w, h, { border: 2, dither: 0.55 });
    // [E] key cap
    x.fillStyle = '#f6e3a4'; x.fillRect(left + 5, cy + 4, 8, 8);
    x.fillStyle = '#6b4a18'; x.fillRect(left + 5, cy + 11, 8, 1);
    drawText(x, 'E', { x: left + 7, y: cy + 5, scale: 1, color: '#1a1006', shadow: false });
    drawText(x, label, { x: left + 18, y: cy + 5, scale: 1, color: GOLD_LT });
  }

  /* ---------- toasts ---------- */
  _toasts(cx, oy) {
    const x = this.x;
    let y = oy;
    for (const t of this.data.toasts) {
      const w = textWidth(t.text, 1, 1) + 12;
      const left = Math.round(cx - w / 2);
      const fade = Math.min(1, t.life * 3);
      if (fade < 0.5 && Math.floor(t.life * 12) % 2 === 0) { y += 13; continue; }
      x.fillStyle = 'rgba(8,5,3,.82)';
      x.fillRect(left, y, w, 11);
      const col = t.kind === 'bad' ? RED : t.kind === 'jade' ? JADE : GOLD;
      x.fillStyle = col; x.fillRect(left, y, 2, 11);
      drawText(x, t.text, { x: left + 6, y: y + 2, scale: 1, color: t.kind === 'bad' ? '#ffbdb7' : GOLD_LT });
      y += 13;
    }
  }

  /* ===========================================================
     COLLECTIBLE POPUP — a drawn card with its own pixel icon
     =========================================================== */
  _popup(W, H, p) {
    const x = this.x;
    const CW = 138, CH = 56;
    // slide in, hold, slide out
    const inT = Math.min(1, p.t / 0.45);
    const outT = p.t > p.dur - 0.5 ? (p.dur - p.t) / 0.5 : 1;
    const k = Math.min(inT, Math.max(0, outT));
    const ease = 1 - Math.pow(1 - k, 3);
    const left = Math.round(W - 4 - CW * ease);
    const top = Math.round(H / 2 - CH / 2);

    panel(x, left, top, CW, CH, { border: 2, dither: 0.45, hi: GOLD, lo: '#3a2610' });

    // icon plate
    const ix = left + 5, iy = top + 10;
    x.fillStyle = '#0d0906'; x.fillRect(ix, iy, 36, 36);
    x.fillStyle = '#2a1c0e'; x.fillRect(ix + 1, iy + 1, 34, 34);
    drawRelicIcon(x, p.icon, ix + 2, iy + 2, 32, Math.sin(p.t * 3) * 0.5);

    // sparkle corners
    if (p.t % 0.6 < 0.3) {
      x.fillStyle = GOLD_LT;
      x.fillRect(ix - 2, iy - 2, 2, 2);
      x.fillRect(ix + 36, iy + 36, 2, 2);
    }

    const tx = left + 46;
    drawText(x, 'RELIC FOUND', { x: tx, y: top + 6, scale: 1, color: GOLD });
    x.fillStyle = '#5c3f1c'; x.fillRect(tx, top + 15, CW - 52, 1);
    const lines = wrapText(p.title, CW - 52, 1, 1).slice(0, 3);
    let ty = top + 20;
    for (const ln of lines) { drawText(x, ln, { x: tx, y: ty, scale: 1, color: GOLD_LT }); ty += 9; }
    if (p.sub) drawText(x, p.sub, { x: tx, y: top + CH - 11, scale: 1, color: '#9fd8c4' });
  }
}

/* ===========================================================
   RELIC ICONS — small pixel drawings, one per collectible
   =========================================================== */
/**
 * A backing plate for HUD text. Solid enough that a bright sky cannot eat
 * the lettering, with a dither over the top so it still belongs to the
 * same picture as everything else.
 */
function plate(x, ox, oy, w, h) {
  x.fillStyle = 'rgba(8,6,3,.90)';
  x.fillRect(ox, oy, w, h);
  // a single dithered row along each edge, so it fades out rather than
  // stopping dead against the world
  ditherRect(x, ox, oy, w, 2, 'rgba(0,0,0,0)', 'rgba(8,6,3,.90)', 0.5, 1);
  ditherRect(x, ox, oy + h - 2, w, 2, 'rgba(0,0,0,0)', 'rgba(8,6,3,.90)', 0.5, 1);
  ditherRect(x, ox + w - 2, oy, 2, h, 'rgba(0,0,0,0)', 'rgba(8,6,3,.90)', 0.5, 1);
}

/** A labelled progress bar, hard-edged and segmented. */
function panelBar(x, bx, by, bw, k, label) {
  x.fillStyle = INK; x.fillRect(bx - 1, by - 1, bw + 2, 9);
  x.fillStyle = '#231708'; x.fillRect(bx, by, bw, 7);
  const n = Math.round(Math.max(0, Math.min(1, k)) * bw);
  for (let i = 0; i < n; i += 3) {
    x.fillStyle = i % 6 ? '#3f8f6a' : JADE;
    x.fillRect(bx + i, by, 2, 7);
  }
  drawText(x, label, { x: bx + bw / 2, y: by - 11, scale: 1, align: 'center', color: JADE });
}

export function drawRelicIcon(x, kind, ox, oy, size, bob = 0) {
  const u = size / 16;
  const px = (gx, gy, w, h, col) => {
    x.fillStyle = col;
    x.fillRect(Math.round(ox + gx * u), Math.round(oy + (gy + bob) * u),
      Math.ceil(w * u), Math.ceil(h * u));
  };

  if (kind === 'syncoin') {
    px(4, 2, 8, 12, '#c9a63c');
    px(5, 3, 6, 10, '#f0dc9a');
    px(6, 4, 4, 8, '#d8c070');
    px(7, 4, 1, 8, '#8a6c2a');
    px(9, 5, 1, 6, '#8a6c2a');
    px(6, 7, 4, 1, '#8a6c2a');
    px(5, 3, 1, 2, '#fff6d0');

  } else if (kind === 'tasha') {
    // head and shoulders of an automaton
    px(5, 2, 6, 6, '#d0d6da');
    px(4, 3, 1, 4, '#a8b0b6');
    px(11, 3, 1, 4, '#a8b0b6');
    px(6, 4, 4, 2, '#6fd0e0');       // visor
    px(6, 4, 1, 2, '#bff0ff');
    px(4, 8, 8, 5, '#bfc4c8');
    px(3, 9, 1, 3, '#a8b0b6');
    px(12, 9, 1, 3, '#a8b0b6');
    px(7, 9, 2, 2, '#6fd0e0');       // core
    px(5, 13, 6, 1, '#8a9298');

  } else if (kind === 'aerlingus') {
    // green fuselage section with a shamrock
    px(2, 6, 12, 5, '#2f7a52');
    px(2, 6, 12, 1, '#3f9a68');
    px(2, 8, 12, 1, '#e8ece8');      // cheatline
    px(4, 9, 1, 1, '#203038');
    px(6, 9, 1, 1, '#203038');
    px(8, 9, 1, 1, '#203038');
    px(11, 2, 3, 5, '#2f7a52');      // tail fin
    px(12, 3, 1, 1, '#dfe8dc');
    px(11, 4, 3, 1, '#dfe8dc');
    px(12, 5, 1, 1, '#dfe8dc');
    px(2, 11, 12, 2, '#c9b083');      // sand

  } else if (kind === 'watermelon') {
    px(3, 5, 10, 8, '#3f7a33');
    px(4, 4, 8, 1, '#4a8f3c');
    px(4, 13, 8, 1, '#2b5a24');
    px(5, 5, 1, 8, '#1f4a20');
    px(8, 4, 1, 9, '#1f4a20');
    px(11, 5, 1, 8, '#1f4a20');
    px(7, 2, 1, 2, '#6a8a3a');        // stem
    px(4, 6, 1, 2, '#7fc060');        // shine

  } else if (kind === 'coin') {
    px(5, 4, 6, 8, '#d8c070');
    px(6, 5, 4, 6, '#f0dc9a');
    px(7, 6, 2, 4, '#8a6c2a');
  }
}
