import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') {
      return { url: new URL('../vendor/three.module.js', import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { HostSession, MirrorSession } = await import('../js/mp/session.js');
const { taskStage, taskSteps, SABOTAGE_DEFS } = await import('../js/mp/tasks.js');
const { C, S, PHASE, ROLE } = await import('../js/net/protocol.js');
const { UFO_PLATE } = await import('../js/world/ufo.js');
const blackjack = await import('../js/mp/blackjack.js');

function host(t, count = 5) {
  let seconds = 100;
  t.mock.method(performance, 'now', () => seconds * 1000);
  const messages = [], direct = [], hooks = [];
  const sites = { camp: { x: 0, z: 0 }, bell: { x: 0, z: 0 }, hut: { x: 100, z: 0 },
    buried: { x: 50, z: 50 }, tasha: { x: 15, z: 0 }, pend1: { x: 20, z: 0 },
    pend2: { x: 40, z: 0 }, vend1: { x: 60, z: 0 }, vend2: { x: 80, z: 0 } };
  const h = new HostSession({ broadcast: (m) => messages.push(structuredClone(m)),
    sendTo: (id, m) => direct.push({ id, ...structuredClone(m) }), close() {} }, {
    siteOf: (key) => sites[key], isNight: () => true,
    onChat: (m) => hooks.push(m),
  });
  for (const id of ['host', 'alice', 'bob', 'carol', 'dave'].slice(0, count)) {
    const p = h._add(id, id);
    p.role = id === 'host' ? ROLE.AGENT : ROLE.CASTAWAY;
  }
  h.phase = PHASE.ROAM;
  return { h, messages, direct, hooks, sites, advance: (n) => { seconds += n; } };
}

test('the host ignores malformed messages and invalid rooms without corrupting positions', (t) => {
  const { h } = host(t);
  for (const msg of [null, undefined, 1, [], {}, { t: 'unknown' }]) {
    assert.doesNotThrow(() => h._recv(msg, 'alice'));
  }
  const p = h.players.get('alice');
  h._recv({ t: C.MOVE, x: 5, y: 2, z: 3, room: 2 }, p.id);
  h._recv({ t: C.MOVE, x: NaN, y: Infinity, z: 'far', room: 99 }, p.id);
  assert.deepEqual([p.x, p.y, p.z, p.room], [5, 2, 3, 2]);
});

test('role dealing keeps a crew majority and sends roles only to their owners', (t) => {
  const { h, messages, direct } = host(t);
  h.phase = PHASE.LOBBY;
  h.settings.agents = 9;
  assert.equal(h.start(), true);
  assert.equal([...h.players.values()].filter((p) => p.role === ROLE.AGENT).length, 2);
  assert.equal(messages.some((m) => m.t === S.ROLE), false);
  assert.equal(direct.filter((m) => m.t === S.ROLE).length, 4);
  assert.ok(h.tasksTotal > 0);
});

test('a full lobby still welcomes a player whose HELLO was already admitted', (t) => {
  const { h, direct } = host(t);
  t.mock.method(globalThis, 'setTimeout', () => 0);
  h.phase = PHASE.LOBBY;
  for (let i = 0; i < 5; i++) h._add('extra' + i, 'EXTRA');
  h._join('extra4');
  assert.equal(direct.at(-1).t, S.WELCOME);
  h._join('eleventh');
  assert.equal(direct.at(-1).t, S.KICK);
  assert.equal(h.players.size, 10);
});

test('returning to the lobby clears round state while retaining the same roster', (t) => {
  const { h } = host(t);
  const p = h.players.get('alice');
  Object.assign(p, { alive: false, room: 3, coins: 150, killReady: 500, digCredit: 0.8 });
  h.phaseEnds = 500; h.graceEnds = 600; h.chaffUntil = 700;
  h.votes.set('host', 'alice'); h.council = { calledBy: 'host' };
  h.stranger = { x: 10, z: 20 }; h.tasksDone = 3; h.tasksTotal = 5;
  h.toLobby();
  assert.equal(h.players.size, 5);
  assert.equal(h.phase, PHASE.LOBBY);
  assert.equal(h.phaseEnds, 0);
  assert.equal(h.graceEnds, 0);
  assert.equal(h.chaffUntil, 0);
  assert.equal(h.votes.size, 0);
  assert.equal(h.council, null);
  assert.equal(h.stranger, null);
  assert.deepEqual([p.alive, p.room, p.coins, p.killReady, p.digCredit], [true, 0, 0, 0, 0]);
  assert.equal(h.start(), true);
  assert.equal(h.phase, PHASE.REVEAL);
});

test('task stages end at the end of their chain, so each final world effect latches', (t) => {
  const { h, messages } = host(t);
  assert.equal(taskStage('fire', 1), undefined);
  assert.equal(taskStage('tasha', 3), undefined);
  assert.equal(taskStage('tasha', -1), undefined);
  const p = h.players.get('alice');
  p.tasks = ['fire'];
  h._recv({ t: C.DO_TASK, taskId: 'fire', step: 0 }, p.id);
  assert.equal(h.tasksDone, 1);
  assert.deepEqual(messages.find((m) => m.t === S.WORLDFX), { t: S.WORLDFX, at: 'camp', last: true });
});

test('a repeated stage completion cannot skip the next minigame at the same site', (t) => {
  const { h, messages } = host(t);
  const p = h.players.get('alice'); p.tasks = ['tasha']; p.x = 15;
  const first = { t: C.DO_TASK, taskId: 'tasha', step: 0 };
  h._recv(first, p.id); h._recv(first, p.id);
  assert.equal(h.tasksDone, 1);
  assert.equal(p.step.tasha, 1);
  h._recv({ ...first, step: 1 }, p.id);
  assert.equal(h.tasksDone, 2);
  assert.deepEqual(messages.filter((m) => m.t === S.WORLDFX).map((m) => m.last), [false, true]);
  p.x = 40;
  h._recv({ ...first, step: 2 }, p.id);
  assert.equal(h.tasksDone, taskSteps('tasha'));
  assert.equal(p.doneTasks.has('tasha'), true);
  assert.equal(messages.filter((m) => m.t === S.WORLDFX).at(-1).last, true);
});

test('ghosts can finish assigned work, but interiors cannot complete island chores', (t) => {
  const { h } = host(t);
  const p = h.players.get('alice'); p.tasks = ['fire']; p.alive = false; p.room = 1;
  h._tryTask(p.id, 'fire', 0);
  assert.equal(h.tasksDone, 0);
  p.room = 0;
  h._tryTask(p.id, 'fire', 0);
  assert.equal(h.tasksDone, 1);
});

test('repairs require a valid distinct island site, free movement and the roam phase', (t) => {
  const { h, messages } = host(t);
  const p = h.players.get('alice'); p.x = 20;
  h._trySabotage('host', 'jam');
  p.room = 1; h._tryFix(p.id, 'jam', 'pend1');
  p.room = 0; p.stunnedUntil = 101; h._tryFix(p.id, 'jam', 'pend1');
  p.stunnedUntil = 0; h._tryFix(p.id, 'jam', 'invented');
  h.phase = PHASE.COUNCIL; h._tryFix(p.id, 'jam', 'pend1');
  assert.equal(h.sabotage.sites.size, 0);
  h.phase = PHASE.ROAM;
  h._tryFix(p.id, 'jam', 'pend1'); h._tryFix(p.id, 'jam', 'pend1');
  assert.equal(messages.filter((m) => m.t === S.FIXPROGRESS).length, 1);
  p.x = 40; h._tryFix(p.id, 'jam', 'pend2');
  assert.equal(h.sabotage, null);
  assert.equal(h.cool.jam, 100 + SABOTAGE_DEFS.jam.cooldown);
});

test('digging validates location and uses elapsed time rather than packet count', (t) => {
  const { h, advance } = host(t);
  const p = h.players.get('alice');
  h._dig(p.id, { secs: 0.4 });
  assert.ok(!h.dug);
  p.x = p.z = 50; p.room = 1;
  h._dig(p.id, { secs: 0.4 });
  assert.ok(!h.dug);
  p.room = 0;
  for (let i = 0; i < 100; i++) h._dig(p.id, { secs: 0.4 });
  assert.ok(h.dug > 0 && h.dug < 0.1);
  for (let i = 0; i < 16; i++) { advance(0.25); h._dig(p.id, { secs: 0.25 }); }
  assert.equal(h.dug, 1);
});

test('chest opening requires proximity and free movement and pays only once', (t) => {
  const { h, messages } = host(t);
  h.dug = 1;
  const p = h.players.get('alice');
  h._openChest(p.id); assert.ok(!h.chestTaken);
  p.x = p.z = 50; p.stunnedUntil = 101;
  h._openChest(p.id); assert.ok(!h.chestTaken);
  p.stunnedUntil = 0; h.phase = PHASE.COUNCIL;
  h._openChest(p.id); assert.ok(!h.chestTaken);
  h.phase = PHASE.ROAM;
  h._openChest(p.id); h._openChest(p.id);
  assert.equal(messages.filter((m) => m.t === S.CHEST).length, 1);
  assert.ok(p.coins >= 20 && p.coins <= 40);
});

test('vending never turns malformed requests into a pull of machine zero', (t) => {
  const { h, messages } = host(t);
  const p = h.players.get('alice'); p.x = 60;
  for (const index of [undefined, '0', -1, 2, NaN, 0.5]) h._vend(p.id, { index });
  p.room = 1; h._vend(p.id, { index: 0 });
  assert.equal(messages.filter((m) => m.t === S.VEND).length, 0);
  p.room = 0; h._vend(p.id, { index: 0 }); h._vend(p.id, { index: 0 });
  assert.equal(messages.filter((m) => m.t === S.VEND).length, 1);
});

test('a whetstone never shortens the agreed opening protection', (t) => {
  const { h, advance } = host(t);
  const k = h.players.get('host'), v = h.players.get('alice');
  h.graceEnds = 220; k.killReady = 220;
  h._recv({ t: C.PERK, perk: 'whetstone', on: true }, k.id);
  assert.equal(k.killReady, 220);
  k.killReady = 0; h._tryKill(k.id, v.id);
  assert.equal(v.alive, true);
  advance(121); h._tryKill(k.id, v.id);
  assert.equal(v.alive, false);
});

test('shop sanctuary applies outdoors and purses remember the room where they fell', (t) => {
  const { h, messages, sites } = host(t);
  sites.hut = { x: 0, z: 0 };
  const k = h.players.get('host'), v = h.players.get('alice'); v.coins = 20;
  h._tryKill(k.id, v.id); assert.equal(v.alive, true);
  k.room = v.room = 2;
  h._tryKill(k.id, v.id); assert.equal(v.alive, false);
  const d = messages.find((m) => m.t === S.DROP);
  assert.equal(d.room, 2);
  const collector = h.players.get('bob');
  h._takeDrop(collector.id, d.did);
  assert.equal(h.drops[0].taken, false);
  collector.room = 2; h._takeDrop(collector.id, d.did); h._takeDrop(collector.id, d.did);
  assert.equal(messages.filter((m) => m.t === S.DROPGONE).length, 1);
});

test('stunned players cannot trigger a meeting or fire another flare, and self shots fail', (t) => {
  const { h, messages, direct } = host(t);
  const p = h.players.get('alice'); p.stunnedUntil = 101;
  h._tryReport(p.id, null); h._tryShoot(p.id, 'bob');
  assert.equal(h.phase, PHASE.ROAM);
  assert.equal(direct.at(-1).why, 'YOU ARE STUNNED');
  p.stunnedUntil = 0; h._tryShoot(p.id, p.id);
  assert.equal(direct.at(-1).why, 'NOT A TARGET');
  assert.equal(messages.filter((m) => m.t === S.SHOT).length, 0);
});

test('a departed flare witness releases their vote and updates the required majority', (t) => {
  const { h, messages } = host(t);
  h._tryShoot('alice', 'bob');
  h._trySnap('carol', true);
  h._leave('carol');
  assert.equal(h.snap.yes.size, 0);
  assert.deepEqual(h.snap.voters, ['host', 'alice', 'dave']);
  const tally = messages.filter((m) => m.t === S.SNAPTALLY).at(-1);
  assert.equal(tally.need, 2);
  assert.deepEqual(tally.voters, h.snap.voters);
  h._trySnap('alice', true); h._trySnap('dave', true);
  assert.equal(h.players.get('bob').alive, false);
  assert.equal(h.snap, null);
});

test('a snap vote cancels and releases the subject when fewer than two witnesses remain', (t) => {
  const { h, messages } = host(t);
  h.players.get('dave').x = 100;
  h.players.get('carol').x = 100;
  h._tryShoot('alice', 'bob');
  h._leave('alice');
  assert.equal(h.snap, null);
  assert.equal(h.players.get('bob').stunnedUntil, 0);
  assert.equal(messages.filter((m) => m.t === S.SNAPDONE).at(-1).exiled, false);
});

test('killing a snap subject cancels the vote without a second exile', (t) => {
  const { h, messages } = host(t);
  h._tryShoot('alice', 'bob');
  h._tryKill('host', 'bob');
  assert.equal(h.snap, null);
  assert.equal(messages.filter((m) => m.t === S.SNAPDONE).at(-1).exiled, false);
  assert.equal(h.bodies.filter((b) => b.id === 'bob').length, 1);
});

test('dead witnesses cannot cast flare ballots and a rejected vote releases its stun immediately', (t) => {
  const { h } = host(t);
  h._tryShoot('alice', 'bob');
  h.players.get('carol').alive = false;
  h._trySnap('carol', true);
  assert.equal(h.snap.yes.size, 0);
  h._pruneSnap();
  h._trySnap('host', false); h._trySnap('alice', false);
  assert.equal(h.snap, null);
  assert.equal(h.players.get('bob').stunnedUntil, 0);
});

test('a fatal sabotage closes active visitors and snap votes before ending the round', (t) => {
  const { h, messages } = host(t);
  h._startUfo(); h.stranger = { x: 5, z: 5, endsAt: 200, sentAt: 100 };
  h._tryShoot('alice', 'bob'); h._trySabotage('host', 'jam');
  h.sabotage.endsAt = 99;
  h.update(0);
  assert.equal(h.phase, PHASE.OVER);
  assert.equal(h.ufo, null); assert.equal(h.stranger, null); assert.equal(h.snap, null);
  const over = messages.findIndex((m) => m.t === S.OVER);
  assert.ok(messages.findIndex((m) => m.t === S.UFO && !m.on) < over);
  assert.ok(messages.findIndex((m) => m.t === S.SNAPDONE) < over);
  h.update(10);
  assert.equal(messages.filter((m) => m.t === S.OVER).length, 1);
});

test('an ordinary win closes pending snap votes as well as sabotage effects', (t) => {
  const { h, messages } = host(t);
  h._tryShoot('alice', 'bob'); h._trySabotage('host', 'storm');
  h.tasksDone = h.tasksTotal = 1;
  assert.equal(h._checkWin(), true);
  assert.equal(h.snap, null); assert.equal(h.sabotage, null);
  assert.equal(h.over.winner, 'castaways');
  assert.equal(messages.filter((m) => m.t === S.SNAPDONE).length, 1);
});

test('the bunker ledger refuses ghosts, other phases and active remote interference', (t) => {
  const { h, direct, advance } = host(t);
  const p = h.players.get('alice'); p.room = 1;
  p.alive = false; h._sendLedger(p.id);
  p.alive = true; h.phase = PHASE.COUNCIL; h._sendLedger(p.id);
  h.phase = PHASE.ROAM;
  h._recv({ t: C.PERK, perk: 'chaff', on: true }, 'host'); h._sendLedger(p.id);
  assert.equal(direct.filter((m) => m.t === S.LEDGER).length, 0);
  advance(61); h._sendLedger(p.id); h._sendLedger(p.id);
  assert.equal(direct.filter((m) => m.t === S.LEDGER).length, 1);
});

test('dead or stunned players cannot activate shared perks, and purse totals remain finite', (t) => {
  const { h, messages } = host(t);
  const p = h.players.get('alice'); p.alive = false;
  h._recv({ t: C.PERK, perk: 'nightfall', on: true }, p.id);
  p.alive = true; p.stunnedUntil = 101;
  h._recv({ t: C.PERK, perk: 'nightfall', on: true }, p.id);
  p.coins = 10; h._recv({ t: C.PURSE, coins: Infinity }, p.id);
  assert.equal(p.coins, 10);
  assert.equal(messages.filter((m) => m.t === S.NIGHTFALL).length, 0);
  h._recv({ t: C.PURSE, coins: 25.8 }, p.id);
  assert.equal(p.coins, 25);
});

test('meeting interruptions can refund a living player’s gambling stake without leaking into a rematch', (t) => {
  const { h } = host(t);
  const p = h.players.get('alice'); p.coins = 5;
  h.phase = PHASE.COUNCIL;
  h._recv({ t: C.PURSE, coins: 25 }, p.id);
  assert.equal(p.coins, 25);
  h.toLobby();
  h._recv({ t: C.PURSE, coins: 25 }, p.id);
  assert.equal(p.coins, 0);
});

test('receipt printers receive only real open-counter items from nearby living buyers', (t) => {
  const { h, direct } = host(t);
  h.players.get('bob').printer = true;
  const p = h.players.get('alice');
  h._receipt(p.id, { id: 'lantern', price: 5 });
  p.x = 100;
  h._receipt(p.id, { id: 'invented', price: 5 });
  h._receipt(p.id, { id: 'whetstone', price: 18 });
  h._receipt(p.id, { id: 'lantern', price: 5 });
  assert.equal(direct.filter((m) => m.t === S.RECEIPT).length, 1);
});

test('ghost chat remains private and chat bursts do not overwhelm the council', (t) => {
  const { h, messages, direct, advance } = host(t);
  h.players.get('alice').alive = false; h.players.get('bob').alive = false;
  h._chat('alice', 'THE KILLER WAS HERE');
  assert.deepEqual(direct.filter((m) => m.t === S.CHAT).map((m) => m.id), ['alice', 'bob']);
  assert.equal(messages.some((m) => m.t === S.CHAT), false);
  h.phase = PHASE.COUNCIL;
  h._chat('carol', 'HELLO'); h._chat('carol', 'HELLO AGAIN');
  assert.equal(messages.filter((m) => m.t === S.CHAT).length, 1);
  advance(0.7); h._chat('carol', 'I WAS AT CAMP');
  assert.equal(messages.filter((m) => m.t === S.CHAT).length, 2);
});

test('the scanner requires reaching the plinth and cannot be used while stunned', (t) => {
  const { h, direct } = host(t);
  h._startUfo();
  const p = h.players.get('alice'), q = h.players.get('bob');
  p.room = q.room = 5; p.x = 8;
  q.x = UFO_PLATE.x; q.z = UFO_PLATE.z;
  h._takeScanner(p.id); assert.equal(h.scannerBy, null);
  p.x = 0; h._takeScanner(p.id); assert.equal(h.scannerBy, p.id);
  q.x = q.z = 1; p.stunnedUntil = 101;
  h._tryScan(p.id, q.id); assert.equal(h.scannerSpent, false);
  p.stunnedUntil = 0; h._tryScan(p.id, q.id);
  assert.equal(h.scannerSpent, true);
  assert.deepEqual(direct.filter((m) => m.t === S.SCANRESULT).map((m) => m.id), [p.id]);
});

test('players inside unrelated rooms do not stop the Stranger outside', (t) => {
  const { h } = host(t);
  for (const p of h.players.values()) p.room = 2;
  h.stranger = { x: 0, z: 0, head: 0, endsAt: 200, sentAt: 100 };
  h._tickStranger(0.1);
  assert.ok(Math.hypot(h.stranger.x, h.stranger.z) > 2);
});

test('mirror room changes snap to the new space and death messages update life immediately', () => {
  const m = new MirrorSession();
  m.handle({ t: S.ROSTER, players: [{ id: 'alice', alive: true }] });
  m.handle({ t: S.SNAPSHOT, p: [['alice', 100, 0, 100, 0, 0, 1, 0]] });
  m.handle({ t: S.SNAPSHOT, p: [['alice', 1, 0, 2, 1, 0, 1, 3]] });
  assert.deepEqual([m.players.get('alice').x, m.players.get('alice').z, m.players.get('alice').room], [1, 2, 3]);
  const killed = { t: S.KILLED, victimId: 'alice', x: 1, y: 0, z: 2, room: 3 };
  m.handle(killed); m.handle(killed);
  assert.equal(m.players.get('alice').alive, false);
  assert.equal(m.bodies.length, 1);
});

test('mirror rematches discard role, task, meeting and scanner state but preserve identity/settings', () => {
  const m = new MirrorSession();
  m.selfId = 'alice'; m.settings.killCooldown = 60;
  m.role = ROLE.AGENT; m.tasks = ['fire']; m.doneTasks.add('fire'); m.taskStep.set('tasha', 1);
  m.over = { winner: 'agents' }; m.scannerBy = 'alice'; m.scannerSpent = true;
  m.tasksDone = 5; m.tasksTotal = 10; m.bodies = [{ id: 'bob' }]; m.ufo = {};
  m.handle({ t: S.PHASE, phase: PHASE.LOBBY, endsAt: 0 });
  assert.equal(m.role, null); assert.equal(m.over, null); assert.equal(m.scannerBy, null);
  assert.equal(m.scannerSpent, false); assert.equal(m.ufo, null);
  assert.equal(m.tasks.length, 0); assert.equal(m.doneTasks.size, 0); assert.equal(m.taskStep.size, 0);
  assert.equal(m.tasksDone, 0); assert.equal(m.bodies.length, 0);
  assert.equal(m.selfId, 'alice'); assert.equal(m.settings.killCooldown, 60);
});

test('mirror hooks preserve the host action metadata guests need', () => {
  const called = {};
  const m = new MirrorSession(Object.fromEntries(['onDrop', 'onDropGone', 'onCooldown',
    'onFixProgress', 'onSnapTally', 'onSabotage'].map((k) => [k, (...v) => { called[k] = v; }])));
  m.handle({ t: S.DROP, x: 1, y: 2, z: 3, coins: 5, id: 'bob', did: 'd2', room: 3 });
  m.handle({ t: S.DROPGONE, did: 'd2', byId: 'alice' });
  m.handle({ t: S.COOLDOWN, secs: 40, grace: 70 });
  m.handle({ t: S.FIXPROGRESS, kind: 'jam', done: 1, need: 2, at: 'pend1' });
  m.handle({ t: S.SNAPTALLY, yes: 1, no: 0, need: 2, voters: ['alice', 'bob'] });
  m.handle({ t: S.SABOTAGE, kind: 'jam', secs: 100, fatal: true, sites: 2, half: 'WEST' });
  assert.deepEqual(called.onDrop, [1, 2, 3, 5, 'bob', 'd2', 3]);
  assert.deepEqual(called.onDropGone, ['d2', 'alice']);
  assert.deepEqual(called.onCooldown, [40, 70]);
  assert.deepEqual(called.onFixProgress, ['jam', 1, 2, 'pend1']);
  assert.deepEqual(called.onSnapTally, [1, 0, 2, ['alice', 'bob']]);
  assert.deepEqual(called.onSabotage, ['jam', 100, true, 2, 'WEST']);
});

const cards = (...ranks) => ranks.map((r) => ({ r, s: 'S' }));

test('a dealer natural beats split and multi-card 21 but pushes a player natural', () => {
  for (const [ranks, split, pays] of [[['A', 'K'], false, 10], [['A', 'K'], true, 0], [['7', '7', '7'], false, 0]]) {
    const st = { phase: 'dealer', dealer: cards('A', 'K'),
      hands: [{ cards: cards(...ranks), bet: 10, split }], shoe: [] };
    blackjack.dealerStep(st);
    assert.equal(blackjack.payout(st), pays);
  }
});

test('a dealer blackjack ends the initial deal before double or split can spend more money', () => {
  const shoe = [...cards(...Array(24).fill('2')), ...cards('K', 'A', '8', '8')];
  const st = blackjack.deal({ bet: 10, shoe });
  assert.equal(st.phase, 'dealer');
  assert.equal(blackjack.canDouble(st), false);
  assert.equal(blackjack.canSplit(st), false);
  blackjack.double(st); blackjack.split(st); blackjack.hit(st); blackjack.stand(st);
  assert.equal(blackjack.staked(st), 10);
  blackjack.dealerStep(st);
  assert.equal(blackjack.payout(st), 0);
});
