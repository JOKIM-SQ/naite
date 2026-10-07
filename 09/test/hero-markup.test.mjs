import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

function hero() {
  const { document } = parseHTML(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
  return document.querySelector('.hero-art');
}

test('hero SVG captions remain complete plain text', () => {
  const captions = [...hero().querySelectorAll('.study-captions text')];
  assert.equal(captions.length, 2);
  for (const caption of captions) {
    assert.equal(caption.children.length, 0, 'SVG captions must not contain scene geometry');
  }
  assert.deepEqual(captions.map(caption => caption.textContent.trim()), ['01 / THE SCENE', '02 / THE PIXELS']);
});

test('hero contains exactly one eight-row animated pixel scene', () => {
  const art = hero();
  const rows = [...art.querySelectorAll('.study-pixel-row')];
  assert.equal(rows.length, 8, 'pixel rows must not be duplicated outside the pixel scene');
  assert.ok(rows.every(row => row.parentElement.classList.contains('study-pixels')));
  assert.ok(rows.every(row => row.querySelectorAll('rect').length > 0));
});
