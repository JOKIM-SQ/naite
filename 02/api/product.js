import { normalizeAmazonUrl, parseProductHtml } from './product-meta.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST만 지원한다.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let normalized;
  try {
    normalized = normalizeAmazonUrl(body.url);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const emptyProduct = {
    asin: normalized.asin,
    sourceUrl: normalized.sourceUrl,
    title: '',
    displayedPrice: '',
    imageUrl: '',
    tags: [],
  };

  try {
    const response = await fetch(normalized.sourceUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);

    return res.status(200).json({
      product: { ...parseProductHtml(await response.text(), normalized.asin), sourceUrl: normalized.sourceUrl },
    });
  } catch {
    return res.status(200).json({
      product: emptyProduct,
      warning: '자동 추출에 실패했다. ASIN을 유지한 채 제품 정보를 직접 입력해 저장할 수 있다.',
    });
  }
}
