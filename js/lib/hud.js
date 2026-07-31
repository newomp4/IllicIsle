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

  /** Wipe the stack. Used when a room change would otherwise pile four up. */
  clearToasts() { this.data.toasts.length = 0; }

  toast(text, kind = 'gold', ms = 2600) {
    /* The same message twice running is one message with its clock reset,
       not two lines saying the same thing. */
    const t = normalize(text);
    const last = this.data.toasts[this.data.toasts.length - 1];
    if (last && last.text === t) { last.life = ms / 1000; last.max = ms / 1000; return; }
    this.data.toasts.push({ text: t, kind, life: ms / 1000, max: ms / 1000 });
    while (this.data.toasts.length > 4) this.data.toasts.shift();
  }

  /** A collectible card that slides in with its own drawn icon. */
  showPopup(title, sub, icon, head) {
    this.data.popup = { title, sub, icon, head, t: 0, dur: 4.6 };
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
      /* Castaways draws its own columns. Everything is deliberately tight —
         this HUD is up for the whole round and it should sit at the edges
         of the picture, not across it. */
      this._mpTags(d.mp);
      this._mpLeft(3, 3 + wob, d.mp);
      this._mpRight(W - 3, 3 + wob, d.mp);
      this._compass(W / 2, 2, d.compass);
      this._mpBanner(W, H, d.mp);
      this._mpBelt(4, H - 52, d.mp);
      /* Clear of the toast stack above it (two at 13 apiece from 58, so
         84 at the worst) and clear of the belt caption below it at 164. */
      if (d.mp.scanner?.on) this._scanner(4, 86, d.mp.scanner);
      // and the till roll in the one gap nothing else uses
      if (d.mp.receipts) this._receipts(138, 24, d.mp.receipts);
      if (d.mp.role === 'agent') this._mpAgent(W - 5, H - 16, d.mp);
      /* An Agent has a knife panel in the bottom right corner, and a long
         prompt centred on the screen runs straight into it — "QUEZETRIEL
         QUEBOLIUS" printed the S of SABOTAGE off. Centre the prompt in
         whatever room is actually left. */
      if (d.prompt) this._prompt(d.mp.role === 'agent' ? (W - 118) / 2 : W / 2, H - 34, d.prompt);
      this._toasts(W / 2, Math.round(H * 0.26));
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
      const w = textWidth(t.name, 1) + 3;
      const bx = Math.round(t.x - w / 2), by = t.y - 8;
      if (t.fade < 0.35) continue;
      // a dark plate so a pale name never vanishes into the sky
      x.fillStyle = 'rgba(8,6,4,.62)';
      x.fillRect(bx, by, w, 8);
      x.fillStyle = t.dead ? '#7a2018' : hex;
      x.fillRect(bx, by + 7, w, 1);
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
    const tasks = mp.myTasks || [];
    /* Measured without building an array of strings first. This runs every
       frame; anything it allocates has to be collected later, and a
       collection mid-round is a visible stutter. */
    const CAP = 136;   // the list is a reminder, not a document
    let widest = textWidth(agent ? 'ROGUE AGENT' : 'CASTAWAY', 1);
    for (const t of tasks) {
      const w = textWidth(t.name, 1) + (t.steps > 1 ? 24 : 0);
      if (w > widest) widest = w;
    }
    const pw = Math.min(CAP, Math.max(64, widest + 15));
    const ph = 12 + tasks.length * 8 + (agent ? 8 : 0);
    plate(x, ox - 2, oy - 2, pw, ph);

    drawText(x, agent ? 'ROGUE AGENT' : 'CASTAWAY', {
      x: ox, y: oy, scale: 1, color: agent ? '#ff6a5a' : '#8fe8c8',
    });
    let y = oy + 9;
    const beat = Math.floor(performance.now() / 110) % 2 === 0;
    for (const t of tasks) {
      const done = t.done;
      const hot = mp.flash === t.id;
      if (hot && beat) { x.fillStyle = 'rgba(126,200,80,.30)'; x.fillRect(ox - 2, y - 1, pw, 8); }
      x.fillStyle = INK; x.fillRect(ox, y, 5, 5);
      x.fillStyle = done ? (hot && beat ? '#9fe870' : '#3a5a2c') : (t.half ? '#5a4a12' : '#2a1c0c');
      x.fillRect(ox + 1, y + 1, 3, 3);
      if (!done && t.half) { x.fillStyle = '#ffd24a'; x.fillRect(ox + 1, y + 3, 3, 1); }
      let label = (!done && t.steps > 1) ? `${t.name} ${t.step + 1}/${t.steps}` : t.name;
      while (label.length > 4 && textWidth(label, 1) > pw - 11) label = label.slice(0, -1);
      drawText(x, label, {
        x: ox + 8, y, scale: 1,
        color: hot ? '#dfffc4' : (done ? '#5f7a4a' : (t.half ? '#ffd88a' : (agent ? '#d8a898' : '#e2d2a4'))),
      });
      y += 8;
    }
    /* This used to say THESE ARE FOR SHOW, and it was true: an Agent's
       chores did not move the bar, which is exactly the tell the crew
       learned to force. They count now, and the line has to say so,
       because the cost is the whole decision. */
    if (agent) drawText(x, 'THESE COUNT FOR THEM', { x: ox, y: y + 1, scale: 1, color: '#c08a5c' });
    else drawText(x, 'TAB  MAP', { x: ox, y: y + 1, scale: 1, color: '#7a6a4a' });
  }

  /* ===========================================================
     THE SIGNAL SCANNER

     A spectrum analyser and a steer, in that order, because that is the
     order you use them in: look at the band, see what is on it, lock the
     one you want, then turn until the marker centres and walk.

     The sonar this replaced was a pretty circle that told you a bearing
     you then had to hold in your head while you turned. This tells you
     which way to turn and how far you have left, which is the only two
     things anybody actually wanted.
     =========================================================== */
  _scanner(ox, oy, sc) {
    const x = this.x;
    const W = 98, H = 76;

    /* ---- the case ---- */
    x.fillStyle = 'rgba(6,8,6,.92)'; x.fillRect(ox - 1, oy - 1, W + 2, H + 2);
    x.fillStyle = '#2a2e28'; x.fillRect(ox, oy, W, H);
    x.fillStyle = '#3c423a'; x.fillRect(ox, oy, W, 1);
    x.fillStyle = '#161a15'; x.fillRect(ox, oy + H - 1, W, 1);
    for (const [sx, sy] of [[ox + 3, oy + 3], [ox + W - 5, oy + 3],
      [ox + 3, oy + H - 5], [ox + W - 5, oy + H - 5]]) {
      x.fillStyle = '#5a6154'; x.fillRect(sx, sy, 2, 2);
      x.fillStyle = '#161a15'; x.fillRect(sx, sy + 1, 2, 1);
    }

    /* ---- the band: a spectrum with one peak per transmitter ---- */
    const BX = ox + 5, BY = oy + 4, BW = W - 10, BH = 21;
    x.fillStyle = '#04120a'; x.fillRect(BX, BY, BW, BH);
    // the graticule
    x.fillStyle = 'rgba(90,220,130,.13)';
    for (let i = 1; i < 6; i++) x.fillRect(BX + Math.round(i * BW / 6), BY, 1, BH);
    for (let i = 1; i < 3; i++) x.fillRect(BX, BY + Math.round(i * BH / 3), BW, 1);

    /* The noise floor: a live trace, so the instrument is alive even when
       there is nothing on the band worth hearing. */
    x.fillStyle = 'rgba(90,220,130,.32)';
    for (let i = 0; i < BW; i++) {
      const n = Math.sin(i * 0.7 + sc.t * 9) * 0.5 + Math.sin(i * 2.3 - sc.t * 13) * 0.5;
      const h = 1 + Math.abs(n) * 2;
      x.fillRect(BX + i, BY + BH - h, 1, h);
    }

    /* and a peak for each carrier, drawn as a proper skirt rather than a
       spike, because that is what a carrier looks like on a set like this */
    for (const b of (sc.bars || [])) {
      const px = BX + Math.round(b.band * (BW - 2)) + 1;
      const ph = Math.max(3, Math.round(b.strength * (BH - 4)));
      const locked = sc.lock && Math.abs(b.band - sc.band) < 0.001;
      for (let w = -3; w <= 3; w++) {
        const k = 1 - Math.abs(w) / 4;
        const hh = Math.round(ph * k * k);
        if (hh < 1) continue;
        const col = b.kind === 'him'
          ? (locked ? '#fff3c4' : '#ffd24a')
          : (locked ? '#b8ffd0' : '#3e9a68');
        x.fillStyle = col;
        x.fillRect(px + w, BY + BH - hh, 1, hh);
      }
      // the lock brackets, which sit outside the peak
      if (locked) {
        x.fillStyle = '#fff3c4';
        x.fillRect(px - 6, BY + 1, 1, 4); x.fillRect(px - 6, BY + 1, 3, 1);
        x.fillRect(px + 6, BY + 1, 1, 4); x.fillRect(px + 4, BY + 1, 3, 1);
      }
    }
    x.fillStyle = '#1e7a4a';
    x.fillRect(BX, BY, BW, 1); x.fillRect(BX, BY + BH - 1, BW, 1);
    x.fillRect(BX, BY, 1, BH); x.fillRect(BX + BW - 1, BY, 1, BH);
    // which of the carriers on the band you are on, in the corner of the graph
    if (sc.lock && sc.count > 1) {
      drawText(x, `${sc.index}/${sc.count}`, {
        x: BX + BW - 3, y: BY + 2, scale: 1, align: 'right', color: '#3e8a5c',
      });
    }

    /* ---- what is locked ---- */
    const NY = oy + 27;
    if (!sc.lock) {
      drawText(x, 'BAND CLEAR', {
        x: ox + W / 2, y: NY + 10, scale: 1, align: 'center', color: '#4a7a5c',
      });
      drawText(x, 'NOTHING TRANSMITTING', {
        x: ox + W / 2, y: NY + 20, scale: 1, align: 'center', color: '#2e5a42',
      });
      return;
    }
    const him = sc.kind === 'him';
    /* The whole line is the name. Where you are on the band goes in the
       corner of the graph instead — sharing this line with it cut
       "UNKNOWN HEAT" down to "UNKNOWN HEA", and a set that cannot print
       the name of the thing it found is not much of a set. */
    drawText(x, sc.name.slice(0, 14), {
      x: BX, y: NY, scale: 1, color: him ? '#ffd24a' : '#8fe8a0',
    });

    /* ---- THE STEER ----
       A tape with a marker that centres when you are facing it. Turn until
       it is in the middle, then walk.

       Two things were wrong with the old one. It steered off the BODY yaw,
       which lags a turn and does not move at all if you stand still and
       look around, so a fast turn simply did not register. And the tape
       only covered a hundred and nine degrees either side, so anything
       behind you pinned the marker to the edge and left it there — which
       is the same picture whether the thing is at your four o'clock or
       directly behind you.

       It covers a quarter turn each way now and everything outside that is
       a solid arrowhead at the edge with the angle printed on it, so you
       always know which way to turn AND how far. */
    const SY = NY + 10;
    const SH = 15;
    x.fillStyle = '#04120a'; x.fillRect(BX, SY, BW, SH);
    // how far off your heading the bearing is, wrapped to +/- pi
    let rel = sc.bearing - sc.facing;
    rel = ((rel % 6.283185) + 9.424778) % 6.283185 - 3.141593;
    const HALF = 1.5708;                   // a quarter turn, either side
    const mid = BX + BW / 2;
    const off = Math.abs(rel) > HALF;
    const px2 = mid + Math.max(-BW / 2 + 4, Math.min(BW / 2 - 4, (rel / HALF) * (BW / 2)));
    const on = Math.abs(rel) < 0.14;

    // the doubt, either side of the marker
    if (!off) {
      const sw = Math.max(2, Math.min(BW / 2, (sc.spread / HALF) * (BW / 2)));
      x.fillStyle = him ? 'rgba(255,210,74,.16)' : 'rgba(90,220,130,.14)';
      x.fillRect(Math.round(px2 - sw), SY + 2, Math.round(sw * 2), SH - 4);
    }
    // the centre gate: two posts, so "in the middle" is a place and not a line
    x.fillStyle = on ? 'rgba(255,243,196,.55)' : 'rgba(200,255,220,.26)';
    x.fillRect(mid - 4, SY + 1, 1, SH - 2);
    x.fillRect(mid + 4, SY + 1, 1, SH - 2);
    // ticks, so the tape has a scale you can read a turn against
    x.fillStyle = 'rgba(90,220,130,.22)';
    for (const f of [0.33, 0.66, 1]) {
      x.fillRect(BX + Math.round(BW / 2 * (1 - f)), SY + SH - 4, 1, 3);
      x.fillRect(BX + Math.round(BW / 2 * (1 + f)) - 1, SY + SH - 4, 1, 3);
    }

    if (off) {
      /* Behind you. A solid arrowhead at the edge it is nearer, and the
         angle, so a hundred and eighty is plainly not the same as ninety
         five. It does not blink: a blinking arrow reads as a fault. */
      const right = rel > 0;
      const ax = right ? BX + BW - 3 : BX + 2;
      x.fillStyle = him ? '#ffd24a' : '#8fe8a0';
      for (let r = 0; r < 7; r++) {
        const h = 13 - r * 2;
        if (h < 1) break;
        x.fillRect(right ? ax - r : ax + r, SY + 1 + ((13 - h) >> 1), 1, h);
      }
      /* One string, centred, clear of both edges — a separate degree
         readout on the right ran straight into the arrowhead. */
      drawText(x, `${right ? 'RIGHT' : 'LEFT'} ${Math.round(Math.abs(rel) * 57.3)}`, {
        x: mid, y: SY + 4, scale: 1, align: 'center', color: '#8ad8a8',
      });
    } else {
      // the marker itself: a plumb bob, so the point is unambiguous
      x.fillStyle = on ? '#fff3c4' : (him ? '#ffd24a' : '#8fe8a0');
      const mx = Math.round(px2);
      for (let r = 0; r < 4; r++) x.fillRect(mx - r, SY + 1 + r, r * 2 + 1, 1);
      x.fillRect(mx - 1, SY + 5, 3, SH - 7);
    }
    x.fillStyle = '#1e7a4a';
    x.fillRect(BX, SY, BW, 1); x.fillRect(BX, SY + SH - 1, BW, 1);

    /* ---- range, and how good the signal is ---- */
    const RY = SY + SH + 2;
    drawText(x, `${sc.shown ?? Math.round(sc.dist)}M`, {
      x: BX, y: RY, scale: 1, color: on ? '#fff3c4' : '#8fe8a0',
    });
    // a strength bar, which also tells you it is getting better as you walk
    const gw = BW - 34;
    x.fillStyle = '#0b1f14'; x.fillRect(BX + 32, RY + 1, gw, 5);
    const gn = Math.round(gw * sc.strength);
    for (let i = 0; i < gn; i += 2) {
      x.fillStyle = i > gw * 0.75 ? '#fff3c4' : (him ? '#ffd24a' : '#5ae08a');
      x.fillRect(BX + 32 + i, RY + 2, 1, 3);
    }

    /* ---- what the thing actually is ---- */
    /* Fourteen characters: any wider and a centred line runs under the
       screws in the bottom corners of the case. */
    drawText(x, on ? 'ON THE NOSE' : (sc.note || 'B  STEP').slice(0, 14), {
      x: ox + W / 2, y: oy + H - 10, scale: 1, align: 'center',
      color: on ? '#8fe8a0' : (him ? '#c09a3a' : '#2e6a48'),
    });
  }

  /* ===========================================================
     THE RECEIPT PRINTER

     Ferdi's docket machine, on your belt. Paper feeds out of the head at
     the top, the printing catches up with it a line at a time, it hangs
     there for fifteen seconds, then it rolls back in.

     It is drawn as paper — off-white, a torn top edge, a perforated
     bottom one — because the whole point is that it reads as a thing
     somebody handed you rather than as another green box.
     =========================================================== */
  _receipts(ox, oy, list) {
    const x = this.x;
    /* WHERE THIS LIVES, and why it is one at a time.

       Every other edge of this HUD is spoken for: chores top left, purse
       and work top right, toasts across the middle at 58, the item card
       at 86 to 138 on the right, the scanner down the left from 86, the
       belt at 164 and the Agent's knife panel at 157. The one rectangle
       nothing else uses is under the compass and to the right of the
       chore list — ninety-eight by thirty, at 138, 24, which stops six
       pixels short of the purse plate.

       A docket at a time fits there and nothing else ever will, which is
       also how a printer with one station behaves: if a second sale comes
       in while the first is still hanging there, the first one tears off
       and the new one feeds in behind it. */
    const W = 98, H = 30;
    const r = list[list.length - 1];
    if (!r) return;
    const outT = Math.min(1, r.t / 0.5);
    const backT = r.t > r.life ? Math.min(1, (r.t - r.life) / 0.7) : 0;
    const shown = Math.round(H * (1 - Math.pow(1 - outT, 3)) * (1 - backT));
    const y = oy;

    // the printer head: a dark slot the paper comes out of
    x.fillStyle = '#1a1d18'; x.fillRect(ox - 2, y - 5, W + 4, 5);
    x.fillStyle = '#3a4038'; x.fillRect(ox - 2, y - 5, W + 4, 1);
    x.fillStyle = '#0a0c09'; x.fillRect(ox, y - 2, W, 2);
    // a lamp on the head that blinks while it is feeding
    if (shown < H && backT < 1) {
      x.fillStyle = Math.floor(r.t * 12) % 2 ? '#7affa8' : '#2a5a3a';
      x.fillRect(ox + W - 4, y - 4, 2, 2);
    }
    if (shown < 3) return;

    // the paper, clipped to however much of it is out
    x.save();
    x.beginPath(); x.rect(ox, y, W, shown); x.clip();
    x.fillStyle = '#e8e3d2'; x.fillRect(ox, y, W, H);
    x.fillStyle = 'rgba(150,138,110,.35)';
    x.fillRect(ox, y, 1, H); x.fillRect(ox + W - 1, y, 1, H);
    // the faint ruling a thermal roll has
    x.fillStyle = 'rgba(60,50,40,.07)';
    for (let i = 2; i < H; i += 4) x.fillRect(ox + 3, y + i, W - 6, 1);

    /* What it says, in the order a printer would put it down — the lines
       catch up with the paper rather than arriving with it. */
    const line = (n) => outT >= 1 && r.t > 0.28 + n * 0.13;
    // a name that runs off the roll says so, rather than stopping mid-word
    const fit = (str) => {
      const full = String(str);
      let v = full;
      while (v.length > 2 && textWidth(v, 1) > W - 8) v = v.slice(0, -1);
      return v === full ? v : `${v.slice(0, -1)}.`;
    };
    if (line(0)) drawText(x, fit(r.who), { x: ox + 4, y: y + 2, scale: 1, color: '#241e16' });
    if (line(1)) drawText(x, fit(r.what), { x: ox + 4, y: y + 11, scale: 1, color: '#4a4032' });
    if (line(2)) {
      x.fillStyle = 'rgba(60,50,40,.45)';
      for (let i = 4; i < W - 4; i += 2) x.fillRect(ox + i, y + 19, 1, 1);
      drawText(x, 'PAID', { x: ox + 4, y: y + 21, scale: 1, color: '#7a6c54' });
      const pr = String(r.price);
      drawText(x, pr, { x: ox + W - 4, y: y + 21, scale: 1, align: 'right', color: '#241e16' });
      drawCoinPip(x, ox + W - 6 - textWidth(pr, 1) - 7, y + 21);
    }
    x.restore();

    // the torn bottom edge, on whatever is actually out
    const bot = y + shown;
    x.fillStyle = '#c9c2ad';
    for (let i = 0; i < W; i += 3) x.fillRect(ox + i, bot - 1, 2, 1);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(ox, bot, W, 1);
  }

  /**
   * The Agent's own panel, in the corner where a weapon readout belongs  /**
   * The Agent's own panel, in the corner where a weapon readout belongs
   * rather than buried under the shopping list.
   */
  _mpAgent(rx, by, mp) {
    const x = this.x;
    const cools = mp.cools || [];
    const PW = 112;
    const PH = 30 + Math.min(3, cools.length) * 7;
    const ox = rx - PW, oy = by - PH;
    plate(x, ox, oy, PW, PH);

    const grace = mp.graceIn || 0;
    const cd = mp.killIn || 0;
    const left = grace > 0 ? grace : cd;
    const ready = left <= 0;
    const total = grace > 0 ? Math.max(grace, 1) : Math.max(mp.killTotal || 1, 1);

    drawKnife(x, ox + 3, oy + 3, ready);
    drawText(x, ready ? 'KNIFE READY' : 'KILL COOLDOWN', {
      x: ox + 14, y: oy + 3, scale: 1, color: ready ? '#ff8a7a' : '#a87a70',
    });
    const bw = PW - 6, bx = ox + 3, by2 = oy + 12;
    x.fillStyle = INK; x.fillRect(bx - 1, by2 - 1, bw + 2, 6);
    x.fillStyle = '#20100c'; x.fillRect(bx, by2, bw, 4);
    const k = ready ? 1 : 1 - Math.min(1, left / total);
    for (let i = 0; i < Math.round(k * bw); i += 3) {
      x.fillStyle = ready
        ? (Math.floor(performance.now() / 220) % 2 ? '#ff6a5a' : '#c03a2c')
        : (i % 6 ? '#8a2018' : '#c03a2c');
      x.fillRect(bx + i, by2, 2, 4);
    }
    // the seconds sit on the bar, not on top of the label
    drawText(x, ready ? 'F' : `${Math.ceil(left)}`, {
      x: ox + PW - 4, y: by2 - 1, scale: 1, align: 'right',
      color: ready ? '#ffd8ce' : '#e2b0a4',
    });

    // the sabotage key, as an actual key
    const sabReady = !cools.length && !mp.sabotage;
    const ky = oy + 20;
    x.fillStyle = sabReady ? '#c39a2c' : '#3a2a18';
    x.fillRect(ox + 3, ky, 9, 9);
    x.fillStyle = sabReady ? '#ffe9a8' : '#5a4a30';
    x.fillRect(ox + 3, ky, 9, 1); x.fillRect(ox + 3, ky, 1, 9);
    drawText(x, 'Q', { x: ox + 7, y: ky + 2, scale: 1, align: 'center',
      color: sabReady ? '#160c04' : '#8a7a52' });
    drawText(x, sabReady ? 'SABOTAGE' : 'COOLING', {
      x: ox + 15, y: ky + 2, scale: 1, color: sabReady ? GOLD_LT : '#7a6a4a' });

    let cy = oy + 31;
    for (const c of cools.slice(0, 3)) {
      const cbw = PW - 36;
      drawText(x, (c.kind || '').toUpperCase().slice(0, 6), { x: ox + 3, y: cy, scale: 1, color: '#7a5a54' });
      x.fillStyle = INK; x.fillRect(ox + 30, cy, cbw + 2, 5);
      x.fillStyle = '#20100c'; x.fillRect(ox + 31, cy + 1, cbw, 3);
      const nn = Math.round((1 - Math.min(1, c.left / Math.max(1, c.total))) * cbw);
      for (let i = 0; i < nn; i += 3) {
        x.fillStyle = i % 6 ? '#6a4a24' : '#c39a2c';
        x.fillRect(ox + 31 + i, cy + 1, 2, 3);
      }
      cy += 7;
    }
  }

  /**
   * Right column: your purse, the island's work, and the crew.
   *
   * It used to be a bar, a bare number and a ragged tail of colour chips
   * that ran off the bottom of its own plate. The purse is the thing you
   * check most often in this mode, so it leads, it says what it is, and it
   * flinches when it changes.
   */
  _mpRight(ox, oy, mp) {
    const x = this.x;
    const players = mp.players || [];
    const PW = 74;

    /* the purse's own animation, kept here rather than in the game so it
       survives whatever the round is doing */
    const coins = mp.coins || 0;
    if (this._purse === undefined) { this._purse = coins; this._purseKick = 0; this._purseDelta = 0; }
    if (coins !== this._purse) {
      this._purseDelta = coins - this._purse;
      this._purseKick = 1;
      this._purse = coins;
    }
    if (this._purseKick > 0) this._purseKick = Math.max(0, this._purseKick - 0.02);
    const kick = this._purseKick;
    const gain = this._purseDelta > 0;

    /* --- the purse plate --- */
    const PH = 24;
    const px0 = ox - PW;
    plate(x, px0, oy - 2, PW, PH);
    // a coin-coloured rule top and bottom so it reads as its own thing
    x.fillStyle = gain && kick > 0.5 ? GOLD_LT : GOLD_DK;
    x.fillRect(px0, oy - 2, PW, 1);
    x.fillRect(px0, oy + PH - 3, PW, 1);

    drawText(x, 'SYNCOIN', { x: px0 + 4, y: oy + 1, scale: 1, color: '#c9b98a' });
    drawCoinPip(x, px0 + 4, oy + 11);
    // the figure, at double height, with a flash on the way up
    const numCol = kick > 0
      ? (gain ? (Math.floor(this._wobble * 14) % 2 ? GOLD_LT : GOLD) : RED)
      : (coins > 0 ? GOLD : '#6a5c40');
    /* The figure sits directly under SYNCOIN with no gap to spare, so the
       kick is a colour flash and the floating delta below — it used to
       lift the number two pixels and at three digits or more that put it
       through the label. */
    drawText(x, String(coins), {
      x: ox - 4, y: oy + 8, scale: 2, align: 'right', color: numCol,
    });
    /* What just happened to it, floating clear of the plate rather than
       printing on top of the figure — over it you got "9090/919". */
    if (kick > 0 && this._purseDelta) {
      const rise = Math.round((1 - kick) * 8);
      const label = (this._purseDelta > 0 ? '+' : '') + this._purseDelta;
      const lw = textWidth(label, 1);
      const lx = ox - 4 - lw;
      const ly = oy - 4 - rise;
      if (ly > 0) {
        x.fillStyle = 'rgba(8,6,3,.85)';
        x.fillRect(lx - 2, ly - 1, lw + 4, 9);
        drawText(x, label, {
          x: lx, y: ly, scale: 1, color: gain ? '#8fe8a0' : '#ff8a7a',
        });
      }
    }

    /* --- the island's work --- */
    let y = oy + PH + 1;
    const WH = 18;
    plate(x, px0, y, PW, WH);
    const total = mp.tasksTotal || 0;
    const frac = total ? Math.min(1, (mp.tasksDone || 0) / total) : 0;
    /* The label gives way to the figure rather than being written over
       it — a nine-thousand-job dev lobby used to render as "WOR0/9999". */
    const cnt = total ? `${mp.tasksDone || 0}/${total}` : '--';
    const cntW = textWidth(cnt, 1);
    if (cntW + textWidth('WORK', 1) + 10 <= PW) {
      drawText(x, 'WORK', { x: px0 + 4, y: y + 2, scale: 1, color: '#c9b98a' });
    }
    drawText(x, cnt, {
      x: ox - 4, y: y + 2, scale: 1, align: 'right',
      color: frac >= 1 ? JADE : '#c9b98a',
    });
    const bw = PW - 8, bx = px0 + 4;
    x.fillStyle = INK; x.fillRect(bx - 1, y + 11, bw + 2, 6);
    x.fillStyle = '#231708'; x.fillRect(bx, y + 12, bw, 4);
    for (let i = 0; i < Math.round(frac * bw); i += 3) {
      x.fillStyle = i % 6 ? '#c39a2c' : GOLD;
      x.fillRect(bx + i, y + 12, 2, 4);
    }

    /* --- your stamina, where you can actually see it ---
       The crew strip lived here and told you nothing you could not read
       from the tags over people's heads; stamina is the number you need
       while you are running away from somebody. */
    y += WH + 1;
    const SH = 18;
    plate(x, px0, y, PW, SH);
    const st = Math.max(0, Math.min(1, mp.stamina ?? 1));
    const spent = st < 0.999;
    drawText(x, 'STAMINA', { x: px0 + 4, y: y + 2, scale: 1, color: '#c9b98a' });
    drawText(x, `${Math.round(st * 100)}`, {
      x: ox - 4, y: y + 2, scale: 1, align: 'right',
      color: st < 0.25 ? RED : (spent ? '#c9b98a' : JADE),
    });
    const sw = PW - 8, sx = px0 + 4;
    x.fillStyle = INK; x.fillRect(sx - 1, y + 11, sw + 2, 6);
    x.fillStyle = '#0a1a14'; x.fillRect(sx, y + 12, sw, 4);
    const sn = Math.round(st * sw);
    for (let i = 0; i < sn; i += 3) {
      // green with wind, amber when it is going, red when it is gone
      x.fillStyle = st < 0.25 ? (i % 6 ? '#8a2018' : RED)
        : st < 0.6 ? (i % 6 ? '#a8761c' : GOLD)
          : (i % 6 ? '#3f8f6a' : JADE);
      x.fillRect(sx + i, y + 12, 2, 4);
    }
    // a flash on the bar the moment it bottoms out
    if (st <= 0.001 && Math.floor(this._wobble * 8) % 2 === 0) {
      x.fillStyle = 'rgba(224,69,58,.35)';
      x.fillRect(sx, y + 12, sw, 4);
    }
  }

  /**
   * The belt: everything you are carrying, on the number keys.
   *
   * Buying something used to fire it at the counter, so a flare pistol was
   * a thing you owned and could not use. Now the consumables sit here and
   * wait, and the row tells you which key spends which one.
   */
  _mpBelt(ox, oy, mp) {
    const x = this.x;
    const belt = mp.belt || [];
    const passives = mp.passives || [];
    if (!belt.length && !passives.length) return;
    const t = this._wobble;

    const SLOT = 18;
    /* Nine at most. The keys are 1 to 9, so a tenth slot is a thing you can
       see and cannot use — and its two-digit number does not fit in the cell
       beside the count, so it printed over it. Anything past nine is shown
       as a tally instead. */
    const MAX = 9;
    const shown = belt.slice(0, MAX);
    const spare = belt.length - shown.length;
    if (shown.length) {
      const w = Math.max(shown.length * SLOT + 4 + (spare > 0 ? 18 : 0),
        textWidth('BELT', 1) + 10);
      plate(x, ox, oy - 10, w, SLOT + 16);
      drawText(x, 'BELT', { x: ox + 3, y: oy - 8, scale: 1, color: '#8a7a52' });
      if (spare > 0) {
        drawText(x, `+${spare}`, {
          x: ox + w - 4, y: oy - 8, scale: 1, align: 'right', color: '#8a7a52',
        });
      }
      shown.forEach((sl, i) => {
        const sx = ox + 2 + i * SLOT;
        // the well
        x.fillStyle = sl.active ? '#3a2a10' : '#140e06';
        x.fillRect(sx, oy + 2, SLOT - 2, SLOT - 2);
        x.fillStyle = sl.active ? GOLD : '#4a3a1c';
        x.fillRect(sx, oy + 2, SLOT - 2, 1);
        x.fillRect(sx, oy + SLOT - 1, SLOT - 2, 1);
        x.fillRect(sx, oy + 2, 1, SLOT - 3);
        x.fillRect(sx + SLOT - 3, oy + 2, 1, SLOT - 3);
        drawShopIcon(x, sl.icon, sx + 2, oy + 4, 12, true, t);
        // the key that spends it, bottom-left of the well
        drawText(x, String(i + 1), {
          x: sx + 1, y: oy + SLOT - 8, scale: 1,
          color: sl.active ? GOLD_LT : '#9a8a62', shadow: true,
        });
        // how many you have, if more than one
        if (sl.count > 1) {
          drawText(x, `x${sl.count}`, {
            x: sx + SLOT - 4, y: oy + SLOT - 8, scale: 1, align: 'right', color: GOLD_LT,
          });
        }
        // a drawn weapon pulses so you know it is in your hands
        if (sl.active && Math.floor(t * 5) % 2 === 0) {
          x.fillStyle = 'rgba(255,210,74,.28)';
          x.fillRect(sx, oy + 2, SLOT - 2, SLOT - 2);
        }
      });
    }

    /* Passives are facts about you rather than keys you press. They used to
       be a bare row of nine-pixel icons floating on the world with no panel
       and no label — from a distance that reads as one small brown button
       nobody can identify. Labelled and plated now. */
    if (passives.length) {
      const py = oy + (shown.length ? SLOT + 10 : 0);
      const pw = Math.max(passives.length * 11 + 6, textWidth('ON YOU', 1) + 10);
      plate(x, ox, py - 10, pw, 21);
      drawText(x, 'ON YOU', { x: ox + 3, y: py - 8, scale: 1, color: '#8a7a52' });
      passives.forEach((icon, i) => {
        drawShopIcon(x, icon, ox + 3 + i * 11, py + 1, 9, false, t);
      });
    }
  }

  /** Centre-bottom: whatever is currently urgent. */
  _mpBanner(W, H, mp) {
    const x = this.x;

    // task hold — a single framed panel, not a bar with captions above and
    // an interaction prompt fighting it below
    if (mp.task) {
      const t2 = mp.task;
      const pw = Math.max(96, textWidth(t2.name || '', 1) + 14);
      const px = Math.round((W - pw) / 2), py = H - 56;
      plate(x, px, py, pw, 27);
      x.fillStyle = JADE;
      x.fillRect(px, py, pw, 1); x.fillRect(px, py + 26, pw, 1);
      drawText(x, t2.name || '', { x: W / 2, y: py + 3, scale: 1, align: 'center', color: GOLD_LT });

      const bw = pw - 12, bx = px + 6, by = py + 12;
      x.fillStyle = INK; x.fillRect(bx - 1, by - 1, bw + 2, 7);
      x.fillStyle = '#231708'; x.fillRect(bx, by, bw, 5);
      const n = Math.round(Math.max(0, Math.min(1, t2.k)) * bw);
      for (let i = 0; i < n; i += 3) {
        x.fillStyle = i % 6 ? '#3f8f6a' : JADE;
        x.fillRect(bx + i, by, 2, 5);
      }
      // a chaser so it never looks frozen when progress is slow
      const cx2 = bx + ((performance.now() / 9) % bw | 0);
      x.fillStyle = 'rgba(190,255,230,.35)'; x.fillRect(cx2, by, 1, 5);
      drawText(x, t2.holding ? `${t2.verb}  HOLD STILL` : 'HOLD E',
        { x: W / 2, y: py + 19, scale: 1, align: 'center',
          color: t2.holding ? '#9fd8c4' : (Math.floor(performance.now() / 200) % 2 ? GOLD : '#8a7a52') });
    }

    // sabotage countdown
    if (mp.sabotage) {
      const s = mp.sabotage;
      const flash = s.fatal && Math.floor(performance.now() / 220) % 2 === 0;
      const label = `${s.name}  ${Math.ceil(s.left)}`;
      const w = textWidth(label, 1) + 10;
      const bx = Math.round((W - w) / 2), by = H - 21;
      x.fillStyle = s.fatal ? 'rgba(60,8,6,.82)' : 'rgba(30,20,6,.8)';
      x.fillRect(bx, by, w, 11);
      x.fillStyle = s.fatal ? (flash ? '#e0453a' : '#8a2018') : '#a8761c';
      x.fillRect(bx, by, w, 1); x.fillRect(bx, by + 10, w, 1);
      drawText(x, label, {
        x: W / 2, y: by + 2, scale: 1, align: 'center',
        color: s.fatal ? (flash ? '#fff3c4' : '#ffb0a4') : GOLD_LT,
      });
    }

    if (!mp.alive) {
      drawText(x, 'YOU ARE A GHOST - WATCH, AND WAIT', {
        x: W / 2, y: mp.sabotage ? H - 32 : H - 21, scale: 1, align: 'center', color: '#8fb0c8',
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
    const W = 132, H = 17;
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

    /* Two named places on the same bearing used to print on top of each
       other — CAMP and COIN at the same angle came out as "CCOAIMNP". The
       place labels share one row, so they are drawn in order of how much you
       need them and anything that would land on top of one already there is
       dropped. The pip or diamond still draws; only the lettering goes. */
    const PRI = { FIX: 0, COIN: 1, BOX: 2, POST: 3, CATHY: 4, MACHINE: 5, FIRE: 6, CAMP: 7 };
    const taken = [];
    const roomFor = (px, w) => {
      for (const [a, b] of taken) if (px - w / 2 < b + 2 && px + w / 2 > a - 2) return false;
      taken.push([px - w / 2, px + w / 2]);
      return true;
    };
    const ordered = c.marks.slice().sort((p, q) => {
      const cardP = p.kind === 'card' || p.kind === 'inter';
      const cardQ = q.kind === 'card' || q.kind === 'inter';
      if (cardP !== cardQ) return cardP ? -1 : 1;      // cardinals have their own row
      return (PRI[p.label] ?? 9) - (PRI[q.label] ?? 9);
    });

    for (const m of ordered) {
      const dA = wrap(m.angle - c.yaw);
      if (Math.abs(dA) > HALF) continue;
      const px = toX(dA);
      const near = 1 - Math.abs(dA) / HALF;
      const col = m.kind === 'card' ? GOLD
        : m.kind === 'inter' ? '#8a7a52'
          : m.kind === 'goal' ? '#ffe07a'
            : m.kind === 'job' ? '#7ec850'
            : m.kind === 'fix' ? (Math.floor(performance.now() / 180) % 2 ? '#ff5a4a' : '#ffd0c0')
            : m.kind === 'coin' ? GOLD_LT
              : '#8fd8ff';
      if (near < 0.10) continue;
      /* Loose money, from something Cathy sold you. Unlabelled ones are the
         seventy-metre sweep and get a pip; the one labelled COIN is the
         needle on the nearest, and gets its name. */
      if (m.kind === 'coin' && !m.label) {
        x.fillStyle = col;
        x.fillRect(px - 1, oy + 12, 3, 3);
        x.fillStyle = '#8a6c2a';
        x.fillRect(px, oy + 13, 1, 1);
        continue;
      }
      if (m.kind === 'job' || m.kind === 'fix') {
        // a small diamond, below the lettering rather than through it
        x.fillStyle = col;
        x.fillRect(px, oy + 11, 1, 1);
        x.fillRect(px - 1, oy + 12, 3, 1);
        x.fillRect(px - 2, oy + 13, 5, 1);
        x.fillRect(px - 1, oy + 14, 3, 1);
        continue;
      }
      /* Cardinals on the top line, places on the bottom. They used to share
         a row and spell nonsense wherever a landmark lined up with a letter. */
      const card = m.kind === 'card' || m.kind === 'inter';
      if (!card && !roomFor(px, textWidth(m.label, 1))) continue;
      drawText(x, m.label, {
        x: px, y: oy + (card ? 1 : 9), scale: 1, align: 'center', color: col, shadow: false,
      });
      if (!card) { x.fillStyle = col; x.fillRect(px, oy + 7, 1, 2); }
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
  _prompt(cx, cy, text, key = 'E') {
    const x = this.x;
    const label = String(text).toUpperCase();
    const capW = keycapWidth(key);
    const w = textWidth(label, 1, 1) + capW + 20;
    const h = 17;
    // never off either edge, whatever it has been asked to centre on
    const left = Math.round(Math.max(3, Math.min(this.c.width - w - 3, cx - w / 2)));
    panel(x, left, cy, w, h, { border: 2, dither: 0.55 });
    keycap(x, left + 5, cy + 3, key);
    drawText(x, label, { x: left + 10 + capW, y: cy + 6, scale: 1, color: GOLD_LT });
  }

  /* ---------- toasts ---------- */
  _toasts(cx, oy) {
    const x = this.x;
    let y = oy;
    /* Two at a time, newest kept. An uncapped stack grows down the
       middle of the screen and there is no panel you can put anywhere
       below it that a tall enough stack will not eventually reach — the
       scanner sits under this and was getting walked on. */
    for (const t of this.data.toasts.slice(-2)) {
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
    const CW = 122, CH = 52;
    // slide in, hold, slide out
    const inT = Math.min(1, p.t / 0.28);
    const outT = p.t > p.dur - 0.5 ? (p.dur - p.t) / 0.5 : 1;
    const k = Math.min(inT, Math.max(0, outT));
    const ease = 1 - Math.pow(1 - k, 3);
    const left = Math.round(W - 9 - CW * ease);
    const top = Math.round(H / 2 - CH / 2);

    panel(x, left, top, CW, CH, { border: 2, dither: 0.45, hi: GOLD, lo: '#3a2610' });

    // icon plate
    const ix = left + 4, iy = top + 9;
    x.fillStyle = '#0d0906'; x.fillRect(ix, iy, 28, 28);
    x.fillStyle = '#2a1c0e'; x.fillRect(ix + 1, iy + 1, 26, 26);
    drawRelicIcon(x, p.icon, ix + 2, iy + 2, 24, Math.sin(p.t * 3) * 0.5);

    // sparkle corners
    if (p.t % 0.6 < 0.3) {
      x.fillStyle = GOLD_LT;
      x.fillRect(ix - 2, iy - 2, 2, 2);
      x.fillRect(ix + 28, iy + 28, 2, 2);
    }

    const tx = left + 36;
    // the header is whatever the caller says it is; it used to always claim
    // a relic had been found, including when you had just stoked a fire
    drawText(x, p.head || 'RELIC FOUND', { x: tx, y: top + 6, scale: 1, color: GOLD });
    x.fillStyle = '#5c3f1c'; x.fillRect(tx, top + 13, CW - 42, 1);
    const lines = wrapText(p.title, CW - 42, 1, 1).slice(0, 2);
    let ty = top + 17;
    for (const ln of lines) { drawText(x, ln, { x: tx, y: ty, scale: 1, color: GOLD_LT }); ty += 8; }
    if (p.sub) {
      ty += 2;
      // laid out in sequence; clamping each line to the bottom edge stacked
      // them all on the same row
      for (const ln of wrapText(p.sub, CW - 42, 1, 1).slice(0, 2)) {
        if (ty > top + CH - 9) break;
        drawText(x, ln, { x: tx, y: ty, scale: 1, color: '#9fd8c4' });
        ty += 8;
      }
    }
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

/* ===========================================================
   KEYCAPS

   The old one was an eight-pixel pale square with a dark line ruled along
   its bottom row — and the glyph, seven rows tall, put its last row on
   exactly that line. Dark ink on a dark line is nothing, so the bottom bar
   of the E disappeared and every prompt in the game read PRESS F.

   The cap is sized from the glyph now, and the shadow sits below it.
   =========================================================== */
export function keycapWidth(key = 'E') {
  return textWidth(String(key).toUpperCase(), 1, 1) + 6;
}

export function keycap(x, ox, oy, key = 'E') {
  const label = String(key).toUpperCase();
  const w = keycapWidth(label);
  const h = 11;
  // the shadow it sits on, clear of the glyph
  x.fillStyle = '#5a3d13';
  x.fillRect(ox, oy + 1, w, h);
  // the cap face
  x.fillStyle = '#f6e3a4';
  x.fillRect(ox, oy, w, h - 1);
  // a lit top edge and a shaded bottom edge, inside the face
  x.fillStyle = '#fff8d8'; x.fillRect(ox, oy, w, 1);
  x.fillStyle = '#d8bf80'; x.fillRect(ox, oy + h - 2, w, 1);
  // and the letter, with a clear row under it
  drawText(x, label, {
    x: ox + 3, y: oy + 2, scale: 1, color: '#241505', shadow: false,
  });
  return w;
}

/** Hand-drawn marks for the shop stock, animated where it helps. */
export function drawShopIcon(x, kind, ox, oy, size, lit, t) {
  const u = size / 12;
  const p = (gx, gy, w, h, col) => {
    x.fillStyle = col;
    x.fillRect(Math.round(ox + gx * u), Math.round(oy + gy * u), Math.ceil(w * u), Math.ceil(h * u));
  };
  const C = (a, b) => (lit ? a : b);
  const beat = lit ? Math.sin(t * 6) * 0.5 + 0.5 : 0;

  if (kind === 'lantern') {
    p(4, 0, 4, 1, C('#8a7a52', '#4a4230'));
    p(5, 1, 2, 1, C('#8a7a52', '#4a4230'));
    p(3, 2, 6, 8, C('#6a5a3a', '#3a332a'));
    p(4, 3, 4, 6, C('#1a1408', '#141008'));
    if (beat > 0.4 || !lit) {
      p(5, 4, 2, 4, C('#ffd88a', '#5a4a24'));
      p(4, 5, 4, 2, C('#ffb04a', '#4a3a1c'));
    }
    p(3, 10, 6, 1, C('#8a7a52', '#4a4230'));
  } else if (kind === 'vest') {
    p(3, 1, 6, 9, C('#b8894a', '#4a3c26'));
    p(2, 2, 2, 6, C('#a07a40', '#40341f'));
    p(8, 2, 2, 6, C('#a07a40', '#40341f'));
    p(5, 1, 2, 9, C('#2a1c0c', '#1c1409'));
    for (let i = 0; i < 3; i++) p(4, 3 + i * 2, 1, 1, C('#ffe0a0', '#6a5a34'));
    for (let i = 0; i < 3; i++) p(7, 3 + i * 2, 1, 1, C('#ffe0a0', '#6a5a34'));
  } else if (kind === 'whistle') {
    p(2, 4, 7, 4, C('#c8c8d0', '#4a4a52'));
    p(9, 5, 2, 2, C('#a0a0a8', '#3a3a42'));
    p(3, 5, 2, 2, C('#2a2a30', '#1c1c22'));
    if (beat > 0.5) {
      p(11, 3, 1, 1, C('#ffffff', '#555'));
      p(11, 6, 1, 1, C('#ffffff', '#555'));
      p(12, 4, 1, 2, C('#dfefff', '#555'));
    }
  } else if (kind === 'tonic') {
    p(5, 0, 2, 2, C('#8a7a52', '#40382a'));
    p(4, 2, 4, 2, C('#6a5a3a', '#332c22'));
    p(3, 4, 6, 7, C('#3a6a4a', '#22332a'));
    const lvl = 4 + Math.round(beat * 1);
    p(4, lvl + 1, 4, 9 - lvl, C('#7ec850', '#3a5a2c'));
    p(4, lvl, 4, 1, C('#bfffa0', '#4a6a3a'));
  /* ---- Cathy's counter ----
     Five things she cooks, each recognisable at twelve pixels. */
  } else if (kind === 'popcorn') {
    // a striped box with it coming over the top
    p(3, 4, 6, 7, C('#c83a30', '#5a2420'));
    p(4, 4, 1, 7, C('#f0e4c0', '#6a6250'));
    p(6, 4, 1, 7, C('#f0e4c0', '#6a6250'));
    p(3, 2, 2, 2, C('#f8f0d0', '#6a6250'));
    p(6, 1, 2, 2, C('#fff8e0', '#787058'));
    p(8, 3, 2, 2, C('#f8f0d0', '#6a6250'));
    if (beat > 0.5) p(5, 0, 2, 2, C('#fffce8', '#807850'));
  } else if (kind === 'eggs') {
    // three of them in a twist of paper
    p(2, 6, 8, 5, C('#8a7a52', '#40382a'));
    p(3, 3, 3, 4, C('#f0ecd8', '#706c58'));
    p(6, 2, 3, 4, C('#f8f4e0', '#787460'));
    p(4, 5, 3, 4, C('#e8e4d0', '#686450'));
    p(4, 4, 1, 1, C('#c8b890', '#585440'));
  } else if (kind === 'sauce') {
    // a squeeze bottle with a drip coming out of it
    p(5, 0, 2, 2, C('#d8d0b0', '#585040'));
    p(4, 2, 4, 2, C('#8a8270', '#3a382c'));
    p(3, 4, 6, 7, C('#a82820', '#4a1810'));
    p(4, 6, 4, 4, C('#d84438', '#5a201a'));
    p(4, 5, 4, 1, C('#f07060', '#6a2820'));
    if (beat > 0.6) p(6, 11, 1, 1, C('#f07060', '#6a2820'));
  } else if (kind === 'burger') {
    p(2, 3, 8, 3, C('#d8a050', '#5a4424'));      // the top of the bun
    p(3, 2, 6, 1, C('#f0c078', '#68502c'));
    p(2, 6, 8, 1, C('#7ec850', '#3a5a2c'));      // lettuce
    p(2, 7, 8, 2, C('#8a5a30', '#3c2818'));      // the patty
    p(2, 9, 8, 2, C('#c08040', '#54381c'));      // and the bottom
    if (beat > 0.5) p(4, 1, 1, 1, C('#fff0c0', '#6a5a3a'));
  } else if (kind === 'floss') {
    // a cloud of it on a stick
    p(5, 7, 2, 5, C('#c8b890', '#5a5240'));
    p(3, 2, 6, 5, C('#e07aa8', '#603448'));
    p(2, 3, 8, 3, C('#f090c0', '#6a3a52'));
    p(4, 1, 4, 2, C('#f8a8d0', '#74405a'));
    if (beat > 0.5) { p(2, 1, 1, 1, C('#ffc8e0', '#7a4a60')); p(9, 4, 1, 1, C('#ffc8e0', '#7a4a60')); }
  } else if (kind === 'cctv') {
    // a camera on a bracket, with its red pinhole
    p(1, 5, 8, 5, C('#3a4038', '#22261f'));
    p(1, 4, 8, 1, C('#5a6154', '#2e3229'));
    p(9, 6, 2, 3, C('#22261f', '#161a15'));
    p(11, 6, 1, 3, C('#0e1214', '#0a0c0e'));
    p(4, 1, 1, 4, C('#5a6154', '#2e3229'));
    p(2, 0, 6, 1, C('#5a6154', '#2e3229'));
    if (lit && beat > 0.55) { p(2, 6, 1, 1, '#ff3a28'); }
    else p(2, 6, 1, 1, C('#5a2018', '#2a1410'));
  } else if (kind === 'scanner') {
    // a handheld set: a round green screen, an aerial and a carrying strap
    p(1, 2, 10, 9, C('#2a2e28', '#1a1c18'));
    p(1, 2, 10, 1, C('#3c423a', '#22261f'));
    p(2, 3, 8, 7, C('#07200f', '#050c07'));
    p(3, 4, 6, 5, C('#0d3418', '#07160c'));
    // the sweep, which only moves when it is lit
    if (lit) {
      const a = beat * 6.283;
      const sx = Math.round(6 + Math.cos(a) * 3), sy = Math.round(6.5 + Math.sin(a) * 2.5);
      p(6, 6, 1, 1, '#7affaa');
      p(sx, sy, 1, 1, '#7affaa');
    } else {
      p(6, 6, 1, 1, '#2a5a3a');
    }
    // the aerial
    p(9, 0, 1, 3, C('#8a9184', '#40443c'));
    p(8, 0, 3, 1, C('#c0c8b8', '#50564c'));
    if (lit && beat > 0.6) p(8, -1, 3, 1, C('#7affaa', '#2a5a3a'));

  /* ---- the saloon: one drawing per drink, not one glass shared out ---- */
  } else if (kind === 'bitter') {
    // PINT OF SHIPWRECK: a straight glass of brown bitter with a thick head
    p(2, 3, 8, 8, C('#a8681c', '#4a3010'));
    p(2, 1, 8, 3, C('#f6efe0', '#6a6458'));
    p(2, 1, 8, 1, C('#fffaf0', '#78725f'));
    p(1, 1, 1, 11, C('#cfe0e8', '#585c60'));
    p(10, 1, 1, 11, C('#cfe0e8', '#585c60'));
    p(1, 11, 10, 1, C('#a8bcc4', '#484c50'));
    p(11, 4, 1, 4, C('#a8bcc4', '#484c50'));
    if (beat > 0.5) { p(4, 6, 1, 1, C('#d8902c', '#5a4018')); p(7, 8, 1, 1, C('#d8902c', '#5a4018')); }
  } else if (kind === 'lamp') {
    // THE LAMPLIGHTER: a lantern-yellow spirit, and it gives off light
    if (lit) { p(1, 2, 10, 9, 'rgba(255,220,120,.10)'); }
    p(3, 2, 6, 2, C('#8a8270', '#3a382c'));
    p(3, 4, 6, 7, C('#e8c860', '#5a5028'));
    p(3, 4, 6, 1, C('#fff0a8', '#6a6030'));
    p(2, 3, 1, 8, C('#cfe0e8', '#585c60'));
    p(9, 3, 1, 8, C('#cfe0e8', '#585c60'));
    p(3, 11, 6, 1, C('#a8bcc4', '#484c50'));
    if (beat > 0.4) p(5, 0, 2, 2, C('#fff8d0', '#6a6440'));
  } else if (kind === 'clear') {
    // QUIET WATER: clear, and it is not water
    p(3, 3, 6, 8, C('#a8d0d8', '#485458'));
    p(3, 6, 6, 5, C('#cfeef4', '#586468'));
    p(3, 6, 6, 1, C('#eafaff', '#68787c'));
    p(3, 11, 6, 1, C('#88a8b0', '#3a4448'));
    p(4, 2, 4, 1, C('#c8e4ea', '#556164'));
    // it makes no sound, so nothing about it moves
  } else if (kind === 'rum') {
    // BLACK RUM: a squat glass of something nearly black, over ice
    p(2, 4, 8, 7, C('#3a1a0c', '#1c0e06'));
    p(2, 4, 8, 1, C('#6a3418', '#301a0c'));
    p(3, 5, 3, 3, C('#7a5a48', '#3a2c22'));
    p(6, 7, 3, 3, C('#6a4a38', '#32261c'));
    p(1, 3, 1, 9, C('#cfe0e8', '#585c60'));
    p(10, 3, 1, 9, C('#cfe0e8', '#585c60'));
    p(1, 11, 10, 1, C('#a8bcc4', '#484c50'));
    if (beat > 0.6) p(4, 5, 1, 1, C('#c8a884', '#4a4038'));
  } else if (kind === 'own') {
    // QUEBOLIUS' OWN: purple, in a stemmed glass, and it does not sit still
    const sw = lit ? Math.round(Math.sin(beat * 6.283) * 1) : 0;
    p(3, 1, 6, 5, C('#7a1a5a', '#341028'));
    p(3, 1, 6, 1, C('#b8409a', '#4a1c3c'));
    p(3 + sw, 2, 6, 1, C('#a83088', '#421834'));
    p(2, 0, 8, 1, C('#cfe0e8', '#585c60'));
    p(5, 6, 2, 4, C('#cfe0e8', '#585c60'));
    p(3, 10, 6, 2, C('#a8bcc4', '#484c50'));
    if (beat > 0.5) p(4, 3, 1, 1, C('#f070d0', '#5a2848'));
  } else if (kind === 'falling') {
    // THE FALLING DOWN: a tumbler of something the colour of a bruise
    p(2, 3, 8, 8, C('#2a1830', '#140c18'));
    p(2, 3, 8, 1, C('#5a2a6a', '#2a1432'));
    p(3, 5, 2, 2, C('#8a3a9a', '#40204a'));
    p(6, 8, 2, 2, C('#6a2a7a', '#32183a'));
    p(1, 2, 1, 10, C('#cfe0e8', '#585c60'));
    p(10, 2, 1, 10, C('#cfe0e8', '#585c60'));
    p(1, 11, 10, 1, C('#a8bcc4', '#484c50'));
    // it is already moving before you have touched it
    if (lit) {
      const w = Math.round(Math.sin(beat * 6.283) * 2);
      p(3 + w, 4, 6, 1, C('#9a4aaa', '#48244f'));
    }
  } else if (kind === 'pint') {
    // a straight glass with a handle, a head on it, and a bead of condensation
    p(2, 2, 7, 9, C('#d8901c', '#5a4014'));
    p(2, 1, 7, 2, C('#f6efe0', '#6a6458'));
    p(1, 1, 9, 10, C('rgba(0,0,0,0)', 'rgba(0,0,0,0)'));
    p(1, 1, 1, 10, C('#cfe0e8', '#585c60'));
    p(9, 1, 1, 10, C('#cfe0e8', '#585c60'));
    p(1, 11, 9, 1, C('#a8bcc4', '#484c50'));
    p(10, 3, 2, 1, C('#a8bcc4', '#484c50'));
    p(11, 4, 1, 4, C('#a8bcc4', '#484c50'));
    p(10, 8, 2, 1, C('#a8bcc4', '#484c50'));
    if (beat > 0.5) p(3, 4, 1, 1, C('#ffe0a0', '#6a5a34'));
  } else if (kind === 'shot') {
    // a small heavy glass, a third full of something serious
    p(3, 3, 7, 8, C('#cfe0e8', '#585c60'));
    p(4, 6, 5, 5, C('#8a3418', '#3a1a0c'));
    p(4, 6, 5, 1, C('#c05a28', '#4a2412'));
    p(3, 11, 7, 1, C('#a8bcc4', '#484c50'));
    p(3, 3, 1, 8, C('#e8f4fa', '#686c70'));
    if (beat > 0.6) p(6, 2, 2, 1, C('#ffd8a0', '#5a4a30'));
  } else if (kind === 'soles') {
    p(3, 1, 4, 6, C('#3a3a42', '#24242a'));
    p(3, 7, 4, 3, C('#2a2a30', '#1c1c22'));
    p(7, 3, 3, 5, C('#4a4a52', '#2a2a32'));
    if (beat > 0.5) { p(9, 1, 1, 1, C('#6a6a72', '#333')); p(10, 3, 1, 1, C('#6a6a72', '#333')); }
  } else if (kind === 'alibi') {
    p(2, 2, 8, 8, C('#d8c69a', '#4a4436'));
    p(3, 3, 6, 1, C('#7a6a48', '#332e24'));
    p(3, 5, 6, 1, C('#7a6a48', '#332e24'));
    p(3, 7, 4, 1, C('#7a6a48', '#332e24'));
    const w = Math.round(beat * 2);
    p(7 + w, 8, 3, 3, C('#c02a1a', '#4a1a12'));
  } else if (kind === 'knife') {
    p(5, 0, 2, 6, C('#e8eef2', '#4a5258'));
    p(4, 1, 1, 5, C('#b8c2c8', '#3a4248'));
    p(3, 6, 6, 1, C('#8a2018', '#3a1810'));
    p(5, 7, 2, 4, C('#6a4a28', '#332618'));
    if (beat > 0.6) { p(8, 1, 1, 1, '#ffffff'); p(9, 3, 1, 1, '#ffffff'); }
  } else if (kind === 'gun') {
    // a stubby flare pistol, muzzle up-right
    p(2, 5, 6, 3, C('#8a4a2a', '#3a2418'));
    p(8, 4, 3, 3, C('#b0b6bc', '#42474c'));
    p(11, 4, 1, 3, C('#e8eef2', '#4a5258'));
    p(3, 8, 3, 4, C('#6a3a20', '#2e1c12'));
    p(6, 7, 2, 2, C('#c8c8d0', '#4a4a52'));
    if (beat > 0.55) {
      p(12, 3, 1, 1, '#ffd24a'); p(12, 6, 1, 1, '#ffd24a');
      p(13, 4, 1, 2, '#fff3c4');
    }
  } else if (kind === 'speaker') {
    /* A big portable speaker, upright, with a carry handle, a woofer and a
       tweeter, and a row of level lights along the bottom. The old one was
       two grey circles in a box and read as a plug socket. */
    // the case, with a rounded top edge
    p(1, 1, 10, 10, C('#2a2a32', '#1a1a20'));
    p(2, 0, 8, 1, C('#2a2a32', '#1a1a20'));
    p(1, 1, 10, 1, C('#4a4a56', '#26262e'));
    // the carry handle
    p(4, 0, 4, 1, C('#5a5a66', '#2e2e36'));
    // the grille, a mesh of dots
    for (let gy = 2; gy < 8; gy += 2) {
      for (let gx = 2; gx < 10; gx += 2) p(gx, gy, 1, 1, C('#4a4a56', '#26262e'));
    }
    // the woofer: a big cone that swells with the beat
    {
      const r = 5 + (lit ? Math.round(beat * 1.4) : 0);
      p(6 - r / 2, 5 - r / 2, r, r, C('#3a3a46', '#22222a'));
      p(4, 3, 4, 4, C('#8a8a96', '#3a3a44'));
      p(5, 4, 2, 2, C('#14141a', '#101014'));
    }
    // a tweeter in the top corner
    p(8, 2, 2, 2, C('#8a8a96', '#3a3a44'));
    // the level lights along the bottom
    for (let i = 0; i < 4; i++) {
      const on = lit && beat > i * 0.25;
      p(2 + i * 2, 9, 1, 1, on ? (i > 2 ? '#e0453a' : '#7ec850') : '#242430');
    }
    // and the sound coming off it
    if (lit && beat > 0.55) {
      p(0, 3, 1, 1, '#ffd24a'); p(11, 5, 1, 1, '#ffd24a');
      p(0, 7, 1, 1, '#9ff0dc'); p(11, 2, 1, 1, '#9ff0dc');
    }
  } else if (kind === 'chart') {
    p(1, 2, 10, 8, C('#d8c69a', '#4a4436'));
    p(2, 3, 8, 6, C('#b09062', '#3e3a2c'));
    p(4, 5, 3, 2, C('#8b9c62', '#333c26'));
    const bl = lit && beat > 0.5;
    p(8, 3, 1, 1, bl ? '#c02a1a' : '#6a3a30');
    p(7, 4, 3, 1, bl ? '#c02a1a' : '#6a3a30');
  } else if (kind === 'flask') {
    p(5, 0, 2, 2, C('#8a7a52', '#40382a'));
    p(4, 2, 4, 2, C('#6a5a3a', '#332c22'));
    p(3, 4, 6, 7, C('#5a3a6a', '#2c2032'));
    p(4, 6, 4, 4, C('#a05ac0', '#4a2a5a'));
    if (lit && beat > 0.5) p(5, 5, 2, 1, '#e0b0ff');
  } else if (kind === 'key') {
    p(2, 4, 3, 3, C('#c39a2c', '#4a3c18'));
    p(3, 5, 1, 1, C('#1a1408', '#0e0c06'));
    p(5, 5, 6, 1, C('#c39a2c', '#4a3c18'));
    p(9, 6, 1, 2, C('#c39a2c', '#4a3c18'));
    p(7, 6, 1, 2, C('#c39a2c', '#4a3c18'));
  } else if (kind === 'chaff') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283 + (lit ? t * 2 : 0);
      p(5 + Math.round(Math.cos(a) * 4), 5 + Math.round(Math.sin(a) * 4), 1, 1,
        C(i % 2 ? '#9fd8e8' : '#6a8a9a', '#33424a'));
    }
    p(5, 5, 2, 2, C('#d8e8f0', '#4a5a64'));
  } else if (kind === 'coin') {
    p(3, 2, 6, 8, C('#ffd24a', '#6a5a24'));
    p(4, 3, 4, 6, C('#c39a2c', '#4a3c18'));
    p(5, 4, 2, 4, C('#fff3c4', '#7a6a34'));
  }
}

/** A Syncoin, eight pixels across. */
function drawCoinPip(x, ox, oy) {
  const p = (gx, gy, w, h, c) => { x.fillStyle = c; x.fillRect(ox + gx, oy + gy, w, h); };
  p(2, 0, 4, 1, '#c39a2c'); p(1, 1, 6, 5, '#ffd24a');
  p(2, 6, 4, 1, '#c39a2c'); p(3, 2, 2, 3, '#fff3c4');
  p(0, 2, 1, 3, '#8a6a1c'); p(7, 2, 1, 3, '#8a6a1c');
}

/** A little knife, so the agent panel is not three words in a box. */
function drawKnife(x, ox, oy, ready) {
  const p = (gx, gy, w, h, c) => { x.fillStyle = c; x.fillRect(ox + gx, oy + gy, w, h); };
  const blade = ready ? '#e8eef2' : '#6a7278';
  p(4, 0, 2, 5, blade);
  p(3, 1, 1, 4, blade);
  p(5, 1, 1, 4, ready ? '#b8c2c8' : '#4a5258');
  p(3, 5, 4, 1, ready ? '#8a2018' : '#3a2018');
  p(4, 6, 2, 4, ready ? '#6a4a28' : '#3a2a18');
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

  } else if (kind === 'task') {
    // a ticked box, which is what the popup is celebrating
    px(2, 3, 12, 1, '#2a1c0c'); px(2, 12, 12, 1, '#2a1c0c');
    px(2, 3, 1, 10, '#2a1c0c'); px(13, 3, 1, 10, '#2a1c0c');
    px(3, 4, 10, 8, '#1a2a12');
    px(5, 8, 2, 2, '#7ec850');
    px(7, 10, 2, 2, '#9fe870');
    px(9, 7, 2, 3, '#9fe870');
    px(11, 5, 2, 2, '#cfffa4');
  } else if (kind === 'vest') {
    px(3, 2, 10, 12, '#b8894a');
    px(2, 3, 3, 8, '#a07a40');
    px(11, 3, 3, 8, '#a07a40');
    px(7, 2, 2, 12, '#2a1c0c');
    px(5, 5, 2, 2, '#ffe0a0'); px(5, 9, 2, 2, '#ffe0a0');
    px(9, 5, 2, 2, '#ffe0a0'); px(9, 9, 2, 2, '#ffe0a0');
  } else if (kind === 'coin') {
    px(5, 4, 6, 8, '#d8c070');
    px(6, 5, 4, 6, '#f0dc9a');
    px(7, 6, 2, 4, '#8a6c2a');
  }
}
