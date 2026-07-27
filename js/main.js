/* ===========================================================
   main.js — boot, menus, and the frame loop.
   =========================================================== */

import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const screens = {
  loading: $('loading'),
  title: $('title'),
  controls: $('controls'),
  options: $('options'),
  pause: $('pause'),
  death: $('death'),
  ending: $('ending'),
  nomobile: $('nomobile'),
};

let game = null;
let backTo = 'title';   // where the CONTROLS/OPTIONS back button returns to

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

/* ===========================================================
   BOOT
   =========================================================== */
async function boot() {
  const canvas = $('game');

  // WebGL sanity check before we promise anything
  const probe = document.createElement('canvas');
  const ok = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!ok) {
    $('load-text').textContent = 'WEBGL NOT AVAILABLE';
    $('load-text').style.color = '#e0453a';
    return;
  }

  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;

  try {
    game = new Game(canvas);
  } catch (err) {
    console.error(err);
    $('load-text').textContent = 'FAILED TO START: ' + err.message;
    $('load-text').style.color = '#e0453a';
    return;
  }

  applySettingsToUI();
  window.__game = game;   // handy from the devtools console

  const fill = $('load-fill');
  const text = $('load-text');

  try {
    await game.load((frac, label) => {
      fill.style.width = `${Math.round(frac * 100)}%`;
      text.textContent = label + '…';
    });
  } catch (err) {
    console.error(err);
    text.textContent = 'LOAD ERROR: ' + err.message;
    text.style.color = '#e0453a';
    return;
  }

  fill.style.width = '100%';
  text.textContent = 'PRESS ANY KEY';

  // wait for a gesture so we can legally start audio
  await waitForGesture();

  game.audio.init();
  game.audio.setEnabled(game.settings.audio);
  game.audio.resume();

  hide(screens.loading);
  if (touchOnly) {
    show(screens.nomobile);
  } else {
    show(screens.title);
  }

  game.startTitle();
  game.loop();
}

function waitForGesture() {
  return new Promise((res) => {
    const go = () => {
      window.removeEventListener('keydown', go);
      window.removeEventListener('mousedown', go);
      window.removeEventListener('touchstart', go);
      res();
    };
    window.addEventListener('keydown', go);
    window.addEventListener('mousedown', go);
    window.addEventListener('touchstart', go, { passive: true });
  });
}

/* ===========================================================
   MENUS
   =========================================================== */
function beginGame() {
  hide(screens.title);
  hide(screens.controls);
  hide(screens.options);
  hide(screens.pause);
  hide(screens.ending);
  hide(screens.death);
  game.audio.resume();
  game.audio.sfx('confirm');
  game.startGame();
}

function openPanel(which, from) {
  backTo = from;
  hide(screens.title);
  hide(screens.pause);
  show(screens[which]);
  game?.audio.sfx('select');
}

function closePanel() {
  hide(screens.controls);
  hide(screens.options);
  if (backTo === 'pause') show(screens.pause);
  else show(screens.title);
  game?.audio.sfx('select');
}

/* ---------- title ---------- */
screens.title.querySelectorAll('.mbtn').forEach((b) => {
  b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'start') beginGame();
    else openPanel(act, 'title');
  });
  b.addEventListener('mouseenter', () => game?.audio.sfx('select'));
});

/* ---------- pause ---------- */
screens.pause.querySelectorAll('.mbtn').forEach((b) => {
  b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'resume') game.pause(false);
    else if (act === 'quit') quitToTitle();
    else openPanel(act, 'pause');
  });
});

function quitToTitle() {
  game.paused = false;
  hide(screens.pause);
  hide(screens.death);
  document.exitPointerLock?.();
  game.ui.hide();
  game.ui.showBoss(false);
  game.state = 'title';
  game.pipeline.fade = 1;
  game.pipeline.tintAmt = 0;
  game.audio.playMusic('island');
  show(screens.title);
  game.audio.sfx('confirm');
}

/* ---------- back buttons ---------- */
document.querySelectorAll('.back-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.closest('#journal')) { game?.toggleJournal(); return; }
    closePanel();
  });
});

/* ---------- death ---------- */
$('respawn-btn').addEventListener('click', () => {
  game.audio.sfx('confirm');
  game.respawn();
});

/* ---------- ending ---------- */
screens.ending.querySelectorAll('.mbtn').forEach((b) => {
  b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'again') {
      hide(screens.ending);
      // give the sanctum idol its pedestal back
      game.sanctumIdol.position.y = 2.4 + 2.45;
      game.sanctumIdol.scale.setScalar(1.35);
      game.caveSeal.seal.visible = true;
      game.caveSeal.bars.forEach((x) => (x.visible = true));
      if (game.hector) {
        game.hector.dispose();
        game.hector = null;
      }
      game.bossTriggered = false;
      game.pipeline.fade = 1;
      beginGame();
    } else if (act === 'share') {
      const txt = game.endingSummary || 'I found the Idol of Chris Illich on IllicIsle.';
      try {
        await navigator.clipboard.writeText(`${txt}\n${location.href}`);
        b.textContent = '✓ COPIED';
        setTimeout(() => (b.textContent = '📋 COPY BRAG'), 1800);
      } catch (e) {
        b.textContent = 'CLIPBOARD BLOCKED';
        setTimeout(() => (b.textContent = '📋 COPY BRAG'), 1800);
      }
      game.audio.sfx('confirm');
    }
  });
});

/* ---------- mobile escape hatch ---------- */
$('nomobile-anyway').addEventListener('click', () => {
  hide(screens.nomobile);
  show(screens.title);
});

/* ===========================================================
   OPTIONS
   =========================================================== */
function wireOption(id, key, parse, after) {
  const wrap = $(id);
  wrap.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      game.settings[key] = parse(b.dataset.v);
      game.applySettings();
      game.audio.sfx('select');
      after?.();
    });
  });
}

function applySettingsToUI() {
  const mark = (id, val) => {
    const wrap = $(id);
    wrap.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', String(b.dataset.v) === String(val));
    });
  };
  mark('opt-res', game.settings.res);
  mark('opt-jitter', game.settings.jitter ? 1 : 0);
  mark('opt-crt', game.settings.crt ? 1 : 0);
  mark('opt-density', game.settings.density);
  mark('opt-audio', game.settings.audio ? 1 : 0);

  wireOption('opt-res', 'res', (v) => parseInt(v, 10));
  wireOption('opt-jitter', 'jitter', (v) => v === '1');
  wireOption('opt-crt', 'crt', (v) => v === '1');
  wireOption('opt-density', 'density', (v) => parseFloat(v));
  wireOption('opt-audio', 'audio', (v) => v === '1');
}

/* ===========================================================
   GO
   =========================================================== */
window.addEventListener('error', (e) => {
  console.error('[IllicIsle]', e.error || e.message);
});

boot();
