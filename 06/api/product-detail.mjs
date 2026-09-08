import { createS06Store } from './s06-store.mjs';
import { buildProductSignals } from './insights-core.mjs';
import { themeDistribution } from './tracking-core.mjs';

const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET만 지원합니다.' });
  if (!uuid(req.query?.productId)) return res.status(400).json({ message: '제품 식별자가 올바르지 않습니다.' });
  try {
    const store = createS06Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
    const detail = await store.detail(req.query.productId);
    if (!detail.product) return res.status(404).json({ message: '제품 카드를 찾지 못했습니다.' });
    return res.status(200).json({
      ...detail,
      ...buildProductSignals(detail),
      distribution: themeDistribution(detail.analyses.map((row) => row.analysis)),
    });
  } catch {
    return res.status(502).json({ message: '리뷰 상세 정보를 읽지 못했습니다.' });
  }
}
