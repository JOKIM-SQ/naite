import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm';
import { DEVICE_CATEGORIES, deviceCategory } from './device-category.mjs';
import { DASHBOARD_COLORS, catalogDistribution, catalogMetrics } from './catalog-dashboard.mjs';
import { isDashboardView } from './catalog-view.mjs';
import { isCatalogMemberEmail } from './access-policy.mjs';
import { allSelectableVariantsSelected, derivedVariantAsins, selectableVariantAsins, toggleAllSelectableVariants } from './variant-selection.mjs';

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
  filter: { category: null, model: null, color: null },
  accessDenied: false,
  processingTimer: null,
};

const safeImage = (url) => /^https:\/\//.test(url || '') ? url : '';
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

function showAuth(message = state.accessDenied ? 'Spigen 이메일 또는 허용된 계정으로만 접속할 수 있습니다.' : 'Spigen 이메일 또는 허용된 계정으로 로그인하면 내 카탈로그를 볼 수 있습니다.') {
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
  if (state.filter.category && deviceCategory(entry.device.modelName) !== state.filter.category) return false;
  if (state.filter.model && entry.device.modelName !== state.filter.model) return false;
  if (state.filter.color && entry.option.colorName !== state.filter.color) return false;
  return true;
}

function renderSidebar(entries) {
  const tree = $('model-tree');
  tree.replaceChildren();
  const categories = new Map(DEVICE_CATEGORIES.map((category) => [category, new Map()]));
  entries.forEach((entry) => {
    const category = deviceCategory(entry.device.modelName);
    const models = categories.get(category);
    const colors = models.get(entry.device.modelName) || new Map();
    colors.set(entry.option.colorName, (colors.get(entry.option.colorName) || 0) + 1);
    models.set(entry.device.modelName, colors);
  });
  DEVICE_CATEGORIES.forEach((category) => {
    const models = categories.get(category);
    const group = document.createElement('section');
    group.className = 'category-group';
    if (state.filter.category === category) group.classList.add('open');
    const row = document.createElement('button');
    row.className = 'category-row';
    row.classList.toggle('active', state.filter.category === category && !state.filter.model);
    const label = document.createElement('span'); label.textContent = category;
    const count = document.createElement('b'); count.textContent = [...models.values()].flatMap((colors) => [...colors.values()]).reduce((sum, value) => sum + value, 0);
    row.append(label, count);
    row.onclick = () => {
      state.filter = state.filter.category === category && !state.filter.model ? { category: null, model: null, color: null } : { category, model: null, color: null };
      render();
    };
    group.append(row);
    const list = document.createElement('div'); list.className = 'category-model-list';
    [...models.entries()].sort(([a], [b]) => b.localeCompare(a, 'en')).forEach(([model, colors]) => {
      const modelGroup = document.createElement('section'); modelGroup.className = 'model-group';
      if (state.filter.model === model) modelGroup.classList.add('open');
      const modelRow = document.createElement('button'); modelRow.className = 'model-row';
      modelRow.classList.toggle('active', state.filter.model === model && !state.filter.color);
      const modelLabel = document.createElement('span'); modelLabel.textContent = model;
      const modelCount = document.createElement('b'); modelCount.textContent = [...colors.values()].reduce((sum, value) => sum + value, 0);
      modelRow.append(modelLabel, modelCount);
      modelRow.onclick = () => { state.filter = { category, model, color: null }; render(); };
      modelGroup.append(modelRow);
      const colorList = document.createElement('div'); colorList.className = 'color-list';
      [...colors.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).forEach(([color, countValue]) => {
        const colorRow = document.createElement('button'); colorRow.className = 'color-row';
        colorRow.classList.toggle('active', state.filter.model === model && state.filter.color === color);
        const name = document.createElement('span'); name.textContent = color;
        const colorCount = document.createElement('b'); colorCount.textContent = countValue;
        colorRow.append(name, colorCount);
        colorRow.onclick = () => { state.filter = { category, model, color }; render(); };
        colorList.append(colorRow);
      });
      modelGroup.append(colorList); list.append(modelGroup);
    });
    group.append(list); tree.append(group);
  });
}

function setText(id, value) { $(id).textContent = value; }

function renderDistribution({ chartId, centerId, legendId, items, label }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chart = $(chartId);
  const center = $(centerId);
  const legend = $(legendId);
  legend.replaceChildren();
  chart.classList.toggle('empty', total === 0);
  if (!total) {
    chart.style.background = '#e5e6df';
    center.replaceChildren(Object.assign(document.createElement('strong'), { textContent: '0' }), Object.assign(document.createElement('span'), { textContent: 'ASIN' }));
    chart.setAttribute('aria-label', `${label}: 저장된 ASIN 없음`);
    return;
  }
  let angle = 0;
  const segments = items.map((item, index) => {
    const start = angle;
    angle += (item.value / total) * 360;
    return `${DASHBOARD_COLORS[index % DASHBOARD_COLORS.length]} ${start}deg ${angle}deg`;
  });
  chart.style.background = `conic-gradient(${segments.join(', ')})`;
  center.replaceChildren(Object.assign(document.createElement('strong'), { textContent: total }), Object.assign(document.createElement('span'), { textContent: 'ASIN' }));
  chart.setAttribute('aria-label', `${label}: ${items.map((item) => `${item.label} ${item.value}개`).join(', ')}`);
  items.forEach((item, index) => {
    const row = document.createElement('li');
    const marker = document.createElement('span'); marker.className = 'legend-marker'; marker.style.backgroundColor = DASHBOARD_COLORS[index % DASHBOARD_COLORS.length];
    const name = document.createElement('span'); name.className = 'legend-label'; name.textContent = item.label;
    const value = document.createElement('b'); value.textContent = `${item.value} · ${Math.round((item.value / total) * 100)}%`;
    row.append(marker, name, value); legend.append(row);
  });
}

function renderDashboard(entries) {
  const metrics = catalogMetrics(entries);
  setText('kpi-asins', metrics.asins);
  setText('kpi-products', metrics.products);
  setText('kpi-devices', metrics.devices);
  setText('kpi-colors', metrics.colors);
  setText('dashboard-context', state.filter.category ? '선택한 필터 기준으로 다시 계산한 관계 요약입니다.' : '저장된 색상·호환 기기 관계를 한눈에 요약합니다.');
  renderDistribution({
    chartId: 'device-chart', centerId: 'device-center', legendId: 'device-legend', label: '호환 기기 분포',
    items: catalogDistribution(entries, (entry) => entry.device.modelName),
  });
  renderDistribution({
    chartId: 'color-chart', centerId: 'color-center', legendId: 'color-legend', label: '색상 분포',
    items: catalogDistribution(entries, (entry) => entry.option.colorName),
  });
}

function productCard(entry) {
  const card = document.createElement('article'); card.className = 'case-card';
  const media = document.createElement('a'); media.className = 'case-image'; media.href = entry.product.sourceUrl; media.target = '_blank'; media.rel = 'noopener noreferrer';
  const imageUrl = safeImage(entry.option.imageUrl) || safeImage(entry.product.imageUrl);
  const displayTitle = entry.option.title || entry.product.title;
  if (imageUrl) { const image = document.createElement('img'); image.src = imageUrl; image.alt = displayTitle; media.append(image); }
  const badge = document.createElement('span'); badge.className = 'model-badge'; badge.textContent = entry.device.modelName; media.append(badge);
  const body = document.createElement('div'); body.className = 'case-body';
  const eyebrow = document.createElement('p'); eyebrow.className = 'card-eyebrow'; eyebrow.textContent = `SPIGEN · ${entry.option.colorName}`;
  const title = document.createElement('h3'); title.textContent = displayTitle;
  const meta = document.createElement('div'); meta.className = 'case-meta';
  const color = document.createElement('span'); color.className = 'color-chip'; color.textContent = entry.option.colorName;
  const asin = document.createElement('span'); asin.className = 'asin'; asin.textContent = entry.option.asin;
  meta.append(color, asin);
  body.append(eyebrow, title, meta); card.append(body, media); return card;
}

function render() {
  const entries = flattenedVariants();
  const visible = entries.filter(matchesFilter);
  const showDashboard = isDashboardView(state.filter);
  $('all-count').textContent = entries.length;
  $('mobile-filter-count').textContent = entries.length;
  $('all-filter').classList.toggle('active', !state.filter.category);
  $('catalog-total').textContent = `${catalogMetrics(entries).asins} catalog ASINs`;
  $('collection-label').textContent = showDashboard ? 'CATALOG OVERVIEW' : (state.filter.color ? `${state.filter.model} · ${state.filter.color}` : state.filter.model || state.filter.category);
  $('active-filter').hidden = !state.filter.category;
  if (state.filter.category) $('active-filter').firstElementChild.textContent = [state.filter.category, state.filter.model, state.filter.color].filter(Boolean).join(' / ');
  renderSidebar(entries);
  $('catalog-dashboard').hidden = !showDashboard;
  $('product-grid').hidden = showDashboard;
  if (showDashboard) renderDashboard(entries);
  else $('product-grid').replaceChildren(...visible.map(productCard));
  $('empty-state').hidden = visible.length > 0 || entries.length > 0;
  if (!visible.length && entries.length) { $('empty-state').hidden = false; $('empty-state').querySelector('h2').textContent = '이 조건의 케이스가 없습니다.'; }
}

function candidateList() {
  return state.activeTab === 'color' ? state.snapshot.colorVariants : state.snapshot.deviceVariants;
}

function expandedDeviceAsins(variant) {
  const colors = variant?.colorPreview?.status === 'complete' ? variant.colorPreview.colors : [];
  return colors.length ? colors.map((color) => color.asin) : [variant.asin];
}

function selectedSaveAsins() {
  const asins = new Set(state.selectedColors);
  state.selectedDevices.forEach((asin) => {
    const variant = state.snapshot?.deviceVariants.find((candidate) => candidate.asin === asin);
    expandedDeviceAsins(variant || { asin }).forEach((value) => asins.add(value));
  });
  return asins;
}

function derivedSaveAsinCount(snapshot) {
  const asins = new Set(selectableVariantAsins(snapshot.colorVariants));
  snapshot.deviceVariants.filter((variant) => !variant.selected).forEach((variant) => {
    expandedDeviceAsins(variant).forEach((asin) => asins.add(asin));
  });
  return asins.size;
}

function renderModal() {
  const snapshot = state.snapshot; if (!snapshot) return;
  $('color-candidate-count').textContent = snapshot.colorVariants.length - 1;
  $('device-candidate-count').textContent = snapshot.deviceVariants.filter((variant) => !variant.selected).reduce((total, variant) => total + expandedDeviceAsins(variant).length, 0);
  document.querySelectorAll('.variant-tab').forEach((tab) => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active));
  });
  const baseline = $('baseline'); baseline.replaceChildren();
  if (safeImage(snapshot.imageUrl)) { const image = document.createElement('img'); image.src = snapshot.imageUrl; image.alt = ''; baseline.append(image); }
  const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = snapshot.title; const detail = document.createElement('p'); detail.textContent = `${snapshot.currentColor} · ${snapshot.currentDevice} · ${snapshot.asin}`; copy.append(title, detail); baseline.append(copy);
  const selected = state.activeTab === 'color' ? state.selectedColors : state.selectedDevices;
  const candidates = candidateList();
  const selectable = selectableVariantAsins(candidates);
  const allSelected = allSelectableVariantsSelected(selected, candidates);
  $('select-all-current').disabled = selectable.length === 0;
  $('select-all-current').textContent = allSelected ? '이 탭 전체 해제' : '이 탭 전체 선택';
  $('select-all-current').setAttribute('aria-label', `${state.activeTab === 'color' ? '같은 기기 · 다른 색상' : '같은 색상 · 다른 기기'} ${allSelected ? '전체 해제' : '전체 선택'}`);
  const panel = $('variant-panel'); const list = document.createElement('div'); list.className = 'variant-list';
  candidates.filter((variant) => !variant.selected).forEach((variant) => {
    const row = document.createElement('div'); row.className = 'variant-item';
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = `${state.activeTab}-${variant.asin}`; input.checked = selected.has(variant.asin);
    input.onchange = () => { input.checked ? selected.add(variant.asin) : selected.delete(variant.asin); renderModal(); };
    const label = document.createElement('label'); label.htmlFor = input.id;
    const name = document.createElement('strong'); name.textContent = variant.label;
    label.append(name);
    if (state.activeTab === 'device') {
      const preview = variant.colorPreview;
      const detail = document.createElement('small'); detail.className = 'device-color-preview';
      detail.textContent = preview?.status === 'complete'
        ? `${preview.colors.length}개 색상 · ${preview.colors.map((color) => color.label).join(' · ')}`
        : '색상 구성 확인 불가 · 대표 ASIN만 저장';
      label.append(detail);
    }
    const asin = document.createElement('span'); asin.textContent = variant.asin;
    label.append(asin); row.append(input, label); list.append(row);
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
  const count = selectedSaveAsins().size;
  $('selected-count').textContent = count;
  $('selected-count-top').textContent = count;
  $('save-selected').disabled = count === 0;
}

function openModal() { $('import-backdrop').hidden = false; renderModal(); }
function openSaveChoice() {
  const snapshot = state.snapshot;
  const variants = derivedVariantAsins(snapshot);
  $('save-choice-title').textContent = snapshot.title;
  $('save-choice-detail').textContent = `${snapshot.currentColor} · ${snapshot.currentDevice} · ${snapshot.asin}`;
  $('save-choice-count').textContent = derivedSaveAsinCount(snapshot);
  $('save-choice-backdrop').hidden = false;
}
function closeModal(id) {
  const backdrop = { import: 'import-backdrop', choice: 'save-choice-backdrop', schema: 'schema-backdrop' }[id];
  if (backdrop) $(backdrop).hidden = true;
}

function showProcessing(kind, count = 0) {
  const isLookup = kind === 'lookup';
  $('processing-title').textContent = isLookup ? '파생 ASIN을 읽고 있어요.' : '카탈로그에 저장하고 있어요.';
  $('processing-stage').textContent = isLookup ? 'Amazon 응답을 확인하고 제품·색상·호환 기기 정보를 누적합니다.' : `${count}개 ASIN의 색상·호환 기기 조합을 다시 검증한 뒤 저장합니다.`;
  $('processing-count').textContent = isLookup ? 'ANALYZING' : `${count} ASIN`;
  $('processing-elapsed').textContent = '경과 0초';
  $('processing-backdrop').hidden = false;
  const startedAt = Date.now();
  window.clearInterval(state.processingTimer);
  state.processingTimer = window.setInterval(() => { $('processing-elapsed').textContent = `경과 ${Math.floor((Date.now() - startedAt) / 1000)}초`; }, 1000);
}

function hideProcessing() {
  window.clearInterval(state.processingTimer);
  state.processingTimer = null;
  $('processing-backdrop').hidden = true;
}

async function saveSelection({ includeBase, button, keepSnapshot = false }) {
  button.disabled = true;
  try {
    const count = includeBase ? 1 : selectedSaveAsins().size;
    showProcessing('save', count);
    toast(`${count}개 ASIN의 색상·호환 기기 조합을 검증하고 저장합니다.`);
    const output = await api('/api/catalog', { method: 'POST', body: JSON.stringify({ action: 'save', input: $('amazon-input').value, selection: { includeBase, colorAsins: [...state.selectedColors], deviceAsins: [...state.selectedDevices] } }) });
    await loadCatalog();
    if (keepSnapshot) {
      closeModal('choice');
      openModal();
      setLookupStatus('검색된 제품을 저장했습니다. 저장할 파생 ASIN을 선택하세요.');
      toast('검색된 제품을 저장했습니다.');
      return;
    }
    closeModal('choice'); closeModal('import'); state.selectedColors.clear(); state.selectedDevices.clear(); state.snapshot = null; $('amazon-input').value = ''; setLookupStatus('카탈로그에 저장했습니다.'); toast(`${output.savedCount || count}개 ASIN을 카탈로그에 저장했습니다.`);
  } catch (error) { toast(error.message, true); } finally { hideProcessing(); button.disabled = false; }
}

async function lookup(event) {
  event.preventDefault(); const button = $('lookup-button'); button.disabled = true;
  showProcessing('lookup');
  setLookupStatus('제품·색상·기기 정보를 누적 수집하는 중입니다…');
  try {
    const output = await api('/api/catalog', { method: 'POST', body: JSON.stringify({ action: 'lookup', input: $('amazon-input').value }) });
    state.snapshot = output.snapshot; state.selectedColors.clear(); state.selectedDevices.clear(); state.activeTab = 'color';
    state.modalScroll = { color: 0, device: 0 };
    const variants = derivedVariantAsins(state.snapshot);
    if (!variants.length) {
      setLookupStatus('파생 ASIN이 없어 검색된 제품을 자동 저장합니다.');
      await saveSelection({ includeBase: true, button });
      return;
    }
    setLookupStatus(`${output.attempts}회 수집으로 ${variants.length}개 파생 ASIN 정보를 완성했습니다.`); openSaveChoice();
  } catch (error) { setLookupStatus(error.message, true); } finally { hideProcessing(); button.disabled = false; }
}

async function bootstrap() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(config.message || 'Supabase 환경 설정을 확인할 수 없습니다.');
    state.supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
    const { data: { session } } = await state.supabase.auth.getSession(); state.session = session;
    const renderSession = async (nextSession) => {
      state.session = nextSession;
      if (!nextSession) return showAuth();
      const { data: { user }, error } = await state.supabase.auth.getUser();
      if (error || !user) throw error || new Error('로그인 정보를 확인하지 못했습니다.');
      if (!isCatalogMemberEmail(user.email)) {
        state.accessDenied = true;
        await state.supabase.auth.signOut();
        return showAuth();
      }
      state.accessDenied = false;
      showApp(user); await loadCatalog();
    };
    state.supabase.auth.onAuthStateChange((_event, nextSession) => { renderSession(nextSession).catch((error) => toast(error.message, true)); });
    await renderSession(session);
  } catch (error) { showAuth(error.message); $('google-login').disabled = true; }
}

$('google-login').onclick = async () => {
  try { const { error } = await state.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin, queryParams: { hd: 'spigen.com' } } }); if (error) throw error; } catch (error) { $('auth-note').textContent = error.message; }
};
$('logout-button').onclick = async () => { await state.supabase.auth.signOut(); };
$('lookup-form').onsubmit = lookup;
$('all-filter').onclick = () => { state.filter = { category: null, model: null, color: null }; render(); };
$('clear-filter').onclick = () => { state.filter = { category: null, model: null, color: null }; render(); };
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
$('save-base-only').onclick = () => saveSelection({ includeBase: true, button: $('save-base-only') });
$('save-with-variants').onclick = () => saveSelection({ includeBase: true, button: $('save-with-variants'), keepSnapshot: true });
$('save-selected').onclick = () => saveSelection({ includeBase: false, button: $('save-selected') });
$('select-all-current').onclick = () => {
  const selected = state.activeTab === 'color' ? state.selectedColors : state.selectedDevices;
  const next = toggleAllSelectableVariants(selected, candidateList());
  selected.clear(); next.forEach((asin) => selected.add(asin));
  renderModal();
};
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal('import'); closeModal('choice'); closeModal('schema'); $('sidebar').classList.remove('show'); } });
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
