const MAX_STOCK = 1_000_000;

function integer(value, label, signed = false) {
  const text = String(value ?? '').trim();
  if (!(signed ? /^[+-]?\d+$/ : /^\d+$/).test(text)) {
    throw new Error(`${label}은 정수로 입력해 주세요.`);
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || Math.abs(number) > MAX_STOCK || (!signed && number < 0)) {
    throw new Error(`${label}은 ${signed ? '-1,000,000' : '0'}부터 1,000,000 사이로 입력해 주세요.`);
  }
  return number;
}

export function parseDelta(value) {
  const delta = integer(value, '변경 수량', true);
  if (delta === 0) throw new Error('변경 수량은 0이 될 수 없습니다.');
  return delta;
}

export function validateItem(values) {
  const name = String(values.name ?? '').trim();
  const sku = String(values.sku ?? '').trim();
  const unit = String(values.unit ?? '').trim();
  if (!name || name.length > 100) throw new Error('품목명은 1~100자로 입력해 주세요.');
  if (!sku || sku.length > 64) throw new Error('SKU는 1~64자로 입력해 주세요.');
  if (!unit || unit.length > 20) throw new Error('단위는 1~20자로 입력해 주세요.');
  return { name, sku, quantity: integer(values.quantity, '초기 수량'), unit, lowStock: integer(values.lowStock, '부족 기준') };
}

/** A single serial read loop closes the read/subscribe race and coalesces invalidations. */
export function createBoardSync({ load, subscribe, onItems, onStatus }) {
  let current = null;

  async function drain(state) {
    if (state.running || !state.subscribed || current !== state) return;
    state.running = true;
    try {
      while (current === state && state.dirty && state.subscribed) {
        state.dirty = false;
        onStatus('loading');
        try {
          const items = await load(state.boardId);
          if (current !== state) return;
          onItems(items);
          if (state.subscribed) onStatus('live');
        } catch (error) {
          if (current !== state) return;
          onStatus('error', error);
        }
      }
    } finally {
      state.running = false;
    }
  }

  function invalidate(state) {
    if (current !== state) return;
    state.dirty = true;
    void drain(state);
  }

  function stop() {
    const previous = current;
    current = null;
    previous?.dispose?.();
    onItems([]);
    onStatus('idle');
  }

  function select(boardId, preserveSnapshot = false) {
    if (preserveSnapshot) {
      const previous = current;
      current = null;
      previous?.dispose?.();
    } else stop();
    if (!boardId) return;
    const state = { boardId, running: false, subscribed: false, dirty: false, dispose: null };
    current = state;
    onStatus('connecting');
    try {
      state.dispose = subscribe(boardId, () => invalidate(state), (status, error) => {
        if (current !== state) return;
        state.subscribed = status === 'SUBSCRIBED';
        if (state.subscribed) invalidate(state);
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) onStatus('offline', error);
      });
    } catch (error) {
      onStatus('offline', error);
    }
  }

  return {
    select,
    stop,
    pause() {
      if (!current) return;
      const previous = current;
      // Retire the whole generation so a pending read or old channel cannot revive it.
      current = { boardId: previous.boardId, running: false, subscribed: false, dirty: false, dispose: null };
      previous.dispose?.();
      onStatus('offline');
    },
    refresh() { if (current) invalidate(current); },
    reconnect() { if (current) select(current.boardId, true); },
  };
}

/** These SQL errors confirm the transaction was rejected, rather than its response lost. */
export function isDefinitiveError(error) {
  return ['22023', '22003', '23505', '23514', '42501', 'P0001', 'P0002', '28000'].includes(error?.code);
}

export function createStockMutations({ adjust, uuid = () => globalThis.crypto.randomUUID() }) {
  const requests = new Map();
  function run(itemId, inputDelta) {
    let delta;
    try { delta = parseDelta(inputDelta); } catch (error) { return Promise.reject(error); }
    let request = requests.get(itemId);
    if (request && request.delta !== delta) {
      return Promise.reject(new Error('이 품목의 이전 변경 결과를 먼저 재시도해 확인해 주세요.'));
    }
    if (request?.promise) return request.promise;
    if (!request) {
      request = { itemId, delta, requestId: uuid(), promise: null };
      requests.set(itemId, request);
    }
    // Invoke immediately so a second click observes the same in-flight promise.
    let operation;
    try { operation = adjust({ itemId, delta, requestId: request.requestId }); }
    catch (error) { operation = Promise.reject(error); }
    request.promise = Promise.resolve(operation).then((result) => {
      if (requests.get(itemId) === request) requests.delete(itemId);
      return result;
    }, (error) => {
      if (isDefinitiveError(error) && requests.get(itemId) === request) requests.delete(itemId);
      request.promise = null;
      throw error;
    });
    return request.promise;
  }
  return {
    run,
    pending(itemId) {
      const request = requests.get(itemId);
      return request ? { itemId, delta: request.delta, requestId: request.requestId, busy: Boolean(request.promise) } : null;
    },
    clear() { requests.clear(); },
  };
}
