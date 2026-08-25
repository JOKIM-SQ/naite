import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAmazonUrl, parseProductHtml } from './product-meta.mjs';

const productHtml = `
  <html><head><meta property="og:image" content="https://images.example.test/product.jpg"></head><body>
    <span id="productTitle">  Caramel &amp; Sea Salt Book  </span>
    <div id="corePrice_feature_div"><span class="a-offscreen">$24.50</span></div>
    <span data-hook="rating-out-of-text">4.6 out of 5 stars</span>
    <div id="wayfinding-breadcrumbs_feature_div">
      <a>Books</a><a>Cooking</a><a>Desserts</a><a>Learn more</a>
    </div>
  </body></html>`;

test('Amazon URL에서 ASIN과 정규 URL을 만든다', () => {
  assert.deepEqual(
    normalizeAmazonUrl('https://www.amazon.com/Caramel-Book/dp/0553277839?tag=tracking'),
    { asin: '0553277839', sourceUrl: 'https://www.amazon.com/dp/0553277839' },
  );
});

test('Cheerio로 Amazon HTML에서 가격·별점·이미지·카테고리를 읽는다', () => {
  assert.deepEqual(parseProductHtml(productHtml, '0553277839'), {
    asin: '0553277839',
    title: 'Caramel & Sea Salt Book',
    displayedPrice: '$24.50',
    rating: 4.6,
    imageUrl: 'https://images.example.test/product.jpg',
    tags: [
      { key: 'books', label: 'Books', level: 1 },
      { key: 'books/cooking', label: 'Cooking', level: 2 },
      { key: 'books/cooking/desserts', label: 'Desserts', level: 3 },
    ],
  });
});
