/* ===========================================================
   session.js — the rules of Castaways, run by the host.

   Only the host ever executes this. Clients hold a mirror of
   whatever the host tells them (see MirrorSession at the bottom),
   which means there is exactly one copy of the rules and no way
   for two machines to disagree about who is dead.
   =========================================================== */

import { C, S, PHASE, ROLE, COLOURS, DEFAULT_SETTINGS } from '../net/protocol.js';
import { TASK_DEFS, SABOTAGE_DEFS, dealTasks, taskById, taskSteps } from './tasks.js';
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
    this.bodies = [];              // { id, x, y, z }
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
      connected: true, ready: false,
    };
    this.players.set(id, p);
    return p;
  }

  _join(id) {
    if (this.phase !== PHASE.LOBBY) {
      this.net.sendTo(id, { t: S.KICK, reason: 'That game has already started.' });
      return;
    }
    if (this.players.size >= COLOURS.length) {
      this.net.sendTo(id, { t: S.KICK, reason: 'That island is full.' });
      return;
    }
    // the record is created on HELLO so we have their chosen name
    this.net.sendTo(id, { t: S.WELCOME, youAre: id, settings: this.settings });
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
    this.bodies = this.bodies.filter((b) => b.id !== id);
    this._roster();
    this.hooks.onEvent?.({ kind: 'left', name: p.name });
    if (this.phase !== PHASE.LOBBY) this._checkWin();
  }

  _roster() {
    const t = now();
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, colour: p.colour, alive: p.alive, ready: p.ready,
      quiet: !!p.quiet,
      whistle: p.whistleUntil && t < p.whistleUntil ? +(p.whistleUntil - t).toFixed(1) : 0,
      decoy: p.decoy && t < p.decoy.until ? { x: p.decoy.x, z: p.decoy.z } : null,
      shroud: !!(p.shroudUntil && t < p.shroudUntil),
    }));
    this.net.broadcast({ t: S.ROSTER, players: list });
    this.hooks.onRoster?.(list);
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
          break;
        }
        if (!p) { this._add(from, msg.name); this._roster(); }
        break;
      }
      case C.MOVE: {
        if (!p) break;
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.yaw = msg.yaw; p.anim = msg.anim;
        /* Which interior they are standing in, if any. Everyone in the same
           room shares one local coordinate space, so the position above is
           all anybody needs to see them down there. */
        p.room = msg.room | 0;
        break;
      }
      case C.READY: { if (p && p.alive) { p.ready = !!msg.ready; this._roster(); } break; }
      case C.DO_TASK: { this._tryTask(from, msg.taskId); break; }
      case C.KILL: { this._tryKill(from, msg.targetId); break; }
      case C.REPORT: { this._tryReport(from, msg.bodyId); break; }
      case C.VOTE: { this._tryVote(from, msg.targetId); break; }
      case C.CHAT: { this._chat(from, msg.text); break; }
      case C.SABOTAGE: { this._trySabotage(from, msg.kind); break; }
      case C.FIX: { this._tryFix(from, msg.kind, msg.at); break; }
      case C.SHOOT: { this._tryShoot(from, msg.targetId); break; }
      case C.SNAP: { this._trySnap(from, !!msg.yes); break; }
      case C.PURSE: { if (p) p.coins = Math.max(0, msg.coins | 0); break; }
      /* The command table's ledger. It is answered privately and only for
         somebody who is really standing in the bunker, so knowing what
         everybody is carrying stays a thing you have to go and earn. */
      case C.BOUGHT: { this._receipt(from, msg); break; }
      case C.LEDGER: { this._sendLedger(from); break; }
      case C.ASKSTRANGER: { this._askStranger(from); break; }
      case C.PERK: {
        /* Some purchases change what everyone else sees or how the rules
           treat you, so the host has to know about them. */
        if (!p) break;
        if (msg.perk === 'quiet') p.quiet = !!msg.on;
        if (msg.perk === 'vest') p.vest = !!msg.on;
        /* Who has a printer. The host needs this so a receipt goes only
           to the people who paid for one — broadcasting every purchase to
           every client and letting them decide whether to show it would
           put the whole shop ledger on the wire for anybody with a
           console open, which is a deduction game giving itself away. */
        if (msg.perk === 'printer') p.printer = !!msg.on;
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
    for (const id of ids) {
      const p = this.players.get(id);
      p.role = agents.has(id) ? ROLE.AGENT : ROLE.CASTAWAY;
      p.alive = true;
      p.doneTasks = new Set();
      p.emergencies = this.settings.emergencyPerPlayer;
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
    this.sabotage = null;
    this.over = null;
    // which of the four hatches is real this round
    this.bunkerIndex = (this.rng() * 4) | 0;
    this.net.broadcast({ t: S.BUNKER, index: this.bunkerIndex });
    this.hooks.onBunker?.(this.bunkerIndex);

    // private role cards
    const agentNames = [...agents].map((id) => this.players.get(id).name);
    for (const [id, p] of this.players) {
      const card = {
        t: S.ROLE, role: p.role, tasks: p.tasks,
        mates: p.role === ROLE.AGENT ? agentNames : null,
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
    this._checkWin();
  }

  _tryKill(id, targetId) {
    const k = this.players.get(id), v = this.players.get(targetId);
    if (!k || !v || this.phase !== PHASE.ROAM) return;
    if (k.role !== ROLE.AGENT || !k.alive || !v.alive || v.role === ROLE.AGENT) return;
    if (now() < k.killReady) return;
    const d = Math.hypot(k.x - v.x, k.z - v.z);
    if (d > 4.8) return;                       // host validates range, not the client
    // Ferdi's counter is neutral ground while the shop is open
    const shop = this.hooks.siteOf?.('hut');
    if (shop && !this.shopShut) {
      const SANCT = 13;
      if (Math.hypot(v.x - shop.x, v.z - shop.z) < SANCT) return;
      if (Math.hypot(k.x - shop.x, k.z - shop.z) < SANCT) return;
    }

    if (v.vest) {
      /* A cork vest takes the strike. The knife still goes cold, and the
         Agent is left standing over somebody who is very much alive. */
      v.vest = false;
      k.killReady = now() + this.settings.killCooldown;
      this._sendCooldown(k);
      this.net.broadcast({ t: S.SAVED, victimId: v.id });
      this.hooks.onSaved?.(v.id);
      this._roster();
      return;
    }
    v.alive = false;
    k.killReady = now() + this.settings.killCooldown;
    this._sendCooldown(k);

    /* What they were carrying goes on the ground, and the Agent takes
       three quarters of it off the body. Killing a Castaway who has been
       working all round is now worth something beyond the kill. */
    const purse = Math.max(0, v.coins | 0);
    if (purse > 0) {
      const taken = Math.floor(purse * 0.75);
      const left = purse - taken;
      v.coins = 0;
      if (taken > 0) {
        k.coins = (k.coins | 0) + taken;
        if (k.id === 'host') this.hooks.onPurse?.(k.coins, taken);
        else this.net.sendTo(k.id, { t: S.PURSE, coins: k.coins, gained: taken });
      }
      if (left > 0) {
        this.net.broadcast({ t: S.DROP, x: v.x, y: v.y, z: v.z, coins: left, id: v.id });
        this.hooks.onDrop?.(v.x, v.y, v.z, left, v.id);
      }
    }
    this.bodies.push({ id: v.id, x: v.x, y: v.y, z: v.z });
    /* Remember who was standing nearby. The Stranger trades in exactly this
       sort of thing — not who did it, just who was close enough to have. */
    this._markNearBody(v.x, v.z, v.id);
    this.net.broadcast({ t: S.KILLED, victimId: v.id, x: v.x, y: v.y, z: v.z });
    this.hooks.onKilled?.(v.id, v.x, v.y, v.z);
    this._roster();
    this._checkWin();
  }

  /**
   * The flare pistol. It cannot kill; it puts somebody on the sand and
   * calls a vote of whoever was close enough to see it happen. That
   * radius is the whole design — you are asking the people who happen to
   * be standing there, not the island.
   */
  _tryShoot(id, targetId) {
    const k = this.players.get(id), v = this.players.get(targetId);
    if (!k || !v || this.phase !== PHASE.ROAM) return;
    if (!k.alive || !v.alive || this.snap) return;
    if (Math.hypot(k.x - v.x, k.z - v.z) > 34) return;

    const SECS = 14;
    v.stunnedUntil = now() + SECS;
    this.net.broadcast({ t: S.SHOT, byId: id, victimId: targetId, x: v.x, y: v.y, z: v.z, secs: SECS });
    this.hooks.onShot?.(id, targetId, v, SECS);

    // everyone near enough to have seen it gets a say
    const R = 30;
    const voters = [...this.players.values()]
      .filter((p) => p.alive && p.id !== targetId && Math.hypot(p.x - v.x, p.z - v.z) < R)
      .map((p) => p.id);
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
      this.net.broadcast({
        t: S.SNAPDONE, victimId: s2.victimId, exiled: true,
        yes: s2.yes.size, no: s2.no.size, wasAgent: v.role === ROLE.AGENT,
      });
      this.hooks.onSnapDone?.(s2.victimId, true, v.role === ROLE.AGENT);
      this._roster();
      this._checkWin();
    } else {
      this.net.broadcast({ t: S.SNAPDONE, victimId: s2.victimId, exiled: false, yes: s2.yes.size, no: s2.no.size });
      this.hooks.onSnapDone?.(s2.victimId, false, false);
    }
  }

  _tryReport(id, bodyId) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== PHASE.ROAM) return;
    if (this.sabotage?.fatal) return;          // no meetings during a fatal sabotage

    if (bodyId) {
      const b = this.bodies.find((x) => x.id === bodyId);
      if (!b) return;
      if (Math.hypot(p.x - b.x, p.z - b.z) > 4.5) return;
    } else {
      if (p.emergencies <= 0) return;
      p.emergencies--;
    }
    this._openCouncil(id, bodyId || null);
  }

  _openCouncil(byId, bodyOf) {
    this.bodies = [];
    this.votes.clear();
    /* Clearing this silently left every client holding a sabotage that had
       already ended: a countdown stuck on their HUD and, for the agents, a
       sabotage wheel that would never open again. */
    if (this.sabotage) {
      const kind = this.sabotage.kind;
      this.sabotage = null;
      this.net.broadcast({ t: S.FIXED, kind });
      this.hooks.onFixed?.(kind);
    }
    for (const p of this.players.values()) p.ready = false;
    this.council = { calledBy: byId, bodyOf };
    this.net.broadcast({ t: S.COUNCIL, calledBy: byId, bodyOf });
    this._setPhase(PHASE.COUNCIL, this.settings.councilSeconds + this.settings.voteSeconds,
      { calledBy: byId, bodyOf });
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
      if (n > bestN) { best = k; bestN = n; tie = false; }
      else if (n === bestN) tie = true;
    }
    const skips = counts.skip || 0;
    if (best && (bestN > skips) && !tie) {
      const p = this.players.get(best);
      if (p) {
        p.alive = false;
        this.net.broadcast({
          t: S.EXILE, targetId: best, wasAgent: p.role === ROLE.AGENT,
          reveal: this.settings.revealOnExile, name: p.name,
        });
        this.hooks.onExile?.(best, p.role === ROLE.AGENT);
      }
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
        p.killReady = now() + this.settings.killCooldown * 0.6;
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

  /** Answer one player's request for the ledger. Host-side only. */
  /** Who was within a dozen metres when somebody last went down. */
  _markNearBody(x, z, exceptId) {
    for (const q of this.players.values()) {
      if (q.id === exceptId) continue;
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

  _sendLedger(id) {
    const rows = [];
    for (const [pid, pl] of this.players) rows.push([pid, Math.max(0, pl.coins | 0)]);
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
      S2.head += (this.rng() - 0.5) * dt * 2.2;
      S2.waited = 0;
    }
    const SP = watching ? 0 : 26;
    S2.x += Math.sin(S2.head) * SP * dt;
    S2.z += Math.cos(S2.head) * SP * dt;
    const rr = Math.hypot(S2.x, S2.z);
    if (rr > 160) { S2.head += Math.PI; S2.x *= 160 / rr; S2.z *= 160 / rr; }
    // the wire only needs him a few times a second; the net timer paces it
    this.net.broadcast({ t: S.STRANGER, on: true, x: +S2.x.toFixed(1), z: +S2.z.toFixed(1) });
    this.hooks.onStranger?.(true, S2.x, S2.z);
  }

  /** Somebody reached him. One clue, then he is gone for good. */
  _askStranger(id) {
    const S2 = this.stranger;
    const p = this.players.get(id);
    if (!S2 || !p || !p.alive) return;
    if (Math.hypot((p.x || 0) - S2.x, (p.z || 0) - S2.z) > 7) return;

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

    S2.spoken = true;
    if (id === 'host') this.hooks.onRiddle?.(clue.text);
    else this.net.sendTo(id, { t: S.RIDDLE, text: clue.text });
    // and he leaves
    this.stranger = null;
    this.strangerDone = true;
    this.net.broadcast({ t: S.STRANGER, on: false });
    this.hooks.onStranger?.(false, 0, 0);
  }

  _trySabotage(id, kind) {
    const p = this.players.get(id);
    const def = SABOTAGE_DEFS[kind];
    if (!p || !def || p.role !== ROLE.AGENT || !p.alive) return;
    if (this.phase !== PHASE.ROAM || this.sabotage) return;
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
    if (where && Math.hypot(p.x - where.x, p.z - where.z) > 6) return;
    this.sabotage.sites.add(site);
    const need = def.sites || 1;
    this.net.broadcast({ t: S.FIXPROGRESS, kind, done: this.sabotage.sites.size, need });
    this.hooks.onFixProgress?.(kind, this.sabotage.sites.size, need);
    if (this.sabotage.sites.size >= need) {
      this.sabotage = null;
      this.cool = this.cool || {};
      this.cool[kind] = now() + (def.cooldown || 0);
      this.net.broadcast({ t: S.FIXED, kind, cooldown: def.cooldown || 0 });
      this.hooks.onFixed?.(kind, def.cooldown || 0);
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

    this.over = { winner, reason };
    const agentNames = [...this.players.values()]
      .filter((p) => p.role === ROLE.AGENT).map((p) => p.name);
    this.net.broadcast({ t: S.OVER, winner, agents: agentNames, reason });
    this._setPhase(PHASE.OVER, 0);
    this.hooks.onOver?.(winner, agentNames, reason);
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
      this.net.broadcast({ t: S.FIXED, kind, cooldown: cd });
      this.hooks.onFixed?.(kind);
      if (wasFatal && !this.over) {
        this.over = { winner: 'agents', reason: 'THE PENDULUMS STOPPED' };
        const agentNames = [...this.players.values()]
          .filter((p) => p.role === ROLE.AGENT).map((p) => p.name);
        this.net.broadcast({ t: S.OVER, winner: 'agents', agents: agentNames, reason: this.over.reason });
        this._setPhase(PHASE.OVER, 0);
        this.hooks.onOver?.('agents', agentNames, this.over.reason);
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
    this.net.broadcast({ t: S.SNAPSHOT, p: arr });
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
    this.killReadyAt = 0;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  handle(msg) {
    switch (msg.t) {
      case S.WELCOME: this.selfId = msg.youAre; this.settings = msg.settings || this.settings; break;
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
        this.killReadyAt = performance.now() / 1000 + (msg.secs || 0);
        this.hooks.onCooldown?.(msg.secs || 0);
        break;
      case S.TASKS: this.tasksDone = msg.done; this.tasksTotal = msg.total; break;
      case S.TASK_OK:
        if (msg.done === false) this.taskStep.set(msg.taskId, msg.step);
        else this.doneTasks.add(msg.taskId);
        this.hooks.onTaskOk?.(msg.taskId, msg.step, msg.done !== false);
        break;
      case S.KILLED:
        this.bodies.push({ id: msg.victimId, x: msg.x, y: msg.y, z: msg.z });
        this.hooks.onKilled?.(msg.victimId, msg.x, msg.y, msg.z);
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
      case S.FIXED: this.sabotage = null; this.hooks.onFixed?.(msg.kind, msg.cooldown || 0); break;
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
