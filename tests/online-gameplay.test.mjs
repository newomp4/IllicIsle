import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'three' ? new URL('../vendor/three.module.js', import.meta.url).href : specifier, context);
} });
const THREE = await import('three');
const { MPGame } = await import('../js/mp/mpgame.js');
const { Avatar, resetSnapshotTiming } = await import('../js/mp/avatar.js');
const { MirrorSession } = await import('../js/mp/session.js');
const { Net } = await import('../js/net/net.js');
const { C, S, PHASE, ROLE } = await import('../js/net/protocol.js');
const { Hud } = await import('../js/lib/hud.js');
const { recordText } = await import('../js/lib/bitfont.js');

function canvas() {
  const stack = [];
  const x = new Proxy({ globalAlpha: 1,
    save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
  }, { get(o, k) { return k in o ? o[k] : () => {}; } });
  return { width: 320, height: 224, getContext() { return x; } };
}
globalThis.document = { createElement: canvas, exitPointerLock() {} };

function game() {
  const g = Object.create(MPGame.prototype);
  g.mp = { active: true, view: new MirrorSession(), avatars: new Map(), bodies: new Map(),
    chat: [], drops: [], cool: {} };
  g.mp.view.selfId = 'self';
  g.mp.view.phase = PHASE.ROAM;
  g.mp.view.role = ROLE.CASTAWAY;
  g.mp.view.players.set('self', { id: 'self', name: 'SELF', alive: true });
  g.state = 'island';
  g.input = {};
  g._movementKeys = new Set();
  g.screens = { name: null, open: false, held: new Set(),
    clearHeld() { this.held.clear(); },
    clear() { this.open = false; this.name = null; },
    replace(name, data) { this.open = true; this.name = name; return (this.top = { ...data, name }); },
  };
  g.player = { pos: new THREE.Vector3(), playThrow() {}, punch() {} };
  g.audio = { sfx() {}, resume() {}, playMusic() {} };
  g.ui = { toast() {}, showPopup() {}, clearToasts() {}, hud: { data: {} } };
  g.pipeline = { tint: new THREE.Color(), tintAmt: 0 };
  g.islandScene = g.scene = new THREE.Scene();
  g.propMats = { opaque: new THREE.MeshBasicMaterial() };
  g.tickers = [];
  g.spawn = { x: 1000, z: 1000 };
  g._send = (msg) => g.sent.push(msg);
  g.sent = [];
  g._requestLock = () => {};
  return g;
}
function avatar() {
  resetSnapshotTiming();
  return new Avatar(new THREE.Scene(), { opaque: new THREE.MeshBasicMaterial() },
    { id: 'peer', name: 'PEER', colour: 'red', alive: true });
}

test('remote players stay hidden until their first valid position', () => {
  const g = game(), av = avatar();
  assert.equal(av.mesh.visible, false);
  assert.equal(g._avatarVisible(av), false);
  av.push(1, 12, 2, 14, 0, 0, 0);
  assert.equal(g._avatarVisible(av), true);
  assert.deepEqual(av.mesh.position.toArray(), [12, 2, 14]);
  av.dispose();
});

test('interior changes and council teleports reset remote interpolation', () => {
  const av = avatar();
  av.push(1, 180, 8, 92, .5, 0, 0);
  av.push(1.04, 180.5, 8, 92, .5, 0, 0);
  av.push(1.08, 0, 0, 2, Math.PI, 0, 1);
  av.update(.016, 1.16);
  assert.equal(av.buf.length, 1);
  assert.deepEqual(av.pos.toArray(), [0, 0, 2]);
  assert.equal(av.speed, 0);
  av.push(1.12, 130, 8, 110, 0, 0, 0);
  av.push(1.16, 80, 8, 110, 0, 0, 0);
  assert.deepEqual(av.pos.toArray(), [80, 8, 110]);
  assert.equal(av.buf.length, 1);
  av.dispose();
});

test('malformed and out-of-order positions do not poison the remote model', () => {
  const av = avatar();
  av.push(2, 1, 2, 3, 0, 0, 0);
  av.push(1, 500, 2, 3, 0, 0, 0);
  av.push(3, NaN, 2, 3, 0, 0, 0);
  av.push(3, 1, 2, 3, Infinity, 0, 0);
  assert.equal(av.buf.length, 1);
  av.update(.016, 3);
  assert.deepEqual(av.pos.toArray(), [1, 2, 3]);
  av.dispose();
});

test('remote outlines and target rings follow their body into the same room', () => {
  const av = avatar(), room = new THREE.Scene();
  av.setShell('mark');
  assert.equal(av.shell.visible, false);
  assert.equal(av.shellRing.visible, false);
  av.setScene(room);
  for (const node of [av.mesh, av.shell, av.shellRing]) assert.equal(node.parent, room);
  av.setVisible(true);
  assert.equal(av.shell.visible, true);
  av.dispose();
  assert.equal(room.children.length, 0);
});

test('all interiors offer nearby bodies before furniture interactions', () => {
  for (const [state, room] of [['bunker', 1], ['highroller', 2], ['bar', 3], ['cab', 4], ['ufo', 5]]) {
    const g = game(); g.state = state;
    g.mp.bodies.set('victim', { id: 'victim', name: 'VICTIM', room,
      mesh: { position: new THREE.Vector3(.5, 0, 0) } });
    assert.equal(g.nearestInteractable()?.kind, 'mpReport', state);
  }
});

test('purses remain in their room and cannot be picked up from another room', () => {
  const g = game();
  g._onDrop(0, 2, 0, 14, 'victim', 'purse-1', 2);
  g._onDrop(0, 2, 0, 14, 'victim', 'purse-1', 2);
  assert.equal(g.mp.drops.length, 1, 'duplicate packets must not duplicate purses');
  const drop = g.mp.drops[0];
  assert.equal(drop.mesh.visible, false);
  assert.equal(drop.y, 2, 'an interior uses its floor, not the terrain height');
  g._takePurse(drop);
  assert.equal(g.sent.length, 0);
  g.state = 'highroller'; g.scene = new THREE.Scene();
  g._rehomeAvatars();
  assert.equal(drop.mesh.parent, g.scene);
  assert.equal(drop.mesh.visible, true);
  assert.equal(g.nearestInteractable()?.kind, 'purse');
  g._takePurse(drop);
  assert.deepEqual(g.sent[0], { t: C.TAKEDROP, did: 'purse-1' });
});

test('the shop sanctuary does not extend into an unrelated room coordinate space', () => {
  const g = game(); g.hutPos = { x: 0, z: 0 };
  assert.equal(g.inSanctuary(0, 0), true);
  g.state = 'bunker';
  assert.equal(g.inSanctuary(0, 0), false);
});

test('stunned players cannot dig, consume inventory, or buy items', () => {
  const g = game();
  g.stunnedUntil = performance.now() / 1000 + 5;
  g.mp.holdingE = true;
  g.buried = { x: 0, y: 0, z: 0, state: { dug: 0, taken: false }, digging: 0, sent: 0 };
  g.carry = ['nightfall']; g.coins = 900;
  g._tickDig(.5);
  assert.equal(g.sent.length, 0);
  assert.equal(g.buried.digging, 0);
  assert.equal(g.useItem('nightfall'), false);
  assert.deepEqual(g.carry, ['nightfall']);
  assert.equal(g.buyItem('vest'), false);
  assert.equal(g.coins, 900);
});

test('outdoor items are kept on the belt when used inside any interior', () => {
  for (const state of ['bunker', 'bar', 'cab', 'highroller', 'ufo']) {
    const g = game(); g.state = state; g.carry = ['speaker', 'skeleton'];
    assert.equal(g.useItem('speaker'), false);
    assert.equal(g.useItem('skeleton'), false);
    assert.deepEqual(g.carry, ['speaker', 'skeleton']);
    assert.equal(g.sent.length, 0);
  }
});

test('gambling refunds survive council interruption but cannot credit dead players', () => {
  const g = game(); g.coins = 5;
  g.mp.view.phase = PHASE.COUNCIL;
  g.bjSettle(10);
  assert.equal(g.coins, 15);
  assert.deepEqual(g.sent[0], { t: C.PURSE, coins: 15 });
  g.me.alive = false;
  g.bjSettle(10); g.dartsSettle(10); g.settleSlot(null, 120);
  assert.equal(g.coins, 15);
  assert.equal(g.sent.length, 1);
});

test('flare events freeze and clear the victim work immediately', () => {
  const g = game(); g.mp.taskProgress = { t: 2, secs: 3 };
  g.input.fwd = true; g.mp.holdingE = true;
  g._onShot('peer', 'self', { x: 0, z: 0, room: 0 }, 10);
  assert.ok(g.stunnedUntil > performance.now() / 1000);
  assert.equal(g.mp.taskProgress, null);
  assert.equal(g.input.fwd, false);
  assert.equal(g.mp.holdingE, false);
});

test('a local death closes an obsolete shop and updates life state immediately', () => {
  const g = game();
  g.screens.replace('mpShop', {});
  g._beginDeathShot = () => {};
  g._onKilled('self', 0, 2, 0, 0);
  assert.equal(g.amAlive, false);
  assert.equal(g.screens.open, false);
  assert.ok(g.mp.bodies.has('self'));
  g.mp.bodies.get('self').dispose();
});

test('a departed snap voter loses the voting overlay without freezing gameplay', () => {
  const g = game();
  g.mp.snap = { voters: ['self', 'peer'], mine: null };
  g.screens.replace('mpSnap', {});
  g._onSnapTally(1, 0, 1, ['peer']);
  assert.deepEqual(g.mp.snap.voters, ['peer']);
  assert.equal(g.screens.open, false);
});

test('new round controls discard stale tasks, snap votes, notices and room cooldowns', () => {
  const g = game();
  g.mp.taskProgress = { t: 3 }; g.mp.snap = {}; g.mp.spectate = 'peer';
  g.mp.bodyCardUntil = 99; g.mp.aboard = true; g.mp.holdingClick = true;
  g._cabCooldown = true; g.ui.hud.data.popup = {};
  g._resetRoundControls();
  for (const key of ['taskProgress', 'snap', 'spectate']) assert.equal(g.mp[key], null);
  assert.equal(g.mp.bodyCardUntil, 0);
  assert.equal(g.mp.aboard, false);
  assert.equal(g.mp.holdingClick, false);
  assert.equal(g._cabCooldown, false);
  assert.equal(g.ui.hud.data.popup, null);
});

test('host and guest game controllers clear the same mirror state for a rematch', () => {
  for (const host of [true, false]) {
    const g = game(), view = g.mp.view;
    let phaseCallbacks = 0;
    view.hooks.onPhase = () => { phaseCallbacks++; };
    Object.assign(view, { role: ROLE.AGENT, tasks: ['crate'], mates: ['PEER'],
      over: { winner: 'agents' }, tasksDone: 8, tasksTotal: 9, bodies: [{}] });
    view.doneTasks.add('crate'); view.taskStep.set('crate', 1);
    g.me.alive = false; g.me.room = 4;
    g._resetUfoClient = g._clearSabotageWorld = g._clearBodies = g.leaveRoom = () => {};
    g.ui.hide = () => {};
    if (!host) view.handle({ t: S.PHASE, phase: PHASE.LOBBY, endsAt: 0 });
    g._phase(PHASE.LOBBY, 0);
    assert.equal(view.role, null);
    assert.equal(view.over, null);
    assert.equal(view.mates, null);
    assert.deepEqual(view.tasks, []);
    assert.equal(view.doneTasks.size, 0);
    assert.equal(view.taskStep.size, 0);
    assert.equal(view.tasksDone, 0);
    assert.equal(view.tasksTotal, 0);
    assert.equal(g.me.alive, true);
    assert.equal(g.me.room, 0);
    assert.equal(g.screens.name, 'mpLobby');
    assert.equal(phaseCallbacks, host ? 0 : 1, 'view state application must not fire the phase callback twice');
  }
});

test('host and guest game controllers expose the same final result', () => {
  for (const host of [true, false]) {
    const g = game();
    let callbacks = 0;
    g.audio.stopMusic = () => {};
    g.mp.view.hooks.onOver = () => { callbacks++; };
    const packet = { t: S.OVER, winner: 'castaways', agents: ['peer'], reason: 'ALL WORK COMPLETE' };
    if (!host) g.mp.view.handle(packet);
    g._onOver(packet.winner, packet.agents, packet.reason);
    assert.deepEqual(g.mp.view.over, packet);
    assert.equal(g.mp.finished, true);
    assert.equal(g.screens.name, 'mpEnd');
    assert.equal(callbacks, host ? 0 : 1);
  }
});

test('delayed council cleanup cannot erase bodies from a later round', (t) => {
  const pending = [];
  t.mock.method(globalThis, 'setTimeout', (fn) => { pending.push(fn); });
  const g = game();
  g.mp.view.players.set('victim', { name: 'VICTIM' });
  let cleared = 0;
  g._clearBodies = () => { cleared++; };
  g._onCouncil('self', 'victim');
  g._runGen = 1;
  pending.forEach((fn) => fn());
  assert.equal(cleared, 0);
});

test('puzzle completions carry a step and never submit after council begins', () => {
  const g = game();
  g.mp.view.taskStep.set('repair', 1);
  g.finishMinigame('repair');
  assert.deepEqual(g.sent[0], { t: C.DO_TASK, taskId: 'repair', step: 1 });
  g.mp.view.phase = PHASE.COUNCIL;
  g.finishMinigame('repair');
  assert.equal(g.sent.length, 1);
});

test('completed ghost work shows its world effect without creating a phantom wallet', () => {
  const g = game(); g.me.alive = false; g.coins = 0;
  g._namedSite = () => ({ x: 0, z: 0 });
  g._taskWorldFx = g._compassForTasks = () => {};
  let effect;
  g.taskFx = { burst(...args) { effect = args; } };
  g._taskDone('crate', false, 0);
  assert.ok(effect.slice(0, 3).every(Number.isFinite), 'landmarks without a y still render their effect');
  assert.equal(g.coins, 0);
  assert.ok(!g.sent.some((m) => m.t === C.PURSE));
});

test('legacy game and rematch entry points always offer online play', () => {
  for (const method of ['beginGame', 'startGame', 'playAgain']) {
    const g = game(); g.mp.active = false;
    g[method]();
    assert.equal(g.screens.name, 'mpMenu', method);
  }
});

test('workshop cheats require a local host and an explicit development opt-in', async (t) => {
  t.mock.method(Net.prototype, 'host', async () => {});
  t.mock.method(globalThis, 'setInterval', () => 0);
  const before = globalThis.location;
  t.after(() => { if (before) globalThis.location = before; else delete globalThis.location; });
  for (const [hostname, search, allowed] of [
    ['localhost', '', false], ['example.com', '?workshop=1', false],
    ['localhost', '?workshop=1', true], ['127.0.0.1', '?workshop=1', true],
  ]) {
    globalThis.location = { hostname, search };
    const g = game(); g.mp.active = false;
    g._startNetTimer = () => {};
    await g.hostGame('TEST', '7226');
    assert.equal(g.mp.dev, allowed, hostname + search);
    assert.equal(!!g.mp.host.dev, allowed);
    g.cancelConnect();
  }
});

function capture(fn) {
  const boxes = recordText(true);
  try { fn(); } finally { recordText(false); }
  return boxes;
}
function readable(boxes, w, h) {
  for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, b.t);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
      `overlap: ${a.t} / ${b.t}`);
  }
}
test('network health and changing purse labels never cover other HUD text', () => {
  for (const [w, h] of [[240, 180], [320, 224], [640, 360]]) {
    const hud = new Hud(); hud.setSize(w, h);
    Object.assign(hud.data, { visible: true, prompt: 'F   ELIMINATE OTHER', mp: {
      role: 'agent', alive: true, myTasks: [], tasksTotal: 30, tasksDone: 6,
      stamina: .7, coins: 10, belt: [], passives: [], cools: [], killIn: 0,
    } });
    for (const [state, rtt, coins] of [['connected', 45, 10], ['degraded', 999, 98], ['closed', null, 2]]) {
      hud.data.mp.coins = coins;
      hud.data.mp.connection = { state, rtt };
      const boxes = capture(() => hud.render(0));
      readable(boxes, w, h);
      assert.ok(boxes.some((b) => b.t === 'F  ELIMINATE OTHER'));
      assert.ok(!boxes.some((b) => b.t.startsWith('E  F')));
    }
  }
});
