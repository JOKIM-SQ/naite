import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as receiptView from './receipt-view.mjs';
import { createAuth } from './auth.mjs';
import * as receiptDashboard from './receipt-dashboard.mjs';

// Browser boundaries only: app.js and its autosave/validation logic run unchanged.
class TestNode {
  constructor(tag, document) {
    this.tagName = tag;
    if (tag === 'select') Object.defineProperty(this, 'type', { get: () => 'select-one' });
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.validity = { badInput: false };
    this.scrolls = [];
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
      toggle: (name, enabled = !this.classList.contains(name)) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      },
    };
  }
  set value(value) { this._value = String(value); }
  get value() { return this._value || ''; }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentNode = this; } }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  replaceChildren(...nodes) {
    if (this.children.some(child => child.contains(this.ownerDocument.activeElement))) this.ownerDocument.activeElement = null;
    this.text = '';
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name, extra = {}) { for (const handler of this.listeners[name] || []) handler({ preventDefault() {}, ...extra }); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  click() { this.dispatch('click'); }
  setCustomValidity(value) { this.validationMessage = value; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrolls.push(options); }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector[0] === '.' ? child.classList.contains(selector.slice(1)) : child.tagName === selector) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (receipts = [], status = 200, message) => ({ ok: status < 400, status, json: async () => ({ receipts, message }) });
const values = { merchant: '문구점', date: '2026-09-16', total: 12000, currency: 'KRW', category: '쇼핑' };
const receipt = (id, status = 'ready') => ({ id, fileName: `${id}.jpg`, status, imageUrl: '/fixture.jpg', values: status === 'ready' ? structuredClone(values) : null, original: status === 'ready' ? structuredClone(values) : null, correctionCount: 0, revision: 0 });
const file = name => ({ name, type: 'image/jpeg', size: 10 });
const authSession = (id = 'user-a', token = 'token-a') => ({ user: { id, email: `${id}@example.test` }, access_token: token });

function app(fetchReceipts, reducedMotion = false, { initial = authSession(), readPending, logoutPending } = {}) {
  const nodes = new Map();
  const document = {
    activeElement: null,
    listeners: {},
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
    querySelectorAll: selector => selector === '[data-view]' ? nav : selector === '[data-count]' ? counts : [],
    createElement: tag => new TestNode(tag, document),
    createTextNode: text => { const node = new TestNode('#text', document); node.textContent = text; return node; },
    querySelector: selector => nodes.get(selector) || null,
  };
  const nav = ['dashboard', 'all', '쇼핑', '장보기', '외식', '그 외'].map(view => { const node = document.createElement('button'); node.dataset.view = view; return node; });
  const counts = ['all', '쇼핑', '장보기', '외식', '그 외'].map(count => { const node = document.createElement('span'); node.dataset.count = count; return node; });
  document.body = document.createElement('body');
  for (const id of ['file-input', 'choose-files', 'choose-files-label', 'upload-state-label', 'drop-zone', 'receipt-list', 'connection-status', 'connection-message', 'reload-receipts', 'receipt-count', 'empty-state', 'review-note', 'upload-errors', 'workspace-status', 'sidebar', 'mobile-nav-toggle', 'sidebar-backdrop', 'page-title', 'page-subtitle', 'dashboard-panel', 'kpi-total', 'kpi-count', 'kpi-month', 'kpi-month-label', 'kpi-average', 'kpi-context', 'monthly-chart', 'category-chart', 'category-legend', 'chart-empty', 'month-filter', 'currency-filter', 'currency-filter-wrap', 'receipt-search', 'records-panel', 'receipts-title', 'empty-title', 'empty-copy', 'receipt-dialog', 'receipt-dialog-title', 'receipt-dialog-close', 'receipt-dialog-content', 'delete-dialog', 'delete-dialog-title', 'delete-message', 'delete-error', 'delete-cancel', 'delete-confirm', 'view-all-receipts', 'sign-in', 'sign-out', 'account-name', 'account-panel', 'auth-message', 'auth-panel']) nodes.set(`#${id}`, document.createElement('div'));
  nodes.get('#auth-message').hidden = true;
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  nodes.get('#connection-status').append(dot);
  const icon = document.createElement('span');
  icon.textContent = '↗';
  nodes.get('#choose-files').append(nodes.get('#choose-files-label'), icon);
  const windowListeners = {};
  const window = { addEventListener(name, handler) { windowListeners[name] = handler; }, matchMedia: () => ({ matches: reducedMotion }), location: { href: 'https://example.test/', origin: 'https://example.test' }, history: { state: null, replaceState() {} } };
  const timers = new Map();
  const revoked = [];
  let timerId = 0;
  let authListener;
  const sdk = { auth: {
    initialize: async () => ({ error: null }),
    onAuthStateChange: listener => { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: initial }, error: null }),
    signOut: async () => { if (logoutPending) await logoutPending.promise; authListener('SIGNED_OUT', null); return { error: null }; },
    signInWithOAuth: async () => ({ error: null }),
  } };
  const sandbox = {
    ...receiptView, ...receiptDashboard, createAuth, document, window, structuredClone, Intl, console, AbortController,
    supabase: { createClient: () => sdk },
    fetch: (url, options) => url === '/api/auth-config' ? Promise.resolve({ ok: true, json: async () => ({ url: 'https://project.supabase.co', publishableKey: 'public-key', provider: 'google' }) }) : fetchReceipts(url, options),
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; }, clearTimeout: id => timers.delete(id),
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
    FileReader: class { readAsDataURL() { const complete = () => { this.result = 'data:image/jpeg;base64,Zml4dHVyZQ=='; this.onload(); }; if (readPending) readPending.promise.then(complete); else complete(); } },
  };
  vm.runInNewContext(`'use strict';\n${source}\nglobalThis.testApp = { entries, restore, acceptFiles, updateSummary, paintReceipt, processEntry, closeEditor: typeof closeEditor === 'function' ? closeEditor : undefined, openEditor: typeof openEditor === 'function' ? openEditor : undefined, openDelete: typeof openDelete === 'function' ? openDelete : undefined, confirmDelete: typeof confirmDelete === 'function' ? confirmDelete : undefined, setView: typeof setView === 'function' ? setView : undefined };`, sandbox);
  return { ...sandbox.testApp, nodes, document, icon, timers, revoked, nav, counts, windowListeners, authEvent: (event, session) => authListener?.(event, session) };
}

test('연결 확인→준비→재연결 실패 동안 버튼과 업로드 상태가 함께 전환되고 아이콘은 남는다', async () => {
  const first = deferred();
  let next = first.promise;
  const view = app(() => next);
  assert.equal(view.nodes.get('#drop-zone').dataset.connection, 'loading');
  assert.equal(view.nodes.get('#choose-files').disabled, true);
  assert.match(view.nodes.get('#choose-files-label').textContent, /연결 확인/);
  first.resolve(response());
  await tick();
  assert.equal(view.nodes.get('#drop-zone').dataset.connection, 'ready');
  assert.equal(view.nodes.get('#choose-files').disabled, false);
  assert.match(view.nodes.get('#upload-state-label').textContent, /사진을 올려/);
  assert.match(view.nodes.get('#choose-files-label').textContent, /선택하기/);
  const reconnect = deferred();
  next = reconnect.promise;
  const restoring = view.restore();
  await view.acceptFiles([file('blocked.jpg')]);
  assert.equal(view.entries.size, 0, '재연결 중 파일 드롭을 차단한다');
  reconnect.resolve(response([], 503, 'ANTHROPIC_API_KEY 설정이 필요합니다.'));
  await restoring;
  assert.equal(view.nodes.get('#drop-zone').dataset.connection, 'error');
  assert.equal(view.nodes.get('#choose-files').disabled, true);
  assert.match(view.nodes.get('#choose-files-label').textContent, /연결 대기/);
  assert.equal(view.nodes.get('#reload-receipts').hidden, false);
  assert.doesNotMatch(view.nodes.get('#connection-message').textContent, /API_KEY|설정/);
  assert.match(view.nodes.get('#connection-message').textContent, /다시 연결/);
  await view.acceptFiles([file('also-blocked.jpg')]);
  assert.equal(view.entries.size, 0);
  assert.ok(view.nodes.get('#choose-files').children.includes(view.icon));
});

test('실제 상태별 장수를 안내하고 실패한 영수증 재시도도 즉시 진행 수에 반영한다', async () => {
  const pending = deferred();
  const view = app((url, options) => options.method === 'GET' ? Promise.resolve(response([receipt('ready'), receipt('busy', 'processing'), receipt('failed', 'failed')])) : pending.promise);
  await tick();
  assert.match(view.nodes.get('#workspace-status').textContent, /1장 정리 중.*1장 정리 완료.*1장 확인 필요/);
  const [ready, busy, failed] = [...view.entries.values()];
  assert.equal(ready.card.dataset.state, 'ready');
  assert.equal(busy.card.dataset.state, 'processing');
  assert.equal(failed.card.dataset.state, 'failed');
  const retrying = view.processEntry(failed);
  assert.match(view.nodes.get('#workspace-status').textContent, /2장 정리 중.*1장 정리 완료/);
  assert.doesNotMatch(view.nodes.get('#workspace-status').textContent, /확인 필요/);
  pending.resolve({ ok: true, status: 200, json: async () => ({ receipt: receipt('failed') }) });
  await retrying;
  busy.receipt = receipt('busy');
  view.paintReceipt(busy);
  view.updateSummary();
  assert.match(view.nodes.get('#workspace-status').textContent, /3장 정리 완료.*틀린 곳만 수정/);
});

test('빈 작업 공간은 사진 업로드를 안내한다', async () => {
  const view = app(async () => response());
  await tick();
  assert.match(view.nodes.get('#workspace-status').textContent, /사진.*올리/);
});

test('결제 날짜는 기본 날짜 선택기를 사용하고 저장에는 ISO 날짜를 유지한다', async () => {
  const view = app(async (url, options) => options.method === 'GET' ? response([receipt('date')]) : ({ ok: true, status: 200, json: async () => ({ receipt: { ...receipt('date'), values: JSON.parse(options.body).values, revision: 1 } }) }));
  await tick();
  const entry = [...view.entries.values()][0];
  const date = entry.fields.get('date').input;
  assert.equal(date.type, 'date');
  date.value = '2026-09-18';
  date.dispatch('change');
  await entry.autosave.flush();
  assert.equal(entry.receipt.values.date, '2026-09-18');
});

test('통화는 편집 입력 없이 다른 필드 저장 시 기존 값을 보존한다', async () => {
  const saved = receipt('currency');
  saved.values.currency = 'USD';
  saved.original.currency = 'USD';
  let written;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([saved]);
    written = JSON.parse(options.body).values;
    return { ok: true, status: 200, json: async () => ({ receipt: { ...saved, values: written, revision: 1, correctionCount: 1 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  assert.equal(entry.fields.has('currency'), false);
  assert.equal(entry.card.querySelector('.field-currency'), null);
  const merchant = entry.fields.get('merchant').input;
  merchant.value = '새 문구점';
  merchant.dispatch('change');
  await entry.autosave.flush();
  assert.equal(written.merchant, '새 문구점');
  assert.equal(written.currency, 'USD');
  assert.equal(entry.receipt.values.currency, 'USD');
  assert.equal(entry.receipt.original.currency, 'USD');
});

test('날짜 선택기의 미완성 입력을 빈 날짜로 덮어쓰지 않는다', async () => {
  let writes = 0;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([receipt('partial-date')]);
    writes += 1;
    return { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('partial-date'), values: JSON.parse(options.body).values, revision: 1 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  const date = entry.fields.get('date').input;
  date.value = '';
  date.validity = { badInput: true };
  date.dispatch('input');
  date.dispatch('change');
  await entry.autosave.flush();
  assert.equal(writes, 0);
  assert.equal(entry.receipt.values.date, '2026-09-16');
  assert.equal(entry.invalid.has(date), true);
});

test('카드 수정은 모달에서 열고 저장 중 포커스와 미완성 입력을 보존한다', async () => {
  const view = app(async (url, options) => options.method === 'GET' ? response([receipt('one')]) : ({ ok: true, status: 200, json: async () => ({ receipt: { ...receipt('one'), values: JSON.parse(options.body).values, revision: 1, correctionCount: 1 } }) }));
  await tick();
  const entry = [...view.entries.values()][0];
  assert.equal(entry.card.querySelector('form'), null);
  assert.match(entry.card.textContent, /문구점/);
  entry.editButton.dispatch('click');
  assert.equal(view.nodes.get('#receipt-dialog').open, true);
  const merchant = entry.fields.get('merchant').input;
  const total = entry.fields.get('total').input;
  merchant.value = '새 문구점';
  merchant.dispatch('change');
  total.focus();
  total.value = '12,';
  total.dispatch('input');
  await entry.autosave.flush();
  assert.equal(view.document.activeElement, total);
  assert.equal(total.value, '12,');
  assert.match(entry.card.textContent, /새 문구점/);
  assert.equal(entry.correctionCount.textContent, '수정한 필드 1개');
  assert.ok(entry.editor.querySelector('details').contains(entry.correctionCount));
  assert.doesNotMatch(entry.editor.textContent, /품목/);
  view.nodes.get('#receipt-dialog').dispatch('cancel');
  assert.equal(view.nodes.get('#receipt-dialog').open, true, '미완성 입력은 창을 유지하고 오류를 안내한다');
  assert.equal(total.value, '12,');
  assert.equal(total.getAttribute('aria-invalid'), 'true');
  let prevented = false;
  view.windowListeners.beforeunload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('허용된 파일의 첫 새 카드로 한 번만 이동하고 거절된 파일은 이동을 만들지 않는다', async () => {
  for (const reducedMotion of [false, true]) {
    const view = app(async (url, options) => options.method === 'GET' ? response([receipt('old')]) : { ok: true, status: 200, json: async () => ({ receipt: receipt(JSON.parse(options.body).fileName) }) }, reducedMotion);
    await tick();
    const trigger = view.nodes.get('#choose-files');
    trigger.focus();
    await view.acceptFiles([file('a.jpg'), file('b.jpg')]);
    const [old, first, second] = [...view.entries.values()];
    assert.equal(old.card.scrolls.length, 0);
    assert.equal(first.card.scrolls.length, 1);
    assert.equal(first.card.scrolls[0].behavior, reducedMotion ? 'instant' : 'smooth');
    assert.equal(first.card.scrolls[0].block, 'start');
    assert.equal(second.card.scrolls.length, 0);
    assert.equal(view.document.activeElement, trigger);
    await view.acceptFiles([{ name: 'bad.heic', type: 'image/heic', size: 1 }]);
    assert.equal(view.entries.size, 3);
    assert.equal(first.card.scrolls.length, 1);
  }
});

test('로그인 전에는 영수증 API와 파일 업로드를 잠근다', async () => {
  let requests = 0;
  const view = app(async () => { requests += 1; return response(); }, false, { initial: null });
  await tick();
  await view.acceptFiles([file('locked.jpg')]);
  assert.equal(requests, 0);
  assert.equal(view.entries.size, 0);
  assert.equal(view.nodes.get('#choose-files').disabled, true);
  assert.equal(view.nodes.get('#account-panel').hidden, true);
  assert.match(view.nodes.get('#workspace-status').textContent, /로그인/);
});

test('로그인 API에는 bearer를 보내고 같은 계정 토큰 갱신은 복원 없이 다음 요청에 적용한다', async () => {
  const requests = [];
  const view = app(async (url, options) => { requests.push(options); return response([receipt('mine')]); });
  await tick();
  assert.equal(requests[0].headers.Authorization, 'Bearer token-a');
  const entry = [...view.entries.values()][0];
  view.authEvent('TOKEN_REFRESHED', authSession('user-a', 'fresh-token'));
  await tick();
  assert.equal(requests.length, 1);
  assert.equal([...view.entries.values()][0], entry);
  await view.restore();
  assert.equal(requests[1].headers.Authorization, 'Bearer fresh-token');
});

test('로그아웃 즉시 원본·요약·폴링을 비우고 이전 계정의 늦은 복원을 무시한다', async () => {
  const pending = deferred();
  let requests = 0;
  const view = app(async () => ++requests === 1 ? response([receipt('old', 'processing')]) : pending.promise);
  await tick();
  const entry = [...view.entries.values()][0];
  const restoring = view.restore();
  view.nodes.get('#sign-out').dispatch('click');
  assert.equal(view.entries.size, 0);
  assert.equal(view.nodes.get('#receipt-list').children.length, 0);
  assert.equal(view.nodes.get('#kpi-count').textContent, '0');
  assert.equal(view.nodes.get('#receipt-dialog-content').children.length, 0);
  assert.equal(entry.image.src, '');
  assert.equal(view.timers.size, 0);
  pending.resolve(response([receipt('old')]));
  await restoring;
  assert.equal(view.entries.size, 0);
  assert.equal(view.nodes.get('#choose-files').disabled, true);
});

test('계정 전환 후 이전 조회의 늦은 JSON과 401은 새 계정 화면을 바꾸지 않는다', async () => {
  for (const lateStatus of [200, 401]) {
    const pending = deferred();
    const requests = [];
    const view = app(async (url, options) => {
      requests.push(options);
      return requests.length === 1 ? lateStatus === 200 ? { ok: true, status: 200, json: () => pending.promise } : pending.promise : response([receipt('user-b-only')]);
    });
    await tick();
    view.authEvent('SIGNED_IN', authSession('user-b', 'token-b'));
    await tick();
    assert.equal(requests[0].signal.aborted, true);
    pending.resolve(lateStatus === 200 ? { receipts: [receipt('user-a-secret')] } : response([], lateStatus));
    await tick();
    assert.equal(view.entries.size, 1);
    assert.equal([...view.entries.values()][0].receipt.id, 'user-b-only');
    assert.equal(view.nodes.get('#choose-files').disabled, false);
  }
});

test('계정 전환 중 파일 읽기가 끝나도 이전 파일을 새 계정 토큰으로 업로드하지 않는다', async () => {
  const pending = deferred();
  const requests = [];
  const view = app(async (url, options) => { requests.push(options); return response(); }, false, { readPending: pending });
  await tick();
  const accepting = view.acceptFiles([file('private-a.jpg')]);
  view.authEvent('SIGNED_IN', authSession('user-b', 'token-b'));
  pending.resolve();
  await accepting;
  await tick();
  assert.equal(requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(view.entries.size, 0);
  assert.deepEqual(view.revoked, ['blob:fixture']);
});

test('이전 계정 업로드와 자동저장의 늦은 응답은 새 화면에 원본과 수정값을 붙이지 않는다', async () => {
  for (const method of ['POST', 'PATCH']) {
    const pending = deferred();
    const view = app(async (url, options) => options.method === method ? pending.promise : response(method === 'PATCH' && options.headers?.Authorization !== 'Bearer token-b' ? [receipt('old-edit')] : []));
    await tick();
    let finishing;
    if (method === 'POST') finishing = view.acceptFiles([file('old-upload.jpg')]);
    else {
      const entry = [...view.entries.values()][0];
      entry.fields.get('total').input.value = '999';
      entry.fields.get('total').input.dispatch('change');
      finishing = entry.autosave.flush();
    }
    await tick();
    view.authEvent('SIGNED_IN', authSession('user-b', 'token-b'));
    await tick();
    pending.resolve({ ok: true, status: 200, json: async () => ({ receipt: { ...receipt('old-secret'), values: { ...values, total: 999 }, revision: 1 } }) });
    await finishing;
    assert.equal(view.entries.size, 0);
    assert.equal(view.nodes.get('#receipt-dialog-content').textContent, '');
    assert.equal(view.nodes.get('#kpi-count').textContent, '0');
  }
});

test('저장 충돌의 늦은 재조회 뒤 계정이 바뀌면 새 계정으로 저장을 재시도하지 않는다', async () => {
  const conflictRefresh = deferred();
  const writes = [];
  let gets = 0;
  const view = app(async (url, options) => {
    if (options.method === 'PATCH') { writes.push(options); return response([], 409, '다른 탭 수정'); }
    gets += 1;
    return gets === 2 ? conflictRefresh.promise : response(options.headers?.Authorization === 'Bearer token-b' ? [] : [receipt('old')]);
  });
  await tick();
  const entry = [...view.entries.values()][0];
  entry.fields.get('total').input.value = '500';
  entry.fields.get('total').input.dispatch('change');
  const saving = entry.autosave.flush();
  await tick();
  view.authEvent('SIGNED_IN', authSession('user-b', 'token-b'));
  conflictRefresh.resolve(response([{ ...receipt('old'), revision: 1 }]));
  await saving;
  await tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].headers.Authorization, 'Bearer token-a');
  assert.equal(view.entries.size, 0);
});

test('현재 계정 API 401은 기록을 즉시 비우고 재로그인 UI로 전환한다', async () => {
  let requests = 0;
  const view = app(async () => ++requests === 1 ? response([receipt('expired')]) : response([], 401, 'jwt expired'));
  await tick();
  await view.restore();
  assert.equal(view.entries.size, 0);
  assert.equal(view.nodes.get('#choose-files').disabled, true);
  assert.equal(view.nodes.get('#auth-panel').hidden, false);
  assert.match(view.nodes.get('#auth-message').textContent, /다시 로그인/);
  assert.equal(view.nodes.get('#auth-message').hidden, false);
});

test('인증 상태 확인 메시지만 표시하고 정상 비로그인·로그인 상태에는 메시지를 숨긴다', async () => {
  const view = app(async () => response(), false, { initial: null });
  const message = view.nodes.get('#auth-message');
  assert.match(message.textContent, /로그인 상태.*확인/);
  assert.equal(message.hidden, false);
  await tick();
  assert.equal(message.textContent, '');
  assert.equal(message.hidden, true);
  view.authEvent('SIGNED_IN', authSession());
  await tick();
  assert.equal(message.textContent, '');
  assert.equal(message.hidden, true);
});

test('토큰 갱신 직전 요청의 401은 최신 토큰으로 한 번 재시도하며 계정 기록을 지우지 않는다', async () => {
  const pending = deferred();
  const requests = [];
  const view = app(async (url, options) => { requests.push(options); return requests.length === 2 ? pending.promise : response([receipt('mine')]); });
  await tick();
  const entry = [...view.entries.values()][0];
  const restoring = view.restore();
  view.authEvent('TOKEN_REFRESHED', authSession('user-a', 'fresh-token'));
  pending.resolve(response([], 401));
  await restoring;
  assert.equal(requests.length, 3);
  assert.equal(requests[2].headers.Authorization, 'Bearer fresh-token');
  assert.equal([...view.entries.values()][0], entry);
  assert.equal(view.nodes.get('#choose-files').disabled, false);
});

test('카테고리를 저장하면 카드와 대시보드가 갱신되고 품목은 전송하지 않는다', async () => {
  let written;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([receipt('category')]);
    written = JSON.parse(options.body).values;
    return { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('category'), values: written, revision: 1 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  assert.deepEqual([...entry.fields.keys()], ['merchant', 'date', 'total', 'category']);
  const category = entry.fields.get('category').input;
  assert.equal(category.tagName, 'select');
  category.value = '외식';
  category.dispatch('change');
  await entry.autosave.flush();
  assert.equal(written.category, '외식');
  assert.equal('items' in written, false);
  assert.match(entry.card.textContent, /외식/);
  assert.equal(view.counts.find(node => node.dataset.count === '외식').textContent, '1');
});

test('삭제 취소와 요청 실패는 카드를 유지하고 성공 확인 뒤에만 제거한다', async () => {
  const pending = deferred();
  let deletes = 0;
  let failed = true;
  const view = app(async (url, options) => {
    if (options.method !== 'DELETE') return response([receipt('delete')]);
    deletes += 1;
    assert.deepEqual(JSON.parse(options.body), { id: 'delete', revision: 0 });
    if (failed) return response([], 500, 'storage fail');
    return pending.promise;
  });
  await tick();
  const entry = [...view.entries.values()][0];
  entry.deleteButton.dispatch('click');
  assert.equal(view.nodes.get('#delete-dialog').open, true);
  view.nodes.get('#delete-cancel').dispatch('click');
  assert.equal(deletes, 0);
  assert.equal(view.entries.size, 1);
  entry.deleteButton.dispatch('click');
  await view.confirmDelete();
  assert.equal(view.entries.size, 1);
  assert.match(view.nodes.get('#delete-error').textContent, /다시 시도/);
  failed = false;
  const removing = view.confirmDelete();
  await tick();
  assert.equal(view.entries.size, 1);
  pending.resolve({ ok: true, status: 200, json: async () => ({ deleted: true, id: 'delete' }) });
  await removing;
  assert.equal(view.entries.size, 0);
  assert.equal(view.nodes.get('#delete-dialog').open, false);
  assert.equal(view.nodes.get('#kpi-count').textContent, '0');
});

test('삭제 실패 후 deleting 상태는 원본을 유지하고 삭제만 다시 시도한다', async () => {
  let gets = 0;
  const view = app(async (url, options) => options.method === 'DELETE' ? response([], 500) : response([{ ...receipt('delete'), ...(gets++ ? { status: 'deleting', revision: 1 } : {}) }]));
  await tick();
  const entry = [...view.entries.values()][0];
  view.openDelete(entry);
  await view.confirmDelete();
  assert.equal(entry.receipt.status, 'deleting');
  assert.equal(entry.editButton.disabled, true);
  assert.equal(entry.deleteButton.disabled, false);
  assert.match(entry.card.textContent, /삭제 마무리 필요/);
});

test('processing은 삭제할 수 없으며 계정 전환 뒤 늦은 삭제는 새 기록을 제거하지 않는다', async () => {
  const pending = deferred();
  let deletes = 0;
  const view = app(async (url, options) => {
    if (options.method === 'DELETE') { deletes += 1; return pending.promise; }
    return response(options.headers.Authorization === 'Bearer token-b' ? [receipt('new')] : [receipt('old'), receipt('busy', 'processing')]);
  });
  await tick();
  const [old, busy] = [...view.entries.values()];
  assert.equal(busy.deleteButton.disabled, true);
  view.openDelete(busy);
  assert.equal(view.nodes.get('#delete-dialog').open, undefined);
  view.openDelete(old);
  const removing = view.confirmDelete();
  await tick();
  view.authEvent('SIGNED_IN', authSession('user-b', 'token-b'));
  await tick();
  pending.resolve({ ok: true, status: 200, json: async () => ({ deleted: true, id: 'old' }) });
  await removing;
  assert.equal(deletes, 1);
  assert.equal([...view.entries.values()][0].receipt.id, 'new');
  assert.equal(view.entries.size, 1);
  assert.equal(view.nodes.get('#delete-error').textContent, '');
});

test('카테고리·검색·월 필터와 수정값이 같은 카드 및 KPI 범위에 적용된다', async () => {
  const a = receipt('a');
  const b = { ...receipt('b'), values: { ...values, merchant: '식당', category: '외식', total: 5000, date: '2026-08-12' } };
  const view = app(async () => response([a, b]));
  await tick();
  assert.equal(view.nodes.get('#dashboard-panel').hidden, false);
  assert.equal(view.nodes.get('#kpi-count').textContent, '2');
  view.setView('외식');
  assert.equal(view.nodes.get('#receipt-count').textContent, '1');
  assert.equal([...view.entries.values()][0].card.hidden, true);
  assert.equal(view.nodes.get('#dashboard-panel').hidden, true);
  view.setView('dashboard');
  view.nodes.get('#month-filter').value = '2026-08';
  view.nodes.get('#month-filter').dispatch('change');
  assert.equal(view.nodes.get('#kpi-count').textContent, '1');
  assert.equal(view.nodes.get('#receipt-count').textContent, '1');
  view.nodes.get('#receipt-search').value = '없는 상호';
  view.nodes.get('#receipt-search').dispatch('input');
  assert.equal(view.nodes.get('#kpi-count').textContent, '0');
  assert.equal(view.nodes.get('#empty-state').hidden, false);
});

test('모바일 사이드바는 선택·Escape로 닫히고 확장 접근성 상태를 갱신한다', async () => {
  const view = app(async () => response());
  await tick();
  const toggle = view.nodes.get('#mobile-nav-toggle');
  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(view.nodes.get('#sidebar-backdrop').hidden, false);
  view.nav.find(node => node.dataset.view === '쇼핑').dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(view.nodes.get('#page-title').textContent, '쇼핑');
  toggle.dispatch('click');
  for (const listener of view.document.listeners.keydown || []) listener({ key: 'Escape', preventDefault() {} });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('저장 충돌 후 삭제는 최신 revision을 확인하고 재확인할 때만 수행한다', async () => {
  let gets = 0;
  const revisions = [];
  const view = app(async (url, options) => {
    if (options.method !== 'DELETE') return response([{ ...receipt('conflict'), revision: gets++ ? 3 : 0 }]);
    revisions.push(JSON.parse(options.body).revision);
    return revisions.length === 1 ? response([], 409) : { ok: true, status: 200, json: async () => ({ deleted: true, id: 'conflict' }) };
  });
  await tick();
  view.openDelete([...view.entries.values()][0]);
  await view.confirmDelete();
  assert.equal(view.entries.size, 1);
  assert.deepEqual(revisions, [0]);
  assert.match(view.nodes.get('#delete-error').textContent, /변경/);
  await view.confirmDelete();
  assert.deepEqual(revisions, [0, 3]);
  assert.equal(view.entries.size, 0);
});

test('삭제는 진행 중 자동저장을 마친 최신 revision으로 요청한다', async () => {
  const pending = deferred();
  let deleteRevision;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([receipt('saving')]);
    if (options.method === 'PATCH') { await pending.promise; return { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('saving'), values: JSON.parse(options.body).values, revision: 1 } }) }; }
    deleteRevision = JSON.parse(options.body).revision;
    return { ok: true, status: 200, json: async () => ({ deleted: true, id: 'saving' }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  entry.fields.get('total').input.value = '15000';
  entry.fields.get('total').input.dispatch('change');
  view.openDelete(entry);
  const removing = view.confirmDelete();
  await tick();
  assert.equal(deleteRevision, undefined);
  pending.resolve();
  await removing;
  assert.equal(deleteRevision, 1);
  assert.equal(view.entries.size, 0);
});

test('원본 서명 URL 갱신은 미저장 입력과 카테고리를 지우지 않는다', async () => {
  let gets = 0;
  const view = app(async () => response([{ ...receipt('image'), imageUrl: ++gets === 1 ? '/expired.jpg' : '/fresh.jpg' }]));
  await tick();
  const entry = [...view.entries.values()][0];
  const total = entry.fields.get('total').input;
  total.value = '12,';
  total.dispatch('input');
  entry.image.dispatch('error');
  entry.imageError.querySelector('button').dispatch('click');
  await tick();
  assert.equal(entry.image.src, '/fresh.jpg');
  assert.equal(entry.thumbnail.src, '/fresh.jpg');
  assert.equal(entry.imageError.hidden, true);
  assert.equal(total.value, '12,');
  assert.equal(entry.draft.category, '쇼핑');
});

test('최근 영수증은 새 업로드부터 여섯 장을 보여 주고 전체보기로 확장한다', async () => {
  const receipts = Array.from({ length: 7 }, (_, index) => ({ ...receipt(`old-${index}`), createdAt: `2026-09-${String(16 - index).padStart(2, '0')}T00:00:00Z` }));
  const view = app(async (url, options) => options.method === 'GET' ? response(receipts) : { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('new'), createdAt: '2026-09-17T00:00:00Z' } }) });
  await tick();
  assert.equal([...view.entries.values()].filter(entry => !entry.card.hidden).length, 6);
  assert.equal(view.nodes.get('#view-all-receipts').hidden, false);
  await view.acceptFiles([file('new.jpg')]);
  view.setView('dashboard');
  const newest = [...view.entries.values()].find(entry => entry.receipt.id === 'new');
  assert.equal(newest.card.hidden, false);
  assert.equal(view.nodes.get('#receipt-list').children[0], newest.card);
  view.nodes.get('#view-all-receipts').dispatch('click');
  assert.equal([...view.entries.values()].filter(entry => !entry.card.hidden).length, 8);
});

test('삭제 전에 시작된 늦은 목록 응답은 성공한 삭제를 되돌리지 않는다', async () => {
  const pending = deferred();
  let gets = 0;
  const view = app(async (url, options) => options.method === 'DELETE' ? { ok: true, status: 200, json: async () => ({ deleted: true, id: 'removed' }) } : ++gets === 1 ? response([receipt('removed')]) : pending.promise);
  await tick();
  const restoring = view.restore();
  view.openDelete([...view.entries.values()][0]);
  await view.confirmDelete();
  pending.resolve(response([receipt('removed')]));
  await restoring;
  assert.equal(view.entries.size, 0);
});

test('삭제 응답이 유실됐지만 재조회에서 사라졌다면 삭제 완료로 정리한다', async () => {
  let gets = 0;
  const view = app(async (url, options) => options.method === 'DELETE' ? response([], 502) : response(++gets === 1 ? [receipt('lost-response')] : []));
  await tick();
  view.openDelete([...view.entries.values()][0]);
  await view.confirmDelete();
  assert.equal(view.entries.size, 0);
  assert.equal(view.nodes.get('#delete-dialog').open, false);
});

test('변경을 원래 값으로 되돌린 뒤 삭제해도 지연 저장이 삭제 상태를 되돌리지 않는다', async () => {
  let gets = 0;
  const view = app(async (url, options) => options.method === 'DELETE' ? response([], 502) : response([{ ...receipt('reverted'), status: gets++ ? 'deleting' : 'ready', revision: 1 }]));
  await tick();
  const entry = [...view.entries.values()][0];
  const total = entry.fields.get('total').input;
  total.value = '15000'; total.dispatch('change');
  total.value = '12000'; total.dispatch('change');
  view.openDelete(entry);
  await view.confirmDelete();
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(entry.receipt.status, 'deleting');
  assert.equal(entry.editButton.disabled, true);
});

test('편집 닫기는 포커스 입력을 확정하고 저장 완료까지 모달을 유지한다', async () => {
  const pending = deferred();
  let written;
  let writes = 0;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([receipt('closing')]);
    writes += 1;
    written = JSON.parse(options.body).values;
    await pending.promise;
    return { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('closing'), values: written, revision: 1 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  view.openEditor(entry);
  const total = entry.fields.get('total').input;
  total.focus(); total.value = '50000'; total.dispatch('input');
  const category = entry.fields.get('category').input;
  category.value = '외식'; category.dispatch('change');
  view.nodes.get('#receipt-dialog').dispatch('cancel');
  const closing = view.closeEditor();
  await tick();
  assert.equal(view.nodes.get('#receipt-dialog').open, true);
  assert.equal(view.nodes.get('#receipt-dialog-close').disabled, true);
  assert.equal(written.total, 50000);
  assert.equal(written.category, '외식');
  assert.equal(writes, 1);
  pending.resolve();
  await closing;
  assert.equal(view.nodes.get('#receipt-dialog').open, false);
  assert.equal(view.nodes.get('#receipt-dialog-close').disabled, false);
  assert.equal(entry.autosave.hasPending(), false);
});

test('편집 닫기 저장 실패는 입력과 모달을 유지하고 다시 닫기로 저장을 재시도한다', async () => {
  let offline = true;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([receipt('close-error')]);
    if (offline) return response([], 502, '연결 오류');
    return { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('close-error'), values: JSON.parse(options.body).values, revision: 1 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  view.openEditor(entry);
  const total = entry.fields.get('total').input;
  total.focus(); total.value = '51000'; total.dispatch('input');
  await view.closeEditor();
  assert.equal(view.nodes.get('#receipt-dialog').open, true);
  assert.equal(view.nodes.get('#receipt-dialog-close').disabled, false);
  assert.equal(total.value, '51000');
  assert.match(entry.saveStatus.textContent, /저장.*못|다시 시도/);
  assert.equal(entry.retrySave.hidden, false);
  offline = false;
  await view.closeEditor();
  assert.equal(view.nodes.get('#receipt-dialog').open, false);
  assert.equal(entry.receipt.values.total, 51000);
});

test('로그아웃 강제 닫기는 입력을 새 저장 요청으로 보내지 않는다', async () => {
  let writes = 0;
  const view = app(async (url, options) => { if (options.method === 'PATCH') writes += 1; return response([receipt('logout-draft')]); });
  await tick();
  const entry = [...view.entries.values()][0];
  view.openEditor(entry);
  const total = entry.fields.get('total').input;
  total.focus(); total.value = '7777'; total.dispatch('input');
  view.nodes.get('#sign-out').dispatch('click');
  await tick();
  assert.equal(writes, 0);
  assert.equal(view.nodes.get('#receipt-dialog').open, false);
  assert.equal(view.nodes.get('#receipt-dialog-content').children.length, 0);
});

test('이전 계정의 늦은 닫기 저장 응답은 새 계정 편집창을 닫지 않는다', async () => {
  const pending = deferred();
  let writes = 0;
  const view = app(async (url, options) => {
    if (options.method === 'PATCH') { writes += 1; await pending.promise; return { ok: true, status: 200, json: async () => ({ receipt: receipt('old') }) }; }
    return response([receipt(options.headers.Authorization === 'Bearer token-b' ? 'new' : 'old')]);
  });
  await tick();
  const old = [...view.entries.values()][0];
  view.openEditor(old);
  old.fields.get('total').input.value = '9000'; old.fields.get('total').input.dispatch('change');
  const closing = view.closeEditor();
  await tick();
  view.authEvent('SIGNED_IN', authSession('user-b', 'token-b'));
  await tick();
  const fresh = [...view.entries.values()][0];
  view.openEditor(fresh);
  pending.resolve();
  await closing;
  assert.equal(writes, 1);
  assert.equal(view.nodes.get('#receipt-dialog').open, true);
  assert.equal(view.nodes.get('#receipt-dialog-close').disabled, false);
  assert.equal(view.nodes.get('#receipt-dialog-content').contains(fresh.editor), true);
});

test('삭제 충돌은 최신 상호·금액·카테고리로 다시 확인하고 새 자동저장을 사용한다', async () => {
  let gets = 0;
  let write;
  const remote = { ...receipt('fresh-delete'), values: { ...values, merchant: '최신 식당', total: 65000, category: '외식' }, original: { ...values, merchant: '처음 식당', total: 64000, category: '외식' }, correctionCount: 4, revision: 3 };
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([gets++ ? remote : receipt('fresh-delete')]);
    if (options.method === 'DELETE') return response([], 409);
    write = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ receipt: { ...remote, values: write.values, revision: 4 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  const oldField = entry.fields.get('merchant').input;
  const oldAutosave = entry.autosave;
  view.openDelete(entry);
  await view.confirmDelete();
  assert.equal(entry.draft.merchant, '최신 식당');
  assert.equal(entry.fields.get('total').input.value, '65000');
  assert.equal(entry.fields.get('category').input.value, '외식');
  assert.equal(entry.autosave === oldAutosave, false);
  assert.match(entry.card.textContent, /최신 식당.*65,000/);
  assert.match(view.nodes.get('#delete-message').textContent, /최신 식당.*65,000/);
  assert.match(entry.editor.querySelector('details').textContent, /처음 식당/);
  assert.match(entry.correctionCount.textContent, /4개/);
  oldField.value = '구버전 이벤트'; oldField.dispatch('change');
  assert.equal(entry.draft.merchant, '최신 식당');
  view.nodes.get('#delete-cancel').dispatch('click');
  view.openEditor(entry);
  const merchant = entry.fields.get('merchant').input;
  merchant.value = '새 수정'; merchant.dispatch('change');
  await entry.autosave.flush();
  assert.equal(write.revision, 3);
  assert.equal(write.values.total, 65000);
});

test('비로그인 대시보드는 로그인과 첫 영수증 안내를 표시한다', async () => {
  const view = app(async () => response(), false, { initial: null });
  await tick();
  assert.equal(view.nodes.get('#empty-state').hidden, false);
  assert.match(view.nodes.get('#empty-copy').textContent, /로그인/);
});

test('저장 실패한 편집값은 입력창에 남고 KPI는 서버 확인 금액을 유지한다', async () => {
  const view = app(async (url, options) => options.method === 'GET' ? response([receipt('confirmed')]) : response([], 502));
  await tick();
  const entry = [...view.entries.values()][0];
  entry.fields.get('total').input.value = '50000'; entry.fields.get('total').input.dispatch('change');
  await entry.autosave.flush();
  assert.equal(entry.draft.total, 50000);
  assert.match(entry.card.textContent, /50,000/);
  assert.equal(view.nodes.get('#kpi-total').textContent, '₩12,000');
});

test('연속 편집 중 첫 저장만 성공하면 KPI는 첫 확인 금액까지 반영한다', async () => {
  const pending = deferred();
  let writes = 0;
  const view = app(async (url, options) => {
    if (options.method === 'GET') return response([receipt('partial-save')]);
    if (++writes > 1) return response([], 502);
    await pending.promise;
    return { ok: true, status: 200, json: async () => ({ receipt: { ...receipt('partial-save'), values: JSON.parse(options.body).values, revision: 1 } }) };
  });
  await tick();
  const entry = [...view.entries.values()][0];
  const total = entry.fields.get('total').input;
  total.value = '15000'; total.dispatch('change');
  const saving = entry.autosave.flush();
  await tick();
  total.value = '20000'; total.dispatch('change');
  pending.resolve();
  await saving;
  assert.equal(entry.draft.total, 20000);
  assert.equal(view.nodes.get('#kpi-total').textContent, '₩15,000');
});

test('집계 통화 선택은 대시보드에서만 표시한다', async () => {
  const view = app(async () => response([receipt('krw'), { ...receipt('usd'), values: { ...values, currency: 'USD' } }]));
  await tick();
  assert.equal(view.nodes.get('#currency-filter-wrap').hidden, false);
  view.setView('all');
  assert.equal(view.nodes.get('#currency-filter-wrap').hidden, true);
  assert.equal(view.nodes.get('#receipt-count').textContent, '2');
});
