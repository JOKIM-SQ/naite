import { load } from 'cheerio';

const AMAZON_HOST = /(^|\.)amazon\.[a-z.]+$/i;
const ASIN = /^[a-z0-9]{10}$/i;
const BLOCKED = /robot check|enter the characters you see below|automated access|captcha/i;

const text = ($, selector) => $(selector).first().text().replace(/\s+/g, ' ').trim() || null;

const uniqueVariants = (variants) => {
  const seen = new Set();
  return variants.filter((variant) => variant.asin && !seen.has(variant.asin) && seen.add(variant.asin));
};

function variantRows($, dimension) {
  const selector = `#inline-twister-row-${dimension} li[data-asin]`;
  const variants = $(selector).map((_, node) => {
    if ($(node).attr('data-initiallyunavailable') === 'true') return null;
    const asin = String($(node).attr('data-asin') || '').toUpperCase();
    const label = dimension === 'color_name'
      ? $(node).find('img[alt]').first().attr('alt')?.trim()
      : $(node).text().replace(/\s+/g, ' ').trim();
    if (!ASIN.test(asin) || !label) return null;
    return {
      asin,
      label,
      selected: $(node).attr('data-initiallyselected') === 'true',
    };
  }).get().filter(Boolean);
  return uniqueVariants(variants);
}

function mergeVariants(previous, incoming) {
  const byAsin = new Map(previous.map((variant) => [variant.asin, variant]));
  incoming.forEach((variant) => byAsin.set(variant.asin, { ...byAsin.get(variant.asin), ...variant }));
  return [...byAsin.values()];
}

export function normalizeAmazonInput(value) {
  const input = String(value || '').trim();
  if (ASIN.test(input)) {
    const asin = input.toUpperCase();
    return { asin, sourceUrl: `https://www.amazon.com/dp/${asin}` };
  }

  let url;
  try { url = new URL(input); } catch { throw new Error('Amazon URL 또는 10자리 ASIN을 입력하세요.'); }
  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?]|$)/i);
  if (url.protocol !== 'https:' || !AMAZON_HOST.test(url.hostname) || !match) {
    throw new Error('Amazon URL에서 ASIN을 찾지 못했습니다.');
  }
  const asin = match[1].toUpperCase();
  return { asin, sourceUrl: `https://${url.hostname}/dp/${asin}` };
}

export function parseCatalogHtml(html, asin) {
  const $ = load(html);
  const title = text($, '#productTitle');
  const displayedPrice = $('#corePrice_feature_div .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, .priceToPay .a-offscreen, .a-offscreen')
    .map((_, node) => $(node).text().trim()).get().find(Boolean) || null;
  const imageUrl = $('meta[property="og:image"]').attr('content')
    || $('#landingImage').attr('data-old-hires')
    || $('#landingImage').attr('src')
    || null;
  const currentColor = text($, '#inline-twister-expanded-dimension-text-color_name');
  const currentDevice = text($, '#inline-twister-expanded-dimension-text-size_name');

  return {
    asin,
    title,
    displayedPrice,
    imageUrl,
    currentColor,
    currentDevice,
    colorVariants: variantRows($, 'color_name'),
    deviceVariants: variantRows($, 'size_name'),
  };
}

export function mergeCatalogSnapshot(previous, incoming) {
  return {
    asin: incoming.asin || previous.asin,
    title: incoming.title || previous.title,
    displayedPrice: incoming.displayedPrice || previous.displayedPrice,
    imageUrl: incoming.imageUrl || previous.imageUrl,
    currentColor: incoming.currentColor || previous.currentColor,
    currentDevice: incoming.currentDevice || previous.currentDevice,
    colorVariants: mergeVariants(previous.colorVariants || [], incoming.colorVariants || []),
    deviceVariants: mergeVariants(previous.deviceVariants || [], incoming.deviceVariants || []),
  };
}

export function missingCatalogFields(snapshot) {
  return [
    !snapshot.title && '제품명',
    !snapshot.displayedPrice && '가격',
    !snapshot.imageUrl && '대표 이미지',
    !snapshot.currentColor && '현재 색상',
    !snapshot.currentDevice && '현재 iPhone 모델',
    !snapshot.colorVariants?.length && '색상 파생 ASIN',
    !snapshot.deviceVariants?.length && '기기 파생 ASIN',
  ].filter(Boolean);
}

export async function fetchCatalogSnapshot({ sourceUrl, asin, fetchImpl = fetch, maxAttempts = 100, delayMs = 180, fetchTimeoutMs = 2500, onAttempt }) {
  let snapshot = {
    asin,
    title: null,
    displayedPrice: null,
    imageUrl: null,
    currentColor: null,
    currentDevice: null,
    colorVariants: [],
    deviceVariants: [],
  };
  let lastError = null;

  for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
    try {
      const response = await fetchImpl(sourceUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; spigen-case-catalog/1.0)',
        },
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);
      const html = await response.text();
      if (BLOCKED.test(html)) throw new Error('Amazon 차단 페이지');
      snapshot = mergeCatalogSnapshot(snapshot, parseCatalogHtml(html, asin));
    } catch (error) {
      lastError = error;
    }

    const missing = missingCatalogFields(snapshot);
    await onAttempt?.({ attempts, snapshot, missing, complete: !missing.length });
    if (!missing.length) return { snapshot, attempts, complete: true, missing: [], error: null };
    if (attempts < maxAttempts && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return {
    snapshot,
    attempts: maxAttempts,
    complete: false,
    missing: missingCatalogFields(snapshot),
    error: lastError?.message || null,
  };
}
