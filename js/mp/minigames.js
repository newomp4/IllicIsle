/* ===========================================================
   minigames.js — the chores that are actually something to do.

   A hold-E bar is a delay, not a task. These are small, animated
   and quick to understand, but they take long enough that you
   cannot clear your whole list in ninety seconds — and, more to
   the point, they take your eyes off the world while you do them,
   which is exactly the window an Agent is looking for.

   Every game is the same shape:
     init(s, rng)          set up state on the screen object
     draw(x, W, H, s, t)   paint it; return hit rows for the mouse
     key(code, s)          -> true when the game is solved
     click(row, i, s)      -> true when the game is solved
   Nothing here knows about the network; the screen reports "done"
   and the game sends the same DO_TASK it always did.
   =========================================================== */

const GOLD = '#ffd24a';
const GOLD_LT = '#fff3c4';
const DIM = '#8a7a52';
const JADE = '#63c6a8';
const RED = '#e0453a';
const INK = '#0a0704';

/* ---------- shared chrome ---------- */
function bar(x, bx, by, bw, bh, k, colour) {
  x.fillStyle = INK; x.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  x.fillStyle = '#231708'; x.fillRect(bx, by, bw, bh);
  const n = Math.round(Math.max(0, Math.min(1, k)) * bw);
  for (let i = 0; i < n; i += 3) {
    x.fillStyle = i % 6 ? colour : '#fff3c4';
    x.fillRect(bx + i, by, 2, bh);
  }
}

function plate(x, ox, oy, w, h, hot) {
  x.fillStyle = hot ? '#3a2a10' : '#1a1208';
  x.fillRect(ox, oy, w, h);
  x.fillStyle = hot ? GOLD : '#5c3f1c';
  x.fillRect(ox, oy, w, 1); x.fillRect(ox, oy + h - 1, w, 1);
  x.fillRect(ox, oy, 1, h); x.fillRect(ox + w - 1, oy, 1, h);
}

/* ===========================================================
   1. WIND THE PENDULUM — catch the bob at the top of its arc.
   Three good catches. Miss and the swing speeds up.
   =========================================================== */
const wind = {
  name: 'WIND IT',
  hint: 'SPACE ON THE MARK',
  init(s) { s.phase = 0; s.speed = 1.5; s.got = 0; s.need = 3; s.flash = 0; },
  draw(x, W, H, s, t, dt) {
    s.phase += dt * s.speed;
    if (s.flash > 0) s.flash -= dt * 3;
    const swing = Math.sin(s.phase);
    const cx = W / 2, top = 44;

    // the target window, drawn as a lit arc at the extremes
    const inWindow = Math.abs(swing) > 0.88;
    x.fillStyle = inWindow ? 'rgba(126,200,80,.22)' : 'rgba(255,210,74,.08)';
    x.fillRect(cx - 96, top - 6, 40, 78);
    x.fillRect(cx + 56, top - 6, 40, 78);

    // the arm and bob
    const ax = cx + swing * 76, ay = top + 62 - Math.abs(swing) * 8;
    x.strokeStyle = '#8a7a52'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx, top); x.lineTo(ax, ay); x.stroke();
    x.fillStyle = '#5c3f1c'; x.fillRect(cx - 4, top - 4, 9, 8);
    const lit = s.flash > 0;
    x.fillStyle = lit ? '#dfffc4' : (inWindow ? JADE : GOLD);
    x.fillRect(Math.round(ax) - 5, Math.round(ay) - 5, 11, 11);
    x.fillStyle = INK;
    x.fillRect(Math.round(ax) - 2, Math.round(ay) - 2, 5, 5);

    // marks for how many catches you have
    for (let i = 0; i < s.need; i++) {
      const mx = cx - (s.need * 12) / 2 + i * 12;
      x.fillStyle = i < s.got ? JADE : '#3a2a10';
      x.fillRect(mx, H - 46, 9, 9);
    }
    return [];
  },
  key(code, s) {
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;
    const swing = Math.sin(s.phase);
    if (Math.abs(swing) > 0.88) { s.got++; s.flash = 1; s.speed += 0.25; }
    else { s.speed = Math.max(1.2, s.speed - 0.15); s.got = Math.max(0, s.got - 1); }
    return s.got >= s.need;
  },
};

/* ===========================================================
   2. SPLICE THE OPTIC — match the colour that is calling.
   Simon, three rounds, four colours.
   =========================================================== */
const splice = {
  name: 'SPLICE THE OPTIC',
  hint: 'REPEAT WHAT IT SHOWS',
  COLS: ['#e0453a', '#46a04a', '#3f6fd0', '#e0c040'],
  init(s, rng) {
    s.seq = [0, 1, 2].map(() => (rng() * 4) | 0);
    s.at = 0; s.showing = 0; s.showT = 0; s.playing = true; s.wrong = 0;
  },
  draw(x, W, H, s, t, dt) {
    const rows = [];
    if (s.playing) {
      s.showT += dt;
      if (s.showT > 0.55) { s.showT = 0; s.showing++; }
      if (s.showing >= s.seq.length + 1) { s.playing = false; s.showing = -1; s.at = 0; }
    }
    if (s.wrong > 0) s.wrong -= dt * 2;

    const bw = 42, bh = 34, gap = 6;
    const total = 4 * bw + 3 * gap;
    const ox = Math.round((W - total) / 2), oy = 52;
    for (let i = 0; i < 4; i++) {
      const bx = ox + i * (bw + gap);
      const on = s.playing && s.showing < s.seq.length && s.seq[s.showing] === i && s.showT < 0.38;
      x.fillStyle = on ? this.COLS[i] : '#1a1208';
      x.fillRect(bx, oy, bw, bh);
      x.fillStyle = this.COLS[i];
      x.fillRect(bx, oy, bw, 1); x.fillRect(bx, oy + bh - 1, bw, 1);
      x.fillRect(bx, oy, 1, bh); x.fillRect(bx + bw - 1, oy, 1, bh);
      x.fillStyle = on ? '#ffffff' : this.COLS[i];
      x.fillRect(bx + bw / 2 - 5, oy + bh / 2 - 5, 10, 10);
      drawKeyCap(x, String(i + 1), bx + bw / 2, oy + bh + 4);
      rows.push({ x: bx, y: oy, w: bw, h: bh, pick: i });
    }
    // progress pips
    for (let i = 0; i < s.seq.length; i++) {
      const mx = W / 2 - (s.seq.length * 12) / 2 + i * 12;
      x.fillStyle = i < s.at ? JADE : '#3a2a10';
      x.fillRect(mx, H - 46, 9, 9);
    }
    if (s.wrong > 0) {
      x.fillStyle = `rgba(224,69,58,${(s.wrong * 0.25).toFixed(2)})`;
      x.fillRect(0, 0, W, H);
    }
    return rows;
  },
  _hit(i, s) {
    if (s.playing) return false;
    if (s.seq[s.at] === i) {
      s.at++;
      return s.at >= s.seq.length;
    }
    s.wrong = 1; s.at = 0; s.playing = true; s.showing = 0; s.showT = 0;
    return false;
  },
  key(code, s) {
    const m = /^Digit([1-4])$/.exec(code);
    if (!m) return false;
    return this._hit(Number(m[1]) - 1, s);
  },
  click(row, i, s) { return row?.pick !== undefined ? this._hit(row.pick, s) : false; },
};

/* ===========================================================
   3. PATCH THE SAIL — stitch along a line, in order.
   =========================================================== */
const stitch = {
  name: 'PATCH THE SAIL',
  hint: 'CLICK THE HOLES IN ORDER',
  init(s, rng) {
    s.pts = [];
    for (let i = 0; i < 6; i++) {
      s.pts.push({
        x: 0.16 + (i / 5) * 0.68 + (rng() - 0.5) * 0.07,
        y: 0.3 + Math.sin(i * 1.1 + rng()) * 0.22,
      });
    }
    s.at = 0; s.wrong = 0;
  },
  draw(x, W, H, s, t, dt) {
    if (s.wrong > 0) s.wrong -= dt * 2;
    // the sail
    const sx = 30, sy = 44, sw = W - 60, sh = H - 96;
    x.fillStyle = '#cabfa0'; x.fillRect(sx, sy, sw, sh);
    ditherPatch(x, sx, sy, sw, sh);
    x.fillStyle = '#a89878';
    x.fillRect(sx, sy, sw, 1); x.fillRect(sx, sy + sh - 1, sw, 1);
    x.fillRect(sx, sy, 1, sh); x.fillRect(sx + sw - 1, sy, 1, sh);
    // the tear
    x.strokeStyle = '#6a5a3a'; x.lineWidth = 1;
    x.beginPath();
    s.pts.forEach((p, i) => {
      const px = sx + p.x * sw, py = sy + p.y * sh;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    });
    x.stroke();

    const rows = [];
    s.pts.forEach((p, i) => {
      const px = Math.round(sx + p.x * sw), py = Math.round(sy + p.y * sh);
      const done = i < s.at;
      const next = i === s.at;
      x.fillStyle = done ? JADE : (next ? GOLD : '#8a7a52');
      if (next) {
        const pulse = 2 + Math.round((Math.sin(t * 7) * 0.5 + 0.5) * 2);
        x.fillRect(px - pulse, py - pulse, pulse * 2 + 1, pulse * 2 + 1);
      } else {
        x.fillRect(px - 2, py - 2, 5, 5);
      }
      x.fillStyle = INK; x.fillRect(px - 1, py - 1, 3, 3);
      rows.push({ x: px - 7, y: py - 7, w: 15, h: 15, pick: i });
    });
    // the thread already run
    if (s.at > 1) {
      x.strokeStyle = JADE;
      x.beginPath();
      for (let i = 0; i < s.at; i++) {
        const px = sx + s.pts[i].x * sw, py = sy + s.pts[i].y * sh;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
    }
    if (s.wrong > 0) {
      x.fillStyle = `rgba(224,69,58,${(s.wrong * 0.22).toFixed(2)})`;
      x.fillRect(0, 0, W, H);
    }
    return rows;
  },
  click(row, i, s) {
    if (row?.pick === undefined) return false;
    if (row.pick === s.at) { s.at++; return s.at >= s.pts.length; }
    s.wrong = 1; s.at = 0;
    return false;
  },
  key() { return false; },
};

/* ===========================================================
   4. SET THE DIALS — three wheels to a target reading.
   =========================================================== */
const dials = {
  name: 'SET THE DIALS',
  hint: 'ARROWS TURN   TAB NEXT',
  init(s, rng) {
    s.want = [0, 0, 0].map(() => 1 + ((rng() * 8) | 0));
    s.have = [0, 0, 0].map(() => 1 + ((rng() * 8) | 0));
    s.sel = 0;
    // never start solved
    if (s.want.every((v, i) => v === s.have[i])) s.have[0] = (s.have[0] % 9) + 1;
  },
  draw(x, W, H, s, t) {
    const rows = [];
    const dw = 40, gap = 12;
    const total = 3 * dw + 2 * gap;
    const ox = Math.round((W - total) / 2), oy = 54;
    for (let i = 0; i < 3; i++) {
      const bx = ox + i * (dw + gap);
      const ok = s.have[i] === s.want[i];
      plate(x, bx, oy, dw, 46, i === s.sel);
      // the wheel, showing the neighbours above and below
      for (const [d, sc, col] of [[-1, 1, '#5c4a24'], [0, 2, ok ? JADE : GOLD_LT], [1, 1, '#5c4a24']]) {
        const v = ((s.have[i] - 1 + d + 9) % 9) + 1;
        drawBigDigit(x, v, bx + dw / 2, oy + 23 + d * 15, sc, col);
      }
      // the target
      drawBigDigit(x, s.want[i], bx + dw / 2, oy + 54, 1, ok ? JADE : '#8a7a52');
      x.fillStyle = ok ? JADE : '#3a2a10';
      x.fillRect(bx, oy + 48, dw, 1);
      rows.push({ x: bx, y: oy, w: dw, h: 46, pick: i });
    }
    drawText3(x, 'TARGET', W / 2, oy + 66, DIM);
    return rows;
  },
  _solved(s) { return s.want.every((v, i) => v === s.have[i]); },
  key(code, s) {
    if (code === 'ArrowLeft' || code === 'KeyA') { s.sel = (s.sel + 2) % 3; return false; }
    if (code === 'ArrowRight' || code === 'KeyD' || code === 'Tab') { s.sel = (s.sel + 1) % 3; return false; }
    if (code === 'ArrowUp' || code === 'KeyW') { s.have[s.sel] = (s.have[s.sel] % 9) + 1; return this._solved(s); }
    if (code === 'ArrowDown' || code === 'KeyS') { s.have[s.sel] = ((s.have[s.sel] + 7) % 9) + 1; return this._solved(s); }
    return false;
  },
  click(row, i, s) {
    if (row?.pick === undefined) return false;
    if (row.pick !== s.sel) { s.sel = row.pick; return false; }
    s.have[s.sel] = (s.have[s.sel] % 9) + 1;
    return this._solved(s);
  },
};

/* ===========================================================
   5. BAIL OUT THE HULL — keep the water down. Timed, not clicky.
   =========================================================== */
const bail = {
  name: 'BAIL OUT THE HULL',
  hint: 'SPACE TO BAIL',
  init(s) { s.level = 0.82; s.wob = 0; s.pump = 0; },
  draw(x, W, H, s, t, dt) {
    s.level = Math.min(1, s.level + dt * 0.085);
    s.wob += dt;
    if (s.pump > 0) s.pump -= dt * 4;

    const hx = 40, hy = 44, hw = W - 80, hh = H - 100;
    x.fillStyle = '#3a2a18'; x.fillRect(hx, hy, hw, hh);
    // ribs
    for (let i = 1; i < 6; i++) {
      x.fillStyle = '#4a3722';
      x.fillRect(hx + Math.round((i / 6) * hw), hy, 2, hh);
    }
    // the water
    const wy = Math.round(hy + hh - s.level * hh);
    for (let yy = wy; yy < hy + hh; yy++) {
      const k = (yy - wy) / Math.max(1, hy + hh - wy);
      x.fillStyle = `rgb(${Math.round(28 + k * 6)},${Math.round(64 - k * 18)},${Math.round(104 - k * 30)})`;
      x.fillRect(hx, yy, hw, 1);
    }
    for (let i = 0; i < 5; i++) {
      const off = Math.sin(s.wob * 2 + i) * 8;
      x.fillStyle = 'rgba(150,200,225,.35)';
      x.fillRect(hx + 6 + ((i * 37 + off + hw) % (hw - 20)), wy + 2 + i * 4, 14, 1);
    }
    x.fillStyle = '#9fd8ff'; x.fillRect(hx, wy, hw, 1);
    x.fillStyle = '#5c3f1c';
    x.fillRect(hx, hy, hw, 1); x.fillRect(hx, hy + hh - 1, hw, 1);
    x.fillRect(hx, hy, 1, hh); x.fillRect(hx + hw - 1, hy, 1, hh);

    // the bucket
    const bxp = Math.round(W / 2 - 8);
    const byp = Math.round(hy + hh - 26 - s.pump * 16);
    x.fillStyle = '#8a7048'; x.fillRect(bxp, byp, 16, 12);
    x.fillStyle = '#6a5432'; x.fillRect(bxp + 1, byp + 1, 14, 3);

    bar(x, 40, H - 50, W - 80, 6, 1 - s.level, s.level > 0.9 ? RED : JADE);
    drawText3(x, s.level > 0.9 ? 'SHE IS GOING DOWN' : 'KEEP IT UNDER THE LINE',
      W / 2, H - 40, s.level > 0.9 ? RED : DIM);
    return [];
  },
  key(code, s) {
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;
    s.level = Math.max(0, s.level - 0.115);
    s.pump = 1;
    return s.level <= 0.02;
  },
};

export const MINIGAMES = { wind, splice, stitch, dials, bail };

/* ---------- little drawing helpers, kept local ---------- */
let _draw = null;
/** screens.js injects its own text routine so the font stays in one place. */
export function bindText(fn) { _draw = fn; }
function drawText3(x, str, cx, cy, col) { _draw?.(x, str, { x: cx, y: cy, scale: 1, align: 'center', color: col }); }
function drawKeyCap(x, str, cx, cy) {
  x.fillStyle = '#2a1c0e'; x.fillRect(cx - 5, cy, 11, 10);
  x.fillStyle = '#5c3f1c'; x.fillRect(cx - 5, cy, 11, 1);
  _draw?.(x, str, { x: cx, y: cy + 2, scale: 1, align: 'center', color: GOLD_LT });
}
function drawBigDigit(x, v, cx, cy, scale, col) {
  _draw?.(x, String(v), { x: cx, y: cy - (scale === 2 ? 7 : 3), scale, align: 'center', color: col });
}
function ditherPatch(x, ox, oy, w, h) {
  for (let j = 0; j < h; j += 2) {
    for (let i = 0; i < w; i += 2) {
      if (((i + j) >> 1) % 3) continue;
      x.fillStyle = 'rgba(160,148,120,.35)';
      x.fillRect(ox + i, oy + j, 2, 2);
    }
  }
}
