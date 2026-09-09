import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchBrowserbasePdpSnapshot,
  normalizeRenderedPdpSnapshot,
} from '../lib/browserbase-reviews.mjs';

const renderedPdp = {
  title: 'Ultra Hybrid MagFit',
  displayedPrice: '$29.99',
  rating: 4.6,
  imageUrl: 'https://images.example/product.jpg',
  reviews: [
    { title: '튼튼하고 깔끔해요', text: '자석이 잘 붙고 보호력도 좋습니다.', rating: 5 },
    { title: '버튼이 단단해요', text: '처음에는 버튼이 조금 뻑뻑합니다.', rating: 3 },
  ],
};

test('렌더링된 PDP 데이터에서 카드와 Claude 분석에 필요한 상위 리뷰를 정규화한다', () => {
  const snapshot = normalizeRenderedPdpSnapshot({
    asin: 'B0FD1TT96X',
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    rendered: { ...renderedPdp, reviews: [...renderedPdp.reviews,
      { title: '여분 1', text: '여분 리뷰 1', rating: 4 },
      { title: '여분 2', text: '여분 리뷰 2', rating: 4 },
      { title: '여분 3', text: '여분 리뷰 3', rating: 4 },
      { title: '여분 4', text: '여분 리뷰 4', rating: 4 },
    ] },
  });
  assert.deepEqual({ ...snapshot, reviews: snapshot.reviews.slice(0, 2) }, {
    asin: 'B0FD1TT96X',
    sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    ...renderedPdp,
  });
  assert.equal(snapshot.reviews.length, 5);
  assert.equal(normalizeRenderedPdpSnapshot({
    asin: 'B0FD1TT96X', sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X', rendered: { rating: null, reviews: [] },
  }).rating, null);
});

test('Browserbase 기본 페이지에서 렌더링 완료 뒤 Amazon 리뷰를 읽고 세션을 닫는다', async () => {
  const events = [];
  const page = {
    async goto(url, options) { events.push(['goto', url, options.waitUntil]); },
    async waitForSelector(selector, options) { events.push(['wait', selector, options.timeout]); },
    async evaluate() { events.push(['evaluate']); return renderedPdp; },
    async close() { events.push(['page.close']); },
  };
  const browser = {
    contexts: () => [{ pages: () => [page] }],
    async close() { events.push(['browser.close']); },
  };
  const browserbaseClient = { sessions: { create: async (config) => {
    events.push(['session.create', config.projectId]);
    return { connectUrl: 'wss://browserbase.example/session' };
  } } };
  const chromium = { connectOverCDP: async (url) => {
    events.push(['connect', url]);
    return browser;
  } };

  const snapshot = await fetchBrowserbasePdpSnapshot({
    asin: 'B0FD1TT96X', sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X',
    browserbaseClient, chromium, projectId: 'bb-project',
  });

  assert.equal(snapshot.reviews.length, 2);
  assert.deepEqual(events, [
    ['session.create', 'bb-project'],
    ['connect', 'wss://browserbase.example/session'],
    ['goto', 'https://www.amazon.com/dp/B0FD1TT96X', 'domcontentloaded'],
    ['wait', '[data-hook="review"]', 15000],
    ['evaluate'],
    ['page.close'],
    ['browser.close'],
  ]);
});

test('렌더링 뒤 공개 리뷰가 없으면 명시적인 수집 실패를 반환한다', async () => {
  await assert.rejects(fetchBrowserbasePdpSnapshot({
    asin: 'B0FD1TT96X', sourceUrl: 'https://www.amazon.com/dp/B0FD1TT96X', projectId: 'bb-project',
    browserbaseClient: { sessions: { create: async () => ({ connectUrl: 'wss://browserbase.example/session' }) } },
    chromium: { connectOverCDP: async () => ({
      contexts: () => [{ pages: () => [{
        goto: async () => {}, waitForSelector: async () => {}, evaluate: async () => ({ ...renderedPdp, reviews: [] }), close: async () => {},
      }] }],
      close: async () => {},
    }) },
  }), /렌더링된 Amazon PDP에서 공개 리뷰를 읽지 못했습니다/);
});
