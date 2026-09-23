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

async function harness({ signedIn = true, hash = '', storage = new Map(), configOk = true, rpcOverride, queryOverride } = {}) {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const { window, document } = parseHTML(html);
  const dialogPrototype = Object.getPrototypeOf(document.createElement('dialog'));
  dialogPrototype.showModal = function () { this.open = true; };
  dialogPrototype.close = function () { this.open = false; };
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
  await startApp({ window, document, fetch: async () => ({ ok: configOk, json: async () => ({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test', provider: 'google' }) }), createClient: (_url, _key, options) => { calls.push(['client', options]); return client; } });
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
  const h = await harness({ rpcOverride(name, args, context) {
    if (name !== 's08_adjust_stock') return null;
    attempts += 1;
    ids.push(args.p_request_id);
    context.setRows([{ ...item, quantity: 8 }]);
    if (attempts === 1) return { data: null, error: { message: 'Failed to fetch' } };
    return { data: { item_id: item.id, quantity: 8, revision: 2, request_id: args.p_request_id }, error: null };
  } });
  h.document.querySelector('[data-action="increase"]').click();
  await tick();
  assert.match(h.document.querySelector('[data-action="adjust"]').textContent, /재시도/);
  h.document.querySelector('[data-action="adjust"]').click();
  h.submit('adjust-form');
  await tick();
  assert.deepEqual(ids, [ids[0], ids[0]]);
  assert.equal(attempts, 2);
  assert.equal(h.document.querySelector('.stock-value')?.textContent, '8');
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
