import { Browserbase } from '@browserbasehq/sdk';
import { chromium as playwrightChromium } from 'playwright-core';

import { fetchPdpSnapshot } from '../api/amazon-reviews.mjs';

const MAX_VISIBLE_REVIEWS = 5;

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim() || null;
const ratingFrom = (value) => {
  const match = String(value || '').match(/\d(?:\.\d)?/);
  return match ? Number(match[0]) : null;
};

export function normalizeRenderedPdpSnapshot({ asin, sourceUrl, rendered }) {
  const renderedRating = Number(rendered?.rating);
  const reviews = (Array.isArray(rendered?.reviews) ? rendered.reviews : [])
    .map((review) => {
      const text = clean(review?.text);
      if (!text) return null;
      const rating = Number(review?.rating);
      return {
        title: clean(review?.title) || '제목 없음',
        text,
        rating: Number.isFinite(rating) ? rating : null,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_VISIBLE_REVIEWS);

  return {
    asin,
    sourceUrl,
    title: clean(rendered?.title),
    displayedPrice: clean(rendered?.displayedPrice),
    rating: rendered?.rating == null || rendered.rating === '' || !Number.isFinite(renderedRating) ? null : renderedRating,
    imageUrl: clean(rendered?.imageUrl),
    reviews,
  };
}

function renderedPdpFromDocument() {
  const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const selectText = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = cleanText(node?.textContent);
      if (value) return value;
    }
    return '';
  };
  const ratingFrom = (value) => {
    const match = String(value || '').match(/\d(?:\.\d)?/);
    return match ? Number(match[0]) : null;
  };
  const reviewCards = [...document.querySelectorAll('[data-hook="review"]')];

  return {
    title: selectText(document, ['#productTitle']),
    displayedPrice: selectText(document, [
      '#corePrice_feature_div .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
    ]),
    rating: ratingFrom(document.querySelector('#acrPopover')?.getAttribute('title') || selectText(document, ['#acrCustomerReviewText'])),
    imageUrl: document.querySelector('#landingImage')?.getAttribute('src')
      || document.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || '',
    reviews: reviewCards.map((card) => {
      const title = selectText(card, [
        '[data-hook="review-title"]',
        '[data-hook="reviewTitle"]',
        '.review-title-content',
        '[class*="review-title"]',
      ]);
      const body = selectText(card, [
        '[data-hook="review-body"]',
        '[data-hook="reviewText"]',
        '.review-text-content',
        '[class*="review-text"]',
        '[data-hook="genome-widget"] [data-hook="review-body"]',
      ]);
      const rating = ratingFrom(selectText(card, [
        '[data-hook="review-star-rating"] .a-icon-alt',
        '[data-hook="cmps-review-star-rating"] .a-icon-alt',
        '.a-icon-alt',
      ]));
      return { title, text: body, rating };
    }),
  };
}

function revealPdpReviews() {
  const reviewLink = [...document.querySelectorAll('a[href]')]
    .find((node) => /#(?:customerReviews|reviewsMedley)/.test(node.getAttribute('href') || ''));
  const reviewSection = document.querySelector('#customerReviews, #reviewsMedley, #cm-cr-dp-review-list');

  if (reviewLink) reviewLink.click();
  if (reviewSection) {
    reviewSection.scrollIntoView({ block: 'center' });
    return;
  }

  const scrollingElement = document.scrollingElement || document.documentElement;
  scrollingElement.scrollTo({ top: Math.floor(scrollingElement.scrollHeight * 0.72), behavior: 'instant' });
}

export async function fetchBrowserbasePdpSnapshot({
  sourceUrl,
  asin,
  projectId,
  browserbaseClient,
  chromium = playwrightChromium,
}) {
  if (!projectId) throw new Error('BROWSERBASE_PROJECT_ID 환경변수가 없습니다.');
  if (!browserbaseClient?.sessions?.create) throw new Error('Browserbase 세션을 시작할 수 없습니다.');

  let browser;
  let page;
  try {
    const session = await browserbaseClient.sessions.create({ projectId });
    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    page = context?.pages()[0];
    if (!page) throw new Error('Browserbase 기본 페이지를 찾지 못했습니다.');
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Amazon은 일부 PDP에서 리뷰 원문을 스크롤한 뒤에야 DOM에 렌더링한다.
    await page.evaluate(revealPdpReviews);
    await page.waitForTimeout(1200);
    try {
      await page.waitForSelector('[data-hook="review"]', { timeout: 15000 });
    } catch {
      // Amazon이 리뷰 영역을 늦게 표시하거나 차단 페이지를 렌더링할 수 있으므로 아래 DOM 검사를 계속한다.
    }
    const snapshot = normalizeRenderedPdpSnapshot({
      asin,
      sourceUrl,
      rendered: await page.evaluate(renderedPdpFromDocument),
    });
    if (!snapshot.reviews.length) {
      throw new Error('렌더링된 Amazon PDP에서 공개 리뷰를 읽지 못했습니다. Amazon 차단 페이지이거나 표시 가능한 리뷰가 없을 수 있습니다.');
    }
    return snapshot;
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

export async function fetchPdpSnapshotWithBrowserbase({
  sourceUrl,
  asin,
  apiKey = process.env.BROWSERBASE_API_KEY,
  projectId = process.env.BROWSERBASE_PROJECT_ID,
  fetchImpl = fetch,
}) {
  if (!apiKey || !projectId) return fetchPdpSnapshot({ sourceUrl, asin, fetchImpl });
  return fetchBrowserbasePdpSnapshot({
    sourceUrl,
    asin,
    projectId,
    browserbaseClient: new Browserbase({ apiKey }),
  });
}

export async function fetchPdpReviewsWithBrowserbase(options) {
  const snapshot = await fetchPdpSnapshotWithBrowserbase(options);
  return { asin: snapshot.asin, sourceUrl: snapshot.sourceUrl, title: snapshot.title, reviews: snapshot.reviews };
}
