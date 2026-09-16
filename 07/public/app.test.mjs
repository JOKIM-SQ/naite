import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as receiptView from './receipt-view.mjs';

// Browser boundaries only: app.js and its autosave/validation logic run unchanged.
class TestNode {
  constructor(tag, document) {
    this.tagName = tag;
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
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
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentNode = this; } }
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

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (receipts = [], status = 200, message) => ({ ok: status < 400, status, json: async () => ({ receipts, message }) });
const values = { merchant: '문구점', date: '2026-09-16', total: 12000, currency: 'KRW', items: [] };
const receipt = (id, status = 'ready') => ({ id, fileName: `${id}.jpg`, status, imageUrl: '/fixture.jpg', values: status === 'ready' ? structuredClone(values) : null, original: status === 'ready' ? structuredClone(values) : null, correctionCount: 0, revision: 0 });
const file = name => ({ name, type: 'image/jpeg', size: 10 });

function app(fetch, reducedMotion = false) {
  const nodes = new Map();
  const document = {
    activeElement: null,
    createElement: tag => new TestNode(tag, document),
    createTextNode: text => { const node = new TestNode('#text', document); node.textContent = text; return node; },
    querySelector: selector => nodes.get(selector) || null,
  };
  for (const id of ['file-input', 'choose-files', 'choose-files-label', 'upload-state-label', 'drop-zone', 'receipt-list', 'connection-status', 'connection-message', 'reload-receipts', 'receipt-count', 'empty-state', 'review-note', 'total-corrections', 'receipt-summary', 'receipt-summary-body', 'upload-errors', 'workspace-status']) nodes.set(`#${id}`, document.createElement('div'));
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  nodes.get('#connection-status').append(dot);
  nodes.set('#total-corrections strong', document.createElement('strong'));
  const icon = document.createElement('span');
  icon.textContent = '↗';
  nodes.get('#choose-files').append(nodes.get('#choose-files-label'), icon);
  const window = { addEventListener() {}, matchMedia: () => ({ matches: reducedMotion }) };
  const sandbox = {
    ...receiptView, document, window, fetch, structuredClone, Intl, console,
    setTimeout: () => 1, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    FileReader: class { readAsDataURL() { this.result = 'data:image/jpeg;base64,Zml4dHVyZQ=='; this.onload(); } },
  };
  vm.runInNewContext(`${source}\nglobalThis.testApp = { entries, restore, acceptFiles, updateSummary, paintReceipt, processEntry };`, sandbox);
  return { ...sandbox.testApp, nodes, document, icon };
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

test('요약은 번호·상호·파일명을 보여 주며 저장 갱신 중 입력 포커스와 미완성 값을 보존한다', async () => {
  const view = app(async (url, options) => options.method === 'GET' ? response([receipt('one')]) : ({ ok: true, status: 200, json: async () => ({ receipt: { ...receipt('one'), values: JSON.parse(options.body).values, revision: 1, correctionCount: 1 } }) }));
  await tick();
  const entry = [...view.entries.values()][0];
  let summary = view.nodes.get('#receipt-summary-body');
  assert.match(summary.querySelector('a').textContent, /영수증 01.*문구점.*one.jpg/);
  assert.equal(summary.querySelector('a').href, '#receipt-1');
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
  assert.match(summary.textContent, /새 문구점/);
  assert.equal(entry.correctionCount.textContent, '수정한 필드 1개');
  assert.ok(entry.editor.querySelector('details').contains(entry.correctionCount));
  assert.match(entry.editor.querySelector('details').textContent, /품목.*전체.*1개/);
  assert.equal(view.nodes.get('#total-corrections strong').textContent, '1개');
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
