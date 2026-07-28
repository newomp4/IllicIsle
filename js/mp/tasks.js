/* ===========================================================
   tasks.js — the work the Castaways are actually here to do.

   Every task sits on a real landmark that already exists in the
   world, so the map teaches you the game: you learn where the
   Pendulums and the wreck are by doing chores at them, and later
   that knowledge is what lets you say "you were never at the
   lagoon" and mean it.
   =========================================================== */

export const TASK_KIND = {
  HOLD: 'hold',        // stand still and hold E for a few seconds
  CARRY: 'carry',      // two-part: do it here, then take it over there
};

/**
 * How the world should answer when a step lands. Purely cosmetic, but it
 * is what makes one chore feel different from another instead of every
 * one being the same green ring.
 */
export const TASK_FX = {
  wind:    { colour: 0x9ff0dc, sfx: 'rumble',  shake: 0.55, ring: 5.4 },
  fire:    { colour: 0xff9a3a, sfx: 'charge',  shake: 0.35, ring: 3.6 },
  water:   { colour: 0x5fb0e0, sfx: 'splat',   shake: 0.30, ring: 4.2 },
  cloth:   { colour: 0xe8dcc0, sfx: 'page',    shake: 0.18, ring: 3.0 },
  crate:   { colour: 0xc09a58, sfx: 'door',    shake: 0.40, ring: 3.4 },
  spark:   { colour: 0xbfe8ff, sfx: 'gemHit',  shake: 0.45, ring: 4.0 },
  metal:   { colour: 0xa8b0b8, sfx: 'slam',    shake: 0.50, ring: 4.4 },
  paper:   { colour: 0xd8c69a, sfx: 'page',    shake: 0.12, ring: 2.6 },
  food:    { colour: 0x7ec850, sfx: 'pickup',  shake: 0.22, ring: 3.2 },
};

/**
 * Task sites are declared against named landmarks rather than raw
 * coordinates, because the island is generated and the landmarks move
 * with it. `at` is resolved at session start.
 */
export const TASK_DEFS = [
  { id: 'wind1', at: 'pend1', name: 'WIND THE WEST PENDULUM', verb: 'WINDING', secs: 3.5, fx: 'wind' },
  { id: 'wind2', at: 'pend2', name: 'WIND THE RIDGE PENDULUM', verb: 'WINDING', secs: 3.5, fx: 'wind' },
  { id: 'wind3', at: 'pend3', name: 'WIND THE EAST PENDULUM', verb: 'WINDING', secs: 3.5, fx: 'wind' },
  { id: 'wind4', at: 'pend4', name: 'WIND THE NORTH PENDULUM', verb: 'WINDING', secs: 3.5, fx: 'wind' },

  { id: 'fire',  at: 'camp',  name: 'STOKE THE CAMPFIRE',      verb: 'STOKING',  secs: 3.0, fx: 'fire' },
  { id: 'bail',  at: 'wreck', name: 'BAIL OUT THE HULL',       verb: 'BAILING',  secs: 4.0, fx: 'water' },
  { id: 'sail',  at: 'wreck', name: 'PATCH THE SAIL',          verb: 'STITCHING', secs: 4.0, fx: 'cloth' },
  { id: 'coco',  at: 'grove', name: 'GATHER COCONUTS',         verb: 'GATHERING', secs: 3.0, fx: 'food' },
  { id: 'net',   at: 'lagoon', name: 'HAUL IN THE FISHING NET', verb: 'HAULING',  secs: 4.0, fx: 'water' },
  { id: 'door',  at: 'temple', name: 'CLEAR THE TEMPLE STEPS',  verb: 'CLEARING', secs: 3.5, fx: 'metal' },
  { id: 'sand',  at: 'rogueSand', name: 'READ THE WORD IN THE SAND', verb: 'READING', secs: 2.5, fx: 'paper' },

  /* Two-part chores. You do something here, then you have to walk it over
     there — which is the whole point: it puts people on paths, in front of
     each other, with something to account for. */
  {
    id: 'crate', at: 'hut', name: 'COLLECT A CRATE FROM FERDI', verb: 'LOADING', secs: 2.5, fx: 'crate',
    then: { at: 'camp', name: 'CARRY THE CRATE TO CAMP', verb: 'UNLOADING', secs: 2.5, fx: 'crate' },
  },
  {
    id: 'jars', at: 'wreck', name: 'FETCH JARS FROM THE HULL', verb: 'RUMMAGING', secs: 3.0, fx: 'cloth',
    then: { at: 'hut', name: "RESTOCK FERDI'S SHELVES", verb: 'STACKING', secs: 3.0, fx: 'crate' },
  },
  {
    id: 'tasha', at: 'tasha', name: "RESTART TASHA'S OPTIC", verb: 'SPLICING', secs: 4.5, fx: 'spark',
    then: { at: 'pend2', name: 'REPORT TASHA TO THE RIDGE PENDULUM', verb: 'UPLOADING', secs: 3.0, fx: 'wind' },
  },
  {
    id: 'plane', at: 'aerlingus', name: 'SALVAGE THE FUSELAGE', verb: 'SALVAGING', secs: 4.0, fx: 'metal',
    then: { at: 'camp', name: 'HAUL THE SCRAP BACK TO CAMP', verb: 'DUMPING', secs: 3.0, fx: 'metal' },
  },
];

/** Steps make up the shared work bar, so a two-part chore is worth two. */
export function taskSteps(id) { return taskById(id)?.then ? 2 : 1; }

/**
 * Sabotages the Agents can call.
 *
 * `sites` is how many DIFFERENT places have to be repaired, not how many
 * people have to press the button — two agents standing at one pendulum
 * calling it fixed was never the intent. `cooldown` is per kind, so the
 * killing one cannot simply be run back the moment it is repaired.
 */
export const SABOTAGE_DEFS = {
  douse: {
    id: 'douse', name: 'DOUSE THE FIRES', secs: 40, cooldown: 45,
    blurb: 'Every fire on the island goes out. Nobody sees anybody.',
    fixAt: ['camp'], sites: 1, fixSecs: 3,
  },
  storm: {
    id: 'storm', name: 'CALL THE STORM', secs: 45, cooldown: 55,
    blurb: 'Rain, fog and thunder. You will not hear them coming.',
    fixAt: ['hut'], sites: 1, fixSecs: 3,
  },
  jam: {
    id: 'jam', name: 'JAM THE PENDULUMS', secs: 75, fatal: true, cooldown: 150,
    blurb: 'All four stop. Two different Pendulums must be wound, by anyone, '
      + 'or the island takes every one of you.',
    fixAt: ['pend1', 'pend2', 'pend3', 'pend4'], sites: 2, fixSecs: 4,
  },
};

/** Deal each player a personal list. Everyone gets a spread of the island. */
export function dealTasks(rng, count) {
  const pool = TASK_DEFS.slice();
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // prefer not to hand somebody five chores in one corner
  const picked = [];
  const usedSites = new Set();
  for (const t of pool) {
    if (picked.length >= count) break;
    if (usedSites.has(t.at) && picked.length < count - 1) continue;
    picked.push(t);
    usedSites.add(t.at);
  }
  for (const t of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked.map((t) => t.id);
}

export function taskById(id) { return TASK_DEFS.find((t) => t.id === id); }
