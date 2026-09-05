import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Use the same bundled engine as the browser import map, without installing
// dependencies or constructing a renderer for state/controller regressions.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') {
      return { url: new URL('../vendor/three.module.js', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const THREE = await import('three');
const { Game } = await import('../js/game.js');
const { Player } = await import('../js/entities/player.js');
const { MPGame } = await import('../js/mp/mpgame.js');
const { HostSession } = await import('../js/mp/session.js');
const { Net } = await import('../js/net/net.js');
const { PHASE, ROLE } = await import('../js/net/protocol.js');

function inputGame(proto = Game.prototype) {
  const g = Object.create(proto);
  g.state = 'island';
  g.input = {};
  g._movementKeys = new Set();
  g.audio = { resume() {}, sfx() {}, playMusic() {} };
  g.screens = {
    open: false, held: new Set(), clearHeld() { this.held.clear(); },
    setHeld(k, down) { if (down) this.held.add(k); else this.held.delete(k); },
    clear() {},
  };
  return g;
}
function key(code, extra = {}) {
  return { code, repeat: false, preventDefault() { this.prevented = true; }, ...extra };
}
function playerIn(scene = new THREE.Scene()) {
  return new Player(scene, { opaque: new THREE.MeshBasicMaterial() }, new THREE.PerspectiveCamera());
}
function browserGlobal(t, name, value) {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (before) Object.defineProperty(globalThis, name, before);
    else delete globalThis[name];
  });
}

test('movement aliases remain active until the last physical key is released', () => {
  const g = inputGame();
  g._key(key('KeyW'), true);
  g._key(key('ArrowUp'), true);
  g._key(key('KeyW'), false);
  assert.equal(g.input.fwd, true);
  g._key(key('ArrowUp'), false);
  assert.equal(g.input.fwd, false);
  g._key(key('ShiftLeft'), true);
  g._key(key('ShiftRight'), true);
  g._key(key('ShiftLeft'), false);
  assert.equal(g.input.sprint, true);
  g._clearHeldInput();
  assert.equal(g.input.sprint, false);
  assert.equal(g._movementKeys.size, 0);
});

test('browser shortcuts do not move, skip scenes or consume multiplayer items', () => {
  const g = inputGame();
  g._key(key('KeyW', { metaKey: true }), true);
  assert.ok(!g.input.fwd);
  g.state = 'cutscene';
  g._skipCutsceneInput = () => assert.fail('shortcut skipped a scene');
  g._key(key('KeyR', { ctrlKey: true }), true);
  const m = inputGame(MPGame.prototype);
  m.mp = { active: true };
  m.useBeltSlot = () => assert.fail('browser tab shortcut spent an item');
  m._key(key('Digit1', { metaKey: true }), true);
});

test('saved settings reject corrupt values and unknown fields while preserving valid choices', (t) => {
  browserGlobal(t, 'localStorage', {
    getItem: () => JSON.stringify({ res: -2, sens: 'fast', dayLen: 0, audio: 'false',
      invert: true, density: 1.45, walk: 'plain', surprise: 99 }),
  });
  const g = inputGame();
  g.settings = { res: 224, sens: 1.4, audio: true, dayLen: 360 };
  g.loadSettings();
  assert.deepEqual(g.settings, { res: 224, sens: 1.4, audio: true, dayLen: 360,
    invert: true, density: 1.45, walk: 'plain' });
});

test('teleport immediately moves the model and clears swimming/landing offsets', () => {
  const p = playerIn();
  p.inWater = 1;
  p.landSquash = 1;
  p.vel.set(3, -5, 7);
  p.teleport(10, 5, 20, Math.PI);
  assert.deepEqual(p.mesh.position.toArray(), [10, 5, 20]);
  assert.equal(p.mesh.rotation.y, Math.PI);
  assert.equal(p.inWater, 0);
  assert.equal(p.landSquash, 0);
  assert.equal(p.vel.length(), 0);
});

test('a player exactly at a collider centre is pushed out without NaN', () => {
  const p = playerIn();
  p.teleport(0, 0, 0);
  p.setColliders([{ x: 0, z: 0, r: 1 }]);
  p.update(0, {}, { groundOf: () => 0, water: false, bounds: false });
  assert.ok(Math.hypot(p.pos.x, p.pos.z) >= 1 + p.RADIUS - 1e-9);
  assert.ok(p.pos.toArray().every(Number.isFinite));
});

test('new runs restore interrupted coin animations and depleted coconut caches', () => {
  const g = inputGame();
  const coin = new THREE.Group();
  coin.userData = { flourish: true, baseY: 3 };
  coin.scale.setScalar(0.1);
  coin.position.set(4, 8, 6);
  coin.visible = false;
  g.syncoins = [{ x: 4, z: 6, taken: true, mesh: coin }];
  g.coinFx = [{ mesh: coin, t: 0.6 }];
  g.coconutPiles = [{ cooldown: 22, mesh: { visible: false } }];
  g.templeCaches = [{ cooldown: 12, mesh: { visible: false } }];
  g.resetPickups();
  assert.equal(g.coinFx.length, 0);
  assert.equal(g.syncoins[0].taken, false);
  assert.equal(coin.visible, true);
  assert.equal(coin.userData.flourish, false);
  assert.deepEqual(coin.position.toArray(), [4, 3, 6]);
  assert.deepEqual(coin.scale.toArray(), [1, 1, 1]);
  assert.ok([...g.coconutPiles, ...g.templeCaches].every((p) => p.cooldown === 0 && p.mesh.visible));
});

test('a full story restart restores the boss seal, idol and player equipment', () => {
  const g = inputGame();
  g.islandScene = new THREE.Scene();
  g.player = playerIn();
  g.player.frozen = true;
  g.player.staminaLock = true;
  g.player.invuln = 4;
  g.player.insideBox = {};
  g.pipeline = { fade: 0, tintAmt: 1 };
  g.spawn = { x: 10, y: 2, z: 20 };
  g.colliders = [];
  g.found = new Set([1, 2, 3, 4]);
  g.relics = new Set(['syncoin']);
  g.bought = new Set(['boots']);
  g.interactables = g.pendulumMeshes = g.coconuts = [];
  g.templeDoor = { userData: { setOpen() {} } };
  g.templeSeal = { seal: { visible: false }, bars: [{ visible: false }] };
  g.sanctumIdol = new THREE.Group();
  g.sanctumIdol.scale.setScalar(1.6);
  let disposed = false;
  g.hector = { dispose() { disposed = true; } };
  g.cams = [false, true].map((fitted) => ({
    fitted, placed: true, pan: 3, tilt: 1, zoom: 4,
    node: { visible: true, userData: { head: { rotation: { x: 1, y: 3 } } } },
  }));
  g.camsHeld = 4;
  g._refreshCompass = g.updateSockets = g.playIntro = () => {};
  g.startGame();
  assert.equal(disposed, true);
  assert.equal(g.hector, null);
  assert.equal(g.templeSeal.seal.visible, true);
  assert.equal(g.templeSeal.bars[0].visible, true);
  assert.equal(g.sanctumIdol.scale.x, 1.3);
  assert.equal(g.player.mesh.parent, g.islandScene);
  assert.equal(g.player.frozen, false);
  assert.equal(g.player.staminaLock, false);
  assert.equal(g.player.invuln, 0);
  assert.equal(g.player.insideBox, null);
  assert.equal(g.bought.size, 0);
  assert.equal(g.camsHeld, 0);
  assert.equal(g.cams[0].placed, false);
  assert.equal(g.cams[0].node.visible, false);
  assert.equal(g.cams[1].placed, true);
  assert.equal(g.cams[1].zoom, 1);
});

test('delayed story callbacks cannot open screens in a later run', (t) => {
  const pending = [];
  t.mock.method(globalThis, 'setTimeout', (fn) => { pending.push(fn); });
  const g = inputGame();
  let fired = 0;
  g._runLater(() => { fired++; }, 900);
  g._runGen = 1;
  g._runLater(() => { fired++; }, 900);
  pending.forEach((fn) => fn());
  assert.equal(fired, 1);
});

test('respawning from a room restores the island scene, collision and camera', (t) => {
  browserGlobal(t, 'document', {});
  const g = inputGame();
  g.islandScene = new THREE.Scene();
  g.templeScene = new THREE.Scene();
  const cabin = new THREE.Scene();
  g.scene = g.deathScene = cabin;
  g.player = playerIn(cabin);
  g.camera = g.player.camera;
  cabin.add(g.camera);
  g.player.hp = 0;
  g.player.frozen = true;
  g.player.insideBox = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
  g.player.staminaLock = true;
  g.colliders = [{ x: 10, z: 10, r: 2 }];
  g.spawn = { x: 20, y: 3, z: 30 };
  g.pipeline = { fade: 0, tintAmt: 0.7 };
  g.ui = { show() {} };
  g.coconuts = [{ mesh: new THREE.Group() }];
  g.coconutCount = 0;
  g._refreshCompass = g._requestLock = () => {};
  g.respawn();
  assert.equal(g.state, 'island');
  assert.equal(g.scene, g.islandScene);
  assert.equal(g.player.mesh.parent, g.islandScene);
  assert.equal(g.camera.parent, g.islandScene);
  assert.equal(g.player.colliders, g.colliders);
  assert.equal(g.player.insideBox, null);
  assert.equal(g.player.frozen, false);
  assert.equal(g.player.staminaLock, false);
  assert.equal(g.player.hp, g.player.maxHp);
  assert.equal(g.coconuts.length, 0);
  assert.equal(g.pipeline.fade, 1);
});

function hostWithPlayers() {
  const messages = [];
  const h = new HostSession({ broadcast: (m) => messages.push(m), sendTo() {} });
  for (const id of ['host', 'alice', 'bob', 'carol']) {
    const p = h._add(id, id);
    p.role = id === 'host' ? ROLE.AGENT : ROLE.CASTAWAY;
  }
  h.phase = PHASE.COUNCIL;
  h.messages = messages;
  return h;
}

test('disconnecting a council target releases ballots so voters can choose again', () => {
  const h = hostWithPlayers();
  h.votes.set('host', 'alice');
  h.votes.set('bob', 'alice');
  h.votes.set('carol', 'skip');
  h._leave('alice');
  assert.equal(h.phase, PHASE.COUNCIL);
  assert.equal(h.votes.has('host'), false);
  assert.equal(h.votes.has('bob'), false);
  assert.equal(h.votes.get('carol'), 'skip');
  h._tryVote('host', 'bob');
  assert.equal(h.votes.get('host'), 'bob');
});

test('vote tally treats peer IDs as data, including JavaScript property names', () => {
  const h = hostWithPlayers();
  h._add('__proto__', 'OTHER').role = ROLE.CASTAWAY;
  h.votes.set('host', '__proto__');
  h._broadcastVotes();
  const packet = h.messages.at(-1);
  assert.equal(packet.counts.__proto__, 1);
  assert.equal(JSON.parse(JSON.stringify(packet)).counts.__proto__, 1);
});

test('council result uses the current phase deadline and preserves kill grace', () => {
  const h = hostWithPlayers();
  h._tickStranger = h._tickUfo = () => {};
  h.votes.set('host', 'skip');
  h._resolveVote();
  assert.equal(h.phase, PHASE.RESULT);
  h._resolveVote();
  assert.equal(h.messages.filter((m) => m.t === 's.exile').length, 1);
  h.graceEnds = performance.now() / 1000 + 100;
  h.update(0.2);
  assert.equal(h.phase, PHASE.RESULT);
  h.phaseEnds = performance.now() / 1000 - 1;
  h.update(0.2);
  assert.equal(h.phase, PHASE.ROAM);
  assert.equal(h.players.get('host').killReady, h.graceEnds);
});

test('cancelling during the PeerJS load prevents a late peer from being created', async (t) => {
  let created = 0;
  browserGlobal(t, 'window', { Peer: class { constructor() { created++; } } });
  for (const mode of ['host', 'join']) {
    const net = new Net();
    const pending = net[mode]('ABCD');
    net.destroy();
    await assert.rejects(pending, /cancelled/i);
  }
  assert.equal(created, 0);
});

test('destroy rejects pending host/join immediately and ignores late open events', async (t) => {
  class Peer {
    constructor() { this.handlers = new Map(); }
    on(name, fn) { this.handlers.set(name, fn); }
    destroy() { this.destroyed = true; }
  }
  browserGlobal(t, 'window', { Peer });
  for (const mode of ['host', 'join']) {
    const net = new Net();
    const pending = net[mode]('ABCD');
    await Promise.resolve();
    net.destroy();
    await assert.rejects(pending, /cancelled/i);
    net.peer.handlers.get('open')('late-peer');
    assert.equal(net.open, false);
    assert.equal(net.peer.destroyed, true);
    assert.equal(net.hostConn, null);
  }
});

test('a canceled multiplayer attempt cannot activate or destroy a newer attempt', async (t) => {
  const waiting = [];
  t.mock.method(Net.prototype, 'join', function () {
    return new Promise((resolve) => waiting.push(resolve));
  });
  const g = inputGame(MPGame.prototype);
  g.mp = { chat: [], active: false };
  g._notice = () => assert.fail('stale network callbacks reached the UI');
  g._startNetTimer = () => {};
  const first = g.joinGame('ONE', 'AAAA');
  const oldNet = g.mp.net;
  g.cancelConnect();
  const second = g.joinGame('TWO', 'BBBB');
  const newNet = g.mp.net;
  oldNet.onStatus('LATE STATUS');
  oldNet.onHostGone();
  waiting[0]();
  await assert.rejects(first, /cancelled/i);
  assert.equal(g.mp.net, newNet);
  assert.equal(g.mp.active, false);
  waiting[1]();
  await second;
  assert.equal(g.mp.active, true);
  assert.equal(newNet.closed, false);
});

test('a channel closed during joining fails the attempt without announcing a finished game', async (t) => {
  class Channel {
    constructor() { this.handlers = new Map(); }
    on(name, fn) { this.handlers.set(name, fn); }
  }
  class Peer extends Channel {
    connect() { return (this.channel = new Channel()); }
    destroy() {}
  }
  browserGlobal(t, 'window', { Peer });
  const net = new Net();
  net.onHostGone = () => assert.fail('a joining player has no game to end');
  const pending = net.join('ABCD');
  await Promise.resolve();
  net.peer.handlers.get('open')('joining-player');
  net.peer.channel.handlers.get('close')();
  await assert.rejects(pending, /host closed/i);
  assert.equal(net.closed, true);
});
