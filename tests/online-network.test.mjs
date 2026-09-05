import test from 'node:test';
import assert from 'node:assert/strict';
import { Net, makeRoomCode, parseRoomCode, roomInviteURL } from '../js/net/net.js';

class Channel {
  constructor(peer = 'guest') { this.peer = peer; this.open = true; this.handlers = new Map(); this.sent = []; }
  on(name, fn) { this.handlers.set(name, fn); }
  emit(name, value) { this.handlers.get(name)?.(value); }
  send(value) { this.sent.push(value); }
  close() { this.open = false; this.emit('close'); }
}
function host() { const net = new Net(); net.isHost = net.open = true; return net; }
function accept(net, id = 'guest') {
  const conn = new Channel(id); net._acceptClient(conn); conn.emit('open'); return conn;
}

test('room codes and shared invites normalize without accepting partial or hostile input', async () => {
  for (const value of ['ab2z', ' AB2Z ', '#ab2z', 'https://example.com/game/?room=ab2z', 'http://localhost:8000/#ab2z']) {
    assert.equal(parseRoomCode(value), 'AB2Z');
  }
  for (const value of ['', null, 'abc', 'abcde', 'AB C', 'AB!?', 'javascript:ABCD', 'file:///ABCD', 'https://example.com/?room=AB']) {
    assert.equal(parseRoomCode(value), '');
  }
  assert.equal(roomInviteURL('ab2z', 'https://example.com/game/?workshop=1&secret=value#old'), 'https://example.com/game/?room=AB2Z');
  assert.equal(roomInviteURL('ABCD', 'file:///game/'), '');
  for (let i = 0; i < 100; i++) assert.match(makeRoomCode(), /^[A-HJ-NP-Z2-9]{4}$/);
  // Validation happens before loading the browser-only networking dependency.
  await assert.rejects(new Net().join('ABC'), /four-character/);
  await assert.rejects(new Net().host('AB C'), /four-character/);
});

test('malformed network messages and unadmitted or retired channels never reach the rules', () => {
  const net = host(), received = [];
  net.onMessage = (...args) => received.push(args);
  const conn = new Channel(); net._acceptClient(conn);
  conn.emit('data', { t: 'c.hello' });
  assert.equal(received.length, 0);
  conn.emit('open');
  for (const raw of [null, [], 4, '{', '{}', { t: 4 }, { t: 'x'.repeat(41) }, ' '.repeat(65537)]) conn.emit('data', raw);
  assert.equal(received.length, 0);
  conn.emit('data', '{"t":"c.hello","name":"GUEST"}');
  assert.deepEqual(received, [[{ t: 'c.hello', name: 'GUEST' }, 'guest']]);
  net.close('guest'); conn.emit('data', { t: 'c.kill' });
  assert.equal(received.length, 1);
  net.destroy();
});

test('a new connection after departure ignores stale data and repeated close events', () => {
  const net = host(), messages = [], leaves = [];
  net.onMessage = msg => messages.push(msg);
  net.onPeerLeave = id => leaves.push(id);
  const old = accept(net);
  old.close();
  const current = accept(net);
  old.emit('data', { t: 'c.move' }); old.emit('close');
  current.emit('data', { t: 'c.hello' });
  assert.deepEqual(messages, [{ t: 'c.hello' }]);
  assert.deepEqual(leaves, ['guest']);
  assert.equal(net.conns.get('guest'), current);
  assert.equal(net.health.peers, 1);
  net.destroy();
});

test('duplicate live channels cannot evict an admitted player in a running round', () => {
  const net = host(), joined = [], messages = [], leaves = [];
  net.onPeerJoin = (id) => {
    joined.push(id);
    // HostSession refuses late joins once the round has started.
    if (joined.length > 1) net.close(id);
  };
  net.onPeerLeave = id => leaves.push(id);
  net.onMessage = msg => messages.push(msg);
  const current = accept(net), duplicate = accept(net);
  assert.equal(duplicate.open, false);
  assert.equal(current.open, true);
  assert.equal(net.conns.get('guest'), current);
  assert.deepEqual(joined, ['guest']);
  current.open = false; // A pending close still owns its one departure callback.
  const earlyReplacement = accept(net);
  assert.equal(earlyReplacement.open, false);
  assert.equal(net.conns.get('guest'), current);
  current.open = true;
  current.emit('open'); // Repeated open must not re-admit the same channel.
  assert.deepEqual(joined, ['guest']);
  duplicate.emit('data', { t: 'c.vote' });
  current.emit('data', { t: 'c.move' });
  assert.deepEqual(messages, [{ t: 'c.move' }]);
  assert.deepEqual(leaves, []);
  net.destroy();
});

test('heartbeat reports latency and stalled links, recovers, and keeps protocol packets private', t => {
  let ms = 1000;
  t.mock.method(performance, 'now', () => ms);
  const net = host(), conn = accept(net), application = [];
  net.onMessage = msg => application.push(msg);
  net._lastHealthTick = ms;
  net._pollHealth();
  const ping = conn.sent.at(-1);
  assert.equal(ping.t, 'n.ping');
  ms += 80; conn.emit('data', { t: 'n.pong', n: ping.n });
  assert.equal(net.health.rtt, 80);
  assert.equal(net.health.state, 'connected');
  ms += 9000; net._pollHealth();
  assert.equal(net.health.state, 'degraded');
  const next = conn.sent.at(-1);
  ms += 20; conn.emit('data', { t: 'n.pong', n: next.n });
  assert.equal(net.health.state, 'connected');
  assert.equal(net.health.rtt, 59);
  conn.emit('data', { t: 'n.ping', n: 42 });
  assert.deepEqual(conn.sent.at(-1), { t: 'n.pong', n: 42 });
  assert.deepEqual(application, []);
  // Sleep on this computer should not falsely report every friend as lost.
  ms += 60000; net._pollHealth();
  assert.equal(net.health.state, 'connected');
  assert.equal(net.conns.size, 1);
  net.destroy();
  assert.deepEqual(net.health, { state: 'closed', rtt: null, peers: 0, broker: 'offline' });
});

test('congested channels discard stale movement while delivering votes and round transitions', () => {
  const net = host(), conn = accept(net);
  conn.dataChannel = { bufferedAmount: 70000 };
  net.broadcast({ t: 's.snap' });
  net._sendPacket(conn, { t: 'c.move' });
  net._sendPacket(conn, { t: 'n.ping' });
  net.broadcast({ t: 's.phase', phase: 'over' });
  net._sendPacket(conn, { t: 'c.vote', targetId: 'skip' });
  assert.deepEqual(conn.sent.map(m => m.t), ['s.phase', 'c.vote']);
  conn.dataChannel.bufferedAmount = 0;
  net.broadcast({ t: 's.snap' });
  assert.equal(conn.sent.at(-1).t, 's.snap');
  net.destroy(); net.broadcast({ t: 's.phase' });
  assert.equal(conn.sent.length, 3);
});

test('host loss terminates the guest transport once and ignores late packets', async t => {
  class Peer extends Channel {
    connect() { return this.channel = new Channel('host'); }
    destroy() { this.destroyed = true; this.channel?.close(); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { Peer } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  const net = new Net(); let gone = 0;
  net.onHostGone = () => gone++;
  net.onMessage = () => assert.fail('late host packet delivered');
  const pending = net.join('ABCD'); await Promise.resolve();
  net.peer.emit('open', 'guest');
  const conn = net.peer.channel; conn.emit('open'); await pending;
  assert.ok(net._heartbeatTimer);
  conn.emit('error', new Error('lost')); conn.emit('close'); conn.emit('data', { t: 's.phase' });
  assert.equal(gone, 1);
  assert.equal(net.closed, true);
  assert.equal(net._heartbeatTimer, null);
  assert.equal(net.peer.destroyed, true);
  assert.equal(net.health.state, 'closed');
});
