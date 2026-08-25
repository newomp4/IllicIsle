/* ===========================================================
   session.js — the rules of Castaways, run by the host.

   Only the host ever executes this. Clients hold a mirror of
   whatever the host tells them (see MirrorSession at the bottom),
   which means there is exactly one copy of the rules and no way
   for two machines to disagree about who is dead.
   =========================================================== */

import { C, S, PHASE, ROLE, COLOURS, DEFAULT_SETTINGS } from '../net/protocol.js';
import { DIG_SECONDS } from '../world/treasure.js';
import { SABOTAGE_DEFS, dealTasks, taskSteps, taskStage } from './tasks.js';
import { VENDOR_IDS, LOOT_SHARE } from './market.js';
import { makeClue } from './stranger.js';

const now = () => performance.now() / 1000;

/* ===========================================================
   HOST
   =========================================================== */
export class HostSession {
  /**
   * @param {Net} net
   * @param {object} hooks { onLocalRole, onPhase, onEvent, siteOf }
   */
  constructor(net, hooks = {}) {
    this.net = net;
    this.hooks = hooks;
    this.settings = { ...DEFAULT_SETTINGS };
    this.players = new Map();      // id -> player record
    this.phase = PHASE.LOBBY;
    this.phaseEnds = 0;
    this.bodies = [];              // { id, x, y, z, room }
    this.votes = new Map();        // voterId -> targetId|'skip'
    this.sabotage = null;          // { kind, endsAt, fixers:Set }
    this.tasksDone = 0;
    this.tasksTotal = 0;
    this.council = null;
    this.rng = mulberry(Date.now() & 0xffffffff);
    this.over = null;

    net.onPeerJoin = (id) => this._join(id);
    net.onPeerLeave = (id) => this._leave(id);
    net.onMessage = (msg, from) => this._recv(msg, from);
  }

  /* ---------- roster ---------- */
  addLocal(name) {
    this._add('host', name || 'HOST');
    return this.players.get('host');
  }

  _add(id, name) {
    const used = new Set([...this.players.values()].map((p) => p.colour));
    const colour = (COLOURS.find((c) => !used.has(c.id)) || COLOURS[0]).id;
    const p = {
      id, name: sanitiseName(name), colour,
      alive: true, role: null, tasks: [], doneTasks: new Set(),
      x: 0, y: 0, z: 0, yaw: 0, anim: 0,
      killReady: 0, emergencies: this.settings.emergencyPerPlayer,
      connected: true,
    };
    this.players.set(id, p);
    return p;
  }

  _join(id) {
    /* 'host' is the key the host's own record lives under, and a peer picks
       its own broker id. One that claimed it would resolve to the host on
       every inbound message — moving them, killing with their cooldown, and
       deleting them from their own game when it disconnected. */
    if (id === 'host') {
      this.net.sendTo(id, { t: S.KICK, reason: 'That name is taken.' });
      this.net.close?.(id);
      return;
    }
    /* A refused peer used to keep its channel, and broadcast() goes to the
       channel list rather than the roster — so somebody told the game had
       started sat on ten snapshots a second of everybody's position for the
       whole round. In a hidden-role game that is the entire game. */
    if (this.phase !== PHASE.LOBBY) {
      this.net.sendTo(id, { t: S.KICK, reason: 'That game has already started.' });
      this.net.close?.(id);
      return;
    }
    if (this.players.size >= COLOURS.length) {
      this.net.sendTo(id, { t: S.KICK, reason: 'That island is full.' });
      this.net.close?.(id);
      return;
    }
    // the record is created on HELLO so we have their chosen name
    this.net.sendTo(id, { t: S.WELCOME, youAre: id, settings: this.settings, dug: this.dug || 0 });
    /* A channel that never says hello is on every broadcast just the same.
       That is not only a bad client: the host can start the round between
       our WELCOME and their HELLO, and HELLO is dropped outside the lobby. */
    setTimeout(() => { if (!this.players.has(id)) this.net.close?.(id); }, 10000);
    /* HELLO can beat this event: the client's channel opens as soon as the
       far end acknowledges, while ours opens a moment later, so their name
       can arrive before we have a connection to answer on. If the record is
       already here, the roster we broadcast then went nowhere — send it. */
    if (this.players.has(id)) this._roster();
  }

  _leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    /* Nobody was ever told the body had gone with them, so it stood on every
       client with a REPORT prompt the host would refuse for the rest of the
       round — and a corpse where somebody who is no longer playing died is a
       clue the game has no business inventing. */
    const hadBody = this.bodies.some((b) => b.id === id);
    this.bodies = this.bodies.filter((b) => b.id !== id);
    if (hadBody) {
      this.net.broadcast({ t: S.BODY_GONE, victimId: id });
      this.hooks.onBodyGone?.(id);
    }
    this.votes.delete(id);             // they are not in the room to vote any more
    /* Their unfinished share of the work leaves with them. Left in the
       denominator it makes ALL WORK COMPLETE unreachable for everyone else,
       since nobody can do a departed player's chores.

       But only shrink the job when what is still owed is more than anybody
       still here can do. Subtracting their share and clamping the total up
       to tasksDone handed the round away: tasksDone counts every step by
       anyone — Agents and the dead included — while tasksTotal is the
       Castaways' share alone, so the clamp landed on tasksDone exactly and
       the bar snapped to a hundred the moment a slacker pulled the plug. */
    if (this.phase !== PHASE.LOBBY) {
      let avail = 0;
      for (const q of this.players.values()) {
        for (const t of q.tasks || []) {
          if (q.doneTasks?.has(t)) continue;
          avail += taskSteps(t) - ((q.step && q.step[t]) || 0);
        }
      }
      const need = this.tasksTotal - this.tasksDone;
      if (need > avail) { this.tasksTotal = this.tasksDone + avail; this._tasks(); }
    }
    this._roster();
    this.hooks.onEvent?.({ kind: 'left', name: p.name });
    if (this.phase !== PHASE.LOBBY && this._checkWin()) return;
    /* Everyone still here may already have voted, and the early resolve was
       only ever tested when a vote came in — so the meeting kept running a
       clock nobody could act on. */
    if (this.phase === PHASE.COUNCIL) {
      this._broadcastVotes();
      const n = [...this.players.values()].filter((x) => x.alive).length;
      if (n > 0 && this.votes.size >= n) this._resolveVote();
    }
  }

  _roster() {
    const t = now();
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, colour: p.colour, alive: p.alive,
      /* How many meetings they have left. Without it a guest's copy was
         always undefined, so the bell prompt stayed lit and E did nothing. */
      emergencies: p.emergencies | 0,
      quiet: !!p.quiet,
      whistle: p.whistleUntil && t < p.whistleUntil ? +(p.whistleUntil - t).toFixed(1) : 0,
      decoy: p.decoy && t < p.decoy.until ? { x: p.decoy.x, z: p.decoy.z } : null,
      shroud: !!(p.shroudUntil && t < p.shroudUntil),
    }));
    this.net.broadcast({ t: S.ROSTER, players: list });
    this.hooks.onRoster?.(list);
  }

  /**
   * The dials, again. They went out once inside WELCOME and never after, so
   * the ordering everybody actually uses — open the room, let friends
   * trickle in, then tune it — left every guest already in the lobby playing
   * by the defaults, and their own client refusing them things the host
   * would have allowed. Called by the settings screen on every change.
   */
  pushSettings() {
    this.net.broadcast({ t: S.SETTINGS, settings: this.settings });
  }

  /* ---------- inbound ---------- */
  _recv(msg, from) {
    const p = this.players.get(from);
    switch (msg.t) {
      case C.HELLO: {
        if (this.phase !== PHASE.LOBBY) break;
        /* The capacity check lived only in _join, which fires on the channel
           opening. HELLO arrives on its own and used to add the player
           regardless, so an eleventh castaway was kicked and seated at the
           same time — and there are only ten colours to go round. */
        if (!p && this.players.size >= COLOURS.length) {
          this.net.sendTo(from, { t: S.KICK, reason: 'That island is full.' });
          this.net.close?.(from);
          break;
        }
        if (!p) { this._add(from, msg.name); this._roster(); }
        break;
      }
      case C.MOVE: {
        if (!p) break;
        /* Straight off the wire and straight into every range gate the host
           owns. A NaN x makes Math.hypot return NaN and `NaN > 4.8` is false,
           so one malformed packet opened the knife on anybody from anywhere
           on the island and walked through Ferdi's sanctuary on the way.
           Falling back to the last good value rather than to 0 spares a
           player whose packet was merely corrupted in transit. */
        const n = (v, d = 0) => (Number.isFinite(v) ? v : d);
        p.x = n(msg.x, p.x || 0); p.y = n(msg.y, p.y || 0); p.z = n(msg.z, p.z || 0);
        p.yaw = Math.atan2(Math.sin(n(msg.yaw)), Math.cos(n(msg.yaw)));
        p.anim = msg.anim | 0;
        /* Which interior they are standing in, if any. Everyone in the same
           room shares one local coordinate space, so the position above is
           all anybody needs to see them down there. */
        p.room = msg.room | 0;
        break;
      }
      case C.DO_TASK: { this._tryTask(from, msg.taskId); break; }
      case C.KILL: { this._tryKill(from, msg.targetId); break; }
      case C.REPORT: { this._tryReport(from, msg.bodyId); break; }
      case C.VOTE: { this._tryVote(from, msg.targetId); break; }
      case C.CHAT: { this._chat(from, msg.text); break; }
      case C.SABOTAGE: { this._trySabotage(from, msg.kind); break; }
      case C.FIX: { this._tryFix(from, msg.kind, msg.at); break; }
      case C.SHOOT: { this._tryShoot(from, msg.targetId); break; }
      case C.SNAP: { this._trySnap(from, !!msg.yes); break; }
      /* Only from the living. A ghost keeps earning locally — chores still
         pay — and its next total would otherwise overwrite the purse the
         killer took, on the one table that is meant to be hard fact. */
      case C.PURSE: { if (p && p.alive) p.coins = Math.max(0, msg.coins | 0); break; }
      case C.DIG: { this._dig(from, msg); break; }
      case C.CHEST: { this._openChest(from); break; }
      case C.VEND: { this._vend(from, msg); break; }
      case C.TAKEDROP: { this._takeDrop(from, msg.did); break; }
      case C.BOUGHT: { this._receipt(from, msg); break; }
      /* The command table's ledger. It is answered privately and only for
         somebody who is really standing in the bunker, so knowing what
         everybody is carrying stays a thing you have to go and earn. */
      case C.LEDGER: { this._sendLedger(from); break; }
      case C.ASKSTRANGER: { this._askStranger(from); break; }
      case C.PERK: {
        /* Some purchases change what everyone else sees or how the rules
           treat you, so the host has to know about them. */
        if (!p) break;
        if (msg.perk === 'quiet') p.quiet = !!msg.on;
        if (msg.perk === 'vest') p.vest = !!msg.on;
        /* Ferdi's whetstone. It takes its third off the ring that is turning
           right now as well as off every one after it — one bought halfway
           through a cooldown that only paid from the next kill would feel
           like nothing at all for the length of the thing you bought it to
           shorten. */
        if (msg.perk === 'whetstone') {
          const was = !!p.whetstone;
          p.whetstone = !!msg.on;
          if (p.whetstone && !was) {
            p.killReady = now() + Math.max(0, p.killReady - now()) * 0.66;
            this._sendCooldown(p);
          }
        }
        /* Who has a printer. The host needs this so a receipt goes only
           to the people who paid for one — broadcasting every purchase to
           every client and letting them decide whether to show it would
           put the whole shop ledger on the wire for anybody with a
           console open, which is a deduction game giving itself away. */
        if (msg.perk === 'printer') p.printer = !!msg.on;
        /* The night is not a thing you can have privately. One person
           pulls it and the sky changes for the whole island at once. */
        if (msg.perk === 'nightfall') {
          this.net.broadcast({ t: S.NIGHTFALL });
          this.hooks.onNightfall?.();
        }
        if (msg.perk === 'speaker') {
          this.net.broadcast({ t: S.SPEAKER, x: msg.x, z: msg.z, secs: 60 });
          this.hooks.onSpeaker?.(msg.x, msg.z, 60);
        }
        if (msg.perk === 'chaff') {
          // a remote hack: the table is off for a full minute
          this.net.broadcast({ t: S.CHAFF, secs: 60 });
          this.hooks.onChaff?.(60);
        }
        /* Ferdi's whistle. Twelve seconds of your name over your head for
           everybody, at any range, through any weather. */
        if (msg.perk === 'whistle') p.whistleUntil = now() + 12;
        /* A false alibi. The host carries the decoy so it appears on every
           chart and on the command table, and clears itself. */
        if (msg.perk === 'alibi') {
          // three minutes, or until they drop it themselves
          if (msg.on === false) p.decoy = null;
          else p.decoy = { x: +msg.x || 0, z: +msg.z || 0, until: now() + 180 };
        }
        /* A lead shroud: forty-five seconds off the command table entirely.
           Carried on the roster like the others so every client agrees. */
        if (msg.perk === 'shroud') p.shroudUntil = now() + 45;
        /* A blackout charge. Everybody has to see it, so it is broadcast. */
        if (msg.perk === 'blackout') {
          this.net.broadcast({ t: S.BLACKOUT, secs: 45 });
          this.hooks.onBlackout?.(45);
        }
        this._roster();
        break;
      }
      default: break;
    }
  }

  /* ---------- start ---------- */
  canStart() {
    // the workshop runs with one
    return this.players.size >= (this.dev ? 1 : 3) && this.phase === PHASE.LOBBY;
  }

  /**
   * Back to the lobby for another round.
   *
   * There was no way back at all: once a round was over the session sat
   * in PHASE.OVER for ever, and the button on the results card labelled
   * PLAY AGAIN called the SINGLE-PLAYER start — so finishing a game of
   * Castaways with five other people quietly dropped you, alone, onto a
   * different island.
   */
  toLobby() {
    this.phase = PHASE.LOBBY;
    this.over = null;
    this._endSabotage();
    this._dropSnap();
    this.cool = {};
    this.bodies = [];
    this.drops = [];
    this.vendSpent = [false, false];
    /* The hole is the one piece of world state that outlived its round, so a
       lobby between two games was still holding an emptied one — and that is
       what a joiner is now told about. */
    this.dug = 0;
    this._dugStep = -1;
    this.chestTaken = false;
    this.tasksDone = 0;
    this.tasksTotal = 0;
    for (const p of this.players.values()) {
      p.alive = true;
      p.role = null;
      p.tasks = [];
      p.doneTasks = new Set();
      p.step = {};
      p.quiet = false; p.vest = false; p.printer = false; p.whetstone = false;
      /* Timed perks only expire in update(), which does not run in the lobby,
         so an alibi or a shroud bought late in one round was still on the
         roster in the next one with nobody having paid for it. */
      p.decoy = null; p.whistleUntil = 0; p.shroudUntil = 0;
      p.stunnedUntil = 0; p.nearBody = false;
      p.coins = 0;
      p.emergencies = this.settings.emergencyPerPlayer;
    }
    this.net.broadcast({ t: S.PHASE, phase: PHASE.LOBBY, endsAt: 0 });
    this.hooks.onPhase?.(PHASE.LOBBY, 0, null);
    this._roster();
    return true;
  }

  start() {
    if (!this.canStart()) return false;
    const ids = [...this.players.keys()];
    // shuffle, deal roles
    for (let i = ids.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    /* Scale with the lobby unless the host has pinned a number. One agent
       among nine is a needle in a haystack; three among four is a massacre. */
    const auto = ids.length >= 9 ? 3 : ids.length >= 6 ? 2 : 1;
    const want = this.settings.agents > 0 ? this.settings.agents : auto;
    const agentCount = this.dev
      ? 0                                   // alone, you are whatever you choose
      : Math.max(1, Math.min(want, Math.floor((ids.length - 1) / 2)));
    const agents = new Set(ids.slice(0, agentCount));

    this.tasksDone = 0;
    this.tasksTotal = 0;
    // one hole, and it is filled in again for a new round
    this.dug = 0;
    this._dugStep = -1;
    this.chestTaken = false;
    this.drops = [];
    this.vendSpent = [false, false];
    this.digSeconds = DIG_SECONDS;
    for (const id of ids) {
      const p = this.players.get(id);
      p.role = agents.has(id) ? ROLE.AGENT : ROLE.CASTAWAY;
      p.alive = true;
      p.doneTasks = new Set();
      p.emergencies = this.settings.emergencyPerPlayer;
      // the same clear-out as toLobby, for a round that is dealt without one
      p.quiet = false; p.vest = false; p.printer = false; p.whetstone = false;
      p.decoy = null; p.whistleUntil = 0; p.shroudUntil = 0;
      p.stunnedUntil = 0; p.nearBody = false;
      p.killReady = now() + Math.max(this.settings.killCooldown, this.settings.graceSeconds || 0);
      // the same list for everyone; an Agent's chores are real chores
      p.tasks = dealTasks(this.rng, this.settings.tasksPerPlayer);
      p.step = {};                       // taskId -> how far through it they are
      /* Only the Castaways' work sets the SIZE of the job. An Agent who
         pitches in is doing somebody else's share, not adding to it —
         otherwise a stonewalling Agent could park the bar below a hundred
         for ever and take the Castaways' win condition away with him. */
      if (p.role === ROLE.CASTAWAY) {
        for (const t of p.tasks) this.tasksTotal += taskSteps(t);
      }
    }
    this.bodies = [];
    this._endSabotage();
    this._dropSnap();
    this.over = null;
    /* The one who is not on the roster gets a fresh window every round.
       strangerDone left standing meant he came ashore in the first round and
       never again, and a strangerAt from a round that ended early put him out
       in the first frame of the next one. */
    if (this.stranger) {
      this.net.broadcast({ t: S.STRANGER, on: false });
      this.hooks.onStranger?.(false, 0, 0);
    }
    this.stranger = null;
    this.strangerAt = null;
    this.strangerDone = false;
    // which of the four hatches is real this round
    this.bunkerIndex = (this.rng() * 4) | 0;
    this.net.broadcast({ t: S.BUNKER, index: this.bunkerIndex });
    /* And the rules the round is being played under, so a dial turned in the
       lobby after somebody joined cannot survive into the round itself. */
    this.net.broadcast({ t: S.SETTINGS, settings: this.settings });
    this.hooks.onBunker?.(this.bunkerIndex);

    // private role cards
    const agentIds = [...agents];
    for (const [id, p] of this.players) {
      const card = {
        t: S.ROLE, role: p.role, tasks: p.tasks,
        /* Who you are working WITH. One array went to every Agent, so the
           reveal — the single beat where you learn your partner — opened by
           telling you your own name. */
        mates: p.role === ROLE.AGENT
          ? agentIds.filter((a) => a !== id).map((a) => this.players.get(a).name)
          : null,
      };
      if (id === 'host') this.hooks.onLocalRole?.(card);
      else this.net.sendTo(id, card);
    }
    this.graceEnds = now() + (this.settings.graceSeconds || 0);
    for (const p of this.players.values()) this._sendCooldown(p);
    this._roster();
    this._setPhase(PHASE.REVEAL, 22);
    this._tasks();
    return true;
  }

  /** The knife's own cooldown: Ferdi's whetstone takes a third off it. */
  _cdOf(p) { return this.settings.killCooldown * (p && p.whetstone ? 0.66 : 1); }

  /**
   * An agent's cooldown is private: everybody else learning when a knife
   * comes back would give the whole thing away. It travels as a duration
   * because performance.now() is a different zero on every machine.
   */
  _sendCooldown(p) {
    if (!p || p.role !== ROLE.AGENT) return;
    const secs = Math.max(0, p.killReady - now());
    const grace = Math.max(0, (this.graceEnds || 0) - now());
    if (p.id === 'host') this.hooks.onCooldown?.(secs, grace);
    else this.net.sendTo(p.id, { t: S.COOLDOWN, secs, grace });
  }

  _setPhase(phase, seconds, meta) {
    this.phase = phase;
    this.phaseEnds = seconds ? now() + seconds : 0;
    this.net.broadcast({ t: S.PHASE, phase, endsAt: seconds || 0, meta: meta || null });
    this.hooks.onPhase?.(phase, seconds || 0, meta || null);
  }

  _tasks() {
    this.net.broadcast({ t: S.TASKS, done: this.tasksDone, total: this.tasksTotal });
    this.hooks.onTasks?.(this.tasksDone, this.tasksTotal);
  }

  /* ---------- actions ---------- */
  _tryTask(id, taskId) {
    const p = this.players.get(id);
    if (!p || this.phase !== PHASE.ROAM) return;
    if (p.stunnedUntil && now() < p.stunnedUntil) return;
    if (!p.tasks.includes(taskId) || p.doneTasks.has(taskId)) return;

    p.step = p.step || {};
    const at = p.step[taskId] || 0;
    /* You have to be where the chore is. Every other action the host owns
       checks this — the knife at 4.8 m, a repair at its own site — and the
       one that decides the round did not, so a client could clear its whole
       list from the spawn point and hand the Castaways the win in a frame.
       The client offers the prompt inside 4.6 m and lets the hold drift
       1.6 m, so 8 is slack rather than a licence; a landmark the host cannot
       resolve is not a landmark it can refuse anybody at; and the room test
       is because every interior is its own space centred on its own origin,
       where a bunker-local position can land on top of an island one. */
    const stage = taskStage(taskId, at);
    const where = this.hooks.siteOf?.(stage?.at);
    if (where && ((p.room | 0) !== 0 || Math.hypot(p.x - where.x, p.z - where.z) > 8)) return;
    const stages = taskSteps(taskId);
    const finished = at >= stages - 1;

    if (finished) p.doneTasks.add(taskId);
    else p.step[taskId] = at + 1;

    /* EVERY completed step moves the bar, whoever did it.

       It used to only count a Castaway's work, and that was a hole you
       could drive a bus through: the crew picks a suspect, makes him do
       one chore while nobody else works, and watches the bar. It moves —
       he is one of them. It does not — he is an Agent. No amount of good
       lying survives that, because it is not a read, it is a readout.

       So an Agent's chores are real chores now. He can do them, they look
       identical from outside, and the bar cannot tell anyone apart.

       What it costs him is the point of the whole thing: the bar is how
       the Castaways WIN. Every chore an Agent does to look busy is a
       chore they no longer have to do themselves. Under suspicion he can
       buy his innocence by handing them progress, and that is a decision
       worth having rather than a tell worth exploiting.

       The dead count too — finishing the work is how the Castaways win,
       and being killed should not take you out of that fight. */
    this.tasksDone++;
    this._tasks();
    const packet = { t: S.TASK_OK, taskId, step: p.step[taskId] || 0, done: finished };
    if (id === 'host') this.hooks.onTaskOk?.(taskId, packet.step, finished);
    else this.net.sendTo(id, packet);
    /* What a finished chore leaves on the island belongs to the island. The
       splice that lights up and the pendulum that starts swinging are still
       there for anybody who walks past an hour later, and TASK_OK is private
       — so the latch travels on its own, with no doer and no position, since
       knowing a chore was done is not knowing who was standing there. The
       host never receives its own broadcast, hence the replay.

       A two-part chore spends both its stages at the same landmark, so the
       mark has to carry whether this was the LAST one. Without it the relic
       lit when the panel was prised rather than when the optic was spliced,
       which is the wrong half of the job to celebrate. */
    if (stage?.at) {
      this.net.broadcast({ t: S.WORLDFX, at: stage.at, last: finished });
      this.hooks.onWorldFx?.(stage.at, finished);
    }
    this._checkWin();
  }

  _tryKill(id, targetId) {
    const k = this.players.get(id), v = this.players.get(targetId);
    if (!k || !v || this.phase !== PHASE.ROAM) return;
    if (k.role !== ROLE.AGENT || !k.alive || !v.alive || v.role === ROLE.AGENT) return;
    if (now() < k.killReady) return;
    if (k.stunnedUntil && now() < k.stunnedUntil) return;
    /* AGENTS STRIKE ONLY AT NIGHT was a lobby row nothing ever read. The
       host's sky is the authority, and a host with no sky wired up is not a
       reason to refuse every kill in the round. */
    if (this.settings.nightOnly && this.hooks.isNight && !this.hooks.isNight()) return;
    /* Every interior is its own space centred on its own origin, so two
       people standing in different ones are not standing on each other. */
    if ((k.room | 0) !== (v.room | 0)) return;
    const d = Math.hypot(k.x - v.x, k.z - v.z);
    if (d > 4.8) return;                       // host validates range, not the client
    /* Ferdi's counter is neutral ground while the shop is open. Read from
       the sabotage the host is already holding rather than from a flag only
       a client hook ever wrote: that flag was never cleared between rounds,
       so a round that ended during SHUT FERDI'S left the sanctuary off for
       the rest of the session while every client's HUD read TRADING. */
    const shop = this.hooks.siteOf?.('hut');
    if (shop && this.sabotage?.kind !== 'shut') {
      const SANCT = 13;
      if (Math.hypot(v.x - shop.x, v.z - shop.z) < SANCT) return;
      if (Math.hypot(k.x - shop.x, k.z - shop.z) < SANCT) return;
    }

    if (v.vest) {
      /* A cork vest takes the strike. The knife still goes cold, and the
         Agent is left standing over somebody who is very much alive. */
      v.vest = false;
      k.killReady = now() + this._cdOf(k);
      this._sendCooldown(k);
      this.net.broadcast({ t: S.SAVED, victimId: v.id });
      this.hooks.onSaved?.(v.id);
      this._roster();
      return;
    }
    v.alive = false;
    k.killReady = now() + this._cdOf(k);
    this._sendCooldown(k);

    /* What they were carrying goes on the ground, and the Agent takes
       three quarters of it off the body. Killing a Castaway who has been
       working all round is now worth something beyond the kill. */
    const purse = Math.max(0, v.coins | 0);
    v.coins = 0;
    /* Tell the victim too. Only the killer was ever told, so the dead went on
       reading their own full purse on the HUD — and the moment a ghost drifted
       over a coin their client sent the stale total back and the host took it,
       restoring every syncoin that had just been looted off the body. No
       `gained`, so nobody pops the killer's card at their own funeral. */
    if (v.id === 'host') this.hooks.onPurse?.(0, 0);
    else this.net.sendTo(v.id, { t: S.PURSE, coins: 0 });
    if (purse > 0) {
      const taken = Math.floor(purse * LOOT_SHARE);
      const left = purse - taken;
      if (taken > 0) {
        k.coins = (k.coins | 0) + taken;
        if (k.id === 'host') this.hooks.onPurse?.(k.coins, taken);
        else this.net.sendTo(k.id, { t: S.PURSE, coins: k.coins, gained: taken });
      }
      if (left > 0) {
        /* The purse gets a name so the host can arbitrate who reaches it.
           Two people standing over it both credited themselves locally, and
           the same coins were in two purses. */
        const did = 'd' + (this._dropSeq = (this._dropSeq || 0) + 1);
        this.drops = this.drops || [];
        this.drops.push({ did, x: v.x, z: v.z, coins: left, taken: false });
        this.net.broadcast({ t: S.DROP, did, x: v.x, y: v.y, z: v.z, coins: left, id: v.id });
        this.hooks.onDrop?.(v.x, v.y, v.z, left, v.id, did);
      }
    }
    this.bodies.push({ id: v.id, x: v.x, y: v.y, z: v.z, room: v.room | 0 });
    /* Remember who was standing nearby. The Stranger trades in exactly this
       sort of thing — not who did it, just who was close enough to have. */
    this._markNearBody(v.x, v.z, v.room | 0, v.id);
    this.net.broadcast({ t: S.KILLED, victimId: v.id, x: v.x, y: v.y, z: v.z, room: v.room | 0 });
    this.hooks.onKilled?.(v.id, v.x, v.y, v.z);
    this._roster();
    this._checkWin();
  }

  /**
   * Somebody reached for a purse on the ground. The host says who got it,
   * once, and C.PURSE stays the only thing that writes anybody's coins.
   */
  _takeDrop(from, did) {
    const p = this.players.get(from);
    const d = (this.drops || []).find((x) => x.did === did);
    if (!d || d.taken) return;
    if (!p || !p.alive) return;
    // the client picks one up inside 2.2 m; the slack is for a stale position
    if (Math.hypot((p.x || 0) - d.x, (p.z || 0) - d.z) > 4) return;
    d.taken = true;
    this.net.broadcast({ t: S.DROPGONE, did, byId: from });
    this.hooks.onDropGone?.(did, from);
  }

  /**
   * The flare pistol. It cannot kill; it puts somebody on the sand and
   * calls a vote of whoever was close enough to see it happen. That
   * radius is the whole design — you are asking the people who happen to
   * be standing there, not the island.
   */
  _tryShoot(id, targetId) {
    const k = this.players.get(id), v = this.players.get(targetId);
    if (!k) return;                            // no client state to answer to
    /* Every refusal used to be a silent return, and the pistol had already
       fired, holstered itself and gone quiet by the time the host said no —
       so the most expensive thing in the shop looked broken exactly where it
       is worth most. The shell is still on the belt; say so. These three sat
       above the helper and stayed silent, and they are the ones you hit in a
       race: somebody else's vote opened a frame ago, or the target was
       knifed while the flare was still in the air. */
    const deny = (why) => {
      if (id === 'host') this.hooks.onSnapDeny?.(why);
      else this.net.sendTo(id, { t: S.SNAPDENY, why });
    };
    if (this.phase !== PHASE.ROAM || !k.alive) { deny('NOT NOW'); return; }
    if (!v || !v.alive) { deny('NOT A TARGET'); return; }
    if (this.snap) { deny('A VOTE IS ALREADY OPEN'); return; }
    // as with the knife: different spaces
    if ((k.room | 0) !== (v.room | 0)) { deny('NOT IN HERE'); return; }
    /* The shot used to reach four metres further than the circle it polls, so
       a long one opened a vote with nobody in it — the shooter included — and
       cost the victim fourteen seconds for a panel that could never resolve.
       One radius now, and it wants two witnesses, because a single witness
       carrying the whole vote is a verdict rather than a vote. */
    const R = 30;
    if (Math.hypot(k.x - v.x, k.z - v.z) >= R) { deny('TOO FAR'); return; }

    // everyone near enough to have seen it gets a say
    const voters = [...this.players.values()]
      .filter((p) => p.alive && p.id !== targetId && (p.room | 0) === (v.room | 0)
        && Math.hypot(p.x - v.x, p.z - v.z) < R)
      .map((p) => p.id);
    if (voters.length < 2) { deny('NOBODY ELSE SAW IT'); return; }

    const SECS = 14;
    v.stunnedUntil = now() + SECS;
    this.net.broadcast({ t: S.SHOT, byId: id, victimId: targetId, x: v.x, y: v.y, z: v.z, secs: SECS });
    this.hooks.onShot?.(id, targetId, v, SECS);

    this.snap = { victimId: targetId, byId: id, endsAt: now() + 12, voters, yes: new Set(), no: new Set() };
    this.net.broadcast({ t: S.SNAPOPEN, victimId: targetId, byId: id, secs: 12, voters });
    this.hooks.onSnapOpen?.(targetId, id, 12, voters);
  }

  _trySnap(id, yes) {
    const s2 = this.snap;
    if (!s2 || !s2.voters.includes(id)) return;
    if (s2.yes.has(id) || s2.no.has(id)) return;
    (yes ? s2.yes : s2.no).add(id);
    const need = Math.floor(s2.voters.length / 2) + 1;
    this.net.broadcast({ t: S.SNAPTALLY, yes: s2.yes.size, no: s2.no.size, need });
    this.hooks.onSnapTally?.(s2.yes.size, s2.no.size, need);
    if (s2.yes.size >= need || s2.no.size >= need
      || s2.yes.size + s2.no.size >= s2.voters.length) this._closeSnap();
  }

  _closeSnap() {
    const s2 = this.snap;
    if (!s2) return;
    this.snap = null;
    const need = Math.floor(s2.voters.length / 2) + 1;
    const exiled = s2.yes.size >= need && s2.yes.size > s2.no.size;
    const v = this.players.get(s2.victimId);
    if (exiled && v) {
      v.alive = false;
      v.stunnedUntil = 0;
      /* A snap vote answered the question REVEAL ON EXILE had turned off, and
         it answered it on the wire, where holding the card back on screen would
         not have helped. Nobody is told what they were unless the host said so. */
      const rv = this.settings.revealOnExile;
      this.net.broadcast({
        t: S.SNAPDONE, victimId: s2.victimId, exiled: true,
        yes: s2.yes.size, no: s2.no.size,
        wasAgent: rv ? (v.role === ROLE.AGENT) : null, reveal: rv,
      });
      this.hooks.onSnapDone?.(s2.victimId, true, rv ? (v.role === ROLE.AGENT) : null,
        s2.yes.size, s2.no.size);
      this._roster();
      this._checkWin();
    } else {
      this.net.broadcast({ t: S.SNAPDONE, victimId: s2.victimId, exiled: false, yes: s2.yes.size, no: s2.no.size });
      this.hooks.onSnapDone?.(s2.victimId, false, false, s2.yes.size, s2.no.size);
    }
  }

  /**
   * A snap vote the end of the round arrived underneath. Its tally belongs to
   * a round nobody is playing any more, so it exiles nobody — but it still has
   * to be closed out loud: S.SNAPDONE is the only thing that clears a client's
   * copy, and one left standing refuses the flare pistol for the rest of the
   * session.
   */
  _dropSnap() {
    const s2 = this.snap;
    if (!s2) return;
    this.snap = null;
    this.net.broadcast({ t: S.SNAPDONE, victimId: s2.victimId, exiled: false, yes: s2.yes.size, no: s2.no.size });
    /* The tally travels with it. The hook takes five and the host reads
       yes/no straight into its own toast, so dropping them printed
       THE VOTE FAILED undefined-undefined on the host alone — the
       broadcast a line above has always carried them. */
    this.hooks.onSnapDone?.(s2.victimId, false, false, s2.yes.size, s2.no.size);
  }

  _tryReport(id, bodyId) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== PHASE.ROAM) return;
    if (this.sabotage?.fatal) return;          // no meetings during a fatal sabotage

    if (bodyId) {
      const b = this.bodies.find((x) => x.id === bodyId);
      if (!b) return;
      if ((p.room | 0) !== (b.room | 0)) return;   // the body is in another space
      if (Math.hypot(p.x - b.x, p.z - b.z) > 4.5) return;
    } else {
      if (p.emergencies <= 0) return;
      /* The body branch checks where you are standing and this one never
         did, so a council could be called from the far side of the island —
         or from inside the listening post, where there is no bell — which is
         a free escape from an Agent already on top of you. Slack of 5 m
         against the client's own 3.4: host-side positions are a net tick and
         a channel behind. */
      const bell = this.hooks.siteOf?.('bell');
      if (bell && ((p.room | 0) !== 0 || Math.hypot(p.x - bell.x, p.z - bell.z) > 5)) return;
      p.emergencies--;
    }
    this._openCouncil(id, bodyId || null);
  }

  _openCouncil(byId, bodyOf) {
    this.bodies = [];
    this.votes.clear();
    this._endSabotage();
    this.council = { calledBy: byId, bodyOf };
    /* PHASE first, then COUNCIL. The guest's phase handler replaces the whole
       screen stack, so a body card sent ahead of it was wiped before it drew
       and only the host ever saw the stinger. This is the order the host's own
       hooks fire in anyway. */
    /* The dial is the whole meeting, exactly as the lobby row promises. A
       second, hidden window added on top of it meant the council always opened
       on a clock 25 seconds longer than the number the host had set. */
    this._setPhase(PHASE.COUNCIL, this.settings.councilSeconds, { calledBy: byId, bodyOf });
    /* A flare vote the meeting arrived underneath. The phase has already
       replaced the snap card on every client, so nobody could answer it, yet
       it would go on running and could exile somebody mid-council. Closed
       here rather than at the top of the method: after the phase, every
       client is on the council screen, so closing it neither clears a screen
       stack nor asks for the pointer lock back inside a meeting. */
    this._dropSnap();
    this.net.broadcast({ t: S.COUNCIL, calledBy: byId, bodyOf });
    this.hooks.onCouncil?.(byId, bodyOf);
  }

  _tryVote(id, targetId) {
    const p = this.players.get(id);
    /* One room. You can talk and vote in it at the same time, and the
       meeting ends when everyone has voted or the clock runs out — being
       made to declare you had stopped talking before you were allowed to
       choose anybody was two gates where none were needed. */
    if (!p || !p.alive || this.phase !== PHASE.COUNCIL) return;
    if (this.votes.has(id)) return;
    if (targetId !== 'skip') {
      const t = this.players.get(targetId);
      if (!t || !t.alive) return;
    }
    this.votes.set(id, targetId);
    this._broadcastVotes();
    const aliveCount = [...this.players.values()].filter((x) => x.alive).length;
    if (this.votes.size >= aliveCount) this._resolveVote();
  }

  _broadcastVotes() {
    const counts = {};
    for (const v of this.votes.values()) counts[v] = (counts[v] || 0) + 1;
    const voted = [...this.votes.keys()];
    this.net.broadcast({ t: S.VOTES, counts, voted });
    this.hooks.onVotes?.(counts, voted);
  }

  _resolveVote() {
    const counts = {};
    for (const v of this.votes.values()) counts[v] = (counts[v] || 0) + 1;
    let best = null, bestN = 0, tie = false;
    for (const [k, n] of Object.entries(counts)) {
      if (k === 'skip') continue;
      if (!this.players.has(k)) continue;      // they left; the ballot has no subject
      if (n > bestN) { best = k; bestN = n; tie = false; }
      else if (n === bestN) tie = true;
    }
    const skips = counts.skip || 0;
    /* The lookup belongs in the condition. Nested inside, a target who had
       since left swallowed the branch without taking the else either, so the
       meeting closed with no exile card and no explanation at all. */
    const p = (best && (bestN > skips) && !tie) ? this.players.get(best) : null;
    if (p) {
      p.alive = false;
      /* The answer used to go out whatever the setting said, so NEVER hid it
         from the card and from nobody else — anyone with a console open could
         read what the council was not allowed to know. */
      const rv = this.settings.revealOnExile;
      this.net.broadcast({
        t: S.EXILE, targetId: best, wasAgent: rv ? (p.role === ROLE.AGENT) : null,
        reveal: rv, name: p.name,
      });
      this.hooks.onExile?.(best, rv ? (p.role === ROLE.AGENT) : null);
    } else {
      this.net.broadcast({ t: S.EXILE, targetId: null, wasAgent: false, reveal: false });
      this.hooks.onExile?.(null, false);
    }
    this._roster();
    this._setPhase(PHASE.RESULT, 8.5);
    /* The win check waits out the reveal. Resolving it immediately would
       replace the "X WAS A ROGUE AGENT" card with the results screen in
       the same frame, and the exile is the payoff people came for. */
    setTimeout(() => {
      if (this.phase !== PHASE.RESULT) return;
      if (this._checkWin()) return;
      for (const p of this.players.values()) {
        if (p.role !== ROLE.AGENT) continue;
        /* A flat cooldown here threw away the grace period a meeting had
           interrupted, so a knife could come back well inside the window the
           host advertised as safe. */
        p.killReady = Math.max(now() + this._cdOf(p) * 0.6, this.graceEnds || 0);
        this._sendCooldown(p);
      }
      this._setPhase(PHASE.ROAM, 0);
    }, 8500);
  }

  _chat(id, text) {
    const p = this.players.get(id);
    if (!p) return;
    const clean = String(text || '').slice(0, 120).replace(/[\u0000-\u001f]/g, '');
    if (!clean.trim()) return;
    // The dead get their own channel; letting them talk to the living
    // would hand the answer to everybody.
    const kind = p.alive ? 'live' : 'ghost';
    if (this.phase !== PHASE.COUNCIL && this.phase !== PHASE.VOTE && kind === 'live') return;
    const packet = { t: S.CHAT, from: p.name, colour: p.colour, text: clean, kind };
    if (kind === 'ghost') {
      for (const [pid, pp] of this.players) {
        if (pp.alive) continue;
        if (pid === 'host') this.hooks.onChat?.(packet);
        else this.net.sendTo(pid, packet);
      }
    } else {
      this.net.broadcast(packet);
      this.hooks.onChat?.(packet);
    }
  }

  /* Who was within a dozen metres of the LATEST body; the one before it is
     forgotten. The flag was only ever set, never cleared, so after two or
     three kills most of the roster carried it and the Stranger's "when the
     last of you fell" riddle — which he promises is always true — was about
     a body from eight minutes ago. The room test is because every interior
     is its own space centred on its own origin. */
  _markNearBody(x, z, room, exceptId) {
    for (const q of this.players.values()) {
      q.nearBody = false;
      if (q.id === exceptId) continue;
      if ((q.room | 0) !== (room | 0)) continue;
      if (Math.hypot((q.x || 0) - x, (q.z || 0) - z) < 12) q.nearBody = true;
    }
  }

  /**
   * Somebody bought something over Ferdi's open counter, and the people
   * who own a printer get a docket for it.
   *
   * The buyer says what it was; the host says who they were and passes it
   * on. The buyer never gets their own receipt — you know what you just
   * bought, and a printer that told you would be noise.
   *
   * Only the open counter. What goes on under it is the whole point of
   * the black market and printing that would end it.
   */
  _receipt(from, msg) {
    const p = this.players.get(from);
    if (!p || !msg || !msg.id) return;
    const price = Math.max(0, Math.min(999, msg.price | 0));
    for (const [pid, q] of this.players) {
      if (!q.printer || pid === from) continue;
      const packet = { t: S.RECEIPT, from: p.name || '?', id: msg.id, price };
      if (pid === 'host') this.hooks.onReceipt?.(packet);
      else this.net.sendTo(pid, packet);
    }
  }

  /* =========================================================
     THE BURIED CHEST

     One hole, one chest, one lot of gold. All of it used to be worked out
     on each player's own machine: everybody dug their own private hole in
     the same spot, everybody found a chest in it, and everybody took
     twenty to forty coins out of it. Two people standing over the same X
     saw different holes.

     The hole belongs to the host now. Anybody can put spadework in and it
     all goes into the same hole, and the first person to reach in gets
     what is in there — once.
     ========================================================= */
  _dig(from, msg) {
    const p = this.players.get(from);
    if (!p || !p.alive || this.phase !== PHASE.ROAM) return;
    if (this.chestTaken) return;
    /* A finished hole used to answer nothing at all, which is exactly what a
       client whose S.DIG went astray is already getting: it keeps sending
       spadework and keeps offering DIG for a chest that surfaced long ago.
       Tell that one caller how deep it really is. */
    if (this.dug >= 1) {
      if (from === 'host') this.hooks.onDig?.(1);
      else this.net.sendTo(from, { t: S.DIG, dug: 1 });
      return;
    }
    // a quarter of a second at a time at most, so nobody can dig it in one
    const secs = Math.max(0, Math.min(0.4, +msg.secs || 0));
    this.dug = Math.min(1, (this.dug || 0) + secs / this.digSeconds);
    const step = Math.round(this.dug * 20);          // twentieths, to keep the wire quiet
    if (step !== this._dugStep || this.dug >= 1) {
      this._dugStep = step;
      this.net.broadcast({ t: S.DIG, dug: this.dug });
      this.hooks.onDig?.(this.dug);
    }
  }

  _openChest(from) {
    const p = this.players.get(from);
    if (!p || !p.alive) return;
    if (this.chestTaken || (this.dug || 0) < 1) return;
    this.chestTaken = true;
    /* The host rolls it, so there is one answer and everybody hears the
       same one. Between twenty and forty: a night at Ferdi's, or a very
       good night at the Flopper. */
    const gold = 20 + ((this.rng() * 21) | 0);
    p.coins = (p.coins | 0) + gold;
    this.net.broadcast({ t: S.CHEST, byId: from, gold, prize: null });
    this.hooks.onChest?.(from, gold, null);
  }

  /**
   * One of Ferdi's two machines. Each holds one thing and the host rolls it,
   * so the handle cannot be pulled twice and two people cannot walk away
   * with the same item because they each rolled their own.
   */
  _vend(from, msg) {
    const p = this.players.get(from);
    if (!p || !p.alive || this.phase !== PHASE.ROAM) return;
    const index = Math.max(0, Math.min(1, msg?.index | 0));
    this.vendSpent = this.vendSpent || [false, false];
    if (this.vendSpent[index]) return;
    /* As with the chores: a machine the host cannot place is not one it can
       refuse anybody at, and an interior is its own coordinate space. */
    const where = this.hooks.siteOf?.('vend' + (index + 1));
    if (where && ((p.room | 0) !== 0 || Math.hypot(p.x - where.x, p.z - where.z) > 8)) return;
    this.vendSpent[index] = true;
    const itemId = VENDOR_IDS[(this.rng() * VENDOR_IDS.length) | 0];
    this.net.broadcast({ t: S.VEND, index, byId: from, itemId });
    this.hooks.onVend?.(index, from, itemId);
  }

  _sendLedger(id) {
    /* The comment on the case above promises the table is somewhere you have
       to go, and nothing here checked. Any peer could ask from the beach and
       be handed every purse on the island, as often as it liked. */
    const p = this.players.get(id);
    if (!p || (p.room | 0) !== 1) return;      // only from inside the listening post
    const t = now();
    if (t - (p.ledgerAt || 0) < 1) return;
    p.ledgerAt = t;
    const rows = [];
    for (const [pid, pl] of this.players) {
      // the lead shroud, kept where it is decided rather than where it is drawn
      if (pl.shroudUntil && t < pl.shroudUntil) continue;
      rows.push([pid, Math.max(0, pl.coins | 0)]);
    }
    if (id === 'host') this.hooks.onLedger?.(rows);
    else this.net.sendTo(id, { t: S.LEDGER, rows });
  }

  /* =========================================================
     THE ONE WHO IS NOT ON THE ROSTER

     He comes ashore once. The host decides when, walks him through the
     jungle far faster than anybody can follow, and takes him away again
     after about a minute whether anybody reached him or not.
     ========================================================= */

  /** Called every rules tick. Cheap when he is not out. */
  _tickStranger(dt) {
    if (!this.settings.stranger) return;
    if (this.phase !== PHASE.ROAM) return;
    const t = now();
    const S2 = this.stranger;

    if (!S2) {
      /* He waits. Somewhere between two and five minutes in, so he is not
         part of the opening and not an afterthought either. */
      /* `== null`, not `!`. Zero is a perfectly good time and treating it as
         "unset" means anything that pokes this to force him out early just
         gets a fresh delay instead. */
      if (this.strangerAt == null) this.strangerAt = t + 120 + this.rng() * 180;
      if (this.strangerDone || t < this.strangerAt) return;
      /* Out of the treeline, well away from the camp so finding him is
         luck rather than a scheduled event. */
      const a = this.rng() * Math.PI * 2;
      const r = 70 + this.rng() * 70;
      this.stranger = {
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        // a wandering heading he keeps mostly to
        head: this.rng() * Math.PI * 2,
        endsAt: t + 75,
        spoken: false,
        sentAt: t,
      };
      this.net.broadcast({ t: S.STRANGER, on: true, x: this.stranger.x, z: this.stranger.z });
      this.hooks.onStranger?.(true, this.stranger.x, this.stranger.z);
      return;
    }

    if (t >= S2.endsAt) {
      this.stranger = null;
      this.strangerDone = true;
      this.net.broadcast({ t: S.STRANGER, on: false });
      this.hooks.onStranger?.(false, 0, 0);
      return;
    }

    /* He moves fast — about twice a sprint — and turns rather than running
       in a line, and he will not leave the island.

       But he STOPS when somebody gets close. Twenty-six metres a second is
       faster than anybody can chase, and a thing you can never reach is
       decoration rather than a mechanic. So: he runs while nobody is near,
       and once you are inside twenty metres he turns and waits for you. If
       you dawdle he loses patience and goes. */
    let nearest = Infinity, toward = S2.head;
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const d = Math.hypot((q.x || 0) - S2.x, (q.z || 0) - S2.z);
      if (d < nearest) {
        nearest = d;
        toward = Math.atan2((q.x || 0) - S2.x, (q.z || 0) - S2.z);
      }
    }
    const watching = nearest < 20;
    if (watching) {
      // he turns to face you and holds still, and his patience runs down
      S2.head = toward;
      S2.waited = (S2.waited || 0) + dt;
      if (S2.waited > 18) S2.endsAt = Math.min(S2.endsAt, t + 0.5);
    } else {
      // a dt of 0 is a caller running on frames, not a tick; a draw here only
      // pulls the seeded stream out from under everything else that uses it
      if (dt > 0) S2.head += (this.rng() - 0.5) * dt * 2.2;
      S2.waited = 0;
    }
    const SP = watching ? 0 : 26;
    S2.x += Math.sin(S2.head) * SP * dt;
    S2.z += Math.cos(S2.head) * SP * dt;
    const rr = Math.hypot(S2.x, S2.z);
    if (rr > 160) { S2.head += Math.PI; S2.x *= 160 / rr; S2.z *= 160 / rr; }
    /* The wire only needs him a few times a second, and this trusted the
       caller to pace it — but MPGame calls update(0) once a frame from inside
       every interior, so the moment the host stepped indoors he went out at
       sixty a second to everybody, saying nothing new. */
    if (t - (S2.sentAt || 0) >= 0.15) {
      S2.sentAt = t;
      this.net.broadcast({ t: S.STRANGER, on: true, x: +S2.x.toFixed(1), z: +S2.z.toFixed(1) });
    }
    this.hooks.onStranger?.(true, S2.x, S2.z);
  }

  /** Somebody reached him. One clue for a Castaway and he is gone for good;
      an Agent gets the brush-off and he stays where he is. */
  _askStranger(id) {
    const S2 = this.stranger;
    const p = this.players.get(id);
    if (!S2 || !p || !p.alive) return;
    /* He stands on the treeline, and every interior is its own space centred
       on its own origin — so a bunker-local position could land inside seven
       metres of an island one and buy the round's only clue from underground,
       with nobody able to walk up and see it happening. */
    if ((p.room | 0) !== 0 || Math.hypot((p.x || 0) - S2.x, (p.z || 0) - S2.z) > 7) return;

    const agents = [...this.players.values()]
      .filter((q) => q.role === ROLE.AGENT && q.alive)
      .map((q) => ({
        id: q.id, x: q.x || 0, z: q.z || 0, coins: q.coins | 0, alive: true,
        nearBody: !!q.nearBody,
      }));
    const crew = [...this.players.values()].filter((q) => q.alive).map((q) => ({ coins: q.coins | 0 }));
    /* An Agent asking gets nothing useful — he knows who they are. */
    const clue = p.role === ROLE.AGENT
      ? { text: 'YOU AND I ARE IN THE SAME TRADE. I HAVE NOTHING TO SELL YOU.', about: null }
      : makeClue({ agents, crew, named: this.hooks.namedSites?.() || {}, rand: () => this.rng() });

    /* He used to leave for an Agent too, which made deleting the crew's one
       clue of the round a single keypress that nobody could see happen. Now
       the brush-off costs him nothing and he stays; an Agent who wants him
       gone still has to stand inside twenty metres for eighteen seconds,
       lit, while anybody may be running at him. The snub is remembered so
       leaning on E cannot keep re-opening the card. */
    if (p.role === ROLE.AGENT) {
      S2.snubbed = S2.snubbed || new Set();
      if (S2.snubbed.has(id)) return;
      S2.snubbed.add(id);
    }
    S2.spoken = true;
    if (id === 'host') this.hooks.onRiddle?.(clue.text);
    else this.net.sendTo(id, { t: S.RIDDLE, text: clue.text });
    // and, for anybody he actually had something to say to, he leaves
    if (p.role !== ROLE.AGENT) {
      this.stranger = null;
      this.strangerDone = true;
      this.net.broadcast({ t: S.STRANGER, on: false });
      this.hooks.onStranger?.(false, 0, 0);
    }
  }

  _trySabotage(id, kind) {
    const p = this.players.get(id);
    /* Own keys only. `kind` comes straight off the wire, and 'constructor'
       resolved to Object itself — truthy, with no secs, so the sabotage got
       an endsAt of NaN, never expired, and blocked every real one for the
       rest of the round. */
    const def = Object.prototype.hasOwnProperty.call(SABOTAGE_DEFS, kind) ? SABOTAGE_DEFS[kind] : null;
    if (!p || !def || p.role !== ROLE.AGENT || !p.alive) return;
    if (this.phase !== PHASE.ROAM || this.sabotage) return;
    if (p.stunnedUntil && now() < p.stunnedUntil) return;
    // per-kind cooldown, so the fatal one cannot simply be run back
    this.cool = this.cool || {};
    if (this.cool[kind] && now() < this.cool[kind]) {
      this.net.sendTo(id, { t: S.SABOTAGE, kind, secs: 0, fatal: false, refused: true });
      return;
    }
    /* Where they were standing when they pulled it. Not a position — a
       half of the island, which is enough to cut the suspect list roughly
       in two without handing anybody the answer. Only the listening post
       ever sees it. */
    const half = Math.abs(p.x || 0) > Math.abs(p.z || 0)
      ? ((p.x || 0) > 0 ? 'EAST' : 'WEST')
      : ((p.z || 0) > 0 ? 'SOUTH' : 'NORTH');
    this.sabotage = {
      kind, endsAt: now() + def.secs, fatal: !!def.fatal, sites: new Set(), half,
    };
    this.net.broadcast({
      t: S.SABOTAGE, kind, secs: def.secs, fatal: !!def.fatal, sites: def.sites, half,
    });
    this.hooks.onSabotage?.(kind, def.secs, !!def.fatal, def.sites, half);
  }

  /**
   * End whatever is running, out loud.
   *
   * S.FIXED is the only thing that clears a client's copy of a sabotage, so
   * one nulled silently is a countdown stuck on every HUD, a storm that
   * never stops striking and a sabotage wheel that never opens again. And
   * every way of ending one has to arm its cooldown, or the pull is
   * laundered away and waiting the moment the island comes back.
   */
  _endSabotage() {
    if (!this.sabotage) return;
    const kind = this.sabotage.kind;
    const cd = SABOTAGE_DEFS[kind]?.cooldown || 0;
    this.sabotage = null;
    this.cool = this.cool || {};
    this.cool[kind] = now() + cd;
    /* S.FIXED is how a sabotage ends, but nobody fixed this one — the
       meeting, the lobby or the round's end cancelled it — so it must not be
       announced as a repair somebody could then claim in council. */
    this.net.broadcast({ t: S.FIXED, kind, cooldown: cd, why: 'council' });
    this.hooks.onFixed?.(kind, cd, 'council');
  }

  /**
   * @param {string} at  which of the sabotage's repair points they are at.
   *   The host checks they are really standing there, and counts distinct
   *   places rather than distinct people.
   */
  _tryFix(id, kind, at) {
    const p = this.players.get(id);
    if (!p || !p.alive || !this.sabotage || this.sabotage.kind !== kind) return;
    const def = SABOTAGE_DEFS[kind];
    const site = def.fixAt.includes(at) ? at : def.fixAt[0];
    const where = this.hooks.siteOf?.(site);
    /* 8, not 6: the client offers REPAIR at 5.0 m and the hold survives 1.6 m
       of drift, so a finished repair could legitimately arrive from 6.6 m and
       be swallowed in silence — the bar fills, the sound plays, nothing. */
    if (where && Math.hypot(p.x - where.x, p.z - where.z) > 8) return;
    this.sabotage.sites.add(site);
    const need = def.sites || 1;
    this.net.broadcast({ t: S.FIXPROGRESS, kind, done: this.sabotage.sites.size, need, at: site });
    this.hooks.onFixProgress?.(kind, this.sabotage.sites.size, need, site);
    if (this.sabotage.sites.size >= need) {
      this.sabotage = null;
      this.cool = this.cool || {};
      this.cool[kind] = now() + (def.cooldown || 0);
      this.net.broadcast({ t: S.FIXED, kind, cooldown: def.cooldown || 0, why: 'fix' });
      this.hooks.onFixed?.(kind, def.cooldown || 0, 'fix');
    }
  }

  /* ---------- win ---------- */
  _checkWin() {
    if (this.over || this.phase === PHASE.LOBBY) return false;
    const alive = [...this.players.values()].filter((p) => p.alive);
    const agents = alive.filter((p) => p.role === ROLE.AGENT);
    const crew = alive.filter((p) => p.role === ROLE.CASTAWAY);

    let winner = null, reason = '';
    if (agents.length === 0) { winner = 'castaways'; reason = 'EVERY AGENT EXILED'; }
    else if (agents.length >= crew.length) { winner = 'agents'; reason = 'THE AGENTS OUTNUMBER YOU'; }
    else if (this.tasksTotal > 0 && this.tasksDone >= this.tasksTotal) {
      winner = 'castaways'; reason = 'ALL WORK COMPLETE';
    }
    if (this.dev) return false;             // the workshop never ends on its own
    if (!winner) return false;

    /* The round ending is a fourth way a sabotage ends, and update() returns
       on its first line once the phase is OVER — so the expiry that would
       have broadcast S.FIXED never comes, and the storm, the jam or the
       douse rides into the next round on every client. Before the OVER card
       goes out, not after: the client's onFixed starts the island music
       again, and after OVER it would play under the results. */
    this._endSabotage();

    this.over = { winner, reason };
    const agentIds = [...this.players.values()]
      .filter((p) => p.role === ROLE.AGENT).map((p) => p.id);
    this.net.broadcast({ t: S.OVER, winner, agents: agentIds, reason });
    this._setPhase(PHASE.OVER, 0);
    this.hooks.onOver?.(winner, agentIds, reason);
    return true;
  }

  /* ---------- tick ---------- */
  update(dt) {
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.OVER) return;

    // phase timers
    if (this.phaseEnds && now() >= this.phaseEnds) {
      if (this.phase === PHASE.REVEAL) this._setPhase(PHASE.ROAM, 0);
      else if (this.phase === PHASE.COUNCIL) this._resolveVote();
    }

    // a snap vote nobody finished
    if (this.snap && now() >= this.snap.endsAt) this._closeSnap();

    this._tickStranger(dt);

    /* Timed perks expire quietly. The roster is what carries them, so when
       one runs out the roster has to go again or a whistle blown once
       lasts for the rest of the round. */
    {
      const t = now();
      let stale = false;
      for (const p of this.players.values()) {
        if (p.whistleUntil && t >= p.whistleUntil) { p.whistleUntil = 0; stale = true; }
        if (p.decoy && t >= p.decoy.until) { p.decoy = null; stale = true; }
        if (p.shroudUntil && t >= p.shroudUntil) { p.shroudUntil = 0; stale = true; }
      }
      if (stale) this._roster();
    }

    // a fatal sabotage that runs out ends the game
    if (this.sabotage && now() >= this.sabotage.endsAt) {
      const wasFatal = this.sabotage.fatal;
      const kind = this.sabotage.kind;
      this.sabotage = null;
      this.cool = this.cool || {};
      const cd = SABOTAGE_DEFS[kind]?.cooldown || 0;
      this.cool[kind] = now() + cd;
      /* It ran its length and nobody reached the repair point. The same
         message went out as for a real repair, so the mist lifting on its own
         told the island somebody had fixed it — a repair that never happened,
         and free cover for whoever pulled it. */
      const why = wasFatal ? 'lost' : 'expired';
      this.net.broadcast({ t: S.FIXED, kind, cooldown: cd, why });
      this.hooks.onFixed?.(kind, cd, why);
      if (wasFatal && !this.over) {
        this.over = { winner: 'agents', reason: 'THE PENDULUMS STOPPED' };
        const agentIds = [...this.players.values()]
          .filter((p) => p.role === ROLE.AGENT).map((p) => p.id);
        this.net.broadcast({ t: S.OVER, winner: 'agents', agents: agentIds, reason: this.over.reason });
        this._setPhase(PHASE.OVER, 0);
        this.hooks.onOver?.('agents', agentIds, this.over.reason);
      }
    }
  }

  /**
   * Position broadcast, called on its own slower ticker. The rows are
   * returned as well as sent: the host never receives its own broadcast,
   * and it should be drawing everyone else from the exact same data the
   * clients get rather than from a private shortcut.
   */
  snapshot() {
    const arr = [];
    for (const p of this.players.values()) {
      arr.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), p.anim | 0, p.alive ? 1 : 0,
        p.room | 0]);
    }
    /* Everybody ran their own day clock from their own join time, so dusk
       fell at a different minute on every machine — and a throttled tab woke
       up an hour behind the island it is standing on. The host's hour rides
       along so the mirror can ease toward it. Absent until the host wires the
       hook up, and a missing field is simply nothing to ease toward. */
    const c24 = this.hooks.clock24?.();
    const msg = { t: S.SNAPSHOT, p: arr };
    if (Number.isFinite(c24)) msg.c24 = r2(c24);
    this.net.broadcast(msg);
    return arr;
  }
}

/* ===========================================================
   CLIENT MIRROR — holds whatever the host last said.
   =========================================================== */
export class MirrorSession {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.players = new Map();
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = 0;
    this.role = null;
    this.tasks = [];
    this.doneTasks = new Set();
    this.taskStep = new Map();      // taskId -> how far through a two-part chore
    this.mates = null;
    this.tasksDone = 0;
    this.tasksTotal = 0;
    this.bodies = [];
    this.votes = { counts: {}, voted: [] };
    this.sabotage = null;
    this.over = null;
    this.selfId = null;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  handle(msg) {
    switch (msg.t) {
      case S.WELCOME: this.selfId = msg.youAre; this.settings = msg.settings || this.settings; break;
      case S.SETTINGS: this.settings = msg.settings || this.settings; break;
      case S.ROSTER: {
        const seen = new Set();
        for (const r of msg.players) {
          seen.add(r.id);
          const p = this.players.get(r.id) || { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
          Object.assign(p, r);
          this.players.set(r.id, p);
        }
        for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
        this.hooks.onRoster?.([...this.players.values()]);
        break;
      }
      case S.PHASE:
        this.phase = msg.phase;
        this.phaseEndsAt = msg.endsAt ? performance.now() / 1000 + msg.endsAt : 0;
        if (msg.phase === PHASE.COUNCIL) { this.votes = { counts: {}, voted: [] }; this.bodies = []; }
        this.hooks.onPhase?.(msg.phase, msg.endsAt, msg.meta);
        break;
      case S.ROLE:
        this.role = msg.role; this.tasks = msg.tasks || []; this.mates = msg.mates;
        this.doneTasks = new Set();
        this.taskStep = new Map();
        this.hooks.onRole?.(msg);
        break;
      case S.SNAPSHOT:
        for (const [id, x, y, z, yaw, anim, alive] of msg.p) {
          const p = this.players.get(id) || {};
          p.id = id;
          p.tx = x; p.ty = y; p.tz = z; p.tyaw = yaw; p.anim = anim; p.alive = !!alive;
          if (p.x === undefined) { p.x = x; p.y = y; p.z = z; p.yaw = yaw; }
          this.players.set(id, p);
        }
        break;
      case S.COOLDOWN:
        this.hooks.onCooldown?.(msg.secs || 0);
        break;
      case S.TASKS: this.tasksDone = msg.done; this.tasksTotal = msg.total; break;
      case S.TASK_OK:
        if (msg.done === false) this.taskStep.set(msg.taskId, msg.step);
        else this.doneTasks.add(msg.taskId);
        this.hooks.onTaskOk?.(msg.taskId, msg.step, msg.done !== false);
        break;
      case S.KILLED:
        this.bodies.push({ id: msg.victimId, x: msg.x, y: msg.y, z: msg.z, room: msg.room | 0 });
        this.hooks.onKilled?.(msg.victimId, msg.x, msg.y, msg.z);
        break;
      case S.BODY_GONE:
        this.bodies = this.bodies.filter((b) => b.id !== msg.victimId);
        this.hooks.onBodyGone?.(msg.victimId);
        break;
      case S.COUNCIL: this.bodies = []; this.hooks.onCouncil?.(msg.calledBy, msg.bodyOf); break;
      case S.CHAT: this.hooks.onChat?.(msg); break;
      case S.VOTES: this.votes = { counts: msg.counts, voted: msg.voted }; this.hooks.onVotes?.(msg); break;
      case S.EXILE: this.hooks.onExile?.(msg); break;
      case S.SABOTAGE:
        if (msg.refused) { this.hooks.onRefused?.(msg.kind); break; }
        this.sabotage = { kind: msg.kind, endsAt: performance.now() / 1000 + msg.secs,
          fatal: msg.fatal, done: 0, need: msg.sites || 1 };
        this.hooks.onSabotage?.(msg.kind, msg.secs, msg.fatal);
        break;
      case S.PURSE: this.hooks.onPurse?.(msg.coins, msg.gained); break;
      case S.LEDGER: this.hooks.onLedger?.(msg.rows); break;
      case S.BLACKOUT: this.hooks.onBlackout?.(msg.secs); break;
      case S.STRANGER: this.hooks.onStranger?.(msg.on, msg.x, msg.z); break;
      case S.RIDDLE: this.hooks.onRiddle?.(msg.text); break;
      case S.DROP: this.hooks.onDrop?.(msg.x, msg.y, msg.z, msg.coins, msg.id); break;
      case S.SHOT: this.hooks.onShot?.(msg.byId, msg.victimId, msg, msg.secs); break;
      /* A refused shot has its own message rather than a flag on S.SHOT: that
         case spends the shell and stuns a victim who is not there. */
      case S.SNAPDENY: this.hooks.onSnapDeny?.(msg.why); break;
      case S.SNAPOPEN: this.hooks.onSnapOpen?.(msg.victimId, msg.byId, msg.secs, msg.voters); break;
      case S.SNAPTALLY: this.hooks.onSnapTally?.(msg.yes, msg.no, msg.need); break;
      case S.SNAPDONE:
        if (msg.exiled) { const p2 = this.players.get(msg.victimId); if (p2) p2.alive = false; }
        this.hooks.onSnapDone?.(msg.victimId, msg.exiled, msg.wasAgent, msg.yes, msg.no);
        break;
      case S.BUNKER: this.hooks.onBunker?.(msg.index); break;
      case S.SPEAKER: this.hooks.onSpeaker?.(msg.x, msg.z, msg.secs); break;
      case S.CHAFF: this.hooks.onChaff?.(msg.secs); break;
      case S.SAVED: this.hooks.onSaved?.(msg.victimId); break;
      case S.FIXPROGRESS:
        if (this.sabotage) { this.sabotage.done = msg.done; this.sabotage.need = msg.need; }
        this.hooks.onFixProgress?.(msg.kind, msg.done, msg.need);
        break;
      case S.FIXED: this.sabotage = null; this.hooks.onFixed?.(msg.kind, msg.cooldown || 0, msg.why); break;
      case S.OVER: this.over = msg; this.hooks.onOver?.(msg.winner, msg.agents, msg.reason); break;
      case S.KICK: this.hooks.onKick?.(msg.reason); break;
      default: break;
    }
  }
}

/* ---------- helpers ---------- */
function r2(v) { return Math.round(v * 100) / 100; }

function sanitiseName(n) {
  const s = String(n || '').toUpperCase().replace(/[^A-Z0-9 .'-]/g, '').trim().slice(0, 12);
  return s || 'CASTAWAY';
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
