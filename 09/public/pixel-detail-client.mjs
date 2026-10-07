/** @typedef {{data:Uint8ClampedArray,width:number,height:number}} PixelGrid */
/** @typedef {Pick<Worker,'onmessage'|'onerror'|'onmessageerror'|'postMessage'|'terminate'>} DetailWorker */

/** @param {{createWorker?:()=>DetailWorker,timeoutMs?:number}} [options] */
export function createDetailRenderer({ createWorker = () => new Worker(new URL('./pixel-detail-worker.js', import.meta.url)), timeoutMs = 60_000 } = {}) {
  /** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {{width:number,height:number}} grid @returns {Promise<PixelGrid>} */
  return function render(pixels, width, height, grid) {
    return new Promise((resolve, reject) => {
      /** @type {DetailWorker} */ let worker;
      let timer;
      let finished = false;
      /** @param {Error} [error] @param {PixelGrid} [result] */
      function finish(error, result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker?.terminate();
        if (error) reject(error);
        else resolve(result);
      }
      try {
        worker = createWorker();
        timer = setTimeout(() => finish(new Error('세밀 변환 시간이 초과되었습니다. 이미지 크기를 줄이거나 다시 시도해 주세요.')), timeoutMs);
        worker.onerror = event => { event.preventDefault(); finish(new Error('세밀 변환을 시작하지 못했습니다. 다시 시도해 주세요.')); };
        worker.onmessageerror = () => finish(new Error('세밀 변환 결과를 읽지 못했습니다. 다시 시도해 주세요.'));
        worker.onmessage = ({ data: result }) => {
          if (typeof result?.error === 'string') { finish(new Error(result.error)); return; }
          if (!(result?.data instanceof Uint8ClampedArray) || result.width !== grid.width || result.height !== grid.height || result.data.length !== grid.width * grid.height * 4) {
            finish(new Error('세밀 변환 결과가 올바르지 않습니다. 다시 시도해 주세요.')); return;
          }
          finish(undefined, result);
        };
        const data = new Uint8ClampedArray(pixels);
        worker.postMessage({ data, width, height, grid }, [data.buffer]);
      } catch (cause) {
        finish(new Error('이 브라우저에서 세밀 변환을 시작할 수 없습니다. 다시 시도해 주세요.', { cause }));
      }
    });
  };
}

export const renderDetailGrid = createDetailRenderer();
