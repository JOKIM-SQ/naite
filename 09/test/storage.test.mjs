import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

const load = () => import('../public/storage.mjs');
const record = (id = 'a', createdAt = 1) => ({ id, name: '사진', createdAt, sourceBlob: new Blob(['source'], { type: 'image/jpeg' }), thumbnailBlob: new Blob(['thumb'], { type: 'image/png' }), pixelBlob: new Blob(['pixels'], { type: 'image/png' }), palette: ['#102030','#405060','#708090','#A0B0C0','#D0E0F0'], width: 400, height: 200, columns: 32, gridWidth: 32, gridHeight: 16 });

test('committed images, palette and settings survive closing and opening a new connection', async () => {
  const { createBoardStore } = await load();
  const factory = new IDBFactory();
  const store = await createBoardStore(factory, 'restore');
  await store.put(record());
  store.close();
  const reopened = await createBoardStore(factory, 'restore');
  const [saved] = await reopened.list();
  assert.equal(saved.id, 'a'); assert.equal(saved.name, '사진');
  assert.equal(await saved.sourceBlob.text(), 'source');
  assert.equal(await saved.thumbnailBlob.text(), 'thumb');
  assert.equal(await saved.pixelBlob.text(), 'pixels');
  assert.equal(saved.pixelBlob.type, 'image/png');
  assert.deepEqual(saved.palette, ['#102030','#405060','#708090','#A0B0C0','#D0E0F0']);
  assert.deepEqual([saved.width,saved.height,saved.columns,saved.gridWidth,saved.gridHeight], [400,200,32,32,16]);
  reopened.close();
});

test('list is newest first and full record updates and removal persist', async () => {
  const { createBoardStore } = await load();
  const store = await createBoardStore(new IDBFactory(), 'edits');
  await store.put(record('old', 1)); await store.put(record('new', 2));
  assert.deepEqual((await store.list()).map(item => item.id), ['new','old']);
  await store.put({ ...record('old', 1), name: '수정', columns: 64, gridWidth: 64, gridHeight: 32, pixelBlob: new Blob(['updated']) });
  const saved = (await store.list())[1];
  assert.equal(saved.name, '수정'); assert.equal(saved.columns, 64); assert.equal(await saved.pixelBlob.text(), 'updated');
  await store.remove('new'); assert.deepEqual((await store.list()).map(item => item.id), ['old']);
  store.close();
  await assert.rejects(store.put(record()));
});

test('request success followed by transaction abort must reject put and persist nothing', async t => {
  const { createBoardStore } = await load();
  const store = await createBoardStore(new IDBFactory(), 'abort');
  const original = IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype, 'put', function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await assert.rejects(store.put(record()));
  assert.deepEqual(await store.list(), []);
  store.close();
});

test('unsupported storage and uncloneable records reject instead of reporting success', async () => {
  const { createBoardStore } = await load();
  await assert.rejects(createBoardStore(null));
  const store = await createBoardStore(new IDBFactory(), 'invalid');
  await assert.rejects(store.put({ ...record(), uncloneable() {} }));
  assert.deepEqual(await store.list(), []);
  store.close();
});
