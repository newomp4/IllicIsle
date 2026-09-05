/* ===========================================================
   mpgame.js — Illic Isle: Castaways.

   Reuses the whole single-player world — same island, same props,
   same renderer, same pixel interface — and swaps the story logic
   for a session. The host runs HostSession (the rules); everyone,
   host included, renders from a MirrorSession-shaped view so there
   is only one drawing path.
   =========================================================== */

import * as THREE from 'three';
import { Game, PENDULUMS, makeGroundWith, setHidden } from '../game.js';
import { Net, makeRoomCode } from '../net/net.js';
import { C, S, PHASE, ROLE } from '../net/protocol.js';
import { HostSession, MirrorSession } from './session.js';
import { Avatar, Body, colourHex, noteSnapshot, resetSnapshotTiming } from './avatar.js';
import { TASK_DEFS, SABOTAGE_DEFS, TASK_FX, taskById, taskStage, taskSteps } from './tasks.js';
import { TaskFx } from './taskfx.js';
import { Gore } from './gore.js';
import {
  STOCK, FOOD, STAGE_PAY_MIN, STAGE_PAY_MAX, SANCTUARY_R, itemById,
  SCHLARNA_UP, SCHLARNA_N, drinkById, shelf,
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
/* Worn or held rather than carried: it belongs in `owned`, not on the belt.
   The CORK VEST is tagged ONE USE but takes effect the moment it is bought,
   so routing it by tag put it on a number key — and pressing that key threw
   the 25% weight away while the host kept the protection. */
const keptOnYou = (it) => !!it && (it.tag === 'PASSIVE' || PASSIVE_AT_BUY.has(it.id));
/** Bought and carried until you choose the moment. These fill the belt. */
const BELT_IDS = ['gun', 'scanner', 'printer', 'whistle', 'speaker', 'flask', 'alibi',
  'skeleton', 'chaff', 'shroud', 'blackout', 'ticket', 'nightfall'];
/* What one pull of Ferdi's machines costs. The mpVend screen prints the same
   figure off a copy of its own — it draws the cabinet before it has asked the
   game anything at all — so the two have to be kept in step by hand. */
const VEND_COST = 6;
import { buildPistol, Flare, Dizzy } from './pistol.js';
import { heightAt, ISLAND } from '../world/terrain.js';
import { buildSyncoin } from '../world/extras.js';
import { BUNKER_BOX, BUNKER_COLLIDERS, bunkerHeight } from '../world/bunker.js';
import {
  HR_BOX, HR_COLLIDERS, hrHeight, HR_BAR_DOOR, HR_BAR_RETURN,
} from '../world/highroller.js';
import {
  BAR_ENTRY, BAR_BOX, BAR_COLLIDERS, barHeight, BAR_KEEP, BAR_OCHE, BAR_DOOR,
} from '../world/bar.js';
import {
  CAB_BOX, CAB_COLLIDERS, CAB_ENTRY, cabHeight, CAMERA_BUNDLE,
} from '../world/tower.js';
import {
  UFO_ALT, UFO_BOX, UFO_COLLIDERS, UFO_ENTRY, UFO_PLATE, UFO_PLINTH, UFO_R, ufoHeight,
} from '../world/ufo.js';
import * as BJ from './blackjack.js';
import { buildStranger, STRANGER_OPENERS, STRANGER_CLOSERS } from './stranger.js';
import { setTime, ps1Clone } from '../lib/ps1.js';
import { rigScene } from '../lib/lights.js';
import { Cutscene, setCinemaBars } from '../lib/cutscene.js';
import { LANDMARKS } from '../world/props.js';

const now = () => performance.now() / 1000;

/** One board for the shutters, built on demand. */
function boxGeo(w, h, d, i) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color: i % 2 ? 0x8a6a3c : 0x6e5330 });
  return new THREE.Mesh(g, m);
}

/** The walls of each room, by the same numbering `roomId` uses. */
const ROOM_BOXES = { 1: BUNKER_BOX, 2: HR_BOX, 3: BAR_BOX, 4: CAB_BOX, 5: UFO_BOX };

/* How long the machine thinks about it before it answers. It is doing the
   one piece of arithmetic anybody on this island will get all night, and an
   answer that arrives on the same frame as the key press reads as a lookup
   rather than a reading. Four seconds is long enough to be caught standing
   over somebody with it, which is the risk that pays for the answer. */
const SCAN_SECS = 4.0;
/* And how long the answer stays legible afterwards. Nothing writes it down. */
const SCAN_HOLD = 14;

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

      /* The visitor. Every one of these is the host's word repeated back —
         nothing here is ever decided locally, and _resetUfoClient() is the
         single place that puts the whole lot back to nothing. */
      ufo: null,           // { until } while one is standing off
      ufoK: 0,             // 0..1, the arrival ramp fed to game.ufoVisit
      beamWarned: false,   // told once per visit what the light does
      scannerBy: null,     // whoever is carrying it, host's word
      scannerSpent: false, // its one scan is gone; the plinth stays empty
      plateDown: false,    // somebody in the room is standing on it
      scannerShown: false, // what we last told the room's iris to do
      scan: null,          // { targetId, name, colour, t, secs, agent, done, hold }
      lift: null,          // the Cutscene while the light has you
    };

    /* Castaways keeps its own held-E flag for chores, and Game's blur
       handler — which exists for exactly this hazard — knows nothing about
       it. Tabbing away never delivers the key-up, so a chore held at that
       moment charged on behind the pause card and finished itself into the
       wire, and the flag was still set when you came back: standing near the
       X was then enough to dig the chest with no key down at all. */
    window.addEventListener('blur', () => { if (this.mp) this.mp.holdingE = false; });

    /* The other half of the click-hold: the press arrives through Game's
       canvas handler, but the release can land anywhere — off the canvas,
       over a screen that opened under the button — and a release that was
       never seen would leave the belt, the bar and the shovel held down
       for the rest of the round. */
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mp) this.mp.holdingClick = false;
    });
  }

  /* ===========================================================
     CONNECTION
     =========================================================== */
  async hostGame(name, room) {
    const M = this.mp;
    clearInterval(M.netTimer); clearInterval(M.hostTimer);
    M.finished = false;
    M.kicked = false;
    /* [RELEASE] REMOVE BEFORE RELEASE — the whole 7226 workshop.
       7226 opens a workshop: one player, no minimum, a full purse, the
       listening post already on your chart and a readout of what the rules
       think is going on. It exists so the island can be tested without
       finding three other people first.

       Anybody who learns the code gets a full purse, every item and a round
       that cannot end, so it must not ship. Grep [RELEASE] for the rest of
       it: the grants below in _applyDevKit, the host flags a few lines down,
       the knowsBunker line in startCastaways, the three tests in
       js/mp/session.js, and the badge and player-count test in
       js/lib/screens.js mpLobby. */
    const loc = globalThis.location;
    M.dev = String(room || '').trim() === '7226'
      && ['localhost', '127.0.0.1', '[::1]'].includes(loc?.hostname)
      && new URLSearchParams(loc?.search || '').get('workshop') === '1';
    resetSnapshotTiming();
    M.cool = {};
    M.chat.length = 0;
    M.room = room || makeRoomCode();
    const connecting = M.net = new Net();
    /* `status` is drawn in exactly one place — mpMenu, and only while it
       is still dialling (`s.busy`); the lobby only replaces it once the
       connection has resolved. Everything the transport says after that (the broker
       dropping, the room code being lost for good) was being written onto
       whatever screen happened to be on top, which draws no such field, so
       the host was never told its code had stopped working. Anything that
       arrives once we are past the connect screen goes to a toast instead. */
    M.net.onStatus = (t) => {
      if (M.net !== connecting) return;
      if (this.screens.name === 'mpMenu' && this.screens.top) this.screens.top.status = t;
      else this._notice(t);
    };
    M.net.onError = (e) => {
      if (M.net === connecting) this._notice('NETWORK: ' + (e?.type || 'ERROR'));
    };
    M.net.onHostGone = () => {};
    await connecting.host(M.room);
    if (M.net !== connecting) throw new Error('Connection cancelled.');

    M.host = new HostSession(M.net, {
      onRoster: (list) => this._roster(list),
      onPhase: (p, secs, meta) => this._phase(p, secs, meta),
      onLocalRole: (card) => M.view.handle(card),
      onTasks: (d, t) => { M.view.tasksDone = d; M.view.tasksTotal = t; },
      onTaskOk: (id, step, done) => {
        if (done) M.view.doneTasks.add(id); else M.view.taskStep.set(id, step);
        // the wire carries the NEW step, so the one just finished is behind it
        this._taskDone(id, done, done ? step : Math.max(0, step - 1));
      },
      onCooldown: (secs, grace) => {
        M.myKillReady = now() + secs;
        M.killTotal = Math.max(secs, 0.001);
        if (grace) M.graceEnds = now() + grace;
      },
      onKilled: (id, x, y, z) => this._onKilled(id, x, y, z, M.host.players.get(id)?.room),
      onSaved: (id) => this._onSaved(id),
      onBodyGone: (id) => this._removeBody(id),
      onBunker: (i) => { M.bunkerIndex = i; if (M.started) this._placeBunker(i); },
      onSpeaker: (x, z, secs) => this._onSpeaker(x, z, secs),
      onChaff: (secs) => { M.chaffUntil = now() + secs; },
      onPurse: (c, gained) => this._onPurse(c, gained),
      onLedger: (rows) => this._onLedger(rows),
      onReceipt: (r) => this._onReceipt(r),
      onDig: (d) => this._onDig(d),
      onNightfall: () => this._onNightfall(),
      isNight: () => (this.night || 0) > 0.5,
      /* The host's hour, so the snapshot can carry it and every other
         machine can ease onto it. Without this hook the field is simply
         absent and each client keeps running its own day. */
      clock24: () => this.clock24,
      onChest: (byId, gold) => this._onChest(byId, gold),
      onBlackout: (secs) => this._onBlackout(secs),
      onStranger: (on, x, z) => this._onStranger(on, x, z),
      onRiddle: (text) => this._onRiddle(text),
      /* The saucer. The host tells itself the same three things it tells
         everybody else, through the same three handlers, so hosting is not a
         second set of rules — including the result, which is private to the
         holder whether or not the holder happens to be running the game. */
      onUfo: (on, secs) => this._onUfo(on, secs),
      onScanner: (byId, spent) => this._onScanner(byId, spent),
      onScanResult: (targetId, agent) => this._onScanResult(targetId, agent),
      /* `named` is snapshotted at round start and the Flopper sails, so
         these two are folded in here instead — the hook is read when the
         Stranger is asked, not when the round begins. Offshore, the boat is
         not a place anybody can be told to look. */
      namedSites: () => ({
        ...(this.mp.named || {}),
        ...(this.casinoPos && this.casinoIn > 0.5
          ? { casino: { x: this.casinoPos.x, z: this.casinoPos.z } } : {}),
        ...(M.bunker ? { post: { x: M.bunker.x, z: M.bunker.z } } : {}),
      }),
      onDrop: (x, y, z, c, id, did, room) => this._onDrop(x, y, z, c, id, did, room),
      onDropGone: (did, byId) => this._onDropGone(did, byId),
      onVend: (i, byId, itemId) => this._onVend(i, byId, itemId),
      onWorldFx: (at, last) => this._onWorldFx(at, last),
      onShot: (by, vid, at, secs) => this._onShot(by, vid, at, secs),
      onSnapDeny: (why) => this._onSnapDeny(why),
      onSnapOpen: (vid, by, secs, voters) => this._onSnapOpen(vid, by, secs, voters),
      onSnapTally: (y, n2, need, voters) => this._onSnapTally(y, n2, need, voters),
      onSnapDone: (vid, ex, wasAgent, y, n2) =>
        this._onSnapDone(vid, ex, wasAgent, y, n2, M.host.settings.revealOnExile),
      onCouncil: (by, body) => this._onCouncil(by, body),
      onVotes: (counts, voted) => { M.view.votes = { counts, voted }; },
      onExile: (id, wasAgent) => this._onExile({ targetId: id, wasAgent, reveal: M.host.settings.revealOnExile }),
      onChat: (m) => this._onChat(m),
      onSabotage: (k, s2, f, sites, half) => this._onSabotage(k, s2, f, sites, half),
      onFixed: (k, cd, why) => {
        M.view.sabotage = null; this._fixedNotice(why); this._applySabotage(k, false);
        /* Somebody else got there first: the bar would run to the end and
           fire a C.FIX the host drops on the floor. */
        if (M.taskProgress?.fix) M.taskProgress = null;
        if (cd) (M.cool = M.cool || {})[k] = now() + cd;
        this._compassForTasks();
      },
      onFixProgress: (k, d, n, at) => this._fixProgress(k, d, n, at),
      siteOf: (at) => this._namedSite(at),
      onOver: (w, a, r) => this._onOver(w, a, r),
      onEvent: (e) => { if (e.kind === 'left') this._notice(`${e.name} LEFT`); },
    });
    M.host.addLocal(name);
    /* The host never sends itself a WELCOME, so its mirror's settings stayed
       the defaults for the whole session while the lobby edited the host's
       copy. One object, so what it renders is what it edits. */
    M.view.settings = M.host.settings;
    M.view.selfId = 'host';
    // [RELEASE] REMOVE BEFORE RELEASE — workshop only: no grace, a 6s knife.
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
    M.kicked = false;
    M.dev = false;
    resetSnapshotTiming();
    M.cool = {};
    M.chat.length = 0;
    M.room = room;
    const connecting = M.net = new Net();
    /* `status` is drawn in exactly one place — mpMenu, and only while it
       is still dialling (`s.busy`); the lobby only replaces it once the
       connection has resolved. Everything the transport says after that (the broker
       dropping, the room code being lost for good) was being written onto
       whatever screen happened to be on top, which draws no such field, so
       the host was never told its code had stopped working. Anything that
       arrives once we are past the connect screen goes to a toast instead. */
    M.net.onStatus = (t) => {
      if (M.net !== connecting) return;
      if (this.screens.name === 'mpMenu' && this.screens.top) this.screens.top.status = t;
      else this._notice(t);
    };
    M.net.onError = (e) => {
      if (M.net === connecting) this._notice('NETWORK: ' + (e?.type || 'ERROR'));
    };
    M.net.onMessage = (msg) => { if (M.net === connecting) this._clientMsg(msg); };
    M.net.onHostGone = () => {
      if (M.net !== connecting) return;
      /* The channel closes a moment after a kick or the last S.OVER, so this
         used to stamp itself over the honest reason — a guest read THE HOST
         LEFT THE ISLAND where the results card or the kick had just been. */
      if (M.finished) return;
      M.finished = true;
      this._notice('THE HOST LEFT');
      if (this.state === 'cutscene') this.skipCutscene();
      this.screens.replace('mpEnd', { winner: null, reason: 'THE HOST LEFT THE ISLAND', agents: [] });
    };
    await connecting.join(room);
    if (M.net !== connecting) throw new Error('Connection cancelled.');
    connecting.sendHost({ t: C.HELLO, name });
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
          /* AND WHICH ROOM. A guest sends this with every move; the host
             writes its own row by hand and this line was missing, so the
             host was permanently on the island as far as everybody else
             was concerned. Stand in the high rollers' room with the host
             and you each saw an empty room — the host could see you, you
             could not see the host, and the host's body was parented to
             the island scene the whole time. */
          hp.room = this.roomId;
          /* Standing at a chore and standing over a body look identical
             otherwise, and telling those two apart across the island is most
             of what Castaways is. The flag has always been on the wire; both
             ends were hard-wiring it to nothing. */
          hp.anim = M.taskProgress ? 1 : 0;
        }
        this._applySnapshot({ p: M.host.snapshot() });
      } else if (M.view.phase === PHASE.ROAM && this.player) {
        this._send({
          t: C.MOVE,
          x: +this.player.pos.x.toFixed(2), y: +this.player.pos.y.toFixed(2),
          z: +this.player.pos.z.toFixed(2), yaw: +this.player.facing.toFixed(2),
          anim: M.taskProgress ? 1 : 0,
          room: this.roomId,
        });
      }
    }, NET_TICK_MS);
  }

  _clientMsg(msg) {
    const M = this.mp;
    if (M.kicked) return;
    M.view.handle(msg);
    switch (msg.t) {
      /* The hole outlives its round on the host, and a joiner who was told
         nothing about it stood in front of an X the island had already dug
         out. The mirror takes youAre and the dials; the depth is ours. */
      case S.WELCOME: this._onDig(msg.dug); break;
      case S.ROSTER: this._roster([...M.view.players.values()]); break;
      case S.PHASE: this._phase(msg.phase, msg.endsAt, msg.meta); break;
      case S.SNAPSHOT: this._applySnapshot(msg); break;
      case S.KILLED: this._onKilled(msg.victimId, msg.x, msg.y, msg.z, msg.room); break;
      case S.BODY_GONE: this._removeBody(msg.victimId); break;
      case S.BUNKER: M.bunkerIndex = msg.index; if (M.started) this._placeBunker(msg.index); break;
      case S.SPEAKER: this._onSpeaker(msg.x, msg.z, msg.secs); break;
      case S.CHAFF: M.chaffUntil = now() + msg.secs; break;
      case S.SAVED: this._onSaved(msg.victimId); break;
      case S.PURSE: this._onPurse(msg.coins, msg.gained); break;
      case S.SALE: this._applySale(msg); break;
      case S.LEDGER: this._onLedger(msg.rows); break;
      case S.NIGHTFALL: this._onNightfall(); break;
      case S.DIG: this._onDig(msg.dug); break;
      case S.CHEST: this._onChest(msg.byId, msg.gold); break;
      case S.RECEIPT: this._onReceipt(msg); break;
      case S.BLACKOUT: this._onBlackout(msg.secs); break;
      case S.STRANGER: this._onStranger(msg.on, msg.x, msg.z); break;
      case S.RIDDLE: this._onRiddle(msg.text); break;
      case S.UFO: this._onUfo(!!msg.on, msg.secs || 0); break;
      case S.SCANNER: this._onScanner(msg.byId || null, !!msg.spent); break;
      case S.SCANRESULT: this._onScanResult(msg.targetId, !!msg.agent); break;
      case S.DROP: this._onDrop(msg.x, msg.y, msg.z, msg.coins, msg.id, msg.did, msg.room); break;
      case S.DROPGONE: this._onDropGone(msg.did, msg.byId); break;
      case S.VEND: this._onVend(msg.index, msg.byId, msg.itemId); break;
      case S.WORLDFX: this._onWorldFx(msg.at, msg.last !== false); break;
      case S.SHOT: this._onShot(msg.byId, msg.victimId, msg, msg.secs); break;
      case S.SNAPDENY: this._onSnapDeny(msg.why); break;
      case S.SNAPOPEN: this._onSnapOpen(msg.victimId, msg.byId, msg.secs, msg.voters); break;
      case S.SNAPTALLY: this._onSnapTally(msg.yes, msg.no, msg.need, msg.voters); break;
      case S.SNAPDONE:
        this._onSnapDone(msg.victimId, msg.exiled, msg.wasAgent, msg.yes, msg.no, msg.reveal);
        break;
      case S.COUNCIL: this._onCouncil(msg.calledBy, msg.bodyOf); break;
      case S.CHAT: this._onChat(msg); break;
      case S.EXILE: this._onExile(msg); break;
      case S.SABOTAGE:
        if (msg.refused) { this.ui.toast('THAT ONE IS STILL COOLING', 'bad', 1600); this.audio.sfx('deny'); break; }
        this._onSabotage(msg.kind, msg.secs, msg.fatal, msg.sites, msg.half);
        break;
      case S.FIXPROGRESS: this._fixProgress(msg.kind, msg.done, msg.need, msg.at); break;
      case S.FIXED:
        this._fixedNotice(msg.why); this._applySabotage(msg.kind, false);
        if (M.taskProgress?.fix) M.taskProgress = null;
        if (msg.cooldown) (M.cool = M.cool || {})[msg.kind] = now() + msg.cooldown;
        this._compassForTasks();
        break;
      case S.TASK_OK:
      {
        const done = msg.done !== false;
        if (!done) M.view.taskStep.set(msg.taskId, msg.step);
        const step = msg.step | 0;
        this._taskDone(msg.taskId, done, done ? step : Math.max(0, step - 1));
        break;
      }
      case S.COOLDOWN:
        M.myKillReady = now() + (msg.secs || 0);
        M.killTotal = Math.max(msg.secs || 0, 0.001);
        if (msg.grace) M.graceEnds = now() + msg.grace;
        break;
      case S.OVER: this._onOver(msg.winner, msg.agents, msg.reason); break;
      case S.KICK:
        M.finished = true;
        /* The host closes the channel a beat later, but anything already in
           flight — a REVEAL, a phase — would still be acted on, and a guest
           who had just been thrown out started the round anyway. */
        M.kicked = true;
        this._notice(msg.reason);
        this.screens.replace('mpEnd', { winner: null, reason: msg.reason, agents: [] });
        break;
      default: break;
    }
  }

  get isHost() { return !!this.mp.host; }
  get me() { return this.mp.view.players.get(this.mp.view.selfId); }
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
    /* The mirror prunes itself from S.ROSTER on a guest; the host never
       receives that message, so the departed have to be dropped here or
       they stay on the HUD, on the ballot, and at the origin of the plot. */
    for (const id of [...M.view.players.keys()]) if (!seen.has(id)) M.view.players.delete(id);
    for (const [id, av] of M.avatars) {
      if (!seen.has(id)) {
        /* Take the saucer's scanner off them first. dispose() frees the
           geometry of everything under that mesh, and the one prop that room
           owns is hung off the carrier's elbow — somebody pulling their plug
           mid-visit would have taken it apart for the rest of the session. */
        const sn = this.ufoScene?.userData.scannerNode;
        for (let o = sn?.parent; o; o = o.parent) {
          if (o === av.mesh) { this._parkScanner(); break; }
        }
        av.dispose();
        M.avatars.delete(id);
      }
    }
  }

  _applySnapshot(msg) {
    const M = this.mp;
    const t = now();
    // the interpolation delay is derived from how these actually arrive
    noteSnapshot(t);
    /* One island, one hour. Every machine ran the day off its own join time
       and a throttled tab woke up whole minutes behind, so dusk fell at a
       different moment on each screen — and the Flopper sails on dusk. Ease
       onto the host's hour the short way round the ring; a snap would jump
       the sky and the tide with it. Absent on the host's own call, which
       passes only the rows. */
    if (Number.isFinite(msg.c24)) {
      const L = this.DAY_LEN > 5000 ? 360 : Math.max(120, this.DAY_LEN);
      const d = (((msg.c24 - this.clock24) % L) + L * 1.5) % L - L / 2;
      this.clock24 = (((this.clock24 + d * 0.05) % L) + L) % L;
    }
    const mine = this.roomId;
    for (const [id, x, y, z, yaw, anim, alive, room] of msg.p) {
      if (id === M.view.selfId) continue;
      const av = M.avatars.get(id);
      if (!av) continue;
      av.push(t, x, y, z, yaw, anim, room | 0);
      av.alive = !!alive;
      /* Somebody in a different space is not merely far away, they are
         somewhere else — hide them, and move their body into whichever scene
         we are looking at when it matches ours. */
      const theirs = room | 0;
      av.room = theirs;
      const together = theirs === mine;
      av.setVisible(this._avatarVisible(av));
      if (together) {
        const sc = this.scene;
        if (sc) av.setScene(sc);
      }
    }
  }

  /* ===========================================================
     PHASES
     =========================================================== */
  _phase(phase, secs, meta) {
    const M = this.mp;
    M.view.setPhase(phase, secs);

    // Keys held through a meeting or a room restart must not act on its exit.
    if (phase !== PHASE.ROAM) {
      this._clearHeldInput();
      M.taskProgress = null;
      this.stopSpectate(true);
    }

    if (phase === PHASE.REVEAL) {
      if (!M.started) { M.started = true; this.startCastaways(); this._applyDevKit(); }
      /* A new round gets a new sky and a new saucer. Left standing, last
         round's visit kept the hull in the air, the beam on the sand and a
         spent scanner in somebody's hands over a lobby that had reset. */
      this._resetUfoClient();
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
      /* Your meeting count changes at the close of every council and at the
         start of every round, and nothing else rebuilds the compass — so the
         BELL tick sat on the ring pointing at a council you had spent. The
         guard matters: only REVEAL builds the island, so a client that took
         ROAM without it has no camp to point at. */
      if (M.started) this._compassForTasks();
      if (M.devKitPending) {
        M.devKitPending = false;
        this._applyDevKit();
      }
    } else if (phase === PHASE.COUNCIL || phase === PHASE.VOTE) {
      // a council pulls everybody to the fire, wherever they were
      this.leaveRoom();
      this._teleportToCamp();
      document.exitPointerLock?.();
      /* Unless the body is still being shown. The card gets its few seconds
         and then update() puts the council up itself. */
      const onBody = this.screens.name === 'mpBodyFound' && M.bodyCardUntil && now() < M.bodyCardUntil;
      if (!onBody && this.screens.name !== 'mpCouncil') this.screens.replace('mpCouncil', {});
    } else if (phase === PHASE.RESULT) {
      // the exile card is pushed by _onExile
    } else if (phase === PHASE.LOBBY) {
      /* Another round. Everything the last one left on the island comes
         off, and everybody goes back to the list of names. */
      M.started = false;
      /* A rematch is not the last round's ending. Left standing, `finished`
         kept the council watchdog from ever re-arming and `cool` refused
         every sabotage the host would have allowed. */
      M.finished = false;
      M.cool = {};
      this._runGen = (this._runGen || 0) + 1;
      this._resetRoundControls();
      this._clearSabotageWorld();
      this.leaveRoom?.();
      this._resetUfoClient();
      this._clearBodies();
      this.paused = false;
      this.state = 'title';
      // _onOver stopped the music for the results card; nothing else starts it
      this.audio.playMusic('title');
      document.exitPointerLock?.();
      this.ui.hide();
      this.screens.replace('mpLobby', {});
    }
  }

  /**
   * PLAY AGAIN, from the results card.
   *
   * It used to call beginGame(), which is the SINGLE-PLAYER start — so
   * the button offered at the end of every game of Castaways quietly put
   * you on your own. The host puts the session back in the lobby and
   * everybody follows; a guest waits for them to do it.
   */
  playAgain() {
    const M = this.mp;
    if (!M.active) { this.beginGame(); return; }
    if (M.host) {
      this.audio.sfx('confirm');
      M.host.toLobby();
    } else {
      this.audio.sfx('select');
    }
  }

  /** Legacy entry points now lead to the online connection screen. */
  beginGame() {
    if (this.mp.active) return;
    this.audio.resume();
    this.audio.sfx('confirm');
    this.screens.replace('mpMenu', {});
  }

  startGame() { this.beginGame(); }

  /**
   * Escape out of the dialling screen. leaveMultiplayer() begins on
   * `M.active`, which is only set once the connect has resolved, so it did
   * nothing at all here and left the hung Peer and its heartbeat running
   * for the rest of the session.
   */
  cancelConnect() {
    const M = this.mp;
    clearInterval(M.netTimer); M.netTimer = null;
    clearInterval(M.hostTimer); M.hostTimer = null;
    try { M.net?.destroy(); } catch (e) { /* already gone */ }
    M.net = null;
    M.host = null;
    M.active = false;
  }

  /**
   * Put the session down.
   *
   * Nothing ever did: quitting to the title left the socket open, both
   * timers ticking, the avatars in the scene and the mirror holding the
   * last round's roster, so the next game started on top of the old one.
   */
  leaveMultiplayer() {
    const M = this.mp;
    if (!M.active) { this.cancelConnect(); return; }
    // first, because the net tick and every `if (!this.mp.active)` read it
    M.active = false;
    this._runGen = (this._runGen || 0) + 1;
    this._resetRoundControls();
    // quitting inside a live sabotage otherwise doused, jammed or stormed
    // the single-player run that follows it
    this._clearSabotageWorld();
    this.leaveRoom?.();          // state, scene and walls back on the island
    /* Same reason: the hull, the beam and the room belong to the session,
       and single player must not inherit any of them. */
    this._resetUfoClient();
    clearInterval(M.netTimer); M.netTimer = null;
    clearInterval(M.hostTimer); M.hostTimer = null;
    M.finished = true;           // the council watchdog stops re-arming
    try { M.net?.destroy(); } catch (e) { /* already gone */ }
    M.net = null; M.host = null; M.started = false;
    for (const a of M.avatars.values()) a.dispose();
    M.avatars.clear();
    this._clearBodies();
    M.taskProgress = null;
    M.marked = null;
    /* Quitting inside the three seconds after a knife would otherwise leave
       the shot driving the camera and the mattes up for the rest of the
       session, on a title screen it knows nothing about. */
    if (this.deathShot) this._endDeathShot();
    /* Only render() ever takes the ghost material off again, and it is gated
       on mp.active — which has just gone false. Quitting while dead used to
       leave the single-player castaway translucent for the session. */
    this._setSelfGhost(false);
    // These effects live on Game/Player and single player never ticks their
    // multiplayer expiry timers. Put them away with the session.
    this.player.frozen = false;
    this.player.drift = 0;
    this.pipeline.drunk = 0;
    this.nightEyes = false;
    this.owned?.clear();
    if (this.carry) this.carry.length = 0;
    this.pistolOut = false;
    if (this.pistolModel) this.pistolModel.visible = false;
    this.stunnedUntil = 0;
    M.spectate = null;
    /* The round's props came off the island with it. Nothing in single
       player owns any of them and nothing there ever takes them away, so
       a quit mid-round left the beacons, the purses, the boombox and the
       Stranger standing in the next run's world. The two built-once nodes
       are hidden rather than removed — their builders only ever run once,
       and re-adding the speaker's light to a live scene is the shader
       recompile _buildSpeakerNode exists to avoid. */
    for (const b of (M.beaconNodes || [])) {
      b.removeFromParent(); b.geometry.dispose(); b.material.dispose();
    }
    M.beaconNodes = null;
    for (const d of (M.drops || [])) this._retireDrop(d);
    M.drops = [];
    M.speaker = null;
    if (M.speakerNode) setHidden(M.speakerNode, true);
    if (M.strangerNode) {
      M.strangerNode.userData.setFade(0);
      M.strangerNode.userData.at = null;   // or he glides in from last round's spot
    }
    M.stranger = null;
    M.strangerGone = 0;
    M.view = new MirrorSession();
    this.ui.hud.data.mp = null;
  }

  quitToTitle() {
    this.leaveMultiplayer();
    super.quitToTitle();
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
      /* The five stings are `visualOnly` for the same reason the opening's
         are: a skip fires every unfired beat on one frame, and this flight
         is skipped from the second round on. The music and the role card
         are not theatre — they are the only place either is set. */
      events: [
        { at: 0.2, fn: () => this.audio.playMusic('island') },
        { at: 3.5, visualOnly: true, fn: () => this.audio.sfx('surfWash') },
        { at: 7.0, visualOnly: true, fn: () => this.audio.sfx('page') },
        { at: 10.2, visualOnly: true, fn: () => this.audio.sfx('stinger') },
        { at: 12.8, visualOnly: true, fn: () => this.audio.sfx('door') },
        { at: 15.8, visualOnly: true, fn: () => this.audio.sfx('rumble') },
        /* The card comes up over the last shot rather than after it. Hanging
           it off the phase timer meant a slow machine could spend the whole
           reveal on the flight and never show anybody what they were. */
        { at: 16.4, fn: () => {
          if (this.mp.finished || this.mp.view.phase !== PHASE.REVEAL) return;
          this.screens.replace('mpRole', {});
          this.audio.sfx('descend');
          this._runLater(() => this.audio.sfx(this.amAgent ? 'bossIntro' : 'idolRise'), 1250);
          this._runLater(() => this.audio.sfx('stinger'), 2050);
        } },
      ],
      onDone: () => {
        setCinemaBars(false);
        if (!this.inRoom) {
          this.state = 'island';
          this.scene = this.islandScene;
        }
        /* A final card is already up — the results, a kick, the host leaving
           — and it is the only way on from here. A round that ends during the
           reveal used to have its results thrown away by this line and left
           the player frozen on the island with nothing but the pause menu. */
        if (this.mp.finished) return;
        // whatever is left of the reveal is theirs to sit with the card
        if (this.mp.view.phase === PHASE.REVEAL) {
          if (this.screens.name !== 'mpRole') this.screens.replace('mpRole', {});
        } else if (this.mp.view.phase === PHASE.ROAM) {
          this.screens.clear(); this.ui.show(); this._requestLock();
        }
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

  _onKilled(id, x, y, z, room) {
    const M = this.mp;
    const rec = M.view.players.get(id) || { id, colour: 'red', name: '?' };
    rec.alive = false;
    /* An interior kill happened in that room's own coordinates, so the body
       goes into that room and not onto the island, where it would be a
       corpse on the beach nobody died on. It still has to exist: the host
       lets you report a body you are standing next to in a room. */
    const outside = (room | 0) === 0;
    const here = (room | 0) === this.roomId;
    // the terrain is under the island only; a room has its own floor
    const gy = outside ? Math.max(y, heightAt(x, z)) : y;

    if (!M.bodies.has(id) && this.islandScene) {
      // parked on the island until we walk into their room; _rehomeAvatars
      // moves it into the right scene the moment we do
      const body = new Body(here && !outside ? this.scene : this.islandScene, this.propMats, rec, x, gy, z);
      body.room = room | 0;
      body.mesh.visible = here;
      body.fall = 0;                       // they drop, they do not appear
      M.bodies.set(id, body);
    }
    const av = M.avatars.get(id);
    if (av) { av.setShell(null); av.setVisible(false); }

    // blood, on the ground, where it happened
    if (outside) this.gore?.splat(x, gy, z, colourHex(rec.colour));

    if (id === M.view.selfId) {
      /* The blow interrupts whatever you were holding down. The hold no
         longer cancels itself for being dead — a ghost has chores of its
         own — so without this the chore you were on would go on charging
         and finish itself over your body. */
      M.taskProgress = null;
      this._clearHeldInput();
      if (['mpMinigame', 'mpShop', 'mpVend', 'mpBar', 'mpCathy', 'mpBlackjack',
        'mpDarts', 'mpSlot', 'mpSabotage', 'mpFlopper'].includes(this.screens.name)) this.screens.clear();
      this._beginDeathShot(x, gy, z);
    } else if (!this.amAlive
      || (here && Math.hypot(this.player.pos.x - x, this.player.pos.z - z) < 30)) {
      /* Only for someone who could have seen it. Played to the whole island
         it handed every living player the one fact the Agent pays a
         cooldown to keep quiet, and spoiled finding the body afterwards.
         The dead keep it: a ghost can already watch whoever it likes. */
      this.audio.sfx('splat');
    }
  }

  /* ===========================================================
     THE LAST THING YOU SEE

     Three seconds of camera between the knife and the afterlife. It is
     deliberately NOT a `state = 'cutscene'` cutscene, for three reasons the
     shape of this mode forces:

       - the cutscene branch of update() returns before _updateAvatars, so
         everybody else on the island would stand perfectly still for the
         whole shot, including whoever just did it;
       - leaveRoom() keys off this.state, so a council called inside those
         three seconds would leave you parented to a room you had already
         been pulled out of, colliding with furniture that is no longer
         under you;
       - the killing blow that ends a round sends KILLED and OVER in the
         same tick, and the results card would come up underneath the
         letterbox mattes.

     Driving only the camera leaves the state machine, the room tick, the
     avatars, the gore and the day clock exactly as they were. A council or
     the round ending simply cuts the shot short.
     =========================================================== */
  _beginDeathShot(x, y, z) {
    this.mp.holdingE = this.mp.holdingClick = false;
    /* The blow lands whether or not the shot gets to play. A player knifed
       with the chart, a shop card or the pause menu up has a screen on the
       stack, and render() ends the shot before its first update — so
       anything living in the cutscene's events fired never, and being
       murdered was completely silent. Feedback here, camera and captions
       there. */
    this.audio.sfx('hurt');
    this.audio.sfx('splat');
    this.player.punch?.(1);
    this.pipeline.tint.setHex(0xb00c06);
    this.pipeline.tintAmt = 0.95;
    this.deathTilt = 1.4;
    this._notice('YOU WERE KILLED');
    const V = (a, b, c) => new THREE.Vector3(a, b, c);
    /* Framed off your OWN last heading, never off the killer's. S.KILLED
       carries no killer id on purpose — you are not meant to learn who it
       was, and a camera that swung round to look at him would tell you. */
    const a = this.player.yaw || 0;
    /* Indoors the shot has to stay in the room. The last rise is 6.2 m up
       and 4.8 m back, and every interior here is smaller than that in both
       — the mast hut is 3.1 m to the ceiling and 6 m across — so a kill in
       the listening post, the bunker, the bar or the cab flew the camera
       out through the wall and finished on a black frame. The kill
       coordinates are the room's own, so the room's box clamps them: half a
       metre in from the walls it already keeps the player off, and the
       ceiling less the same clearance the pull-back leaves at the floor. */
    const box = ROOM_BOXES[this.roomId] || null;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const back = (r, h) => {
      const bx = x - Math.sin(a) * r, bz = z - Math.cos(a) * r;
      return box
        ? V(clamp(bx, box.minX + 0.5, box.maxX - 0.5),
          Math.min(y + h, box.maxY - 0.6),
          clamp(bz, box.minZ + 0.5, box.maxZ - 0.5))
        : V(bx, y + h, bz);
    };
    const body = V(x, y + 0.35, z);

    this.deathShot = new Cutscene(this.camera, {
      skippable: false,
      shots: [
        // the ground coming up, close and shaking
        { dur: 0.9, ease: 'easeOut', shake: 0.30,
          from: back(1.4, 1.55), to: back(2.0, 0.5), look: V(x, y + 0.9, z) },
        // and away, so you see where you fell
        { dur: 1.4, ease: 'smooth',
          from: back(2.0, 0.5), to: back(4.4, 2.4), look: body },
        // up to where a ghost stands
        { dur: 0.9, ease: 'smooth',
          from: back(4.4, 2.4), to: back(4.8, 6.2), look: body },
      ],
      text: [
        { at: 0.30, until: 2.10, text: 'SOMEBODY GOT YOU.' },
        { at: 2.35, until: 3.15, text: 'Stay. Watch. The work still counts.' },
      ],
      events: [
        { at: 1.80, visualOnly: true, fn: () => this.audio.sfx('deny') },
      ],
      onDone: () => this._endDeathShot(),
    });
    setCinemaBars(true, false);      // no skip hint: this one cannot be skipped
    this.ui.hide();
    this.ui.setPrompt(null);
    document.exitPointerLock?.();
  }

  /* Driven from render rather than update so the room, the avatars, the
     gore and the day clock have all had their say first and the camera is
     the last word on the frame — the whole reason this is not a real
     cutscene is that everybody else has to keep moving while you watch. */
  render(dt) {
    if (this.deathShot) {
      if (this.screens.open || this.mp.finished) this._endDeathShot();
      /* Real time where there is any, the frame's own step otherwise. rawDt
         is zero until the loop has run a frame, and a tab that was hidden at
         the moment of the knife would otherwise hold the shot at t = 0 for
         as long as it stayed hidden — `??` does not catch a zero. */
      else this.deathShot.update(this.rawDt > 0 ? this.rawDt : dt);
      /* You are lying at your own feet: the corpse is its own mesh, and the
         one the controller drives is still standing up in the middle of the
         shot. Hidden here rather than at the blow because player.update()
         rewrites visible from thirdPerson every frame. */
      if (this.deathShot && this.player?.mesh) this.player.mesh.visible = false;
      /* The roll goes on last, on the same clock as the shot: the cutscene's
         lookAt rewrites the orientation every frame, so anything applied
         before it is thrown away. */
      if (this.deathShot) this._tickDeathTilt(this.rawDt > 0 ? this.rawDt : dt);
    }
    /* The lift, for the same reason and on the same clock: the room, the
       avatars and the day have all had their say and the camera is the last
       word on the frame. A knife lands on top of a lift — _tickLift ends
       itself the moment there is a death shot — so it goes second. */
    if (this.mp.lift) this._tickLift(this.rawDt > 0 ? this.rawDt : dt);
    /* Your own body goes see-through with everybody else's. Done here for
       the same reason the line above is: player.update() rewrites the mesh
       from thirdPerson every frame, and the material swap has to sit after
       whatever it decided. */
    if (this.mp.active) this._setSelfGhost(!this.amAlive && this.mp.started);
    super.render(dt);
  }

  /* ===========================================================
     SPECTATING

     Being dead used to mean walking the island on foot, which is a long way
     to go to watch somebody who is already somewhere else. F picks a living
     castaway up and pins you to them; F again steps to the next one; a
     movement key lets go and gives you the island back.

     Following means going where they went, so this also walks the rooms:
     the bar sits behind the High Roller room, so reaching it is island ->
     high roller -> bar, and every hop goes through the same enter/leave
     methods a living player uses rather than writing state by hand.
     =========================================================== */
  get _spectateTargets() {
    const M = this.mp;
    return [...M.view.players.values()]
      .filter((p) => p.alive !== false && p.id !== M.view.selfId)
      .sort((a, b) => (a.id < b.id ? -1 : 1));      // a stable ring to step round
  }

  /** F: take the next living castaway, or drop the one we have. */
  cycleSpectate() {
    const M = this.mp;
    const list = this._spectateTargets;
    if (!list.length) {
      this.audio.sfx('deny');
      this.ui.toast('NOBODY LEFT TO WATCH', 'bad', 1600);
      return;
    }
    const at = list.findIndex((p) => p.id === M.spectate);
    const next = list[(at + 1) % list.length];
    M.spectate = next.id;
    this.audio.sfx('select');
    this.ui.toast(`WATCHING ${next.name || '?'}`, 'jade', 1800);
    this._followSpectate(true);
  }

  stopSpectate(quiet) {
    if (!this.mp.spectate) return;
    this.mp.spectate = null;
    if (!quiet) this.ui.toast('ON YOUR OWN AGAIN', 'gold', 1400);
  }

  /** Put ourselves in the room the target is in. True if we got there. */
  _spectateRoom(room) {
    if (this.roomId === room) return true;
    this.leaveRoom();                       // always back to the island first
    if (room === 1) this.enterBunker();
    else if (room === 2) this.enterHighRoller();
    else if (room === 3) { this.enterHighRoller(); this.enterBar(); }
    else if (room === 4) this.enterCab();
    /* Only while there is one to be inside. A ghost that followed somebody
       up the beam a frame after the saucer left would be standing in a room
       that nothing is going to come back for. */
    else if (room === 5 && this.mp.ufo) this.enterUfo();
    return this.roomId === room;
  }

  /**
   * Sit just behind and above them, looking where they look.
   * @param {boolean} snap  true on the first frame, so we arrive rather than glide
   */
  _followSpectate(snap) {
    const M = this.mp;
    if (!M.spectate) return;
    const rec = M.view.players.get(M.spectate);
    const av = M.avatars.get(M.spectate);
    if (!rec || rec.alive === false) {
      /* They died while we were watching. Somebody else is still worth
         watching, so step on rather than dumping us back on the beach. */
      this.stopSpectate(true);
      if (this._spectateTargets.length) this.cycleSpectate();
      else this.ui.toast('NOBODY LEFT TO WATCH', 'bad', 1600);
      return;
    }
    /* Which space they are in comes off the AVATAR, not the roster: the
       roster broadcast carries name, colour, alive and the perks, and has
       never carried a room, so reading it here quietly said 'island' for
       everybody and the follow stayed on the beach while they went down the
       hatch. The snapshot is what knows, twelve times a second. */
    if (!this._spectateRoom((av ? av.room : 0) | 0)) { this.stopSpectate(); return; }
    /* The avatar is the only thing that knows where they are — the roster
       carries no coordinates at all. Its interpolation runs off the snapshot
       buffer whether or not it is being drawn, so this is still right for
       somebody we cannot see yet, which is every target for the one frame
       between arriving in their room and the next snapshot. */
    if (!av || !av.buf.length) return;
    const p = av.pos;
    const yaw = av.yaw;
    const bx = p.x - Math.sin(yaw) * 2.6;
    const bz = p.z - Math.cos(yaw) * 2.6;
    if (snap) this.player.teleport(bx, (p.y || 0) + 0.2, bz, yaw);
    else {
      /* Eased, so somebody sprinting does not drag the camera in jerks —
         but hard-snapped past four metres, which is a ladder or a hatch
         rather than a walk, and gliding across it looks like a bug. */
      const k = Math.min(1, (this.rawDt > 0 ? this.rawDt : 1 / 60) * 6);
      const far = Math.hypot(this.player.pos.x - bx, this.player.pos.z - bz) > 4;
      this.player.pos.x += (bx - this.player.pos.x) * (far ? 1 : k);
      this.player.pos.z += (bz - this.player.pos.z) * (far ? 1 : k);
      this.player.pos.y = (p.y || 0) + 0.2;
    }
  }

  /** Your own castaway, rendered through — the same swap the avatars get. */
  _setSelfGhost(on) {
    if (this._selfGhost === !!on || !this.player?.mesh) return;
    this._selfGhost = !!on;
    const mat = on ? this._ghostMat : null;
    this.player.mesh.traverse((o) => {
      if (!o.isMesh) return;
      if (on) {
        if (!o.userData.solidMat) o.userData.solidMat = o.material;
        o.material = mat;
      } else if (o.userData.solidMat) {
        o.material = o.userData.solidMat;
      }
    });
  }

  _endDeathShot() {
    if (!this.deathShot) return;
    this.deathShot = null;
    setCinemaBars(false);
    /* The red is left to update()'s own decay rather than wiped. A player
       knifed with a screen up ends the shot on the frame it began, and
       zeroing here took the hit flash with it — the blow landed in silence
       and full colour. The decay clears it in two thirds of a second either
       way. */
    this.ui.show();
    /* Only take the pointer back if nothing claimed the frame while the shot
       was running. The kill that ends a round sends OVER in the same tick as
       KILLED, and a body can be reported inside the three seconds — in both
       cases there is a card up that the player is in the middle of reading. */
    if (!this.screens.open && !this.mp.finished) this._requestLock();
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
  _onDrop(x, y, z, coins, id, did, room = 0) {
    if (!coins || !this.islandScene) return;
    const M = this.mp;
    M.drops = M.drops || [];
    if (did && M.drops.some((d) => d.did === did)) return;
    room |= 0;
    // Stay at the host's pickup coordinates. Moving the visual away from
    // those coordinates made a visible purse impossible for the host to grant.
    const f = { x, z };
    const gy = room ? y : Math.max(y, heightAt(x, z));
    const g = buildSyncoin(this.propMats, true);
    g.position.set(f.x, gy + 0.4, f.z);
    const here = room === this.roomId;
    (here ? this.scene : this.islandScene).add(g);
    g.visible = here;
    this.tickers.push(g);
    /* The host names every purse, and that name is the only way to ask for
       this one rather than some other. A drop with no name is one nothing can
       claim, so it is left on the ground rather than handed out twice. */
    M.drops.push({ did: did || null, mesh: g, x: f.x, y: gy, z: f.z, room, coins, taken: false });
    if (!room && here) this.taskFx?.burst(f.x, gy, f.z, 0xffd24a, 'done', 3.0);
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
      /* The weight goes with it — but only the weight. This used to write
         the flat base speeds back, so a strike survived while you were on
         Quezetriel's OWN or Cathy's floss silently threw away the quarter
         or the third you had paid for, and you got it back at the moment
         the drink wore off. */
      this._recalcSpeed();
      this.player.punch?.(1);
      this.pipeline.tint.setHex(0xffd24a);
      this.pipeline.tintAmt = 0.85;
      this.ui.showPopup('THE CORK VEST HELD', 'SOMEBODY JUST TRIED FOR YOU', 'vest', 'YOU ARE ALIVE');
      const p = this.player.pos;
      this.taskFx?.burst(p.x, heightAt(p.x, p.z), p.z, 0xffd24a, 'done', 3.4);
    } else {
      this.ui.toast(`${rec?.name || 'SOMEBODY'} SURVIVED A STRIKE`, 'jade', 2600);
      /* At the man who was struck, not at you. Somebody else's vest used to
         set off a gold shockwave under your own feet, wherever you were. */
      const av = M.avatars.get(id);
      // an avatar in another interior is holding room-local coordinates
      if (av && (av.room | 0) === this.roomId) {
        this.taskFx?.burst(av.pos.x, heightAt(av.pos.x, av.pos.z), av.pos.z, 0xffd24a, 'done', 3.4);
      }
    }
  }

  /** One body off the sand: whoever it was has left the island for good. */
  _removeBody(id) {
    const b = this.mp.bodies.get(id);
    if (!b) return;
    b.dispose();
    this.mp.bodies.delete(id);
  }

  _clearBodies() {
    for (const b of this.mp.bodies.values()) b.dispose();
    this.mp.bodies.clear();
    this.gore?.clear();
    for (const av of this.mp.avatars.values()) {
      const rec = this.mp.view.players.get(av.id);
      av.setVisible(this._avatarVisible(av));
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
      this._runLater(() => { this._clearBodies(); }, 2600);
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
    /* `name` is the screen stack's own identity field — passing the exiled
       player's name in it renamed the screen to them. And what they were is
       gated here rather than left to the sender, so a host running with the
       reveal off cannot leak it through the card. */
    this.screens.replace('mpExile', {
      wasAgent: msg.reveal ? msg.wasAgent : null,
      targetId: msg.targetId, who: p?.name || msg.name || '?',
    });
    this.audio.sfx('descend');
  }

  _fixProgress(kind, done, need, at) {
    const sab = this.mp.view.sabotage;
    if (sab && sab.kind === kind) { sab.done = done; sab.need = need; }
    this.audio.sfx('gemHit');
    this.ui.toast(`${done} OF ${need} REPAIRED`, 'jade', 1800);
    /* Where the repair actually happened, not where YOU are standing. This
       used to throw a five-metre ring out of the ground at the feet of
       everybody on the island — and across an interior floor if you were
       below decks — for work being done somewhere else. */
    const site = at ? this._namedSite(at) : null;
    if (this.taskFx && site) {
      this.taskFx.burst(site.x, heightAt(site.x, site.z), site.z, 0x8fe8c8);
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
      // drawn once and kept for the run of it; reshuffling every frame
      // would make the panel a slot machine
      if (on) {
        const ids = [...this.mp.view.tasks];
        for (let i = ids.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const t2 = ids[i]; ids[i] = ids[j]; ids[j] = t2;
        }
        this.mp.scatterOrder = ids;
      } else this.mp.scatterOrder = null;
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
          /* Planks nailed across the counter, made once and hidden.

             Four of them at 0.75 apart put the top board at 4.45, which is
             above the shopfront opening entirely — the deck is at 1.5 and
             the awning comes down at 3.78-4.25 — and straight through the
             roof sheets at 4.62-4.72. It stuck out of the roof at an angle.
             Three boards cover the gap and stay under the awning: the top
             one reaches 3.68, and 3.96 at the end that the roll lifts.
             6.4 long, too, for a 6.2 m hut; 7.4 overhung open air by more
             than half a metre each side. */
          const B = [];
          for (let i = 0; i < 3; i++) {
            const b2 = boxGeo(6.4, 0.55, 0.24, i);
            b2.position.set(0, 2.0 + i * 0.7, 2.55);
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
      this.audio.playMusic(on ? 'alarm' : this._islandTrack());
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
        this.audio.playMusic(this._islandTrack());
      }
    }
  }

  /**
   * Undo every world effect a sabotage left standing, without the repair
   * fanfare. `_applySabotage(kind, false)` is the only other way back and it
   * runs from S.FIXED alone, which a round that ends mid-sabotage never
   * sends — the host nulls its own sabotage silently.
   */
  _clearSabotageWorld() {
    this.doused = false;
    this.jammed = false;
    this.stormOn = false;
    this.blinded = false;
    this.scattered = false;
    this.shopShut = false;
    this.mp.scatterOrder = null;
    if (this.storm) this.storm.stop();
    for (const m of (this.pendulumMeshes || [])) m.userData.setJammed?.(false);
    if (this.hutNode?.userData.boards) this.hutNode.userData.boards.visible = false;
    /* The fog and the lights come back on their own — updateDayNight rewrites
       them every frame — but the mist leaves these behind. */
    this._fogWas = null;
    if (this.sky) this.sky.material.opacity = 1;
    if (this._lanternLight) this._lanternLight.intensity = 0;
    for (const av of this.mp.avatars.values()) av.setShell(null);
    // a blackout timer from last round would otherwise flip doused mid-round
    clearTimeout(this._blackoutT); this._blackoutT = null;
    /* The guest mirror only clears on S.FIXED too, and left standing it
       prints a dead banner on the HUD and denies every pull all round. */
    if (this.mp.view) this.mp.view.sabotage = null;
  }

  _onOver(winner, agents, reason) {
    this.mp.view.over = { t: S.OVER, winner, agents, reason };
    this.mp.finished = true;
    this._clearHeldInput();
    this.mp.taskProgress = null;
    this.stopSpectate(true);
    this.audio.stopMusic();
    this.audio.sfx(winner === 'castaways' ? 'victory' : 'bossDie');
    document.exitPointerLock?.();
    /* A round can end during the reveal, and nothing else cuts the briefing
       short once the phase timer has stopped — so the results card sat over
       a scenic flight for the rest of its twenty-three seconds. */
    if (this.state === 'cutscene') this.skipCutscene();
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
  _taskDone(id, finished = true, atStep = null) {
    const M = this.mp;
    /* The beacons are NOT rebuilt here. _updateTaskBeacons re-reads the done
       list and the stage's landmark every frame, so a finished step darkens
       and moves its pillar on its own — building a fresh set for every step
       of every chore only threw away geometry nobody disposed of. */
    /* The stage that was just DONE, passed in, not read back out of
       taskStep — both callers have already advanced that map by the time
       they get here, so every payoff used to fire at the NEXT landmark:
       the crate flashed at the campfire, and splicing the optic threw the
       ridge Pendulum's shockwave with nobody standing under it. */
    const stage = (atStep === null ? this._taskStage(id) : taskStage(id, atStep))
      || { name: 'THE TASK', verb: 'WORKING', secs: 3, at: null, fx: 'spark' };
    const fx = TASK_FX[stage.fx] || TASK_FX.spark;
    const site = this._namedSite(stage.at) || M.sites[id] || null;

    if (site && this.taskFx) {
      const ground = heightAt(site.x, site.z);
      this.taskFx.burst(site.x, Number.isFinite(site.y) ? Math.max(site.y, ground) : ground,
        site.z, fx.colour, 'done', fx.ring);
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

    const next = atStep === null ? taskById(id)?.then : taskStage(id, atStep + 1);
    this._taskWorldFx(id, stage, next);
    /* Work pays. Agents' lists are a cover, so their "work" pays nothing —
       if they want anything off Ferdi they have to go and find coins on
       the ground like a scavenger, which puts them out in the open. */
    if (!this.amAgent && this.amAlive) {
      let pay = STAGE_PAY_MIN + Math.floor(Math.random() * (STAGE_PAY_MAX - STAGE_PAY_MIN + 1));
      // Cathy's house burger: every job pays twice for the rest of the round
      if (this.bigMeals) pay *= 2;
      this.coins = (this.coins || 0) + pay;
      this.ui.toast(`+${pay} SYNCOIN`, 'gold', 1600);
      this._payInstalment();
      /* Every other move of this purse tells the host. Chore pay never did,
         so the command table's ledger read zero for the hardest workers, the
         Stranger's rich/poor clue sorted numbers that were not real, and an
         Agent who killed one of them looted nothing. After the instalment,
         so the one packet carries the figure the round ends up with. */
      this._send({ t: C.PURSE, coins: this.coins });
    }

    const cleared = finished && M.view.tasks.length
      && M.view.tasks.every((t) => M.view.doneTasks.has(t));
    if (!finished && next && next !== stage) {
      this.ui.showPopup(next.name, 'NOW TAKE IT THERE', 'task', 'HALF DONE');
    } else if (cleared) {
      /* The last chore on your own list used to get the same card as the
         first, so the moment every Castaway reaches was the flattest one in
         the round. The rest of the work is other people's from here. */
      this.audio.sfx('victory');
      this.ui.showPopup(
        'YOUR LIST IS CLEAR',
        `${Math.max(0, (M.view.tasksTotal || 0) - (M.view.tasksDone || 0))} STEPS LEFT ON THE ISLAND`,
        'task', 'NOTHING LEFT TO DO BUT WATCH',
      );
    } else {
      this.ui.showPopup(stage.name, 'THAT IS ONE OFF THE LIST', 'task', 'TASK DONE');
    }
    this._compassForTasks();
  }

  /**
   * What the island does about it. A ring of light is generic; this is the
   * bit that makes each chore feel like a different job.
   */
  _taskWorldFx(id, stage, next) {
    const at = stage?.at;
    /* Both three-part chores spend their first two stages on the same
       landmark, so the pair below would fire twice on the way through. Only
       the last stage there gets to throw it. */
    const last = !next || next.at !== at;

    /* The relic and the Pendulum are not here any more: what they do LATCHES,
       and this path is private to whoever did the work, so the island only
       ever lit up for one person and everybody else walked past a dead tower
       all round. They ride S.WORLDFX now — see _onWorldFx. The bang stays,
       because a noise is for the one who made it. */
    if (id === 'tasha' && at === 'tasha' && last) this.audio.sfx('orbShatter');
    if (id === 'plane' && at === 'aerlingus' && last) this.audio.sfx('slam');
    if (id === 'crate' && at === 'crates') {
      // the crate you just shouldered comes off the stack
      const loose = this.hutNode?.userData.crate;
      if (loose && loose.visible) {
        loose.visible = false;
        this._runLater(() => { if (loose) loose.visible = true; }, 45000);
      }
    }
    if (id === 'fire' || id === 'torches') {
      // the fire jumps
      const f = this.campfire?.userData.flames;
      if (f) {
        f.scale.setScalar(1.9);
        this._runLater(() => f.scale.setScalar(1), 1400);
      }
      /* A clock, not a value. Two per-frame writers own this light —
         tickIslandWorld and updateDayNight — so a direct write here was
         overwritten before the frame ended and the fire never jumped at
         all. Nothing to brighten if the lights are out. */
      if (!this.doused) this.fireFlareUntil = this.time + 1.4;
    }
    if (id === 'brazier' && this.templeDoor) {
      for (const fl of (this.templeDoor.userData.fires || [])) {
        fl.scale.setScalar(1.8);
        this._runLater(() => fl.scale.setScalar(1), 1600);
      }
    }
    if (id === 'sweep' && this.templeDoor?.userData.light) {
      this.templeDoor.userData.light.intensity = 4.2;
      this._runLater(() => { if (this.templeDoor) this.templeDoor.userData.light.intensity = 1.1; }, 1800);
    }
  }

  /**
   * The mark a finished step leaves on the island, told to everybody.
   *
   * All that crosses the wire is the landmark — no doer, no position, since
   * knowing a chore was done is not knowing who was standing there — so the
   * latch is keyed on the place. Every one of these is idempotent, which is
   * what lets a landmark that carries two stages of the same chore say so
   * twice without any of it mattering.
   */
  /* `last` matters because a two-part chore spends both stages at the same
     landmark: the relic is the finished job, not the opened panel. */
  _onWorldFx(at, last = true) {
    if (!at) return;
    if (last && (at === 'tasha' || at === 'aerlingus')) {
      (this.relicNodes || []).find((r) => r.kind === at)?.mesh.userData.setFixed?.(true);
    }
    if (at.startsWith('pend')) {
      // found by landmark, because the meshes are built in PENDULUMS order,
      // not pend1..4
      const i = PENDULUMS.findIndex((pd) => pd.place === at);
      if (i >= 0) (this.pendulumMeshes || [])[i]?.userData.activate?.();
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

  /* A toast, and only a toast. This also wrote the line into mp.notice on a
     three second clock for a banner that was never built and nothing ever
     read, and the channel carries routine chatter — REPAIRED, NETWORK, a
     name leaving — so it is not a thing to put across the picture either. */
  _notice(text) {
    this.ui.toast(text, 'jade', 2600);
  }

  /**
   * S.FIXED is how a sabotage ends, and only one of the ways it ends is
   * somebody fixing it. REPAIRED over a storm that simply ran out was free
   * cover for the Agent who pulled it; over a fatal one it sat next to the
   * results card, and over a meeting it announced a repair nobody did.
   */
  _fixedNotice(why) {
    if (!why || why === 'fix') this._notice('REPAIRED');
    else if (why === 'expired') this._notice('IT PASSED ON ITS OWN');
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

  /** Transient controls and overlays belong to a round, never a rematch. */
  _resetRoundControls() {
    const M = this.mp;
    this._clearHeldInput();
    M.taskProgress = M.marked = M.killTarget = M.reportTarget = null;
    M.snap = M.spectate = M.doneFlash = null;
    M.bodyCardUntil = 0;
    M.aboard = false;
    M.devKitPending = false;
    M.stunned?.clear();
    this.stunnedUntil = 0;
    this._hrCooldown = this._barCooldown = this._cabCooldown = this._ufoCooldown = false;
    if (this.deathShot) this._endDeathShot();
    this.ui.clearToasts?.();
    if (this.ui.hud?.data) {
      Object.assign(this.ui.hud.data, { popup: null, prompt: null, mp: null, hurtT: 0 });
    }
    for (const av of M.avatars.values()) av.setShell(null);
    // Effects whose reset timers were canceled with the previous round.
    if (this.hutNode?.userData.crate) this.hutNode.userData.crate.visible = true;
    this.campfire?.userData.flames?.scale.setScalar(1);
    for (const flame of this.templeDoor?.userData.fires || []) flame.scale.setScalar(1);
    if (this.templeDoor?.userData.light) this.templeDoor.userData.light.intensity = 1.1;
    if (this.pistolModel?.userData.glow) this.pistolModel.userData.glow.intensity = 0;
    this.fireFlareUntil = 0;
  }

  startCastaways() {
    // Reuse the single-player world wholesale, minus the story.
    this.paused = false;
    this._runGen = (this._runGen || 0) + 1;
    this._clearHeldInput();
    this._resetRoundControls();
    this.state = 'island';
    this.scene = this.islandScene;
    this.runTime = 0;
    this.clock24 = 0;
    this.night = 0;
    this.stunnedUntil = 0;
    this._adrift = 0;
    this._tideSaid = false;

    this.player.hp = this.player.maxHp;
    this.player.frozen = false;
    this.player.stamina = 1;
    this.player.staminaLock = false;
    this.player.invuln = 0;
    this.player.shake = this.player.throwAnim = 0;
    this.player.insideBox = null;
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
    /* The end of a round leaves both of these standing: `finished` stops the
       council ever re-arming, and `cool` is the client's copy of the sabotage
       timers, which the host already forgot in toLobby(). */
    M2.finished = false;
    M2.cool = {};
    for (const d of (M2.drops || [])) this._retireDrop(d);
    M2.drops = [];
    M2.chaffUntil = 0;
    M2.speaker = null;
    if (M2.speakerNode) setHidden(M2.speakerNode, true);
    /* And the one on the treeline, who is otherwise still standing where he
       was when the last round ended, and glides across the island from there
       the moment the host places him again. */
    M2.stranger = null;
    M2.strangerGone = 0;
    if (M2.strangerNode) {
      M2.strangerNode.userData.setFade(0);
      M2.strangerNode.userData.at = null;
    }
    for (const v of (this.vendors || [])) v.spent = false;
    this._buildSpeakerNode();
    // [RELEASE] REMOVE BEFORE RELEASE — the workshop starts knowing the post.
    this.knowsBunker = !!M2.dev;
    /* A round that ends inside a live sabotage never sees the S.FIXED that
       would have undone it, so the douse, the jam and the storm used to run
       on into the next round — and into single player after a quit. */
    this._clearSabotageWorld();
    this.flask = false;
    this.coins = 0;
    this.owned = new Set();
    this.carry = [];
    /* And the state those items put on the player. Emptying the pockets
       without undoing what was in them left last round's vest weight, last
       round's Schlarna debt and last round's drawn pistol on you — and the
       vest was gone, so you were slower for a protection you no longer had. */
    this.player.SPEED = this.player.BASE_SPEED;
    this.player.SPRINT = this.player.BASE_SPRINT;
    this.player.staminaDrain = this.player.BASE_DRAIN;
    this.player.staminaRegen = this.player.BASE_REGEN;
    this.player.drift = 0;
    this.plan = null;
    this.pistolOut = false;
    // and the shell back in the breech, or the pistol reads spent for ever
    if (this.pistolModel) {
      this.pistolModel.visible = false;
      this.pistolModel.userData.flare.visible = true;
    }
    this.printerOn = false;
    this.scannerOn = false;
    this.scanLock = null;
    // alive again, and not watching over anybody's shoulder
    this.mp.spectate = null;
    this._setSelfGhost(false);      // reverts the material, not just the flag
    this.alibiUntil = 0;
    this.freePulls = 0;
    this.nightEyes = false;
    this.doubleCoins = false;
    this.bigMeals = false;
    // Cathy's permanent plates, and the one that wears off
    this.ate = new Set();
    this.coinSense = false;
    this.coinNeedle = false;
    this.flossUntil = 0;
    this.drunkUntil = 0;
    this.drunkPeak = 0;
    this.tab = null;                // last round's bar tab does not follow you
    if (this.pipeline) this.pipeline.drunk = 0;
    /* The hole is filled in again for a new round, the same as the host's
       side does (see HostSession.start). The X node's state object lives for
       the whole session, so without this round two found an open, empty
       chest that nobody could dig, open or hear on the scanner. */
    if (this.buried) {
      const bs = this.buried;
      bs.state.dug = 0; bs.state.open = 0; bs.state.taken = false;
      bs.said = false; bs.saidHalf = false;
      bs.digging = 0; bs.lastSpade = 0; bs.sent = 0;
      if (bs.collider) {
        const i = this.colliders.indexOf(bs.collider);
        if (i >= 0) this.colliders.splice(i, 1);
        bs.collider = null;
      }
      bs.solid = false;
      this.player.setColliders(this.colliders);
    }
    this.foundX = false;
    this._saidSanct = false;
    /* The two durable marks a chore leaves — the lit lighthouse eye and the
       stripped fuselage — and the towers a wind woke. Nothing else ever puts
       any of them back, so they stayed on for the rest of the session and
       `activate`'s own guard then silently refused every later wind. */
    for (const r of (this.relicNodes || [])) r.mesh.userData.setFixed?.(false);
    for (const m of (this.pendulumMeshes || [])) m.userData.reset?.();
    /* The money on the ground, back where it was. Only the single-player
       start ever undid a pickup, so every coin anybody walked over stayed
       taken and invisible for the rest of the session — and an Agent, whose
       chores pay nothing, had no income at all from round two on. */
    this.coinFx = this.coinFx || [];
    this.coinFx.length = 0;
    for (const c of (this.syncoins || [])) {
      c.taken = false;
      const m = c.mesh;
      if (!m) continue;
      m.visible = true;
      // a flourish cut short by the round ending owns the coin's tick for ever
      m.userData.flourish = false;
      m.scale.setScalar(1);
      m.position.set(c.x, m.userData.baseY ?? m.position.y, c.z);
      m.userData.setSense?.(false);
    }
    // she keeps her own hours; start her wherever the clock says she is
    if (this.casinoDock) this.casinoIn = this.night > 0.34 ? 1 : 0;
    this.resetCameras();
    this.receipts = [];
    M2.sale = null;
    M2.saleDay = 0;
    this._lastDawn = 0;
    this.rollSale();

    this._resolveTaskSites();

    /* The effect pools, the beacons and the boombox are built here, after
       the loading screen's warm-up has already run. Compile them now,
       while the reveal card is still up, rather than the first time
       somebody finishes a chore or somebody dies. */
    const warmHidden = [];
    let warmTarget = null;
    try {
      /* The man on the treeline, built now rather than on the frame he first
         appears. His body is the only transparent ps1-Lambert in the scene,
         so nothing else warms that program — and the ghost material every
         dead castaway wears has the same cache key and rides along for
         free. buildStranger ends on setFade(0), so he is hidden already. */
      if (this.islandScene && !M2.strangerNode) {
        M2.strangerNode = buildStranger(this.propMats);
        this.islandScene.add(M2.strangerNode);
        this.tickers.push(M2.strangerNode);
      }
      /* Anything built since the loading screen may have brought a light
         with it. Put those on the rig BEFORE compiling, or this compiles
         every material for a light count the game will never render at
         and does it all again on the first frame. */
      rigScene(this.islandScene);
      this.islandScene.traverse((o) => {
        if (o.userData.rigOff) return;
        if (o.visible === false) { o.visible = true; warmHidden.push(o); }
      });
      /* Into the target, not the canvas — the output colour space is part
         of every program's cache key, so compiling with nothing bound
         builds the twin of each program that nothing ever draws with. See
         the warm-up in game.js. */
      warmTarget = this.renderer.getRenderTarget?.() || null;
      this.renderer.setRenderTarget(this.pipeline.target);
      this.renderer.compile(this.islandScene, this.camera);
    } catch (e) { /* never worth failing a round start over */ }
    finally {
      // A compile failure must not reveal every intentionally hidden prop
      // or leave the renderer bound to a warming target for the whole round.
      for (const o of warmHidden) o.visible = false;
      try { this.renderer?.setRenderTarget?.(warmTarget); } catch (e) { /* context lost */ }
    }

    this.ui.show();
    this.ui.setObjective('');
    this._requestLock();
  }

  /** Turn task landmark names into world positions. */
  _resolveTaskSites() {
    const M = this.mp;
    const named = {
      camp: this.campfirePos || this.spawn,
      /* Not for a chore — the host's emergency-meeting check asks siteOf
         for it, and the bell hangs at the camp, not at the spawn. */
      bell: this.campPos || this.spawn,
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
      buried: this.buried,
    };
    /* Keyed by the tower's own landmark, not by where it sits in the list.
       PENDULUMS is declared in the order pend2, pend3, pend1, pend4, so
       numbering them off the array made WIND THE WEST point at the north
       ridge and gave the Stranger the wrong tower to name in council. */
    for (const it of this.interactables) {
      if (it.kind !== 'pendulum') continue;
      const place = PENDULUMS[it.index]?.place;
      if (place) named[place] = { x: it.x, z: it.z };
    }
    for (const it of this.interactables) {
      if (it.kind === 'relic') named[it.relic] = { x: it.x, z: it.z };
    }
    /* Not chores either. The host refuses a pull you are not standing at, and
       a machine it cannot place is not one it can refuse anybody at — without
       these two the check reads `where` as null and waves everybody through
       from anywhere on the island. */
    (this.vendors || []).forEach((v, i) => { named['vend' + (i + 1)] = { x: v.x, z: v.z }; });
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
    /* Detaching them is not freeing them: three keeps the buffers until
       something disposes of the geometry, and a rematch builds a whole new
       set over the top of the last one. */
    for (const b of (M.beaconNodes || [])) {
      b.removeFromParent(); b.geometry.dispose(); b.material.dispose();
    }
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
    /* Every tick carries the name of its own sprite. Named rather than
       guessed from the label, so renaming one cannot quietly lose its
       picture — and on a crowded bearing the picture is the half that
       survives. See POI_ICONS in lib/hud.js. */
    const pois = [];
    /* One tick for the camp, not two. The bell hangs at the camp centre and
       the fire sits a few metres off it — the same bearing from anywhere far
       enough away to need a compass, so the two names always landed on each
       other and one of them was thrown away for its trouble. The camp is
       named for what you can still do there: the bell while you have a
       meeting left to call, the fire once you have spent them. */
    const bell = this.campPos || this.spawn;
    const fire = this.campfirePos || this.campPos || this.spawn;
    if ((this.me?.emergencies ?? 0) > 0) {
      pois.push({ label: 'BELL', x: bell.x, z: bell.z, kind: 'poi', icon: 'bell' });
    } else {
      pois.push({ label: 'FIRE', x: fire.x, z: fire.z, kind: 'poi', icon: 'fire' });
    }
    /* One chore: the one you are nearest. Five identical green pips gave you
       five bearings and not a word about which of them was yours to walk to,
       and every chore you have left is already standing under its own beacon
       out in the world. The strip carries the next one; the chart carries
       the plan. */
    const job = this._nearestTaskSite();
    if (job) pois.push({ label: '', x: job.x, z: job.z, kind: 'job' });
    /* Wherever the current sabotage has to be repaired, marked in red and
       blinking. Being told the island is on fire without being told where
       the bucket is was not much of a callout. */
    if (M.speaker) pois.push({ label: 'BOX', x: M.speaker.x, z: M.speaker.z, kind: 'poi', icon: 'box' });
    if ((this.knowsBunker || this.state === 'bunker') && M.bunker) {
      pois.push({ label: 'POST', x: M.bunker.x, z: M.bunker.z, kind: 'poi', icon: 'post' });
    }
    /* Ferdi's delivery notes: the nearest machine still worth the walk. Both
       at once were two ticks reading MACHINE on one errand with nothing to
       tell them apart, and one you cannot make the six for is a walk to a
       drum that will not turn. */
    const vend = this._nearestVendor();
    if (vend) {
      pois.push({ label: 'MACHINE', x: vend.x, z: vend.z, kind: 'poi', icon: 'machine' });
    }
    /* Once you have spoken to her, Cathy is on your compass. Before that
       she is on the map and nowhere else, which is the whole point of her
       being out there. */
    if (this.metCathy && this.cathy) {
      pois.push({ label: 'CATHY', x: this.cathy.x, z: this.cathy.z, kind: 'poi', icon: 'cathy' });
    }
    if (this.foundX && this.buried && !this.buried.state.taken) {
      pois.push({ label: 'X', x: this.buried.x, z: this.buried.z, kind: 'goal', icon: 'dig' });
    }
    /* Where the light is standing on the sand, for as long as it is there.
       Three minutes is not long enough to go looking for something on an
       island this size, and a night event nobody can find is a night event
       that did not happen. */
    if (M.ufo && this.ufoBeamPos) {
      pois.push({
        label: 'LIGHT', x: this.ufoBeamPos.x, z: this.ufoBeamPos.z, kind: 'goal', icon: 'ufo',
      });
    }

    /* Cathy's sauce puts a needle on the nearest loose coin, and her eggs
       put a tick on every one inside seventy metres. */
    this._coinPois(pois);

    const sab = M.view.sabotage;
    if (sab) {
      const def = SABOTAGE_DEFS[sab.kind];
      for (const at of (def?.fixAt || [])) {
        const site = this._namedSite(at);
        if (site) pois.push({ label: 'FIX', x: site.x, z: site.z, kind: 'fix', icon: 'fix' });
      }
    }
    this.ui.setCompassPois(pois);
  }

  /** The chore you are closest to. Nothing while the tools are scattered. */
  _nearestTaskSite() {
    const M = this.mp;
    if (this.scattered) return null;
    const p = this.player.pos;
    let near = null, nearD = Infinity;
    for (const id of (M.view?.tasks || [])) {
      if (M.view.doneTasks.has(id)) continue;
      const site = this._taskSite(id);
      if (!site) continue;
      const d = Math.hypot(p.x - site.x, p.z - site.z);
      if (d < nearD) { nearD = d; near = site; }
    }
    return near;
  }

  /** The nearest machine you hold the notes for and can still pay at. */
  _nearestVendor() {
    if (!this.hasItem('rounds') || (this.coins || 0) < VEND_COST) return null;
    const p = this.player.pos;
    let near = null, nearD = Infinity;
    for (const v of (this.vendors || [])) {
      if (v.spent) continue;
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < nearD) { nearD = d; near = v; }
    }
    return near;
  }

  /* Both of those change with every step you take, and the compass is only
     rebuilt when something happens — so a tick that says "the nearest one"
     has to be told when the answer changes, or it goes on pointing at the
     one you walked away from. Twice a second and only on a change: the same
     handful of distances the coin sweep already does. */
  _tickNearestPois() {
    const M = this.mp;
    if (!M.started || M.view.phase !== PHASE.ROAM) return;
    const t = performance.now() / 1000;
    if (t - (this._nearPoiAt || 0) < 0.5) return;
    this._nearPoiAt = t;
    const j = this._nearestTaskSite(), v = this._nearestVendor();
    const key = `${j ? `${j.x | 0},${j.z | 0}` : '-'}|${v ? `${v.x | 0},${v.z | 0}` : '-'}`;
    if (key === this._nearPoiKey) return;
    this._nearPoiKey = key;
    this._compassForTasks();
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
    let bodyD = Infinity, bodyBest = null;
    if (this.amAlive) {
      /* The host drops a REPORT during a fatal sabotage without a word, so
         the prompt has to say why rather than offer a button that does
         nothing. */
      const jam = !!M.view.sabotage?.fatal;
      // a body to report
      for (const b of M.bodies.values()) {
        if ((b.room | 0) !== this.roomId) continue;   // theirs is another room
        const d = Math.hypot(p.x - b.mesh.position.x, p.z - b.mesh.position.z);
        if (d < 4.0 && d < bodyD) {
          bodyD = d;
          bodyBest = {
            kind: 'mpReport', bodyId: b.id,
            prompt: jam ? 'NO REPORTS - PENDULUMS JAMMED' : `REPORT ${b.name}`,
          };
        }
      }
      if (bodyBest) { bestD = bodyD; best = bodyBest; }
      /* The bell hangs at the camp, not at the spawn point — the spawn is
         four metres from the wreck, so a bell there sat on top of the two
         chores that live in the hull and neither could ever be reached. */
      const bell = this.campPos || this.spawn;
      const dc = Math.hypot(p.x - bell.x, p.z - bell.z);
      if (!this.inRoom && dc < 3.4 && dc < bestD) {
        bestD = dc;
        /* Say so rather than offering nothing: standing at a bell that gives
           no prompt reads as a bug. `none` falls through interact(). */
        best = (this.me?.emergencies ?? 0) > 0
          ? { kind: 'mpBell', prompt: jam ? 'NO COUNCIL - PENDULUMS JAMMED' : 'CALL A COUNCIL' }
          : { kind: 'none', prompt: 'NO COUNCILS LEFT' };
      }
    }

    /* Your own chores outrank everything. Whatever else is underfoot, the
       thing you came here to do is the thing E should be offering. */
    let taskD = Infinity, taskBest = null;
    for (const id of (this.inRoom ? [] : M.view.tasks)) {
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
    /* ...except a corpse that is literally nearer than the chore site. The
       report reaches 4.0 m and a chore 4.6, so a body dropped on one of your
       own sites used to be unreportable from anywhere at all — there was no
       spot left to stand in. Step towards it and it wins; stand on the site
       and the chore still does. */
    if (taskBest && !(bodyBest && bodyD < taskD)) { bestD = taskD; best = taskBest; }

    // sabotage repair
    const sab = M.view.sabotage;
    if (sab && this.amAlive && !this.inRoom) {
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

    // Purses and bodies keep their room coordinates, and must remain
    // reachable before an interior's furniture-specific early returns.
    if (this.inRoom && this.amAlive) {
      let nearby = bodyBest, distance = bodyD;
      for (const drop of M.drops || []) {
        if (drop.taken || (drop.room | 0) !== this.roomId) continue;
        const d = Math.hypot(p.x - drop.x, p.z - drop.z);
        if (d < 3 && d < distance) {
          distance = d;
          nearby = { kind: 'purse', drop, prompt: `${drop.coins} SYNCOIN` };
        }
      }
      if (nearby) return nearby;
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
    if (this.state === 'cab') {
      const dt4 = Math.hypot(p.x - 0, p.z - (-1.5));
      if (dt4 < 2.4) return { kind: 'mpCams', prompt: 'THE TERMINAL' };
      const dsh = Math.hypot(p.x - 1.6, p.z - (-2.2));
      if (dsh < 1.8) return { kind: 'mpTakeCams', prompt: 'THE SPARES SHELF' };
      const ddn = Math.hypot(p.x - 0, p.z - 2.2);
      if (ddn < 1.8 && !this._cabCooldown) return { kind: 'mpCabOut', prompt: 'BACK DOWN' };
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
    /* Inside it. There is no door and no way out but the way the saucer
       chooses, so the only two things E does in here are lift the machine
       off its plinth and point it at somebody. */
    if (this.state === 'ufo') {
      if (!this.amAlive) return null;
      /* `bodyBest` is the one thing found above that is room-aware, so it is
         the one thing allowed through: the chores, the bell and the rest are
         island coordinates and would fire on whatever they happened to line
         up with in here. Somebody killed under the plinth is still somebody
         you can point at, and three minutes is long enough to be killed in. */
      const fallback = bodyBest;
      const mine = M.scannerBy === M.view.selfId;
      if (mine) {
        const v = this._nearestScanTarget();
        if (v) {
          const rec = M.view.players.get(v.id);
          /* The warning goes on the prompt, not on a card afterwards. By the
             time anybody would read an afterwards the only scan the lobby
             gets tonight is already spent. */
          return {
            kind: 'mpScan', targetId: v.id,
            prompt: `SCAN ${(rec?.name || '?').toUpperCase()} - THE ONLY ONE`,
          };
        }
        return fallback;
      }
      const dp = Math.hypot(p.x - UFO_PLINTH.x, p.z - UFO_PLINTH.z);
      if (dp < 2.8) {
        /* Four different reasons the plinth might not give you anything, and
           every one of them is a thing the room is trying to teach. Saying
           nothing at all here was what made the plate look broken. */
        if (M.scannerSpent) return { kind: 'none', prompt: 'IT HAS BEEN USED' };
        if (M.scannerBy) return { kind: 'none', prompt: 'SOMEBODY HAS IT' };
        /* Somebody ELSE, which is the whole point of the plate. The plinth
           and the plate are six metres apart, so this is not a rule anybody
           could break by standing carefully — but the prompt has to say what
           is missing, not offer a key that the host will refuse. */
        if (!this._plateHeldByOther()) {
          return { kind: 'none', prompt: 'SOMEBODY MUST HOLD THE PLATE' };
        }
        return { kind: 'mpTakeScan', prompt: 'TAKE THE SCANNER' };
      }
      return fallback;
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

    /* The foot of the mast's ladder. */
    if (this.tower && this.amAlive && !this._cabCooldown) {
      const a = Math.PI / 4 + Math.PI;
      const lx = this.tower.x + Math.cos(a) * 3.0, lz = this.tower.z + Math.sin(a) * 3.0;
      const dl = Math.hypot(p.x - lx, p.z - lz);
      if (dl < 3.0 && dl < bestD) { bestD = dl; best = { kind: 'mpLadderUp', prompt: 'CLIMB THE MAST' }; }
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
      /* The safe circle is thirteen metres wide and nothing anywhere told
         anybody it existed — Castaways never learned they were safe and
         Agents only learned the key had stopped working. Taught off
         `inSanctuary` rather than the counter's prompt radius, so a shut
         shop correctly says nothing. */
      if (!this._saidSanct && this.inSanctuary(p.x, p.z)) {
        this._saidSanct = true;
        this.ui.toast('FERDI KEEPS THE PEACE - NOBODY DIES HERE', 'jade', 3400);
      }
      /* Measured from the COUNTER, not from the middle of the building.
         A 7.5 m circle on `hutPos` reached three metres past the back wall
         and well past both sides, so you could buy through the planking
         from a spot where Ferdi is not even visible. Single player has this
         right: the stall stands 3.6 m out along the hut's facing and
         answers within 5.2 m, which reaches back to hut-local z = -1.6 —
         over the counter, short of the back wall at -2.5. */
      const hy = this.hutNode ? this.hutNode.rotation.y : 0;
      const dcount = Math.hypot(
        p.x - (this.hutPos.x + Math.sin(hy) * 3.6),
        p.z - (this.hutPos.z + Math.cos(hy) * 3.6),
      );
      if (dcount < 5.2 && dcount < bestD) {
        bestD = dcount; best = { kind: 'mpShop', prompt: 'FERDI STEINMAN' };
      }
    }

    // a dead player's purse, lying where they fell
    if (this.amAlive) for (const d of (M.drops || [])) {
      if (d.taken || (d.room | 0) !== this.roomId) continue;
      const dd = Math.hypot(p.x - d.x, p.z - d.z);
      if (dd < 6.0 && dd < bestD) { bestD = dd; best = { kind: 'purse', drop: d, prompt: `${d.coins} SYNCOIN` }; }
    }

    /* Coins are collected by walking into them (see _sweepCoins); the
       prompt only exists so you know one is nearby if you walk past
       looking the other way. */
    if (this.amAlive) for (const c of (this.syncoins || [])) {
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
    if (this.stunnedUntil && now() < this.stunnedUntil) return;
    const it = this.nearestInteractable();
    if (!it) return;
    const M = this.mp;

    switch (it.kind) {
      case 'mpTask': {
        const stage = this._taskStage(it.taskId);
        /* The Flopper's Flask is sold as "no holding, no puzzle", so it has
           to fire before the puzzle window opens rather than after it has
           already returned — the puzzle stages are the ones it is bought for. */
        if (this.flask) {
          this.flask = false;
          this._send({ t: C.DO_TASK, taskId: it.taskId, step: M.view.taskStep.get(it.taskId) || 0 });
          this.audio.sfx('victory');
          this.ui.toast("THE FLOPPER'S FLASK", 'jade', 1800);
          break;
        }
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
          return;
        }
        M.taskProgress = {
          taskId: it.taskId, step: M.view.taskStep.get(it.taskId) || 0,
          t: 0, secs: stage.secs || 3, verb: stage.verb || 'WORKING',
          name: stage.name, fx: stage.fx,
          x: this.player.pos.x, z: this.player.pos.z,
        };
        this.player.playThrow();
        this.audio.sfx('charge');
        break;
      }
      case 'mpReport':
      case 'mpBell':
        /* The host refuses meetings while a fatal sabotage runs and says
           nothing, so pressing E on a body simply did nothing at all. */
        if (M.view.sabotage?.fatal) {
          this.audio.sfx('deny');
          this.ui.toast('NOBODY MEETS WHILE THE PENDULUMS ARE STOPPED', 'bad', 2600);
          break;
        }
        this._send({ t: C.REPORT, bodyId: it.kind === 'mpReport' ? it.bodyId : null });
        break;
      case 'mpFix': {
        M.taskProgress = {
          fix: it.fix, at: it.at, t: 0, secs: SABOTAGE_DEFS[it.fix]?.fixSecs ?? 3,
          verb: 'REPAIRING', name: 'REPAIR',
          x: this.player.pos.x, z: this.player.pos.z,
        };
        this.player.playThrow();
        this.audio.sfx('charge');
        break;
      }
      case 'mpHatch': {
        this.enterBunker();
        break;
      }
      case 'mpTable': {
        this.screens.push('mpTable', {});
        document.exitPointerLock?.();
        this.audio.sfx('terminal');
        this._runLater(() => this.audio.sfx('ping'), 420);
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
        break;
      }
      case 'mpTable2': {
        this.screens.push('mpBlackjack', {});
        document.exitPointerLock?.();
        break;
      }
      case 'mpDoorOut': {
        this.leaveHighRoller();
        break;
      }
      case 'mpDig': break;      // held, not pressed: see _tickDig
      case 'mpDug': break;
      case 'mpChest': { this.openChest(); break; }
      case 'mpLadderUp': { this.enterCab(); break; }
      case 'mpCabOut': { this.leaveCab(); break; }
      case 'mpTakeCams': {
        this.audio.sfx('deny');
        this.ui.toast('THE SPARES ARE GONE - FERDI SELLS THEM', 'bad', 3000);
        break;
      }
      case 'mpCams': {
        this._initCameras();
        this.screens.push('mpCams', { sel: 0 });
        document.exitPointerLock?.();
        this.audio.sfx('terminal');
        break;
      }
      case 'mpTakeScan': { this.takeScanner(); break; }
      case 'mpScan': { this.fireScan(it.targetId); break; }
      case 'mpBarDoor': { this.enterBar(); break; }
      case 'mpBarOut': { this.leaveBar(); break; }
      case 'mpBar': {
        this.screens.push('mpBar', { sel: 0 });
        document.exitPointerLock?.();
        break;
      }
      case 'mpDarts': {
        this.screens.push('mpDarts', {});
        document.exitPointerLock?.();
        break;
      }
      case 'mpFlopper': {
        this.screens.push('mpFlopper', {});
        document.exitPointerLock?.();
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
        break;
      }
      case 'mpShop':
        this.screens.push('mpShop', { sel: 0, side: 0 });
        document.exitPointerLock?.();
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
    /* On the sand and seeing stars. The pistol has always refused while a
       flare is on you and the knife never did, so a stunned Agent could
       still take somebody out of the middle of the vote about him. */
    if (this.stunnedUntil && now() < this.stunnedUntil) { this.audio.sfx('deny'); return; }
    if (M.myKillReady && now() < M.myKillReady) return;
    /* The host edits `host.settings` directly and never receives a WELCOME,
       so its mirror copy is still the defaults — read the authority when we
       are it, the mirror when we are not. Reading only the mirror meant the
       host's own knife was refused by the host with no word at all. */
    const sset = M.host?.settings || M.view.settings;
    if (sset?.nightOnly && (this.night || 0) <= 0.5) {
      this.audio.sfx('deny');
      this._notice('NOT IN DAYLIGHT');
      return;
    }
    const target = this._nearestVictim();
    if (!target) {
      if (this._sanctBlocked && (!this._sanctSaid || now() - this._sanctSaid > 2.5)) {
        this._sanctSaid = now();
        this.audio.sfx('deny');
        this._notice("FERDI'S COUNTER IS NEUTRAL GROUND");
      }
      return;
    }
    this._send({ t: C.KILL, targetId: target.id });
    this.player.playThrow();
  }

  /** Ferdi's is neutral ground, unless somebody has shut it. */
  inSanctuary(x, z) {
    if (this.inRoom || this.shopShut || !this.hutPos) return false;
    return Math.hypot(x - this.hutPos.x, z - this.hutPos.z) < SANCTUARY_R;
  }

  _nearestVictim() {
    const M = this.mp;
    const p = this.player.pos;
    /* Why the refusal is remembered rather than just returned: a kill inside
       the ring drew no outline, printed no prompt and made no sound, so the
       one key the whole role is built around simply did nothing. tryKill
       reads this immediately after calling us, so a flag costs no allocation
       on a path that runs twice a frame. */
    this._sanctBlocked = false;
    if (this.inSanctuary(p.x, p.z)) { this._sanctBlocked = true; return null; }
    let best = null, bestD = Infinity;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      // somebody in another interior is not in front of you; the host
      // refuses those kills without a word
      if ((av.room | 0) !== this.roomId) continue;
      const d = Math.hypot(p.x - av.pos.x, p.z - av.pos.z);
      /* Whoever is already outlined keeps it out to the host's own limit.
         One reach for both meant somebody standing at 4.6 was marked and
         dropped frame after frame, and the outline strobed. */
      if (d > (av === M.marked ? 4.8 : 4.6)) continue;
      // tested after the reach, or somebody protected three rooms away
      // would claim the refusal
      if (this.inSanctuary(av.pos.x, av.pos.z)) { this._sanctBlocked = true; continue; }
      if (d < bestD) { bestD = d; best = av; }
    }
    return best;
  }

  _send(msg) {
    const M = this.mp;
    if (this.isHost) { if (M.host) M.host._recv(msg, 'host'); return; }
    /* No socket means no session — a queued callback firing after you
       have quit to the lobby, or anything that reaches this outside a
       round. Dropping the message is right; throwing takes the frame
       down with it. */
    if (M.net) M.net.sendHost(msg);
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
      && !(this.stunnedUntil && now() < this.stunnedUntil)
      && !(M.view.settings?.nightOnly && (this.night || 0) <= 0.5)
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
    const self = this;         // `this` inside the live getters below is the data object
    const jobs = this.scattered ? [] : M.view.tasks
      .map((id) => ({ id, site: this._taskSite(id), done: M.view.doneTasks.has(id) }))
      .filter((j) => j.site);
    const left = jobs.filter((j) => !j.done).length;
    const below = this.state !== 'island';
    this.screens.push('chart', {
      agentSide: this.amAgent,
      // below decks the cross is where you went down, not where you are
      subtitle: below ? 'BELOW DECKS. THE CROSS IS THE WAY YOU CAME IN.'
        : (this.scattered ? 'THE MARKERS ARE GONE. FROM MEMORY, THEN.'
          : (this.amAgent
            ? 'THE LIST IS A COVER. WALK IT ANYWAY.'
            : (left ? `${left} STILL TO DO` : 'YOUR WORK IS DONE'))),
      data: {
        heightAt, radius: ISLAND.shore + 14,
        /* The listening post, once you have paid for the chart that shows
           it. This was the bug: knowsBunker fed the compass and nothing
           else, so the one item you bought specifically to put a cross on
           the chart never put one there. */
        marks: [
          ...((this.knowsBunker && M.bunker)
            ? [{ x: M.bunker.x, z: M.bunker.z, label: 'LISTENING POST', found: true, icon: 'post' }]
            : []),
        ],
        /* The machines get their own picture rather than a red cross
           labelled MACHINE, and only once you have paid for the map that
           shows them. */
        vendors: this.hasItem('rounds')
          ? (this.vendors || []).filter((v) => !v.spent).map((v) => ({ x: v.x, z: v.z }))
          : [],
        // named, so zooming in tells you which job is which
        jobs: jobs.map((j) => ({
          x: j.site.x, z: j.site.z, done: j.done,
          name: this._taskStage(j.id).name,
        })),
        temple: this.templeDoorPos,
        fire: this.campfirePos || this.spawn || null,
        tower: this.tower ? { x: this.tower.x, z: this.tower.z } : null,
        casino: this.casinoIn > 0.5 ? this.casinoPos : null,
        /* Every interior is its own local coordinate space, so plotting the
           live position while you are below decks planted the pip — and the
           first-open centring — in the middle of the island. Show where you
           went down instead, and drop `facing` entirely: drawChart only
           draws the arrow when it is present, and a room-local yaw means
           nothing out here. */
        player: below ? (this._islandPos || this.spawn || { x: 0, z: 0 }) : this.player.pos,
        facing: below ? undefined : this.player.facing,
        inside: below || undefined,
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
        /* A getter, because drawChart reads this every frame and nothing
           ever rebuilds the data object: built as a list of copied numbers
           the living were frozen where they stood at the moment the ghost
           pressed M, and only moved when the map was closed and reopened.
           The overrides have to be resolved per frame too — an alibi or a
           Party Box that starts while the chart is open must lie on it. */
        get others() {
          return [...M.avatars.values()]
            .filter((a) => (M.view.players.get(a.id)?.alive !== false) && !self.amAlive)
            .map((a) => {
              const rec = M.view.players.get(a.id);
              const bx = M.speaker && now() < M.speaker.until ? M.speaker : null;
              /* Same local-space trap on the other side: a ghost watching the
                 round saw everybody who had gone below stacked on the island's
                 origin. Plot them at the way in instead. The box and the alibi
                 are already island coordinates, and both still lie first. */
              const at = bx || rec?.decoy || self._roomAnchor(a.room) || a.pos;
              return { x: at.x, z: at.z, colour: colourHex(a.colour) };
            });
        },
      },
    });
    document.exitPointerLock?.();
  }

  /* Castaways reads its own held-E flag, so Game's "let go of everything"
     has to reach it too — a chore held through a pause or an alt-tab kept
     charging otherwise. The guard is for construction order: Game's
     constructor binds its events before `this.mp` exists. */
  _clearHeldInput() {
    super._clearHeldInput();
    if (this.mp) this.mp.holdingE = this.mp.holdingClick = false;
  }

  _key(e, down) {
    const M = this.mp;
    // Apply the base shortcut guard before multiplayer's inventory hotkeys.
    if (down && (e.metaKey || e.ctrlKey || e.altKey)) return super._key(e, down);
    // a chore is something you hold down, not something you tap once
    if (M.active && e.code === 'KeyE') M.holdingE = down;
    // Q toggles: pressing it again on the wheel should put it away
    if (M.active && down && !e.repeat && e.code === 'KeyQ' && this.screens.name === 'mpSabotage') {
      this.screens.pop();
      this.afterOverlayClose();
      return;
    }
    if (M.active && down && !this.screens.open && this.playing) {
      /* A held key is one press. The browser repeats a keydown about thirty
         times a second and every branch below is a one-shot: the belt spends
         a different item on each repeat, V empties the camera bundle at your
         feet, and the printer toggle puts a C.PERK — and the roster
         broadcast that ends that case — on the wire per repeat. Swallowed
         here rather than guarded on the `if` above, because a repeat that
         falls through reaches Game._key, where KeyF still opens the chart. */
      if (e.repeat && /^(Digit[1-9]|Key[GVBNFQ])$/.test(e.code)) return;
      /* The belt. 1-9 uses what you are carrying — the one thing the game
         had no way of doing at all. */
      if (/^Digit[1-9]$/.test(e.code)) { this.useBeltSlot(+e.code.slice(5)); return; }
      if (e.code === 'KeyG') { this.togglePistol(); return; }
      if (e.code === 'KeyV') { this.placeCamera(); return; }
      if (e.code === 'KeyB' && this.scannerOn) { this.scanNext(1); return; }
      if (e.code === 'KeyN' && this.printerOn) { this.receiptBack(); return; }
      if (e.code === 'KeyF') {
        /* The dead have no use for the knife or the flare, and every reason
           to want to be somewhere else. Same key, different job. */
        if (!this.amAlive) { this.cycleSpectate(); return; }
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
        else if (this.stunnedUntil && now() < this.stunnedUntil) this.ui.toast('YOU ARE SEEING STARS', 'bad', 1400);
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
    // the dead were harvesting the island: nothing here guarded on being alive
    if (!this.amAlive) return;
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

  /**
   * Take a purse off the ground and off the books.
   *
   * Hiding the mesh was not enough: it stayed parented to the scene and
   * stayed in `tickers`, so every purse ever dropped went on being walked
   * and spun for the rest of the session, invisible. A long round with a
   * busy Agent left dozens of them, and a rematch cleared the LIST and
   * left the meshes behind.
   */
  _retireDrop(d) {
    if (!d || !d.mesh) return;
    d.mesh.visible = false;
    d.mesh.removeFromParent();
    const i = this.tickers.indexOf(d.mesh);
    if (i >= 0) this.tickers.splice(i, 1);
    d.mesh = null;
  }

  /**
   * Reach for one. Two people standing over the same purse both credited
   * themselves and the same coins ended up in two pockets, so this asks and
   * waits: the host says who got there first, and S.DROPGONE is what pays.
   *
   * The ask is held for a second rather than for good — the sweep runs every
   * frame, and a refusal (a position a tick out of date, four metres from the
   * one the host is holding) says nothing back, so a flag that never lapsed
   * would leave the purse lying there untakeable for the rest of the round.
   */
  _takePurse(d) {
    if (!d || d.taken || !d.did || !this.amAlive || (d.room | 0) !== this.roomId) return;
    if (d.pending && now() < d.pending) return;
    d.pending = now() + 1;
    this._send({ t: C.TAKEDROP, did: d.did });
  }

  /** The host's answer: whose it was. */
  _onDropGone(did, byId) {
    const M = this.mp;
    const d = (M.drops || []).find((x) => x.did === did);
    if (!d || d.taken) return;
    d.taken = true;
    d.pending = 0;
    if (byId === M.view.selfId) {
      const got = this.doubleCoins ? d.coins * 2 : d.coins;
      this.coins = (this.coins || 0) + got;
      this._send({ t: C.PURSE, coins: this.coins });
      this.audio.sfx('coin');
      this.ui.toast(`+${got} SYNCOIN`, 'gold', 1800);
      if (!d.room) this.taskFx?.burst(d.x, heightAt(d.x, d.z), d.z, 0xffd24a, 'done', 3.2);
      this.player.punch?.(0.2);
      this._payInstalment();
    }
    this._retireDrop(d);
  }

  _takeCoin(c) {
    c.taken = true;
    // black rum, and the falling down: every coin counts twice
    this.coins = (this.coins || 0) + (this.doubleCoins ? 2 : 1);
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
     as much as all but the last Syncoin of it. He does not explain how he
     decides.
     ========================================================= */

  /**
   * Pick the day's offer. Called on each dawn, and once at round start.
   *
   * Rolled by the host alone. Math.random() on every client gave every
   * player a different item at a different cut, and the shop prints the
   * figure and C.BOUGHT carries the buyer's own price to every printer on
   * the island — so a docket could show a price nobody could have paid.
   * The host's own rng is the same stream that deals the chores, so nothing
   * new has to go on the wire to seed it.
   */
  rollSale() {
    if (!this.isHost) return;                 // clients wait to be told
    const M = this.mp;
    const rng = this.mp.host.rng;
    /* Off the open counter, the way the Schlarna line below is picked. The
       roll used to run over the whole of STOCK, so about one dawn in four
       announced a markdown on a back-room line that nobody standing at the
       open shelf could find — and the toast goes to everybody. */
    const open = shelf('open', (this.night || 0) > 0.5);
    const pool = open.length ? open : shelf('open', true);
    const it = pool[(rng() * pool.length) | 0];
    if (!it) return;
    // ten to a hundred per cent, in fives, so the figure reads cleanly;
    // priceOf holds the floor at one Syncoin, so nothing is ever free
    const cut = 10 + ((rng() * 19) | 0) * 5;

    /* ---- and the day's Schlarna line ----
       Somebody sold Ferdi a card reader. One item a day can be taken away in
       four parts instead of paid for; it is never the item that is already
       marked down, because two offers on one line is how a shop ends up
       giving things away. */
    const open2 = STOCK.filter((i) => i.side === 'open' && i.id !== it.id
      && (!i.night || (this.night || 0) > 0.5));
    const after = open2.length ? open2[(rng() * open2.length) | 0].id : null;

    const msg = { t: S.SALE, id: it.id, cut, day: (M.saleDay || 0) + 1, after };
    this.mp.host.net.broadcast(msg);
    this._applySale(msg);                     // the host is a player too
  }

  /** One shop, one sale: both sides come through here. */
  _applySale(m) {
    const M = this.mp;
    M.saleDay = m.day | 0;
    M.sale = { id: m.id, cut: m.cut | 0, day: M.saleDay, at: now() };
    M.after = m.after ? { id: m.after } : null;
    this.ui.toast(`FERDI HAS MARKED SOMETHING DOWN ${m.cut | 0}%`, 'gold', 4200);
    this.audio.sfx('stinger');
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
    /* A plan cannot be part-refunded the way buyItem refunds a short box, so
       a camera box only goes on the card if the whole box will fit — and the
       card is not advertised for a purchase that would then be refused. */
    if (id === 'camera' && this.camsSpare() < CAMERA_BUNDLE) return false;
    return this.mp.after?.id === id && !this.plan
      && !(this.owned?.has(id) && keptOnYou(itemById(id)));
  }

  /** Take something away now and settle it over the round. */
  buySchlarna(id) {
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM || now() < (this.stunnedUntil || 0)) return false;
    const it = itemById(id);
    if (!it || !this.schlarnaOn(id)) { this.audio.sfx('deny'); return false; }
    const each = this.schlarnaEach(id);
    if ((this.coins || 0) < each) {
      this.audio.sfx('deny');
      this.ui.toast(`THE FIRST PAYMENT IS ${each} SYNCOIN`, 'bad', 2200);
      return false;
    }
    if (id === 'camera' && this.camsSpare() < CAMERA_BUNDLE) {
      this.audio.sfx('deny');
      this.ui.toast('THE RELAY WILL NOT TAKE A WHOLE BOX', 'bad', 2400);
      return false;
    }
    this.coins -= each;
    this._send({ t: C.PURSE, coins: this.coins });
    /* Same counter, same shelf, same docket. The plan sent only the purse,
       so taking the day's line on the card was the one way to buy over
       Ferdi's open counter without a printer anywhere seeing it. The figure
       is what actually left the purse, because the docket says PAID. */
    this._send({ t: C.BOUGHT, id, price: each });
    this.audio.sfx('confirm');
    this.audio.sfx('coin');

    /* The camera's effect lives in applyItem now. On the belt it was four
       payments for nothing: nothing incremented the relay's spare count and
       pressing its number key simply destroyed the box. */
    if (keptOnYou(it)) { this.owned = this.owned || new Set(); this.owned.add(id); }
    else if (id !== 'camera') this.carry = [...(this.carry || []), id];
    if (id === 'camera' || PASSIVE_AT_BUY.has(id)) this.applyItem(id);

    /* How many payments are left is the schedule's own length, not the
       nominal four: `each` is rounded up, so a cheap line clears the total in
       three and the card said four. _payInstalment recomputes it this way on
       every collection after the first, so the popup was the only place that
       disagreed with the card the player had just signed. */
    const owed = this.schlarnaTotal(id) - each;
    const left = Math.max(0, Math.ceil(owed / each));
    this.plan = { id, name: it.name, each, left, owed };
    this.mp.after = null;                    // one a day, and it has gone
    this.ui.showPopup(it.name,
      `${left} PAYMENTS OF ${each} LEFT`, 'coin', 'SCHLARNA');
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
    /* Floor, not ceil: on an odd purse the ceiling took more than the half
       the plan promises to leave you — three coins in hand and it took two.
       Clamped to what is still owed as well, or the last payment collects
       past the total the card quoted. */
    const take = Math.min(this.coins, pl.each, pl.owed, Math.max(1, Math.floor(this.coins / 2)));
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
    /* Never nothing. A hundred per cent off rounded to zero, and `coins <
       price` is false at zero — so a ONE USE line, which is neither owned
       nor `once`, could be tapped off the counter without limit for the
       rest of the day. */
    return Math.max(1, Math.round(it.cost * (1 - sale.cut / 100)));
  }

  /** Buy something. Nothing here is a number you cannot feel. */
  buyItem(id) {
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM || now() < (this.stunnedUntil || 0)) return false;
    const it = itemById(id);
    if (!it) return false;
    this.owned = this.owned || new Set();
    if (this.owned.has(id) && (keptOnYou(it) || it.once)) {
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
    /* Whether the relay has room for a box at all, asked BEFORE any money
       moves. The refund further down handed the coins back to you and told
       nobody, so the host went on believing you were six poorer and took it
       off you again the next time it was the authority on your purse — and
       a docket for a sale that never happened had already gone to every
       printer on the island. */
    if (id === 'camera') {
      if (this.camsSpare() <= 0) {
        this.ui.toast('THE RELAY WILL NOT TAKE ANOTHER', 'bad', 2400);
        this.audio.sfx('deny');
        return false;
      }
    }
    /* Nine belt keys, so nine belt rows. A tenth was sold, paid for and
       then told you to PRESS 10 — a key nothing is bound to — and the item
       was gone for good. Only a NEW row costs a slot: another of something
       already carried stacks on the row it has. */
    if (BELT_IDS.includes(id) && !(this.carry || []).includes(id)
      && this.beltSlots().length >= 9) {
      this.audio.sfx('deny');
      this.ui.toast('YOUR BELT IS FULL', 'bad', 1600);
      return false;
    }
    this.coins -= price;
    this._send({ t: C.PURSE, coins: this.coins });
    /* Over the counter, in front of whoever is watching, and on the
       docket of anybody carrying a printer. Under the counter, nothing is
       written down — that is what the black market is for. Named rather
       than "not black", because itemById reaches Cathy's food too and her
       stall is across the island from Ferdi's, not part of it. */
    if (it.side === 'open' || it.side === 'both') this._send({ t: C.BOUGHT, id, price });
    this.audio.sfx('confirm');
    this.audio.sfx('coin');

    /* Food is eaten at the counter. It does not go on your belt: there is
       no version of this where you carry a burger around and press 4. */
    /* A camera is not carried on the belt and is not eaten: buying one
       hands it straight to the relay's spare count and you set it with V. */
    if (id === 'camera') {
      /* A box of three. If the relay only has room for one or two left you
         get those and pay for those — nobody should be charged six coins
         for a box that half of will not fit. */
      const got = this.gainCamera(CAMERA_BUNDLE);
      // the check above should have caught this; if it ever does not, the
      // host still has to be told the money came back
      if (!got) {
        this.coins += price;
        this._send({ t: C.PURSE, coins: this.coins });
        this.audio.sfx('deny');
        return false;
      }
      if (got < CAMERA_BUNDLE) {
        const back = Math.round(price * (1 - got / CAMERA_BUNDLE));
        this.coins += back;
        this._send({ t: C.PURSE, coins: this.coins });
        this.ui.showPopup(`${got} CAMERA${got === 1 ? '' : 'S'}`,
          `THE RELAY ONLY HAD ROOM FOR ${got} - ${back} BACK`, 'coin', 'FERDI SAYS');
        return true;
      }
      this.ui.showPopup(it.name, 'PRESS V WHERE YOU WANT EACH ONE', 'coin', 'FERDI SAYS');
      return true;
    }

    const isFood = FOOD.some((f) => f.id === id);
    if (keptOnYou(it) || it.once) this.owned.add(id);
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
    /* The one entry point for a box of cameras. buyItem has its own path
       with a partial refund and returns before it reaches here; every other
       way of coming by one — the plan, the chest, the dev kit — used to hand
       you a belt slot that did nothing at all. */
    if (id === 'camera') { this.gainCamera(CAMERA_BUNDLE); return; }
    // Cathy's food does the same thing in both modes, so it lives on Game
    if (FOOD.some((f) => f.id === id)) this.applyFood(id);
    if (id === 'soles') this._send({ t: C.PERK, perk: 'quiet', on: true });

    if (id === 'vest') {
      this._send({ t: C.PERK, perk: 'vest', on: true });
      /* Cork and canvas over your chest is heavy. A quarter off both your
         walk and your sprint is the price of the strike it eats. */
      this._recalcSpeed();
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
    /* The host is the authority on the cooldown and knew nothing about the
       stone, so shaving the local clock only made the ring disagree with the
       knife: it read READY and the strike was dropped in silence. Tell the
       host instead and let S.COOLDOWN bring the ring back. */
    if (id === 'whetstone') this._send({ t: C.PERK, perk: 'whetstone', on: true });
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
    /* The rows live in a pool of their own, and so does the Map. The HUD
       asks for the belt every frame, so a fresh literal per carried item was
       a few hundred objects a second for a list that hardly ever changes —
       and the pool is a separate array because the alibi row comes and goes
       on a clock, which would keep trimming `out` back down. */
    const pool = (this._beltPool = this._beltPool || []);
    const seen = (this._beltSeen = this._beltSeen || new Map());
    seen.clear();
    for (const id of (this.carry || [])) {
      const at = seen.get(id);
      if (at !== undefined) { out[at].count++; continue; }
      const it = itemById(id);
      if (!it) continue;
      const row = pool[out.length] || (pool[out.length] = {});
      row.id = id; row.icon = it.icon; row.name = it.name;
      row.count = 1; row.active = false; row.secs = 0;
      seen.set(id, out.length);
      out.push(row);
    }
    // the pistol shows whether it is drawn
    for (const sl of out) if (sl.id === 'gun') sl.active = !!this.pistolOut;
    /* A running alibi keeps a slot of its own so there is somewhere to press
       to end it. It is not an item you hold — it is a thing that is
       happening to you. */
    if (this.alibiUntil && now() < this.alibiUntil) {
      const row = pool[out.length] || (pool[out.length] = {});
      row.id = 'alibi-live'; row.icon = 'alibi'; row.name = 'ALIBI RUNNING';
      row.count = 1; row.active = true; row.secs = Math.ceil(this.alibiUntil - now());
      out.push(row);
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
    if (!this.amAlive || this.screens.open || this.paused
        || this.mp.view.phase !== PHASE.ROAM || now() < (this.stunnedUntil || 0)) return;
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
   * Pull the handle. Each machine holds ONE thing, so what falls out is the
   * host's to roll and the host's to refuse: two people pulling in the same
   * second each rolled their own item and both walked away with it.
   *
   * `true` tells the screen the ask is away and the item is coming back on
   * the reply. Nothing leaves your purse here either — the six went the
   * moment E went down, so a machine somebody had already emptied charged
   * you for a drum that stopped on nothing.
   */
  vendPay(vendor) {
    if (!vendor || vendor.spent) return null;
    if ((this.coins || 0) < VEND_COST) {
      this.ui.toast('NOT ENOUGH SYNCOIN', 'bad', 1600);
      return null;
    }
    const index = (this.vendors || []).indexOf(vendor);
    if (index < 0) return null;
    this._send({ t: C.VEND, index });
    return true;
  }

  /** The host's answer: which machine, who pulled it, and what was in it. */
  _onVend(index, byId, itemId) {
    const M = this.mp;
    /* The cabinet empties for EVERYBODY. It used to be emptied by whoever
       was standing within four and a half metres of it, which meant a
       machine somebody else had already cleaned out still lit up and still
       offered you a pull when you walked up to it. */
    const v = (this.vendors || [])[index | 0];
    if (v) {
      v.spent = true;
      v.node?.userData?.vend?.(0xffd24a);
      if (v.node) v.node.userData.empty = true;
    }
    if (byId !== M.view.selfId) return;
    const it = itemById(itemId);
    // charged for what fell out, and only once something has
    if (!it) return;
    this.coins = Math.max(0, (this.coins || 0) - VEND_COST);
    this._send({ t: C.PURSE, coins: this.coins });
    /* Tag is the wrong question: the cork vest is tagged ONE USE and so went
       on the belt, which meant applyItem never ran and the host was never
       told — a vest out of a machine protected you from nothing. */
    if (keptOnYou(it)) {
      this.owned = this.owned || new Set();
      this.owned.add(it.id);
    } else {
      this.carry = [...(this.carry || []), it.id];
    }
    if (PASSIVE_AT_BUY.has(it.id)) this.applyItem(it.id);
    /* A host answers its own pull inside the same call that sent it, before
       the screen has so much as started its drum — and the line after that
       call clears `got`. Handing the item over on the next turn of the loop
       is what lets one path serve both ends of the wire. */
    this._runLater(() => {
      const s = this.screens.name === 'mpVend' ? this.screens.top : null;
      if (s && s.phase === 'turning' && !s.got) s.got = it;
      else this.vendDeliver(it);
    }, 0);
  }

  /** The drum has stopped: the card that names what fell out. */
  vendDeliver(item) {
    if (!item) return;
    const it = itemById(item.id) || item;
    const belt = BELT_IDS.includes(it.id);
    const slot = belt ? this.beltSlots().findIndex((sl) => sl.id === it.id) + 1 : 0;
    this.ui.showPopup(it.name, belt ? `PRESS ${slot} TO USE IT` : 'IN FORCE NOW',
      'coin', 'THE MACHINE GAVE YOU');
  }

  /** Spend one carried item. */
  useItem(id) {
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM
        || now() < (this.stunnedUntil || 0)) return false;
    if ((id === 'speaker' || id === 'skeleton') && this.inRoom) {
      this.audio.sfx('deny');
      this.ui.toast('USE THIS OUTSIDE', 'bad', 1800);
      return false;
    }
    /* The scanner is the one thing on the belt you switch ON rather than
       use up: pressing it again puts it away, and it is still in your hand
       either way. Everything else here is consumed. */
    /* The till roll is switched on and off like the scanner rather than
       running whether you want it or not — it is an instrument you pick
       up, not a thing that happens to you. */
    if (id === 'nightfall') {
      if (!this.useCarried('nightfall')) { this.audio.sfx('deny'); return false; }
      this.audio.sfx('cast');
      this.audio.sfx('horn');
      // the host tells everybody, including us — one sky, one clock
      this._send({ t: C.PERK, perk: 'nightfall', on: true });
      return true;
    }
    if (id === 'printer') {
      if (!this.hasItem('printer')) { this.audio.sfx('deny'); return false; }
      this.printerOn = !this.printerOn;
      this.receipts = this.receipts || [];
      this.receiptAt = 0;
      // the host only sends dockets to sets that are switched on
      this._send({ t: C.PERK, perk: 'printer', on: !!this.printerOn });
      this.audio.sfx(this.printerOn ? 'page' : 'select');
      this.ui.toast(this.printerOn ? 'TILL ROLL ON - N READS BACK' : 'TILL ROLL OFF',
        this.printerOn ? 'jade' : 'bad', 2200);
      return true;
    }
    if (id === 'scanner') {
      if (!this.hasItem('scanner')) { this.audio.sfx('deny'); return false; }
      this.scannerOn = !this.scannerOn;
      if (this.scannerOn) {
        this.audio.sfx('terminal');
        this.ui.toast('SCANNER ON - IT IS LISTENING', 'jade', 2400);
      } else {
        this.audio.sfx('select');
        this.ui.toast('SCANNER OFF', 'bad', 1600);
      }
      return true;
    }

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
      // the whole book at once: the pulls are counted on the Flopper, and
      // the ticket itself is one use and gone
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
      this.ui.toast('ALIBI SET - PRESS AGAIN TO DROP IT', 'jade', 4200);
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
    /* If the click is the same reach as E it has to be the same HOLD as E.
       The chore bar is driven by the held-E flag alone, so a chore or a
       repair started with the mouse drained from the first frame and died
       1.1 seconds later on 'YOU LET GO' with the button never released. */
    this.mp.holdingClick = true;
    this.interact();
  }

  /* =========================================================
     THE FLARE PISTOL
     ========================================================= */
  togglePistol() {
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM) return;
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
    /* The model is built once and keeps last shot's empty breech, so a second
       pistol bought after firing the first came out of the holster spent. */
    if (this.pistolOut) this.pistolModel.userData.flare.visible = !!this.carry?.includes('gun');
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
    const p = this.player.pos;
    let best = null, bestDot = 0.93;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      // as with the knife: another interior is not in front of you, and the
      // host refuses those shots without a word
      if ((av.room | 0) !== this.roomId) continue;
      /* Horizontally, from the body — which is how the host measures it.
         Measured from the eye the camera's own 4.6 m of trail came off the
         top of the range, so the last five metres of an advertised thirty
         answered NOBODY IN YOUR SIGHTS. */
      if (Math.hypot(av.pos.x - p.x, av.pos.z - p.z) >= 30) continue;
      // the cone is about what is under the crosshair, so that stays on the eye
      const to = new THREE.Vector3(av.pos.x - eye.x, av.pos.y + 1 - eye.y, av.pos.z - eye.z);
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
    /* Checked, not spent. The host has the last word on a shot — it refuses
       one across rooms, one past thirty metres, and one with nobody but the
       shooter to vote on it — and it refuses silently. Spending the shell
       here meant a refused shot destroyed a bought item and did nothing at
       all. It comes off the belt in _onShot instead, when the host has said
       the shot happened. */
    if (!this.carry?.includes('gun')) { this.audio.sfx('deny'); return; }

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
      this._runLater(() => { if (this.pistolModel) this.pistolModel.userData.glow.intensity = 0; }, 220);
    }
    this.pistolOut = false;
    if (this.pistolModel) this.pistolModel.visible = false;
    this._send({ t: C.SHOOT, targetId: target.id });
  }

  _onShot(byId, victimId, at, secs) {
    const M = this.mp;
    /* The shell is spent here rather than at the trigger, because this is
       the first word we have that the host let the shot through. */
    if (byId === M.view.selfId) this.useCarried('gun');
    const rec = M.view.players.get(victimId);
    const here = (at.room | 0) === this.roomId;
    if (here && !at.room) this.dizzy?.add(victimId, colourHex(rec?.colour));
    M.stunned = M.stunned || new Map();
    M.stunned.set(victimId, now() + secs);
    if (here) this.audio.sfx('bossHit');
    if (here && !at.room) this.taskFx?.burst(at.x, heightAt(at.x, at.z), at.z, 0xff9a3a, 'done', 5.0);
    if (victimId === M.view.selfId) {
      this.stunnedUntil = now() + secs;
      this._clearHeldInput();
      M.taskProgress = null;
      this.pistolOut = false;
      if (this.pistolModel) this.pistolModel.visible = false;
      this.player.punch?.(1);
      this.pipeline.tint.setHex(0xffb060);
      this.pipeline.tintAmt = 0.9;
      this.ui.showPopup('YOU ARE SEEING STARS', 'THEY ARE DECIDING ABOUT YOU', 'coin', 'FLARED');
    } else if (here) {
      this.ui.toast(`${rec?.name || 'SOMEBODY'} IS DOWN`, 'bad', 2400);
    }
  }

  /* The shot never happened, so the shell is still worth what it cost. But
     the shell and the draw are two different things: a deny can arrive after
     the shooter has been knifed, flared or pulled into a council, and putting
     the pistol back in his hand there drew it on a corpse or over a vote. */
  _onSnapDeny(why) {
    const loaded = !!this.carry?.includes('gun');
    if (this.pistolModel && loaded) this.pistolModel.userData.flare.visible = true;
    if (loaded && this.amAlive && this.mp.view.phase === PHASE.ROAM
        && !(this.stunnedUntil && now() < this.stunnedUntil)) {
      this.pistolOut = true;
      if (this.pistolModel) this.pistolModel.visible = true;
    }
    this.audio.sfx('deny');
    this.ui.toast(why, 'bad', 1800);
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
      /* replace() throws away whatever was on the stack, and a pause card
         put up by Escape owns this.paused — left set, the vote's own exits
         refuse to take the pointer back and you stand frozen with no card. */
      this.paused = false;
      this.screens.replace('mpSnap', {});
      document.exitPointerLock?.();
      this.audio.sfx('stinger');
    }
  }

  _onSnapTally(yes, no, need, voters) {
    if (!this.mp.snap) return;
    this.mp.snap.yes = yes; this.mp.snap.no = no; this.mp.snap.need = need;
    if (Array.isArray(voters)) {
      this.mp.snap.voters = voters;
      if (!voters.includes(this.mp.view.selfId) && this.screens.name === 'mpSnap') {
        this.screens.clear();
        this.afterOverlayClose();
      }
    }
    this.audio.sfx('select');
  }

  _onSnapDone(victimId, exiled, wasAgent, yes, no, reveal) {
    const M = this.mp;
    // read before the vote is dropped: it decides who gets a card and who
    // is simply told
    const voters = M.snap?.voters || [];
    M.snap = null;
    this.dizzy?.remove(victimId);
    M.stunned?.delete(victimId);
    if (victimId === M.view.selfId) this.stunnedUntil = 0;
    /* The vote card took the pointer when it opened (_onSnapOpen calls
       exitPointerLock), so clearing it without asking for the lock back
       left you standing in a live round unable to turn your head. Only
       back into a live round, though: a snap that resolves straight into a
       council or a results card would otherwise steal the pointer off the
       screen that is about to open. */
    if (this.screens.name === 'mpSnap') {
      this.screens.clear();
      if (M.view.phase === PHASE.ROAM) this.afterOverlayClose();
    }
    const rec = M.view.players.get(victimId);
    const who = rec?.name || '?';
    if (exiled) {
      const me = M.view.selfId;
      /* Only the people the flare already had by the throat see the
         cinematic, and a short cut of it. S.SNAPDONE goes to everybody, so
         the full card froze the whole island for eight seconds — a player
         at the temple who never saw the flare lost control mid-round, and
         the stack clear took his shop screen or his minigame with it. */
      if (voters.includes(me) || victimId === me) {
        const card = this.screens.replace('mpExile', {
          line: '', wasAgent: reveal ? wasAgent : null, targetId: victimId, who, snap: true,
        });
        /* Held by identity, not by name: a body reported while the card is
           up puts the council on the stack, and mpExile is in the FINAL
           list, so a blind clear would take the council down with it. */
        this._runLater(() => {
          if (this.screens.top === card) { this.screens.clear(); this.ui.show(); this.afterOverlayClose(); }
        }, 2500);
      } else {
        this.ui.toast(`${who} WAS THROWN TO THE SEA`, 'bad', 3000);
        /* And what they were, when the host reveals it at all. The council
           tells the whole island; a snap vote must not be a private reveal
           for the two who called it. */
        if (reveal) {
          this.ui.toast(`${who} WAS ${wasAgent ? '' : 'NOT '}A ROGUE AGENT`,
            wasAgent ? 'jade' : 'gold', 3400);
        }
        this.audio.sfx('descend');
      }
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
    this._runLater(() => { if (this.state === 'bunker') this.audio.sfx('ladder'); }, 380);
    this._runLater(() => { if (this.state === 'bunker') this.audio.sfx('terminal'); }, 1500);
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
    this._runLater(() => { this._hrCooldown = false; }, 2200);
    this.state = 'island';
    this.scene = this.islandScene;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    this.player.insideBox = null;
    this._backOnDeck();
    this._rehomeAvatars();
    this.audio.sfx('door');
    this.audio.playMusic(this._islandTrack());
    this.pipeline.tint.setHex(0xffffff);
    this.pipeline.tintAmt = 0.4;
  }

  /* =========================================================
     THE MAST

     The ladder is fifteen metres and there is no climbing in this game,
     so the ladder is a door: stand at the foot of it, hold E, and you go
     up. It takes a moment, and the moment is the climb.
     ========================================================= */
  enterCab() {
    if (this.state !== 'island') return;
    if (!this.cabScene) return;
    this.state = 'cab';
    this.scene = this.cabScene;
    this.player.mesh.removeFromParent();
    this.cabScene.add(this.player.mesh);
    this.player.setColliders(CAB_COLLIDERS);
    this.player.insideBox = CAB_BOX;
    this.player.teleport(CAB_ENTRY.x, CAB_ENTRY.y, CAB_ENTRY.z, Math.PI);
    this.player.pitch = -0.05;
    this._cabCooldown = true;
    this._runLater(() => { this._cabCooldown = false; }, 1800);
    this.audio.sfx('ladder');
    this.audio.sfx('door');
    this.audio.playMusic('bunker');
    this.pipeline.tint.setHex(0x203028);
    this.pipeline.tintAmt = 0.55;
    this._rehomeAvatars();
    this.ui.clearToasts?.();
    this.ui.showPopup('THE MAST', 'NOBODY CAME BACK FOR IT', 'coin', 'UP THE LADDER');
  }

  leaveCab() {
    if (this.state !== 'cab') return;
    this.state = 'island';
    this.scene = this.islandScene;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    this.player.insideBox = null;
    const tw = this.tower;
    if (tw) {
      // back at the foot of the ladder, facing away from the mast
      const a = Math.PI / 4 + Math.PI;
      const bx = tw.x + Math.cos(a) * 4.6, bz = tw.z + Math.sin(a) * 4.6;
      this.player.teleport(bx, heightAt(bx, bz) + 0.6, bz, a);
    }
    this._cabCooldown = true;
    this._runLater(() => { this._cabCooldown = false; }, 1800);
    this.audio.sfx('ladder');
    this._rehomeAvatars();
    this.audio.playMusic(this._islandTrack());
    this.pipeline.tint.setHex(0xffffff);
    this.pipeline.tintAmt = 0.4;
  }


  /* =========================================================
     THE VISITOR

     Once a night, at an hour only the host knows, a saucer stands off
     above the temple and drops a column of green light onto the sand for
     three minutes. Walk into the light and it takes you up.

     Everything below is the host's word repeated back. The client owns
     the picture — the fade, the lift, the plate going down, the four
     seconds the machine spends thinking — and owns not one of the
     decisions. Who is holding the scanner and what it said are the two
     facts this mode is built on, and neither of them is ours to make up.
     ========================================================= */

  /** Every field the visit owns, back to nothing, and the world with it. */
  _resetUfoClient() {
    const M = this.mp;
    if (!M) return;
    this._endLift(true);
    if (this.state === 'ufo') this.exitUfo();
    M.ufo = null;
    M.ufoK = 0;
    M.beamWarned = false;
    M.scannerBy = null;
    M.scannerSpent = false;
    M.plateDown = false;
    M.scannerShown = false;
    M.scan = null;
    this.ufoVisit = 0;
    if (this.ufoNode) { this.ufoNode.userData.setBeam(false); this.ufoNode.userData.setVisit(0); }
    const u = this.ufoScene?.userData;
    if (u) { u.setPlate(false); u.setScanner(false); }
    this._parkScanner();
  }

  /**
   * It arrives, or it leaves.
   *
   * `secs` is a duration, like every clock on this wire — the two machines
   * have no shared one — so it is added to our own now() and counted down
   * from there.
   */
  _onUfo(on, secs) {
    const M = this.mp;
    /* The scanner belongs to the visit and to nothing else. The host clears
       it at both ends without a separate S.SCANNER, so this is the line
       that has to clear it here. */
    M.scannerBy = null;
    M.scannerSpent = false;
    M.plateDown = false;

    if (on) {
      M.ufo = { until: now() + (secs || 0) };
      M.beamWarned = false;
      /* A reading only ever belongs to the visit that paid for it. Cleared
         at the START of one rather than at the end, because a saucer that
         leaves in the middle of the four seconds still owes its answer to
         whoever spent the lobby's one scan on it. */
      M.scan = null;
      this.ufoNode?.userData.setBeam(true);
      /* A night event should arrive as a night event. The rumble is the
         thing itself; the toast is only there so somebody looking at their
         own boots knows to look up. */
      this.audio.sfx('rumble');
      this._runLater(() => { if (this.mp.ufo) this.audio.sfx('alert'); }, 900);
      this.ui.toast('SOMETHING IS STANDING OVER THE TEMPLE', 'jade', 5000);
    } else {
      M.ufo = null;
      this.ufoNode?.userData.setBeam(false);
      this._endLift(true);
      /* Anybody still up there comes down with it. exitUfo puts them back
         under the light, which is the only place they could have gone up
         from. */
      if (this.state === 'ufo') this.exitUfo();
      const u = this.ufoScene?.userData;
      if (u) { u.setPlate(false); u.setScanner(false); }
      M.scannerShown = false;
      this._parkScanner();
      this.ui.toast('IT HAS GONE', 'gold', 3000);
    }
    if (M.started) this._compassForTasks();
  }

  /**
   * Who is carrying it — and, when `spent` is set, that nobody ever will
   * again tonight. Those are two different kinds of empty plinth and the
   * room has to read as the right one.
   */
  _onScanner(byId, spent) {
    const M = this.mp;
    const wasMine = M.scannerBy === M.view.selfId;
    M.scannerBy = byId || null;
    M.scannerSpent = !!spent;

    if (spent) {
      /* Used up, not put down. The machine is gone from the hands that
         held it and the iris over the plinth shuts for good. */
      M.scannerShown = false;
      this.ufoScene?.userData.setScanner(false);
      /* Unless it is still in our own hand finishing the sum — see
         _syncScannerProp. Ours goes dark when the reading lands. */
      if (!(wasMine && M.scan && !M.scan.done)) this._parkScanner();
      if (wasMine) {
        this.audio.sfx('wire');
      } else if (this.roomId === 5 || M.ufo) {
        /* Everybody else's only warning that tonight's answer is already
           sitting in somebody's head, and that the plinth is finished. */
        this.audio.sfx('deny');
        this.ui.toast('THE SCANNER HAS BEEN USED', 'bad', 4600);
      }
      return;
    }
    if (byId && byId === M.view.selfId) {
      this.audio.sfx('pickup');
      this.ui.toast('ONE READING. MAKE IT COUNT.', 'jade', 4600);
    } else if (byId && this.roomId === 5) {
      const rec = M.view.players.get(byId);
      this.ui.toast(`${(rec?.name || '?').toUpperCase()} HAS THE SCANNER`, 'gold', 3400);
    } else if (!byId && wasMine) {
      /* Killed, or the wire dropped us. Either way it is back on its plinth
         and somebody else's night now. */
      M.scan = null;
    }
  }

  /**
   * The answer, and it came to us alone.
   *
   * It is not shown the moment it lands. The machine is still thinking —
   * `M.scan` is running its own four seconds — and the reading appears when
   * that finishes, so the wait is the same whether the host answered in one
   * frame or forty. Nothing about this reaches the room.
   */
  _onScanResult(targetId, agent) {
    const M = this.mp;
    const s = M.scan;
    if (s && s.targetId === targetId) { s.agent = !!agent; s.got = true; return; }
    /* An answer with no computation behind it — a stray, or the round
       turned over underneath us. Show it rather than lose it: it is the
       only one anybody gets. */
    const rec = M.view.players.get(targetId);
    M.scan = {
      targetId, name: rec?.name || '?', colour: colourHex(rec?.colour),
      t: SCAN_SECS, secs: SCAN_SECS, agent: !!agent, got: true, done: false, hold: SCAN_HOLD,
    };
  }

  /* ---------- the two things E does in that room ---------- */

  /**
   * Lift it off the plinth. The host refuses this without a word unless
   * somebody else is holding the plate down, so the refusal has to be said
   * here or the key reads as broken.
   */
  takeScanner() {
    const M = this.mp;
    if (this.state !== 'ufo' || !this.amAlive) return;
    if (M.scannerSpent || M.scannerBy) { this.audio.sfx('deny'); return; }
    if (!this._plateHeldByOther()) {
      this.audio.sfx('deny');
      this.ui.toast('SOMEBODY ELSE MUST STAND ON THE PLATE', 'bad', 3000);
      return;
    }
    this._send({ t: C.TAKESCAN });
    this.audio.sfx('select');
  }

  /**
   * Point it at somebody and ask. This is the only one the lobby gets all
   * night, so it is deliberately a keypress with a name on it rather than
   * anything that could go off by accident.
   */
  fireScan(targetId) {
    const M = this.mp;
    if (M.scannerBy !== M.view.selfId || M.scan) return;
    const rec = M.view.players.get(targetId);
    if (!rec) return;
    M.scan = {
      targetId, name: rec.name || '?', colour: colourHex(rec.colour),
      t: 0, secs: SCAN_SECS, agent: null, got: false, done: false, hold: 0,
    };
    this._send({ t: C.SCAN, targetId });
    this.audio.sfx('charge');
  }

  /** Whoever the machine is currently aimed at, if anybody. */
  _nearestScanTarget() {
    const M = this.mp;
    const p = this.player.pos;
    /* The LOOK yaw, not the body's. The body lerps toward wherever you are
       walking and does not turn at all when you stand still and aim, which
       is exactly what somebody with this in their hands is doing. */
    const yaw = this.player.yaw ?? this.player.facing ?? 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestD = Infinity;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      if ((av.room | 0) !== 5) continue;
      const dx = av.pos.x - p.x, dz = av.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      // the host allows six metres; ask for less, so a prompt never lies
      if (d > 4.6 || d < 0.001) continue;
      // and in front of you: this is an instrument you aim, not a radius
      if ((dx / d) * fx + (dz / d) * fz < 0.45) continue;
      if (d < bestD) { bestD = d; best = av; }
    }
    return best;
  }

  /** Is somebody OTHER than us standing on the plate right now? */
  _plateHeldByOther() {
    const M = this.mp;
    const r = UFO_PLATE.r;
    for (const av of M.avatars.values()) {
      const rec = M.view.players.get(av.id);
      if (!rec || rec.alive === false) continue;
      if ((av.room | 0) !== 5) continue;
      if (Math.hypot(av.pos.x - UFO_PLATE.x, av.pos.z - UFO_PLATE.z) <= r) return true;
    }
    return false;
  }

  /* ---------- the room, once a frame ---------- */

  /**
   * The plate, the plinth and whose hands the machine is in. Run before the
   * scene's own tick, so the iris and the lamp are working from this frame's
   * answer rather than the last one's.
   */
  _tickUfoRoom() {
    const M = this.mp;
    const u = this.ufoScene?.userData;
    if (!u) return;

    /* Anybody's weight will do, ours included — but taking the scanner off
       still needs somebody else, which is the whole design and is enforced
       by the host, not here. */
    let down = this._plateHeldByOther();
    if (!down && this.amAlive) {
      down = Math.hypot(this.player.pos.x - UFO_PLATE.x, this.player.pos.z - UFO_PLATE.z)
        <= UFO_PLATE.r;
    }
    if (down !== M.plateDown) {
      M.plateDown = down;
      u.setPlate(down);
      this.audio.sfx(down ? 'lever' : 'door');
    }

    // on the plinth only while the plate is held and nobody has taken it
    const show = !!M.ufo && down && !M.scannerBy && !M.scannerSpent;
    if (show !== M.scannerShown) {
      M.scannerShown = show;
      u.setScanner(show);
      if (show) this.audio.sfx('ping');
    }
    this._syncScannerProp();
  }

  /**
   * The machine in somebody's hand.
   *
   * The room owns exactly one of these and it is the same object the plinth
   * holds, hung off whichever elbow is currently carrying it — a second prop
   * would be a second thing to keep in step with the host, and they would
   * disagree the first time a message was late.
   */
  _syncScannerProp() {
    const M = this.mp;
    const sc = this.ufoScene;
    const node = sc?.userData.scannerNode;
    if (!node) return;
    let holder = this.roomId === 5 ? M.scannerBy : null;
    /* Spent, and still in the hand that spent it until the reading lands.
       The host takes it off the roster on the keypress, four seconds before
       the answer — and a prop that vanished on the keypress would read as
       having been dropped rather than as having burned itself out doing the
       one piece of arithmetic it had in it. */
    if (!holder && M.scannerSpent && M.scan && !M.scan.done && this.roomId === 5) {
      holder = M.view.selfId;
    }
    if (!holder || (M.scannerSpent && holder !== M.view.selfId)) {
      this._parkScanner();
      return;
    }

    const hand = holder === M.view.selfId
      ? this.player.parts?.elbows?.r
      : M.avatars.get(holder)?.parts?.elbows?.r;
    if (!hand) { this._parkScanner(); return; }
    if (node.parent !== hand) {
      hand.add(node);
      /* Where the hand actually is on this rig: the forearm runs from the
         elbow down to -0.29 and the fist is drawn there. Tipped forward so
         the lens looks the way its carrier does. */
      node.position.set(0.012, -0.30, 0.07);
      node.rotation.set(-0.42, 0, 0);
      node.scale.setScalar(1);
    }
    node.visible = true;
  }

  /** Back on its plinth, or at least back out of somebody's sleeve. */
  _parkScanner() {
    const sc = this.ufoScene;
    const node = sc?.userData.scannerNode;
    if (!node) return;
    if (node.parent !== sc) {
      sc.add(node);
      node.position.set(UFO_PLINTH.x, UFO_PLINTH.y, UFO_PLINTH.z);
      node.rotation.set(0.12, 0, 0);
    }
    node.visible = !!this.mp.scannerShown;
  }

  /**
   * The four seconds. Ticked above every room branch, because the visit can
   * end underneath a computation and the answer is still owed to whoever
   * paid the lobby's one scan for it.
   */
  _tickScan(dt) {
    const M = this.mp;
    const s = M.scan;
    if (!s) return;
    if (s.done) {
      s.hold -= dt;
      if (s.hold <= 0) M.scan = null;
      return;
    }
    s.t += dt;
    if (s.t < s.secs) return;
    if (s.got) {
      s.done = true;
      s.hold = SCAN_HOLD;
      /* And it goes out. _syncScannerProp lets go of it on this flag, so the
         machine leaves your hand on the frame the answer appears rather than
         on the frame you pressed the key. */
      this.audio.sfx('wire');
      this._parkScanner();
      /* ONE sound for both answers. A different chime for an Agent is the
         same tell as a different colour, in the one channel a person sitting
         beside you cannot help hearing. */
      this.audio.sfx('ping');
      /* The wash over the picture is GREEN either way — the machine
         finishing, not what it found. A screen that goes red for an Agent is
         a tell anybody sitting beside you can read at a glance, and the whole
         point of this thing is that the answer lives in one head until its
         owner decides to say something about it. The words below are the
         answer, and they are on your own HUD and nowhere else. */
      this.pipeline.tint.setHex(0x2aff88);
      this.pipeline.tintAmt = 0.45;
      /* ...and the toast is the machine's own colour whichever way it went.
         Red for an Agent and jade for a human is a wide bar of colour in the
         middle of the frame that reads across a room without anybody having
         to see a single word of it — which would have handed away the exact
         secret the green wash above is at pains to keep. The WORDS are the
         answer; the colour only says the machine finished. */
      this.ui.toast(
        s.agent ? `${s.name.toUpperCase()}: ROGUE AGENT` : `${s.name.toUpperCase()}: HUMAN`,
        'jade', SCAN_HOLD * 1000,
      );
      return;
    }
    /* No answer, and the machine is still in our hands — the host refused
       it, which means they moved, or died, or the round turned over. Let it
       go rather than sit on a bar that will never fill. */
    if (s.t > s.secs + 3) {
      M.scan = null;
      this.audio.sfx('deny');
      this.ui.toast('IT READ NOTHING', 'bad', 2600);
    }
  }

  /* ---------- the visit, from outside ---------- */

  /**
   * The fade, the beam and the one test that matters: are you standing in
   * the light. Called every frame of a round, in every room, because the
   * hull has to finish arriving whether or not anybody is looking at it.
   */
  _tickUfoVisit(dt) {
    const M = this.mp;
    /* Two seconds to arrive and two to go. Under a second and it pops into
       existence; much over and the three minutes have started before the
       thing is properly there. */
    const want = M.ufo ? 1 : 0;
    if (M.ufoK !== want) {
      const step = dt * 0.5;
      M.ufoK = want > M.ufoK ? Math.min(want, M.ufoK + step) : Math.max(want, M.ufoK - step);
    }
    this.ufoVisit = M.ufoK;
    /* The machine lives in the saucer's scene and is hung off an elbow while
       somebody carries it. Standing anywhere else, put it back: an avatar
       who walks out of that room takes their whole subtree with them, and
       the one prop the room owns must not go to the beach with them. */
    if (this.roomId !== 5) this._parkScanner();

    if (!M.ufo || !this.ufoBeamPos) return;
    if (M.ufo.until && now() >= M.ufo.until + 6) {
      /* The host's S.UFO { on:false } never arrived — a dropped message, or
         a host that went away mid-visit. Six seconds past our own count is
         long enough to be sure, and a beam left on with nothing behind it
         would take people up into a room nobody is going to empty. */
      this._onUfo(false, 0);
      return;
    }
    if (this.state !== 'island' || !this.amAlive) return;
    if (M.view.phase !== PHASE.ROAM) return;

    const b = this.ufoBeamPos;
    const d = Math.hypot(this.player.pos.x - b.x, this.player.pos.z - b.z);
    if (!M.beamWarned && d < UFO_R + 14) {
      M.beamWarned = true;
      this.ui.toast('THE LIGHT TAKES WHATEVER STANDS IN IT', 'jade', 4200);
    }
    if (d > UFO_R) return;
    if (M.lift || this.deathShot || this._ufoCooldown) return;
    if (this.paused || this.screens.open || M.finished) return;
    this._beginLift();
  }

  /* ===========================================================
     THE LIFT

     Deliberately NOT a `state = 'cutscene'` cutscene, for the same three
     reasons the death shot is not one: the cutscene branch of update()
     returns before the avatars are interpolated, leaveRoom() keys off
     this.state, and a council or a knife arriving mid-shot has to be able
     to cut it short without unpicking anything.

     So it drives the camera and nothing else. The body is walked up the
     beam by hand, the world carries on underneath, and the last second of
     it is the screen going out.
     =========================================================== */
  _beginLift() {
    const M = this.mp;
    const b = this.ufoBeamPos;
    if (!b || M.lift) return;
    M.holdingE = M.holdingClick = false;
    M.taskProgress = null;

    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const gy = heightAt(b.x, b.z);
    const p = this.player.pos;
    /* The camera stands on the side you walked in from, so the shot opens on
       the ground you were just standing on. Dead centre of the column there
       is no such side, and the facing is the next best guess. */
    let ox = p.x - b.x, oz = p.z - b.z;
    const om = Math.hypot(ox, oz);
    if (om < 0.6) {
      const a = this.player.facing || 0;
      ox = -Math.sin(a); oz = -Math.cos(a);
    } else { ox /= om; oz /= om; }

    const TOP = gy + UFO_ALT - 3.2;
    /* Where the body has got to, read live: the shots look at a moving
       target rather than a point, which is what makes it read as a lift
       rather than a pan. */
    const rise = { x: p.x, y: p.y, z: p.z };
    M.liftRise = rise;
    const at = () => rise;
    const out = (r, h) => V(b.x + ox * r, gy + h, b.z + oz * r);

    M.lift = new Cutscene(this.camera, {
      skippable: false,
      /* Every one of these stands OUTSIDE the column — eleven metres out at
         its nearest, and the column is seven across. A camera that can share
         a horizontal position with the thing it is looking at eventually
         looks straight down at it, and lookAt with the view parallel to up
         is a matrix with no solution and a frame of garbage. */
      shots: [
        // your own feet leaving the sand
        { dur: 1.2, ease: 'easeOut', shake: 0.16, from: out(11.0, 2.0), to: out(12.0, 4.0), look: at },
        // the length of the column, with the hull growing over the top of it
        { dur: 2.0, ease: 'smooth', from: out(12.0, 4.0), to: out(15.0, 14.0), look: at },
        // and into the aperture
        { dur: 1.4, ease: 'smooth', from: out(15.0, 14.0), to: out(11.0, 26.0), look: at },
      ],
      text: [
        { at: 0.35, until: 2.30, text: 'THE LIGHT HAS YOU.' },
        { at: 2.60, until: 4.40, text: 'Something up there wanted a closer look.' },
      ],
      events: [
        { at: 0.0, visualOnly: true, fn: () => this.audio.sfx('charge') },
        { at: 1.6, visualOnly: true, fn: () => this.audio.sfx('wire') },
        { at: 3.4, visualOnly: true, fn: () => this.audio.sfx('descend') },
      ],
      onDone: () => this._endLift(false),
    });
    M.liftT = 0;
    M.liftFrom = { x: p.x, y: p.y, z: p.z };
    M.liftTop = TOP;
    setCinemaBars(true, false);      // no skip hint: neither can this one
    this.ui.hide();
    this.ui.setPrompt(null);
    /* The pointer stays LOCKED. Giving it up here reads to the browser as
       Escape, the lock handler pauses the game, and a pause card is one of
       the things that cuts this shot short — it would have cancelled itself
       on the frame it started. The look keys move nothing anyway: the
       controller is frozen and the camera is the cutscene's for four and a
       half seconds. */
  }

  /**
   * @param {boolean} cancel  true when something else claimed the frame —
   *   the visit ended, a council opened, the round finished. The lift is
   *   simply undone and you are left on the sand you were standing on.
   */
  _endLift(cancel) {
    const M = this.mp;
    if (!M || !M.lift) return;
    M.lift = null;
    M.liftRise = null;
    setCinemaBars(false);
    this.ui.show();
    /* Put the body back where the controller still thinks it is. Only the
       mesh was ever moved — pos was never touched — so this is one line and
       the next frame of player.update() would have done it anyway. */
    if (this.player?.mesh) this.player.mesh.position.copy(this.player.pos);
    if (!cancel && M.ufo && this.amAlive) this.enterUfo();
    /* No _requestLock: it was never given up. See _beginLift. */
  }

  /** The body going up, and the last second of the picture going out. */
  _tickLift(dt) {
    const M = this.mp;
    if (!M.lift) return;
    /* Anything that would make the arrival wrong ends the shot instead of
       finishing it: a knife, a meeting, the saucer leaving early. */
    if (this.deathShot || M.finished || !M.ufo
      || M.view.phase !== PHASE.ROAM || this.screens.open) {
      this._endLift(true);
      return;
    }
    M.liftT += dt;
    const dur = M.lift.duration || 4.6;
    const k = Math.min(1, M.liftT / dur);
    const f = M.liftFrom, r = M.liftRise;
    const b = this.ufoBeamPos;
    if (r && f && b) {
      /* Drawn into the middle of the column as you rise, so the last of the
         climb is straight up the aperture rather than into the hull's rim. */
      const pull = Math.min(1, k * 2.2);
      r.x = f.x + (b.x - f.x) * pull;
      r.z = f.z + (b.z - f.z) * pull;
      r.y = f.y + (M.liftTop - f.y) * (k * k * (3 - 2 * k));
      if (this.player?.mesh) {
        this.player.mesh.position.set(r.x, r.y, r.z);
        this.player.mesh.visible = true;
        this.player.mesh.rotation.y = (this.player.facing || 0) + this.time * 0.8;
      }
    }
    M.lift.update(dt);
    /* And out. Written every frame because update() decays the tint by 1.4
       a second and would otherwise let the picture back in on the way up. */
    const fade = Math.max(0, (k - 0.74) / 0.26);
    if (fade > 0) {
      this.pipeline.tint.setHex(0x000000);
      this.pipeline.tintAmt = Math.max(this.pipeline.tintAmt, fade);
    }
  }

  /* ===========================================================
     THE ROOM ITSELF
     =========================================================== */
  enterUfo() {
    if (this.state !== 'island') return;
    if (!this.ufoScene || !this.mp.ufo) return;
    this.state = 'ufo';
    this.scene = this.ufoScene;
    this.player.mesh.removeFromParent();
    this.ufoScene.add(this.player.mesh);
    this.player.setColliders(UFO_COLLIDERS);
    this.player.insideBox = UFO_BOX;
    // in through the floor by the south wall, looking up the room at the plinth
    this.player.teleport(UFO_ENTRY.x, UFO_ENTRY.y, UFO_ENTRY.z, Math.PI);
    this.player.pitch = -0.02;
    this._ufoCooldown = true;
    this._runLater(() => { this._ufoCooldown = false; }, 4000);
    this.audio.sfx('descend');
    this._runLater(() => { if (this.state === 'ufo') this.audio.sfx('terminal'); }, 700);
    this.audio.playMusic('bunker');
    /* You arrive out of the black the lift ended on, and it lifts off the
       picture over the next two thirds of a second. */
    this.pipeline.tint.setHex(0x000000);
    this.pipeline.tintAmt = 0.95;
    this._rehomeAvatars();
    this.ui.clearToasts?.();
    this.ui.showPopup('INSIDE IT', 'TASHA - UNIT 03 CAME FROM HERE', 'coin', 'UP THE LIGHT');
  }

  /**
   * Put down under the light again. There is no door in that room: this is
   * called when the visit ends, when a council pulls everybody to the fire,
   * and when the round is packed away — never by the player.
   */
  exitUfo() {
    if (this.state !== 'ufo') return;
    this.state = 'island';
    this.scene = this.islandScene;
    this.player.mesh.removeFromParent();
    this.islandScene.add(this.player.mesh);
    this.player.setColliders(this.colliders);
    this.player.insideBox = null;
    const b = this.ufoBeamPos;
    if (b) {
      /* Set down on your own bearing rather than all on one spot, so four
         people coming out together do not arrive inside each other. Inside
         the footprint, because under the beam is where you went up from —
         and if the light is somehow still on, up you go again, which is
         correct. The cooldown gives you four seconds to walk out of it. */
      const a = this.player.facing || 0;
      const x = b.x + Math.sin(a) * (UFO_R * 0.6);
      const z = b.z + Math.cos(a) * (UFO_R * 0.6);
      this.player.teleport(x, heightAt(x, z) + 0.6, z, a);
    }
    this._ufoCooldown = true;
    this._runLater(() => { this._ufoCooldown = false; }, 4000);
    /* The room's one prop must not leave with us: it belongs to the saucer's
       scene and it may still be in somebody's hand up there. */
    this._parkScanner();
    this.audio.sfx('descend');
    this._rehomeAvatars();
    this.audio.playMusic(this._islandTrack());
    this.pipeline.tint.setHex(0xffffff);
    this.pipeline.tintAmt = 0.5;
  }

  /* =========================================================
     THE SIGNAL SCANNER

     The first version of this was a sonar sweep looking for exactly one
     thing: the Stranger. He comes ashore once a round and stays for
     seventy-five seconds, so a fifteen Syncoin item spent the other
     nineteen minutes saying NO SIGNAL. It was not glitchy — it had
     nothing to find.

     It is a spectrum analyser now. The island is full of things that
     transmit, and they sit at different places on the band:

       the mast          always there, and it is what gets you home
       the listening post  the real hatch talks; the three decoys do not
       relay cameras     one carrier each, so you can find cameras
                         somebody else hid
       the Stranger      when he is ashore, and he is the loudest
                         thing on the band by a long way

     So it is useful from the moment you switch it on, and when the one
     you actually want appears you cannot miss it.

     You LOCK a carrier and it gives you a steer: a bar with a marker that
     centres as you turn to face it, and a range that counts down as you
     close. That is a thing you can walk with. A bearing painted on a
     compass rose is not.
     ========================================================= */
  _scanSources(out = []) {
    out.length = 0;
    const M = this.mp;
    const p = this._roomAnchor(this.roomId) || this.player.pos;
    /* Pooled, like the belt: the set is re-read every frame while it is
       switched on, and a carrier per frame per source is garbage for
       nothing. The sort below permutes `out`, never the pool. */
    const pool = (this._scanPool = this._scanPool || []);
    const push = (kind, name, x, z, band, power) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > power * 1.6) return;                 // out of its range entirely
      const r = pool[out.length] || (pool[out.length] = {});
      r.kind = kind; r.name = name; r.x = x; r.z = z; r.band = band;
      r.dist = d;
      // how loud it reads: inverse square, near enough, clamped
      r.strength = THREE.MathUtils.clamp(1 - (d / (power * 1.6)), 0.04, 1);
      out.push(r);
    };

    /* THE X. This used to be the mast, which is a fixed point you can see
       from most of the island and learn in one round — a carrier that
       tells you something you already knew is not worth a band. The chest
       moves every round, it is the one thing on the island worth finding
       that nothing else will point you at, and it goes quiet the moment
       somebody digs it up. */
    const bu = this.buried;
    if (bu && !bu.state.taken) push('x', 'BURIED METAL', bu.x, bu.z, 0.08, 300);
    // the real listening post. The decoys are holes in the ground.
    if (M.bunker) push('post', 'LISTENING POST', M.bunker.x, M.bunker.z, 0.30, 170);
    // every camera that is up, including the four that came with the mast
    for (const c of (this.cams || [])) {
      if (!c.placed) continue;
      push('cam', c.name, c.x, c.z, 0.50 + (c.i % 10) * 0.028, 110);
    }
    // and him, when he is out there
    if (M.stranger) push('him', 'UNKNOWN HEAT', M.stranger.x, M.stranger.z, 0.86, 260);
    out.sort((a, b) => a.band - b.band);
    return out;
  }

  _tickScanner(dt) {
    if (!this.scannerOn) { this.scanLock = null; return; }
    if (!this.hasItem('scanner')) { this.scannerOn = false; return; }

    this.scanT = (this.scanT || 0) + dt;
    const list = this._scanSources(this.scanList || (this.scanList = []));

    /* Which carrier you are locked to. It stays put unless it goes away,
       so the display does not jump about under you while you are walking
       toward something. The Stranger takes the lock the FIRST time he
       appears — that is what you bought this for — but only once, so if
       you step off him deliberately the set stays where you put it. */
    let lock = list.find((q) => q.kind === this.scanKind && q.name === this.scanName);
    const him = list.find((q) => q.kind === 'him');
    if (him && !this._scanSaidHim) lock = him;
    if (!lock) lock = list[0] || null;
    if (lock) { this.scanKind = lock.kind; this.scanName = lock.name; }

    if (!lock) { this.scanLock = null; return; }

    /* The bearing is TRUE, every frame, with nothing wandering on top of
       it. The old version added a slow drift of up to a third of a radian
       and it read exactly like a fault: you would face the thing dead on
       and the needle would sit off to one side and stay there.
       The doubt is still modelled — it is drawn as a band either side of
       the needle instead, so the set tells you how sure it is without ever
       telling you something untrue. */
    const position = this._roomAnchor(this.roomId) || this.player.pos;
    const dx = lock.x - position.x, dz = lock.z - position.z;
    const bearing = Math.atan2(dx, dz);
    const far = THREE.MathUtils.clamp((lock.dist - 12) / 130, 0, 1);
    const spread = 0.03 + far * 0.42;

    /* The range is rounded coarsely at distance and finely up close, which
       is the honest way to be vague: 180M, 140M, 96M, 41M, 12M. A number
       that flickers between 137 and 138 while you stand still is the other
       thing that read as glitchy. */
    const step = lock.dist > 100 ? 20 : lock.dist > 40 ? 5 : 1;
    const shown = Math.max(step, Math.round(lock.dist / step) * step);

    // one object, kept, because the steer is rewritten every frame the set is on
    const lk = (this._scanLockObj = this._scanLockObj || {});
    lk.kind = lock.kind;
    lk.name = lock.name;
    lk.note = lock.kind === 'him' ? 'HUMANOID HEAT'
      : lock.kind === 'cam' ? 'RELAY CAMERA'
        : lock.kind === 'x' ? 'WORTH DIGGING' : 'BURIED SET';
    lk.dist = lock.dist;
    lk.shown = shown;
    lk.strength = lock.strength;
    lk.band = lock.band;
    lk.bearing = bearing;
    lk.spread = spread;
    lk.count = list.length;
    lk.index = list.indexOf(lock) + 1;
    this.scanLock = lk;

    /* It clicks faster the closer you are, like a geiger counter — which
       is the part that actually walks you in, because you can hear it
       without looking at the panel. */
    const rate = 0.10 + (1 - THREE.MathUtils.clamp(lock.dist / 140, 0, 1)) * 1.9;
    this._scanClick = (this._scanClick || 0) + dt * rate;
    if (this._scanClick >= 1) {
      this._scanClick = 0;
      this.audio.sfx(lock.kind === 'him' ? 'ping' : 'oche');
    }

    // and a warble when he first turns up, so you know without looking
    if (him && !this._scanSaidHim) {
      this._scanSaidHim = true;
      this.audio.sfx('alert');
      this.ui.toast('UNKNOWN HUMANOID HEAT SIGNATURE DETECTED', 'gold', 4500);
    }
    if (!him) this._scanSaidHim = false;
  }

  /** Step the lock on to the next carrier along the band. */
  scanNext(d = 1) {
    if (!this.scannerOn) return;
    const list = this.scanList || [];
    if (!list.length) { this.audio.sfx('deny'); return; }
    let i = list.findIndex((q) => q.kind === this.scanKind && q.name === this.scanName);
    if (i < 0) i = 0;
    const n = list[(i + d + list.length) % list.length];
    this.scanKind = n.kind;
    this.scanName = n.name;
    this.audio.sfx('select');
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
    if (st.dug >= 1 || st.taken) { bu.digging = bu.lastSpade = 0; return; }
    const p = this.player.pos;
    const near = Math.hypot(p.x - bu.x, p.z - bu.z) < 3.2;
    const want = near && (this.mp.holdingE || this.mp.holdingClick) && this.amAlive
      && !this.screens.open && !this.paused && !this.inRoom
      && now() >= (this.stunnedUntil || 0) && this.mp.view.phase === PHASE.ROAM;
    if (!want) {
      bu.digging = bu.lastSpade = 0;
      return;
    }
    bu.digging += dt;
    /* THE HOLE IS THE HOST'S. This used to advance `dug` locally, so
       everybody dug a private hole in the same spot and two people
       standing over the same X saw different ground. Spadework goes on
       the wire in quarter-second lots and the depth comes back. */
    bu.sent = (bu.sent || 0) + dt;
    if (bu.sent >= 0.25) { this._send({ t: C.DIG, secs: bu.sent }); bu.sent = 0; }
    // a spadeful every third of a second, and sand off the shovel
    if (bu.digging - (bu.lastSpade || 0) > 0.34) {
      bu.lastSpade = bu.digging;
      this.audio.sfx('step_sand');
      this.taskFx?.burst(bu.x, bu.y + 0.3, bu.z, 0xd8c79c, 'puff', 1.1);
      this.player.punch?.(0.05);
    }
    /* The chest breaking the surface is handled in _onDig — the depth only
       ever changes there, and by the time it reaches 1 this method has
       already returned at its own guard. Half way up is still here, because
       it is a message for whoever is standing over the hole. */
    if (st.dug > 0.62 && !bu.saidHalf) {
      bu.saidHalf = true;
      this.audio.sfx('stinger');
      this.ui.toast('SOMETHING IS COMING UP', 'gold', 2600);
    }
  }

  /**
   * Out of the sand.
   *
   * This lived at the bottom of _tickDig, where it could only ever fire on
   * the host's own machine and only if the host put in the last spadeful:
   * everywhere else the depth arrives between frames and the next _tickDig
   * returns at its guard. So a guest dug the chest out in silence and then
   * walked through it, camera and all.
   */
  _chestSurfaced() {
    const bu = this.buried;
    if (!bu || bu.said) return;
    bu.said = true;
    /* It is a solid object once it is standing on the sand, and every
       machine has to agree about that wherever its own player is standing. */
    if (!bu.solid) {
      bu.solid = true;
      // kept, because the hole is filled in again at the start of the next
      // round and the chest must not leave an invisible wall on the sand
      bu.collider = { x: bu.x, z: bu.z, r: 0.95 };
      this.colliders.push(bu.collider);
      /* Only if we are standing on the island. Every door back out sets the
         island list again, and handing it to somebody inside a room would
         give them the beach's walls in the bar. */
      if (this.state === 'island') this.player.setColliders(this.colliders);
    }
    // the card belongs to the people at the hole, not to the whole island
    const p = this.player.pos;
    if (bu.digging > 0 || Math.hypot(p.x - bu.x, p.z - bu.z) < 6) {
      this.audio.sfx('confirm');
      this.audio.sfx('rumble');
      this.ui.showPopup('A CHEST', 'IT IS NOT LOCKED', 'coin', 'OUT OF THE SAND');
    }
  }

  /** Open it. Gold, and one thing that is not gold. */
  openChest() {
    const bu = this.buried;
    if (!bu || bu.state.taken || bu.state.dug < 1) { this.audio.sfx('deny'); return; }
    // the host says who got it, and there is only one lot to get
    this._send({ t: C.CHEST });
  }

  /** The host's answer: it is open, this is who reached in. */
  _onChest(byId, gold) {
    const bu = this.buried;
    if (!bu || bu.state.taken) return;
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
    const mine = byId === this.mp.view.selfId;
    if (mine) {
      this.coins = (this.coins || 0) + gold;
      this._send({ t: C.PURSE, coins: this.coins });
    }
    this.taskFx?.burst(bu.x, bu.y + 1.0, bu.z, 0xffd24a, 'done', 5.0);
    this.player.punch?.(0.28);

    if (!mine) {
      // somebody else got there first, and everybody should know who
      const who = this.mp.view.players.get(byId)?.name || 'SOMEBODY';
      this.ui.toast(`${who} TOOK THE CHEST`, 'gold', 3200);
      return;
    }

    /* And one thing off Ferdi's shelf, free — rolled here rather than by
       the host because only the person holding it is affected by it, and
       it depends on what they already own. Never the flare pistol: a free
       gun found in a hole is not a thing this round needs. */
    const pool = STOCK.filter((i) => i.side === 'open' && i.id !== 'gun'
      && !(this.owned?.has(i.id))
      && (i.id !== 'camera' || this.camsSpare() > 0));
    const prize = pool.length ? pool[(Math.random() * pool.length) | 0] : null;
    if (prize) {
      this.owned = this.owned || new Set();
      if (keptOnYou(prize)) this.owned.add(prize.id);
      else if (prize.id !== 'camera') this.carry = [...(this.carry || []), prize.id];
      if (prize.id === 'camera' || PASSIVE_AT_BUY.has(prize.id)) this.applyItem(prize.id);
    }
    /* The card names the prize, so a toast saying it again is two messages
       for one event — and "AND A THE PARTY BOX" is not a sentence. */
    this.ui.clearToasts?.();
    this.ui.showPopup(`${gold} SYNCOIN`, prize ? prize.name : 'AND NOTHING ELSE',
      'coin', 'THE CHEST');
  }

  /**
   * Somebody put the night on.
   *
   * The clock is wound to eight seconds short of dusk, so the sky turns
   * while you watch rather than snapping, and the night then runs its
   * full length from there. Everybody's clock is set by the same message,
   * so nobody is standing in a different hour to anybody else.
   */
  _onNightfall() {
    /* ALWAYS DAY is a cycle so long the clock never reaches dusk, so the
       light no longer follows it — winding it forward would darken nothing. */
    if (this.DAY_LEN > 5000) {
      this.ui.toast('THE SUN IS NOT SETTING TODAY', 'bad', 2000);
      return;
    }
    /* game.js scales the day's phases off the cycle instead of the old
       absolute 131 seconds, so dusk has to be derived the same way or the
       flare lands in the wrong hour at every DAY LENGTH but 6 MIN. */
    const DAY = Math.max(120, this.DAY_LEN) * 0.364;
    if (this.clock24 > DAY - 8 && this.night > 0.5) {
      // already dark; do not wind it forward into the dawn
      this.ui.toast('IT IS ALREADY DARK', 'bad', 2000);
      return;
    }
    this.clock24 = DAY - 8;
    this.audio.sfx('horn');
    this.audio.sfx('dawn');
    this.ui.clearToasts?.();
    this.ui.showPopup('NIGHTFALL', 'THE SKY IS GOING OUT', 'lantern', 'A FLARE WENT UP');
  }

  /** The host says the hole is this deep. */
  _onDig(dug) {
    const bu = this.buried;
    if (!bu) return;
    bu.state.dug = Math.max(bu.state.dug || 0, Math.min(1, +dug || 0));
    if (bu.state.dug >= 1) this._chestSurfaced();
  }

  /* =========================================================
     WHAT YOU DRANK

     Everything Quezetriel sells runs on one clock and one set of counters,
     so a second drink extends the first rather than fighting it, and there
     is exactly one place that decides when it all wears off.
     ========================================================= */
  buyDrink(id) {
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM || now() < (this.stunnedUntil || 0)) return false;
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
      this.ui.toast('NOBODY CAN READ YOUR NAME', 'jade', 2600);
    }
    if (id === 'rum' || id === 'falling') {
      this.doubleCoins = true;
      this.ui.toast('EVERY SYNCOIN COUNTS TWICE', 'jade', 2600);
    }
    if (id === 'own' || id === 'falling') {
      this.bigMeals = true;
      this._recalcSpeed();
      this.ui.toast('FASTER, AND THE WORK PAYS DOUBLE', 'jade', 2800);
    }
    if (id === 'falling') {
      this.player.staminaDrain = Math.min(this.player.staminaDrain, this.player.BASE_DRAIN * 0.5);
      this.nightEyes = true;
      this._send({ t: C.PERK, perk: 'quiet', on: true });
    }
  }

  /**
   * The whole multiplier stack, in one place.
   *
   * Every one of these used to write the speeds itself from the base, so
   * whichever spoke last wiped the others: taking the vest off threw away
   * the drink, the drink threw away the vest. The drink is read off the
   * tab rather than off bigMeals, because Cathy's burger sets bigMeals too
   * and a burger has never made anybody faster.
   */
  _recalcSpeed() {
    const t = now();
    const vest = this.hasItem('vest') ? 0.75 : 1;
    const floss = this.flossUntil && t < this.flossUntil ? 1.30 : 1;
    const own = this.tab && (t < (this.tab.own || 0) || t < (this.tab.falling || 0)) ? 1.25 : 1;
    this.player.SPEED = this.player.BASE_SPEED * vest * floss * own;
    this.player.SPRINT = this.player.BASE_SPRINT * vest * floss * own;
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
    /* _tickDrink has already dropped the expired key, so anything still on
       the tab and still in the future is a drink you are still paying for.
       Only speed ever asked: THE FALLING DOWN is ninety seconds against the
       others' two and three minutes, so it expired first and cancelled the
       quiet water, the pint and the rum you had running alongside it —
       which the tab then kept marked as live for ever. */
    const t = now();
    const live = (k) => !!this.tab && t < (this.tab[k] || 0);
    const still = (k) => live(k) || live('falling');

    if ((id === 'pint' || id === 'falling') && !still('pint')) {
      // back to whatever you had before the drink, popcorn included
      this.player.staminaDrain = this.hasItem('tonic')
        ? this.player.BASE_DRAIN * 0.2 : this.player.BASE_DRAIN;
    }
    if ((id === 'lamp' || id === 'falling') && !still('lamp')) {
      this.nightEyes = this.hasItem('nightglass') || false;
    }
    if ((id === 'quiet' || id === 'falling') && !still('quiet')) {
      if (!this.hasItem('soles')) this._send({ t: C.PERK, perk: 'quiet', on: false });
    }
    if ((id === 'rum' || id === 'falling') && !still('rum')) this.doubleCoins = false;
    if (id === 'own' || id === 'falling') {
      if (!still('own') && !this.hasItem('burger')) this.bigMeals = false;
      this._recalcSpeed();          // unconditional: it reads the tab itself
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
    this._runLater(() => { this._barCooldown = false; }, 1800);
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
    this._runLater(() => { this._barCooldown = false; }, 1800);
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
  /**
   * What the outdoors sounds like right now.
   *
   * Every door out of a room hard-played island/night, which put the island
   * theme on the Flopper's deck — and `M.aboard` was already true, so the
   * latch that starts her own track never re-fired and the only way back to
   * it was to walk ashore and board again. Anything restoring the open-air
   * track has to ask rather than guess. Jam and storm outrank the speaker
   * because they set the world state the day/night block is gated on.
   */
  _islandTrack() {
    const M = this.mp;
    if (M.aboard) return 'flopper';
    if (this.jammed) return 'alarm';
    if (this.stormOn) return 'storm';
    if (M.speaker && now() < M.speaker.until) return 'title';
    return (this.night || 0) > 0.55 ? 'night' : 'island';
  }

  _backOnDeck(lz = -1.2) {
    const plat = this.casinoPlat;
    /* SHE MAY HAVE SAILED.
       The deck follows the boat, and the boat leaves at dawn. Stepping
       out of the room onto the spot where the deck used to be is a
       hundred-metre fall into deep water — and if she is halfway out you
       ride with her past the edge of the playable sea and get dropped
       anyway. If she is not properly alongside you get off at the pier,
       which is where somebody who missed the boat would be. */
    const alongside = plat && (this.casinoIn ?? 1) > 0.9;
    if (plat && alongside) {
      const wx = plat.x + lz * plat.sin;
      const wz = plat.z + lz * plat.cos;
      // facing forward, down the open deck at the water, cabin behind
      this.player.teleport(wx, plat.y + 0.35, wz, Math.atan2(-plat.sin, -plat.cos));
      this.player.pitch = 0;
      return;
    }
    this._putAshore('SHE SAILED WITHOUT YOU');
  }

  /**
   * The shore end of her bridge, on ground you can actually stand on.
   *
   * The pier head is worked out from the boat's mooring and is not
   * guaranteed to be above water, so this walks inland until the terrain
   * is properly dry rather than trusting the arithmetic.
   */
  _putAshore(why) {
    const sh = this.casinoShore;
    let x = sh ? sh.x : 0, z = sh ? sh.z : 0;
    const d0 = Math.hypot(x, z) || 1;
    for (let k = 0; k < 40; k++) {
      if (heightAt(x, z) > 0.8) break;
      // straight at the middle of the island, two metres at a time
      x -= (x / d0) * 2; z -= (z / d0) * 2;
    }
    this.player.teleport(x, Math.max(heightAt(x, z), 0.6) + 0.6, z, Math.atan2(-x, -z));
    this.player.pitch = 0;
    if (why) this.ui?.toast?.(why, 'gold', 3000);
  }

  /** In a round there is paid work, so the burger is on the counter too. */
  foodList() { return FOOD; }

  /* ---------- darts ---------- */
  /** Put a stake up. The screen has already checked you can cover it. */
  dartsStake(n) {
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM || !Number.isFinite(n) || n <= 0) return false;
    if ((this.coins || 0) < n) return false;
    this.coins -= n;
    this._send({ t: C.PURSE, coins: this.coins });
    this.audio.sfx('coin');
    return true;
  }

  /** Settle a leg. `pays` is the whole pot, or nought. */
  dartsSettle(pays) {
    if (!this.mp.active || this.mp.finished || !this.amAlive || !Number.isFinite(pays)) return;
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
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM || !Number.isFinite(n) || n <= 0) return false;
    if ((this.coins || 0) < n) return false;
    this.coins -= n;
    this._send({ t: C.PURSE, coins: this.coins });
    return true;
  }

  /** Pay a round out. The stake has already been taken. */
  bjSettle(pays) {
    if (!this.mp.active || this.mp.finished || !this.amAlive || !Number.isFinite(pays) || pays <= 0) return;
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
    this._runLater(() => { if (this.state === 'island') this.audio.sfx('hatch'); }, 700);
    this.pipeline.tint.setHex(0xffffff);
    this.pipeline.tintAmt = 0.5;
    this.audio.playMusic(this._islandTrack());
  }

  /**
   * Interpolate every avatar and decide whether it can be seen.
   *
   * This used to live inside the island branch of update(), after the
   * interior branches had already returned — so anybody who followed you down
   * the ladder stood perfectly still, because nothing was advancing their
   * interpolation.
   */
  /* One ghost material for every dead castaway. Cloned off the shared
     `opaque` the whole island is built from — via ps1Clone, or the copy comes
     back perspective-correct and un-snapped while the world around it wobbles
     — and made once, on the first death of a session, so a round with nobody
     dead in it never compiles the program at all. depthWrite off so two
     ghosts standing together read as two, not as whichever drew first. */
  get _ghostMat() {
    if (!this._ghostMaterial) {
      const m = ps1Clone(this.propMats.opaque);
      m.transparent = true;
      m.opacity = 0.34;
      m.depthWrite = false;
      this._ghostMaterial = m;
    }
    return this._ghostMaterial;
  }

  _updateAvatars(dt) {
    const M = this.mp;
    const t = now();
    for (const av of M.avatars.values()) {
      av.update(dt, t);
      av.setVisible(this._avatarVisible(av));
      /* Only the dead ever see a ghost — the living cannot see them at all,
         so their solid form never reaches a living screen either way. */
      const rec = M.view.players.get(av.id);
      /* Asked for only when it is wanted: evaluating the getter as an
         argument for every avatar on every frame built the material on the
         first frame of the round, whether or not anybody ever died. */
      const dead = rec ? rec.alive === false : av.alive === false;
      av.setGhost(dead, dead ? this._ghostMat : null);
    }
  }

  /**
   * The dead can see the dead; the living cannot — and nobody sees anybody
   * who is in a different room from them.
   *
   * One rule, asked from all three places that decide it, because
   * setVisible's early-out is only safe if nothing writes mesh.visible
   * behind its back. The snapshot used to do exactly that, with no ghost
   * term in it: it hid another ghost directly on the mesh, left av.visible
   * saying true, and setVisible then refused to put them back. Two dead
   * players standing together could not see each other for the rest of the
   * round.
   */
  _avatarVisible(av) {
    if (!av.buf?.length) return false;
    const rec = this.mp.view.players.get(av.id);
    const isAlive = rec ? rec.alive !== false : av.alive !== false;
    return (isAlive || !this.amAlive) && (av.room | 0) === this.roomId;
  }

  /**
   * Move every avatar into the scene we are now looking at, or hide it.
   * Called whenever we cross between the island and an interior.
   */
  _rehomeAvatars() {
    const M = this.mp;
    M.taskProgress = null;
    M.holdingE = M.holdingClick = false;
    const mine = this.roomId;
    const sc = this.scene;
    for (const av of M.avatars.values()) {
      const together = (av.room | 0) === mine;
      av.setVisible(this._avatarVisible(av));
      if (together && sc) av.setScene(sc);
    }
    for (const b of M.bodies.values()) {
      // a body stays where it fell, which may be an interior
      const together = (b.room | 0) === mine;
      b.mesh.visible = together;
      if (together && sc && b.mesh.parent !== sc) sc.add(b.mesh);
    }
    for (const d of M.drops || []) {
      if (!d.mesh) continue;
      const together = !d.taken && (d.room | 0) === mine;
      d.mesh.visible = together;
      if (together && sc && d.mesh.parent !== sc) sc.add(d.mesh);
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
    this.audio.sfx('slam');
    this.audio.sfx('rumble');
    this.pipeline.tint.setHex(0x000000);
    this.pipeline.tintAmt = 0.7;
    this._notice('THE LIGHTS ARE OUT');
    clearTimeout(this._blackoutT);
    this._blackoutT = this._runLater(() => {
      // only lift it if a douse sabotage is not also running
      if (!this.mp.view.sabotage || this.mp.view.sabotage.kind !== 'douse') this.doused = false;
      this.audio.sfx('confirm');
    }, (secs || 45) * 1000);
  }

  /** The host's answer to a ledger request, cached until the next one. */
  /* =========================================================
     THE RECEIPT PRINTER

     A docket for every sale over Ferdi's open counter: who, what, and
     what they paid. It feeds out of the top of the panel, hangs there for
     fifteen seconds, and rolls away.

     One station, one docket. If a second sale comes in while the first
     is still hanging there the first tears off — the queue is kept so
     nothing is lost while the paper is changing over, but only the
     newest is ever on the roll.
     ========================================================= */
  _onReceipt(r) {
    if (!r || !this.hasItem?.('printer') || !this.printerOn) return;
    this.receipts = this.receipts || [];
    const it = itemById(r.id);
    this.receipts.push({
      who: String(r.from || '?').slice(0, 12),
      what: (it ? it.name : String(r.id || '?')).slice(0, 18),
      price: r.price | 0,
      icon: it ? it.icon : 'coin',
      t: 0,                             // how long it has been out
      life: 15,                         // and how long it gets
      no: (this._receiptNo = (this._receiptNo || 0) + 1),
    });
    /* Six on the roll. They no longer expire on a clock — the set is on
       or it is off, and while it is on you can read back through what it
       has printed, which is the whole point of a printer over a toast. */
    while (this.receipts.length > 6) this.receipts.shift();
    this.receiptAt = 0;                    // a new one always shows itself
    this.audio.sfx('page');
    this.audio.sfx('select');
  }

  _tickReceipts(dt) {
    const R = this.receipts;
    if (!R || !R.length) return;
    for (const q of R) q.t += dt;
  }

  /** Read back one docket. Wraps, because six is not many to scroll. */
  receiptBack(d = 1) {
    const R = this.receipts || [];
    if (!R.length) { this.audio.sfx('deny'); return; }
    this.receiptAt = ((this.receiptAt || 0) + d + R.length) % R.length;
    this.audio.sfx('select');
  }

  _onLedger(rows) {
    const M = this.mp;
    M.ledger = new Map();
    for (const [id, coins] of (rows || [])) M.ledger.set(id, coins | 0);
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
  get inRoom() {
    return this.roomId !== 0;
  }

  /** Come back up, whichever room we happen to be in. */
  leaveRoom() {
    if (this.state === 'bunker') this.leaveBunker();
    else if (this.state === 'cab') this.leaveCab();
    else if (this.state === 'bar') { this.leaveBar(); this.leaveHighRoller(); }
    else if (this.state === 'highroller') this.leaveHighRoller();
    else if (this.state === 'ufo') this.exitUfo();
  }

  /** Where a room comes out on the island — nothing inside one is on the chart. */
  _roomAnchor(room) {
    const r = room | 0;
    if (!r) return null;
    if (r === 1) return this.mp.bunker || null;
    if (r === 2 || r === 3) return this.casinoPlat || this.casinoPos || null;
    if (r === 4) return this.tower || null;
    /* The saucer's anchor is where its light lands, which is the only part
       of it anybody on the ground can walk to. */
    if (r === 5) return this.ufoBeamPos || null;
    return null;
  }

  get roomId() {
    if (this.state === 'bunker') return 1;
    if (this.state === 'highroller') return 2;
    if (this.state === 'bar') return 3;
    if (this.state === 'cab') return 4;
    if (this.state === 'ufo') return 5;
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
      sabotage: M.view.sabotage
        ? (SABOTAGE_DEFS[M.view.sabotage.kind]?.short
          || SABOTAGE_DEFS[M.view.sabotage.kind]?.name || '') : null,
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
    /* The generated fire, not LANDMARKS.wreck: that is only the seed the
       placer starts from, and the hull it settles on can end up fifteen
       metres from the camp the pip claims to mark. */
    const camp = this.campfirePos || this.campPos || this.spawn || this.wreckPos;
    if (camp) m.push({ x: camp.x, z: camp.z, label: 'CAMP', kind: 'camp' });
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
    if (!this.amAlive || this.mp.view.phase !== PHASE.ROAM || now() < (this.stunnedUntil || 0)) return null;
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
      this._runLater(() => this.audio.sfx('reel'), 500 + i * 450);
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
    if (!this.mp.active || this.mp.finished || !this.amAlive || !Number.isFinite(win) || win <= 0) return;
    this.coins += win;
    this._send({ t: C.PURSE, coins: this.coins });
    slot?.userData.payout(true);
    if (win >= 60) {
      this.ui.showPopup(`${win} SYNCOIN`, 'TIM WILL BE FURIOUS', 'coin', 'THE FLOPPER PAYS');
    }
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
    if (!this.inRoom) this.audio.playMusic('title');
    this.ui.toast('SOMEBODY PUT A SPEAKER ON', 'gold', 3000);
    this._compassForTasks();
    this._buildSpeakerNode();
    setHidden(M.speakerNode, false);
    M.speakerNode.position.set(x, heightAt(x, z), z);
  }

  /** A puzzle stage was solved; it counts exactly like a hold would. */
  finishMinigame(taskId) {
    if (!taskId || this.mp.view.phase !== PHASE.ROAM || this.inRoom
        || now() < (this.stunnedUntil || 0)) return;
    this._send({ t: C.DO_TASK, taskId, step: this.mp.view.taskStep.get(taskId) || 0 });
  }

  cancelMinigame() { this.audio.sfx('deny'); }

  sendChat(text) { this._send({ t: C.CHAT, text }); }
  sendVote(targetId) { this._send({ t: C.VOTE, targetId }); this.audio.sfx('confirm'); }
  /* No local cue: on the host `_send` is a synchronous loopback, so the
     echo's own `charge` in _onSabotage landed on the same frame and the pull
     was heard at double amplitude. Let the authoritative echo be the sound. */
  sendSabotage(kind) { this._send({ t: C.SABOTAGE, kind }); }

  /** Where a given sabotage has to be repaired, in world coordinates. */
  sabotageSites(kind) {
    const def = SABOTAGE_DEFS[kind];
    if (!def) return [];
    return (def.fixAt || []).map((k) => this._namedSite(k)).filter(Boolean);
  }
  startMatch() { if (this.isHost) this.mp.host.start(); }

  /* [RELEASE] REMOVE BEFORE RELEASE — everything the workshop hands you the
     moment a round begins: 9999 coins, every item in the shop, the listening
     post on your chart. Delete this method and its one call site. */
  _applyDevKit() {
    const M = this.mp;
    if (!M.dev) return;
    // The same phase gates as the online game apply to workshop grants.
    if (M.view.phase !== PHASE.ROAM) { M.devKitPending = true; return; }
    this.coins = 9999;
    // the host has to be told, or the command table's ledger shows nothing
    this._send({ t: C.PURSE, coins: this.coins });
    this.knowsBunker = true;
    this.owned = this.owned || new Set();
    for (const it of STOCK) {
      if (keptOnYou(it)) { this.owned.add(it.id); this.applyItem(it.id); }
      else if (it.id === 'camera') this.applyItem(it.id);
      else this.carry = [...(this.carry || []), it.id, it.id, it.id];
    }
    this.ui.toast('DEV MODE - EVERYTHING UNLOCKED', 'jade', 4000);
  }

  /**
   * A body drops rather than appearing already laid out.
   *
   * This ran at the bottom of update(), below every interior branch's
   * `return`, so a corpse in the listening post was simply there, fully
   * slumped, in the frame it was made — and then played its drop when
   * somebody climbed out. It only touches the mesh, so it belongs above
   * the branches with the rest of the things that are true in any room.
   */
  _tickBodies(dt) {
    for (const b of this.mp.bodies.values()) {
      if (b.fall === undefined || b.fall >= 1) continue;
      b.fall = Math.min(1, b.fall + dt * 2.6);
      const k = 1 - Math.pow(1 - b.fall, 3);
      b.mesh.rotation.z = Math.PI * 0.46 * k;
      b.mesh.position.y = b.restY + (1 - k) * 0.9;
    }
  }

  /**
   * The world tipping as you go down.
   *
   * The roll is ABSOLUTE, not accumulated — the death shot's lookAt rewrites
   * the whole orientation every frame — so this has to be called from
   * render(), after the shot has had the camera, and it has to come back
   * to nothing on its own. The old ramp grew to its full twenty-nine
   * degrees and then simply stopped being applied, which snapped the
   * horizon upright in a single frame; a sine over the same 1.4 seconds
   * tips you over and unwinds you, and is exactly zero at both ends.
   */
  _tickDeathTilt(dt) {
    if (!this.deathTilt) return;
    this.deathTilt = Math.max(0, this.deathTilt - dt);
    const k = 1 - this.deathTilt / 1.4;
    this.camera.rotateZ(0.5 * Math.sin(Math.PI * k));
  }

  /* ===========================================================
     LOOP
     =========================================================== */
  update(dt) {
    if (!this.mp.active) return super.update(dt);
    const M = this.mp;

    /* A body does not walk itself out of its own shot. Zeroed here, above
       every branch, because each room branch reads the input for itself. */
    if (this.deathShot || M.lift) {
      const I = this.input;
      I.fwd = I.back = I.left = I.right = false;
      I.jump = I.sprint = false;
    }

    /* Spectating. Wanting to walk is how you say you are done watching, so
       any movement key lets go — checked before the follow writes over the
       position, or the step you asked for would be undone in the same frame. */
    if (M.spectate) {
      const I = this.input;
      if (I.fwd || I.back || I.left || I.right || I.jump) this.stopSpectate();
      else if (!this.amAlive && M.view.phase === PHASE.ROAM) this._followSpectate(false);
      else this.stopSpectate(true);
    }

    this.time += dt;
    setTime(this.time);
    if (this.pipeline.tintAmt > 0) this.pipeline.tintAmt = Math.max(0, this.pipeline.tintAmt - dt * 1.4);

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
    /* And so does the hour. Only the island branch reaches updateDayNight,
       so a night spent in the bar or down the hatch was a night that never
       happened — you came up at the same minute you went down while the
       host had rolled over into dawn. Real time rather than the capped
       physics step, because the host's clock runs on a wall-clock timer;
       tickClock refuses a second advance in the same frame, so the island
       branch's own updateDayNight still paints the sky without double
       winding it. */
    this.tickClock(this.rawDt > 0 ? this.rawDt : dt);
    this._tickBodies(dt);
    /* And the saucer. Its fade has to finish whether you are watching it or
       standing in a room three hundred metres below it, and the machine's
       four seconds of arithmetic are owed to whoever started them however
       the round moves underneath. Both above every branch, for that reason. */
    this._tickUfoVisit(dt);
    this._tickScan(dt);

    /* And so does the flare. The host allows a shot in a room — it only
       refuses one across two different rooms — but the stun was read in the
       island branch alone, so a victim taken in the listening post walked up
       the ladder and away while the room voted on him. */
    const stunned = !!this.stunnedUntil && now() < this.stunnedUntil;
    if (this.stunnedUntil && !stunned) this.stunnedUntil = 0;

    if (this.state === 'cutscene') {
      this.updateCutscene(dt);
      this.ui.hud.data.mp = null;
      return;
    }

    // These timers keep advancing in interiors. A till receipt did not get
    // older in the bar, and a flare fired there remained alive until exit.
    this.flares?.update(dt);
    this._tickReceipts(dt);
    this._tickScanner(dt);
    this.dizzy?.update(dt, this.time, (id) => {
      if (id === M.view.selfId) return this.roomId ? null : this.player.pos;
      const av = M.avatars.get(id);
      return av && !av.room ? av.pos : null;
    });

    /* Down the hatch: its own room, its own walls, and the island keeps
       running above you — which is the whole risk of being down here. */
    /* The room behind the painting. Its own scene, its own walls, and the
       island keeps running above you exactly as it does in the bunker. */
    if (this.state === 'highroller') {
      const froze2 = this.paused || this.screens.open || stunned || M.view.phase !== PHASE.ROAM;
      if (!froze2) {
        this.player.update(dt, this.input, {
          groundOf: hrHeight, water: false, bounds: false, insideBox: HR_BOX,
        });
      } else {
        this.player.insideBox = HR_BOX;
        this.player.updateCamera(dt, hrHeight);
        if (stunned) this.camera.rotateZ(Math.sin(this.time * 4) * 0.09);
      }
      this.hrScene.userData.tick(this.time, dt);
      this._updateAvatars(dt);
      this._mpHud(dt);
      const bit2 = froze2 ? null : this.nearestInteractable();
      this.ui.setPrompt(bit2 ? bit2.prompt : null);
      return;
    }

    /* The hut at the head of the mast. Same shape again. */
    if (this.state === 'cab') {
      const frozeC = this.paused || this.screens.open || stunned || M.view.phase !== PHASE.ROAM;
      if (!frozeC) {
        this.player.update(dt, this.input, {
          groundOf: cabHeight, water: false, bounds: false, insideBox: CAB_BOX,
        });
      } else {
        this.player.insideBox = CAB_BOX;
        this.player.updateCamera(dt, cabHeight);
        if (stunned) this.camera.rotateZ(Math.sin(this.time * 4) * 0.09);
      }
      this.cabScene.userData.tick(this.time, dt);
      this._updateAvatars(dt);
      this._mpHud(dt);
      const bitC = frozeC ? null : this.nearestInteractable();
      this.ui.setPrompt(bitC ? bitC.prompt : null);
      return;
    }

    /* The bar behind the high rollers room. Same shape again: its own scene,
       its own walls, and the island carrying on without you. */
    if (this.state === 'bar') {
      const frozeB = this.paused || this.screens.open || stunned || M.view.phase !== PHASE.ROAM;
      if (!frozeB) {
        this.player.update(dt, this.input, {
          groundOf: barHeight, water: false, bounds: false, insideBox: BAR_BOX,
        });
      } else {
        this.player.insideBox = BAR_BOX;
        this.player.updateCamera(dt, barHeight);
        if (stunned) this.camera.rotateZ(Math.sin(this.time * 4) * 0.09);
      }
      this.barScene.userData.tick(this.time, dt, this.camera.position);
      this._updateAvatars(dt);
      this._mpHud(dt);
      const bitB = frozeB ? null : this.nearestInteractable();
      this.ui.setPrompt(bitB ? bitB.prompt : null);
      return;
    }
    /* Inside the saucer. Same shape as the three above it, plus the two
       things this room has that no other room does: a plate that has to know
       who is standing on it, and a machine that may be in somebody's hand. */
    if (this.state === 'ufo') {
      const frozeU = this.paused || this.screens.open || stunned || M.view.phase !== PHASE.ROAM;
      if (!frozeU) {
        this.player.update(dt, this.input, {
          groundOf: ufoHeight, water: false, bounds: false, insideBox: UFO_BOX,
        });
      } else {
        this.player.insideBox = UFO_BOX;
        this.player.updateCamera(dt, ufoHeight);
        if (stunned) this.camera.rotateZ(Math.sin(this.time * 4) * 0.09);
      }
      /* Before the scene's own tick, so the iris and the plate lamp are
         working from this frame's answer rather than the last one's. */
      this._updateAvatars(dt);
      this._tickUfoRoom();
      this.ufoScene.userData.tick(this.time, dt, this.camera.position);
      this._mpHud(dt);
      const bitU = frozeU ? null : this.nearestInteractable();
      this.ui.setPrompt(bitU ? bitU.prompt : null);
      return;
    }
    if (this.state === 'bunker') {
      const froze = this.paused || this.screens.open || stunned || M.view.phase !== PHASE.ROAM;
      if (!froze) {
        this.player.update(dt, this.input, {
          groundOf: bunkerHeight, water: false, bounds: false,
          insideBox: BUNKER_BOX,
        });
      } else {
        // frozen behind a screen, but the walls still apply
        this.player.insideBox = BUNKER_BOX;
        this.player.updateCamera(dt, bunkerHeight);
        if (stunned) this.camera.rotateZ(Math.sin(this.time * 4) * 0.09);
      }
      /* The hologram wants positions, nothing else. bunkerReadout() builds
         the whole dossier and it is not cheap to do sixty times a second. */
      this.bunkerScene.userData.tick(
        this.time, dt, this._holoRoster(),
        this.mp.view.sabotage?.half || this.mp.sabLog?.[0]?.half || null,
        this.screens.top?.name === 'mpTable'
      );
      this._updateAvatars(dt);
      this._mpHud(dt);
      const bit = froze ? null : this.nearestInteractable();
      this.ui.setPrompt(bit ? bit.prompt : null);
      return;
    }

    /* The last place you actually stood outdoors, kept as a copy so it does
       not follow you into a room the way a live Vector3 would. The chart has
       no way to draw an interior, and every interior is its own local space. */
    if (this.state === 'island') {
      this._islandPos = { x: this.player.pos.x, z: this.player.pos.z };
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
    /* The lift freezes you too. Your feet left the sand four frames ago and
       the controller must not walk them anywhere while the camera is busy
       showing you leaving. */
    const frozen = this.paused || this.screens.open || !inPlay || !!M.lift || stunned;

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
      /* Being dead is NOT a reason to drop it. Ghosts are given a list and
         twelve of the nineteen chores contain a hold, so cancelling on the
         first frame left the murdered with a list they could not touch and
         a toast telling them they had moved. Death clears the hold once,
         where the blow lands. */
      if (moved || !inPlay) {
        M.taskProgress = null;
        this.audio.sfx('deny');
        // !inPlay is a council opening or the round ending, not a step taken
        this.ui.toast(moved ? 'YOU MOVED - START AGAIN' : 'THAT WILL HAVE TO WAIT', 'bad', 1400);
      } else if (frozen) {
        /* Behind a card or a pause the world is frozen, so the hold freezes
           with it. No key-up ever arrives when Escape is pressed with E
           down, and the bar used to charge on and fire the chore into the
           wire from behind the pause card. Nothing drains either — a body
           card popping up must not bin your chore for you. */
        tp.slack = 0;
      } else if (!M.holdingE && !M.holdingClick) {
        // let go and it drains, so you cannot start six chores at once
        tp.t = Math.max(0, tp.t - dt * 1.6);
        tp.slack = (tp.slack || 0) + dt;
        if (tp.slack > 1.1) {
          M.taskProgress = null;
          this.audio.sfx('deny');
          // the commonest way to lose a chore, and the only one that said nothing
          this.ui.toast('YOU LET GO - START AGAIN', 'bad', 1400);
        }
      } else {
        tp.slack = 0;
        tp.t += dt;
        if (tp.t >= tp.secs) {
          if (tp.fix) this._send({ t: C.FIX, kind: tp.fix, at: tp.at });
          else this._send({ t: C.DO_TASK, taskId: tp.taskId, step: tp.step });
          M.taskProgress = null;
          this.audio.sfx('pickup');
        }
      }
    }

    if (M.doneFlash) { M.doneFlash.t -= dt; if (M.doneFlash.t <= 0) M.doneFlash = null; }
    this.taskFx?.update(dt);
    this._updateTaskBeacons(dt);
    this._tickNearestPois();
    // the party box, thumping away and pulling people towards it
    if (M.speaker) {
      if (now() > M.speaker.until) {
        M.speaker = null;
        if (M.speakerNode) setHidden(M.speakerNode, true);
        this.audio.playMusic(this._islandTrack());
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
        this.audio.playMusic(this._islandTrack());
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
    // world + avatars
    this.tickIslandWorld(dt);
    this.updateDayNight(dt);
    /* The island after dark is a different game — you cannot see who is
       behind you — so it gets its own track. */
    if (!this.stormOn && !this.jammed && M.view.phase === PHASE.ROAM) {
      const wantNight = (this.night || 0) > 0.55;
      if (wantNight !== this._nightMusic) {
        /* The latch is kept current even aboard, or stepping off after dusk
           finds it stale and the flip never fires again. */
        this._nightMusic = wantNight;
        if (!M.aboard) this.audio.playMusic(this._islandTrack());
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
      if (this.sky) this.sky.material.opacity = 0.03;
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
    this._mpHud(dt);
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
    if (now() < (this.stunnedUntil || 0)) return null;
    if (this.mp.view.settings?.nightOnly && (this.night || 0) <= 0.5) return null;
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
    // room-local coordinates land anywhere, so only tag the ones we can see
    for (const b of M.bodies.values()) if (b.mesh.visible) add(b.mesh, 'BODY', 0xb03a2e, true);
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
  _mpHud(dt = 1 / 60) {
    const M = this.mp;
    const h = this.ui.hud.data;
    // In the lobby and on the results card there is no world behind the
    // panel worth annotating, and a half-drawn HUD leaking out from under
    // a full-screen menu just looks broken.
    /* The death shot runs inside ROAM and puts its own mattes and caption
       up, so the belt and the hearts have to go with the rest of the
       interface — this runs every frame and would otherwise switch the HUD
       straight back on underneath the bars. */
    /* The lift puts its own mattes and captions up and goes with them. */
    if (!M.started || M.view.phase !== PHASE.ROAM || this.deathShot || M.lift) {
      h.visible = false; h.mp = null;
      return;
    }
    h.visible = true;

    const d = M.hudData || (M.hudData = {
      role: null, alive: true, tasksDone: 0, tasksTotal: 0,
      myTasks: [], killIn: 0, killTotal: 1, graceIn: 0, cools: [], sanct: false,
      sabotage: null, task: null, coins: 0,
      belt: [], passives: [],
      tags: [], phase: null, flash: null,
    });

    d.role = M.view.role;
    d.alive = this.amAlive;
    /* Who we are shadowing, if anybody — and the nudge that says the key
       exists, because a ghost with nothing to read assumes it has nothing
       to do. Names only; the HUD does the wording. */
    d.watching = M.spectate ? (M.view.players.get(M.spectate)?.name || '?') : null;
    d.tasksDone = M.view.tasksDone;
    d.tasksTotal = M.view.tasksTotal;
    d.coins = this.coins || 0;
    d.stamina = this.player?.stamina ?? 1;
    /* The scanner panel. One object, reused, because this is written every
       frame and a new one each time is garbage for nothing. */
    if (this.scannerOn) {
      const sc = (d.scanner = d.scanner || { bars: [] });
      sc.on = true;
      sc.t = this.scanT || 0;
      /* The camera yaw, NOT the body yaw. The body lerps toward wherever
         you are walking and does not move at all when you stand still and
         look around — which is why the steer used to lag a fast turn by
         the best part of a second, or not follow it at all. */
      sc.facing = this.player?.yaw ?? this.player?.facing ?? 0;
      // the whole band, so the panel can draw every carrier on it
      sc.bars.length = 0;
      const pool = sc.bars._pool || (sc.bars._pool = []);
      for (const q of (this.scanList || [])) {
        const bar = pool[sc.bars.length] || (pool[sc.bars.length] = {});
        bar.band = q.band; bar.strength = q.strength; bar.kind = q.kind;
        sc.bars.push(bar);
      }
      const L = this.scanLock;
      sc.lock = !!L;
      if (L) {
        sc.kind = L.kind; sc.name = L.name; sc.note = L.note;
        sc.dist = L.dist; sc.shown = L.shown;
        sc.strength = L.strength; sc.band = L.band;
        sc.bearing = L.bearing; sc.spread = L.spread;
        sc.index = L.index; sc.count = L.count;
      }
    } else if (d.scanner) {
      d.scanner.on = false;
    }
    /* The till roll. Handed over by reference — it is a short list and it
       is rebuilt only when something is actually bought. */
    if (this.printerOn && this.hasItem?.('printer')) {
      const pr = (d.printer = d.printer || {});
      pr.on = true;
      pr.list = this.receipts || [];
      pr.at = Math.min(this.receiptAt || 0, Math.max(0, pr.list.length - 1));
      pr.t = (pr.t || 0) + dt;
    } else if (d.printer) d.printer.on = false;
    /* The saucer, and the one machine inside it.

       `ufo.scan` is PRIVATE and it is the only place in this data block that
       carries a role anybody had to be told. It is written only when the
       reading is ours — the host never sends anybody else's — so the HUD may
       print it exactly as it stands, and nothing may put it anywhere else.

         on     a visit is in progress
         left   seconds of it remaining, our own count of the host's duration
         inside we are in the room
         held   we are the one carrying the scanner
         spent  its one scan is gone; the plinth stays empty for this visit
         plate  somebody in the room is standing on the plate
         scan   null, or { name, colour, k 0..1, done, agent }
                while `done` is false it is COMPUTING and `agent` is null. */
    if (M.ufo || M.scan) {
      const uf = (d.ufo = d.ufo || {});
      uf.on = !!M.ufo;
      uf.left = M.ufo ? Math.max(0, M.ufo.until - now()) : 0;
      uf.inside = this.roomId === 5;
      uf.held = !!M.scannerBy && M.scannerBy === M.view.selfId;
      uf.spent = !!M.scannerSpent;
      uf.plate = !!M.plateDown;
      const s = M.scan;
      if (s) {
        const sc = (uf.scan = uf.scan || {});
        sc.name = s.name;
        sc.colour = s.colour;
        sc.k = Math.min(1, s.t / s.secs);
        sc.done = !!s.done;
        sc.agent = s.done ? !!s.agent : null;
      } else uf.scan = null;
    } else d.ufo = null;

    d.phase = M.view.phase;
    d.connection = M.net?.health || null;
    d.nightOnly = !!M.view.settings?.nightOnly && (this.night || 0) <= 0.5;
    d.stunned = now() < (this.stunnedUntil || 0);
    d.flash = M.doneFlash ? M.doneFlash.id : null;

    // what you are carrying, and what is simply true of you
    d.belt = this.beltSlots(d.belt);
    d.passives.length = 0;
    for (const id of (this.owned || [])) {
      const it = itemById(id);
      if (it) d.passives.push(it.icon);
    }

    /* Chores, written into the rows that are already there — and while the
       tools are scattered, in the shuffled order, saying only what the job
       is. The sabotage took the markers, the beacons and the chart jobs
       away and then left the panel printing WIND THE RIDGE, which is the
       label the Agent paid fifty seconds to take away. */
    const ids = (this.scattered && M.scatterOrder) || M.view.tasks;
    d.myTasks.length = ids.length;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = d.myTasks[i] || (d.myTasks[i] = {});
      const stage = this._taskStage(id);
      row.id = id;
      row.name = this.scattered ? (stage.verb || stage.name) : stage.name;
      row.done = M.view.doneTasks.has(id);
      row.half = !row.done && (M.view.taskStep.get(id) || 0) >= 1;
      row.step = M.view.taskStep.get(id) || 0;
      row.steps = taskSteps(id);
    }

    // the knife
    d.killIn = this.amAgent && M.myKillReady ? Math.max(0, M.myKillReady - now()) : 0;
    d.killTotal = M.killTotal || 1;
    d.graceIn = this.amAgent && M.graceEnds ? Math.max(0, M.graceEnds - now()) : 0;
    /* Standing on neutral ground the knife is refused, and the panel used to
       go on reading KNIFE READY over a key that did nothing. */
    d.sanct = this.amAgent && this.amAlive
      && this.inSanctuary(this.player.pos.x, this.player.pos.z);

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
      d.task.holding = !!(M.holdingE || M.holdingClick);
    } else d.task = null;

    this._tags(d.tags);
    h.mp = d;

    this.ui.updateCompass(this.player.yaw, this.player.pos.x, this.player.pos.z);
    this.ui.setStamina(this.player.stamina);
  }
}
