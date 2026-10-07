import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../public/processing.mjs');

test('file validation rejects unsupported, empty and oversized files before decoding', async () => {
  const { validateImageFile } = await load();
  for (const file of [new Blob(['x'], { type: 'text/plain' }), new Blob([], { type: 'image/png' }), new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: 'image/png' })]) {
    assert.throws(() => validateImageFile(file));
  }
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => validateImageFile(new Blob(['x'], { type })));
});

test('grid preserves source proportions, limits columns to source width and rejects unsafe dimensions', async () => {
  const { gridDimensions } = await load();
  assert.deepEqual(gridDimensions(400, 200, 32), { width: 32, height: 16 });
  assert.deepEqual(gridDimensions(200, 400, 32), { width: 32, height: 64 });
  assert.deepEqual(gridDimensions(3, 2, 64), { width: 3, height: 2 });
  for (const args of [[0, 2, 32], [2, -1, 32], [2, 2, 0], [2, 2, 1.5], [Infinity, 2, 32], [100000, 100000, 32]]) assert.throws(() => gridDimensions(...args));
});

test('nearest cell centers retain each original RGBA including partial and zero alpha', async () => {
  const { samplePixelGrid } = await load();
  const pixels = new Uint8ClampedArray([
    1,2,3,255, 4,5,6,255, 7,8,9,255, 10,11,12,255,
    13,14,15,255, 17,33,65,128, 19,20,21,255, 211,155,91,0,
  ]);
  const sampled = samplePixelGrid(pixels, 4, 2, 2);
  assert.deepEqual({ width: sampled.width, height: sampled.height, data: [...sampled.data] }, { width: 2, height: 1, data: [17,33,65,128,211,155,91,0] });
  assert.throws(() => samplePixelGrid(pixels.subarray(1), 4, 2, 2));
});

test('pixel conversion never quantizes a source with more than five colors', async () => {
  const { samplePixelGrid } = await load();
  const pixels = new Uint8ClampedArray([10,0,0,255, 20,0,0,255, 30,0,0,255, 40,0,0,255, 50,0,0,255, 60,0,0,255, 70,0,0,255]);
  assert.deepEqual([...samplePixelGrid(pixels, 7, 1, 7).data], [...pixels]);
});

test('processImage and rerender give Korean recovery guidance for undecodable images', async t => {
  const { processImage, renderPixelArt } = await load();
  browserBoundary(t, { decodeError: new Error('The source image could not be decoded.') });
  const blob = new Blob(['corrupt'], { type: 'image/png' });
  await assert.rejects(processImage(blob), /이미지.*읽.*다른.*선택/);
  await assert.rejects(renderPixelArt(blob, 32), /이미지.*읽.*다른.*선택/);
});

test('oversized decoded bitmaps are closed before rejecting without allocating canvas', async t => {
  const { processImage } = await load();
  let closed = false;
  browserBoundary(t, { width: 100000, height: 100000, close() { closed = true; } });
  await assert.rejects(processImage(new Blob(['x'], { type: 'image/png' })), /너무 큽니다/);
  assert.equal(closed, true);
});

// Node has no Canvas or image decoder. Only those browser boundaries are replaced;
// validation, sampling, palette normalization, orchestration and error handling stay real.
function browserBoundary(t, { width = 2, height = 1, pixels = new Uint8ClampedArray([12,34,56,255,90,80,70,255]), close = () => {}, decodeError, encodeFailure = false } = {}) {
  const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalBitmap) Object.defineProperty(globalThis, 'createImageBitmap', originalBitmap); else delete globalThis.createImageBitmap;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => {
    if (decodeError) throw decodeError;
    return { width, height, close };
  }});
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const context = { drawImage() {}, getImageData() { return { data: pixels }; }, createImageData(w, h) { return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData() {}, imageSmoothingEnabled: true };
      return { width: 0, height: 0, getContext() { return context; }, toBlob(callback, type) { callback(encodeFailure ? null : new Blob([JSON.stringify({ width: this.width, height: this.height })], { type })); } };
    },
  }});
}

test('processImage keeps source Blob and fills five swatches from actual extracted colors', async t => {
  const { processImage } = await load();
  let closed = false;
  browserBoundary(t, { close() { closed = true; } });
  const blob = new Blob(['source'], { type: 'image/png' });
  const result = await processImage(blob, { columns: 32, pixelMode: 'style', extractPalette: async () => [{ hex: () => '#123456' }, '#aabbcc'] });
  assert.equal(result.sourceBlob, blob);
  assert.deepEqual(result.palette, ['#123456', '#AABBCC', '#123456', '#AABBCC', '#123456']);
  assert.equal(result.thumbnailBlob.type, 'image/png');
  assert.equal(result.pixelBlob.type, 'image/png');
  assert.deepEqual([result.width, result.height, result.gridWidth, result.gridHeight], [2, 1, 2, 1]);
  assert.equal(closed, true);
});

test('transparent images and failed palettes reject and always release decoded bitmaps', async t => {
  const { processImage } = await load();
  let closes = 0;
  browserBoundary(t, { close() { closes++; } });
  const blob = new Blob(['source'], { type: 'image/png' });
  for (const palette of [null, [], ['bad'], [{ hex: () => '#ff' }]]) {
    await assert.rejects(processImage(blob, { extractPalette: async () => palette }));
  }
  assert.equal(closes, 4);
  browserBoundary(t, { pixels: new Uint8ClampedArray([1,2,3,0,4,5,6,0]), close() { closes++; } });
  await assert.rejects(processImage(blob, { extractPalette: async () => ['#FFFFFF'] }));
  assert.equal(closes, 5);
});

test('PNG encoding failure rejects rerender and releases bitmap', async t => {
  const { renderPixelArt } = await load();
  let closed = false;
  browserBoundary(t, { encodeFailure: true, close() { closed = true; } });
  await assert.rejects(renderPixelArt(new Blob(['source'], { type: 'image/png' }), 32));
  assert.equal(closed, true);
});

test('new uploads default to detail at 96 columns while rerenders remain original by default', async t => {
  const { processImage, renderPixelArt } = await load();
  browserBoundary(t);
  const file = new Blob(['source'], { type: 'image/png' });
  const uploaded = await processImage(file, { extractPalette: () => ['#123456'], detailRenderer });
  assert.equal(uploaded.pixelMode, 'detail');
  assert.equal(uploaded.columns, 96);
  assert.equal((await renderPixelArt(file, 32)).pixelMode, 'original');
  assert.equal((await renderPixelArt(file, 32, 'style')).pixelMode, 'style');
  assert.equal((await processImage(file, { pixelMode: 'original', extractPalette: () => ['#123456'] })).pixelMode, 'original');
});
test('unknown modes reject before decoding', async () => {
  const { processImage, renderPixelArt } = await load();
  const file = new Blob(['source'], { type: 'image/png' });
  await assert.rejects(processImage(file, { pixelMode: 'unknown' }), /모드/);
  await assert.rejects(renderPixelArt(file, 32, 'unknown'), /모드/);
});


test('PNG cells use integer enlargement and the longest edge never exceeds 1600', async t => {
  const { renderPixelArt } = await load();
  const file = new Blob(['source'], { type: 'image/png' });
  for (const [width, height, columns] of [[7, 5, 3], [1, 2000, 32]]) {
    browserBoundary(t, { width, height, pixels: new Uint8ClampedArray(width * height * 4).fill(255) });
    for (const mode of ['original', 'style', 'detail']) {
      const result = await renderPixelArt(file, columns, mode, { detailRenderer });
      const size = JSON.parse(await result.pixelBlob.text());
      assert.ok(Math.max(size.width, size.height) <= 1600);
      assert.equal(size.width % result.gridWidth, 0);
      assert.equal(size.height % result.gridHeight, 0);
      assert.equal(size.width / result.gridWidth, size.height / result.gridHeight);
    }
  }
});

// This renderer replaces the browser Worker boundary only; Canvas orchestration stays real.
async function detailRenderer(pixels, width, height, grid) {
  return { data: new Uint8ClampedArray(grid.width * grid.height * 4).fill(255), ...grid };
}
test('detail renderer receives original RGBA and produces a 96 by 120 grid with independent five-color palette', async t => {
  const { processImage } = await load();
  const pixels = new Uint8ClampedArray(736 * 920 * 4).fill(255);
  browserBoundary(t, { width: 736, height: 920, pixels });
  let calls = 0;
  const rendered = await processImage(new Blob(['source'], { type: 'image/png' }), {
    extractPalette: () => ['#123456', '#234567', '#345678', '#456789', '#56789A'],
    detailRenderer: async (rgba, width, height, grid) => {
      calls++;
      assert.equal(rgba, pixels);
      assert.deepEqual([width, height, grid], [736, 920, { width: 96, height: 120 }]);
      await Promise.resolve();
      return detailRenderer(rgba, width, height, grid);
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual([rendered.gridWidth, rendered.gridHeight, rendered.pixelMode], [96, 120, 'detail']);
  assert.deepEqual(JSON.parse(await rendered.pixelBlob.text()), { width: 1248, height: 1560 });
  assert.deepEqual(rendered.palette, ['#123456', '#234567', '#345678', '#456789', '#56789A']);
});
test('detail rerender propagates worker failure without silently falling back to another mode', async t => {
  const { renderPixelArt } = await load();
  browserBoundary(t);
  await assert.rejects(renderPixelArt(new Blob(['source'], { type: 'image/png' }), 96, 'detail', {
    detailRenderer: async () => { throw Error('detail renderer unavailable'); },
  }), /detail renderer unavailable/);
});
