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
    id: 'flask', name: "FLOPPER'S FLASK", cost: 4, side: 'open', icon: 'flask',
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
    /* The mast came with four. These are yours, they go where you decide,
       and they join the same feed — which is the whole of it: the four that
       were already up are watching what somebody else thought mattered. */
    id: 'camera', name: 'RELAY CAMERAS X3', cost: 6, side: 'open', icon: 'cctv',
    blurb: 'Three cameras in a box, 6 Syncoin for the three. Press V to hang one '
      + 'where you are standing, aimed where you are looking. Each one joins the '
      + 'terminal at the top of the mast the moment it is up. The relay takes 10 '
      + 'in total and 4 are already fitted, so there is room for 6 of yours.',
    tag: '3 FOR 6',
  },
  {
    /* The one thing that will find the Stranger. He comes ashore once, he
       stands in the trees, and without this you find him by walking into
       him — which is not a mechanic, it is a coincidence. */
    /* Ferdi keeps a docket machine behind the counter and will happily
       sell you the other end of it. It only ever sees the open counter —
       what happens under it is not written down anywhere, which is most
       of why people go down there. */
    id: 'printer', name: 'RECEIPT PRINTER', cost: 12, side: 'open', icon: 'chart',
    blurb: 'A till roll on your belt. Press its number to switch it on and every '
      + 'sale over Ferdi\'s open counter prints a docket: who, what, and what they '
      + 'paid. It keeps the last 6 and you can read back through them. It does not '
      + 'see the black market and it does not print your own.',
    tag: 'BELT',
  },
  {
    /* Somebody has to be able to MAKE it dark. Half the island's items
       are for the dark and the day is two and a half minutes long. */
    id: 'nightfall', name: 'NIGHTFALL FLARE', cost: 16, side: 'open', icon: 'lantern',
    blurb: 'A signal flare that brings the night on for everybody, at once, wherever '
      + 'they are. Dusk lands in about 8 seconds and the night runs its full '
      + 'length from there. The Lucky Flopper comes in on the tide with it. One '
      + 'use, and everyone sees the sky change.',
    tag: 'ONE USE',
  },
  {
    id: 'scanner', name: 'SIGNAL SCANNER', cost: 8, side: 'open', icon: 'scanner',
    blurb: 'A handheld set that reads the whole band: the mast, the real listening '
      + 'post, every camera that is up, and any heat signature that is not on the '
      + 'roster. Lock one and it steers you - which way to turn and how many '
      + 'metres are left. B steps to the next signal.',
    tag: 'BELT',
  },
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
/* The cane tonic used to be in here. It is Cathy's popcorn now, and Ferdi
   does not stock anything of hers, so his machines got the cork vest
   instead — a thing nobody buys at full price at the counter either. */
/* Added late, and deliberately not cheap: it is the only thing on the
   island that will point you at the one who is not on the roster. */
export const SCANNER_ID = 'scanner';

export const VENDOR_IDS = ['lantern', 'flask', 'whistle', 'ticket', 'vest'];

/* ===========================================================
   SCHLARNA

   A card reader turned up in Ferdi's stock one morning with nobody's name
   on the box. One line a day can be taken away in four payments instead of
   bought; it costs a third more in total, and the rest comes out of
   whatever you earn afterwards.
   =========================================================== */
export const SCHLARNA_UP = 0.30;   // a third more, near enough
export const SCHLARNA_N = 4;       // in four parts

/* ===========================================================
   CATHY'S STALL

   She is on the far side of the island and she is the only person on it who
   sells anything to eat. Nothing here is sold at Ferdi's counter, and Ferdi
   has never been asked about the arrangement.
   =========================================================== */
/* `once` means the effect lasts the round, so buying a second one would be
   money for nothing and the counter refuses it. Only the candy floss wears
   off, and only the candy floss can be bought again. */
export const FOOD = [
  {
    once: true, id: 'tonic', name: 'CUSTOM POPCORN', cost: 12, side: 'food', icon: 'popcorn',
    blurb: 'Cathy will not say what is in it. You stop running out of breath: '
      + 'sprinting costs almost nothing and recovers five times faster, for the '
      + 'rest of the round.',
    tag: 'PASSIVE',
  },
  {
    once: true, id: 'eggs', name: 'BAG OF PICKLED EGGS', cost: 9, side: 'food', icon: 'eggs',
    blurb: 'Every loose Syncoin within 70 metres shows through the trees and the '
      + 'hills, and appears on your compass. You will not walk past money again. '
      + 'Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    once: true, id: 'sauce', name: "CATHY'S OWN SAUCE", cost: 7, side: 'food', icon: 'sauce',
    blurb: 'Your compass grows one more needle and it points at the nearest loose '
      + 'Syncoin, wherever it is. Lasts the whole round.',
    tag: 'PASSIVE',
  },
  {
    /* Three jobs at double pay averages ten Syncoin back on a fourteen
       Syncoin burger, which is a burger you would have to be very hungry to
       buy. It runs for the rest of the round now and costs less than a
       night's work. */
    once: true, id: 'burger', name: 'THE HOUSE BURGER', cost: 10, side: 'food', icon: 'burger',
    blurb: 'The one she is proud of. Every job you finish for the rest of the '
      + 'round pays double: 2 to 12 Syncoin instead of 1 to 6. A full list left '
      + 'to do is about 25 back.',
    tag: 'REST OF THE ROUND',
  },
  {
    id: 'floss', name: 'CANDY FLOSS', cost: 5, side: 'food', icon: 'floss',
    blurb: 'Pure sugar. You walk and sprint 30% faster for ninety seconds, then '
      + 'you feel it.',
    tag: 'ONE USE',
  },
];

/* ===========================================================
   QUEZETRIEL QUEBOLIUS' BAR

   Through the west door of the high rollers room. Everything here is
   timed rather than permanent, everything says what it does in minutes
   and per cents, and three of the six will get you drunk.

   `drunk` is how far the room goes round: 0.45 is a sway you can steer
   through, 1 is a night you will not remember. `mins` is how long the
   whole thing lasts.
   =========================================================== */
export const DRINKS = [
  {
    id: 'pint', name: 'PINT OF SHIPWRECK', cost: 4, icon: 'bitter',
    blurb: 'The house bitter. Sprinting costs you half as much breath for '
      + 'three minutes.',
    tag: '3 MINUTES', mins: 3, colour: 0xc07820,
  },
  {
    id: 'lamp', name: 'THE LAMPLIGHTER', cost: 6, icon: 'lamp',
    blurb: 'A tallow-coloured spirit. The dark stops mattering for three '
      + 'minutes - you see at night exactly as you do by day.',
    tag: '3 MINUTES', mins: 3, colour: 0xe8c860,
  },
  {
    id: 'quiet', name: 'QUIET WATER', cost: 7, icon: 'clear',
    blurb: 'Clear, and it is not water. Your footsteps make no sound at all '
      + 'for three minutes. Nobody is told you drank it.',
    tag: '3 MINUTES', mins: 3, colour: 0xa8d0d8,
  },
  {
    id: 'rum', name: 'BLACK RUM', cost: 5, icon: 'rum',
    blurb: 'Every Syncoin you pick up counts double for two minutes. You will '
      + 'also not walk in a straight line.',
    tag: 'DRINK - 2 MINUTES', mins: 2, drunk: 0.45, colour: 0x5a2a12,
  },
  {
    id: 'own', name: "QUEBOLIUS' OWN", cost: 9, icon: 'own',
    blurb: 'He will not say. You move 25% faster and every job pays double for '
      + 'two minutes. The room comes with it.',
    tag: 'DRINK - 2 MINUTES', mins: 2, drunk: 0.7, colour: 0x7a1a5a,
  },
  {
    id: 'falling', name: 'THE FALLING DOWN', cost: 14, icon: 'falling',
    blurb: 'All three of the above at once, for ninety seconds, and you will '
      + 'be no use to anybody. He pours it slowly so you can change your mind.',
    tag: 'DRINK - 90 SECONDS', mins: 1.5, drunk: 1, colour: 0x2a1830,
  },
];

export const drinkById = (id) => DRINKS.find((d) => d.id === id);

/** Everything Cathy has, in the order it sits on her counter. */
export function cathyStock() { return FOOD; }

export const itemById = (id) => STOCK.find((i) => i.id === id) || FOOD.find((i) => i.id === id);

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
