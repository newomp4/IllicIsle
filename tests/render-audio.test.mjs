import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'three' ? new URL('../vendor/three.module.js', import.meta.url).href : specifier, context);
}});
const { RetroPipeline } = await import('../js/lib/ps1.js');
const { GameAudio } = await import('../js/lib/audio.js');

test('mouse projection matches CRT sampling and clean mode', () => {
  const pipeline = new RetroPipeline({});
  assert.deepEqual(pipeline.screenToHud(.5,.5), [.5,.5]);
  for (const [u,v] of [[0,0], [.08,.9], [1,1]]) {
    const x = u-.5, y = v-.5;
    const factor = 1+.055*(x*x+y*y);
    assert.deepEqual(pipeline.screenToHud(u,v), [.5+x*factor,.5+y*factor]);
  }
  pipeline.setCRT(false);
  assert.deepEqual(pipeline.screenToHud(.2,.7), [.2,.7]);
  pipeline.dispose();
});

test('low resolution keeps portrait menus at their minimum readable width', () => {
  const pipeline = new RetroPipeline({}, 180);
  pipeline.setSize(540, 900);
  assert.deepEqual(pipeline.internal, {w: 240, h: 400});
  pipeline.dispose();
});

test('audio remembers the most recent music requested before the first gesture', () => {
  const audio = new GameAudio();
  audio.playMusic('title');
  audio.playMusic('storm');
  assert.equal(audio._requestedTrack, 'storm');
  const gain = () => ({ gain: { value: 0 }, connect() {} });
  globalThis.window = { AudioContext: class {
    currentTime = 1;
    destination = {};
    addEventListener() {}
    createGain = gain;
    createConvolver() { return { connect() {} }; }
  }};
  audio._impulse = () => null;
  audio._noise = () => null;
  audio._buildVoices = () => {};
  audio._silenceMusic = () => {};
  try {
    audio.init();
    assert.equal(audio.track, 'storm');
    audio.stopMusic();
    assert.equal(audio.track, null);
    assert.equal(audio._requestedTrack, null);
  } finally {
    clearInterval(audio.timer);
    delete globalThis.window;
  }
});

test('stopping before audio initialization cancels the queued track', () => {
  const audio = new GameAudio();
  audio.playMusic('title');
  audio.stopMusic();
  assert.equal(audio._requestedTrack, null);
});
