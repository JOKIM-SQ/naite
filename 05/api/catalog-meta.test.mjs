import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchCatalogSnapshot,
  normalizeAmazonInput,
  parseCatalogHtml,
} from './catalog-meta.mjs';

const partialHtml = `
  <html><head><meta property="og:image" content="https://images.example.test/case.jpg"></head><body>
    <span id="productTitle">Spigen Ultra Hybrid</span>
    <span class="a-offscreen">$14.99</span>
  </body></html>`;

const completeHtml = `
  <html><head><meta property="og:image" content="https://images.example.test/case.jpg"></head><body>
    <span id="productTitle">Spigen for iPhone 17 Pro Max Case - Clear</span>
    <a id="bylineInfo">Visit the Spigen Store</a>
    <div id="wayfinding-breadcrumbs_feature_div">Cell Phones &amp; Accessories › Cell Phone Cases</div>
    <span class="a-offscreen">$14.99</span>
    <div id="inline-twister-expanded-dimension-text-color_name">Clear</div>
    <div id="inline-twister-expanded-dimension-text-size_name">iPhone 17 Pro Max</div>
    <div id="inline-twister-row-color_name"><ul>
      <li data-asin="B0FD1TT96X" data-initiallyselected="true" data-initiallyunavailable="false"><img alt="Clear"></li>
      <li data-asin="B0FR85ZZVF" data-initiallyselected="false" data-initiallyunavailable="false"><img alt="Clear Deep Blue"></li>
      <li data-asin="B0C5S8TS2Z" data-initiallyselected="false" data-initiallyunavailable="true"><img alt="Carbon Fiber"></li>
    </ul></div>
    <div id="inline-twister-row-size_name"><ul>
      <li data-asin="B0FD1TT96X" data-initiallyselected="true" data-initiallyunavailable="false">iPhone 17 Pro Max</li>
      <li data-asin="B0FD28CZDK" data-initiallyselected="false" data-initiallyunavailable="false">iPhone 17 Pro</li>
      <li data-asin="B0C5S75FY3" data-initiallyselected="false" data-initiallyunavailable="true">iPhone 15 Pro Max</li>
    </ul></div>
  </body></html>`;

test('Amazon URL과 원시 ASIN을 정규 URL로 바꾼다', () => {
  assert.deepEqual(normalizeAmazonInput('B0FD1TT96X'), {
    asin: 'B0FD1TT96X', sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
  });
  assert.deepEqual(normalizeAmazonInput('https://www.amazon.com/Spigen/dp/B0FD1TT96X?th=1'), {
    asin: 'B0FD1TT96X', sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
  });
  assert.throws(() => normalizeAmazonInput('B0FD1'), /ASIN/);
});

test('inline twister에서 현재 조합과 판매 가능한 색상·기기 파생 ASIN만 읽는다', () => {
  const snapshot = parseCatalogHtml(completeHtml, 'B0FD1TT96X');
  assert.equal(snapshot.title, 'Spigen for iPhone 17 Pro Max Case - Clear');
  assert.equal(snapshot.brand, 'Visit the Spigen Store');
  assert.equal(snapshot.categoryText, 'Cell Phones & Accessories › Cell Phone Cases');
  assert.equal(snapshot.currentColor, 'Clear');
  assert.equal(snapshot.currentDevice, 'iPhone 17 Pro Max');
  assert.deepEqual(snapshot.colorVariants, [
    { asin: 'B0FD1TT96X', label: 'Clear', selected: true },
    { asin: 'B0FR85ZZVF', label: 'Clear Deep Blue', selected: false },
  ]);
  assert.deepEqual(snapshot.deviceVariants, [
    { asin: 'B0FD1TT96X', label: 'iPhone 17 Pro Max', selected: true },
    { asin: 'B0FD28CZDK', label: 'iPhone 17 Pro', selected: false },
  ]);
});

test('여러 fetch 응답을 병합해 모든 필수 정보가 채워질 때까지 재시도한다', async () => {
  const responses = [partialHtml, completeHtml];
  const result = await fetchCatalogSnapshot({
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    asin: 'B0FD1TT96X',
    fetchImpl: async () => new Response(responses.shift()),
    maxAttempts: 3,
    delayMs: 0,
  });

  assert.equal(result.complete, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.snapshot.imageUrl, 'https://images.example.test/case.jpg');
  assert.equal(result.snapshot.currentColor, 'Clear');
  assert.equal(result.snapshot.deviceVariants.length, 2);
});
