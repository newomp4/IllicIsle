/* ===========================================================
   darts.js — 301, straight in, double out, against Quezetriel.

   All the rules live here so the screen only has to draw. The board
   is real: the twenty beds are in the real order, the trebles and
   doubles are where they should be, and a miss is a miss.

   The throw is two decisions, not one. A sweep runs left and right
   across the board and you stop it; then a second sweep runs up and
   down and you stop that. Where the two cross is where the dart
   goes, plus a wobble that gets worse the more you have had to
   drink. Nothing is random until you have committed to both.
   =========================================================== */

/** Clockwise from the top. The one thing about a dartboard everybody knows. */
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/* Ring radii, as a fraction of the board's own radius. These are the real
   proportions: the trebles sit a little inside halfway, the doubles on the
   rim, and the bull is small. */
export const R_BULL = 0.062;
export const R_OUTER = 0.152;
export const R_TREBLE_IN = 0.582;
export const R_TREBLE_OUT = 0.648;
export const R_DOUBLE_IN = 0.926;
export const R_DOUBLE_OUT = 1.0;

/**
 * What a dart at (dx, dy) from the middle of the board is worth.
 * Units are fractions of the board radius. Returns {score, label, ring, bed}.
 */
export function scoreAt(dx, dy) {
  const r = Math.hypot(dx, dy);
  if (r > R_DOUBLE_OUT) return { score: 0, label: 'OFF THE BOARD', ring: 'miss', bed: 0 };
  if (r <= R_BULL) return { score: 50, label: 'BULL', ring: 'inner', bed: 25 };
  if (r <= R_OUTER) return { score: 25, label: 'OUTER BULL', ring: 'outer', bed: 25 };

  /* Which bed. Twelve o'clock is the middle of the 20, and the angle runs
     clockwise, so it is measured from up and the sign of x is what turns it
     into "clockwise". */
  let a = Math.atan2(dx, -dy);                 // 0 at the top, growing clockwise
  if (a < 0) a += Math.PI * 2;
  const i = Math.floor((a + Math.PI / 20) / (Math.PI * 2 / 20)) % 20;
  const bed = ORDER[i];

  if (r >= R_TREBLE_IN && r <= R_TREBLE_OUT) {
    return { score: bed * 3, label: `TREBLE ${bed}`, ring: 'treble', bed };
  }
  if (r >= R_DOUBLE_IN) {
    return { score: bed * 2, label: `DOUBLE ${bed}`, ring: 'double', bed };
  }
  return { score: bed, label: String(bed), ring: 'single', bed };
}

/** Which of the twenty wedges a bed number sits in, for drawing. */
export function bedIndex(n) { return ORDER.indexOf(n); }

/* ===========================================================
   A LEG
   =========================================================== */
export const START = 301;

export function newLeg(stake) {
  return {
    stake,
    you: START,
    him: START,
    turn: 'you',
    darts: [],            // this turn's throws: {x, y, score, label, ring}
    thrown: 0,            // how many of the three are gone
    turnStart: START,     // what you were on when this turn began
    log: [],              // one line per completed turn
    over: null,           // 'you' | 'him' when somebody checks out
    bust: false,
  };
}

/**
 * Apply a throw. Returns what happened to the leg.
 *
 * 301 straight in, double out: you may start on anything, but the throw
 * that takes you to nought has to be a double or a bull, and going below
 * two — or to one — is a bust and the whole turn is scrubbed.
 */
export function throwDart(leg, dx, dy) {
  const hit = scoreAt(dx, dy);
  const who = leg.turn;
  const before = who === 'you' ? leg.you : leg.him;
  let left = before - hit.score;
  let bust = false;
  let out = false;

  if (left === 0) {
    // only a double or the bull finishes it
    if (hit.ring === 'double' || hit.ring === 'inner') out = true;
    else { bust = true; left = before; }
  } else if (left < 2) {
    bust = true;
    left = before;
  }

  leg.darts.push({ x: dx, y: dy, ...hit, bust });
  leg.thrown++;

  if (bust) {
    // everything this turn is undone, not just the dart that did it
    if (who === 'you') leg.you = leg.turnStart; else leg.him = leg.turnStart;
    leg.bust = true;
    return { hit, bust: true, out: false, left: leg.turnStart };
  }

  if (who === 'you') leg.you = left; else leg.him = left;
  if (out) { leg.over = who; return { hit, bust: false, out: true, left: 0 }; }
  return { hit, bust: false, out: false, left };
}

/** True when the turn is finished: three darts, a bust, or a checkout. */
export function turnDone(leg) {
  return leg.over !== null || leg.bust || leg.thrown >= 3;
}

/** Hand over. Writes the turn into the log and resets the dart counter. */
export function endTurn(leg) {
  const who = leg.turn;
  const now = who === 'you' ? leg.you : leg.him;
  const scored = leg.bust ? 0 : leg.turnStart - now;
  leg.log.unshift({
    who, scored, left: now, bust: leg.bust,
    darts: leg.darts.map((d) => d.label),
  });
  if (leg.log.length > 8) leg.log.length = 8;
  leg.turn = who === 'you' ? 'him' : 'you';
  leg.turnStart = leg.turn === 'you' ? leg.you : leg.him;
  leg.darts = [];
  leg.thrown = 0;
  leg.bust = false;
}

/* ===========================================================
   QUEZETRIEL

   He is good, but he is not a machine, and he is beatable — which he
   has to be, or nobody plays twice. He aims at the right thing, and
   then his hand does what hands do.

   `spread` is how far off he lands, in board radii. 0.09 is a man who
   plays every night; the wobble is deliberately larger when he is
   going for a double, because that is the shot everybody misses.
   =========================================================== */

/** What he should be aiming at, given what he needs. */
export function aimFor(left) {
  // a finishable double, if he is on one
  if (left <= 40 && left % 2 === 0) {
    return { bed: left / 2, ring: 'double', why: `D${left / 2}` };
  }
  if (left === 50) return { bed: 25, ring: 'inner', why: 'BULL' };
  // otherwise set one up: treble twenty until it is worth leaving a double
  if (left > 60) return { bed: 20, ring: 'treble', why: 'T20' };
  if (left > 40) {
    // leave himself an even number he can finish on
    const want = left - 20;
    if (want > 1 && want % 2 === 0) return { bed: 20, ring: 'single', why: '20' };
    return { bed: 19, ring: 'single', why: '19' };
  }
  // odd and under forty: take one off to make it even
  return { bed: 1, ring: 'single', why: 'ONE OFF' };
}

/** Turn an aim into a point on the board, then miss it a bit. */
export function aimPoint(aim, rand = Math.random) {
  let r;
  if (aim.ring === 'inner') r = 0;
  else if (aim.ring === 'treble') r = (R_TREBLE_IN + R_TREBLE_OUT) / 2;
  else if (aim.ring === 'double') r = (R_DOUBLE_IN + R_DOUBLE_OUT) / 2;
  else r = (R_OUTER + R_TREBLE_IN) / 2;
  if (aim.bed === 25) return { x: 0, y: 0 };
  const i = bedIndex(aim.bed);
  const a = i * (Math.PI * 2 / 20);
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/** One of his darts. */
export function hisThrow(left, rand = Math.random) {
  const aim = aimFor(left);
  const p = aimPoint(aim, rand);
  // doubles are the hard shot, and he misses them like everybody else
  const spread = aim.ring === 'double' ? 0.115 : (aim.ring === 'treble' ? 0.095 : 0.085);
  // box-muller, so his misses cluster round the aim rather than being flat
  const u = Math.max(1e-6, rand()), v = rand();
  const g1 = Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v);
  const g2 = Math.sqrt(-2 * Math.log(u)) * Math.sin(6.283 * v);
  return { x: p.x + g1 * spread, y: p.y + g2 * spread, aim };
}
