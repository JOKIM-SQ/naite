const $ = (id) => document.getElementById(id);

function empty(message) {
  const node = document.createElement('p');
  node.className = 'empty-intel';
  node.textContent = message;
  return node;
}

function renderAlerts(alerts = []) {
  $('alert-count').textContent = alerts.length;
  const inbox = $('alert-inbox');
  if (!alerts.length) { inbox.replaceChildren(empty('오늘은 조치가 필요한 고객 신호가 없습니다.')); return; }
  inbox.replaceChildren(...alerts.map((alert) => {
    const item = document.createElement('button');
    item.className = `alert-item ${alert.severity}`; item.type = 'button';
    const mark = document.createElement('i'); mark.className = 'alert-mark';
    const copy = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = alert.title;
    const detail = document.createElement('p'); detail.textContent = `${alert.productTitle} · ${alert.detail}`;
    const action = document.createElement('small'); action.textContent = alert.action;
    copy.append(title, detail); item.append(mark, copy, action);
    item.onclick = () => window.openS06Detail?.(alert.productId);
    return item;
  }));
}

function renderWeekly(report) {
  $('weekly-period').textContent = report ? `${report.from.slice(5)} — ${report.to.slice(5)}` : '—';
  const root = $('weekly-report');
  if (!report) { root.replaceChildren(empty('주간 수집 기록이 아직 없습니다.')); return; }
  const stats = [
    ['새 분석 리뷰', `${report.newReviews}개`],
    ['가장 큰 페인 포인트', report.topPainPoint || '아직 없음'],
    ['별점 추세', report.ratingTrend],
  ].map(([label, value]) => {
    const row = document.createElement('div'); row.className = 'weekly-stat';
    const name = document.createElement('span'); name.textContent = label;
    const result = document.createElement('strong'); result.textContent = value;
    row.append(name, result); return row;
  });
  const action = document.createElement('p'); action.className = 'weekly-action'; action.textContent = report.recommendedAction;
  root.replaceChildren(...stats, action);
}

function metric(label, value, tone = '') {
  const cell = document.createElement('div'); cell.className = 'comparison-cell';
  const result = document.createElement('b'); result.className = tone; result.textContent = value;
  const name = document.createElement('span'); name.textContent = label;
  cell.append(result, name); return cell;
}

function renderComparison(rows = []) {
  const root = $('comparison-list');
  if (!rows.length) { root.replaceChildren(empty('두 개 이상의 제품을 등록하면 비교 신호가 쌓입니다.')); return; }
  root.replaceChildren(...rows.map((row) => {
    const item = document.createElement('button'); item.className = 'comparison-row'; item.type = 'button';
    const product = document.createElement('div'); product.className = 'comparison-product';
    const title = document.createElement('strong'); title.textContent = row.title;
    const asin = document.createElement('span'); asin.textContent = row.asin;
    product.append(title, asin);
    const delta = row.ratingDelta == null ? '—' : `${row.ratingDelta > 0 ? '+' : ''}${row.ratingDelta.toFixed(1)}`;
    const open = document.createElement('i'); open.className = 'comparison-open'; open.textContent = '↗';
    item.append(
      product,
      metric('별점', row.rating == null ? '—' : `★ ${Number(row.rating).toFixed(1)}`),
      metric('변화', delta, row.ratingDelta < 0 ? 'down' : ''),
      metric('새 리뷰', `${row.newReviews}개`),
      metric('주요 이슈', row.topPainPoint || '없음', row.topPainPoint ? 'down' : ''),
      open,
    );
    item.onclick = () => window.openS06Detail?.(row.productId);
    return item;
  }));
}

function render(payload) {
  renderAlerts(payload.alerts || []);
  renderWeekly(payload.weeklyReport || null);
  renderComparison(payload.comparison || []);
}

window.addEventListener('s06-dashboard', (event) => render(event.detail));
if (window.s06Dashboard) render(window.s06Dashboard);
