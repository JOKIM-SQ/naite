const decode = (value = '') => value
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/&#([0-9]+);/g, (_, value) => String.fromCodePoint(Number(value)))
  .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)));

const text = (value = '') => decode(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());

const attribute = (tag, name) => tag?.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? null;

const findTag = (html, predicate) => [...html.matchAll(/<(?:meta|img)\b[^>]*>/gi)]
  .map((match) => match[0])
  .find(predicate) ?? null;

const categoryKey = (labels) => labels
  .map((label) => label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  .join('/');

const isAmazonHost = (host) => /(^|\.)amazon\.[a-z.]+$/i.test(host);

export const isAmazonAccessBlocked = (html = '') => /robot check|enter the characters you see below|automated access|captcha/i.test(html);

export function normalizeAmazonUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('유효한 Amazon 상품 URL이 아니다.');
  }

  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?]|$)/i);
  if (url.protocol !== 'https:' || !isAmazonHost(url.hostname) || !match) {
    throw new Error('Amazon 상품 URL에서 ASIN을 찾지 못했다.');
  }

  const asin = match[1].toUpperCase();
  return { asin, sourceUrl: `https://${url.hostname}/dp/${asin}` };
}

export function parseProductHtml(html, asin) {
  const titleHtml = html.match(/<span[^>]*\bid=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
  const title = titleHtml ? text(titleHtml) : null;
  if (!title) throw new Error('상품 제목을 찾지 못했다.');

  const ogImage = findTag(html, (tag) => /\bproperty=["']og:image["']/i.test(tag));
  const landingImage = findTag(html, (tag) => /\bid=["']landingImage["']/i.test(tag));
  const imageUrl = decode(attribute(ogImage, 'content')
    ?? attribute(landingImage, 'data-old-hires')
    ?? attribute(landingImage, 'src')
    ?? '');

  const priceStart = html.search(/\bid=["'](?:corePrice_feature_div|corePriceDisplay_desktop_feature_div)["']/i);
  const priceHtml = priceStart >= 0 ? html.slice(priceStart, priceStart + 20000) : html;
  const displayedPrice = [...priceHtml.matchAll(/<span[^>]*\bclass=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([^<]+)<\/span>/gi)]
    .map((match) => text(match[1]))
    .find(Boolean) ?? null;

  const breadcrumbStart = html.indexOf('wayfinding-breadcrumbs_feature_div');
  const breadcrumbHtml = breadcrumbStart >= 0 ? html.slice(breadcrumbStart, breadcrumbStart + 12000) : '';
  const excluded = /^(join prime|learn more|see more|shop now)$/i;
  const categories = [...breadcrumbHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => text(match[1]))
    .filter((label) => label && !excluded.test(label) && !/^\d(?:\.\d+)?\s+\d+/.test(label));
  const labels = [...new Set(categories)].slice(0, 3);
  const tags = labels.map((label, index) => ({
    key: categoryKey(labels.slice(0, index + 1)),
    label,
    level: index + 1,
  }));

  return { asin, title, displayedPrice, imageUrl: imageUrl || null, tags };
}
