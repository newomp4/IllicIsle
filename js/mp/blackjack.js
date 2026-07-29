/* ===========================================================
   blackjack.js — the rules, and nothing else.

   Michael Beef's table plays it straight: six decks in the shoe,
   dealer stands on all seventeens, blackjack pays three to two,
   insurance is not offered because he does not offer it. Split
   and double are both available on the first two cards.

   The rules live here, on their own, so they can be reasoned
   about without a canvas anywhere near them.
   =========================================================== */

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Six decks, shuffled with the caller's own random source. */
export function newShoe(rand = Math.random, decks = 6) {
  const shoe = [];
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  }
  // Fisher-Yates, so every ordering is equally likely
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = shoe[i]; shoe[i] = shoe[j]; shoe[j] = tmp;
  }
  return shoe;
}

/** What one card is worth. Aces are counted as eleven and softened later. */
export function cardValue(card) {
  if (card.r === 'A') return 11;
  if (card.r === 'K' || card.r === 'Q' || card.r === 'J' || card.r === '10') return 10;
  return +card.r;
}

/**
 * The best total a hand can make.
 * @returns {{total:number, soft:boolean, bust:boolean, blackjack:boolean}}
 */
export function score(hand) {
  let total = 0, aces = 0;
  for (const c of hand) {
    total += cardValue(c);
    if (c.r === 'A') aces++;
  }
  // soften aces one at a time, only as far as we have to
  let soft = aces > 0;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  if (aces === 0) soft = false;
  return {
    total, soft, bust: total > 21,
    blackjack: hand.length === 2 && total === 21,
  };
}

export function handText(hand) {
  const s = score(hand);
  if (s.bust) return `${s.total} BUST`;
  if (s.blackjack) return 'BLACKJACK';
  return s.soft && s.total !== 21 ? `${s.total - 10}/${s.total}` : String(s.total);
}

/* ===========================================================
   A ROUND
   =========================================================== */

/**
 * @param {object} o
 * @param {number} o.bet
 * @param {() => number} o.rand
 * @param {object[]} [o.shoe]  carried between rounds; reshuffled when low
 */
export function deal({ bet, rand = Math.random, shoe = null }) {
  let s = (shoe && shoe.length > 20) ? shoe : newShoe(rand);
  const draw = () => s.pop();
  const state = {
    shoe: s,
    rand,
    bet,
    /* Hands are a list because a split makes two of them. Each carries its
       own stake, so doubling one does not double the other. */
    hands: [{ cards: [draw(), draw()], bet, done: false, doubled: false, split: false }],
    active: 0,
    dealer: [draw(), draw()],
    phase: 'player',        // player | dealer | done
    results: null,
    reshuffled: s !== shoe,
  };
  // a natural ends it there and then
  if (score(state.hands[0].cards).blackjack) {
    state.hands[0].done = true;
    state.phase = 'dealer';
  }
  return state;
}

export function canDouble(st) {
  const h = st.hands[st.active];
  return !!h && !h.done && h.cards.length === 2 && !h.doubled;
}

export function canSplit(st) {
  const h = st.hands[st.active];
  if (!h || h.done || h.cards.length !== 2 || st.hands.length >= 4) return false;
  return cardValue(h.cards[0]) === cardValue(h.cards[1]);
}

export function hit(st) {
  const h = st.hands[st.active];
  if (!h || h.done) return st;
  h.cards.push(st.shoe.pop());
  const sc = score(h.cards);
  if (sc.bust || sc.total === 21) h.done = true;
  advance(st);
  return st;
}

export function stand(st) {
  const h = st.hands[st.active];
  if (!h) return st;
  h.done = true;
  advance(st);
  return st;
}

export function double(st) {
  if (!canDouble(st)) return st;
  const h = st.hands[st.active];
  h.bet *= 2;
  h.doubled = true;
  h.cards.push(st.shoe.pop());
  h.done = true;
  advance(st);
  return st;
}

export function split(st) {
  if (!canSplit(st)) return st;
  const h = st.hands[st.active];
  const moved = h.cards.pop();
  const nh = { cards: [moved, st.shoe.pop()], bet: h.bet, done: false, doubled: false, split: true };
  h.cards.push(st.shoe.pop());
  h.split = true;
  st.hands.splice(st.active + 1, 0, nh);
  /* Split aces get one card each and stand, which is the standard rule and
     the one that stops a split-ace hand being strictly better than any
     other. */
  if (moved.r === 'A') { h.done = true; nh.done = true; advance(st); }
  return st;
}

function advance(st) {
  while (st.active < st.hands.length && st.hands[st.active].done) st.active++;
  if (st.active >= st.hands.length) st.phase = 'dealer';
}

/** One dealer card. Returns true when he is finished. */
export function dealerStep(st) {
  if (st.phase !== 'dealer') return true;
  const sc = score(st.dealer);
  /* He stands on all seventeens, soft included. If every player hand has
     already busted he does not draw at all — there is nothing to beat. */
  const allBust = st.hands.every((h) => score(h.cards).bust);
  if (allBust || sc.total >= 17) { settle(st); return true; }
  st.dealer.push(st.shoe.pop());
  if (score(st.dealer).total >= 17) { settle(st); return true; }
  return false;
}

function settle(st) {
  const d = score(st.dealer);
  st.results = st.hands.map((h) => {
    const p = score(h.cards);
    if (p.bust) return { outcome: 'bust', pays: 0, staked: h.bet };
    // a natural pays three to two, and only on a hand that was not split
    if (p.blackjack && !h.split && !d.blackjack) {
      return { outcome: 'blackjack', pays: Math.round(h.bet * 2.5), staked: h.bet };
    }
    if (d.bust) return { outcome: 'win', pays: h.bet * 2, staked: h.bet };
    if (p.total > d.total) return { outcome: 'win', pays: h.bet * 2, staked: h.bet };
    if (p.total === d.total) return { outcome: 'push', pays: h.bet, staked: h.bet };
    return { outcome: 'lose', pays: 0, staked: h.bet };
  });
  st.phase = 'done';
}

/** What the whole round returns to the player, stake included. */
export function payout(st) {
  if (!st.results) return 0;
  return st.results.reduce((a, r) => a + r.pays, 0);
}

/** What the whole round cost to play. */
export function staked(st) {
  return st.hands.reduce((a, h) => a + h.bet, 0);
}
