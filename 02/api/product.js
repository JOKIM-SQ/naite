const productMeta = import('./product-meta.mjs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const headers = () => ({
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'content-type': 'application/json',
  'Accept-Profile': 'weekly_projects',
  'Content-Profile': 'weekly_projects',
});

const validProduct = (product) => product
  && typeof product.asin === 'string'
  && typeof product.sourceUrl === 'string'
  && typeof product.title === 'string'
  && product.title.trim()
  && Array.isArray(product.tags)
  && product.tags.length <= 3
  && product.tags.every((tag) => typeof tag.key === 'string' && typeof tag.label === 'string' && Number.isInteger(tag.level));

const validProductId = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function listProducts() {
  let response = await fetch(`${supabaseUrl}/rest/v1/s02_products?select=id,asin,source_url,title,displayed_price,image_url,price_change,last_price_checked_at,created_at,s02_product_tags(s02_tags(id,key,label,level))&order=created_at.desc`, { headers: headers() });
  if (!response.ok) response = await fetch(`${supabaseUrl}/rest/v1/s02_products?select=id,asin,source_url,title,displayed_price,image_url,created_at,s02_product_tags(s02_tags(id,key,label,level))&order=created_at.desc`, { headers: headers() });
  if (!response.ok) throw new Error('Supabase 제품 목록을 읽지 못했다.');
  const rows = await response.json();
  return rows.map((row) => ({
    id: row.id,
    asin: row.asin,
    sourceUrl: row.source_url,
    title: row.title,
    displayedPrice: row.displayed_price,
    imageUrl: row.image_url,
    priceChange: row.price_change || 0,
    lastPriceCheckedAt: row.last_price_checked_at,
    tags: row.s02_product_tags.map((link) => link.s02_tags).filter(Boolean).sort((a, b) => a.level - b.level),
  }));
}

async function registeredAsin(asin) {
  const response = await fetch(`${supabaseUrl}/rest/v1/s02_products?asin=eq.${encodeURIComponent(asin)}&select=id&limit=1`, { headers: headers() });
  if (!response.ok) throw new Error('Supabase ASIN 중복 확인에 실패했다.');
  return (await response.json()).length > 0;
}

async function saveProduct(product) {
  const inserted = await fetch(`${supabaseUrl}/rest/v1/s02_products`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify({
      asin: product.asin,
      source_url: product.sourceUrl,
      title: product.title.trim(),
      displayed_price: product.displayedPrice?.trim() || null,
      image_url: product.imageUrl || null,
    }),
  });
  if (inserted.status === 409) return { duplicate: true };
  if (!inserted.ok) throw new Error('Supabase 제품 저장에 실패했다.');
  const [saved] = await inserted.json();

  for (const tag of product.tags) {
    const tagResponse = await fetch(`${supabaseUrl}/rest/v1/s02_tags?on_conflict=key`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ key: tag.key, label: tag.label, level: tag.level }),
    });
    if (!tagResponse.ok) throw new Error('Supabase 태그 저장에 실패했다.');
    const [insertedTag] = await tagResponse.json();
    const savedTag = insertedTag || await fetch(`${supabaseUrl}/rest/v1/s02_tags?key=eq.${encodeURIComponent(tag.key)}&select=id`, { headers: headers() })
      .then(async (response) => {
        if (!response.ok) throw new Error('Supabase 태그를 읽지 못했다.');
        const [existingTag] = await response.json();
        return existingTag;
      });
    if (!savedTag) throw new Error('Supabase 태그를 찾지 못했다.');
    const linkResponse = await fetch(`${supabaseUrl}/rest/v1/s02_product_tags`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ product_id: saved.id, tag_id: savedTag.id }),
    });
    if (!linkResponse.ok) throw new Error('제품과 태그를 연결하지 못했다.');
  }
  return { duplicate: false };
}

const customTagKey = (label) => `custom/${encodeURIComponent(label.toLowerCase())}`;

const retryPause = () => new Promise((resolve) => setTimeout(resolve, 400));

async function readAmazonProduct(sourceUrl, asin, parseProductHtml, isAmazonAccessBlocked) {
  let lastError;
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; CartHoarders/1.0; +https://github.com/JOKIM-SQ/naite)',
        },
        redirect: 'follow',
      });
      if (response.status === 403 || response.status === 429) {
        const error = new Error(`Amazon 응답 ${response.status}`);
        error.blocked = true;
        throw error;
      }
      if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);
      const html = await response.text();
      if (isAmazonAccessBlocked(html)) {
        const error = new Error('Amazon 차단 페이지');
        error.blocked = true;
        throw error;
      }
      return { product: parseProductHtml(html, asin), attempts: attempt };
    } catch (error) {
      if (error.blocked) throw error;
      lastError = error;
      if (attempt < 50) await retryPause();
    }
  }
  throw lastError;
}

async function customTag(productId, label, previousTagId = null) {
  const normalized = String(label || '').trim().slice(0, 40);
  if (!normalized) throw new Error('커스텀 태그 이름을 입력해주세요.');
  const tagResponse = await fetch(`${supabaseUrl}/rest/v1/s02_tags?on_conflict=key`, { method: 'POST', headers: { ...headers(), Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ key: customTagKey(normalized), label: normalized, level: 4, source: 'custom' }) });
  if (!tagResponse.ok) throw new Error('커스텀 태그를 저장하지 못했습니다.');
  const [inserted] = await tagResponse.json();
  const tag = inserted || await fetch(`${supabaseUrl}/rest/v1/s02_tags?key=eq.${encodeURIComponent(customTagKey(normalized))}&select=id`, { headers: headers() }).then(async (response) => (await response.json())[0]);
  if (!tag) throw new Error('커스텀 태그를 찾지 못했습니다.');
  const link = await fetch(`${supabaseUrl}/rest/v1/s02_product_tags`, { method: 'POST', headers: { ...headers(), Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({ product_id: productId, tag_id: tag.id }) });
  if (!link.ok) throw new Error('제품에 커스텀 태그를 연결하지 못했습니다.');
  if (previousTagId && previousTagId !== tag.id) {
    const unlink = await fetch(`${supabaseUrl}/rest/v1/s02_product_tags?product_id=eq.${productId}&tag_id=eq.${previousTagId}`, { method: 'DELETE', headers: headers() });
    if (!unlink.ok) throw new Error('기존 커스텀 태그를 지우지 못했습니다.');
  }
}

async function removeCustomTag(productId, tagId) {
  const check = await fetch(`${supabaseUrl}/rest/v1/s02_product_tags?product_id=eq.${productId}&tag_id=eq.${tagId}&select=s02_tags(level)`, { headers: headers() });
  const [link] = await check.json();
  if (!link?.s02_tags || link.s02_tags.level !== 4) throw new Error('Amazon 카테고리 태그는 수정할 수 없습니다.');
  const response = await fetch(`${supabaseUrl}/rest/v1/s02_product_tags?product_id=eq.${productId}&tag_id=eq.${tagId}`, { method: 'DELETE', headers: headers() });
  if (!response.ok) throw new Error('커스텀 태그를 지우지 못했습니다.');
}

async function deleteProduct(productId, pin) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_s02_product`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_product_id: productId, p_pin: pin }),
  });
  if (response.status === 401 || response.status === 403) throw new Error('비밀번호가 일치하지 않습니다.');
  if (response.status === 404) throw new Error('이미 삭제된 제품입니다.');
  if (!response.ok) throw new Error('제품을 삭제하지 못했습니다.');
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없다.' });
    try {
      return res.status(200).json(await listProducts());
    } catch (error) {
      return res.status(502).json({ message: error.message });
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST만 지원한다.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (body.action === 'save') {
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없다.' });
    if (!validProduct(body.product)) return res.status(400).json({ message: '저장할 제품 정보가 완전하지 않다.' });
    try {
      const result = await saveProduct(body.product);
      if (result.duplicate) return res.status(409).json({ message: '이미 선반에 등록된 ASIN입니다.' });
      return res.status(200).json({ message: 'Supabase에 저장했다.' });
    } catch (error) {
      return res.status(502).json({ message: error.message });
    }
  }
  if (body.action === 'delete') {
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없다.' });
    if (!validProductId(body.productId) || !/^\d{4}$/.test(body.pin || '')) return res.status(400).json({ message: '4자리 비밀번호를 입력해주세요.' });
    try {
      await deleteProduct(body.productId, body.pin);
      return res.status(200).json({ message: '선반에서 제품을 삭제했습니다.' });
    } catch (error) {
      if (error.message === '비밀번호가 일치하지 않습니다.') return res.status(401).json({ message: error.message });
      if (error.message === '이미 삭제된 제품입니다.') return res.status(404).json({ message: error.message });
      return res.status(502).json({ message: error.message });
    }
  }
  if (body.action === 'custom-tag-add' || body.action === 'custom-tag-update') {
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없다.' });
    if (!validProductId(body.productId) || (body.previousTagId && !validProductId(body.previousTagId))) return res.status(400).json({ message: '태그 요청이 올바르지 않습니다.' });
    try {
      await customTag(body.productId, body.label, body.action === 'custom-tag-update' ? body.previousTagId : null);
      return res.status(200).json({ message: '커스텀 태그를 저장했습니다.' });
    } catch (error) { return res.status(502).json({ message: error.message }); }
  }
  if (body.action === 'custom-tag-delete') {
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없다.' });
    if (!validProductId(body.productId) || !validProductId(body.tagId)) return res.status(400).json({ message: '태그 요청이 올바르지 않습니다.' });
    try {
      await removeCustomTag(body.productId, body.tagId);
      return res.status(200).json({ message: '커스텀 태그를 지웠습니다.' });
    } catch (error) { return res.status(502).json({ message: error.message }); }
  }

  const { normalizeAmazonUrl, parseProductHtml, isAmazonAccessBlocked } = await productMeta;
  let normalized;
  try {
    normalized = normalizeAmazonUrl(body.url);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ message: 'Supabase 환경변수가 아직 없다.' });
  try {
    if (await registeredAsin(normalized.asin)) {
      return res.status(409).json({ message: `ASIN ${normalized.asin}은(는) 이미 선반에 등록되어 있습니다.` });
    }
  } catch (error) {
    return res.status(502).json({ message: error.message });
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
    const result = await readAmazonProduct(normalized.sourceUrl, normalized.asin, parseProductHtml, isAmazonAccessBlocked);
    return res.status(200).json({
      product: { ...result.product, sourceUrl: normalized.sourceUrl },
      warning: result.attempts > 1 ? `${result.attempts}번째 요청에서 Amazon 정보를 읽었습니다.` : undefined,
    });
  } catch (error) {
    return res.status(200).json({
      product: emptyProduct,
      warning: error.blocked
        ? 'Amazon이 자동 요청을 차단했다. ASIN을 유지한 채 제품 정보를 직접 입력해 저장할 수 있다.'
        : '자동 추출을 50회 시도했지만 읽지 못했다. ASIN을 유지한 채 제품 정보를 직접 입력해 저장할 수 있다.',
    });
  }
}
