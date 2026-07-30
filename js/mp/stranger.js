/* ===========================================================
   stranger.js — the one who is not on the roster.

   Once a round, somebody who looks like another castaway comes
   out of the treeline. He moves far faster than anybody should,
   he keeps to the jungle, and he is gone in about a minute
   whether you found him or not.

   If you do reach him he will tell you one true thing about a
   Rogue Agent, in the least helpful way he can manage. Never a
   name — a place, a purse, a habit. Enough to cross two people
   off, not enough to end anybody.

   The host owns all of it: where he is, when he goes, who he is
   talking about and what he says. Clients only draw him.
   =========================================================== */

import * as THREE from 'three';
import { mergeGeos, box, cyl, ico, tint } from '../lib/geo.js';

const G = (n) => new THREE.Color(n);

/* ===========================================================
   THE FIGURE
   A castaway silhouette, but wrong: too tall, hooded, and lit
   from inside so you can pick him out of a treeline at dusk.
   =========================================================== */
export function buildStranger(mats) {
  const g = new THREE.Group();
  const P = [];
  /* Dark, but a figure rather than a hole. At the old values he read as a
     shadow with two lights in it even when you were standing next to him. */
  const CLOTH = G(0x50606e), CLOTH_D = G(0x33404c), SKIN = G(0xb09a84);

  // a long coat, narrow, reaching the ground
  P.push(tint(cyl(0.30, 0.46, 1.55, 8, 'clothTat', { pos: [0, 0.78, 0] }), CLOTH));
  P.push(tint(cyl(0.32, 0.32, 0.10, 8, 'clothTat', { pos: [0, 1.52, 0] }), CLOTH_D));
  // shoulders and a hood that hides the face
  P.push(tint(box(0.62, 0.22, 0.34, 'clothTat', { pos: [0, 1.62, 0] }), CLOTH_D));
  P.push(tint(cyl(0.24, 0.30, 0.34, 8, 'clothTat', { pos: [0, 1.86, -0.02] }), CLOTH));
  P.push(tint(box(0.34, 0.22, 0.10, 'clothTat', { pos: [0, 1.86, 0.16] }), CLOTH_D));
  // arms held in
  for (const sx of [-1, 1]) {
    P.push(tint(cyl(0.09, 0.075, 0.62, 6, 'clothTat', {
      pos: [sx * 0.30, 1.28, 0.02], rot: [0, 0, sx * 0.12],
    }), CLOTH));
    P.push(tint(ico(0.075, 0, 'skin', { pos: [sx * 0.33, 0.98, 0.06] }), SKIN));
  }
  // and the hem, which moves
  const hem = new THREE.Group();
  const hemParts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    hemParts.push(tint(box(0.20, 0.34, 0.06, 'clothTat', {
      pos: [Math.cos(a) * 0.40, -0.17, Math.sin(a) * 0.40], rot: [0, -a, 0],
    }), CLOTH_D));
  }
  hem.add(new THREE.Mesh(mergeGeos(hemParts), mats.opaque));
  hem.position.y = 0.18;
  g.add(hem);
  g.add(new THREE.Mesh(mergeGeos(P), mats.opaque));

  /* Two points of light under the hood, so you can see him watching you
     from thirty metres of jungle. */
  const eyes = [];
  for (const sx of [-0.07, 0.07]) {
    const e = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.03, 0.02),
      new THREE.MeshBasicMaterial({ color: 0xbdf0ff, fog: true })
    );
    e.position.set(sx, 1.88, 0.20);
    g.add(e);
    eyes.push(e);
  }

  /* He fades rather than blinking out — an object that simply stops being
     there reads as a bug, and he is supposed to read as a ghost. */
  const fadeMats = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.material.transparent = true;
    fadeMats.push(o.material);
  });

  g.userData.setFade = (k) => {
    for (const m of fadeMats) m.opacity = k;
    g.visible = k > 0.02;
  };
  g.userData.tick = (t, dt = 0.016) => {
    // the hem swings with whatever direction he is facing
    hem.rotation.y = Math.sin(t * 2.1) * 0.12;
    hem.position.y = 0.18 + Math.abs(Math.sin(t * 4.2)) * 0.03;
    const glow = 0.7 + Math.sin(t * 5.3) * 0.3;
    for (const e of eyes) e.material.color.setRGB(0.6 * glow + 0.2, 0.9 * glow, glow);
  };
  g.userData.setFade(0);
  return g;
}

/* ===========================================================
   THE CLUES
   Every one is true, and every one leaves you with at least two
   people it could be.
   =========================================================== */

const PLACE_RIDDLES = [
  'ONE WHO SMILES AT YOU STOOD IN THE SHADOW OF {P} WHILE THE REST OF YOU WERE ELSEWHERE.',
  'ASK YOURSELF WHO HAD BUSINESS AT {P}. THEY WILL TELL YOU THEY HAD NONE.',
  '{P} REMEMBERS A VISITOR IT DID NOT EXPECT. THE VISITOR IS STILL BREATHING.',
  'THE GROUND AT {P} WAS DISTURBED. NOT BY THE WIND, AND NOT BY YOU.',
];

const PURSE_RICH = [
  'ONE OF THEM CARRIES MORE COIN THAN THEIR WORK COULD EVER HAVE EARNED.',
  'COUNT THE PURSES. THE HEAVIEST ONE HAS NOT BEEN FILLED HONESTLY.',
];

const PURSE_POOR = [
  'ONE OF THEM HAS NOT EARNED A SINGLE COIN AND HAS NOT NEEDED TO.',
  'THE LIGHTEST PURSE ON THIS ISLAND BELONGS TO SOMEBODY WHO IS NOT WORKING.',
];

const NEAR_RIDDLES = [
  'WHEN THE LAST OF YOU FELL, ONE WHO WEEPS FOR THEM WAS CLOSER THAN THEY HAVE SAID.',
  'SOMEBODY WAS WITHIN A STONE\'S THROW OF THE LAST BODY. THEY HAVE NOT MENTIONED IT.',
];

/* The fallback, which is never nothing: which half of the island one of
   them is standing in. It cuts the list roughly in two and names nobody. */
const HALF_RIDDLES = [
  'ONE OF THEM IS IN THE {H} OF THIS ISLAND RIGHT NOW. GO AND SEE WHO IS NOT.',
  'LOOK {H}. SOMEBODY WHO SHOULD BE ELSEWHERE IS THERE.',
  'THE {H} HALF OF THIS PLACE HOLDS ONE OF THEM AS I SPEAK.',
];

const PLACES = {
  camp: 'THE FIRE', wreck: 'THE WRECK', hut: "FERDI'S COUNTER",
  temple: 'THE TEMPLE DOOR', lagoon: 'THE LAGOON', crates: "FERDI'S CRATES",
  pend1: 'THE WEST PENDULUM', pend2: 'THE RIDGE PENDULUM',
  pend3: 'THE EAST PENDULUM', pend4: 'THE NORTH PENDULUM',
  casino: 'THE LUCKY FLOPPER', post: 'THE LISTENING POST',
};

/**
 * Build one true, unhelpful clue about a living Agent.
 *
 * @param {object} o
 * @param {Array} o.agents   [{ id, x, z, coins, nearBody }]
 * @param {Array} o.crew     everybody alive, for the purse comparison
 * @param {object} o.named    landmark name -> { x, z }
 * @param {() => number} o.rand
 * @returns {{ text: string, about: string|null }}
 */
export function makeClue({ agents, crew, named, rand = Math.random }) {
  const live = (agents || []).filter((a) => a && a.alive !== false);
  if (!live.length) {
    return {
      text: 'THEY ARE ALL ACCOUNTED FOR. YOU HAVE NO ENEMY LEFT TO FIND.',
      about: null,
    };
  }
  const target = live[(rand() * live.length) | 0];
  const kinds = [];

  /* ---- a place: the landmark he was nearest, if he is near one at all ---- */
  let bestName = null, bestD = 72;
  for (const [key, at] of Object.entries(named || {})) {
    if (!at || !PLACES[key]) continue;
    const d = Math.hypot((target.x || 0) - at.x, (target.z || 0) - at.z);
    if (d < bestD) { bestD = d; bestName = PLACES[key]; }
  }
  if (bestName) kinds.push('place');

  /* ---- a purse, but only when it actually stands out ---- */
  const purses = (crew || []).map((c) => c.coins | 0).sort((a, b) => b - a);
  if (purses.length >= 3) {
    const mine = target.coins | 0;
    if (mine === purses[0] && mine > (purses[1] | 0) + 4) kinds.push('rich');
    if (mine === purses[purses.length - 1] && mine + 4 < (purses[purses.length - 2] | 0)) kinds.push('poor');
  }

  /* ---- and whether they were standing over the last body ---- */
  if (target.nearBody) kinds.push('near');

  /* There is always something to say. If nothing else stands out, the half
     of the island they are standing in does. */
  if (!kinds.length) kinds.push('half');
  const kind = kinds[(rand() * kinds.length) | 0];
  const pick = (list) => list[(rand() * list.length) | 0];
  let text;
  if (kind === 'place') text = pick(PLACE_RIDDLES).replace('{P}', bestName);
  else if (kind === 'rich') text = pick(PURSE_RICH);
  else if (kind === 'poor') text = pick(PURSE_POOR);
  else if (kind === 'near') text = pick(NEAR_RIDDLES);
  else {
    const half = Math.abs(target.x || 0) > Math.abs(target.z || 0)
      ? ((target.x || 0) > 0 ? 'EAST' : 'WEST')
      : ((target.z || 0) > 0 ? 'SOUTH' : 'NORTH');
    text = pick(HALF_RIDDLES).replace('{H}', half);
  }
  return { text, about: target.id };
}

/** What he says before and after, so he is not just a vending machine. */
export const STRANGER_OPENERS = [
  'YOU FOUND ME. NOBODY FINDS ME.',
  'I DO NOT COME ASHORE FOR EVERYONE.',
  'QUICKLY, THEN. I AM NOT SUPPOSED TO BE HERE.',
];
export const STRANGER_CLOSERS = [
  'DO NOT SAY IT WAS ME.',
  'I WAS NEVER ON YOUR LIST. REMEMBER THAT.',
  'GO. AND DO NOT LOOK FOR ME AGAIN.',
];
