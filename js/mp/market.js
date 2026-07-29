/* ===========================================================
   market.js — Ferdi Steinman's, and the room behind it.

   Syncoins were decoration. They are the spine of the round now:
   Castaways earn them by finishing work, Agents can only find them
   on the ground, and both spend them at the same counter — except
   that the Agents can see a second list nobody else can.

   Every item is one clear, legible advantage. Nothing here is a
   number tweak you cannot feel.
   =========================================================== */

/**
 * Coins for finishing one stage of a chore — a random handful rather than
 * a flat rate, so a run of good luck can put something in reach early.
 * Agents get nothing; their lists are a cover.
 */
export const STAGE_PAY_MIN = 2;
export const STAGE_PAY_MAX = 10;
export const STAGE_PAY = 6;          // the average, for anything that needs one

/** Share of a victim's purse an Agent takes off the body. */
export const LOOT_SHARE = 0.75;

/** How close to the counter you have to be for Ferdi's protection. */
export const SANCTUARY_R = 13;

export const STOCK = [
  /* ---------- the front of the shop ---------- */
  {
    id: 'lantern', name: 'STORM LANTERN', cost: 5, side: 'open', icon: 'lantern',
    blurb: 'Burns through the mist. You see roughly as far as an Agent does while it is down.',
    tag: 'PASSIVE',
  },
  {
    id: 'vest', name: 'CORK VEST', cost: 13, side: 'open', icon: 'vest',
    blurb: 'Takes one strike for you. Whoever swung it is left standing over nobody.',
    tag: 'ONE USE',
  },
  {
    id: 'whistle', name: "FERDI'S WHISTLE", cost: 7, side: 'open', icon: 'whistle',
    blurb: 'Puts your name over your head for everybody, anywhere, for twelve seconds. An alibi you can prove.',
    tag: 'ONE USE',
  },
  {
    id: 'tonic', name: 'CANE TONIC', cost: 4, side: 'open', icon: 'tonic',
    blurb: 'You stop running out of breath. Getting there first is most of this game.',
    tag: 'PASSIVE',
  },

  /* ---------- the room behind it ---------- */
  {
    id: 'soles', name: 'QUIET SOLES', cost: 9, side: 'black', icon: 'soles',
    blurb: 'No footfall, and no name over your head at any distance. They will not know who walked past.',
    tag: 'PASSIVE',
  },
  {
    id: 'alibi', name: 'A FALSE ALIBI', cost: 11, side: 'black', icon: 'alibi',
    blurb: 'Your marker shows somewhere else on their charts for twenty seconds. Pick your moment.',
    tag: 'ONE USE',
  },
  {
    id: 'whetstone', name: 'THE WHETSTONE', cost: 10, side: 'black', icon: 'knife',
    blurb: 'Takes a third off the wait between kills, for the rest of the round.',
    tag: 'PASSIVE',
  },

  /* ---------- the thing under the counter ---------- */
  {
    id: 'gun', name: 'THE FLARE PISTOL', cost: 24, side: 'both', icon: 'gun',
    blurb: 'One shot. It will not kill anybody - it puts them on the sand seeing stars, '
      + 'and everyone close enough to have seen it votes on the spot.',
    tag: 'ONE SHOT',
  },
];

export const itemById = (id) => STOCK.find((i) => i.id === id);

/** What this player is allowed to be shown. */
export function stockFor(isAgent) {
  return STOCK.filter((i) => i.side === 'both' || (isAgent ? true : i.side === 'open'));
}
