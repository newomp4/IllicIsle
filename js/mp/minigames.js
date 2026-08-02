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

/* ===========================================================
   SHARED EFFECTS

   Every one of these games was drawing its own sparks, its own red
   flash and its own shake, and three of the five were drawing none of
   them at all. One pool, one updater, one drawer — so adding a puff of
   dust to a game is one line rather than a new array and a new loop.

   Nothing here allocates during play: the pool is fixed and particles
   are recycled by writing over dead ones.
   =========================================================== */
const FX_MAX = 120;

function fxInit(s) {
  if (s.fx) return s.fx;
  const pool = new Array(FX_MAX);
  for (let i = 0; i < FX_MAX; i++) {
    pool[i] = { on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, g: 0, r: 2, kind: 'spark', col: '#fff' };
  }
  s.fx = { pool, next: 0 };
  return s.fx;
}

/**
 * Throw one particle.
 *
 * `kind` decides how it is drawn and how it dies:
 *   spark   a bright pixel that fades white to colour
 *   puff    a square that grows and thins, for dust and smoke
 *   chunk   a square that tumbles and falls, for debris
 *   drop    a falling pixel with a splash colour, for water
 */
function fx(s, kind, x2, y2, opts = {}) {
  const F = fxInit(s);
  // find a dead one, or take the oldest
  let p = null;
  for (let i = 0; i < FX_MAX; i++) {
    const q = F.pool[(F.next + i) % FX_MAX];
    if (!q.on) { p = q; F.next = (F.next + i + 1) % FX_MAX; break; }
  }
  if (!p) { p = F.pool[F.next]; F.next = (F.next + 1) % FX_MAX; }
  p.on = true; p.kind = kind;
  p.x = x2; p.y = y2;
  p.vx = opts.vx ?? 0; p.vy = opts.vy ?? 0;
  p.t = 0; p.life = opts.life ?? 0.5;
  p.g = opts.g ?? (kind === 'chunk' || kind === 'drop' ? 220 : kind === 'puff' ? -18 : 90);
  p.r = opts.r ?? (kind === 'puff' ? 3 : 2);
  p.col = opts.col || '#ffffff';
  return p;
}

/** A ring of them, thrown outward. The commonest thing any of these want. */
function fxBurst(s, kind, x2, y2, n, opts = {}) {
  const spd = opts.speed ?? 90;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (opts.spin || 0);
    const v = spd * (0.45 + Math.random() * 0.75);
    fx(s, kind, x2, y2, {
      ...opts,
      vx: Math.cos(a) * v + (opts.driftX || 0),
      vy: Math.sin(a) * v * (opts.squash ?? 1) + (opts.driftY || 0),
    });
  }
}

/** Step and paint the lot. Called once per frame by each game's draw. */
function fxDraw(x, s, dt) {
  const F = s.fx;
  if (!F) return;
  for (let i = 0; i < FX_MAX; i++) {
    const p = F.pool[i];
    if (!p.on) continue;
    p.t += dt;
    if (p.t >= p.life) { p.on = false; continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
    const k = p.t / p.life;                    // 0 fresh, 1 gone
    if (p.kind === 'puff') {
      const r = Math.round(p.r * (0.6 + k * 1.9));
      x.fillStyle = k < 0.5 ? p.col : 'rgba(120,106,80,.28)';
      x.globalAlpha = Math.max(0, 1 - k) * 0.7;
      x.fillRect(Math.round(p.x) - r, Math.round(p.y) - r, r * 2, r * 2);
      x.globalAlpha = 1;
    } else if (p.kind === 'chunk') {
      const r = p.r;
      x.fillStyle = p.col;
      // it tumbles, so it is a square that changes size as it turns
      const w = 1 + Math.abs(Math.round(Math.cos(p.t * 14) * r));
      x.fillRect(Math.round(p.x) - (w >> 1), Math.round(p.y) - (r >> 1), w, r);
    } else if (p.kind === 'drop') {
      x.fillStyle = k < 0.7 ? p.col : '#5a8aa0';
      // stretched by how fast it is falling, which is what a drop looks like
      const h = Math.max(1, Math.min(4, Math.round(Math.abs(p.vy) / 90)));
      x.fillRect(Math.round(p.x), Math.round(p.y), 1, h);
    } else {
      x.fillStyle = k < 0.28 ? '#ffffff' : p.col;
      const r = k > 0.7 ? 1 : p.r;
      x.fillRect(Math.round(p.x) - (r >> 1), Math.round(p.y) - (r >> 1), r, r);
    }
  }
}

/**
 * A shock ring. Every game wants one and three of them had written it
 * out by hand; `squash` flattens it into an ellipse for anything lying
 * on a surface.
 */
function fxRing(x, cx, cy, k, col, opts = {}) {
  if (k < 0 || k > 1) return;
  const r = (opts.from ?? 6) + k * (opts.to ?? 30);
  const a = (1 - k) * (opts.alpha ?? 0.55);
  const n = opts.n ?? 20;
  const sq = opts.squash ?? 1;
  x.fillStyle = col.replace(/[\d.]+\)$/, `${a.toFixed(2)})`);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    x.fillRect(Math.round(cx + Math.cos(th) * r), Math.round(cy + Math.sin(th) * r * sq), 2, 2);
  }
}

/** The whole panel jolts. Games set it; the screen applies it. */
function fxShake(s, amount) { s.shake = Math.max(s.shake || 0, amount); }

/** A full-screen wash, for a hit or a miss. */
function fxFlash(x, W, H, k, rgb) {
  if (k <= 0) return;
  x.fillStyle = `rgba(${rgb},${(k * 0.24).toFixed(2)})`;
  x.fillRect(0, 0, W, H);
}

/* ---------- shared chrome ---------- */
/** A cheap two-tone weave, so a big flat rectangle has some grain in it. */
function ditherRect3(x, ox, oy, w, h, a, b) {
  x.fillStyle = a; x.fillRect(ox, oy, w, h);
  x.fillStyle = b;
  for (let yy = 0; yy < h; yy += 2) {
    for (let xx = (yy / 2) % 2; xx < w; xx += 2) x.fillRect(ox + xx, oy + yy, 1, 1);
  }
}

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
    s.taut = 0;           // the rope snapping tight on a catch
    fxInit(s);
  },
  draw(x, W, H, s, t, dt) {
    s.phase += dt * s.speed;
    if (s.flash > 0) s.flash -= dt * 3;
    if (s.miss > 0) s.miss -= dt * 2.5;
    /* The screen decays `shake` and moves the whole panel with it now, so
       a game that also decayed it halved its own jolt and one that also
       offset its contents slid them out from under their own frame. */
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
    const shk = 0;                       // the whole panel jolts instead
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
    const taut = Math.max(0, s.taut || 0);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      /* Slack in the rod, taken up when it bites. A dead straight line
         between two points is a stick; a rope has a belly in it. */
      const sag = Math.sin(k * Math.PI) * (1 - taut) * 2.2;
      const rx = Math.round(px + (bx - px) * k);
      const ry = Math.round(py + (by - py) * k + sag);
      x.fillStyle = taut > 0.2 ? '#fff3c4' : (i > steps - 3 ? '#c9b98a' : '#8a7a52');
      const w = taut > 0.2 ? 3 : 2;
      x.fillRect(rx - (w >> 1), ry - 1, w, 2);
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

    if (s.taut > 0) s.taut -= dt * 3.4;
    fxDraw(x, s, dt);
    fxFlash(x, W, H, s.miss, '224,69,58');
    return [];
  },
  key(code, s) {
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;
    const swing = Math.sin(s.phase);
    const MAXA = 1.02, L = 84, PY = 50;
    const bx = 160 + Math.sin(swing * MAXA) * L;
    if (Math.abs(swing) > s.window) {
      s.got++;
      // it bites, and the last tooth of the ratchet rings differently
      s.sfx?.('lever'); s.sfx?.(s.got >= s.need - 1 ? 'confirm' : 'clink');
      s.flash = 1;
      s.taut = 1;
      s.ring = 0;
      s.ringX = bx;
      s.ringY = 50 + Math.cos(swing * MAXA) * L;
      s.ratchet += 0.52;
      /* Brass filings off the escape wheel and a small kick through the
         frame — a catch you can feel as well as see. */
      fxShake(s, 0.45);
      fxBurst(s, 'spark', 160, 50, 7, { col: '#ffe9a8', speed: 70, life: 0.4 });
      fxBurst(s, 'chunk', 160, 50, 3, { col: '#8a7a52', speed: 55, life: 0.6, r: 2 });
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
      s.sfx?.('deny'); s.sfx?.('rumble');            // it slips, and the whole rig shakes
      s.miss = 1;
      fxShake(s, 1);
      /* The pawl skips: dust out of the bearing and grit off the gantry. */
      fxBurst(s, 'puff', 160, 50, 5, { col: 'rgba(150,130,90,.55)', speed: 30, life: 0.9, r: 3 });
      fxBurst(s, 'chunk', 160, 50, 5, { col: '#5c3f1c', speed: 95, life: 0.7, r: 2 });
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
  GLOW: ['#ff9a88', '#9fe89a', '#8fb4ff', '#ffefa0'],
  init(s, rng) {
    s.seq = new Array(s.hard ? 5 : 3).fill(0).map(() => (rng() * 4) | 0);
    s.at = 0; s.showing = 0; s.showT = 0; s.playing = true; s.wrong = 0;
    /* Per strand: how lit it is, and where a pulse of light has got to on
       its way down. A strand that has been spliced stays warm. */
    s.lit = [0, 0, 0, 0];
    s.pulse = [-1, -1, -1, -1];
    s.fused = [0, 0, 0, 0];
    s.arc = 0;                  // the flash across the block when it shorts
    s.hum = 0;
    fxInit(s);
  },
  draw(x, W, H, s, t, dt) {
    const rows = [];
    if (s.playing) {
      s.showT += dt;
      if (s.showT > 0.55) {
        s.showT = 0; s.showing++;
        // a pulse leaves the cable every time it calls one
        if (s.showing < s.seq.length) {
          s.pulse[s.seq[s.showing]] = 0;
          s.sfx?.('cast');
        }
      }
      if (s.showing >= s.seq.length + 1) { s.playing = false; s.showing = -1; s.at = 0; }
    }
    if (s.wrong > 0) s.wrong -= dt * 2;
    if (s.arc > 0) s.arc -= dt * 5;
    s.hum = (s.hum || 0) + dt;

    const bw = 42, bh = 34, gap = 6;
    const total = 4 * bw + 3 * gap;
    /* The cable sits BELOW the panel's own title. At 34 the housing ran
       from 22, and the frame prints the job's name at 28 — the words came
       out through the middle of the ducting. */
    const CAB_Y = 58;
    const oy = 98;
    const ox = Math.round((W - total) / 2);
    const cabX = W / 2;

    /* ---- the housing: a dark box with the cable coming into it ---- */
    ditherRect3(x, 20, CAB_Y - 12, W - 40, 20, '#171c1e', '#20272a');
    x.fillStyle = '#2e383c'; x.fillRect(20, CAB_Y - 12, W - 40, 1);
    x.fillStyle = '#0b0e0f'; x.fillRect(20, CAB_Y + 7, W - 40, 1);
    // the cable itself, banded, running in from the left
    for (let i = 20; i < W - 20; i += 4) {
      x.fillStyle = (i >> 2) % 2 ? '#3a2f28' : '#4a3c32';
      x.fillRect(i, CAB_Y - 4, 4, 8);
    }
    x.fillStyle = '#5a4a3c'; x.fillRect(20, CAB_Y - 4, W - 40, 1);
    // the splice block in the middle, where the strands are broken out
    x.fillStyle = '#252d30'; x.fillRect(cabX - 34, CAB_Y - 9, 68, 18);
    x.fillStyle = '#46545a'; x.fillRect(cabX - 34, CAB_Y - 9, 68, 1);
    x.fillStyle = '#0d1112'; x.fillRect(cabX - 34, CAB_Y + 8, 68, 1);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = '#0d1112';
      x.fillRect(cabX - 26 + i * 17, CAB_Y - 5, 3, 10);
    }
    // a status lamp that breathes while it is calling
    {
      const on = s.playing && Math.floor(s.hum * 6) % 2 === 0;
      x.fillStyle = on ? '#ffd24a' : '#4a3a10';
      x.fillRect(cabX + 28, CAB_Y - 5, 4, 4);
    }

    /* ---- four strands, fanning from the block down to the terminals ---- */
    for (let i = 0; i < 4; i++) {
      const bx = ox + i * (bw + gap);
      const tipX = bx + bw / 2;
      const rootX = cabX - 25 + i * 17;
      const lit = Math.max(s.lit[i], s.fused[i] * 0.55);
      // the strand, drawn as pixels down a curve
      const N = 26;
      for (let k2 = 0; k2 <= N; k2++) {
        const u = k2 / N;
        // ease across so it leaves the block vertically and arrives vertically
        const e = u * u * (3 - 2 * u);
        const px = Math.round(rootX + (tipX - rootX) * e);
        const py = Math.round(CAB_Y + 9 + u * (oy - CAB_Y - 9));
        const isPulse = s.pulse[i] >= 0 && Math.abs(u - s.pulse[i]) < 0.10;
        x.fillStyle = isPulse ? '#ffffff'
          : lit > 0.05 ? this.GLOW[i]
            : (s.fused[i] ? '#4a5c4a' : '#3a4038');
        x.fillRect(px - 1, py, 2, 2);
        if (isPulse) {
          // the light spills off the strand as it travels
          x.fillStyle = `rgba(255,255,255,.22)`;
          x.fillRect(px - 3, py - 1, 6, 4);
        }
      }
      // advance the pulse
      if (s.pulse[i] >= 0) {
        s.pulse[i] += dt * 2.6;
        if (s.pulse[i] >= 1) {
          s.pulse[i] = -1;
          s.lit[i] = 1;                          // it arrives, and the pad blooms
          fxBurst(s, 'spark', tipX, oy + 4, 6, { col: this.GLOW[i], speed: 60, life: 0.35 });
        }
      }
      if (s.lit[i] > 0) s.lit[i] = Math.max(0, s.lit[i] - dt * 2.2);
    }

    /* ---- the terminals ---- */
    for (let i = 0; i < 4; i++) {
      const bx = ox + i * (bw + gap);
      const lit = s.lit[i];
      const fused = s.fused[i];
      const on = lit > 0.05;
      // the pad, sunk into a bezel
      x.fillStyle = '#0d1112'; x.fillRect(bx - 2, oy - 2, bw + 4, bh + 4);
      ditherRect3(x, bx, oy, bw, bh, on ? this.COLS[i] : '#161d1a',
        on ? this.GLOW[i] : '#1d2622');
      // the rim, brighter when it has been spliced for good
      x.fillStyle = on ? '#ffffff' : (fused ? this.COLS[i] : '#33403a');
      x.fillRect(bx, oy, bw, 1); x.fillRect(bx, oy + bh - 1, bw, 1);
      x.fillRect(bx, oy, 1, bh); x.fillRect(bx + bw - 1, oy, 1, bh);
      // the ferrule in the middle: a lens that lights from within
      const r = on ? 8 : 5;
      x.fillStyle = '#0a0d0c';
      x.fillRect(bx + bw / 2 - r - 1, oy + bh / 2 - r - 1, r * 2 + 2, r * 2 + 2);
      x.fillStyle = on ? '#ffffff' : (fused ? this.GLOW[i] : this.COLS[i]);
      x.fillRect(bx + bw / 2 - r, oy + bh / 2 - r, r * 2, r * 2);
      if (on) {
        x.fillStyle = this.COLS[i];
        x.fillRect(bx + bw / 2 - r + 2, oy + bh / 2 - r + 2, r * 2 - 4, r * 2 - 4);
        // and it throws light onto the panel around it
        x.globalAlpha = lit * 0.28;
        x.fillStyle = this.GLOW[i];
        x.fillRect(bx - 8, oy - 8, bw + 16, bh + 16);
        x.globalAlpha = 1;
      }
      // a fused strand keeps a small steady core
      if (fused && !on) {
        x.fillStyle = this.GLOW[i];
        x.fillRect(bx + bw / 2 - 2, oy + bh / 2 - 2, 4, 4);
      }
      drawKeyCap(x, String(i + 1), bx + bw / 2, oy + bh + 5);
      rows.push({ x: bx, y: oy, w: bw, h: bh, pick: i });
    }

    /* ---- the arc flash, when you put the wrong strand across ---- */
    if (s.arc > 0) {
      const k = s.arc;
      x.fillStyle = `rgba(255,255,255,${(k * 0.5).toFixed(2)})`;
      // a jagged line across the block
      let px = cabX - 34;
      let py = CAB_Y;
      for (let i = 0; i < 14; i++) {
        const nx = px + 5;
        const ny = CAB_Y + (Math.random() - 0.5) * 14 * k;
        x.fillRect(Math.round(px), Math.round(py), Math.round(nx - px) + 1, 2);
        px = nx; py = ny;
      }
    }

    /* ---- progress: strands spliced, as a row of ferrules ---- */
    for (let i = 0; i < s.seq.length; i++) {
      const mx = W / 2 - (s.seq.length * 13) / 2 + i * 13;
      const done = i < s.at;
      x.fillStyle = '#0d1112'; x.fillRect(mx - 1, H - 47, 12, 11);
      x.fillStyle = done ? JADE : '#243028';
      x.fillRect(mx, H - 46, 10, 9);
      if (done) { x.fillStyle = '#dfffc4'; x.fillRect(mx + 3, H - 43, 4, 3); }
    }
    drawText3(x, s.playing ? 'LISTEN' : `${s.at} OF ${s.seq.length} SPLICED`,
      W / 2, H - 32, s.playing ? GOLD : (s.at ? '#9ff0dc' : DIM));

    fxDraw(x, s, dt);
    fxFlash(x, W, H, s.wrong, '224,69,58');
    return rows;
  },
  _hit(i, s) {
    if (s.playing) return false;
    /* Kept in step with draw() by hand, because _hit has no layout of its
       own and the sparks have to come off the ferrule you just pressed. */
    const bw = 42, gap = 6, ox = Math.round((320 - (4 * bw + 3 * gap)) / 2);
    const tipX = ox + i * (bw + gap) + bw / 2;
    const tipY = 98 + 17;
    if (s.seq[s.at] === i) {
      s.at++;
      s.lit[i] = 1;
      s.fused[i] = 1;
      s.sfx?.('select'); s.sfx?.('clink');
      // it fuses: white sparks off the ferrule and a puff of the flux burning
      fxBurst(s, 'spark', tipX, tipY, 10, { col: this.GLOW[i], speed: 105, life: 0.42 });
      fxBurst(s, 'puff', tipX, tipY - 3, 3, { col: 'rgba(220,230,220,.5)', speed: 26, life: 0.7, r: 2 });
      return s.at >= s.seq.length;
    }
    s.sfx?.('deny'); s.sfx?.('gemHit');
    /* Wrong strand across the block: it arcs, the panel jolts, everything
       that was lit goes out, and it starts calling again. */
    s.arc = 1;
    fxShake(s, 1);
    fxBurst(s, 'spark', 160, 58, 14, { col: '#ffe9a8', speed: 150, life: 0.5 });
    fxBurst(s, 'puff', 160, 54, 5, { col: 'rgba(90,90,90,.6)', speed: 34, life: 1.0, r: 3 });
    for (let k2 = 0; k2 < 4; k2++) { s.lit[k2] = 0; s.fused[k2] = 0; s.pulse[k2] = -1; }
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
  hint: 'ARROWS AIM   SPACE STITCH',
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
    /* The needle, in sail space. This game used to be click-only — its key()
       returned false for everything — so on a keyboard PATCH THE SAIL could
       not be played at all. You steer the needle now and press to put a
       stitch in whatever is under it, which works either way. */
    const first = s.tears[s.order[0][0]][s.order[0][1]];
    s.nx = first.x; s.ny = first.y;
    s.miss = 0;
    /* How far each tear has been drawn together. A tear that is sewn
       should CLOSE, not just change colour — the two lips of it come in
       toward the seam as the stitches go in. */
    s.close = s.tears.map(() => 0);
    s.gust = 0;
    fxInit(s);
  },
  draw(x, W, H, s, t, dt) {
    if (s.wrong > 0) s.wrong -= dt * 2;
    if (s.pull > 0) s.pull -= dt * 3;
    // the tears ease shut behind the needle
    s.close = s.close || s.tears.map(() => 0);
    s.tears.forEach((pts, tear) => {
      const doneTo = s.order.slice(0, s.at).filter(([w]) => w === tear).length;
      const want = doneTo / pts.length;
      s.close[tear] += (want - s.close[tear]) * Math.min(1, dt * 6);
    });
    /* A gust every few seconds: the whole sail bellies out and snaps
       back, which is the difference between cloth and a brown rectangle. */
    s.gust = (s.gust || 0) + dt;
    const gust = Math.max(0, Math.sin(s.gust * 0.62)) ** 3;

    const sx = 26, sy = 40, sw = W - 52, sh = H - 92;
    // canvas, with a weave and a wind-billow in it
    x.fillStyle = '#cabfa0'; x.fillRect(sx, sy, sw, sh);
    for (let j = 0; j < sh; j += 3) {
      const shade = 0.06 + Math.sin(j * 0.13 + t * 0.8) * 0.05;
      x.fillStyle = `rgba(120,106,80,${Math.max(0, shade).toFixed(3)})`;
      x.fillRect(sx, sy + j, sw, 1);
    }
    /* The belly of the sail, as bands of light and shade that travel
       across it while the gust runs through. */
    if (gust > 0.02) {
      for (let j = 0; j < sh; j += 2) {
        const w2 = Math.sin(j * 0.09 - s.gust * 3.4) * gust;
        if (w2 > 0.25) {
          x.fillStyle = `rgba(255,248,220,${(w2 * 0.16).toFixed(3)})`;
          x.fillRect(sx, sy + j, sw, 2);
        } else if (w2 < -0.25) {
          x.fillStyle = `rgba(90,76,50,${(-w2 * 0.14).toFixed(3)})`;
          x.fillRect(sx, sy + j, sw, 2);
        }
      }
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

    /* The tears themselves. A tear is a HOLE — two edges with daylight
       between them — and it was a single brown line. Two lips, with the
       gap between them closing as the seam goes in. */
    s.tears.forEach((pts, tear) => {
      const doneTo = s.order.slice(0, s.at).filter(([w]) => w === tear).length;
      const shut = s.close[tear] || 0;
      const gap = (1 - shut) * 4.5 + 0.5;
      for (let lip = -1; lip <= 1; lip += 2) {
        x.strokeStyle = lip < 0 ? '#6a5a38' : '#4a3c22';
        x.lineWidth = 2;
        x.beginPath();
        pts.forEach((p, i) => {
          const q = P(tear, i);
          // the lips flap a little in the gust while they are still open
          const flap = lip * (1 - shut) * gust * 1.6;
          const yy = q.y + lip * gap + flap;
          if (i === 0) x.moveTo(q.x, yy); else x.lineTo(q.x, yy);
        });
        x.stroke();
      }
      // what is behind the sail, showing through the gap
      if (shut < 0.98) {
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = P(tear, i), p1 = P(tear, i + 1);
          for (let k = 0; k <= 8; k++) {
            const px2 = p0.x + (p1.x - p0.x) * (k / 8);
            const py2 = p0.y + (p1.y - p0.y) * (k / 8);
            x.fillStyle = `rgba(24,30,38,${(0.5 * (1 - shut)).toFixed(2)})`;
            x.fillRect(Math.round(px2) - 1, Math.round(py2 - gap + 1), 2, Math.max(1, Math.round(gap * 2 - 2)));
          }
        }
      }
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

    /* ---- the needle you are steering ---- */
    {
      const nx2 = Math.round(sx + (s.nx ?? 0.5) * sw);
      const ny2 = Math.round(sy + (s.ny ?? 0.5) * sh);
      const bob = Math.round(Math.sin(t * 5) * 2) - Math.round(s.pull * 4);
      // its shadow on the canvas, which is what puts it above the sail
      x.fillStyle = 'rgba(60,50,30,.30)';
      x.fillRect(nx2 + 2, ny2 + 2, 3, 3);
      // and a ring showing what it would sew
      const near2 = s.order[s.at] ? P(s.order[s.at][0], s.order[s.at][1]) : null;
      const over = near2 && Math.hypot(near2.x - nx2, near2.y - ny2) < 9;
      x.fillStyle = over ? 'rgba(126,200,80,.5)' : (s.miss > 0 ? 'rgba(224,69,58,.5)' : 'rgba(255,210,74,.28)');
      x.fillRect(nx2 - 5, ny2 - 5, 11, 1);
      x.fillRect(nx2 - 5, ny2 + 5, 11, 1);
      x.fillRect(nx2 - 5, ny2 - 5, 1, 11);
      x.fillRect(nx2 + 5, ny2 - 5, 1, 11);
      // the needle itself, with thread trailing off it
      x.fillStyle = '#d8dde0';
      x.fillRect(nx2 + 4, ny2 - 12 + bob, 1, 9);
      x.fillRect(nx2 + 3, ny2 - 4 + bob, 3, 2);
      x.fillStyle = '#8fd8c4';
      x.fillRect(nx2 + 5, ny2 - 13 + bob, 3, 1);
      x.fillRect(nx2 + 7, ny2 - 15 + bob, 2, 1);
    }
    if (s.miss > 0) s.miss -= dt * 3;

    // and a ghost of the needle over the hole it wants next
    if (nextKey) {
      const q = P(nextKey[0], nextKey[1]);
      const bob = Math.round(Math.sin(t * 5) * 2) - Math.round(s.pull * 4);
      x.fillStyle = 'rgba(216,221,224,.35)';
      x.fillRect(q.x + 5, q.y - 12 + bob, 1, 9);
      x.fillRect(q.x + 4, q.y - 4 + bob, 3, 2);
    }

    bar(x, 30, H - 40, W - 60, 5, s.at / s.order.length, JADE);
    drawText3(x, `${s.at} OF ${s.order.length} STITCHES`, W / 2, H - 30, DIM);
    fxDraw(x, s, dt);
    fxFlash(x, W, H, s.wrong, '224,69,58');
    return rows;
  },
  /** One place decides what a stitch does, whichever way you asked for it. */
  _sew(idx, s) {
    if (idx === s.at) {
      s.at++; s.pull = 1;
      s.sfx?.('oche'); s.sfx?.('page');              // the needle through, the thread after it
      /* Lint off the weave where the needle went in, and a small tug
         through the frame as the thread is drawn tight. */
      {
        const q = s.tears[s.order[s.at - 1][0]][s.order[s.at - 1][1]];
        const px2 = 26 + q.x * (320 - 52), py2 = 40 + q.y * (224 - 92);
        fxBurst(s, 'puff', px2, py2, 4, { col: 'rgba(232,224,196,.65)', speed: 24, life: 0.55, r: 2 });
        fxBurst(s, 'spark', px2, py2, 3, { col: '#dfffc4', speed: 48, life: 0.3 });
        fxShake(s, 0.22);
      }
      // the needle follows the thread to the next hole
      const nk = s.order[s.at];
      if (nk) { s.nx = s.tears[nk[0]][nk[1]].x; s.ny = s.tears[nk[0]][nk[1]].y; }
      return s.at >= s.order.length;
    }
    s.sfx?.('deny');
    s.wrong = 1;
    s.miss = 1;
    fxShake(s, 0.7);
    // drop back to the start of the tear you botched, not the whole sail
    const tear = s.order[s.at]?.[0] ?? 0;
    while (s.at > 0 && s.order[s.at - 1][0] === tear) s.at--;
    return false;
  },
  click(row, i, s) {
    return row?.idx !== undefined ? this._sew(row.idx, s) : false;
  },
  key(code, s) {
    const STEP = 0.035;
    if (code === 'ArrowLeft' || code === 'KeyA') { s.nx = Math.max(0.02, s.nx - STEP); return false; }
    if (code === 'ArrowRight' || code === 'KeyD') { s.nx = Math.min(0.98, s.nx + STEP); return false; }
    if (code === 'ArrowUp' || code === 'KeyW') { s.ny = Math.max(0.02, s.ny - STEP * 1.5); return false; }
    if (code === 'ArrowDown' || code === 'KeyS') { s.ny = Math.min(0.98, s.ny + STEP * 1.5); return false; }
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;
    /* Whatever hole the needle is closest to, if it is close enough. In
       sail units, since that is what the needle is in. */
    let best = -1, bestD = 0.055;
    s.order.forEach(([tear, i], idx) => {
      if (idx < s.at) return;
      const p = s.tears[tear][i];
      const d = Math.hypot(p.x - s.nx, (p.y - s.ny) * 0.62);
      if (d < bestD) { bestD = d; best = idx; }
    });
    if (best < 0) { s.sfx?.('deny'); s.miss = 1; return false; }
    return this._sew(best, s);
  },
};

/* ===========================================================
   4. SET THE DIALS — three wheels to a target reading.
   =========================================================== */
const dials = {
  name: 'SET THE DIALS',
  hint: 'LEFT RIGHT PICK   UP DOWN TURN',
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
    s.dropped = new Array(n).fill(false);   // which tumblers have already fallen
    s.boltSaid = false;
    fxInit(s);
    if (s.want.every((v, i) => v === s.have[i])) s.have[0] = (s.have[0] % 9) + 1;
  },

  draw(x, W, H, s, t, dt) {
    const rows = [];
    const n = s.have.length;
    /* The screen decays `shake` and moves the whole panel with it now, so
       a game that also decayed it halved its own jolt and one that also
       offset its contents slid them out from under their own frame. */
    const solved = s.want.every((v, i) => v === s.have[i]);
    if (solved) s.bolt = Math.min(1, (s.bolt || 0) + dt * 3);
    /* A tumbler falling is the moment of this game, and it happened in
       silence with nothing coming off it. Grit out of the wards, a knock
       through the case, and the same again louder when the bolt runs. */
    s.dropped = s.dropped || new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const home = s.want[i] === s.have[i];
      if (home && !s.dropped[i]) {
        s.dropped[i] = true;
        fxShake(s, 0.30);
        fxBurst(s, 'chunk', W / 2, 96, 4, { col: '#5c3f1c', speed: 70, life: 0.5, r: 2 });
        fxBurst(s, 'puff', W / 2, 96, 3, { col: 'rgba(150,130,90,.5)', speed: 22, life: 0.7, r: 2 });
      } else if (!home && s.dropped[i]) s.dropped[i] = false;
    }
    if (solved && !s.boltSaid) {
      s.boltSaid = true;
      fxShake(s, 0.9);
      fxBurst(s, 'spark', W / 2, 118, 12, { col: '#ffe9a8', speed: 120, life: 0.5 });
      fxBurst(s, 'puff', W / 2, 118, 4, { col: 'rgba(170,150,110,.55)', speed: 30, life: 0.9, r: 3 });
    }

    /* ---- layout, in bands, so nothing can drift into anything ---- */
    const DW = n > 3 ? 40 : 46, GAP = 8;
    const TOTAL = n * DW + (n - 1) * GAP;
    const OX = Math.round((W - TOTAL) / 2);
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
    fxDraw(x, s, dt);
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
  hint: 'LEFT RIGHT MOVE   SPACE SCOOP',
  /* This used to be one key pressed as fast as you could, which is not a
     game, it is a countdown with extra work. Now the water SLOSHES: the
     ship rolls, the level runs from one end of the hull to the other, and
     the bucket only lifts what is actually under it. So you chase the deep
     end, and mashing at the shallow end does nothing at all. */
  init(s) {
    s.level = s.hard ? 0.86 : 0.76;
    s.rate = s.hard ? 0.105 : 0.062;
    s.wob = 0;
    s.pump = 0;
    s.bucket = 0.5;          // where you are, across the hull
    s.carry = 0;             // how much is in the bucket
    s.tip = 0;               // the tipping animation when you throw it out
    s.roll = 0;
    s.splash = [];
    s.miss = 0;
    s.best = 0;
    s.lastLevel = s.level;
    s.rising = 0;             // spray where the water is climbing the ribs
    fxInit(s);
  },
  /** How deep the water is at `u` across the hull, 0..1. */
  depthAt(s, u) {
    // the roll tilts the surface, and a second slower wave rides on it
    const tilt = Math.sin(s.wob * (s.hard ? 1.5 : 1.05)) * (s.hard ? 0.42 : 0.30);
    const wave = Math.sin(s.wob * 2.6 + u * 6.0) * 0.045;
    return Math.max(0, Math.min(1, s.level + (u - 0.5) * tilt * 2 + wave));
  },
  draw(x, W, H, s, t, dt) {
    s.level = Math.min(1, s.level + dt * (s.rate || 0.085));
    s.wob += dt;
    s.roll = Math.sin(s.wob * (s.hard ? 1.5 : 1.05)) * 0.06;
    if (s.pump > 0) s.pump -= dt * 3.4;
    if (s.tip > 0) s.tip -= dt * 2.2;
    if (s.miss > 0) s.miss -= dt * 3;
    /* Spray where the water is coming up, so a hull that is filling LOOKS
       like it is filling rather than a bar quietly changing height. */
    s.rising = (s.rising || 0) + dt;
    if (s.level > (s.lastLevel ?? s.level) && s.rising > 0.16) {
      s.rising = 0;
      const u = Math.random();
      const d = this.depthAt(s, u);
      fx(s, 'drop', 34 + u * (W - 68), (H - 96) * (1 - d) + 40, {
        vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 40,
        col: '#8fc8dc', life: 0.55,
      });
    }
    s.lastLevel = s.level;

    const hx = 34, hy = 40, hw = W - 68, hh = H - 96;

    /* ---- the hull, rolling ---- */
    x.save();
    x.translate(hx + hw / 2, hy + hh / 2);
    x.rotate(s.roll * 0.5);
    x.translate(-(hx + hw / 2), -(hy + hh / 2));

    x.fillStyle = '#3a2a18'; x.fillRect(hx, hy, hw, hh);
    ditherRect3(x, hx, hy, hw, hh, '#3a2a18', '#472f1a');
    // ribs, and a plank line or two
    for (let i = 1; i < 7; i++) {
      x.fillStyle = '#4a3722';
      x.fillRect(hx + Math.round((i / 7) * hw), hy, 2, hh);
      x.fillStyle = 'rgba(0,0,0,.25)';
      x.fillRect(hx + Math.round((i / 7) * hw) + 2, hy, 1, hh);
    }
    for (let yy = hy + 8; yy < hy + hh; yy += 9) {
      x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(hx, yy, hw, 1);
    }

    /* ---- the water, column by column, so it can slosh ---- */
    const COLS = 40;
    let deepU = 0.5, deepD = 0;
    for (let i = 0; i < COLS; i++) {
      const u = (i + 0.5) / COLS;
      const d = bail.depthAt(s, u);
      if (d > deepD) { deepD = d; deepU = u; }
      const cw = Math.ceil(hw / COLS);
      const cx0 = hx + Math.floor((i / COLS) * hw);
      const wy = Math.round(hy + hh - d * hh);
      for (let yy = wy; yy < hy + hh; yy++) {
        const k = (yy - wy) / Math.max(1, hy + hh - wy);
        x.fillStyle = `rgb(${Math.round(26 + k * 8)},${Math.round(62 - k * 18)},${Math.round(102 - k * 30)})`;
        x.fillRect(cx0, yy, cw, 1);
      }
      // the lit surface, brighter where it is deepest
      x.fillStyle = d > 0.02 ? `rgba(159,216,255,${(0.35 + d * 0.5).toFixed(2)})` : 'rgba(0,0,0,0)';
      x.fillRect(cx0, wy, cw, 1);
    }
    // foam streaks running with the slosh
    for (let i = 0; i < 6; i++) {
      const u = ((s.wob * 0.22 + i * 0.17) % 1);
      const d = bail.depthAt(s, u);
      if (d < 0.04) continue;
      const wy = Math.round(hy + hh - d * hh);
      x.fillStyle = 'rgba(190,225,245,.28)';
      x.fillRect(hx + Math.round(u * hw), wy + 2 + (i % 3) * 3, 12, 1);
    }

    /* ---- the bucket ---- */
    const bux = Math.round(hx + s.bucket * hw - 9);
    const surface = hy + hh - bail.depthAt(s, s.bucket) * hh;
    // it dips into the water when you scoop, and tips out over the side
    const dip = Math.sin(Math.max(0, s.pump) * Math.PI) * 16;
    const buy = Math.round(Math.min(surface - 16 + dip, hy + hh - 20));
    x.save();
    x.translate(bux + 9, buy + 6);
    x.rotate(-s.tip * 1.5);
    x.translate(-(bux + 9), -(buy + 6));
    // what is in it
    if (s.carry > 0.01) {
      x.fillStyle = '#2a5a8a';
      x.fillRect(bux + 2, buy + 12 - Math.round(s.carry * 9), 14, Math.round(s.carry * 9));
    }
    x.fillStyle = '#8a7048'; x.fillRect(bux, buy, 18, 13);
    x.fillStyle = '#6a5432'; x.fillRect(bux + 1, buy + 1, 16, 3);
    x.fillStyle = '#a88a58'; x.fillRect(bux, buy, 18, 1);
    // the handle
    x.fillStyle = '#5a4a2a';
    x.fillRect(bux - 1, buy - 4, 1, 5); x.fillRect(bux + 18, buy - 4, 1, 5);
    x.fillRect(bux, buy - 5, 18, 1);
    x.restore();

    /* the guide line: where the water is deepest, which is where to be */
    {
      const gx = Math.round(hx + deepU * hw);
      const blink = Math.floor(t * 5) % 2;
      x.fillStyle = blink ? 'rgba(255,210,74,.55)' : 'rgba(255,210,74,.22)';
      x.fillRect(gx, hy + 2, 1, 6);
      x.fillStyle = 'rgba(255,210,74,.75)';
      x.fillRect(gx - 2, hy + 2, 5, 1);
    }

    /* splashes */
    for (let i = s.splash.length - 1; i >= 0; i--) {
      const p = s.splash[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt;
      if (p.t > 0.5) { s.splash.splice(i, 1); continue; }
      x.fillStyle = `rgba(180,225,250,${(1 - p.t / 0.5).toFixed(2)})`;
      x.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }

    x.fillStyle = '#5c3f1c';
    x.fillRect(hx, hy, hw, 1); x.fillRect(hx, hy + hh - 1, hw, 1);
    x.fillRect(hx, hy, 1, hh); x.fillRect(hx + hw - 1, hy, 1, hh);
    x.restore();

    /* ---- the readout ---- */
    bar(x, 34, H - 48, W - 68, 6, 1 - s.level, s.level > 0.88 ? RED : JADE);
    const msg = s.miss > 0 ? 'NOTHING THERE - FIND THE DEEP END'
      : (s.level > 0.88 ? 'SHE IS GOING DOWN'
        : 'BAIL FROM WHERE IT IS DEEPEST');
    drawText3(x, msg, W / 2, H - 38, s.miss > 0 ? '#ffb08a' : (s.level > 0.88 ? RED : DIM));
    fxDraw(x, s, dt);
    fxFlash(x, W, H, s.miss, '224,69,58');
    return [];
  },
  key(code, s) {
    if (code === 'ArrowLeft' || code === 'KeyA') { s.bucket = Math.max(0.04, s.bucket - 0.09); return false; }
    if (code === 'ArrowRight' || code === 'KeyD') { s.bucket = Math.min(0.96, s.bucket + 0.09); return false; }
    if (code !== 'Space' && code !== 'Enter' && code !== 'KeyE') return false;

    /* What you lift is what is under you. At the shallow end that is
       nothing, and the whole game is knowing that. */
    const d = bail.depthAt(s, s.bucket);
    const got = Math.min(s.level, d * 0.20);
    s.pump = 1;
    s.tip = 1;
    if (got < 0.012) {
      // the bucket scrapes the boards: a knock and a dry rattle, no water
      s.sfx?.('deny');
      fxShake(s, 0.35);
      fxBurst(s, 'chunk', 34 + s.bucket * (320 - 68), 96, 3,
        { col: '#5a4a2c', speed: 60, life: 0.45, r: 2 });
      s.miss = 1; s.carry = 0; return false;
    }
    s.sfx?.('step_water'); s.sfx?.('pour');          // in, and over the side
    /* A full bucket is thrown over the side: a rope of water going out
       and a shower coming off it. The old version put seven flat pixels
       on the screen and called it a splash. */
    {
      const bxp = 34 + s.bucket * (320 - 68);
      fxBurst(s, 'drop', bxp, 62, 14, {
        col: '#9fd8e8', speed: 130, life: 0.6, squash: 0.5, driftY: -60,
      });
      fxBurst(s, 'puff', bxp, 66, 3, { col: 'rgba(200,230,240,.5)', speed: 26, life: 0.5, r: 2 });
      fxShake(s, 0.28 * Math.min(1, got / 0.14));
    }
    s.carry = Math.min(1, got / 0.2);
    s.level = Math.max(0, s.level - got);
    s.best = Math.max(s.best || 0, got);
    // a handful of drops thrown over the side
    for (let i = 0; i < 7; i++) {
      s.splash.push({
        x: 34 + s.bucket * 100, y: 60,
        vx: -60 - Math.random() * 90, vy: -90 - Math.random() * 70, t: 0,
      });
    }
    setTimeout(() => { s.carry = 0; }, 260);
    return s.level <= 0.02;
  },
};

export const MINIGAMES = { wind, splice, stitch, dials, bail };

/* ---------- little drawing helpers, kept local ---------- */
let _draw = null;
/** screens.js injects its own text routine so the font stays in one place. */
export function bindText(fn) { _draw = fn; }

/* SOUND. Four of these five were silent: only the dials ever called the
   `s.sfx` hook screens.js has been handing them all along. They are
   physical things — a pendulum, a needle, a bucket — and doing physical
   things without a noise is the difference between a puzzle and a chore. */
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
