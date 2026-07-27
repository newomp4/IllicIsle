/* ===========================================================
   audio.js — a tiny WebAudio sound chip.
   Three looping tracks and a pile of one-shots, all synthesised
   at runtime. Nothing to download.
   =========================================================== */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ---------- patterns ---------- */
/* Island: A minor pentatonic, lilting, a bit sad. */
const ISLAND = {
  bpm: 88,
  steps: 32,
  bass: [45, null, null, null, 45, null, 52, null, 43, null, null, null, 43, null, 50, null,
    41, null, null, null, 41, null, 48, null, 40, null, null, null, 47, null, 45, null],
  lead: [69, null, 72, 74, null, 76, null, 72, 69, null, 67, null, 64, null, null, null,
    65, null, 69, 72, null, 74, null, 69, 67, null, 64, null, 60, null, null, null],
  pad: [[45, 52, 57], null, null, null, null, null, null, null,
    [43, 50, 55], null, null, null, null, null, null, null,
    [41, 48, 53], null, null, null, null, null, null, null,
    [40, 47, 52], null, null, null, null, null, null, null],
};

/* Cave: a drone and the occasional drip. */
const CAVE = {
  bpm: 64,
  steps: 32,
  bass: [33, null, null, null, null, null, null, null, 33, null, null, null, null, null, 34, null,
    32, null, null, null, null, null, null, null, 31, null, null, null, null, null, null, null],
  lead: [null, null, null, 76, null, null, null, null, null, null, 79, null, null, null, null, null,
    null, null, null, null, 74, null, null, null, null, null, null, null, 72, null, null, null],
  pad: [[33, 40, 44], null, null, null, null, null, null, null, null, null, null, null, null, null, null, null,
    [31, 38, 43], null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
};

/* Boss: he is called EL BASS PRESIDENTE. The bass is the point. */
const BOSS = {
  bpm: 148,
  steps: 32,
  bass: [33, 33, 45, 33, 36, 33, 45, 40, 33, 33, 45, 33, 38, 40, 41, 43,
    31, 31, 43, 31, 34, 31, 43, 38, 36, 36, 48, 36, 41, 43, 44, 45],
  lead: [null, null, null, null, 69, null, 67, null, null, null, null, null, 64, null, 65, 67,
    null, null, null, null, 67, null, 65, null, null, null, null, null, 60, null, 62, 64],
  kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
  hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

const TRACKS = { island: ISLAND, cave: CAVE, boss: BOSS };

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.track = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.musicVol = 0.34;
    this.sfxVol = 0.5;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);

    // a little room on everything
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(1.9, 2.6);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.noiseBuf = this._noise(2);
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
    }
  }

  _impulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noise(dur) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * dur, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ---------- primitives ---------- */
  _tone(freq, time, dur, {
    type = 'square', gain = 0.2, bus = null, attack = 0.005, release = 0.12,
    filter = 0, q = 1, detune = 0, sweep = 0, send = 0,
  } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * sweep), time + dur);
    if (detune) osc.detune.value = detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + attack);
    g.gain.setTargetAtTime(0, time + Math.max(attack, dur - release), release * 0.4 + 0.01);

    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(filter, time);
      f.Q.value = q;
      node.connect(f); node = f;
    }
    node.connect(g);
    g.connect(bus || this.sfxBus);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s); s.connect(this.verb);
    }
    osc.start(time);
    osc.stop(time + dur + 0.3);
    return osc;
  }

  _noiseHit(time, dur, {
    gain = 0.2, filter = 2000, type = 'lowpass', q = 1, bus = null, sweep = 0, send = 0,
  } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, time);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, filter * sweep), time + dur);
    f.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    src.connect(f); f.connect(g); g.connect(bus || this.sfxBus);
    if (send) {
      const s = ctx.createGain(); s.gain.value = send;
      g.connect(s); s.connect(this.verb);
    }
    src.start(time);
    src.stop(time + dur + 0.05);
  }

  /* ===========================================================
     MUSIC
     =========================================================== */
  playMusic(name) {
    if (!this.ready) return;
    if (this.track === name) return;
    this.track = name;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    if (!this.timer) {
      this.timer = setInterval(() => this._schedule(), 25);
    }
  }

  stopMusic() {
    this.track = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _schedule() {
    if (!this.track || !this.ready) return;
    const T = TRACKS[this.track];
    if (!T) return;
    const spb = 60 / T.bpm / 2; // eighth notes
    const now = this.ctx.currentTime;
    while (this.nextTime < now + 0.12) {
      this._playStep(T, this.step % T.steps, this.nextTime, spb);
      this.step++;
      this.nextTime += spb;
    }
  }

  _playStep(T, i, time, spb) {
    const bus = this.musicBus;

    const b = T.bass?.[i];
    if (b != null) {
      this._tone(mtof(b), time, spb * 1.7, {
        type: 'sawtooth', gain: 0.20, bus, filter: 420, q: 4, release: 0.2,
      });
      this._tone(mtof(b - 12), time, spb * 1.7, { type: 'sine', gain: 0.24, bus, release: 0.2 });
    }

    const l = T.lead?.[i];
    if (l != null) {
      const isBoss = T === BOSS;
      this._tone(mtof(l), time, spb * (isBoss ? 1.1 : 2.4), {
        type: isBoss ? 'square' : 'triangle',
        gain: isBoss ? 0.10 : 0.13,
        bus, filter: isBoss ? 2400 : 1500, q: 1.2,
        release: isBoss ? 0.12 : 0.5, send: 0.35,
      });
      if (!isBoss) {
        this._tone(mtof(l + 12), time + 0.02, spb * 1.2, {
          type: 'sine', gain: 0.05, bus, send: 0.4, release: 0.4,
        });
      }
    }

    const p = T.pad?.[i];
    if (p) {
      for (const n of p) {
        this._tone(mtof(n), time, spb * 8.5, {
          type: 'sawtooth', gain: 0.035, bus, filter: 700, q: 0.8,
          attack: 0.5, release: 1.6, detune: (Math.random() - 0.5) * 12, send: 0.5,
        });
      }
    }

    if (T.kick?.[i]) {
      this._tone(90, time, 0.20, { type: 'sine', gain: 0.42, bus, sweep: 0.35, release: 0.1 });
      this._noiseHit(time, 0.04, { gain: 0.12, filter: 900, bus });
    }
    if (T.snare?.[i]) {
      this._noiseHit(time, 0.16, { gain: 0.20, filter: 2600, q: 0.8, bus, sweep: 0.4, send: 0.3 });
      this._tone(190, time, 0.10, { type: 'triangle', gain: 0.10, bus, sweep: 0.6 });
    }
    if (T.hat?.[i]) {
      this._noiseHit(time, i % 2 ? 0.03 : 0.05, {
        gain: i % 2 ? 0.035 : 0.06, filter: 7000, type: 'highpass', bus,
      });
    }
  }

  /* ===========================================================
     SFX
     =========================================================== */
  sfx(name, opt = {}) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const R = Math.random;

    switch (name) {
      case 'step_sand':
        this._noiseHit(t, 0.09, { gain: 0.11, filter: 1400 + R() * 500, sweep: 0.4 });
        break;
      case 'step_jungle':
        this._noiseHit(t, 0.12, { gain: 0.11, filter: 2400 + R() * 900, sweep: 0.3, q: 1.5 });
        break;
      case 'step_rock':
        this._noiseHit(t, 0.07, { gain: 0.12, filter: 3600 + R() * 800, sweep: 0.25 });
        break;
      case 'step_water':
        this._noiseHit(t, 0.22, { gain: 0.15, filter: 900 + R() * 700, sweep: 2.2, q: 2 });
        break;

      case 'jump':
        this._tone(320, t, 0.16, { type: 'square', gain: 0.10, sweep: 2.1, filter: 2600 });
        break;
      case 'land':
        this._noiseHit(t, 0.14, { gain: 0.16, filter: 700, sweep: 0.3 });
        this._tone(120, t, 0.12, { type: 'sine', gain: 0.14, sweep: 0.5 });
        break;

      case 'throw':
        this._noiseHit(t, 0.20, { gain: 0.13, filter: 1800, type: 'bandpass', q: 3, sweep: 3.2 });
        break;
      case 'splat':
        this._noiseHit(t, 0.17, { gain: 0.22, filter: 1100, sweep: 0.25, q: 2 });
        this._tone(150, t, 0.10, { type: 'triangle', gain: 0.12, sweep: 0.4 });
        break;
      case 'bossHit':
        this._tone(210, t, 0.14, { type: 'square', gain: 0.18, sweep: 0.45, filter: 2600 });
        this._noiseHit(t, 0.16, { gain: 0.16, filter: 2400, sweep: 0.3 });
        break;
      case 'gemHit':
        for (let i = 0; i < 3; i++) {
          this._tone(mtof(76 + i * 5), t + i * 0.035, 0.25, {
            type: 'square', gain: 0.13, filter: 4000, send: 0.4,
          });
        }
        break;

      case 'hurt':
        this._tone(220, t, 0.28, { type: 'sawtooth', gain: 0.20, sweep: 0.35, filter: 1300 });
        this._noiseHit(t, 0.20, { gain: 0.14, filter: 1000, sweep: 0.4 });
        break;
      case 'die':
        for (let i = 0; i < 5; i++) {
          this._tone(mtof(60 - i * 4), t + i * 0.14, 0.5, {
            type: 'sawtooth', gain: 0.16, filter: 900, send: 0.5, release: 0.4,
          });
        }
        break;

      case 'pickup':
        [72, 76, 79, 84].forEach((n, i) => {
          this._tone(mtof(n), t + i * 0.065, 0.22, {
            type: 'square', gain: 0.11, filter: 4200, send: 0.4, release: 0.16,
          });
        });
        break;
      case 'coconut':
        this._tone(mtof(72), t, 0.12, { type: 'triangle', gain: 0.12, filter: 3000 });
        this._tone(mtof(79), t + 0.05, 0.14, { type: 'triangle', gain: 0.09, filter: 3000, send: 0.3 });
        break;
      case 'heal':
        [67, 72, 76].forEach((n, i) => {
          this._tone(mtof(n), t + i * 0.08, 0.4, { type: 'sine', gain: 0.13, send: 0.5, release: 0.3 });
        });
        break;
      case 'deny':
        this._tone(140, t, 0.18, { type: 'square', gain: 0.12, sweep: 0.7, filter: 900 });
        break;

      case 'door':
        this._noiseHit(t, 2.4, { gain: 0.22, filter: 320, q: 3, sweep: 1.8, send: 0.6 });
        this._tone(48, t, 2.2, { type: 'sawtooth', gain: 0.14, filter: 200, release: 1.2, send: 0.5 });
        for (let i = 0; i < 4; i++) {
          this._tone(mtof(52 + i * 7), t + 0.5 + i * 0.22, 0.9, {
            type: 'triangle', gain: 0.09, send: 0.7, release: 0.6, filter: 2200,
          });
        }
        break;

      case 'cast':
        this._tone(180, t, 0.5, { type: 'sawtooth', gain: 0.13, sweep: 3.2, filter: 2400, send: 0.4 });
        break;
      case 'charge':
        this._tone(70, t, 0.9, { type: 'sawtooth', gain: 0.20, sweep: 2.4, filter: 700, send: 0.3 });
        break;
      case 'slam':
        this._tone(64, t, 0.7, { type: 'sine', gain: 0.36, sweep: 0.3, release: 0.4 });
        this._noiseHit(t, 0.6, { gain: 0.26, filter: 800, sweep: 0.16, send: 0.5 });
        break;

      case 'bossIntro':
        this._tone(46, t, 2.6, { type: 'sawtooth', gain: 0.26, filter: 380, release: 1.4, send: 0.6 });
        this._noiseHit(t, 2.2, { gain: 0.14, filter: 500, sweep: 0.4, send: 0.6 });
        break;
      case 'bossDie':
        for (let i = 0; i < 8; i++) {
          this._tone(mtof(64 - i * 3), t + i * 0.16, 0.6, {
            type: 'sawtooth', gain: 0.17, filter: 1100 - i * 90, send: 0.6, release: 0.4,
          });
        }
        this._noiseHit(t + 1.3, 1.8, { gain: 0.2, filter: 700, sweep: 0.2, send: 0.7 });
        break;

      case 'victory':
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => {
          this._tone(mtof(n), t + i * 0.11, 1.1, {
            type: 'square', gain: 0.12, filter: 4200, send: 0.6, release: 0.7,
          });
          this._tone(mtof(n - 12), t + i * 0.11, 1.1, {
            type: 'triangle', gain: 0.09, send: 0.5, release: 0.7,
          });
        });
        break;

      case 'select':
        this._tone(mtof(84), t, 0.06, { type: 'square', gain: 0.09, filter: 5000 });
        break;
      case 'confirm':
        this._tone(mtof(79), t, 0.08, { type: 'square', gain: 0.11, filter: 5000 });
        this._tone(mtof(86), t + 0.07, 0.14, { type: 'square', gain: 0.10, filter: 5000 });
        break;
      case 'page':
        this._noiseHit(t, 0.13, { gain: 0.10, filter: 3800, type: 'bandpass', q: 2, sweep: 0.5 });
        break;
    }
  }
}
