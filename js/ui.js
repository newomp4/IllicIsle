/* ===========================================================
   ui.js — HUD, compass, reader, journal, chart, dial puzzle.
   All plain DOM on top of the canvas.
   =========================================================== */

const $ = (id) => document.getElementById(id);

/* ===========================================================
   GLYPHS — drawn as chunky pixel icons, shared by the chart
   and the door dials so the puzzle reads the same in both.
   =========================================================== */
export function drawGlyph(ctx, name, x, y, size, color = '#ffd24a') {
  const u = size / 16;                       // one "pixel" of the 16x16 grid
  const px = (gx, gy, w = 1, h = 1) => ctx.fillRect(x + gx * u, y + gy * u, w * u, h * u);
  ctx.fillStyle = color;

  switch (name) {
    case 'SUN': {
      px(6, 6, 4, 4);
      for (const [gx, gy] of [[7, 2], [7, 12], [2, 7], [12, 7]]) px(gx, gy, 2, 2);
      for (const [gx, gy] of [[3, 3], [11, 3], [3, 11], [11, 11]]) px(gx, gy, 2, 2);
      break;
    }
    case 'MOON': {
      // crescent: a disc with a bite taken out of it
      for (let gy = 2; gy < 14; gy++) {
        const dy = gy - 8;
        const half = Math.sqrt(Math.max(0, 36 - dy * dy));
        const x0 = Math.round(8 - half), x1 = Math.round(8 + half);
        const bx0 = Math.round(11 - Math.sqrt(Math.max(0, 30 - dy * dy)));
        for (let gx = x0; gx < x1; gx++) {
          if (gx >= bx0) continue;
          px(gx, gy);
        }
      }
      break;
    }
    case 'EYE': {
      for (let gy = 5; gy < 11; gy++) {
        const t = Math.abs(gy - 7.5) / 3;
        const half = Math.round(7 * (1 - t * t));
        px(8 - half, gy, half * 2, 1);
      }
      ctx.fillStyle = '#1a1006';
      px(6, 6, 4, 4);
      ctx.fillStyle = color;
      px(7, 7, 2, 2);
      break;
    }
    case 'SPIRAL': {
      const pts = [];
      for (let i = 0; i < 46; i++) {
        const a = i * 0.42;
        const r = 0.8 + i * 0.135;
        pts.push([Math.round(8 + Math.cos(a) * r), Math.round(8 + Math.sin(a) * r)]);
      }
      const seen = new Set();
      for (const [gx, gy] of pts) {
        const k = gx + ',' + gy;
        if (seen.has(k) || gx < 0 || gy < 0 || gx > 15 || gy > 15) continue;
        seen.add(k);
        px(gx, gy);
      }
      break;
    }
  }
}

/* A 9x8 pixel heart, drawn once and used as a background image so the HUD
   is genuinely pixel art rather than a CSS clip-path silhouette. */
function makeHeartSprite(full) {
  const M = [
    '.XX.XX...',
    'XOOXOOX..',
    'XOOOOOOX.',
    'XOOOOOOX.',
    '.XOOOOX..',
    '..XOOX...',
    '...XX....',
  ];
  const S = 4, W = 9, H = 7;
  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const ch = M[j][i];
      if (ch === '.') continue;
      if (ch === 'X') x.fillStyle = full ? '#7a1410' : '#2e1210';
      else x.fillStyle = full ? (j < 2 ? '#ff6a5a' : '#e0453a') : '#4a1c18';
      x.fillRect(i * S, j * S, S, S);
    }
  }
  // highlight glint
  if (full) { x.fillStyle = '#ffb0a4'; x.fillRect(S, S, S, S); x.fillRect(S * 2, S, S, S); }
  return c.toDataURL();
}

let HEART_FULL = null, HEART_EMPTY = null;

export class UI {
  constructor(audio) {
    if (!HEART_FULL) { HEART_FULL = makeHeartSprite(true); HEART_EMPTY = makeHeartSprite(false); }
    this.audio = audio;
    this.el = {
      hud: $('hud'),
      hearts: $('hearts'), stamina: $('stamina'), staminaWrap: $('stamina-wrap'),
      ammo: $('ammo-count'), marks: $('marks'), marksCount: $('marks-count'),
      objective: $('objective-text'), timer: $('run-timer'),
      prompt: $('prompt'), promptText: $('prompt-text'),
      compassStrip: $('compass-strip'), compass: $('compass'),
      bossBar: $('boss-bar'), bossFill: $('boss-fill'), bossChip: $('boss-chip'), bossPhase: $('boss-phase'),
      toastWrap: $('toast-wrap'), dmgFlash: $('dmg-flash'), healFlash: $('heal-flash'),
      reader: $('reader'), readerHead: $('reader-head'), readerBody: $('reader-body'),
      journal: $('journal'), journalEntries: $('journal-entries'),
      map: $('map'), mapCanvas: $('map-canvas'), mapLegend: $('map-legend'),
      dials: $('dials'), dialRow: $('dial-row'), dialHint: $('dial-hint'),
      shop: $('shop'), shopList: $('shop-list'), shopCoins: $('shop-coins'),
      lightning: $('lightning'),
    };

    this._hearts = -1; this._maxHearts = -1;
    this._ammo = -1; this._marks = -1;
    this._objective = ''; this._promptText = null;

    this.readerActive = false;
    this._typeTimer = null;
    this._onReaderDone = null;
    this.compassMarks = [];
    this.compassPois = [];
    this._dialCanvases = [];
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
      d.className = 'heart' + (i < hp ? '' : ' empty') + (lost && i === hp ? ' hurt' : '');
      d.style.backgroundImage = `url(${i < hp ? HEART_FULL : HEART_EMPTY})`;
      this.el.hearts.appendChild(d);
    }
  }

  setStamina(v) {
    this.el.stamina.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
    this.el.staminaWrap.classList.toggle('low', v < 0.3);
  }
  setAmmo(n) { if (n !== this._ammo) { this._ammo = n; this.el.ammo.textContent = String(n); } }
  setMarks(n, total) {
    if (n === this._marks) return;
    this._marks = n;
    this.el.marksCount.textContent = String(n);
    this.el.marks.classList.toggle('full', n >= total);
  }
  setTimer(seconds) {
    if (!this.el.timer) return;
    const s = Math.max(0, seconds);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(Math.floor(s % 60)).padStart(2, '0');
    const cs = String(Math.floor((s * 100) % 100)).padStart(2, '0');
    this.el.timer.textContent = `${mm}:${ss}.${cs}`;
  }

  setObjective(text) {
    if (text === this._objective) return;
    this._objective = text;
    this.el.objective.textContent = text;
  }

  setPrompt(text) {
    if (text === this._promptText) return;
    this._promptText = text;
    if (text) { this.el.promptText.textContent = text; this.el.prompt.classList.remove('hidden'); }
    else this.el.prompt.classList.add('hidden');
  }

  /* ---------- toasts ---------- */
  toast(text, kind = 'gold', ms = 2600) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.el.toastWrap.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, ms);
    while (this.el.toastWrap.children.length > 4) this.el.toastWrap.firstChild.remove();
  }

  flashDamage() { const f = this.el.dmgFlash; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
  flashHeal() { const f = this.el.healFlash; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

  /* ---------- boss bar ---------- */
  showBoss(on) {
    this.el.bossBar.classList.toggle('hidden', !on);
    if (on) { this.el.bossFill.style.width = '100%'; this.el.bossChip.style.width = '100%'; }
  }
  setBoss(frac, phaseLabel) {
    const pct = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    this.el.bossFill.style.width = pct;
    this.el.bossChip.style.width = pct;
    if (phaseLabel) this.el.bossPhase.textContent = phaseLabel;
  }

  /* ---------- compass ---------- */
  setCompassPois(list) {
    this.el.compassStrip.innerHTML = '';
    this.compassMarks = [];
    const cardinals = [
      { label: 'N', a: Math.PI, card: true }, { label: 'E', a: -Math.PI / 2, card: true },
      { label: 'S', a: 0, card: true }, { label: 'W', a: Math.PI / 2, card: true },
      { label: '+', a: Math.PI * 0.75 }, { label: '+', a: -Math.PI * 0.75 },
      { label: '+', a: -Math.PI * 0.25 }, { label: '+', a: Math.PI * 0.25 },
    ];
    for (const c of cardinals) {
      const d = document.createElement('div');
      d.className = 'cmark' + (c.card ? ' card' : '');
      d.textContent = c.label;
      this.el.compassStrip.appendChild(d);
      this.compassMarks.push({ el: d, fixedAngle: c.a, faint: !c.card });
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
    const HALF_FOV = 1.15;
    for (const m of this.compassMarks) {
      let target;
      if (m.poi) {
        if (m.poi.hidden) { m.el.style.display = 'none'; continue; }
        m.el.style.display = '';
        target = Math.atan2(m.poi.x - px, m.poi.z - pz);
      } else target = m.fixedAngle;
      let d = target - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > HALF_FOV) { m.el.style.opacity = '0'; continue; }
      m.el.style.left = `${W / 2 + (d / HALF_FOV) * (W / 2)}px`;
      m.el.style.opacity = m.poi ? '0.95' : (m.faint ? '0.35' : '1');
    }
  }

  /* ---------- reader ---------- */
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
      if (i >= body.length) { clearInterval(this._typeTimer); this._typing = false; return; }
      const ch = body[i++];
      this.el.readerBody.textContent += ch;
      if (ch !== ' ' && ch !== '\n' && i % 2 === 0) this.audio?.sfx('page');
    }, 16);
  }

  advanceReader() {
    if (!this.readerActive) return false;
    if (this._typing) {
      clearInterval(this._typeTimer);
      this._typing = false;
      this.el.readerBody.textContent = this._fullText;
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
      h.textContent = e.found ? e.title : 'NOT YET FOUND';
      const p = document.createElement('p');
      p.textContent = e.found ? e.text : e.hint;
      d.appendChild(h); d.appendChild(p);
      this.el.journalEntries.appendChild(d);
    }
  }
  toggleJournal(entries) {
    const open = this.el.journal.classList.contains('hidden');
    if (open) { this.renderJournal(entries); this.el.journal.classList.remove('hidden'); }
    else this.el.journal.classList.add('hidden');
    return open;
  }
  get journalOpen() { return !this.el.journal.classList.contains('hidden'); }
  closeJournal() { this.el.journal.classList.add('hidden'); }

  /* ===========================================================
     THE CHART
     ===========================================================
     Drawn straight from the height function so the coastline on
     the parchment is the coastline you're standing on.
  */
  get mapOpen() { return !this.el.map.classList.contains('hidden'); }

  toggleMap(data) {
    const open = this.el.map.classList.contains('hidden');
    if (open) { this.drawMap(data); this.el.map.classList.remove('hidden'); }
    else this.el.map.classList.add('hidden');
    return open;
  }
  closeMap() { this.el.map.classList.add('hidden'); }

  drawMap(data) {
    const cv = this.el.mapCanvas;
    const x = cv.getContext('2d');
    const S = cv.width;
    const R = data.radius;
    const toPx = (wx, wz) => [S / 2 + (wx / R) * (S / 2 - 12), S / 2 + (wz / R) * (S / 2 - 12)];

    // parchment
    x.fillStyle = '#e2cfa2';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 2200; i++) {
      x.fillStyle = `rgba(120,92,52,${Math.random() * 0.11})`;
      x.fillRect((Math.random() * S) | 0, (Math.random() * S) | 0, 1 + ((Math.random() * 2) | 0), 1);
    }

    // land mass, sampled from the real terrain
    const STEP = 3;
    for (let py = 0; py < S; py += STEP) {
      for (let pxx = 0; pxx < S; pxx += STEP) {
        const wx = ((pxx - S / 2) / (S / 2 - 12)) * R;
        const wz = ((py - S / 2) / (S / 2 - 12)) * R;
        const h = data.heightAt(wx, wz);
        if (h < 0) continue;
        let col;
        if (h < 2.4) col = '#cbb47c';                 // beach
        else if (h < 12) col = '#8b9c62';             // low jungle
        else if (h < 26) col = '#6d8450';             // high jungle
        else col = '#8a8468';                         // bare ridge
        x.fillStyle = col;
        x.fillRect(pxx, py, STEP, STEP);
      }
    }

    // coast hatching
    x.strokeStyle = 'rgba(70,52,26,.5)';
    x.lineWidth = 1;
    for (let a = 0; a < Math.PI * 2; a += 0.02) {
      let rr = R;
      for (let r = R; r > 20; r -= 1.5) {
        if (data.heightAt(Math.cos(a) * r, Math.sin(a) * r) > 0) { rr = r; break; }
      }
      const [sx, sy] = toPx(Math.cos(a) * rr, Math.sin(a) * rr);
      x.fillStyle = 'rgba(70,52,26,.45)';
      x.fillRect(sx, sy, 1.6, 1.6);
    }

    const label = (text, sx, sy, col = '#3f2f14') => {
      x.font = 'bold 9px "Courier New", monospace';
      x.textAlign = 'center';
      x.fillStyle = 'rgba(226,207,162,.85)';
      x.fillText(text, sx + 1, sy + 1);
      x.fillStyle = col;
      x.fillText(text, sx, sy);
    };

    // wreck
    if (data.wreck) {
      const [sx, sy] = toPx(data.wreck.x, data.wreck.z);
      x.strokeStyle = '#5a3a18'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(sx - 5, sy + 3); x.lineTo(sx + 5, sy + 3); x.lineTo(sx + 3, sy - 2); x.stroke();
      label('WRECK', sx, sy + 15);
    }
    if (data.rogue) {
      const [sx, sy] = toPx(data.rogue.x, data.rogue.z);
      label('"ROGUE"', sx, sy + 4, '#7a2418');
    }

    // pendulums
    for (const m of data.marks) {
      const [sx, sy] = toPx(m.x, m.z);
      x.strokeStyle = m.found ? '#2f6a4a' : '#8a2418';
      x.lineWidth = 2.5;
      x.beginPath();
      x.moveTo(sx - 6, sy - 6); x.lineTo(sx + 6, sy + 6);
      x.moveTo(sx + 6, sy - 6); x.lineTo(sx - 6, sy + 6);
      x.stroke();
      label(m.label, sx, sy - 10);
      if (m.glyph) drawGlyph(x, m.glyph, sx - 7, sy + 8, 14, '#2f6a4a');
    }

    // temple
    if (data.temple) {
      const [sx, sy] = toPx(data.temple.x, data.temple.z);
      x.fillStyle = '#4a3a1a';
      x.fillRect(sx - 7, sy - 2, 14, 8);
      x.fillRect(sx - 4, sy - 6, 8, 5);
      x.fillStyle = '#1a1206';
      x.fillRect(sx - 2, sy + 1, 4, 5);
      label('TEMPLE', sx, sy + 18);
    }

    // you
    if (data.player) {
      const [sx, sy] = toPx(data.player.x, data.player.z);
      x.fillStyle = '#c02a1a';
      x.beginPath(); x.arc(sx, sy, 4, 0, 7); x.fill();
      x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke();
    }

    // compass rose
    x.fillStyle = '#3f2f14';
    x.font = 'bold 11px "Courier New", monospace';
    x.textAlign = 'center';
    x.fillText('N', S - 26, 24);
    x.beginPath();
    x.moveTo(S - 26, 30); x.lineTo(S - 30, 44); x.lineTo(S - 22, 44);
    x.closePath(); x.fill();

    // border
    x.strokeStyle = '#5c3f1c'; x.lineWidth = 4;
    x.strokeRect(2, 2, S - 4, S - 4);

    // legend
    const remaining = data.marks.filter((m) => !m.found);
    this.el.mapLegend.innerHTML = remaining.length
      ? `<b>${remaining.length}</b> Pendulum${remaining.length === 1 ? '' : 's'} still unread. ` +
        `Red crosses mark the ones you haven't reached.`
      : `All four Pendulums read. The door will take the order now.`;
  }

  /* ===========================================================
     DIAL PUZZLE
     =========================================================== */
  get dialsOpen() { return !this.el.dials.classList.contains('hidden'); }

  openDials(state, sel, hint) {
    this.el.dialHint.textContent = hint
      ? `Recorded from the Pendulums:  ${hint}`
      : 'Four sockets. The Pendulums know the order.';
    this.el.dialRow.innerHTML = '';
    this._dialCanvases = [];
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'dial';
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const span = document.createElement('span');
      span.textContent = ['I', 'II', 'III', 'IV'][i];
      d.appendChild(c); d.appendChild(span);
      d.addEventListener('click', () => {
        this._onDialClick?.(i);
      });
      this.el.dialRow.appendChild(d);
      this._dialCanvases.push({ el: d, ctx: c.getContext('2d') });
    }
    this.renderDials(state, sel);
    this.el.dials.classList.remove('hidden');
  }

  renderDials(state, sel) {
    const GLYPHS = ['SUN', 'MOON', 'EYE', 'SPIRAL'];
    this._dialCanvases.forEach((d, i) => {
      const x = d.ctx;
      x.clearRect(0, 0, 32, 32);
      drawGlyph(x, GLYPHS[state[i]], 0, 0, 32, i === sel ? '#ffe89a' : '#c8a94a');
      d.el.classList.toggle('sel', i === sel);
    });
  }

  shakeDials() {
    const row = this.el.dialRow;
    row.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' },
       { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }],
      { duration: 220, iterations: 2 }
    );
  }

  closeDials() { this.el.dials.classList.add('hidden'); }

  /* ===========================================================
     FERDY'S SHOP
     =========================================================== */
  get shopOpen() { return !this.el.shop.classList.contains('hidden'); }

  openShop(stock, coins, onBuy) {
    this.el.shopCoins.textContent = String(coins);
    this.el.shopList.innerHTML = '';
    for (const it of stock) {
      const row = document.createElement('button');
      row.className = 'shop-row' + (it.owned ? ' owned' : (it.afford ? '' : ' broke'));
      row.innerHTML =
        `<span class="shop-name">${it.name}</span>` +
        `<span class="shop-desc">${it.desc}</span>` +
        `<span class="shop-cost">${it.owned ? 'SOLD' : it.cost + ' \u25C9'}</span>`;
      if (!it.owned) row.addEventListener('click', () => onBuy(it.id));
      this.el.shopList.appendChild(row);
    }
    this.el.shop.classList.remove('hidden');
  }

  shakeShop() {
    this.el.shopList.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' },
       { transform: 'translateX(7px)' }, { transform: 'translateX(0)' }],
      { duration: 200, iterations: 2 });
  }

  closeShop() { this.el.shop.classList.add('hidden'); }

  /** Full-screen white pop for a lightning strike. */
  flashLightning() {
    const f = this.el.lightning;
    if (!f) return;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
}
