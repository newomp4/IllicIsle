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
  hint: 'SPACE AT THE TOP OF THE ARC',
  init(s) {
    // a storm has the whole thing juddering, and asks for more of it
    s.phase = 0;
    s.speed = s.hard ? 1.9 : 1.35;
    s.got = 0;
    s.need = s.hard ? 7 : 5;
    s.flash = 0; s.miss = 0;
    s.window = s.hard ? 0.93 : 0.90;
    s.spark = [];
    s.ring = -1;          // the shock ring thrown by a good catch
    s.ringX = 0;
    s.ringY = 100;
    s.shake = 0;
    s.ratchet = 0;        // the escape wheel, one tooth per catch
  },
  draw(x, W, H, s, t, dt) {
    s.phase += dt * s.speed;
    if (s.flash > 0) s.flash -= dt * 3;
    if (s.miss > 0) s.miss -= dt * 2.5;
    if (s.shake > 0) s.shake -= dt * 4;
    if (s.ring >= 0) { s.ring += dt * 2.6; if (s.ring > 1) s.ring = -1; }
    s.ratchet += dt * (s.flash > 0 ? 6 : 0.35);

    const swing = Math.sin(s.phase);
    const inWindow = Math.abs(swing) > s.window;

    /* True pendulum kinematics. The old version moved the bob along a
       horizontal line with a token vertical wobble, which is why it read as
       a box sliding about rather than a weight on a rod. It travels on an
       arc now: the angle is what swings, and the position follows from it. */
    const MAXA = 1.02;                  // radians either side of vertical
    const ang = swing * MAXA;
    const shk = s.shake > 0 ? Math.round(Math.sin(s.shake * 70) * 2 * s.shake) : 0;
    /* The pivot sits below the frame's title rule, which is at y = 28. The
       gantry used to be drawn from y = 18 — straight through the title — and
       its bracing was a row of dots that ran clean across the top of the
       panel. That was most of what looked broken about this. */
    const px = W / 2 + shk, py = 50;
    const L = 84;                       // rod length
    const bx = px + Math.sin(ang) * L;
    const by = py + Math.cos(ang) * L;
    const TOP = 38;                     // the gantry's head beam
    const FOOT = 152;                   // and where its legs stand

    /* ---- the gantry ---- */
    {
      const HW = 86;
      x.fillStyle = '#241708';
      x.fillRect(px - HW, TOP, HW * 2, 7);              // head beam
      x.fillRect(px - HW, TOP, 7, FOOT - TOP);          // legs
      x.fillRect(px + HW - 7, TOP, 7, FOOT - TOP);
      x.fillRect(px - HW, FOOT - 6, HW * 2, 6);         // sill
      // a lit top edge, so it reads as timber rather than a hole
      x.fillStyle = '#3a2a10';
      x.fillRect(px - HW, TOP, HW * 2, 1);
      x.fillRect(px - HW, FOOT - 6, HW * 2, 1);
      // bolts, four of them, at the joints
      for (const [rx, ry] of [[px - HW + 2, TOP + 2], [px + HW - 6, TOP + 2],
        [px - HW + 2, FOOT - 5], [px + HW - 6, FOOT - 5]]) {
        x.fillStyle = '#8a7a52'; x.fillRect(rx, ry, 4, 4);
        x.fillStyle = '#241708'; x.fillRect(rx + 1, ry + 1, 2, 2);
      }
      /* Diagonal braces in the top corners — drawn as short stepped runs
         from the beam down to the leg, which is what a brace looks like. */
      for (const side of [-1, 1]) {
        for (let i = 0; i < 12; i++) {
          x.fillStyle = '#33240c';
          x.fillRect(Math.round(px + side * (HW - 7 - i * 2)), TOP + 7 + i * 2, 3, 3);
        }
      }
    }

    /* ---- the arc it travels, drawn as pixels ---- */
    for (let i = 0; i <= 44; i++) {
      const a2 = (-1 + (i / 44) * 2) * MAXA;
      const tx = Math.round(px + Math.sin(a2) * L);
      const ty = Math.round(py + Math.cos(a2) * L);
      const near = Math.abs(Math.sin(a2) / Math.sin(MAXA)) > s.window;
      x.fillStyle = near
        ? (inWindow ? '#7ec850' : '#c39a2c')
        : 'rgba(120,96,44,.30)';
      x.fillRect(tx - 1, ty - 1, 2, 2);
    }

    /* ---- the catch zones: a thicker band ON the arc at each end ---- */
    for (const side of [-1, 1]) {
      const a0 = Math.asin(Math.max(-1, Math.min(1, s.window))) * (MAXA / (Math.PI / 2));
      for (let i = 0; i <= 14; i++) {
        const a2 = side * (a0 + (i / 14) * (MAXA - a0));
        const tx = Math.round(px + Math.sin(a2) * L);
        const ty = Math.round(py + Math.cos(a2) * L);
        x.fillStyle = inWindow ? '#7ec850' : '#8a6a2a';
        x.fillRect(tx - 2, ty - 2, 5, 5);
        if (inWindow) {
          x.fillStyle = 'rgba(190,255,180,.35)';
          x.fillRect(tx - 4, ty - 4, 9, 9);
        }
      }
    }

    /* ---- the rod, in pixel steps rather than a stroked line ---- */
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const rx = Math.round(px + (bx - px) * k);
      const ry = Math.round(py + (by - py) * k);
      x.fillStyle = i > steps - 3 ? '#c9b98a' : '#8a7a52';
      x.fillRect(rx - 1, ry - 1, 2, 2);
    }

    /* ---- the trail: fading dots along the path just travelled ----
       It used to be three translucent squares the size of the bob, which
       overlapped into a grey smear trailing off to one side. Small dots on
       the actual arc read as motion. */
    for (let i = 1; i <= 7; i++) {
      const a2 = Math.sin(s.phase - i * 0.055) * MAXA;
      const tx = Math.round(px + Math.sin(a2) * L);
      const ty = Math.round(py + Math.cos(a2) * L);
      const a3 = (0.34 * (1 - i / 8)).toFixed(2);
      x.fillStyle = inWindow ? `rgba(190,255,180,${a3})` : `rgba(255,226,150,${a3})`;
      const r2 = i < 3 ? 3 : 2;
      x.fillRect(tx - r2, ty - r2, r2 * 2, r2 * 2);
    }

    /* ---- the pivot: a bearing with an escape wheel behind it ---- */
    {
      // the wheel, which advances a tooth every time you catch it
      for (let i = 0; i < 12; i++) {
        const a2 = s.ratchet + (i / 12) * Math.PI * 2;
        const tx = Math.round(px + Math.cos(a2) * 13);
        const ty = Math.round(py + Math.sin(a2) * 13);
        x.fillStyle = i % 3 === 0 ? '#8a7a52' : '#5c3f1c';
        x.fillRect(tx - 1, ty - 1, 3, 3);
      }
      x.fillStyle = '#3a2a10'; x.fillRect(px - 8, py - 8, 17, 17);
      x.fillStyle = '#5c3f1c'; x.fillRect(px - 6, py - 6, 13, 13);
      x.fillStyle = '#8a7a52'; x.fillRect(px - 3, py - 3, 7, 7);
      x.fillStyle = '#241708'; x.fillRect(px - 1, py - 1, 3, 3);
    }

    /* ---- the bob: a weight, with a rim and a highlight ---- */
    {
      const lit = s.flash > 0;
      const R2 = 8;
      const rx = Math.round(bx), ry = Math.round(by);
      // its shadow on the arc
      x.fillStyle = 'rgba(0,0,0,.35)';
      x.fillRect(rx - R2 + 1, ry - R2 + 2, R2 * 2, R2 * 2);
      // the body, an octagon rather than a square
      x.fillStyle = lit ? '#dfffc4' : (inWindow ? JADE : GOLD);
      x.fillRect(rx - R2, ry - R2 + 3, R2 * 2, R2 * 2 - 6);
      x.fillRect(rx - R2 + 3, ry - R2, R2 * 2 - 6, R2 * 2);
      // a darker core and a bright catch of light on the upper left
      x.fillStyle = lit ? '#8fe8a0' : (inWindow ? '#2f7a60' : '#8a6a1c');
      x.fillRect(rx - 4, ry - 4, 9, 9);
      x.fillStyle = lit ? '#ffffff' : (inWindow ? '#9ff0dc' : '#ffe9a8');
      x.fillRect(rx - 4, ry - 4, 4, 2);
      x.fillRect(rx - 4, ry - 4, 2, 4);
    }

    /* ---- a shock ring where a good catch landed ---- */
    if (s.ring >= 0) {
      const rr = Math.round(6 + s.ring * 26);
      const a2 = (1 - s.ring) * 0.55;
      x.fillStyle = `rgba(190,255,210,${a2.toFixed(2)})`;
      for (let i = 0; i < 20; i++) {
        const th = (i / 20) * Math.PI * 2;
        x.fillRect(Math.round(s.ringX + Math.cos(th) * rr),
          Math.round(s.ringY + Math.sin(th) * rr * 0.7), 2, 2);
      }
    }

    // sparks thrown off a good catch
    for (let i = s.spark.length - 1; i >= 0; i--) {
      const sp = s.spark[i];
      sp.t += dt; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 90 * dt;
      if (sp.t > 0.5) { s.spark.splice(i, 1); continue; }
      x.fillStyle = sp.t < 0.25 ? '#ffffff' : '#9ff0dc';
      x.fillRect(Math.round(sp.x), Math.round(sp.y), 2, 2);
    }

    /* ---- the count, as teeth on a strip ---- */
    for (let i = 0; i < s.need; i++) {
      const mx = W / 2 - (s.need * 13) / 2 + i * 13;
      const done = i < s.got;
      x.fillStyle = '#1a1206'; x.fillRect(mx - 1, H - 45, 12, 12);
      x.fillStyle = done ? JADE : '#3a2a10';
      x.fillRect(mx, H - 44, 10, 10);
      if (done) {
        x.fillStyle = '#dfffc4'; x.fillRect(mx + 3, H - 41, 4, 4);
        x.fillStyle = 'rgba(223,255,196,.3)'; x.fillRect(mx, H - 44, 10, 2);
      }
    }
    // how tight it has wound
    drawText3(x, `TENSION ${Math.round((s.window - 0.86) / 0.105 * 100)}%`,
      W / 2, H - 30, inWindow ? '#9ff0dc' : '#8a7a52');

    if (s.miss > 0) {
      x.fillStyle = `rgba(224,69,58,${(s.miss * 0.22).toFixed(2)})`;
      x.fillRect(0, 0, W, H);
    }
    return [];
  },
  key(code, s) {
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;
    const swing = Math.sin(s.phase);
    const MAXA = 1.02, L = 84, PY = 50;
    const bx = 160 + Math.sin(swing * MAXA) * L;
    if (Math.abs(swing) > s.window) {
      s.got++;
      s.flash = 1;
      s.ring = 0;
      s.ringX = bx;
      s.ringY = 50 + Math.cos(swing * MAXA) * L;
      s.ratchet += 0.52;
      // each catch winds it tighter: faster, and a narrower window
      s.speed += 0.34;
      s.window = Math.min(0.965, s.window + 0.016);
      for (let i = 0; i < 9; i++) {
        s.spark.push({
          x: bx, y: PY + Math.cos(swing * MAXA) * L, t: 0,
          vx: (Math.random() - 0.5) * 110, vy: -30 - Math.random() * 80,
        });
      }
    } else {
      s.miss = 1;
      s.shake = 1;
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
  hint: 'LEFT RIGHT PICK A WHEEL   UP DOWN TURN IT',
  init(s, rng) {
    const n = s.hard ? 4 : 3;
    s.want = []; s.have = [];
    for (let i = 0; i < n; i++) {
      s.want.push(1 + ((rng() * 9) | 0));
      s.have.push(1 + ((rng() * 9) | 0));
    }
    s.sel = 0;
    /* One float per drum. It is the distance still to roll, in digits, so
       the wheel visibly turns rather than the number simply changing —
       which is what made the old one look like a spreadsheet. */
    s.roll = new Array(n).fill(0);
    s.lock = new Array(n).fill(0);   // how far each tumbler has dropped
    s.bolt = 0;                      // the bolt, once they all match
    s.shake = 0;
    if (s.want.every((v, i) => v === s.have[i])) s.have[0] = (s.have[0] % 9) + 1;
  },

  draw(x, W, H, s, t, dt) {
    const rows = [];
    const n = s.have.length;
    if (s.shake > 0) s.shake -= dt * 4;
    const solved = s.want.every((v, i) => v === s.have[i]);
    if (solved) s.bolt = Math.min(1, (s.bolt || 0) + dt * 3);

    /* ---- layout, in bands, so nothing can drift into anything ---- */
    const DW = n > 3 ? 40 : 46, GAP = 8;
    const TOTAL = n * DW + (n - 1) * GAP;
    const OX = Math.round((W - TOTAL) / 2) + (s.shake > 0 ? Math.round(Math.sin(s.shake * 60) * 2) : 0);
    const PLATE_Y = 42;          // the stamped code, clear of the title
    const PLATE_H = 26;
    const DRUM_Y = PLATE_Y + PLATE_H + 12;
    const DRUM_H = 54;
    const BOLT_Y = DRUM_Y + DRUM_H + 12;

    /* ---- the brass case ---- */
    const CX0 = OX - 14, CY0 = PLATE_Y - 12;
    const CW = TOTAL + 28, CH = (BOLT_Y + 20) - CY0;
    x.fillStyle = '#2b2010'; x.fillRect(CX0, CY0, CW, CH);
    ditherRect2(x, CX0, CY0, CW, CH);
    // rolled edges
    x.fillStyle = '#6b5220';
    x.fillRect(CX0, CY0, CW, 2); x.fillRect(CX0, CY0 + CH - 2, CW, 2);
    x.fillRect(CX0, CY0, 2, CH); x.fillRect(CX0 + CW - 2, CY0, 2, CH);
    x.fillStyle = '#8a6a2a';
    x.fillRect(CX0 + 1, CY0 + 1, CW - 2, 1);
    // and its bolts, one at each corner
    for (const [rx, ry] of [[CX0 + 4, CY0 + 4], [CX0 + CW - 9, CY0 + 4],
      [CX0 + 4, CY0 + CH - 9], [CX0 + CW - 9, CY0 + CH - 9]]) {
      x.fillStyle = '#8a6a2a'; x.fillRect(rx, ry, 5, 5);
      x.fillStyle = '#4a3a1c'; x.fillRect(rx + 1, ry + 1, 3, 3);
      x.fillStyle = '#c39a2c'; x.fillRect(rx + 1, ry + 1, 3, 1);
    }

    /* ---- the plate: the code, stamped, above the drums ---- */
    x.fillStyle = '#4a3a18'; x.fillRect(OX - 4, PLATE_Y, TOTAL + 8, PLATE_H);
    ditherPatch(x, OX - 4, PLATE_Y, TOTAL + 8, PLATE_H);
    x.fillStyle = '#8a6a2a';
    x.fillRect(OX - 4, PLATE_Y, TOTAL + 8, 1);
    x.fillRect(OX - 4, PLATE_Y + PLATE_H - 1, TOTAL + 8, 1);
    drawText3(x, 'SET TO', OX + TOTAL / 2, PLATE_Y + 3, '#a89050');
    for (let i = 0; i < n; i++) {
      const bx = OX + i * (DW + GAP);
      const ok = s.have[i] === s.want[i];
      /* One shadow, not two. drawBigDigit goes through the shared text
         routine, which already lays a shadow down behind every glyph — the
         extra pass I added on top of it read as a smudge stuck to each
         figure. */
      drawBigDigit(x, s.want[i], bx + DW / 2, PLATE_Y + 16, 2, ok ? JADE : '#e8cf9a');
    }

    /* ---- the drums ---- */
    for (let i = 0; i < n; i++) {
      const bx = OX + i * (DW + GAP);
      const ok = s.have[i] === s.want[i];
      const live = i === s.sel;

      // the roll eases out, and the tumbler drops when it lands right
      if (Math.abs(s.roll[i]) > 0.001) {
        s.roll[i] -= s.roll[i] * Math.min(1, dt * 11);
        if (Math.abs(s.roll[i]) < 0.01) s.roll[i] = 0;
      }
      s.lock[i] += ((ok ? 1 : 0) - s.lock[i]) * Math.min(1, dt * 8);

      /* the well the drum sits in */
      x.fillStyle = '#0e0904'; x.fillRect(bx - 2, DRUM_Y - 2, DW + 4, DRUM_H + 4);
      x.fillStyle = live ? (ok ? '#2f7a60' : '#8a6a2a') : '#3a2a12';
      x.fillRect(bx - 2, DRUM_Y - 2, DW + 4, 1);
      x.fillRect(bx - 2, DRUM_Y + DRUM_H + 1, DW + 4, 1);
      x.fillRect(bx - 2, DRUM_Y - 2, 1, DRUM_H + 4);
      x.fillRect(bx + DW + 1, DRUM_Y - 2, 1, DRUM_H + 4);

      /* the drum face, curved by shading rather than by geometry */
      x.fillStyle = ok ? '#0d2a1e' : '#151008';
      x.fillRect(bx, DRUM_Y, DW, DRUM_H);
      for (let j = 0; j < DRUM_H; j++) {
        const k = Math.abs(j - DRUM_H / 2) / (DRUM_H / 2);
        x.fillStyle = `rgba(0,0,0,${(0.05 + k * k * 0.55).toFixed(3)})`;
        x.fillRect(bx, DRUM_Y + j, DW, 1);
      }

      /* the digits, clipped to the window, rolling on the drum */
      x.save();
      x.beginPath(); x.rect(bx, DRUM_Y, DW, DRUM_H); x.clip();
      const STEP = 20;
      const off = s.roll[i] * STEP;
      for (let d = -2; d <= 2; d++) {
        const v = ((s.have[i] - 1 + d + 9) % 9) + 1;
        const cy = DRUM_Y + DRUM_H / 2 + d * STEP + off;
        const centre = Math.abs(cy - (DRUM_Y + DRUM_H / 2)) < 5;
        drawBigDigit(x, v, bx + DW / 2, Math.round(cy), centre ? 2 : 1,
          centre ? (ok ? '#dfffc4' : GOLD_LT) : '#4a3a1c');
      }
      x.restore();

      /* the sight line across the middle of the window */
      x.fillStyle = ok ? 'rgba(126,200,80,.5)' : 'rgba(195,154,44,.28)';
      x.fillRect(bx, DRUM_Y + DRUM_H / 2 - 10, DW, 1);
      x.fillRect(bx, DRUM_Y + DRUM_H / 2 + 10, DW, 1);
      // notches either side of the sight line, like a real drum window
      x.fillStyle = ok ? JADE : '#8a6a2a';
      x.fillRect(bx, DRUM_Y + DRUM_H / 2 - 1, 3, 3);
      x.fillRect(bx + DW - 3, DRUM_Y + DRUM_H / 2 - 1, 3, 3);

      /* the tumbler above the drum, which drops when it is right */
      {
        const dropped = s.lock[i];
        const ty = DRUM_Y - 10 + Math.round(dropped * 5);
        x.fillStyle = dropped > 0.6 ? JADE : '#6a5220';
        x.fillRect(bx + DW / 2 - 2, ty, 5, 8);
        x.fillStyle = dropped > 0.6 ? '#dfffc4' : '#8a6a2a';
        x.fillRect(bx + DW / 2 - 2, ty, 5, 2);
      }

      /* which one you are turning */
      if (live) {
        const blink = Math.floor(t * 4) % 2 === 0;
        x.fillStyle = blink ? GOLD : '#8a6a2a';
        // arrows above and below, so up and down are obvious
        for (let k = 0; k < 4; k++) {
          x.fillRect(bx + DW / 2 - k, DRUM_Y - 8 - k, k * 2 + 1, 1);
          x.fillRect(bx + DW / 2 - k, DRUM_Y + DRUM_H + 7 + k, k * 2 + 1, 1);
        }
        // and a bright frame round the well
        x.fillStyle = blink ? 'rgba(255,210,74,.55)' : 'rgba(255,210,74,.22)';
        x.fillRect(bx - 4, DRUM_Y - 4, DW + 8, 1);
        x.fillRect(bx - 4, DRUM_Y + DRUM_H + 3, DW + 8, 1);
        x.fillRect(bx - 4, DRUM_Y - 4, 1, DRUM_H + 8);
        x.fillRect(bx + DW + 3, DRUM_Y - 4, 1, DRUM_H + 8);
      }

      rows.push({ x: bx - 2, y: DRUM_Y - 2, w: DW + 4, h: DRUM_H + 4, pick: i });
    }

    /* ---- the bolt strip: what the lock is actually doing ---- */
    const BW = TOTAL;
    x.fillStyle = '#120c06'; x.fillRect(OX, BOLT_Y, BW, 12);
    x.fillStyle = '#4a3a1c'; x.fillRect(OX, BOLT_Y, BW, 1); x.fillRect(OX, BOLT_Y + 11, BW, 1);
    // the bolt slides across as the drums come right
    const done = s.want.filter((v, i) => v === s.have[i]).length;
    const slide = Math.round((done / n) * (BW - 22) + (s.bolt || 0) * 8);
    x.fillStyle = solved ? JADE : '#8a6a2a';
    x.fillRect(OX + 2 + slide, BOLT_Y + 2, 18, 8);
    x.fillStyle = solved ? '#dfffc4' : '#c39a2c';
    x.fillRect(OX + 2 + slide, BOLT_Y + 2, 18, 2);
    // the keep it slides into
    x.fillStyle = solved ? JADE : '#3a2a12';
    x.fillRect(OX + BW - 6, BOLT_Y + 1, 4, 10);

    drawText3(x, solved ? 'THE BOLT IS OVER' : `${done} OF ${n}`,
      W / 2, BOLT_Y + 16, solved ? JADE : DIM);

    /* a wash of green over everything the moment it opens */
    if (solved && s.bolt < 1) {
      x.fillStyle = `rgba(126,200,80,${((1 - s.bolt) * 0.22).toFixed(3)})`;
      x.fillRect(0, 0, W, H);
    }
    return rows;
  },

  _solved(s) { return s.want.every((v, i) => v === s.have[i]); },

  _turn(s, dir) {
    const n = 9;
    const before = s.have[s.sel] === s.want[s.sel];
    s.have[s.sel] = ((s.have[s.sel] - 1 + dir + n) % n) + 1;
    // the drum rolls the other way to the digit, which is what a drum does
    s.roll[s.sel] = -dir;
    const after = s.have[s.sel] === s.want[s.sel];
    s.sfx?.('reel');
    if (after && !before) s.sfx?.('confirm');
    const solved = this._solved(s);
    if (solved) { s.sfx?.('door'); s.sfx?.('victory'); }
    return solved;
  },

  key(code, s) {
    const n = s.have.length;
    if (code === 'ArrowLeft' || code === 'KeyA') {
      s.sel = (s.sel + n - 1) % n; s.sfx?.('select'); return false;
    }
    if (code === 'ArrowRight' || code === 'KeyD' || code === 'Tab') {
      s.sel = (s.sel + 1) % n; s.sfx?.('select'); return false;
    }
    if (code === 'ArrowUp' || code === 'KeyW') return this._turn(s, 1);
    if (code === 'ArrowDown' || code === 'KeyS') return this._turn(s, -1);
    if (code === 'Space' || code === 'Enter' || code === 'KeyE') return this._turn(s, 1);
    return false;
  },

  click(row, i, s) {
    if (row?.pick === undefined) return false;
    if (row.pick !== s.sel) { s.sel = row.pick; s.sfx?.('select'); return false; }
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
