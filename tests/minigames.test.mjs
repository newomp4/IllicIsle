import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as DARTS from '../js/mp/darts.js';
import * as BJ from '../js/mp/blackjack.js';
import { textWidth, wrapText, fitText } from '../js/lib/bitfont.js';
import { MINIGAMES, bindText } from '../js/mp/minigames.js';

// The darts and blackjack screens, run without a canvas (same harness as
// screens-regression.test.mjs, but with the real rules modules wired in).
const source = (await readFile(new URL('../js/lib/screens.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
const context = vm.createContext({
  console, Math, performance, textWidth, wrapText, fitText,
  parseRoomCode: () => '', roomInviteURL: () => '',
  setTimeout() { return 0; }, clearTimeout() {},
  drawText() {}, panel() {}, ditherRect() {}, drawRelicIcon() {}, drawShopIcon() {}, drawPoiIcon() {},
  POI_ICONS: {}, POI_ICON_W: 12, COLOURS: [{ id: 'gold', hex: 0xffd24a }],
  SABOTAGE_DEFS: {}, MINIGAMES, bindText, DARTS, STOCK: {}, FOOD: {}, DRINKS: {},
  shelf() { return []; }, VENDOR_IDS: [], SCHLARNA_N: 6, FEED_H: 10, FEED_W: 10, THUMB_H: 5, THUMB_W: 5,
  document: { createElement() { return { getContext: () => new Proxy({}, { get: () => () => {} }) }; } },
  localStorage: { getItem() { return ''; } }, location: { hash: '' },
});
vm.runInContext(`${source}\nglobalThis.screensAPI = { SCREENS };`, context);
const { SCREENS } = context.screensAPI;

function wallet(coins, { refuse = false } = {}) {
  const g = {
    coins, settled: [], staked: [], audio: { sfx() {} }, bjRules: BJ,
    afterOverlayClose() {},
    dartsStake(n) { if (refuse || g.coins < n) return false; g.coins -= n; g.staked.push(n); return true; },
    dartsSettle(n) { g.settled.push(n); g.coins += n; },
    bjStake(n) { if (refuse || g.coins < n) return false; g.coins -= n; g.staked.push(n); return true; },
    bjSettle(n) { g.settled.push(n); g.coins += n; },
  };
  return g;
}

test('Quezetriel never aims a perfect dart that busts him from 61', () => {
  // rand() = 1 makes the Box-Muller wobble exactly zero: a dead-centre throw.
  const leg = DARTS.newLeg(10);
  leg.turn = 'him'; leg.him = 61; leg.turnStart = 61;
  const th = DARTS.hisThrow(61, () => 1);
  const r = DARTS.throwDart(leg, th.x, th.y);
  assert.equal(r.bust, false, `aimed ${th.aim.why} and busted`);
  // and every finish-able score he aims at with a perfect hand never busts
  for (let left = 2; left <= DARTS.START; left++) {
    const l2 = DARTS.newLeg(10);
    l2.turn = 'him'; l2.him = left; l2.turnStart = left;
    const t2 = DARTS.hisThrow(left, () => 1);
    assert.equal(DARTS.throwDart(l2, t2.x, t2.y).bust, false, `bust from ${left} aiming ${t2.aim.why}`);
  }
});

test('a council arriving just after the winning dart lands still pays the leg', () => {
  const g = wallet(40);
  const s = { t: 0 };
  SCREENS.mpDarts.init(s, g);
  s.stake = 10;
  SCREENS.mpDarts.key('KeyE', s, g, {});
  assert.equal(g.coins, 30);
  // the checkout dart has landed, the 'over' phase is a few frames away
  s.leg.over = 'you'; s.phase = 'fly'; s.landed = true;
  SCREENS.mpDarts.discard(s, g);
  assert.deepEqual(g.settled, [20]);
  SCREENS.mpDarts.discard(s, g);
  assert.deepEqual(g.settled, [20], 'settled once only');
});

test('a darts leg never starts when the purse refused the stake', () => {
  const g = wallet(40, { refuse: true });
  const s = { t: 0 };
  SCREENS.mpDarts.init(s, g);
  SCREENS.mpDarts.key('KeyE', s, g, {});
  assert.equal(s.leg, null);
  assert.equal(s.phase, 'stake');
  SCREENS.mpDarts.discard(s, g);
  assert.deepEqual(g.settled, [], 'nothing to refund for a stake never taken');
});

test('blackjack double and split only happen when the extra stake was really taken', () => {
  const g = wallet(100);
  const s = { t: 0 };
  SCREENS.mpBlackjack.init(s, g);
  s.stake = 10;
  SCREENS.mpBlackjack.key('KeyE', s, g, {});
  // a pair of eights against a six, no naturals
  s.st.hands[0].cards = [{ r: '8', s: 'S' }, { r: '8', s: 'H' }];
  s.st.dealer = [{ r: '6', s: 'S' }, { r: '9', s: 'H' }];
  s.st.phase = 'player'; s.st.hands[0].done = false;
  s.phase = 'player';
  g.bjStake = () => false;          // the purse says no (left ROAM, died, ...)
  SCREENS.mpBlackjack.key('KeyP', s, g, {});
  assert.equal(s.st.hands.length, 1, 'split without paying for it');
  SCREENS.mpBlackjack.key('KeyD', s, g, {});
  assert.equal(s.st.hands[0].doubled, false, 'doubled without paying for it');
  assert.equal(BJ.staked(s.st), 10);
});
