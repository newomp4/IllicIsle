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
   only. With 4-10 players that's far fewer connections than a mesh
   and it makes the host the natural authority.
   =========================================================== */

const BROKER_PREFIX = 'illicisle-';       // namespaces our room codes on the shared broker
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1

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
  }

  _status(t) { this.onStatus?.(t); }

  /* ---------------------------------------------------------
     HOST
     --------------------------------------------------------- */
  async host(room) {
    const Peer = await loadPeerLib();
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
        if (backoff > 16000) { this._status('ROOM CODE LOST - RESTART TO REOPEN'); return; }
        this._status('BROKER DROPPED - RECONNECTING');
        const wait = backoff;
        backoff *= 2;
        setTimeout(() => {
          if (this.closed) return;
          try { this.peer.reconnect(); } catch (e) { this._status('ROOM CODE LOST - RESTART TO REOPEN'); }
        }, wait);
      });
      this.peer.on('open', () => {
        clearTimeout(timer);
        settled = true;
        this.open = true;
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
    if (conn.peer === 'host') {
      try { conn.close(); } catch (e) { /* already gone */ }
      return;
    }
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.onPeerJoin?.(conn.peer);
    });
    conn.on('data', (raw) => {
      const msg = decode(raw);
      if (msg) this.onMessage?.(msg, conn.peer);
    });
    const bye = () => {
      if (this.closed) return;               // we are the ones leaving; nobody left us
      if (this.conns.delete(conn.peer)) this.onPeerLeave?.(conn.peer);
    };
    conn.on('close', bye);
    conn.on('error', bye);
  }

  /* ---------------------------------------------------------
     CLIENT
     --------------------------------------------------------- */
  async join(room) {
    const Peer = await loadPeerLib();
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

      this.peer.on('error', (e) => {
        if (!settled) {
          clearTimeout(timer);
          giveUp(e?.type === 'peer-unavailable'
            ? 'No room with that code is open right now.'
            : (e?.message || 'Could not reach the matchmaking broker.'));
        } else this.onError?.(e);
      });

      this.peer.on('open', (id) => {
        this.selfId = id;
        this._status('DIALLING HOST');
        const conn = this.peer.connect(BROKER_PREFIX + room, {
          reliable: true, serialization: 'json',
        });
        this.hostConn = conn;

        conn.on('open', () => {
          clearTimeout(timer);
          settled = true;
          this.open = true;
          this._status('CONNECTED');
          this.onOpen?.(id);
          resolve(id);
        });
        conn.on('data', (raw) => {
          const msg = decode(raw);
          if (msg) this.onMessage?.(msg, 'host');
        });
        // destroy() closes this channel itself, and that close is us quitting,
        // not the host vanishing — announcing it would slam a results card over
        // the title screen the player just asked for.
        conn.on('close', () => { if (this.closed) return; this.open = false; this.onHostGone?.(); });
        conn.on('error', () => { if (!settled) giveUp('Could not open a channel to the host.'); });
      });
    });
  }

  /* ---------------------------------------------------------
     SEND
     --------------------------------------------------------- */
  /** Host -> everyone. */
  broadcast(msg, exceptId) {
    if (!this.isHost) return;
    const raw = encode(msg);
    for (const [id, c] of this.conns) {
      if (id === exceptId) continue;
      try { c.send(raw); } catch (e) { /* dropped; the close handler will clean up */ }
    }
  }

  /** Host -> one client. */
  sendTo(peerId, msg) {
    const c = this.conns.get(peerId);
    if (!c) return;
    try { c.send(encode(msg)); } catch (e) { /* ignore */ }
  }

  /** Client -> host. */
  sendHost(msg) {
    if (this.isHost || !this.hostConn) return;
    try { this.hostConn.send(encode(msg)); } catch (e) { /* ignore */ }
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
    try { c.close({ flush: true }); } catch (e) { try { c.close(); } catch (e2) { /* already gone */ } }
  }

  get peerCount() { return this.isHost ? this.conns.size : (this.open ? 1 : 0); }

  destroy() {
    this.closed = true;
    this.open = false;
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
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  return null;
}
