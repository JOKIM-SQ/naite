import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { startApp, errorMessage, parseInvitation } from '../public/app.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 8));
const board = { id: 'dbd934c4-5a40-4ed5-825c-b652593c3ad2', name: '작업실', role: 'owner' };
const item = { id: '29359722-e3f6-4f1c-b1a2-43d4887c77f6', board_id: board.id, name: '<img src=x onerror=alert(1)>', sku: 'TEST-1', quantity: 7, unit: '개', low_stock: 2, revision: 1, updated_at: '2026-09-23T00:00:00Z', updated_by: 'user-1' };
const session = { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, expires_at: 9999999999, token_type: 'bearer', user: { id: 'user-1', email: 'member@example.com', user_metadata: { full_name: '재고 담당자' }, app_metadata: { provider: 'google' }, aud: 'authenticated', created_at: '2026-09-23T00:00:00Z' } };
const invite = '9a0c777b-7609-453e-8af2-279f96e45c79';

test('RPC errors explain stock and membership failures without exposing raw database details', () => {
  assert.match(errorMessage({ code: '23505', message: 'duplicate key value violates unique constraint s08_items_sku_idx' }), /SKU/);
  assert.match(errorMessage({ code: '42501', message: 'not_a_member' }), /권한|멤버/);
  assert.match(errorMessage({ code: '22003', message: 'quantity_out_of_range' }), /수량/);
  const network = errorMessage({ message: 'Failed to fetch secret-context' });
  assert.match(network, /연결|재시도/);
  assert.doesNotMatch(network, /secret-context/);
});

test('invite entry accepts a shared link or UUID and rejects arbitrary text', () => {
  assert.equal(parseInvitation(`https://stockroom.example/#invite=${invite}`), invite);
  assert.equal(parseInvitation(` ${invite} `), invite);
  assert.throws(() => parseInvitation('not-an-invitation'));
});

async function harness({ signedIn = true, hash = '', storage = new Map(), configOk = true, rpcOverride, queryOverride, now = () => Date.now() } = {}) {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { window, document } = parseHTML(html);
  const dialogPrototype = Object.getPrototypeOf(document.createElement('dialog'));
  dialogPrototype.showModal = function () { this.open = true; };
  dialogPrototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.HTMLInputElement.prototype.select = function () { this.selectionStart = 0; this.selectionEnd = this.value.length; };
  Object.defineProperty(window, 'navigator', { configurable: true, value: { onLine: true, clipboard: { async writeText() { throw new DOMException('Permission denied', 'NotAllowedError'); } } } });
  const location = new URL(`https://stockroom.example/${hash}`);
  window.location = location;
  window.history = { replaceState: (_state, _unused, url) => { location.href = new URL(url, location).href; } };
  window.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  const calls = [];
  const channels = [];
  let callback;
  let insideAuthCallback = false;
  let rows = [item];
  const client = {
    auth: {
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session: signedIn ? session : null }, error: null }; },
      async signInWithOAuth(options) { calls.push(['oauth', options]); return { data: { provider: 'google', url: 'https://accounts.google.com/' }, error: null }; },
      async signOut() { callback('SIGNED_OUT', null); return { error: null }; },
    },
    async rpc(name, args) {
      assert.equal(insideAuthCallback, false, 'DB calls inside auth callback can deadlock the SDK');
      calls.push([name, args]);
      const custom = await rpcOverride?.(name, args, { setRows: (value) => { rows = value; } });
      if (custom) return custom;
      if (name === 's08_list_boards') return { data: [board], error: null };
      if (name === 's08_join_board') return { data: board.id, error: null };
      if (name === 's08_get_invite') return { data: invite, error: null };
      if (name === 's08_adjust_stock') { rows = [{ ...item, quantity: item.quantity + args.p_delta }]; return { data: { item_id: item.id, quantity: rows[0].quantity, revision: 2, request_id: args.p_request_id }, error: null }; }
      if (name === 's08_add_item') { rows = [...rows, { ...item, id: 'item-new', name: args.p_name, sku: args.p_sku, quantity: args.p_quantity, unit: args.p_unit, low_stock: args.p_low_stock }]; return { data: rows.at(-1), error: null }; }
      if (name === 's08_list_item_movements') return { data: [], error: null };
      return { data: board.id, error: null };
    },
    channel(name, options) {
      const channel = { name, options, removed: false, on(_kind, filter, changed) { this.filter = filter; this.changed = changed; return this; }, subscribe(status) { this.status = status; calls.push(['subscribe']); queueMicrotask(() => status('SUBSCRIBED')); return this; } };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { channel.removed = true; return 'ok'; },
    from(table) { return { select(columns) { return { eq(key, value) { return { async order(column) { calls.push(['query', table, columns, key, value, column]); return queryOverride ? queryOverride() : { data: rows, error: null }; } }; } }; } }; },
  };
  await startApp({ window, document, now, fetch: async () => ({ ok: configOk, json: async () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', provider: 'google' }) }), createClient: (_url, _key, options) => { calls.push(['client', options]); return client; } });
  await tick();
  return { window, document, calls, channels, storage, emitAuth(event, value) { insideAuthCallback = true; callback(event, value); insideAuthCallback = false; }, click(id) { document.getElementById(id).click(); }, submit(id) { document.getElementById(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); } };
}

test('signed-in app subscribes before reading and renders remote stock as literal text', async () => {
  const h = await harness();
  assert.equal(h.document.getElementById('workspace').hidden, false);
  assert.equal(h.document.querySelector('.stock-value')?.textContent, '7');
  assert.equal(h.document.querySelector('#items-list img'), null);
  assert.match(h.document.getElementById('items-list').textContent, /<img src=x/);
  assert.ok(h.calls.findIndex(([name]) => name === 'subscribe') < h.calls.findIndex(([name]) => name === 'query'));
  assert.equal(h.channels[0].filter.filter, `board_id=eq.${board.id}`);
  assert.equal(h.channels[0].options?.config.postgres_changes_options.wait, true, 'SUBSCRIBED must mean replication is ready, not only socket joined');
});

test('invite survives OAuth and auth callbacks defer joining until outside the SDK lock', async () => {
  const h = await harness({ signedIn: false, hash: `#invite=${invite}` });
  assert.equal(h.window.location.hash, '');
  h.click('sign-in');
  await tick();
  assert.equal(h.calls.find(([name]) => name === 'oauth')[1].options.redirectTo, 'https://stockroom.example/');
  h.emitAuth('SIGNED_IN', session);
  await tick();
  await tick();
  assert.equal(h.calls.find(([name]) => name === 's08_join_board')[1].p_invite_code, invite);
  assert.equal(h.document.querySelector('.stock-value')?.textContent, '7');
  assert.equal(h.storage.size, 0);
});

test('uncertain stock response exposes retry and reuses its request while rendering the latest snapshot', async () => {
  let attempts = 0;
  const ids = [];
  const timestamps = [];
  let now = Date.parse('2026-09-24T12:00:00.000Z');
  const h = await harness({ now: () => now, rpcOverride(name, args, context) {
    if (name !== 's08_adjust_stock') return null;
    attempts += 1;
    ids.push(args.p_request_id);
    timestamps.push(args.p_sent_at);
    context.setRows([{ ...item, quantity: 8 }]);
    if (attempts === 1) return { data: null, error: { message: 'Failed to fetch' } };
    return { data: { item_id: item.id, quantity: 8, revision: 2, request_id: args.p_request_id }, error: null };
  } });
  h.document.querySelector('[data-action="increase"]').click();
  await tick();
  assert.match(h.document.querySelector('[data-action="adjust"]').textContent, /재시도/);
  now += 1_000;
  h.document.querySelector('[data-action="adjust"]').click();
  h.submit('adjust-form');
  await tick();
  assert.deepEqual(ids, [ids[0], ids[0]]);
  assert.deepEqual(timestamps, ['2026-09-24T12:00:00.000Z', '2026-09-24T12:00:00.000Z']);
  assert.equal(attempts, 2);
  assert.equal(h.document.querySelector('.stock-value')?.textContent, '8');
});

test('latency UI measures the received change while snapshots, refreshes, and new-item events stay unmeasured', async () => {
  let now = Date.parse('2026-09-24T12:00:00.000Z');
  const h = await harness({ now: () => now });
  const value = h.document.getElementById('latency-value');
  const detail = h.document.getElementById('latency-detail');
  const metric = h.document.getElementById('change-latency');
  assert.equal(value.textContent, '—');
  assert.equal(metric.dataset.state, 'waiting');
  h.document.querySelector('[data-action="increase"]').click();
  await tick();
  assert.equal(h.calls.find(([name]) => name === 's08_adjust_stock')[1].p_sent_at, '2026-09-24T12:00:00.000Z');
  assert.equal(value.textContent, '—');
  now += 247;
  const changed = { eventType: 'UPDATE', new: { ...item, revision: 2, change_sent_at: '2026-09-24T12:00:00.000Z' } };
  h.channels[0].changed({ ...changed, eventType: 'INSERT' });
  assert.equal(value.textContent, '—');
  h.channels[0].changed(changed);
  assert.equal(value.textContent, '247');
  assert.equal(h.document.getElementById('latency-unit').textContent, 'ms');
  assert.equal(metric.dataset.state, 'measured');
  assert.match(detail.textContent, /수신/);
  now += 1_000;
  h.channels[0].changed(changed);
  h.window.dispatchEvent(new h.window.Event('focus'));
  await tick();
  assert.equal(value.textContent, '247');
});

test('latency UI clears on offline and logout and ignores the retired channel', async () => {
  const h = await harness({ now: () => Date.parse('2026-09-24T12:00:00.247Z') });
  const changed = { eventType: 'UPDATE', new: { ...item, revision: 2, change_sent_at: '2026-09-24T12:00:00.000Z' } };
  const metric = h.document.getElementById('change-latency');
  const value = h.document.getElementById('latency-value');
  h.channels[0].changed(changed);
  assert.equal(value.textContent, '247');
  h.window.dispatchEvent(new h.window.Event('offline'));
  h.channels[0].changed({ ...changed, new: { ...changed.new, revision: 3 } });
  assert.equal(value.textContent, '—');
  assert.equal(metric.dataset.state, 'offline');
  assert.match(h.document.getElementById('latency-detail').textContent, /복구/);
  h.window.dispatchEvent(new h.window.Event('online'));
  await tick();
  assert.equal(metric.dataset.state, 'waiting');
  h.channels[1].changed({ ...changed, new: { ...changed.new, revision: 3 } });
  assert.equal(value.textContent, '247');
  h.click('sign-out');
  await tick();
  h.channels[1].changed({ ...changed, new: { ...changed.new, revision: 4 } });
  assert.equal(value.textContent, '—');
  assert.equal(metric.dataset.state, 'waiting');
});

test('legacy and invalid clock changes explain unavailable measurements without showing zero ms', async () => {
  const h = await harness({ now: () => Date.parse('2026-09-24T12:00:00.247Z') });
  const metric = h.document.getElementById('change-latency');
  const detail = h.document.getElementById('latency-detail');
  h.channels[0].changed({ eventType: 'UPDATE', new: { ...item, revision: 2, change_sent_at: null } });
  assert.equal(metric.dataset.state, 'unmeasured');
  assert.equal(h.document.getElementById('latency-value').textContent, '—');
  assert.equal(h.document.getElementById('latency-unit').textContent, '');
  assert.match(detail.textContent, /전송 시각/);
  h.channels[0].changed({ eventType: 'UPDATE', new: { ...item, revision: 3, change_sent_at: '2026-09-24T12:00:01.000Z' } });
  assert.equal(metric.dataset.state, 'unmeasured');
  assert.equal(h.document.getElementById('latency-value').textContent, '—');
  assert.match(detail.textContent, /시계|시각 차이/);
});

test('sign out removes the channel and inventory even if an earlier query resolves afterward', async () => {
  let finish;
  const h = await harness({ queryOverride: () => new Promise((resolve) => { finish = resolve; }) });
  h.click('sign-out');
  await tick();
  finish({ data: [item], error: null });
  await tick();
  assert.equal(h.document.getElementById('workspace').hidden, true);
  assert.equal(h.document.querySelectorAll('.inventory-row').length, 0);
  assert.equal(h.channels[0].removed, true);
  assert.equal(h.document.getElementById('login-panel').hidden, false);
});

test('missing service configuration displays a visible setup error and disables login', async () => {
  const h = await harness({ configOk: false });
  assert.equal(h.document.getElementById('sign-in').disabled, true);
  assert.match(h.document.getElementById('app-status').textContent, /설정/);
  assert.equal(h.calls.some(([name]) => name === 'client'), false);
});

test('item form exposes invalid input, then registers a valid item and displays the saved snapshot', async () => {
  const h = await harness();
  h.click('add-item-button');
  for (const [id, value] of [['item-name', '새 상자'], ['item-sku', 'BOX-2'], ['item-quantity', '-1'], ['item-unit', '박스'], ['item-low-stock', '3']]) h.document.getElementById(id).value = value;
  h.submit('item-form');
  await tick();
  assert.equal(h.document.getElementById('item-form-error').hidden, false);
  assert.equal(h.calls.some(([name]) => name === 's08_add_item'), false);
  h.document.getElementById('item-quantity').value = '12';
  h.submit('item-form');
  await tick();
  assert.equal(h.document.querySelectorAll('.inventory-row').length, 2);
  assert.equal(h.document.getElementById('total-quantity').textContent, '19');
  assert.equal(h.document.getElementById('item-dialog').open, false);
  assert.deepEqual(h.calls.find(([name]) => name === 's08_add_item')[1], { p_board_id: board.id, p_name: '새 상자', p_sku: 'BOX-2', p_quantity: 12, p_unit: '박스', p_low_stock: 3 });
});

test('invalid signed stock input stays visible in the dialog and does not mutate stock', async () => {
  const h = await harness();
  h.document.querySelector('[data-action="adjust"]').click();
  h.document.getElementById('adjust-delta').value = '0';
  h.submit('adjust-form');
  await tick();
  assert.equal(h.document.getElementById('adjust-error').hidden, false);
  assert.match(h.document.getElementById('adjust-error').textContent, /0/);
  assert.equal(h.calls.some(([name]) => name === 's08_adjust_stock'), false);
  assert.equal(h.document.querySelector('.stock-value').textContent, '7');
});

test('a definitive rejection after an uncertain retry unlocks the delta for correction', async () => {
  let attempts = 0;
  const h = await harness({ rpcOverride(name) {
    if (name !== 's08_adjust_stock') return null;
    attempts += 1;
    return attempts === 1 ? { data: null, error: { message: 'Failed to fetch' } } : { data: null, error: { code: '22023', message: '변경 후 수량은 0~1,000,000이어야 합니다.' } };
  } });
  h.document.querySelector('[data-action="increase"]').click();
  await tick();
  h.document.querySelector('[data-action="adjust"]').click();
  h.submit('adjust-form');
  await tick();
  assert.equal(h.document.getElementById('adjust-delta').readOnly, false);
  assert.equal(h.document.getElementById('adjust-error').hidden, false);
});

test('a first-time member creates a board through the setup form and enters its live inventory', async () => {
  let created = false;
  const h = await harness({ rpcOverride(name) {
    if (name === 's08_list_boards') return { data: created ? [board] : [], error: null };
    if (name === 's08_create_board') { created = true; return { data: board.id, error: null }; }
    return null;
  } });
  assert.equal(h.document.getElementById('setup-panel').hidden, false);
  assert.equal(h.document.getElementById('workspace').hidden, true);
  h.document.getElementById('board-name').value = ' 작업실 ';
  h.submit('create-board-form');
  await tick();
  assert.deepEqual(h.calls.find(([name]) => name === 's08_create_board')[1], { p_name: '작업실' });
  assert.equal(h.document.getElementById('setup-panel').hidden, true);
  assert.equal(h.document.getElementById('workspace').hidden, false);
  assert.equal(h.document.querySelector('.stock-value').textContent, '7');
});

test('an invited member sees stock but cannot request an owner invitation', async () => {
  const h = await harness({ rpcOverride(name) { return name === 's08_list_boards' ? { data: [{ ...board, role: 'member' }], error: null } : null; } });
  assert.equal(h.document.querySelector('.stock-value').textContent, '7');
  assert.equal(h.document.getElementById('invite-button').hidden, true);
  h.click('invite-button');
  await tick();
  assert.equal(h.calls.some(([name]) => name === 's08_get_invite'), false);
});

test('a new page after OAuth consumes the saved invitation and focus refreshes changed remote stock', async () => {
  const storage = new Map();
  await harness({ signedIn: false, hash: `#invite=${invite}`, storage });
  let quantity = 7;
  const h = await harness({ storage, queryOverride: async () => ({ data: [{ ...item, quantity }], error: null }) });
  assert.equal(h.calls.find(([name]) => name === 's08_join_board')[1].p_invite_code, invite);
  quantity = 14;
  h.window.dispatchEvent(new h.window.Event('focus'));
  await tick();
  assert.equal(h.document.querySelector('.stock-value').textContent, '14');
});

test('browser offline immediately disables inventory changes, preserves stock, then reconnects and refreshes online', async () => {
  let quantity = 7;
  const h = await harness({ queryOverride: async () => ({ data: [{ ...item, quantity }], error: null }) });
  h.window.dispatchEvent(new h.window.Event('offline'));
  assert.match(h.document.getElementById('connection-status').textContent, /연결 끊김/);
  assert.equal(h.document.getElementById('add-item-button').disabled, true);
  assert.equal(h.document.querySelector('[data-action="increase"]').disabled, true);
  assert.equal(h.document.querySelector('[data-action="adjust"]').disabled, true);
  assert.equal(h.document.querySelector('.stock-value').textContent, '7');
  h.channels[0].status('SUBSCRIBED');
  await tick();
  assert.match(h.document.getElementById('connection-status').textContent, /연결 끊김/);
  quantity = 16;
  h.window.dispatchEvent(new h.window.Event('online'));
  await tick();
  assert.equal(h.channels[0].removed, true);
  assert.equal(h.channels.length, 2);
  assert.equal(h.document.querySelector('.stock-value').textContent, '16');
  assert.equal(h.document.getElementById('add-item-button').disabled, false);
  assert.equal(h.document.querySelector('[data-action="increase"]').disabled, false);
  assert.equal(h.document.getElementById('toast').dataset.kind, 'success');
});

for (const result of ['success', 'error']) {
  test(`an earlier item's ${result} does not alter another item's open adjustment dialog`, async () => {
    let finish;
    const second = { ...item, id: 'item-b', name: '다른 상자', sku: 'B-2', quantity: 10 };
    const h = await harness({
      queryOverride: async () => ({ data: [item, second], error: null }),
      rpcOverride(name) { return name === 's08_adjust_stock' ? new Promise((resolve) => { finish = resolve; }) : null; },
    });
    h.document.querySelector(`[data-action="increase"][data-item-id="${item.id}"]`).click();
    h.document.querySelector('[data-action="adjust"][data-item-id="item-b"]').click();
    h.document.getElementById('adjust-delta').value = '-2';
    assert.equal(h.document.getElementById('adjust-submit').disabled, false);
    finish(result === 'success' ? { data: { item_id: item.id, quantity: 8, revision: 2, request_id: 'prior-request' }, error: null } : { data: null, error: { message: 'Failed to fetch' } });
    await tick();
    assert.equal(h.document.getElementById('adjust-dialog').open, true);
    assert.equal(h.document.getElementById('adjust-delta').value, '-2');
    assert.equal(h.document.getElementById('adjust-delta').readOnly, false);
    assert.equal(h.document.getElementById('adjust-error').hidden, true);
  });
}

test('clipboard rejection exposes a selectable invitation link and logout clears it', async () => {
  const h = await harness();
  h.click('invite-button');
  await tick();
  const dialog = h.document.getElementById('invite-dialog');
  assert.equal(dialog?.open, true);
  const input = h.document.getElementById('invite-link');
  assert.equal(input.value, `https://stockroom.example/#invite=${invite}`);
  assert.equal(input.readOnly, true);
  assert.equal(input.selectionEnd, input.value.length);
  h.click('sign-out');
  await tick();
  assert.equal(dialog.open, false);
  assert.equal(input.value, '');
});

const movement = { request_id: 'request-history-1', actor_id: 'user-1', actor_name: '<img src=x onerror=alert(1)>', delta: 3, quantity_before: 4, quantity_after: 7, created_at: '2026-09-24T12:00:00.123456Z' };

// A text-only row protects actor identity labels while showing an audit-friendly before/after.
test('item history renders actor, signed movement, before/after quantities, and time without interpreting actor HTML', async () => {
  const h = await harness({ rpcOverride(name) { return name === 's08_list_item_movements' ? { data: [movement, { ...movement, request_id: 'request-2', actor_id: 'user-2', actor_name: '다른 팀원', delta: -2, quantity_before: 9, quantity_after: 7 }], error: null } : null; } });
  h.document.querySelector('[data-action="history"]')?.click();
  await tick();
  assert.equal(h.document.getElementById('adjust-dialog').open, true);
  assert.equal(h.document.getElementById('history-panel').hidden, false);
  const entries = h.document.querySelectorAll('.history-entry');
  assert.equal(entries.length, 2);
  assert.match(entries[0].querySelector('.history-actor').textContent, /<img src=x.*\(나\)/);
  assert.equal(entries[0].querySelector('img'), null);
  assert.match(entries[0].querySelector('.history-delta').textContent, /\+3/);
  assert.equal(entries[0].querySelector('.history-delta').dataset.direction, 'in');
  assert.match(entries[0].querySelector('.history-balance').textContent, /4.*→.*7/);
  assert.equal(entries[0].querySelector('time').getAttribute('datetime'), movement.created_at);
  assert.match(entries[1].querySelector('.history-delta').textContent, /-2|−2/);
  assert.equal(entries[1].querySelector('.history-delta').dataset.direction, 'out');
  assert.equal(h.calls.some(([name]) => name === 's08_adjust_stock'), false);
});

// A composite cursor must preserve timestamp precision and disambiguate equal-time movements.
test('history paginates with the last timestamp and request id, appends results, and hides more at the end', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...movement, request_id: `request-${index}` }));
  let reads = 0;
  const h = await harness({ rpcOverride(name) { if (name !== 's08_list_item_movements') return null; reads += 1; return { data: reads === 1 ? firstPage : [{ ...movement, request_id: 'request-older' }], error: null }; } });
  h.document.querySelector('[data-action="history"]')?.click();
  await tick();
  assert.equal(h.document.querySelectorAll('.history-entry').length, 20);
  assert.equal(h.document.getElementById('history-more').hidden, false);
  h.click('history-more');
  await tick();
  const requests = h.calls.filter(([name]) => name === 's08_list_item_movements');
  assert.deepEqual(requests[0][1], { p_item_id: item.id, p_before_created_at: null, p_before_request_id: null, p_limit: 20 });
  assert.deepEqual(requests[1][1], { p_item_id: item.id, p_before_created_at: '2026-09-24T12:00:00.123456Z', p_before_request_id: 'request-19', p_limit: 20 });
  assert.equal(h.document.querySelectorAll('.history-entry').length, 21);
  assert.equal(h.document.getElementById('history-more').hidden, true);
});

// Older pages cannot acknowledge unseen newest rows; only a fresh first-page read can.
test('history pagination preserves the new-record notice and a change during refresh keeps it visible', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...movement, request_id: `request-${index}` }));
  let revision = 1;
  let reads = 0;
  let finishRefresh;
  const h = await harness({
    queryOverride: async () => ({ data: [{ ...item, revision }], error: null }),
    rpcOverride(name) {
      if (name !== 's08_list_item_movements') return null;
      reads += 1;
      if (reads === 3) return new Promise((resolve) => { finishRefresh = resolve; });
      return { data: reads === 2 ? [{ ...movement, request_id: 'request-older' }] : firstPage, error: null };
    },
  });
  h.document.querySelector('[data-action="history"]').click();
  await tick();
  const status = h.document.getElementById('history-status');
  revision = 2;
  h.channels[0].changed({ eventType: 'UPDATE', new: { ...item, revision, change_sent_at: null } });
  await tick();
  assert.match(status.textContent, /새 입출고 기록/);
  h.click('history-more');
  await tick();
  assert.equal(h.document.querySelectorAll('.history-entry').length, 21);
  assert.match(status.textContent, /새 입출고 기록/);
  h.click('history-refresh');
  assert.doesNotMatch(status.textContent, /새 입출고 기록/);
  revision = 3;
  h.channels[0].changed({ eventType: 'UPDATE', new: { ...item, revision, change_sent_at: null } });
  await tick();
  assert.match(status.textContent, /새 입출고 기록/);
  finishRefresh({ data: firstPage, error: null });
  await tick();
  assert.match(status.textContent, /새 입출고 기록/);
  h.click('history-refresh');
  await tick();
  assert.doesNotMatch(status.textContent, /새 입출고 기록/);
  assert.equal(reads, 4);
});

test('history query errors provide a retry and successful empty results show an empty state', async () => {
  let reads = 0;
  const h = await harness({ rpcOverride(name) { if (name !== 's08_list_item_movements') return null; reads += 1; return reads === 1 ? { data: null, error: { message: 'Failed to fetch private detail' } } : { data: [], error: null }; } });
  h.document.querySelector('[data-action="history"]')?.click();
  await tick();
  assert.match(h.document.getElementById('history-status').textContent, /실패|못했|불러오지/);
  assert.doesNotMatch(h.document.getElementById('history-status').textContent, /private detail/);
  assert.equal(h.document.getElementById('history-refresh').disabled, false);
  h.click('history-refresh');
  await tick();
  assert.equal(reads, 2);
  assert.match(h.document.getElementById('history-status').textContent, /없|아직/);
  assert.equal(h.document.querySelectorAll('.history-entry').length, 0);
});

// Late history responses must never cross item, dialog, board, or authentication boundaries.
test('history ignores an old item response and clears pending results when closed or signed out', async () => {
  const pending = [];
  const second = { ...item, id: 'item-b', name: '다른 상자', sku: 'B-2' };
  const h = await harness({ queryOverride: async () => ({ data: [item, second], error: null }), rpcOverride(name, args) { return name === 's08_list_item_movements' ? new Promise((resolve) => pending.push({ itemId: args.p_item_id, resolve })) : null; } });
  h.document.querySelector(`[data-action="history"][data-item-id="${item.id}"]`)?.click();
  await tick();
  assert.equal(pending.length, 1);
  h.document.querySelector('[data-action="history"][data-item-id="item-b"]')?.click();
  await tick();
  pending[1].resolve({ data: [{ ...movement, actor_name: '현재 품목 담당자' }], error: null });
  await tick();
  pending[0].resolve({ data: [movement], error: null });
  await tick();
  assert.match(h.document.getElementById('history-list').textContent, /현재 품목 담당자/);
  assert.doesNotMatch(h.document.getElementById('history-list').textContent, /<img/);
  h.click('history-refresh');
  await tick();
  h.click('history-close');
  pending[2].resolve({ data: [movement], error: null });
  await tick();
  assert.equal(h.document.querySelectorAll('.history-entry').length, 0);
  h.document.querySelector('[data-action="history"][data-item-id="item-b"]').click();
  await tick();
  h.click('sign-out');
  await tick();
  pending[3].resolve({ data: [movement], error: null });
  await tick();
  assert.equal(h.document.querySelectorAll('.history-entry').length, 0);
  assert.equal(h.document.getElementById('adjust-dialog').open, false);
});

test('history tabs support keyboard navigation and cannot submit a hidden stock form or close when its earlier save completes', async () => {
  let finishSave;
  const h = await harness({ rpcOverride(name) { return name === 's08_adjust_stock' ? new Promise((resolve) => { finishSave = resolve; }) : null; } });
  h.document.querySelector('[data-action="adjust"]').click();
  h.document.getElementById('adjust-delta').value = '2';
  h.submit('adjust-form');
  await tick();
  const key = (id, value) => { const event = new h.window.Event('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'key', { value }); h.document.getElementById(id).dispatchEvent(event); };
  key('adjust-tab', 'ArrowRight');
  await tick();
  assert.equal(h.document.getElementById('history-tab').getAttribute('aria-selected'), 'true');
  // Linkedom's tabIndex getter maps the valid value 0 to -1; inspect the reflected attribute.
  assert.equal(h.document.getElementById('history-tab').getAttribute('tabindex'), '0');
  assert.equal(h.document.getElementById('adjust-panel').hidden, true);
  h.submit('adjust-form');
  assert.equal(h.calls.filter(([name]) => name === 's08_adjust_stock').length, 1);
  finishSave({ data: { item_id: item.id, quantity: 9, revision: 2, request_id: 'saved' }, error: null });
  await tick();
  assert.equal(h.document.getElementById('adjust-dialog').open, true);
  assert.equal(h.document.getElementById('history-panel').hidden, false);
  key('history-tab', 'Home');
  assert.equal(h.document.getElementById('adjust-tab').getAttribute('aria-selected'), 'true');
  key('adjust-tab', 'End');
  assert.equal(h.document.getElementById('history-tab').getAttribute('aria-selected'), 'true');
  key('history-tab', 'ArrowLeft');
  assert.equal(h.document.getElementById('adjust-tab').getAttribute('aria-selected'), 'true');
});

test('offline history retires pending reads and offers refresh after connection recovery', async () => {
  let finish;
  const h = await harness({ rpcOverride(name) { return name === 's08_list_item_movements' ? new Promise((resolve) => { finish = resolve; }) : null; } });
  h.document.querySelector('[data-action="history"]')?.click();
  await tick();
  assert.equal(typeof finish, 'function');
  h.window.dispatchEvent(new h.window.Event('offline'));
  finish({ data: [movement], error: null });
  await tick();
  assert.equal(h.document.querySelectorAll('.history-entry').length, 0);
  assert.equal(h.document.getElementById('history-refresh').disabled, true);
  assert.match(h.document.getElementById('history-status').textContent, /연결/);
  h.window.dispatchEvent(new h.window.Event('online'));
  await tick();
  assert.equal(h.document.getElementById('history-refresh').disabled, false);
});

test('returning from history after an uncertain save exposes the original retry instead of an editable new movement', async () => {
  let finish;
  const h = await harness({ rpcOverride(name) { return name === 's08_adjust_stock' ? new Promise((resolve) => { finish = resolve; }) : null; } });
  h.document.querySelector('[data-action="adjust"]').click();
  h.document.getElementById('adjust-delta').value = '3';
  h.submit('adjust-form');
  h.click('history-tab');
  finish({ data: null, error: { message: 'Failed to fetch' } });
  await tick();
  h.click('adjust-tab');
  assert.equal(h.document.getElementById('adjust-delta').value, '3');
  assert.equal(h.document.getElementById('adjust-delta').readOnly, true);
  assert.match(h.document.getElementById('adjust-submit').textContent, /재시도/);
  assert.equal(h.document.getElementById('adjust-error').hidden, false);
});

test('a live stock change updates the open item heading and offers new history before the header close button dismisses it', async () => {
  let quantity = 7;
  let revision = 1;
  const h = await harness({ queryOverride: async () => ({ data: [{ ...item, quantity, revision }], error: null }) });
  h.document.querySelector('[data-action="history"]').click();
  await tick();
  quantity = 9;
  revision = 2;
  h.channels[0].changed({ eventType: 'UPDATE', new: { ...item, quantity, revision, change_sent_at: null } });
  await tick();
  assert.match(h.document.getElementById('adjust-item-name').textContent, /현재 9 개/);
  assert.match(h.document.getElementById('history-status').textContent, /새 입출고 기록/);
  h.document.getElementById('item-detail-close')?.click();
  assert.equal(h.document.getElementById('adjust-dialog').open, false);
});
