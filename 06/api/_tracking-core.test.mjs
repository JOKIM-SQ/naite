import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deduplicateAnalyses,
  deduplicateReviews,
  knownReviewFingerprints,
  newReviewsOnly,
  reviewFingerprint,
  themeDistribution,
} from './tracking-core.mjs';
import { trackingDate } from './s06-store.mjs';

const review = {
  rating: 2,
  title: '설치가 어려워요',
  text: '처음 연결하는 방법을 찾기 힘들었습니다.',
};

test('같은 리뷰는 공백 차이와 무관하게 같은 지문을 만든다', () => {
  assert.equal(
    reviewFingerprint(review),
    reviewFingerprint({ ...review, title: '  설치가   어려워요 ', text: '처음 연결하는 방법을  찾기 힘들었습니다. ' }),
  );
});

test('Amazon 접근성 안내문과 토글 문구가 달라도 같은 리뷰 지문을 만든다', () => {
  const clean = { rating: 5, title: 'Just what I wanted!', text: '튼튼하고 만족합니다.' };
  const legacy = {
    ...clean,
    text: 'Brief content visible, double tap to read full content.Full content visible, double tap to read brief content.튼튼하고 만족합니다.Read moreRead less',
  };
  assert.equal(reviewFingerprint(clean), reviewFingerprint(legacy));
  assert.ok(knownReviewFingerprints([{ ...legacy, fingerprint: 'legacy-hash' }]).has(reviewFingerprint(clean)));
});

test('정규화 지문이 같은 저장 리뷰와 분석 배치는 하나로 접는다', () => {
  const first = { fingerprint: 'old', rating: 5, review_title: '좋아요', review_text: '튼튼하고 만족합니다.', first_seen_at: '2026-09-09T00:00:00.000Z' };
  const second = { fingerprint: 'new', rating: 5, review_title: '좋아요', review_text: 'Brief content visible, double tap to read full content.Full content visible, double tap to read brief content.튼튼하고 만족합니다.Read moreRead less', first_seen_at: '2026-09-10T00:00:00.000Z' };
  const reviews = [first, second];
  assert.equal(deduplicateReviews(reviews).length, 1);
  assert.equal(deduplicateAnalyses([
    { product_id: 'p1', created_at: '2026-09-09T00:00:00.000Z', review_fingerprints: ['old'] },
    { product_id: 'p1', created_at: '2026-09-10T00:00:00.000Z', review_fingerprints: ['new'] },
  ], reviews).length, 1);
});

test('이미 저장된 리뷰를 제외하고 이번 수집에서 새로 보인 리뷰만 남긴다', () => {
  const known = new Set([reviewFingerprint(review)]);
  const fresh = { rating: 5, title: '가격 대비 좋아요', text: '배송도 빠르고 품질도 만족합니다.' };
  assert.deepEqual(newReviewsOnly([review, fresh], known), [fresh]);
});

test('분석 배치의 장점·단점·페인 포인트를 빈도순 분포로 집계한다', () => {
  const analyses = [
    { positiveFactors: ['배송'], negativeFactors: ['설명서'], painPoints: ['초기 설정'] },
    { positiveFactors: ['배송', '가격'], negativeFactors: ['설명서'], painPoints: ['초기 설정', '호환성'] },
  ];

  assert.deepEqual(themeDistribution(analyses), {
    positives: [{ label: '배송', value: 2 }, { label: '가격', value: 1 }],
    negatives: [{ label: '설명서', value: 2 }],
    painPoints: [{ label: '초기 설정', value: 2 }, { label: '호환성', value: 1 }],
  });
});

test('일별 스냅샷 키는 태평양 시간 기준 ISO 날짜다', () => {
  assert.equal(trackingDate(new Date('2026-09-07T06:30:00.000Z')), '2026-09-06');
});
