/* ===========================================================
   mpgame.js — Illic Isle: Castaways.

   Reuses the whole single-player world — same island, same props,
   same renderer, same pixel interface — and swaps the story logic
   for a session. The host runs HostSession (the rules); everyone,
   host included, renders from a MirrorSession-shaped view so there
   is only one drawing path.
   =========================================================== */

import * as THREE from 'three';
import { Game } from '../game.js';
import { Net, Ticker, makeRoomCode } from '../net/net.js';
import { C, S, PHASE, ROLE, COLOURS } from '../net/protocol.js';
import { HostSession, MirrorSession } from './session.js';
import { Avatar, Body, colourHex } from './avatar.js';
import { TASK_DEFS, SABOTAGE_DEFS, taskById } from './tasks.js';
import { TaskFx } from './taskfx.js';
import { heightAt, ISLAND } from '../world/terrain.js';
import { setTime } from '../lib/ps1.js';
import { setCinemaBars } from '../lib/cutscene.js';
import { LANDMARKS } from '../world/props.js';

const now = () => performance.now() / 1000;

export class MPGame extends Game {
  constructor(canvas) {
    super(canvas);
    this.mp = {
      active: false,
      net: null,
      host: null,          // HostSession when we are the host
      view: new MirrorSession(),   // what we render from, host included
      room: null,
      myName: 'CASTAWAY',
      avatars: new Map(),  // id -> Avatar
      bodies: new Map(),   // id -> Body
      sites: {},           // taskId -> {x,y,z}
      chat: [],
      taskProgress: null,  // { taskId, t, secs }
      killTarget: null,
      reportTarget: null,
      notice: '',
      noticeT: 0,
    };
    this.moveTick = new Ticker(12);
    this.mp.snapTick = new Ticker(12);
  }

  /* ===========================================================
     CONNECTION
     =========================================================== */
  async hostGame(name, room) {
    const M = this.mp;
    M.myName = name;
    M.room = room || makeRoomCode();
    M.net = new Net();
    M.net.onStatus = (t) => this.screens.top && (this.screens.top.status = t);
    M.net.onHostGone = () => {};
    await M.net.host(M.room);

    M.host = new HostSession(M.net, {
      onRoster: (list) => this._roster(list),
      onPhase: (p, secs, meta) => this._phase(p, secs, meta),
      onLocalRole: (card) => M.view.handle(card),
      onTasks: (d, t) => { M.view.tasksDone = d; M.view.tasksTotal = t; },
      onTaskOk: (id) => { M.view.doneTasks.add(id); this._taskDone(id); },
      onCooldown: (secs) => { M.myKillReady = now() + secs; },
      onKilled: (id, x, y, z) => this._onKilled(id, x, y, z),
      onCouncil: (by, body) => this._onCouncil(by, body),
      onVotes: (counts, voted) => { M.view.votes = { counts, voted }; },
      onExile: (id, wasAgent) => this._onExile({ targetId: id, wasAgent, reveal: M.host.settings.revealOnExile }),
      onChat: (m) => this._onChat(m),
      onSabotage: (k, s2, f) => this._onSabotage(k, s2, f),
      onFixed: (k) => { M.view.sabotage = null; this._notice('REPAIRED'); this._applySabotage(k, false); },
      onOver: (w, a, r) => this._onOver(w, a, r),
      onEvent: (e) => { if (e.kind === 'left') this._notice(`${e.name} LEFT`); },
    });
    M.host.addLocal(name);
    M.view.selfId = 'host';
    M.host._roster();
    M.active = true;

    /* The rules run on a timer, not on frames. Browsers throttle animation
       to nothing in a hidden tab, and if the host alt-tabs, every other
       player would freeze mid-round waiting on a clock that had stopped.
       setInterval is throttled too, but only to about once a second, and
       phase changes are decided against the wall clock anyway. */
    clearInterval(M.hostTimer);
    M.hostTimer = setInterval(() => {
      if (!M.host) return;
      const t = now();
      const dt = Math.min(1, t - (M.hostLast || t));
      M.hostLast = t;
      M.host.update(dt);
      if (M.snapTick.ready(dt)) this._applySnapshot({ p: M.host.snapshot() });
    }, 200);
    return M.room;
  }

  async joinGame(name, room) {
    const M = this.mp;
    M.myName = name;
    M.room = room;
    M.net = new Net();
    M.net.onStatus = (t) => this.screens.top && (this.screens.top.status = t);
    M.net.onMessage = (msg) => this._clientMsg(msg);
    M.net.onHostGone = () => {
      this._notice('THE HOST LEFT');
      this.screens.replace('mpEnd', { winner: null, reason: 'THE HOST LEFT THE ISLAND', agents: [] });
    };
    await M.net.join(room);
    M.net.sendHost({ t: C.HELLO, name });
    M.active = true;
    return room;
  }

  _clientMsg(msg) {
    const M = this.mp;
    M.view.handle(msg);
    switch (msg.t) {
      case S.ROSTER: this._roster([...M.view.players.values()]); break;
      case S.PHASE: this._phase(msg.phase, msg.endsAt, msg.meta); break;
      case S.SNAPSHOT: this._applySnapshot(msg); break;
      case S.KILLED: this._onKilled(msg.victimId, msg.x, msg.y, msg.z); break;
      case S.COUNCIL: this._onCouncil(msg.calledBy, msg.bodyOf); break;
      case S.CHAT: this._onChat(msg); break;
      case S.EXILE: this._onExile(msg); break;
      case S.SABOTAGE: this._onSabotage(msg.kind, msg.secs, msg.fatal); break;
      case S.FIXED: this._notice('REPAIRED'); this._applySabotage(msg.kind, false); break;
      case S.TASK_OK: this._taskDone(msg.taskId); break;
      case S.COOLDOWN: M.myKillReady = now() + (msg.secs || 0); break;
      case S.OVER: this._onOver(msg.winner, msg.agents, msg.reason); break;
      case S.KICK:
        this._notice(msg.reason);
        this.screens.replace('mpEnd', { winner: null, reason: msg.reason, agents: [] });
        break;
      default: break;
    }
  }

  get isHost() { return !!this.mp.host; }
  get me() { return this.mp.view.players.get(this.mp.view.selfId); }
  get myRole() { return this.mp.view.role; }
  get amAgent() { return this.mp.view.role === ROLE.AGENT; }
  get amAlive() {
    const m = this.me;
    return m ? m.alive !== false : true;
  }

  /* ===========================================================
     ROSTER / AVATARS
     =========================================================== */
  _roster(list) {
    const M = this.mp;
    const seen = new Set();
    for (const r of list) {
      seen.add(r.id);
      const rec = M.view.players.get(r.id) || {};
      Object.assign(rec, r);
      M.view.players.set(r.id, rec);
      if (r.id === M.view.selfId) continue;
      let av = M.avatars.get(r.id);
      if (!av && this.islandScene) {
        av = new Avatar(this.islandScene, this.propMats, r);
        M.avatars.set(r.id, av);
      } else if (av) av.setRecord(r);
    }
    for (const [id, av] of M.avatars) {
      if (!seen.has(id)) { av.dispose(); M.avatars.delete(id); }
    }
  }

  _applySnapshot(msg) {
    const M = this.mp;
    const t = now();
    for (const [id, x, y, z, yaw, anim, alive] of msg.p) {
      if (id === M.view.selfId) continue;
      const av = M.avatars.get(id);
      if (av) { av.push(t, x, y, z, yaw, anim); av.alive = !!alive; }
    }
  }

  /* ===========================================================
     PHASES
     =========================================================== */
  _phase(phase, secs, meta) {
    const M = this.mp;
    M.view.phase = phase;
    M.view.phaseEndsAt = secs ? now() + secs : 0;
    M.view.phaseTotal = secs || 0;

    if (phase === PHASE.REVEAL) {
      if (!M.started) { M.started = true; this.startCastaways(); }
      this._teleportToCamp();
      this._briefing();
    } else if (phase === PHASE.ROAM) {
      // if the briefing is still running on a slow machine, cut it here —
      // everyone else is already ashore
      if (this.state === 'cutscene') this.skipCutscene();
      this.paused = false;
      this.state = 'island';
      this.scene = this.islandScene;
      setCinemaBars(false);
      this.screens.clear();
      this.ui.show();
      this._requestLock();
    } else if (phase === PHASE.COUNCIL || phase === PHASE.VOTE) {
      this._teleportToCamp();
      document.exitPointerLock?.();
      if (this.screens.name !== 'mpCouncil') this.screens.replace('mpCouncil', {});
    } else if (phase === PHASE.RESULT) {
      // the exile card is pushed by _onExile
    }
  }

  /**
   * The opening. Everyone gets the same flight over the island and the
   * same rules, then their own card — and crucially it runs for the same
   * number of seconds whichever card you are holding. A briefing that ran
   * long for the Agents would name them before anybody said a word.
   */
  _briefing() {
    const camp = this.spawn;
    const wreck = this.wreckPos || camp;
    const pend = this.interactables.find((i) => i.kind === 'pendulum');
    const temple = this.templeDoorPos;
    const hut = this.hutPos || camp;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const over = (p, h, r, a) => V(p.x + Math.cos(a) * r, heightAt(p.x, p.z) + h, p.z + Math.sin(a) * r);
    const at = (p, h = 1.5) => V(p.x, heightAt(p.x, p.z) + h, p.z);

    // the title menu is still on the stack at this point and would be
    // drawn straight over the top of the flight
    this.screens.clear();
    this.playCutscene({
      shots: [
        { // the island, from out at sea
          dur: 3.0, ease: 'smooth',
          from: over(wreck, 44, 120, 1.1), to: over(wreck, 26, 74, 1.5),
          look: at(camp, 6),
        },
        { // down onto the camp, where you all wake up
          dur: 3.0, ease: 'smooth',
          from: over(camp, 16, 30, 2.4), to: over(camp, 4.5, 11, 2.9),
          look: at(camp, 1.4),
        },
        { // the work: a pendulum, turning over
          dur: 3.2, ease: 'smooth',
          from: pend ? over(pend, 5, 22, 0.6) : over(hut, 6, 20, 0.6),
          to: pend ? over(pend, 13, 11, 1.3) : over(hut, 8, 10, 1.3),
          look: pend ? at(pend, 8) : at(hut, 4),
        },
        { // somewhere to be alone with somebody
          dur: 3.0, ease: 'smooth', shake: 0.05,
          from: over(hut, 3.2, 17, 3.6), to: over(hut, 2.4, 7.5, 4.2),
          look: at(hut, 2.6),
        },
        { // and the temple watching all of it
          dur: 3.0, ease: 'smooth',
          from: over(temple, 20, 46, 2.2), to: over(temple, 34, 26, 1.6),
          look: at(temple, 8),
        },
        { // back to the fire, where the arguing happens
          dur: 3.0, ease: 'smooth',
          from: over(camp, 12, 22, 5.4), to: over(camp, 4.6, 10, 5.9),
          look: at(camp, 1.2),
        },
        { // held, so the card that lands on top has a still frame under it
          dur: 5.0, ease: 'linear',
          from: over(camp, 4.6, 10, 5.9), to: over(camp, 4.4, 9.4, 6.05),
          look: at(camp, 1.2),
        },
      ],
      text: [
        { at: 0.4, until: 3.2, text: 'ILLIC ISLE - CASTAWAYS' },
        { at: 3.6, until: 6.4, text: 'You all washed up together.\nSome of you did not come here to be rescued.' },
        { at: 7.0, until: 9.8, text: 'CASTAWAYS: walk your list and finish the work.\nFill the bar and you all get off this island.' },
        { at: 10.2, until: 13.0, text: 'ROGUE AGENTS: cut them down one at a time.\nJam the island when it suits you.' },
        { at: 12.8, until: 15.4, text: 'Find a body, or ring the bell at the camp.' },
        { at: 15.8, until: 17.4, text: 'Then everyone talks, and somebody goes in the sea.' },
      ],
      events: [
        { at: 0.2, fn: () => this.audio.playMusic('island') },
        { at: 3.5, fn: () => this.audio.sfx('surfWash') },
        { at: 7.0, fn: () => this.audio.sfx('page') },
        { at: 10.2, fn: () => this.audio.sfx('stinger') },
        { at: 12.8, fn: () => this.audio.sfx('door') },
        { at: 15.8, fn: () => this.audio.sfx('rumble') },
        /* The card comes up over the last shot rather than after it. Hanging
           it off the phase timer meant a slow machine could spend the whole
           reveal on the flight and never show anybody what they were. */
        { at: 17.6, fn: () => { if (this.mp.view.phase === PHASE.REVEAL) this.screens.replace('mpRole', {}); } },
      ],
      onDone: () => {
        setCinemaBars(false);
        this.state = 'island';
        this.scene = this.islandScene;
        // whatever is left of the reveal is theirs to sit with the card
        if (this.mp.view.phase === PHASE.REVEAL) {
          if (this.screens.name !== 'mpRole') this.screens.replace('mpRole', {});
        } else { this.screens.clear(); this.ui.show(); this._requestLock(); }
      },
    }, this.islandScene);
  }

  _teleportToCamp() {
    const M = this.mp;
    const c = this.spawn;
    const ids = [...M.view.players.keys()];
    const i = Math.max(0, ids.indexOf(M.view.selfId));
    const n = Math.max(1, ids.length);

    // one seat per player around the fire, and never inside the wreck
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = (i / n) * Math.PI * 2 + attempt * 0.5;
      const r = 5 + attempt * 1.6;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const w = this.wreckPos;
      if (w && Math.hypot(x - w.x, z - w.z) < 9) continue;
      if (heightAt(x, z) < 0.4) continue;                 // not in the sea
      this.player.teleport(x, heightAt(x, z) + 0.6, z, Math.atan2(c.x - x, c.z - z));
      return;
    }
    this.player.teleport(c.x, Math.max(heightAt(c.x, c.z), 0.6) + 0.6, c.z, 0);
  }

  _onKilled(id, x, y, z) {
    const M = this.mp;
    const rec = M.view.players.get(id) || { id, colour: 'red', name: '?' };
    if (!M.bodies.has(id) && this.islandScene) {
      M.bodies.set(id, new Body(this.islandScene, this.propMats, rec, x, y, z));
    }
    const av = M.avatars.get(id);
    if (av) av.setVisible(false);
    if (id === M.view.selfId) {
      this._notice('YOU WERE KILLED');
      this.audio.sfx('hurt');
      this.ui.hud.data.hp = 0;
    } else {
      this.audio.sfx('splat');
    }
  }

  _clearBodies() {
    for (const b of this.mp.bodies.values()) b.dispose();
    this.mp.bodies.clear();
    for (const av of this.mp.avatars.values()) {
      const rec = this.mp.view.players.get(av.id);
      av.setVisible(!rec || rec.alive !== false ? true : false);
    }
  }

  _onCouncil(byId, bodyOf) {
    this._clearBodies();
    this.mp.chat.length = 0;
    const M = this.mp;
    const by = M.view.players.get(byId);
    const of = bodyOf ? M.view.players.get(bodyOf) : null;
    this.mp.councilHeader = of
      ? `${(by?.name) || '?'} FOUND ${(of?.name) || '?'}`
      : `${(by?.name) || '?'} CALLED A COUNCIL`;
    this.audio.sfx('door');
    this.audio.playMusic('temple');
  }

  _onChat(m) {
    this.mp.chat.push(m);
    while (this.mp.chat.length > 40) this.mp.chat.shift();
  }

  _onExile(msg) {
    const M = this.mp;
    const p = msg.targetId ? M.view.players.get(msg.targetId) : null;
    if (p) p.alive = false;
    let line;
    if (!msg.targetId) line = 'NOBODY WAS EXILED';
    else if (!msg.reveal) line = `${p?.name || '?'} WAS THROWN TO THE SEA`;
    else line = `${p?.name || '?'} WAS ${msg.wasAgent ? '' : 'NOT '}A ROGUE AGENT`;
    this.screens.replace('mpExile', { line, wasAgent: msg.wasAgent, targetId: msg.targetId });
    this.audio.sfx(msg.wasAgent ? 'gemHit' : 'deny');
    if (msg.targetId === M.view.selfId) this.ui.hud.data.hp = 0;
  }

  _onSabotage(kind, secs, fatal) {
    const def = SABOTAGE_DEFS[kind];
    this.mp.view.sabotage = { kind, endsAt: now() + secs, fatal };
    this._notice(def ? def.name : 'SABOTAGE');
    this.audio.sfx(fatal ? 'bossIntro' : 'charge');
    this.player.punch?.(0.7);
    this.pipeline.tint.setHex(fatal ? 0xff4030 : 0x4060a0);
    this.pipeline.tintAmt = 0.6;
    this._applySabotage(kind, true);
  }

  /** Sabotages have to be visible from across the island or they are just a timer. */
  _applySabotage(kind, on) {
    if (kind === 'storm' && this.storm) { on ? this.storm.start() : this.storm.stop(); }
    if (kind === 'douse') {
      this.doused = on;
      // every flame on the island, not just a number on the HUD
      for (const t of (this.tikis || [])) {
        if (t.userData.flame) t.userData.flame.visible = !on;
        if (t.userData.light) t.userData.light.intensity = on ? 0 : t.userData.baseIntensity;
      }
      if (this.campfire) {
        if (this.campfire.userData.flames) this.campfire.userData.flames.visible = !on;
        if (this.campfire.userData.light) this.campfire.userData.light.intensity = on ? 0 : 1.8;
      }
      this.audio.sfx(on ? 'deny' : 'confirm');
    }
    if (kind === 'jam') {
      this.jammed = on;
      this.audio.playMusic(on ? 'boss' : 'island');
    }
  }

  _onOver(winner, agents, reason) {
    this.audio.stopMusic();
    this.audio.sfx(winner === 'castaways' ? 'victory' : 'bossDie');
    document.exitPointerLock?.();
    this.screens.replace('mpEnd', { winner, agents, reason });
  }

  /**
   * The payoff for a chore. A line of text on its own reads like filling
   * in a form, so the world answers back: a ring thrown out across the
   * ground, the frame flashing, and the row on the HUD lighting up.
   */
  _taskDone(id) {
    const M = this.mp;
    const def = taskById(id);
    const site = M.sites[id];
    if (site && this.taskFx) {
      this.taskFx.burst(site.x, Math.max(site.y, heightAt(site.x, site.z)), site.z, 0x7ec850);
    }
    this.pipeline.tint.setHex(0x8fe8c8);
    this.pipeline.tintAmt = 0.42;
    this.player.punch?.(0.5);
    M.doneFlash = { id, t: 1.4 };
    this.audio.sfx('gemHit');
    this.audio.sfx('confirm');
    this.ui.showPopup(def ? def.name : 'TASK DONE', 'THAT ONE IS FINISHED', 'task');
    this._compassForTasks();
  }

  _notice(text) {
    this.mp.notice = String(text).toUpperCase();
    this.mp.noticeT = 3;
    this.ui.toast(text, 'jade', 2600);
  }

  /* ===========================================================
     START
     =========================================================== */
  startCastaways() {
    // Reuse the single-player world wholesale, minus the story.
    this.paused = false;
    this.state = 'island';
    this.scene = this.islandScene;
    this.runTime = 0;
    this.clock24 = 0;

    this.player.hp = this.player.maxHp;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    this._teleportToCamp();

    // no chart, no pendulum quest, no temple door in this mode
    this.hasChart = true;
    this.doorSolved = false;
    this.coconutCount = 0;

    this.taskFx = new TaskFx(this.islandScene);
    this._resolveTaskSites();
    this.ui.show();
    this.ui.setObjective('');
    this._requestLock();
  }

  /** Turn task landmark names into world positions. */
  _resolveTaskSites() {
    const M = this.mp;
    const named = {
      camp: this.campfirePos || this.spawn,
      wreck: this.wreckPos,
      hut: this.hutPos,
      temple: this.templeDoorPos,
      rogueSand: this.rogueSandPos,
      // there is no LANDMARKS entry for the grove; it is wherever the
      // coconut piles were actually scattered, which is the thing players
      // will walk to anyway.
      grove: this.coconutPiles?.[0] || LANDMARKS.lagoon,
      lagoon: LANDMARKS.lagoon,
    };
    const pend = this.interactables.filter((i) => i.kind === 'pendulum');
    pend.forEach((p, i) => { named['pend' + (i + 1)] = { x: p.x, z: p.z }; });
    for (const it of this.interactables) {
      if (it.kind === 'relic') named[it.relic] = { x: it.x, z: it.z };
    }
    M.named = named;

    M.sites = {};
    for (const t of TASK_DEFS) {
      const n = named[t.at];
      if (!n) continue;
      M.sites[t.id] = { x: n.x, z: n.z, y: heightAt(n.x, n.z) };
    }
    this._compassForTasks();
  }

  /** Your own chores get compass ticks. Nobody else's do. */
  _compassForTasks() {
    const M = this.mp;
    const bell = this.campPos || this.spawn;
    const pois = [{ label: 'BELL', x: bell.x, z: bell.z, kind: 'poi' }];
    for (const id of M.view.tasks) {
      const site = M.sites[id];
      if (!site) continue;
      pois.push({
        label: '', x: site.x, z: site.z, kind: 'job',
        hidden: M.view.doneTasks.has(id),
      });
    }
    this._taskPois = pois;
    this.ui.setCompassPois(pois);
  }

  /* ===========================================================
     INTERACTION — replaces the single-player quest actions
     =========================================================== */
  nearestInteractable() {
    if (!this.mp.active) return super.nearestInteractable();
    const M = this.mp;
    if (M.view.phase !== PHASE.ROAM) return null;
    const p = this.player.pos;
    let best = null, bestD = Infinity;

    if (this.amAlive) {
      // a body to report
      for (const b of M.bodies.values()) {
        const d = Math.hypot(p.x - b.mesh.position.x, p.z - b.mesh.position.z);
        if (d < 4.0 && d < bestD) {
          bestD = d;
          best = { kind: 'mpReport', bodyId: b.id, prompt: `REPORT ${b.name}` };
        }
      }
      /* The bell hangs at the camp, not at the spawn point — the spawn is
         four metres from the wreck, so a bell there sat on top of the two
         chores that live in the hull and neither could ever be reached. */
      const bell = this.campPos || this.spawn;
      const dc = Math.hypot(p.x - bell.x, p.z - bell.z);
      if (dc < 3.4 && dc < bestD && (this.me?.emergencies ?? 1) > 0) {
        bestD = dc;
        best = { kind: 'mpBell', prompt: 'CALL A COUNCIL' };
      }
    }

    /* Your own chores outrank everything. Whatever else is underfoot, the
       thing you came here to do is the thing E should be offering. */
    let taskD = Infinity, taskBest = null;
    for (const id of M.view.tasks) {
      if (M.view.doneTasks.has(id)) continue;
      const site = M.sites[id];
      if (!site) continue;
      const d = Math.hypot(p.x - site.x, p.z - site.z);
      if (d < 4.6 && d < taskD) {
        const def = taskById(id);
        taskD = d;
        taskBest = { kind: 'mpTask', taskId: id, prompt: def ? def.name : 'DO THE TASK' };
      }
    }
    if (taskBest) { bestD = taskD; best = taskBest; }

    // sabotage repair
    const sab = M.view.sabotage;
    if (sab && this.amAlive) {
      const def = SABOTAGE_DEFS[sab.kind];
      for (const at of (def?.fixAt || [])) {
        const site = this._namedSite(at);
        if (!site) continue;
        const d = Math.hypot(p.x - site.x, p.z - site.z);
        if (d < 4.5 && d < bestD) { bestD = d; best = { kind: 'mpFix', fix: sab.kind, prompt: 'REPAIR' }; }
      }
    }
    return best;
  }

  _namedSite(at) {
    const n = this.mp.named?.[at];
    return n ? { x: n.x, z: n.z } : null;
  }

  interact() {
    if (!this.mp.active) return super.interact();
    if (this.screens.open || this.paused) return;
    const it = this.nearestInteractable();
    if (!it) return;
    const M = this.mp;

    switch (it.kind) {
      case 'mpTask': {
        const def = taskById(it.taskId);
        M.taskProgress = {
          taskId: it.taskId, t: 0, secs: def ? def.secs : 3, verb: def?.verb || 'WORKING',
          name: def ? def.name : 'THE TASK',
          x: this.player.pos.x, z: this.player.pos.z,
        };
        this.player.playThrow();
        this.audio.sfx('charge');
        break;
      }
      case 'mpReport': this._send({ t: C.REPORT, bodyId: it.bodyId }); break;
      case 'mpBell': this._send({ t: C.REPORT, bodyId: null }); break;
      case 'mpFix': this._send({ t: C.FIX, kind: it.fix }); break;
      default: break;
    }
  }

  /** Agents strike with the same button they'd throw a coconut with. */
  tryKill() {
    const M = this.mp;
    if (!this.amAgent || !this.amAlive || M.view.phase !== PHASE.ROAM) return;
    if (M.myKillReady && now() < M.myKillReady) return;
    const target = this._nearestVictim();
    if (!target) return;
    this._send({ t: C.KILL, targetId: target.id });
    this.player.playThrow();
  }

  _nearestVictim() {
    const M = this.mp;
    const p = this.player.pos;
    let best = null, bestD = 3.2;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      const d = Math.hypot(p.x - av.pos.x, p.z - av.pos.z);
      if (d < bestD) { bestD = d; best = av; }
    }
    return best;
  }

  _send(msg) {
    const M = this.mp;
    if (this.isHost) M.host._recv(msg, 'host');
    else M.net.sendHost(msg);
  }

  /* The base game hangs a coconut throw off the left button. In Castaways
     that same button is the knife, so the hook is taken over rather than
     the event plumbing duplicated. */
  throwCoconut() {
    if (!this.mp.active) return super.throwCoconut();
    this.tryKill();
  }

  /**
   * There is no quest journal in Castaways — there is no quest. Tab is
   * worth more as a second binding for the chart, which is the one thing
   * you actually want to check mid-round.
   */
  toggleJournal() {
    if (!this.mp.active) return super.toggleJournal();
    this.openChart();
  }

  /** The chart, with your own chores on it instead of the pendulum hunt. */
  openChart() {
    if (!this.mp.active) return super.openChart();
    if (this.screens.name === 'chart') { this.screens.pop(); this.afterOverlayClose(); return; }
    if (!this.mp.started) { this.audio.sfx('deny'); return; }
    const M = this.mp;
    const jobs = M.view.tasks
      .map((id) => ({ id, site: M.sites[id], done: M.view.doneTasks.has(id) }))
      .filter((j) => j.site);
    const left = jobs.filter((j) => !j.done).length;
    this.audio.sfx('page');
    this.screens.push('chart', {
      subtitle: this.amAgent
        ? 'THE LIST IS A COVER. WALK IT ANYWAY.'
        : (left ? `${left} STILL TO DO` : 'YOUR WORK IS DONE'),
      data: {
        heightAt, radius: ISLAND.shore + 14,
        marks: [],
        jobs: jobs.map((j) => ({ x: j.site.x, z: j.site.z, done: j.done })),
        temple: this.templeDoorPos,
        player: this.player.pos,
        wreck: this.wreckPos,
        rogue: this.rogueSandPos,
        hut: this.hutPos,
        relics: [],
        others: [...M.avatars.values()]
          .filter((a) => (M.view.players.get(a.id)?.alive !== false) && !this.amAlive)
          .map((a) => ({ x: a.pos.x, z: a.pos.z, colour: colourHex(a.colour) })),
      },
    });
    document.exitPointerLock?.();
  }

  _key(e, down) {
    const M = this.mp;
    // Q toggles: pressing it again on the wheel should put it away
    if (M.active && down && e.code === 'KeyQ' && this.screens.name === 'mpSabotage') {
      this.screens.pop();
      this.afterOverlayClose();
      return;
    }
    if (M.active && down && !this.screens.open && this.playing) {
      if (e.code === 'KeyQ') {
        /* Push first, release the pointer second. pointerlockchange fires on
           its own task and the auto-pause it triggers checks whether an
           overlay is open — if the screen is not on the stack yet, the game
           pauses instead and the wheel appears not to open at all. */
        if (!this.amAgent) this.ui.toast('ONLY ROGUE AGENTS SABOTAGE', 'bad', 1400);
        else if (!this.amAlive) this.ui.toast('THE DEAD DO NOTHING', 'bad', 1400);
        else if (M.view.phase !== PHASE.ROAM) this.audio.sfx('deny');
        else if (M.view.sabotage) this.ui.toast('ONE AT A TIME', 'bad', 1400);
        else {
          this.screens.push('mpSabotage');
          document.exitPointerLock?.();
          return;
        }
        this.audio.sfx('deny');
        return;
      }
    }
    return super._key(e, down);
  }

  sendChat(text) { this._send({ t: C.CHAT, text }); }
  sendVote(targetId) { this._send({ t: C.VOTE, targetId }); this.audio.sfx('confirm'); }
  sendReady(on) { this._send({ t: C.READY, ready: !!on }); this.audio.sfx(on ? 'confirm' : 'select'); }
  sendSabotage(kind) { this._send({ t: C.SABOTAGE, kind }); this.audio.sfx('charge'); }
  startMatch() { if (this.isHost) this.mp.host.start(); }

  /* ===========================================================
     LOOP
     =========================================================== */
  update(dt) {
    if (!this.mp.active) return super.update(dt);
    const M = this.mp;

    this.time += dt;
    setTime(this.time);
    if (this.pipeline.tintAmt > 0) this.pipeline.tintAmt = Math.max(0, this.pipeline.tintAmt - dt * 1.4);
    if (M.noticeT > 0) M.noticeT -= dt;

    if (this.isHost) {
      // the rules and the snapshot ticker run on M.hostTimer; all this loop
      // owes them is the host's own position
      const hp = M.host.players.get('host');
      if (hp) {
        hp.x = this.player.pos.x; hp.y = this.player.pos.y; hp.z = this.player.pos.z;
        hp.yaw = this.player.facing;
      }
      // mirror the host's own truth into the view we render from
      M.view.phase = M.host.phase;
      M.view.tasksDone = M.host.tasksDone;
      M.view.tasksTotal = M.host.tasksTotal;
      M.view.sabotage = M.host.sabotage
        ? { kind: M.host.sabotage.kind, endsAt: M.host.sabotage.endsAt, fatal: M.host.sabotage.fatal }
        : null;
      const meRec = M.host.players.get('host');
      if (meRec) {
        const mv = M.view.players.get('host');
        if (mv) { mv.alive = meRec.alive; mv.emergencies = meRec.emergencies; }
        M.view.role = meRec.role || M.view.role;
        M.myKillReady = meRec.killReady;
      }
    }

    if (this.state === 'cutscene') {
      this.updateCutscene(dt);
      this.ui.hud.data.mp = null;
      return;
    }

    const inPlay = M.view.phase === PHASE.ROAM;
    const frozen = this.paused || this.screens.open || !inPlay;

    if (!frozen) {
      this.player.update(dt, this.input, { groundOf: heightAt, water: true, bounds: true });
      if (this.moveTick.ready(dt) && !this.isHost) {
        this._send({
          t: C.MOVE,
          x: +this.player.pos.x.toFixed(2), y: +this.player.pos.y.toFixed(2),
          z: +this.player.pos.z.toFixed(2), yaw: +this.player.facing.toFixed(2), anim: 0,
        });
      }
      this.runTime += dt;
    } else {
      this.player.updateCamera(dt, heightAt);
    }

    // task hold
    if (M.taskProgress) {
      const tp = M.taskProgress;
      const moved = Math.hypot(this.player.pos.x - tp.x, this.player.pos.z - tp.z) > 1.6;
      if (moved || !inPlay || !this.amAlive) {
        M.taskProgress = null;
        this.audio.sfx('deny');
        this.ui.toast('YOU MOVED - START AGAIN', 'bad', 1400);
      }
      else {
        tp.t += dt;
        if (tp.t >= tp.secs) {
          this._send({ t: C.DO_TASK, taskId: tp.taskId });
          M.taskProgress = null;
          this.audio.sfx('pickup');
        }
      }
    }

    if (M.doneFlash) { M.doneFlash.t -= dt; if (M.doneFlash.t <= 0) M.doneFlash = null; }
    this.taskFx?.update(dt);

    // world + avatars
    this.tickIslandWorld(dt);
    this.updateDayNight(dt);
    const t = now();
    const ghost = !this.amAlive;
    for (const av of M.avatars.values()) {
      av.update(dt, t);
      // the dead can see the dead; the living cannot
      const rec = M.view.players.get(av.id);
      av.setVisible(rec ? (rec.alive !== false || ghost) : true);
    }

    // HUD
    this._mpHud();
    if (M.taskProgress) {
      this.ui.setPrompt(null);
    } else {
      const it = frozen ? null : this.nearestInteractable();
      this.ui.setPrompt(it ? it.prompt : (this._killPrompt() || null));
    }
  }

  _killPrompt() {
    if (!this.amAgent || !this.amAlive) return null;
    if (this.mp.view.phase !== PHASE.ROAM) return null;
    const ready = !this.mp.myKillReady || now() >= this.mp.myKillReady;
    if (!ready) return null;
    return this._nearestVictim() ? 'CLICK TO STRIKE' : null;
  }

  /**
   * Name tags are projected here rather than drawn as sprites, because a
   * sprite would be filtered and lit like part of the world. Projecting to
   * HUD pixels keeps the letters on the same hard grid as the rest of the
   * interface.
   */
  _tags() {
    const M = this.mp;
    const out = [];
    if (M.view.phase !== PHASE.ROAM) return out;
    const cam = this.camera;
    const W = this.ui.hud.c.width, H = this.ui.hud.c.height;
    const v = this._tagVec || (this._tagVec = new THREE.Vector3());
    const eye = cam.position;

    const add = (obj, name, colour, dead) => {
      v.set(obj.position.x, obj.position.y + (dead ? 0.9 : 2.15), obj.position.z);
      const dist = v.distanceTo(eye);
      if (dist > 34) return;
      v.project(cam);
      if (v.z > 1 || v.z < -1) return;
      out.push({
        x: Math.round((v.x * 0.5 + 0.5) * W),
        y: Math.round((-v.y * 0.5 + 0.5) * H),
        name, colour, dead,
        fade: dist > 26 ? 1 - (dist - 26) / 8 : 1,
      });
    };

    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      if (!av.mesh.visible) continue;
      add(av.mesh, rec.name || '?', colourHex(rec.colour), false);
    }
    for (const b of M.bodies.values()) add(b.mesh, 'BODY', 0xb03a2e, true);
    return out;
  }

  _mpHud() {
    const M = this.mp;
    const h = this.ui.hud.data;
    // In the lobby and on the results card there is no world behind the
    // panel worth annotating, and a half-drawn HUD leaking out from under
    // a full-screen menu just looks broken.
    // Only while you are actually out there. Every other phase is a
    // full-screen card, and a HUD bleeding out from under it looks broken.
    if (!M.started || M.view.phase !== PHASE.ROAM) {
      h.visible = false; h.mp = null;
      return;
    }
    h.visible = true;
    h.mp = {
      role: M.view.role,
      alive: this.amAlive,
      tasksDone: M.view.tasksDone,
      tasksTotal: M.view.tasksTotal,
      myTasks: M.view.tasks.map((id) => ({
        id, name: taskById(id)?.name || id, done: M.view.doneTasks.has(id),
      })),
      killIn: this.amAgent && M.myKillReady ? Math.max(0, M.myKillReady - now()) : 0,
      sabotage: M.view.sabotage
        ? { name: SABOTAGE_DEFS[M.view.sabotage.kind]?.name || '', left: Math.max(0, M.view.sabotage.endsAt - now()), fatal: M.view.sabotage.fatal }
        : null,
      task: M.taskProgress
        ? { verb: M.taskProgress.verb, name: M.taskProgress.name, k: M.taskProgress.t / M.taskProgress.secs }
        : null,
      flash: M.doneFlash ? M.doneFlash.id : null,
      players: [...M.view.players.values()],
      selfId: M.view.selfId,
      tags: this._tags(),
      phase: M.view.phase,
    };
    this.ui.setHearts(this.amAlive ? 1 : 0, 1);
    this.ui.setTimer(this.runTime);
    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);
    this.ui.setStamina(this.player.stamina);
  }
}
