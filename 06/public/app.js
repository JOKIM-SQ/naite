const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = './favicon.svg';
document.head.append(favicon);

const scanProgressStyles = document.createElement('link');
scanProgressStyles.rel = 'stylesheet';
scanProgressStyles.href = './scan-progress.css';
document.head.append(scanProgressStyles);

const signalOrbitStyles = document.createElement('link');
signalOrbitStyles.rel = 'stylesheet';
signalOrbitStyles.href = './signal-orbit.css';
document.head.append(signalOrbitStyles);

const signalOrbitTweaks = document.createElement('link');
signalOrbitTweaks.rel = 'stylesheet';
signalOrbitTweaks.href = './signal-orbit-tweaks.css';
document.head.append(signalOrbitTweaks);

const titleGlitchStyles = document.createElement('link');
titleGlitchStyles.rel = 'stylesheet';
titleGlitchStyles.href = './title-glitch.css';
document.head.append(titleGlitchStyles);

const brandGroupStyles = document.createElement('link');
brandGroupStyles.rel = 'stylesheet';
brandGroupStyles.href = './brand-groups.css';
document.head.append(brandGroupStyles);

const $ = (id) => document.getElementById(id);
const dateText = (value) => value ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(value)) : '아직 없음';
const safeImage = (value) => /^https:\/\//.test(value || '') ? value : '';
const status = $('status');
const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
const brandGroup = (product) => /\bspigen\b/i.test(product?.title || '') ? 'spigen' : 'competitor';
const brandCopy = { spigen: 'SPIGEN', competitor: 'COMPETITOR' };
const scanCopy = {
  connect: ['REMOTE SESSION · CONNECTING', 'Browserbase 원격 브라우저 세션을 연결하는 중입니다.', 0],
  render: ['PDP RENDER · RUNNING', 'Amazon PDP를 열고 공개 리뷰를 렌더링하는 중입니다.', 0],
  retry: ['REMOTE SESSION · RETRYING', '응답이 불안정해 새 원격 세션으로 다시 시도합니다.', 0],
  snapshot: ['SNAPSHOT · SAVING', '첫 별점·가격·공개 리뷰 스냅샷을 만드는 중입니다.', 1],
  claude: ['CLAUDE · ANALYZING', '새 리뷰의 장점·단점·페인포인트를 분석하는 중입니다.', 2],
  store: ['SIGNALS · STORING', '리뷰 근거와 분석 신호를 추적 카드에 저장하는 중입니다.', 2],
};
function setScanStage(payload = {}) {
  const [label, fallback, activeIndex] = scanCopy[payload.id] || scanCopy.connect;
  const suffix = payload.attempt ? ` · ${payload.attempt}/${payload.maxAttempts}` : '';
  const progress = $('scan-progress');
  progress.dataset.stage = payload.id || 'connect';
  progress.querySelector('p').textContent = `${label}${suffix}`;
  progress.querySelector('strong').textContent = payload.message || fallback;
  [...progress.querySelectorAll('.scan-pipeline span')].forEach((node, index) => {
    node.classList.toggle('is-active', index === activeIndex);
    node.classList.toggle('is-done', index < activeIndex);
  });
  setStatus(payload.message || fallback);
}
function setScanWorking(working) {
  $('tracker-panel').classList.toggle('scanning', working);
  $('tracker-form').setAttribute('aria-busy', String(working));
  $('scan-progress').hidden = !working;
  $('amazon-url').disabled = working;
  $('track-button').disabled = working;
  $('track-label').textContent = working ? 'SCANNING' : 'START SCAN';
}
async function request(path, options = {}) { const response = await fetch(path, options); const payload = await response.json(); if (!response.ok) throw new Error(payload.message || '요청을 처리하지 못했습니다.'); return payload; }
async function trackProduct(url) {
  const response = await fetch('/api/products', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ url }),
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || '추적 카드를 만들지 못했습니다.');
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed;
  const processEvent = (block) => {
    const name = block.match(/^event:\s*(.+)$/m)?.[1];
    const source = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!name || !source) return;
    const payload = JSON.parse(source);
    if (name === 'stage') setScanStage(payload);
    if (name === 'complete') completed = payload;
    if (name === 'error') throw new Error(payload.message || '추적 카드를 만들지 못했습니다.');
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\n\n/); buffer = blocks.pop() || '';
    blocks.forEach(processEvent);
    if (done) break;
  }
  if (!completed) throw new Error('추적 작업이 완료되기 전에 연결이 종료되었습니다.');
  return completed;
}
function card(product) {
  const node = document.createElement('button'); node.className = 'product-card'; node.type = 'button';
  const media = document.createElement('div'); media.className = 'product-media'; const image = safeImage(product.image_url);
  if (image) { const img = document.createElement('img'); img.src = image; img.alt = ''; media.append(img); } else media.textContent = product.asin;
  const body = document.createElement('div'); body.className = 'product-body';
  const eyebrow = document.createElement('p'); eyebrow.className = 'card-eyebrow'; eyebrow.textContent = `${product.asin} · DAILY TRACKING`;
  const title = document.createElement('h3'); title.textContent = product.title || 'Amazon 상품';
  const meta = document.createElement('div'); meta.className = 'metrics'; [['★', product.rating == null ? '별점 없음' : `${Number(product.rating).toFixed(1)} / 5`], ['$', product.displayed_price || '가격 없음'], ['↻', dateText(product.last_checked_at)]].forEach(([label, value]) => { const span = document.createElement('span'); span.textContent = `${label} ${value}`; meta.append(span); });
  const foot = document.createElement('div'); foot.className = 'card-foot'; const tracking = document.createElement('span'); tracking.className = product.tracking_enabled ? 'tracking-state on' : 'tracking-state'; tracking.textContent = product.tracking_enabled ? 'DAILY ON' : 'PAUSED'; const link = document.createElement('span'); link.textContent = 'REVIEW SIGNALS →'; foot.append(tracking, link); body.append(eyebrow, title, meta, foot); node.append(media, body); node.onclick = () => openDetail(product.id); return node;
}
function renderDataStream(products) {
  const stream = $('data-stream');
  const signals = products.length ? products.flatMap((product) => [
    `ASIN::${product.asin}`, `RATING::${product.rating ?? 'UNKNOWN'}`, `PRICE::${product.displayed_price || 'UNKNOWN'}`,
    `SCAN::${dateText(product.last_checked_at)}`, `TRACK::${product.tracking_enabled ? 'ACTIVE' : 'PAUSED'}`,
  ]) : ['AWAITING SOURCE', 'SIGNAL LINK READY', 'NEW REVIEW SCAN', 'PAIN POINT MONITOR', 'TRACKING ACTIVE'];
  stream.replaceChildren();
  Array.from({ length: 8 }, (_, laneIndex) => {
    const lane = document.createElement('div'); lane.className = 'stream-lane'; lane.style.setProperty('--lane-delay', `${laneIndex * -3.7}s`);
    Array.from({ length: 16 }, (_, index) => {
      const line = document.createElement('span'); line.textContent = `${String(index + 1).padStart(2, '0')} // ${signals[(laneIndex * 3 + index) % signals.length]}`; lane.append(line);
    });
    return lane;
  }).forEach((lane) => stream.append(lane));
}
function productGroup(key, products) {
  const section = document.createElement('section'); section.className = `product-brand-group ${key}`;
  const heading = document.createElement('header'); const label = document.createElement('span'); label.textContent = brandCopy[key];
  const count = document.createElement('b'); count.textContent = `${products.length} TRACKED`; heading.append(label, count);
  const grid = document.createElement('div'); grid.className = 'product-brand-grid'; grid.append(...products.map(card)); section.append(heading, grid); return section;
}
function renderProducts(products) {
  $('product-count').textContent = products.length;
  const groups = ['spigen', 'competitor'].map((key) => [key, products.filter((product) => brandGroup(product) === key)]);
  $('product-grid').replaceChildren(...groups.filter(([, rows]) => rows.length).map(([key, rows]) => productGroup(key, rows)));
  $('empty-state').hidden = products.length !== 0; renderDataStream(products);
}
function renderTodaySignals(summary) {
  const delta = Number(summary.ratingDelta || 0);
  $('signal-review-count').textContent = summary.newReviews || '0';
  $('signal-pain-count').textContent = summary.newPainPoints || '0';
  $('signal-pain').classList.toggle('alert', Number(summary.newPainPoints || 0) > 0);
  $('signal-rating-delta').textContent = delta === 0 ? '±0.0' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
  $('signal-rating').classList.toggle('alert', delta < 0);
  $('signal-rating').classList.toggle('neutral', delta === 0);
  $('signal-rating-copy').textContent = delta < 0 ? '전일 대비 하락 감지' : delta > 0 ? '전일 대비 상승 감지' : '전일 기준 변화 없음';
  $('signal-last-check').textContent = summary.lastCheckedAt ? `마지막 신호 확인 · ${dateText(summary.lastCheckedAt)} · 추적 카드 ${summary.trackedProducts}개` : `추적 카드 ${summary.trackedProducts || 0}개 · 아직 오늘의 수집 기록이 없습니다.`;
  $('orbit-tracked').textContent = summary.trackedProducts || 0;
  $('orbit-reviews').textContent = summary.newReviews || 0;
  $('orbit-pain').textContent = summary.newPainPoints || 0;
  $('orbit-rating').textContent = delta === 0 ? '±0.0' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
  $('orbit-state').textContent = Number(summary.newPainPoints || 0) > 0 ? 'SIGNAL FOUND' : 'LISTENING';
  document.querySelector('.signal-orbit').classList.toggle('is-clear', Number(summary.newPainPoints || 0) === 0);
}
async function loadProducts() {
  const products = await request('/api/products'); renderProducts(products.products || []);
  try { const dashboard = await request('/api/dashboard'); renderTodaySignals(dashboard); window.s06Dashboard = dashboard; window.dispatchEvent(new CustomEvent('s06-dashboard', { detail: dashboard })); } catch (error) { $('signal-last-check').textContent = error.message; }
}
function group(title, values, tone) { const section = document.createElement('section'); section.className = `signal-group ${tone}`; const heading = document.createElement('h3'); heading.textContent = title; section.append(heading); if (!values?.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '아직 분석된 항목이 없습니다.'; section.append(empty); return section; } const max = Math.max(...values.map((v) => v.value)); values.forEach((value) => { const row = document.createElement('div'); row.className = 'signal-row'; const label = document.createElement('span'); label.textContent = value.label; const bar = document.createElement('i'); bar.style.setProperty('--signal-width', `${Math.max(12, value.value / max * 100)}%`); const count = document.createElement('b'); count.textContent = value.value; row.append(label, bar, count); section.append(row); }); return section; }
function list(title, rows, render) { const section = document.createElement('section'); section.className = 'detail-list'; const heading = document.createElement('h3'); heading.textContent = `${title} ${rows.length}`; section.append(heading); if (!rows.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '아직 저장된 항목이 없습니다.'; section.append(empty); } else rows.forEach((row) => section.append(render(row))); return section; }
function timeline(points = []) { const section = document.createElement('section'); section.className = 'detail-list'; const heading = document.createElement('h3'); heading.textContent = '변화 타임라인'; section.append(heading); if (!points.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '일별 스냅샷이 쌓이면 변화 추세를 표시합니다.'; section.append(empty); return section; } const chart = document.createElement('div'); chart.className = 'timeline'; points.slice(-7).forEach((point) => { const row = document.createElement('div'); row.className = 'timeline-point'; const date = document.createElement('time'); date.textContent = point.date.slice(5); const bar = document.createElement('div'); bar.className = 'timeline-bar'; const fill = document.createElement('i'); fill.style.width = `${Math.max(8, Number(point.rating || 0) / 5 * 100)}%`; bar.append(fill); const value = document.createElement('small'); value.textContent = `★ ${point.rating ?? '—'}${point.ratingDelta == null ? '' : ` · ${point.ratingDelta > 0 ? '+' : ''}${point.ratingDelta.toFixed(1)}`}`; value.classList.toggle('down', Number(point.ratingDelta) < 0); row.append(date, bar, value); chart.append(row); }); section.append(chart); return section; }
function evidenceReviews(rows = []) { const section = document.createElement('section'); section.className = 'detail-list'; const heading = document.createElement('h3'); heading.textContent = `리뷰 근거 ${rows.length}`; section.append(heading); if (!rows.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = '아직 저장된 항목이 없습니다.'; section.append(empty); return section; } let active = 'all'; const themes = [...new Set(rows.flatMap((row) => [...(row.negativeFactors || []), ...(row.painPoints || [])]))].slice(0, 5); const controls = document.createElement('div'); controls.className = 'review-filters'; const body = document.createElement('div'); const draw = () => { [...controls.children].forEach((button) => button.classList.toggle('active', button.dataset.filter === active)); const shown = rows.filter((row) => active === 'all' || active === 'low' ? active !== 'low' || Number(row.rating) <= 3 : [...(row.negativeFactors || []), ...(row.painPoints || [])].includes(active)); if (!shown.length) { const empty = document.createElement('p'); empty.className = 'no-filtered-reviews'; empty.textContent = '현재 필터에 맞는 리뷰가 없습니다.'; body.replaceChildren(empty); return; } body.replaceChildren(...shown.map((row) => { const item = document.createElement('article'); const meta = document.createElement('p'); meta.className = 'review-meta'; meta.textContent = `${row.rating == null ? '별점 없음' : `★ ${row.rating}`} · 최초 확인 ${dateText(row.first_seen_at)}`; const title = document.createElement('h4'); title.textContent = row.review_title || '제목 없음'; const text = document.createElement('p'); text.textContent = row.review_text; const tags = document.createElement('div'); tags.className = 'review-tags'; [['positiveFactors', 'positive'], ['negativeFactors', 'negative'], ['painPoints', 'pain']].forEach(([field, tone]) => (row[field] || []).forEach((label) => { const tag = document.createElement('span'); tag.className = `review-tag ${tone}`; tag.textContent = label; tags.append(tag); })); item.append(meta, title, text); if (tags.childElementCount) item.append(tags); return item; })); }; [['전체', 'all'], ['저평점 1–3', 'low'], ...themes.map((theme) => [theme, theme])].forEach(([label, filter]) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'review-filter'; button.dataset.filter = filter; button.textContent = label; button.onclick = () => { active = filter; draw(); }; controls.append(button); }); section.append(controls, body); draw(); return section; }
async function openDetail(productId) { const content = $('detail-content'); $('detail-backdrop').hidden = false; content.textContent = '리뷰 신호를 불러오는 중입니다…'; try { const detail = await request(`/api/product-detail?productId=${encodeURIComponent(productId)}`); $('detail-title').textContent = detail.product.title || detail.product.asin; const intro = document.createElement('p'); intro.className = 'detail-link'; const link = document.createElement('a'); link.href = detail.product.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `Amazon PDP 열기 (${detail.product.asin}) ↗`; intro.append(link); const signals = document.createElement('div'); signals.className = 'signals'; signals.append(group('장점 분포', detail.distribution.positives, 'positive'), group('단점 분포', detail.distribution.negatives, 'negative'), group('페인 포인트', detail.distribution.painPoints, 'pain')); const snapshots = list('일별 스냅샷', detail.snapshots.slice().reverse().slice(0, 7), (row) => { const p = document.createElement('p'); p.textContent = `${row.tracked_on} · ★ ${row.rating ?? '—'} · ${row.displayed_price || '가격 없음'} · 화면 리뷰 ${row.visible_review_count}개`; return p; }); content.replaceChildren(intro, signals, timeline(detail.timeline), snapshots, evidenceReviews(detail.reviewEvidence || detail.reviews)); } catch (error) { content.textContent = error.message; } }
$('tracker-form').addEventListener('submit', async (event) => { event.preventDefault(); const url = $('amazon-url').value.trim(); if (!url) return; setScanWorking(true); setScanStage({ id: 'connect' }); try { const payload = await trackProduct(url); await loadProducts(); $('amazon-url').value = ''; setStatus(payload.existing ? '이미 추적 중인 제품입니다.' : `${payload.tracking.newReviews}개의 수집 리뷰를 기준으로 첫 분석을 저장했습니다.`); } catch (error) { setStatus(error.message, true); } finally { setScanWorking(false); } });
$('detail-close').onclick = () => { $('detail-backdrop').hidden = true; }; $('detail-backdrop').onclick = (event) => { if (event.target === $('detail-backdrop')) $('detail-backdrop').hidden = true; }; window.openS06Detail = openDetail; loadProducts().catch((error) => setStatus(error.message, true));
