/* ===========================================================
   session.js — the rules of Castaways, run by the host.

   Only the host ever executes this. Clients hold a mirror of
   whatever the host tells them (see MirrorSession at the bottom),
   which means there is exactly one copy of the rules and no way
   for two machines to disagree about who is dead.
   =========================================================== */

import { C, S, PHASE, ROLE, COLOURS, DEFAULT_SETTINGS } from '../net/protocol.js';
import { TASK_DEFS, SABOTAGE_DEFS, dealTasks, taskById } from './tasks.js';

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
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, colour: p.colour, alive: p.alive, ready: p.ready,
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
        if (!p) { this._add(from, msg.name); this._roster(); }
        break;
      }
      case C.MOVE: {
        if (!p) break;
        p.x = msg.x; p.y = msg.y; p.z = msg.z; p.yaw = msg.yaw; p.anim = msg.anim;
        break;
      }
      case C.READY: {
        if (!p || !p.alive) break;
        p.ready = !!msg.ready;
        this._roster();
        /* Nobody should have to sit out a timer everyone has finished with.
           Once every living player says they are done talking, open the
           ballot immediately. */
        if (this.phase === PHASE.COUNCIL) {
          const alive = [...this.players.values()].filter((x) => x.alive);
          if (alive.length && alive.every((x) => x.ready)) {
            this.votes.clear();
            this._setPhase(PHASE.VOTE, this.settings.voteSeconds);
          }
        }
        break;
      }
      case C.DO_TASK: { this._tryTask(from, msg.taskId); break; }
      case C.KILL: { this._tryKill(from, msg.targetId); break; }
      case C.REPORT: { this._tryReport(from, msg.bodyId); break; }
      case C.VOTE: { this._tryVote(from, msg.targetId); break; }
      case C.CHAT: { this._chat(from, msg.text); break; }
      case C.SABOTAGE: { this._trySabotage(from, msg.kind); break; }
      case C.FIX: { this._tryFix(from, msg.kind); break; }
      default: break;
    }
  }

  /* ---------- start ---------- */
  canStart() {
    return this.players.size >= 3 && this.phase === PHASE.LOBBY;
  }

  start() {
    if (!this.canStart()) return false;
    const ids = [...this.players.keys()];
    // shuffle, deal roles
    for (let i = ids.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const agentCount = Math.max(1, Math.min(this.settings.agents, Math.floor((ids.length - 1) / 2)));
    const agents = new Set(ids.slice(0, agentCount));

    this.tasksDone = 0;
    this.tasksTotal = 0;
    for (const id of ids) {
      const p = this.players.get(id);
      p.role = agents.has(id) ? ROLE.AGENT : ROLE.CASTAWAY;
      p.alive = true;
      p.doneTasks = new Set();
      p.emergencies = this.settings.emergencyPerPlayer;
      p.killReady = now() + this.settings.killCooldown;
      p.tasks = p.role === ROLE.CASTAWAY
        ? dealTasks(this.rng, this.settings.tasksPerPlayer)
        : dealTasks(this.rng, this.settings.tasksPerPlayer);   // agents get a fake list
      if (p.role === ROLE.CASTAWAY) this.tasksTotal += p.tasks.length;
    }
    this.bodies = [];
    this.sabotage = null;
    this.over = null;

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
    for (const p of this.players.values()) this._sendCooldown(p);
    this._roster();
    this._setPhase(PHASE.REVEAL, 26);
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
    if (p.id === 'host') this.hooks.onCooldown?.(secs);
    else this.net.sendTo(p.id, { t: S.COOLDOWN, secs });
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
    if (!p || !p.alive || this.phase !== PHASE.ROAM) return;
    if (!p.tasks.includes(taskId) || p.doneTasks.has(taskId)) return;
    // Agents get a decoy list so they can be seen "doing tasks"; it just
    // never counts toward the bar.
    p.doneTasks.add(taskId);
    if (p.role === ROLE.CASTAWAY) { this.tasksDone++; this._tasks(); }
    if (id === 'host') this.hooks.onTaskOk?.(taskId);
    else this.net.sendTo(id, { t: S.TASK_OK, taskId });
    this._checkWin();
  }

  _tryKill(id, targetId) {
    const k = this.players.get(id), v = this.players.get(targetId);
    if (!k || !v || this.phase !== PHASE.ROAM) return;
    if (k.role !== ROLE.AGENT || !k.alive || !v.alive || v.role === ROLE.AGENT) return;
    if (now() < k.killReady) return;
    const d = Math.hypot(k.x - v.x, k.z - v.z);
    if (d > 3.2) return;                       // host validates range, not the client

    v.alive = false;
    k.killReady = now() + this.settings.killCooldown;
    this._sendCooldown(k);
    this.bodies.push({ id: v.id, x: v.x, y: v.y, z: v.z });
    this.net.broadcast({ t: S.KILLED, victimId: v.id, x: v.x, y: v.y, z: v.z });
    this.hooks.onKilled?.(v.id, v.x, v.y, v.z);
    this._roster();
    this._checkWin();
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
    this._setPhase(PHASE.COUNCIL, this.settings.councilSeconds, { calledBy: byId, bodyOf });
    this.hooks.onCouncil?.(byId, bodyOf);
  }

  _tryVote(id, targetId) {
    const p = this.players.get(id);
    if (!p || !p.alive || this.phase !== PHASE.VOTE) return;
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
    this._setPhase(PHASE.RESULT, 5.5);
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
    }, 5500);
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

  _trySabotage(id, kind) {
    const p = this.players.get(id);
    const def = SABOTAGE_DEFS[kind];
    if (!p || !def || p.role !== ROLE.AGENT || !p.alive) return;
    if (this.phase !== PHASE.ROAM || this.sabotage) return;
    this.sabotage = { kind, endsAt: now() + def.secs, fatal: !!def.fatal, fixers: new Set() };
    this.net.broadcast({ t: S.SABOTAGE, kind, secs: def.secs, fatal: !!def.fatal });
    this.hooks.onSabotage?.(kind, def.secs, !!def.fatal);
  }

  _tryFix(id, kind) {
    const p = this.players.get(id);
    if (!p || !p.alive || !this.sabotage || this.sabotage.kind !== kind) return;
    const def = SABOTAGE_DEFS[kind];
    this.sabotage.fixers.add(id);
    if (this.sabotage.fixers.size >= def.fixers) {
      this.sabotage = null;
      this.net.broadcast({ t: S.FIXED, kind });
      this.hooks.onFixed?.(kind);
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
      else if (this.phase === PHASE.COUNCIL) {
        this.votes.clear();
        for (const p of this.players.values()) p.ready = false;
        this._setPhase(PHASE.VOTE, this.settings.voteSeconds);
      } else if (this.phase === PHASE.VOTE) this._resolveVote();
    }

    // a fatal sabotage that runs out ends the game
    if (this.sabotage && now() >= this.sabotage.endsAt) {
      const wasFatal = this.sabotage.fatal;
      const kind = this.sabotage.kind;
      this.sabotage = null;
      this.net.broadcast({ t: S.FIXED, kind });
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
      arr.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), p.anim | 0, p.alive ? 1 : 0]);
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
      case S.TASK_OK: this.doneTasks.add(msg.taskId); this.hooks.onTaskOk?.(msg.taskId); break;
      case S.KILLED:
        this.bodies.push({ id: msg.victimId, x: msg.x, y: msg.y, z: msg.z });
        this.hooks.onKilled?.(msg.victimId, msg.x, msg.y, msg.z);
        break;
      case S.COUNCIL: this.bodies = []; this.hooks.onCouncil?.(msg.calledBy, msg.bodyOf); break;
      case S.CHAT: this.hooks.onChat?.(msg); break;
      case S.VOTES: this.votes = { counts: msg.counts, voted: msg.voted }; this.hooks.onVotes?.(msg); break;
      case S.EXILE: this.hooks.onExile?.(msg); break;
      case S.SABOTAGE:
        this.sabotage = { kind: msg.kind, endsAt: performance.now() / 1000 + msg.secs, fatal: msg.fatal };
        this.hooks.onSabotage?.(msg.kind, msg.secs, msg.fatal);
        break;
      case S.FIXED: this.sabotage = null; this.hooks.onFixed?.(msg.kind); break;
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
