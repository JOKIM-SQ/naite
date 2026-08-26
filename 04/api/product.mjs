import { priceCents } from './price-history.mjs';
import { fetchAmazonProductInfo } from './amazon-fetch.mjs';
import { normalizeAmazonUrl } from './product-meta.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const headers = () => ({ apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'content-type': 'application/json', 'Accept-Profile': 'weekly_projects', 'Content-Profile': 'weekly_projects' });
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const customTagKey = (label) => `custom/${encodeURIComponent(label.toLowerCase())}`;

function configured(res) {
  if (supabaseUrl && supabaseKey) return true;
  res.status(503).json({ message: 'Supabase 환경변수가 아직 없습니다.' });
  return false;
}

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: { ...headers(), ...options.headers } });
  const text = await response.text();
  if (!response.ok) throw new Error(text || 'Supabase 요청에 실패했습니다.');
  return text ? JSON.parse(text) : null;
}

async function listProducts() {
  const rows = await request('s04_products?select=id,asin,source_url,title,displayed_price,rating,image_url,price_change,rating_change,last_price_checked_at,created_at,s04_product_tags(s04_tags(id,key,label,level,source))&order=created_at.desc');
  return rows.map((row) => ({
    id: row.id, asin: row.asin, sourceUrl: row.source_url, title: row.title, displayedPrice: row.displayed_price,
    rating: row.rating, imageUrl: row.image_url, priceChange: row.price_change || 0, ratingChange: row.rating_change || 0, lastPriceCheckedAt: row.last_price_checked_at,
    tags: row.s04_product_tags.map((link) => link.s04_tags).filter(Boolean).sort((a, b) => a.level - b.level),
  }));
}

async function readAmazonProduct(sourceUrl, asin) {
  const result = await fetchAmazonProductInfo({ sourceUrl, asin });
  if (!result.product.title || !result.product.displayedPrice) {
    const missing = result.missing.join(', ') || '제품명 또는 가격';
    throw new Error(`Amazon 상품 정보가 ${result.cycles}개 수집 사이클, ${result.attempts}회 시도 후에도 저장에 필요한 정보를 채우지 못했습니다. 누락: ${missing}`);
  }
  return result.product;
}

async function saveProduct(product) {
  const initialPrice = priceCents(product.displayedPrice);
  if (initialPrice === null) throw new Error('현재 Amazon 가격을 읽지 못해 추적을 시작할 수 없습니다.');
  const productRows = await request('s04_products', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    asin: product.asin, source_url: product.sourceUrl, title: product.title, displayed_price: product.displayedPrice,
    rating: product.rating, image_url: product.imageUrl, last_price_cents: initialPrice, last_price_checked_at: new Date().toISOString(),
  }) });
  const saved = productRows[0];
  const checkedAt = new Date().toISOString();
  await request('s04_price_checks', { method: 'POST', body: JSON.stringify({ product_id: saved.id, checked_at: checkedAt, displayed_price: product.displayedPrice, price_cents: initialPrice, rating: product.rating }) });
  for (const tag of product.tags) {
    await request('s04_tags?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ key: tag.key, label: tag.label, level: tag.level, source: 'amazon' }) });
    const [savedTag] = await request(`s04_tags?key=eq.${encodeURIComponent(tag.key)}&select=id`);
    await request('s04_product_tags', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ product_id: saved.id, tag_id: savedTag.id }) });
  }
}

async function saveCustomTag(productId, label, previousTagId) {
  const normalized = String(label || '').trim().slice(0, 40);
  if (!normalized) throw new Error('커스텀 태그 이름을 입력하세요.');
  const key = customTagKey(normalized);
  await request('s04_tags?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ key, label: normalized, level: 4, source: 'custom' }) });
  const [tag] = await request(`s04_tags?key=eq.${encodeURIComponent(key)}&select=id`);
  await request('s04_product_tags', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ product_id: productId, tag_id: tag.id }) });
  if (previousTagId && previousTagId !== tag.id) await request(`s04_product_tags?product_id=eq.${productId}&tag_id=eq.${previousTagId}`, { method: 'DELETE' });
}

export default async function handler(req, res) {
  if (!configured(res)) return;
  if (req.method === 'GET') {
    try { return res.status(200).json(await listProducts()); } catch { return res.status(502).json({ message: '제품 목록을 읽지 못했습니다.' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST만 지원합니다.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  try {
    if (body.action === 'lookup') {
      const normalized = normalizeAmazonUrl(body.url);
      const existing = await request(`s04_products?asin=eq.${normalized.asin}&select=id`);
      if (existing.length) return res.status(409).json({ message: '이미 추적 중인 ASIN입니다.' });
      return res.status(200).json({ product: { ...(await readAmazonProduct(normalized.sourceUrl, normalized.asin)), sourceUrl: normalized.sourceUrl } });
    }
    if (body.action === 'save') {
      const product = body.product;
      if (!product?.asin || !product?.sourceUrl || !product?.title || !Array.isArray(product.tags)) return res.status(400).json({ message: '저장할 제품 정보가 완전하지 않습니다.' });
      await saveProduct(product);
      return res.status(201).json({ message: '가격 추적을 시작했습니다.' });
    }
    if (body.action === 'custom-tag-add' || body.action === 'custom-tag-update') {
      if (!uuid(body.productId)) return res.status(400).json({ message: '제품 식별자가 올바르지 않습니다.' });
      await saveCustomTag(body.productId, body.label, body.action === 'custom-tag-update' ? body.previousTagId : null);
      return res.status(200).json({ message: '커스텀 태그를 저장했습니다.' });
    }
    if (body.action === 'custom-tag-delete') {
      if (!uuid(body.productId) || !uuid(body.tagId)) return res.status(400).json({ message: '태그 식별자가 올바르지 않습니다.' });
      await request(`s04_product_tags?product_id=eq.${body.productId}&tag_id=eq.${body.tagId}`, { method: 'DELETE' });
      return res.status(200).json({ message: '커스텀 태그를 지웠습니다.' });
    }
    if (body.action === 'delete') {
      if (!uuid(body.productId)) return res.status(400).json({ message: '제품 식별자가 올바르지 않습니다.' });
      if (!process.env.DELETE_PIN || body.pin !== process.env.DELETE_PIN) return res.status(401).json({ message: '삭제 비밀번호가 일치하지 않습니다.' });
      await request(`s04_products?id=eq.${body.productId}`, { method: 'DELETE' });
      return res.status(200).json({ message: '추적을 중단했습니다.' });
    }
    return res.status(400).json({ message: '알 수 없는 요청입니다.' });
  } catch (error) {
    const status = /Amazon|ASIN|URL/.test(error.message) ? 422 : 502;
    return res.status(status).json({ message: error.message || '요청을 처리하지 못했습니다.' });
  }
}
