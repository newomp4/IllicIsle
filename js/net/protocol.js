/* ===========================================================
   protocol.js — every message that crosses the wire.

   Rule of thumb: clients send INTENT, the host sends TRUTH.
   A client never decides that it killed someone or finished a
   task; it asks, and the host says whether it happened. That
   keeps one copy of the rules and makes cheating a matter of
   editing the host's page rather than any player's.
   =========================================================== */

/* ---------- client -> host ---------- */
export const C = {
  HELLO:      'c.hello',      // { name, colour }
  MOVE:       'c.move',       // { x, y, z, yaw, anim }
  DO_TASK:    'c.task',       // { taskId }
  KILL:       'c.kill',       // { targetId }
  REPORT:     'c.report',     // { bodyId }  (or null for the camp bell)
  VOTE:       'c.vote',       // { targetId | 'skip' }
  CHAT:       'c.chat',       // { text }
  SABOTAGE:   'c.sabotage',   // { kind }
  FIX:        'c.fix',        // { kind }
  READY:      'c.ready',      // { ready }
  SETTINGS:   'c.settings',   // host-only UI echo; ignored from clients
};

/* ---------- host -> clients ---------- */
export const S = {
  WELCOME:    's.welcome',    // { youAre, seed, settings, roster }
  ROSTER:     's.roster',     // { players: [...] }
  PHASE:      's.phase',      // { phase, endsAt, meta }
  ROLE:       's.role',       // { role, tasks, mates }   PRIVATE, per player
  SNAPSHOT:   's.snap',       // { t, players: [[id,x,y,z,yaw,anim,flags]] }
  TASKS:      's.tasks',      // { done, total }
  TASK_OK:    's.taskok',     // { taskId }               PRIVATE
  COOLDOWN:   's.cool',       // { secs }                 PRIVATE, to one agent
  KILLED:     's.killed',     // { victimId, x, y, z }
  BODY_GONE:  's.bodygone',   // { victimId }
  COUNCIL:    's.council',    // { calledBy, bodyOf, endsAt }
  CHAT:       's.chat',       // { from, text, kind }
  VOTES:      's.votes',      // { counts, voted }
  EXILE:      's.exile',      // { targetId | null, wasAgent, reveal }
  SABOTAGE:   's.sabotage',   // { kind, endsAt }
  FIXPROGRESS: 's.fixprog',   // { kind, done, need }
  FIXED:      's.fixed',      // { kind }
  OVER:       's.over',       // { winner, agents, reason }
  KICK:       's.kick',       // { reason }
};

/* ---------- phases ---------- */
export const PHASE = {
  LOBBY:    'lobby',
  REVEAL:   'reveal',    // role card, a few seconds
  ROAM:     'roam',      // free play
  COUNCIL:  'council',   // discussion
  VOTE:     'vote',
  RESULT:   'result',    // exile reveal
  OVER:     'over',
};

export const ROLE = {
  CASTAWAY: 'castaway',
  AGENT:    'agent',
};

/** Colours players are dealt, in order. Deliberately far apart at 15-bit. */
export const COLOURS = [
  { id: 'red',    hex: 0xd8412f, name: 'RED' },
  { id: 'blue',   hex: 0x3f6fd0, name: 'BLUE' },
  { id: 'green',  hex: 0x46a04a, name: 'GREEN' },
  { id: 'yellow', hex: 0xe0c040, name: 'YELLOW' },
  { id: 'purple', hex: 0x8a4fc0, name: 'PURPLE' },
  { id: 'orange', hex: 0xe08430, name: 'ORANGE' },
  { id: 'cyan',   hex: 0x46b8c0, name: 'CYAN' },
  { id: 'pink',   hex: 0xe07aa8, name: 'PINK' },
  { id: 'white',  hex: 0xdcd6c4, name: 'WHITE' },
  { id: 'black',  hex: 0x4a4a52, name: 'BLACK' },
];

export const DEFAULT_SETTINGS = {
  agents: 0,          // 0 = scale with the size of the lobby
  killCooldown: 32,
  /* Nobody dies in the first two minutes. It gives the Castaways a chance
     to build a picture of where people are before that picture starts
     being worth lying about — and it gives the Agents time to be seen
     somewhere innocent. */
  graceSeconds: 120,
  /* One meeting, not two. The old split made you declare you had finished
     talking before the game would let you choose anybody. */
  councilSeconds: 50,
  voteSeconds: 25,        // folded onto the council; kept for the total
  revealOnExile: true,
  tasksPerPlayer: 5,
  emergencyPerPlayer: 1,
  nightOnly: false,      // agents can only strike after dark
};
