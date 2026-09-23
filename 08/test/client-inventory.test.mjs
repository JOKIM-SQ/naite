import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardSync, createStockMutations, validateItem, parseDelta } from '../public/inventory.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function syncHarness(load) {
  const channels = [];
  const snapshots = [];
  const statuses = [];
  const sync = createBoardSync({
    load,
    subscribe(boardId, changed, status) {
      const channel = { boardId, changed, status, removed: false };
      channels.push(channel);
      return () => { channel.removed = true; };
    },
    onItems: (items) => snapshots.push(items),
    onStatus: (status) => statuses.push(status),
  });
  return { sync, channels, snapshots, statuses };
}

// Removing the subscription gate could miss a write between initial read and subscription.
test('initial snapshot waits for subscription and reloads when a write arrives during that read', async () => {
  const first = deferred();
  const second = deferred();
  let reads = 0;
  const h = syncHarness(() => (++reads === 1 ? first.promise : second.promise));
  h.sync.select('board-a');
  await settle();
  assert.equal(reads, 0);
  h.channels[0].status('SUBSCRIBED');
  h.channels[0].changed();
  h.channels[0].changed();
  first.resolve([{ id: 'item-a', quantity: 5 }]);
  await settle();
  assert.equal(reads, 2);
  second.resolve([{ id: 'item-a', quantity: 8 }]);
  await settle();
  assert.deepEqual(h.snapshots.at(-1), [{ id: 'item-a', quantity: 8 }]);
  assert.equal(h.statuses.at(-1), 'live');
});

// Removing the generation check leaks the old board or signed-out user's data.
test('switching boards and logging out ignore old inflight snapshots and dispose channels', async () => {
  const old = deferred();
  const next = deferred();
  const h = syncHarness((board) => board === 'board-a' ? old.promise : next.promise);
  h.sync.select('board-a');
  h.channels[0].status('SUBSCRIBED');
  h.sync.select('board-b');
  h.channels[1].status('SUBSCRIBED');
  old.resolve([{ id: 'secret-a', quantity: 4 }]);
  await settle();
  assert.equal(h.channels[0].removed, true);
  assert.equal(h.snapshots.some((items) => items.some((item) => item.id === 'secret-a')), false);
  h.sync.stop();
  next.resolve([{ id: 'secret-b', quantity: 2 }]);
  await settle();
  assert.equal(h.channels[1].removed, true);
  assert.deepEqual(h.snapshots.at(-1), []);
});

test('reconnected channels requery and a failed snapshot can be explicitly retried', async () => {
  let reads = 0;
  const h = syncHarness(async () => {
    reads += 1;
    if (reads === 1) throw new Error('network unavailable');
    return [{ id: 'item-a', quantity: reads }];
  });
  h.sync.select('board-a');
  h.channels[0].status('SUBSCRIBED');
  await settle();
  assert.equal(h.statuses.at(-1), 'error');
  h.sync.refresh();
  await settle();
  assert.equal(h.snapshots.at(-1)[0].quantity, 2);
  h.channels[0].status('CHANNEL_ERROR');
  assert.equal(h.statuses.at(-1), 'offline');
  h.channels[0].status('SUBSCRIBED');
  await settle();
  assert.equal(h.snapshots.at(-1)[0].quantity, 3);
});

test('offline pause preserves the visible snapshot and ignores old subscription and inflight callbacks', async () => {
  const late = deferred();
  let reads = 0;
  const h = syncHarness(async () => {
    reads += 1;
    if (reads === 2) return late.promise;
    return [{ id: 'item-a', quantity: reads === 1 ? 7 : 11 }];
  });
  h.sync.select('board-a');
  h.channels[0].status('SUBSCRIBED');
  await settle();
  h.sync.refresh();
  h.sync.pause();
  late.resolve([{ id: 'item-a', quantity: 99 }]);
  h.channels[0].status('SUBSCRIBED');
  h.channels[0].changed();
  await settle();
  assert.equal(h.channels[0].removed, true);
  assert.equal(h.statuses.at(-1), 'offline');
  assert.deepEqual(h.snapshots.at(-1), [{ id: 'item-a', quantity: 7 }]);
  h.sync.reconnect();
  assert.deepEqual(h.snapshots.at(-1), [{ id: 'item-a', quantity: 7 }]);
  h.channels[1].status('SUBSCRIBED');
  await settle();
  assert.deepEqual(h.snapshots.at(-1), [{ id: 'item-a', quantity: 11 }]);
  assert.equal(h.statuses.at(-1), 'live');
});

// Generating a new request on retry would apply the same stock movement twice.
test('an uncertain mutation retries the original request id and prevents a different movement until resolved', async () => {
  let number = 0;
  let calls = 0;
  const committed = new Map();
  const mutations = createStockMutations({
    uuid: () => `request-${++number}`,
    adjust: async ({ itemId, delta, requestId }) => {
      calls += 1;
      if (!committed.has(requestId)) committed.set(requestId, { item_id: itemId, quantity: 10 + delta, revision: 2, request_id: requestId });
      if (calls === 1) throw new TypeError('Failed to fetch');
      return committed.get(requestId);
    },
  });
  await assert.rejects(mutations.run('item-a', 3));
  await assert.rejects(mutations.run('item-a', -1), /재시도/);
  assert.equal(mutations.pending('item-a').delta, 3);
  const result = await mutations.run('item-a', 3);
  assert.equal(result.quantity, 13);
  assert.equal(committed.size, 1);
  assert.equal(mutations.pending('item-a'), null);
});

test('rapid repeat submission shares the inflight movement while confirmed validation errors permit correction', async () => {
  const response = deferred();
  let requests = 0;
  const mutations = createStockMutations({ uuid: () => 'unique-id', adjust: () => { requests += 1; return response.promise; } });
  const a = mutations.run('item-a', 1);
  const b = mutations.run('item-a', 1);
  assert.equal(requests, 1);
  response.reject({ code: '22023', message: 'invalid_delta' });
  await assert.rejects(a);
  await assert.rejects(b);
  assert.equal(mutations.pending('item-a'), null);
});

test('stock input rejects fractions, exponent notation, zero changes, negative quantity and overflow', () => {
  for (const value of ['0', '1.5', '1e2', '', '1000001', '-1000001']) {
    assert.throws(() => parseDelta(value));
  }
  assert.equal(parseDelta(' +12 '), 12);
  assert.equal(parseDelta('-9'), -9);
  const valid = { name: ' 상자 ', sku: ' BX-01 ', quantity: '0', unit: ' 개 ', lowStock: '3' };
  assert.deepEqual(validateItem(valid), { name: '상자', sku: 'BX-01', quantity: 0, unit: '개', lowStock: 3 });
  for (const patch of [{ quantity: '-1' }, { quantity: '1000001' }, { lowStock: '2.1' }, { name: ' ' }, { sku: '' }, { unit: '' }]) {
    assert.throws(() => validateItem({ ...valid, ...patch }));
  }
});
