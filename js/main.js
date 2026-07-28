/* ===========================================================
   main.js — boot and the frame loop.
   All in-game interfaces are drawn on the pixel canvas
   (js/lib/screens.js); the loading screen is the only DOM one,
   because it has to show before the renderer exists.
   =========================================================== */

import { MPGame } from './mp/mpgame.js';
import { heightAt } from './world/terrain.js';

const $ = (id) => document.getElementById(id);
let game = null;

async function boot() {
  const canvas = $('game');

  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
    $('load-text').textContent = 'WEBGL NOT AVAILABLE';
    $('load-text').style.color = '#e0453a';
    return;
  }

  const touchOnly = matchMedia('(pointer: coarse)').matches
    && !matchMedia('(pointer: fine)').matches;

  try {
    game = new MPGame(canvas);
  } catch (err) {
    console.error(err);
    $('load-text').textContent = 'FAILED TO START: ' + err.message;
    $('load-text').style.color = '#e0453a';
    return;
  }
  window.__game = game;
  window.__heightAt = heightAt;   // used by the placement audit harness

  const fill = $('load-fill');
  const text = $('load-text');
  try {
    await game.load((frac, label) => {
      fill.style.width = `${Math.round(frac * 100)}%`;
      text.textContent = label;
    });
  } catch (err) {
    console.error(err);
    text.textContent = 'LOAD ERROR: ' + err.message;
    text.style.color = '#e0453a';
    return;
  }

  fill.style.width = '100%';
  text.textContent = 'PRESS ANY KEY';
  await waitForGesture();

  game.audio.init();
  game.audio.setEnabled(game.settings.audio);
  game.audio.resume();

  $('loading').classList.add('hidden');
  if (touchOnly) $('nomobile').classList.remove('hidden');

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

$('nomobile-anyway')?.addEventListener('click', () => {
  $('nomobile').classList.add('hidden');
});

window.addEventListener('error', (e) => console.error('[IllicIsle]', e.error || e.message));

boot();
