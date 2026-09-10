import { normalizeAmazonPdpUrl } from './amazon-reviews.mjs';
import { fetchPdpSnapshotWithRetries } from '../lib/browserbase-reviews.mjs';
import { createS06Store } from './s06-store.mjs';
import { syncTrackedProduct } from './tracker.mjs';

const store = () => createS06Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
const stage = (res, payload) => res.write(`event: stage\ndata: ${JSON.stringify(payload)}\n\n`);
const event = (res, name, payload) => res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);

export async function createTrackedProduct({ url, database, onStage }) {
  const { asin, sourceUrl } = normalizeAmazonPdpUrl(url);
  const existing = await database.productByAsin(asin);
  if (existing) return { product: existing, existing: true };
  onStage?.({ id: 'connect', message: 'Browserbase 원격 브라우저 세션을 연결하는 중입니다.' });
  const snapshot = await fetchPdpSnapshotWithRetries({
    sourceUrl, asin,
    onAttempt: ({ attempt, maxAttempts }) => onStage?.({ id: 'render', attempt, maxAttempts, message: 'Amazon PDP를 열고 공개 리뷰를 렌더링하는 중입니다.' }),
    onRetry: ({ nextAttempt, maxAttempts }) => onStage?.({ id: 'retry', attempt: nextAttempt, maxAttempts, message: '응답이 불안정해 새 원격 세션으로 다시 시도합니다.' }),
  });
  onStage?.({ id: 'snapshot', message: '첫 별점·가격·공개 리뷰 스냅샷을 만드는 중입니다.' });
  const product = await database.createProduct({
    asin, source_url: sourceUrl, title: snapshot.title, displayed_price: snapshot.displayedPrice,
    rating: snapshot.rating, image_url: snapshot.imageUrl, last_checked_at: new Date().toISOString(),
  });
  const tracking = await syncTrackedProduct({
    store: database, product, snapshot, apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', onStage,
  });
  return { product, tracking, existing: false };
}

export default async function handler(req, res) {
  try {
    const database = store();
    if (req.method === 'GET') return res.status(200).json({ products: await database.listProducts() });
    if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST만 지원합니다.' });
    const stream = req.headers.accept?.includes('text/event-stream');
    if (stream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      try {
        const result = await createTrackedProduct({ url: bodyOf(req).url, database, onStage: (payload) => stage(res, payload) });
        event(res, 'complete', result);
      } catch (error) {
        event(res, 'error', { message: error.message || '추적 카드를 만들지 못했습니다.' });
      }
      return res.end();
    }
    const result = await createTrackedProduct({ url: bodyOf(req).url, database });
    return res.status(result.existing ? 200 : 201).json(result);
  } catch (error) {
    const status = /Amazon|PDP|ASIN|URL/.test(error.message) ? 422 : /ANTHROPIC/.test(error.message) ? 503 : 502;
    return res.status(status).json({ message: error.message || '추적 카드를 만들지 못했습니다.' });
  }
}
