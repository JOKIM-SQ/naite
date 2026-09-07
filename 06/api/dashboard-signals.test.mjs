import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeTodaySignals } from './dashboard-signals.mjs';

test('오늘 새 리뷰·새 페인 포인트와 추적 제품의 평균 별점 변화를 집계한다', () => {
  const summary = summarizeTodaySignals({
    today: '2026-09-07',
    products: [
      { id: 'a', last_checked_at: '2026-09-07T13:00:00.000Z' },
      { id: 'b', last_checked_at: '2026-09-07T13:01:00.000Z' },
    ],
    snapshots: [
      { product_id: 'a', tracked_on: '2026-09-07', rating: 4.1 },
      { product_id: 'a', tracked_on: '2026-09-06', rating: 4.4 },
      { product_id: 'b', tracked_on: '2026-09-07', rating: 4.7 },
      { product_id: 'b', tracked_on: '2026-09-06', rating: 4.5 },
    ],
    analyses: [
      { analyzed_on: '2026-09-07', review_count: 2, analysis: { painPoints: ['초기 설정', '호환성'] } },
      { analyzed_on: '2026-09-07', review_count: 1, analysis: { painPoints: ['초기 설정'] } },
      { analyzed_on: '2026-09-06', review_count: 4, analysis: { painPoints: ['설명서'] } },
    ],
  });

  assert.deepEqual(summary, {
    trackedProducts: 2,
    newReviews: 3,
    newPainPoints: 2,
    ratingDelta: -0.1,
    lastCheckedAt: '2026-09-07T13:01:00.000Z',
  });
});

test('첫 수집일은 별점 변화 대신 0을 보여준다', () => {
  assert.equal(summarizeTodaySignals({
    today: '2026-09-07', products: [{ id: 'a', last_checked_at: null }],
    snapshots: [{ product_id: 'a', tracked_on: '2026-09-07', rating: 4.4 }], analyses: [],
  }).ratingDelta, 0);
});
