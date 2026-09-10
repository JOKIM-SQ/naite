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
  const tone = report.reviewTone || { total: 0, positive: 0, neutral: 0, negative: 0 };
  const percent = (value) => tone.total ? Math.round((value / tone.total) * 100) : 0;
  const positive = percent(tone.positive); const neutral = percent(tone.neutral); const negative = Math.max(0, 100 - positive - neutral);
  const overview = document.createElement('div'); overview.className = 'weekly-overview';
  const donut = document.createElement('div'); donut.className = 'review-donut';
  donut.style.background = tone.total ? `conic-gradient(#57ff86 0 ${positive}%, #879b8c ${positive}% ${positive + neutral}%, #ff4d58 ${positive + neutral}% 100%)` : 'rgb(38 104 53 / .35)';
  donut.setAttribute('role', 'img'); donut.setAttribute('aria-label', `분석 리뷰 ${tone.total}개: 긍정 ${positive}%, 중립 ${neutral}%, 부정 ${negative}%`);
  const donutCenter = document.createElement('div'); donutCenter.className = 'review-donut-center';
  const total = document.createElement('strong'); total.textContent = tone.total;
  const totalLabel = document.createElement('span'); totalLabel.textContent = 'REVIEWS'; donutCenter.append(total, totalLabel); donut.append(donutCenter);
  const legend = document.createElement('dl'); legend.className = 'review-tone-legend';
  [['긍정', positive, 'positive'], ['중립', neutral, 'neutral'], ['부정', negative, 'negative']].forEach(([label, value, toneClass]) => {
    const row = document.createElement('div'); const name = document.createElement('dt'); name.className = toneClass; name.textContent = label;
    const result = document.createElement('dd'); result.textContent = `${value}%`; row.append(name, result); legend.append(row);
  });
  overview.append(donut, legend);
  const stats = document.createElement('div'); stats.className = 'weekly-mini-stats';
  [['새 분석 리뷰', `${report.newReviews}개`], ['별점 추세', report.ratingTrend]].forEach(([label, value]) => {
    const row = document.createElement('div'); const name = document.createElement('span'); name.textContent = label;
    const result = document.createElement('strong'); result.textContent = value; row.append(name, result); stats.append(row);
  });
  const themes = report.topPainPoints || [];
  const painToggle = document.createElement('button'); painToggle.className = 'weekly-pain-toggle'; painToggle.type = 'button';
  const painCopy = document.createElement('span'); painCopy.textContent = '주요 페인포인트';
  const painValue = document.createElement('strong'); painValue.textContent = themes.length > 1 ? `동률 ${themes.length}개` : themes.length ? `${themes.length}개` : '아직 없음';
  const arrow = document.createElement('i'); arrow.textContent = '⌄'; painToggle.append(painCopy, painValue, arrow);
  const detail = document.createElement('section'); detail.className = 'weekly-pain-details'; detail.hidden = true; detail.style.display = 'none';
  const detailIntro = document.createElement('p'); detailIntro.textContent = themes.length > 1 ? '같은 빈도로 감지된 이슈입니다. 항목을 누르면 해당 상품의 원문 리뷰를 볼 수 있습니다.' : '항목을 누르면 해당 상품의 원문 리뷰를 볼 수 있습니다.';
  detail.append(detailIntro);
  themes.forEach((theme) => {
    const item = document.createElement('button'); item.className = 'weekly-pain-theme'; item.type = 'button';
    const label = document.createElement('strong'); label.textContent = theme.label;
    const source = document.createElement('span'); source.textContent = `${theme.value} SIGNAL · ${(theme.products || []).map((product) => product.title).join(', ')}`;
    item.append(label, source); item.onclick = () => window.openS06Detail?.(theme.products?.[0]?.id); detail.append(item);
  });
  painToggle.disabled = !themes.length;
  painToggle.onclick = () => { const expanded = painToggle.getAttribute('aria-expanded') === 'true'; painToggle.setAttribute('aria-expanded', String(!expanded)); painToggle.classList.toggle('expanded', !expanded); detail.hidden = expanded; detail.style.display = expanded ? 'none' : 'grid'; };
  painToggle.setAttribute('aria-expanded', 'false');
  root.replaceChildren(overview, stats, painToggle, detail);
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
