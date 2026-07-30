/* ===========================================================
   mpgame.js — Illic Isle: Castaways.

   Reuses the whole single-player world — same island, same props,
   same renderer, same pixel interface — and swaps the story logic
   for a session. The host runs HostSession (the rules); everyone,
   host included, renders from a MirrorSession-shaped view so there
   is only one drawing path.
   =========================================================== */

import * as THREE from 'three';
import { Game, makeGroundWith, setHidden } from '../game.js';
import { Net, Ticker, makeRoomCode } from '../net/net.js';
import { C, S, PHASE, ROLE, COLOURS } from '../net/protocol.js';
import { HostSession, MirrorSession } from './session.js';
import { Avatar, Body, colourHex, noteSnapshot } from './avatar.js';
import { TASK_DEFS, SABOTAGE_DEFS, TASK_FX, taskById, taskStage, taskSteps } from './tasks.js';
import { TaskFx } from './taskfx.js';
import { Gore } from './gore.js';
import {
  STOCK, FOOD, DRINKS, STAGE_PAY_MIN, STAGE_PAY_MAX, LOOT_SHARE, SANCTUARY_R,
  itemById, stockFor, VENDOR_IDS, SCHLARNA_UP, SCHLARNA_N, drinkById,
} from './market.js';

/* How often the wire carries anything.

   Twenty-five times a second rather than eighteen. The payload is a handful
   of numbers per player — at ten players that is about seven kilobytes a
   second — and a shorter interval means the interpolator needs less buffer,
   which is felt directly as smoother movement. */
const NET_TICK_MS = 40;

/** Bought and immediately in force; nothing to press. */
const PASSIVE_AT_BUY = new Set(['lantern', 'tonic', 'soles', 'whetstone', 'chart', 'vest',
  'spyglass', 'rounds', 'nightglass']);
/** Bought and carried until you choose the moment. These fill the belt. */
const BELT_IDS = ['gun', 'whistle', 'speaker', 'flask', 'alibi', 'skeleton', 'chaff',
  'shroud', 'blackout', 'ticket'];
import { buildPistol, Flare, Dizzy } from './pistol.js';
import { heightAt, ISLAND } from '../world/terrain.js';
import { buildSyncoin } from '../world/extras.js';
import { DIG_SECONDS } from '../world/treasure.js';
import { BUNKER_SPOTS, BUNKER_BOX, BUNKER_COLLIDERS, bunkerHeight } from '../world/bunker.js';
import {
  HR_BOX, HR_COLLIDERS, hrHeight, HR_BAR_DOOR, HR_BAR_RETURN,
} from '../world/highroller.js';
import {
  BAR_ENTRY, BAR_BOX, BAR_COLLIDERS, barHeight, BAR_KEEP, BAR_OCHE, BAR_DOOR,
} from '../world/bar.js';
import * as BJ from './blackjack.js';
import { buildStranger, STRANGER_OPENERS, STRANGER_CLOSERS } from './stranger.js';
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

  }

  /* ===========================================================
     CONNECTION
     =========================================================== */
  async hostGame(name, room) {
    const M = this.mp;
    clearInterval(M.netTimer); clearInterval(M.hostTimer);
    M.finished = false;
    /* 7226 opens a workshop: one player, no minimum, a full purse, the
       listening post already on your chart and a readout of what the rules
       think is going on. It exists so the island can be tested without
       finding three other people first. */
    M.dev = String(room || '').trim() === '7226';
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
      onBunker: (i) => { M.bunkerIndex = i; if (M.started) this._placeBunker(i); },
      onSpeaker: (x, z, secs) => this._onSpeaker(x, z, secs),
      onChaff: (secs) => { M.chaffUntil = now() + secs; },
      onPurse: (c, gained) => this._onPurse(c, gained),
      onLedger: (rows) => this._onLedger(rows),
      onBlackout: (secs) => this._onBlackout(secs),
      onStranger: (on, x, z) => this._onStranger(on, x, z),
      onRiddle: (text) => this._onRiddle(text),
      namedSites: () => this.mp.named || {},
      onDrop: (x, y, z, c, id) => this._onDrop(x, y, z, c, id),
      onShot: (by, vid, at, secs) => this._onShot(by, vid, at, secs),
      onSnapOpen: (vid, by, secs, voters) => this._onSnapOpen(vid, by, secs, voters),
      onSnapTally: (y, n2, need) => this._onSnapTally(y, n2, need),
      onSnapDone: (vid, ex, wasAgent, y, n2) => this._onSnapDone(vid, ex, wasAgent, y, n2),
      onCouncil: (by, body) => this._onCouncil(by, body),
      onVotes: (counts, voted) => { M.view.votes = { counts, voted }; },
      onExile: (id, wasAgent) => this._onExile({ targetId: id, wasAgent, reveal: M.host.settings.revealOnExile }),
      onChat: (m) => this._onChat(m),
      onSabotage: (k, s2, f, sites, half) => this._onSabotage(k, s2, f, sites, half),
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
    if (M.dev) {
      M.host.dev = true;
      M.host.settings.graceSeconds = 0;
      M.host.settings.killCooldown = 6;
    }
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
    }, 200);
    this._startNetTimer();
    return M.room;
  }

  async joinGame(name, room) {
    const M = this.mp;
    clearInterval(M.netTimer); clearInterval(M.hostTimer);
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
    this._startNetTimer();
    return room;
  }

  /**
   * Everything that goes on the wire goes from here.
   *
   * It used to ride the animation loop, which meant the rate of position
   * updates was whatever frame rate the host happened to be getting. A
   * host at fifteen frames a second sent fifteen snapshots a second, every
   * client's interpolation buffer ran dry between them, and every remote
   * body on the island stuttered in lockstep — which reads as "everyone
   * lagged at the same moment" even though almost no data is moving.
   */
  _startNetTimer() {
    const M = this.mp;
    clearInterval(M.netTimer);
    M.netTimer = setInterval(() => {
      if (!M.active) return;
      if (this.isHost) {
        if (!M.host) return;
        const hp = M.host.players.get('host');
        if (hp && this.player) {
          hp.x = this.player.pos.x; hp.y = this.player.pos.y; hp.z = this.player.pos.z;
          hp.yaw = this.player.facing;
        }
        this._applySnapshot({ p: M.host.snapshot() });
      } else if (M.view.phase === PHASE.ROAM && this.player) {
        this._send({
          t: C.MOVE,
          x: +this.player.pos.x.toFixed(2), y: +this.player.pos.y.toFixed(2),
          z: +this.player.pos.z.toFixed(2), yaw: +this.player.facing.toFixed(2), anim: 0,
          room: this.roomId,
        });
      }
    }, NET_TICK_MS);
  }

  _clientMsg(msg) {
    const M = this.mp;
    M.view.handle(msg);
    switch (msg.t) {
      case S.ROSTER: this._roster([...M.view.players.values()]); break;
      case S.PHASE: this._phase(msg.phase, msg.endsAt, msg.meta); break;
      case S.SNAPSHOT: this._applySnapshot(msg); break;
      case S.KILLED: this._onKilled(msg.victimId, msg.x, msg.y, msg.z); break;
      case S.BUNKER: M.bunkerIndex = msg.index; if (M.started) this._placeBunker(msg.index); break;
      case S.SPEAKER: this._onSpeaker(msg.x, msg.z, msg.secs); break;
      case S.CHAFF: M.chaffUntil = now() + msg.secs; break;
      case S.SAVED: this._onSaved(msg.victimId); break;
      case S.PURSE: this._onPurse(msg.coins, msg.gained); break;
      case S.LEDGER: this._onLedger(msg.rows); break;
      case S.BLACKOUT: this._onBlackout(msg.secs); break;
      case S.STRANGER: this._onStranger(msg.on, msg.x, msg.z); break;
      case S.RIDDLE: this._onRiddle(msg.text); break;
      case S.DROP: this._onDrop(msg.x, msg.y, msg.z, msg.coins, msg.id); break;
      case S.SHOT: this._onShot(msg.byId, msg.victimId, msg, msg.secs); break;
      case S.SNAPOPEN: this._onSnapOpen(msg.victimId, msg.byId, msg.secs, msg.voters); break;
      case S.SNAPTALLY: this._onSnapTally(msg.yes, msg.no, msg.need); break;
      case S.SNAPDONE: this._onSnapDone(msg.victimId, msg.exiled, msg.wasAgent, msg.yes, msg.no); break;
      case S.COUNCIL: this._onCouncil(msg.calledBy, msg.bodyOf); break;
      case S.CHAT: this._onChat(msg); break;
      case S.EXILE: this._onExile(msg); break;
      case S.SABOTAGE:
        if (msg.refused) { this.ui.toast('THAT ONE IS STILL COOLING', 'bad', 1600); this.audio.sfx('deny'); break; }
        this._onSabotage(msg.kind, msg.secs, msg.fatal, msg.sites, msg.half);
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
    // the interpolation delay is derived from how these actually arrive
    noteSnapshot(t);
    const mine = this.roomId;
    for (const [id, x, y, z, yaw, anim, alive, room] of msg.p) {
      if (id === M.view.selfId) continue;
      const av = M.avatars.get(id);
      if (!av) continue;
      av.push(t, x, y, z, yaw, anim);
      av.alive = !!alive;
      /* Somebody in a different space is not merely far away, they are
         somewhere else — hide them, and move their body into whichever scene
         we are looking at when it matches ours. */
      const theirs = room | 0;
      av.room = theirs;
      const together = theirs === mine;
      av.mesh.visible = together && av.alive !== false;
      if (together) {
        const sc = this.scene;
        if (sc && av.mesh.parent !== sc) sc.add(av.mesh);
      }
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
      if (!M.started) { M.started = true; this.startCastaways(); this._applyDevKit(); }
      this._teleportToCamp();
      this._briefing();
    } else if (phase === PHASE.ROAM) {
      // if the briefing is still running on a slow machine, cut it here —
      // everyone else is already ashore
      if (this.state === 'cutscene') this.skipCutscene();
      this.paused = false;
      /* Do NOT drag somebody out of an interior. This used to set the state
         and the scene unconditionally, so a phase message arriving while you
         were in the listening post or the room behind the painting left your
         body in that scene while the camera rendered the island — you were
         standing in the jungle at the height of the ridge with no way back. */
      if (!this.inRoom) {
        this.state = 'island';
        this.scene = this.islandScene;
        this.screens.clear();
        this.ui.show();
        this._requestLock();
      }
      setCinemaBars(false);
    } else if (phase === PHASE.COUNCIL || phase === PHASE.VOTE) {
      // a council pulls everybody to the fire, wherever they were
      this.leaveRoom();
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
        { at: 16.4, fn: () => {
          if (this.mp.view.phase !== PHASE.REVEAL) return;
          this.screens.replace('mpRole', {});
          this.audio.sfx('descend');
          setTimeout(() => this.audio.sfx(this.amAgent ? 'bossIntro' : 'idolRise'), 1250);
          setTimeout(() => this.audio.sfx('stinger'), 2050);
        } },
      ],
      onDone: () => {
        setCinemaBars(false);
        if (!this.inRoom) {
          this.state = 'island';
          this.scene = this.islandScene;
        }
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

  /** The host is the authority on what is in your pocket. */
  _onPurse(coins, gained) {
    this.coins = Math.max(0, coins | 0);
    if (gained > 0) {
      this.audio.sfx('coin');
      this.ui.toast(`+${gained} OFF THE BODY`, 'gold', 2400);
      this.ui.showPopup(`${gained} SYNCOIN`, 'THEY WILL NOT BE NEEDING IT', 'coin', 'TAKEN');
    }
  }

  /** What the Agent left behind, lying where they fell. */
  _onDrop(x, y, z, coins, id) {
    if (!coins || !this.islandScene) return;
    const M = this.mp;
    M.drops = M.drops || [];
    const g = buildSyncoin(this.propMats, true);
    const gy = Math.max(y, heightAt(x, z));
    g.position.set(x, gy + 0.4, z);
    this.islandScene.add(g);
    this.tickers.push(g);
    M.drops.push({ mesh: g, x, z, coins, taken: false });
    this.taskFx?.burst(x, gy, z, 0xffd24a, 'done', 3.0);
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
      // the weight goes with it
      this.player.SPEED = this.player.BASE_SPEED;
      this.player.SPRINT = this.player.BASE_SPRINT;
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

  _onSabotage(kind, secs, fatal, sites, half) {
    const def = SABOTAGE_DEFS[kind];
    this.mp.view.sabotage = {
      kind, endsAt: now() + secs, fatal, done: 0, need: sites || 1,
      /* Which half of the island it was pulled from. Everyone receives it,
         but only the command table ever draws it — you have to be standing
         in the bunker to know, and you have to be believed afterwards. */
      half: half || null, at: now(),
    };
    const M = this.mp;
    M.sabLog = M.sabLog || [];
    M.sabLog.unshift({ kind, half: half || null, at: now(), name: def ? def.name : 'SABOTAGE' });
    if (M.sabLog.length > 6) M.sabLog.length = 6;
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
        if (this._lanternLight) this._lanternLight.intensity = 0;
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
      // the host enforces the sanctuary, so the host has to know
      if (this.mp.host) this.mp.host.shopShut = on;
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
    this._buildTaskBeacons();
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
      let pay = STAGE_PAY_MIN + Math.floor(Math.random() * (STAGE_PAY_MAX - STAGE_PAY_MIN + 1));
      // Cathy's house burger: every job pays twice for the rest of the round
      if (this.bigMeals) pay *= 2;
      this.coins = (this.coins || 0) + pay;
      this.ui.toast(`+${pay} SYNCOIN`, 'gold', 1600);
      this._payInstalment();
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
  /** Which hatch is real this round, and open it up. */
  _placeBunker(index) {
    const M = this.mp;
    M.bunkerIndex = index;
    /* Three of the four are dressed and dark. setHidden leaves their lamps
       in the scene at zero intensity rather than hiding the whole group —
       hiding a group hides the light inside it, the light count is part of
       every shader's cache key, and revealing the real hatch would make
       three recompile every material in the world. */
    (this.hatches || []).forEach((h, i) => { setHidden(h.node, i !== index); });
    M.bunker = (this.hatches || [])[index] || null;
  }

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

    // the host picks; everybody else is told
    this._placeBunker(this.mp.bunkerIndex ?? 0);
    // decks and bridges the terrain does not know about
    this.groundOf = makeGroundWith(this.platforms, heightAt);

    /* A rematch used to build a second set of every effect pool and leave
       the first one parented to the scene — twelve more rings, six more
       stains and a dozen materials every round, none of them ever drawn
       again. Reuse them when they exist and just empty them. */
    if (this.taskFx) this.taskFx.clear(); else this.taskFx = new TaskFx(this.islandScene);
    if (this.gore) this.gore.clear(); else this.gore = new Gore(this.islandScene, heightAt);
    if (this.dizzy) this.dizzy.clear(); else this.dizzy = new Dizzy(this.islandScene);
    if (!this.flares) this.flares = new Flare(this.islandScene);
    this._buildTaskBeacons();

    /* Everything a round accumulates, cleared. Left behind, a second round
       started with the last one's incident log, its ledger and its emptied
       vending machines. */
    const M2 = this.mp;
    M2.sabLog = [];
    M2.ledger = null;
    M2.ledgerPending = 0;
    M2.drops = [];
    M2.chaffUntil = 0;
    M2.speaker = null;
    if (M2.speakerNode) setHidden(M2.speakerNode, true);
    for (const v of (this.vendors || [])) v.spent = false;
    this._buildSpeakerNode();
    this.knowsBunker = !!M2.dev;
    this.blinded = false;
    this.scattered = false;
    this.shopShut = false;
    this.flask = false;
    this.owned = new Set();
    this.carry = [];
    // she keeps her own hours; start her wherever the clock says she is
    if (this.casinoDock) this.casinoIn = this.night > 0.34 ? 1 : 0;
    M2.sale = null;
    M2.saleDay = 0;
    this._lastDawn = 0;
    this.rollSale();

    this._resolveTaskSites();

    /* The effect pools, the beacons and the boombox are built here, after
       the loading screen's warm-up has already run. Compile them now,
       while the reveal card is still up, rather than the first time
       somebody finishes a chore or somebody dies. */
    try {
      const hidden = [];
      this.islandScene.traverse((o) => {
        if (o.visible === false) { o.visible = true; hidden.push(o); }
      });
      this.renderer.compile(this.islandScene, this.camera);
      for (const o of hidden) o.visible = false;
    } catch (e) { /* never worth failing a round start over */ }

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

  /**
   * A pillar of light over every chore on your own list.
   *
   * Reading a compass tick and a name is fine once you know the island;
   * for the first few rounds it is a scavenger hunt. These are visible
   * over the canopy from a long way off, only to you, and they go out as
   * you finish them.
   */
  _buildTaskBeacons() {
    const M = this.mp;
    for (const b of (M.beaconNodes || [])) b.removeFromParent();
    M.beaconNodes = [];
    for (const id of M.view.tasks) {
      const geo = new THREE.CylinderGeometry(0.5, 1.5, 90, 8, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9ff0dc, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false, fog: true,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.userData.taskId = id;
      m.visible = false;
      this.islandScene.add(m);
      M.beaconNodes.push(m);
    }
  }

  _updateTaskBeacons(dt) {
    const M = this.mp;
    if (!M.beaconNodes) return;
    const roam = M.view.phase === PHASE.ROAM;
    for (const m of M.beaconNodes) {
      const id = m.userData.taskId;
      const done = M.view.doneTasks.has(id);
      const site = this._taskSite(id);
      if (!roam || done || !site || this.scattered) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(site.x, heightAt(site.x, site.z) + 45, site.z);
      m.rotation.y += dt * 0.5;
      // brighter the further away you are, so it is a signpost, not a glare
      const d = Math.hypot(this.player.pos.x - site.x, this.player.pos.z - site.z);
      const near = Math.max(0, Math.min(1, (d - 6) / 40));
      m.material.opacity = 0.05 + near * 0.16 + Math.sin(this.time * 2) * 0.02;
    }
  }

  /* The base class rebuilds the compass through _refreshCompass; in a round
     the list of ticks is a different list, so it comes through here. */
  _refreshCompass() { if (this.mp?.active) this._compassForTasks(); else super._refreshCompass(); }

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
    if (M.speaker) pois.push({ label: 'BOX', x: M.speaker.x, z: M.speaker.z, kind: 'poi' });
    if ((this.knowsBunker || this.state === 'bunker') && M.bunker) {
      pois.push({ label: 'POST', x: M.bunker.x, z: M.bunker.z, kind: 'poi' });
    }
    // Ferdi's delivery notes: his two outlying machines
    if (this.hasItem('rounds')) {
      for (const v of (this.vendors || [])) {
        if (v.spent) continue;
        pois.push({ label: 'MACHINE', x: v.x, z: v.z, kind: 'poi' });
      }
    }
    /* Once you have spoken to her, Cathy is on your compass. Before that
       she is on the map and nowhere else, which is the whole point of her
       being out there. */
    if (this.metCathy && this.cathy) {
      pois.push({ label: 'CATHY', x: this.cathy.x, z: this.cathy.z, kind: 'poi' });
    }
    if (this.foundX && this.buried && !this.buried.state.taken) {
      pois.push({ label: 'X', x: this.buried.x, z: this.buried.z, kind: 'goal' });
    }

    /* Cathy's sauce puts a needle on the nearest loose coin, and her eggs
       put a tick on every one inside seventy metres. */
    this._coinPois(pois);

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

    /* Ghosts can work. They cannot report, ring the bell, or be seen — but
       leaving them with nothing to do for the rest of a round was a
       punishment for having been murdered. */
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

    // the listening post
    const bunk = M.bunker;
    if (bunk && this.state === 'island') {
      const db = Math.hypot(p.x - bunk.x, p.z - bunk.z);
      if (db < 4.6 && db < bestD) { bestD = db; best = { kind: 'mpHatch', prompt: 'GO DOWN' }; }
    }
    if (this.state === 'highroller') {
      const dt3 = Math.hypot(p.x - 0, p.z - (-3.4));
      if (dt3 < 4.6) return { kind: 'mpTable2', prompt: 'SIT DOWN' };
      const dd = Math.hypot(p.x - 0, p.z - 10.2);
      if (dd < 3.0) return { kind: 'mpDoorOut', prompt: 'BACK ON DECK' };
      // the door in the west panelling, which has no plate on it
      const db = Math.hypot(p.x - HR_BAR_DOOR.x, p.z - HR_BAR_DOOR.z);
      if (db < 2.6 && !this._barCooldown) return { kind: 'mpBarDoor', prompt: 'THE SALOON' };
      return null;
    }
    if (this.state === 'bar') {
      // the bar itself: stand at it and he will serve you
      const dq = Math.hypot(p.x - (BAR_KEEP.x + 1.9), p.z - BAR_KEEP.z);
      if (dq < 3.4) return { kind: 'mpBar', prompt: 'QUEZETRIEL QUEBOLIUS' };
      // the oche, at the far end
      const do2 = Math.hypot(p.x - BAR_OCHE.x, p.z - BAR_OCHE.z);
      if (do2 < 2.2) return { kind: 'mpDarts', prompt: 'PLAY HIM AT DARTS' };
      // and the way back
      const dbk = Math.hypot(p.x - BAR_DOOR.x, p.z - BAR_DOOR.z);
      if (dbk < 2.6 && !this._barCooldown) return { kind: 'mpBarOut', prompt: 'BACK THROUGH' };
      return null;
    }
    if (this.state === 'bunker') {
      const dt2 = Math.hypot(p.x - 0, p.z - 1.5);
      if (dt2 < 3.6) return { kind: 'mpTable', prompt: 'THE COMMAND TABLE' };
      const dl = Math.hypot(p.x - 0, p.z - (-6.0));
      if (dl < 2.4) return { kind: 'mpLadder', prompt: 'CLIMB OUT' };
      return null;
    }

    /* The Flopper. Everything on her deck is walk-up: all four machines,
       and the man on the wall. */
    if (this.casino) {
      const _wp = (this._wp = this._wp || new THREE.Vector3());
      for (const s2 of (this.casino.userData.slots || [])) {
        s2.getWorldPosition(_wp);
        const ds = Math.hypot(p.x - _wp.x, p.z - _wp.z);
        if (ds < 3.0 && ds < bestD) {
          bestD = ds;
          best = {
            kind: 'mpSlot', slot: s2,
            prompt: `MACHINE ${(s2.userData.index | 0) + 1}  (3 SYNCOIN)`,
          };
        }
      }
      /* The portrait. Stand right in front of it and the frame is a door —
         Tim's face is the way into the room that is not on her plan. */
      const pt = this.casino.userData.portrait;
      if (pt) {
        this.casino.localToWorld(_wp.set(pt.x, 0, pt.z));
        const dp = Math.hypot(p.x - _wp.x, p.z - _wp.z);
        /* No prompt at the frame itself. Walking into it takes you through,
           which is the whole joke — you should find the room by accident. */
        if (dp < 1.5) {
          if (this.state === 'island' && !this._hrCooldown) this.enterHighRoller();
        } else if (dp < 3.6 && dp < bestD) {
          bestD = dp;
          best = { kind: 'mpFlopper', prompt: 'TIM GRADY FLOPPER' };
        }
      }
    }

    /* The X. Three states, three different prompts: sand to move, a chest
       to get to, and a lid. */
    if (this.buried && this.amAlive) {
      const bu = this.buried;
      const db = Math.hypot(p.x - bu.x, p.z - bu.z);
      if (db < 3.2 && db < bestD) {
        bestD = db;
        if (!this.foundX) {
          this.foundX = true;
          this._compassForTasks();
          this.ui.toast('AN X. IT IS ON YOUR MAP NOW.', 'gold', 3400);
        }
        if (bu.state.taken) best = { kind: 'mpDug', prompt: 'NOTHING LEFT IN IT' };
        else if (bu.state.dug >= 1) best = { kind: 'mpChest', prompt: 'OPEN IT' };
        else best = { kind: 'mpDig', prompt: bu.state.dug > 0.02 ? 'KEEP DIGGING' : 'DIG' };
      }
    }

    // Cathy, on the far side of the island
    if (this.cathy && this.amAlive) {
      const dc = Math.hypot(p.x - this.cathy.x, p.z - this.cathy.z);
      if (dc < 5.0 && dc < bestD) { bestD = dc; best = { kind: 'mpCathy', prompt: 'CATHY' }; }
    }

    // the one who is not on the roster
    if (M.stranger) {
      const ds = Math.hypot(p.x - M.stranger.x, p.z - M.stranger.z);
      if (ds < 6.0 && ds < bestD) { bestD = ds; best = { kind: 'mpStranger', prompt: 'SPEAK TO HIM' }; }
    }

    // Ferdi's outlying machines
    for (const v of (this.vendors || [])) {
      const dv = Math.hypot(p.x - v.x, p.z - v.z);
      if (dv < 4.0 && dv < bestD) {
        bestD = dv;
        best = v.spent
          ? { kind: 'none', prompt: 'THE MACHINE IS EMPTY' }
          : { kind: 'mpVendor', vendor: v, prompt: "FERDI'S MACHINE" };
      }
    }

    // Ferdi's counter
    if (this.amAlive && this.hutPos && !this.shopShut) {
      const dh = Math.hypot(p.x - this.hutPos.x, p.z - this.hutPos.z);
      if (dh < 7.5 && dh < bestD) { bestD = dh; best = { kind: 'mpShop', prompt: 'FERDI STEINMAN' }; }
    }

    // a dead player's purse, lying where they fell
    for (const d of (M.drops || [])) {
      if (d.taken) continue;
      const dd = Math.hypot(p.x - d.x, p.z - d.z);
      if (dd < 6.0 && dd < bestD) { bestD = dd; best = { kind: 'purse', drop: d, prompt: `${d.coins} SYNCOIN` }; }
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
        if (this.flask) {
          this.flask = false;
          this._send({ t: C.DO_TASK, taskId: it.taskId });
          this.audio.sfx('victory');
          this.ui.toast("THE FLOPPER'S FLASK", 'jade', 1800);
          break;
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
      case 'mpHatch': {
        this.enterBunker();
        break;
      }
      case 'mpTable': {
        this.screens.push('mpTable', {});
        document.exitPointerLock?.();
        this.audio.sfx('terminal');
        setTimeout(() => this.audio.sfx('ping'), 420);
        this.requestLedger();
        break;
      }
      case 'mpLadder': {
        this.leaveBunker();
        break;
      }
      case 'mpSlot': {
        /* The machine's face, full screen, so you can read what landed.
           Standing at deck height you could never see the drums. */
        this.screens.push('mpSlot', { slot: it.slot });
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpTable2': {
        this.screens.push('mpBlackjack', {});
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpDoorOut': {
        this.leaveHighRoller();
        break;
      }
      case 'mpDig': break;      // held, not pressed: see _tickDig
      case 'mpDug': break;
      case 'mpChest': { this.openChest(); break; }
      case 'mpBarDoor': { this.enterBar(); break; }
      case 'mpBarOut': { this.leaveBar(); break; }
      case 'mpBar': {
        this.screens.push('mpBar', { sel: 0 });
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpDarts': {
        this.screens.push('mpDarts', {});
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpFlopper': {
        this.screens.push('mpFlopper', {});
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpCathy': {
        if (!this.metCathy) {
          this.metCathy = true;
          this._compassForTasks();
          this.ui.toast(`CATHY IS ON YOUR COMPASS - ${this.cathy.name}`, 'jade', 3400);
        }
        this.screens.push('mpCathy', { sel: 0 });
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpStranger': {
        this.askStranger();
        break;
      }
      case 'mpVendor': {
        /* Not a shop screen. A machine you put money into, which decides
           what you get. Browsing a vending machine was never the idea. */
        this.screens.push('mpVend', { vendor: it.vendor || null });
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      }
      case 'mpShop':
        this.screens.push('mpShop', { sel: 0, side: 0 });
        document.exitPointerLock?.();
        this.audio.sfx('page');
        break;
      case 'coin': this._takeCoin(it.coin); break;
      case 'purse': this._takePurse(it.drop); break;
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
      agentSide: this.amAgent,
      subtitle: this.scattered ? 'THE MARKERS ARE GONE. FROM MEMORY, THEN.'
        : (this.amAgent
          ? 'THE LIST IS A COVER. WALK IT ANYWAY.'
          : (left ? `${left} STILL TO DO` : 'YOUR WORK IS DONE')),
      data: {
        heightAt, radius: ISLAND.shore + 14,
        /* The listening post, once you have paid for the chart that shows
           it. This was the bug: knowsBunker fed the compass and nothing
           else, so the one item you bought specifically to put a cross on
           the chart never put one there. */
        marks: [
          ...((this.knowsBunker && M.bunker)
            ? [{ x: M.bunker.x, z: M.bunker.z, label: 'LISTENING POST', found: true }]
            : []),
          ...(this.hasItem('rounds')
            ? (this.vendors || []).filter((v) => !v.spent)
              .map((v) => ({ x: v.x, z: v.z, label: 'MACHINE', found: true }))
            : []),
        ],
        // named, so zooming in tells you which job is which
        jobs: jobs.map((j) => ({
          x: j.site.x, z: j.site.z, done: j.done,
          name: this._taskStage(j.id).name,
        })),
        temple: this.templeDoorPos,
        casino: this.casinoIn > 0.5 ? this.casinoPos : null,
        player: this.player.pos,
        facing: this.player.facing,
        wreck: this.wreckPos,
        rogue: this.rogueSandPos,
        hut: this.hutPos,
        shop: this.shopShut ? null : this.hutPos,
        cathy: this.cathy ? { x: this.cathy.x, z: this.cathy.z } : null,
        buried: (this.foundX && this.buried)
          ? { x: this.buried.x, z: this.buried.z, taken: this.buried.state.taken } : null,
        relics: [],
        fixes: (() => {
          const sab2 = M.view.sabotage;
          if (!sab2) return [];
          const def2 = SABOTAGE_DEFS[sab2.kind];
          return (def2?.fixAt || []).map((k2) => this._namedSite(k2)).filter(Boolean);
        })(),
        others: [...M.avatars.values()]
          .filter((a) => (M.view.players.get(a.id)?.alive !== false) && !this.amAlive)
          .map((a) => {
            const rec = M.view.players.get(a.id);
            const bx = M.speaker && now() < M.speaker.until ? M.speaker : null;
            const at = bx || rec?.decoy || a.pos;   // the box and the alibi both lie
            return { x: at.x, z: at.z, colour: colourHex(a.colour) };
          }),
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
      /* The belt. 1-9 uses what you are carrying — the one thing the game
         had no way of doing at all. */
      if (/^Digit[1-9]$/.test(e.code)) { this.useBeltSlot(+e.code.slice(5)); return; }
      if (e.code === 'KeyG') { this.togglePistol(); return; }
      if (e.code === 'KeyF') {
        if (this.pistolOut) this.fireFlare(); else this.tryKill();
        return;
      }
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
    for (const d of (this.mp.drops || [])) {
      if (d.taken) continue;
      if (Math.hypot(p.x - d.x, p.z - d.z) < 2.2) this._takePurse(d);
    }
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

  _takePurse(d) {
    if (d.taken) return;
    d.taken = true;
    d.mesh.visible = false;
    const got = this.doubleCoins ? d.coins * 2 : d.coins;
    this.coins = (this.coins || 0) + got;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('coin');
    this.ui.toast(`+${got} SYNCOIN`, 'gold', 1800);
    this.taskFx?.burst(d.x, heightAt(d.x, d.z), d.z, 0xffd24a, 'done', 3.2);
    this.player.punch?.(0.2);
    this._payInstalment();
  }

  _takeCoin(c) {
    c.taken = true;
    // black rum, and the falling down: every coin counts twice
    this.coins = (this.coins || 0) + (this.doubleCoins ? 2 : 1);
    this.wallet = this.coins;
    this.audio.sfx('coin');
    this.startCoinFlourish(c);
    this.ui.toast(`SYNCOIN  x${this.coins}`, 'gold', 1200);
    this.taskFx?.burst(c.x, heightAt(c.x, c.z), c.z, 0xffd24a, 'done', 2.4);
    this.player.punch?.(0.16);
    this._send({ t: C.PURSE, coins: this.coins });
    this._payInstalment();
  }

  /* =========================================================
     THE DAY'S SALE

     Ferdi marks one line down every morning, by as little as a tenth and
     as much as the whole price. He does not explain how he decides.
     ========================================================= */

  /** Pick the day's offer. Called on each dawn, and once at round start. */
  rollSale() {
    const M = this.mp;
    const open = STOCK.filter((i) => !i.night || (this.night || 0) > 0.5);
    const pool = open.length ? open : STOCK;
    const it = pool[(Math.random() * pool.length) | 0];
    if (!it) return;
    // ten to a hundred per cent, in fives, so the figure reads cleanly
    const cut = 10 + ((Math.random() * 19) | 0) * 5;
    M.sale = { id: it.id, cut, day: M.saleDay = (M.saleDay || 0) + 1, at: now() };
    this.ui.toast(`FERDI HAS MARKED SOMETHING DOWN ${cut}%`, 'gold', 4200);
    this.audio.sfx('stinger');

    /* ---- and the day's Schlarna line ----
       Somebody sold Ferdi a card reader. One item a day can be taken away in
       four parts instead of paid for; it is never the item that is already
       marked down, because two offers on one line is how a shop ends up
       giving things away. */
    const open2 = STOCK.filter((i) => i.side === 'open' && i.id !== it.id
      && (!i.night || (this.night || 0) > 0.5));
    if (open2.length) {
      const pick = open2[(Math.random() * open2.length) | 0];
      M.after = { id: pick.id };
    }
  }

  /* =========================================================
     SCHLARNA

     Four payments, no coins needed up front beyond the first, and a
     premium for the privilege. Ferdi does not know how the arrangement
     works either; he knows the reader beeps and the money turns up.
     ========================================================= */

  /** The full price of paying for something in parts. */
  schlarnaTotal(id) {
    const it = itemById(id);
    if (!it) return 0;
    return Math.max(SCHLARNA_N, Math.ceil(this.priceOf(id) * (1 + SCHLARNA_UP)));
  }

  /** What each of the four payments comes to. */
  schlarnaEach(id) { return Math.ceil(this.schlarnaTotal(id) / SCHLARNA_N); }

  /** Whether this line is on the plan today, and you are not already on one. */
  schlarnaOn(id) {
    return this.mp.after?.id === id && !this.plan
      && !(this.owned?.has(id) && itemById(id)?.tag === 'PASSIVE');
  }

  /** Take something away now and settle it over the round. */
  buySchlarna(id) {
    const it = itemById(id);
    if (!it || !this.schlarnaOn(id)) { this.audio.sfx('deny'); return false; }
    const each = this.schlarnaEach(id);
    if ((this.coins || 0) < each) {
      this.audio.sfx('deny');
      this.ui.toast(`THE FIRST PAYMENT IS ${each} SYNCOIN`, 'bad', 2200);
      return false;
    }
    this.coins -= each;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('confirm');
    this.audio.sfx('coin');

    if (it.tag === 'PASSIVE') { this.owned = this.owned || new Set(); this.owned.add(id); }
    else this.carry = [...(this.carry || []), id];
    if (PASSIVE_AT_BUY.has(id)) this.applyItem(id);

    this.plan = {
      id, name: it.name, each,
      left: SCHLARNA_N - 1,
      owed: this.schlarnaTotal(id) - each,
    };
    this.mp.after = null;                    // one a day, and it has gone
    this.ui.showPopup(it.name,
      `${SCHLARNA_N - 1} PAYMENTS OF ${each} LEFT`, 'coin', 'SCHLARNA');
    return true;
  }

  /**
   * A payment comes out of the next money you earn.
   *
   * Half of whatever lands in your purse goes to the plan until it is
   * settled, which means the debt is real without ever being able to leave
   * you unable to move: you always keep half of everything you find.
   */
  _payInstalment() {
    const pl = this.plan;
    if (!pl || !this.coins) return;
    const take = Math.min(this.coins, pl.each, Math.max(1, Math.ceil(this.coins / 2)));
    if (take <= 0) return;
    this.coins -= take;
    pl.owed -= take;
    this._send({ t: C.PURSE, coins: this.coins });
    if (pl.owed <= 0) {
      this.plan = null;
      this.ui.toast('SCHLARNA IS SETTLED', 'jade', 3000);
      this.audio.sfx('confirm');
    } else {
      pl.left = Math.ceil(pl.owed / pl.each);
      this.ui.toast(`SCHLARNA TOOK ${take} - ${pl.owed} LEFT`, 'bad', 2200);
      this.audio.sfx('select');
    }
  }

  /** What this item costs right now. */
  priceOf(id) {
    const it = itemById(id);
    if (!it) return 0;
    const sale = this.mp.sale;
    if (!sale || sale.id !== id) return it.cost;
    return Math.max(0, Math.round(it.cost * (1 - sale.cut / 100)));
  }

  /** Buy something. Nothing here is a number you cannot feel. */
  buyItem(id) {
    const it = itemById(id);
    if (!it) return false;
    this.owned = this.owned || new Set();
    if (this.owned.has(id) && (it.tag === 'PASSIVE' || it.once)) {
      this.audio.sfx('deny');
      this.ui.toast('YOU HAVE ALREADY HAD THAT', 'bad', 1600);
      return false;
    }
    const price = this.priceOf(id);
    if ((this.coins || 0) < price) {
      this.audio.sfx('deny');
      this.ui.toast('NOT ENOUGH SYNCOIN', 'bad', 1600);
      return false;
    }
    this.coins -= price;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('confirm');
    this.audio.sfx('coin');

    /* Food is eaten at the counter. It does not go on your belt: there is
       no version of this where you carry a burger around and press 4. */
    const isFood = FOOD.some((f) => f.id === id);
    if (it.tag === 'PASSIVE' || it.once) this.owned.add(id);
    else if (isFood) { /* the floss is eaten and gone */ }
    else this.carry = [...(this.carry || []), id];
    if (isFood) {
      this.applyFood(id);
      this.ui.showPopup(it.name, 'EATEN', 'coin', 'CATHY SAYS');
      return true;
    }

    /* Passives take effect the moment they are bought. Everything else goes
       on your belt and waits for you.

       It used to all fire at the counter — you bought the boombox and it
       was already on the sand, you bought the whistle and it had already
       blown. That is why there was no way to use the flare pistol: there
       was no concept of using anything. */
    if (PASSIVE_AT_BUY.has(id)) this.applyItem(id);

    /* One card, not a card AND a toast. Buying three things in a row used
       to stack four toasts under a popup that covered their right-hand
       ends, so every message was cut off mid-word. */
    const belt = BELT_IDS.includes(id);
    const slot = belt ? this.beltSlots().findIndex((sl) => sl.id === id) + 1 : 0;
    this.ui.showPopup(
      it.name,
      belt ? `PRESS ${slot} TO USE IT` : (it.side === 'black' ? 'NOTHING WAS SOLD HERE' : 'IN FORCE NOW'),
      'coin', 'FERDI SAYS'
    );
    return true;
  }

  /** What an item actually does. Called at the counter, or off the belt. */
  applyItem(id) {
    // Cathy's food does the same thing in both modes, so it lives on Game
    if (FOOD.some((f) => f.id === id)) this.applyFood(id);
    if (id === 'soles') this._send({ t: C.PERK, perk: 'quiet', on: true });
    if (id === 'vest') {
      this._send({ t: C.PERK, perk: 'vest', on: true });
      /* Cork and canvas over your chest is heavy. A quarter off both your
         walk and your sprint is the price of the strike it eats. */
      this.player.SPEED = this.player.BASE_SPEED * 0.75;
      this.player.SPRINT = this.player.BASE_SPRINT * 0.75;
      this.ui.toast('THE VEST IS HEAVY - YOU ARE 25% SLOWER', 'jade', 3200);
    }
    if (id === 'chart') {
      this.knowsBunker = true;
      // the compass has to be told, or the marker only appears the next
      // time something else happens to rebuild it
      this._compassForTasks();
      const b = this.mp.bunker;
      this.ui.toast(b ? `THE POST: ${b.name}` : 'THE POST IS ON YOUR MAP', 'jade', 3200);
    }
    if (id === 'whetstone' && this.mp.myKillReady) {
      this.mp.myKillReady -= Math.max(0, (this.mp.myKillReady - now()) * 0.34);
    }
    if (id === 'lantern') this.ui.toast('THE LANTERN IS LIT', 'jade', 2000);
    if (id === 'spyglass') this.ui.toast('YOU CAN READ THEM FROM 68 METRES', 'jade', 2600);
    if (id === 'nightglass') this.ui.toast('THE DARK STOPS MATTERING', 'jade', 2600);
    if (id === 'rounds') {
      // his delivery notes: both outlying machines, on the map and compass
      this._compassForTasks();
      this.ui.toast(`${(this.vendors || []).length} MACHINES MARKED`, 'jade', 3000);
    }
  }

  /* =========================================================
     THE BELT

     Everything you are carrying, in the order you bought it, on the
     number keys. Consumables sit here until you decide the moment.
     ========================================================= */

  /** What is on the belt right now, grouped, in a stable order. */
  beltSlots(out = (this._belt = this._belt || [])) {
    out.length = 0;
    const seen = new Map();
    for (const id of (this.carry || [])) {
      const at = seen.get(id);
      if (at !== undefined) { out[at].count++; continue; }
      const it = itemById(id);
      if (!it) continue;
      seen.set(id, out.length);
      out.push({ id, icon: it.icon, name: it.name, count: 1, active: false });
    }
    // the pistol shows whether it is drawn
    for (const sl of out) if (sl.id === 'gun') sl.active = !!this.pistolOut;
    /* A running alibi keeps a slot of its own so there is somewhere to press
       to end it. It is not an item you hold — it is a thing that is
       happening to you. */
    if (this.alibiUntil && now() < this.alibiUntil) {
      out.push({
        id: 'alibi-live', icon: 'alibi', name: 'ALIBI RUNNING',
        count: 1, active: true, secs: Math.ceil(this.alibiUntil - now()),
      });
    } else if (this.alibiUntil) {
      this.alibiUntil = 0;
    }
    return out;
  }

  /**
   * Use slot n (1-based). The pistol draws and holsters rather than firing,
   * because firing it is a shot you have to aim; a live alibi is dropped
   * rather than bought again.
   */
  useBeltSlot(n) {
    if (!this.amAlive || this.screens.open) return;
    const slots = this.beltSlots();
    const sl = slots[n - 1];
    if (!sl) { this.audio.sfx('deny'); return; }
    if (sl.id === 'gun') { this.togglePistol(); return; }
    if (sl.id === 'alibi-live') { this.endAlibi(); return; }
    this.useItem(sl.id);
  }

  /** Drop the lie. Three minutes is a long time to be somewhere you are not. */
  endAlibi() {
    if (!this.alibiUntil) return;
    this.alibiUntil = 0;
    this._send({ t: C.PERK, perk: 'alibi', on: false });
    this.audio.sfx('confirm');
    this.ui.toast('YOUR MARKER IS BACK WHERE YOU ARE', 'jade', 2600);
  }

  /* =========================================================
     ONE OF FERDI'S MACHINES
     ========================================================= */

  /**
   * Take the money and decide what comes out. Returns the item, or null if
   * it cannot be paid for — the screen turns the drum, then calls
   * vendDeliver when the drum stops.
   */
  vendPay(vendor) {
    const COST = 6;
    if (vendor && vendor.spent) return null;
    if ((this.coins || 0) < COST) {
      this.ui.toast('NOT ENOUGH SYNCOIN', 'bad', 1600);
      return null;
    }
    this.coins -= COST;
    this._send({ t: C.PURSE, coins: this.coins });
    const pool = VENDOR_IDS.map((id) => itemById(id)).filter(Boolean);
    return pool[(Math.random() * pool.length) | 0] || null;
  }

  /** The drum has stopped: hand it over and empty the machine. */
  vendDeliver(item) {
    if (!item) return;
    const it = itemById(item.id) || item;
    if (it.tag === 'PASSIVE') {
      this.owned = this.owned || new Set();
      this.owned.add(it.id);
      this.applyItem(it.id);
    } else {
      this.carry = [...(this.carry || []), it.id];
    }
    const near = this.nearestInteractable?.();
    const v = near && near.kind === 'mpVendor' ? near.vendor : null;
    for (const vd of (this.vendors || [])) {
      if (v && vd !== v) continue;
      if (Math.hypot(this.player.pos.x - vd.x, this.player.pos.z - vd.z) < 4.5) {
        vd.spent = true;
        vd.node?.userData?.vend?.(0xffd24a);
        if (vd.node) vd.node.userData.empty = true;
      }
    }
    const belt = BELT_IDS.includes(it.id);
    const slot = belt ? this.beltSlots().findIndex((sl) => sl.id === it.id) + 1 : 0;
    this.ui.showPopup(it.name, belt ? `PRESS ${slot} TO USE IT` : 'IN FORCE NOW',
      'coin', 'THE MACHINE GAVE YOU');
  }

  /** Spend one carried item. */
  useItem(id) {
    if (!this.useCarried(id)) { this.audio.sfx('deny'); return false; }
    const it = itemById(id);

    if (id === 'skeleton') {
      this.enterBunker();
    } else if (id === 'chaff') {
      this._send({ t: C.PERK, perk: 'chaff', on: true });
      this.audio.sfx('terminal');
      this.audio.sfx('alert');
      this.ui.toast('THE COMMAND TABLE IS DOWN FOR SIXTY SECONDS', 'jade', 3400);
    } else if (id === 'flask') {
      this.flask = true;
      this.audio.sfx('heal');
      this.ui.toast('YOUR NEXT JOB IS DONE ON SIGHT', 'jade', 2600);
    } else if (id === 'speaker') {
      this.dropSpeaker();
    } else if (id === 'whistle') {
      /* Twelve seconds of everybody, anywhere, seeing your name over your
         head. An alibi you can prove, and a thing you can only do once. */
      this._send({ t: C.PERK, perk: 'whistle', on: true });
      this.audio.sfx('stinger');
      this.ui.toast('EVERY EYE ON THE ISLAND', 'jade', 2600);
    } else if (id === 'shroud') {
      /* Forty-five seconds of simply not being on the table. Different from
         chaff: chaff moves everybody, this removes one person. */
      this._send({ t: C.PERK, perk: 'shroud', on: true });
      this.audio.sfx('descend');
      this.ui.toast('YOU ARE OFF THE TABLE FOR 45 SECONDS', 'jade', 3000);
    } else if (id === 'blackout') {
      this._send({ t: C.PERK, perk: 'blackout', on: true });
      this.audio.sfx('slam');
      this.ui.toast('EVERY FIRE ON THE ISLAND IS OUT', 'jade', 3000);
    } else if (id === 'ticket') {
      // a book of three, so using one leaves two on the belt
      this.freePulls = (this.freePulls || 0) + 3;
      this.audio.sfx('coin');
      this.ui.toast(`${this.freePulls} FREE PULLS ON THE FLOPPER`, 'jade', 2600);
    } else if (id === 'alibi') {
      /* A decoy on everybody else's chart and on the command table, for
         twenty seconds. It has to be somewhere plausible — a place people
         go — or the lie tells itself. */
      const spots = [this.wreckPos, this.hutPos, this.templeDoorPos, this.casinoPos]
        .filter(Boolean);
      const pick = spots[(Math.random() * spots.length) | 0] || { x: 0, z: 0 };
      const jx = pick.x + (Math.random() - 0.5) * 22;
      const jz = pick.z + (Math.random() - 0.5) * 22;
      this._send({ t: C.PERK, perk: 'alibi', on: true, x: +jx.toFixed(1), z: +jz.toFixed(1) });
      this.alibiUntil = now() + 180;
      this.audio.sfx('cast');
      this.ui.toast('THEY WILL SWEAR YOU WERE ELSEWHERE - PRESS AGAIN TO DROP IT', 'jade', 4200);
    } else {
      // anything without its own moment just takes effect
      this.applyItem(id);
      this.audio.sfx('confirm');
      if (it) this.ui.toast(it.name, 'jade', 1800);
    }
    return true;
  }

  hasItem(id) { return !!this.owned?.has(id) || !!this.carry?.includes(id); }

  useCarried(id) {
    if (!this.carry?.includes(id)) return false;
    this.carry.splice(this.carry.indexOf(id), 1);
    return true;
  }

  /**
   * In Castaways there are no coconuts to throw, so the left button is
   * free: with the pistol drawn it fires, otherwise it is the same reach
   * as E. That, plus the belt, is how a flare pistol becomes a thing you
   * can use rather than a thing you own.
   */
  throwCoconut() {
    if (!this.mp.active) return super.throwCoconut();
    if (this.pistolOut) { this.fireFlare(); return; }
    this.interact();
  }

  /* =========================================================
     THE FLARE PISTOL
     ========================================================= */
  togglePistol() {
    if (!this.hasItem('gun')) { this.audio.sfx('deny'); return; }
    if (this.stunnedUntil && now() < this.stunnedUntil) return;
    this.pistolOut = !this.pistolOut;
    if (!this.pistolModel) {
      this.pistolModel = buildPistol();
      /* In the player's hand, not on the camera. Bolted to the camera it
         sits ten centimetres from the near plane and, in the third-person
         view this game actually uses, it filled the screen with a white
         slab. In the hand it reads correctly from behind and it is still
         roughly where your eye expects it in first person. */
      const hand = this.player?.parts?.arms?.r;
      if (hand) {
        this.pistolModel.position.set(0, -0.42, 0.06);
        this.pistolModel.rotation.set(-Math.PI / 2 + 0.25, 0, 0);
        this.pistolModel.scale.setScalar(1.15);
        hand.add(this.pistolModel);
      } else {
        this.pistolModel.position.set(0.16, -0.14, -0.34);
        this.camera.add(this.pistolModel);
        if (!this.camera.parent) this.islandScene.add(this.camera);
      }
    }
    this.pistolModel.visible = this.pistolOut;
    this.audio.sfx(this.pistolOut ? 'charge' : 'select');
    this.ui.toast(this.pistolOut ? 'FLARE PISTOL  -  CLICK OR F TO FIRE' : 'HOLSTERED', 'gold', 2200);
  }

  /** Whoever is nearest the middle of the screen, within range. */
  _flareTarget() {
    const M = this.mp;
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const eye = cam.position;
    let best = null, bestDot = 0.93;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      const to = new THREE.Vector3(av.pos.x - eye.x, av.pos.y + 1 - eye.y, av.pos.z - eye.z);
      const d = to.length();
      if (d > 34) continue;
      to.normalize();
      const dot = to.dot(fwd);
      if (dot > bestDot) { bestDot = dot; best = av; }
    }
    return best;
  }

  fireFlare() {
    const M = this.mp;
    if (!this.pistolOut || !this.amAlive || M.view.phase !== PHASE.ROAM) return;
    if (M.snap) { this.audio.sfx('deny'); return; }
    const target = this._flareTarget();
    if (!target) {
      this.audio.sfx('deny');
      this.ui.toast('NOBODY IN YOUR SIGHTS', 'bad', 1400);
      return;
    }
    if (!this.useCarried('gun')) { this.audio.sfx('deny'); return; }

    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const from = cam.position.clone().addScaledVector(dir, 0.6);
    this.flares.fire(from, dir, () => {});
    this.audio.sfx('slam');
    this.audio.sfx('cast');
    this.player.punch?.(0.9);
    if (this.pistolModel) {
      this.pistolModel.userData.flare.visible = false;
      this.pistolModel.userData.glow.intensity = 6;
      setTimeout(() => { if (this.pistolModel) this.pistolModel.userData.glow.intensity = 0; }, 220);
    }
    this.pistolOut = false;
    if (this.pistolModel) this.pistolModel.visible = false;
    this._send({ t: C.SHOOT, targetId: target.id });
  }

  _onShot(byId, victimId, at, secs) {
    const M = this.mp;
    const rec = M.view.players.get(victimId);
    this.dizzy?.add(victimId, colourHex(rec?.colour));
    M.stunned = M.stunned || new Map();
    M.stunned.set(victimId, now() + secs);
    this.audio.sfx('bossHit');
    this.taskFx?.burst(at.x, heightAt(at.x, at.z), at.z, 0xff9a3a, 'done', 5.0);
    if (victimId === M.view.selfId) {
      this.stunnedUntil = now() + secs;
      this.pistolOut = false;
      if (this.pistolModel) this.pistolModel.visible = false;
      this.player.punch?.(1);
      this.pipeline.tint.setHex(0xffb060);
      this.pipeline.tintAmt = 0.9;
      this.ui.showPopup('YOU ARE SEEING STARS', 'THEY ARE DECIDING ABOUT YOU', 'coin', 'FLARED');
    } else {
      this.ui.toast(`${rec?.name || 'SOMEBODY'} IS DOWN`, 'bad', 2400);
    }
  }

  _onSnapOpen(victimId, byId, secs, voters) {
    const M = this.mp;
    const me = M.view.selfId;
    M.snap = {
      victimId, byId, endsAt: now() + secs,
      voters: voters || [], yes: 0, no: 0, need: Math.floor((voters || []).length / 2) + 1,
      mine: null,
    };
    if ((voters || []).includes(me)) {
      this.screens.replace('mpSnap', {});
      document.exitPointerLock?.();
      this.audio.sfx('stinger');
    }
  }

  _onSnapTally(yes, no, need) {
    if (!this.mp.snap) return;
    this.mp.snap.yes = yes; this.mp.snap.no = no; this.mp.snap.need = need;
    this.audio.sfx('select');
  }

  _onSnapDone(victimId, exiled, wasAgent, yes, no) {
    const M = this.mp;
    M.snap = null;
    this.dizzy?.remove(victimId);
    M.stunned?.delete(victimId);
    if (victimId === M.view.selfId) this.stunnedUntil = 0;
    if (this.screens.name === 'mpSnap') this.screens.clear();
    const rec = M.view.players.get(victimId);
    if (exiled) {
      this.screens.replace('mpExile', {
        line: '', wasAgent, targetId: victimId, who: rec?.name || '?',
      });
      setTimeout(() => { if (this.screens.name === 'mpExile') { this.screens.clear(); this.ui.show(); } }, 8000);
    } else {
      this.ui.toast(`THE VOTE FAILED  ${yes}-${no}`, 'gold', 3000);
      this.audio.sfx('deny');
    }
  }

  sendSnap(yes) {
    if (this.mp.snap) this.mp.snap.mine = !!yes;
    this._send({ t: C.SNAP, yes: !!yes });
    this.audio.sfx('confirm');
  }

  /* =========================================================
     THE LISTENING POST
     ========================================================= */
  enterBunker() {
    const M = this.mp;
    if (this.state !== 'island') return;
    M.bunker?.node.userData.setOpen(true);
    this.state = 'bunker';
    this.scene = this.bunkerScene;
    this.player.mesh.removeFromParent();
    this.bunkerScene.add(this.player.mesh);
    /* The room's own furniture. This said setColliders([]) for far too
       long, which is why the command table, the crate stack and the whole
       bank of lockers were scenery you strolled straight through. */
    this.player.setColliders(BUNKER_COLLIDERS);
    /* Facing into the room. Arriving with your back to the ladder wall put
       the camera through the concrete before its collision could pull it
       in, and the first thing you saw was the outside of the world. */
    this.player.insideBox = BUNKER_BOX;
    this.player.teleport(0, 1.0, -3.4, Math.PI);
    this.player.pitch = -0.05;
    /* Going down should sound like going down: the lid comes off, the
       rungs go past under you, and the island stops. */
    this.audio.sfx('hatch');
    this.audio.sfx('descend');
    setTimeout(() => { if (this.state === 'bunker') this.audio.sfx('ladder'); }, 380);
    setTimeout(() => { if (this.state === 'bunker') this.audio.sfx('terminal'); }, 1500);
    this.audio.playMusic('bunker');
    // a moment of black at the bottom of the ladder
    this.pipeline.tint.setHex(0x000000);
    this.pipeline.tintAmt = 0.85;
    this._rehomeAvatars();
    this.ui.toast('THE LISTENING POST', 'jade', 2600);
  }

  /* =========================================================
     THE HIGH ROLLERS ROOM
     ========================================================= */
  enterHighRoller() {
    if (this.state !== 'island') return;
    if (!this.hrScene) return;
    this.state = 'highroller';
    this.scene = this.hrScene;
    this.player.mesh.removeFromParent();
    this.hrScene.add(this.player.mesh);
    this.player.setColliders(HR_COLLIDERS);
    this.player.insideBox = HR_BOX;
    // you arrive through the door, facing the table
    this.player.teleport(0, 1.0, 9.4, Math.PI);
    this.player.pitch = -0.04;
    this.audio.sfx('door');
    this.audio.sfx('descend');
    this.audio.playMusic('highroller');
    this.pipeline.tint.setHex(0x000000);
    this.pipeline.tintAmt = 0.8;
    this._rehomeAvatars();
    this.ui.clearToasts?.();
    this.ui.showPopup('HIGH ROLLERS', 'M. BEEF PRESIDING', 'coin', 'BEHIND THE PICTURE');
  }

  leaveHighRoller() {
    if (this.state !== 'highroller') return;
    /* A moment's grace before the frame will swallow you again, or stepping
       out onto the deck puts you straight back in. */
    this._hrCooldown = true;
    setTimeout(() => { this._hrCooldown = false; }, 2200);
    this.state = 'island';
    this.scene = this.islandScene;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    this.player.insideBox = null;
    this._backOnDeck();
    this._rehomeAvatars();
    this.audio.sfx('door');
    this.audio.playMusic(this.night > 0.55 ? 'night' : 'island');
    this.pipeline.tint.setHex(0xffffff);
    this.pipeline.tintAmt = 0.4;
  }

  /* =========================================================
     THE X

     Digging is HELD, not tapped. The sand comes up in a ring, the hole
     deepens, and two thirds of the way down the chest breaks the surface
     and starts to rise. Walk away and it stays exactly as deep as you left
     it, so somebody else can finish it — or find it half done and wonder.
     ========================================================= */
  _tickDig(dt) {
    const bu = this.buried;
    if (!bu) return;
    const st = bu.state;
    if (st.dug >= 1 || st.taken) { bu.digging = 0; return; }
    const p = this.player.pos;
    const near = Math.hypot(p.x - bu.x, p.z - bu.z) < 3.2;
    const want = near && this.mp.holdingE && this.amAlive
      && !this.screens.open && this.mp.view.phase === PHASE.ROAM;
    if (!want) {
      bu.digging = 0;
      return;
    }
    bu.digging += dt;
    st.dug = Math.min(1, st.dug + dt / DIG_SECONDS);
    // a spadeful every third of a second, and sand off the shovel
    if (bu.digging - (bu.lastSpade || 0) > 0.34) {
      bu.lastSpade = bu.digging;
      this.audio.sfx('step_sand');
      this.taskFx?.burst(bu.x, bu.y + 0.3, bu.z, 0xd8c79c, 'puff', 1.1);
      this.player.punch?.(0.05);
    }
    if (st.dug >= 1 && !bu.said) {
      bu.said = true;
      this.audio.sfx('confirm');
      this.audio.sfx('rumble');
      this.ui.showPopup('A CHEST', 'IT IS NOT LOCKED', 'coin', 'OUT OF THE SAND');
    } else if (st.dug > 0.62 && !bu.saidHalf) {
      bu.saidHalf = true;
      this.audio.sfx('stinger');
      this.ui.toast('SOMETHING IS COMING UP', 'gold', 2600);
    }
  }

  /** Open it. Gold, and one thing that is not gold. */
  openChest() {
    const bu = this.buried;
    if (!bu || bu.state.taken || bu.state.dug < 1) { this.audio.sfx('deny'); return; }
    bu.state.taken = true;
    // the lid swings over the next second, in the node's own tick
    const swing = setInterval(() => {
      bu.state.open = Math.min(1, bu.state.open + 0.06);
      if (bu.state.open >= 1) clearInterval(swing);
    }, 16);
    this.audio.sfx('hatch');
    this.audio.sfx('jackpot');

    /* Enough to matter and not enough to end the round: between twenty and
       forty, which is a night at Ferdi's or a very good night at the
       Flopper. */
    const gold = 20 + ((Math.random() * 21) | 0);
    this.coins = (this.coins || 0) + gold;
    this._send({ t: C.PURSE, coins: this.coins });
    this.taskFx?.burst(bu.x, bu.y + 1.0, bu.z, 0xffd24a, 'done', 5.0);
    this.player.punch?.(0.28);

    /* And one thing off Ferdi's shelf, free. Never the flare pistol — a
       free gun found in a hole is not a thing this round needs. */
    const pool = STOCK.filter((i) => i.side === 'open' && i.id !== 'gun'
      && !(this.owned?.has(i.id)));
    const prize = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    if (prize) {
      this.owned = this.owned || new Set();
      if (prize.tag === 'PASSIVE') this.owned.add(prize.id);
      else this.carry = [...(this.carry || []), prize.id];
      if (PASSIVE_AT_BUY.has(prize.id)) this.applyItem(prize.id);
    }
    /* The card names the prize, so a toast saying it again is two messages
       for one event — and "AND A THE PARTY BOX" is not a sentence. */
    this.ui.clearToasts?.();
    this.ui.showPopup(`${gold} SYNCOIN`, prize ? prize.name : 'AND NOTHING ELSE',
      'coin', 'THE CHEST');
  }

  /* =========================================================
     WHAT YOU DRANK

     Everything Quezetriel sells runs on one clock and one set of counters,
     so a second drink extends the first rather than fighting it, and there
     is exactly one place that decides when it all wears off.
     ========================================================= */
  buyDrink(id) {
    const d = drinkById(id);
    if (!d) return false;
    if ((this.coins || 0) < d.cost) {
      this.audio.sfx('deny');
      this.ui.toast('NOT ENOUGH SYNCOIN', 'bad', 1600);
      return false;
    }
    this.coins -= d.cost;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('coin');
    this.rounds = (this.rounds || 0) + 1;

    const until = now() + d.mins * 60;
    this.tab = this.tab || {};
    // a second of the same extends it; a different one runs alongside
    this.tab[id] = Math.max(this.tab[id] || 0, until);
    this._applyDrink(id, d);
    if (d.drunk) {
      this.drunkUntil = Math.max(this.drunkUntil || 0, until);
      this.drunkPeak = Math.min(1, Math.max(this.drunkPeak || 0, d.drunk));
    }
    return true;
  }

  _applyDrink(id, d) {
    if (id === 'pint') {
      const half = this.player.BASE_DRAIN * 0.5;
      this.player.staminaDrain = Math.min(this.player.staminaDrain, half);
      this.ui.toast('SPRINTING COSTS HALF', 'jade', 2600);
    }
    if (id === 'lamp') {
      this.nightEyes = true;
      this.ui.toast('THE DARK STOPS MATTERING', 'jade', 2600);
    }
    if (id === 'quiet') {
      this._send({ t: C.PERK, perk: 'quiet', on: true });
      this.ui.toast('YOUR FEET MAKE NO SOUND', 'jade', 2600);
    }
    if (id === 'rum' || id === 'falling') {
      this.doubleCoins = true;
      this.ui.toast('EVERY SYNCOIN COUNTS TWICE', 'jade', 2600);
    }
    if (id === 'own' || id === 'falling') {
      this.bigMeals = true;
      this.player.SPEED = this.player.BASE_SPEED * 1.25;
      this.player.SPRINT = this.player.BASE_SPRINT * 1.25;
      this.ui.toast('FASTER, AND THE WORK PAYS DOUBLE', 'jade', 2800);
    }
    if (id === 'falling') {
      this.player.staminaDrain = Math.min(this.player.staminaDrain, this.player.BASE_DRAIN * 0.5);
      this.nightEyes = true;
      this._send({ t: C.PERK, perk: 'quiet', on: true });
    }
  }

  /** One clock for the whole tab. Called every frame from update(). */
  _tickDrink(dt) {
    const t = now();
    const tab = this.tab;
    if (tab) {
      for (const id of Object.keys(tab)) {
        if (t < tab[id]) continue;
        delete tab[id];
        this._endDrink(id);
      }
      if (!Object.keys(tab).length) this.tab = null;
    }
    /* The room settles rather than snapping straight: the last thirty
       seconds of a drink are it wearing off, which is when you notice you
       had it. */
    let want = 0;
    if (this.drunkUntil && t < this.drunkUntil) {
      const left = this.drunkUntil - t;
      want = (this.drunkPeak || 0.5) * Math.min(1, left / 25);
    } else if (this.drunkUntil) {
      this.drunkUntil = 0;
      this.drunkPeak = 0;
      this.ui.toast('YOUR HEAD CLEARS', 'jade', 2600);
    }
    const cur = this.pipeline.drunk || 0;
    this.pipeline.drunk = cur + (want - cur) * Math.min(1, dt * 1.4);
    /* And it is not only a picture: drunk, you do not walk where you point.
       The sway is slow enough to steer through and fast enough to be a
       nuisance, which is the whole trade. */
    this.player.drift = this.pipeline.drunk > 0.02
      ? Math.sin(t * 0.9) * 0.30 * this.pipeline.drunk : 0;
  }

  _endDrink(id) {
    const d = drinkById(id);
    if (id === 'pint' || id === 'falling') {
      // back to whatever you had before the drink, popcorn included
      this.player.staminaDrain = this.hasItem('tonic')
        ? this.player.BASE_DRAIN * 0.2 : this.player.BASE_DRAIN;
    }
    if (id === 'lamp' || id === 'falling') this.nightEyes = this.hasItem('nightglass') || false;
    if (id === 'quiet' || id === 'falling') {
      if (!this.hasItem('soles')) this._send({ t: C.PERK, perk: 'quiet', on: false });
    }
    if (id === 'rum' || id === 'falling') this.doubleCoins = false;
    if (id === 'own' || id === 'falling') {
      if (!this.hasItem('burger')) this.bigMeals = false;
      const vest = this.hasItem('vest') ? 0.75 : 1;
      const floss = this.flossUntil && now() < this.flossUntil ? 1.30 : 1;
      this.player.SPEED = this.player.BASE_SPEED * vest * floss;
      this.player.SPRINT = this.player.BASE_SPRINT * vest * floss;
    }
    if (d) this.ui.toast(`${d.name} HAS WORN OFF`, 'bad', 2400);
  }

  /* =========================================================
     THE BAR

     Through the west door of the high rollers room. Quezetriel Quebolius
     keeps it. He sells drink, he plays darts for money, and he has never
     once been asked what he is.
     ========================================================= */
  enterBar() {
    if (this.state !== 'highroller') return;
    if (!this.barScene) return;
    this.state = 'bar';
    this.scene = this.barScene;
    this.player.mesh.removeFromParent();
    this.barScene.add(this.player.mesh);
    this.player.setColliders(BAR_COLLIDERS);
    this.player.insideBox = BAR_BOX;
    // in through the door, facing across the room at the bar
    this.player.teleport(BAR_ENTRY.x, BAR_ENTRY.y, BAR_ENTRY.z, -Math.PI / 2);
    this.player.pitch = -0.02;
    this._barCooldown = true;
    setTimeout(() => { this._barCooldown = false; }, 1800);
    this.audio.sfx('door');
    this.audio.playMusic('bar');
    this.pipeline.tint.setHex(0xffa040);
    this.pipeline.tintAmt = 0.7;
    this._rehomeAvatars();
    /* One card, not two toasts on top of the two the room next door already
       put up. Four stacked messages was most of the screen. */
    this.ui.clearToasts?.();
    this.ui.showPopup('THE SALOON', 'QUEBOLIUS, PROPRIETOR', 'coin', 'THROUGH THE DOOR');
  }

  leaveBar() {
    if (this.state !== 'bar') return;
    this.state = 'highroller';
    this.scene = this.hrScene;
    this.player.mesh.removeFromParent();
    this.hrScene.add(this.player.mesh);
    this.player.setColliders(HR_COLLIDERS);
    this.player.insideBox = HR_BOX;
    this.player.teleport(HR_BAR_RETURN.x, HR_BAR_RETURN.y, HR_BAR_RETURN.z, HR_BAR_RETURN.yaw);
    this.player.pitch = 0;
    this._barCooldown = true;
    setTimeout(() => { this._barCooldown = false; }, 1800);
    this.audio.sfx('door');
    this.audio.playMusic('highroller');
    this.pipeline.tint.setHex(0x000000);
    this.pipeline.tintAmt = 0.6;
    this._rehomeAvatars();
  }

  /**
   * Put you back on the Flopper's deck.
   *
   * This used to be `casino.localToWorld(0, 0, 6.4)`, and it dropped you in
   * the sea. The boat's matrixWorld is only refreshed when the island scene
   * is RENDERED, and the island is not rendered at all while you are in the
   * high rollers room — so after a few seconds inside, the matrix was
   * wherever she had been when you walked through the picture, and she had
   * sailed on without it. Coming out at dawn put you a hundred metres astern
   * of her, over forty feet of water.
   *
   * casinoPlat is the deck's own frame and _sailCasino keeps it current
   * every frame, boat or no boat, so it is the thing to ask.
   *
   * And it has to come out FORWARD of the picture, not aft of it. The
   * cabin is a solid box from local z 4 to z 10 and the portrait hangs on
   * its front — so nine metres along the deck was nine metres INSIDE the
   * deckhouse, which is why stepping out of the high rollers room put you
   * in a little wooden room instead of on the open deck. The open deck, the
   * rails, the torches and the slot machines are all at negative z.
   */
  _backOnDeck(lz = -1.2) {
    const plat = this.casinoPlat;
    if (!plat) {
      // no boat: the pier head, which is the only other place that makes sense
      const sh = this.casinoShore;
      if (sh) this.player.teleport(sh.x, heightAt(sh.x, sh.z) + 0.8, sh.z, 0);
      return;
    }
    const wx = plat.x + lz * plat.sin;
    const wz = plat.z + lz * plat.cos;
    // facing forward, down the open deck at the water, with the cabin behind
    this.player.teleport(wx, plat.y + 0.35, wz, Math.atan2(-plat.sin, -plat.cos));
    this.player.pitch = 0;
  }

  /** In a round there is paid work, so the burger is on the counter too. */
  foodList() { return FOOD; }

  /* ---------- darts ---------- */
  /** Put a stake up. The screen has already checked you can cover it. */
  dartsStake(n) {
    if ((this.coins || 0) < n) return false;
    this.coins -= n;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('coin');
    return true;
  }

  /** Settle a leg. `pays` is the whole pot, or nought. */
  dartsSettle(pays) {
    if (!pays) {
      this.audio.sfx('deny');
      return;
    }
    this.coins = (this.coins || 0) + pays;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('jackpot');
    this.ui.toast(`+${pays} SYNCOIN`, 'gold', 2400);
  }

  /* ---------- the table ---------- */
  /** The rules, handed to the screen so it never implements any itself. */
  get bjRules() { return BJ; }

  /** Take a stake. Returns false if the purse cannot cover it. */
  bjStake(n) {
    if ((this.coins || 0) < n) return false;
    this.coins -= n;
    this._send({ t: C.PURSE, coins: this.coins });
    return true;
  }

  /** Pay a round out. The stake has already been taken. */
  bjSettle(pays) {
    if (!pays) return;
    this.coins = (this.coins || 0) + pays;
    this._send({ t: C.PURSE, coins: this.coins });
  }

  leaveBunker() {
    const M = this.mp;
    if (this.state !== 'bunker') return;
    this.state = 'island';
    this.scene = this.islandScene;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    const b = M.bunker;
    if (b) this.player.teleport(b.x + 2.6, heightAt(b.x + 2.6, b.z) + 0.8, b.z, 0);
    M.bunker?.node.userData.setOpen(false);
    this._rehomeAvatars();
    this.audio.sfx('ladder');
    setTimeout(() => { if (this.state === 'island') this.audio.sfx('hatch'); }, 700);
    this.pipeline.tint.setHex(0xffffff);
    this.pipeline.tintAmt = 0.5;
    this.audio.playMusic(this.night > 0.55 ? 'night' : 'island');
  }

  /**
   * Interpolate every avatar and decide whether it can be seen.
   *
   * This used to live inside the island branch of update(), after the
   * interior branches had already returned — so anybody who followed you down
   * the ladder stood perfectly still, because nothing was advancing their
   * interpolation.
   */
  _updateAvatars(dt) {
    const M = this.mp;
    const t = now();
    const ghost = !this.amAlive;
    const mine = this.roomId;
    for (const av of M.avatars.values()) {
      av.update(dt, t);
      const rec = M.view.players.get(av.id);
      // the dead can see the dead; the living cannot — and nobody sees
      // anybody who is in a different room from them
      const alive = rec ? (rec.alive !== false || ghost) : true;
      av.setVisible(alive && (av.room | 0) === mine);
    }
  }

  /**
   * Move every avatar into the scene we are now looking at, or hide it.
   * Called whenever we cross between the island and an interior.
   */
  _rehomeAvatars() {
    const M = this.mp;
    const mine = this.roomId;
    const sc = this.scene;
    for (const av of M.avatars.values()) {
      const together = (av.room | 0) === mine;
      av.mesh.visible = together && av.alive !== false;
      if (together && sc && av.mesh.parent !== sc) sc.add(av.mesh);
    }
    for (const b of M.bodies.values()) {
      // bodies stay where they fell, which is always the island
      b.mesh.visible = mine === 0;
      if (mine === 0 && this.islandScene && b.mesh.parent !== this.islandScene) {
        this.islandScene.add(b.mesh);
      }
    }
  }

  /** Positions for the hologram, written into one array that is kept. */
  _holoRoster(out = (this._holo = this._holo || [])) {
    const M = this.mp;
    const pool = (this._holoPool = this._holoPool || []);
    out.length = 0;
    let i = 0;
    for (const p of M.view.players.values()) {
      const av = M.avatars.get(p.id);
      const pos = p.id === M.view.selfId ? this.player.pos : (av ? av.pos : null);
      const r = pool[i] || (pool[i] = { colour: 0, alive: true, x: 0, z: 0 });
      r.colour = colourHex(p.colour);
      r.alive = p.alive !== false;
      r.x = pos ? pos.x : 0;
      r.z = pos ? pos.z : 0;
      out.push(r);
      i++;
    }
    return out;
  }

  /* =========================================================
     THE ONE WHO IS NOT ON THE ROSTER
     ========================================================= */

  /** The host says where he is, or that he has gone. */
  _onStranger(on, x, z) {
    const M = this.mp;
    if (!this.islandScene) return;
    if (!M.strangerNode) {
      M.strangerNode = buildStranger(this.propMats);
      this.islandScene.add(M.strangerNode);
      this.tickers.push(M.strangerNode);
    }
    if (!on) {
      if (M.stranger) {
        // he fades rather than blinking out
        M.strangerGone = now() + 1.2;
        this.audio.sfx('descend');
      }
      M.stranger = null;
      return;
    }
    const first = !M.stranger;
    M.stranger = { x, z };
    M.strangerGone = 0;
    if (first) {
      /* No marker, no toast telling you where. A shape at the edge of the
         trees and a sound you cannot place is the whole point of him. */
      this.audio.sfx('ping');
      this.ui.toast('SOMETHING MOVED IN THE TREES', 'jade', 2600);
    }
  }

  /** What he told you. */
  _onRiddle(text) {
    const open = STRANGER_OPENERS[(Math.random() * STRANGER_OPENERS.length) | 0];
    const close = STRANGER_CLOSERS[(Math.random() * STRANGER_CLOSERS.length) | 0];
    this.screens.push('mpRiddle', { lines: [open, text, close] });
    document.exitPointerLock?.();
    this.audio.sfx('page');
    this.mp.riddleHeard = text;
  }

  /** Ask him. He answers once and leaves. */
  askStranger() {
    if (this.isHost) this.mp.host?._askStranger('host');
    else this._send({ t: C.ASKSTRANGER });
  }

  /** Somebody set off a blackout charge. Every fire on the island, out. */
  _onBlackout(secs) {
    this.doused = true;
    this.blackoutUntil = now() + (secs || 45);
    this.audio.sfx('slam');
    this.audio.sfx('rumble');
    this.pipeline.tint.setHex(0x000000);
    this.pipeline.tintAmt = 0.7;
    this._notice('THE LIGHTS ARE OUT');
    clearTimeout(this._blackoutT);
    this._blackoutT = setTimeout(() => {
      // only lift it if a douse sabotage is not also running
      if (!this.mp.view.sabotage || this.mp.view.sabotage.kind !== 'douse') this.doused = false;
      this.audio.sfx('confirm');
    }, (secs || 45) * 1000);
  }

  /** The host's answer to a ledger request, cached until the next one. */
  _onLedger(rows) {
    const M = this.mp;
    M.ledger = new Map();
    for (const [id, coins] of (rows || [])) M.ledger.set(id, coins | 0);
    M.ledgerAt = now();
  }

  /** Ask for it. Cheap, and only ever while the table is open. */
  requestLedger() {
    const M = this.mp;
    if (M.ledgerPending && now() - M.ledgerPending < 1.2) return;
    M.ledgerPending = now();
    if (this.isHost) M.host?._sendLedger('host');
    else this._send({ t: C.LEDGER });
  }

  /**
   * Which interior we are standing in. 0 the island, 1 the listening post,
   * 2 the room behind the painting.
   *
   * The rooms are shared: everybody inside one is in the same local
   * coordinate space, so the ordinary position on the wire is enough to
   * place them, and this is the one extra number that says which space the
   * numbers belong to.
   */
  /** True while we are inside one of the shared interiors. */
  get inRoom() { return this.state === 'bunker' || this.state === 'highroller'; }

  /** Come back up, whichever room we happen to be in. */
  leaveRoom() {
    if (this.state === 'bunker') this.leaveBunker();
    else if (this.state === 'bar') { this.leaveBar(); this.leaveHighRoller(); }
    else if (this.state === 'highroller') this.leaveHighRoller();
  }

  get roomId() {
    if (this.state === 'bunker') return 1;
    if (this.state === 'highroller') return 2;
    if (this.state === 'bar') return 3;
    return 0;
  }

  /** Everything the table knows. Deliberately a lot. */
  bunkerReadout() {
    const M = this.mp;
    const jam = this.jammed, chaff = M.chaffUntil && now() < M.chaffUntil;
    const roster = [...M.view.players.values()].filter((p) => !p.shroud).map((p) => {
      const av = M.avatars.get(p.id);
      /* A false alibi shows the buyer somewhere else on everybody's plot —
         but never on their own, or they could not use it deliberately.

         And while somebody's Party Box is playing, EVERY marker sits on the
         box: for sixty seconds the only way to know who is where is to walk
         out there and look. */
      const box = M.speaker && now() < M.speaker.until ? M.speaker : null;
      const pos = box ? box
        : (p.id === M.view.selfId ? this.player.pos
          : (p.decoy ? p.decoy : (av ? av.pos : null)));

      return {
        id: p.id, name: p.name || '?', colour: colourHex(p.colour),
        alive: p.alive !== false,
        coins: M.ledger ? (M.ledger.get(p.id) ?? null) : null,
        me: p.id === M.view.selfId,
        x: pos ? pos.x : 0,
        z: pos ? pos.z : 0,
      };
    });
    /* A remote hack does not falsify the table, it takes it away — the
       screen handles that. Nothing here has to lie. */
    const sab = M.view.sabotage;
    return {
      roster,
      chaff,
      /* the places worth marking on the plot */
      marks: this._tableMarks(),
      /* where the last sabotage was pulled from, and the ones before it */
      half: sab && sab.half ? sab.half : null,
      log: M.sabLog || [],
      alive: roster.filter((r) => r.alive).length,
      total: roster.length,
      work: `${M.view.tasksDone || 0} / ${M.view.tasksTotal || 0}`,
      sabotage: M.view.sabotage ? (SABOTAGE_DEFS[M.view.sabotage.kind]?.name || '') : null,
      shop: this.shopShut ? 'SHUTTERED' : 'TRADING',
      weather: this.stormOn ? 'STORM' : (this.blinded ? 'MIST' : (this.night > 0.55 ? 'NIGHT' : 'CLEAR')),
      bunker: M.bunker?.name || '',
      flopper: this.casinoIn == null ? '--'
        : (this.casinoIn > 0.9 ? 'DOCKED' : (this.casinoIn < 0.1 ? 'OUT AT SEA' : 'MOVING')),
      ledger: !!M.ledger,
    };
  }

  /** Fixed points the plot draws, so the ring of pips means something. */
  _tableMarks() {
    const m = [];
    const L = this.landmarks || LANDMARKS;
    if (L?.wreck) m.push({ x: L.wreck.x, z: L.wreck.z, label: 'CAMP', kind: 'camp' });
    if (this.templeDoorPos) m.push({ x: this.templeDoorPos.x, z: this.templeDoorPos.z, label: 'TEMPLE', kind: 'temple' });
    if (this.hutPos) m.push({ x: this.hutPos.x, z: this.hutPos.z, label: 'FERDI', kind: 'shop' });
    if (this.casinoPos) m.push({ x: this.casinoPos.x, z: this.casinoPos.z, label: 'FLOPPER', kind: 'boat' });
    for (const v of (this.vendors || [])) m.push({ x: v.x, z: v.z, label: '', kind: 'vendor' });
    const b = this.mp.bunker;
    if (b) m.push({ x: b.x, z: b.z, label: 'POST', kind: 'post' });
    return m;
  }

  /* =========================================================
     THE LUCKY FLOPPER
     ========================================================= */
  /**
   * One pull. The result is decided here, in one place, and both the
   * cabinet on the deck and the screen in front of you are told what it
   * was — so what you watch land is what you are paid for.
   *
   * @returns {{result:number[], win:number}|null} null if you cannot afford it
   */
  pullSlot(slot) {
    const STAKE = 3;
    // a book of tickets covers the stake; the odds are untouched
    const free = (this.freePulls || 0) > 0;
    if (!free && (this.coins || 0) < STAKE) return null;
    if (free) {
      this.freePulls--;
      this.ui.toast(`TICKET USED - ${this.freePulls} LEFT`, 'gold', 1600);
    } else {
      this.coins -= STAKE;
      this._send({ t: C.PURSE, coins: this.coins });
    }
    this.audio.sfx('lever');

    /* Six symbols, three drums, honestly rolled. The table pays 480 coins
       across the 216 possible outcomes against a stake of three, so the
       house keeps about a quarter of what crosses it — twenty per cent
       tighter than it was — while the two jackpots are worth twice what
       they were. You lose slowly and win loudly, which is the point. */
    const result = [0, 0, 0].map(() => (Math.random() * 6) | 0);
    const [a, b, c] = result;
    let win = 0;
    if (a === b && b === c) {
      win = a === 5 ? 120 : (a === 3 ? 60 : 30);       // SEVEN, IDOL, anything
    } else if (a === b || b === c || a === c) {
      win = 2;
    }

    slot?.userData.spin(result);
    // the drums clacking down, one after another
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.audio.sfx('reel'), 500 + i * 450);
    }
    return { result, win };
  }

  /**
   * Pay out. Called by the machine's face when the last drum stops, NOT on
   * a timer — a wall-clock timeout and a screen counting in game time drift
   * apart on a slow machine, and the coins would arrive before the reels
   * had finished telling you why.
   */
  settleSlot(slot, win) {
    if (!win) return;
    this.coins += win;
    this._send({ t: C.PURSE, coins: this.coins });
    slot?.userData.payout(true);
    if (win >= 60) {
      this.ui.showPopup(`${win} SYNCOIN`, 'TIM WILL BE FURIOUS', 'coin', 'THE FLOPPER PAYS');
    }
  }

  /** The old one-key pull, kept for anything that bypasses the screen. */
  playSlot(slot) {
    const out = this.pullSlot(slot);
    if (!out) { this.audio.sfx('deny'); return; }
    setTimeout(() => {
      this.settleSlot(slot, out.win);
      if (out.win) { this.audio.sfx('victory'); this.ui.toast(`${out.win} SYNCOIN`, 'gold', 2000); }
      else { this.audio.sfx('deny'); this.ui.toast('NOTHING', 'bad', 1400); }
    }, 1900);
  }

  /** A boombox on the sand, and everybody knows exactly where it is. */
  dropSpeaker() {
    const p = this.player.pos;
    this._send({ t: C.PERK, perk: 'speaker', on: true, x: +p.x.toFixed(1), z: +p.z.toFixed(1) });
    this.audio.sfx('confirm');
  }

  /**
   * The boombox, built once at the start of the round and parked out of
   * sight. It used to be created the first time somebody dropped one —
   * which meant adding a PointLight to a live scene, which changes
   * numPointLights, which is part of every shader's cache key, which made
   * three recompile every material in the world. One purchase, one
   * second-and-a-half freeze, for everybody at once.
   */
  _buildSpeakerNode() {
    const M = this.mp;
    if (M.speakerNode || !this.islandScene) return;
    /* A big upright PA speaker, the kind somebody carries to a beach on
       their shoulder — not the little two-cone box it was. Roughly a metre
       and a half tall, standing on rubber feet, with a driver you can watch
       move. */
    const g = new THREE.Group();
    const CASE = 0x22222a, TRIM = 0x3e3e4a;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 1.42, 0.62),
      new THREE.MeshLambertMaterial({ color: CASE })
    );
    body.position.y = 0.78;
    g.add(body);
    // a lighter bezel round the front
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 1.32, 0.04),
      new THREE.MeshLambertMaterial({ color: TRIM })
    );
    bezel.position.set(0, 0.78, 0.32);
    g.add(bezel);
    // rubber feet, and a carry handle across the top
    for (const sx of [-0.34, 0.34]) {
      for (const sz of [-0.22, 0.22]) {
        const f = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.1, 0.14),
          new THREE.MeshLambertMaterial({ color: 0x14141a })
        );
        f.position.set(sx, 0.05, sz);
        g.add(f);
      }
    }
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.07, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x4a4a56 })
    );
    handle.position.set(0, 1.53, 0);
    g.add(handle);

    /* The woofer, which actually moves in and out with the beat, and a
       tweeter above it. */
    const woofer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.26, 0.12, 14),
      new THREE.MeshLambertMaterial({ color: 0x8a8a96 })
    );
    woofer.rotation.x = Math.PI / 2;
    woofer.position.set(0, 0.58, 0.34);
    g.add(woofer);
    const dust = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x14141a })
    );
    dust.position.set(0, 0.58, 0.40);
    g.add(dust);
    const tweeter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.08, 10),
      new THREE.MeshLambertMaterial({ color: 0x6a6a76 })
    );
    tweeter.rotation.x = Math.PI / 2;
    tweeter.position.set(0, 1.22, 0.34);
    g.add(tweeter);

    // a row of level lights along the bottom of the bezel
    const lamps = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.05, 0.03),
        new THREE.MeshBasicMaterial({ color: 0x1a1a22, fog: true })
      );
      m.position.set(-0.28 + i * 0.112, 0.20, 0.35);
      g.add(m);
      lamps.push(m);
    }

    const glow = new THREE.PointLight(0xff5aa8, 0, 16, 1.8);
    glow.position.set(0, 1.2, 0);
    g.add(glow);
    g.userData.glow = glow;
    g.userData.body = body;
    g.userData.woofer = woofer;
    g.userData.dust = dust;
    g.userData.lamps = lamps;
    this.islandScene.add(g);
    M.speakerNode = g;
    setHidden(M.speakerNode, true);
  }

  _onSpeaker(x, z, secs) {
    const M = this.mp;
    M.speaker = { x, z, until: now() + secs };
    this.audio.playMusic('title');
    this.ui.toast('SOMEBODY PUT A SPEAKER ON', 'gold', 3000);
    this._compassForTasks();
    this._buildSpeakerNode();
    setHidden(M.speakerNode, false);
    M.speakerNode.position.set(x, heightAt(x, z), z);
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

  /** Where a given sabotage has to be repaired, in world coordinates. */
  sabotageSites(kind) {
    const def = SABOTAGE_DEFS[kind];
    if (!def) return [];
    return (def.fixAt || []).map((k) => this._namedSite(k)).filter(Boolean);
  }
  startMatch() { if (this.isHost) this.mp.host.start(); }

  /** Everything the workshop hands you the moment a round begins. */
  _applyDevKit() {
    const M = this.mp;
    if (!M.dev) return;
    this.coins = 9999;
    // the host has to be told, or the command table's ledger shows nothing
    this._send({ t: C.PURSE, coins: this.coins });
    this.knowsBunker = true;
    this.owned = this.owned || new Set();
    for (const it of STOCK) {
      if (it.tag === 'PASSIVE') this.owned.add(it.id);
      else this.carry = [...(this.carry || []), it.id, it.id, it.id];
    }
    this.ui.toast('DEV MODE - EVERYTHING UNLOCKED', 'jade', 4000);
  }

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
      // rules on M.hostTimer, wire on M.netTimer; this loop only mirrors
      // the host's own truth into the view it renders from

      M.view.phase = M.host.phase;
      M.view.tasksDone = M.host.tasksDone;
      M.view.tasksTotal = M.host.tasksTotal;
      /* Mirror in place rather than rebuilding. A fresh object every frame
         threw away everything the client side had learned about the
         sabotage — the repair counter, and now which half of the island it
         came from — so on the host the table read NOMINAL and the fix
         progress sat at zero however many people were working on it. */
      const hs = M.host.sabotage;
      if (!hs) {
        M.view.sabotage = null;
      } else {
        const v = M.view.sabotage && M.view.sabotage.kind === hs.kind
          ? M.view.sabotage
          : (M.view.sabotage = { kind: hs.kind, done: 0, need: 1 });
        v.kind = hs.kind;
        v.endsAt = hs.endsAt;
        v.fatal = hs.fatal;
        v.half = hs.half || v.half || null;
        v.done = hs.sites ? hs.sites.size : (v.done || 0);
      }
      const meRec = M.host.players.get('host');
      if (meRec) {
        const mv = M.view.players.get('host');
        if (mv) { mv.alive = meRec.alive; mv.emergencies = meRec.emergencies; }
        M.view.role = meRec.role || M.view.role;
        M.myKillReady = meRec.killReady;
      }
    }

    /* Whatever you drank runs on wherever you are — in the bar, on the
       island, down the hatch. It is one clock and it is ticked here, above
       every branch, so there is no room you can stand in to sober up. */
    this._tickDrink(dt);

    if (this.state === 'cutscene') {
      this.updateCutscene(dt);
      this.ui.hud.data.mp = null;
      return;
    }

    /* Down the hatch: its own room, its own walls, and the island keeps
       running above you — which is the whole risk of being down here. */
    /* The room behind the painting. Its own scene, its own walls, and the
       island keeps running above you exactly as it does in the bunker. */
    if (this.state === 'highroller') {
      if (this.isHost) M.host.update(0);
      const froze2 = this.paused || this.screens.open;
      if (!froze2) {
        this.player.update(dt, this.input, {
          groundOf: hrHeight, water: false, bounds: false, insideBox: HR_BOX,
        });
      } else {
        this.player.insideBox = HR_BOX;
        this.player.updateCamera(dt, hrHeight);
      }
      this.hrScene.userData.tick(this.time, dt);
      this._updateAvatars(dt);
      this._mpHud();
      const bit2 = froze2 ? null : this.nearestInteractable();
      this.ui.setPrompt(bit2 ? bit2.prompt : null);
      return;
    }

    /* The bar behind the high rollers room. Same shape again: its own scene,
       its own walls, and the island carrying on without you. */
    if (this.state === 'bar') {
      if (this.isHost) M.host.update(0);
      const frozeB = this.paused || this.screens.open;
      if (!frozeB) {
        this.player.update(dt, this.input, {
          groundOf: barHeight, water: false, bounds: false, insideBox: BAR_BOX,
        });
      } else {
        this.player.insideBox = BAR_BOX;
        this.player.updateCamera(dt, barHeight);
      }
      this.barScene.userData.tick(this.time, dt, this.camera.position);
      this._updateAvatars(dt);
      this._mpHud();
      const bitB = frozeB ? null : this.nearestInteractable();
      this.ui.setPrompt(bitB ? bitB.prompt : null);
      return;
    }
    if (this.state === 'bunker') {
      if (this.isHost) M.host.update(0);
      const froze = this.paused || this.screens.open;
      if (!froze) {
        this.player.update(dt, this.input, {
          groundOf: bunkerHeight, water: false, bounds: false,
          insideBox: BUNKER_BOX,
        });
      } else {
        // frozen behind a screen, but the walls still apply
        this.player.insideBox = BUNKER_BOX;
        this.player.updateCamera(dt, bunkerHeight);
      }
      /* The hologram wants positions, nothing else. bunkerReadout() builds
         the whole dossier and it is not cheap to do sixty times a second. */
      this.bunkerScene.userData.tick(
        this.time, dt, this._holoRoster(),
        this.mp.view.sabotage?.half || this.mp.sabLog?.[0]?.half || null,
        this.screens.top?.name === 'mpTable'
      );
      this._updateAvatars(dt);
      this._mpHud();
      const bit = froze ? null : this.nearestInteractable();
      this.ui.setPrompt(bit ? bit.prompt : null);
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
    const FINAL = ['mpEnd', 'mpExile', 'mpRole', 'pause', 'mpBodyFound', 'mpSnap'];
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

    const stunned = this.stunnedUntil && now() < this.stunnedUntil;
    if (stunned) {
      // on the sand: you can look, and that is all
      this.player.updateCamera(dt, this.groundOf || heightAt);
      this.camera.rotateZ(Math.sin(this.time * 4) * 0.09);
    } else if (!frozen) {
      this.player.update(dt, this.input, {
        groundOf: this.groundOf || heightAt, water: true, bounds: true,
      });
      /* Off the pier, or off the Flopper's deck when she sails: the sea
         brings you in. This lives on Game and single player has always
         called it; the round has its own update and never did, which is why
         falling in during a round meant treading water until somebody
         called a council. */
      if (this.amAlive) this._tide(dt);
      this.runTime += dt;
    } else {
      this.player.updateCamera(dt, this.groundOf || heightAt);
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
    this._updateTaskBeacons(dt);
    // the party box, thumping away and pulling people towards it
    if (M.speaker) {
      if (now() > M.speaker.until) {
        M.speaker = null;
        if (M.speakerNode) setHidden(M.speakerNode, true);
        this.audio.playMusic(this.night > 0.55 ? 'night' : 'island');
        this._compassForTasks();
      } else if (M.speakerNode) {
        const beat = 1 + Math.abs(Math.sin(this.time * 4.2)) * 0.14;
        /* The case barely moves; the DRIVER moves. A speaker that squashes
           and stretches as a whole reads as a jelly, not as a speaker. */
        const u = M.speakerNode.userData;
        u.body.scale.set(1 + (beat - 1) * 0.06, 1 - (beat - 1) * 0.05, 1);
        if (u.woofer) {
          const push = 0.34 + (beat - 1) * 0.06;
          u.woofer.position.z = push;
          if (u.dust) u.dust.position.z = push + 0.06;
        }
        if (u.lamps) {
          const lvl = Math.abs(Math.sin(this.time * 6.1)) * 6;
          u.lamps.forEach((m, i) => {
            const on = i < lvl;
            m.material.color.setHex(on ? (i > 3 ? 0xe0453a : 0x7ec850) : 0x1a1a22);
          });
        }
        // its own animation must not undo setHidden's zeroed intensity
        u.glow.intensity = u.hidden ? 0 : 3 + Math.sin(this.time * 8.4) * 2.4;
        M.speakerNode.userData.glow.color.setHSL((this.time * 0.3) % 1, 0.8, 0.6);
      }
    }
    this.gore?.update(dt);
    this.flares?.update(dt);
    this.dizzy?.update(dt, this.time, (id) => {
      if (id === M.view.selfId) return this.player.pos;
      const av = M.avatars.get(id);
      return av ? av.pos : null;
    });
    if (this.stunnedUntil && now() >= this.stunnedUntil) this.stunnedUntil = 0;
    this.updateCoinFx(dt);      // the pickup flourish never ran in this mode
    /* Her own music, while you are on her deck. The Flopper is a gambling
       barge and she should sound like one from the moment you step aboard —
       and stop the moment you step off. */
    if (this.state === 'island' && this.casinoPlat) {
      const pl = this.casinoPlat, pp = this.player.pos;
      const rx = pp.x - pl.x, rz = pp.z - pl.z;
      const lx = rx * pl.cos - rz * pl.sin;
      const lz = rx * pl.sin + rz * pl.cos;
      const aboard = Math.abs(lx) <= pl.hw + 1.5 && Math.abs(lz) <= pl.hd + 1.5
        && pp.y > pl.y - 1.2 && this.casinoIn > 0.5;
      if (aboard && !M.aboard) {
        M.aboard = true;
        this.audio.playMusic('flopper');
      } else if (!aboard && M.aboard) {
        M.aboard = false;
        this.audio.playMusic(this.night > 0.55 ? 'night' : 'island');
      }
    }

    this._sweepCoins(dt);
    this._tickFood();
    this._tickDig(dt);

    /* The one on the treeline. His position comes off the wire at the net
       tick, so it is interpolated here — he moves far too fast for a
       twenty-hertz stream to look like anything otherwise. */
    if (M.strangerNode) {
      const node = M.strangerNode;
      if (M.stranger) {
        const gy = heightAt(M.stranger.x, M.stranger.z);
        if (!node.userData.at) node.userData.at = { x: M.stranger.x, z: M.stranger.z };
        const at = node.userData.at;
        at.x += (M.stranger.x - at.x) * Math.min(1, dt * 7);
        at.z += (M.stranger.z - at.z) * Math.min(1, dt * 7);
        node.position.set(at.x, gy, at.z);
        node.rotation.y = Math.atan2(M.stranger.x - at.x, M.stranger.z - at.z) || node.rotation.y;
        /* He fades with distance as well as time — at forty metres he is a
           suggestion, and at fifteen he is a person. */
        const d = Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z);
        const near = 1 - Math.min(1, Math.max(0, (d - 14) / 34));
        node.userData.setFade(0.25 + near * 0.75);
      } else if (M.strangerGone && now() < M.strangerGone) {
        node.userData.setFade(Math.max(0, (M.strangerGone - now()) / 1.2) * 0.8);
      } else {
        node.userData.setFade(0);
        node.userData.at = null;
      }
    }
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
      /* The storm lantern. Bought from the front of the shop, it buys you
         roughly the reach an Agent has — not enough to be safe, enough to
         keep working while everybody else is feeling for the path. */
      const lit = this.hasItem('lantern');
      f.near = lit ? 3.0 : 1.5;
      f.far = lit ? 22 : 8.5;
      f.color.setRGB(0.055, 0.065, 0.085);
      this.islandScene.background?.setRGB?.(0.045, 0.055, 0.075);
      if (this.sky) { this.sky.material.transparent = true; this.sky.material.opacity = 0.03; }
      if (this.ambient) this.ambient.intensity = lit ? 0.42 : 0.22;
      if (this.hemi) this.hemi.intensity = lit ? 0.24 : 0.10;
      /* The light itself is built once at load and left in the scene with
         its intensity at zero. Adding a light to a scene changes
         numPointLights, which is baked into every shader's cache key — so
         one new PointLight makes three recompile EVERY material in the
         scene, and you get a second and a half of nothing at the worst
         possible moment. Lights are never added or removed during play. */
      if (this._lanternLight) {
        const pp = this.player.pos;
        this._lanternLight.position.set(pp.x, pp.y + 1.4, pp.z);
        this._lanternLight.intensity = lit ? 2.4 + Math.sin(this.time * 7.3) * 0.35 : 0;
      }
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
    this._updateAvatars(dt);

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
  _tags(out = []) {
    const M = this.mp;
    out.length = 0;
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
    // a spyglass doubles whatever the weather has left you
    if (this.hasItem('spyglass')) reach *= 2;
    /* Nobody is named near a Party Box. Between the noise and the crowd you
       cannot tell who is standing next to you, which is the point of it. */
    const box2 = M.speaker && now() < M.speaker.until ? M.speaker : null;
    if (box2 && Math.hypot(this.player.pos.x - box2.x, this.player.pos.z - box2.z) < 18) {
      reach = Math.min(reach, 6);
    }

    /** A tag that ignores range entirely — the whistle, and nothing else. */
    const addFar = (obj, name, colour) => {
      v.set(obj.position.x, obj.position.y + 2.5, obj.position.z);
      v.project(cam);
      if (v.z > 1 || v.z < -1) return;
      if (!out._pool) out._pool = [];
      const row = out._pool[out.length] || (out._pool[out.length] = {});
      row.x = Math.round((v.x * 0.5 + 0.5) * W);
      row.y = Math.round((-v.y * 0.5 + 0.5) * H);
      row.name = name; row.colour = colour; row.dead = false; row.fade = 1;
      out.push(row);
    };

    const add = (obj, name, colour, dead) => {
      v.set(obj.position.x, obj.position.y + (dead ? 0.9 : 2.15), obj.position.z);
      const dist = v.distanceTo(eye);
      if (dist > reach) return;
      v.project(cam);
      if (v.z > 1 || v.z < -1) return;
      const row = out._pool && out._pool[out.length] ? out._pool[out.length] : {};
      if (!out._pool) out._pool = [];
      out._pool[out.length] = row;
      row.x = Math.round((v.x * 0.5 + 0.5) * W);
      row.y = Math.round((-v.y * 0.5 + 0.5) * H);
      row.name = name; row.colour = colour; row.dead = dead;
      row.fade = dist > reach * 0.76 ? 1 - (dist - reach * 0.76) / (reach * 0.24) : 1;
      out.push(row);
    };

    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      if (!av.mesh.visible) continue;
      if (rec.quiet) continue;                 // quiet soles: no name, at any range
      /* Ferdi's whistle overrides the weather and the distance both. It is
         the only way to be provably somewhere, and it costs a purchase. */
      if (rec.whistle > 0) { addFar(av.mesh, rec.name || '?', colourHex(rec.colour)); continue; }
      add(av.mesh, rec.name || '?', colourHex(rec.colour), false);
    }
    for (const b of M.bodies.values()) add(b.mesh, 'BODY', 0xb03a2e, true);
    return out;
  }

  /**
   * The HUD's data block.
   *
   * This runs every single frame, and it used to build a fresh object with
   * four fresh arrays inside it each time — a steady stream of garbage that
   * eventually has to be collected, which is felt as the game stopping for
   * a moment. Everything below is written into structures that persist.
   */
  _mpHud() {
    const M = this.mp;
    const h = this.ui.hud.data;
    // In the lobby and on the results card there is no world behind the
    // panel worth annotating, and a half-drawn HUD leaking out from under
    // a full-screen menu just looks broken.
    if (!M.started || M.view.phase !== PHASE.ROAM) {
      h.visible = false; h.mp = null;
      return;
    }
    h.visible = true;

    const d = M.hudData || (M.hudData = {
      role: null, alive: true, tasksDone: 0, tasksTotal: 0,
      myTasks: [], killIn: 0, killTotal: 1, graceIn: 0, cools: [],
      sabotage: null, task: null, players: [], coins: 0, selfId: null,
      belt: [], passives: [],
      tags: [], phase: null, flash: null,
    });

    d.role = M.view.role;
    d.alive = this.amAlive;
    d.tasksDone = M.view.tasksDone;
    d.tasksTotal = M.view.tasksTotal;
    d.coins = this.coins || 0;
    d.stamina = this.player?.stamina ?? 1;
    d.selfId = M.view.selfId;
    d.phase = M.view.phase;
    d.flash = M.doneFlash ? M.doneFlash.id : null;

    // what you are carrying, and what is simply true of you
    d.belt = this.beltSlots(d.belt);
    d.passives.length = 0;
    for (const id of (this.owned || [])) {
      const it = itemById(id);
      if (it) d.passives.push(it.icon);
    }

    // chores, written into the rows that are already there
    const ids = M.view.tasks;
    d.myTasks.length = ids.length;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = d.myTasks[i] || (d.myTasks[i] = {});
      row.id = id;
      row.name = this._taskStage(id).name;
      row.done = M.view.doneTasks.has(id);
      row.half = !row.done && (M.view.taskStep.get(id) || 0) >= 1;
      row.step = M.view.taskStep.get(id) || 0;
      row.steps = taskSteps(id);
    }

    // the knife
    d.killIn = this.amAgent && M.myKillReady ? Math.max(0, M.myKillReady - now()) : 0;
    d.killTotal = M.killTotal || 1;
    d.graceIn = this.amAgent && M.graceEnds ? Math.max(0, M.graceEnds - now()) : 0;

    // sabotage cooldowns
    d.cools.length = 0;
    if (this.amAgent && M.cool) {
      const t = now();
      for (const k in M.cool) {
        const left = M.cool[k] - t;
        if (left > 0) {
          d.cools.push({ kind: k, left, total: SABOTAGE_DEFS[k]?.cooldown || 1 });
        }
      }
    }

    // whatever the island is doing
    if (M.view.sabotage) {
      d.sabotage = d.sabotage || {};
      d.sabotage.name = SABOTAGE_DEFS[M.view.sabotage.kind]?.name || '';
      d.sabotage.left = Math.max(0, M.view.sabotage.endsAt - now());
      d.sabotage.fatal = M.view.sabotage.fatal;
    } else d.sabotage = null;

    // the chore you are holding
    if (M.taskProgress) {
      d.task = d.task || {};
      d.task.verb = M.taskProgress.verb;
      d.task.name = M.taskProgress.name;
      d.task.k = M.taskProgress.t / M.taskProgress.secs;
      d.task.holding = !!M.holdingE;
    } else d.task = null;

    // the roster, in place
    let n = 0;
    for (const p of M.view.players.values()) {
      const row = d.players[n] || (d.players[n] = {});
      row.id = p.id; row.name = p.name; row.colour = p.colour; row.alive = p.alive;
      n++;
    }
    d.players.length = n;

    this._tags(d.tags);
    h.mp = d;

    this.ui.setHearts(this.amAlive ? 1 : 0, 1);
    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);
    this.ui.setStamina(this.player.stamina);
  }
}
