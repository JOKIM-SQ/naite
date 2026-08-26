import { load } from 'cheerio';

const isAmazonHost = (host) => /(^|\.)amazon\.[a-z.]+$/i.test(host);

const categoryKey = (labels) => labels
  .map((label) => label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  .join('/');

export const isAmazonAccessBlocked = (html = '') => /robot check|enter the characters you see below|automated access|captcha/i.test(html);

export function normalizeAmazonUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('유효한 Amazon 상품 URL이 아닙니다.'); }
  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?]|$)/i);
  if (url.protocol !== 'https:' || !isAmazonHost(url.hostname) || !match) {
    throw new Error('Amazon 상품 URL에서 ASIN을 찾지 못했습니다.');
  }
  const asin = match[1].toUpperCase();
  return { asin, sourceUrl: `https://${url.hostname}/dp/${asin}` };
}

export function parseProductHtml(html, asin) {
  const $ = load(html);
  const title = $('#productTitle').first().text().replace(/\s+/g, ' ').trim() || null;
  const displayedPrice = $('#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, .priceToPay .a-offscreen')
    .map((_, element) => $(element).text().trim()).get().find(Boolean) || null;
  const imageUrl = $('meta[property="og:image"]').attr('content')
    || $('#landingImage').attr('data-old-hires') || $('#landingImage').attr('src') || null;
  const ratingText = $('[data-hook="rating-out-of-text"]').first().text()
    || $('#acrPopover').attr('title') || $('.a-icon-alt').first().text();
  const rating = Number.parseFloat(String(ratingText || '').match(/\d(?:\.\d)?/)?.[0]);
  const categories = $('#wayfinding-breadcrumbs_feature_div a').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get()
    .filter((label) => label && !/^(join prime|learn more|see more|shop now)$/i.test(label));
  const labels = [...new Set(categories)].slice(0, 3);
  const tags = labels.map((label, index) => ({ key: categoryKey(labels.slice(0, index + 1)), label, level: index + 1 }));
  return { asin, title, displayedPrice, rating: Number.isFinite(rating) ? rating : null, imageUrl, tags };
}
