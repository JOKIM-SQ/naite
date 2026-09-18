import { createAutosave, parseField, validateFiles, reconcileDraft } from './receipt-view.mjs';
import { createAuth } from './auth.mjs';
import { CATEGORIES, categoryOf, formatAmount, buildDashboard } from './receipt-dashboard.mjs';

const $ = selector => document.querySelector(selector);
const entries = new Map();
const removedReceipts = new Set();
const fileInput = $('#file-input');
const chooseButton = $('#choose-files');
const dropZone = $('#drop-zone');
const list = $('#receipt-list');
let sessionReady = false;
let sequence = 0;
let pollTimer;
let account = null;
let accountGeneration = 0;
const requests = new Set();
let selectedView = 'dashboard';
let selectedMonth = 'all';
let selectedCurrency = null;
let editorEntry = null;
let deleteEntry = null;
let deleteBusy = false;
const auth = createAuth({ fetcher: fetch, createClient: globalThis.supabase?.createClient, location: window.location, history: window.history, onState: authChanged });

function current(generation) { return !!account && generation === accountGeneration; }
function activeEntry(entry) { return current(entry.generation) && entries.get(entry.key) === entry; }
function recordConfirmed(entry, receipt) {
  if (!activeEntry(entry) || (entry.confirmedRevision ?? -1) > receipt.revision) return;
  entry.confirmedValues = structuredClone(receipt.values);
  entry.confirmedRevision = receipt.revision;
}

function requireCurrent(generation) {
  if (!current(generation)) throw Object.assign(new Error('로그인 계정이 바뀌어 이전 작업을 멈췄어요.'), { name: 'AbortError' });
}

function clearAccount() {
  clearTimeout(pollTimer);
  for (const controller of requests) controller.abort();
  requests.clear();
  for (const entry of entries.values()) {
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    entry.image.src = '';
    entry.thumbnail.src = '';
    entry.imageLink.removeAttribute('href');
    entry.openLink.removeAttribute('href');
  }
  closeEditor(true);
  closeDelete(true);
  setSidebar(false);
  selectedView = 'dashboard';
  selectedMonth = 'all';
  selectedCurrency = null;
  $('#receipt-search').value = '';
  entries.clear();
  removedReceipts.clear();
  list.replaceChildren();
  fileInput.value = '';
  sequence = 0;
  $('#upload-errors').replaceChildren();
  $('#upload-errors').hidden = true;
  dropZone.classList.remove('drag-over');
}

function authChanged(state) {
  const changed = account?.user.id !== state.session?.user.id;
  account = state.session;
  if (changed) { accountGeneration += 1; clearAccount(); }
  $('#auth-panel').hidden = !!account;
  $('#account-panel').hidden = !account;
  $('#account-name').textContent = account?.user.user_metadata?.full_name || account?.user.email || '';
  $('#auth-message').textContent = state.message || '';
  $('#auth-message').hidden = !$('#auth-message').textContent;
  $('#sign-in').disabled = ['loading', 'redirecting'].includes(state.phase);
  $('#sign-out').disabled = !account;
  if (!account) setConnection(state.phase === 'loading' ? 'loading' : 'locked');
  updateSummary();
  if (account && changed) restore();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(method = 'GET', payload, generation = accountGeneration, retriedToken = false) {
  requireCurrent(generation);
  const token = account.access_token;
  const controller = new AbortController();
  requests.add(controller);
  try {
    let response;
    try {
      response = await fetch('/api/receipts', { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    } catch (error) {
      requireCurrent(generation);
      if (error.name === 'AbortError') throw error;
      throw new Error('연결이 끊겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
    requireCurrent(generation);
    if (response.status === 401) {
      if (!retriedToken && token !== account.access_token) return await request(method, payload, generation, true);
      void auth.invalidate();
      throw Object.assign(new Error('로그인이 만료됐어요. 다시 로그인해 주세요.'), { status: 401 });
    }
    if (response.status === 503) throw Object.assign(new Error('지금은 영수증을 정리할 수 없어요. 잠시 후 다시 연결해 주세요.'), { status: response.status });
    let data;
    try { data = await response.json(); } catch {
      requireCurrent(generation);
      throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    requireCurrent(generation);
    if (!response.ok) throw Object.assign(new Error(data.message || '처리하지 못했어요. 다시 시도해 주세요.'), { status: response.status });
    return data;
  } finally { requests.delete(controller); }
}

function setConnection(state, message = '') {
  const isError = state === 'error';
  const isLoading = state === 'loading';
  const isLocked = state === 'locked';
  sessionReady = state === 'ready' && !!account;
  chooseButton.disabled = !sessionReady;
  $('#choose-files-label').textContent = isLocked ? '로그인 후 사진 선택' : isLoading ? '연결 확인 중…' : isError ? '연결 대기 중' : '사진 선택하기';
  $('#upload-state-label').textContent = isLocked ? '로그인이 필요해요' : isLoading ? '연결을 확인하고 있어요' : isError ? '연결을 확인해 주세요' : '사진을 올려 주세요';
  dropZone.dataset.connection = state;
  dropZone.setAttribute('aria-busy', String(isLoading));
  const status = $('#connection-status');
  status.hidden = !message;
  status.classList.toggle('error', isError);
  $('#connection-message').textContent = message;
  $('#reload-receipts').hidden = !isError || !account;
  status.querySelector('.status-dot').classList.toggle('busy', isLoading);
}

function option(value, label) {
  const node = element('option', '', label);
  node.value = value;
  return node;
}

function updateSummary() {
  const receipts = [...entries.values()].map(entry => ({ ...entry.receipt, id: entry.key, values: entry.confirmedValues, fileName: entry.receipt?.fileName || entry.file?.name, createdAt: entry.receipt?.createdAt || entry.createdAt, status: entry.receipt?.status || 'processing' })).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const ordered = receipts.map(receipt => entries.get(receipt.id).card);
  if (ordered.some((card, index) => list.children[index] !== card)) list.append(...ordered);
  const dashboard = buildDashboard(receipts, { view: selectedView, month: selectedMonth, currency: selectedCurrency, search: $('#receipt-search').value });
  selectedCurrency = dashboard.currency;
  const monthOptions = [option('all', '전체 기간'), ...dashboard.months.map(month => option(month, `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`))];
  $('#month-filter').replaceChildren(...monthOptions);
  if (selectedMonth !== 'all' && !dashboard.months.includes(selectedMonth)) $('#month-filter').append(option(selectedMonth, `${selectedMonth.slice(0, 4)}년 ${Number(selectedMonth.slice(5))}월`));
  $('#month-filter').value = selectedMonth;
  $('#currency-filter').replaceChildren(...dashboard.currencies.map(currency => option(currency.value, currency.label)));
  $('#currency-filter').value = selectedCurrency || '';
  $('#currency-filter-wrap').hidden = selectedView !== 'dashboard' || dashboard.currencies.length < 2;
  for (const badge of document.querySelectorAll('[data-count]')) badge.textContent = String(dashboard.counts[badge.dataset.count] || 0);
  for (const nav of document.querySelectorAll('[data-view]')) {
    const active = nav.dataset.view === selectedView;
    nav.classList.toggle('active', active);
    if (active) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current');
  }
  const isDashboard = selectedView === 'dashboard';
  $('#dashboard-panel').hidden = !isDashboard;
  $('#page-title').textContent = isDashboard ? '대시보드' : selectedView === 'all' ? '전체 영수증' : selectedView;
  $('#page-subtitle').textContent = isDashboard ? '영수증에 담긴 지출을 한눈에 확인하세요.' : selectedView === 'all' ? '저장한 영수증을 확인하고 관리하세요.' : `${selectedView} 영수증을 모아 확인하세요.`;
  $('#receipts-title').textContent = isDashboard ? '최근 영수증' : selectedView === 'all' ? '전체 영수증' : `${selectedView} 영수증`;
  $('#receipt-count').textContent = String(dashboard.filtered.length);
  const visible = new Set((isDashboard ? dashboard.filtered.slice(0, 6) : dashboard.filtered).map(receipt => receipt.id));
  for (const entry of entries.values()) { entry.card.hidden = !visible.has(entry.key); updateCard(entry); }
  $('#view-all-receipts').hidden = !isDashboard || dashboard.filtered.length <= 6;
  $('#empty-state').hidden = dashboard.filtered.length > 0 || (!!account && !sessionReady);
  const filtered = selectedView !== 'dashboard' && selectedView !== 'all' || selectedMonth !== 'all' || !!$('#receipt-search').value.trim();
  $('#empty-title').textContent = !account ? '첫 영수증을 정리해 보세요' : filtered ? '조건에 맞는 영수증이 없어요' : '첫 영수증을 올려 보세요';
  $('#empty-copy').textContent = !account ? 'Google로 로그인하면 영수증 사진을 올리고 내 지출을 확인할 수 있어요.' : filtered ? '검색어나 기간을 바꾸면 다른 영수증을 볼 수 있어요.' : '사진을 올리면 날짜, 금액, 카테고리를 정리해 드려요.';
  $('#review-note').hidden = !entries.size;
  const ready = receipts.filter(receipt => receipt.status === 'ready').length;
  const failed = receipts.filter(receipt => receipt.status === 'failed').length;
  const processing = receipts.filter(receipt => receipt.status === 'processing').length;
  const deleting = receipts.filter(receipt => receipt.status === 'deleting').length;
  const progress = [processing && `${processing}장 정리 중`, ready && `${ready}장 정리 완료`, failed && `${failed}장 확인 필요`, deleting && `${deleting}장 삭제 마무리 필요`].filter(Boolean).join(' · ');
  $('#workspace-status').textContent = !account ? '로그인하면 내 영수증 기록을 확인할 수 있어요.' : !receipts.length ? '사진을 올리면 정리한 내용을 여기서 확인할 수 있어요.' : ready === receipts.length ? `${ready}장 정리 완료 · 틀린 곳만 수정하세요.` : progress;
  const currency = dashboard.currency === 'UNKNOWN' ? null : dashboard.currency;
  $('#kpi-total').textContent = formatAmount(dashboard.kpis.total, currency);
  $('#kpi-count').textContent = String(dashboard.kpis.processedCount);
  $('#kpi-month-label').textContent = selectedMonth === 'all' ? '이번 달 지출' : '선택한 달 지출';
  $('#kpi-month').textContent = formatAmount(selectedMonth === 'all' ? dashboard.kpis.monthTotal : dashboard.kpis.total, currency);
  $('#kpi-average').textContent = formatAmount(dashboard.kpis.average, currency);
  $('#kpi-context').textContent = [dashboard.currencies.length > 1 && '선택한 통화의 금액만 합산해요.', dashboard.kpis.processedCount > 0 && dashboard.currency === 'UNKNOWN' && '통화를 확인하지 못한 기록이에요.', dashboard.unknownAmountCount && `금액 미확인 ${dashboard.unknownAmountCount}장은 합계에서 제외해요.`, dashboard.unknownDateCount && `날짜 미확인 ${dashboard.unknownDateCount}장은 월별 차트에서 제외해요.`, selectedMonth !== 'all' && '월별 차트는 선택한 달까지 최근 6개월을 보여 줘요.'].filter(Boolean).join(' ');
  renderCharts(dashboard, currency);
}

function renderCharts(dashboard, currency) {
  const monthly = $('#monthly-chart');
  monthly.replaceChildren();
  const maximum = Math.max(...dashboard.monthly.map(month => month.total), 1);
  for (const month of dashboard.monthly) {
    const group = element('div', 'month-bar-group');
    group.setAttribute('aria-label', `${month.month}, ${formatAmount(month.total, currency)}, ${month.count}장`);
    const track = element('div', 'month-bar-track');
    const bar = element('div', 'month-bar');
    bar.style.height = `${Math.max(0, month.total / maximum * 100)}%`;
    track.append(bar);
    group.append(element('span', 'month-amount', formatAmount(month.total, currency)), track, element('span', 'month-label', month.label));
    monthly.append(group);
  }
  const chart = $('#category-chart');
  chart.replaceChildren();
  const donut = element('div', 'donut-chart');
  let offset = 0;
  const stops = dashboard.categories.filter(category => category.total > 0).map(category => {
    const start = offset;
    offset += category.share * 100;
    return `${category.color} ${start}% ${offset}%`;
  });
  donut.style.setProperty('--donut-stops', stops.length ? stops.join(', ') : '#e9ece7 0% 100%');
  donut.setAttribute('role', 'img');
  donut.setAttribute('aria-label', dashboard.categories.map(category => `${category.label} ${formatAmount(category.total, currency)}`).join(', '));
  const center = element('div', 'donut-center');
  center.append(element('strong', '', `${dashboard.amountCount}장`), element('span', '', '집계한 영수증'));
  donut.append(center);
  chart.append(donut);
  const legend = $('#category-legend');
  legend.replaceChildren();
  for (const category of dashboard.categories) {
    const item = element('li', 'legend-item');
    const dot = element('span', 'legend-dot');
    dot.style.backgroundColor = category.color;
    dot.setAttribute('aria-hidden', 'true');
    item.append(dot, element('span', 'legend-label', category.label), element('span', 'legend-value', formatAmount(category.total, currency)));
    legend.append(item);
  }
  $('#chart-empty').hidden = dashboard.amountCount > 0;
}

function setSidebar(open) {
  $('#sidebar').classList.toggle('is-open', open);
  document.body.classList.toggle('sidebar-open', open);
  $('#mobile-nav-toggle').setAttribute('aria-expanded', String(open));
  $('#sidebar-backdrop').hidden = !open;
}

function setView(view) {
  if (!['dashboard', 'all', ...CATEGORIES.map(category => category.value)].includes(view)) return;
  selectedView = view;
  setSidebar(false);
  updateSummary();
}

async function restore() {
  if (!account) return;
  const generation = accountGeneration;
  setConnection('loading', '저장한 영수증을 불러오고 있어요.');
  try {
    const { receipts } = await request('GET', undefined, generation);
    if (!current(generation)) return;
    for (const receipt of receipts) {
      if (removedReceipts.has(receipt.id)) continue;
      const existing = [...entries.values()].find(entry => entry.receipt?.id === receipt.id);
      if (existing) {
        recordConfirmed(existing, receipt);
        updateImage(existing, receipt.imageUrl);
        if (existing.receipt.status === 'processing' && receipt.status !== 'processing') { existing.receipt = receipt; paintReceipt(existing); }
      }
      else mountReceipt(receipt);
    }
    setConnection('ready');
    scheduleProcessingRefresh();
  } catch (error) { if (current(generation)) setConnection('error', error.message); }
  finally { if (current(generation)) updateSummary(); }
}

function scheduleProcessingRefresh() {
  clearTimeout(pollTimer);
  if (!account) return;
  const generation = accountGeneration;
  const waiting = [...entries.values()].filter(entry => entry.receipt?.id && entry.receipt.status === 'processing' && !entry.processingRequest);
  if (!waiting.length) return;
  pollTimer = setTimeout(async () => {
    if (!current(generation)) return;
    try {
      const { receipts } = await request('GET', undefined, generation);
      if (!current(generation)) return;
      for (const entry of waiting) {
        const fresh = receipts.find(receipt => receipt.id === entry.receipt.id);
        if (fresh && fresh.status !== 'processing') { entry.receipt = fresh; recordConfirmed(entry, fresh); updateImage(entry, fresh.imageUrl); paintReceipt(entry); }
      }
      updateSummary();
      scheduleProcessingRefresh();
    } catch (error) { if (current(generation)) setConnection('error', error.message); }
  }, 2500);
}

function updateImage(entry, url) {
  if (!url || !activeEntry(entry)) return;
  entry.image.src = url;
  entry.thumbnail.src = url;
  entry.thumbnail.hidden = false;
  entry.image.hidden = false;
  entry.imageLink.hidden = false;
  entry.imageLink.href = url;
  entry.openLink.href = url;
  entry.imageError.hidden = true;
}

function mountReceipt(receipt = null, file = null) {
  sequence += 1;
  const key = `receipt-${sequence}`;
  const entry = { key, generation: accountGeneration, number: sequence, receipt, file, createdAt: file ? new Date().toISOString() : receipt?.createdAt, card: element('article', 'receipt-card'), invalid: new Set(), editing: new Set(), fields: new Map() };
  entry.card.id = key;
  entry.card.setAttribute('aria-labelledby', `${key}-title`);
  const preview = element('button', 'receipt-preview');
  preview.type = 'button';
  preview.setAttribute('aria-label', `${receipt?.fileName || file.name} 영수증 보기`);
  preview.addEventListener('click', () => openEditor(entry));
  entry.previewButton = preview;
  entry.thumbnail = element('img', 'receipt-thumbnail');
  entry.thumbnail.alt = '';
  entry.thumbnail.loading = 'lazy';
  entry.thumbnail.addEventListener('error', () => { if (activeEntry(entry)) { entry.thumbnail.hidden = true; entry.imageError.hidden = false; } });
  preview.append(entry.thumbnail);
  const main = element('div', 'receipt-card-main');
  entry.title = element('h3', 'receipt-merchant');
  entry.title.id = `${key}-title`;
  const meta = element('div', 'receipt-meta');
  entry.category = element('span', 'receipt-category');
  entry.date = element('span', 'receipt-date');
  meta.append(entry.category, entry.date);
  entry.amount = element('p', 'receipt-amount');
  entry.status = element('span', 'card-status');
  entry.error = element('p', 'receipt-error');
  main.append(entry.title, meta, entry.amount, entry.status, entry.error);
  const actions = element('div', 'receipt-card-actions');
  entry.editButton = element('button', 'text-button edit-receipt', '수정');
  entry.editButton.type = 'button';
  entry.editButton.addEventListener('click', () => openEditor(entry));
  entry.deleteButton = element('button', 'text-button delete-receipt', '삭제');
  entry.deleteButton.type = 'button';
  entry.deleteButton.addEventListener('click', () => openDelete(entry));
  entry.retryButton = element('button', 'text-button retry-receipt', '다시 시도');
  entry.retryButton.type = 'button';
  entry.retryButton.addEventListener('click', () => processEntry(entry));
  actions.append(entry.editButton, entry.retryButton, entry.deleteButton);
  entry.card.append(preview, main, actions);
  entry.content = element('div', 'receipt-content');
  const original = element('div', 'original-pane');
  const paneHeading = element('div', 'pane-heading');
  entry.openLink = element('a', 'original-link', '크게 보기 ↗');
  entry.openLink.target = '_blank';
  entry.openLink.rel = 'noopener';
  entry.openLink.setAttribute('aria-label', `영수증 ${sequence} 원본 사진 새 탭에서 크게 보기`);
  paneHeading.append(element('h4', '', '원본 사진'), entry.openLink);
  const frame = element('div', 'image-frame');
  entry.imageLink = element('a');
  entry.imageLink.target = '_blank';
  entry.imageLink.rel = 'noopener';
  entry.image = element('img', 'receipt-image');
  entry.image.alt = `${receipt?.fileName || file.name} 영수증 원본`;
  entry.image.decoding = 'async';
  entry.imageLink.append(entry.image);
  entry.imageError = element('div', 'image-failure');
  entry.imageError.hidden = true;
  entry.imageError.append(element('p', '', '원본 사진을 불러오지 못했어요.'));
  const refreshImage = element('button', 'text-button', '원본 다시 불러오기');
  refreshImage.type = 'button';
  refreshImage.addEventListener('click', async () => {
    if (!activeEntry(entry)) return;
    refreshImage.disabled = true;
    try {
      const { receipts } = await request('GET', undefined, entry.generation);
      if (!activeEntry(entry)) return;
      const fresh = receipts.find(item => item.id === entry.receipt?.id);
      if (fresh?.imageUrl) updateImage(entry, fresh.imageUrl);
      else throw new Error('원본을 찾지 못했어요. 다시 연결해 주세요.');
    } catch (error) { if (activeEntry(entry)) entry.imageError.querySelector('p').textContent = error.message; }
    finally { if (activeEntry(entry)) refreshImage.disabled = false; }
  });
  entry.imageError.append(refreshImage);
  entry.image.addEventListener('error', () => { if (activeEntry(entry)) { entry.imageLink.hidden = true; entry.imageError.hidden = false; } });
  frame.append(entry.imageLink, entry.imageError);
  original.append(paneHeading, frame);
  entry.editor = element('div', 'editor-pane');
  entry.content.append(original, entry.editor);
  entries.set(key, entry);
  if (receipt) recordConfirmed(entry, receipt);
  list.append(entry.card);
  if (file) { entry.preview = URL.createObjectURL(file); updateImage(entry, entry.preview); }
  else updateImage(entry, receipt.imageUrl);
  paintReceipt(entry);
  updateSummary();
  return entry;
}

function updateCard(entry) {
  const values = entry.draft || entry.receipt?.values;
  const status = entry.receipt?.status || 'processing';
  entry.title.textContent = values?.merchant || entry.receipt?.fileName || entry.file?.name || '상호 미확인';
  entry.category.textContent = categoryOf({ values });
  entry.category.hidden = status !== 'ready';
  entry.date.textContent = values?.date || '날짜 미확인';
  entry.date.hidden = status !== 'ready';
  entry.amount.textContent = formatAmount(values?.total ?? null, values?.currency);
  entry.amount.hidden = status !== 'ready';
  entry.editButton.disabled = status !== 'ready' || !!entry.deleting;
  entry.previewButton.disabled = status !== 'ready' || !!entry.deleting;
  entry.deleteButton.disabled = status === 'processing' || !!entry.deleting;
  entry.deleteButton.textContent = status === 'deleting' ? '삭제 다시 시도' : '삭제';
  entry.retryButton.hidden = status !== 'failed';
  entry.retryButton.disabled = !!entry.deleting;
  entry.error.hidden = status !== 'failed';
  entry.error.textContent = entry.receipt?.error || '';
  entry.editButton.setAttribute('aria-label', `${entry.title.textContent} 영수증 수정`);
  entry.deleteButton.setAttribute('aria-label', `${entry.title.textContent} 영수증 삭제`);
}

function openEditor(entry) {
  if (!activeEntry(entry) || entry.receipt?.status !== 'ready' || entry.deleting || editorEntry?.closing) return;
  editorEntry = entry;
  $('#receipt-dialog-close').disabled = false;
  $('#receipt-dialog').setAttribute('aria-busy', 'false');
  $('#receipt-dialog-title').textContent = `${entry.draft?.merchant || '영수증'} 수정`;
  $('#receipt-dialog-content').replaceChildren(entry.content);
  if (!$('#receipt-dialog').open) $('#receipt-dialog').showModal();
  entry.fields.get('merchant')?.input.focus();
}

function finishCloseEditor(entry) {
  if (editorEntry !== entry) return;
  editorEntry = null;
  $('#receipt-dialog-close').disabled = false;
  $('#receipt-dialog').setAttribute('aria-busy', 'false');
  if ($('#receipt-dialog').open) $('#receipt-dialog').close();
  $('#receipt-dialog-content').replaceChildren();
  if (activeEntry(entry) && !entry.card.hidden) entry.editButton.focus();
}

function closeEditor(force = false) {
  const entry = editorEntry;
  if (!entry) return Promise.resolve();
  if (force) { finishCloseEditor(entry); return Promise.resolve(); }
  if (entry.closePromise) return entry.closePromise;
  const focused = document.activeElement;
  const unfinished = [...entry.fields.values()].filter(({ input }) => input === focused || entry.editing.has(input));
  if (entry.content.contains(focused)) focused?.blur();
  for (const { commit } of unfinished) commit();
  if (entry.invalid.size) {
    entry.saveStatus.textContent = '입력한 값을 확인해 주세요. 오류를 수정한 뒤 닫을 수 있어요.';
    entry.saveStatus.classList.add('error');
    [...entry.invalid][0]?.focus();
    return Promise.resolve();
  }
  entry.closing = true;
  $('#receipt-dialog-close').disabled = true;
  $('#receipt-dialog').setAttribute('aria-busy', 'true');
  for (const { input } of entry.fields.values()) input.disabled = true;
  entry.saveStatus.textContent = '변경사항을 저장한 뒤 닫을게요…';
  entry.closePromise = (async () => {
    try {
      await entry.autosave.flush();
      if (!activeEntry(entry) || editorEntry !== entry) return;
      if (entry.autosave.hasPending()) {
        entry.saveStatus.textContent = '변경사항을 저장하지 못했어요. 다시 시도하면 저장한 뒤 닫을게요.';
        entry.saveStatus.classList.add('error');
        entry.retrySave.hidden = false;
        return;
      }
      finishCloseEditor(entry);
    } catch {
      if (activeEntry(entry) && editorEntry === entry) {
        entry.saveStatus.textContent = '변경사항을 저장하지 못했어요. 입력값을 유지했으니 다시 시도해 주세요.';
        entry.saveStatus.classList.add('error');
        entry.retrySave.hidden = false;
      }
    } finally {
      entry.closePromise = null;
      entry.closing = false;
      for (const { input } of entry.fields.values()) input.disabled = false;
      if (activeEntry(entry) && editorEntry === entry) {
        $('#receipt-dialog-close').disabled = false;
        $('#receipt-dialog').setAttribute('aria-busy', 'false');
      }
    }
  })();
  return entry.closePromise;
}

function deleteMessage(entry) {
  const values = entry.draft || entry.receipt?.values;
  const title = values?.merchant || entry.receipt?.fileName || '영수증';
  const details = values ? ` ${formatAmount(values.total, values.currency)} · ${values.date || '날짜 미확인'} · ${categoryOf({ values })}.` : '';
  return `“${title}” 영수증과 원본 사진을 삭제할까요?${details} 삭제하면 되돌릴 수 없어요.`;
}

function openDelete(entry) {
  if (!activeEntry(entry) || entry.receipt?.status === 'processing' || !entry.receipt || entry.deleting) return;
  deleteEntry = entry;
  $('#delete-message').textContent = deleteMessage(entry);
  $('#delete-error').textContent = '';
  $('#delete-error').hidden = true;
  $('#delete-confirm').disabled = false;
  $('#delete-cancel').disabled = false;
  $('#delete-dialog').showModal();
  $('#delete-cancel').focus();
}

function closeDelete(force = false) {
  if (deleteBusy && !force) return;
  const entry = deleteEntry;
  deleteEntry = null;
  deleteBusy = false;
  if ($('#delete-dialog').open) $('#delete-dialog').close();
  $('#delete-error').textContent = '';
  $('#delete-error').hidden = true;
  $('#delete-confirm').disabled = false;
  $('#delete-cancel').disabled = false;
  if (entry && activeEntry(entry) && !entry.card.hidden) entry.deleteButton.focus();
}

function finishDelete(entry) {
  if (!activeEntry(entry)) return;
  if (editorEntry === entry) closeEditor(true);
  if (entry.preview) URL.revokeObjectURL(entry.preview);
  if (entry.receipt?.id) removedReceipts.add(entry.receipt.id);
  entry.card.remove();
  entries.delete(entry.key);
  closeDelete(true);
  updateSummary();
}

async function confirmDelete() {
  const entry = deleteEntry;
  if (!entry || !activeEntry(entry) || deleteBusy || entry.receipt.status === 'processing') return;
  deleteBusy = true;
  entry.deleting = true;
  $('#delete-confirm').disabled = true;
  $('#delete-cancel').disabled = true;
  $('#delete-error').hidden = true;
  updateCard(entry);
  let deleteAttempted = false;
  try {
    if (entry.autosave && entry.receipt.status === 'ready') {
      await entry.autosave.flush();
      if (!activeEntry(entry)) return;
      if (entry.autosave.hasPending()) throw new Error('변경사항을 저장하지 못했어요. 저장을 마친 뒤 다시 시도해 주세요.');
    }
    if (entry.receipt.id) {
      deleteAttempted = true;
      const result = await request('DELETE', { id: entry.receipt.id, revision: entry.receipt.revision }, entry.generation);
      if (!activeEntry(entry)) return;
      if (!result.deleted || result.id !== entry.receipt.id) throw new Error('삭제 결과를 확인하지 못했어요.');
    }
    if (!activeEntry(entry)) return;
    finishDelete(entry);
  } catch (error) {
    if (!activeEntry(entry)) return;
    if (entry.receipt.id) {
      try {
        const { receipts } = await request('GET', undefined, entry.generation);
        if (!activeEntry(entry)) return;
        const fresh = receipts.find(receipt => receipt.id === entry.receipt.id);
        if (!fresh) { finishDelete(entry); return; }
        entry.receipt = fresh;
        recordConfirmed(entry, fresh);
        if (deleteAttempted && fresh.status === 'ready') {
          renderEditor(entry);
          $('#delete-message').textContent = deleteMessage(entry);
          if (editorEntry === entry) $('#receipt-dialog-title').textContent = `${entry.draft.merchant || '영수증'} 수정`;
        }
        updateImage(entry, fresh.imageUrl);
        paintReceipt(entry);
      } catch { /* Keep the card and its draft until deletion is confirmed. */ }
    }
    if (!activeEntry(entry)) return;
    $('#delete-error').textContent = error.status === 409 ? '다른 곳에서 영수증이 변경됐어요. 내용을 확인하고 다시 삭제해 주세요.' : '삭제를 마치지 못했어요. 다시 시도해 주세요.';
    $('#delete-error').hidden = false;
    updateSummary();
  } finally {
    if (activeEntry(entry)) {
      entry.deleting = false;
      updateCard(entry);
      if (deleteEntry === entry) { deleteBusy = false; $('#delete-confirm').disabled = false; $('#delete-cancel').disabled = false; }
    }
  }
}

function cardStatus(entry, message, kind = 'ready') {
  if (!activeEntry(entry)) return;
  entry.status.className = `card-status${kind === 'failed' ? ' error' : ''}`;
  const dot = element('span', `status-dot${kind === 'processing' ? ' busy' : ''}`);
  dot.setAttribute('aria-hidden', 'true');
  entry.status.replaceChildren(dot, document.createTextNode(message));
}

function paintReceipt(entry) {
  if (!activeEntry(entry)) return;
  const status = entry.receipt?.status || 'processing';
  entry.card.dataset.state = status;
  if (status === 'ready') {
    if (!entry.autosave) renderEditor(entry);
    cardStatus(entry, '정리 완료');
  } else if (status === 'failed') cardStatus(entry, '확인 필요', 'failed');
  else if (status === 'deleting') cardStatus(entry, '삭제 마무리 필요', 'failed');
  else cardStatus(entry, '정리 중', 'processing');
  updateCard(entry);
}

function field(entry, fieldName, labelText, value) {
  const editorVersion = entry.editorVersion;
  const editable = () => activeEntry(entry) && entry.editorVersion === editorVersion && !entry.closing && !entry.deleting && entry.receipt?.status === 'ready';
  const label = element('label', `field field-${fieldName}`);
  const labelNode = element('span', 'field-label', labelText);
  const input = element(fieldName === 'category' ? 'select' : 'input');
  if (fieldName === 'category') for (const category of CATEGORIES) input.append(option(category.value, category.label));
  if (fieldName !== 'category') input.type = fieldName === 'date' ? 'date' : 'text';
  input.value = value ?? '';
  input.autocomplete = 'off';
  input.name = fieldName;
  input.id = `${entry.key}-${input.name}`;
  label.htmlFor = input.id;
  if (fieldName === 'total') input.inputMode = 'decimal';
  if (fieldName === 'date') input.placeholder = 'YYYY-MM-DD';
  else if (fieldName === 'merchant') { input.placeholder = '읽지 못함'; input.maxLength = 200; }
  else input.placeholder = '미확인';
  input.setAttribute('aria-label', `영수증 ${entry.number} ${labelText}`);
  const errorNode = element('span', 'field-error');
  errorNode.id = `${input.id}-error`;
  errorNode.hidden = true;
  input.setAttribute('aria-describedby', errorNode.id);
  input.addEventListener('input', () => {
    if (!editable()) return;
    entry.editing.add(input);
    input.setCustomValidity('');
    if (!entry.invalid.size && !entry.saveStatus.classList.contains('error')) entry.saveStatus.textContent = '입력을 마치면 자동 저장해요';
  });
  const commit = () => {
    if (!editable()) return;
    try {
      if (fieldName === 'date' && input.validity.badInput) throw new Error('실제 날짜를 선택하거나 YYYY-MM-DD 형식으로 입력해 주세요.');
      const value = parseField(fieldName, input.value);
      entry.draft[fieldName] = value;
      entry.invalid.delete(input);
      entry.editing.delete(input);
      input.removeAttribute('aria-invalid');
      errorNode.hidden = true;
      input.setCustomValidity('');
      queueSave(entry);
      if (!entry.invalid.size && !entry.autosave.hasPending()) {
        entry.saveStatus.textContent = '모든 변경사항을 저장했어요.';
        entry.saveStatus.classList.remove('error');
      }
    } catch (error) {
      entry.invalid.add(input);
      input.setAttribute('aria-invalid', 'true');
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      input.setCustomValidity(error.message);
      entry.saveStatus.textContent = '입력한 값을 확인해 주세요. 오류가 있는 값은 아직 저장하지 않았어요.';
      entry.saveStatus.classList.add('error');
    }
  };
  input.addEventListener('change', commit);
  entry.fields.set(input.name, { input, fieldName, commit });
  label.append(labelNode, input, errorNode);
  return label;
}


function syncFields(entry) {
  if (!activeEntry(entry)) return;
  for (const { input, fieldName } of entry.fields.values()) {
    if (document.activeElement === input || entry.invalid.has(input) || entry.editing.has(input)) continue;
    const value = entry.draft[fieldName];
    input.value = value ?? '';
  }
}

function queueSave(entry) {
  if (!activeEntry(entry)) return;
  entry.lastQueued = structuredClone(entry.draft);
  entry.autosave.update(entry.draft);
  updateSummary();
  if (!entry.invalid.size && !entry.autosave.hasPending()) {
    entry.saveStatus.textContent = '모든 변경사항을 저장했어요.';
    entry.saveStatus.classList.remove('error');
    cardStatus(entry, '정리 완료');
  }
}

function originalDetails(entry) {
  const details = element('details', 'original-details');
  details.append(element('summary', '', '최초 추출값 보기'), element('p', '', '수정하기 전의 값이에요. 원본과 비교해 주세요.'), entry.correctionCount);
  const original = entry.receipt.original;
  if (!original) { details.append(element('p', '', '최초 추출값이 없어요.')); return details; }
  const definition = element('dl', 'original-values');
  for (const [key, label] of [['merchant', '상호명'], ['date', '날짜'], ['total', '최종 금액'], ['category', '카테고리']]) definition.append(element('dt', '', label), element('dd', '', original[key] === null || original[key] === undefined ? '읽지 못함' : String(original[key])));
  details.append(definition);
  return details;
}

function renderEditor(entry) {
  if (!activeEntry(entry)) return;
  recordConfirmed(entry, entry.receipt);
  const editorVersion = (entry.editorVersion || 0) + 1;
  entry.editorVersion = editorVersion;
  entry.editor.replaceChildren();
  entry.invalid.clear();
  entry.editing.clear();
  entry.draft = structuredClone(entry.receipt.values);
  entry.lastQueued = structuredClone(entry.receipt.values);
  entry.fields.clear();
  const heading = element('div', 'editor-heading');
  heading.append(element('h4', '', '정리한 내용'), element('span', 'review-tag', '원본과 확인해 주세요'));
  const form = element('form', 'receipt-form');
  form.setAttribute('aria-label', `영수증 ${entry.number} 내용 수정`);
  form.addEventListener('submit', event => { event.preventDefault(); if (activeEntry(entry)) { document.activeElement?.blur(); entry.autosave.flush(); } });
  form.append(field(entry, 'merchant', '상호명', entry.draft.merchant));
  const grid = element('div', 'field-grid');
  grid.append(field(entry, 'date', '결제 날짜', entry.draft.date), field(entry, 'total', '최종 결제금액', entry.draft.total));
  form.append(grid);
  form.append(field(entry, 'category', '카테고리', entry.draft.category));
  const saveRow = element('div', 'save-row');
  entry.saveStatus = element('p', 'save-status', '자동 저장됨 · 수정하면 바로 저장돼요.');
  entry.saveStatus.setAttribute('role', 'status');
  entry.saveStatus.setAttribute('aria-live', 'polite');
  entry.retrySave = element('button', 'text-button', '저장 다시 시도');
  entry.retrySave.type = 'button';
  entry.retrySave.hidden = true;
  entry.retrySave.addEventListener('click', () => { if (activeEntry(entry)) entry.autosave.flush(); });
  saveRow.append(entry.saveStatus, entry.retrySave);
  entry.correctionCount = element('p', 'correction-count', `수정한 필드 ${entry.receipt.correctionCount}개`);
  entry.autosave = createAutosave({
    receipt: entry.receipt,
    save: async (values, revision) => {
      if (!activeEntry(entry) || entry.editorVersion !== editorVersion) throw Object.assign(new Error('이전 편집 작업을 멈췄어요.'), { name: 'AbortError' });
      const { receipt } = await request('PATCH', { id: entry.receipt.id, values, revision }, entry.generation);
      requireCurrent(entry.generation);
      if (entry.editorVersion !== editorVersion) throw Object.assign(new Error('이전 편집 작업을 멈췄어요.'), { name: 'AbortError' });
      recordConfirmed(entry, receipt);
      updateSummary();
      return receipt;
    },
    refresh: async () => {
      const { receipts } = await request('GET', undefined, entry.generation);
      requireCurrent(entry.generation);
      const fresh = receipts.find(item => item.id === entry.receipt.id);
      if (!fresh || fresh.status !== 'ready') throw new Error('최신 영수증을 찾지 못했어요. 입력값은 이 화면에 남아 있어요.');
      if (entry.editorVersion !== editorVersion) throw Object.assign(new Error('이전 편집 작업을 멈췄어요.'), { name: 'AbortError' });
      recordConfirmed(entry, fresh);
      return fresh;
    },
    onState: state => {
      if (!activeEntry(entry) || entry.editorVersion !== editorVersion) return;
      entry.receipt = state.receipt;
      entry.draft = reconcileDraft(entry.lastQueued, entry.draft, state.receipt.values);
      entry.lastQueued = structuredClone(state.receipt.values);
      const messages = { pending: '변경사항을 저장할게요…', saving: '변경사항 저장 중…', saved: '모든 변경사항을 저장했어요.', error: `${state.error} 입력값은 화면에 남아 있어요.` };
      entry.saveStatus.textContent = entry.invalid.size ? '입력한 값을 확인해 주세요. 오류가 있는 값은 아직 저장하지 않았어요.' : state.phase === 'error' ? messages.error : entry.editing.size ? '입력을 마치면 자동 저장해요' : messages[state.phase];
      entry.saveStatus.classList.toggle('error', state.phase === 'error' || !!entry.invalid.size);
      entry.retrySave.hidden = state.phase !== 'error';
      entry.correctionCount.textContent = `수정한 필드 ${state.receipt.correctionCount}개`;
      cardStatus(entry, state.phase === 'error' ? '저장 확인 필요' : state.phase === 'saved' ? '정리 완료' : '저장 중', state.phase === 'error' ? 'failed' : state.phase === 'saved' ? 'ready' : 'processing');
      syncFields(entry);
      updateSummary();
    },
  });
  entry.editor.append(heading, form, saveRow, originalDetails(entry));
}

function base64File(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('사진 파일을 읽지 못했어요. 다시 선택해 주세요.'));
    reader.readAsDataURL(file);
  });
}

async function processEntry(entry) {
  if (!activeEntry(entry) || entry.deleting || entry.receipt?.status === 'deleting') return;
  entry.processingRequest = true;
  const persistedId = entry.receipt?.id;
  entry.receipt = entry.receipt ? { ...entry.receipt, status: 'processing', error: null } : null;
  paintReceipt(entry);
  updateSummary();
  try {
    const payload = persistedId ? { action: 'retry', id: persistedId } : { action: 'upload', fileName: entry.file.name, mediaType: entry.file.type, data: await base64File(entry.file) };
    if (!activeEntry(entry)) return;
    const { receipt } = await request('POST', payload, entry.generation);
    if (!activeEntry(entry)) return;
    entry.receipt = receipt;
    recordConfirmed(entry, receipt);
    updateImage(entry, receipt.imageUrl);
    if (entry.preview && receipt.imageUrl) { URL.revokeObjectURL(entry.preview); entry.preview = null; }
  } catch (error) {
    if (!activeEntry(entry)) return;
    entry.receipt = { ...entry.receipt, id: persistedId, fileName: entry.file?.name || entry.receipt?.fileName, status: 'failed', error: error.message, correctionCount: 0 };
  }
  paintReceipt(entry);
  updateSummary();
  entry.processingRequest = false;
  scheduleProcessingRefresh();
}

async function acceptFiles(files) {
  if (!sessionReady) return;
  const generation = accountGeneration;
  const errors = $('#upload-errors');
  errors.replaceChildren();
  errors.hidden = true;
  try {
    const { accepted, rejected } = validateFiles([...files]);
    for (const { file, message } of rejected) errors.append(element('p', '', `${file.name}: ${message}`));
    errors.hidden = !rejected.length;
    if (accepted.length) { selectedView = 'all'; selectedMonth = 'all'; $('#receipt-search').value = ''; }
    const newEntries = accepted.map(file => mountReceipt(null, file));
    newEntries[0]?.card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    await Promise.allSettled(newEntries.map(processEntry));
  } catch (error) { if (current(generation)) { errors.hidden = false; errors.append(element('p', '', error.message)); } }
  finally { if (current(generation)) fileInput.value = ''; }
}

chooseButton.addEventListener('click', () => fileInput.click());
$('#sign-in').addEventListener('click', () => auth.signIn());
$('#sign-out').addEventListener('click', () => auth.signOut());
fileInput.addEventListener('change', () => acceptFiles(fileInput.files));
$('#reload-receipts').addEventListener('click', restore);
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, event => { event.preventDefault(); if (sessionReady) dropZone.classList.add('drag-over'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', event => acceptFiles(event.dataTransfer.files));
window.addEventListener('beforeunload', event => {
  if ([...entries.values()].some(entry => entry.autosave?.hasPending() || entry.invalid.size || entry.editing.size || !entry.receipt || entry.receipt.status === 'processing')) { event.preventDefault(); event.returnValue = ''; }
});
for (const nav of document.querySelectorAll('[data-view]')) nav.addEventListener('click', () => setView(nav.dataset.view));
$('#mobile-nav-toggle').addEventListener('click', () => setSidebar($('#mobile-nav-toggle').getAttribute('aria-expanded') !== 'true'));
$('#sidebar-backdrop').addEventListener('click', () => setSidebar(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#mobile-nav-toggle').getAttribute('aria-expanded') === 'true') { setSidebar(false); $('#mobile-nav-toggle').focus(); }
});
$('#month-filter').addEventListener('change', () => { selectedMonth = $('#month-filter').value; updateSummary(); });
$('#currency-filter').addEventListener('change', () => { selectedCurrency = $('#currency-filter').value; updateSummary(); });
$('#receipt-search').addEventListener('input', updateSummary);
$('#view-all-receipts').addEventListener('click', () => setView('all'));
$('#receipt-dialog-close').addEventListener('click', () => closeEditor());
$('#receipt-dialog').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#receipt-dialog').addEventListener('close', () => {
  if (editorEntry && !$('#receipt-dialog').open) { $('#receipt-dialog').showModal(); void closeEditor(); }
});
$('#delete-cancel').addEventListener('click', () => closeDelete());
$('#delete-confirm').addEventListener('click', confirmDelete);
$('#delete-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDelete(); });
auth.start();
