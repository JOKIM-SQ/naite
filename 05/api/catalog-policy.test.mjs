import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCatalogEligible } from './catalog-policy.mjs';

test('Spigen 휴대폰 케이스만 아카이브에 허용한다', () => {
  assert.doesNotThrow(() => assertCatalogEligible({
    brand: 'Visit the Spigen Store',
    title: 'Ultra Hybrid MagFit Case',
    currentDevice: 'iPhone 17 Pro Max',
    categoryText: 'Cell Phones & Accessories › Cell Phone Cases',
  }));
  assert.throws(() => assertCatalogEligible({ brand: 'OtterBox', title: 'iPhone 17 Pro Max Case', currentDevice: 'iPhone 17 Pro Max' }), /Spigen/);
  assert.throws(() => assertCatalogEligible({ brand: 'Spigen', title: 'USB-C Charger', currentDevice: 'Universal' }), /휴대폰 케이스/);
});

test('Amazon breadcrumb가 Cases, Holsters & Sleeves이면 Nothing Phone 케이스를 허용한다', () => {
  assert.doesNotThrow(() => assertCatalogEligible({
    brand: 'Visit the Spigen Store',
    title: 'Spigen Liquid Crystal for Nothing Phone (3), Anti-Yellowing',
    currentDevice: 'Nothing Phone (3)',
    categoryText: 'Cell Phones & Accessories › Cases, Holsters & Sleeves › Basic Cases',
  }));
});

test('상품명에 Case가 있어도 Amazon breadcrumb가 스마트폰 케이스가 아니면 거부한다', () => {
  assert.throws(() => assertCatalogEligible({
    brand: 'Visit the Spigen Store',
    title: 'Spigen Case Organizer for Phone Accessories',
    currentDevice: 'Nothing Phone (3)',
    categoryText: 'Office Products › Desk Accessories',
  }), /휴대폰 케이스/);
});
