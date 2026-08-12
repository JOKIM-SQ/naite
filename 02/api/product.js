const productMeta = import('./product-meta.mjs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const headers = () => ({
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'content-type': 'application/json',
});

const validProduct = (product) => product
  && typeof product.asin === 'string'
  && typeof product.sourceUrl === 'string'
  && typeof product.title === 'string'
  && product.title.trim()
  && Array.isArray(product.tags)
  && product.tags.length === 3
  && product.tags.every((tag) => typeof tag.key === 'string' && typeof tag.label === 'string' && Number.isInteger(tag.level));

async function listProducts() {
  const response = await fetch(`${supabaseUrl}/rest/v1/s02_products?select=id,asin,source_url,title,displayed_price,image_url,created_at,s02_product_tags(s02_tags(key,label,level))&order=created_at.desc`, { headers: headers() });
  if (!response.ok) throw new Error('Supabase 제품 목록을 읽지 못했다.');
  const rows = await response.json();
  return rows.map((row) => ({
    id: row.id,
    asin: row.asin,
    sourceUrl: row.source_url,
    title: row.title,
    displayedPrice: row.displayed_price,
    imageUrl: row.image_url,
    tags: row.s02_product_tags.map((link) => link.s02_tags).filter(Boolean).sort((a, b) => a.level - b.level),
  }));
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
      return res.status(200).json({ message: result.duplicate ? '이미 저장된 ASIN이다.' : 'Supabase에 저장했다.' });
    } catch (error) {
      return res.status(502).json({ message: error.message });
    }
  }

  const { normalizeAmazonUrl, parseProductHtml } = await productMeta;
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
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; CartHoarders/1.0; +https://github.com/JOKIM-SQ/naite)',
      },
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
