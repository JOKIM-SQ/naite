import test from 'node:test';
import assert from 'node:assert/strict';
import * as processing from '../public/processing.mjs';

const fixture = (width, height, color) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(color(x, y), (y * width + x) * 4);
  return data;
};
const style = (...args) => {
  assert.equal(typeof processing.stylePixelGrid, 'function', 'style processing is available');
  return processing.stylePixelGrid(...args);
};
const colors = data => new Set(Array.from({ length: data.length / 4 }, (_, i) => data[i*4+3] ? [...data.slice(i*4,i*4+3)].join(',') : null).filter(Boolean));

test('style keeps a solid partially transparent color intact', () => {
  const result = style(fixture(16, 8, () => [37, 81, 143, 128]), 16, 8, 4);
  assert.deepEqual([result.width, result.height], [4, 2]);
  assert.deepEqual([...result.data], [...fixture(4, 2, () => [37, 81, 143, 128])]);
});
test('style palette is independently limited to 32 visible RGB colors and deterministic', () => {
  const input = fixture(64, 32, (x, y) => [x*4, y*8, (x*17+y*11)%256, 255]);
  const a = style(input, 64, 32, 64);
  assert.ok(colors(a.data).size <= 32);
  assert.ok(colors(a.data).size > 5);
  assert.deepEqual(a, style(input, 64, 32, 64));
});
test('transparent RGB does not pollute visible palette and alpha survives', () => {
  const result = style(fixture(8, 4, (x) => x < 4 ? [255, 0, 255, 0] : [20, 80, 120, 128]), 8, 4, 2);
  assert.deepEqual([...result.data], [0,0,0,0,20,80,120,128]);
  assert.deepEqual([...style(fixture(4, 4, () => [255,0,0,0]), 4,4,2).data], Array(16).fill(0));
});
test('cell aggregation removes sparse texture without blurring a dark-light boundary', () => {
  const input = fixture(32, 16, (x,y) => {
    const base = x < 16 ? 30 : 220;
    const noise = x%4 === 2 && y%4 === 2 ? 25 : 0;
    return [base+noise,base+noise,base+noise,255];
  });
  const result = style(input,32,16,8);
  assert.deepEqual([...result.data], [...fixture(8,4,x => x<4 ? [30,30,30,255] : [220,220,220,255])]);
  assert.ok(colors(result.data).size < colors(input).size);
});
