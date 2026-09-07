import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeReviews,
  parseStructuredAnalysis,
} from './analyze.mjs';
import {
  fetchPdpReviews,
  fetchPdpSnapshot,
  normalizeAmazonPdpUrl,
  parseVisibleReviewsHtml,
} from './amazon-reviews.mjs';

const reviews = ['배송은 빨랐지만 설치 방법이 어렵습니다.', '가격 대비 품질이 좋습니다.'];

const productHtml = `
  <html><body>
    <span id="productTitle">Example Product</span>
    <span id="priceblock_ourprice">$19.99</span>
    <span id="acrPopover" title="4.4 out of 5 stars"></span>
    <meta property="og:image" content="https://images.example/product.jpg">
    <div id="cm-cr-dp-review-list">
      <div data-hook="review">
        <i data-hook="review-star-rating"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
        <a data-hook="review-title"><span>배송이 빨라요</span></a>
        <span data-hook="review-body"><span>하루 만에 도착했고 품질도 좋습니다.</span></span>
      </div>
      <div data-hook="review">
        <i data-hook="review-star-rating"><span class="a-icon-alt">2.0 out of 5 stars</span></i>
        <a data-hook="review-title"><span>설치 설명이 부족해요</span></a>
        <span data-hook="review-body"><span>처음 설정에서 오래 걸렸습니다.</span></span>
      </div>
    </div>
  </body></html>`;

test('Amazon PDP URL을 ASIN 기준 URL로 정규화한다', () => {
  assert.deepEqual(normalizeAmazonPdpUrl('https://www.amazon.com/Example/dp/B0FD1TT96X?th=1'), {
    asin: 'B0FD1TT96X',
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
  });
});

test('PDP에 즉시 보이는 상위 리뷰의 제목·본문·별점만 최대 5개 읽는다', () => {
  assert.deepEqual(parseVisibleReviewsHtml(productHtml), {
    title: 'Example Product',
    reviews: [
      { title: '배송이 빨라요', text: '하루 만에 도착했고 품질도 좋습니다.', rating: 5 },
      { title: '설치 설명이 부족해요', text: '처음 설정에서 오래 걸렸습니다.', rating: 2 },
    ],
  });
});

test('같은 PDP HTML에서 카드에 필요한 가격·별점·이미지와 즉시 보이는 리뷰를 함께 읽는다', async () => {
  const product = await fetchPdpSnapshot({
    asin: 'B0FD1TT96X',
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    fetchImpl: async () => new Response(productHtml),
  });
  assert.deepEqual({
    title: product.title,
    displayedPrice: product.displayedPrice,
    rating: product.rating,
    imageUrl: product.imageUrl,
    reviewCount: product.reviews.length,
  }, {
    title: 'Example Product',
    displayedPrice: '$19.99',
    rating: 4.4,
    imageUrl: 'https://images.example/product.jpg',
    reviewCount: 2,
  });
});

test('Amazon 차단 페이지는 리뷰 분석 전에 명시적으로 중단한다', async () => {
  await assert.rejects(fetchPdpReviews({
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    asin: 'B0FD1TT96X',
    fetchImpl: async () => new Response('<html>Robot Check</html>'),
  }), /차단 페이지/);
});

test('상위 리뷰가 없는 PDP 응답은 Amazon 차단 가능성을 함께 안내한다', async () => {
  await assert.rejects(fetchPdpReviews({
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    asin: 'B0FD1TT96X',
    fetchImpl: async () => new Response('<html><span id="productTitle">No reviews</span></html>'),
  }), /차단되었거나/);
});

test('Claude에는 PDP에서 추출된 리뷰 1~5개만 보낸다', async () => {
  await assert.rejects(analyzeReviews({ reviews: [], apiKey: 'test-key' }), /1개 이상/);
  await assert.rejects(analyzeReviews({ reviews: Array.from({ length: 6 }, () => '리뷰'), apiKey: 'test-key' }), /5개 이하/);
});

test('Claude JSON 응답을 5개 표시 항목으로 정규화한다', () => {
  const analysis = parseStructuredAnalysis(`\`\`\`json
  {"summary":"가성비는 좋지만 첫 사용이 어렵습니다.","positiveFactors":["배송이 빠릅니다","가격이 합리적입니다"],"negativeFactors":["설치 안내가 부족합니다"],"painPoints":["초기 설정에서 멈춥니다"],"recommendedFocus":"설치 안내를 첫 화면에 추가하세요."}
  \`\`\``);

  assert.deepEqual(analysis, {
    summary: '가성비는 좋지만 첫 사용이 어렵습니다.',
    positiveFactors: ['배송이 빠릅니다', '가격이 합리적입니다'],
    negativeFactors: ['설치 안내가 부족합니다'],
    painPoints: ['초기 설정에서 멈춥니다'],
    recommendedFocus: '설치 안내를 첫 화면에 추가하세요.',
  });
});

test('Claude 호출은 서버 키를 Authorization 헤더에만 담고 JSON 결과를 반환한다', async () => {
  let request;
  const result = await analyzeReviews({
    reviews,
    apiKey: 'server-only-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"summary":"요약","positiveFactors":["장점"],"negativeFactors":["단점"],"painPoints":["불편"],"recommendedFocus":"개선"}' }],
      }), { status: 200 });
    },
  });

  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.options.headers['x-api-key'], 'server-only-key');
  assert.equal(JSON.parse(request.options.body).messages[0].content.includes('배송은 빨랐지만'), true);
  assert.equal(result.recommendedFocus, '개선');
});
