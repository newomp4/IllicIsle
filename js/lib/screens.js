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
import { drawRelicIcon } from './hud.js';
import { COLOURS } from '../net/protocol.js';
import { SABOTAGE_DEFS } from '../mp/tasks.js';

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
    const s = { name, sel: 0, scroll: 0, t: 0, ...data };
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
    for (let i = 0; i < this._rows.length; i++) {
      const r = this._rows[i];
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
        s.sel = i;
        this.key('Enter');
        return true;
      }
    }
    return false;
  }

  update(dt) { this.t += dt; if (this.top) this.top.t += dt; }

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
      let y = b.top + 4;
      const nw = 120, nx = Math.round((W - nw) / 2);
      drawText(x, 'YOUR NAME', { x: W / 2, y, scale: 1, align: 'center', color: s.field === 0 ? GOLD : DIM });
      field(x, nx, y + 10, nw, 15, s.field === 0);
      drawText(x, s.who + caret(s.field === 0), {
        x: W / 2, y: y + 14, scale: 1, align: 'center', color: GOLD_LT,
      });

      // room
      y += 36;
      drawText(x, 'ROOM CODE', { x: W / 2, y, scale: 1, align: 'center', color: s.field === 1 ? GOLD : DIM });
      const rw = 78, rx = Math.round((W - rw) / 2);
      field(x, rx, y + 10, rw, 20, s.field === 1);
      drawText(x, s.code + caret(s.field === 1), {
        x: W / 2, y: y + 16, scale: 2, align: 'center', color: GOLD_LT,
      });
      drawText(x, 'LEAVE IT BLANK TO OPEN A ROOM OF YOUR OWN', {
        x: W / 2, y: y + 34, scale: 1, align: 'center', color: DIM,
      });

      y += 58;
      const rows = menuList(x, [s.code ? 'JOIN THAT ROOM' : 'OPEN A NEW ROOM'],
        s.sel, W / 2, y, t, { width: 150 });
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
      let rows = [];
      if (g.isHost) {
        const can = players.length >= 3;
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
      x.fillStyle = agent ? '#180404' : '#04090e';
      x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, agent ? '#180404' : '#04090e',
        agent ? '#240707' : '#071018', 0.5, 2);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, y, W, 1); }

      // the card slides up and settles
      const pop = Math.min(1, s.t * 2.2);
      const lift = Math.round((1 - pop * pop) * 26);
      const cw = 220, ch = 96;
      const cx = Math.round((W - cw) / 2), cy = Math.round((H - ch) / 2) + lift - 6;
      x.fillStyle = agent ? '#2c0a08' : '#07131a';
      x.fillRect(cx, cy, cw, ch);
      ditherRect(x, cx, cy, cw, ch, agent ? '#2c0a08' : '#07131a',
        agent ? '#3a0f0c' : '#0b1c26', 0.4, 2);
      x.fillStyle = agent ? '#8a2018' : '#2f6a5c';
      x.fillRect(cx, cy, cw, 1); x.fillRect(cx, cy + ch - 1, cw, 1);
      x.fillRect(cx, cy, 1, ch); x.fillRect(cx + cw - 1, cy, 1, ch);

      drawText(x, 'YOU ARE', { x: W / 2, y: cy + 12, scale: 1, align: 'center', color: DIM });
      drawText(x, agent ? 'A ROGUE AGENT' : 'A CASTAWAY', {
        x: W / 2, y: cy + 24, scale: 2, align: 'center', color: agent ? '#ff6a5a' : '#8fe8c8',
      });
      x.fillStyle = agent ? '#8a2018' : '#2f6a5c';
      x.fillRect(cx + 30, cy + 44, cw - 60, 1);

      const blurb = agent
        ? ['CUT THEM DOWN. DO NOT BE SEEN.', 'JAM THE ISLAND WHEN IT SUITS YOU.']
        : ['DO YOUR WORK. WATCH THE OTHERS.', 'SOMEBODY HERE IS NOT WHAT THEY SAY.'];
      let y = cy + 52;
      for (const ln of blurb) {
        drawText(x, ln, { x: W / 2, y, scale: 1, align: 'center', color: GOLD_LT }); y += 11;
      }
      if (agent && g.mp.view.mates && g.mp.view.mates.length > 1) {
        drawText(x, 'WITH YOU: ' + g.mp.view.mates.join(' '), {
          x: W / 2, y: y + 4, scale: 1, align: 'center', color: '#ff9a8a',
        });
      } else if (agent) {
        drawText(x, 'YOU WORK ALONE', { x: W / 2, y: y + 4, scale: 1, align: 'center', color: '#a8564c' });
      }
      return [];
    },
    key() { return true; },
  },

  /* ---------------- COUNCIL + VOTE ---------------- */
  mpCouncil: {
    init(s, g) { s.sel = 0; s.typing = ''; s.ready = false; },
    draw(x, W, H, s, g, t) {
      const voting = g.mp.view.phase === 'vote';
      const players = [...g.mp.view.players.values()];
      const alive = players.filter((p) => p.alive !== false);
      const total = Math.max(0.001, g.mp.view.phaseTotal || 45);
      const left = Math.max(0, (g.mp.view.phaseEndsAt || 0) - performance.now() / 1000);

      /* ---- the fire everyone is sitting around ---- */
      x.fillStyle = '#080604'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#080604', '#120c06', 0.5, 2);
      const flick = 0.82 + Math.sin(t * 11) * 0.09 + Math.sin(t * 6.3) * 0.09;
      for (let i = 7; i >= 0; i--) {
        const r = 40 + i * 15;
        x.fillStyle = `rgba(${90 - i * 6},${44 - i * 3},${10},${(0.05 * flick).toFixed(3)})`;
        x.beginPath(); x.arc(W / 2, H - 6, r, 0, Math.PI * 2); x.fill();
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.34)'; x.fillRect(0, y, W, 1); }

      /* ---- header: which half of the meeting you are in ---- */
      const title = voting ? 'THE VOTE' : 'THE COUNCIL';
      drawText(x, title, { x: W / 2, y: 8, scale: 2, align: 'center', color: voting ? RED : GOLD });
      drawText(x, g.mp.councilHeader || '', { x: W / 2, y: 26, scale: 1, align: 'center', color: GOLD_LT });

      // a draining bar reads faster than a number, so it gets both
      const bw = W - 60, bx = 30, by = 38;
      x.fillStyle = INK; x.fillRect(bx - 1, by - 1, bw + 2, 6);
      x.fillStyle = '#1c1208'; x.fillRect(bx, by, bw, 4);
      const n = Math.round((left / total) * bw);
      const urgent = left < 8;
      for (let i = 0; i < n; i += 3) {
        x.fillStyle = urgent
          ? (Math.floor(t * 6) % 2 ? '#ff6a5a' : '#8a2018')
          : (i % 6 ? '#c39a2c' : GOLD);
        x.fillRect(bx + i, by, 2, 4);
      }
      drawText(x, `${Math.ceil(left)}`, {
        x: W - 30, y: by - 10, scale: 1, align: 'right', color: urgent ? RED : DIM,
      });
      drawText(x, voting ? 'CAST YOUR VOTE' : 'TALK IT OUT', {
        x: 30, y: by - 10, scale: 1, color: DIM,
      });

      /* ---- left: the roster, which doubles as the ballot ---- */
      s.targets = alive.map((p) => p.id);
      if (voting) s.targets.push('skip');
      if (s.sel >= s.targets.length) s.sel = 0;

      const LX = 12, LW = 122;
      let y = 52;
      const rows = [];
      const voted = new Set(g.mp.view.votes?.voted || []);
      const line = (id, label, swatch, dead, tag, tagCol) => {
        const idx = s.targets.indexOf(id);
        const on = idx >= 0 && idx === s.sel;
        if (on) {
          x.fillStyle = voting ? '#4a1410' : '#3a2a10';
          x.fillRect(LX, y - 2, LW, 11);
          x.fillStyle = voting ? RED : GOLD;
          x.fillRect(LX, y - 2, 1, 11);
        }
        if (swatch) { x.fillStyle = dead ? '#4a4a4a' : swatch; x.fillRect(LX + 4, y, 7, 7); }
        drawText(x, label, {
          x: LX + 16, y, scale: 1,
          color: dead ? '#6a6a6a' : (on ? GOLD_LT : '#c9b98a'),
        });
        if (tag) drawText(x, tag, { x: LX + LW - 4, y, scale: 1, align: 'right', color: tagCol });
        if (idx >= 0) rows[idx] = { x: LX, y: y - 2, w: LW, h: 11 };
        y += 11;
      };

      for (const p of players) {
        const dead = p.alive === false;
        let tag = '', col = DIM;
        if (dead) { tag = 'LOST'; col = '#5a4a3a'; }
        else if (voting) {
          const c = g.mp.view.votes?.counts?.[p.id] || 0;
          if (c) { tag = '*'.repeat(Math.min(c, 5)); col = GOLD; }
          else if (voted.has(p.id)) { tag = 'VOTED'; col = '#5f7a4a'; }
        } else if (p.ready) { tag = 'DONE'; col = JADE; }
        line(p.id, (dead ? 'X ' : '') + (p.name || '?'), colourOf(p.colour), dead, tag, col);
      }
      if (voting) {
        const c = g.mp.view.votes?.counts?.skip || 0;
        line('skip', 'SKIP THE VOTE', null, false, c ? '*'.repeat(Math.min(c, 5)) : '', GOLD);
      }

      // a running count, so nobody wonders who they are waiting on
      if (voting) {
        drawText(x, `${voted.size} OF ${alive.length} VOTED`,
          { x: LX + 4, y: y + 4, scale: 1, color: DIM });
      } else {
        const done = alive.filter((p) => p.ready).length;
        drawText(x, `${done} OF ${alive.length} DONE TALKING`,
          { x: LX + 4, y: y + 4, scale: 1, color: done === alive.length ? JADE : DIM });
      }

      /* ---- right: the chat ---- */
      const cx = LX + LW + 8;
      const cw = W - cx - 12;
      const ctop = 52, cbot = H - 36;
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(cx, ctop, cw, cbot - ctop);
      x.fillStyle = '#3a2a10';
      x.fillRect(cx, ctop, cw, 1); x.fillRect(cx, cbot - 1, cw, 1);
      x.fillRect(cx, ctop, 1, cbot - ctop); x.fillRect(cx + cw - 1, ctop, 1, cbot - ctop);

      const lines = [];
      for (const m of g.mp.chat.slice(-14)) {
        const wrapped = wrapText(`${m.from}: ${m.text}`, cw - 8, 1, 1);
        wrapped.forEach((ln, i) => lines.push({
          ln, kind: m.kind, from: i === 0 ? m.from : null, colour: m.colour,
        }));
      }
      const fit = Math.floor((cbot - ctop - 6) / 9);
      let cy = ctop + 4;
      for (const l of lines.slice(-fit)) {
        drawText(x, l.ln, { x: cx + 4, y: cy, scale: 1, color: l.kind === 'ghost' ? '#8fb0c8' : GOLD_LT });
        if (l.from) drawText(x, l.from + ':', { x: cx + 4, y: cy, scale: 1, color: colourOf(l.colour) });
        cy += 9;
      }
      if (!lines.length) {
        drawText(x, g.amAlive ? 'NOBODY HAS SPOKEN YET' : 'THE DEAD TALK AMONG THEMSELVES', {
          x: cx + cw / 2, y: ctop + 8, scale: 1, align: 'center', color: '#4a3f2a',
        });
      }

      // input line
      field(x, cx, H - 33, cw, 12, true);
      drawText(x, s.typing + (Math.floor(t * 3) % 2 ? '_' : ''), {
        x: cx + 3, y: H - 30, scale: 1, color: g.amAlive ? JADE : '#8fb0c8',
      });

      /* ---- footer ---- */
      const hint = voting
        ? (s.typing ? 'ENTER SENDS' : 'UP DOWN CHOOSE   ENTER CASTS YOUR VOTE')
        : (s.typing ? 'ENTER SENDS'
          : (s.ready ? 'ENTER AGAIN TO SPEAK UP' : 'ENTER WHEN YOU ARE DONE TALKING'));
      footer(x, W, H, hint);
      return voting ? rows.filter(Boolean) : [];
    },
    key(code, s, g, st) {
      const voting = g.mp.view.phase === 'vote';
      /* Enter carries the whole screen: it sends what you have typed, and
         when the line is empty it means "I am done" — which during the
         discussion ends it early once everyone agrees, and during the vote
         casts your ballot. Binding these to letters would make those
         letters untypable in a screen that is mostly typing. */
      if (code === 'Enter' || code === 'NumpadEnter') {
        if (s.typing.trim()) { g.sendChat(s.typing.trim()); s.typing = ''; return true; }
        if (voting) { if (s.targets?.length) g.sendVote(s.targets[s.sel] || 'skip'); }
        else { s.ready = !s.ready; g.sendReady(s.ready); }
        return true;
      }
      if (code === 'Backspace') { s.typing = s.typing.slice(0, -1); return true; }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        const n = s.targets?.length || 1;
        s.sel = (s.sel + (code === 'ArrowUp' ? n - 1 : 1)) % n;
        return true;
      }
      const m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
      if (m && s.typing.length < 60) { s.typing += m[1]; return true; }
      if (code === 'Space' && s.typing.length < 60) { s.typing += ' '; return true; }
      if (code === 'Period' && s.typing.length < 60) { s.typing += '.'; return true; }
      if (code === 'Comma' && s.typing.length < 60) { s.typing += ','; return true; }
      if (code === 'Slash' && s.typing.length < 60) { s.typing += '?'; return true; }
      if (code === 'Minus' && s.typing.length < 60) { s.typing += '-'; return true; }
      if (code === 'Quote' && s.typing.length < 60) { s.typing += "'"; return true; }
      return true;
    },
  },

  /* ---------------- SABOTAGE WHEEL ---------------- */
  mpSabotage: {
    init(s) { s.sel = 0; },
    draw(x, W, H, s, g, t) {
      const defs = Object.values(SABOTAGE_DEFS);
      const d = defs[s.sel] || defs[0];

      /* A dark console rather than a menu: this is the one screen that is
         entirely the villain's, so it gets its own colour and its own
         furniture instead of the game's gold panel. */
      x.fillStyle = '#0e0403'; x.fillRect(0, 0, W, H);
      ditherRect(x, 0, 0, W, H, '#0e0403', '#1a0605', 0.5, 2);
      // a slow sweep, like something is scanning
      const sweep = ((t * 40) % (H + 60)) - 30;
      for (let i = 0; i < 20; i++) {
        const yy = Math.round(sweep + i);
        if (yy < 0 || yy >= H) continue;
        x.fillStyle = `rgba(180,40,30,${(0.05 * (1 - i / 20)).toFixed(3)})`;
        x.fillRect(0, yy, W, 1);
      }
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.40)'; x.fillRect(0, y, W, 1); }

      // frame
      x.fillStyle = '#8a2018';
      x.fillRect(8, 8, W - 16, 1); x.fillRect(8, H - 9, W - 16, 1);
      x.fillRect(8, 8, 1, H - 17); x.fillRect(W - 9, 8, 1, H - 17);
      for (const [cx2, cy2] of [[8, 8], [W - 12, 8], [8, H - 12], [W - 12, H - 12]]) {
        x.fillStyle = RED; x.fillRect(cx2, cy2, 4, 4);
      }

      drawText(x, 'SABOTAGE', { x: W / 2, y: 15, scale: 2, align: 'center', color: RED });
      drawText(x, 'THEY WILL COME RUNNING. BE SOMEWHERE ELSE.', {
        x: W / 2, y: 33, scale: 1, align: 'center', color: '#8a5a52',
      });

      /* three plates across, the lit one raised */
      const CW = 92, CH = 74, GAP = 8;
      const total = defs.length * CW + (defs.length - 1) * GAP;
      const ox = Math.round((W - total) / 2);
      const rows = [];
      defs.forEach((def, i) => {
        const on = i === s.sel;
        const cx2 = ox + i * (CW + GAP);
        const cy2 = 46 - (on ? 2 : 0);
        x.fillStyle = on ? '#2a0a08' : '#160605';
        x.fillRect(cx2, cy2, CW, CH);
        ditherRect(x, cx2, cy2, CW, CH, on ? '#2a0a08' : '#160605', on ? '#3a0e0b' : '#1c0807', 0.4, 2);
        x.fillStyle = on ? RED : '#5a1a14';
        x.fillRect(cx2, cy2, CW, 1); x.fillRect(cx2, cy2 + CH - 1, CW, 1);
        x.fillRect(cx2, cy2, 1, CH); x.fillRect(cx2 + CW - 1, cy2, 1, CH);
        if (on) { x.fillStyle = RED; x.fillRect(cx2, cy2, CW, 3); }

        drawSabotageIcon(x, def.id, cx2 + CW / 2 - 12, cy2 + 10, 24, on, t);

        let ty = cy2 + 40;
        for (const ln of wrapText(def.name, CW - 8, 1, 1)) {
          drawText(x, ln, { x: cx2 + CW / 2, y: ty, scale: 1, align: 'center', color: on ? '#ffd8ce' : '#8a5a52' });
          ty += 9;
        }
        drawText(x, def.fatal ? 'FATAL' : `${def.secs} SEC`, {
          x: cx2 + CW / 2, y: cy2 + CH - 10, scale: 1, align: 'center',
          color: def.fatal ? (Math.floor(t * 5) % 2 ? '#ff6a5a' : '#8a2018') : '#7a4a44',
        });
        rows.push({ x: cx2, y: cy2, w: CW, h: CH });
      });

      // what the lit one actually does
      let by = 132;
      for (const ln of wrapText(d.blurb.toUpperCase(), W - 60, 1, 1)) {
        drawText(x, ln, { x: W / 2, y: by, scale: 1, align: 'center', color: '#e2b0a4' });
        by += 10;
      }
      const fixers = d.fixers > 1 ? `${d.fixers} OF THEM MUST FIX IT` : 'ONE OF THEM CAN FIX IT';
      drawText(x, fixers, { x: W / 2, y: by + 4, scale: 1, align: 'center', color: '#7a4a44' });

      // where they will be while they fix it — which is the useful part
      const WHERE = {
        camp: 'THE CAMPFIRE', hut: "FERDI'S HUT", wreck: 'THE WRECK',
        pend1: 'THE WEST PENDULUM', pend2: 'THE RIDGE PENDULUM',
        pend3: 'THE EAST PENDULUM', pend4: 'THE NORTH PENDULUM',
      };
      const spots = (d.fixAt || []).map((k) => WHERE[k] || k.toUpperCase());
      x.fillStyle = '#5a1a14';
      x.fillRect(W / 2 - 70, by + 18, 140, 1);
      drawText(x, 'THEY WILL RUN TO', { x: W / 2, y: by + 24, scale: 1, align: 'center', color: '#7a4a44' });
      let sy = by + 34;
      for (const ln of wrapText(spots.join(' - '), W - 60, 1, 1)) {
        drawText(x, ln, { x: W / 2, y: sy, scale: 1, align: 'center', color: '#c08078' });
        sy += 9;
      }

      footer(x, W, H, 'LEFT RIGHT CHOOSE   E PULL IT   Q OR ESC AWAY');
      return rows;
    },
    key(code, s, g, st) {
      const defs = Object.values(SABOTAGE_DEFS);
      if (code === 'ArrowLeft' || code === 'KeyA') { s.sel = (s.sel + defs.length - 1) % defs.length; return true; }
      if (code === 'ArrowRight' || code === 'KeyD') { s.sel = (s.sel + 1) % defs.length; return true; }
      if (code === 'Escape' || code === 'Backspace') { st.pop(); g.afterOverlayClose(); return true; }
      if (code === 'Enter' || code === 'KeyE' || code === 'Space') {
        g.sendSabotage(defs[s.sel].id);
        st.pop();
        g.afterOverlayClose();
        return true;
      }
      return true;
    },
  },

  /* ---------------- EXILE CARD ---------------- */
  mpExile: {
    draw(x, W, H, s, g, t) {
      // night sky above, banded down to the waterline
      const sea = Math.round(H * 0.70);
      for (let yy = 0; yy < sea; yy++) {
        const k = yy / sea;
        const v = Math.round(6 + k * k * 54);
        x.fillStyle = `rgb(${Math.round(v * 0.5)},${Math.round(v * 0.7)},${v})`;
        x.fillRect(0, yy, W, 1);
      }
      ditherRect(x, 0, 0, W, sea, 'rgba(0,0,0,0)', 'rgba(0,0,0,.30)', 0.5, 2);
      for (let yy = sea; yy < H; yy++) {
        const k = (yy - sea) / (H - sea);
        const r = Math.round(20 - k * 14), gr = Math.round(46 - k * 34), bl = Math.round(84 - k * 62);
        x.fillStyle = `rgb(${r},${gr},${bl})`;
        x.fillRect(0, yy, W, 1);
      }
      x.fillStyle = '#7fa8c4'; x.fillRect(0, sea, W, 1);
      x.fillStyle = 'rgba(140,180,210,.35)'; x.fillRect(0, sea - 1, W, 1);
      for (let y = 0; y < H; y += 2) { x.fillStyle = 'rgba(0,0,0,.30)'; x.fillRect(0, y, W, 1); }
      for (let i = 0; i < 9; i++) {
        const yy = sea + 4 + i * 7;
        if (yy > H - 3) break;
        const off = Math.round(Math.sin(t * 1.1 + i * 1.7) * (10 + i * 3));
        const w = 26 - i * 2;
        x.fillStyle = `rgba(150,190,215,${(0.34 - i * 0.03).toFixed(2)})`;
        x.fillRect((((i * 71 + off) % W) + W) % W, yy, w, 1);
        x.fillRect((((i * 71 + off + 150) % W) + W) % W, yy, w, 1);
      }

      drawText(x, s.targetId ? 'THROWN TO THE SEA' : 'THE COUNCIL COULD NOT AGREE', {
        x: W / 2, y: 34, scale: 1, align: 'center', color: DIM,
      });
      x.fillStyle = GOLD_DK; x.fillRect(W / 2 - 70, 48, 140, 1);

      let y = 60;
      const col = s.targetId ? (s.wasAgent ? JADE : RED) : GOLD_LT;
      for (const ln of wrapText(s.line || '', W - 60, 2, 1)) {
        drawText(x, ln, { x: W / 2, y, scale: 2, align: 'center', color: col });
        y += 18;
      }

      const left = [...g.mp.view.players.values()].filter((p) => p.alive !== false).length;
      drawText(x, `${left} STILL ASHORE`, { x: W / 2, y: sea - 18, scale: 1, align: 'center', color: DIM });
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
        ['M', 'CHART'], ['TAB', 'JOURNAL'], ['C', 'VIEW'], ['ESC', 'PAUSE'],
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
      const rows = menuList(x, ['RESUME', 'JOURNAL', 'CHART', 'CONTROLS', 'OPTIONS', 'QUIT TO TITLE'],
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

  /* ---------------- CHART ---------------- */
  chart: {
    draw(x, W, H, s, g, t) {
      /* It unfolds. A map that simply appears reads as a menu; a map that
         opens in two beats — creased in half, then flat — reads as paper
         you are pulling out of a pocket. */
      const k = Math.min(1, s.t / 0.26);
      const ease = 1 - Math.pow(1 - k, 3);

      x.fillStyle = `rgba(6,4,2,${(0.86 * ease).toFixed(3)})`;
      x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 0; y < H; y += 2) x.fillRect(0, y, W, 1);

      const m = 10;
      const fullH = H - m * 2;
      const openH = Math.max(4, Math.round(fullH * ease));
      const top = Math.round(m + (fullH - openH) / 2);
      panel(x, m, top, W - m * 2, openH, { border: 2, dither: 0.45, hi: GOLD_DK, lo: '#241708' });

      if (k < 0.7) {
        // the crease, still visible while it is coming open
        x.fillStyle = GOLD_DK;
        x.fillRect(m + 6, top + Math.round(openH / 2), W - m * 2 - 12, 1);
        return [];
      }

      drawText(x, "ROGUE AGENTS' CHART", { x: W / 2, y: m + 7, scale: 1, align: 'center', color: GOLD });
      x.fillStyle = GOLD_DK;
      x.fillRect(m + 8, m + 18, W - m * 2 - 16, 1);
      const b = { top: m + 24, bottom: H - m - 12 };

      const size = Math.min(W - 30, b.bottom - b.top - 14);
      const ox = Math.round((W - size) / 2), oy = b.top + 2;
      drawChart(x, ox, oy, size, s.data, t);
      if (s.data.marks.length) {
        const left = s.data.marks.filter((mk) => !mk.found).length;
        drawText(x, left ? `${left} PENDULUM${left === 1 ? '' : 'S'} STILL UNREAD` : 'ALL FOUR READ',
          { x: W / 2, y: b.bottom - 2, scale: 1, align: 'center', color: left ? GOLD : JADE });
      } else if (s.subtitle) {
        drawText(x, s.subtitle, { x: W / 2, y: b.bottom - 2, scale: 1, align: 'center', color: JADE });
      }
      footer(x, W, H, 'M OR TAB CLOSE');
      return [];
    },
    key(code, s, g, st) {
      if (code === 'KeyM' || code === 'Escape' || code === 'Tab' || code === 'KeyF') {
        st.pop(); g.afterOverlayClose(); return true;
      }
      return true;
    },
  },

  /* ---------------- FERDI'S SHOP ---------------- */
  shop: {
    init(s, g) { s.sel = 0; s.shake = 0; },
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
   THE CHART — drawn from the real height function
   =========================================================== */
export function drawChart(x, ox, oy, S, data, t) {
  if (!data) return;
  const R = data.radius;
  const toPx = (wx, wz) => [ox + S / 2 + (wx / R) * (S / 2 - 6), oy + S / 2 + (wz / R) * (S / 2 - 6)];

  // parchment with a dithered grain
  ditherRect(x, ox, oy, S, S, '#d8c69a', PAPER, 0.5, 1);

  // land, sampled coarsely so it reads as a drawn map
  const STEP = 2;
  for (let py = 0; py < S; py += STEP) {
    for (let pxx = 0; pxx < S; pxx += STEP) {
      const wx = ((pxx - S / 2) / (S / 2 - 6)) * R;
      const wz = ((py - S / 2) / (S / 2 - 6)) * R;
      const h = data.heightAt(wx, wz);
      if (h < 0) continue;
      x.fillStyle = h < 2.6 ? '#c9b078' : h < 12 ? '#8b9c62' : h < 28 ? '#6d8450' : '#8a8468';
      x.fillRect(ox + pxx, oy + py, STEP, STEP);
    }
  }
  // coast stipple
  x.fillStyle = 'rgba(70,52,26,.55)';
  for (let a = 0; a < Math.PI * 2; a += 0.012) {
    let rr = R;
    for (let r = R; r > 20; r -= 2) {
      if (data.heightAt(Math.cos(a) * r, Math.sin(a) * r) > 0) { rr = r; break; }
    }
    const [sx, sy] = toPx(Math.cos(a) * rr, Math.sin(a) * rr);
    x.fillRect(Math.round(sx), Math.round(sy), 1, 1);
  }

  const label = (txt, sx, sy, col) => drawText(x, txt, {
    x: sx, y: sy, scale: 1, align: 'center', color: col || '#3f2f14', shadowColor: PAPER,
  });

  if (data.wreck) {
    const [sx, sy] = toPx(data.wreck.x, data.wreck.z);
    x.fillStyle = '#5a3a18';
    x.fillRect(sx - 4, sy, 9, 2); x.fillRect(sx + 1, sy - 4, 2, 5);
    label('WRECK', sx, sy + 5);
  }
  if (data.hut) {
    const [sx, sy] = toPx(data.hut.x, data.hut.z);
    x.fillStyle = '#6b4a18';
    x.fillRect(sx - 4, sy - 1, 9, 5); x.fillRect(sx - 5, sy - 3, 11, 2);
    label('FERDI', sx, sy + 6, '#5a3a18');
  }
  if (data.rogue) {
    const [sx, sy] = toPx(data.rogue.x, data.rogue.z);
    label('"ROGUE"', sx, sy, '#7a2418');
  }
  for (const m of data.marks) {
    const [sx, sy] = toPx(m.x, m.z);
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
    x.fillStyle = '#4a3a1a';
    x.fillRect(sx - 6, sy - 1, 13, 6); x.fillRect(sx - 4, sy - 4, 9, 3); x.fillRect(sx - 2, sy - 6, 5, 2);
    x.fillStyle = '#1a1206'; x.fillRect(sx - 1, sy + 1, 3, 4);
    label('TEMPLE', sx, sy + 8);
  }
  /* Castaways: your own chores, ticked as you go. Nobody else's list is
     drawn — knowing where everyone is supposed to be would hand the game
     away. */
  for (const j of (data.jobs || [])) {
    const [sx, sy] = toPx(j.x, j.z);
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
  }
  // ghosts get to watch the living move about
  for (const o of (data.others || [])) {
    const [sx, sy] = toPx(o.x, o.z);
    x.fillStyle = '#000'; x.fillRect(sx - 3, sy - 3, 6, 6);
    x.fillStyle = '#' + (o.colour >>> 0).toString(16).padStart(6, '0');
    x.fillRect(sx - 2, sy - 2, 4, 4);
  }
  if (data.player) {
    const [sx, sy] = toPx(data.player.x, data.player.z);
    x.fillStyle = '#c02a1a'; x.fillRect(sx - 2, sy - 2, 5, 5);
    x.fillStyle = '#fff'; x.fillRect(sx - 1, sy - 1, 3, 3);
  }

  // compass rose + border
  x.fillStyle = '#3f2f14';
  drawText(x, 'N', { x: ox + S - 12, y: oy + 5, scale: 1, align: 'center', color: '#3f2f14', shadowColor: PAPER });
  x.fillRect(ox + S - 13, oy + 14, 3, 8);
  x.fillRect(ox + S - 15, oy + 16, 7, 2);
  x.fillStyle = '#5c3f1c';
  x.fillRect(ox, oy, S, 2); x.fillRect(ox, oy + S - 2, S, 2);
  x.fillRect(ox, oy, 2, S); x.fillRect(ox + S - 2, oy, 2, S);
}

/* ---------- Ferdi, in pixels ---------- */
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
