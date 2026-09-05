import test from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../js/lib/hud.js';
import { UI } from '../js/ui.js';
import { recordText } from '../js/lib/bitfont.js';

// Use the real bitmap renderer's recording API so assertions measure the
// actual glyph rectangles, including normalization and every alignment mode.
function canvas() {
  const stack = [];
  const context = new Proxy({
    globalAlpha: 1,
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop(); },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  return { width: 320, height: 224, getContext() { return context; } };
}
globalThis.document = { createElement: canvas, getElementById() { return null; } };

function mpData() {
  return {
    role: 'agent', coins: 99999, stamina: .84,
    myTasks: ['WIND THE WEST PENDULUM', 'WIND THE RIDGE PENDULUM', 'LIGHT THE BRAZIERS',
      "OPEN TASHA'S PANTRY", 'RETURN THE FILAMENT'].map(name => ({ name, steps: 2, step: 0, done: false })),
    belt: Array.from({ length: 9 }, (_, i) => ({ icon: 'coin', count: i * 11 + 2, active: i === 1 })),
    passives: ['coin', 'vest'],
    cools: [{ kind: 'storm', left: 15, total: 30 }, { kind: 'lights', left: 20, total: 30 },
      { kind: 'work', left: 10, total: 60 }],
    killIn: 9, killTotal: 30, tasksTotal: 35, tasksDone: 5,
    sabotage: { name: 'ISLAND BLACKOUT', left: 99, fatal: true },
  };
}
function capture(draw) {
  const boxes = recordText(true);
  try { draw(); } finally { recordText(false); }
  return boxes;
}
function assertLayout(boxes, width, height, fixture) {
  for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height,
    `${fixture}: outside framebuffer: ${JSON.stringify(b)}`);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    assert.ok(!overlap, `${fixture}: overlapping text: ${a.t} / ${b.t}`);
  }
}

test('HUD text stays readable across resolutions, busy roles and notification states', () => {
  for (const [w, h] of [[240, 180], [320, 180], [320, 224], [402, 224], [640, 360]]) {
    for (const mode of ['solo', 'boss', 'mp', 'tools', 'printer', 'assay', 'ghost', 'task', 'ghostTask']) {
      for (const notice of ['none', 'toast', 'popup']) {
        const hud = new Hud(); hud.setSize(w, h);
        const d = hud.data; d.visible = true; d.coins = 99999;
        d.objective = 'Find the western pendulum and read the island chart.';
        d.prompt = 'Talk to Quezetriel Quebolius the extraordinarily verbose castaway';
        if (mode === 'boss') d.boss = { name: 'HECTOR - EL BASS PRESIDENTE', frac: .6, chip: .7, phase: 'TERM TWO' };
        if (!['solo', 'boss'].includes(mode)) d.mp = mpData();
        if (mode === 'tools') d.mp.scanner = { on: true, lock: true, t: 1, count: 1, index: 1,
          name: 'QUEZETRIEL QUEBOLIUS', dist: 59, angle: 0, rel: 0, band: .5 };
        if (['tools', 'printer'].includes(mode)) d.mp.printer = { on: true, at: 0,
          list: [{ who: 'QUEZETRIEL QUEBOLIUS', what: 'THE LANTERN', price: 25, t: 2 }] };
        if (mode === 'assay') d.mp.ufo = { on: true, held: true, left: 45,
          scan: { name: 'QUEZETRIEL QUEBOLIUS', colour: 0xffd24a, done: true, agent: true } };
        if (['ghost', 'ghostTask'].includes(mode)) { d.mp.alive = false; d.mp.watching = 'QUEZETRIEL QUEBOLIUS'; }
        if (['task', 'ghostTask'].includes(mode)) d.mp.task = {
          name: 'CARRY THE FILAMENT TO THE RIDGE PENDULUM', verb: 'SHOULDERING', k: .7, holding: true,
        };
        if (notice === 'toast') hud.toast('FERDI KEEPS THE PEACE - NOBODY DIES HERE. PLEASE KEEP THE WHOLE INSTRUCTION VISIBLE.', 'jade');
        if (notice === 'popup') hud.showPopup('THE EXTRAORDINARILY LONG CHORE IS COMPLETED',
          'PRESS V WHERE YOU WANT EACH ONE', 'coin', 'TASK DONE');
        const fixture = `${w}x${h} ${mode} ${notice}`;
        assertLayout(capture(() => hud.render(1)), w, h, fixture);
      }
    }
  }
});

test('compass cardinals and hidden places survive repeated HUD priority sorting', () => {
  const ui = new UI();
  const places = Array.from({ length: 12 }, (_, i) => ({ label: `FIX${i}`, kind: 'fix', x: i * 10, z: 100 }));
  ui.setCompassPois(places);
  for (let frame = 0; frame < 30; frame++) {
    places[2].hidden = frame % 2 === 0;
    ui.updateCompass(frame * .1, 0, 0);
    ui.hud._compass(160, 2, ui.hud.data.compass, 130);
    const marks = ui.hud.data.compass.marks;
    const cardinals = marks.filter(m => ['card', 'inter'].includes(m.kind));
    assert.equal(cardinals.length, 8);
    assert.equal(new Set(cardinals.map(m => m.label)).size, 8);
    assert.equal(marks.some(m => m.label === 'FIX2'), !places[2].hidden);
  }
});

test('notices take turns, warnings interrupt cards, and menu time does not consume reading time', () => {
  const hud = new Hud(); hud.data.visible = true;
  hud.toast('A PURCHASE NOTICE', 'jade');
  hud.showPopup('A RELIC', 'SAFE IN THE JOURNAL', 'syncoin');
  hud.render(0);
  assert.ok(hud._popupShown);
  assert.equal(hud._toastShown, null);
  hud.toast('NOT ENOUGH SYNCOIN', 'bad'); hud.render(0);
  assert.equal(hud._toastShown.text, 'NOT ENOUGH SYNCOIN');
  assert.equal(hud._popupShown, null);
  const popupT = hud.data.popup.t;
  const warningLife = hud.data.toasts.at(-1).life;
  assert.deepEqual(capture(() => hud.renderOverlay(0, 'pause')), []);
  hud.update(2);
  assert.equal(hud.data.popup.t, popupT);
  assert.equal(hud.data.toasts.at(-1).life, warningLife);
  assert.deepEqual(capture(() => hud.renderOverlay(0, 'shop')), []);
  hud.renderOverlay(0, null);
  assert.equal(hud._toastShown.text, 'NOT ENOUGH SYNCOIN');
});

test('long notices expose their final instruction without growing taller', () => {
  const hud = new Hud(); hud.data.visible = true;
  const text = 'FERDI KEEPS THE PEACE AND ALL YOUR FRIENDS SAFE. PRESS AGAIN TO DROP IT.';
  hud.toast(text, 'jade', 800);
  const seen = new Set();
  for (let t = 0; t < 15 && hud.data.toasts.length; t += .2) {
    for (const b of capture(() => hud._toasts(160, 22, 92, 45))) seen.add(b.t);
    hud.update(.2);
  }
  assert.ok([...seen].some(line => line.includes('DROP IT.')));
  assert.equal(hud.data.toasts.length, 0);
  hud.showPopup('YOU HAVE FINISHED A VERY LONG CHORE', 'PRESS V WHERE YOU WANT EACH ONE', 'task', 'TASK DONE');
  const popupSeen = new Set();
  for (let t = 0; t < 15 && hud.data.popup; t += .2) {
    for (const b of capture(() => hud._popup(320, 180, hud.data.popup,
      { cx: 160, top: 22, width: 128, bottom: 58 }))) popupSeen.add(b.t);
    hud.update(.2);
  }
  assert.ok([...popupSeen].some(line => line.includes('EACH ONE')));
  assert.equal(hud.data.popup, null);
});

test('wrapped cutscene subtitles stay above the letterbox and skip hint', () => {
  const hud = new Hud(); hud.setSize(240, 180);
  Object.assign(hud.data, { cinema: true, cinemaFade: 1, cinemaSkip: true,
    cinemaText: 'This caption has enough words to wrap across several lines on the narrow framebuffer.\nA second paragraph is still readable.' });
  const boxes = capture(() => hud.renderCinema(0));
  assertLayout(boxes, 240, 180, 'cinema');
  assert.ok(boxes.filter(b => b.t !== 'ANY KEY TO SKIP').every(b => b.y + b.h < 160));
});

test('HUD numeric state clamps invalid and out-of-range inputs', () => {
  const ui = new UI();
  ui.setStamina(4); assert.equal(ui.hud.data.stamina, 1);
  ui.setStamina(-1); assert.equal(ui.hud.data.stamina, 0);
  ui.setHearts(8, 5); assert.equal(ui.hud.data.hp, 5);
  ui.setHearts(-4, NaN); assert.equal(ui.hud.data.hp, 0); assert.equal(ui.hud.data.maxHp, 5);
  ui.setCoins(-3); assert.equal(ui.hud.data.coins, 0);
  ui.setAmmo(NaN); assert.equal(ui.hud.data.ammo, 0);
});
