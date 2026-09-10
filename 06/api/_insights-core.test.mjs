import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDashboardIntelligence, buildProductSignals } from './insights-core.mjs';

const products = [
  { id: 'a', asin: 'B0AAAA0001', title: 'Alpha 헤드폰', rating: 4.1, displayed_price: '$99', last_checked_at: '2026-09-08T14:00:00.000Z' },
  { id: 'b', asin: 'B0BBBB0002', title: 'Beta 헤드폰', rating: 4.7, displayed_price: '$129', last_checked_at: '2026-09-08T14:10:00.000Z' },
];

const snapshots = [
  { product_id: 'a', tracked_on: '2026-09-01', rating: 4.6, displayed_price: '$99', visible_review_count: 2 },
  { product_id: 'a', tracked_on: '2026-09-07', rating: 4.4, displayed_price: '$99', visible_review_count: 3 },
  { product_id: 'a', tracked_on: '2026-09-08', rating: 4.1, displayed_price: '$99', visible_review_count: 5 },
  { product_id: 'b', tracked_on: '2026-09-01', rating: 4.5, displayed_price: '$129', visible_review_count: 2 },
  { product_id: 'b', tracked_on: '2026-09-08', rating: 4.7, displayed_price: '$129', visible_review_count: 4 },
];

const reviews = [
  { product_id: 'a', fingerprint: 'r1', review_title: '연결이 끊겨요', review_text: '회의 중 연결이 두 번 끊겼습니다.', rating: 2, first_seen_at: '2026-09-08T13:00:00.000Z' },
  { product_id: 'a', fingerprint: 'r2', review_title: '음질은 좋아요', review_text: '음질과 배터리는 만족합니다.', rating: 4, first_seen_at: '2026-09-08T13:01:00.000Z' },
  { product_id: 'b', fingerprint: 'r3', review_title: '휴대는 편해요', review_text: '휴대성은 좋지만 케이스가 두껍습니다.', rating: 3, first_seen_at: '2026-09-07T13:00:00.000Z' },
];

const analyses = [
  { product_id: 'a', analyzed_on: '2026-09-08', review_count: 2, review_fingerprints: ['r1', 'r2'], analysis: { positiveFactors: ['음질'], negativeFactors: ['연결 안정성'], painPoints: ['연결 안정성'], recommendedFocus: '연결 품질을 점검하세요.', reviewSignals: [{ reviewIndex: 1, positiveFactors: [], negativeFactors: ['연결 안정성'], painPoints: ['연결 안정성'] }, { reviewIndex: 2, positiveFactors: ['음질'], negativeFactors: [], painPoints: [] }] } },
  { product_id: 'b', analyzed_on: '2026-09-07', review_count: 1, review_fingerprints: ['r3'], analysis: { positiveFactors: ['착용감'], negativeFactors: [], painPoints: ['휴대성'], recommendedFocus: '케이스를 개선하세요.', reviewSignals: [{ reviewIndex: 1, positiveFactors: ['착용감'], negativeFactors: [], painPoints: ['휴대성'] }] } },
];

test('대시보드는 별점 하락과 신규 페인 포인트를 조치 가능한 알림으로 만든다', () => {
  const intelligence = buildDashboardIntelligence({ today: '2026-09-08', products, snapshots, reviews, analyses });

  assert.deepEqual(intelligence.alerts.map((alert) => [alert.kind, alert.productId, alert.severity]), [
    ['rating_drop', 'a', 'critical'], ['pain_point', 'a', 'warning'], ['low_rating_review', 'a', 'warning'],
  ]);
  assert.equal(intelligence.comparison[0].productId, 'a');
  assert.equal(intelligence.comparison[0].ratingDelta, -0.3);
  assert.equal(intelligence.comparison[0].topPainPoint, '연결 안정성');
  assert.deepEqual(intelligence.weeklyReport, {
    from: '2026-09-02', to: '2026-09-08', newReviews: 3, topPainPoint: '연결 안정성',
    topPainPoints: [
      { label: '연결 안정성', value: 1, products: [{ id: 'a', title: 'Alpha 헤드폰' }] },
      { label: '휴대성', value: 1, products: [{ id: 'b', title: 'Beta 헤드폰' }] },
    ],
    reviewTone: { total: 3, positive: 1, neutral: 1, negative: 1 },
    ratingTrend: '하락', recommendedAction: '연결 안정성 관련 원문 리뷰를 우선 확인하세요.',
  });
});

test('제품 상세 신호는 날짜별 타임라인과 리뷰별 분석 근거를 제공한다', () => {
  const detail = buildProductSignals({ snapshots: snapshots.filter((row) => row.product_id === 'a'), reviews: reviews.filter((row) => row.product_id === 'a'), analyses: analyses.filter((row) => row.product_id === 'a') });

  assert.deepEqual(detail.timeline.map((point) => [point.date, point.ratingDelta]), [
    ['2026-09-01', null], ['2026-09-07', -0.2], ['2026-09-08', -0.3],
  ]);
  assert.deepEqual(detail.reviewEvidence[0].painPoints, ['연결 안정성']);
  assert.deepEqual(detail.reviewEvidence[1].positiveFactors, ['음질']);
  assert.deepEqual(detail.reviewEvidence[1].negativeFactors, []);
});

test('기존 배치 분석은 개별 리뷰의 근거 태그로 재사용하지 않는다', () => {
  const detail = buildProductSignals({
    reviews: reviews.filter((row) => row.product_id === 'a'),
    analyses: [{ product_id: 'a', analyzed_on: '2026-09-08', review_fingerprints: ['r1', 'r2'], analysis: { positiveFactors: ['음질'], negativeFactors: ['연결 안정성'], painPoints: ['연결 안정성'] } }],
  });

  assert.deepEqual(detail.reviewEvidence.map((review) => [review.positiveFactors, review.negativeFactors, review.painPoints]), [
    [[], [], []], [[], [], []],
  ]);
});
