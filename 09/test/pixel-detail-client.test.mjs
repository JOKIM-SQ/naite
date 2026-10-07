import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetailRenderer } from '../public/pixel-detail-client.mjs';

function workerBoundary(onSend) {
  return {
    onmessage: null, onerror: null, onmessageerror: null, terminated: false,
    postMessage(request) { queueMicrotask(() => onSend(this, request)); },
    terminate() { this.terminated = true; },
  };
}

test('detail worker returns RGBA pixels and releases its runtime', async () => {
  const worker = workerBoundary((target, request) => {
    assert.equal(request.width, 2); assert.equal(request.height, 1);
    assert.deepEqual(request.grid, { width: 1, height: 1 });
    target.onmessage({ data: { data: new Uint8ClampedArray([120, 80, 40, 255]), width: 1, height: 1 } });
  });
  const render = createDetailRenderer({ createWorker: () => worker });
  const pixels = new Uint8ClampedArray([100, 50, 25, 255, 140, 110, 55, 255]);
  const output = await render(pixels, 2, 1, { width: 1, height: 1 });
  assert.deepEqual([...output.data], [120, 80, 40, 255]);
  assert.equal(output.width, 1); assert.equal(output.height, 1);
  assert.equal(pixels.byteLength, 8);
  assert.equal(worker.terminated, true);
});

test('malformed worker output cannot become a stored PNG', async () => {
  const worker = workerBoundary(target => target.onmessage({ data: { data: new Uint8ClampedArray(3), width: 1, height: 1 } }));
  const render = createDetailRenderer({ createWorker: () => worker });
  await assert.rejects(render(new Uint8ClampedArray(4), 1, 1, { width: 1, height: 1 }), /결과/);
  assert.equal(worker.terminated, true);
});

test('runtime errors reject the conversion and the following attempt can succeed', async () => {
  let attempts = 0;
  const workers = [];
  const render = createDetailRenderer({ createWorker: () => {
    const worker = workerBoundary(target => {
      if (++attempts === 1) target.onerror({ preventDefault() {} });
      else target.onmessage({ data: { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 } });
    }); workers.push(worker); return worker;
  } });
  await assert.rejects(render(new Uint8ClampedArray(4), 1, 1, { width: 1, height: 1 }), /세밀/);
  const result = await render(new Uint8ClampedArray(4), 1, 1, { width: 1, height: 1 });
  assert.deepEqual([...result.data], [1, 2, 3, 255]);
  assert.equal(workers.every(worker => worker.terminated), true);
});

test('a stalled runtime times out and releases the worker', async () => {
  const worker = workerBoundary(() => {});
  const render = createDetailRenderer({ createWorker: () => worker, timeoutMs: 10 });
  await assert.rejects(render(new Uint8ClampedArray(4), 1, 1, { width: 1, height: 1 }), /시간/);
  assert.equal(worker.terminated, true);
});

test('worker-reported validation error reaches the caller', async () => {
  const worker = workerBoundary(target => target.onmessage({ data: { error: '변환 크기가 너무 큽니다.' } }));
  const render = createDetailRenderer({ createWorker: () => worker });
  await assert.rejects(render(new Uint8ClampedArray(4), 1, 1, { width: 1, height: 1 }), /크기/);
  assert.equal(worker.terminated, true);
});
