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
  init(s) {
    // a storm has the whole thing juddering, and asks for more of it
    s.phase = 0;
    s.speed = s.hard ? 1.9 : 1.35;
    s.got = 0;
    s.need = s.hard ? 7 : 5;
    s.flash = 0; s.miss = 0;
    s.window = s.hard ? 0.93 : 0.90;
    s.spark = [];
  },
  draw(x, W, H, s, t, dt) {
    s.phase += dt * s.speed;
    if (s.flash > 0) s.flash -= dt * 3;
    if (s.miss > 0) s.miss -= dt * 2.5;
    const swing = Math.sin(s.phase);
    const cx = W / 2, top = 40;
    const inWindow = Math.abs(swing) > s.window;

    /* the tower it hangs in, so it is a machine and not a metronome */
    x.fillStyle = '#241708';
    x.fillRect(cx - 78, top - 12, 156, 6);
    x.fillRect(cx - 78, top - 12, 6, 104);
    x.fillRect(cx + 72, top - 12, 6, 104);
    x.fillStyle = '#3a2a10';
    for (let i = 0; i < 7; i++) x.fillRect(cx - 72 + i * 22, top - 10, 2, 2);
    // toothed rim it has to be caught on
    for (let i = 0; i <= 18; i++) {
      const a2 = -Math.PI * 0.5 + (i / 18 - 0.5) * 2.1;
      const rx = cx + Math.sin(a2) * 88, ry = top + 62 + Math.cos(a2) * 12;
      const near = Math.abs(Math.sin(a2)) > s.window * 0.98;
      x.fillStyle = near ? (inWindow ? '#7ec850' : '#c39a2c') : '#4a3a1c';
      x.fillRect(Math.round(rx) - 1, Math.round(ry), 3, 4);
    }

    // the lit catch zones
    x.fillStyle = inWindow ? 'rgba(126,200,80,.20)' : 'rgba(255,210,74,.07)';
    const zw = Math.round(96 * (1 - s.window) + 14);
    x.fillRect(cx - 88 - zw / 2, top - 4, zw, 80);
    x.fillRect(cx + 88 - zw / 2, top - 4, zw, 80);

    // arm, bob, and a trail behind it
    for (let i = 6; i >= 1; i--) {
      const sw = Math.sin(s.phase - i * 0.07);
      const tx = cx + sw * 76, ty = top + 62 - Math.abs(sw) * 8;
      x.fillStyle = `rgba(200,170,80,${(0.05 * (7 - i)).toFixed(2)})`;
      x.fillRect(Math.round(tx) - 3, Math.round(ty) - 3, 7, 7);
    }
    const ax = cx + swing * 76, ay = top + 62 - Math.abs(swing) * 8;
    x.strokeStyle = '#8a7a52'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx, top); x.lineTo(ax, ay); x.stroke();
    x.fillStyle = '#5c3f1c'; x.fillRect(cx - 5, top - 5, 11, 10);
    x.fillStyle = '#8a7a52'; x.fillRect(cx - 2, top - 3, 5, 5);
    const lit = s.flash > 0;
    x.fillStyle = lit ? '#dfffc4' : (inWindow ? JADE : GOLD);
    x.fillRect(Math.round(ax) - 6, Math.round(ay) - 6, 13, 13);
    x.fillStyle = INK; x.fillRect(Math.round(ax) - 3, Math.round(ay) - 3, 7, 7);
    x.fillStyle = lit ? '#ffffff' : (inWindow ? '#9ff0dc' : '#c39a2c');
    x.fillRect(Math.round(ax) - 1, Math.round(ay) - 1, 3, 3);

    // sparks thrown off a good catch
    for (let i = s.spark.length - 1; i >= 0; i--) {
      const sp = s.spark[i];
      sp.t += dt; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 90 * dt;
      if (sp.t > 0.5) { s.spark.splice(i, 1); continue; }
      x.fillStyle = sp.t < 0.25 ? '#ffffff' : '#9ff0dc';
      x.fillRect(Math.round(sp.x), Math.round(sp.y), 2, 2);
    }

    // the count, and how tight the window has become
    for (let i = 0; i < s.need; i++) {
      const mx = cx - (s.need * 13) / 2 + i * 13;
      x.fillStyle = i < s.got ? JADE : '#3a2a10';
      x.fillRect(mx, H - 44, 10, 10);
      if (i < s.got) { x.fillStyle = '#dfffc4'; x.fillRect(mx + 3, H - 41, 4, 4); }
    }
    if (s.miss > 0) {
      x.fillStyle = `rgba(224,69,58,${(s.miss * 0.22).toFixed(2)})`;
      x.fillRect(0, 0, W, H);
    }
    return [];
  },
  key(code, s) {
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;
    const swing = Math.sin(s.phase);
    if (Math.abs(swing) > s.window) {
      s.got++;
      s.flash = 1;
      // each catch winds it tighter: faster, and a narrower window
      s.speed += 0.34;
      s.window = Math.min(0.965, s.window + 0.016);
      const cx = 160, ax = cx + swing * 76;
      for (let i = 0; i < 7; i++) {
        s.spark.push({
          x: ax, y: 100, t: 0,
          vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 70,
        });
      }
    } else {
      s.miss = 1;
      s.speed = Math.max(1.2, s.speed - 0.2);
      s.window = Math.max(0.86, s.window - 0.01);
      s.got = Math.max(0, s.got - 1);
    }
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
    s.seq = new Array(s.hard ? 5 : 3).fill(0).map(() => (rng() * 4) | 0);
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
  hint: 'FOLLOW THE TEAR   BOTH SIDES',
  init(s, rng) {
    /* Two tears, ten holes, and they alternate sides — so it is a route to
       walk rather than six dots in a row you can sweep through. */
    s.tears = [];
    const TEARS = s.hard ? 3 : 2;
    for (let tear = 0; tear < TEARS; tear++) {
      const pts = [];
      const y0 = 0.20 + tear * (TEARS > 2 ? 0.28 : 0.40);
      for (let i = 0; i < 5; i++) {
        pts.push({
          x: 0.12 + (i / 4) * 0.76 * (tear ? -1 : 1) + (tear ? 0.88 : 0) + (rng() - 0.5) * 0.05,
          y: y0 + Math.sin(i * 1.4 + tear * 2.1 + rng() * 0.5) * 0.13,
        });
      }
      s.tears.push(pts);
    }
    s.order = [];
    for (let i = 0; i < 5; i++) for (let tr = 0; tr < TEARS; tr++) s.order.push([tr, i]);
    s.at = 0; s.wrong = 0; s.pull = 0;
  },
  draw(x, W, H, s, t, dt) {
    if (s.wrong > 0) s.wrong -= dt * 2;
    if (s.pull > 0) s.pull -= dt * 3;

    const sx = 26, sy = 40, sw = W - 52, sh = H - 92;
    // canvas, with a weave and a wind-billow in it
    x.fillStyle = '#cabfa0'; x.fillRect(sx, sy, sw, sh);
    for (let j = 0; j < sh; j += 3) {
      const shade = 0.06 + Math.sin(j * 0.13 + t * 0.8) * 0.05;
      x.fillStyle = `rgba(120,106,80,${Math.max(0, shade).toFixed(3)})`;
      x.fillRect(sx, sy + j, sw, 1);
    }
    ditherPatch(x, sx, sy, sw, sh);
    // bolt ropes and grommets
    x.fillStyle = '#8a7450';
    x.fillRect(sx, sy, sw, 2); x.fillRect(sx, sy + sh - 2, sw, 2);
    x.fillRect(sx, sy, 2, sh); x.fillRect(sx + sw - 2, sy, 2, sh);
    for (let i = 0; i <= 6; i++) {
      const gx = sx + 4 + (i / 6) * (sw - 8);
      x.fillStyle = '#6a5a3a'; x.fillRect(Math.round(gx) - 2, sy + 1, 4, 4);
      x.fillStyle = '#cabfa0'; x.fillRect(Math.round(gx) - 1, sy + 2, 2, 2);
    }

    const rows = [];
    const P = (tear, i) => ({
      x: Math.round(sx + s.tears[tear][i].x * sw),
      y: Math.round(sy + s.tears[tear][i].y * sh),
    });

    // the tears themselves, gaping until they are sewn
    s.tears.forEach((pts, tear) => {
      const doneTo = s.order.slice(0, s.at).filter(([w]) => w === tear).length;
      x.strokeStyle = '#5a4a2c'; x.lineWidth = 2;
      x.beginPath();
      pts.forEach((p, i) => {
        const q = P(tear, i);
        if (i === 0) x.moveTo(q.x, q.y); else x.lineTo(q.x, q.y);
      });
      x.stroke();
      // sewn section, drawn as stitches rather than a line
      if (doneTo > 1) {
        for (let i = 0; i < doneTo - 1; i++) {
          const p0 = P(tear, i), p1 = P(tear, i + 1);
          for (let k = 0; k <= 6; k++) {
            const px = p0.x + (p1.x - p0.x) * (k / 6);
            const py = p0.y + (p1.y - p0.y) * (k / 6);
            x.fillStyle = k % 2 ? '#2f6a4a' : JADE;
            x.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
          }
        }
      }
    });

    // the holes
    const nextKey = s.order[s.at];
    s.order.forEach(([tear, i], idx) => {
      const q = P(tear, i);
      const done = idx < s.at;
      const next = nextKey && nextKey[0] === tear && nextKey[1] === i;
      if (next) {
        const pulse = 3 + Math.round((Math.sin(t * 8) * 0.5 + 0.5) * 3);
        x.fillStyle = 'rgba(255,210,74,.35)';
        x.fillRect(q.x - pulse - 1, q.y - pulse - 1, pulse * 2 + 3, pulse * 2 + 3);
        x.fillStyle = GOLD;
        x.fillRect(q.x - 3, q.y - 3, 7, 7);
      } else {
        x.fillStyle = done ? JADE : '#7a6a48';
        x.fillRect(q.x - 2, q.y - 2, 5, 5);
      }
      x.fillStyle = done ? '#0d2a1c' : INK;
      x.fillRect(q.x - 1, q.y - 1, 3, 3);
      if (!done) rows.push({ x: q.x - 7, y: q.y - 7, w: 15, h: 15, tear, idx });
    });

    // the needle, sitting on the next hole
    if (nextKey) {
      const q = P(nextKey[0], nextKey[1]);
      const bob = Math.round(Math.sin(t * 5) * 2) - Math.round(s.pull * 4);
      x.fillStyle = '#d8dde0';
      x.fillRect(q.x + 5, q.y - 12 + bob, 1, 9);
      x.fillRect(q.x + 4, q.y - 4 + bob, 3, 2);
      x.fillStyle = '#8fd8c4';
      x.fillRect(q.x + 6, q.y - 13 + bob, 3, 1);
    }

    bar(x, 30, H - 40, W - 60, 5, s.at / s.order.length, JADE);
    drawText3(x, `${s.at} OF ${s.order.length} STITCHES`, W / 2, H - 30, DIM);
    if (s.wrong > 0) {
      x.fillStyle = `rgba(224,69,58,${(s.wrong * 0.22).toFixed(2)})`;
      x.fillRect(0, 0, W, H);
    }
    return rows;
  },
  click(row, i, s) {
    if (!row || row.idx === undefined) return false;
    if (row.idx === s.at) {
      s.at++; s.pull = 1;
      return s.at >= s.order.length;
    }
    s.wrong = 1;
    // drop back to the start of the tear you botched, not the whole sail
    const tear = s.order[s.at]?.[0] ?? 0;
    while (s.at > 0 && s.order[s.at - 1][0] === tear) s.at--;
    return false;
  },
  key() { return false; },
};

/* ===========================================================
   4. SET THE DIALS — three wheels to a target reading.
   =========================================================== */
const dials = {
  name: 'SET THE DIALS',
  hint: 'CLICK A WHEEL   ARROWS TURN IT',
  init(s, rng) {
    const n = s.hard ? 4 : 3;
    s.want = []; s.have = [];
    for (let i = 0; i < n; i++) {
      s.want.push(1 + ((rng() * 9) | 0));
      s.have.push(1 + ((rng() * 9) | 0));
    }
    s.sel = 0; s.spin = new Array(n).fill(0);
    if (s.want.every((v, i) => v === s.have[i])) s.have[0] = (s.have[0] % 9) + 1;
  },
  draw(x, W, H, s, t, dt) {
    const rows = [];
    const n = s.have.length;
    const dw = n > 3 ? 34 : 42, gap = 10;
    const total = n * dw + (n - 1) * gap;
    const ox = Math.round((W - total) / 2), oy = 50;

    // a brass housing behind the whole rack
    x.fillStyle = '#2b2010';
    x.fillRect(ox - 10, oy - 12, total + 20, 92);
    ditherRect2(x, ox - 10, oy - 12, total + 20, 92);
    x.fillStyle = '#6b5220';
    x.fillRect(ox - 10, oy - 12, total + 20, 2);
    x.fillRect(ox - 10, oy + 78, total + 20, 2);
    for (const rx of [ox - 7, ox + total + 4]) {
      x.fillStyle = '#8a6a2a'; x.fillRect(rx, oy - 9, 3, 3);
      x.fillRect(rx, oy + 72, 3, 3);
    }

    for (let i = 0; i < n; i++) {
      const bx = ox + i * (dw + gap);
      const ok = s.have[i] === s.want[i];
      if (s.spin[i] > 0) s.spin[i] -= dt * 5;

      // the drum
      x.fillStyle = '#120c06'; x.fillRect(bx, oy, dw, 48);
      for (let j = 0; j < 48; j += 2) {
        const sh = 0.10 + Math.abs(j - 24) / 24 * 0.22;
        x.fillStyle = `rgba(0,0,0,${sh.toFixed(2)})`;
        x.fillRect(bx, oy + j, dw, 1);
      }
      const off = Math.round((s.spin[i] || 0) * 12);
      for (const [d, sc, col] of [[-1, 1, '#4a3a1c'], [0, 2, ok ? JADE : GOLD_LT], [1, 1, '#4a3a1c']]) {
        const v = ((s.have[i] - 1 + d + 9) % 9) + 1;
        drawBigDigit(x, v, bx + dw / 2, oy + 25 + d * 16 + off, sc, col);
      }
      // the window frame over it
      x.fillStyle = ok ? JADE : '#8a6a2a';
      x.fillRect(bx, oy + 16, dw, 1); x.fillRect(bx, oy + 32, dw, 1);
      x.fillStyle = i === s.sel ? GOLD : '#5c3f1c';
      x.fillRect(bx, oy, dw, 1); x.fillRect(bx, oy + 47, dw, 1);
      x.fillRect(bx, oy, 1, 48); x.fillRect(bx + dw - 1, oy, 1, 48);
      if (i === s.sel) {
        // little arrows showing which way it turns
        x.fillStyle = GOLD;
        x.fillRect(bx + dw / 2 - 2, oy - 6, 5, 1);
        x.fillRect(bx + dw / 2 - 1, oy - 7, 3, 1);
        x.fillRect(bx + dw / 2 - 2, oy + 52, 5, 1);
        x.fillRect(bx + dw / 2 - 1, oy + 53, 3, 1);
      }

      // what it has to read
      x.fillStyle = ok ? '#14301f' : '#2a1c0c';
      x.fillRect(bx, oy + 54, dw, 14);
      x.fillStyle = ok ? JADE : '#5c3f1c';
      x.fillRect(bx, oy + 54, dw, 1); x.fillRect(bx, oy + 67, dw, 1);
      drawBigDigit(x, s.want[i], bx + dw / 2, oy + 61, 1, ok ? JADE : '#a89050');
      rows.push({ x: bx, y: oy, w: dw, h: 48, pick: i });
    }
    drawText3(x, 'MATCH THE PLATE', W / 2, oy + 74, DIM);
    const done = s.want.filter((v, i) => v === s.have[i]).length;
    bar(x, 40, H - 40, W - 80, 5, done / n, JADE);
    return rows;
  },
  _solved(s) { return s.want.every((v, i) => v === s.have[i]); },
  _turn(s, dir) {
    const n = 9;
    s.have[s.sel] = ((s.have[s.sel] - 1 + dir + n) % n) + 1;
    s.spin[s.sel] = dir > 0 ? 1 : -1;
    return this._solved(s);
  },
  key(code, s) {
    const n = s.have.length;
    if (code === 'ArrowLeft' || code === 'KeyA') { s.sel = (s.sel + n - 1) % n; return false; }
    if (code === 'ArrowRight' || code === 'KeyD' || code === 'Tab') { s.sel = (s.sel + 1) % n; return false; }
    if (code === 'ArrowUp' || code === 'KeyW') return this._turn(s, 1);
    if (code === 'ArrowDown' || code === 'KeyS') return this._turn(s, -1);
    return false;
  },
  click(row, i, s) {
    if (row?.pick === undefined) return false;
    if (row.pick !== s.sel) { s.sel = row.pick; return false; }
    return this._turn(s, 1);
  },
};

/* ===========================================================
   5. BAIL OUT THE HULL — keep the water down. Timed, not clicky.
   =========================================================== */
const bail = {
  name: 'BAIL OUT THE HULL',
  hint: 'SPACE TO BAIL',
  init(s) { s.level = s.hard ? 0.9 : 0.82; s.rate = s.hard ? 0.15 : 0.085; s.wob = 0; s.pump = 0; },
  draw(x, W, H, s, t, dt) {
    s.level = Math.min(1, s.level + dt * (s.rate || 0.085));
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
function ditherRect2(x, ox, oy, w, h) {
  for (let j = 0; j < h; j += 2) {
    for (let i = 0; i < w; i += 2) {
      if (((i + j) >> 1) % 2) continue;
      x.fillStyle = 'rgba(0,0,0,.22)';
      x.fillRect(ox + i, oy + j, 2, 2);
    }
  }
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
