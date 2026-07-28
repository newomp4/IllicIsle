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
  VISIT: 'visit',      // two-part: go here, then go there
};

/**
 * Task sites are declared against named landmarks rather than raw
 * coordinates, because the island is generated and the landmarks move
 * with it. `at` is resolved at session start.
 */
export const TASK_DEFS = [
  { id: 'wind1', at: 'pend1', name: 'WIND THE WEST PENDULUM', verb: 'WINDING', secs: 3.5 },
  { id: 'wind2', at: 'pend2', name: 'WIND THE RIDGE PENDULUM', verb: 'WINDING', secs: 3.5 },
  { id: 'wind3', at: 'pend3', name: 'WIND THE EAST PENDULUM', verb: 'WINDING', secs: 3.5 },
  { id: 'wind4', at: 'pend4', name: 'WIND THE NORTH PENDULUM', verb: 'WINDING', secs: 3.5 },

  { id: 'fire',  at: 'camp',  name: 'STOKE THE CAMPFIRE',      verb: 'STOKING',  secs: 3.0 },
  { id: 'bail',  at: 'wreck', name: 'BAIL OUT THE HULL',       verb: 'BAILING',  secs: 4.0 },
  { id: 'sail',  at: 'wreck', name: 'PATCH THE SAIL',          verb: 'STITCHING', secs: 4.0 },
  { id: 'crate', at: 'hut',   name: 'COLLECT A CRATE FROM FERDI', verb: 'LOADING', secs: 2.5 },
  { id: 'jars',  at: 'hut',   name: 'RESTOCK FERDI\'S SHELVES',  verb: 'STACKING', secs: 3.0 },
  { id: 'coco',  at: 'grove', name: 'GATHER COCONUTS',         verb: 'GATHERING', secs: 3.0 },
  { id: 'net',   at: 'lagoon', name: 'HAUL IN THE FISHING NET', verb: 'HAULING',  secs: 4.0 },
  { id: 'door',  at: 'temple', name: 'CLEAR THE TEMPLE STEPS',  verb: 'CLEARING', secs: 3.5 },
  { id: 'sand',  at: 'rogueSand', name: 'READ THE WORD IN THE SAND', verb: 'READING', secs: 2.5 },
  { id: 'tasha', at: 'tasha', name: 'RESTART TASHA\'S OPTIC',   verb: 'SPLICING', secs: 4.5 },
  { id: 'plane', at: 'aerlingus', name: 'SALVAGE THE FUSELAGE',  verb: 'SALVAGING', secs: 4.0 },
];

/** Sabotages the Agents can call. */
export const SABOTAGE_DEFS = {
  douse: {
    id: 'douse', name: 'DOUSE THE TORCHES', secs: 34,
    blurb: 'Every fire on the island goes out.',
    fixAt: ['camp'], fixers: 1, fixSecs: 3,
  },
  storm: {
    id: 'storm', name: 'CALL THE STORM', secs: 40,
    blurb: 'Rain and fog close in.',
    fixAt: ['hut'], fixers: 1, fixSecs: 3,
  },
  jam: {
    id: 'jam', name: 'JAM THE PENDULUMS', secs: 45, fatal: true,
    blurb: 'All four stop. Wind two of them or the island takes you.',
    fixAt: ['pend1', 'pend2', 'pend3', 'pend4'], fixers: 2, fixSecs: 4,
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
