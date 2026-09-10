const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const finiteRating = (value) => Number.isFinite(Number(value));

function dateBefore(today, days) {
  const date = new Date(`${today}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function reviewDate(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function rank(values = []) {
  const counts = new Map();
  values.map(compact).filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ko'));
}

function list(value) { return Array.isArray(value) ? value.map(compact).filter(Boolean) : []; }

function productSnapshots(snapshots, productId) {
  return snapshots.filter((snapshot) => snapshot.product_id === productId)
    .slice().sort((a, b) => String(a.tracked_on).localeCompare(String(b.tracked_on)));
}

function ratingDelta(snapshots, productId) {
  const rows = productSnapshots(snapshots, productId);
  const current = rows.at(-1);
  const previous = rows.at(-2);
  if (!current || !previous || !finiteRating(current.rating) || !finiteRating(previous.rating)) return null;
  return Number((Number(current.rating) - Number(previous.rating)).toFixed(1));
}

function latestRating(snapshots, productId) {
  return productSnapshots(snapshots, productId).at(-1)?.rating ?? null;
}

function analysisRows(analyses, productId, from, to) {
  return analyses.filter((analysis) => analysis.product_id === productId && analysis.analyzed_on >= from && analysis.analyzed_on <= to);
}

function analysisThemes(rows, field) {
  return rank(rows.flatMap((row) => list(row.analysis?.[field])));
}

function weeklyPainThemes(rows, products) {
  const titles = new Map(products.map((product) => [product.id, product.title || product.asin]));
  const sources = new Map();
  rows.forEach((row) => list(row.analysis?.painPoints).forEach((label) => {
    const ids = sources.get(label) || new Set();
    ids.add(row.product_id);
    sources.set(label, ids);
  }));
  return analysisThemes(rows, 'painPoints').map((theme) => ({
    ...theme,
    products: [...(sources.get(theme.label) || [])].map((id) => ({ id, title: titles.get(id) || id })),
  }));
}

function weeklyReviewTone(rows, reviews) {
  const fingerprints = new Set(rows.flatMap((row) => (row.review_fingerprints || []).map((fingerprint) => `${row.product_id}:${fingerprint}`)));
  return reviews.reduce((tone, review) => {
    if (!fingerprints.has(`${review.product_id}:${review.fingerprint}`) || !finiteRating(review.rating)) return tone;
    tone.total += 1;
    if (Number(review.rating) >= 4) tone.positive += 1;
    else if (Number(review.rating) === 3) tone.neutral += 1;
    else tone.negative += 1;
    return tone;
  }, { total: 0, positive: 0, neutral: 0, negative: 0 });
}

const severityWeight = { critical: 0, warning: 1, info: 2 };
const alertWeight = { rating_drop: 0, pain_point: 1, low_rating_review: 2 };

function alertForProduct({ product, snapshots, reviews, analyses, today }) {
  const alerts = [];
  const delta = ratingDelta(snapshots, product.id);
  const title = product.title || product.asin;
  if (delta != null && delta < 0) {
    alerts.push({
      id: `rating-${product.id}`, kind: 'rating_drop', severity: delta <= -0.3 ? 'critical' : 'warning', productId: product.id, productTitle: title,
      title: `평균 별점 ${Math.abs(delta).toFixed(1)} 하락`, detail: `${title}의 최근 일별 스냅샷에서 감지됐습니다.`, action: '추세와 원문 리뷰를 확인하세요.',
    });
  }
  const todayAnalyses = analysisRows(analyses, product.id, today, today);
  const topPain = analysisThemes(todayAnalyses, 'painPoints')[0];
  if (topPain) {
    alerts.push({
      id: `pain-${product.id}-${topPain.label}`, kind: 'pain_point', severity: 'warning', productId: product.id, productTitle: title,
      title: `${topPain.label} 페인 포인트 감지`, detail: `오늘 Claude 분석에서 ${topPain.value}회 언급됐습니다.`, action: '해당 페인 포인트의 원문 리뷰를 확인하세요.',
    });
  }
  const lowReview = reviews.filter((review) => review.product_id === product.id && reviewDate(review.first_seen_at) === today && Number(review.rating) <= 2)[0];
  if (lowReview) {
    alerts.push({
      id: `review-${product.id}-${lowReview.fingerprint}`, kind: 'low_rating_review', severity: 'warning', productId: product.id, productTitle: title,
      title: `${Number(lowReview.rating).toFixed(0)}점 신규 리뷰`, detail: compact(lowReview.review_title || lowReview.review_text).slice(0, 96), action: '원문 리뷰와 연결된 분석 근거를 확인하세요.',
    });
  }
  return alerts;
}

export function buildDashboardIntelligence({ today, products = [], snapshots = [], reviews = [], analyses = [] }) {
  const from = dateBefore(today, 6);
  const alerts = products.flatMap((product) => alertForProduct({ product, snapshots, reviews, analyses, today }))
    .sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity] || alertWeight[a.kind] - alertWeight[b.kind] || a.productTitle.localeCompare(b.productTitle, 'ko'));
  const comparison = products.map((product) => {
    const recentAnalyses = analysisRows(analyses, product.id, from, today);
    const topPain = analysisThemes(recentAnalyses, 'painPoints')[0];
    const delta = ratingDelta(snapshots, product.id);
    const risk = (delta || 0) < 0 ? Math.abs(delta) * 10 : 0;
    return {
      productId: product.id, asin: product.asin, title: product.title || product.asin,
      rating: latestRating(snapshots, product.id) ?? product.rating ?? null, ratingDelta: delta,
      displayedPrice: product.displayed_price || null, newReviews: recentAnalyses.reduce((sum, row) => sum + Number(row.review_count || 0), 0),
      topPainPoint: topPain?.label || null, painPointMentions: topPain?.value || 0, risk,
    };
  }).sort((a, b) => b.risk - a.risk || b.painPointMentions - a.painPointMentions || a.title.localeCompare(b.title, 'ko'));
  const weeklyAnalyses = analyses.filter((analysis) => analysis.analyzed_on >= from && analysis.analyzed_on <= today);
  const painThemes = weeklyPainThemes(weeklyAnalyses, products);
  const topPain = painThemes[0];
  const topPainPoints = topPain ? painThemes.filter((theme) => theme.value === topPain.value) : [];
  const weeklyDeltas = products.map((product) => {
    const rows = productSnapshots(snapshots, product.id).filter((row) => row.tracked_on >= from && row.tracked_on <= today);
    const first = rows[0]; const last = rows.at(-1);
    return first && last && finiteRating(first.rating) && finiteRating(last.rating) ? Number(last.rating) - Number(first.rating) : null;
  }).filter((value) => value != null);
  const averageDelta = weeklyDeltas.length ? weeklyDeltas.reduce((sum, value) => sum + value, 0) / weeklyDeltas.length : 0;
  const ratingTrend = averageDelta < -0.05 ? '하락' : averageDelta > 0.05 ? '상승' : '보합';
  return {
    alerts,
    comparison,
    weeklyReport: {
      from, to: today, newReviews: weeklyAnalyses.reduce((sum, row) => sum + Number(row.review_count || 0), 0),
      topPainPoint: topPain?.label || null, topPainPoints, reviewTone: weeklyReviewTone(weeklyAnalyses, reviews), ratingTrend,
      recommendedAction: topPain ? `${topPain.label} 관련 원문 리뷰를 우선 확인하세요.` : '새 리뷰가 쌓이면 다음 수집 후 신호를 확인하세요.',
    },
  };
}

export function buildProductSignals({ snapshots = [], reviews = [], analyses = [] }) {
  const timeline = snapshots.slice().sort((a, b) => String(a.tracked_on).localeCompare(String(b.tracked_on))).map((snapshot, index, rows) => {
    const previous = rows[index - 1];
    const delta = previous && finiteRating(snapshot.rating) && finiteRating(previous.rating) ? Number((Number(snapshot.rating) - Number(previous.rating)).toFixed(1)) : null;
    return { date: snapshot.tracked_on, rating: snapshot.rating ?? null, ratingDelta: delta, displayedPrice: snapshot.displayed_price || null, visibleReviewCount: snapshot.visible_review_count || 0 };
  });
  const evidenceByFingerprint = new Map();
  analyses.forEach((row) => (row.review_fingerprints || []).forEach((fingerprint) => {
    const existing = evidenceByFingerprint.get(fingerprint) || { positiveFactors: [], negativeFactors: [], painPoints: [] };
    ['positiveFactors', 'negativeFactors', 'painPoints'].forEach((field) => existing[field].push(...list(row.analysis?.[field])));
    evidenceByFingerprint.set(fingerprint, existing);
  }));
  const reviewEvidence = reviews.map((review) => {
    const evidence = evidenceByFingerprint.get(review.fingerprint) || { positiveFactors: [], negativeFactors: [], painPoints: [] };
    return { ...review, positiveFactors: [...new Set(evidence.positiveFactors)], negativeFactors: [...new Set(evidence.negativeFactors)], painPoints: [...new Set(evidence.painPoints)] };
  });
  return { timeline, reviewEvidence };
}
