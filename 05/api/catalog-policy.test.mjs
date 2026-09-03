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
