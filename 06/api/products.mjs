import { fetchPdpSnapshot, normalizeAmazonPdpUrl } from './amazon-reviews.mjs';
import { createS06Store } from './s06-store.mjs';
import { syncTrackedProduct } from './tracker.mjs';

const store = () => createS06Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

export default async function handler(req, res) {
  try {
    const database = store();
    if (req.method === 'GET') return res.status(200).json({ products: await database.listProducts() });
    if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST만 지원합니다.' });
    const { asin, sourceUrl } = normalizeAmazonPdpUrl(bodyOf(req).url);
    const existing = await database.productByAsin(asin);
    if (existing) return res.status(200).json({ product: existing, existing: true });
    const snapshot = await fetchPdpSnapshot({ sourceUrl, asin });
    const product = await database.createProduct({
      asin, source_url: sourceUrl, title: snapshot.title, displayed_price: snapshot.displayedPrice,
      rating: snapshot.rating, image_url: snapshot.imageUrl, last_checked_at: new Date().toISOString(),
    });
    const tracking = await syncTrackedProduct({
      store: database, product, snapshot, apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
    return res.status(201).json({ product, tracking });
  } catch (error) {
    const status = /Amazon|PDP|ASIN|URL/.test(error.message) ? 422 : /ANTHROPIC/.test(error.message) ? 503 : 502;
    return res.status(status).json({ message: error.message || '추적 카드를 만들지 못했습니다.' });
  }
}
