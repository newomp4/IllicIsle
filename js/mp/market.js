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
export const STAGE_PAY_MIN = 1;
export const STAGE_PAY_MAX = 6;
export const STAGE_PAY = 3;          // the average, for anything that needs one

/** Share of a victim's purse an Agent takes off the body. */
export const LOOT_SHARE = 0.75;

/** How close to the counter you have to be for Ferdi's protection. */
export const SANCTUARY_R = 13;

/**
 * Every line Ferdi keeps.
 *
 * The blurbs say what the thing does, in numbers, in plain words. They
 * used to be written to sound mysterious, which meant nobody could tell
 * what they were buying — and in a couple of cases the mystery was hiding
 * the fact that the item did nothing at all.
 *
 * `night: true` means it is only on the shelf after dark.
 */
export const STOCK = [
  /* ---------- the front of the shop ---------- */
  {
    id: 'lantern', name: 'STORM LANTERN', cost: 5, side: 'open', icon: 'lantern',
    blurb: 'While a Rogue Agent has the mist up, you can see 22 metres instead of 8, '
      + 'and you carry your own light. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'vest', name: 'CORK VEST', cost: 13, side: 'open', icon: 'vest',
    blurb: 'The next time an Agent strikes you, it fails and the vest is destroyed. '
      + 'You survive; they are left standing over nobody.',
    tag: 'ONE USE',
  },
  {
    id: 'whistle', name: "FERDI'S WHISTLE", cost: 7, side: 'open', icon: 'whistle',
    blurb: 'Blow it and your name appears over your head for every player on the '
      + 'island, through any weather, for 12 seconds. Proof of where you were.',
    tag: 'ONE USE',
  },
  {
    id: 'tonic', name: 'CANE TONIC', cost: 4, side: 'open', icon: 'tonic',
    blurb: 'You stop running out of breath: sprinting costs almost nothing and '
      + 'recovers five times faster. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'spyglass', name: 'SPYGLASS', cost: 13, side: 'open', icon: 'chart',
    blurb: 'You can read names over heads from 68 metres instead of 34 — twice as '
      + 'far as anybody else. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'speaker', name: 'THE PARTY BOX', cost: 8, side: 'open', icon: 'speaker',
    blurb: 'Drop it and it plays for 60 seconds. Every player sees exactly where it '
      + 'is on their map. Somewhere to be, or somewhere to send everyone else.',
    tag: 'ONE USE',
  },
  {
    id: 'chart', name: 'SECOND CHART', cost: 8, side: 'open', icon: 'chart',
    blurb: 'Puts the listening post on your map and your compass, wherever it is '
      + 'buried this round. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'rounds', name: "FERDI'S ROUNDS", cost: 10, side: 'open', icon: 'chart',
    blurb: 'His delivery notes. Both of his machines out in the trees appear on your '
      + 'map and compass for the rest of the round. Most players never find one.',
    tag: 'PASSIVE',
  },
  {
    id: 'flask', name: "FLOPPER'S FLASK", cost: 5, side: 'open', icon: 'flask',
    blurb: 'Drink it and the next job you touch completes instantly - no holding, '
      + 'no puzzle. Keeps until you use it.',
    tag: 'ONE USE',
  },

  /* ---------- after dark, at the front ---------- */
  {
    id: 'nightglass', name: 'NIGHT GLASS', cost: 15, side: 'open', icon: 'lantern',
    night: true,
    blurb: 'Night stops mattering to you. The world stays as bright at midnight as '
      + 'it is at noon, for the rest of the round. Sold after dark only.',
    tag: 'PASSIVE',
  },
  {
    id: 'ticket', name: 'BOOK OF TICKETS', cost: 9, side: 'open', icon: 'coin',
    night: true,
    blurb: 'Three free pulls on any machine aboard the Lucky Flopper. Saves you 9 '
      + 'Syncoin and the odds are the same. Sold after dark only.',
    tag: 'THREE USES',
  },

  /* ---------- the room behind it ---------- */
  {
    id: 'soles', name: 'QUIET SOLES', cost: 9, side: 'black', icon: 'soles',
    blurb: 'Your name never appears over your head, at any distance, for anybody. '
      + 'They will see somebody walk past and not know who. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'alibi', name: 'FALSE ALIBI', cost: 11, side: 'black', icon: 'alibi',
    blurb: 'For 20 seconds you appear on everyone else\'s map, and on the command '
      + 'table, standing somewhere else entirely. Your own map still shows the truth.',
    tag: 'ONE USE',
  },
  {
    id: 'whetstone', name: 'THE WHETSTONE', cost: 10, side: 'black', icon: 'knife',
    blurb: 'Cuts a third off your current kill cooldown the moment you buy it, and a '
      + 'third off every one after it. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'skeleton', name: 'SKELETON KEY', cost: 12, side: 'black', icon: 'key',
    blurb: 'Drops you straight into the listening post from wherever you are '
      + 'standing. No walk, no witnesses.',
    tag: 'ONE USE',
  },
  {
    id: 'chaff', name: 'HANDFUL OF CHAFF', cost: 9, side: 'black', icon: 'chaff',
    blurb: 'For 30 seconds the command table lies: every marker jumps somewhere '
      + 'random and the coin ledger is wrong. Whoever is down there stops trusting it.',
    tag: 'ONE USE',
  },
  {
    id: 'shroud', name: 'LEAD SHROUD', cost: 12, side: 'black', icon: 'soles',
    blurb: 'For 45 seconds you do not appear on the command table at all. Not moved, '
      + 'not scrambled - absent. Nobody watching can place you anywhere.',
    tag: 'ONE USE',
  },
  {
    id: 'blackout', name: 'BLACKOUT CHARGE', cost: 14, side: 'black', icon: 'chaff',
    night: true,
    blurb: 'Puts out every torch and the campfire across the whole island for 45 '
      + 'seconds. In the dark nobody can read anybody. Sold after dark only.',
    tag: 'ONE USE',
  },

  /* ---------- the thing under the counter ---------- */
  {
    id: 'gun', name: 'FLARE PISTOL', cost: 24, side: 'both', icon: 'gun',
    blurb: 'One shot. It does not kill: it puts them on the ground for 12 seconds and '
      + 'calls an immediate vote among everyone who saw it. Draw it from your belt, '
      + 'then click or press F.',
    tag: 'ONE SHOT',
  },
];

/**
 * What Ferdi's outlying machines hold. Not the whole shop — leftovers, the
 * things nobody walks all the way to the clearing for. A machine is worth
 * finding, but it is not a substitute for the counter.
 */
export const VENDOR_IDS = ['tonic', 'lantern', 'flask', 'whistle', 'ticket'];

export const itemById = (id) => STOCK.find((i) => i.id === id);

/**
 * What this player is allowed to be shown right now.
 * @param {boolean} isAgent
 * @param {boolean} isNight  some lines only come out after dark
 */
export function stockFor(isAgent, isNight = true) {
  return STOCK.filter((i) => (i.side === 'both' || (isAgent ? true : i.side === 'open'))
    && (!i.night || isNight));
}

/** Everything on the shelf on this side of the counter, right now. */
export function shelf(side, isNight) {
  return STOCK.filter((i) => (side === 'black'
    ? (i.side === 'black' || i.side === 'both')
    : (i.side === 'open' || i.side === 'both'))
    && (!i.night || isNight));
}
