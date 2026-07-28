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
  peerLibPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => (window.Peer ? res(window.Peer) : rej(new Error('PeerJS did not register')));
    s.onerror = () => rej(new Error('Could not load vendor/peerjs.min.js'));
    document.head.appendChild(s);
  });
  return peerLibPromise;
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
      const fail = (e) => {
        if (this.closed) return;
        const taken = e && (e.type === 'unavailable-id');
        reject(new Error(taken
          ? 'That room code is already in use. Try another.'
          : (e?.message || 'Could not reach the matchmaking broker.')));
      };
      this.peer.on('error', (e) => {
        if (!this.open) fail(e);
        else this.onError?.(e);
      });
      this.peer.on('open', () => {
        this.open = true;
        this._status('ROOM OPEN');
        this.onOpen?.('host');
        resolve(room);
      });
      this.peer.on('connection', (conn) => this._acceptClient(conn));
    });
  }

  _acceptClient(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.onPeerJoin?.(conn.peer);
    });
    conn.on('data', (raw) => {
      const msg = decode(raw);
      if (msg) this.onMessage?.(msg, conn.peer);
    });
    const bye = () => {
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
        conn.on('close', () => { this.open = false; this.onHostGone?.(); });
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

/* ===========================================================
   RATE LIMITER — position updates are the only chatty message.
   =========================================================== */
export class Ticker {
  constructor(hz) { this.interval = 1 / hz; this.acc = 0; }
  ready(dt) {
    this.acc += dt;
    if (this.acc >= this.interval) { this.acc %= this.interval; return true; }
    return false;
  }
}
