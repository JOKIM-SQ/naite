import { summarizeHistory } from './price-history.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Accept-Profile': 'weekly_projects' };
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET만 지원합니다.' });
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없습니다.' });
  if (!uuid(req.query.productId)) return res.status(400).json({ message: '제품 식별자가 올바르지 않습니다.' });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/s04_price_checks?product_id=eq.${req.query.productId}&select=checked_at,price_cents,displayed_price,rating&order=checked_at.asc`, { headers });
    if (!response.ok) throw new Error();
    const history = (await response.json()).map((row) => ({ checkedAt: row.checked_at, priceCents: row.price_cents, displayedPrice: row.displayed_price, rating: row.rating }));
    return res.status(200).json({ history, summary: summarizeHistory(history) });
  } catch { return res.status(502).json({ message: '가격 이력을 읽지 못했습니다.' }); }
}
