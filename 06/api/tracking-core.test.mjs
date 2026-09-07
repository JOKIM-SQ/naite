import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
