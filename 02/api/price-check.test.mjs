import assert from 'node:assert/strict';
import test from 'node:test';

import { priceCents, priceDirection } from './price-check.mjs';

test('Amazon 표시 가격을 비교 가능한 센트 정수로 바꾼다', () => {
  assert.equal(priceCents('$219.00'), 21900);
  assert.equal(priceCents('$1,024.50'), 102450);
  assert.equal(priceCents('가격 없음'), null);
});

test('직전 가격과 비교해 상승·하락·동일 상태를 구분한다', () => {
  assert.equal(priceDirection(null, 21900), 0);
  assert.equal(priceDirection(21900, 21900), 0);
  assert.equal(priceDirection(21900, 22900), 1);
  assert.equal(priceDirection(21900, 20900), -1);
});
