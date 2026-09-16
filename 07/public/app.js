import { createAutosave, parseField, validateFiles, reconcileDraft } from './receipt-view.mjs';

const $ = selector => document.querySelector(selector);
const entries = new Map();
const fileInput = $('#file-input');
const chooseButton = $('#choose-files');
const dropZone = $('#drop-zone');
const list = $('#receipt-list');
let sessionReady = false;
let sequence = 0;
let pollTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(method = 'GET', payload) {
  let response;
  try {
    response = await fetch('/api/receipts', { method, credentials: 'same-origin', cache: 'no-store', headers: payload ? { 'Content-Type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined });
  } catch { throw new Error('연결이 끊겼어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw Object.assign(new Error(data.message || '처리하지 못했어요. 다시 시도해 주세요.'), { status: response.status });
  return data;
}

function setConnection(message, isError = false) {
  const status = $('#connection-status');
  status.hidden = !message;
  status.classList.toggle('error', isError);
  $('#connection-message').textContent = message;
  $('#reload-receipts').hidden = !isError;
  status.querySelector('.status-dot').classList.toggle('busy', !isError);
}

function updateSummary() {
  const count = entries.size;
  $('#receipt-count').textContent = String(count);
  $('#empty-state').hidden = count > 0 || !sessionReady;
  $('#review-note').hidden = !count;
  $('#total-corrections').hidden = !count;
  const corrections = [...entries.values()].reduce((total, entry) => total + (entry.receipt?.correctionCount || 0), 0);
  $('#total-corrections strong').textContent = `${corrections}회`;
  $('#receipt-summary').hidden = !count;
  const body = $('#receipt-summary-body');
  body.replaceChildren();
  for (const entry of entries.values()) {
    const row = element('tr');
    const file = element('th');
    file.scope = 'row';
    const link = element('a', '', entry.receipt?.fileName || entry.file.name);
    link.href = `#${entry.key}`;
    file.append(link);
    const values = entry.draft || entry.receipt?.values;
    const date = element('td', '', values?.date || '—');
    const total = element('td');
    if (values?.total !== null && values?.total !== undefined) total.append(element('span', 'summary-amount', new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 20 }).format(values.total)), element('span', 'summary-currency', values.currency || '통화 미확인'));
    else total.textContent = '—';
    if (!values) file.append(element('span', 'summary-state', entry.receipt?.status === 'failed' ? '확인 필요' : '정리 중'));
    row.append(file, date, total);
    body.append(row);
  }
}

async function restore() {
  chooseButton.disabled = true;
  dropZone.setAttribute('aria-busy', 'true');
  setConnection('저장한 영수증을 불러오고 있어요.');
  try {
    const { receipts } = await request();
    for (const receipt of receipts) {
      const existing = [...entries.values()].find(entry => entry.receipt?.id === receipt.id);
      if (existing) {
        updateImage(existing, receipt.imageUrl);
        if (existing.receipt.status === 'processing' && receipt.status !== 'processing') { existing.receipt = receipt; paintReceipt(existing); }
      }
      else mountReceipt(receipt);
    }
    sessionReady = true;
    setConnection('');
    chooseButton.disabled = false;
    scheduleProcessingRefresh();
  } catch (error) { setConnection(error.message, true); }
  finally { dropZone.setAttribute('aria-busy', 'false'); updateSummary(); }
}

function scheduleProcessingRefresh() {
  clearTimeout(pollTimer);
  const waiting = [...entries.values()].filter(entry => entry.receipt?.id && entry.receipt.status === 'processing' && !entry.processingRequest);
  if (!waiting.length) return;
  pollTimer = setTimeout(async () => {
    try {
      const { receipts } = await request();
      for (const entry of waiting) {
        const fresh = receipts.find(receipt => receipt.id === entry.receipt.id);
        if (fresh && fresh.status !== 'processing') { entry.receipt = fresh; updateImage(entry, fresh.imageUrl); paintReceipt(entry); }
      }
      updateSummary();
      scheduleProcessingRefresh();
    } catch (error) { setConnection(error.message, true); }
  }, 2500);
}

function updateImage(entry, url) {
  if (!url) return;
  entry.image.src = url;
  entry.image.hidden = false;
  entry.imageLink.hidden = false;
  entry.imageLink.href = url;
  entry.openLink.href = url;
  entry.imageError.hidden = true;
}

function mountReceipt(receipt = null, file = null) {
  sequence += 1;
  const key = `receipt-${sequence}`;
  const entry = { key, number: sequence, receipt, file, card: element('article', 'receipt-card'), invalid: new Set(), editing: new Set(), fields: new Map() };
  entry.card.id = key;
  entry.card.setAttribute('aria-labelledby', `${key}-title`);
  const header = element('header', 'receipt-card-header');
  const name = element('div', 'receipt-name');
  const title = element('h3', '', `영수증 ${String(sequence).padStart(2, '0')}`);
  title.id = `${key}-title`;
  name.append(title, element('p', 'file-name', receipt?.fileName || file.name));
  entry.status = element('span', 'card-status');
  header.append(name, entry.status);
  const content = element('div', 'receipt-content');
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
    refreshImage.disabled = true;
    try {
      const { receipts } = await request();
      const fresh = receipts.find(item => item.id === entry.receipt?.id);
      if (fresh?.imageUrl) updateImage(entry, fresh.imageUrl);
      else throw new Error('원본을 찾지 못했어요. 다시 연결해 주세요.');
    } catch (error) { entry.imageError.querySelector('p').textContent = error.message; }
    finally { refreshImage.disabled = false; }
  });
  entry.imageError.append(refreshImage);
  entry.image.addEventListener('error', () => { entry.imageLink.hidden = true; entry.imageError.hidden = false; });
  frame.append(entry.imageLink, entry.imageError);
  original.append(paneHeading, frame);
  entry.editor = element('div', 'editor-pane');
  content.append(original, entry.editor);
  entry.card.append(header, content);
  entries.set(key, entry);
  list.append(entry.card);
  if (file) { entry.preview = URL.createObjectURL(file); updateImage(entry, entry.preview); }
  else updateImage(entry, receipt.imageUrl);
  paintReceipt(entry);
  updateSummary();
  return entry;
}

function cardStatus(entry, message, kind = 'ready') {
  entry.status.className = `card-status${kind === 'failed' ? ' error' : ''}`;
  const dot = element('span', `status-dot${kind === 'processing' ? ' busy' : ''}`);
  dot.setAttribute('aria-hidden', 'true');
  entry.status.replaceChildren(dot, document.createTextNode(message));
}

function paintReceipt(entry) {
  const status = entry.receipt?.status || 'processing';
  entry.editor.replaceChildren();
  if (status === 'ready') { renderEditor(entry); cardStatus(entry, '정리 완료'); return; }
  if (status === 'failed') {
    cardStatus(entry, '확인 필요', 'failed');
    const panel = element('div', 'failed-pane');
    panel.setAttribute('role', 'status');
    panel.append(element('h4', '', '이 사진을 읽지 못했어요'), element('p', '', entry.receipt.error || '글자가 선명한 사진인지 확인해 주세요. 다른 사진은 계속 정리돼요.'));
    const retry = element('button', 'button button-secondary', '이 사진만 다시 시도');
    retry.type = 'button';
    retry.addEventListener('click', () => processEntry(entry));
    panel.append(retry);
    entry.editor.append(panel);
    return;
  }
  cardStatus(entry, '정리 중', 'processing');
  const panel = element('div', 'processing-pane');
  panel.setAttribute('role', 'status');
  panel.append(element('span', 'processing-line'), element('h4', '', '영수증을 읽고 있어요'), element('p', '', '날짜, 최종 금액, 품목을 찾고 있어요. 정리가 끝나면 자동으로 저장돼요.'));
  entry.editor.append(panel);
}

function field(entry, fieldName, labelText, value, itemIndex = null) {
  const label = element('label', `field field-${fieldName}`);
  const labelNode = element('span', 'field-label', labelText);
  const input = element('input');
  input.type = 'text';
  input.value = value ?? '';
  input.autocomplete = 'off';
  input.name = itemIndex === null ? fieldName : `items-${itemIndex}-${fieldName}`;
  input.id = `${entry.key}-${input.name}`;
  label.htmlFor = input.id;
  if (['total', 'amount', 'quantity'].includes(fieldName)) input.inputMode = 'decimal';
  if (fieldName === 'date') { input.placeholder = 'YYYY-MM-DD'; input.inputMode = 'numeric'; }
  else if (fieldName === 'currency') { input.placeholder = 'KRW'; input.maxLength = 3; }
  else if (fieldName === 'merchant') { input.placeholder = '읽지 못함'; input.maxLength = 200; }
  else if (fieldName === 'name') { input.placeholder = '품목명'; input.maxLength = 300; }
  else input.placeholder = '미확인';
  input.setAttribute('aria-label', `영수증 ${entry.number} ${itemIndex === null ? labelText : `품목 ${itemIndex + 1} ${labelText}`}`);
  const errorNode = element('span', 'field-error');
  errorNode.id = `${input.id}-error`;
  errorNode.hidden = true;
  input.setAttribute('aria-describedby', errorNode.id);
  input.addEventListener('input', () => {
    entry.editing.add(input);
    input.setCustomValidity('');
    if (!entry.invalid.size && !entry.saveStatus.classList.contains('error')) entry.saveStatus.textContent = '입력을 마치면 자동 저장해요';
  });
  input.addEventListener('change', () => {
    try {
      const value = parseField(fieldName, input.value);
      if (itemIndex === null) entry.draft[fieldName] = value;
      else {
        if (!entry.draft.items[itemIndex]) return;
        entry.draft.items[itemIndex][fieldName] = value;
      }
      entry.invalid.delete(input);
      entry.editing.delete(input);
      input.removeAttribute('aria-invalid');
      errorNode.hidden = true;
      input.setCustomValidity('');
      queueSave(entry);
      if (!entry.invalid.size && !entry.autosave.hasPending() && !entry.draft.items.some(item => !item.name.trim())) {
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
  });
  entry.fields.set(input.name, { input, fieldName, itemIndex });
  label.append(labelNode, input, errorNode);
  return label;
}

function renderItems(entry) {
  for (const [name, descriptor] of entry.fields) {
    if (descriptor.itemIndex !== null) { entry.invalid.delete(descriptor.input); entry.editing.delete(descriptor.input); entry.fields.delete(name); }
  }
  entry.itemsContainer.replaceChildren();
  if (!entry.draft.items.length) entry.itemsContainer.append(element('p', 'items-empty', '읽어 낸 품목이 없어요. 필요하면 직접 추가해 주세요.'));
  entry.draft.items.forEach((item, index) => {
    const row = element('div', 'item-row');
    row.append(field(entry, 'name', '품목명', item.name, index), field(entry, 'quantity', '수량', item.quantity, index), field(entry, 'amount', '금액', item.amount, index));
    const remove = element('button', 'remove-item', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `영수증 ${entry.number} 품목 ${index + 1} 삭제`);
    remove.addEventListener('click', () => {
      entry.draft.items.splice(index, 1);
      renderItems(entry);
      queueSave(entry);
      entry.addItem.focus();
    });
    row.append(remove);
    entry.itemsContainer.append(row);
  });
  entry.addItem.disabled = entry.draft.items.length >= 200;
}

function syncFields(entry) {
  for (const { input, fieldName, itemIndex } of entry.fields.values()) {
    if (document.activeElement === input || entry.invalid.has(input) || entry.editing.has(input)) continue;
    const value = itemIndex === null ? entry.draft[fieldName] : entry.draft.items[itemIndex]?.[fieldName];
    input.value = value ?? '';
  }
}

function queueSave(entry) {
  if (entry.draft.items.some(item => !item.name.trim())) {
    entry.saveStatus.textContent = '추가한 품목명을 입력하면 변경사항을 자동 저장해요.';
    entry.saveStatus.classList.remove('error');
    return;
  }
  entry.lastQueued = structuredClone(entry.draft);
  entry.autosave.update(entry.draft);
  if (!entry.invalid.size && !entry.autosave.hasPending()) {
    entry.saveStatus.textContent = '모든 변경사항을 저장했어요.';
    entry.saveStatus.classList.remove('error');
  }
}

function originalDetails(entry) {
  const details = element('details', 'original-details');
  details.append(element('summary', '', '최초 추출값 보기'), element('p', '', '수정하기 전의 값이에요. 정확도는 원본의 날짜·최종 금액과 직접 비교해 주세요.'));
  const original = entry.receipt.original;
  if (!original) { details.append(element('p', '', '최초 추출값이 없어요.')); return details; }
  const definition = element('dl', 'original-values');
  for (const [key, label] of [['merchant', '상호명'], ['date', '날짜'], ['total', '최종 금액'], ['currency', '통화']]) definition.append(element('dt', '', label), element('dd', '', original[key] === null ? '읽지 못함' : String(original[key])));
  details.append(definition);
  if (original.items.length) {
    const items = element('ul', 'original-items');
    for (const item of original.items) items.append(element('li', '', `${item.name || '품목명 없음'} · 수량 ${item.quantity ?? '미확인'} · 금액 ${item.amount ?? '미확인'}`));
    details.append(items);
  } else details.append(element('p', '', '추출된 품목 없음'));
  return details;
}

function renderEditor(entry) {
  entry.draft = structuredClone(entry.receipt.values);
  entry.lastQueued = structuredClone(entry.receipt.values);
  entry.fields.clear();
  const heading = element('div', 'editor-heading');
  heading.append(element('h4', '', '정리한 내용'), element('span', 'review-tag', '원본과 확인해 주세요'));
  const form = element('form', 'receipt-form');
  form.setAttribute('aria-label', `영수증 ${entry.number} 내용 수정`);
  form.addEventListener('submit', event => { event.preventDefault(); document.activeElement?.blur(); entry.autosave.flush(); });
  form.append(field(entry, 'merchant', '상호명', entry.draft.merchant));
  const grid = element('div', 'field-grid');
  grid.append(field(entry, 'date', '결제 날짜', entry.draft.date), field(entry, 'total', '최종 결제금액', entry.draft.total), field(entry, 'currency', '통화', entry.draft.currency));
  form.append(grid);
  const items = element('div', 'items-section');
  const itemsHeading = element('div', 'items-heading');
  entry.addItem = element('button', 'text-button', '+ 품목 추가');
  entry.addItem.type = 'button';
  entry.addItem.setAttribute('aria-label', `영수증 ${entry.number} 품목 추가`);
  entry.addItem.addEventListener('click', () => {
    entry.draft.items.push({ name: '', quantity: null, amount: null });
    renderItems(entry);
    queueSave(entry);
    entry.fields.get(`items-${entry.draft.items.length - 1}-name`).input.focus();
  });
  itemsHeading.append(element('h5', '', '구매 품목'), entry.addItem);
  const tableHead = element('div', 'items-table-head');
  tableHead.setAttribute('aria-hidden', 'true');
  for (const label of ['품목명', '수량', '금액', '']) tableHead.append(element('span', '', label));
  entry.itemsContainer = element('div', 'items-container');
  items.append(itemsHeading, tableHead, entry.itemsContainer);
  form.append(items);
  const saveRow = element('div', 'save-row');
  entry.saveStatus = element('p', 'save-status', '자동 저장됨 · 수정하면 바로 저장돼요.');
  entry.saveStatus.setAttribute('role', 'status');
  entry.saveStatus.setAttribute('aria-live', 'polite');
  entry.retrySave = element('button', 'text-button', '저장 다시 시도');
  entry.retrySave.type = 'button';
  entry.retrySave.hidden = true;
  entry.retrySave.addEventListener('click', () => entry.autosave.flush());
  saveRow.append(entry.saveStatus, entry.retrySave);
  entry.correctionCount = element('p', 'correction-count', `수정 횟수 ${entry.receipt.correctionCount}회 · 서버에 저장된 변경 필드 기준. 품목은 전체 1개 필드예요.`);
  entry.autosave = createAutosave({
    receipt: entry.receipt,
    save: async (values, revision) => (await request('PATCH', { id: entry.receipt.id, values, revision })).receipt,
    refresh: async () => {
      const { receipts } = await request();
      const fresh = receipts.find(item => item.id === entry.receipt.id);
      if (!fresh || fresh.status !== 'ready') throw new Error('최신 영수증을 찾지 못했어요. 입력값은 이 화면에 남아 있어요.');
      return fresh;
    },
    onState: state => {
      entry.receipt = state.receipt;
      const editingItems = [...entry.fields.values()].some(({ input, itemIndex }) => itemIndex !== null && (entry.editing.has(input) || entry.invalid.has(input)));
      const next = reconcileDraft(entry.lastQueued, entry.draft, state.receipt.values, editingItems);
      const itemsChanged = next.items.length !== entry.draft.items.length;
      entry.draft = next;
      entry.lastQueued = structuredClone(state.receipt.values);
      const messages = { pending: '변경사항을 저장할게요…', saving: '변경사항 저장 중…', saved: '모든 변경사항을 저장했어요.', error: `${state.error} 입력값은 화면에 남아 있어요.` };
      entry.saveStatus.textContent = entry.invalid.size ? '입력한 값을 확인해 주세요. 오류가 있는 값은 아직 저장하지 않았어요.' : state.phase === 'error' ? messages.error : entry.editing.size ? '입력을 마치면 자동 저장해요' : entry.draft.items.some(item => !item.name.trim()) ? '추가한 품목명을 입력하면 변경사항을 자동 저장해요.' : messages[state.phase];
      entry.saveStatus.classList.toggle('error', state.phase === 'error' || !!entry.invalid.size);
      entry.retrySave.hidden = state.phase !== 'error';
      entry.correctionCount.textContent = `수정 횟수 ${state.receipt.correctionCount}회 · 서버에 저장된 변경 필드 기준. 품목은 전체 1개 필드예요.`;
      cardStatus(entry, state.phase === 'error' ? '저장 확인 필요' : state.phase === 'saved' ? '정리 완료' : '저장 중', state.phase === 'error' ? 'failed' : state.phase === 'saved' ? 'ready' : 'processing');
      if (itemsChanged) renderItems(entry);
      syncFields(entry);
      updateSummary();
    },
  });
  renderItems(entry);
  entry.editor.append(heading, form, saveRow, entry.correctionCount, originalDetails(entry));
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
  entry.processingRequest = true;
  const persistedId = entry.receipt?.id;
  entry.receipt = entry.receipt ? { ...entry.receipt, status: 'processing', error: null } : null;
  paintReceipt(entry);
  try {
    const payload = persistedId ? { action: 'retry', id: persistedId } : { action: 'upload', fileName: entry.file.name, mediaType: entry.file.type, data: await base64File(entry.file) };
    const { receipt } = await request('POST', payload);
    entry.receipt = receipt;
    updateImage(entry, receipt.imageUrl);
    if (entry.preview && receipt.imageUrl) { URL.revokeObjectURL(entry.preview); entry.preview = null; }
  } catch (error) {
    entry.receipt = { ...entry.receipt, id: persistedId, fileName: entry.file?.name || entry.receipt?.fileName, status: 'failed', error: error.message, correctionCount: 0 };
  }
  paintReceipt(entry);
  updateSummary();
  entry.processingRequest = false;
  scheduleProcessingRefresh();
}

async function acceptFiles(files) {
  if (!sessionReady) return;
  const errors = $('#upload-errors');
  errors.replaceChildren();
  errors.hidden = true;
  try {
    const { accepted, rejected } = validateFiles([...files]);
    for (const { file, message } of rejected) errors.append(element('p', '', `${file.name}: ${message}`));
    errors.hidden = !rejected.length;
    const newEntries = accepted.map(file => mountReceipt(null, file));
    await Promise.allSettled(newEntries.map(processEntry));
  } catch (error) { errors.hidden = false; errors.append(element('p', '', error.message)); }
  finally { fileInput.value = ''; }
}

chooseButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => acceptFiles(fileInput.files));
$('#reload-receipts').addEventListener('click', restore);
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, event => { event.preventDefault(); if (sessionReady) dropZone.classList.add('drag-over'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', event => acceptFiles(event.dataTransfer.files));
window.addEventListener('beforeunload', event => {
  if ([...entries.values()].some(entry => entry.autosave?.hasPending() || entry.invalid.size || entry.editing.size || entry.draft?.items.some(item => !item.name.trim()) || !entry.receipt || entry.receipt.status === 'processing')) { event.preventDefault(); event.returnValue = ''; }
});
restore();
