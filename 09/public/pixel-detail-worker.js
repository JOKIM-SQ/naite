/// <reference lib="webworker" />
const scope = /** @type {DedicatedWorkerGlobalScope & {cv:Promise<typeof import('@techstark/opencv-js')>}} */ (/** @type {unknown} */ (globalThis));

scope.onmessage = async ({ data: request }) => {
  try {
    scope.importScripts('./vendor/opencv.js');
    const [cv, { detailGrid }] = await Promise.all([scope.cv, import('./pixel-detail.mjs')]);
    const result = detailGrid(cv, request.data, request.width, request.height, request.grid);
    scope.postMessage(result, [result.data.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : '세밀 변환을 완료하지 못했습니다. 다시 시도해 주세요.' });
  }
};
