import { priceCents, priceDirection, ratingDirection } from './price-history.mjs';
import { fetchAmazonProductInfo } from './amazon-fetch.mjs';

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

const productSeed = (product) => ({
  asin: product.asin, title: product.title || null, displayedPrice: product.displayed_price || null,
  rating: product.rating ?? null, imageUrl: product.image_url || null,
  tags: product.s04_product_tags.map((link) => link.s04_tags).filter((tag) => tag?.source === 'amazon'),
});

const metadataPayload = (parsed) => ({
  ...(parsed.title && { title: parsed.title }),
  ...(parsed.displayedPrice && { displayed_price: parsed.displayedPrice }),
  ...(Number.isFinite(parsed.rating) && { rating: parsed.rating }),
  ...(parsed.imageUrl && { image_url: parsed.imageUrl }),
});

async function syncAmazonTags(productId, tags) {
  for (const tag of tags) {
    await api('s04_tags?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ key: tag.key, label: tag.label, level: tag.level, source: 'amazon' }) });
    const [savedTag] = await api(`s04_tags?key=eq.${encodeURIComponent(tag.key)}&select=id`);
    await api('s04_product_tags', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ product_id: productId, tag_id: savedTag.id }) });
  }
}

async function savePriceSnapshot(product, parsed, currentCents) {
  const direction = priceDirection(product.last_price_cents, currentCents);
  const ratingChange = ratingDirection(product.rating, parsed.rating);
  const checkedAt = new Date().toISOString();
  await api(`s04_products?id=eq.${product.id}`, { method: 'PATCH', body: JSON.stringify({ ...metadataPayload(parsed), last_price_cents: currentCents, price_change: direction, rating_change: ratingChange, last_price_checked_at: checkedAt }) });
  await api('s04_price_checks', { method: 'POST', body: JSON.stringify({ product_id: product.id, checked_at: checkedAt, displayed_price: parsed.displayedPrice, price_cents: currentCents, rating: parsed.rating, price_change: direction, rating_change: ratingChange }) });
  return direction;
}

async function checkProduct(product) {
  let priceRecorded = false;
  let direction = null;
  const result = await fetchAmazonProductInfo({
    sourceUrl: product.source_url,
    asin: product.asin,
    seed: productSeed(product),
    onAttempt: async ({ product: parsed }) => {
      const currentCents = priceCents(parsed.displayedPrice);
      if (priceRecorded || currentCents === null) return;
      direction = await savePriceSnapshot(product, parsed, currentCents);
      priceRecorded = true;
    },
  });
  const metadata = metadataPayload(result.product);
  if (Object.keys(metadata).length) await api(`s04_products?id=eq.${product.id}`, { method: 'PATCH', body: JSON.stringify(metadata) });
  if (result.product.tags.length) await syncAmazonTags(product.id, result.product.tags);
  return priceRecorded ? direction : 'skipped';
}

export async function runPriceCheck() {
  const products = await api('s04_products?select=id,asin,source_url,last_price_cents,title,displayed_price,rating,image_url,s04_product_tags(s04_tags(id,key,label,level,source))&order=created_at.asc');
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
