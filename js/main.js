/* ===========================================================
   main.js — boot and the frame loop.
   All in-game interfaces are drawn on the pixel canvas
   (js/lib/screens.js); the loading screen is the only DOM one,
   because it has to show before the renderer exists.
   =========================================================== */

import { MPGame } from './mp/mpgame.js';
import { parseRoomCode } from './net/net.js';

const $ = (id) => document.getElementById(id);
let game = null;

async function boot() {
  const canvas = $('game');

  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) {
    window.illicLoadError('WEBGL NOT AVAILABLE', 'Enable hardware acceleration in your browser, then reload.');
    return;
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();

  const touchOnly = matchMedia('(pointer: coarse)').matches
    && !matchMedia('(pointer: fine)').matches;
  /* Told before the work, not after it: building the world costs a phone
     many seconds of texture and geometry work, and it is the one machine
     that is about to be told it cannot play. The load runs underneath, so
     TRY ANYWAY still drops straight into a game that is already coming up. */
  if (touchOnly) $('nomobile').classList.remove('hidden');

  try {
    game = new MPGame(canvas);
  } catch (err) {
    console.error(err);
    window.illicLoadError('FAILED TO START', err.message);
    return;
  }
  // Local regression tools inspect the live game without exposing that
  // convenience handle on the public online game.
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) window.__game = game;
  canvas.addEventListener('webglcontextlost', () => {
    game._clearHeldInput();
    game.paused = true;
    game.audio.setEnabled(false);
    document.exitPointerLock?.();
    $('loading').classList.remove('hidden', 'going');
    window.illicLoadError('GRAPHICS INTERRUPTED', 'Reload the game to reconnect to your graphics device.');
  });

  const fill = $('load-fill');
  const text = $('load-text');
  try {
    await game.load((frac, label) => {
      if (window.illicLoadFailed) return;
      fill.style.width = `${Math.round(frac * 100)}%`;
      text.textContent = label;
    });
  } catch (err) {
    console.error(err);
    window.illicLoadError('LOAD ERROR', err.message);
    return;
  }
  if (window.illicLoadFailed) return;

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
      // init resumes the latest requested track, including an intro begun
      // by this same first gesture.
    } catch (e) { /* no sound is not a reason to have no game */ }
  };
  window.addEventListener('keydown', startAudio);
  window.addEventListener('mousedown', startAudio);
  window.addEventListener('touchstart', startAudio, { passive: true });

  /* A beat with the bar sitting at full, then it fades. Cutting straight
     from a full progress bar to a title screen reads as a glitch; a third
     of a second reads as the thing finishing. */
  game.startTitle();
  const invitedRoom = parseRoomCode(location.href);
  if (invitedRoom) game.screens.replace('mpMenu', { room: invitedRoom });
  game.loop();
  await new Promise((r) => setTimeout(r, 260));
  if (window.illicLoadFailed) return;
  $('loading').classList.add('going');
  setTimeout(() => { if (!window.illicLoadFailed) $('loading').classList.add('hidden'); }, 400);
}

$('nomobile-anyway')?.addEventListener('click', () => {
  $('nomobile').classList.add('hidden');
});

window.addEventListener('error', (e) => console.error('[IllicIsle]', e.error || e.message));

boot();
