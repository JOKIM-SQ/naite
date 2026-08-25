import { priceCents, priceDirection } from './price-history.mjs';
import { isAmazonAccessBlocked, parseProductHtml } from './product-meta.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const cronSecret = process.env.CRON_SECRET;
const headers = () => ({ apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'content-type': 'application/json', 'Accept-Profile': 'weekly_projects', 'Content-Profile': 'weekly_projects' });

const isSixAmPacific = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(new Date()) === '06';

async function api(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: { ...headers(), ...options.headers } });
  const text = await response.text();
  if (!response.ok) throw new Error(text || 'Supabase 요청에 실패했습니다.');
  return text ? JSON.parse(text) : null;
}

async function checkProduct(product) {
  const response = await fetch(product.source_url, { headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; caramelcaramelcaramel/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);
  const html = await response.text();
  if (isAmazonAccessBlocked(html)) throw new Error('Amazon 차단 페이지');
  const parsed = parseProductHtml(html, product.asin);
  const currentCents = priceCents(parsed.displayedPrice);
  if (currentCents === null) return 'skipped';
  const direction = priceDirection(product.last_price_cents, currentCents);
  const checkedAt = new Date().toISOString();
  await api(`s04_products?id=eq.${product.id}`, { method: 'PATCH', body: JSON.stringify({ displayed_price: parsed.displayedPrice, rating: parsed.rating, last_price_cents: currentCents, price_change: direction, last_price_checked_at: checkedAt }) });
  await api('s04_price_checks', { method: 'POST', body: JSON.stringify({ product_id: product.id, checked_at: checkedAt, displayed_price: parsed.displayedPrice, price_cents: currentCents, rating: parsed.rating, price_change: direction }) });
  return direction;
}

export async function runPriceCheck() {
  const products = await api('s04_products?select=id,asin,source_url,last_price_cents&order=created_at.asc');
  const result = { checked: 0, up: 0, down: 0, unchanged: 0, skipped: 0, failed: 0 };
  for (const product of products) {
    try {
      const direction = await checkProduct(product);
      if (direction === 'skipped') { result.skipped += 1; continue; }
      result.checked += 1;
      if (direction > 0) result.up += 1;
      else if (direction < 0) result.down += 1;
      else result.unchanged += 1;
    } catch { result.failed += 1; }
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET만 지원합니다.' });
  if (!supabaseUrl || !supabaseKey || !cronSecret) return res.status(503).json({ message: '가격 확인 환경변수가 아직 없습니다.' });
  if (req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ message: 'Cron 요청만 허용합니다.' });
  if (!isSixAmPacific()) return res.status(200).json({ skipped: true, message: '오전 6시(태평양 시간) 실행을 기다립니다.' });
  try { return res.status(200).json(await runPriceCheck()); } catch { return res.status(502).json({ message: '가격 확인을 시작하지 못했습니다.' }); }
}
