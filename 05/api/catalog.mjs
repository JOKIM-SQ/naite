import { fetchCatalogSnapshot, normalizeAmazonInput } from './catalog-meta.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

function configured(res) {
  if (supabaseUrl && supabasePublishableKey) return true;
  res.status(503).json({ message: 'Supabase 환경변수가 아직 없습니다.' });
  return false;
}

async function getUser(token) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('로그인 세션이 만료되었습니다. 다시 로그인하세요.');
  return response.json();
}

async function request(path, token, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body || '카탈로그 데이터를 처리하지 못했습니다.');
  return body ? JSON.parse(body) : null;
}

const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

function normalizeSelection(snapshot, selection) {
  const colorByAsin = new Map(snapshot.colorVariants.map((variant) => [variant.asin, variant]));
  const deviceByAsin = new Map(snapshot.deviceVariants.map((variant) => [variant.asin, variant]));
  const selected = [{ asin: snapshot.asin, expectedColor: snapshot.currentColor, expectedDevice: snapshot.currentDevice }];

  [...new Set(selection?.colorAsins || [])].forEach((asin) => {
    const variant = colorByAsin.get(asin);
    if (!variant) throw new Error('선택한 색상 ASIN이 수집 결과에 없습니다.');
    selected.push({ asin, expectedColor: variant.label, expectedDevice: snapshot.currentDevice });
  });
  [...new Set(selection?.deviceAsins || [])].forEach((asin) => {
    const variant = deviceByAsin.get(asin);
    if (!variant) throw new Error('선택한 기기 ASIN이 수집 결과에 없습니다.');
    selected.push({ asin, expectedColor: snapshot.currentColor, expectedDevice: variant.label });
  });

  const seen = new Set();
  return selected.filter((variant) => !seen.has(variant.asin) && seen.add(variant.asin));
}

function assertVariant(snapshot, expected) {
  if (snapshot.currentColor !== expected.expectedColor || snapshot.currentDevice !== expected.expectedDevice) {
    throw new Error(`${expected.asin}의 색상 또는 iPhone 모델이 선택한 조합과 다릅니다.`);
  }
}

async function verifiedVariant(selection, initialSnapshot) {
  if (selection.asin === initialSnapshot.asin) return initialSnapshot;
  const result = await fetchCatalogSnapshot({
    sourceUrl: `https://www.amazon.com/dp/${selection.asin}`,
    asin: selection.asin,
  });
  if (!result.complete) {
    throw new Error(`${selection.asin}의 정보를 완성하지 못했습니다. 누락: ${result.missing.join(', ')}`);
  }
  return result.snapshot;
}

async function upsertProduct(snapshot, sourceUrl, user, token) {
  const rows = await request('s05_products?on_conflict=owner_id,source_asin', token, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      owner_id: user.id,
      source_asin: snapshot.asin,
      source_url: sourceUrl,
      title: snapshot.title,
      image_url: snapshot.imageUrl,
      displayed_price: snapshot.displayedPrice,
      import_status: 'collecting',
      updated_at: new Date().toISOString(),
    }),
  });
  return rows[0];
}

async function upsertDevice(productId, snapshot, token) {
  const rows = await request('s05_compatible_devices?on_conflict=product_id,model_name', token, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      product_id: productId,
      model_name: snapshot.currentDevice,
      variant_asin: snapshot.asin,
      import_status: 'complete',
    }),
  });
  return rows[0];
}

async function upsertOption(deviceId, snapshot, token) {
  await request('s05_product_options?on_conflict=device_id,variant_asin', token, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      device_id: deviceId,
      color_name: snapshot.currentColor,
      variant_asin: snapshot.asin,
      is_available: true,
    }),
  });
}

async function setProductStatus(productId, importStatus, token) {
  await request(`s05_products?id=eq.${encodeURIComponent(productId)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ import_status: importStatus, updated_at: new Date().toISOString() }),
  });
}

async function listCatalog(token) {
  const rows = await request('s05_products?select=id,source_asin,source_url,title,image_url,displayed_price,created_at,s05_compatible_devices(id,model_name,variant_asin,s05_product_options(id,color_name,variant_asin,is_available))&import_status=eq.complete&order=created_at.desc', token);
  return rows.map((product) => ({
    id: product.id,
    asin: product.source_asin,
    sourceUrl: product.source_url,
    title: product.title,
    imageUrl: product.image_url,
    displayedPrice: product.displayed_price,
    createdAt: product.created_at,
    devices: (product.s05_compatible_devices || []).map((device) => ({
      id: device.id,
      modelName: device.model_name,
      asin: device.variant_asin,
      options: (device.s05_product_options || []).filter((option) => option.is_available).map((option) => ({
        id: option.id,
        colorName: option.color_name,
        asin: option.variant_asin,
      })),
    })),
  }));
}

export default async function handler(req, res) {
  if (!configured(res)) return;
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: '로그인이 필요합니다.' });

  try {
    const user = await getUser(token);
    if (req.method === 'GET') return res.status(200).json({ products: await listCatalog(token) });
    if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST만 지원합니다.' });

    const body = bodyOf(req);
    const normalized = normalizeAmazonInput(body.input);
    const initial = await fetchCatalogSnapshot(normalized);
    if (!initial.complete) {
      return res.status(422).json({ message: `Amazon 정보가 완성되지 않았습니다. 누락: ${initial.missing.join(', ')}`, attempts: initial.attempts });
    }
    if (body.action === 'lookup') return res.status(200).json({ snapshot: initial.snapshot, attempts: initial.attempts });
    if (body.action !== 'save') return res.status(400).json({ message: '알 수 없는 요청입니다.' });

    const product = await upsertProduct(initial.snapshot, normalized.sourceUrl, user, token);
    try {
      const selections = normalizeSelection(initial.snapshot, body.selection);
      for (const selection of selections) {
        const variant = await verifiedVariant(selection, initial.snapshot);
        assertVariant(variant, selection);
        const device = await upsertDevice(product.id, variant, token);
        await upsertOption(device.id, variant, token);
      }
      await setProductStatus(product.id, 'complete', token);
      return res.status(201).json({ message: '선택한 ASIN을 카탈로그에 저장했습니다.', productId: product.id });
    } catch (error) {
      await setProductStatus(product.id, 'needs_retry', token);
      throw error;
    }
  } catch (error) {
    const status = /로그인|세션/.test(error.message) ? 401 : /Amazon|ASIN|선택한|조합/.test(error.message) ? 422 : 502;
    return res.status(status).json({ message: error.message || '요청을 처리하지 못했습니다.' });
  }
}
