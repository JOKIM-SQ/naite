import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCatalogEligible } from './catalog-policy.mjs';

test('Spigen 휴대폰 케이스만 아카이브에 허용한다', () => {
  assert.doesNotThrow(() => assertCatalogEligible({
    brand: 'Visit the Spigen Store',
    title: 'Ultra Hybrid MagFit Case',
    currentDevice: 'iPhone 17 Pro Max',
    categoryText: 'Cell Phone Cases',
  }));
  assert.throws(() => assertCatalogEligible({ brand: 'OtterBox', title: 'iPhone 17 Pro Max Case', currentDevice: 'iPhone 17 Pro Max' }), /Spigen/);
  assert.throws(() => assertCatalogEligible({ brand: 'Spigen', title: 'USB-C Charger', currentDevice: 'Universal' }), /휴대폰 케이스/);
});

test('Spigen 케이스 라인명만 표기된 Nothing Phone 케이스도 허용한다', () => {
  assert.doesNotThrow(() => assertCatalogEligible({
    brand: 'Visit the Spigen Store',
    title: 'Spigen Ultra Hybrid for Nothing Phone (3), Anti-Yellowing',
    currentDevice: 'Nothing Phone (3)',
    categoryText: 'Cell Phones & Accessories',
  }));
});
