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
    id: 'vest', name: 'CORK VEST', cost: 18, side: 'open', icon: 'vest',
    blurb: 'The next time an Agent strikes you, it fails and the vest is destroyed. '
      + 'You survive. It is heavy, though: you move and sprint 25% slower for as long '
      + 'as you are wearing it.',
    tag: 'ONE USE',
  },
  {
    id: 'whistle', name: "FERDI'S WHISTLE", cost: 3, side: 'open', icon: 'whistle',
    blurb: 'Blow it and your name appears over your head for every player on the '
      + 'island, through any weather, for 12 seconds. Proof of where you were.',
    tag: 'ONE USE',
  },
  {
    id: 'tonic', name: 'CANE TONIC', cost: 12, side: 'open', icon: 'tonic',
    blurb: 'You stop running out of breath: sprinting costs almost nothing and '
      + 'recovers five times faster. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    /* Sold at the FRONT counter on purpose. When only Agents could buy
       these, a missing name over somebody's head was a confession — you
       had found your Agent without doing anything. Anyone can buy them, so
       walking unnamed proves nothing about you either way. */
    id: 'soles', name: 'QUIET SOLES', cost: 9, side: 'open', icon: 'soles',
    blurb: 'Your name never appears over your head, at any distance, for anybody - '
      + 'and neither does your footfall. Plenty of Castaways buy these too, so it '
      + 'tells nobody anything about you. Lasts the whole round.',
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
    blurb: 'A speaker the size of a crate. Drop it and it plays for 60 seconds, and '
      + 'while it does, NOBODY on the island shows their real position on any map or '
      + 'on the command table - every marker sits on the box instead. Names also stop '
      + 'appearing over heads within 18 metres of it. Everyone can see where the box '
      + 'is. Sixty seconds where the only way to know who is where is to go and look.',
    tag: 'ONE USE',
  },
  {
    id: 'chart', name: 'LISTENING POST MAP', cost: 8, side: 'open', icon: 'chart',
    blurb: 'Marks the hidden listening post on your map and your compass. It is in '
      + 'one of four places and it moves every round, so without this you have to '
      + 'search. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'rounds', name: 'VENDING MACHINE MAP', cost: 10, side: 'open', icon: 'chart',
    blurb: 'Ferdi has two vending machines hidden out in the jungle. This marks both '
      + 'of them on your map and your compass for the rest of the round. Each one '
      + 'sells one random item for 6 Syncoin, then it is empty.',
    tag: 'PASSIVE',
  },
  {
    id: 'flask', name: "FLOPPER'S FLASK", cost: 2, side: 'open', icon: 'flask',
    blurb: 'Drink it and the next job you touch completes instantly - no holding, '
      + 'no puzzle. Keeps until you use it.',
    tag: 'ONE USE',
  },

  /* ---------- after dark, at the front ---------- */
  {
    id: 'nightglass', name: 'NIGHT GLASS', cost: 15, side: 'open', icon: 'lantern',
    night: true,
    blurb: 'You can see in the dark: the island stays as bright at midnight as at '
      + 'noon, for you, for the rest of the round. Only on the shelf after dark.',
    tag: 'PASSIVE',
  },
  {
    id: 'ticket', name: 'BOOK OF TICKETS', cost: 9, side: 'open', icon: 'coin',
    night: true,
    blurb: 'Three free pulls on the slot machines aboard the Lucky Flopper. A pull '
      + 'normally costs 3, so this saves you 9. The odds do not change. Only on the '
      + 'shelf after dark.',
    tag: 'THREE USES',
  },

  /* ---------- the room behind it ---------- */

  {
    id: 'alibi', name: 'FALSE ALIBI', cost: 11, side: 'black', icon: 'alibi',
    blurb: 'You appear on everyone else\'s map, and on the command table, standing '
      + 'somewhere else entirely - for up to three minutes. Your own map still shows '
      + 'the truth. Press its belt key again to drop the lie the moment it stops '
      + 'being useful.',
    tag: 'ONE USE',
  },
  {
    id: 'whetstone', name: 'THE WHETSTONE', cost: 18, side: 'black', icon: 'knife',
    blurb: 'Your kill cooldown drops by a third - both the one running right now and '
      + 'every one after it. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    id: 'skeleton', name: 'SKELETON KEY', cost: 16, side: 'black', icon: 'key',
    blurb: 'Teleports you straight down into the listening post from wherever you '
      + 'are standing, instead of walking there. Nobody sees you go.',
    tag: 'ONE USE',
  },
  {
    id: 'chaff', name: 'REMOTE HACKING DEVICE', cost: 9, side: 'black', icon: 'chaff',
    blurb: 'Kills the command table from anywhere on the island for 60 seconds. '
      + 'Whoever is down there watching gets a screen full of garbage instead of the '
      + 'island - no positions, no vitals, no ledger. They will know it was done to '
      + 'them; they will not know by whom.',
    tag: 'ONE USE',
  },
  {
    id: 'shroud', name: 'LEAD SHROUD', cost: 12, side: 'black', icon: 'soles',
    blurb: 'For 45 seconds you vanish from the command table completely - not moved, '
      + 'not scrambled, just not on it. Anyone watching sees one fewer person than '
      + 'there are.',
    tag: 'ONE USE',
  },
  {
    id: 'blackout', name: 'BLACKOUT CHARGE', cost: 14, side: 'black', icon: 'chaff',
    night: true,
    blurb: 'Puts out every torch and the campfire on the island for 45 seconds. In '
      + 'the dark nobody can tell who anybody is. Only on the shelf after dark.',
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
