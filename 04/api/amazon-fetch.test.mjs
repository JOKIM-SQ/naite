import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchAmazonProductInfo, fetchCompleteAmazonProduct } from './amazon-fetch.mjs';

const partialHtml = `
  <html><body>
    <span id="productTitle">Retry Caramel</span>
    <div id="corePrice_feature_div"><span class="a-offscreen">$12.34</span></div>
  </body></html>`;

const completeHtml = `
  <html><head><meta property="og:image" content="https://images.example.test/retry.jpg"></head><body>
    <span id="productTitle">Retry Caramel</span>
    <div id="corePrice_feature_div"><span class="a-offscreen">$12.34</span></div>
    <span data-hook="rating-out-of-text">4.8 out of 5 stars</span>
    <div id="wayfinding-breadcrumbs_feature_div"><a>Grocery</a><a>Candy</a></div>
  </body></html>`;

test('부분 응답을 누적하고 정보가 완성될 때까지 재시도한다', async () => {
  const replies = [partialHtml, completeHtml];
  const result = await fetchCompleteAmazonProduct({
    sourceUrl: 'https://www.amazon.com/dp/0553277839',
    asin: '0553277839',
    delayMs: 0,
    fetchImpl: async () => new Response(replies.shift()),
  });

  assert.equal(result.attempts, 2);
  assert.equal(result.product.displayedPrice, '$12.34');
  assert.equal(result.product.rating, 4.8);
  assert.equal(result.product.imageUrl, 'https://images.example.test/retry.jpg');
  assert.deepEqual(result.product.tags.map((tag) => tag.label), ['Grocery', 'Candy']);
});

test('완성되지 않은 Amazon 정보도 최대 50회 후 부분 결과로 돌려준다', async () => {
  let attempts = 0;
  const result = await fetchAmazonProductInfo({
    sourceUrl: 'https://www.amazon.com/dp/0553277839',
    asin: '0553277839',
    delayMs: 0,
    fetchImpl: async () => { attempts += 1; return new Response(partialHtml); },
  });
  assert.equal(attempts, 50);
  assert.equal(result.complete, false);
  assert.equal(result.product.title, 'Retry Caramel');
  assert.equal(result.product.displayedPrice, '$12.34');
  assert.deepEqual(result.missing, ['별점', '이미지', '카테고리']);
});

test('엄격한 조회는 부분 결과를 사용자에게 넘기지 않는다', async () => {
  await assert.rejects(
    () => fetchCompleteAmazonProduct({
      sourceUrl: 'https://www.amazon.com/dp/0553277839', asin: '0553277839', delayMs: 0,
      fetchImpl: async () => new Response(partialHtml),
    }),
    /50회/,
  );
});
