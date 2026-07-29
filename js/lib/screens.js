/* ===========================================================
   screens.js — every full-screen interface, drawn as pixels.

   The journal, pause menu, title, shop, chart and reader all used
   to be DOM. However you style DOM it renders at native resolution
   with antialiased type, so it sat on top of the game looking
   modern and artificial. These are drawn into the same low-res
   canvas as the HUD and composited inside the PS1 pass, so they
   pixelate, dither, band and curve exactly like the world does.
   =========================================================== */

import { drawText, textWidth, wrapText, panel, ditherRect, normalize } from './bitfont.js';
import { drawRelicIcon, drawShopIcon } from './hud.js';
import { COLOURS } from '../net/protocol.js';
import { SABOTAGE_DEFS } from '../mp/tasks.js';
import { MINIGAMES, bindText } from '../mp/minigames.js';
import { STOCK, stockFor, shelf, SANCTUARY_R, VENDOR_IDS } from '../mp/market.js';

// the minigames borrow the one font everything else is set in
bindText(drawText);

/** A small deterministic RNG, so a chore looks the same to whoever opens it. */
function mulberryLocal(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hex string for a player colour id, for the lobby and council lists. */
function colourOf(id) {
  const c = COLOURS.find((k) => k.id === id) || COLOURS[0];
  return '#' + c.hex.toString(16).padStart(6, '0');
}

const GOLD = '#ffd24a';
const GOLD_LT = '#fff3c4';
const GOLD_DK = '#a8761c';
const DIM = '#8a7a52';
const RED = '#e0453a';
const JADE = '#63c6a8';
const PAPER = '#e2cfa2';
const INK = '#2b1d0c';

/* ---------- shared chrome ---------- */
function frame(x, W, H, title, sub) {
  // full-screen scrim with scanline weave
  x.fillStyle = 'rgba(6,4,2,.86)';
  x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(0,0,0,.35)';
  for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

  const m = 10;
  panel(x, m, m, W - m * 2, H - m * 2, { border: 2, dither: 0.45, hi: GOLD_DK, lo: '#241708' });
  if (title) {
    drawText(x, title, { x: W / 2, y: m + 7, scale: 1, align: 'center', color: GOLD });
    x.fillStyle = GOLD_DK;
    x.fillRect(m + 8, m + 18, W - m * 2 - 16, 1);
  }
  if (sub) drawText(x, sub, { x: W / 2, y: m + 22, scale: 1, align: 'center', color: DIM });
  return { m, top: m + (sub ? 32 : 24), bottom: H - m - 12 };
}

/** A sunken input box. Darker inside than out, so it reads as a hole. */
function field(x, ox, oy, w, h, active) {
  x.fillStyle = active ? '#3a2a10' : '#241708';
  x.fillRect(ox - 1, oy - 1, w + 2, h + 2);
  ditherRect(x, ox, oy, w, h, '#120c06', '#1c1208', active ? 0.6 : 0.3);
  x.fillStyle = active ? GOLD : GOLD_DK;
  x.fillRect(ox - 1, oy - 1, w + 2, 1);
  x.fillRect(ox - 1, oy + h, w + 2, 1);
  x.fillRect(ox - 1, oy, 1, h);
  x.fillRect(ox + w, oy, 1, h);
}

function footer(x, W, H, text) {
  drawText(x, text, { x: W / 2, y: H - 17, scale: 1, align: 'center', color: DIM });
}

/**
 * Ferdi, framed, for the single-player shop counter.
 *
 * This went missing when drawShopIcon was moved out to hud.js — the two
 * were adjacent and the extraction took one brace too many, which is why
 * opening the shop in single player threw.
 */
function drawFerdiPortrait(x, ox, oy, t) {
  const u = 2;
  const px = (gx, gy, w, h, col) => { x.fillStyle = col; x.fillRect(ox + gx * u, oy + gy * u, w * u, h * u); };
  const blink = Math.sin(t * 0.9) > 0.93;
  px(0, 0, 18, 18, '#0d0906');
  px(1, 1, 16, 16, '#231708');
  // hat
  px(3, 2, 12, 2, '#54492f');
  px(5, 0, 8, 2, '#54492f');
  // face
  px(5, 4, 8, 5, '#c79a72');
  px(6, 5, 2, 1, blink ? '#c79a72' : '#2a1a10');
  px(10, 5, 2, 1, blink ? '#c79a72' : '#2a1a10');
  px(8, 6, 2, 1, '#c4614a');          // nose
  // beard
  px(4, 8, 10, 6, '#9a9388');
  px(5, 9, 8, 4, '#8a8378');
  px(7, 10, 4, 1, '#3a2f22');         // mouth
  // shoulders
  px(2, 14, 14, 4, '#6b5f48');
}

/**
 * Ferdi, drawn in the corner of his own shop.
 *
 * In the back room he is not there at all — a lantern hangs where he
 * would be and a shadow of him falls on the block work, which is the
 * whole conceit of the place.
 */
function drawFerdi(x, ox, oy, black, t) {
  const p = (gx, gy, w, h, col) => { x.fillStyle = col; x.fillRect(ox + gx, oy + gy, w, h); };
  const sway = Math.round(Math.sin(t * 0.9) * 1.5);
  const blink = Math.sin(t * 0.7) > 0.965;

  if (black) {
    // only his shadow, thrown up the wall and swaying with the bulb
    const sh = 'rgba(0,0,0,.55)';
    p(sway * 2 - 4, 0, 26, 4, sh);
    p(sway * 2 - 1, 4, 20, 30, sh);
    p(sway * 2 + 2, -8, 14, 9, sh);
    return;
  }

  // coat
  p(2 + sway, 12, 20, 34, '#5f5540');
  p(2 + sway, 12, 20, 2, '#7a6e52');
  p(0 + sway, 16, 3, 22, '#4a4132');
  p(21 + sway, 16, 3, 22, '#4a4132');
  // an arm leaning on the counter
  p(20 + sway, 30, 12, 4, '#5f5540');
  p(30 + sway, 30, 5, 5, '#c79a72');
  // head
  p(6 + sway, 0, 12, 12, '#c79a72');
  // the beard, most of him
  p(4 + sway, 8, 16, 10, '#9a9388');
  p(6 + sway, 16, 12, 5, '#8a8378');
  // sunburnt nose
  p(11 + sway, 6, 3, 3, '#c4614a');
  // eyes
  if (!blink) {
    p(8 + sway, 4, 2, 2, '#1a1208');
    p(14 + sway, 4, 2, 2, '#1a1208');
  } else {
    p(8 + sway, 5, 2, 1, '#1a1208');
    p(14 + sway, 5, 2, 1, '#1a1208');
  }
  // the hat
  p(3 + sway, -3, 18, 3, '#54492f');
  p(6 + sway, -8, 12, 5, '#54492f');
  p(6 + sway, -5, 12, 1, '#3a3220');
}

/** A vertical list of choices with a blinking selector. */
function menuList(x, items, sel, cx, top, t, opts = {}) {
  const gap = opts.gap ?? 14;
  const w = opts.width ?? 130;
  const rows = [];
  items.forEach((it, i) => {
    const y = top + i * gap;
    const on = i === sel;
    const label = typeof it === 'string' ? it : it.label;
    const dis = typeof it === 'object' && it.disabled;
    if (on) {
      x.fillStyle = '#3a2a10';
      x.fillRect(cx - w / 2, y - 3, w, 11);
      x.fillStyle = GOLD;
      x.fillRect(cx - w / 2, y - 3, 1, 11);
      x.fillRect(cx + w / 2 - 1, y - 3, 1, 11);
      if (Math.floor(t * 3) % 2 === 0) {
        drawText(x, '>', { x: cx - w / 2 + 4, y, scale: 1, color: GOLD });
      }
    }
    drawText(x, label, {
      x: cx, y, scale: 1, align: 'center',
      color: dis ? '#6a5c40' : (on ? GOLD_LT : DIM),
    });
    rows.push({ y: y - 3, h: 11, x: cx - w / 2, w });
  });
  return rows;
}

/* ===========================================================
   SCREEN STACK
   =========================================================== */
export class ScreenStack {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.t = 0;
    this._rows = [];
  }

  get open() { return this.stack.length > 0; }
  get top() { return this.stack[this.stack.length - 1] || null; }
  get name() { return this.top ? this.top.name : null; }

  push(name, data = {}) {
    /* `name` identifies the screen. A caller that puts its own `name` in
       the data renames the screen out of existence and the stack stops
       being able to find it — it has happened twice, so it is guarded now. */
    if (data && data.name !== undefined) {
      console.warn(`[screens] "${name}" was passed a name in its data; ignoring it`);
      data = { ...data };
      delete data.name;
    }
    const s = { name, sel: 0, scroll: 0, t: 0, ...data, name };
    if (SCREENS[name]?.init) SCREENS[name].init(s, this.game);
    this.stack.push(s);
    this.game.audio?.sfx('page');
    return s;
  }
  pop() { const s = this.stack.pop(); this.game.audio?.sfx('select'); return s; }
  clear() { this.stack.length = 0; }
  replace(name, data) { this.stack.length = 0; return this.push(name, data); }
  has(name) { return this.stack.some((s) => s.name === name); }

  key(code) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    if (!def) return false;
    return def.key ? def.key(code, s, this.game, this) !== false : false;
  }

  /** Screen-space click, already converted to canvas pixels. */
  click(cx, cy) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    for (let i = 0; i < this._rows.length; i++) {
      const r = this._rows[i];
      if (!r) continue;
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        /* Some screens have rows that are not menu entries — a chat box, a
           confirm button — so they get told which row was hit rather than
           having the index forced into `sel`. */
        if (def?.click) { def.click(r, i, s, this.game, this); return true; }
        s.sel = i;
        this.key('Enter');
        return true;
      }
    }
    return false;
  }

  /**
   * Pointer press / drag / release, in canvas pixels.
   *
   * Screens are mostly lists, so a click is enough for them — but the slot
   * machine has an arm, and an arm you cannot pull is a picture of an arm.
   */
  pointer(kind, cx, cy) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    if (!def?.pointer) return false;
    return !!def.pointer(kind, cx, cy, s, this.game, this);
  }

  /** Clipboard text, handed to the top screen if it takes any. */
  paste(text) {
    const s = this.top;
    if (!s) return false;
    const def = SCREENS[s.name];
    return def?.paste ? !!def.paste(text, s, this.game, this) : false;
  }

  update(dt) {
    this.t += dt;
    const s = this.top;
    if (!s) return;
    s.t += dt;
    /* A screen that runs a state machine (a slot spinning down, a reveal
       counting itself out) needs a clock that is not the draw call — draw
       must stay a pure function of state or it misbehaves the moment a
       frame is dropped. */
    SCREENS[s.name]?.tick?.(s, this.game, dt, s.t);
  }

  draw(x, W, H) {
    this._rows = [];
    const s = this.top;
    if (!s) return;
    const def = SCREENS[s.name];
    if (def?.draw) this._rows = def.draw(x, W, H, s, this.game, this.t) || [];
  }
}

/* ===========================================================
   SCREENS
   =========================================================== */
/** How long the command table takes to wake up. */
const BOOT_LEN = 1.9;

const nav = (code, s, len, onOk, onBack) => {
  if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + len - 1) % len; return true; }
  if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % len; return true; }
  if (code === 'Enter' || code === 'KeyE' || code === 'Space') { onOk?.(s.sel); return true; }
  if (code === 'Escape' || code === 'Backspace') { onBack?.(); return true; }
  return false;
};

export const SCREENS = {

  /* ---------------- MODE SELECT ---------------- */
  mode: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'ILLIC ISLE');
      drawText(x, 'CHOOSE A WAY TO PLAY', { x: W / 2, y: b.top, scale: 1, align: 'center', color: DIM });
      const rows = menuList(x, ['SINGLE PLAYER', 'CASTAWAYS  (3-10 PLAYERS)'],
        s.sel, W / 2, b.top + 18, t, { width: 180, gap: 16 });
      const blurb = s.sel === 0
        ? 'Wash ashore alone. Wake four Pendulums,\nopen the temple, take the Idol.'
        : 'Wash ashore together. Some of you are\nRogue Agents, and nobody knows who.\nDo the work. Watch the paths people take.';
      x.fillStyle = GOLD_DK;
      x.fillRect(W / 2 - 60, b.top + 48, 120, 1);
      let y = b.top + 56;
      for (const ln of blurb.split('\n')) {
        drawText(x, ln, { x: W / 2, y, scale: 1, align: 'center', color: GOLD_LT }); y += 10;
      }
      footer(x, W, H, 'ESC BACK');
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 2, (i) => {
        if (i === 0) { st.clear(); g.beginGame(); }
        else st.replace('mpMenu');
      }, () => st.replace('title'));
    },
  },

  /* ---------------- HOST OR JOIN ---------------- */
  mpMenu: {
    init(s, g) {
      s.who = (localStorage.getItem('illicisle.name') || '').toUpperCase();
      s.code = '';
      s.field = 0;           // 0 name, 1 code
      s.busy = false;
      s.err = '';
      s.status = '';
    },
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'CASTAWAYS');
      const caret = (on) => (on && Math.floor(t * 3) % 2 ? '_' : '');

      // name
      const rows = [];
      let y = b.top + 4;
      const nw = 120, nx = Math.round((W - nw) / 2);
      drawText(x, 'YOUR NAME', { x: W / 2, y, scale: 1, align: 'center', color: s.field === 0 ? GOLD : DIM });
      field(x, nx, y + 10, nw, 15, s.field === 0);
      drawText(x, s.who + caret(s.field === 0), {
        x: W / 2, y: y + 14, scale: 1, align: 'center', color: GOLD_LT,
      });
      rows.push({ x: nx - 4, y: y + 7, w: nw + 8, h: 21, focus: 0 });

      // room
      y += 36;
      drawText(x, 'ROOM CODE', { x: W / 2, y, scale: 1, align: 'center', color: s.field === 1 ? GOLD : DIM });
      const rw = 78, rx = Math.round((W - rw) / 2);
      field(x, rx, y + 10, rw, 20, s.field === 1);
      drawText(x, s.code + caret(s.field === 1), {
        x: W / 2, y: y + 16, scale: 2, align: 'center', color: GOLD_LT,
      });
      rows.push({ x: rx - 4, y: y + 7, w: rw + 8, h: 26, focus: 1 });
      drawText(x, 'CLICK A BOX TO TYPE IN IT   CTRL V PASTES', {
        x: W / 2, y: y + 36, scale: 1, align: 'center', color: DIM,
      });
      drawText(x, 'LEAVE THE CODE BLANK TO OPEN A ROOM OF YOUR OWN', {
        x: W / 2, y: y + 45, scale: 1, align: 'center', color: '#6a5c40',
      });

      y += 60;
      for (const r of menuList(x, [s.code ? 'JOIN THAT ROOM' : 'OPEN A NEW ROOM'],
        0, W / 2, y, t, { width: 150 })) rows.push({ ...r, go: true });
      if (!s.busy && !s.err) {
        x.fillStyle = GOLD_DK; x.fillRect(W / 2 - 70, y + 22, 140, 1);
        const rules = [
          'THREE TO TEN CASTAWAYS. SOME ARE ROGUE AGENTS.',
          'CASTAWAYS FINISH THE WORK. AGENTS CUT THEM DOWN.',
          'FIND A BODY, CALL A COUNCIL, THROW SOMEBODY TO THE SEA.',
        ];
        let ry = y + 28;
        for (const r of rules) {
          drawText(x, r, { x: W / 2, y: ry, scale: 1, align: 'center', color: DIM });
          ry += 10;
        }
      }
      if (s.busy) drawText(x, s.status || 'CONNECTING', { x: W / 2, y: y + 20, scale: 1, align: 'center', color: JADE });
      if (s.err) {
        let ey = y + 20;
        for (const ln of wrapText(s.err, W - 50, 1, 1)) {
          drawText(x, ln, { x: W / 2, y: ey, scale: 1, align: 'center', color: RED }); ey += 9;
        }
      }
      footer(x, W, H, 'TAB SWITCH FIELD   ENTER GO   ESC BACK');
      return rows;
    },

    /** Clicking a box puts the caret in it. */
    click(row, i, s, g, st) {
      if (row?.focus !== undefined) { s.field = row.focus; g.audio?.sfx('select'); return true; }
      if (row?.go) this.key('Enter', s, g, st);
      return true;
    },

    /** Ctrl/Cmd+V. Room codes get read out loud and pasted, not retyped. */
    paste(text, s) {
      const clean = String(text || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
      if (!clean) return true;
      if (s.field === 1) s.code = (s.code + clean).replace(/\s/g, '').slice(0, 6);
      else s.who = (s.who + clean).replace(/^\s+/, '').slice(0, 12);
      return true;
    },

    key(code, s, g, st) {
      if (s.busy) return true;
      if (code === 'Tab') { s.field = 1 - s.field; return true; }
      if (code === 'Escape') { st.replace('mode'); return true; }
      if (code === 'Backspace') {
        if (s.field === 0) s.who = s.who.slice(0, -1); else s.code = s.code.slice(0, -1);
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter') {
        s.busy = true; s.err = '';
        const name = s.who.trim() || 'CASTAWAY';
        localStorage.setItem('illicisle.name', name);
        const go = s.code
          ? g.joinGame(name, s.code.trim().toUpperCase())
          : g.hostGame(name, null);
        go.then(() => st.replace('mpLobby'))
          .catch((e) => { s.busy = false; s.err = e.message || String(e); });
        return true;
      }
      // typed characters
      const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
      if (m) {
        const ch = m[1];
        if (s.field === 0) { if (s.who.length < 12) s.who += ch; }
        else if (s.code.length < 6) s.code += ch;
        return true;
      }
      if (code === 'Space' && s.field === 0 && s.who.length < 12) { s.who += ' '; return true; }
      return true;
    },
  },

  /* ---------------- LOBBY ---------------- */
  mpLobby: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'THE BEACH');
      const players = [...g.mp.view.players.values()];

      // the code, big, because saying it out loud is the whole handshake
      const code = g.mp.room || '----';
      const cw = textWidth(code, 3) + 22;
      const cx = Math.round((W - cw) / 2);
      field(x, cx, b.top - 1, cw, 29, true);
      drawText(x, code, { x: W / 2, y: b.top + 3, scale: 3, align: 'center', color: GOLD });
      drawText(x, 'ROOM CODE - SEND IT TO YOUR FRIENDS',
        { x: W / 2, y: b.top + 33, scale: 1, align: 'center', color: DIM });

      let y = b.top + 48;
      drawText(x, `${players.length} ASHORE`, { x: 30, y, scale: 1, color: DIM });
      y += 12;
      for (const p of players) {
        const hex = colourOf(p.colour);
        x.fillStyle = hex; x.fillRect(30, y, 7, 7);
        x.fillStyle = '#000'; x.fillRect(30, y + 7, 7, 1);
        drawText(x, p.name || '?', { x: 42, y, scale: 1, color: p.id === g.mp.view.selfId ? GOLD : GOLD_LT });
        if (p.id === 'host') drawText(x, 'HOST', { x: W - 30, y, scale: 1, align: 'right', color: JADE });
        y += 11;
      }
      // people want to know what they are walking into
      const n = players.length;
      const agents = n >= 9 ? 3 : n >= 6 ? 2 : 1;
      if (n >= 3) {
        drawText(x, `${agents} ROGUE AGENT${agents === 1 ? '' : 'S'} AMONG YOU`,
          { x: W - 30, y: b.top + 48, scale: 1, align: 'right', color: RED });
      }

      let rows = [];
      if (g.mp.dev) {
        drawText(x, 'DEV MODE', { x: W / 2, y: b.top + 33, scale: 1, align: 'center', color: JADE });
      }
      if (g.isHost) {
        const can = players.length >= (g.mp.dev ? 1 : 3);
        rows = menuList(x, [can ? 'PUT TO SEA' : 'NEED 3 PLAYERS'], s.sel, W / 2, b.bottom - 26, t, { width: 150 });
        if (!can) drawText(x, 'THREE ASHORE AT LEAST, TEN AT MOST',
          { x: W / 2, y: b.bottom - 40, scale: 1, align: 'center', color: DIM });
      } else {
        drawText(x, 'WAITING FOR THE HOST', { x: W / 2, y: b.bottom - 22, scale: 1, align: 'center', color: JADE });
      }
      footer(x, W, H, g.isHost ? 'ENTER START   ESC LEAVE' : 'ESC LEAVE');
      return rows;
    },
    key(code, s, g, st) {
      if (code === 'Escape') { location.reload(); return true; }
      if ((code === 'Enter' || code === 'KeyE') && g.isHost) g.startMatch();
      return true;
    },
  },

  /* ---------------- ROLE CARD ---------------- */
  mpRole: {
    draw(x, W, H, s, g, t) {
      const agent = g.amAgent;
      const HOT = agent ? '#ff6a5a' : '#8fe8c8';
      const DK = agent ? '#8a2018' : '#2f6a5c';

      /* Four beats, so it lands like a reveal instead of a box sliding up:
         the dark closes in, a slot opens, the card turns over, and then it
         settles and the words arrive. */
      const T1 = 0.55, T2 = 1.25, T3 = 2.0;
      const e = (a2, b2) => Math.max(0, Math.min(1, (s.t - a2) / (b2 - a2)));
      const easeOut = (k) => 1 - Math.pow(1 - k, 3);

      // 1. the world drains away
      const drain = easeOut(e(0, T1));
      x.fillStyle = agent ? '#180404' : '#04090e';
      x.globalAlpha = drain;
      x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
      if (drain > 0.02) ditherRect(x, 0, 0, W, H, agent ? '#180404' : '#04090e',
        agent ? '#240707' : '#071018', 0.5 * drain, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = `rgba(0,0,0,${(0.42 * drain).toFixed(2)})`; x.fillRect(0, y, W, 1); }

      const CW = 226, CH = 104;
      const cx = Math.round((W - CW) / 2), cy = Math.round((H - CH) / 2) - 4;

      // 2. a slot of light opens across the middle
      const slot = easeOut(e(T1 * 0.7, T2));
      if (slot > 0 && s.t < T2) {
        const sh = Math.max(1, Math.round(CH * slot));
        const sy = Math.round(cy + (CH - sh) / 2);
        x.fillStyle = DK;
        x.fillRect(cx - 2, sy - 1, CW + 4, sh + 2);
        x.fillStyle = agent ? '#2c0a08' : '#07131a';
        x.fillRect(cx, sy, CW, sh);
        ditherRect(x, cx, sy, CW, sh, agent ? '#2c0a08' : '#07131a',
          agent ? '#3a0f0c' : '#0b1c26', 0.4, 2);
        // a hot line racing along the opening edges
        if (slot < 1) {
          x.fillStyle = HOT;
          x.fillRect(cx, sy, CW, 1);
          x.fillRect(cx, sy + sh - 1, CW, 1);
        }
      }
      if (s.t < T2) return [];

      // 3. the card turns over: squash horizontally through the halfway point
      const flip = e(T2, T3);
      const face = flip < 0.5 ? Math.cos(flip * Math.PI) : Math.cos((1 - flip) * Math.PI) * -1;
      const squash = Math.max(0.04, Math.abs(Math.cos(flip * Math.PI)));
      const fw = Math.round(CW * (flip < 1 ? squash : 1));
      const fx = Math.round(W / 2 - fw / 2);

      x.fillStyle = agent ? '#2c0a08' : '#07131a';
      x.fillRect(fx, cy, fw, CH);
      ditherRect(x, fx, cy, fw, CH, agent ? '#2c0a08' : '#07131a',
        agent ? '#3a0f0c' : '#0b1c26', 0.4, 2);
      x.fillStyle = DK;
      x.fillRect(fx, cy, fw, 1); x.fillRect(fx, cy + CH - 1, fw, 1);
      x.fillRect(fx, cy, 1, CH); x.fillRect(fx + fw - 1, cy, 1, CH);

      if (flip < 1 && face < 0) {
        // the back of the card, mid-turn: a blank plate with a seal on it
        if (fw > 22) {
          x.fillStyle = DK;
          const bx = Math.round(W / 2 - Math.min(14, fw / 3) / 2);
          x.fillRect(bx, cy + CH / 2 - 7, Math.min(14, fw / 3), 14);
        }
        return [];
      }
      if (flip < 1) return [];

      // 4. settled: the words arrive line by line
      const line = (i) => e(T3 + 0.12 * i, T3 + 0.12 * i + 0.18);
      const fade = (k, c1, c2) => (k > 0.66 ? c1 : k > 0.25 ? c2 : DK);

      if (line(0) > 0) {
        drawText(x, 'YOU ARE', { x: W / 2, y: cy + 13, scale: 1, align: 'center',
          color: fade(line(0), DIM, '#5a4a34') });
      }
      if (line(1) > 0) {
        // the title stamps in: oversized for a frame, then settles
        const k = line(1);
        const sc = k < 0.55 ? 3 : 2;
        drawText(x, agent ? 'A ROGUE AGENT' : 'A CASTAWAY', {
          x: W / 2, y: cy + 26 + (sc === 3 ? -4 : 0), scale: sc, align: 'center',
          color: k < 0.55 ? '#ffffff' : HOT,
        });
        if (k > 0.7) {
          x.fillStyle = DK;
          const rw = Math.round((CW - 70) * Math.min(1, (k - 0.7) / 0.3));
          x.fillRect(Math.round(W / 2 - rw / 2), cy + 48, rw, 1);
        }
      }
      const blurb = agent
        ? ['CUT THEM DOWN. DO NOT BE SEEN.', 'JAM THE ISLAND WHEN IT SUITS YOU.']
        : ['DO YOUR WORK. WATCH THE OTHERS.', 'SOMEBODY HERE IS NOT WHAT THEY SAY.'];
      blurb.forEach((ln, i) => {
        const k = line(2 + i);
        if (k <= 0) return;
        drawText(x, ln, { x: W / 2, y: cy + 57 + i * 11, scale: 1, align: 'center',
          color: fade(k, GOLD_LT, '#8a7a52') });
      });

      const k4 = line(4);
      if (k4 > 0) {
        const mates = g.mp.view.mates;
        const txt = agent
          ? (mates && mates.length > 1 ? 'WITH YOU: ' + mates.join('  ') : 'YOU WORK ALONE')
          : `${[...g.mp.view.players.values()].length} ASHORE. TRUST NOBODY.`;
        drawText(x, txt, { x: W / 2, y: cy + 84, scale: 1, align: 'center',
          color: fade(k4, agent ? '#ff9a8a' : '#9fd8c4', DK) });
      }

      // a slow pulse on the border once it is all up
      if (k4 >= 1) {
        const p = 0.5 + Math.sin(s.t * 3.1) * 0.5;
        x.fillStyle = p > 0.6 ? HOT : DK;
        x.fillRect(cx, cy, 6, 1); x.fillRect(cx + CW - 6, cy, 6, 1);
        x.fillRect(cx, cy + CH - 1, 6, 1); x.fillRect(cx + CW - 6, cy + CH - 1, 6, 1);
      }
      return [];
    },
    key() { return true; },
  },

  /* ---------------- COUNCIL + VOTE ---------------- */
  mpCouncil: {
    init(s) { s.sel = 0; s.typing = ''; s.talking = false; s.cast = null; s.stampT = 0; },
    draw(x, W, H, s, g, t) {
      const players = [...g.mp.view.players.values()];
      const alive = players.filter((p) => p.alive !== false);
      const total = Math.max(0.001, g.mp.view.phaseTotal || 60);
      const left = Math.max(0, (g.mp.view.phaseEndsAt || 0) - performance.now() / 1000);

      /* the fire everyone is sitting around */
      x.fillStyle = '#080604'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#080604', '#120c06', 0.5, 2);
      const flick = 0.82 + Math.sin(t * 11) * 0.09 + Math.sin(t * 6.3) * 0.09;
      for (let i = 6; i >= 0; i--) {
        x.fillStyle = `rgba(${88 - i * 6},${42 - i * 3},10,${(0.045 * flick).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H - 4, 34 + i * 13, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* header */
      drawText(x, 'THE COUNCIL', { x: W / 2, y: 6, scale: 2, align: 'center', color: GOLD });
      drawText(x, g.mp.councilHeader || '', { x: W / 2, y: 22, scale: 1, align: 'center', color: GOLD_LT });

      const bw = W - 52, bx = 26, by = 32;
      x.fillStyle = INK; x.fillRect(bx - 1, by - 1, bw + 2, 5);
      x.fillStyle = '#1c1208'; x.fillRect(bx, by, bw, 3);
      const n = Math.round((left / total) * bw);
      const urgent = left < 10;
      for (let i = 0; i < n; i += 3) {
        x.fillStyle = urgent ? (Math.floor(t * 6) % 2 ? '#ff6a5a' : '#8a2018') : (i % 6 ? '#c39a2c' : GOLD);
        x.fillRect(bx + i, by, 2, 3);
      }
      drawText(x, `${Math.ceil(left)}`, { x: W - 26, y: by - 9, scale: 1, align: 'right', color: urgent ? RED : DIM });
      const voted = new Set(g.mp.view.votes?.voted || []);
      drawText(x, `${voted.size}/${alive.length} VOTED`, { x: 26, y: by - 9, scale: 1, color: DIM });

      /* the ballot — every living name, votable from the moment you arrive */
      s.targets = alive.map((p) => p.id);
      s.targets.push('skip');
      if (s.sel >= s.targets.length) s.sel = 0;

      const LX = 10, LW = 118, ROW = 10;
      let y = 42;
      const rows = [];
      const canPick = g.amAlive && !s.cast;

      const line = (id, label, swatch, dead, tag, tagCol) => {
        const idx = s.targets.indexOf(id);
        const on = idx >= 0 && idx === s.sel && !s.talking;
        if (on && canPick) {
          x.fillStyle = '#5a1810'; x.fillRect(LX, y - 1, LW, ROW);
          x.fillStyle = RED; x.fillRect(LX, y - 1, 2, ROW);
        } else if (on) {
          x.fillStyle = '#2e2210'; x.fillRect(LX, y - 1, LW, ROW);
        }
        if (swatch) { x.fillStyle = dead ? '#4a4a4a' : swatch; x.fillRect(LX + 4, y, 6, 6); }
        const tagW = tag ? textWidth(tag, 1) + 5 : 0;
        let shown = label;
        while (shown.length > 1 && textWidth(shown, 1) > LW - 16 - tagW) shown = shown.slice(0, -1);
        drawText(x, shown, { x: LX + 14, y, scale: 1,
          color: dead ? '#6a6a6a' : (on ? GOLD_LT : '#c9b98a') });
        if (tag) drawText(x, tag, { x: LX + LW - 4, y, scale: 1, align: 'right', color: tagCol });
        if (idx >= 0 && canPick) rows[idx] = { x: LX, y: y - 1, w: LW, h: ROW, pick: idx };
        y += ROW;
      };

      for (const p of players) {
        const dead = p.alive === false;
        let tag = '', col = DIM;
        if (dead) { tag = 'X'; col = '#5a4a3a'; }
        else {
          const c = g.mp.view.votes?.counts?.[p.id] || 0;
          if (c) { tag = '*'.repeat(Math.min(c, 5)); col = GOLD; }
          else if (voted.has(p.id)) { tag = 'IN'; col = '#5f7a4a'; }
        }
        line(p.id, (p.name || '?'), colourOf(p.colour), dead, tag, col);
      }
      const skips = g.mp.view.votes?.counts?.skip || 0;
      line('skip', 'NOBODY', null, false, skips ? '*'.repeat(Math.min(skips, 5)) : '', GOLD);

      /* one button, and it says who it is for */
      y += 3;
      if (!g.amAlive) {
        drawText(x, 'THE DEAD DO NOT VOTE', { x: LX, y, scale: 1, color: '#6a6a6a' });
      } else if (s.cast) {
        const who = s.cast === 'skip' ? 'NOBODY'
          : (players.find((p) => p.id === s.cast)?.name || '?');
        s.stampT += 0.016;
        const k = Math.min(1, s.stampT / 0.2);
        const over = 1 + (1 - k) * 0.3;
        x.save();
        x.translate(LX + LW / 2, y + 8); x.scale(over, over); x.translate(-(LX + LW / 2), -(y + 8));
        x.fillStyle = '#12301f'; x.fillRect(LX, y, LW, 17);
        x.fillStyle = JADE;
        x.fillRect(LX, y, LW, 1); x.fillRect(LX, y + 16, LW, 1);
        x.fillRect(LX, y, 1, 17); x.fillRect(LX + LW - 1, y, 1, 17);
        let shown = who;
        while (shown.length > 1 && textWidth(shown, 1) > LW - 40) shown = shown.slice(0, -1);
        drawText(x, `VOTED  ${shown}`, { x: LX + LW / 2, y: y + 5, scale: 1,
          align: 'center', color: k < 0.6 ? '#ffffff' : GOLD_LT });
        x.restore();
      } else {
        const who = s.targets[s.sel] === 'skip' ? 'NOBODY'
          : (players.find((p) => p.id === s.targets[s.sel])?.name || '?');
        let lbl = `ENTER  VOTE ${who}`;
        while (lbl.length > 8 && textWidth(lbl, 1) > LW - 10) lbl = lbl.slice(0, -1);
        x.fillStyle = '#2a0a08'; x.fillRect(LX, y, LW, 13);
        x.fillStyle = RED;
        x.fillRect(LX, y, LW, 1); x.fillRect(LX, y + 12, LW, 1);
        x.fillRect(LX, y, 1, 13); x.fillRect(LX + LW - 1, y, 1, 13);
        drawText(x, lbl, { x: LX + LW / 2, y: y + 3, scale: 1, align: 'center', color: '#ffd8ce' });
        rows.push({ x: LX, y, w: LW, h: 13, vote: true });
      }

      /* chat, alongside — not before */
      const cx = LX + LW + 6;
      const cw = W - cx - 10;
      const ctop = 42, cbot = H - 33;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(cx, ctop, cw, cbot - ctop);
      x.fillStyle = s.talking ? JADE : '#3a2a10';
      x.fillRect(cx, ctop, cw, 1); x.fillRect(cx, cbot - 1, cw, 1);
      x.fillRect(cx, ctop, 1, cbot - ctop); x.fillRect(cx + cw - 1, ctop, 1, cbot - ctop);

      const lines = [];
      for (const m of g.mp.chat.slice(-16)) {
        wrapText(`${m.from}: ${m.text}`, cw - 7, 1, 1).forEach((ln, i) => lines.push({
          ln, kind: m.kind, from: i === 0 ? m.from : null, colour: m.colour,
        }));
      }
      const fit = Math.floor((cbot - ctop - 5) / 8);
      let cy = ctop + 3;
      for (const l of lines.slice(-fit)) {
        drawText(x, l.ln, { x: cx + 3, y: cy, scale: 1, color: l.kind === 'ghost' ? '#8fb0c8' : GOLD_LT });
        if (l.from) drawText(x, l.from + ':', { x: cx + 3, y: cy, scale: 1, color: colourOf(l.colour) });
        cy += 8;
      }
      if (!lines.length) {
        drawText(x, 'NOBODY HAS SPOKEN YET', { x: cx + cw / 2, y: ctop + 6, scale: 1, align: 'center', color: '#4a3f2a' });
      }

      field(x, cx, H - 31, cw, 11, s.talking);
      if (s.talking) {
        drawText(x, s.typing + (Math.floor(t * 3) % 2 ? '_' : ''), {
          x: cx + 3, y: H - 28, scale: 1, color: g.amAlive ? JADE : '#8fb0c8' });
      } else {
        drawText(x, 'T  TO TALK', { x: cx + 3, y: H - 28, scale: 1, color: '#5a4a30' });
        rows.push({ x: cx, y: H - 31, w: cw, h: 11, talk: true });
      }

      footer(x, W, H, s.talking ? 'ENTER SENDS   ESC STOPS TYPING'
        : (s.cast ? 'YOUR VOTE IS IN   T TALKS'
          : 'CLICK A NAME OR ARROW TO IT   ENTER VOTES   T TALKS'));
      return rows;
    },

    paste(text, s) {
      if (!s.talking) return false;
      s.typing = (s.typing + String(text || '').toUpperCase().replace(/[^A-Z0-9 .,'?-]/g, '')).slice(0, 60);
      return true;
    },

    key(code, s, g, st) {
      if (s.talking) {
        if (code === 'Escape') { s.talking = false; s.typing = ''; return true; }
        if (code === 'Enter' || code === 'NumpadEnter') {
          if (s.typing.trim()) g.sendChat(s.typing.trim());
          s.typing = ''; s.talking = false;
          return true;
        }
        if (code === 'Backspace') { s.typing = s.typing.slice(0, -1); return true; }
        const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
        if (m && s.typing.length < 60) { s.typing += m[1]; return true; }
        const punct = { Space: ' ', Period: '.', Comma: ',', Slash: '?', Minus: '-', Quote: "'" };
        if (punct[code] && s.typing.length < 60) { s.typing += punct[code]; return true; }
        return true;
      }
      if (code === 'KeyT') { s.talking = true; return true; }
      if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyW' || code === 'KeyS') {
        const n2 = s.targets?.length || 1;
        s.sel = (s.sel + ((code === 'ArrowUp' || code === 'KeyW') ? n2 - 1 : 1)) % n2;
        g.audio?.sfx('select');
        return true;
      }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE' || code === 'Space') {
        if (!g.amAlive || s.cast) return true;
        s.cast = s.targets?.[s.sel] || 'skip';
        s.stampT = 0;
        g.sendVote(s.cast);
        return true;
      }
      return true;
    },

    /** Click a name to pick it, click it again (or the button) to send it. */
    click(row, i, s, g) {
      if (row?.talk) { s.talking = true; return true; }
      if (!g.amAlive || s.cast) return true;
      if (row?.vote) {
        s.cast = s.targets?.[s.sel] || 'skip';
        s.stampT = 0;
        g.sendVote(s.cast);
        return true;
      }
      if (row?.pick !== undefined) {
        if (row.pick === s.sel) {
          s.cast = s.targets[s.sel];
          s.stampT = 0;
          g.sendVote(s.cast);
        } else { s.sel = row.pick; g.audio?.sfx('select'); }
      }
      return true;
    },
  },

  /* ---------------- THE COMMAND TABLE ---------------- */
  mpTable: {
    init(s) {
      s.tab = s.tab || 0;
      s.boot = 0;            // seconds since the terminal was woken
      s.asked = 0;
      s.beeped = 0;
    },
    tick(s, g, dt) {
      const was = s.boot;
      s.boot = Math.min(BOOT_LEN + 1, s.boot + dt);
      // one clack per line of the start-up log, and a chime when it lands
      const lineNow = Math.floor(s.boot / 0.16);
      if (s.boot < BOOT_LEN && lineNow !== Math.floor(was / 0.16)) g.audio?.sfx('reel');
      if (was < BOOT_LEN && s.boot >= BOOT_LEN) g.audio?.sfx('ping');
    },
    draw(x, W, H, s, g, t) {
      const d = g.bunkerReadout ? g.bunkerReadout() : null;
      if (!d) return [];
      const TABS = ['PLOT', 'VITALS', 'LEDGER', 'LOG'];

      /* Ask the host for the ledger the moment the table is open, and keep
         it fresh. The request is answered privately; nobody upstairs learns
         that anybody looked. */
      if (!s.asked || t - s.asked > 3) { s.asked = t; g.requestLedger?.(); }

      /* ---- the terminal waking up ----
         Thirty years on standby and it still runs its self-test. It is a
         second and a bit of theatre, and it is the difference between a
         menu and a machine. */
      if (s.boot < BOOT_LEN) {
        x.fillStyle = '#02100b'; x.fillRect(0, 0, W, H);
        const k = s.boot / BOOT_LEN;

        // the tube striking: a hairline that opens out into the picture
        if (k < 0.18) {
          const o = k / 0.18;
          const hh = Math.max(1, Math.round(o * o * H));
          x.fillStyle = `rgba(150,255,215,${(0.5 + o * 0.5).toFixed(2)})`;
          x.fillRect(0, Math.round((H - hh) / 2), W, hh);
          return [];
        }

        // the log, one line at a time
        const LOG = [
          'SCHWAB TECHNOLOGY LTD',
          'FIELD TERMINAL  MK IV',
          '',
          'CORE ............ OK',
          'AERIAL MAST ..... OK',
          'PLOT TABLE ...... OK',
          'VITALS LOOP ..... OK',
          'LEDGER LINK ..... OK',
          'ARCHIVE ......... DEGRADED',
          '',
          'WARMING PHOSPHOR',
        ];
        const shown = Math.min(LOG.length, Math.floor((s.boot - 0.2) / 0.16));
        for (let i = 0; i < shown; i++) {
          const ln = LOG[i];
          if (!ln) continue;
          const bad = ln.includes('DEGRADED');
          drawText(x, ln, {
            x: 16, y: 16 + i * 10, scale: 1,
            color: bad ? '#ff6a5a' : (i < 2 ? '#c8ffe8' : '#6fe0b8'),
          });
        }
        // a cursor on the line still arriving
        if (shown < LOG.length && Math.floor(s.boot * 8) % 2 === 0) {
          x.fillStyle = '#c8ffe8';
          x.fillRect(16, 16 + shown * 10, 5, 7);
        }
        // and a bar that fills as it goes
        const bw = W - 32;
        x.fillStyle = '#0d3227'; x.fillRect(16, H - 26, bw, 6);
        x.fillStyle = '#6fe0b8';
        x.fillRect(16, H - 26, Math.round(bw * Math.min(1, k * 1.05)), 6);
        drawText(x, `${Math.min(100, Math.round(k * 105))}%`, {
          x: W - 16, y: H - 38, scale: 1, align: 'right', color: '#2f7a60',
        });
        // the picture rolling into sync
        const roll = Math.round((1 - k) * 40);
        for (let i = 0; i < 3; i++) {
          x.fillStyle = 'rgba(150,255,215,.05)';
          x.fillRect(0, ((s.boot * 260 + i * 90) % (H + roll)) - roll, W, 2 + roll / 8);
        }
        for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }
        return [];
      }

      // and a beat of settling after it lands
      const settle = Math.min(1, (s.boot - BOOT_LEN) * 4);

      /* A screen from a room nobody has been in for thirty years: phosphor
         green, a scanline crawl, and a bloom that never quite settles. */
      x.fillStyle = '#03100c'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#03100c', '#061a14', 0.5, 2);
      const crawl = ((t * 24) % (H + 40)) - 20;
      for (let i = 0; i < 18; i++) {
        const yy = Math.round(crawl + i);
        if (yy < 0 || yy >= H) continue;
        x.fillStyle = `rgba(90,240,190,${(0.030 * (1 - i / 18)).toFixed(3)})`;
        x.fillRect(0, yy, W, 1);
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      const GRN = '#6fe0b8', GRN_D = '#2f7a60', GRN_L = '#c8ffe8';
      const RED = '#ff6a5a', AMB = '#ffd24a';
      x.fillStyle = GRN_D;
      x.fillRect(6, 6, W - 12, 1); x.fillRect(6, H - 7, W - 12, 1);
      x.fillRect(6, 6, 1, H - 13); x.fillRect(W - 7, 6, 1, H - 13);

      /* ---- the header, with the sponsor nobody asked for ---- */
      if (settle < 1) {
        // one last horizontal roll as the picture locks
        x.fillStyle = `rgba(150,255,215,${(0.16 * (1 - settle)).toFixed(3)})`;
        x.fillRect(0, Math.round((1 - settle) * H), W, 3);
      }
      drawText(x, 'LISTENING POST', { x: 14, y: 11, scale: 2, color: GRN });
      drawText(x, 'SCHWAB TECHNOLOGY', { x: 14, y: 25, scale: 1, color: GRN_D });
      drawText(x, d.bunker || '', { x: W - 14, y: 10, scale: 1, align: 'right', color: GRN_D });
      drawText(x, d.chaff ? 'SIGNAL DEGRADED' : 'SIGNAL NOMINAL', {
        x: W - 14, y: 19, scale: 1, align: 'right',
        color: d.chaff ? (Math.floor(t * 6) % 2 ? RED : '#8a2018') : GRN_D,
      });
      drawText(x, `FLOPPER ${d.flopper}`, {
        x: W - 14, y: 28, scale: 1, align: 'right', color: GRN_D,
      });

      /* ---- tabs ---- */
      let tx = 14;
      const TOP = 40;
      TABS.forEach((name, i) => {
        const wd = textWidth(name, 1) + 12;
        const on = s.tab === i;
        if (on) { x.fillStyle = '#0d3227'; x.fillRect(tx, TOP - 3, wd, 12); }
        x.fillStyle = on ? GRN : GRN_D;
        x.fillRect(tx, TOP + 8, wd, 1);
        drawText(x, name, { x: tx + 6, y: TOP, scale: 1, color: on ? GRN_L : GRN_D });
        tx += wd + 4;
      });
      x.fillStyle = GRN_D; x.fillRect(14, TOP + 8, W - 28, 1);

      const BODY_T = TOP + 16, BODY_B = H - 44;

      /* =====================================================
         PLOT — the island, everybody on it, and where the last
         sabotage came from.
         ===================================================== */
      if (s.tab === 0) {
        const PW = W - 28, PH = BODY_B - BODY_T;
        const px0 = 14, py0 = BODY_T;
        x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(px0, py0, PW, PH);

        const cx = px0 + PW / 2, cy = py0 + PH / 2;
        const R = Math.min(PW, PH) / 2 - 4;
        const K = R / 205;                       // world units -> screen

        /* The half the sabotage came from, washed red and pulsing. Drawn
           under everything else so the pips still read on top of it. */
        if (d.half) {
          const pulse = 0.10 + Math.abs(Math.sin(t * 2.6)) * 0.14;
          x.fillStyle = `rgba(200,40,30,${pulse.toFixed(3)})`;
          if (d.half === 'EAST') x.fillRect(cx, py0, px0 + PW - cx, PH);
          else if (d.half === 'WEST') x.fillRect(px0, py0, cx - px0, PH);
          else if (d.half === 'SOUTH') x.fillRect(px0, cy, PW, py0 + PH - cy);
          else x.fillRect(px0, py0, PW, cy - py0);
          // a hatched edge along the dividing line
          x.fillStyle = `rgba(255,90,70,${(0.4 + pulse).toFixed(2)})`;
          if (d.half === 'EAST' || d.half === 'WEST') {
            for (let yy = py0; yy < py0 + PH; yy += 3) x.fillRect(cx - 1, yy, 2, 2);
          } else {
            for (let xx = px0; xx < px0 + PW; xx += 3) x.fillRect(xx, cy - 1, 2, 2);
          }
        }

        // the coastline: a lumpy ring, not a circle
        x.strokeStyle = 'rgba(47,122,96,.85)'; x.lineWidth = 1;
        x.beginPath();
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          const rr = R * (0.90 + Math.sin(a * 3 + 0.7) * 0.045 + Math.sin(a * 5 - 1.2) * 0.03);
          const qx = cx + Math.cos(a) * rr, qy = cy + Math.sin(a) * rr;
          if (i === 0) x.moveTo(qx, qy); else x.lineTo(qx, qy);
        }
        x.closePath(); x.stroke();
        // the interior, one shade up from the sea
        x.fillStyle = 'rgba(20,70,54,.5)'; x.fill();
        // the ridge, as a couple of contours
        x.strokeStyle = 'rgba(47,122,96,.45)';
        for (const rr of [R * 0.52, R * 0.3]) {
          x.beginPath();
          for (let i = 0; i <= 30; i++) {
            const a = (i / 30) * Math.PI * 2;
            const q = rr * (1 + Math.sin(a * 4 + 2) * 0.12);
            const qx = cx - R * 0.12 + Math.cos(a) * q, qy = cy - R * 0.16 + Math.sin(a) * q;
            if (i === 0) x.moveTo(qx, qy); else x.lineTo(qx, qy);
          }
          x.closePath(); x.stroke();
        }
        /* Compass letters in the corners rather than on the axes. On the
           axes the S sat exactly where the CAMP label lands. */
        drawText(x, 'N', { x: px0 + 4, y: py0 + 3, scale: 1, color: GRN_D });
        drawText(x, 'E', { x: px0 + PW - 9, y: py0 + 3, scale: 1, color: GRN_D });
        drawText(x, 'W', { x: px0 + 4, y: py0 + PH - 10, scale: 1, color: GRN_D });
        drawText(x, 'S', { x: px0 + PW - 9, y: py0 + PH - 10, scale: 1, color: GRN_D });

        // the sweep
        const a0 = t * 1.1;
        for (let i = 0; i < 22; i++) {
          const a = a0 - i * 0.045;
          x.strokeStyle = `rgba(111,224,184,${(0.26 * (1 - i / 22)).toFixed(3)})`;
          x.beginPath(); x.moveTo(cx, cy);
          x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          x.stroke();
        }

        /* The places worth knowing. Labels are placed by hand against
           each other: two names printed on the same eight pixels is not a
           map, it is a smear. */
        const taken = [];
        const freeRow = (lx, ly, lw) => {
          for (let tries = 0; tries < 6; tries++) {
            const clash = taken.some((r) => Math.abs(r.y - ly) < 9 && lx < r.x + r.w && r.x < lx + lw);
            if (!clash) break;
            ly += 9;
          }
          taken.push({ x: lx, y: ly, w: lw });
          return ly;
        };
        for (const m of (d.marks || [])) {
          const mx = Math.round(cx + m.x * K), my = Math.round(cy + m.z * K);
          x.fillStyle = m.kind === 'post' ? AMB : 'rgba(120,190,165,.75)';
          if (m.kind === 'post') {
            const pulse = Math.floor(t * 3) % 2 === 0;
            x.fillStyle = pulse ? '#ffe9a8' : AMB;
            x.fillRect(mx - 3, my - 3, 7, 1); x.fillRect(mx - 3, my + 3, 7, 1);
            x.fillRect(mx - 3, my - 3, 1, 7); x.fillRect(mx + 3, my - 3, 1, 7);
          } else {
            x.fillRect(mx - 1, my - 1, 3, 3);
          }
          if (!m.label) continue;
          const lw = textWidth(m.label, 1);
          const lx = Math.round(Math.min(px0 + PW - lw - 3, Math.max(px0 + 3, mx - lw / 2)));
          const ly = freeRow(lx, my + 5, lw);
          // a dark bed, so a name over the coastline is still readable
          x.fillStyle = 'rgba(3,16,12,.78)';
          x.fillRect(lx - 1, ly - 1, lw + 2, 9);
          drawText(x, m.label, {
            x: lx, y: ly, scale: 1,
            color: m.kind === 'post' ? AMB : 'rgba(120,190,165,.95)', shadow: false,
          });
        }

        // and everybody on it
        for (const p of d.roster) {
          const qx = Math.round(cx + p.x * K), qy = Math.round(cy + p.z * K);
          const hex = '#' + (p.colour >>> 0).toString(16).padStart(6, '0');
          if (p.alive) {
            // a soft return that breathes, so live pips read as live
            const br = 2 + (Math.sin(t * 3 + qx) > 0 ? 1 : 0);
            x.fillStyle = hex;
            x.fillRect(qx - br, qy - br, br * 2 + 1, br * 2 + 1);
            x.fillStyle = GRN_L;
            x.fillRect(qx - 1, qy - 1, 3, 3);
          } else {
            x.fillStyle = '#8a2018';
            x.fillRect(qx - 3, qy, 7, 1);
            x.fillRect(qx, qy - 3, 1, 7);
          }
          if (p.me) {
            x.strokeStyle = GRN_L; x.lineWidth = 1;
            x.strokeRect(qx - 4.5, qy - 4.5, 9, 9);
          }
        }

        if (d.half) {
          // on its own bar, so it never lands on top of a place name
          const msg2 = `LAST SABOTAGE ORIGINATED ${d.half}`;
          const mw = textWidth(msg2, 1) + 10;
          x.fillStyle = 'rgba(4,14,10,.92)';
          x.fillRect(Math.round(cx - mw / 2), py0 + PH - 12, mw, 11);
          x.fillStyle = 'rgba(200,60,45,.6)';
          x.fillRect(Math.round(cx - mw / 2), py0 + PH - 12, mw, 1);
          drawText(x, msg2, {
            x: cx, y: py0 + PH - 10, scale: 1, align: 'center',
            color: Math.floor(t * 4) % 2 ? RED : '#a83a2a',
          });
        }
      }

      /* =====================================================
         VITALS — who is breathing, with a trace each.
         ===================================================== */
      if (s.tab === 1) {
        let y = BODY_T + 4;
        const COLW = (W - 32) / 2;
        d.roster.forEach((p, i) => {
          const col = i % 2, row = (i / 2) | 0;
          const ox = 14 + col * (COLW + 4);
          const oy = y + row * 16;
          const hex = '#' + (p.colour >>> 0).toString(16).padStart(6, '0');
          x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(ox, oy - 2, COLW, 14);
          x.fillStyle = p.alive ? hex : '#2a3a34';
          x.fillRect(ox + 2, oy + 1, 7, 7);
          let nm = p.name;
          while (nm.length > 1 && textWidth(nm, 1) > COLW - 52) nm = nm.slice(0, -1);
          drawText(x, nm, { x: ox + 13, y: oy + 1, scale: 1, color: p.alive ? GRN_L : '#3f5a52' });
          const bx = ox + COLW - 34;
          x.fillStyle = p.alive ? GRN : '#3f5a52';
          if (p.alive) {
            const ph = (t * 2.2 + p.name.length) % 1;
            for (let k = 0; k < 30; k++) {
              const u = k / 30;
              let hgt = 0;
              const dd = Math.abs(u - ph);
              if (dd < 0.05) hgt = 4; else if (dd < 0.10) hgt = 2;
              if (hgt) x.fillRect(bx + k, oy + 4 - hgt, 1, hgt * 2);
              else x.fillRect(bx + k, oy + 4, 1, 1);
            }
          } else {
            x.fillRect(bx, oy + 4, 30, 1);
          }
        });
        const rows = Math.ceil(d.roster.length / 2);
        drawText(x, `${d.alive} OF ${d.total} BREATHING`, {
          x: 14, y: y + rows * 16 + 6, scale: 1, color: GRN,
        });
      }

      /* =====================================================
         LEDGER — what everybody is carrying. The single most
         dangerous thing in the room: a Castaway with a fortune
         has been working, and an Agent with one has not.
         ===================================================== */
      if (s.tab === 2) {
        let y = BODY_T + 4;
        if (!d.ledger) {
          drawText(x, 'QUERYING . . .', { x: 14, y, scale: 1, color: GRN_D });
        } else {
          drawText(x, 'NAME', { x: 20, y, scale: 1, color: GRN_D });
          drawText(x, 'SYNCOIN', { x: W - 60, y, scale: 1, color: GRN_D });
          drawText(x, 'BAR', { x: W - 130, y, scale: 1, color: GRN_D });
          y += 11;
          const sorted = [...d.roster].sort((a2, b2) => (b2.coins || 0) - (a2.coins || 0));
          const top = Math.max(1, sorted[0]?.coins || 1);
          for (const p of sorted) {
            if (y > BODY_B - 8) break;
            const hex = '#' + (p.colour >>> 0).toString(16).padStart(6, '0');
            x.fillStyle = p.alive ? hex : '#2a3a34';
            x.fillRect(14, y, 5, 7);
            let nm = p.name + (p.me ? ' (YOU)' : '');
            while (nm.length > 1 && textWidth(nm, 1) > 96) nm = nm.slice(0, -1);
            drawText(x, nm, { x: 22, y, scale: 1, color: p.alive ? GRN_L : '#3f5a52' });
            // a bar, because a column of numbers is not a picture
            const bw = Math.round(((p.coins || 0) / top) * 64);
            x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(W - 130, y + 1, 64, 5);
            x.fillStyle = p.alive ? GRN : '#3f5a52';
            x.fillRect(W - 130, y + 1, bw, 5);
            drawText(x, p.coins == null ? '--' : String(p.coins), {
              x: W - 20, y, scale: 1, align: 'right',
              color: d.chaff ? RED : (p.alive ? AMB : '#5a6a62'),
            });
            y += 10;
          }
          if (d.chaff) {
            drawText(x, 'FIGURES UNRELIABLE - CHAFF IN THE AIR', {
              x: 14, y: y + 3, scale: 1, color: RED,
            });
          }
        }
      }

      /* =====================================================
         LOG — what the island has done, and which way it came.
         ===================================================== */
      if (s.tab === 3) {
        let y = BODY_T + 4;
        drawText(x, 'INCIDENT LOG', { x: 14, y, scale: 1, color: GRN_D }); y += 12;
        const log = d.log || [];
        if (!log.length) {
          drawText(x, 'NOTHING RECORDED THIS ROUND.', { x: 14, y, scale: 1, color: '#3f5a52' });
        }
        for (const e of log) {
          if (y > BODY_B - 8) break;
          x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(14, y - 2, W - 28, 12);
          x.fillStyle = RED; x.fillRect(14, y - 2, 2, 12);
          drawText(x, e.name || 'SABOTAGE', { x: 22, y, scale: 1, color: GRN_L });
          drawText(x, e.half ? `FROM THE ${e.half}` : 'ORIGIN UNKNOWN', {
            x: W - 20, y, scale: 1, align: 'right', color: e.half ? AMB : '#3f5a52',
          });
          y += 14;
        }
        y += 4;
        drawText(x, 'THE POST TRIANGULATES A HALF, NOT A NAME.', {
          x: 14, y, scale: 1, color: '#3f5a52',
        });
      }

      /* the strip along the bottom */
      const cell = (label, val, ox, colour) => {
        drawText(x, label, { x: ox, y: H - 38, scale: 1, color: GRN_D });
        drawText(x, val, { x: ox, y: H - 28, scale: 1, color: colour || GRN_L });
      };
      cell('WORK', d.work, 14);
      cell('WEATHER', d.weather, 76, d.weather === 'CLEAR' ? GRN_L : AMB);
      cell("FERDI'S", d.shop, 148, d.shop === 'TRADING' ? GRN_L : RED);
      cell('ISLAND', d.sabotage || 'NOMINAL', 214, d.sabotage ? RED : GRN_L);

      footer(x, W, H, 'LEFT/RIGHT  CHANGE PAGE      ESC  STEP BACK');
      return [];
    },
    key(code, s, g, st) {
      if (code === 'ArrowRight' || code === 'KeyD' || code === 'Tab') {
        s.tab = (s.tab + 1) % 4; g.audio?.sfx('terminal'); return true;
      }
      if (code === 'ArrowLeft' || code === 'KeyA') {
        s.tab = (s.tab + 3) % 4; g.audio?.sfx('terminal'); return true;
      }
      if (code === 'Escape' || code === 'Backspace' || code === 'KeyE') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
  },

  /* ===========================================================
     ONE OF FERDI'S MACHINES

     Not a shop. You put six Syncoin in the slot, the drum turns, and it
     gives you whichever of his leftovers it feels like. It has one thing
     in it and once you have taken it, it has nothing.
     =========================================================== */
  mpVend: {
    init(s) {
      s.phase = 'idle';       // idle | turning | out | empty
      s.t0 = 0;
      s.got = null;
      s.reel = 0;
    },
    draw(x, W, H, s, g, t) {
      const COST = 6;
      const coins = g.coins || 0;
      const pool = VENDOR_IDS.map((id) => STOCK.find((i) => i.id === id)).filter(Boolean);

      x.fillStyle = '#08120f'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#08120f', '#0e1c18', 0.5, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* the cabinet, seen straight on */
      const CW = 150, CH = 168;
      const cx0 = Math.round((W - CW) / 2), cy0 = 26;
      x.fillStyle = '#1c4034'; x.fillRect(cx0 - 3, cy0 - 3, CW + 6, CH + 6);
      x.fillStyle = '#2a5a4a'; x.fillRect(cx0, cy0, CW, CH);
      x.fillStyle = '#c39a2c';
      x.fillRect(cx0 - 3, cy0 - 3, CW + 6, 3); x.fillRect(cx0 - 3, cy0 + CH, CW + 6, 3);

      // the header
      x.fillStyle = '#8a2018'; x.fillRect(cx0 + 6, cy0 + 5, CW - 12, 16);
      drawText(x, 'FERDI STEINMAN', {
        x: W / 2, y: cy0 + 9, scale: 1, align: 'center', color: '#ffd24a',
      });

      /* the window, and the drum turning behind it */
      const GX = cx0 + 12, GY = cy0 + 27, GW = CW - 24, GH = 92;
      x.fillStyle = '#071410'; x.fillRect(GX - 2, GY - 2, GW + 4, GH + 4);
      x.fillStyle = '#12302a'; x.fillRect(GX, GY, GW, GH);
      // the lit interior
      for (let i = 5; i >= 0; i--) {
        x.fillStyle = `rgba(159,232,216,${(0.020 + i * 0.004).toFixed(3)})`;
        x.fillRect(GX + i * 3, GY + i * 3, GW - i * 6, GH - i * 6);
      }

      if (s.phase === 'turning' || s.phase === 'idle') {
        /* Three of his leftovers going past on the coil. Spinning while it
           decides, still while it waits for your coin. */
        const spin = s.phase === 'turning';
        const off = spin ? (s.t - s.t0) * 260 : 0;
        for (let k = -1; k <= 2; k++) {
          const it = pool[(((s.reel + k) % pool.length) + pool.length) % pool.length];
          const iy = GY + GH / 2 - 16 + k * 34 - (off % 34);
          if (iy < GY - 20 || iy > GY + GH) continue;
          x.save();
          x.beginPath(); x.rect(GX, GY, GW, GH); x.clip();
          drawShopIcon(x, it.icon, GX + GW / 2 - 14, iy, 28, !spin, t);
          if (!spin) {
            drawText(x, it.name, {
              x: GX + GW / 2, y: iy + 31, scale: 1, align: 'center', color: '#8fd8c0',
            });
          }
          x.restore();
        }
        if (spin) {
          // a blur of motion across the glass
          for (let i = 0; i < 5; i++) {
            x.fillStyle = 'rgba(159,232,216,.07)';
            x.fillRect(GX, GY + ((off * 1.7 + i * 21) % GH), GW, 2);
          }
        }
      } else if (s.got) {
        // what you got, sitting in the tray with a light on it
        const puls = 0.6 + Math.abs(Math.sin(t * 4)) * 0.4;
        for (let i = 7; i >= 0; i--) {
          x.fillStyle = `rgba(255,210,74,${(0.03 * puls).toFixed(3)})`;
          x.beginPath(); x.arc(GX + GW / 2, GY + GH / 2, 10 + i * 6, 0, 6.283); x.fill();
        }
        drawShopIcon(x, s.got.icon, GX + GW / 2 - 18, GY + GH / 2 - 24, 36, true, t);
        drawText(x, s.got.name, {
          x: GX + GW / 2, y: GY + GH / 2 + 16, scale: 1, align: 'center', color: GOLD_LT,
        });
        drawText(x, s.got.tag, {
          x: GX + GW / 2, y: GY + GH / 2 + 26, scale: 1, align: 'center', color: '#8a7a52',
        });
      } else {
        drawText(x, 'EMPTY', {
          x: GX + GW / 2, y: GY + GH / 2 - 4, scale: 2, align: 'center', color: '#3f5a52',
        });
      }

      /* the slot and the knob */
      const KY = cy0 + CH - 34;
      x.fillStyle = '#3a3a42'; x.fillRect(cx0 + CW - 44, KY, 34, 26);
      x.fillStyle = '#e8eef2'; x.fillRect(cx0 + CW - 38, KY + 5, 16, 3);
      const knobA = s.phase === 'turning' ? (s.t - s.t0) * 9 : 0;
      const kx = cx0 + CW - 27, ky = KY + 17;
      x.fillStyle = '#c39a2c';
      x.fillRect(kx - 6, ky - 6, 12, 12);
      x.fillStyle = '#24242a';
      x.fillRect(Math.round(kx + Math.cos(knobA) * 4) - 1, Math.round(ky + Math.sin(knobA) * 4) - 1, 3, 3);

      // the hopper
      x.fillStyle = '#14141a'; x.fillRect(cx0 + 12, cy0 + CH - 32, 78, 22);
      x.fillStyle = '#8a9096'; x.fillRect(cx0 + 12, cy0 + CH - 34, 78, 2);
      if (s.phase === 'out' && s.got) {
        const bob = Math.round(Math.sin(t * 5) * 1);
        drawShopIcon(x, s.got.icon, cx0 + 42, cy0 + CH - 28 + bob, 14, true, t);
      }

      /* the strip along the top and the prompt along the bottom */
      drawText(x, `PURSE ${coins}`, {
        x: 14, y: 12, scale: 1, color: coins >= COST ? GOLD : RED,
      });
      drawText(x, `${COST} SYNCOIN A PULL`, {
        x: W - 14, y: 12, scale: 1, align: 'right', color: '#8fd8c0',
      });

      let msg, mcol;
      if (s.phase === 'turning') { msg = 'THINKING ABOUT IT'; mcol = '#8fd8c0'; }
      else if (s.phase === 'out') { msg = 'TAKE IT'; mcol = GOLD_LT; }
      else if (s.phase === 'empty') { msg = 'NOTHING LEFT IN IT'; mcol = '#7a6a52'; }
      else if (coins < COST) { msg = 'NOT ENOUGH SYNCOIN'; mcol = RED; }
      else { msg = 'PUT SIX IN'; mcol = GOLD_LT; }
      drawText(x, msg, {
        x: W / 2, y: cy0 + CH + 8, scale: 2, align: 'center', color: mcol,
      });

      footer(x, W, H, s.phase === 'turning' ? ''
        : (s.phase === 'out' ? 'E  TAKE IT' : 'E  PAY      ESC  WALK AWAY'));
      return [];
    },
    tick(s, g, dt) {
      if (s.phase === 'turning') {
        // keep the drum index moving so the icons cycle
        s.reel = (s.reel + (dt > 0 ? 1 : 0)) % 64;
        if (s.t - s.t0 > 1.5) {
          s.phase = 'out';
          g.audio?.sfx('coin');
          g.vendDeliver?.(s.got);
        }
      }
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (code !== 'KeyE' && code !== 'Enter' && code !== 'Space') return true;
      if (s.phase === 'turning') return true;
      if (s.phase === 'out') { st.pop(); g.afterOverlayClose(); return true; }
      if (s.phase === 'empty') { g.audio?.sfx('deny'); return true; }
      const out = g.vendPay?.(s.vendor);
      if (!out) { g.audio?.sfx('deny'); return true; }
      s.got = out;
      s.phase = 'turning';
      s.t0 = s.t;
      g.audio?.sfx('lever');
      return true;
    },
  },

  /* ===========================================================
     THE LUCKY FLOPPER — a slot machine you can actually read.

     The cabinet on the deck turns its drums, but from standing height
     you could never see what landed. This is the machine's face: three
     windows, six symbols, a paytable and an arm.
     =========================================================== */
  mpSlot: {
    init(s) {
      s.phase = 'idle';     // idle | spin | land | paid
      s.drag = 0;
      s.dragging = false;
      s.pulled = false;
      s.t0 = 0;
      s.reels = [0, 0, 0];
      s.result = null;
      s.win = 0;
      s.arm = 0;
      s.flash = 0;
    },
    draw(x, W, H, s, g, t) {
      const SYM = ['COCONUT', 'ANCHOR', 'SKULL', 'IDOL', 'FISH', 'SEVEN'];
      const COL = ['#a8843c', '#9aa6b0', '#e8e2d2', '#ffd24a', '#5aa0c0', '#e0453a'];
      const coins = g.coins || 0;

      /* the cabinet */
      x.fillStyle = '#1a0a08'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#1a0a08', '#2a0f0c', 0.5, 2);
      const CW = 188, CH = 158;
      const cx0 = Math.round((W - CW) / 2), cy0 = 26;
      // body
      x.fillStyle = '#8a2018'; x.fillRect(cx0, cy0, CW, CH);
      x.fillStyle = '#6a1410'; x.fillRect(cx0 + 3, cy0 + 3, CW - 6, CH - 6);
      x.fillStyle = '#c39a2c';
      x.fillRect(cx0, cy0, CW, 3); x.fillRect(cx0, cy0 + CH - 3, CW, 3);
      x.fillRect(cx0, cy0, 3, CH); x.fillRect(cx0 + CW - 3, cy0, 3, CH);

      // the crown, with lamps that chase
      drawText(x, 'THE LUCKY FLOPPER', {
        x: W / 2, y: cy0 + 8, scale: 1, align: 'center', color: '#ffd24a',
      });
      for (let i = 0; i < 14; i++) {
        const lit = ((i + Math.floor(t * (s.phase === 'paid' ? 14 : 5))) % 3) === 0;
        x.fillStyle = lit ? '#fff3c4' : '#5a2018';
        x.fillRect(cx0 + 8 + i * 12, cy0 + 18, 4, 3);
      }

      /* --- the three windows --- */
      const RW = 46, RH = 52, RY = cy0 + 26;
      const gap = 6;
      const totalW = RW * 3 + gap * 2;
      const rx0 = Math.round(cx0 + (CW - totalW) / 2);
      for (let i = 0; i < 3; i++) {
        const wx = rx0 + i * (RW + gap);
        x.fillStyle = '#0a0604'; x.fillRect(wx - 2, RY - 2, RW + 4, RH + 4);
        x.fillStyle = '#e6dcc0'; x.fillRect(wx, RY, RW, RH);

        /* Spinning: the strip is scrolling, so three neighbouring symbols
           are drawn at an offset. Landed: one symbol, centred, still. */
        const spinning = s.phase === 'spin' && s.t - s.t0 < 0.55 + i * 0.45;
        const idx = s.reels[i];
        const off = spinning ? ((t * (17 - i * 3)) % 1) : 0;
        for (let k = -1; k <= 1; k++) {
          const sym = SYM[(((idx + k) % 6) + 6) % 6];
          const sy = RY + RH / 2 + k * RH - off * RH;
          if (sy < RY - 12 || sy > RY + RH + 12) continue;
          x.save();
          x.beginPath(); x.rect(wx, RY, RW, RH); x.clip();
          // the symbol's colour block, then its name under it
          const c = COL[(((idx + k) % 6) + 6) % 6];
          x.fillStyle = c;
          const bw = 22, bh = 14;
          x.fillRect(Math.round(wx + RW / 2 - bw / 2), Math.round(sy - 12), bw, bh);
          x.fillStyle = 'rgba(0,0,0,.28)';
          x.fillRect(Math.round(wx + RW / 2 - bw / 2), Math.round(sy - 12 + bh - 3), bw, 3);
          drawText(x, sym, {
            x: wx + RW / 2, y: Math.round(sy + 5), scale: 1, align: 'center',
            color: '#2a1a10', shadow: false,
          });
          x.restore();
        }
        // the pay line across the middle
        x.fillStyle = s.phase === 'paid' && s.win > 0
          ? (Math.floor(t * 10) % 2 ? '#ffd24a' : '#8a2018') : 'rgba(140,40,30,.55)';
        x.fillRect(wx, RY + RH / 2 - 1, RW, 1);
      }

      /* --- the arm: a handle you actually pull --- */
      {
        const ax = cx0 + CW + 8;
        const TOP = cy0 + 38, THROW = 46;          // how far it travels
        const k = Math.max(s.arm || 0, s.drag || 0);
        const kn = Math.round(TOP + k * THROW);
        // the slot the arm runs in
        x.fillStyle = '#2a1a14'; x.fillRect(ax - 1, TOP - 4, 6, THROW + 22);
        // the shaft
        x.fillStyle = '#b0b6bc'; x.fillRect(ax, kn + 8, 4, cy0 + CH - 14 - kn);
        // the ball on top
        const grabbed = s.dragging;
        x.fillStyle = grabbed ? '#ff5a44' : '#c02a1a';
        x.fillRect(ax - 5, kn, 14, 12);
        x.fillStyle = grabbed ? '#ff9a88' : '#e06a58';
        x.fillRect(ax - 5, kn, 14, 3);
        x.fillStyle = '#7a1810'; x.fillRect(ax - 5, kn + 10, 14, 2);
        s.armBox = { x: ax - 9, y: TOP - 6, w: 22, h: THROW + 24, top: TOP, throwLen: THROW };
        // tell people it is draggable, until they have done it once
        if (s.phase === 'idle' && !s.pulled) {
          const puls = Math.floor(t * 3) % 2 === 0;
          drawText(x, 'PULL', {
            x: ax + 2, y: cy0 + CH + 4, scale: 1, align: 'center',
            color: puls ? '#ffd24a' : '#8a7a52',
          });
        }
      }

      /* --- the paytable --- */
      const py0 = RY + RH + 8;
      const PAY_H = 46;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(cx0 + 8, py0, CW - 16, PAY_H);
      x.fillStyle = 'rgba(195,154,44,.5)'; x.fillRect(cx0 + 8, py0, CW - 16, 1);
      const pay = [
        ['3 SEVEN', '120'], ['3 IDOL', '60'], ['ANY 3 ALIKE', '30'], ['ANY 2 ALIKE', '2'],
      ];
      /* One column with the figures hard right. Two columns did not fit:
         "ANY 3 ALIKE" ran under its own payout. */
      pay.forEach((row, i) => {
        const ry = py0 + 4 + i * 10;
        drawText(x, row[0], { x: cx0 + 14, y: ry, scale: 1, color: '#c9b98a' });
        // a dotted leader, so the eye gets from the name to the number
        const lx0 = cx0 + 16 + textWidth(row[0], 1);
        const lx1 = cx0 + CW - 16 - textWidth(row[1], 1) - 4;
        x.fillStyle = 'rgba(195,154,44,.30)';
        for (let dx = lx0; dx < lx1; dx += 4) x.fillRect(dx, ry + 5, 2, 1);
        drawText(x, row[1], {
          x: cx0 + CW - 14, y: ry, scale: 1, align: 'right', color: '#ffd24a',
        });
      });

      /* --- purse and stake --- */
      drawText(x, `PURSE ${coins}`, { x: 14, y: 12, scale: 1, color: coins >= 3 ? '#ffd24a' : '#e0453a' });
      drawText(x, 'STAKE 3', { x: W - 14, y: 12, scale: 1, align: 'right', color: '#c9b98a' });

      /* --- the result line --- */
      let msg = coins >= 3 ? 'PULL THE ARM' : 'TIM DOES NOT EXTEND CREDIT';
      let mcol = coins >= 3 ? '#c9b98a' : '#e0453a';
      if (s.phase === 'spin') { msg = 'ROUND SHE GOES'; mcol = '#c9b98a'; }
      if (s.phase === 'paid') {
        if (s.win > 0) {
          msg = `${s.win} SYNCOIN`;
          mcol = Math.floor(t * 8) % 2 ? '#fff3c4' : '#ffd24a';
        } else { msg = 'NOTHING'; mcol = '#8a7a52'; }
      }
      drawText(x, msg, { x: W / 2, y: cy0 + CH + 6, scale: 2, align: 'center', color: mcol });

      footer(x, W, H, s.phase === 'spin' ? '' : 'DRAG THE ARM  OR  E      ESC  WALK AWAY');
      return [];
    },
    /**
     * The arm. Grab the ball, drag it down, and it goes when you have
     * pulled it far enough — released early it springs back and nothing
     * happens, which is the whole pleasure of the thing.
     */
    pointer(kind, cx, cy, s, g, st) {
      const box = s.armBox;
      if (!box) return false;
      if (kind === 'down') {
        if (s.phase === 'spin') return true;
        if (cx < box.x || cx > box.x + box.w || cy < box.y || cy > box.y + box.h) return false;
        s.dragging = true;
        s.dragFrom = cy;
        s.drag = 0;
        return true;
      }
      if (!s.dragging) return false;
      if (kind === 'move') {
        s.drag = Math.max(0, Math.min(1, (cy - s.dragFrom) / box.throwLen));
        return true;
      }
      // released
      s.dragging = false;
      const far = s.drag >= 0.75;
      s.drag = 0;
      if (far) { s.pulled = true; SCREENS.mpSlot._pull(s, g); }
      else g.audio?.sfx('select');
      return true;
    },

    /** Shared by the arm and the key. */
    _pull(s, g) {
      if (s.phase === 'spin') return;
      const out = g.pullSlot?.(s.slot);
      if (!out) { g.audio?.sfx('deny'); return; }
      s.phase = 'spin';
      s.t0 = s.t;
      s.result = out.result;
      s.win = out.win;
      s.arm = 1;
      s.pulled = true;
    },

    tick(s, g, dt, t) {
      if (s.arm > 0) s.arm = Math.max(0, s.arm - dt * 3);
      if (s.phase === 'spin' && s.t - s.t0 > 1.9) {
        s.phase = 'paid';
        s.reels = s.result.slice();
        // the coins land exactly when the last drum does
        g.settleSlot?.(s.slot, s.win);
        if (s.win > 0) g.audio?.sfx(s.win >= 60 ? 'jackpot' : 'coin');
        else g.audio?.sfx('deny');
      }
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
        SCREENS.mpSlot._pull(s, g);
        return true;
      }
      return true;
    },
  },

  /* ===========================================================
     TIM GRADY FLOPPER — the portrait, up close.
     =========================================================== */
  mpFlopper: {
    init(s) { s.scroll = s.scroll || 0; },
    draw(x, W, H, s, g, t) {
      x.fillStyle = '#160a06'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#160a06', '#241009', 0.5, 2);

      // the gilt frame
      const FW = 108, FH = 108;
      const fx = 18, fy = 30;
      x.fillStyle = '#c39a2c'; x.fillRect(fx - 6, fy - 6, FW + 12, FH + 12);
      x.fillStyle = '#8a6a1c'; x.fillRect(fx - 3, fy - 3, FW + 6, FH + 6);

      /* The man himself, painted here rather than sampled off the model —
         the same lumps, at a size you can actually look at. */
      x.fillStyle = '#d8d4cc'; x.fillRect(fx, fy, FW, FH);
      const cxp = fx + FW / 2, cyp = fy + FH / 2;
      x.fillStyle = '#b8b2a6';
      x.beginPath(); x.arc(cxp, cyp + 3, 46, 0, 6.29); x.fill();
      x.fillStyle = '#4a3320';
      x.beginPath(); x.arc(cxp, cyp + 3, 41, 0, 6.29); x.fill();
      const lump = (lx, ly, rx, ry, rot, base) => {
        x.save(); x.translate(cxp + lx, cyp + ly); x.rotate(rot);
        x.fillStyle = base;
        x.beginPath(); x.ellipse(0, 0, rx, ry, 0, 0, 6.29); x.fill();
        x.fillStyle = 'rgba(150,116,74,.55)';
        x.beginPath(); x.ellipse(-rx * 0.22, -ry * 0.3, rx * 0.55, ry * 0.42, 0, 0, 6.29); x.fill();
        x.fillStyle = 'rgba(30,18,8,.45)';
        x.beginPath(); x.ellipse(rx * 0.3, ry * 0.35, rx * 0.42, ry * 0.3, 0, 0, 6.29); x.fill();
        x.restore();
      };
      lump(-13, -13, 25, 12, -0.5, '#5b3f24');
      lump(14, -6, 24, 12, 0.7, '#6a4a2b');
      lump(-3, 11, 29, 14, 0.15, '#553a21');
      lump(10, -22, 19, 10, -0.2, '#63452a');
      lump(-20, 11, 19, 10, 0.9, '#4d351d');
      lump(2, -2, 20, 10, -1.1, '#6f4d2e');
      x.fillStyle = 'rgba(220,190,140,.20)';
      x.beginPath(); x.ellipse(cxp - 20, cyp + 25, 15, 5, -0.3, 0, 6.29); x.fill();
      // a picture light that never quite settles
      const glare = 0.06 + Math.abs(Math.sin(t * 1.6)) * 0.05;
      x.fillStyle = `rgba(255,220,150,${glare.toFixed(3)})`;
      x.fillRect(fx, fy, FW, 34);

      // the plaque
      x.fillStyle = '#4a3410'; x.fillRect(fx - 6, fy + FH + 10, FW + 12, 16);
      x.fillStyle = '#c39a2c'; x.fillRect(fx - 6, fy + FH + 10, FW + 12, 1);
      drawText(x, 'T. GRADY FLOPPER', {
        x: fx + FW / 2, y: fy + FH + 15, scale: 1, align: 'center', color: '#ffd88a',
      });

      /* the copy, to the right */
      const TX = fx + FW + 22, TW = W - TX - 16;
      drawText(x, 'THE PROPRIETOR', { x: TX, y: 22, scale: 2, color: '#ffd24a' });
      x.fillStyle = '#8a6a1c'; x.fillRect(TX, 38, TW, 1);

      const body = [
        'TIM GRADY FLOPPER CAME ASHORE WITH A CRATE OF '
        + 'FRUIT MACHINES AND NO EXPLANATION FOR EITHER.',
        'HE HAS NEVER BEEN SEEN ON THIS DECK. THE PORTRAIT '
        + 'IS CONSIDERED SUFFICIENT.',
        'HOUSE RULES: THREE SYNCOIN A PULL. THE HOUSE PAYS '
        + 'IN COIN. THE HOUSE DOES NOT PAY IN ADVICE.',
      ];
      let y = 46;
      for (const para of body) {
        for (const line of wrapText(para, TW, 1)) {
          drawText(x, line, { x: TX, y, scale: 1, color: '#c9b98a' });
          y += 9;
        }
        y += 5;
      }
      x.fillStyle = '#8a6a1c'; x.fillRect(TX, y, TW, 1); y += 6;
      drawText(x, 'NO CREDIT.  NO REFUNDS.', { x: TX, y, scale: 1, color: '#e0453a' });
      y += 11;
      drawText(x, 'SHE WORKS NIGHTS ONLY.', { x: TX, y, scale: 1, color: '#63c6a8' });

      footer(x, W, H, 'ESC  STEP BACK');
      return [];
    },
    key(code, s, g, st) {
      if (code === 'Escape' || code === 'Backspace' || code === 'KeyE') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
  },

  /* ---------------- THE SNAP VOTE ---------------- */
  mpSnap: {
    init(s) { s.sel = 0; },
    draw(x, W, H, s, g, t) {
      const snap = g.mp.snap;
      if (!snap) return [];
      const left = Math.max(0, snap.endsAt - performance.now() / 1000);
      const who = g.mp.view.players.get(snap.victimId);
      const by = g.mp.view.players.get(snap.byId);

      /* Deliberately not the council. This is a handful of people standing
         over somebody in the sand, deciding on the spot. */
      x.fillStyle = '#140803'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#140803', '#20100a', 0.5, 2);
      // the flare still burning
      const flick = 0.7 + Math.sin(t * 17) * 0.3;
      for (let i = 7; i >= 0; i--) {
        x.fillStyle = `rgba(255,150,60,${(0.035 * flick).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H * 0.62, 22 + i * 15, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      drawText(x, 'A FLARE WENT UP', { x: W / 2, y: 14, scale: 2, align: 'center', color: '#ffb060' });
      drawText(x, `${(by?.name || '?').toUpperCase()} PUT ${(who?.name || '?').toUpperCase()} ON THE SAND`, {
        x: W / 2, y: 32, scale: 1, align: 'center', color: GOLD_LT,
      });
      drawText(x, `${snap.voters.length} OF YOU SAW IT. ${snap.need} DECIDE.`, {
        x: W / 2, y: 44, scale: 1, align: 'center', color: DIM,
      });

      // the clock
      const bw = W - 80, bx = 40;
      x.fillStyle = INK; x.fillRect(bx - 1, 55, bw + 2, 5);
      x.fillStyle = '#20100c'; x.fillRect(bx, 56, bw, 3);
      const n = Math.round((left / 12) * bw);
      for (let i = 0; i < n; i += 3) {
        x.fillStyle = left < 4 ? (Math.floor(t * 6) % 2 ? '#ff6a5a' : '#8a2018') : '#ffb060';
        x.fillRect(bx + i, 56, 2, 3);
      }

      // the person on the floor, with their stars
      const cx = W / 2, cy = H * 0.62;
      x.fillStyle = '#0b0f14';
      x.fillRect(cx - 16, cy, 32, 7);
      x.fillRect(cx + 15, cy - 5, 8, 8);
      for (let i = 0; i < 5; i++) {
        const a = t * 3 + (i / 5) * Math.PI * 2;
        const sx = Math.round(cx + 19 + Math.cos(a) * 11);
        const sy = Math.round(cy - 12 + Math.sin(a) * 4);
        x.fillStyle = i % 2 ? '#ffd24a' : '#ffffff';
        x.fillRect(sx - 2, sy, 5, 1);
        x.fillRect(sx, sy - 2, 1, 5);
      }

      const rows = [];
      const btn = (label, colour, ox, mine) => {
        const w = 76, bxx = ox - w / 2, byy = H - 48;
        x.fillStyle = mine ? colour : '#1a1208';
        x.fillRect(bxx, byy, w, 18);
        x.fillStyle = colour;
        x.fillRect(bxx, byy, w, 1); x.fillRect(bxx, byy + 17, w, 1);
        x.fillRect(bxx, byy, 1, 18); x.fillRect(bxx + w - 1, byy, 1, 18);
        drawText(x, label, { x: ox, y: byy + 6, scale: 1, align: 'center',
          color: mine ? '#160c04' : colour });
        rows.push({ x: bxx, y: byy, w, h: 18 });
      };
      if (snap.mine === null) {
        btn('Y  THROW OUT', RED, W / 2 - 41, false);
        btn('N  LET THEM UP', JADE, W / 2 + 41, false);
      } else {
        btn('THREW THEM OUT', RED, W / 2 - 41, snap.mine === true);
        btn('LET THEM UP', JADE, W / 2 + 41, snap.mine === false);
      }

      drawText(x, `${snap.yes} OUT   -   ${snap.no} STAY`, {
        x: W / 2, y: H - 27, scale: 1, align: 'center', color: GOLD_LT,
      });
      footer(x, W, H, snap.mine === null ? 'Y OR N' : 'WAITING ON THE REST');
      return rows;
    },
    key(code, s, g) {
      const snap = g.mp.snap;
      if (!snap || snap.mine !== null) return true;
      if (code === 'KeyY') { g.sendSnap(true); return true; }
      if (code === 'KeyN') { g.sendSnap(false); return true; }
      return true;
    },
    click(row, i, s, g) {
      const snap = g.mp.snap;
      if (!snap || snap.mine !== null) return true;
      g.sendSnap(i === 0);
      return true;
    },
  },

  /* ---------------- FERDI'S, AND THE ROOM BEHIND IT ---------------- */
  mpShop: {
    init(s) {
      /* Defaults, not resets. init() runs after the pushed data has been
         merged in, so assigning unconditionally threw away whatever the
         caller asked for — pushing this screen straight to the back room
         landed you on the front counter every time. */
      s.sel = s.sel || 0;
      s.side = s.side || 0;
      s.flash = 0;
    },
    draw(x, W, H, s, g, t) {
      const agent = g.amAgent;
      const black = agent && s.side === 1 && !s.vendor;
      /* One of Ferdi's machines in the trees is not Ferdi's shop. It holds
         whatever did not sell, it has no back room, and once it has taken
         your coin it is empty for the rest of the round. */
      const isNight = (g.night || 0) > 0.5;
      const list = s.vendor
        ? STOCK.filter((i) => VENDOR_IDS.includes(i.id) && (!i.night || isNight))
        : shelf(black ? 'black' : 'open', isNight);
      if (s.sel >= list.length) s.sel = 0;
      const d = list[s.sel];
      if (s.flash > 0) s.flash -= 0.016;

      /* Two rooms, and they do not look alike. The front is lamplight on
         old timber; the back is a shuttered lock-up lit by one bulb. */
      if (black) {
        /* ---- THE BACK ROOM ----
           A shuttered lock-up behind the shop: one bulb on a flex that has
           never stopped swinging, a roller shutter half down, hazard paint
           on the threshold and a stencil on the wall telling you what did
           not happen here. It should feel like somewhere you are not
           supposed to be standing. */
        x.fillStyle = '#080506'; x.fillRect(0, 0, W, H);
        ditherRect(x, 0, 0, W, H, '#080506', '#160b0d', 0.5, 2);

        // breeze-block courses on the back wall
        for (let ry = 0; ry < H; ry += 11) {
          const off = ((ry / 11) | 0) % 2 ? 13 : 0;
          x.fillStyle = 'rgba(180,120,110,.035)';
          x.fillRect(0, ry, W, 10);
          x.fillStyle = 'rgba(0,0,0,.30)';
          x.fillRect(0, ry + 10, W, 1);
          for (let rx = off; rx < W; rx += 26) x.fillRect(rx, ry, 1, 10);
        }

        /* The roller shutter, most of the way down, stopped just above
           where the header sits. Chrome never goes where type goes. */
        const drop = 8;
        for (let sy = 0; sy < drop; sy += 3) {
          x.fillStyle = sy % 6 ? 'rgba(46,34,32,.95)' : 'rgba(70,52,48,.95)';
          x.fillRect(0, sy, W, 3);
        }
        x.fillStyle = '#1a1210'; x.fillRect(0, drop, W, 1);
        for (let hx = 0; hx < W; hx += 10) {
          x.fillStyle = (hx / 10) % 2 ? 'rgba(200,160,42,.75)' : 'rgba(42,26,16,.9)';
          x.fillRect(hx, drop + 1, 10, 2);
        }

        // the bulb hangs down the side of the room, out of the type
        const swing = Math.sin(t * 1.4) * 4;
        const bulbX = 26, bulbY = 62;
        for (let i = 9; i >= 0; i--) {
          x.fillStyle = `rgba(170,50,36,${(0.026 + i * 0.001).toFixed(3)})`;
          x.beginPath(); x.arc(bulbX + swing, bulbY, 20 + i * 15, 0, Math.PI * 2); x.fill();
        }
        x.fillStyle = '#2a1c12';
        x.fillRect(Math.round(bulbX + swing / 2), drop + 3, 1, bulbY - drop - 7);
        x.fillStyle = '#4a3420';
        x.fillRect(Math.round(bulbX + swing) - 3, bulbY - 4, 7, 3);
        const glow = 0.75 + Math.sin(t * 11) * 0.12 + (Math.sin(t * 47) > 0.94 ? -0.4 : 0);
        x.fillStyle = `rgba(255,216,138,${glow.toFixed(2)})`;
        x.fillRect(Math.round(bulbX + swing) - 2, bulbY - 1, 5, 5);

        // a chain hanging in one corner, because the room needs weight
        for (let cy2 = drop + 6; cy2 < H - 46; cy2 += 5) {
          x.fillStyle = 'rgba(120,110,104,.45)';
          x.fillRect(W - 16 + (((cy2 / 5) | 0) % 2), cy2, 3, 4);
        }

        // and the light dies at the edges
        for (let i = 0; i < 22; i++) {
          const a = (0.055 * (1 - i / 22)).toFixed(3);
          x.fillStyle = `rgba(0,0,0,${a})`;
          x.fillRect(i, 0, 1, H); x.fillRect(W - 1 - i, 0, 1, H);
          x.fillRect(0, H - 1 - i, W, 1);
        }
      } else {
        x.fillStyle = '#120c06'; x.fillRect(0, 0, W, H);
        ditherRect(x, 0, 0, W, H, '#120c06', '#1c1208', 0.5, 2);
        // planking behind the counter
        for (let i = 0; i < H; i += 7) {
          x.fillStyle = 'rgba(90,64,28,.10)'; x.fillRect(0, i, W, 1);
        }
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* The man himself, leaning on the end of his own counter. A shop with
         nobody in it is a menu; a shop with a shopkeeper watching you pick
         things up is a shop. */
      if (!s.vendor) drawFerdi(x, W - 34, H - 74, black, t);

      const accent = black ? RED : GOLD;
      x.fillStyle = accent;
      x.fillRect(6, 6, W - 12, 1); x.fillRect(6, H - 7, W - 12, 1);
      x.fillRect(6, 6, 1, H - 13); x.fillRect(W - 7, 6, 1, H - 13);

      drawText(x, s.vendor ? "FERDI'S MACHINE" : (black ? 'THE BACK ROOM' : "FERDI STEINMAN'S"), {
        x: 14, y: 11, scale: 2, color: accent,
      });
      if (black) {
        // painted on the block work, well below the list
        drawText(x, 'NOTHING WAS SOLD HERE', {
          x: 14, y: H - 66, scale: 1, color: 'rgba(160,66,54,.55)', shadow: false,
        });
        drawText(x, 'NO NAMES.  NO NOTES.', {
          x: 14, y: H - 56, scale: 1, color: 'rgba(160,66,54,.40)', shadow: false,
        });
        drawText(x, 'HE IS NOT HERE.', {
          x: 14, y: H - 42, scale: 1, color: 'rgba(200,120,110,.55)', shadow: false,
        });
      }
      if (s.vendor) {
        drawText(x, 'WHATEVER DID NOT SELL', { x: 14, y: 26, scale: 1, color: '#8a7a52' });
      }
      drawText(x, `${g.coins || 0} SYNCOIN`, {
        x: W - 14, y: 10, scale: 1, align: 'right', color: GOLD_LT,
      });
      if (agent && !s.vendor) {
        drawText(x, black ? 'TAB  BACK TO THE SHOP' : 'TAB  THE OTHER LIST', {
          x: W - 14, y: 21, scale: 1, align: 'right', color: black ? '#c08078' : '#8a5a52',
        });
      }
      x.fillStyle = black ? '#5a1a14' : '#5c3f1c';
      x.fillRect(14, 28, W - 28, 1);

      /* the stock list */
      const LX = 10, LW = 138, ROW = 15;
      let y = 36;
      const rows = [];
      list.forEach((it, i) => {
        const on = i === s.sel;
        /* Only permanent things read as HELD. A consumable you are carrying
           can be bought again, and showing HELD next to a button that says
           BUY FOR 13 just made the list look broken. */
        const held = it.tag === 'PASSIVE' && g.hasItem?.(it.id);
        const carrying = it.tag !== 'PASSIVE' && g.hasItem?.(it.id);
        const owned = held;
        const afford = (g.coins || 0) >= it.cost;
        if (on) {
          x.fillStyle = black ? '#3a0e0b' : '#3a2a10';
          x.fillRect(LX, y - 1, LW, ROW - 1);
          x.fillStyle = accent; x.fillRect(LX, y - 1, 2, ROW - 1);
        }
        drawShopIcon(x, it.icon, LX + 5, y, 12, on, t);
        /* Trim against the width of the label that is actually going to sit
           on the right. "HELD" is wider than a two-digit price, and the
           names used to run straight into it. */
        /* A dot means "you have one already"; a count only appears when it
           is worth knowing. "x1 13" next to every line was noise. */
        const n = (g.carry || []).filter((q) => q === it.id).length;
        const right = held ? 'HELD'
          : (n > 1 ? `x${n}  ${it.cost}` : (n === 1 ? `. ${it.cost}` : String(it.cost)));
        const room = LW - 26 - textWidth(right, 1) - 6;
        let nm = it.name;
        while (nm.length > 3 && textWidth(nm, 1) > room) nm = nm.slice(0, -1);
        if (nm !== it.name) nm = nm.slice(0, -1) + '.';
        drawText(x, nm, {
          x: LX + 21, y: y + 1, scale: 1,
          color: owned ? '#5f7a4a' : (on ? GOLD_LT : (afford ? '#c9b98a' : '#7a6a52')),
        });
        drawText(x, right, {
          x: LX + LW - 4, y: y + 1, scale: 1, align: 'right',
          color: held ? JADE : (carrying ? '#8fd8b8' : (afford ? GOLD : '#8a4a44')),
        });
        rows.push({ x: LX, y: y - 1, w: LW, h: ROW - 1, pick: i });
        y += ROW;
      });

      /* what it is, and what it does */
      const RX = LX + LW + 8;
      // a strip on the right for the shopkeeper, so he is not half off the edge
      const MAN = s.vendor ? 0 : 34;
      const RW = W - RX - 12 - MAN;
      const RB = H - 30;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(RX, 36, RW, RB - 36);
      x.fillStyle = black ? '#5a1a14' : '#5c3f1c';
      x.fillRect(RX, 36, RW, 1); x.fillRect(RX, RB - 1, RW, 1);
      x.fillRect(RX, 36, 1, RB - 36); x.fillRect(RX + RW - 1, 36, 1, RB - 36);

      if (d) {
        /* The thing itself, stood on the counter with a light on it and a
           price tag tied round it — not an icon floating in a box. */
        const ICX = RX + RW / 2;
        // the pool of lamplight it stands in
        for (let i = 6; i >= 0; i--) {
          x.fillStyle = black ? `rgba(180,60,44,.03)` : `rgba(255,200,110,.035)`;
          x.beginPath(); x.arc(ICX, 58, 12 + i * 6, 0, 6.283); x.fill();
        }
        drawShopIcon(x, d.icon, ICX - 16, 40, 32, true, t);
        // the counter it stands on
        x.fillStyle = black ? '#2a1a16' : '#4a3418';
        x.fillRect(RX + 8, 73, RW - 16, 3);
        x.fillStyle = 'rgba(0,0,0,.45)';
        x.fillRect(ICX - 15, 71, 30, 2);

        // a tag, hand-lettered, tilted
        {
          const tagW = textWidth(String(d.cost), 1) + 16;
          const tx0 = ICX + 18, ty0 = 52;
          x.fillStyle = '#3a2a12'; x.fillRect(tx0 - 1, ty0 - 1, tagW + 2, 13);
          x.fillStyle = '#d8c69a'; x.fillRect(tx0, ty0, tagW, 11);
          x.fillStyle = '#3a2a12'; x.fillRect(tx0 + 2, ty0 + 4, 3, 3);
          drawText(x, String(d.cost), {
            x: tx0 + 8, y: ty0 + 2, scale: 1, color: '#2a1c08', shadow: false,
          });
        }

        let by = 80;
        for (const ln of wrapText(d.name, RW - 10, 1, 1)) {
          drawText(x, ln, { x: ICX, y: by, scale: 1, align: 'center', color: GOLD_LT });
          by += 9;
        }
        // tag line, plus a badge if it is only out after dark
        drawText(x, d.tag, {
          x: ICX, y: by, scale: 1, align: 'center',
          color: black ? '#c08078' : '#8a7a52',
        });
        by += 11;
        if (d.night) {
          const nw = textWidth('AFTER DARK ONLY', 1) + 12;
          x.fillStyle = 'rgba(30,44,78,.85)';
          x.fillRect(ICX - nw / 2, by - 2, nw, 11);
          x.fillStyle = '#6fa8e0'; x.fillRect(ICX - nw / 2, by - 2, nw, 1);
          // a little moon
          x.fillStyle = '#cfe4ff';
          x.fillRect(ICX - nw / 2 + 3, by + 1, 4, 4);
          x.fillStyle = 'rgba(30,44,78,.95)';
          x.fillRect(ICX - nw / 2 + 5, by, 4, 4);
          drawText(x, 'AFTER DARK ONLY', {
            x: ICX + 5, y: by, scale: 1, align: 'center', color: '#9fc8ff',
          });
          by += 13;
        }
        x.fillStyle = black ? '#5a1a14' : '#5c3f1c';
        x.fillRect(RX + 8, by - 3, RW - 16, 1);
        by += 3;
        for (const ln of wrapText(d.blurb.toUpperCase(), RW - 12, 1, 1)) {
          if (by > RB - 26) break;
          drawText(x, ln, { x: RX + 6, y: by, scale: 1, color: '#c9b98a' });
          by += 9;
        }
      }

      // the counter itself: price and the buy key
      const owned = d && g.hasItem?.(d.id);
      const afford = d && (g.coins || 0) >= d.cost;
      const label = owned && d.tag === 'PASSIVE' ? 'ALREADY YOURS'
        : (afford ? `E   BUY FOR ${d ? d.cost : 0}` : 'NOT ENOUGH SYNCOIN');
      const bw = RW - 12, bx = RX + 6, byy = RB - 16;
      x.fillStyle = s.flash > 0 ? accent : (afford && !owned ? (black ? '#3a0e0b' : '#3a2a10') : '#1a1208');
      x.fillRect(bx, byy, bw, 12);
      x.fillStyle = afford && !owned ? accent : '#5a4a30';
      x.fillRect(bx, byy, bw, 1); x.fillRect(bx, byy + 11, bw, 1);
      x.fillRect(bx, byy, 1, 12); x.fillRect(bx + bw - 1, byy, 1, 12);
      drawText(x, label, {
        x: bx + bw / 2, y: byy + 3, scale: 1, align: 'center',
        color: s.flash > 0 ? '#160c04' : (afford && !owned ? GOLD_LT : '#7a6a4a'),
      });
      rows.push({ x: bx, y: byy, w: bw, h: 12, buy: true });

      footer(x, W, H, 'UP DOWN CHOOSE   E BUY   ESC LEAVE');
      return rows;
    },
    key(code, s, g, st) {
      const agent = g.amAgent;
      const black = agent && s.side === 1 && !s.vendor;
      const isNight = (g.night || 0) > 0.5;
      const list = s.vendor
        ? STOCK.filter((i) => VENDOR_IDS.includes(i.id) && (!i.night || isNight))
        : shelf(black ? 'black' : 'open', isNight);
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + list.length - 1) % list.length; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % list.length; g.audio?.sfx('select'); return true; }
      if (code === 'Tab' && agent && !s.vendor) { s.side = 1 - s.side; s.sel = 0; g.audio?.sfx('page'); return true; }
      if (code === 'Escape' || code === 'Backspace') { st.pop(); g.afterOverlayClose(); return true; }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        if (list[s.sel] && g.buyItem(list[s.sel].id)) {
          s.flash = 0.3;
          /* A machine in the trees holds one thing. Once it has taken your
             coin it is a box, and whoever comes next gets nothing — which
             is what makes finding one first worth something. */
          if (s.vendor && typeof s.vendor === 'object') {
            s.vendor.spent = true;
            st.pop();
            g.afterOverlayClose();
            g.ui?.toast('THE MACHINE IS EMPTY NOW', 'gold', 2400);
          }
        }
        return true;
      }
      return true;
    },
    click(row, i, s, g, st) {
      if (row?.buy) { this.key('Enter', s, g, st); return true; }
      if (row?.pick !== undefined) {
        if (row.pick === s.sel) this.key('Enter', s, g, st);
        else { s.sel = row.pick; g.audio?.sfx('select'); }
      }
      return true;
    },
  },

  /* ---------------- A CHORE THAT IS ACTUALLY A TASK ---------------- */
  mpMinigame: {
    init(s, g) {
      const G = MINIGAMES[s.game];
      s.rng = mulberryLocal((s.seed || 1) * 2654435761);
      s.done = false;
      s.doneT = 0;
      G?.init?.(s, s.rng);
    },
    draw(x, W, H, s, g, t) {
      const G = MINIGAMES[s.game];
      const dt = Math.min(0.05, s.t - (s._last ?? s.t));
      s._last = s.t;

      const b = frame(x, W, H, s.title || G?.name || 'WORK',
        s.hard ? 'STORM DAMAGE - THIS ONE IS WORSE' : null);
      if (!G) { footer(x, W, H, 'ESC'); return []; }

      let rows = [];
      if (!s.done) {
        rows = G.draw.call(G, x, W, H, s, t, dt) || [];
        footer(x, W, H, `${G.hint}   ESC WALK AWAY`);
      } else {
        // it lands, rather than the window simply closing
        s.doneT += dt;
        const k = Math.min(1, s.doneT / 0.45);
        const r = Math.round(6 + k * 90);
        x.strokeStyle = `rgba(126,200,80,${(1 - k).toFixed(2)})`;
        x.lineWidth = 2;
        x.beginPath(); x.arc(W / 2, H / 2, r, 0, Math.PI * 2); x.stroke();
        drawText(x, 'DONE', {
          x: W / 2, y: H / 2 - 10, scale: k < 0.4 ? 3 : 2, align: 'center',
          color: k < 0.4 ? '#ffffff' : JADE,
        });
        footer(x, W, H, '');
      }
      // a strip showing this is one step of possibly several
      if (s.step && s.steps > 1) {
        for (let i = 0; i < s.steps; i++) {
          const mx = W - 22 - (s.steps - 1 - i) * 10;
          x.fillStyle = i < s.step ? JADE : '#3a2a10';
          x.fillRect(mx, 13, 7, 4);
        }
      }
      return rows;
    },
    key(code, s, g, st) {
      if (s.done) return true;
      if (code === 'Escape') { st.pop(); g.afterOverlayClose(); g.cancelMinigame?.(); return true; }
      const G = MINIGAMES[s.game];
      if (G?.key && G.key.call(G, code, s)) this._win(s, g, st);
      return true;
    },
    click(row, i, s, g, st) {
      if (s.done) return true;
      const G = MINIGAMES[s.game];
      if (G?.click && G.click.call(G, row, i, s)) this._win(s, g, st);
      return true;
    },
    _win(s, g, st) {
      s.done = true;
      s.doneT = 0;
      g.audio?.sfx('confirm');
      setTimeout(() => {
        if (st.name === 'mpMinigame') { st.pop(); g.afterOverlayClose(); }
        g.finishMinigame?.(s.taskId);
      }, 620);
    },
  },

  /* ---------------- SABOTAGE CONSOLE ---------------- */
  mpSabotage: {
    init(s) { s.sel = s.sel || 0; s.pull = 0; s.arm = 0; },
    draw(x, W, H, s, g, t) {
      const defs = Object.values(SABOTAGE_DEFS);
      const d = defs[s.sel] || defs[0];
      const cool = g.mp.cool || {};
      const now = performance.now() / 1000;
      const left = (id) => Math.max(0, (cool[id] || 0) - now);
      const sab = g.mp.view.sabotage;
      if (s.pull > 0) s.pull = Math.max(0, s.pull - 0.035);
      const locked = (def) => left(def.id) > 0 || !!sab;

      /* ---- the terminal itself ---- */
      x.fillStyle = '#0c0303'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#0c0303', '#170606', 0.5, 2);
      // a beam sweeping down the tube
      const sweep = ((t * 46) % (H + 70)) - 35;
      for (let i = 0; i < 26; i++) {
        const yy = Math.round(sweep + i);
        if (yy < 0 || yy >= H) continue;
        x.fillStyle = `rgba(190,44,32,${(0.055 * (1 - i / 26)).toFixed(3)})`;
        x.fillRect(0, yy, W, 1);
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, y, W, 1); }

      // frame with riveted corners
      x.fillStyle = '#8a2018';
      x.fillRect(6, 6, W - 12, 1); x.fillRect(6, H - 7, W - 12, 1);
      x.fillRect(6, 6, 1, H - 13); x.fillRect(W - 7, 6, 1, H - 13);
      for (const [rx, ry] of [[6, 6], [W - 10, 6], [6, H - 10], [W - 10, H - 10]]) {
        x.fillStyle = RED; x.fillRect(rx, ry, 4, 4);
        x.fillStyle = '#3a0e0b'; x.fillRect(rx + 1, ry + 1, 2, 2);
      }

      drawText(x, 'SABOTAGE', { x: 14, y: 11, scale: 2, color: RED });
      const alive = [...g.mp.view.players.values()].filter((p) => p.alive !== false).length;
      drawText(x, sab ? 'ONE IS ALREADY RUNNING' : 'ISLAND NOMINAL', {
        x: W - 14, y: 10, scale: 1, align: 'right', color: sab ? '#ff6a5a' : '#6a8a5a',
      });
      drawText(x, `${alive} STILL BREATHING`, { x: W - 14, y: 20, scale: 1, align: 'right', color: '#8a5a52' });
      x.fillStyle = '#5a1a14'; x.fillRect(14, 28, W - 28, 1);

      /* ---- left: the rack of switches ---- */
      const LX = 14, LW = 106, ROW = 17;
      let y = 36;
      const rows = [];
      defs.forEach((def, i) => {
        const on = i === s.sel;
        const cd = left(def.id);
        const off = locked(def);
        if (on) {
          x.fillStyle = off ? '#2a1210' : '#4a1410';
          x.fillRect(LX, y - 1, LW, ROW - 2);
          x.fillStyle = off ? '#6a3a34' : RED;
          x.fillRect(LX, y - 1, 2, ROW - 2);
        }
        drawSabotageIcon(x, def.id, LX + 5, y, 13, on && !off, t);
        // short names, because the status column owns the right of the row
        drawText(x, def.short || def.name, { x: LX + 22, y: y + 1, scale: 1,
          color: off ? '#6a4a44' : (on ? '#ffd8ce' : '#a86a60') });
        const tag = cd > 0 ? `${Math.ceil(cd)}` : (def.fatal ? 'FATAL' : 'READY');
        drawText(x, tag, { x: LX + LW - 9, y: y + 1, scale: 1, align: 'right',
          color: cd > 0 ? '#7a5a54' : (def.fatal ? '#ff6a5a' : '#5f8a4a') });
        // a little indicator lamp that blinks when ready
        x.fillStyle = off ? '#3a1a16'
          : (Math.floor(t * 2 + i) % 2 ? '#ff6a5a' : '#8a2018');
        x.fillRect(LX + LW - 6, y + 2, 3, 3);
        rows.push({ x: LX, y: y - 1, w: LW, h: ROW - 2, pick: i });
        y += ROW;
      });

      /* ---- right: what the selected switch does ---- */
      const RX = LX + LW + 8, RW = W - RX - 14;
      const RB = H - 30;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(RX, 36, RW, RB - 36);
      x.fillStyle = locked(d) ? '#4a2a26' : '#8a2018';
      x.fillRect(RX, 36, RW, 1); x.fillRect(RX, RB - 1, RW, 1);
      x.fillRect(RX, 36, 1, RB - 36); x.fillRect(RX + RW - 1, 36, 1, RB - 36);

      // big animated mark
      drawSabotageIcon(x, d.id, RX + RW / 2 - 16, 42, 32, !locked(d), t);
      let by = 80;
      for (const ln of wrapText(d.name, RW - 12, 1, 1)) {
        drawText(x, ln, { x: RX + RW / 2, y: by, scale: 1, align: 'center', color: '#ffd8ce' });
        by += 10;
      }
      x.fillStyle = '#5a1a14'; x.fillRect(RX + 8, by + 1, RW - 16, 1);
      by += 7;
      for (const ln of wrapText(d.blurb.toUpperCase(), RW - 12, 1, 1)) {
        if (by > H - 88) break;
        drawText(x, ln, { x: RX + 6, y: by, scale: 1, color: '#e2b0a4' });
        by += 9;
      }
      if (d.tell && by < H - 54) {
        by += 3;
        for (const ln of wrapText(d.tell.toUpperCase(), RW - 12, 1, 1)) {
          if (by > H - 68) break;
          drawText(x, ln, { x: RX + 6, y: by, scale: 1, color: '#8fb0c8' });
          by += 9;
        }
      }

      /* ---- the strip along the bottom: duration, repair, lever ---- */
      const WHERE = {
        camp: 'THE FIRE', hut: "FERDI'S", wreck: 'THE WRECK',
        pend1: 'W PENDULUM', pend2: 'RIDGE PENDULUM',
        pend3: 'E PENDULUM', pend4: 'N PENDULUM',
      };
      const spots = (d.fixAt || []).map((k) => WHERE[k] || k.toUpperCase());
      const need = d.sites > 1 ? `${d.sites} OF` : 'AT';
      // pinned to the bottom of the panel so the prose above cannot push it out
      let fy = H - 56;
      x.fillStyle = '#5a1a14'; x.fillRect(RX + 8, fy - 4, RW - 16, 1);
      drawText(x, `RUNS ${d.secs}S      COOLS ${d.cooldown}S`,
        { x: RX + 6, y: fy, scale: 1, color: '#7a4a44' });
      fy += 9;
      for (const ln of wrapText(`FIXED ${need} ${spots.join(', ')}`, RW - 12, 1, 1).slice(0, 2)) {
        drawText(x, ln, { x: RX + 6, y: fy, scale: 1, color: '#c08078' });
        fy += 9;
      }

      // the lever, which visibly throws
      const lvx = W - 30, lvy = H - 28;
      x.fillStyle = '#2a0a08'; x.fillRect(lvx - 9, lvy, 18, 22);
      x.fillStyle = '#5a1a14'; x.fillRect(lvx - 9, lvy, 18, 1); x.fillRect(lvx - 9, lvy + 21, 18, 1);
      x.fillStyle = '#8a2018'; x.fillRect(lvx - 1, lvy + 3, 2, 16);
      const knob = Math.round(lvy + 3 + s.pull * 13);
      x.fillStyle = s.pull > 0.15 ? '#ffd8ce' : (locked(d) ? '#5a3a34' : '#c03a2c');
      x.fillRect(lvx - 6, knob, 12, 5);

      footer(x, W, H, locked(d)
        ? 'UP DOWN CHOOSE   Q OR ESC AWAY'
        : 'UP DOWN CHOOSE   E PULL IT   Q OR ESC AWAY');
      return rows;
    },

    key(code, s, g, st) {
      const defs = Object.values(SABOTAGE_DEFS);
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + defs.length - 1) % defs.length; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % defs.length; g.audio?.sfx('select'); return true; }
      if (code === 'Escape' || code === 'Backspace') { st.pop(); g.afterOverlayClose(); return true; }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        const def = defs[s.sel];
        const cd = Math.max(0, ((g.mp.cool || {})[def.id] || 0) - performance.now() / 1000);
        if (cd > 0 || g.mp.view.sabotage) { g.audio?.sfx('deny'); return true; }
        s.pull = 1;
        g.sendSabotage(def.id);
        setTimeout(() => { if (st.name === 'mpSabotage') { st.pop(); g.afterOverlayClose(); } }, 300);
        return true;
      }
      return true;
    },

    click(row, i, s, g, st) {
      if (row && row.pick !== undefined && row.pick !== s.sel) {
        s.sel = row.pick; g.audio?.sfx('select'); return true;
      }
      this.key('Enter', s, g, st);
      return true;
    },
  },

  /* ---------------- BODY FOUND ---------------- */
  mpBodyFound: {
    draw(x, W, H, s, g, t) {
      /* A hard cut to red, a shape on the ground and a name. It runs for a
         couple of seconds before the council, so the meeting starts with
         everyone having seen the same thing. */
      const k = Math.min(1, s.t / 0.14);
      const beat = s.t;

      x.fillStyle = '#120403'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#120403', '#1e0605', 0.5, 2);
      // a pulse of red from the middle
      const pr = 30 + Math.sin(beat * 4) * 8;
      for (let i = 6; i >= 0; i--) {
        x.fillStyle = `rgba(150,20,14,${(0.05 * k).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H / 2 + 8, pr + i * 16, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.36)'; x.fillRect(0, y, W, 1); }

      // the body, in silhouette, in its own mess
      const cx = W / 2, cy = H / 2 + 16;
      x.fillStyle = '#5a0d07';
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const r = 16 + ((i * 7) % 13);
        x.fillRect(Math.round(cx + Math.cos(a) * r) - 2, Math.round(cy + Math.sin(a) * r * 0.4) - 1, 5, 3);
      }
      x.fillStyle = '#7d1109';
      x.fillRect(cx - 26, cy - 5, 52, 11);
      x.fillStyle = '#0b0f14';
      x.fillRect(cx - 18, cy - 4, 30, 8);            // torso
      x.fillRect(cx + 12, cy - 7, 8, 8);             // head
      x.fillRect(cx - 24, cy - 1, 8, 3);             // legs
      x.fillRect(cx - 8, cy + 4, 12, 3);             // an arm thrown out

      // the words, arriving hard
      if (beat > 0.10) {
        const kk = Math.min(1, (beat - 0.10) / 0.16);
        drawText(x, 'BODY FOUND', {
          x: W / 2, y: 40, scale: kk < 0.5 ? 3 : 2, align: 'center',
          color: kk < 0.5 ? '#ffffff' : RED,
        });
      }
      if (beat > 0.45) {
        drawText(x, (s.who || '?').toUpperCase(), {
          x: W / 2, y: 62, scale: 1, align: 'center', color: GOLD_LT,
        });
      }
      if (beat > 0.85) {
        drawText(x, `${(s.by || '?').toUpperCase()} RAISED THE ALARM`, {
          x: W / 2, y: H - 40, scale: 1, align: 'center', color: DIM,
        });
      }
      if (beat > 1.4 && Math.floor(beat * 2) % 2 === 0) {
        drawText(x, 'EVERYONE TO THE FIRE', {
          x: W / 2, y: H - 26, scale: 1, align: 'center', color: '#8a5a52',
        });
      }
      return [];
    },
    key() { return true; },
  },

  /* ---------------- EXILE ---------------- */
  mpExile: {
    init(s, g) { s.beat = -1; },
    draw(x, W, H, s, g, t) {
      /* Five beats. The verdict, the walk, the water closing, a held
         silence, and only then what they actually were. The silence is the
         part that does the work — an instant reveal has no stakes in it. */
      const T = { verdict: 0.0, walk: 1.1, splash: 2.7, hold: 3.3, reveal: 5.0 };
      const at = (k) => s.t >= T[k];
      const since = (k) => s.t - T[k];

      const sea = Math.round(H * 0.62);
      // sky: bruise-dark, lifting a little at the horizon
      for (let yy = 0; yy < sea; yy++) {
        const k = yy / sea;
        const v = Math.round(5 + k * k * 46);
        x.fillStyle = `rgb(${Math.round(v * 0.55)},${Math.round(v * 0.7)},${v})`;
        x.fillRect(0, yy, W, 1);
      }
      ditherRect(x, 0, 0, W, sea, 'rgba(0,0,0,0)', 'rgba(0,0,0,.30)', 0.5, 2);

      // sea
      for (let yy = sea; yy < H; yy++) {
        const k = (yy - sea) / (H - sea);
        const r = Math.round(18 - k * 13), gg = Math.round(42 - k * 32), bl = Math.round(78 - k * 58);
        x.fillStyle = `rgb(${r},${gg},${bl})`;
        x.fillRect(0, yy, W, 1);
      }
      x.fillStyle = '#7fa8c4'; x.fillRect(0, sea, W, 1);
      for (let i = 0; i < 9; i++) {
        const yy = sea + 4 + i * 7;
        if (yy > H - 3) break;
        const off = Math.round(Math.sin(t * 1.1 + i * 1.7) * (10 + i * 3));
        const w = 26 - i * 2;
        x.fillStyle = `rgba(150,190,215,${(0.32 - i * 0.03).toFixed(2)})`;
        x.fillRect((((i * 71 + off) % W) + W) % W, yy, w, 1);
      }

      // the figure, walked to the edge and dropped
      if (s.targetId && at('walk')) {
        const k = Math.min(1, since('walk') / (T.splash - T.walk));
        const fx = Math.round(W * 0.22 + k * W * 0.28);
        const fy = sea - 16 + Math.round(k * 4);
        const drop = at('splash') ? Math.min(1, since('splash') / 0.5) : 0;
        const dy = Math.round(drop * drop * 34);
        if (drop < 1) {
          x.fillStyle = '#0b0f14';
          x.fillRect(fx - 2, fy + dy, 5, 11);          // body
          x.fillRect(fx - 1, fy - 4 + dy, 3, 4);       // head
          const sw = Math.sin(k * 22) * 2;
          x.fillRect(fx - 4 + sw, fy + 3 + dy, 2, 5);  // arms
          x.fillRect(fx + 3 - sw, fy + 3 + dy, 2, 5);
        }
      }
      // the splash, and the rings going out
      if (at('splash')) {
        const k = Math.min(1, since('splash') / 1.4);
        const cx2 = Math.round(W * 0.5), cy2 = sea + 8;
        for (let i = 0; i < 3; i++) {
          const rk = Math.max(0, k - i * 0.16);
          if (rk <= 0 || rk >= 1) continue;
          const rr = Math.round(4 + rk * 40);
          x.fillStyle = `rgba(190,225,240,${(0.5 * (1 - rk)).toFixed(2)})`;
          x.fillRect(cx2 - rr, cy2, rr * 2, 1);
          x.fillRect(cx2 - Math.round(rr * 0.5), cy2 - 1, rr, 1);
        }
      }

      /* ---- the words ---- */
      drawText(x, s.targetId ? 'THE COUNCIL HAS DECIDED' : 'THE COUNCIL COULD NOT AGREE', {
        x: W / 2, y: 22, scale: 1, align: 'center', color: DIM,
      });
      if (!s.targetId) {
        drawText(x, 'NOBODY GOES IN THE WATER', {
          x: W / 2, y: 40, scale: 2, align: 'center', color: GOLD_LT,
        });
      } else {
        drawText(x, (s.who || '?').toUpperCase(), {
          x: W / 2, y: 36, scale: 2, align: 'center', color: GOLD_LT,
        });
        drawText(x, 'THROWN TO THE SEA', {
          x: W / 2, y: 56, scale: 1, align: 'center', color: '#8a7a52',
        });
      }

      // the held silence, then the verdict
      if (s.targetId) {
        if (at('hold') && !at('reveal')) {
          const dots = 1 + (Math.floor((s.t - T.hold) * 2.2) % 3);
          drawText(x, '.'.repeat(dots), {
            x: W / 2, y: 76, scale: 2, align: 'center', color: '#5a4a34',
          });
        }
        if (at('reveal')) {
          const k = Math.min(1, since('reveal') / 0.3);
          const good = s.wasAgent;
          const col = good ? JADE : RED;
          const label = good ? 'THEY WERE A ROGUE AGENT' : 'THEY WERE NOT A ROGUE AGENT';
          // a plate slams down behind the verdict
          const w = Math.min(W - 24, textWidth(label, 1) + 24);
          const hh = Math.round(20 * (0.4 + k * 0.6));
          const bx = Math.round((W - w) / 2), by = Math.round(70 + (20 - hh) / 2);
          x.fillStyle = good ? '#0d2a20' : '#2a0a08';
          x.fillRect(bx, by, w, hh);
          x.fillStyle = col;
          x.fillRect(bx, by, w, 1); x.fillRect(bx, by + hh - 1, w, 1);
          if (k > 0.5) {
            drawText(x, label, { x: W / 2, y: by + 6, scale: 1, align: 'center',
              color: k < 0.7 ? '#ffffff' : col });
          }
          if (s.beat !== 1) { s.beat = 1; g.audio?.sfx(good ? 'victory' : 'deny'); }
        } else if (at('splash') && s.beat !== 0) {
          s.beat = 0; g.audio?.sfx('splat');
        }
      }

      const left = [...g.mp.view.players.values()].filter((p) => p.alive !== false).length;
      drawText(x, `${left} STILL ASHORE`, { x: W / 2, y: sea - 12, scale: 1, align: 'center', color: DIM });
      return [];
    },
    key() { return true; },
  },

  /* ---------------- GAME OVER ---------------- */
  mpEnd: {
    draw(x, W, H, s, g, t) {
      const win = s.winner === 'castaways';
      x.fillStyle = win ? '#04120c' : '#160404';
      x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, win ? '#04120c' : '#160404', win ? '#071c12' : '#200707', 0.5, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, y, W, 1); }

      drawText(x, s.winner ? (win ? 'THE CASTAWAYS' : 'THE ROGUE AGENTS') : 'GAME OVER', {
        x: W / 2, y: 22, scale: 2, align: 'center', color: win ? '#8fe8c8' : '#ff6a5a',
      });
      if (s.winner) drawText(x, 'WIN', { x: W / 2, y: 42, scale: 2, align: 'center', color: GOLD });
      x.fillStyle = win ? '#2f6a5c' : '#8a2018';
      x.fillRect(W / 2 - 80, 62, 160, 1);
      drawText(x, s.reason || '', { x: W / 2, y: 68, scale: 1, align: 'center', color: GOLD_LT });

      /* Everybody's role, revealed. Half the fun of losing is finding out
         how close you were. */
      const agents = new Set(s.agents || []);
      const players = [...g.mp.view.players.values()];
      let y = 86;
      for (const p of players) {
        const wasAgent = agents.has(p.name);
        x.fillStyle = colourOf(p.colour); x.fillRect(W / 2 - 92, y, 7, 7);
        drawText(x, p.name || '?', { x: W / 2 - 80, y, scale: 1, color: GOLD_LT });
        drawText(x, wasAgent ? 'ROGUE AGENT' : 'CASTAWAY', {
          x: W / 2 - 4, y, scale: 1, color: wasAgent ? '#ff6a5a' : '#8fb0c8',
        });
        drawText(x, p.alive === false ? 'LOST' : 'ALIVE', {
          x: W / 2 + 92, y, scale: 1, align: 'right', color: p.alive === false ? '#6a5c40' : JADE,
        });
        y += 10;
      }

      const rows = menuList(x, ['BACK TO THE BEACH'], s.sel, W / 2, H - 34, t, { width: 150 });
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 1, () => location.reload());
    },
  },


  /* ---------------- TITLE ---------------- */
  title: {
    draw(x, W, H, s, g, t) {
      // the idol renders behind; scrim only the left third
      const grad = Math.round(W * 0.52);
      for (let i = 0; i < grad; i++) {
        const a = 0.86 * (1 - i / grad);
        x.fillStyle = `rgba(6,4,2,${a.toFixed(3)})`;
        x.fillRect(i, 0, 1, H);
      }
      x.fillStyle = 'rgba(0,0,0,.30)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

      const L = 14;
      drawText(x, 'THE LEGEND OF', { x: L, y: 30, scale: 1, color: DIM });
      drawText(x, 'ILLIC', { x: L, y: 42, scale: 4, color: GOLD_LT });
      drawText(x, 'ISLE', { x: L, y: 74, scale: 4, color: GOLD });
      // rule
      x.fillStyle = GOLD_DK; x.fillRect(L, 106, 108, 2);
      x.fillStyle = GOLD; x.fillRect(L + 108, 105, 4, 4);
      drawText(x, 'THE IDOL OF ILLIC ISLE', { x: L, y: 114, scale: 1, color: GOLD });

      const rows = menuList(x, ['PLAY', 'CONTROLS', 'OPTIONS', 'THE LEGEND'],
        s.sel, L + 66, 136, t, { width: 132 });
      drawText(x, '(C) 1998 SCHWAB TECHNOLOGY', { x: L, y: H - 22, scale: 1, color: '#6a5c40' });
      if (Math.floor(t * 1.5) % 2 === 0) {
        drawText(x, 'PRESS ENTER', { x: L, y: H - 13, scale: 1, color: GOLD });
      }
      return rows;
    },
    key(code, s, g) {
      return nav(code, s, 4, (i) => {
        if (i === 0) g.screens.replace('mode');
        else if (i === 1) g.screens.push('controls');
        else if (i === 2) g.screens.push('options');
        else g.screens.push('lore');
      });
    },
  },

  /* ---------------- THE LEGEND (lore codex) ---------------- */
  lore: {
    init(s, g) { s.page = 0; },
    draw(x, W, H, s, g, t) {
      const L = LORE_PAGES[s.page];
      const b = frame(x, W, H, 'THE LEGEND', `${s.page + 1} / ${LORE_PAGES.length}`);
      drawText(x, L.title, { x: W / 2, y: b.top + 2, scale: 1, align: 'center', color: GOLD });
      let y = b.top + 16;
      for (const ln of wrapText(L.text, W - 44, 1, 1)) {
        drawText(x, ln, { x: 22, y, scale: 1, color: GOLD_LT });
        y += 9;
      }
      if (L.icon) drawRelicIcon(x, L.icon, W - 52, b.bottom - 44, 32, Math.sin(t * 2) * 0.4);
      footer(x, W, H, '< > TURN PAGE   ESC BACK');
      return [];
    },
    key(code, s, g, st) {
      if (code === 'ArrowLeft' || code === 'KeyA') { s.page = (s.page + LORE_PAGES.length - 1) % LORE_PAGES.length; return true; }
      if (code === 'ArrowRight' || code === 'KeyD' || code === 'Enter' || code === 'KeyE') {
        s.page = (s.page + 1) % LORE_PAGES.length; return true;
      }
      if (code === 'Escape' || code === 'Tab') { st.pop(); return true; }
      return true;
    },
  },

  /* ---------------- CONTROLS ---------------- */
  controls: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'CONTROLS');
      const rows = [
        ['W A S D', 'MOVE'], ['MOUSE', 'LOOK'], ['SHIFT', 'SPRINT'],
        ['SPACE', 'JUMP'], ['E', 'INTERACT'], ['CLICK', 'THROW COCONUT'],
        ['M', 'MAP'], ['TAB', 'JOURNAL'], ['C', 'VIEW'], ['ESC', 'PAUSE'],
      ];
      let y = b.top + 2;
      for (const [k, v] of rows) {
        drawText(x, k, { x: W / 2 - 8, y, scale: 1, align: 'right', color: GOLD });
        drawText(x, v, { x: W / 2 + 8, y, scale: 1, color: GOLD_LT });
        y += 11;
      }
      drawText(x, 'COCONUTS GROW UNDER THE PALMS.', {
        x: W / 2, y: y + 4, scale: 1, align: 'center', color: DIM,
      });
      footer(x, W, H, 'ESC BACK');
      return [];
    },
    key(code, s, g, st) { if (code === 'Escape' || code === 'Enter' || code === 'KeyE') st.pop(); return true; },
  },

  /* ---------------- OPTIONS ---------------- */
  options: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'OPTIONS');
      const O = OPTION_DEFS;
      let y = b.top + 2;
      const rows = [];
      O.forEach((o, i) => {
        const on = i === s.sel;
        if (on) { x.fillStyle = '#3a2a10'; x.fillRect(16, y - 3, W - 32, 12); }
        drawText(x, o.label, { x: 22, y, scale: 1, color: on ? GOLD_LT : DIM });
        const cur = o.get(g);
        const vi = o.values.findIndex((v) => String(v.v) === String(cur));
        const name = vi >= 0 ? o.values[vi].n : '?';
        drawText(x, `< ${name} >`, { x: W - 22, y, scale: 1, align: 'right', color: on ? GOLD : DIM });
        rows.push({ x: 16, y: y - 3, w: W - 32, h: 12 });
        y += 13;
      });
      footer(x, W, H, 'UP DOWN SELECT   < > CHANGE   ESC BACK');
      return rows;
    },
    key(code, s, g, st) {
      const O = OPTION_DEFS;
      if (code === 'ArrowUp' || code === 'KeyW') { s.sel = (s.sel + O.length - 1) % O.length; return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.sel = (s.sel + 1) % O.length; return true; }
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Enter' || code === 'KeyE') {
        const o = O[s.sel];
        const cur = String(o.get(g));
        let vi = o.values.findIndex((v) => String(v.v) === cur);
        if (vi < 0) vi = 0;
        vi = (vi + (code === 'ArrowLeft' ? o.values.length - 1 : 1)) % o.values.length;
        o.set(g, o.values[vi].v);
        g.applySettings();
        g.audio?.sfx('select');
        return true;
      }
      if (code === 'Escape') { st.pop(); return true; }
      return true;
    },
  },

  /* ---------------- PAUSE ---------------- */
  pause: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'PAUSED');
      const rows = menuList(x, ['RESUME', 'JOURNAL', 'MAP', 'CONTROLS', 'OPTIONS', 'QUIT TO TITLE'],
        s.sel, W / 2, b.top + 10, t, { width: 140 });
      const mm = String(Math.floor(g.runTime / 60)).padStart(2, '0');
      const ss = String(Math.floor(g.runTime % 60)).padStart(2, '0');
      drawText(x, `TIME ${mm}:${ss}`, { x: W / 2, y: H - 28, scale: 1, align: 'center', color: DIM });
      footer(x, W, H, 'ESC RESUME');
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 6, (i) => {
        if (i === 0) g.pause(false);
        else if (i === 1) st.push('journal');
        else if (i === 2) g.openChart();
        else if (i === 3) st.push('controls');
        else if (i === 4) st.push('options');
        else g.quitToTitle();
      }, () => g.pause(false));
    },
  },

  /* ---------------- JOURNAL ---------------- */
  journal: {
    init(s, g) { s.entries = g.journalEntries(); s.sel = 0; s.scroll = 0; },
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, "CASTAWAY'S JOURNAL", `${s.sel + 1} / ${s.entries.length}`);
      const e = s.entries[s.sel];
      drawText(x, e.found ? e.title : 'NOT YET FOUND', {
        x: W / 2, y: b.top, scale: 1, align: 'center', color: e.found ? GOLD : '#6a5c40',
      });
      x.fillStyle = '#4a3a1c';
      x.fillRect(20, b.top + 11, W - 40, 1);

      const body = e.found ? e.text : e.hint;
      const lines = [];
      for (const para of String(body).split('\n')) {
        if (!para.trim()) { lines.push(''); continue; }
        lines.push(...wrapText(para, W - 46, 1, 1));
      }
      const visible = Math.floor((b.bottom - b.top - 24) / 9);
      s.scroll = Math.max(0, Math.min(s.scroll, Math.max(0, lines.length - visible)));
      let y = b.top + 17;
      for (let i = s.scroll; i < Math.min(lines.length, s.scroll + visible); i++) {
        drawText(x, lines[i], { x: 23, y, scale: 1, color: e.found ? GOLD_LT : '#7a6a48' });
        y += 9;
      }
      if (lines.length > visible) {
        const barH = Math.max(6, (visible / lines.length) * (b.bottom - b.top - 20));
        const barY = b.top + 17 + (s.scroll / lines.length) * (b.bottom - b.top - 20);
        x.fillStyle = '#3a2a10'; x.fillRect(W - 17, b.top + 16, 3, b.bottom - b.top - 18);
        x.fillStyle = GOLD_DK; x.fillRect(W - 17, barY, 3, barH);
      }
      footer(x, W, H, '< > ENTRY   UP DOWN SCROLL   TAB CLOSE');
      return [];
    },
    key(code, s, g, st) {
      const n = s.entries.length;
      if (code === 'ArrowLeft' || code === 'KeyA') { s.sel = (s.sel + n - 1) % n; s.scroll = 0; return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { s.sel = (s.sel + 1) % n; s.scroll = 0; return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { s.scroll = Math.max(0, s.scroll - 1); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.scroll += 1; return true; }
      if (code === 'Tab' || code === 'Escape') { st.pop(); g.afterOverlayClose(); return true; }
      return true;
    },
  },

  /* ---------------- THE MAP ---------------- */
  chart: {
    draw(x, W, H, s, g, t) {
      /* It unrolls. Two rods part and the paper comes out between them,
         with the roll still visible at each edge until it is fully open —
         a panel that simply grows reads as a dialog box, not a chart
         somebody has been carrying in their shirt. */
      const k = Math.min(1, s.t / 0.40);
      const ease = 1 - Math.pow(1 - k, 3);

      x.fillStyle = `rgba(6,4,2,${(0.86 * Math.min(1, k * 2)).toFixed(3)})`;
      x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

      const m = 10;
      const fullH = H - m * 2;
      const openH = Math.max(2, Math.round(fullH * ease));
      const top = Math.round(m + (fullH - openH) / 2);
      const PW = W - m * 2;

      // the paper
      ditherRect(x, m, top, PW, openH, '#d8c69a', PAPER, 0.5, 1);
      // a soft curl of shadow at each rolled edge
      for (let i = 0; i < 5; i++) {
        const a2 = (0.16 - i * 0.03).toFixed(3);
        x.fillStyle = `rgba(90,64,28,${a2})`;
        x.fillRect(m, top + i, PW, 1);
        x.fillRect(m, top + openH - 1 - i, PW, 1);
      }
      // the rods
      const rod = (ry) => {
        x.fillStyle = '#4a3418'; x.fillRect(m - 3, ry - 2, PW + 6, 5);
        x.fillStyle = '#6b4c22'; x.fillRect(m - 3, ry - 2, PW + 6, 1);
        x.fillStyle = '#2a1c0c'; x.fillRect(m - 5, ry - 3, 3, 7);
        x.fillRect(m + PW + 2, ry - 3, 3, 7);
      };
      rod(top - 1);
      rod(top + openH);

      if (k < 0.82) return [];

      // and the chart itself, once there is room for it
      const alpha = Math.min(1, (k - 0.82) / 0.18);
      x.save();
      x.globalAlpha = alpha;
      const title = s.data?.agentSide ? "MAP  -  ROGUE AGENTS' COPY" : 'MAP OF ILLIC ISLE';
      drawText(x, title, { x: W / 2, y: top + 5, scale: 1, align: 'center', color: '#3f2f14' });
      x.fillStyle = '#8a6a34';
      x.fillRect(m + 10, top + 15, PW - 20, 1);
      const b = { top: top + 21, bottom: top + openH - 12 };
      const size = Math.min(W - 34, b.bottom - b.top - 12);
      const ox = Math.round((W - size) / 2), oy = b.top + 1;

      /* Zoom and pan live on the screen, not the data, so opening the map
         again puts you back where you were looking. Panning is clamped to
         the island so you cannot lose it off the edge. */
      s.zoom = s.zoom || 1;
      if (s.cx === undefined) {
        // first open: centred on you, not on the origin
        s.cx = s.data?.player?.x || 0;
        s.cz = s.data?.player?.z || 0;
      }
      const R = s.data?.radius || 200;
      const reach = R * (1 - 1 / s.zoom);
      s.cx = Math.max(-reach, Math.min(reach, s.cx));
      s.cz = Math.max(-reach, Math.min(reach, s.cz));
      if (s.zoom <= 1) { s.cx = 0; s.cz = 0; }
      s.data.zoom = s.zoom;
      s.data.cx = s.cx;
      s.data.cz = s.cz;
      s.data._size = size;
      drawChart(x, ox, oy, size, s.data, t);
      /* The pendulum tally belongs to the single-player hunt. Castaways
         puts its own marks on this chart — the listening post — and used
         to inherit "ALL FOUR READ" underneath them. */
      /* On the paper, above its bottom rod — printed at b.bottom it landed
         squarely on the key hints underneath. */
      const subY = oy + size + 3;
      if (s.data.marks.length && !s.subtitle) {
        const left = s.data.marks.filter((mk) => !mk.found).length;
        drawText(x, left ? `${left} PENDULUM${left === 1 ? '' : 'S'} STILL UNREAD` : 'ALL FOUR READ',
          { x: W / 2, y: subY, scale: 1, align: 'center', color: left ? '#7a2418' : '#2f6a4a' });
      } else if (s.subtitle) {
        drawText(x, s.subtitle, { x: W / 2, y: subY, scale: 1, align: 'center', color: '#2f6a4a' });
      }
      x.restore();
      footer(x, W, H, s.zoom > 1
        ? '+ -  ZOOM     ARROWS  PAN     C  CENTRE ON YOU     M  CLOSE'
        : '+  ZOOM IN     M OR TAB  CLOSE');
      return [];
    },
    key(code, s, g, st) {
      const R = s.data?.radius || 200;
      const step = () => (R / (s.zoom || 1)) * 0.22;
      if (code === 'Equal' || code === 'NumpadAdd' || code === 'KeyZ') {
        if (s.zoom < 5) {
          // zooming in from the wide view starts on you
          if (s.zoom === 1) { s.cx = s.data?.player?.x || 0; s.cz = s.data?.player?.z || 0; }
          s.zoom = Math.min(5, (s.zoom || 1) + 1);
          g.audio?.sfx('select');
        }
        return true;
      }
      if (code === 'Minus' || code === 'NumpadSubtract' || code === 'KeyX') {
        s.zoom = Math.max(1, (s.zoom || 1) - 1);
        g.audio?.sfx('select');
        return true;
      }
      if (code === 'KeyC') {
        s.cx = s.data?.player?.x || 0; s.cz = s.data?.player?.z || 0;
        g.audio?.sfx('confirm');
        return true;
      }
      if (code === 'ArrowLeft' || code === 'KeyA') { s.cx -= step(); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { s.cx += step(); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { s.cz -= step(); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { s.cz += step(); return true; }
      if (code === 'KeyM' || code === 'Escape' || code === 'Tab' || code === 'KeyF') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
    /** Drag to pan, and the wheel is handled by the game's own listener. */
    pointer(kind, cx, cy, s) {
      if (kind === 'down') { s._drag = [cx, cy]; return true; }
      if (kind === 'move' && s._drag) {
        const R = s.data?.radius || 200;
        const size = Math.min((s.data?._size || 180), 400);
        const perPx = (R / (s.zoom || 1)) / (size / 2);
        s.cx -= (cx - s._drag[0]) * perPx;
        s.cz -= (cy - s._drag[1]) * perPx;
        s._drag = [cx, cy];
        return true;
      }
      if (kind === 'up') { s._drag = null; return true; }
      return false;
    },
  },

  /* ---------------- FERDI'S SHOP ---------------- */
  shop: {
    init(s) { s.sel = s.sel || 0; s.shake = 0; },
    draw(x, W, H, s, g, t) {
      if (s.shake > 0) s.shake -= 0.016;
      const jitter = s.shake > 0 ? Math.round(Math.sin(s.shake * 60) * 2) : 0;
      const b = frame(x, W, H, "FERDI STEINMAN'S SUPPLIES");

      // Ferdi himself, drawn in the corner
      drawFerdiPortrait(x, 16, b.top + 2, t);
      const bubbleX = 58;
      panel(x, bubbleX, b.top + 2, W - bubbleX - 16, 26, { border: 1, dither: 0.35 });
      const quip = FERDI_LINES[Math.floor(t / 4) % FERDI_LINES.length];
      let qy = b.top + 7;
      for (const ln of wrapText(quip, W - bubbleX - 26, 1, 1).slice(0, 2)) {
        drawText(x, ln, { x: bubbleX + 5, y: qy, scale: 1, color: GOLD_LT }); qy += 9;
      }

      // purse
      drawRelicIcon(x, 'coin', W - 44, b.top + 32, 14);
      drawText(x, `${g.coins}`, { x: W - 18, y: b.top + 35, scale: 1, align: 'right', color: GOLD });

      const rows = [];
      let y = b.top + 50;
      g.shopStock().forEach((it, i) => {
        const on = i === s.sel;
        const bx = 16 + (on ? jitter : 0);
        panel(x, bx, y, W - 32, 22, {
          border: 2, dither: on ? 0.6 : 0.35,
          hi: it.owned ? '#2f5a48' : (on ? GOLD : GOLD_DK),
          lo: '#241708',
        });
        drawText(x, it.name, { x: bx + 6, y: y + 4, scale: 1, color: it.owned ? '#7a9a8c' : (on ? GOLD_LT : DIM) });
        drawText(x, it.desc, { x: bx + 6, y: y + 13, scale: 1, color: '#8a7a52' });
        drawText(x, it.owned ? 'SOLD' : `${it.cost}`, {
          x: bx + W - 38, y: y + 8, scale: 1, align: 'right',
          color: it.owned ? JADE : (g.coins >= it.cost ? GOLD : RED),
        });
        if (!it.owned) drawRelicIcon(x, 'coin', bx + W - 34, y + 4, 12);
        rows.push({ x: bx, y, w: W - 32, h: 22 });
        y += 25;
      });
      footer(x, W, H, 'UP DOWN CHOOSE   E BUY   ESC LEAVE');
      return rows;
    },
    key(code, s, g, st) {
      const stock = g.shopStock();
      return nav(code, s, stock.length,
        () => { if (!g.buy(stock[s.sel].id)) s.shake = 0.28; },
        () => { st.pop(); g.afterOverlayClose(); });
    },
  },

  /* ---------------- READER ---------------- */
  reader: {
    init(s) { s.shown = 0; s.done = false; s.scroll = 0; },
    draw(x, W, H, s, g, t) {
      const full = String(s.body);
      s.shown = Math.min(full.length, s.shown + 2);
      s.done = s.shown >= full.length;

      const boxH = Math.min(H - 24, 116);
      const top = H - boxH - 8;
      panel(x, 8, top, W - 16, boxH, { border: 2, dither: 0.30, hi: '#f4e8c4', lo: '#7a5a24', fill: '#d8c79a', fill2: '#e6d6ac' });

      drawText(x, s.head, { x: 15, y: top + 6, scale: 1, color: '#6b4a18', shadowColor: '#e6d6ac' });
      x.fillStyle = '#a8946a'; x.fillRect(14, top + 16, W - 28, 1);

      const shownText = full.slice(0, s.shown);
      const lines = [];
      for (const para of shownText.split('\n')) {
        if (!para.trim()) { lines.push(''); continue; }
        lines.push(...wrapText(para, W - 34, 1, 1));
      }
      const visible = Math.floor((boxH - 34) / 9);
      const start = Math.max(0, lines.length - visible);
      let y = top + 22;
      for (let i = start; i < lines.length; i++) {
        drawText(x, lines[i], { x: 16, y, scale: 1, color: INK, shadow: false });
        y += 9;
      }
      if (s.done && Math.floor(t * 2) % 2 === 0) {
        drawText(x, 'E', { x: W - 18, y: top + boxH - 11, scale: 1, color: '#6b4a18', shadow: false });
      }
      return [];
    },
    key(code, s, g, st) {
      if (code === 'KeyE' || code === 'Enter' || code === 'Space') {
        if (!s.done) { s.shown = String(s.body).length; s.done = true; return true; }
        st.pop();
        s.onDone?.();
        g.afterOverlayClose();
        return true;
      }
      return true;
    },
  },

  /* ---------------- DIAL PUZZLE ---------------- */
  dials: {
    draw(x, W, H, s, g, t) {
      const b = frame(x, W, H, 'THE SEALED DOOR');
      if (s.shake > 0) s.shake -= 0.016;
      const jit = s.shake > 0 ? Math.round(Math.sin(s.shake * 70) * 3) : 0;

      drawText(x, 'RECORDED FROM THE PENDULUMS', { x: W / 2, y: b.top, scale: 1, align: 'center', color: DIM });
      drawText(x, g.knownGlyphHint(), { x: W / 2, y: b.top + 11, scale: 1, align: 'center', color: JADE });

      const GW = 36, GAP = 8;
      const total = 4 * GW + 3 * GAP;
      const left = Math.round((W - total) / 2) + jit;
      const y = b.top + 30;
      const rows = [];
      for (let i = 0; i < 4; i++) {
        const bx = left + i * (GW + GAP);
        const on = i === g.dialSel;
        panel(x, bx, y, GW, GW + 10, { border: 2, dither: on ? 0.6 : 0.3, hi: on ? GOLD : GOLD_DK });
        drawGlyphPixels(x, GLYPH_NAMES[g.dialState[i]], bx + 3, y + 3, GW - 6, on ? GOLD_LT : '#c8a94a');
        drawText(x, ['I', 'II', 'III', 'IV'][i], {
          x: bx + GW / 2, y: y + GW + 1, scale: 1, align: 'center', color: on ? GOLD : DIM,
        });
        if (on) {
          drawText(x, '^', { x: bx + GW / 2, y: y - 8, scale: 1, align: 'center', color: GOLD });
          drawText(x, 'v', { x: bx + GW / 2, y: y + GW + 11, scale: 1, align: 'center', color: GOLD });
        }
        rows.push({ x: bx, y, w: GW, h: GW + 10 });
      }
      footer(x, W, H, '< > SOCKET   UP DOWN GLYPH   E CONFIRM   ESC BACK');
      return rows;
    },
    key(code, s, g, st) {
      if (code === 'ArrowLeft' || code === 'KeyA') { g.dialSel = (g.dialSel + 3) % 4; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { g.dialSel = (g.dialSel + 1) % 4; g.audio?.sfx('select'); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { g.cycleDial(1); return true; }
      if (code === 'ArrowDown' || code === 'KeyS') { g.cycleDial(-1); return true; }
      if (code === 'KeyE' || code === 'Enter') { if (!g.submitDials()) s.shake = 0.3; return true; }
      if (code === 'Escape') { st.pop(); g.afterOverlayClose(); return true; }
      return true;
    },
  },

  /* ---------------- DEATH ---------------- */
  death: {
    draw(x, W, H, s, g, t) {
      x.fillStyle = 'rgba(30,4,2,.88)'; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,.4)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);
      const wob = Math.round(Math.sin(t * 4) * 1);
      drawText(x, 'YOU DIED', { x: W / 2 + wob, y: H / 2 - 34, scale: 3, align: 'center', color: '#c8352a' });
      drawText(x, s.sub || '', { x: W / 2, y: H / 2 - 6, scale: 1, align: 'center', color: '#c9a89a' });
      const rows = menuList(x, ['WASH ASHORE AGAIN', 'QUIT TO TITLE'], s.sel, W / 2, H / 2 + 14, t, { width: 130 });
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 2, (i) => { if (i === 0) g.respawn(); else g.quitToTitle(); });
    },
  },

  /* ---------------- ENDING ---------------- */
  ending: {
    draw(x, W, H, s, g, t) {
      x.fillStyle = '#100a04'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        const a = (i * 2.399 + t * 0.2);
        const r = (i % 20) * 6 + 10;
        x.fillStyle = i % 3 ? 'rgba(255,210,74,.12)' : 'rgba(255,240,180,.2)';
        x.fillRect(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * 0.6, 1, 1);
      }
      drawText(x, 'YOU FOUND IT', { x: W / 2, y: 22, scale: 1, align: 'center', color: GOLD });
      drawText(x, 'THE IDOL OF', { x: W / 2, y: 36, scale: 2, align: 'center', color: GOLD_LT });
      drawText(x, 'KING ILLIC', { x: W / 2, y: 54, scale: 2, align: 'center', color: GOLD });

      const st2 = s.stats || {};
      drawText(x, st2.time || '00:00.00', { x: W / 2, y: 78, scale: 2, align: 'center', color: GOLD_LT });
      let y = 100;
      for (const [k, v] of (st2.rows || [])) {
        drawText(x, k, { x: W / 2 - 6, y, scale: 1, align: 'right', color: DIM });
        drawText(x, v, { x: W / 2 + 6, y, scale: 1, color: GOLD_LT });
        y += 10;
      }
      const rows = menuList(x, ['PLAY AGAIN', 'COPY BRAG', 'TITLE'], s.sel, W / 2, y + 8, t, { width: 120 });
      return rows;
    },
    key(code, s, g, st) {
      return nav(code, s, 3, (i) => {
        if (i === 0) g.beginGame();
        else if (i === 1) g.copyBrag();
        else g.quitToTitle();
      });
    },
  },
};

/* ===========================================================
   CONTENT
   =========================================================== */
export const LORE_PAGES = [
  {
    title: 'ILLIC ISLE',
    text: `A rock in a warm sea that nobody visits twice.\n\nIt was named for the man who owned it, and he owned it the way a fist owns a coin.`,
  },
  {
    title: 'KING ILLIC',
    text: `He ruled badly and at length.\n\nHe took a third of everything anyone grew, and when the wells failed he took a third of the water too. He built no roads. He built one temple, and he built it for himself.`,
    icon: 'coin',
  },
  {
    title: 'SYNERGY HOLDINGS',
    text: `Before the king there was a company.\n\nThey dug here for something they never named, paid the diggers in their own coin, and left so completely that only the coins remain.`,
    icon: 'syncoin',
  },
  {
    title: 'THE ROGUE AGENTS',
    text: `They came at night and they came for him.\n\nNobody agrees who sent them. They ended the king, sealed what was left of him in gold, and buried the gold under his own temple.\n\nThen they built four Pendulums to mark the way, and stayed, and grew old.`,
  },
  {
    title: 'TASHA — UNIT 03',
    text: `The Agents did not come alone.\n\nOne of them was not a person. She is still on the west shore, and her optic still flickers about once a minute, which is worse than if it did not.`,
    icon: 'tasha',
  },
  {
    title: 'HECTOR',
    text: `The king's brother.\n\nHe arrived eleven years ago, killed every Rogue Agent on the island, found a staff that makes food out of nothing, and sat down on top of his brother's corpse.\n\nHe has not been hungry since. He calls the temple his LAYER.`,
    icon: 'watermelon',
  },
  {
    title: 'AND YOU',
    text: `The storm took the ship, the crew, and most of your good sense.\n\nIt did not take the reason you came.`,
    icon: 'aerlingus',
  },
];

const FERDI_LINES = [
  '"Everything here fell off a boat. Some of it twice."',
  '"No refunds. Not because of policy. Because of physics."',
  '"You want the boots? Everyone wants the boots."',
  '"I have been open eleven years. You are the fourth."',
  '"Do not go in the temple. You are going in the temple."',
];

export const GLYPH_NAMES = ['SUN', 'MOON', 'EYE', 'SPIRAL'];

const OPTION_DEFS = [
  { label: 'MOUSE SENS', values: [{ v: 0.9, n: 'LOW' }, { v: 1.4, n: 'NORMAL' }, { v: 2.1, n: 'HIGH' }, { v: 3.0, n: 'V.HIGH' }],
    get: (g) => g.settings.sens, set: (g, v) => (g.settings.sens = v) },
  { label: 'INVERT LOOK', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.invert, set: (g, v) => (g.settings.invert = v) },
  { label: 'RESOLUTION', values: [{ v: 180, n: '240x180' }, { v: 224, n: '320x224' }, { v: 320, n: '427x320' }, { v: 0, n: 'NATIVE' }],
    get: (g) => g.settings.res, set: (g, v) => (g.settings.res = v) },
  { label: 'VERTEX JITTER', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.jitter, set: (g, v) => (g.settings.jitter = v) },
  { label: 'CRT / DITHER', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.crt, set: (g, v) => (g.settings.crt = v) },
  { label: 'FOLIAGE', values: [{ v: 0.55, n: 'LOW' }, { v: 1, n: 'NORMAL' }, { v: 1.45, n: 'LUSH' }],
    get: (g) => g.settings.density, set: (g, v) => (g.settings.density = v) },
  { label: 'DAY LENGTH', values: [{ v: 240, n: '4 MIN' }, { v: 480, n: '8 MIN' }, { v: 99999, n: 'ALWAYS DAY' }],
    get: (g) => g.DAY_LEN, set: (g, v) => (g.DAY_LEN = v) },
  { label: 'AUDIO', values: [{ v: false, n: 'OFF' }, { v: true, n: 'ON' }],
    get: (g) => g.settings.audio, set: (g, v) => (g.settings.audio = v) },
];

/* ===========================================================
   PIXEL GLYPHS (shared by dials and the chart)
   =========================================================== */

/** Hand-drawn 24px marks for the three sabotages. */
function drawSabotageIcon(x, kind, ox, oy, size, lit, t) {
  const u = size / 12;
  const p = (gx, gy, w, h, col) => {
    x.fillStyle = col;
    x.fillRect(Math.round(ox + gx * u), Math.round(oy + gy * u), Math.ceil(w * u), Math.ceil(h * u));
  };
  const hot = lit ? 1 : 0.45;
  const C = (a, b) => (lit ? a : b);

  if (kind === 'douse') {
    // a torch head with the flame guttering out
    p(5, 6, 2, 6, C('#8a6a3c', '#4a3a22'));
    p(4, 11, 4, 1, C('#6a4a28', '#3a2a18'));
    if (lit && Math.floor(t * 6) % 2 === 0) {
      p(5, 3, 2, 3, '#e0703a');
      p(5, 1, 2, 2, '#f0b050');
    } else {
      p(5, 4, 2, 2, C('#5a3a2a', '#3a2418'));
    }
    // smoke curling off
    const w = Math.sin(t * 3) * 1;
    p(5 + w, 0, 1, 1, C('#6a6a6a', '#3a3a3a'));
    p(6 - w, 2, 1, 1, C('#5a5a5a', '#333'));
  } else if (kind === 'storm') {
    // cloud with a bolt through it
    p(2, 3, 8, 3, C('#4a5a6a', '#2a323c'));
    p(3, 2, 6, 1, C('#5a6a7a', '#333c46'));
    p(1, 5, 10, 1, C('#3a4a5a', '#242c34'));
    for (let i = 0; i < 4; i++) {
      const rx = 2 + i * 2.4;
      p(rx, 7 + (i % 2), 1, 2, C('#7fa8c4', '#3a4a58'));
    }
    if (!lit || Math.floor(t * 4) % 2 === 0) {
      p(6, 6, 1, 3, C('#ffe07a', '#5a4a20'));
      p(5, 9, 2, 1, C('#ffe07a', '#5a4a20'));
      p(5, 10, 1, 2, C('#ffd24a', '#4a3c18'));
    }
  } else if (kind === 'blind') {
    // an eye with the fog rolling over it
    p(1, 5, 10, 1, C('#8fa0a8', '#3a444a'));
    p(2, 4, 8, 1, C('#8fa0a8', '#3a444a'));
    p(2, 6, 8, 1, C('#8fa0a8', '#3a444a'));
    p(4, 4, 4, 4, C('#d8e4e8', '#4a5458'));
    p(5, 5, 2, 2, C('#1a2024', '#12181c'));
    for (let i = 0; i < 4; i++) {
      const w = Math.sin(t * 2.2 + i) * 1.4;
      p(1 + w, 8 + i * 1.2, 10, 1, C('#7a8a92', '#333c42'));
    }
  } else if (kind === 'scatter') {
    // tools thrown across the floor
    const j = lit ? Math.sin(t * 6) * 0.6 : 0;
    p(1 + j, 2, 5, 1, C('#b0a488', '#4a463a'));
    p(5 + j, 3, 1, 3, C('#8a7a52', '#3c3626'));
    p(7, 5 - j, 4, 1, C('#b0a488', '#4a463a'));
    p(7, 6 - j, 1, 3, C('#8a7a52', '#3c3626'));
    p(2, 8 + j, 1, 3, C('#8a7a52', '#3c3626'));
    p(1, 10 + j, 4, 1, C('#b0a488', '#4a463a'));
    p(8, 9, 3, 3, C('#6a6a72', '#2e2e34'));
    p(9, 10, 1, 1, C('#c8c8d0', '#4a4a52'));
  } else {
    // a pendulum arrested mid-swing, with a bar jammed through it
    p(5, 0, 2, 1, C('#8a7a52', '#453d29'));
    p(6, 1, 1, 6, C('#8a7a52', '#453d29'));
    p(4, 7, 5, 4, C('#c39a2c', '#5f4c16'));
    p(5, 8, 3, 2, C('#ffd24a', '#7a6522'));
    const jitter = lit ? (Math.floor(t * 12) % 2 ? 1 : 0) : 0;
    p(1 + jitter, 5, 10, 1, C('#e0453a', '#6a2018'));
    p(1 + jitter, 6, 10, 1, C('#8a2018', '#3a100c'));
  }
}

export function drawGlyphPixels(x, name, ox, oy, size, color) {
  const u = size / 16;
  const px = (gx, gy, w = 1, h = 1) => x.fillRect(
    Math.round(ox + gx * u), Math.round(oy + gy * u), Math.ceil(w * u), Math.ceil(h * u));
  x.fillStyle = color;
  if (name === 'SUN') {
    px(6, 6, 4, 4);
    for (const [a, b] of [[7, 1], [7, 13], [1, 7], [13, 7]]) px(a, b, 2, 2);
    for (const [a, b] of [[3, 3], [11, 3], [3, 11], [11, 11]]) px(a, b, 2, 2);
  } else if (name === 'MOON') {
    for (let gy = 2; gy < 14; gy++) {
      const dy = gy - 8;
      const half = Math.sqrt(Math.max(0, 36 - dy * dy));
      const bx0 = Math.round(11 - Math.sqrt(Math.max(0, 30 - dy * dy)));
      for (let gx = Math.round(8 - half); gx < bx0; gx++) px(gx, gy);
    }
  } else if (name === 'EYE') {
    for (let gy = 5; gy < 11; gy++) {
      const tt = Math.abs(gy - 7.5) / 3;
      const half = Math.round(7 * (1 - tt * tt));
      if (half > 0) px(8 - half, gy, half * 2, 1);
    }
    x.fillStyle = '#1a1006'; px(6, 6, 4, 4);
    x.fillStyle = color; px(7, 7, 2, 2);
  } else if (name === 'SPIRAL') {
    const seen = new Set();
    for (let i = 0; i < 48; i++) {
      const a = i * 0.42, r = 0.8 + i * 0.135;
      const gx = Math.round(8 + Math.cos(a) * r), gy = Math.round(8 + Math.sin(a) * r);
      const k = gx + ',' + gy;
      if (seen.has(k) || gx < 0 || gy < 0 || gx > 15 || gy > 15) continue;
      seen.add(k); px(gx, gy);
    }
  }
}

/* ===========================================================
   THE MAP — drawn from the real height function
   =========================================================== */
/**
 * The island, drawn on paper.
 *
 * Three things it has to do that it did not. Zoom, because at one fixed
 * scale everything within thirty metres of anything else prints on top of
 * it. Place its labels against each other rather than blindly. And show
 * enough — contours, a scale, the shoreline, every place worth knowing —
 * to be worth opening.
 *
 * @param {object} data  needs heightAt and radius; everything else optional.
 *   `zoom` (1..4) and `cx`/`cz` (the world point at the centre) pan it.
 */
export function drawChart(x, ox, oy, S, data, t) {
  if (!data) return;
  const R = data.radius;
  const zoom = Math.max(1, Math.min(5, data.zoom || 1));
  const cx = data.cx || 0, cz = data.cz || 0;
  const span = R / zoom;                       // world half-extent on screen
  const half = S / 2 - 6;
  const toPx = (wx, wz) => [
    ox + S / 2 + ((wx - cx) / span) * half,
    oy + S / 2 + ((wz - cz) / span) * half,
  ];
  const onMap = (sx, sy) => sx > ox + 2 && sx < ox + S - 2 && sy > oy + 2 && sy < oy + S - 2;

  // parchment with a dithered grain
  ditherRect(x, ox, oy, S, S, '#d8c69a', PAPER, 0.5, 1);

  /* Land. Sampled coarsely so it reads as something drawn, with a finer
     step as you zoom in — there is no point sampling every two pixels of a
     view that only covers forty metres. */
  const STEP = zoom >= 3 ? 1 : 2;
  for (let py = 0; py < S; py += STEP) {
    for (let pxx = 0; pxx < S; pxx += STEP) {
      const wx = cx + ((pxx - S / 2) / half) * span;
      const wz = cz + ((py - S / 2) / half) * span;
      const h = data.heightAt(wx, wz);
      if (h < 0) continue;
      /* Seven bands, not four. With four the whole interior came out as
         one flat grey-green mass and the island had no shape on paper. */
      x.fillStyle = h < 1.2 ? '#d5c08a'
        : h < 3.0 ? '#c9b078'
        : h < 8 ? '#a8b070'
        : h < 16 ? '#8b9c62'
        : h < 24 ? '#758a54'
        : h < 33 ? '#647a4a'
        : h < 42 ? '#7e7a5e'
        : '#95907a';
      x.fillRect(ox + pxx, oy + py, STEP, STEP);
    }
  }

  /* Contours, so the interior has shape instead of being three flat
     greens. Drawn by testing whether a sample crosses a height band. */
  const BANDS = zoom >= 2 ? [4, 10, 18, 26, 34] : [10, 24];
  x.fillStyle = 'rgba(70,56,26,.20)';
  for (let py = 0; py < S; py += 1) {
    for (let pxx = 0; pxx < S; pxx += 1) {
      const wx = cx + ((pxx - S / 2) / half) * span;
      const wz = cz + ((py - S / 2) / half) * span;
      const h = data.heightAt(wx, wz);
      if (h < 0) continue;
      const wx2 = cx + ((pxx + 1 - S / 2) / half) * span;
      const h2 = data.heightAt(wx2, wz);
      for (const bnd of BANDS) {
        if ((h < bnd) !== (h2 < bnd)) { x.fillRect(ox + pxx, oy + py, 1, 1); break; }
      }
    }
  }

  // coast stipple, only worth drawing when the coast is in view
  if (zoom < 3) {
    x.fillStyle = 'rgba(70,52,26,.55)';
    for (let a = 0; a < Math.PI * 2; a += 0.012) {
      let rr = R;
      for (let r = R; r > 20; r -= 2) {
        if (data.heightAt(Math.cos(a) * r, Math.sin(a) * r) > 0) { rr = r; break; }
      }
      const [sx, sy] = toPx(Math.cos(a) * rr, Math.sin(a) * rr);
      if (onMap(sx, sy)) x.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    }
  }

  /* A grid, faint, in hundred-metre squares. Gives the eye something to
     measure against and makes the zoom legible. */
  x.fillStyle = 'rgba(90,64,28,.12)';
  const GRID = zoom >= 3 ? 25 : 50;
  for (let g0 = -Math.ceil(R / GRID) * GRID; g0 <= R; g0 += GRID) {
    const [gx] = toPx(g0, 0);
    const [, gy] = toPx(0, g0);
    if (gx > ox + 2 && gx < ox + S - 2) x.fillRect(Math.round(gx), oy + 2, 1, S - 4);
    if (gy > oy + 2 && gy < oy + S - 2) x.fillRect(ox + 2, Math.round(gy), S - 4, 1);
  }

  /* ---- labels are collected and placed at the end ---- */
  const labels = [];
  const label = (txt, sx, sy, col) => {
    if (!txt) return;
    labels.push({ txt, x: sx, y: sy, col: col || '#3f2f14' });
  };

  if (data.wreck) {
    const [sx, sy] = toPx(data.wreck.x, data.wreck.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a3a18';
      x.fillRect(sx - 4, sy, 9, 2); x.fillRect(sx + 1, sy - 4, 2, 5);
      label('WRECK', sx, sy + 5);
    }
  }
  // Ferdi's, marked as a shop rather than a place name
  if (data.shop) {
    const [sx, sy] = toPx(data.shop.x, data.shop.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a3a18';
      x.fillRect(sx - 6, sy - 2, 13, 7);
      x.fillStyle = '#8a5a24';
      x.fillRect(sx - 7, sy - 5, 15, 3);
      x.fillStyle = '#ffd24a';
      x.fillRect(sx - 2, sy, 5, 5);
      x.fillStyle = '#3a2410';
      x.fillRect(sx - 1, sy + 1, 3, 3);
      label("FERDI'S", sx, sy + 8, '#5a3a18');
    }
  }
  if (data.hut && !data.shop) {
    const [sx, sy] = toPx(data.hut.x, data.hut.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#6a5a48';
      x.fillRect(sx - 6, sy - 2, 13, 7); x.fillRect(sx - 7, sy - 5, 15, 3);
      x.fillStyle = '#3a2f22';
      for (let i = -6; i < 7; i += 3) x.fillRect(sx + i, sy - 2, 2, 7);
      label('SHUT', sx, sy + 8, '#6a5a48');
    }
  }
  // the Lucky Flopper, and her pier
  if (data.casino) {
    const [sx, sy] = toPx(data.casino.x, data.casino.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#5a2a44';
      x.fillRect(sx - 6, sy - 1, 13, 4);
      x.fillRect(sx - 3, sy - 5, 7, 4);
      x.fillStyle = Math.floor(t * 3) % 2 ? '#ff5aa8' : '#8a3a68';
      x.fillRect(sx - 2, sy - 7, 5, 2);
      label('FLOPPER', sx, sy + 6, '#7a2a54');
    }
  }
  if (data.rogue) {
    const [sx, sy] = toPx(data.rogue.x, data.rogue.z);
    if (onMap(sx, sy)) label('"ROGUE"', sx, sy, '#7a2418');
  }
  for (const m of data.marks) {
    const [sx, sy] = toPx(m.x, m.z);
    if (!onMap(sx, sy)) continue;
    const col = m.found ? '#2f6a4a' : '#8a2418';
    x.fillStyle = col;
    for (let i = -4; i <= 4; i++) { x.fillRect(sx + i, sy + i, 2, 2); x.fillRect(sx + i, sy - i, 2, 2); }
    if (!m.found && Math.floor(t * 2) % 2 === 0) {
      x.fillStyle = '#c02a1a';
      x.fillRect(sx - 6, sy - 6, 13, 1); x.fillRect(sx - 6, sy + 6, 13, 1);
      x.fillRect(sx - 6, sy - 6, 1, 13); x.fillRect(sx + 6, sy - 6, 1, 13);
    }
    label(m.label, sx, sy - 13, col);
    if (m.glyph) drawGlyphPixels(x, m.glyph, sx - 5, sy + 7, 11, '#2f6a4a');
  }
  for (const r of (data.relics || [])) {
    const [sx, sy] = toPx(r.x, r.z);
    if (!onMap(sx, sy)) continue;
    if (r.found) {
      drawRelicIcon(x, r.kind, sx - 6, sy - 6, 13);
    } else {
      x.fillStyle = '#6b4a8a';
      x.fillRect(sx - 3, sy - 4, 6, 2); x.fillRect(sx + 1, sy - 2, 2, 3);
      x.fillRect(sx - 1, sy + 1, 3, 2); x.fillRect(sx - 1, sy + 4, 3, 2);
    }
  }
  if (data.temple) {
    const [sx, sy] = toPx(data.temple.x, data.temple.z);
    if (onMap(sx, sy)) {
      x.fillStyle = '#4a3a1a';
      x.fillRect(sx - 6, sy - 1, 13, 6); x.fillRect(sx - 4, sy - 4, 9, 3); x.fillRect(sx - 2, sy - 6, 5, 2);
      x.fillStyle = '#1a1206'; x.fillRect(sx - 1, sy + 1, 3, 4);
      label('TEMPLE', sx, sy + 8);
    }
  }
  /* Castaways: your own chores, ticked as you go, and named once you are
     zoomed in far enough for the name to fit. */
  for (const j of (data.jobs || [])) {
    const [sx, sy] = toPx(j.x, j.z);
    if (!onMap(sx, sy)) continue;
    if (j.done) {
      x.fillStyle = '#2f6a4a';
      x.fillRect(sx - 3, sy, 2, 2); x.fillRect(sx - 1, sy + 2, 2, 2);
      x.fillRect(sx + 1, sy - 1, 2, 2); x.fillRect(sx + 3, sy - 3, 2, 2);
    } else {
      const pulse = Math.floor(t * 2) % 2 === 0;
      x.fillStyle = '#8a2418';
      x.fillRect(sx - 4, sy - 1, 9, 3); x.fillRect(sx - 1, sy - 4, 3, 9);
      if (pulse) {
        x.fillStyle = '#c02a1a';
        x.fillRect(sx - 6, sy - 6, 13, 1); x.fillRect(sx - 6, sy + 5, 13, 1);
        x.fillRect(sx - 6, sy - 6, 1, 12); x.fillRect(sx + 6, sy - 6, 1, 12);
      }
    }
    if (j.name && zoom >= 2) label(j.name, sx, sy + 7, j.done ? '#2f6a4a' : '#7a2418');
  }
  // where the current sabotage has to be put right
  for (const f of (data.fixes || [])) {
    const [sx, sy] = toPx(f.x, f.z);
    if (!onMap(sx, sy)) continue;
    const on = Math.floor(t * 3) % 2 === 0;
    x.fillStyle = on ? '#c02a1a' : '#7a2418';
    x.fillRect(sx - 5, sy - 1, 11, 3);
    x.fillRect(sx - 1, sy - 5, 3, 11);
    if (on) {
      x.fillStyle = '#ffd0c0';
      x.fillRect(sx - 8, sy - 8, 17, 1); x.fillRect(sx - 8, sy + 7, 17, 1);
      x.fillRect(sx - 8, sy - 8, 1, 16); x.fillRect(sx + 8, sy - 8, 1, 16);
    }
    label('REPAIR', sx, sy + 8, '#7a2418');
  }
  // ghosts get to watch the living move about
  for (const o of (data.others || [])) {
    const [sx, sy] = toPx(o.x, o.z);
    if (!onMap(sx, sy)) continue;
    x.fillStyle = '#000'; x.fillRect(sx - 3, sy - 3, 6, 6);
    x.fillStyle = '#' + (o.colour >>> 0).toString(16).padStart(6, '0');
    x.fillRect(sx - 2, sy - 2, 4, 4);
  }
  if (data.player) {
    const [sx, sy] = toPx(data.player.x, data.player.z);
    if (onMap(sx, sy)) {
      // a proper "you are here", with a heading pip
      x.fillStyle = '#c02a1a'; x.fillRect(sx - 3, sy - 3, 7, 7);
      x.fillStyle = '#fff'; x.fillRect(sx - 1, sy - 1, 3, 3);
      if (data.facing !== undefined) {
        const fx = sx + Math.sin(data.facing) * 7, fy = sy + Math.cos(data.facing) * 7;
        x.fillStyle = '#c02a1a'; x.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 3);
      }
    }
  }

  /* ---- and now the labels, none of them on top of each other ----
     Each is nudged down a row at a time until it has clear space. If it
     cannot find any within a few rows it is dropped rather than printed
     over something else. */
  const placed = [];
  for (const L of labels) {
    const w = textWidth(L.txt, 1);
    let lx = Math.round(Math.max(ox + 3, Math.min(ox + S - w - 3, L.x - w / 2)));
    let ly = Math.round(L.y);
    let ok = false;
    for (let tries = 0; tries < 7; tries++) {
      const clash = placed.some((r) => ly < r.y + 9 && r.y < ly + 9 && lx < r.x + r.w + 2 && r.x < lx + w + 2);
      if (!clash) { ok = true; break; }
      ly += 9;
      if (ly > oy + S - 10) { ly = Math.round(L.y) - 9 * (tries + 1); }
    }
    if (!ok || ly < oy + 2 || ly > oy + S - 9) continue;
    placed.push({ x: lx, y: ly, w });
    drawText(x, L.txt, { x: lx, y: ly, scale: 1, color: L.col, shadowColor: PAPER });
  }

  /* ---- furniture: compass rose, scale bar, the zoom you are at ---- */
  x.fillStyle = '#3f2f14';
  drawText(x, 'N', { x: ox + S - 12, y: oy + 5, scale: 1, align: 'center', color: '#3f2f14', shadowColor: PAPER });
  x.fillRect(ox + S - 13, oy + 14, 3, 8);
  x.fillRect(ox + S - 15, oy + 16, 7, 2);

  // a scale bar, so the zoom means something
  {
    const metres = zoom >= 3 ? 20 : (zoom >= 2 ? 50 : 100);
    const px = Math.round((metres / span) * half);
    const bx = ox + 8, by = oy + S - 10;
    x.fillStyle = '#3f2f14';
    x.fillRect(bx, by, px, 2);
    x.fillRect(bx, by - 3, 2, 8); x.fillRect(bx + Math.max(4, px) - 2, by - 3, 2, 8);
    drawText(x, `${metres}M`, {
      x: bx + Math.max(4, px) / 2, y: by - 12, scale: 1, align: 'center',
      color: '#3f2f14', shadowColor: PAPER,
    });
  }
  if (zoom > 1) {
    drawText(x, `x${zoom}`, {
      x: ox + S - 8, y: oy + S - 12, scale: 1, align: 'right',
      color: '#5a3a18', shadowColor: PAPER,
    });
  }

  x.fillStyle = '#5c3f1c';
  x.fillRect(ox, oy, S, 2); x.fillRect(ox, oy + S - 2, S, 2);
  x.fillRect(ox, oy, 2, S); x.fillRect(ox + S - 2, oy, 2, S);
}
