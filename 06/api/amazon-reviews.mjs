import { load } from 'cheerio';

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i;
const ASIN = /^[a-z0-9]{10}$/i;
const BLOCKED = /robot check|enter the characters you see below|automated access|captcha|click the button below to continue shopping/i;
const MAX_VISIBLE_REVIEWS = 5;

const text = ($, selector) => $(selector).first().text().replace(/\s+/g, ' ').trim() || null;
const nodeText = (node, selector) => node.find(selector).first().text().replace(/\s+/g, ' ').trim() || null;

export function normalizeAmazonPdpUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('유효한 Amazon PDP URL을 입력하세요.'); }
  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?]|$)/i);
  if (url.protocol !== 'https:' || !AMAZON_HOST.test(url.hostname) || !match) {
    throw new Error('Amazon PDP URL에서 ASIN을 찾지 못했습니다.');
  }
  const asin = match[1].toUpperCase();
  return { asin, sourceUrl: `https://${url.hostname}/dp/${asin}` };
}

export function parseVisibleReviewsHtml(html) {
  const $ = load(html);
  const reviews = $('#cm-cr-dp-review-list [data-hook="review"], #customerReviews [data-hook="review"]')
    .map((_, node) => {
      const review = $(node);
      const title = nodeText(review, '[data-hook="review-title"]');
      const body = nodeText(review, '[data-hook="review-body"]');
      const ratingText = nodeText(review, '[data-hook="review-star-rating"] .a-icon-alt')
        || nodeText(review, '[data-hook="cmps-review-star-rating"] .a-icon-alt');
      const rating = Number.parseFloat(String(ratingText || '').match(/\d(?:\.\d)?/)?.[0]);
      if (!body) return null;
      return { title: title || '제목 없음', text: body, rating: Number.isFinite(rating) ? rating : null };
    })
    .get()
    .filter(Boolean)
    .slice(0, MAX_VISIBLE_REVIEWS);

  return { title: text($, '#productTitle'), reviews };
}

export async function fetchPdpReviews({ sourceUrl, asin, fetchImpl = fetch }) {
  const response = await fetchImpl(sourceUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; review-radar/1.0)',
    },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);
  const html = await response.text();
  if (BLOCKED.test(html)) throw new Error('Amazon 차단 페이지가 반환되었습니다. 다른 PDP URL로 다시 시도하세요.');

  const parsed = parseVisibleReviewsHtml(html);
  if (!parsed.reviews.length) throw new Error('이 PDP에서 즉시 노출된 리뷰를 읽지 못했습니다. Amazon이 차단되었거나 리뷰가 표시되지 않은 상품일 수 있습니다.');
  return { asin, sourceUrl, ...parsed };
}
