import test from 'node:test';
import assert from 'node:assert/strict';
import { isAmazonAccessBlocked, parseProductHtml } from './_product-meta.mjs';

test('S06 내부 메타데이터 파서는 PDP의 카드 핵심 필드를 읽는다', () => {
  const product = parseProductHtml(`
    <h1 id="productTitle">  Rugged Case  </h1>
    <div id="corePrice_feature_div"><span class="a-offscreen">$19.99</span></div>
    <meta property="og:image" content="https://images.example/case.jpg">
    <span data-hook="rating-out-of-text">4.6 out of 5 stars</span>
  `, 'B012345678');

  assert.deepEqual(product, {
    asin: 'B012345678', title: 'Rugged Case', displayedPrice: '$19.99', rating: 4.6,
    imageUrl: 'https://images.example/case.jpg', tags: [],
  });
});

test('S06 내부 메타데이터 파서는 Amazon 차단 문구를 감지한다', () => {
  assert.equal(isAmazonAccessBlocked('Robot Check: enter the characters you see below'), true);
});
