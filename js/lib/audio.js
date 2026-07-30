/* ===========================================================
   audio.js — a small WebAudio sound chip.
   Everything is synthesised at runtime; nothing is downloaded.

   Music is arranged rather than looped: each track is 64 steps
   long and cycles through SECTIONS that mute or add voices, so
   the same material keeps changing shape instead of repeating
   the same eight bars forever.
   =========================================================== */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const _ = null;   // rest, keeps the pattern tables readable

/* ===========================================================
   TRACKS
   ===========================================================
   layers[section] decides whether a voice plays this time round.
*/

/* ---- ISLAND: warm, lilting, a little lost. D dorian. ---- */
const ISLAND = {
  bpm: 84, len: 64, sections: 4,
  voices: {
    bass: {
      layers: [1, 1, 1, 1],
      notes: [
        38, _, _, _, _, _, 45, _, 38, _, _, _, 41, _, _, _,
        36, _, _, _, _, _, 43, _, 36, _, _, _, 40, _, 38, _,
        33, _, _, _, _, _, 40, _, 33, _, _, _, 36, _, _, _,
        34, _, _, _, 41, _, _, _, 36, _, 38, _, 40, _, 41, _,
      ],
    },
    marimba: {
      layers: [0, 1, 1, 1],
      notes: [
        69, _, 72, _, 74, _, 72, _, 69, _, 67, _, _, _, 65, _,
        67, _, 69, _, 72, _, _, _, 74, _, 72, _, 69, _, _, _,
        65, _, 67, _, 69, _, 67, _, 65, _, 62, _, _, _, 60, _,
        62, _, 65, _, 67, _, 69, _, 72, _, 74, _, 76, _, _, _,
      ],
    },
    lead: {
      layers: [0, 0, 1, 1],
      notes: [
        _, _, _, _, 81, _, _, 79, _, _, 77, _, _, _, _, _,
        _, _, 76, _, _, _, 74, _, _, _, _, _, 72, _, _, _,
        _, _, _, _, 77, _, _, 76, _, _, 74, _, _, _, _, _,
        _, _, 72, _, _, 74, _, 76, _, _, _, _, 79, _, _, _,
      ],
    },
    pad: {
      layers: [1, 1, 1, 1],
      chords: [
        [50, 57, 62], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [48, 55, 60], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [45, 52, 57], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [46, 53, 58], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
    shaker: { layers: [0, 1, 1, 1], hits: 'x.x.x.xxx.x.x.x.' },
    conga:  { layers: [0, 0, 1, 1], hits: 'x...x..x..x.x...' },
  },
};

/* ---- TITLE: the same theme, slower and heavier. ---- */
const TITLE = {
  bpm: 62, len: 64, sections: 2,
  voices: {
    bass: {
      layers: [1, 1],
      notes: [
        38, _, _, _, _, _, _, _, 36, _, _, _, _, _, _, _,
        33, _, _, _, _, _, _, _, 34, _, _, _, 36, _, 38, _,
        38, _, _, _, _, _, _, _, 36, _, _, _, _, _, _, _,
        41, _, _, _, _, _, _, _, 40, _, 38, _, 36, _, _, _,
      ],
    },
    lead: {
      layers: [1, 1],
      notes: [
        69, _, _, _, 72, _, _, _, 74, _, _, _, _, _, _, _,
        72, _, _, _, 69, _, _, _, 67, _, _, _, _, _, _, _,
        65, _, _, _, 67, _, _, _, 69, _, _, _, 72, _, _, _,
        74, _, _, _, 72, _, _, _, 69, _, _, _, _, _, _, _,
      ],
    },
    pad: {
      layers: [1, 1],
      chords: [
        [38, 45, 50, 57], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [33, 40, 45, 52], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [36, 43, 48, 55], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [34, 41, 46, 53], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
  },
};

/* ---- TEMPLE: stone, damp, patient. Almost no melody. ---- */
const TEMPLE = {
  bpm: 54, len: 64, sections: 3,
  voices: {
    bass: {
      layers: [1, 1, 1],
      notes: [
        26, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        26, _, _, _, _, _, _, _, _, _, 27, _, _, _, _, _,
        25, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        24, _, _, _, _, _, _, _, 26, _, _, _, _, _, _, _,
      ],
    },
    bell: {
      layers: [0, 1, 1],
      notes: [
        _, _, _, _, _, _, _, _, _, _, _, _, 81, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        _, _, _, _, 79, _, _, _, _, _, _, _, _, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, 76, _, _, _,
      ],
    },
    pad: {
      layers: [1, 1, 1],
      chords: [
        [38, 45, 49], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [38, 45, 50], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [37, 44, 49], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [36, 43, 48], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
    drip: { layers: [1, 1, 1], hits: '..........x.....' },
  },
};

/* ---- BOSS: he is called EL BASS PRESIDENTE. ---- */
const BOSS = {
  bpm: 146, len: 64, sections: 4,
  voices: {
    bass: {
      layers: [1, 1, 1, 1],
      notes: [
        33, 33, 45, 33, 36, 33, 45, 40, 33, 33, 45, 33, 38, 40, 41, 43,
        31, 31, 43, 31, 34, 31, 43, 38, 36, 36, 48, 36, 41, 43, 44, 45,
        33, 33, 45, 33, 36, 33, 45, 40, 33, 33, 45, 33, 38, 40, 41, 43,
        29, 29, 41, 29, 32, 29, 41, 36, 34, 34, 46, 34, 39, 41, 43, 45,
      ],
    },
    stab: {
      layers: [0, 1, 1, 1],
      chords: [
        _, _, _, _, [57, 60, 64], _, _, _, _, _, _, _, [56, 59, 63], _, _, _,
        _, _, _, _, [55, 58, 62], _, _, _, _, _, _, _, [57, 60, 64], _, _, _,
        _, _, _, _, [57, 60, 64], _, _, _, _, _, _, _, [59, 62, 66], _, _, _,
        _, _, [53, 56, 60], _, _, _, [55, 58, 62], _, _, _, [57, 60, 64], _, _, _, _, _,
      ],
    },
    lead: {
      layers: [0, 0, 1, 1],
      notes: [
        _, _, _, _, 69, _, 67, _, _, _, _, _, 64, _, 65, 67,
        _, _, _, _, 67, _, 65, _, _, _, _, _, 60, _, 62, 64,
        _, _, 72, _, _, 71, _, 69, _, _, _, _, 67, _, _, _,
        76, _, 74, _, 72, _, 71, _, 69, _, 67, _, 65, _, 64, _,
      ],
    },
    kick:  { layers: [1, 1, 1, 1], hits: 'x.....x.x.....x.' },
    snare: { layers: [1, 1, 1, 1], hits: '....x.......x..x' },
    hat:   { layers: [0, 1, 1, 1], hits: 'xxxxxxxxxxxxxxxx' },
  },
};

/* ---- STORM: the opening. Churning low end, no tune, a bell tolling. ---- */
const STORM = {
  bpm: 48, len: 64, sections: 3,
  voices: {
    bass: {
      layers: [1, 1, 1],
      notes: [
        26, _, _, _, _, _, _, _, 26, _, _, _, _, _, 25, _,
        24, _, _, _, _, _, _, _, 24, _, _, _, 26, _, _, _,
        22, _, _, _, _, _, _, _, 24, _, _, _, _, _, _, _,
        26, _, _, _, 25, _, _, _, 24, _, _, _, 22, _, _, _,
      ],
    },
    pad: {
      layers: [1, 1, 1],
      chords: [
        [38, 45, 48], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [36, 43, 46], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [34, 41, 44], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [38, 44, 49], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
    bell: {
      layers: [0, 1, 1],
      notes: [
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        62, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        60, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
    drip: { layers: [1, 1, 1], hits: '..x.......x..x..' },
  },
};

/* ---- ALARM: the Pendulums are jammed and the island is counting down.
   Two notes a semitone apart, forever, over a heartbeat kick. It is meant
   to be unpleasant — it only ever plays while somebody is about to die. ---- */
const ALARM = {
  bpm: 132, len: 16, sections: 3,
  voices: {
    bass: {
      layers: [1, 1, 1],
      notes: [
        29, _, 29, _, 30, _, 29, _, 29, _, 29, _, 28, _, 29, _,
      ],
    },
    stab: {
      layers: [1, 1, 1],
      chords: [
        [53, 54, 60], _, _, _, _, _, _, _, [52, 53, 59], _, _, _, _, _, _, _,
      ],
    },
    lead: {
      layers: [0, 1, 1],
      notes: [
        77, _, _, _, 78, _, _, _, 77, _, _, _, 78, _, _, _,
      ],
    },
    kick:  { layers: [1, 1, 1], hits: 'x...x...x...x..x' },
    snare: { layers: [0, 0, 1], hits: '....x.......x...' },
    hat:   { layers: [0, 1, 1], hits: 'x.x.x.x.x.x.x.xx' },
  },
};

/* ---- NIGHT: the same island with the lights off. Sparser, lower, and
   it leaves gaps you fill in yourself. ---- */
const NIGHT = {
  bpm: 62, len: 32, sections: 3,
  voices: {
    bass: {
      layers: [1, 1, 1],
      notes: [
        33, _, _, _, _, _, _, _, 31, _, _, _, _, _, _, _,
        29, _, _, _, _, _, _, _, 28, _, _, _, 31, _, _, _,
      ],
    },
    pad: {
      layers: [1, 1, 1],
      chords: [
        [45, 52, 57], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [43, 50, 55], _, _, _, _, _, _, _, [41, 48, 53], _, _, _, _, _, _, _,
      ],
    },
    lead: {
      layers: [0, 1, 1],
      notes: [
        _, _, _, _, 69, _, _, _, _, _, 67, _, _, _, _, _,
        _, _, 64, _, _, _, _, _, 62, _, _, _, _, _, 60, _,
      ],
    },
    bell: {
      layers: [0, 0, 1],
      notes: [
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, 76, _,
      ],
    },
    drip: { layers: [1, 1, 1], hits: '....x.......x...' },
  },
};

/* ---- BUNKER: forty years of standby power and nobody to hear it.
   A drone on the tonic, a filtered pulse that could be a generator, and a
   single sonar ping that arrives whenever it feels like it. It should be
   uncomfortable to stand in for long, because standing in it is exactly
   what you are trading your round for. ---- */
const BUNKER = {
  bpm: 48, len: 32, sections: 3,
  voices: {
    bass: {
      layers: [1, 1, 1],
      notes: [
        26, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        26, _, _, _, _, _, _, _, 25, _, _, _, _, _, _, _,
      ],
    },
    pad: {
      layers: [1, 1, 1],
      chords: [
        [38, 45, 50], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        [38, 44, 51], _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
    lead: {
      layers: [0, 1, 1],
      notes: [
        _, _, _, _, _, _, _, _, _, _, _, _, 74, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, 73, _,
      ],
    },
    bell: {
      layers: [0, 0, 1],
      notes: [
        _, _, _, _, _, _, _, _, 86, _, _, _, _, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
      ],
    },
    // the generator, ticking over
    kick: { layers: [1, 1, 1], hits: 'x.......x.......' },
    hat:  { layers: [0, 1, 1], hits: '..x...x...x...x.' },
  },
};

/* ---- FLOPPER: the deck of a gambling barge that has had one idea and has
   been having it for thirty years. A walking bass, an organ that cannot quite
   stay in tune, a tambourine, and a hook you will resent. ---- */
const FLOPPER = {
  bpm: 116, len: 16, sections: 3,
  voices: {
    bass: {
      layers: [1, 1, 1],
      notes: [
        33, _, 40, _, 33, _, 45, _, 38, _, 45, _, 40, _, 38, _,
      ],
    },
    // the organ, in thirds, because it is that kind of establishment
    stab: {
      layers: [1, 1, 1],
      chords: [
        [57, 60, 64], _, _, [57, 60, 64], _, _, [59, 62, 66], _,
        [62, 65, 69], _, _, [60, 64, 67], _, _, [57, 60, 64], _,
      ],
    },
    lead: {
      layers: [0, 1, 1],
      notes: [
        72, _, 76, _, 79, _, 76, _, 74, _, 72, _, 69, _, 72, _,
      ],
    },
    bell: {
      layers: [0, 0, 1],
      notes: [
        _, 84, _, 88, _, 84, _, _, _, 86, _, 91, _, 86, _, _,
      ],
    },
    kick:  { layers: [1, 1, 1], hits: 'x...x...x...x...' },
    snare: { layers: [0, 1, 1], hits: '....x.......x..x' },
    hat:   { layers: [1, 1, 1], hits: 'x.x.x.x.x.x.x.xx' },
  },
};

/* ---- HIGH ROLLERS: a room with one table in it and nobody in a hurry.
   Brushed hats, a walking double bass that never repeats the same bar twice
   in a row, and a piano that plays four notes and then thinks about it. It is
   meant to feel like somebody is playing this in the corner rather than like
   a soundtrack. ---- */
const HIGHROLLER = {
  bpm: 92, len: 32, sections: 4,
  voices: {
    // the walk: minor, chromatic on the way up, never quite settling
    bass: {
      layers: [1, 1, 1, 1],
      notes: [
        33, _, 35, _, 36, _, 38, _, 40, _, 38, _, 36, _, 35, _,
        33, _, 32, _, 33, _, 36, _, 40, _, 43, _, 40, _, 36, _,
      ],
    },
    // sevenths and ninths, left hanging
    pad: {
      layers: [1, 1, 1, 1],
      chords: [
        [52, 55, 59, 62], _, _, _, _, _, _, _,
        [50, 54, 57, 60], _, _, _, _, _, _, _,
        [48, 52, 55, 59], _, _, _, _, _, _, _,
        [55, 58, 62, 65], _, _, _, _, _, _, _,
      ],
    },
    // four notes, then it thinks about it
    lead: {
      layers: [0, 1, 1, 1],
      notes: [
        _, _, 71, _, 74, _, 75, _, 74, _, _, _, _, _, _, _,
        _, _, 69, _, 72, _, 74, _, 71, _, _, _, _, _, _, _,
      ],
    },
    bell: {
      layers: [0, 0, 1, 1],
      notes: [
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, 86, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 83,
      ],
    },
    // brushes, not sticks
    kick:  { layers: [1, 1, 1, 1], hits: 'x.......x.......' },
    snare: { layers: [0, 1, 1, 1], hits: '..x...x...x...x.' },
    hat:   { layers: [1, 1, 1, 1], hits: 'x.xxx.xxx.xxx.xx' },
  },
};

/* ===========================================================
   THE SALOON

   Slower than the room next door and a great deal less sober. A shuffling
   twelve-bar in a minor key, a piano that comes in late and leaves early,
   and a bass that walks the same four bars all night because nobody has
   ever asked it to do anything else.
   =========================================================== */
const BAR = {
  bpm: 68, len: 32, sections: 4,
  voices: {
    // the walk, in a low blues: root, flat third, fourth, flat five, five
    bass: {
      layers: [1, 1, 1, 1],
      notes: [
        33, _, _, _, 36, _, _, _, 38, _, _, _, 39, _, 40, _,
        33, _, _, _, 36, _, _, _, 40, _, 39, _, 38, _, 36, _,
      ],
    },
    // dominant sevenths, held long and let go of untidily
    pad: {
      layers: [1, 1, 1, 1],
      chords: [
        [45, 49, 52, 55], _, _, _, _, _, _, _,
        [50, 54, 57, 60], _, _, _, _, _, _, _,
        [45, 49, 52, 55], _, _, _, _, _, _, _,
        [52, 56, 59, 62], _, _, _, _, _, _, _,
      ],
    },
    // the piano in the corner, which is nearly in tune
    lead: {
      layers: [0, 0, 1, 1],
      notes: [
        _, _, _, 68, _, 70, 71, _, _, _, 68, _, 66, _, _, _,
        _, _, _, 63, _, 66, 68, _, _, _, 66, _, 63, _, _, _,
      ],
    },
    bell: {
      layers: [0, 1, 1, 1],
      notes: [
        _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _,
        _, _, _, _, _, _, _, _, _, _, _, _, _, 80, _, _,
      ],
    },
    // brushes and a foot, and nothing else
    kick:  { layers: [1, 1, 1, 1], hits: 'x.......x...x...' },
    snare: { layers: [0, 1, 1, 1], hits: '....x.......x...' },
    hat:   { layers: [1, 1, 1, 1], hits: 'x..x..x.x..x..x.' },
  },
};

const TRACKS = {
  island: ISLAND, title: TITLE, temple: TEMPLE, boss: BOSS,
  storm: STORM, alarm: ALARM, night: NIGHT, bunker: BUNKER,
  flopper: FLOPPER, highroller: HIGHROLLER, bar: BAR,
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.track = null;
    this.step = 0;
    this.section = 0;
    this.nextTime = 0;
    this.timer = null;
    this.musicVol = 0.32;
    this.sfxVol = 0.5;
    this.duck = 1;
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

    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(2.4, 2.4);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.26;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.noiseBuf = this._noise(2);
    this._buildVoices();
    this.ready = true;
  }

  /* ===========================================================
     THE VOICE POOL

     Every note used to build its own oscillator, gain and filter,
     connect them, start them and abandon them. Those wrappers live for
     the length of the note — long enough that V8 promotes them out of
     the nursery into old space, where clearing them costs a major
     collection. At forty notes a second that is a second-and-a-half
     freeze every ten to twenty seconds, which is exactly what it was.

     So: a fixed set of voices, built once. The oscillators run forever
     and are silent because their gain is zero; playing a note is a
     handful of scheduled parameter changes on nodes that already exist.
     After warm-up the music allocates nothing at all.
     =========================================================== */
  _buildVoices() {
    const ctx = this.ctx;
    const mk = (kind) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 20000;
      f.Q.value = 1;
      f.connect(g);

      /* Both destinations are wired permanently and chosen by gain, so a
         note never has to connect() or disconnect() anything. */
      const toMusic = ctx.createGain(); toMusic.gain.value = 0;
      const toSfx = ctx.createGain(); toSfx.gain.value = 0;
      const toVerb = ctx.createGain(); toVerb.gain.value = 0;
      g.connect(toMusic); toMusic.connect(this.musicBus);
      g.connect(toSfx); toSfx.connect(this.sfxBus);
      g.connect(toVerb); toVerb.connect(this.verb);

      let src;
      if (kind === 'noise') {
        src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
      } else {
        src = ctx.createOscillator();
        src.type = 'square';
        src.frequency.value = 220;
      }
      src.connect(f);
      src.start();
      return { src, f, g, toMusic, toSfx, toVerb, until: 0, type: kind === 'noise' ? 'noise' : 'square' };
    };

    /* Twenty-four tonal voices covers bass, a three-note pad, a lead, a
       bell and any sound effect that lands on top of them; eight noise
       voices covers the drums and the weather. */
    this.voices = [];
    for (let i = 0; i < 24; i++) this.voices.push(mk('tone'));
    this.noises = [];
    for (let i = 0; i < 8; i++) this.noises.push(mk('noise'));
  }

  /**
   * The voice that will interfere least: one that has finished, preferring
   * one already set to the waveform we want so the type change cannot be
   * heard on a note still sounding.
   */
  _take(pool, time, type) {
    let best = null, bestScore = -Infinity;
    for (const v of pool) {
      const freeFor = time - v.until;              // >0 means idle already
      const score = (freeFor >= 0 ? 1000 : freeFor * 10) + (v.type === type ? 5 : 0);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  /** Duck the music under a cutscene line or a big hit. */
  duckMusic(amount = 0.35, seconds = 1.4) {
    if (!this.ready) return;
    const g = this.musicBus.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.musicVol * amount, now, 0.05);
    g.setTargetAtTime(this.musicVol, now + seconds, 0.35);
  }

  _impulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
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

  /**
   * One note. Nothing is created here: a voice is borrowed from the pool
   * and its parameters are scheduled.
   */
  _tone(freq, time, dur, {
    type = 'square', gain = 0.2, bus = null, attack = 0.005, release = 0.12,
    filter = 0, q = 1, detune = 0, sweep = 0, send = 0,
  } = {}) {
    if (!this.voices) return null;
    const v = this._take(this.voices, time, type);
    const osc = v.src;

    /* type and detune apply the moment they are set rather than at `time`,
       so they are the one thing that can be heard on a stolen voice. _take
       prefers voices that are already idle and already this shape. */
    if (v.type !== type) { osc.type = type; v.type = type; }
    osc.detune.value = detune;

    const f0 = osc.frequency;
    f0.cancelScheduledValues(time);
    f0.setValueAtTime(freq, time);
    if (sweep) f0.exponentialRampToValueAtTime(Math.max(20, freq * sweep), time + dur);

    const fq = v.f.frequency;
    fq.cancelScheduledValues(time);
    fq.setValueAtTime(filter || 20000, time);
    v.f.Q.value = filter ? q : 1;

    const g = v.g.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(gain, time + attack);
    g.setTargetAtTime(0, time + Math.max(attack, dur - release), release * 0.4 + 0.01);
    // a hard zero at the end, so a borrowed voice can never leak a tail
    const end = time + dur + 0.3;
    g.setValueAtTime(0, end);

    const music = (bus || this.sfxBus) === this.musicBus;
    v.toMusic.gain.setValueAtTime(music ? 1 : 0, time);
    v.toSfx.gain.setValueAtTime(music ? 0 : 1, time);
    v.toVerb.gain.setValueAtTime(send, time);

    v.until = end;
    return osc;
  }

  /** Plucked, marimba/kalimba-ish: fast attack, bell-ish partials. */
  _pluck(freq, time, dur, { gain = 0.14, bus = null, send = 0.4, bright = 1 } = {}) {
    this._tone(freq, time, dur, {
      type: 'triangle', gain, bus, attack: 0.002, release: dur * 0.7,
      filter: 1800 * bright, q: 1.1, send,
    });
    this._tone(freq * 2.01, time, dur * 0.45, {
      type: 'sine', gain: gain * 0.35, bus, attack: 0.001, release: dur * 0.3, send,
    });
    this._tone(freq * 3.02, time, dur * 0.22, {
      type: 'sine', gain: gain * 0.13, bus, attack: 0.001, release: dur * 0.15, send,
    });
  }

  /** A burst of filtered noise, from the same kind of pool. */
  _noiseHit(time, dur, {
    gain = 0.2, filter = 2000, type = 'lowpass', q = 1, bus = null, sweep = 0, send = 0,
  } = {}) {
    if (!this.noises) return;
    const v = this._take(this.noises, time, type);
    if (v.type !== type) { v.f.type = type; v.type = type; }

    const fq = v.f.frequency;
    fq.cancelScheduledValues(time);
    fq.setValueAtTime(filter, time);
    if (sweep) fq.exponentialRampToValueAtTime(Math.max(60, filter * sweep), time + dur);
    v.f.Q.value = q;

    const g = v.g.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(gain, time);
    g.exponentialRampToValueAtTime(0.0001, time + dur);
    const end = time + dur + 0.05;
    g.setValueAtTime(0, end);

    const music = (bus || this.sfxBus) === this.musicBus;
    v.toMusic.gain.setValueAtTime(music ? 1 : 0, time);
    v.toSfx.gain.setValueAtTime(music ? 0 : 1, time);
    v.toVerb.gain.setValueAtTime(send, time);

    v.until = end;
  }

  /* ===========================================================
     MUSIC
     =========================================================== */
  playMusic(name) {
    if (!this.ready) return;
    if (this.track === name) return;
    this.track = name;
    this.step = 0;
    this.section = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    if (!this.timer) this.timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    this.track = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _schedule() {
    if (!this.track || !this.ready) return;
    const T = TRACKS[this.track];
    if (!T) return;
    const spb = 60 / T.bpm / 2;
    const now = this.ctx.currentTime;
    while (this.nextTime < now + 0.12) {
      const i = this.step % T.len;
      if (i === 0 && this.step > 0) this.section = (this.section + 1) % T.sections;
      this._playStep(T, i, this.nextTime, spb);
      this.step++;
      this.nextTime += spb;
    }
  }

  _playStep(T, i, time, spb) {
    const bus = this.musicBus;
    const V = T.voices;
    const sec = this.section;
    const on = (v) => v && v.layers[sec % v.layers.length];

    if (on(V.bass)) {
      const n = V.bass.notes[i];
      if (n != null) {
        this._tone(mtof(n), time, spb * 1.8, {
          type: 'sawtooth', gain: 0.18, bus, filter: 380, q: 5, release: 0.22,
        });
        this._tone(mtof(n - 12), time, spb * 1.8, { type: 'sine', gain: 0.24, bus, release: 0.22 });
      }
    }

    if (on(V.marimba)) {
      const n = V.marimba.notes[i];
      if (n != null) this._pluck(mtof(n), time, spb * 2.6, { gain: 0.13, bus, send: 0.45 });
    }

    if (on(V.lead)) {
      const n = V.lead.notes[i];
      if (n != null) {
        const isBoss = T === BOSS;
        this._tone(mtof(n), time, spb * (isBoss ? 1.2 : 3.0), {
          type: isBoss ? 'square' : 'triangle',
          gain: isBoss ? 0.10 : 0.11,
          bus, filter: isBoss ? 2600 : 1500, q: 1.2,
          release: isBoss ? 0.14 : 0.7, send: 0.4,
        });
      }
    }

    if (on(V.bell)) {
      const n = V.bell.notes[i];
      if (n != null) this._pluck(mtof(n), time, spb * 6, { gain: 0.10, bus, send: 0.8, bright: 1.6 });
    }

    if (on(V.pad)) {
      const c = V.pad.chords[i];
      if (c) for (const n of c) {
        this._tone(mtof(n), time, spb * 17, {
          type: 'sawtooth', gain: 0.030, bus, filter: 620, q: 0.8,
          attack: 0.9, release: 2.6, detune: (Math.random() - 0.5) * 11, send: 0.55,
        });
      }
    }

    if (on(V.stab)) {
      const c = V.stab.chords[i];
      if (c) for (const n of c) {
        this._tone(mtof(n), time, spb * 1.1, {
          type: 'sawtooth', gain: 0.055, bus, filter: 1700, q: 2,
          attack: 0.004, release: 0.1, send: 0.25,
        });
      }
    }

    /* percussion — 16-step strings tiled across the bar */
    const hit = (v) => v && v.layers[sec % v.layers.length] && v.hits[i % 16] === 'x';

    if (hit(V.kick)) {
      this._tone(92, time, 0.20, { type: 'sine', gain: 0.42, bus, sweep: 0.34, release: 0.1 });
      this._noiseHit(time, 0.03, { gain: 0.10, filter: 900, bus });
    }
    if (hit(V.snare)) {
      this._noiseHit(time, 0.16, { gain: 0.19, filter: 2600, q: 0.8, bus, sweep: 0.4, send: 0.3 });
      this._tone(190, time, 0.09, { type: 'triangle', gain: 0.09, bus, sweep: 0.6 });
    }
    if (hit(V.hat)) {
      this._noiseHit(time, i % 2 ? 0.028 : 0.05, {
        gain: i % 2 ? 0.030 : 0.055, filter: 7600, type: 'highpass', bus,
      });
    }
    if (hit(V.shaker)) {
      this._noiseHit(time, 0.045, {
        gain: (i % 4 === 0 ? 0.055 : 0.032), filter: 6200, type: 'highpass', bus, send: 0.15,
      });
    }
    if (hit(V.conga)) {
      this._tone(i % 8 === 0 ? 196 : 148, time, 0.16, {
        type: 'sine', gain: 0.15, bus, sweep: 0.72, release: 0.1, send: 0.3,
      });
      this._noiseHit(time, 0.035, { gain: 0.05, filter: 1600, bus });
    }
    if (hit(V.drip)) {
      this._tone(mtof(88 + (i % 3) * 3), time, 0.5, {
        type: 'sine', gain: 0.055, bus, sweep: 0.55, attack: 0.002, release: 0.4, send: 0.9,
      });
    }
  }

  /* ===========================================================
     SFX
     =========================================================== */
  sfx(name) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const R = Math.random;

    switch (name) {
      case 'step_sand':   this._noiseHit(t, 0.09, { gain: 0.10, filter: 1400 + R() * 500, sweep: 0.4 }); break;
      case 'step_jungle': this._noiseHit(t, 0.12, { gain: 0.10, filter: 2400 + R() * 900, sweep: 0.3, q: 1.5 }); break;
      case 'step_rock':   this._noiseHit(t, 0.07, { gain: 0.11, filter: 3600 + R() * 800, sweep: 0.25 }); break;
      case 'step_water':  this._noiseHit(t, 0.22, { gain: 0.14, filter: 900 + R() * 700, sweep: 2.2, q: 2 }); break;

      case 'jump': this._tone(320, t, 0.16, { type: 'square', gain: 0.09, sweep: 2.1, filter: 2600 }); break;
      case 'land':
        this._noiseHit(t, 0.14, { gain: 0.15, filter: 700, sweep: 0.3 });
        this._tone(120, t, 0.12, { type: 'sine', gain: 0.13, sweep: 0.5 });
        break;

      case 'throw': this._noiseHit(t, 0.20, { gain: 0.12, filter: 1800, type: 'bandpass', q: 3, sweep: 3.2 }); break;
      case 'splat':
        this._noiseHit(t, 0.17, { gain: 0.20, filter: 1100, sweep: 0.25, q: 2 });
        this._tone(150, t, 0.10, { type: 'triangle', gain: 0.11, sweep: 0.4 });
        break;
      case 'bossHit':
        this._tone(210, t, 0.14, { type: 'square', gain: 0.17, sweep: 0.45, filter: 2600 });
        this._noiseHit(t, 0.16, { gain: 0.15, filter: 2400, sweep: 0.3 });
        break;
      case 'gemHit':
        for (let i = 0; i < 3; i++) {
          this._tone(mtof(76 + i * 5), t + i * 0.035, 0.25, { type: 'square', gain: 0.12, filter: 4000, send: 0.4 });
        }
        break;

      case 'hurt':
        this._tone(220, t, 0.28, { type: 'sawtooth', gain: 0.19, sweep: 0.35, filter: 1300 });
        this._noiseHit(t, 0.20, { gain: 0.13, filter: 1000, sweep: 0.4 });
        break;
      case 'die':
        for (let i = 0; i < 5; i++) {
          this._tone(mtof(60 - i * 4), t + i * 0.14, 0.5, { type: 'sawtooth', gain: 0.15, filter: 900, send: 0.5, release: 0.4 });
        }
        break;

      case 'pickup':
        [72, 76, 79, 84].forEach((n, i) =>
          this._pluck(mtof(n), t + i * 0.06, 0.5, { gain: 0.13, send: 0.5, bright: 1.5 }));
        break;
      case 'coconut':
        this._pluck(mtof(72), t, 0.22, { gain: 0.13 });
        this._pluck(mtof(79), t + 0.05, 0.28, { gain: 0.10, send: 0.35 });
        break;
      case 'heal':
        [67, 72, 76].forEach((n, i) => this._tone(mtof(n), t + i * 0.08, 0.4, { type: 'sine', gain: 0.12, send: 0.5, release: 0.3 }));
        break;
      case 'deny': this._tone(140, t, 0.18, { type: 'square', gain: 0.11, sweep: 0.7, filter: 900 }); break;

      /* ---- the big door, with weight ---- */
      case 'door':
        this.duckMusic(0.3, 2.6);
        this._noiseHit(t, 2.6, { gain: 0.22, filter: 300, q: 3, sweep: 1.9, send: 0.7 });
        this._tone(44, t, 2.4, { type: 'sawtooth', gain: 0.15, filter: 190, release: 1.3, send: 0.5 });
        for (let i = 0; i < 5; i++) {
          this._tone(mtof(50 + i * 7), t + 0.45 + i * 0.2, 1.1, {
            type: 'triangle', gain: 0.085, send: 0.8, release: 0.8, filter: 2200,
          });
        }
        break;

      case 'cast':   this._tone(180, t, 0.5, { type: 'sawtooth', gain: 0.12, sweep: 3.2, filter: 2400, send: 0.4 }); break;
      case 'charge': this._tone(70, t, 0.9, { type: 'sawtooth', gain: 0.19, sweep: 2.4, filter: 700, send: 0.3 }); break;
      case 'slam':
        this._tone(64, t, 0.7, { type: 'sine', gain: 0.34, sweep: 0.3, release: 0.4 });
        this._noiseHit(t, 0.6, { gain: 0.24, filter: 800, sweep: 0.16, send: 0.5 });
        break;

      case 'bossIntro':
        this.duckMusic(0.25, 2.2);
        this._tone(46, t, 2.6, { type: 'sawtooth', gain: 0.26, filter: 380, release: 1.4, send: 0.6 });
        this._noiseHit(t, 2.2, { gain: 0.14, filter: 500, sweep: 0.4, send: 0.6 });
        break;

      /* ---- defeat: the staff dies, then the room exhales ---- */
      case 'bossDie':
        this.duckMusic(0.12, 5.5);
        // the orb winding down
        this._tone(520, t, 2.2, { type: 'sawtooth', gain: 0.2, sweep: 0.06, filter: 2600, release: 1.6, send: 0.7 });
        for (let i = 0; i < 9; i++) {
          this._tone(mtof(64 - i * 3), t + i * 0.16, 0.7, {
            type: 'sawtooth', gain: 0.16, filter: 1100 - i * 90, send: 0.6, release: 0.5,
          });
        }
        this._noiseHit(t + 1.5, 2.4, { gain: 0.22, filter: 620, sweep: 0.18, send: 0.8 });
        this._tone(38, t + 1.6, 2.6, { type: 'sine', gain: 0.3, sweep: 0.5, release: 1.6 });
        break;

      case 'orbShatter':
        this._noiseHit(t, 0.5, { gain: 0.3, filter: 5200, type: 'highpass', sweep: 0.25, send: 0.7 });
        for (let i = 0; i < 7; i++) {
          this._tone(mtof(84 + (Math.random() * 12 | 0)), t + Math.random() * 0.25, 0.5, {
            type: 'triangle', gain: 0.08, send: 0.8, release: 0.4,
          });
        }
        break;

      /* ---- the idol ---- */
      case 'idolRise':
        this.duckMusic(0.15, 6);
        [60, 64, 67, 71, 72].forEach((n, i) =>
          this._tone(mtof(n), t + i * 0.28, 4.5 - i * 0.4, {
            type: 'triangle', gain: 0.11, attack: 0.5, release: 2.5, send: 0.9, filter: 2400,
          }));
        this._noiseHit(t, 3.5, { gain: 0.07, filter: 4200, type: 'highpass', sweep: 1.6, send: 0.9 });
        break;

      case 'victory':
        [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => {
          this._tone(mtof(n), t + i * 0.11, 1.2, { type: 'square', gain: 0.11, filter: 4200, send: 0.6, release: 0.8 });
          this._tone(mtof(n - 12), t + i * 0.11, 1.2, { type: 'triangle', gain: 0.08, send: 0.5, release: 0.8 });
        });
        break;

      case 'stinger':
        this.duckMusic(0.3, 1.6);
        [45, 52, 57, 64].forEach((n, i) =>
          this._tone(mtof(n), t + i * 0.02, 1.6, {
            type: 'sawtooth', gain: 0.12, filter: 1400, attack: 0.01, release: 1.0, send: 0.6,
          }));
        this._noiseHit(t, 0.9, { gain: 0.14, filter: 1800, sweep: 0.2, send: 0.6 });
        break;

      case 'rumble':
        this._tone(34, t, 2.8, { type: 'sine', gain: 0.28, release: 1.8 });
        this._noiseHit(t, 2.6, { gain: 0.13, filter: 240, q: 2, sweep: 0.7, send: 0.5 });
        break;

      case 'select':  this._tone(mtof(84), t, 0.05, { type: 'square', gain: 0.08, filter: 5000 }); break;
      case 'confirm':
        this._tone(mtof(79), t, 0.07, { type: 'square', gain: 0.10, filter: 5000 });
        this._tone(mtof(86), t + 0.06, 0.13, { type: 'square', gain: 0.09, filter: 5000 });
        break;
      /* ---- storm & cinematics ---- */
      case 'thunder': {
        // crack, then the roll
        this._noiseHit(t, 0.16, { gain: 0.30, filter: 5200, type: 'highpass', sweep: 0.2, send: 0.5 });
        this._noiseHit(t + 0.05, 3.4, { gain: 0.34, filter: 260, q: 1.2, sweep: 0.45, send: 0.85 });
        this._tone(38, t + 0.04, 2.8, { type: 'sine', gain: 0.34, sweep: 0.55, release: 1.9 });
        this._tone(52, t + 0.6, 1.8, { type: 'sawtooth', gain: 0.10, filter: 200, release: 1.2, send: 0.7 });
        break;
      }
      case 'stormAmbience':
        // long wind/rain bed
        this._noiseHit(t, 9.0, { gain: 0.16, filter: 900, q: 0.7, sweep: 1.5, send: 0.4 });
        this._noiseHit(t, 9.0, { gain: 0.10, filter: 240, type: 'highpass', sweep: 2.2 });
        break;
      case 'shipBreak':
        this._noiseHit(t, 0.9, { gain: 0.26, filter: 1500, q: 2.5, sweep: 0.25, send: 0.5 });
        this._tone(120, t, 0.8, { type: 'sawtooth', gain: 0.20, sweep: 0.35, filter: 800 });
        this._tone(74, t + 0.2, 1.1, { type: 'square', gain: 0.13, sweep: 0.45, filter: 500, send: 0.5 });
        break;
      case 'dawn':
        this.duckMusic(0.4, 3.2);
        [55, 62, 67, 74].forEach((n, i) =>
          this._tone(mtof(n), t + i * 0.34, 3.6 - i * 0.4, {
            type: 'triangle', gain: 0.085, attack: 0.9, release: 2.2, send: 0.85, filter: 2000,
          }));
        break;
      case 'surfWash':
        this._noiseHit(t, 2.6, { gain: 0.17, filter: 700, q: 1.4, sweep: 2.6, send: 0.5 });
        break;
      case 'descend':
        this._tone(40, t, 2.4, { type: 'sawtooth', gain: 0.22, sweep: 0.55, filter: 320, release: 1.5, send: 0.6 });
        this._noiseHit(t, 2.0, { gain: 0.15, filter: 420, q: 2, sweep: 0.5, send: 0.7 });
        break;
      case 'coin':
        this._pluck(mtof(88), t, 0.24, { gain: 0.14, send: 0.5, bright: 2.0 });
        this._pluck(mtof(95), t + 0.055, 0.32, { gain: 0.11, send: 0.6, bright: 2.0 });
        break;

      case 'page': this._noiseHit(t, 0.11, { gain: 0.075, filter: 3800, type: 'bandpass', q: 2, sweep: 0.5 }); break;

      /* ---- the Lucky Flopper ---- */
      case 'horn':
        // a ship's horn: two low sawtooths a hair apart, so they beat
        this.duckMusic(0.45, 2.6);
        this._tone(58, t, 2.2, { type: 'sawtooth', gain: 0.20, filter: 420, attack: 0.18, release: 1.1, send: 0.7 });
        this._tone(59.5, t, 2.2, { type: 'sawtooth', gain: 0.16, filter: 380, attack: 0.22, release: 1.2, send: 0.7 });
        this._tone(116, t, 2.0, { type: 'triangle', gain: 0.07, filter: 700, attack: 0.2, release: 1.0, send: 0.5 });
        break;
      case 'reel':
        // one drum going past: a short clacking blip, meant to be repeated
        this._tone(520 + R() * 90, t, 0.05, { type: 'square', gain: 0.055, filter: 3200, sweep: 0.7 });
        break;
      case 'lever':
        this._noiseHit(t, 0.14, { gain: 0.13, filter: 1200, type: 'bandpass', q: 3, sweep: 0.4 });
        this._tone(150, t + 0.05, 0.2, { type: 'square', gain: 0.10, sweep: 0.5, filter: 800 });
        break;
      case 'jackpot':
        this.duckMusic(0.5, 1.8);
        [76, 83, 88, 91, 95].forEach((n, i) =>
          this._pluck(mtof(n), t + i * 0.07, 0.5, { gain: 0.15, send: 0.6, bright: 2.4 }));
        for (let i = 0; i < 10; i++) {
          this._pluck(mtof(88 + (i % 3) * 5), t + 0.4 + i * 0.09, 0.22, { gain: 0.10, send: 0.5, bright: 2.2 });
        }
        break;

      /* ---- the listening post ---- */
      case 'hatch':
        // a heavy steel lid coming up on a dry hinge
        this._noiseHit(t, 0.9, { gain: 0.15, filter: 500, q: 2.4, sweep: 1.9, send: 0.5 });
        this._tone(78, t, 0.7, { type: 'sawtooth', gain: 0.13, sweep: 0.6, filter: 400, release: 0.4 });
        this._tone(240, t + 0.2, 0.5, { type: 'square', gain: 0.05, sweep: 0.35, filter: 1600 });
        break;
      case 'ladder':
        for (let i = 0; i < 5; i++) {
          this._noiseHit(t + i * 0.22, 0.09, { gain: 0.09, filter: 2200, type: 'bandpass', q: 4, sweep: 0.6 });
        }
        break;
      case 'terminal':
        // a switch closing and a CRT finding its line
        this._tone(880, t, 0.04, { type: 'square', gain: 0.06, filter: 5200 });
        this._tone(1320, t + 0.04, 0.05, { type: 'square', gain: 0.045, filter: 6000 });
        this._noiseHit(t + 0.02, 0.3, { gain: 0.05, filter: 4200, type: 'bandpass', q: 6, sweep: 0.4 });
        break;
      case 'ping':
        // sonar: one clean tone with a long tail
        this._tone(1180, t, 0.9, { type: 'sine', gain: 0.09, sweep: 0.55, filter: 4000, release: 0.7, send: 0.9 });
        break;
      case 'alert':
        this._tone(220, t, 0.22, { type: 'square', gain: 0.13, filter: 1400 });
        this._tone(180, t + 0.24, 0.28, { type: 'square', gain: 0.13, filter: 1200 });
        break;

      /* ---- the sea ---- */
      case 'wave':
        // a swell arriving and drawing back out
        this._noiseHit(t, 1.5, { gain: 0.10, filter: 340, type: 'lowpass', sweep: 3.4, send: 0.5 });
        this._noiseHit(t + 0.55, 1.4, { gain: 0.06, filter: 1500, type: 'lowpass', sweep: 0.22, send: 0.6 });
        break;

      /* ---- the bar ---- */
      case 'pour': {
        /* Liquid into a glass: filtered noise whose pitch climbs as the glass
           fills, which is the whole reason you can hear a glass filling. */
        this._noiseHit(t, 1.05, { gain: 0.075, filter: 620, type: 'bandpass', q: 3.5, sweep: 2.6, send: 0.28 });
        for (let i = 0; i < 7; i++) {
          this._tone(300 + i * 62, t + i * 0.13, 0.07,
            { type: 'sine', gain: 0.028, filter: 2200, release: 0.05 });
        }
        break;
      }
      case 'fizz':
        // the head settling on a pint
        this._noiseHit(t, 1.9, { gain: 0.045, filter: 7200, type: 'highpass', send: 0.3 });
        break;
      case 'glass':
        // a heavy base set down on wood
        this._tone(150, t, 0.09, { type: 'sine', gain: 0.16, filter: 900, release: 0.07 });
        this._noiseHit(t, 0.10, { gain: 0.10, filter: 2400, type: 'bandpass', q: 2, sweep: 0.4 });
        this._tone(1900, t, 0.16, { type: 'sine', gain: 0.035, release: 0.14, send: 0.5 });
        break;
      case 'clink':
        // two glasses meeting
        this._tone(2350, t, 0.5, { type: 'sine', gain: 0.055, release: 0.42, send: 0.8 });
        this._tone(3130, t + 0.01, 0.42, { type: 'sine', gain: 0.032, release: 0.38, send: 0.8 });
        break;
      case 'gulp':
        this._tone(160, t, 0.10, { type: 'sine', gain: 0.10, sweep: 1.9, release: 0.07 });
        this._tone(140, t + 0.16, 0.10, { type: 'sine', gain: 0.09, sweep: 2.1, release: 0.07 });
        break;
      case 'dart':
        // a tungsten point going into cork
        this._noiseHit(t, 0.06, { gain: 0.16, filter: 3000, type: 'bandpass', q: 3, sweep: 0.25 });
        this._tone(420, t, 0.07, { type: 'triangle', gain: 0.08, sweep: 0.45, release: 0.05 });
        break;
      case 'wire':
        // a dart off the wire, which is the sound of a bad night
        this._tone(3600, t, 0.30, { type: 'sine', gain: 0.06, release: 0.26, send: 0.7 });
        this._tone(2700, t + 0.02, 0.22, { type: 'sine', gain: 0.04, release: 0.2, send: 0.7 });
        break;
      case 'oche':
        // the little wooden knock of a dart being lifted off the board
        this._noiseHit(t, 0.05, { gain: 0.08, filter: 1800, type: 'bandpass', q: 4 });
        break;
    }
  }
}
