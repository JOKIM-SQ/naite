import { isAmazonAccessBlocked, parseProductHtml } from './product-meta.mjs';

export const MAX_AMAZON_ATTEMPTS = 50;
export const MAX_AMAZON_CYCLES = 2;
export const AMAZON_FETCH_TIMEOUT_MS = 2500;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const emptyProduct = (asin) => ({ asin, title: null, displayedPrice: null, rating: null, imageUrl: null, tags: [] });

export const mergeProductInfo = (previous, next) => ({
  asin: next.asin || previous.asin,
  title: next.title || previous.title,
  displayedPrice: next.displayedPrice || previous.displayedPrice,
  rating: Number.isFinite(next.rating) ? next.rating : previous.rating,
  imageUrl: next.imageUrl || previous.imageUrl,
  tags: next.tags.length ? next.tags : previous.tags,
});

export const missingProductFields = (product) => [
  !product.title && '제품명',
  !product.displayedPrice && '가격',
  !Number.isFinite(product.rating) && '별점',
  !product.imageUrl && '이미지',
  !product.tags.length && '카테고리',
].filter(Boolean);

export async function fetchAmazonProductInfo({ sourceUrl, asin, seed = emptyProduct(asin), fetchImpl = fetch, maxAttempts = MAX_AMAZON_ATTEMPTS, maxCycles = MAX_AMAZON_CYCLES, delayMs = 180, cycleDelayMs = 1200, fetchTimeoutMs = AMAZON_FETCH_TIMEOUT_MS, onAttempt }) {
  let product = mergeProductInfo(emptyProduct(asin), seed);
  let lastError = null;
  let attempts = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    for (let attemptInCycle = 1; attemptInCycle <= maxAttempts; attemptInCycle += 1) {
      attempts += 1;
      try {
        const response = await fetchImpl(sourceUrl, {
          headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; caramelcaramelcaramel/1.0)' },
          redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(fetchTimeoutMs),
        });
        if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);
        const html = await response.text();
        if (isAmazonAccessBlocked(html)) throw new Error('Amazon 차단 페이지');
        product = mergeProductInfo(product, parseProductHtml(html, asin));
        const missing = missingProductFields(product);
        await onAttempt?.({ product, attempts, cycle, attemptInCycle, complete: !missing.length, missing });
        if (!missing.length) return { product, attempts, cycles: cycle, complete: true, missing: [] };
      } catch (error) {
        lastError = error;
      }
      if (attemptInCycle < maxAttempts && delayMs) await delay(delayMs);
    }
    if (cycle < maxCycles && cycleDelayMs) await delay(cycleDelayMs);
  }

  const missing = missingProductFields(product);
  return { product, attempts, cycles: maxCycles, complete: !missing.length, missing, error: lastError?.message || null };
}

export async function fetchCompleteAmazonProduct(options) {
  const result = await fetchAmazonProductInfo(options);
  if (result.complete) return result;
  const reason = result.missing.length ? `누락: ${result.missing.join(', ')}` : result.error;
  throw new Error(`Amazon 상품 정보가 ${result.cycles}개 수집 사이클, ${result.attempts}회 시도 후에도 완성되지 않았습니다. ${reason || ''}`.trim());
}
