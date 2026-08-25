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
  HELLO:      'c.hello',      // { name }        the host deals the colour itself
  MOVE:       'c.move',       // { x, y, z, yaw, anim, room }
  DO_TASK:    'c.task',       // { taskId }
  KILL:       'c.kill',       // { targetId }
  REPORT:     'c.report',     // { bodyId }  (or null for the camp bell)
  VOTE:       'c.vote',       // { targetId | 'skip' }
  CHAT:       'c.chat',       // { text }
  SABOTAGE:   'c.sabotage',   // { kind }
  FIX:        'c.fix',        // { kind }
  SHOOT:      'c.shoot',      // { targetId }   the flare pistol
  SNAP:       'c.snap',       // { yes }        a snap vote answer
  PURSE:      'c.purse',      // { coins }      tell the host what you are carrying
  PERK:       'c.perk',       // { perk, on }   something bought that others must see
  DIG:        'c.dig',        // { secs }       spadework, sent while you hold E
  CHEST:      'c.chest',      // {}             open it, once it is out
  VEND:       'c.vend',       // { index }      pull the handle on one of Ferdi's machines
  TAKEDROP:   'c.takedrop',   // { did }        reach for a purse somebody left behind
  BOUGHT:     'c.bought',     // { id, price }  over Ferdi's counter, for the printers
  LEDGER:     'c.ledger',     // {}             ask what everybody is carrying
  ASKSTRANGER: 'c.ask',       // {}             speak to the one on the treeline
  SETTINGS:   'c.settings',   // host-only UI echo; ignored from clients
};

/* ---------- host -> clients ---------- */
export const S = {
  WELCOME:    's.welcome',    // { youAre, settings }   the roster follows as its own s.roster
  SETTINGS:   's.settings',   // { settings }   the host turned a dial
  ROSTER:     's.roster',     // { players: [...] }
  PHASE:      's.phase',      // { phase, endsAt, meta }  endsAt is SECONDS LEFT, not a clock:
                              //   the two machines have no shared one, so the receiver adds it to its own
                              //   now(). 0 means the phase has no timer.
  ROLE:       's.role',       // { role, tasks, mates }   PRIVATE, per player
  SNAPSHOT:   's.snap',       // { p: [[id,x,y,z,yaw,anim,alive,room]] }
  TASKS:      's.tasks',      // { done, total }
  TASK_OK:    's.taskok',     // { taskId, step, done }   PRIVATE
  WORLDFX:    's.worldfx',    // { at, last }  the mark a finished chore leaves on the island,
                              //   to EVERYBODY. No doer, no position: what latches is the
                              //   world. `last` is false on the early stages of a two-part
                              //   chore, both of which happen at the same landmark.
  COOLDOWN:   's.cool',       // { secs, grace }          PRIVATE, to one agent
  PURSE:      's.purse',      // { coins, gained }      PRIVATE, your wallet
  DROP:       's.drop',       // { did, x, y, z, coins, id }  a purse on the ground, did names it
  DROPGONE:   's.dropgone',   // { did, byId }  somebody reached it first
  SHOT:       's.shot',       // { byId, victimId, x, y, z, secs }
  SNAPDENY:   's.snapdeny',   // { why }         PRIVATE, the flare pistol refused
  SNAPOPEN:   's.snapopen',   // { victimId, byId, secs, voters }   secs, like s.phase, is a duration
  SNAPTALLY:  's.snaptally',  // { yes, no, need }
  SNAPDONE:   's.snapdone',   // { victimId, exiled, yes, no, wasAgent, reveal }
  BUNKER:     's.bunker',     // { index }      which hatch is real this round
  SPEAKER:    's.speaker',    // { x, z, secs }  somebody put a boombox down
  CHAFF:      's.chaff',      // { secs }        the command table is lying
  SAVED:      's.saved',      // { victimId }   a cork vest took the strike
  KILLED:     's.killed',     // { victimId, x, y, z, room }
  BODY_GONE:  's.bodygone',   // { victimId }
  COUNCIL:    's.council',    // { calledBy, bodyOf }   the clock arrives on the s.phase that follows
  CHAT:       's.chat',       // { from, colour, text, kind }
  VOTES:      's.votes',      // { counts, voted }
  EXILE:      's.exile',      // { targetId | null, wasAgent, reveal }  wasAgent is null unless reveal
  SABOTAGE:   's.sabotage',   // { kind, secs, fatal, sites, half }  half = where it came from,
                              //   secs a duration. Or { kind, refused: true } to the caller alone,
                              //   when that kind is still cooling.
  NIGHTFALL:  's.night',      // {}             somebody pulled the night on
  DIG:        's.dig',        // { dug }        how far down EVERYBODY is
  CHEST:      's.chest',      // { byId, gold, prize }  who got it and what
  VEND:       's.vend',       // { index, byId, itemId }  which machine, who pulled it, what fell
  RECEIPT:    's.receipt',    // { from, id, price }  PRIVATE, to whoever owns a printer
  SALE:       's.sale',       // { id, cut, day, after }  the day's markdown, host to all
  LEDGER:     's.ledger',     // { rows: [[id, coins]] }  PRIVATE, the command table
  BLACKOUT:   's.blackout',   // { secs }        every fire on the island goes out
  STRANGER:   's.stranger',   // { on, x, z }   where he is, if he is anywhere
  RIDDLE:     's.riddle',     // { text }       PRIVATE, what he told you
  FIXPROGRESS: 's.fixprog',   // { kind, done, need }
  FIXED:      's.fixed',      // { kind, cooldown }  cooldown seeds the client's ring
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
  /* Long enough that a kill is a decision rather than a rhythm. At 32 an
     Agent could clear a corner of the island in a couple of minutes and
     nobody could build a picture of anything; three quarters of a minute
     means each one has to be worth it, and it gives the Castaways time to
     notice somebody is missing before the next one goes. Adjustable from
     12 to 90 in the round settings. */
  killCooldown: 45,
  /* Nobody dies in the first two minutes. It gives the Castaways a chance
     to build a picture of where people are before that picture starts
     being worth lying about — and it gives the Agents time to be seen
     somewhere innocent. */
  graceSeconds: 120,
  /* One meeting, not two. The old split made you declare you had finished
     talking before the game would let you choose anybody. */
  councilSeconds: 75,
  revealOnExile: true,
  tasksPerPlayer: 5,
  emergencyPerPlayer: 1,
  nightOnly: false,      // agents can only strike after dark
  stranger: true,        // the one who is not on the roster comes ashore once
};
