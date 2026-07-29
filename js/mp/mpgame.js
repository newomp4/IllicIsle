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
import { TASK_DEFS, SABOTAGE_DEFS, TASK_FX, taskById, taskStage, taskSteps } from './tasks.js';
import { TaskFx } from './taskfx.js';
import { Gore } from './gore.js';
import { STOCK, STAGE_PAY, SANCTUARY_R, itemById, stockFor } from './market.js';
import { heightAt, ISLAND } from '../world/terrain.js';
import { setTime } from '../lib/ps1.js';
import { setCinemaBars } from '../lib/cutscene.js';
import { LANDMARKS } from '../world/props.js';

const now = () => performance.now() / 1000;

/** One board for the shutters, built on demand. */
function boxGeo(w, h, d, i) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color: i % 2 ? 0x8a6a3c : 0x6e5330 });
  return new THREE.Mesh(g, m);
}

/** A stable 32-bit seed from a string, so a puzzle looks the same if reopened. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

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
      marked: null,      // whoever your knife is currently on
      cool: {},          // kind -> when it may be pulled again
      finished: false,   // the match is over; stop putting screens back
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
    M.finished = false;
    M.cool = {};
    M.chat.length = 0;
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
      onTaskOk: (id, step, done) => {
        if (done) M.view.doneTasks.add(id); else M.view.taskStep.set(id, step);
        this._taskDone(id, done);
      },
      onCooldown: (secs, grace) => {
        M.myKillReady = now() + secs;
        M.killTotal = Math.max(secs, 0.001);
        if (grace) M.graceEnds = now() + grace;
      },
      onKilled: (id, x, y, z) => this._onKilled(id, x, y, z),
      onSaved: (id) => this._onSaved(id),
      onCouncil: (by, body) => this._onCouncil(by, body),
      onVotes: (counts, voted) => { M.view.votes = { counts, voted }; },
      onExile: (id, wasAgent) => this._onExile({ targetId: id, wasAgent, reveal: M.host.settings.revealOnExile }),
      onChat: (m) => this._onChat(m),
      onSabotage: (k, s2, f, sites) => this._onSabotage(k, s2, f, sites),
      onFixed: (k, cd) => {
        M.view.sabotage = null; this._notice('REPAIRED'); this._applySabotage(k, false);
        if (cd) (M.cool = M.cool || {})[k] = now() + cd;
        this._compassForTasks();
      },
      onFixProgress: (k, d, n) => this._fixProgress(k, d, n),
      siteOf: (at) => this._namedSite(at),
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
    M.finished = false;
    M.cool = {};
    M.chat.length = 0;
    M.myName = name;
    M.room = room;
    M.net = new Net();
    M.net.onStatus = (t) => this.screens.top && (this.screens.top.status = t);
    M.net.onMessage = (msg) => this._clientMsg(msg);
    M.net.onHostGone = () => {
      M.finished = true;
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
      case S.SAVED: this._onSaved(msg.victimId); break;
      case S.COUNCIL: this._onCouncil(msg.calledBy, msg.bodyOf); break;
      case S.CHAT: this._onChat(msg); break;
      case S.EXILE: this._onExile(msg); break;
      case S.SABOTAGE:
        if (msg.refused) { this.ui.toast('THAT ONE IS STILL COOLING', 'bad', 1600); this.audio.sfx('deny'); break; }
        this._onSabotage(msg.kind, msg.secs, msg.fatal, msg.sites);
        break;
      case S.FIXPROGRESS: this._fixProgress(msg.kind, msg.done, msg.need); break;
      case S.FIXED:
        this._notice('REPAIRED'); this._applySabotage(msg.kind, false);
        if (msg.cooldown) (M.cool = M.cool || {})[msg.kind] = now() + msg.cooldown;
        this._compassForTasks();
        break;
      case S.TASK_OK:
        if (!msg.done) M.view.taskStep.set(msg.taskId, msg.step);
        this._taskDone(msg.taskId, msg.done !== false);
        break;
      case S.COOLDOWN:
        M.myKillReady = now() + (msg.secs || 0);
        M.killTotal = Math.max(msg.secs || 0, 0.001);
        if (msg.grace) M.graceEnds = now() + msg.grace;
        break;
      case S.OVER: this._onOver(msg.winner, msg.agents, msg.reason); break;
      case S.KICK:
        M.finished = true;
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
        { /* The work: a Pendulum, turning over. Flown high and pulled back
             — the old path started five metres off the ground twenty-two
             out, which is exactly where the canopy is, and the camera spent
             the shot inside a tree. */
          dur: 3.2, ease: 'smooth',
          from: pend ? over(pend, 26, 30, 0.6) : over(hut, 24, 28, 0.6),
          to: pend ? over(pend, 19, 17, 1.3) : over(hut, 18, 16, 1.3),
          look: pend ? at(pend, 9) : at(hut, 5),
        },
        { // somewhere to be alone with somebody
          dur: 3.0, ease: 'smooth', shake: 0.05,
          from: over(hut, 9, 21, 3.6), to: over(hut, 5.0, 11, 4.2),
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
        { at: 17.6, fn: () => {
          if (this.mp.view.phase !== PHASE.REVEAL) return;
          this.screens.replace('mpRole', {});
          this.audio.sfx('descend');
          setTimeout(() => this.audio.sfx(this.amAgent ? 'bossIntro' : 'idolRise'), 1250);
          setTimeout(() => this.audio.sfx('stinger'), 2050);
        } },
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

  /**
   * Everyone stands round the fire, in their own seat, facing it. This is
   * where you wake up and where every council is held — arriving in a ring
   * of faces is half of what makes a meeting feel like one.
   */
  _teleportToCamp() {
    const M = this.mp;
    const c = this.campfirePos || this.spawn;
    const ids = [...M.view.players.keys()];
    const i = Math.max(0, ids.indexOf(M.view.selfId));
    const n = Math.max(1, ids.length);

    for (let attempt = 0; attempt < 8; attempt++) {
      const a = (i / n) * Math.PI * 2 + attempt * 0.35;
      const r = 4.4 + attempt * 1.1;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const w = this.wreckPos;
      if (w && Math.hypot(x - w.x, z - w.z) < 8) continue;
      if (heightAt(x, z) < 0.4) continue;                 // not in the sea
      this.player.teleport(x, heightAt(x, z) + 0.6, z, Math.atan2(c.x - x, c.z - z));
      return;
    }
    this.player.teleport(c.x + 4, Math.max(heightAt(c.x, c.z), 0.6) + 0.6, c.z, 0);
  }

  _onKilled(id, x, y, z) {
    const M = this.mp;
    const rec = M.view.players.get(id) || { id, colour: 'red', name: '?' };
    const gy = Math.max(y, heightAt(x, z));

    if (!M.bodies.has(id) && this.islandScene) {
      const body = new Body(this.islandScene, this.propMats, rec, x, gy, z);
      body.fall = 0;                       // they drop, they do not appear
      M.bodies.set(id, body);
    }
    const av = M.avatars.get(id);
    if (av) { av.setShell(null); av.setVisible(false); }

    // blood, on the ground, where it happened
    this.gore?.splat(x, gy, z, colourHex(rec.colour));

    if (id === M.view.selfId) {
      this._notice('YOU WERE KILLED');
      this.audio.sfx('hurt');
      this.audio.sfx('splat');
      this.player.punch?.(1);
      this.pipeline.tint.setHex(0xb00c06);
      this.pipeline.tintAmt = 0.95;
      this.ui.hud.data.hp = 0;
      // the world tips as you go down
      this.deathTilt = 1.4;
    } else {
      this.audio.sfx('splat');
    }
  }

  /** The cork vest earned its keep. */
  _onSaved(id) {
    const M = this.mp;
    const rec = M.view.players.get(id);
    this.audio.sfx('gemHit');
    this.audio.sfx('deny');
    if (id === M.view.selfId) {
      this.owned?.delete('vest');
      this.carry = (this.carry || []).filter((c) => c !== 'vest');
      this.player.punch?.(1);
      this.pipeline.tint.setHex(0xffd24a);
      this.pipeline.tintAmt = 0.85;
      this.ui.showPopup('THE CORK VEST HELD', 'SOMEBODY JUST TRIED FOR YOU', 'vest', 'YOU ARE ALIVE');
    } else {
      this.ui.toast(`${rec?.name || 'SOMEBODY'} SURVIVED A STRIKE`, 'jade', 2600);
    }
    const p = this.player.pos;
    this.taskFx?.burst(p.x, heightAt(p.x, p.z), p.z, 0xffd24a, 'done', 3.4);
  }

  _clearBodies() {
    for (const b of this.mp.bodies.values()) b.dispose();
    this.mp.bodies.clear();
    this.gore?.clear();
    for (const av of this.mp.avatars.values()) {
      const rec = this.mp.view.players.get(av.id);
      av.setVisible(!rec || rec.alive !== false ? true : false);
    }
  }

  _onCouncil(byId, bodyOf) {
    const M = this.mp;
    const by = M.view.players.get(byId);
    const of = bodyOf ? M.view.players.get(bodyOf) : null;
    M.councilHeader = of
      ? `${(by?.name) || '?'} FOUND ${(of?.name) || '?'}`
      : `${(by?.name) || '?'} CALLED A COUNCIL`;
    M.chat.length = 0;

    if (of) {
      /* Everybody sees the body before anybody talks. The bodies are left
         standing for the length of the card, then cleared with the blood. */
      this.screens.replace('mpBodyFound', { who: of.name, by: by?.name });
      this.audio.sfx('stinger');
      this.audio.sfx('hurt');
      this.player.punch?.(0.8);
      this.pipeline.tint.setHex(0x8c0f08);
      this.pipeline.tintAmt = 0.7;
      M.bodyCardUntil = now() + 2.6;
      setTimeout(() => { this._clearBodies(); }, 2600);
    } else {
      this._clearBodies();
      this.audio.sfx('door');
    }
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
    /* `name` is the screen stack's own identity field — passing the exiled
       player's name in it renamed the screen to them. */
    this.screens.replace('mpExile', {
      line, wasAgent: msg.wasAgent, targetId: msg.targetId, who: p?.name || msg.name || '?',
    });
    this.audio.sfx('descend');
    if (msg.targetId === M.view.selfId) this.ui.hud.data.hp = 0;
  }

  _fixProgress(kind, done, need) {
    const sab = this.mp.view.sabotage;
    if (sab && sab.kind === kind) { sab.done = done; sab.need = need; }
    this.audio.sfx('gemHit');
    this.ui.toast(`${done} OF ${need} REPAIRED`, 'jade', 1800);
    if (this.taskFx) {
      const p = this.player.pos;
      this.taskFx.burst(p.x, heightAt(p.x, p.z), p.z, 0x8fe8c8);
    }
  }

  _onSabotage(kind, secs, fatal, sites) {
    const def = SABOTAGE_DEFS[kind];
    this.mp.view.sabotage = { kind, endsAt: now() + secs, fatal, done: 0, need: sites || 1 };
    this._notice(def ? def.name : 'SABOTAGE');
    this.audio.sfx(fatal ? 'bossIntro' : 'charge');
    this.player.punch?.(0.7);
    this.pipeline.tint.setHex(fatal ? 0xff4030 : 0x4060a0);
    this.pipeline.tintAmt = 0.6;
    this._applySabotage(kind, true);
    this._compassForTasks();
  }

  /** Sabotages have to be visible from across the island or they are just a timer. */
  _applySabotage(kind, on) {
    /* The mist. Fog collapses to arm's length and the sky goes with it —
       and an Agent sees a little further through it than anyone else,
       which is the whole reason to pull it. */
    if (kind === 'blind') {
      this.blinded = on;
      const f = this.islandScene.fog;
      if (on) {
        this._fogWas = { near: f.near, far: f.far };
        this.audio.sfx('descend');
        this.audio.sfx('rumble');
      } else if (this._fogWas) {
        f.near = this._fogWas.near; f.far = this._fogWas.far;
        if (this.sky) this.sky.material.opacity = 1;
        for (const av of this.mp.avatars.values()) av.setShell(null);
        this.audio.sfx('confirm');
      }
    }
    if (kind === 'scatter') {
      /* Not just markers off the map. Your list is shuffled and the names
         are stripped back to what the job is, so you have to walk the
         island and recognise the place rather than read a label. */
      this.scattered = on;
      this._compassForTasks();
      this.audio.sfx(on ? 'deny' : 'confirm');
      if (on) {
        this.player.punch?.(0.3);
        this.ui.toast('YOUR TOOLS ARE EVERYWHERE', 'bad', 2600);
      }
    }
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
    if (kind === 'shut') {
      this.shopShut = on;
      const hut = this.hutNode;
      if (hut) {
        if (!hut.userData.boards) {
          // planks nailed across the counter, made once and hidden
          const B = [];
          for (let i = 0; i < 4; i++) {
            const b2 = boxGeo(7.4, 0.55, 0.24, i);
            b2.position.set(0, 2.2 + i * 0.75, 2.55);
            b2.rotation.z = (i % 2 ? 1 : -1) * 0.09;
            B.push(b2);
          }
          const grp = new THREE.Group();
          for (const b2 of B) grp.add(b2);
          hut.add(grp);
          hut.userData.boards = grp;
        }
        hut.userData.boards.visible = on;
      }
      this.audio.sfx(on ? 'slam' : 'door');
      if (on) this.ui.toast('FERDI IS SHUT. NOWHERE IS SAFE.', 'bad', 3200);
    }
    if (kind === 'jam') {
      this.jammed = on;
      // its own track: two notes a semitone apart over a heartbeat
      this.audio.playMusic(on ? 'alarm' : 'island');
      for (const m of (this.pendulumMeshes || [])) {
        if (m.userData.setJammed) m.userData.setJammed(on);
      }
    }
    if (kind === 'storm') {
      this.stormOn = on;
      if (on) {
        this.audio.sfx('thunder');
        this.ui.flashLightning?.();
        this.audio.playMusic('storm');
        this.ui.toast('THE WORK IS SCRAMBLED', 'bad', 3000);
      } else {
        this.audio.playMusic(this.night > 0.5 ? 'night' : 'island');
      }
    }
  }

  _onOver(winner, agents, reason) {
    this.mp.finished = true;
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
  /**
   * The payoff for a step of a chore. Each one has its own colour, sound
   * and weight of camera shake, so winding a Pendulum does not land like
   * folding a sail.
   */
  _taskDone(id, finished = true) {
    const M = this.mp;
    const stage = this._taskStage(id);
    const fx = TASK_FX[stage.fx] || TASK_FX.spark;
    const site = this._taskSite(id);

    if (site && this.taskFx) {
      this.taskFx.burst(site.x, Math.max(site.y, heightAt(site.x, site.z)), site.z, fx.colour, 'done', fx.ring);
    }
    this.pipeline.tint.setHex(fx.colour);
    // desaturated profiles look like a fault rather than a flourish, so the
    // duller the colour the lighter the wash
    const c = new THREE.Color(fx.colour);
    const sat = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    this.pipeline.tintAmt = 0.16 + Math.min(0.30, sat * 0.55);
    this.player.punch?.(fx.shake);
    M.doneFlash = { id, t: 1.4 };
    this.audio.sfx(fx.sfx);
    this.audio.sfx(finished ? 'confirm' : 'select');

    this._taskWorldFx(id, stage);
    /* Work pays. Agents' lists are a cover, so their "work" pays nothing —
       if they want anything off Ferdi they have to go and find coins on
       the ground like a scavenger, which puts them out in the open. */
    if (!this.amAgent) {
      this.coins = (this.coins || 0) + STAGE_PAY;
      this.ui.toast(`+${STAGE_PAY} SYNCOIN`, 'gold', 1400);
    }

    const def = taskById(id);
    if (!finished && def?.then) {
      this.ui.showPopup(def.then.name, 'NOW TAKE IT THERE', 'task', 'HALF DONE');
    } else {
      this.ui.showPopup(stage.name, 'THAT IS ONE OFF THE LIST', 'task', 'TASK DONE');
    }
    this._compassForTasks();
  }

  /**
   * What the island does about it. A ring of light is generic; this is the
   * bit that makes each chore feel like a different job.
   */
  _taskWorldFx(id, stage) {
    const at = stage?.at;
    const relic = (k) => (this.relicNodes || []).find((r) => r.kind === k)?.mesh;

    if (id === 'tasha' && at === 'tasha') {
      relic('tasha')?.userData.setFixed?.(true);
      this.audio.sfx('orbShatter');
    }
    if (id === 'plane' && at === 'aerlingus') {
      relic('aerlingus')?.userData.setFixed?.(true);
      this.audio.sfx('slam');
    }
    if (at && at.startsWith('pend')) {
      // the Pendulum you just wound throws a shockwave and flares
      const i = Number(at.slice(4)) - 1;
      const m = (this.pendulumMeshes || [])[i];
      m?.userData.activate?.();
    }
    if (id === 'crate' && at === 'crates') {
      // the crate you just shouldered comes off the stack
      const loose = this.hutNode?.userData.crate;
      if (loose && loose.visible) {
        loose.visible = false;
        this.audio.sfx('door');
        setTimeout(() => { if (loose) loose.visible = true; }, 45000);
      }
    }
    if (id === 'fire' || id === 'torches') {
      // the fire jumps
      const f = this.campfire?.userData.flames;
      if (f) {
        f.scale.setScalar(1.9);
        setTimeout(() => f.scale.setScalar(1), 1400);
      }
      if (this.campfire?.userData.light) this.campfire.userData.light.intensity = 6;
    }
    if (id === 'brazier' && this.templeDoor) {
      for (const fl of (this.templeDoor.userData.fires || [])) {
        fl.scale.setScalar(1.8);
        setTimeout(() => fl.scale.setScalar(1), 1600);
      }
    }
    if (id === 'sweep' && this.templeDoor?.userData.light) {
      this.templeDoor.userData.light.intensity = 4.2;
      setTimeout(() => { if (this.templeDoor) this.templeDoor.userData.light.intensity = 1.1; }, 1800);
    }
  }

  /** Which stage of a chore you are on, and what it is called right now. */
  _taskStage(id) {
    const step = this.mp.view.taskStep.get(id) || 0;
    return taskStage(id, step)
      || { name: 'THE TASK', verb: 'WORKING', secs: 3, at: null, fx: 'spark' };
  }

  /** Where the current half of a chore happens. */
  _taskSite(id) {
    const stage = this._taskStage(id);
    return this._namedSite(stage.at) || this.mp.sites[id] || null;
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
    this.gore = new Gore(this.islandScene, heightAt);
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
      crates: this.cratePos || this.hutPos,
      wreck: this.wreckPos,
      hut: this.hutPos,
      temple: this.templeDoorPos,
      rogueSand: this.rogueSandPos,
      /* The grove is wherever the coconut piles actually landed — but only
         one that is out in the open. The first pile in the list had been
         scattered inside the temple's own footprint, so the chore was a
         prompt you had to stand in a wall to reach. */
      grove: (this.coconutPiles || []).find((c) => {
        const t = this.templeDoorPos;
        return !t || Math.hypot(c.x - t.x, c.z - t.z) > 34;
      }) || this.coconutPiles?.[0] || LANDMARKS.lagoon,
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
    const bell = this.campfirePos || this.campPos || this.spawn;
    const pois = [{ label: 'FIRE', x: bell.x, z: bell.z, kind: 'poi' }];
    for (const id of M.view.tasks) {
      const site = this._taskSite(id);
      if (!site) continue;
      pois.push({
        label: '', x: site.x, z: site.z, kind: 'job',
        hidden: this.scattered || M.view.doneTasks.has(id),
      });
    }
    /* Wherever the current sabotage has to be repaired, marked in red and
       blinking. Being told the island is on fire without being told where
       the bucket is was not much of a callout. */
    const sab = M.view.sabotage;
    if (sab) {
      const def = SABOTAGE_DEFS[sab.kind];
      for (const at of (def?.fixAt || [])) {
        const site = this._namedSite(at);
        if (site) pois.push({ label: 'FIX', x: site.x, z: site.z, kind: 'fix' });
      }
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
      const site = this._taskSite(id);
      if (!site) continue;
      const d = Math.hypot(p.x - site.x, p.z - site.z);
      if (d < 4.6 && d < taskD) {
        const stage = this._taskStage(id);
        taskD = d;
        taskBest = { kind: 'mpTask', taskId: id, prompt: stage.name };
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
        if (d < 5.0 && d < bestD) {
          bestD = d;
          const need = sab.need || 1, done = sab.done || 0;
          best = {
            kind: 'mpFix', fix: sab.kind, at,
            prompt: need > 1 ? `REPAIR  (${done}/${need})` : 'REPAIR',
          };
        }
      }
    }

    // Ferdi's counter
    if (this.amAlive && this.hutPos && !this.shopShut) {
      const dh = Math.hypot(p.x - this.hutPos.x, p.z - this.hutPos.z);
      if (dh < 7.5 && dh < bestD) { bestD = dh; best = { kind: 'mpShop', prompt: 'FERDI STEINMAN' }; }
    }

    /* Coins are collected by walking into them (see _sweepCoins); the
       prompt only exists so you know one is nearby if you walk past
       looking the other way. */
    for (const c of (this.syncoins || [])) {
      if (c.taken) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < 6.0 && d < bestD) { bestD = d; best = { kind: 'coin', coin: c, prompt: 'SYNCOIN' }; }
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
        const stage = this._taskStage(it.taskId);
        /* Some stages are a puzzle rather than a hold. They take longer,
           and — the point — they take your eyes off the world while you
           are doing them. */
        if (stage.game) {
          const step = M.view.taskStep.get(it.taskId) || 0;
          this.screens.push('mpMinigame', {
            game: stage.game, taskId: it.taskId, title: stage.name,
            // the storm fries the instruments: every puzzle gets its
            // harder variant while it is running
            hard: !!this.stormOn,
            seed: hashSeed(it.taskId + ':' + step + ':' + (M.view.selfId || '')),
            step: step + 1, steps: taskSteps(it.taskId),
          });
          document.exitPointerLock?.();
          this.audio.sfx('page');
          return;
        }
        M.taskProgress = {
          taskId: it.taskId, t: 0, secs: stage.secs || 3, verb: stage.verb || 'WORKING',
          name: stage.name, fx: stage.fx,
          x: this.player.pos.x, z: this.player.pos.z,
        };
        this.player.playThrow();
        this.audio.sfx('charge');
        break;
      }
      case 'mpReport': this._send({ t: C.REPORT, bodyId: it.bodyId }); break;
      case 'mpBell': this._send({ t: C.REPORT, bodyId: null }); break;
      case 'mpFix': this._send({ t: C.FIX, kind: it.fix, at: it.at }); break;
      case 'mpShop':
        this.screens.push('mpShop', { sel: 0, side: 0 });
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      case 'coin': this._takeCoin(it.coin); break;
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

  /** Ferdi's is neutral ground, unless somebody has shut it. */
  inSanctuary(x, z) {
    if (this.shopShut || !this.hutPos) return false;
    return Math.hypot(x - this.hutPos.x, z - this.hutPos.z) < SANCTUARY_R;
  }

  _nearestVictim() {
    const M = this.mp;
    const p = this.player.pos;
    if (this.inSanctuary(p.x, p.z)) return null;
    let best = null, bestD = 4.6;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      if (this.inSanctuary(av.pos.x, av.pos.z)) continue;
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

  /* Left click does nothing in Castaways. Killing somebody because you
     happened to click while looking around is not a mistake anyone should
     be able to make; it is on its own key. */
  throwCoconut() {
    if (!this.mp.active) return super.throwCoconut();
  }

  /** Outline whoever is close enough to take. */
  _markTarget() {
    const M = this.mp;
    if (!M.active) return;
    const ready = this.amAgent && this.amAlive
      && M.view.phase === PHASE.ROAM
      && !(M.myKillReady && now() < M.myKillReady);
    const target = ready ? this._nearestVictim() : null;
    if (this.blinded) return;            // thermal owns the shells while it runs
    for (const av of M.avatars.values()) {
      av.setShell(av === target ? 'mark' : null);
    }
    M.marked = target;
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
    const jobs = this.scattered ? [] : M.view.tasks
      .map((id) => ({ id, site: this._taskSite(id), done: M.view.doneTasks.has(id) }))
      .filter((j) => j.site);
    const left = jobs.filter((j) => !j.done).length;
    this.audio.sfx('page');
    this.screens.push('chart', {
      subtitle: this.scattered ? 'THE MARKERS ARE GONE. FROM MEMORY, THEN.'
        : (this.amAgent
          ? 'THE LIST IS A COVER. WALK IT ANYWAY.'
          : (left ? `${left} STILL TO DO` : 'YOUR WORK IS DONE')),
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
        fixes: (() => {
          const sab2 = M.view.sabotage;
          if (!sab2) return [];
          const def2 = SABOTAGE_DEFS[sab2.kind];
          return (def2?.fixAt || []).map((k2) => this._namedSite(k2)).filter(Boolean);
        })(),
        others: [...M.avatars.values()]
          .filter((a) => (M.view.players.get(a.id)?.alive !== false) && !this.amAlive)
          .map((a) => ({ x: a.pos.x, z: a.pos.z, colour: colourHex(a.colour) })),
      },
    });
    document.exitPointerLock?.();
  }

  _key(e, down) {
    const M = this.mp;
    // a chore is something you hold down, not something you tap once
    if (M.active && e.code === 'KeyE') M.holdingE = down;
    // Q toggles: pressing it again on the wheel should put it away
    if (M.active && down && e.code === 'KeyQ' && this.screens.name === 'mpSabotage') {
      this.screens.pop();
      this.afterOverlayClose();
      return;
    }
    if (M.active && down && !this.screens.open && this.playing) {
      if (e.code === 'KeyF') { this.tryKill(); return; }
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

  /**
   * Coins come to you. A two-and-a-half metre radius you had to stand
   * inside AND press a key in is why they read as broken — a coin should
   * be something you run over.
   */
  _sweepCoins(dt) {
    const p = this.player.pos;
    for (const c of (this.syncoins || [])) {
      if (c.taken) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d > 4.6) { if (c.mesh) c.mesh.position.set(c.x, c.mesh.userData.baseY ?? c.mesh.position.y, c.z); continue; }
      // drawn in, faster the closer it gets
      if (c.mesh) {
        const k = Math.min(1, dt * (2.2 + (4.6 - d) * 2.4));
        c.mesh.position.x += (p.x - c.mesh.position.x) * k;
        c.mesh.position.z += (p.z - c.mesh.position.z) * k;
        c.mesh.position.y += ((p.y + 0.9) - c.mesh.position.y) * k;
      }
      const m = c.mesh;
      const md = m ? Math.hypot(p.x - m.position.x, p.z - m.position.z) : d;
      if (md < 1.4 || d < 1.2) this._takeCoin(c);
    }
  }

  _takeCoin(c) {
    c.taken = true;
    this.coins = (this.coins || 0) + 1;
    this.wallet = this.coins;
    this.audio.sfx('coin');
    this.startCoinFlourish(c);
    this.ui.toast(`SYNCOIN  x${this.coins}`, 'gold', 1200);
    this.taskFx?.burst(c.x, heightAt(c.x, c.z), c.z, 0xffd24a, 'done', 2.4);
    this.player.punch?.(0.16);
  }

  /** Buy something. Nothing here is a number you cannot feel. */
  buyItem(id) {
    const it = itemById(id);
    if (!it) return false;
    this.owned = this.owned || new Set();
    if (this.owned.has(id) && it.tag === 'PASSIVE') { this.audio.sfx('deny'); return false; }
    if ((this.coins || 0) < it.cost) {
      this.audio.sfx('deny');
      this.ui.toast('NOT ENOUGH SYNCOIN', 'bad', 1600);
      return false;
    }
    this.coins -= it.cost;
    this.audio.sfx('confirm');
    this.audio.sfx('coin');

    if (it.tag === 'PASSIVE') this.owned.add(id);
    else this.carry = [...(this.carry || []), id];

    if (id === 'tonic') { this.player.staminaDrain = 0.06; this.player.staminaRegen = 0.5; }
    if (id === 'soles') this._send({ t: C.PERK, perk: 'quiet', on: true });
    if (id === 'vest') this._send({ t: C.PERK, perk: 'vest', on: true });
    if (id === 'whetstone' && this.mp.myKillReady) {
      this.mp.myKillReady -= Math.max(0, (this.mp.myKillReady - now()) * 0.34);
    }
    this.ui.showPopup(it.name, it.side === 'black' ? 'NOTHING WAS SOLD HERE' : 'NO REFUNDS', 'coin', 'FERDI SAYS');
    this.ui.toast(`BOUGHT ${it.name}`, 'jade', 2200);
    return true;
  }

  hasItem(id) { return !!this.owned?.has(id) || !!this.carry?.includes(id); }

  useCarried(id) {
    if (!this.carry?.includes(id)) return false;
    this.carry.splice(this.carry.indexOf(id), 1);
    return true;
  }

  /** A puzzle stage was solved; it counts exactly like a hold would. */
  finishMinigame(taskId) {
    if (!taskId) return;
    this._send({ t: C.DO_TASK, taskId });
  }

  cancelMinigame() { this.audio.sfx('deny'); }

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

    /* Whatever happened — a pause card, an alt-tab, a stray Escape — if the
       council is sitting then the council screen is what you should be
       looking at. Without this you could end up frozen in the world with no
       interface at all and no way back short of a refresh. */
    const meeting = M.view.phase === PHASE.COUNCIL || M.view.phase === PHASE.VOTE;
    /* ...but not over the top of a card that is deliberately final. The
       results screen and the "the host left" screen both sit on a phase
       that never advances, and the watchdog would put the council straight
       back over them. */
    const FINAL = ['mpEnd', 'mpExile', 'mpRole', 'pause', 'mpBodyFound'];
    const held = FINAL.includes(this.screens.name);
    // the body card gets its moment, then the council takes over
    if (this.screens.name === 'mpBodyFound' && M.bodyCardUntil && now() > M.bodyCardUntil) {
      this.screens.replace('mpCouncil', {});
    }
    if (meeting && !M.finished && !held && this.screens.name !== 'mpCouncil') {
      this.paused = false;
      this.screens.replace('mpCouncil', {});
    }
    if ((!meeting || M.finished) && this.screens.name === 'mpCouncil') {
      this.screens.clear();
      this.ui.show();
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
      } else if (!M.holdingE) {
        // let go and it drains, so you cannot start six chores at once
        tp.t = Math.max(0, tp.t - dt * 1.6);
        tp.slack = (tp.slack || 0) + dt;
        if (tp.slack > 1.1) { M.taskProgress = null; this.audio.sfx('deny'); }
      } else {
        tp.slack = 0;
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
    this.gore?.update(dt);
    this.updateCoinFx(dt);      // the pickup flourish never ran in this mode
    this._sweepCoins(dt);
    // a body drops rather than appearing already laid out
    for (const b of M.bodies.values()) {
      if (b.fall === undefined || b.fall >= 1) continue;
      b.fall = Math.min(1, b.fall + dt * 2.6);
      const k = 1 - Math.pow(1 - b.fall, 3);
      b.mesh.rotation.z = Math.PI * 0.46 * k;
      b.mesh.position.y = b.restY + (1 - k) * 0.9;
    }
    // and the world tips as you go down with them
    if (this.deathTilt > 0) {
      this.deathTilt = Math.max(0, this.deathTilt - dt);
      this.camera.rotateZ(Math.min(0.5, (1.4 - this.deathTilt) * 0.4));
    }

    // world + avatars
    this.tickIslandWorld(dt);
    this.updateDayNight(dt);
    /* The island after dark is a different game — you cannot see who is
       behind you — so it gets its own track. */
    if (!this.stormOn && !this.jammed && M.view.phase === PHASE.ROAM) {
      const wantNight = (this.night || 0) > 0.55;
      if (wantNight !== this._nightMusic) {
        this._nightMusic = wantNight;
        this.audio.playMusic(wantNight ? 'night' : 'island');
      }
    }
    /* The storm sabotage started the weather and then nothing drove it, so
       no rain fell, no thunder cracked and the only sign of it was a
       countdown on the HUD. */
    if (this.storm) this.storm.tick(this.time, dt, this.camera.position);
    /* A sabotaged storm is not weather, it is an assault: a much darker
       sky and strikes that land near people rather than somewhere on the
       horizon. */
    if (this.stormOn) {
      this._strikeT = (this._strikeT || 0) - dt;
      if (this._strikeT <= 0) {
        this._strikeT = 1.6 + Math.random() * 2.6;
        const a = Math.random() * Math.PI * 2;
        const r = 18 + Math.random() * 46;
        const sx = this.player.pos.x + Math.cos(a) * r;
        const sz = this.player.pos.z + Math.sin(a) * r;
        this.taskFx?.burst(sx, heightAt(sx, sz), sz, 0xbfe8ff, 'done', 7.0);
        this.ui.flashLightning?.();
        this.audio.sfx('thunder');
        this.player.punch?.(0.35);
      }
    }
    /* updateDayNight rewrites the fog every frame, so the mist has to be
       re-imposed after it rather than set once. */
    if (this.blinded) {
      /* Not a white sheet laid over things. A cold, dark murk that takes
         the sky with it, so you cannot navigate by the horizon either. */
      const f = this.islandScene.fog;
      f.near = 1.5;
      f.far = 8.5;
      f.color.setRGB(0.055, 0.065, 0.085);
      this.islandScene.background?.setRGB?.(0.045, 0.055, 0.075);
      if (this.sky) { this.sky.material.transparent = true; this.sky.material.opacity = 0.03; }
      if (this.ambient) this.ambient.intensity = 0.22;
      if (this.hemi) this.hemi.intensity = 0.10;
      // an Agent does not see further; an Agent sees HEAT
      const thermal = this.amAgent || !this.amAlive;
      for (const av of this.mp.avatars.values()) {
        const rec = this.mp.view.players.get(av.id);
        av.setShell(thermal && rec && rec.alive !== false ? 'thermal' : null);
      }
    }
    for (const m of (this.pendulumMeshes || [])) {
      if (m.userData.setNight) m.userData.setNight(this.night || 0);
    }
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
    this._markTarget();
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
    const v = this._nearestVictim();
    if (!v) return null;
    const rec = this.mp.view.players.get(v.id);
    return `F   ELIMINATE ${(rec?.name || 'THEM').toUpperCase()}`;
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

    /* Rain and mist take the names off people. Knowing who is walking
       towards you is most of what the tags are for, so taking them away is
       the point of calling weather in. */
    let reach = 34;
    if (this.storm?.active) reach = 9;
    if (this.blinded) reach = this.amAgent ? 12 : 5;

    const add = (obj, name, colour, dead) => {
      v.set(obj.position.x, obj.position.y + (dead ? 0.9 : 2.15), obj.position.z);
      const dist = v.distanceTo(eye);
      if (dist > reach) return;
      v.project(cam);
      if (v.z > 1 || v.z < -1) return;
      out.push({
        x: Math.round((v.x * 0.5 + 0.5) * W),
        y: Math.round((-v.y * 0.5 + 0.5) * H),
        name, colour, dead,
        fade: dist > reach * 0.76 ? 1 - (dist - reach * 0.76) / (reach * 0.24) : 1,
      });
    };

    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      if (!av.mesh.visible) continue;
      if (rec.quiet) continue;                 // quiet soles: no name, at any range
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
        id, name: this._taskStage(id).name, done: M.view.doneTasks.has(id),
        half: !M.view.doneTasks.has(id) && (M.view.taskStep.get(id) || 0) >= 1,
        step: (M.view.taskStep.get(id) || 0), steps: taskSteps(id),
      })),
      killIn: this.amAgent && M.myKillReady ? Math.max(0, M.myKillReady - now()) : 0,
      killTotal: M.killTotal || 1,
      graceIn: this.amAgent && M.graceEnds ? Math.max(0, M.graceEnds - now()) : 0,
      cools: this.amAgent ? Object.entries(M.cool || {}).map(([k, at]) => ({
        kind: k, left: Math.max(0, at - now()),
        total: (SABOTAGE_DEFS[k]?.cooldown || 1),
      })).filter((c) => c.left > 0) : [],
      sabotage: M.view.sabotage
        ? { name: SABOTAGE_DEFS[M.view.sabotage.kind]?.name || '', left: Math.max(0, M.view.sabotage.endsAt - now()), fatal: M.view.sabotage.fatal }
        : null,
      task: M.taskProgress
        ? {
          verb: M.taskProgress.verb, name: M.taskProgress.name,
          k: M.taskProgress.t / M.taskProgress.secs,
          holding: !!M.holdingE,
        }
        : null,
      flash: M.doneFlash ? M.doneFlash.id : null,
      players: [...M.view.players.values()],
      selfId: M.view.selfId,
      tags: this._tags(),
      phase: M.view.phase,
    };
    this.ui.setHearts(this.amAlive ? 1 : 0, 1);
    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);
    this.ui.setStamina(this.player.stamina);
  }
}
