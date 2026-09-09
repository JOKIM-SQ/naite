import { load } from 'cheerio';
import { isAmazonAccessBlocked, parseProductHtml } from './_product-meta.mjs';

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i;
const ASIN = /^[a-z0-9]{10}$/i;
const BLOCKED = /robot check|enter the characters you see below|automated access|captcha|click the button below to continue shopping/i;
const MAX_VISIBLE_REVIEWS = 5;
export const MAX_REVIEW_COLLECTION_ATTEMPTS = 50;

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
  const reviews = $('#cm-cr-dp-review-list [data-hook="review"], #customerReviews [data-hook="review"], #cm_cr-review_list [data-hook="review"]')
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

export function parsePdpSnapshotHtml(html, asin) {
  const metadata = parseProductHtml(html, asin);
  const visible = parseVisibleReviewsHtml(html);
  const $ = load(html);
  const legacyPrice = $('#priceblock_ourprice, #priceblock_dealprice, #priceblock_saleprice').first().text().replace(/\s+/g, ' ').trim() || null;
  return {
    asin,
    title: metadata.title || visible.title,
    displayedPrice: metadata.displayedPrice || legacyPrice,
    rating: metadata.rating,
    imageUrl: metadata.imageUrl,
    reviews: visible.reviews,
  };
}

export function reviewCollectionUrls({ sourceUrl, asin, maxAttempts = MAX_REVIEW_COLLECTION_ATTEMPTS }) {
  const attempts = Math.max(1, Math.min(MAX_REVIEW_COLLECTION_ATTEMPTS, Number(maxAttempts) || MAX_REVIEW_COLLECTION_ATTEMPTS));
  const urls = [sourceUrl];
  for (let pageNumber = 1; urls.length < attempts; pageNumber += 1) {
    const url = new URL(`/product-reviews/${asin}`, sourceUrl);
    url.searchParams.set('ie', 'UTF8');
    url.searchParams.set('reviewerType', 'all_reviews');
    url.searchParams.set('filterByStar', 'all_stars');
    url.searchParams.set('pageNumber', String(pageNumber));
    urls.push(url.toString());
  }
  return urls;
}

function mergeSnapshot(previous, current) {
  if (!previous) return current;
  return {
    asin: current.asin,
    title: previous.title || current.title,
    displayedPrice: previous.displayedPrice || current.displayedPrice,
    rating: previous.rating ?? current.rating,
    imageUrl: previous.imageUrl || current.imageUrl,
    reviews: current.reviews.length ? current.reviews : previous.reviews,
  };
}

async function fetchAmazonHtml(url, fetchImpl) {
  const response = await fetchImpl(url, {
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
  if (BLOCKED.test(html) || isAmazonAccessBlocked(html)) throw new Error('Amazon 차단 페이지가 반환되었습니다. 다른 PDP URL로 다시 시도하세요.');
  return html;
}

export async function fetchPdpSnapshot({ sourceUrl, asin, maxAttempts = MAX_REVIEW_COLLECTION_ATTEMPTS, fetchImpl = fetch }) {
  const urls = reviewCollectionUrls({ sourceUrl, asin, maxAttempts });
  let snapshot = null;
  let lastFailure = null;
  for (const url of urls) {
    try {
      const html = await fetchAmazonHtml(url, fetchImpl);
      const parsed = parsePdpSnapshotHtml(html, asin);
      snapshot = mergeSnapshot(snapshot, parsed);
      if (parsed.reviews.length) return { asin, sourceUrl, ...snapshot, reviews: parsed.reviews };
    } catch (error) {
      if (/차단 페이지/.test(error.message)) throw error;
      lastFailure = error;
    }
  }
  const detail = lastFailure ? ` 마지막 응답: ${lastFailure.message}` : '';
  throw new Error(`Amazon PDP와 리뷰 목록을 ${urls.length}회 확인했지만 공개 리뷰를 읽지 못했습니다. Amazon이 차단했거나 리뷰가 표시되지 않은 상품일 수 있습니다.${detail}`);
}

export async function fetchPdpReviews(options) {
  const snapshot = await fetchPdpSnapshot(options);
  return { asin: snapshot.asin, sourceUrl: snapshot.sourceUrl, title: snapshot.title, reviews: snapshot.reviews };
}
