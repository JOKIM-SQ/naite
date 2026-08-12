import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAmazonUrl, parseProductHtml } from './product-meta.mjs';

const productHtml = `
  <html><head>
    <meta property="og:image" content="https://images.example.test/product.jpg?x=1&amp;y=2">
  </head><body>
    <span id="productTitle">  Ergonomic &amp; Adjustable Chair  </span>
    <div id="corePrice_feature_div">
      <span class="a-price"><span class="a-offscreen">$118.94</span></span>
    </div>
    <div id="wayfinding-breadcrumbs_feature_div">
      <a>Home &amp; Kitchen</a>
      <a>Furniture</a>
      <a>Home Office Furniture</a>
      <a>Home Office Chairs</a>
      <a>Join Prime</a>
      <a>Learn more</a>
      <a>4.1 64</a>
    </div>
  </body></html>`;

test('Amazon URL에서 ASIN과 정규 URL을 만든다', () => {
  assert.deepEqual(
    normalizeAmazonUrl('https://www.amazon.com/Marsail-Ergonomic-Office-Chair/dp/B0CP22DQQS/?th=1'),
    { asin: 'B0CP22DQQS', sourceUrl: 'https://www.amazon.com/dp/B0CP22DQQS' },
  );
});

test('Amazon 상품 HTML에서 표시 필드와 실제 앞 3단 카테고리를 읽는다', () => {
  assert.deepEqual(parseProductHtml(productHtml, 'B0CP22DQQS'), {
    asin: 'B0CP22DQQS',
    title: 'Ergonomic & Adjustable Chair',
    displayedPrice: '$118.94',
    imageUrl: 'https://images.example.test/product.jpg?x=1&y=2',
    tags: [
      { key: 'home-kitchen', label: 'Home & Kitchen', level: 1 },
      { key: 'home-kitchen/furniture', label: 'Furniture', level: 2 },
      { key: 'home-kitchen/furniture/home-office-furniture', label: 'Home Office Furniture', level: 3 },
    ],
  });
});

test('카테고리 breadcrumb가 없거나 2단이면 실제 개수만 태그로 만든다', () => {
  const withoutCategories = productHtml.replace(/<div id="wayfinding-breadcrumbs_feature_div">[\s\S]*?<\/div>/, '');
  assert.deepEqual(parseProductHtml(withoutCategories, 'B0FQFNRH72').tags, []);

  const twoCategories = productHtml.replace(/<a>Home Office Furniture<\/a>[\s\S]*?<a>4\.1 64<\/a>/, '');
  assert.deepEqual(parseProductHtml(twoCategories, 'B0GHRHXVN1').tags, [
    { key: 'home-kitchen', label: 'Home & Kitchen', level: 1 },
    { key: 'home-kitchen/furniture', label: 'Furniture', level: 2 },
  ]);
});

test('Amazon 주소나 상품 제목이 없으면 입력을 거절한다', () => {
  assert.throws(() => normalizeAmazonUrl('https://example.com/dp/B0CP22DQQS'));
  assert.throws(() => parseProductHtml('<html></html>', 'B0CP22DQQS'));
});
