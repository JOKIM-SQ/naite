import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm';

const $ = (id) => document.getElementById(id);
const state = {
  supabase: null,
  session: null,
  products: [],
  snapshot: null,
  activeTab: 'color',
  selectedColors: new Set(),
  selectedDevices: new Set(),
  modalScroll: { color: 0, device: 0 },
  filter: { model: null, color: null },
};

const safeImage = (url) => /^https:\/\//.test(url || '') ? url : '';
const uniqueCount = () => new Set([...state.selectedColors, ...state.selectedDevices]).size;
function toast(message, error = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => { node.hidden = true; }, 4200);
}

function setLookupStatus(message, error = false) {
  const node = $('lookup-status');
  node.textContent = message;
  node.classList.toggle('error', error);
}

async function api(path = '/api/catalog', options = {}) {
  if (!state.session?.access_token) throw new Error('로그인이 필요합니다.');
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.session.access_token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const output = await response.json();
  if (!response.ok) throw new Error(output.message || '요청을 처리하지 못했습니다.');
  return output;
}

function showAuth(message = '로그인하면 내 카탈로그만 볼 수 있습니다.') {
  $('auth-shell').hidden = false;
  $('app-shell').hidden = true;
  $('auth-note').textContent = message;
}

function showApp(user) {
  $('auth-shell').hidden = true;
  $('app-shell').hidden = false;
  $('account-email').textContent = user.email || '로그아웃';
  $('account-initial').textContent = (user.email || 'U').slice(0, 1).toUpperCase();
}

async function loadCatalog() {
  const output = await api();
  state.products = output.products || [];
  render();
}

function flattenedVariants() {
  return state.products.flatMap((product) => product.devices.flatMap((device) => device.options.map((option) => ({ product, device, option }))));
}

function matchesFilter(entry) {
  if (state.filter.model && entry.device.modelName !== state.filter.model) return false;
  if (state.filter.color && entry.option.colorName !== state.filter.color) return false;
  return true;
}

function renderSidebar(entries) {
  const tree = $('model-tree');
  tree.replaceChildren();
  const models = new Map();
  entries.forEach((entry) => {
    const colors = models.get(entry.device.modelName) || new Map();
    colors.set(entry.option.colorName, (colors.get(entry.option.colorName) || 0) + 1);
    models.set(entry.device.modelName, colors);
  });
  [...models.entries()].sort(([a], [b]) => b.localeCompare(a, 'en')).forEach(([model, colors]) => {
    const group = document.createElement('section');
    group.className = 'model-group';
    if (state.filter.model === model) group.classList.add('open');
    const row = document.createElement('button');
    row.className = 'model-row';
    row.classList.toggle('active', state.filter.model === model && !state.filter.color);
    const label = document.createElement('span'); label.textContent = model;
    const count = document.createElement('b'); count.textContent = [...colors.values()].reduce((sum, value) => sum + value, 0);
    row.append(label, count);
    row.onclick = () => {
      if (state.filter.model === model && !state.filter.color) state.filter = { model: null, color: null };
      else state.filter = { model, color: null };
      render();
    };
    group.append(row);
    const list = document.createElement('div'); list.className = 'color-list';
    [...colors.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).forEach(([color, countValue]) => {
      const colorRow = document.createElement('button');
      colorRow.className = 'color-row';
      colorRow.classList.toggle('active', state.filter.model === model && state.filter.color === color);
      const name = document.createElement('span'); name.textContent = color;
      const count = document.createElement('b'); count.textContent = countValue;
      colorRow.append(name, count);
      colorRow.onclick = () => { state.filter = { model, color }; render(); };
      list.append(colorRow);
    });
    group.append(list); tree.append(group);
  });
}

function productCard(entry) {
  const card = document.createElement('article'); card.className = 'case-card';
  const media = document.createElement('a'); media.className = 'case-image'; media.href = entry.product.sourceUrl; media.target = '_blank'; media.rel = 'noopener noreferrer';
  if (safeImage(entry.product.imageUrl)) { const image = document.createElement('img'); image.src = entry.product.imageUrl; image.alt = entry.product.title; media.append(image); }
  const badge = document.createElement('span'); badge.className = 'model-badge'; badge.textContent = entry.device.modelName; media.append(badge);
  const body = document.createElement('div'); body.className = 'case-body';
  const title = document.createElement('h3'); title.textContent = entry.product.title;
  const price = document.createElement('p'); price.className = 'price'; price.textContent = entry.product.displayedPrice || '가격 정보 없음';
  const meta = document.createElement('div'); meta.className = 'case-meta';
  const color = document.createElement('span'); color.className = 'color-chip'; color.textContent = entry.option.colorName;
  const asin = document.createElement('span'); asin.className = 'asin'; asin.textContent = entry.option.asin;
  meta.append(color, asin);
  const options = document.createElement('div'); options.className = 'card-options';
  entry.device.options.slice(0, 3).forEach((option) => { const chip = document.createElement('span'); chip.textContent = option.colorName; options.append(chip); });
  if (entry.device.options.length > 3) { const chip = document.createElement('span'); chip.textContent = `+${entry.device.options.length - 3}`; options.append(chip); }
  body.append(title, price, meta, options); card.append(media, body); return card;
}

function render() {
  const entries = flattenedVariants();
  const visible = entries.filter(matchesFilter);
  $('all-count').textContent = entries.length;
  $('mobile-filter-count').textContent = entries.length;
  $('all-filter').classList.toggle('active', !state.filter.model);
  $('catalog-total').textContent = `${entries.length} saved variants`;
  $('collection-label').textContent = state.filter.color ? `${state.filter.model} · ${state.filter.color}` : state.filter.model || 'ALL VARIANTS';
  $('active-filter').hidden = !state.filter.model;
  if (state.filter.model) $('active-filter').firstElementChild.textContent = state.filter.color ? `${state.filter.model} / ${state.filter.color}` : state.filter.model;
  renderSidebar(entries);
  const grid = $('product-grid'); grid.replaceChildren(...visible.map(productCard));
  $('empty-state').hidden = visible.length > 0 || entries.length > 0;
  if (!visible.length && entries.length) { $('empty-state').hidden = false; $('empty-state').querySelector('h2').textContent = '이 조건의 케이스가 없습니다.'; }
}

function candidateList() {
  return state.activeTab === 'color' ? state.snapshot.colorVariants : state.snapshot.deviceVariants;
}

function renderModal() {
  const snapshot = state.snapshot; if (!snapshot) return;
  $('color-candidate-count').textContent = snapshot.colorVariants.length - 1;
  $('device-candidate-count').textContent = snapshot.deviceVariants.length - 1;
  document.querySelectorAll('.variant-tab').forEach((tab) => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active));
  });
  const baseline = $('baseline'); baseline.replaceChildren();
  if (safeImage(snapshot.imageUrl)) { const image = document.createElement('img'); image.src = snapshot.imageUrl; image.alt = ''; baseline.append(image); }
  const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = snapshot.title; const detail = document.createElement('p'); detail.textContent = `${snapshot.currentColor} · ${snapshot.currentDevice} · ${snapshot.asin}`; copy.append(title, detail); baseline.append(copy);
  const selected = state.activeTab === 'color' ? state.selectedColors : state.selectedDevices;
  const panel = $('variant-panel'); const list = document.createElement('div'); list.className = 'variant-list';
  candidateList().filter((variant) => !variant.selected).forEach((variant) => {
    const row = document.createElement('div'); row.className = 'variant-item';
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = `${state.activeTab}-${variant.asin}`; input.checked = selected.has(variant.asin);
    input.onchange = () => { input.checked ? selected.add(variant.asin) : selected.delete(variant.asin); updateSelectionCount(); };
    const label = document.createElement('label'); label.htmlFor = input.id; const name = document.createElement('strong'); name.textContent = variant.label; const asin = document.createElement('span'); asin.textContent = variant.asin; label.append(name, asin); row.append(input, label); list.append(row);
  });
  if (!list.childElementCount) {
    const empty = document.createElement('p'); empty.className = 'variant-empty';
    empty.textContent = '현재 수집 결과에는 추가로 저장할 ASIN이 없습니다.';
    list.append(empty);
  }
  panel.replaceChildren(list);
  updateSelectionCount();
}

function updateSelectionCount() {
  const count = uniqueCount();
  $('selected-count').textContent = count;
  $('selected-count-top').textContent = count;
  $('save-selected').disabled = count === 0;
}

function openModal() { $('import-backdrop').hidden = false; renderModal(); }
function closeModal(id) { $(id === 'import' ? 'import-backdrop' : 'schema-backdrop').hidden = true; }

async function saveSelection(selection) {
  const button = selection ? $('save-selected') : $('save-current'); button.disabled = true;
  try {
    const count = selection ? uniqueCount() : 1;
    toast(`${count}개 ASIN의 색상·iPhone 조합을 검증하고 저장합니다.`);
    await api('/api/catalog', { method: 'POST', body: JSON.stringify({ action: 'save', input: $('amazon-input').value, selection: selection || {} }) });
    closeModal('import'); state.selectedColors.clear(); state.selectedDevices.clear(); state.snapshot = null; $('amazon-input').value = ''; setLookupStatus('카탈로그에 저장했습니다.'); await loadCatalog(); toast('카탈로그를 업데이트했습니다.');
  } catch (error) { toast(error.message, true); } finally { button.disabled = false; }
}

async function lookup(event) {
  event.preventDefault(); const button = $('lookup-button'); button.disabled = true;
  setLookupStatus('제품·색상·기기 정보를 누적 수집하는 중입니다…');
  try {
    const output = await api('/api/catalog', { method: 'POST', body: JSON.stringify({ action: 'lookup', input: $('amazon-input').value }) });
    state.snapshot = output.snapshot; state.selectedColors.clear(); state.selectedDevices.clear(); state.activeTab = 'color';
    state.modalScroll = { color: 0, device: 0 };
    setLookupStatus(`${output.attempts}회 수집으로 파생 ASIN 정보를 완성했습니다.`); openModal();
  } catch (error) { setLookupStatus(error.message, true); } finally { button.disabled = false; }
}

async function bootstrap() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(config.message || 'Supabase 환경 설정을 확인할 수 없습니다.');
    state.supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
    const { data: { session } } = await state.supabase.auth.getSession(); state.session = session;
    const renderSession = async (nextSession) => { state.session = nextSession; if (!nextSession) return showAuth(); const { data: { user } } = await state.supabase.auth.getUser(); showApp(user); await loadCatalog(); };
    state.supabase.auth.onAuthStateChange((_event, nextSession) => { renderSession(nextSession).catch((error) => toast(error.message, true)); });
    await renderSession(session);
  } catch (error) { showAuth(error.message); $('google-login').disabled = true; }
}

$('google-login').onclick = async () => {
  try { const { error } = await state.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); if (error) throw error; } catch (error) { $('auth-note').textContent = error.message; }
};
$('logout-button').onclick = async () => { await state.supabase.auth.signOut(); };
$('lookup-form').onsubmit = lookup;
$('all-filter').onclick = () => { state.filter = { model: null, color: null }; render(); };
$('clear-filter').onclick = () => { state.filter = { model: null, color: null }; render(); };
$('mobile-filter').onclick = () => $('sidebar').classList.add('show');
$('sidebar-close').onclick = () => $('sidebar').classList.remove('show');
$('schema-trigger').onclick = () => { $('schema-backdrop').hidden = false; };
document.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => closeModal(button.dataset.close); });
document.querySelectorAll('.variant-tab').forEach((tab) => { tab.onclick = () => {
  const modal = document.querySelector('.import-modal');
  state.modalScroll[state.activeTab] = modal.scrollTop;
  state.activeTab = tab.dataset.tab;
  renderModal();
  modal.scrollTop = state.modalScroll[state.activeTab];
}; });
$('save-current').onclick = () => saveSelection(null);
$('save-selected').onclick = () => saveSelection({ colorAsins: [...state.selectedColors], deviceAsins: [...state.selectedDevices] });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal('import'); closeModal('schema'); $('sidebar').classList.remove('show'); } });
document.addEventListener('dragover', (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes('text/plain')) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  const dropped = event.dataTransfer?.getData('text/plain')?.trim();
  if (!dropped) return;
  event.preventDefault();
  $('amazon-input').value = dropped;
  $('lookup-form').requestSubmit();
});
bootstrap();
