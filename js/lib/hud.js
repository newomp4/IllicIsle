/* ===========================================================
   hud.js — the in-game HUD, drawn as pixels.

   This canvas is sized to the renderer's INTERNAL resolution
   (320x224 by default) and composited inside the PS1 pass, so
   the interface gets the same nearest-neighbour upscale, the
   same 15-bit dither, the same scanlines and the same barrel
   curve as the world. It also inherits a tiny per-frame wobble,
   because a PSX framebuffer was never perfectly still.
   =========================================================== */

import { drawText, textWidth, wrapText, panel, ditherRect, normalize } from './bitfont.js';

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

/* Compass geometry and ordering, out here because the strip is redrawn
   every frame and none of it depends on the frame. */
const COMPASS_HALF = 1.9;                 // radians visible either side
const compassWrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
/* Screen-right is (-cos yaw, sin yaw), so a bearing counter-clockwise of your
   heading — a POSITIVE dA — is to your LEFT. Adding it put every mark, tick
   and place name on the side of the strip opposite the thing itself. */
const compassX = (dA, left, W) => Math.round(left + W / 2 - (dA / COMPASS_HALF) * (W / 2));
/** Which name wins the lettering row when two land on the same bearing. */
const PRI = { FIX: 0, COIN: 1, BOX: 2, POST: 3, CATHY: 4, MACHINE: 5, FIRE: 6, CAMP: 7 };
const byNeed = (p, q) => {
  const cardP = p.kind === 'card' || p.kind === 'inter';
  const cardQ = q.kind === 'card' || q.kind === 'inter';
  if (cardP !== cardQ) return cardP ? -1 : 1;      // cardinals have their own row
  return (PRI[p.label] ?? 9) - (PRI[q.label] ?? 9);
};

export class Hud {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = 320; this.c.height = 224;
    this.x = this.c.getContext('2d');
    this.x.imageSmoothingEnabled = false;

    /* The compass strip is a fixed 132x17 ordered dither whose pixels never
       change, yet painting it a pixel at a time cost 2,244 fills of every
       frame. Bake it once here; only the left edge it lands on moves. */
    this._compassBg = document.createElement('canvas');
    this._compassBg.width = 132; this._compassBg.height = 17;
    ditherRect(this._compassBg.getContext('2d'), 0, 0, 132, 17, '#140d06', '#241708', 0.5, 1);

    this.data = {
      visible: false,
      hp: 5, maxHp: 5, stamina: 1,
      ammo: 0,
      pendulums: 0, relics: 0, coins: 0,
      objective: '', prompt: null, timer: 0,
      boss: null,           // { frac, chip, name, phase }
      toasts: [],
      compass: null,        // { yaw, marks:[{label,angle,kind}] }
      popup: null,          // { title, sub, icon, t }
      cinema: false, cinemaText: '', cinemaFade: 0, cinemaSkip: false,
      hurtT: 0,
    };
    this._wobble = 0;
    /* Flat x0/x1 pairs of whatever the compass has already lettered this
       frame. Reused, because it is refilled sixty times a second. */
    this._compassTaken = [];
  }

  /* Returns true when the canvas actually changed size, because the caller
     has to act on that: assigning to canvas.width reallocates the backing
     store, and the CanvasTexture wrapping it keeps its old GL allocation
     until somebody builds a new one. Without that the composite pass goes
     on sampling the interface at the size it had before, which reads as the
     previous screen burned in behind the new one at the wrong scale. */
  setSize(w, h) {
    if (this.c.width === w && this.c.height === h) return false;
    this.c.width = w; this.c.height = h;
    this.x.imageSmoothingEnabled = false;
    return true;
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
    /* The purse flinch decays on the clock rather than per draw, so it
       lasts the same fraction of a second whatever the frame rate. */
    if (this._purseKick > 0) this._purseKick = Math.max(0, this._purseKick - dt * 1.2);
    this._wobble += dt;
  }

  /* ===========================================================
     DRAW
     =========================================================== */
  render(time) {
    /* Whether the caller made the overlay pass itself for the frame before;
       see the handoff at the end of this method. */
    const late = this._overlayLate; this._overlayLate = false;
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
      const pwLeft = this._mpLeft(3, 3 + wob, d.mp);
      this._mpRight(W - 3, 3 + wob, d.mp);
      /* The strip is centred on the frame and used to be a flat 132 wide,
         so at 240 across it painted over the chore list on one side and the
         purse on the other — a chore row you can read eight characters of
         is not a chore list. It gets whatever the two columns actually
         leave, measured symmetrically about the centre so the needle stays
         on the middle of the rose, and goes altogether if that is nothing. */
      const room = 2 * Math.min(W / 2 - (pwLeft + 4), W / 2 - 81);
      if (room >= 40) this._compass(W / 2, 2, d.compass, room);
      this._mpBanner(W, H, d.mp, pwLeft);
      /* Clear of the toast stack above it (two at 13 apiece from 58, so
         84 at the worst). Below it is the belt: an instrument is 78 tall
         from y 85 and the belt's plate starts at H - 62, so on a 180-tall
         frame the two want the same pixels and the belt was losing it,
         buried under the case along with the keys that spend it. Nothing
         above them can move, so where the frame cannot hold both, the belt
         stands down to a line naming its keys — the instrument you have
         just switched on is the thing you are reading. */
      const inst = !!(d.mp.scanner?.on || d.mp.printer?.on);
      const beltRow = !inst || H - 62 >= 162;
      if (beltRow) this._mpBelt(4, H - 52, d.mp);
      else if (d.mp.belt?.length) {
        drawText(x, '1-9  BELT', { x: 4, y: 164, scale: 1, color: '#8a7a52' });
      }
      /* The knife panel hangs off the bottom right corner and the till
         roll's case ends at 163, so on a 180-tall frame the panel was drawn
         last and over the top of the docket — the price, how long ago it
         was and the key that reads it back all went under it. The panel
         takes whichever bottom corner the belt has already vacated, and
         where neither is free the roll stands down to a line naming its
         key, the way the belt does above. */
      const agent = d.mp.role === 'agent';
      const aPH = 30 + Math.min(3, (d.mp.cools || []).length) * 7;
      const clash = agent && !!d.mp.printer?.on && H - 16 - aPH < 163;
      const agentLeft = clash && !d.mp.scanner?.on && !beltRow;
      if (d.mp.scanner?.on) this._scanner(4, 86, d.mp.scanner);
      /* The till roll, mirroring the scanner on the other side. Both are
         belt instruments and both are read the same way. */
      if (d.mp.printer?.on) {
        if (clash && !agentLeft) {
          drawText(x, 'N  TILL ROLL', {
            x: W - 4, y: H - 16, scale: 1, align: 'right', color: '#8a7a52',
          });
        } else this._printer(W - 102, 86, d.mp.printer);
      }
      if (agent) this._mpAgent(agentLeft ? 116 : W - 5, H - 16, d.mp);
      /* An Agent has a knife panel in the bottom right corner, and a long
         prompt centred on the screen runs straight into it — "QUEZETRIEL
         QUEBOLIUS" printed the S of SABOTAGE off. Centre the prompt in
         whatever room is actually left.

         And an instrument owns rows 85 to 163, which is where a 17-tall
         panel at H - 34 lands on a 180-tall frame: it covered the range,
         the caption and the key under it. There is nothing 17 tall between
         the toasts and the case, so the prompt stands down to its own key
         and its own line, under everything, the way the belt does. */
      const flat = inst && H - 34 < 163;
      if (d.prompt) {
        this._prompt(flat || !agent ? W / 2 : (W - 118) / 2,
          flat ? H - 9 : H - 34, d.prompt, 'E', flat);
      }
      /* Where the toast stack can sit is decided by what the columns and
         the instrument band actually took this frame, and only this pass
         knows that, so it leaves the measurements for the overlay. */
      this._overlayFit = {
        colBot: Math.max(this._mpLeftBottom || 0, this._mpRightBottom || 0),
        room, tBot: inst ? 85 : H - 62,
      };
      return late ? this.c : this._drawOverlay(time);
    }

    this._hearts(4, 4 + wob);
    this._stamina(4, 4 + HEART.length * 2 + 5 + wob);
    this._right(W - 4, 4 + wob);
    /* The same fixed strip, and the same trouble: 132 centred on a 320-wide
       frame lands on the heart row, and a sixth heart bought from Ferdi
       vanished under it entirely. Measure the room the heart row leaves on
       one side and the counters on the other — of those only PEND n/4 and
       the ammo figure reach these rows, both inside 52 pixels of the edge. */
    const l = 4 + d.maxHp * 21 + 2, r = W - 52;
    const room = 2 * Math.min(W / 2 - l, r - W / 2);
    if (room >= 40) this._compass(W / 2, 3, d.compass, room);
    /* Centred, the strip only ever gets twice the shorter side, and at 240
       across with five hearts that is eighteen pixels — the narrowest frame
       had no compass at all, and buying a sixth heart took it away at 288.
       Off-centre it still reads: the needle is the middle of the rose, not
       the middle of the screen. */
    else if (r - l >= 40) this._compass((l + r) / 2, 3, d.compass, r - l);
    if (d.boss) this._boss(W / 2, 26, d.boss);
    const objH = this._objective(4, H - 4);
    this._timer(W - 4, H - 4);
    /* The prompt panel is opaque and centred, and it owns rows H-44 to
       H-28 — exactly where a three-line OBJECTIVE sits. It comes up clear
       of whatever the objective actually took, and never goes lower than it
       already was, so it still stays off the timer. */
    if (d.prompt) this._prompt(W / 2, Math.min(H - 44, H - 4 - objH - 20), d.prompt);
    return late ? this.c : this._drawOverlay(time);
  }

  /* Toasts and the popup composite over whatever is already on the canvas,
     so they are a pass of their own. Screens draw onto this same canvas
     after the HUD and most of them open with an opaque full-frame fill, so
     anything raised while one is up — the toast for a camera bought from
     Ferdi with a full relay — was painted out before the player saw it.
     The pass therefore belongs to the caller, run after the screens have
     drawn. A caller that only makes it while a screen is open would leave
     the toasts undrawn on every other frame, so render() still makes the
     pass itself on any frame the caller made none for the frame before —
     never both, so the stack is never composited twice and the panel behind
     it keeps the alpha it was drawn with. No clearRect: it is drawn on top,
     not instead. */
  renderOverlay(time) {
    this._overlayLate = true;
    return this._drawOverlay(time);
  }

  _drawOverlay(time) {
    if (!this.data.visible) return this.c;
    const d = this.data;
    const W = this.c.width, H = this.c.height;
    if (d.mp) {
      /* The stack is centred and was measured against nothing, so a long
         toast lay across the purse and the stamina bar on one side and the
         chore list on the other. It gets the band between the columns —
         but at 240 across that band is thirteen characters, which is not a
         sentence, so where it is narrower than the compass' own strip the
         stack drops below both columns instead, where the full width is
         free. Either way it stops before the belt or an instrument.

         The fit comes from render(), which measured the columns and the
         instruments this frame; the fallbacks only stand in for a first
         call that somehow beats it, and read as a frame with neither. */
      const fit = this._overlayFit || {};
      const room = fit.room || 0, tBot = fit.tBot ?? H - 62;
      const band = room >= 132;
      const tb = this._toasts(W / 2,
        band ? Math.min(Math.round(H * 0.26), tBot - 26)
          : Math.max(Math.round(H * 0.26), (fit.colBot || 0) + 3),
        band ? room : W - 24, tBot);
      if (d.popup) this._popup(W, H, d.popup, tb);
      return this.c;
    }
    const tb = this._toasts(W / 2, Math.round(H * 0.30));
    if (d.popup) this._popup(W, H, d.popup, tb);
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
    /* The list is a reminder, not a document — and it is also what the
       compass has to fit beside, so the cap comes down with the framebuffer
       instead of always being 136 and being painted over for its trouble. */
    const CAP = Math.max(56, Math.min(136, (this.c.width >> 1) - 78));
    /* Measured without building an array of strings first. This runs every
       frame; anything it allocates has to be collected later, and a
       collection mid-round is a visible stutter. */
    let widest = textWidth(agent ? 'ROGUE AGENT' : 'CASTAWAY', 1);
    for (const t of tasks) {
      const w = textWidth(t.name, 1) + (t.steps > 1 ? 24 : 0);
      if (w > widest) widest = w;
    }
    const pw = Math.min(CAP, Math.max(64, widest + 15));
    /* The key hint under the list is drawn whichever side you are on, so
       the plate has to be tall enough for it either way — a Castaway's
       TAB MAP was printed on the sand a row below its own backing. */
    const ph = 12 + tasks.length * 8 + 8;
    plate(x, ox - 2, oy - 2, pw, ph);
    /* What the banner and the toasts have to clear. */
    this._mpLeftBottom = oy - 2 + ph;

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
    /* Every chore row above is cut to the plate; this line was not, and at
       240 across it ran sixty-five pixels past the edge of its own backing
       and onto the world. It says as much of itself as the plate can hold. */
    const foot = agent
      ? (['THESE COUNT FOR THEM', 'COUNTS FOR THEM', 'THEY COUNT', 'COUNTS']
        .find((t) => textWidth(t, 1) <= pw - 4) || 'COUNTS')
      : 'TAB  MAP';
    drawText(x, foot, { x: ox, y: y + 1, scale: 1, color: agent ? '#c08a5c' : '#7a6a4a' });
    return pw;                 // render() sizes the compass against this
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
      /* Dark green on the case's dark grey came out at 1.7:1 on five-by-seven
         glyphs — and these are the lines you read when nothing is happening,
         so they are the ones read most. Both lifted, the headline further
         than the line under it so the order still reads. The caption is
         shorter too: twenty characters is 119 pixels on a 98-wide case, and
         it hung off both sides onto the world. */
      drawText(x, 'BAND CLEAR', {
        x: ox + W / 2, y: NY + 10, scale: 1, align: 'center', color: '#8fe8a0',
      });
      drawText(x, 'NOTHING ON BAND', {
        x: ox + W / 2, y: NY + 20, scale: 1, align: 'center', color: '#5f9a78',
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
    /* How far off your heading the bearing is, wrapped to +/- pi, and
       signed the way the tape reads: screen-right is (-cos yaw, sin yaw), so
       a bearing counter-clockwise of your heading sits to your LEFT. Taken
       the other way round the bob and the arrow both pointed away from the
       carrier, and turning toward it drove the marker further out. */
    let rel = sc.facing - sc.bearing;
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
      color: on ? '#8fe8a0' : (him ? '#c09a3a' : '#5f9a78'),
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
  /* ===========================================================
     THE RECEIPT PRINTER

     Switched on off the belt like the scanner, and read like one: the
     roll on the left with the last six sales stacked on it, the docket
     itself on the right, and N to walk back through them.

     It used to be a docket that appeared for fifteen seconds and left. A
     thing you cannot look at again is not information, it is a
     notification — and the whole reason to buy this is to be able to say
     "he bought a vest four minutes ago".
     =========================================================== */
  _printer(ox, oy, pr) {
    const x = this.x;
    const W = 98, H = 76;
    const list = pr.list || [];
    const at = Math.min(pr.at || 0, Math.max(0, list.length - 1));
    const r = list.length ? list[list.length - 1 - at] : null;

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

    /* ---- the head, with the paper coming out of it ---- */
    const HX = ox + 5, HY = oy + 5, HW = W - 10;
    x.fillStyle = '#12150f'; x.fillRect(HX, HY, HW, 9);
    x.fillStyle = '#3a4038'; x.fillRect(HX, HY, HW, 1);
    drawText(x, 'FERDI', { x: HX + 3, y: HY + 1, scale: 1, color: '#8a7c5c' });
    // the feed roller, turning whenever something has just printed
    const spin = r && r.t < 1.2;
    for (let i = 0; i < 6; i++) {
      const k = (i + Math.floor((pr.t || 0) * (spin ? 14 : 2))) % 6;
      x.fillStyle = k < 3 ? '#6a6254' : '#2a2e28';
      x.fillRect(HX + HW - 26 + i * 4, HY + 3, 3, 4);
    }
    if (list.length) {
      drawText(x, `${at + 1}/${list.length}`, {
        x: HX + HW - 2, y: HY + 1, scale: 1, align: 'right', color: '#8fe8a0',
      });
    }

    /* ---- the roll: one stub per sale, the one you are reading lit ---- */
    const RX = ox + 5, RY = oy + 17;
    for (let i = 0; i < 6; i++) {
      const has = i < list.length;
      const here = has && i === at;
      x.fillStyle = here ? '#e8e3d2' : (has ? '#8a8474' : '#1e2219');
      x.fillRect(RX, RY + i * 6, 6, 4);
    }

    /* ---- the docket ---- */
    const DX = ox + 15, DW = W - 20;
    if (!r) {
      drawText(x, 'NO SALES YET', {
        x: ox + W / 2, y: oy + 34, scale: 1, align: 'center', color: '#8fe8a0',
      });
      drawText(x, 'OVER THE COUNTER', {
        x: ox + W / 2, y: oy + 44, scale: 1, align: 'center', color: '#5f9a78',
      });
      return;
    }
    /* the paper, feeding out over about half a second */
    const out = Math.min(1, r.t / 0.45);
    const DH = Math.round(46 * (1 - Math.pow(1 - out, 3)));
    x.save();
    x.beginPath(); x.rect(DX, RY, DW, Math.max(1, DH)); x.clip();
    x.fillStyle = '#e8e3d2'; x.fillRect(DX, RY, DW, 46);
    x.fillStyle = 'rgba(150,138,110,.35)';
    x.fillRect(DX, RY, 1, 46); x.fillRect(DX + DW - 1, RY, 1, 46);
    x.fillStyle = 'rgba(60,50,40,.07)';
    for (let i = 2; i < 46; i += 4) x.fillRect(DX + 3, RY + i, DW - 6, 1);

    const fit = (str) => {
      const full = String(str);
      let v = full;
      while (v.length > 2 && textWidth(v, 1) > DW - 8) v = v.slice(0, -1);
      return v === full ? v : `${v.slice(0, -1)}.`;
    };
    // the lines catch up with the paper rather than arriving with it
    const line = (n) => out >= 1 && r.t > 0.25 + n * 0.11;
    if (line(0)) drawText(x, fit(r.who), { x: DX + 4, y: RY + 3, scale: 1, color: '#241e16' });
    if (line(1)) {
      x.fillStyle = 'rgba(60,50,40,.45)';
      for (let i = 4; i < DW - 4; i += 2) x.fillRect(DX + i, RY + 12, 1, 1);
      drawText(x, fit(r.what), { x: DX + 4, y: RY + 15, scale: 1, color: '#4a4032' });
    }
    if (line(2)) {
      x.fillStyle = 'rgba(60,50,40,.45)';
      for (let i = 4; i < DW - 4; i += 2) x.fillRect(DX + i, RY + 25, 1, 1);
      drawText(x, 'PAID', { x: DX + 4, y: RY + 28, scale: 1, color: '#7a6c54' });
      const pr2 = String(r.price);
      drawText(x, pr2, { x: DX + DW - 4, y: RY + 28, scale: 1, align: 'right', color: '#241e16' });
      drawCoinPip(x, DX + DW - 6 - textWidth(pr2, 1) - 7, RY + 28);
    }
    if (line(3)) {
      // how long ago, because "four minutes ago" is the useful part
      const secs = Math.floor(r.t);
      const ago = secs < 60 ? `${secs}S AGO` : `${Math.floor(secs / 60)}M AGO`;
      drawText(x, ago, { x: DX + 4, y: RY + 37, scale: 1, color: '#8a7c64' });
    }
    x.restore();
    // the torn bottom edge, on whatever is out
    const bot = RY + Math.max(1, DH);
    x.fillStyle = '#c9c2ad';
    for (let i = 0; i < DW; i += 3) x.fillRect(DX + i, bot - 1, 2, 1);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(DX, bot, DW, 1);

    drawText(x, list.length > 1 ? 'N  READ BACK' : 'N', {
      x: ox + W / 2, y: oy + H - 10, scale: 1, align: 'center', color: '#5f9a78',
    });
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
    /* The grace window is folded into the kill clock rather than measured
       against itself: left/total was grace/grace for the whole two minutes,
       so the bar sat at a hard zero and then leapt to full in the last
       second. killReady is never earlier than graceEnds, so this is the
       same wait, drawn as one monotone fill. */
    const left = Math.max(grace, cd);
    const ready = left <= 0;
    const total = Math.max(mp.killTotal || 1, 1);

    /* On neutral ground the kill is refused however cold the clock is, and
       the panel went on promising a knife over a key that did nothing. */
    const sanct = !!mp.sanct;
    drawKnife(x, ox + 3, oy + 3, ready && !sanct);
    drawText(x, sanct ? 'NEUTRAL GROUND' : (ready ? 'KNIFE READY' : 'KILL COOLDOWN'), {
      x: ox + 14, y: oy + 3, scale: 1, color: ready && !sanct ? '#ff8a7a' : '#a87a70',
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
    /* Six glyphs reach ox+38 with their shadow, and the bar was started at
       ox+30 and filled after them, so SCATTER printed as SCAT and two
       stubs. The bar starts clear of the label field and gives up the
       width, rather than the label giving up its last two letters. */
    const LX = 40;
    for (const c of cools.slice(0, 3)) {
      const cbw = PW - 46;
      drawText(x, (c.kind || '').toUpperCase().slice(0, 6), { x: ox + 3, y: cy, scale: 1, color: '#7a5a54' });
      x.fillStyle = INK; x.fillRect(ox + LX, cy, cbw + 2, 5);
      x.fillStyle = '#20100c'; x.fillRect(ox + LX + 1, cy + 1, cbw, 3);
      const nn = Math.round((1 - Math.min(1, c.left / Math.max(1, c.total))) * cbw);
      for (let i = 0; i < nn; i += 3) {
        x.fillStyle = i % 6 ? '#6a4a24' : '#c39a2c';
        x.fillRect(ox + LX + 1 + i, cy + 1, 2, 3);
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
    /* An Agent's own chores count toward this bar, and it filled in gold and
       went JADE at a hundred — the colour of a win — on the frame he lost.
       Named and coloured for whose bar it is, so pitching in to look busy is
       a trade he can see he is making. */
    const them = mp.role === 'agent';
    /* 'THEIR WORK' is 59 pixels of a 74-pixel plate and would have taken the
       label off the panel entirely once the count is beside it. */
    const word = them ? 'THEIRS' : 'WORK';
    if (cntW + textWidth(word, 1) + 10 <= PW) {
      drawText(x, word, { x: px0 + 4, y: y + 2, scale: 1, color: '#c9b98a' });
    }
    drawText(x, cnt, {
      x: ox - 4, y: y + 2, scale: 1, align: 'right',
      color: !them && frac >= 1 ? JADE : '#c9b98a',
    });
    const bw = PW - 8, bx = px0 + 4;
    x.fillStyle = INK; x.fillRect(bx - 1, y + 11, bw + 2, 6);
    x.fillStyle = '#231708'; x.fillRect(bx, y + 12, bw, 4);
    for (let i = 0; i < Math.round(frac * bw); i += 3) {
      x.fillStyle = them ? (i % 6 ? '#8a2018' : '#c03a2c') : (i % 6 ? '#c39a2c' : GOLD);
      x.fillRect(bx + i, y + 12, 2, 4);
    }

    /* What just happened to the purse, floating clear of the figure rather
       than printing on top of it — over it you got "9090/919". It used to
       float ABOVE the plate, and the plate is three pixels from the top of
       the frame: ly was never once greater than zero and nobody has ever
       seen this. It floats below instead, under the panel it belongs to and
       drawn after it so the panel cannot bury it in turn; the backing keeps
       it legible over the work count for the second the kick lasts. */
    if (kick > 0 && this._purseDelta) {
      const rise = Math.round((1 - kick) * 5);
      const label = (this._purseDelta > 0 ? '+' : '') + this._purseDelta;
      const lw = textWidth(label, 1);
      const lx = ox - 4 - lw;
      const ly = oy + PH + 4 - rise;
      x.fillStyle = 'rgba(8,6,3,.85)';
      x.fillRect(lx - 2, ly - 1, lw + 4, 9);
      drawText(x, label, {
        x: lx, y: ly, scale: 1, color: gain ? '#8fe8a0' : '#ff8a7a',
      });
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
    /* What the banner and the toasts have to clear. */
    this._mpRightBottom = y + SH;
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
    const shown = Math.min(belt.length, MAX);
    const spare = belt.length - shown;
    if (shown) {
      const w = Math.max(shown * SLOT + 4 + (spare > 0 ? 18 : 0),
        textWidth('BELT', 1) + 10);
      plate(x, ox, oy - 10, w, SLOT + 16);
      drawText(x, 'BELT', { x: ox + 3, y: oy - 8, scale: 1, color: '#8a7a52' });
      if (spare > 0) {
        drawText(x, `+${spare}`, {
          x: ox + w - 4, y: oy - 8, scale: 1, align: 'right', color: '#8a7a52',
        });
      }
      for (let i = 0; i < shown; i++) {
        const sl = belt[i];
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
      }
    }

    /* Passives are facts about you rather than keys you press. They used to
       be a bare row of nine-pixel icons floating on the world with no panel
       and no label — from a distance that reads as one small brown button
       nobody can identify. Labelled and plated now. */
    if (passives.length) {
      const py = oy + (shown ? SLOT + 10 : 0);
      const pw = Math.max(passives.length * 11 + 6, textWidth('ON YOU', 1) + 10);
      plate(x, ox, py - 10, pw, 21);
      drawText(x, 'ON YOU', { x: ox + 3, y: py - 8, scale: 1, color: '#8a7a52' });
      passives.forEach((icon, i) => {
        drawShopIcon(x, icon, ox + 3 + i * 11, py + 1, 9, false, t);
      });
    }
  }

  /** Centre-bottom: whatever is currently urgent. */
  _mpBanner(W, H, mp, pwLeft = 0) {
    const x = this.x;

    /* The dead get a line of their own, above everything else the banner
       does. Being murdered is not the end of the round for you and the game
       should say so — the chores still count, and F puts you on somebody's
       shoulder rather than making you walk the island to find them. */
    if (mp.alive === false) {
      const msg = mp.watching ? `WATCHING ${mp.watching}` : 'YOU ARE A GHOST';
      /* Sized from its own text and centred on the frame, this was 205 wide
         on a 240-wide frame: three chore rows on one side and the whole of
         WORK on the other went under it, told by the banner that the chores
         still count. It gets the room the two columns actually leave — the
         same measurement the compass is given — and where the hint will not
         fit on one line it goes on two, split at the keys rather than
         wrapped, because "SOMEBODY E" is not a hint. */
      const room = 2 * Math.min(W / 2 - (pwLeft + 4), W / 2 - 81);
      const inner = Math.max(30, room - 14);
      const long = mp.watching ? 'F  NEXT     MOVE  LET GO' : 'F  WATCH SOMEBODY     E  WORK ON';
      const hint = textWidth(long, 1) <= inner ? [long]
        : (mp.watching ? ['F  NEXT', 'MOVE  LET GO'] : ['F  WATCH', 'E  WORK ON']);
      const lines = [...wrapText(msg, inner, 1, 1), ...hint];
      const gw = Math.min(room, lines.reduce((m, s2) => Math.max(m, textWidth(s2, 1)), 0) + 14);
      const gx = Math.round((W - gw) / 2), gy = 22;
      plate(x, gx, gy, gw, 4 + lines.length * 10);
      const named = lines.length - hint.length;
      lines.forEach((s2, i) => drawText(x, s2, {
        x: W / 2, y: gy + 3 + i * 10, scale: 1, align: 'center',
        color: i < named ? '#8fd8ff' : '#6a7a8a',
      }));
    }

    // task hold — a single framed panel, not a bar with captions above and
    // an interaction prompt fighting it below
    if (mp.task) {
      const t2 = mp.task;
      /* The bottom line is the verb, which can be longer than the name the
         plate was measured from — SHOULDERING HOLD STILL ran twenty pixels
         off each end of its own backing onto the world. */
      const hold = `${t2.verb || ''}  HOLD STILL`;
      const pw = Math.min(W - 8,
        Math.max(96, textWidth(t2.name || '', 1) + 14, textWidth(hold, 1) + 14));
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
      drawText(x, t2.holding ? hold : 'HOLD E',
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
  _compass(cx, oy, c, w = 132) {
    if (!c) return;
    const x = this.x;
    /* The caller says how much room it has; the strip used to take 132
       whatever the frame was and print it over its neighbours. The baked
       plate is blitted from its own centre outwards rather than scaled, so
       a narrow strip is the same pixels with less of them either side and
       everything below still measures against the width in hand. */
    const W = Math.max(40, Math.min(132, w | 0)), H = 17;
    const left = Math.round(cx - W / 2);
    x.fillStyle = INK; x.fillRect(left - 1, oy - 1, W + 2, H + 2);
    x.drawImage(this._compassBg, (132 - W) >> 1, 0, W, H, left, oy, W, H);

    // degree ticks every 15 degrees, taller every 45
    for (let deg = 0; deg < 360; deg += 15) {
      const dA = compassWrap(deg * Math.PI / 180 - c.yaw);
      if (Math.abs(dA) > COMPASS_HALF) continue;
      const tx = compassX(dA, left, W);
      const major = deg % 45 === 0;
      x.fillStyle = major ? '#7a6a3c' : '#4a3a1c';
      x.fillRect(tx, oy + H - (major ? 5 : 3), 1, major ? 5 : 3);
    }

    /* Two named places on the same bearing used to print on top of each
       other — CAMP and COIN at the same angle came out as "CCOAIMNP". The
       place labels share one row, so they are drawn in order of how much you
       need them and anything that would land on top of one already there is
       dropped. The pip or diamond still draws; only the lettering goes.
       Sorted where it lies: ui.js refills the same pooled marks in the same
       slots every frame, so a permuted pool is indistinguishable. */
    c.marks.sort(byNeed);
    this._compassTaken.length = 0;

    for (const m of c.marks) {
      const dA = compassWrap(m.angle - c.yaw);
      if (Math.abs(dA) > COMPASS_HALF) continue;
      const px = compassX(dA, left, W);
      const near = 1 - Math.abs(dA) / COMPASS_HALF;
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
      if (card) {
        const cw = textWidth(m.label, 1);
        drawText(x, m.label, {
          x: Math.max(left + cw / 2, Math.min(left + W - cw / 2, px)),
          y: oy + 1, scale: 1, align: 'center', color: col, shadow: false,
        });
        continue;
      }
      /* Picture first, name second, and the name is the part that gives way.
         A place costs seven pixels as a sprite and up to thirty-five as a
         word, so on a crowded bearing the word is what will not fit — and a
         campfire you can recognise is worth more than a blank gap where
         CAMP used to be dropped for want of room. */
      const icon = m.icon && POI_ICONS[m.icon] ? m.icon : null;
      const lw = textWidth(m.label, 1);
      const iw = icon ? POI_ICON_W + 2 : 0;   // two clear pixels, or the halo touches the first letter
      /* A mark survives to within a twentieth of the end of the strip, so a
         word centred on it lettered clean off the plate — onto a heart on
         one side and the purse's coin pip on the other, with no shadow
         under it. It slides inboard until it is on its own backing, and
         claims the span it will actually occupy rather than the one it
         asked for, or two labels clamped to the same end re-collide. */
      const lo = left + 1, hi = left + W - 1;
      const place = (wd) => Math.max(lo, Math.min(hi - wd, Math.round(px - wd / 2)));
      let showLabel = !!m.label;
      let wide = iw + lw;
      let x0 = place(wide);
      if (wide > hi - lo || !this._compassRoom(x0, wide)) {
        if (!icon) continue;                 // nothing to fall back on
        showLabel = false;
        wide = POI_ICON_W;
        x0 = place(wide);
        if (!this._compassRoom(x0, wide)) continue;
      }
      if (icon) drawPoiIcon(x, icon, x0, oy + 9, performance.now() / 1000);
      if (showLabel) {
        drawText(x, m.label, {
          x: x0 + iw, y: oy + 9, scale: 1, align: 'left', color: col, shadow: false,
        });
      }
      x.fillStyle = col; x.fillRect(px, oy + 7, 1, 2);
    }

    // needle and frame
    x.fillStyle = GOLD_LT;
    x.fillRect(Math.round(cx), oy - 3, 1, H + 5);
    x.fillRect(Math.round(cx) - 1, oy - 3, 3, 1);
    x.fillStyle = GOLD_DK;
    x.fillRect(left, oy, 1, H); x.fillRect(left + W - 1, oy, 1, H);
  }

  /** True if a label of width w starting at x0 clears everything already
      lettered on the compass this frame, and claims the span if it does. */
  _compassRoom(x0, w) {
    const t = this._compassTaken;
    for (let i = 0; i < t.length; i += 2) {
      if (x0 < t[i + 1] + 2 && x0 + w > t[i] - 2) return false;
    }
    t.push(x0, x0 + w);
    return true;
  }

  /* ---------- boss bar ---------- */
  _boss(cx, oy, b) {
    const x = this.x;
    const W = 150, H = 8;
    const left = Math.round(cx - W / 2);
    /* The counters on one side of this row and the stamina bar on the other
       own it: at 240 across HECTOR - EL BASS PRESIDENTE printed its tail
       over RELIC and its head on the bar. The name gets what they leave,
       measured symmetrically about the centre so it stays over its own
       bar — the bar itself is 150 and the row above is not. */
    const room = this.c.width - 128;
    let nm = normalize(b.name);
    if (textWidth(nm, 1, 1) > room) {
      const fit = Math.max(2, Math.floor((room + 1) / 6));
      nm = `${nm.slice(0, fit - 1).trimEnd()}.`;
    }
    drawText(x, nm, { x: cx, y: oy, scale: 1, align: 'center', color: '#ffb46a' });
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
    if (!d.objective) return 0;
    const x = this.x;
    const lines = wrapText(d.objective, 150, 1, 1);
    let y = byBottom - lines.length * 9 - 10;
    drawText(x, 'OBJECTIVE', { x: ox, y, scale: 1, color: GOLD_DK });
    y += 10;
    for (const ln of lines) { drawText(x, ln, { x: ox, y, scale: 1, color: GOLD_LT }); y += 9; }
    return lines.length * 9 + 10;    // what the prompt above it has to clear
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
  _prompt(cx, cy, text, key = 'E', flat = false) {
    const x = this.x;
    const label = String(text).toUpperCase();
    const capW = keycapWidth(key);
    /* Stood down to a line, because the caller has an instrument up and its
       case owns every row a 17-tall panel could have sat in. The key is
       still named, which is the part you are reading it for. */
    if (flat) {
      drawText(x, `${key}  ${label}`, {
        x: cx, y: cy, scale: 1, align: 'center', color: GOLD_LT,
      });
      return;
    }
    const w = textWidth(label, 1, 1) + capW + 20;
    const h = 17;
    // never off either edge, whatever it has been asked to centre on
    const left = Math.round(Math.max(3, Math.min(this.c.width - w - 3, cx - w / 2)));
    panel(x, left, cy, w, h, { border: 2, dither: 0.55 });
    keycap(x, left + 5, cy + 3, key);
    drawText(x, label, { x: left + 10 + capW, y: cy + 6, scale: 1, color: GOLD_LT });
  }

  /* ---------- toasts ----------
     Two at a time, newest kept. An uncapped stack grows down the middle of
     the screen and there is no panel you can put anywhere below it that a
     tall enough stack will not eventually reach — the scanner sits under
     this and was getting walked on.

     Nothing measured the width either. A toast is centred on cx and was
     drawn at whatever length it happened to be, so THEY WILL SWEAR YOU WERE
     ELSEWHERE - PRESS AGAIN TO DROP IT was a 365-pixel plate on a 240-pixel
     frame: nine characters off the left of the picture, ten off the right,
     and the whole width blanked for eleven rows. It wraps into the room the
     caller says it has, two lines at most so the stack cannot walk any
     further down than it did, and it stops at `bottom` — dropping the older
     toast rather than the one that has just arrived.

     Returns the y the stack finished at, so the popup card can stay off it. */
  _toasts(cx, oy, maxW = this.c.width - 24, bottom = this.c.height) {
    const x = this.x;
    // as many lines as the budget below the stack can hold, never more than two
    const cap = Math.max(1, Math.min(2, Math.floor((bottom - oy - 2) / 9)));
    const rows = this.data.toasts.slice(-2).map((t) => {
      const all = wrapText(t.text, maxW - 12, 1, 1);
      const lines = all.length ? all.slice(0, cap) : [''];
      // the same '.' the printer's dockets end a cut line with
      if (all.length > cap) lines[cap - 1] = `${lines[cap - 1].slice(0, -1)}.`;
      return {
        t,
        lines,
        w: lines.reduce((m, l) => Math.max(m, textWidth(l, 1, 1)), 0) + 12,
        h: lines.length * 9 + 2,
      };
    });
    let y = oy;
    while (rows.length > 1
      && y + rows.reduce((n, r) => n + r.h + 2, 0) - 2 > bottom) rows.shift();
    for (const r of rows) {
      const left = Math.round(Math.max(3, Math.min(this.c.width - r.w - 3, cx - r.w / 2)));
      const fade = Math.min(1, r.t.life * 3);
      if (fade < 0.5 && Math.floor(r.t.life * 12) % 2 === 0) { y += r.h + 2; continue; }
      x.fillStyle = 'rgba(8,5,3,.82)';
      x.fillRect(left, y, r.w, r.h);
      const col = r.t.kind === 'bad' ? RED : r.t.kind === 'jade' ? JADE : GOLD;
      x.fillStyle = col; x.fillRect(left, y, 2, r.h);
      const tc = r.t.kind === 'bad' ? '#ffbdb7' : GOLD_LT;
      r.lines.forEach((ln, i) => drawText(x, ln, { x: left + 6, y: y + 2 + i * 9, scale: 1, color: tc }));
      y += r.h + 2;
    }
    return y;
  }

  /* ===========================================================
     COLLECTIBLE POPUP — a drawn card with its own pixel icon
     =========================================================== */
  _popup(W, H, p, toastBot = 0) {
    const x = this.x;
    /* CENTRED, and 110 wide.

       It used to slide in against the right-hand edge, which is where the
       till roll now lives — and the scanner is on the left. The middle of
       that band, 105 to 215, is the one place nothing else uses, so the
       card drops into it from above instead of sliding in from the side. */
    /* Both were flat numbers, and the text field inside 110 is 68 pixels —
       eleven characters — so YOU ARE SEEING STARS was cut to YOU ARE SEEING
       and THEY ARE DECIDING ABOUT YOU lost ABOUT YOU. The card takes the
       width its own header needs and grows downwards for the lines it
       actually has, down being the one direction with room in it. */
    const head = p.head || 'RELIC FOUND';
    const CW = Math.max(110, Math.min(W - 24, textWidth(head, 1, 1) + 40));
    const TL = wrapText(p.title, CW - 42, 1, 1).slice(0, 3);
    const SL = p.sub ? wrapText(p.sub, CW - 42, 1, 1).slice(0, 3) : [];
    const CH = Math.max(52, 24 + (TL.length + SL.length) * 8 + (SL.length ? 2 : 0));
    const inT = Math.min(1, p.t / 0.28);
    const outT = p.t > p.dur - 0.5 ? (p.dur - p.t) / 0.5 : 1;
    const k = Math.min(inT, Math.max(0, outT));
    const ease = 1 - Math.pow(1 - k, 3);
    const left = Math.round(W / 2 - CW / 2);
    /* The card is opaque and lands on the middle of the frame, which is
       where the second toast still is at 180 tall — it cut it in half, and
       buying at Ferdi's fires a toast and a card together. It drops to
       just under whatever the stack actually used, and no further than the
       furniture below it; with one toast or none it does not move at all,
       and when it has been pushed it comes up from below rather than
       sweeping down through the stack it was moved off. */
    const rest = Math.round(H / 2 - CH / 2);
    const floor = (this.data.mp ? H - 62 : H - 44) - CH - 2;
    const restY = Math.min(Math.max(rest, toastBot + 2), Math.max(rest, floor));
    const push = restY > rest;
    const top = Math.round(restY + (push ? 1 : -1) * (1 - ease) * 26);

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
    drawText(x, head, { x: tx, y: top + 6, scale: 1, color: GOLD });
    x.fillStyle = '#5c3f1c'; x.fillRect(tx, top + 13, CW - 42, 1);
    let ty = top + 17;
    for (const ln of TL) { drawText(x, ln, { x: tx, y: ty, scale: 1, color: GOLD_LT }); ty += 8; }
    if (SL.length) {
      ty += 2;
      // laid out in sequence; clamping each line to the bottom edge stacked
      // them all on the same row
      for (const ln of SL) {
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
  plateEdge(x, ox, oy, w, 2);
  plateEdge(x, ox, oy + h - 2, w, 2);
  plateEdge(x, ox + w - 2, oy, 2, h);
}

/* Those edges are a 2x2 checkerboard of one colour and nothing, and dithering
   them a pixel at a time meant thousands of 1x1 fills a frame, half of them
   painting a fully transparent colour over what was already there. The
   pattern repeats every two pixels, so one cached tile covers a strip in a
   single fill; translating to the strip's own corner first keeps it in the
   phase ditherRect gave it, which is measured from the rect, not the canvas. */
let PLATE_EDGE = null;
function plateEdge(x, ox, oy, w, h) {
  if (!PLATE_EDGE) {
    const t = document.createElement('canvas');
    t.width = 2; t.height = 2;
    const tx = t.getContext('2d');
    tx.fillStyle = 'rgba(8,6,3,.90)';
    tx.fillRect(0, 0, 1, 1); tx.fillRect(1, 1, 1, 1);
    PLATE_EDGE = x.createPattern(t, 'repeat');
  }
  x.save();
  x.translate(ox, oy);
  x.fillStyle = PLATE_EDGE;
  x.fillRect(0, 0, w, h);
  x.restore();
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

/* ===========================================================
   POI SPRITES

   Seven by seven, because the compass row is seventeen tall and the glyphs
   beside them are five by seven — anything bigger pushes the strip out of
   shape. Each is a list of [dx, dy, w, h, colour] rects in the same shape
   as the chart's larger MAP_ICONS, and 'BLINK' is a colour that alternates,
   for the things that are meant to catch your eye.

   The point of them is room as much as recognition: a name on the compass
   costs twenty-three to thirty-five pixels of a hundred and thirty-two, and
   eight places in view at once do not fit. A picture costs seven, so when
   the row is crowded the label goes and the picture stays — which is more
   than the old behaviour left, a bare one-by-two pip and no clue at all.
   =========================================================== */
export const POI_ICONS = {
  // a campfire: two logs and a flame
  fire: [[0, 5, 7, 2, '#5a3a1e'], [1, 4, 5, 1, '#6b4626'], [2, 2, 3, 2, '#e06a1a'],
    [3, 0, 1, 2, '#f0a020'], [2, 3, 1, 1, '#fff0b0']],
  // where you all washed up: a tent
  camp: [[3, 0, 1, 1, '#8a7452'], [2, 1, 3, 1, '#8a7452'], [1, 2, 5, 2, '#a08a5e'],
    [0, 4, 7, 3, '#7a6444'], [3, 4, 1, 3, '#2a2018']],
  // Cathy's: a parasol over a burger
  cathy: [[0, 0, 7, 2, '#c4402e'], [2, 0, 1, 2, '#f0e4c4'], [5, 0, 1, 2, '#f0e4c4'],
    [1, 3, 5, 1, '#e8b04a'], [1, 4, 5, 1, '#7a3a20'], [1, 5, 5, 2, '#c98a3a']],
  // the temple: flat-topped and squarely stepped, so it is not the tent
  temple: [[0, 5, 7, 2, '#8a7a54'], [1, 3, 5, 2, '#7a6a44'], [2, 1, 3, 2, '#6a5a34'],
    [2, 0, 3, 1, '#9a8a64'], [3, 4, 1, 3, '#150f06']],
  // the little gold man himself
  idol: [[2, 0, 3, 2, '#ffd24a'], [1, 2, 5, 3, '#e0a92b'], [0, 5, 7, 2, '#a8761c']],
  // the listening post: a hatch with an aerial
  post: [[0, 4, 7, 3, '#4a5a4a'], [1, 5, 5, 1, '#2e3a2e'], [3, 0, 1, 4, '#8a8478'],
    [2, 0, 1, 1, '#8a8478'], [4, 0, 1, 1, '#8a8478']],
  // one of Ferdi's outlying machines
  machine: [[1, 0, 5, 7, '#2e4a5a'], [2, 1, 3, 3, '#7ad0e0'], [2, 5, 3, 1, '#c9b98a']],
  // somebody put a boombox down
  box: [[0, 1, 7, 5, '#3a3a44'], [1, 2, 2, 3, '#8fd8ff'], [4, 2, 2, 3, '#8fd8ff'],
    [3, 0, 1, 1, '#8a8478']],
  // a hammer, for whatever the Agents broke. Blinks with the alarm.
  fix: [[1, 0, 5, 2, 'BLINK'], [0, 0, 1, 1, 'BLINK'], [3, 2, 1, 5, '#c98a3a']],
  // loose money
  coin: [[2, 0, 3, 1, '#ffd24a'], [1, 1, 5, 5, '#ffd24a'], [2, 6, 3, 1, '#ffd24a'],
    [3, 2, 1, 3, '#8a6a20']],
  // the X, and what is under it
  dig: [[0, 0, 2, 2, '#8a1a10'], [5, 0, 2, 2, '#8a1a10'], [2, 2, 3, 3, '#8a1a10'],
    [0, 5, 2, 2, '#8a1a10'], [5, 5, 2, 2, '#8a1a10']],
  // a Rogue Pendulum: the bob on its wire
  pendulum: [[3, 0, 1, 2, '#8a8478'], [3, 2, 1, 1, '#d0a0ff'], [2, 3, 3, 1, '#9a6ad0'],
    [1, 4, 5, 1, '#9a6ad0'], [2, 5, 3, 1, '#9a6ad0'], [3, 6, 1, 1, '#d0a0ff']],
  // the way out of wherever you are
  out: [[0, 0, 5, 7, '#4a3a22'], [1, 1, 3, 5, '#150f06'], [5, 3, 2, 1, '#ffd24a'],
    [5, 2, 1, 1, '#ffd24a'], [5, 4, 1, 1, '#ffd24a']],
  // the bell you ring to call everybody in
  bell: [[2, 0, 3, 1, '#8a8478'], [1, 1, 5, 4, '#c9a03a'], [0, 5, 7, 1, '#e8c060'],
    [3, 6, 1, 1, '#8a6a20']],
};

export const POI_ICON_W = 7;

/** One POI sprite, with the same pale halo the chart's larger icons carry. */
export function drawPoiIcon(x, icon, ox, oy, t = 0) {
  const spec = POI_ICONS[icon];
  if (!spec) return false;
  const px = Math.round(ox), py = Math.round(oy);
  x.fillStyle = 'rgba(20,13,6,.85)';
  for (const [dx, dy, w, h] of spec) x.fillRect(px + dx - 1, py + dy - 1, w + 2, h + 2);
  const blink = Math.floor(t * 3) % 2 ? '#ff5a4a' : '#ffd0c0';
  for (const [dx, dy, w, h, col] of spec) {
    x.fillStyle = col === 'BLINK' ? blink : col;
    x.fillRect(px + dx, py + dy, w, h);
  }
  return true;
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

  } else if (kind === 'lantern') {
    px(6, 1, 4, 1, '#8a7a52');        // handle
    px(7, 2, 2, 1, '#8a7a52');
    px(4, 3, 8, 10, '#6a5a3a');       // brass cage
    px(5, 4, 6, 8, '#1a1408');
    px(7, 5, 2, 6, '#ffd88a');        // flame
    px(6, 6, 4, 3, '#ffb04a');
    px(4, 13, 8, 1, '#8a7a52');

  } else {
    /* The market names icons the popup does not all draw, and an unknown
       one left a bought item celebrating with an empty box. */
    px(6, 6, 4, 4, '#8a6c2a');
    px(7, 7, 2, 2, '#f0dc9a');
  }
}
