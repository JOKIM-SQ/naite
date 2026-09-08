const profileHeaders = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'content-type': 'application/json',
  'Accept-Profile': 'weekly_projects',
  'Content-Profile': 'weekly_projects',
});

const encoded = (value) => encodeURIComponent(String(value));

export const trackingDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export function createS06Store({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Supabase 환경변수가 아직 없습니다.');

  async function request(path, options = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...options,
      headers: { ...profileHeaders(key), ...(options.headers || {}) },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'Supabase 요청에 실패했습니다.');
    return text ? JSON.parse(text) : null;
  }

  async function productByAsin(asin) {
    const rows = await request(`s06_products?asin=eq.${encoded(asin)}&select=*&limit=1`);
    return rows[0] || null;
  }

  async function productById(id) {
    const rows = await request(`s06_products?id=eq.${encoded(id)}&select=*&limit=1`);
    return rows[0] || null;
  }

  return {
    listProducts: () => request('s06_products?select=id,asin,source_url,title,displayed_price,rating,image_url,tracking_enabled,last_checked_at,created_at&order=created_at.desc'),
    productByAsin,
    productById,
    createProduct: async (product) => {
      const rows = await request('s06_products', {
        method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(product),
      });
      return rows[0];
    },
    updateProduct: (id, product) => request(`s06_products?id=eq.${encoded(id)}`, {
      method: 'PATCH', body: JSON.stringify({ ...product, updated_at: new Date().toISOString() }),
    }),
    saveSnapshot: (productId, snapshot, now = new Date()) => request('s06_daily_snapshots?on_conflict=product_id,tracked_on', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({
        product_id: productId, tracked_on: trackingDate(now), checked_at: now.toISOString(),
        displayed_price: snapshot.displayedPrice || null, rating: snapshot.rating ?? null,
        visible_review_count: snapshot.reviews.length,
      }),
    }),
    reviewFingerprints: async (productId) => {
      const rows = await request(`s06_reviews?product_id=eq.${encoded(productId)}&select=fingerprint`);
      return new Set(rows.map((row) => row.fingerprint));
    },
    saveReviews: (productId, reviews, now = new Date()) => Promise.all(reviews.map((review) => request('s06_reviews?on_conflict=product_id,fingerprint', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' }, body: JSON.stringify({
        product_id: productId, fingerprint: review.fingerprint, review_title: review.title || null,
        review_text: review.text, rating: review.rating ?? null, first_seen_at: now.toISOString(), last_seen_at: now.toISOString(),
      }),
    }))),
    saveAnalysis: (productId, analysis, fingerprints, now = new Date()) => request('s06_review_analyses', {
      method: 'POST', body: JSON.stringify({
        product_id: productId, analyzed_on: trackingDate(now), review_fingerprints: fingerprints,
        review_count: fingerprints.length, analysis,
      }),
    }),
    settings: async () => {
      const rows = await request('s06_settings?id=eq.true&select=daily_tracking_enabled,updated_at&limit=1');
      return rows[0] || { daily_tracking_enabled: true, updated_at: null };
    },
    updateSettings: (dailyTrackingEnabled) => request('s06_settings?id=eq.true', {
      method: 'PATCH', body: JSON.stringify({ daily_tracking_enabled: Boolean(dailyTrackingEnabled), updated_at: new Date().toISOString() }),
    }),
    trackedProducts: () => request('s06_products?tracking_enabled=is.true&select=*&order=created_at.asc'),
    dashboardRows: async () => {
      const [products, snapshots, reviews, analyses] = await Promise.all([
        request('s06_products?select=id,asin,title,rating,displayed_price,last_checked_at&order=created_at.desc'),
        request('s06_daily_snapshots?select=product_id,tracked_on,rating,displayed_price,visible_review_count&order=tracked_on.desc'),
        request('s06_reviews?select=product_id,fingerprint,review_title,review_text,rating,first_seen_at&order=first_seen_at.desc'),
        request('s06_review_analyses?select=product_id,analyzed_on,review_count,review_fingerprints,analysis&order=analyzed_on.desc'),
      ]);
      return { products, snapshots, reviews, analyses };
    },
    detail: async (productId) => {
      const [product, snapshots, reviews, analyses] = await Promise.all([
        productById(productId),
        request(`s06_daily_snapshots?product_id=eq.${encoded(productId)}&select=tracked_on,checked_at,displayed_price,rating,visible_review_count&order=tracked_on.asc`),
        request(`s06_reviews?product_id=eq.${encoded(productId)}&select=fingerprint,review_title,review_text,rating,first_seen_at,last_seen_at&order=first_seen_at.desc`),
        request(`s06_review_analyses?product_id=eq.${encoded(productId)}&select=analyzed_on,review_count,analysis,created_at&order=created_at.desc`),
      ]);
      return { product, snapshots, reviews, analyses };
    },
  };
}
