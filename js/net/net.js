/* ===========================================================
   net.js — peer-to-peer transport for Illic Isle: Castaways.

   The game is a static page on GitHub Pages, so there is no
   server to run authoritative logic on. Instead one player is
   the HOST: their browser owns the truth (roles, tasks, kills,
   votes) and every other client is thin — it sends inputs and
   renders what the host tells it.

   WebRTC gives us direct data channels between browsers. The only
   thing we need a server for is the initial handshake, and PeerJS's
   public broker does that for free. After the handshake, traffic
   goes peer to peer and never touches it again.

   Topology is a star, not a mesh: everyone connects to the host
   only. With 3-10 players that's far fewer connections than a mesh
   and it makes the host the natural authority.
   =========================================================== */

const BROKER_PREFIX = 'illicisle-';       // namespaces our room codes on the shared broker
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1
const PING = 'n.ping', PONG = 'n.pong';
const HEARTBEAT_MS = 2500, SLOW_AFTER_MS = 8000;
const clock = () => performance.now();

/** Read a code or a shared invite without guessing around invalid characters. */
export function parseRoomCode(value) {
  const text = String(value ?? '').trim();
  if (/^[a-z0-9]{4}$/i.test(text)) return text.toUpperCase();
  if (/^#[a-z0-9]{4}$/i.test(text)) return text.slice(1).toUpperCase();
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const code = url.searchParams.get('room') || url.hash.slice(1);
    return /^[a-z0-9]{4}$/i.test(code) ? code.toUpperCase() : '';
  } catch { return ''; }
}

export function roomInviteURL(room, base = globalThis.location?.href) {
  const code = parseRoomCode(room);
  if (!code) return '';
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    // Carry the room only. Workshop/debug flags belong to the host's browser.
    url.search = ''; url.hash = '';
    url.searchParams.set('room', code);
    return url.href;
  } catch { return ''; }
}

export function makeRoomCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ROOM_ALPHABET[(Math.random() * ROOM_ALPHABET.length) | 0];
  }
  return s;
}

/** Load the vendored PeerJS bundle once, on demand. */
let peerLibPromise = null;
function loadPeerLib() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLibPromise) return peerLibPromise;
  /* A wifi handoff, a waking laptop or a captive portal makes this one fetch
     fail, and a cached rejection then re-rejects every later HOST or JOIN for
     the life of the page — the player retries, gets the same instant error
     seconds after the network came back, and only a reload helps. Forget the
     failure so the next press builds a fresh <script> and really refetches.
     A stalled request is the same dead end from the other side: it fires
     neither handler, and the menu swallows every key while it is busy, so
     give up on the same 15s the join timeout uses. */
  const p = peerLibPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    let done = false;
    const fail = (m) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Ours only — a late failure must not wipe a newer load already in flight.
      if (peerLibPromise === p) peerLibPromise = null;
      s.remove();
      rej(new Error(m));
    };
    const timer = setTimeout(() => fail('Could not load vendor/peerjs.min.js'), 15000);
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => {
      if (done) return;
      if (window.Peer) { done = true; clearTimeout(timer); res(window.Peer); }
      else fail('PeerJS did not register');
    };
    s.onerror = () => fail('Could not load vendor/peerjs.min.js');
    document.head.appendChild(s);
  });
  return p;
}

/**
 * A star network with one host.
 *
 * Events (set as properties):
 *   onStatus(text)          human-readable connection state
 *   onOpen(id)              our peer is live
 *   onError(err)
 *   onPeerJoin(peerId)      host only
 *   onPeerLeave(peerId)     host only
 *   onMessage(msg, fromId)  a decoded message arrived
 *   onHostGone()            client only, the host vanished
 */
export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.room = null;
    this.selfId = null;          // our logical player id ('host' or peer id)
    this.conns = new Map();      // host: peerId -> DataConnection
    this.hostConn = null;        // client: connection to the host
    this.open = false;
    this.closed = false;

    this.onStatus = null;
    this.onOpen = null;
    this.onError = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onMessage = null;
    this.onHostGone = null;

    this._sendBudget = 0;
    this.health = { state: 'connecting', rtt: null, peers: 0, broker: 'connecting' };
    this.onHealth = null;
    this._links = new WeakMap();
    this._heartbeatTimer = null;
  }

  _status(t) { this.onStatus?.(t); }

  _watch(conn) {
    let link = this._links.get(conn);
    if (!link) {
      link = { seen: clock(), sent: 0, nonce: 0, pending: null, rtt: null };
      this._links.set(conn, link);
    }
    return link;
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) return;
    this._lastHealthTick = clock();
    this._heartbeatTimer = setInterval(() => this._pollHealth(), HEARTBEAT_MS);
    this._heartbeatTimer.unref?.();
    this._refreshHealth();
  }

  _refreshHealth(t = clock()) {
    const links = this.isHost ? [...this.conns.values()] : (this.hostConn ? [this.hostConn] : []);
    let slow = false, worst = null;
    for (const conn of links) {
      const link = this._watch(conn);
      slow ||= t - link.seen > SLOW_AFTER_MS || link.rtt > 450;
      if (link.rtt !== null) worst = Math.max(worst || 0, Math.round(link.rtt));
    }
    const state = this.closed || !this.open ? (this.closed ? 'closed' : 'connecting')
      : slow ? 'degraded' : 'connected';
    const changed = this.health.state !== state || this.health.rtt !== worst || this.health.peers !== links.length;
    Object.assign(this.health, { state, rtt: worst, peers: links.length });
    if (changed) this.onHealth?.(this.health);
  }

  _pollHealth(t = clock()) {
    if (this.closed) return;
    const links = this.isHost ? [...this.conns.values()] : (this.hostConn ? [this.hostConn] : []);
    // Waking the local computer is not evidence that a friend disconnected.
    const woke = t - this._lastHealthTick > SLOW_AFTER_MS * 2;
    this._lastHealthTick = t;
    for (const conn of links) {
      const link = this._watch(conn);
      if (woke) { link.seen = t; link.pending = null; }
      if (link.pending === null || t - link.sent > SLOW_AFTER_MS) {
        link.nonce = (link.nonce + 1) % 0x7fffffff;
        link.sent = t;
        link.pending = link.nonce;
        if (!this._sendPacket(conn, { t: PING, n: link.nonce })) link.pending = null;
      }
    }
    this._refreshHealth(t);
  }

  _receive(conn, raw, from) {
    if (this.closed) return;
    const msg = decode(raw);
    if (!msg) return;
    const link = this._watch(conn);
    const t = clock();
    link.seen = t;
    if (msg.t === PING) {
      if (Number.isSafeInteger(msg.n) && msg.n >= 0) this._sendPacket(conn, { t: PONG, n: msg.n });
      return;
    }
    if (msg.t === PONG) {
      if (link.pending !== null && msg.n === link.pending) {
        const sample = Math.max(0, t - link.sent);
        link.rtt = link.rtt === null ? sample : link.rtt * 0.65 + sample * 0.35;
        link.pending = null;
        this._refreshHealth(t);
      }
      return;
    }
    this.onMessage?.(msg, from);
  }

  _sendPacket(conn, msg) {
    if (this.closed || !conn || conn.open === false) return false;
    // Old positions are disposable. Queuing them behind a stalled channel
    // makes everyone replay seconds of movement after the network recovers.
    const replaceable = msg.t === 'c.move' || msg.t === 's.snap' || msg.t === PING;
    if (replaceable && ((conn.dataChannel?.bufferedAmount || 0) > 65536 || (conn.bufferSize || 0) > 2)) return false;
    try { conn.send(encode(msg)); return true; }
    catch { return false; }
  }

  /* ---------------------------------------------------------
     HOST
     --------------------------------------------------------- */
  async host(room) {
    room = parseRoomCode(room);
    if (!room) throw new Error('Enter a four-character room code.');
    const Peer = await loadPeerLib();
    if (this.closed) throw new Error('Connection cancelled.');
    this.isHost = true;
    this.room = room;
    this.selfId = 'host';

    this._status('OPENING ROOM');
    // Claiming the room id itself means clients can reach us knowing only
    // the code — no lobby list, no server of ours.
    this.peer = new Peer(BROKER_PREFIX + room, { debug: 0 });

    return new Promise((resolve, reject) => {
      let settled = false;
      // A broker that accepts the socket and then never answers fires neither
      // 'error' nor 'open', and the connect screen swallows every key while it
      // is busy — so without a watchdog the player sits on OPENING ROOM with no
      // message and no way out. join() has had one all along; match it.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.destroy();
        reject(new Error('The matchmaking broker did not answer.'));
      }, 15000);
      this._cancelPending = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Connection cancelled.'));
      };
      const fail = (e) => {
        if (this.closed || settled) return;
        settled = true;
        clearTimeout(timer);
        const taken = e && (e.type === 'unavailable-id');
        // Nothing will ever use this peer again, and a broker that fails us
        // before 'open' otherwise leaves a socket and a reconnect backoff alive.
        this.destroy();
        reject(new Error(taken
          ? 'That room code is already in use. Try another.'
          : (e?.message || 'Could not reach the matchmaking broker.')));
      };
      this.peer.on('error', (e) => {
        if (!this.open) fail(e);
        else this.onError?.(e);
      });
      // The broker socket can drop under us — sleep/wake, a wifi handoff, the
      // free broker restarting. PeerJS reacts by releasing our room id and
      // firing 'disconnected'; the existing data channels survive, so the round
      // carries on and nothing on screen changes while the code we read out to
      // our friends quietly stops resolving. Nothing reclaims the id unless we
      // ask, and asking too eagerly loops, so back off and eventually give up
      // honestly rather than hammering a dead network.
      let backoff = 1000;
      this.peer.on('disconnected', () => {
        if (this.closed) return;             // destroy() is tearing us down on purpose
        this.health.broker = 'reconnecting';
        if (backoff > 16000) { this.health.broker = 'offline'; this._status('ROOM CODE LOST - RESTART TO REOPEN'); return; }
        this._status('BROKER DROPPED - RECONNECTING');
        const wait = backoff;
        backoff *= 2;
        setTimeout(() => {
          if (this.closed) return;
          try { this.peer.reconnect(); } catch (e) { this._status('ROOM CODE LOST - RESTART TO REOPEN'); }
        }, wait);
      });
      this.peer.on('open', () => {
        if (this.closed) return;
        clearTimeout(timer);
        settled = true;
        this._cancelPending = null;
        this.open = true;
        this.health.broker = 'online';
        this._startHeartbeat();
        backoff = 1000;                      // a successful reconnect re-fires 'open'
        this._status('ROOM OPEN');
        this.onOpen?.('host');
        resolve(room);
      });
      this.peer.on('connection', (conn) => this._acceptClient(conn));
    });
  }

  _acceptClient(conn) {
    /* 'host' is our own sentinel id, and a peer picks its own broker id. The
       session refuses one that claimed it, but only from 'open' — by then the
       channel is wired and anything sent in the same burst arrives at the
       session tagged as the host, moving and killing with the host's record.
       Refuse before a listener exists so there is no window at all. */
    if (this.closed || conn.peer === 'host') {
      try { conn.close(); } catch (e) { /* already gone */ }
      return;
    }
    conn.on('open', () => {
      if (this.closed) { conn.close(); return; }
      const previous = this.conns.get(conn.peer);
      // One live channel per player. Replacing it would close their only
      // admitted link, then make the round reject the replacement as a late
      // join, leaving a seated player with no way to send or receive.
      if (previous) {
        if (previous !== conn) {
          try { conn.close(); } catch { /* already gone */ }
        }
        return;
      }
      this.conns.set(conn.peer, conn);
      this._watch(conn);
      this._refreshHealth();
      this.onPeerJoin?.(conn.peer);
    });
    conn.on('data', (raw) => {
      if (this.closed) return;
      const current = this.conns.get(conn.peer);
      if (current !== conn) return;
      this._receive(conn, raw, conn.peer);
    });
    const bye = () => {
      if (this.closed) return;               // we are the ones leaving; nobody left us
      if (this.conns.get(conn.peer) !== conn) return;
      if (this.conns.delete(conn.peer)) this.onPeerLeave?.(conn.peer);
      this._refreshHealth();
    };
    conn.on('close', bye);
    conn.on('error', bye);
  }

  /* ---------------------------------------------------------
     CLIENT
     --------------------------------------------------------- */
  async join(room) {
    room = parseRoomCode(room);
    if (!room) throw new Error('Enter a four-character room code.');
    const Peer = await loadPeerLib();
    if (this.closed) throw new Error('Connection cancelled.');
    this.isHost = false;
    this.room = room;

    this._status('CONTACTING BROKER');
    this.peer = new Peer({ debug: 0 });

    return new Promise((resolve, reject) => {
      let settled = false;
      const giveUp = (m) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // A wrong code or a silent room used to leave the Peer, its broker
        // socket and its ping loop alive for the life of the page, and a
        // connection that opened after we gave up would still register with
        // the host as a player that never says hello. Tearing the peer down
        // is the only thing that stops both.
        this.destroy();
        reject(new Error(m));
      };
      const timer = setTimeout(() => giveUp('No answer from that room. Check the code.'), 15000);
      this._cancelPending = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Connection cancelled.'));
      };

      this.peer.on('error', (e) => {
        if (!settled) {
          clearTimeout(timer);
          giveUp(e?.type === 'peer-unavailable'
            ? 'No room with that code is open right now.'
            : (e?.message || 'Could not reach the matchmaking broker.'));
        } else this.onError?.(e);
      });

      this.peer.on('open', (id) => {
        if (this.closed || settled || this.hostConn) return;
        this.selfId = id;
        this._status('DIALLING HOST');
        const conn = this.peer.connect(BROKER_PREFIX + room, {
          reliable: true, serialization: 'json',
        });
        this.hostConn = conn;

        conn.on('open', () => {
          if (this.closed || settled) return;
          clearTimeout(timer);
          settled = true;
          this._cancelPending = null;
          this.open = true;
          this.health.broker = 'online';
          this._watch(conn);
          this._startHeartbeat();
          this._status('CONNECTED');
          this.onOpen?.(id);
          resolve(id);
        });
        conn.on('data', (raw) => {
          if (this.closed) return;
          this._receive(conn, raw, 'host');
        });
        // destroy() closes this channel itself, and that close is us quitting,
        // not the host vanishing — announcing it would slam a results card over
        // the title screen the player just asked for.
        const hostGone = () => {
          if (this.closed) return;
          if (!settled) { giveUp('The host closed the connection.'); return; }
          this.destroy();
          this.onHostGone?.();
        };
        conn.on('close', hostGone);
        conn.on('error', hostGone);
      });
    });
  }

  /* ---------------------------------------------------------
     SEND
     --------------------------------------------------------- */
  /** Host -> everyone. */
  broadcast(msg, exceptId) {
    if (!this.isHost) return;
    for (const [id, c] of this.conns) {
      if (id === exceptId) continue;
      this._sendPacket(c, msg);
    }
  }

  /** Host -> one client. */
  sendTo(peerId, msg) {
    const c = this.conns.get(peerId);
    if (!c) return;
    this._sendPacket(c, msg);
  }

  /** Client -> host. */
  sendHost(msg) {
    if (this.isHost || !this.hostConn) return;
    this._sendPacket(this.hostConn, msg);
  }

  /** Either direction, whichever applies. */
  send(msg) {
    if (this.isHost) this.broadcast(msg);
    else this.sendHost(msg);
  }

  /**
   * Host -> drop one client for good, the way a refused joiner should be.
   * A kicked peer used to keep its channel and go on receiving every
   * snapshot, chat and reveal for the rest of the round. The map entry goes
   * first so no further broadcast can reach them, and so the real 'close'
   * event does not announce a leave for someone who never joined.
   */
  close(peerId) {
    const c = this.conns.get(peerId);
    if (!c) return;
    this.conns.delete(peerId);
    this._refreshHealth();
    try { c.close({ flush: true }); } catch (e) { try { c.close(); } catch (e2) { /* already gone */ } }
  }

  get peerCount() { return this.isHost ? this.conns.size : (this.open ? 1 : 0); }

  destroy() {
    this.closed = true;
    this.open = false;
    clearInterval(this._heartbeatTimer); this._heartbeatTimer = null;
    Object.assign(this.health, { state: 'closed', rtt: null, peers: 0, broker: 'offline' });
    const cancel = this._cancelPending;
    this._cancelPending = null;
    cancel?.();
    try { this.peer?.destroy(); } catch (e) { /* already gone */ }
    this.conns.clear();
    this.hostConn = null;
  }
}

/* ===========================================================
   WIRE FORMAT
   ===========================================================
   PeerJS json serialization already handles structured data, so
   this stays a thin seam: somewhere to add compression later
   without touching call sites.
   =========================================================== */
function encode(msg) { return msg; }

function decode(raw) {
  if (typeof raw === 'string') {
    if (raw.length > 65536) return null;
    try { raw = JSON.parse(raw); } catch (e) { return null; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    && typeof raw.t === 'string' && raw.t.length <= 40 ? raw : null;
}
