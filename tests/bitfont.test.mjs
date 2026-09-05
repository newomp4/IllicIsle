import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, fitText, textWidth, wrapText, ditherRect } from '../js/lib/bitfont.js';

test('bitmap text preserves names with accents and handles missing labels', () => {
  assert.equal(normalize('Héctor — café…'), 'HECTOR - CAFE...');
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
});

test('fitted labels and their ellipses stay within every available width', () => {
  for (const scale of [1, 2, 3]) {
    for (const tracking of [0, 1, 2]) {
      for (let width = 0; width < 250; width++) {
        const fitted = fitText('A remarkably long heading — about the island', width, scale, tracking);
        assert.ok(textWidth(fitted, scale, tracking) <= width, `${width}: ${fitted}`);
      }
    }
  }
  assert.equal(fitText('SHORT', 80), 'SHORT');
  assert.equal(fitText('TOO LONG', 17), '...');
});

test('paragraph breaks and blank lines survive wrapping', () => {
  assert.deepEqual(wrapText('First line\n\nSecond line', 70, 1), ['FIRST LINE', '', 'SECOND LINE']);
  assert.deepEqual(wrapText('A\r\nB\rC', 70, 1), ['A', 'B', 'C']);
  assert.deepEqual(wrapText('A', 4, 1), []);
  const lines = wrapText('ABCDEFGHIJKLMNOP and another word', 29, 1);
  assert.ok(lines.every(line => textWidth(line, 1) <= 29));
  assert.ok(lines.join('').startsWith('ABCDEFGHIJKLMNOP'));
});

test('small dither panels never paint outside their bounds', () => {
  const rects = [];
  const ctx = { fillRect: (...r) => rects.push(r) };
  ditherRect(ctx, 3, 5, 7, 3, '#000', '#fff', 0.5, 2);
  assert.ok(rects.length);
  for (const [x,y,w,h] of rects) {
    assert.ok(x >= 3 && y >= 5 && x+w <= 10 && y+h <= 8);
  }
  rects.length = 0;
  ditherRect(ctx, 0, 0, -3, 2, '#000', '#fff', 0.5);
  assert.equal(rects.length, 0);
});
