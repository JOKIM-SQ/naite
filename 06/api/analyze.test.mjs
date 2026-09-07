import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeReviews,
  parseReviewInput,
  parseStructuredAnalysis,
} from './analyze.mjs';

const reviews = Array.from({ length: 10 }, (_, index) => `리뷰 ${index + 1}: 배송은 빨랐지만 설치 방법이 어렵습니다.`);

test('줄 단위 리뷰를 정리하고 빈 줄은 제외한다', () => {
  assert.deepEqual(parseReviewInput('\n첫 리뷰\n\n 둘째 리뷰 \n'), ['첫 리뷰', '둘째 리뷰']);
});

test('리뷰는 10개 이상 20개 이하로 제한한다', async () => {
  await assert.rejects(analyzeReviews({ reviews: reviews.slice(0, 9), apiKey: 'test-key' }), /10개 이상/);
  await assert.rejects(analyzeReviews({ reviews: [...reviews, ...reviews, '추가 리뷰'], apiKey: 'test-key' }), /20개 이하/);
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
  assert.equal(JSON.parse(request.options.body).messages[0].content.includes('리뷰 1'), true);
  assert.equal(result.recommendedFocus, '개선');
});
