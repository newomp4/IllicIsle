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
  /* Straight holds. Quick, and the bulk of anyone's list. */
  { id: 'fire',  at: 'camp',  name: 'STOKE THE CAMPFIRE',      verb: 'STOKING',  secs: 3.0, fx: 'fire' },
  { id: 'coco',  at: 'grove', name: 'GATHER COCONUTS',         verb: 'GATHERING', secs: 3.0, fx: 'food' },
  { id: 'net',   at: 'lagoon', name: 'HAUL IN THE FISHING NET', verb: 'HAULING',  secs: 4.0, fx: 'water' },
  { id: 'door',  at: 'temple', name: 'CLEAR THE TEMPLE STEPS',  verb: 'CLEARING', secs: 3.5, fx: 'metal' },
  { id: 'sand',  at: 'rogueSand', name: 'READ THE WORD IN THE SAND', verb: 'READING', secs: 2.5, fx: 'paper' },
  { id: 'sweep', at: 'temple', name: 'SCRUB THE TEMPLE DOORS',  verb: 'SCRUBBING', secs: 4.0, fx: 'paper' },
  { id: 'brazier', at: 'temple', name: 'LIGHT THE TEMPLE BRAZIERS', verb: 'LIGHTING', secs: 3.0, fx: 'fire' },
  { id: 'torches', at: 'camp',  name: 'TRIM THE TIKI WICKS',    verb: 'TRIMMING', secs: 3.0, fx: 'fire' },

  /* Puzzles. Roughly a third of the list, and the reason you cannot clear
     it in ninety seconds — each one takes your eyes off the world. */
  { id: 'wind1', at: 'pend1', name: 'WIND THE WEST PENDULUM',  verb: 'WINDING', game: 'wind', fx: 'wind' },
  { id: 'wind2', at: 'pend2', name: 'WIND THE RIDGE PENDULUM', verb: 'WINDING', game: 'wind', fx: 'wind' },
  { id: 'wind3', at: 'pend3', name: 'WIND THE EAST PENDULUM',  verb: 'WINDING', game: 'wind', fx: 'wind' },
  { id: 'wind4', at: 'pend4', name: 'WIND THE NORTH PENDULUM', verb: 'WINDING', game: 'wind', fx: 'wind' },
  { id: 'bail',  at: 'wreck', name: 'BAIL OUT THE HULL',       verb: 'BAILING', game: 'bail', fx: 'water' },
  { id: 'sail',  at: 'wreck', name: 'PATCH THE SAIL',          verb: 'STITCHING', game: 'stitch', fx: 'cloth' },
  { id: 'lookout', at: 'pend3', name: 'SET THE LOOKOUT GLASS', verb: 'SETTING', game: 'dials', fx: 'wind' },

  /* Two-part: do something here, carry it there. */
  {
    id: 'crate', at: 'crates', name: 'TAKE A CRATE FROM THE STACK', verb: 'SHOULDERING', secs: 2.5, fx: 'crate',
    then: { at: 'camp', name: 'CARRY THE CRATE TO CAMP', verb: 'UNLOADING', secs: 2.5, fx: 'crate' },
  },
  {
    id: 'jars', at: 'wreck', name: 'FETCH JARS FROM THE HULL', verb: 'RUMMAGING', secs: 3.0, fx: 'cloth',
    then: { at: 'hut', name: "RESTOCK FERDI'S SHELVES", verb: 'STACKING', secs: 3.0, fx: 'crate' },
  },

  /* Three-part: across the island and back, with a puzzle in the middle.
     These are the ones that put people on long walks past each other. */
  {
    id: 'tasha', at: 'tasha', name: "OPEN TASHA'S HOUSING", verb: 'PRISING', secs: 3.0, fx: 'metal',
    then: {
      at: 'tasha', name: "SPLICE TASHA'S OPTIC", verb: 'SPLICING', game: 'splice', fx: 'spark',
      then: { at: 'pend2', name: 'REPORT TASHA TO THE RIDGE', verb: 'UPLOADING', secs: 3.0, fx: 'wind' },
    },
  },
  {
    id: 'plane', at: 'aerlingus', name: 'SALVAGE THE FUSELAGE', verb: 'SALVAGING', secs: 4.0, fx: 'metal',
    then: {
      at: 'aerlingus', name: 'SET THE BEACON DIALS', verb: 'SETTING', game: 'dials', fx: 'spark',
      then: { at: 'camp', name: 'HAUL THE SCRAP BACK TO CAMP', verb: 'DUMPING', secs: 3.0, fx: 'metal' },
    },
  },
];

/** How many stages a chore has, following the `then` chain. */
export function taskStageCount(id) {
  let d = taskById(id), n = 0;
  while (d) { n++; d = d.then; }
  return Math.max(1, n);
}

/** The nth stage of a chore, 0-based. */
export function taskStage(id, step) {
  let d = taskById(id);
  for (let i = 0; i < step && d?.then; i++) d = d.then;
  return d;
}

/** Steps make up the shared work bar, so a three-part chore is worth three. */
export function taskSteps(id) { return taskStageCount(id); }

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
    id: 'douse', name: 'DOUSE THE FIRES', short: 'DOUSE', secs: 40, cooldown: 45,
    blurb: 'Every fire on the island goes out. After dark that is most of what anybody can see by.',
    tell: 'The light dies. They will head for the camp.',
    fixAt: ['camp'], sites: 1, fixSecs: 3,
  },
  blind: {
    id: 'blind', name: 'SEND THE MIST', short: 'MIST', secs: 38, cooldown: 70,
    blurb: 'Fog closes to arm\u2019s length. Nobody can see who is standing next to them \u2014 '
      + 'including, if you are careless, you.',
    tell: 'You see a little further through it than they do.',
    fixAt: ['pend2'], sites: 1, fixSecs: 4,
  },
  scatter: {
    id: 'scatter', name: 'SCATTER THE TOOLS', short: 'SCATTER', secs: 50, cooldown: 60,
    blurb: 'Every marker off the chart and the compass. They have to remember where they were going.',
    tell: 'Watch who walks straight there anyway.',
    fixAt: ['hut'], sites: 1, fixSecs: 3,
  },
  storm: {
    id: 'storm', name: 'CALL THE STORM', short: 'STORM', secs: 45, cooldown: 55,
    blurb: 'Rain, thunder and a sky the colour of a bruise. Names stop showing over people at any distance.',
    tell: 'Nobody will hear you coming.',
    fixAt: ['wreck'], sites: 1, fixSecs: 3,
  },
  shut: {
    id: 'shut', name: "SHUT FERDI'S", short: 'SHUT SHOP', secs: 55, cooldown: 80,
    blurb: 'The shutters come down. Nothing is for sale, and the counter stops being neutral ground.',
    tell: 'Anybody hiding there stops being safe the moment it lands.',
    fixAt: ['hut'], sites: 1, fixSecs: 4,
  },
  jam: {
    id: 'jam', name: 'JAM THE PENDULUMS', short: 'JAM', secs: 75, fatal: true, cooldown: 150,
    blurb: 'All four stop. Two different Pendulums must be wound, by anyone, or the island takes every one of you.',
    tell: 'Including you. Be somewhere useful when it lands.',
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
