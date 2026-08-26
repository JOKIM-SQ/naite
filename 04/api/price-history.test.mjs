import assert from 'node:assert/strict';
import test from 'node:test';

import { filterHistory, priceCents, priceDirection, ratingDirection, summarizeHistory } from './price-history.mjs';

const history = [
  { checkedAt: '2026-08-01T13:00:00.000Z', priceCents: 2450 },
  { checkedAt: '2026-08-07T13:00:00.000Z', priceCents: 2299 },
  { checkedAt: '2026-08-20T13:00:00.000Z', priceCents: 2399 },
];

test('표시 가격을 비교 가능한 센트 정수로 바꾼다', () => {
  assert.equal(priceCents('$24.50'), 2450);
  assert.equal(priceCents('$1,024'), 102400);
  assert.equal(priceCents('가격 없음'), null);
});

test('가격 이력의 최저·최고·현재·평균을 계산한다', () => {
  assert.deepEqual(summarizeHistory(history), { lowest: 2299, highest: 2450, current: 2399, average: 2383 });
  assert.equal(priceDirection(2450, 2299), -1);
});

test('별점 변화도 상승·동일·하락으로 계산한다', () => {
  assert.equal(ratingDirection(4.3, 4.5), 1);
  assert.equal(ratingDirection(4.5, 4.5), 0);
  assert.equal(ratingDirection(4.8, 4.6), -1);
  assert.equal(ratingDirection(null, 4.6), 0);
});

test('선택 기간보다 오래된 가격 이력은 그래프에서 뺀다', () => {
  assert.deepEqual(filterHistory(history, '1m', new Date('2026-08-25T00:00:00.000Z')).map((entry) => entry.priceCents), [2450, 2299, 2399]);
  assert.deepEqual(filterHistory(history, 'all', new Date('2026-08-25T00:00:00.000Z')).map((entry) => entry.priceCents), [2450, 2299, 2399]);
});
