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

  /* ---- straight in ----
     There used to be a PRESS ANY KEY here, and it was not a flourish: a
     browser will not let an AudioContext start without a gesture, so the
     game had to wait for one before it could have any sound.

     It does not have to wait to be VISIBLE though. The title comes up the
     moment the loading finishes, and the audio arms itself on the first
     thing you touch — which is the keystroke that gets you off the title
     anyway, so nobody ever notices the difference. */
  fill.style.width = '100%';
  text.textContent = 'READY';

  const startAudio = () => {
    window.removeEventListener('keydown', startAudio);
    window.removeEventListener('mousedown', startAudio);
    window.removeEventListener('touchstart', startAudio);
    try {
      game.audio.init();
      game.audio.setEnabled(game.settings.audio);
      game.audio.resume();
      // whatever the title asked for, now that there is something to play it
      game.audio.playMusic(game.state === 'title' ? 'title' : null);
    } catch (e) { /* no sound is not a reason to have no game */ }
  };
  window.addEventListener('keydown', startAudio);
  window.addEventListener('mousedown', startAudio);
  window.addEventListener('touchstart', startAudio, { passive: true });

  /* A beat with the bar sitting at full, then it fades. Cutting straight
     from a full progress bar to a title screen reads as a glitch; a third
     of a second reads as the thing finishing. */
  game.startTitle();
  game.loop();
  await new Promise((r) => setTimeout(r, 260));
  $('loading').classList.add('going');
  setTimeout(() => $('loading').classList.add('hidden'), 400);
  if (touchOnly) $('nomobile').classList.remove('hidden');
}

$('nomobile-anyway')?.addEventListener('click', () => {
  $('nomobile').classList.add('hidden');
});

window.addEventListener('error', (e) => console.error('[IllicIsle]', e.error || e.message));

boot();
