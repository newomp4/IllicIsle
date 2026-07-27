/* ===========================================================
   ui.js — HUD, compass, reader, journal, toasts.
   All plain DOM on top of the canvas.
   =========================================================== */

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.el = {
      hud: $('hud'),
      hearts: $('hearts'),
      stamina: $('stamina'),
      staminaWrap: $('stamina-wrap'),
      ammo: $('ammo-count'),
      marks: $('marks'),
      marksCount: $('marks-count'),
      objective: $('objective-text'),
      prompt: $('prompt'),
      promptText: $('prompt-text'),
      compassStrip: $('compass-strip'),
      compass: $('compass'),
      bossBar: $('boss-bar'),
      bossFill: $('boss-fill'),
      bossChip: $('boss-chip'),
      bossPhase: $('boss-phase'),
      toastWrap: $('toast-wrap'),
      dmgFlash: $('dmg-flash'),
      healFlash: $('heal-flash'),
      reader: $('reader'),
      readerHead: $('reader-head'),
      readerBody: $('reader-body'),
      journal: $('journal'),
      journalEntries: $('journal-entries'),
    };

    this._hearts = -1;
    this._maxHearts = -1;
    this._ammo = -1;
    this._marks = -1;
    this._objective = '';
    this._promptText = null;

    this.readerActive = false;
    this._typeTimer = null;
    this._onReaderDone = null;

    this.compassMarks = [];
    this._buildCompass();
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  /* ---------- hearts ---------- */
  setHearts(hp, max) {
    if (hp === this._hearts && max === this._maxHearts) return;
    const lost = hp < this._hearts;
    this._hearts = hp; this._maxHearts = max;
    this.el.hearts.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const d = document.createElement('div');
      d.className = 'heart' + (i < hp ? '' : ' empty');
      if (lost && i === hp) d.className += ' hurt';
      this.el.hearts.appendChild(d);
    }
  }

  setStamina(v) {
    this.el.stamina.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
    this.el.staminaWrap.classList.toggle('low', v < 0.3);
  }

  setAmmo(n) {
    if (n === this._ammo) return;
    this._ammo = n;
    this.el.ammo.textContent = String(n);
  }

  setMarks(n, total) {
    if (n === this._marks) return;
    this._marks = n;
    this.el.marksCount.textContent = String(n);
    this.el.marks.classList.toggle('full', n >= total);
  }

  setObjective(text) {
    if (text === this._objective) return;
    this._objective = text;
    this.el.objective.textContent = text;
  }

  /* ---------- prompt ---------- */
  setPrompt(text) {
    if (text === this._promptText) return;
    this._promptText = text;
    if (text) {
      this.el.promptText.textContent = text;
      this.el.prompt.classList.remove('hidden');
    } else {
      this.el.prompt.classList.add('hidden');
    }
  }

  /* ---------- toasts ---------- */
  toast(text, kind = 'gold', ms = 2600) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toastWrap.appendChild(d);
    setTimeout(() => {
      d.classList.add('out');
      setTimeout(() => d.remove(), 450);
    }, ms);
    // never let them stack forever
    while (this.el.toastWrap.children.length > 4) this.el.toastWrap.firstChild.remove();
  }

  flashDamage() {
    const f = this.el.dmgFlash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  flashHeal() {
    const f = this.el.healFlash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  /* ---------- boss bar ---------- */
  showBoss(on) {
    this.el.bossBar.classList.toggle('hidden', !on);
    if (on) {
      this.el.bossFill.style.width = '100%';
      this.el.bossChip.style.width = '100%';
    }
  }

  setBoss(frac, phaseLabel) {
    const pct = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.el.bossFill.style.width = pct;
    this.el.bossChip.style.width = pct;
    if (phaseLabel) this.el.bossPhase.textContent = phaseLabel;
  }

  /* ---------- compass ---------- */
  _buildCompass() {
    this.compassPois = [];
  }

  setCompassPois(list) {
    // list: [{ label, x, z, kind }]
    this.el.compassStrip.innerHTML = '';
    this.compassMarks = [];
    const cardinals = [
      { label: 'N', a: Math.PI, card: true },
      { label: 'E', a: -Math.PI / 2, card: true },
      { label: 'S', a: 0, card: true },
      { label: 'W', a: Math.PI / 2, card: true },
      { label: 'NE', a: Math.PI * 0.75, card: false, small: true },
      { label: 'NW', a: -Math.PI * 0.75, card: false, small: true },
      { label: 'SE', a: -Math.PI * 0.25, card: false, small: true },
      { label: 'SW', a: Math.PI * 0.25, card: false, small: true },
    ];
    for (const c of cardinals) {
      const d = document.createElement('div');
      d.className = 'cmark' + (c.card ? ' card' : '');
      d.textContent = c.label;
      if (c.small) d.style.opacity = '0.5';
      this.el.compassStrip.appendChild(d);
      this.compassMarks.push({ el: d, fixedAngle: c.a });
    }
    for (const p of list) {
      const d = document.createElement('div');
      d.className = `cmark ${p.kind || 'poi'}`;
      d.textContent = p.label;
      this.el.compassStrip.appendChild(d);
      this.compassMarks.push({ el: d, poi: p });
    }
    this.compassPois = list;
  }

  updateCompass(yaw, px, pz) {
    const W = this.el.compass.clientWidth;
    const HALF_FOV = 1.15; // radians shown either side of centre
    for (const m of this.compassMarks) {
      let target;
      if (m.poi) {
        if (m.poi.hidden) { m.el.style.display = 'none'; continue; }
        m.el.style.display = '';
        target = Math.atan2(m.poi.x - px, m.poi.z - pz);
      } else {
        target = m.fixedAngle;
      }
      let d = target - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > HALF_FOV) { m.el.style.opacity = '0'; continue; }
      const x = W / 2 + (d / HALF_FOV) * (W / 2);
      m.el.style.left = `${x}px`;
      m.el.style.opacity = m.poi ? '0.95' : (m.el.classList.contains('card') ? '1' : '0.5');
    }
  }

  /* ---------- reader (typewriter) ---------- */
  showReader(head, body, onDone) {
    this.readerActive = true;
    this._onReaderDone = onDone;
    this.el.readerHead.textContent = head;
    this.el.readerBody.textContent = '';
    this.el.reader.classList.remove('hidden');
    this._fullText = body;

    let i = 0;
    this._typing = true;
    clearInterval(this._typeTimer);
    this._typeTimer = setInterval(() => {
      if (i >= body.length) {
        clearInterval(this._typeTimer);
        this._typing = false;
        return;
      }
      const ch = body[i++];
      this.el.readerBody.textContent += ch;
      if (ch !== ' ' && ch !== '\n' && i % 2 === 0) this.audio?.sfx('page');
    }, 18);
  }

  /** Returns true if the reader consumed the input. */
  advanceReader() {
    if (!this.readerActive) return false;
    if (this._typing) {
      // first press: dump the whole page
      clearInterval(this._typeTimer);
      this._typing = false;
      this.el.readerBody.textContent = this._fullText || this.el.readerBody.textContent;
      return true;
    }
    this.closeReader();
    return true;
  }

  closeReader() {
    clearInterval(this._typeTimer);
    this._typing = false;
    this.readerActive = false;
    this.el.reader.classList.add('hidden');
    const cb = this._onReaderDone;
    this._onReaderDone = null;
    if (cb) cb();
  }

  /* ---------- journal ---------- */
  renderJournal(entries) {
    this.el.journalEntries.innerHTML = '';
    for (const e of entries) {
      const d = document.createElement('div');
      d.className = 'jentry' + (e.found ? '' : ' locked');
      const h = document.createElement('h3');
      h.textContent = e.found ? e.title : '??? — NOT YET FOUND';
      const p = document.createElement('p');
      p.textContent = e.found ? e.text : e.hint;
      d.appendChild(h); d.appendChild(p);
      this.el.journalEntries.appendChild(d);
    }
  }

  toggleJournal(entries) {
    const open = this.el.journal.classList.contains('hidden');
    if (open) {
      this.renderJournal(entries);
      this.el.journal.classList.remove('hidden');
    } else {
      this.el.journal.classList.add('hidden');
    }
    return open;
  }

  get journalOpen() { return !this.el.journal.classList.contains('hidden'); }
  closeJournal() { this.el.journal.classList.add('hidden'); }
}
