const productMeta = import('./product-meta.mjs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const cronSecret = process.env.CRON_SECRET;

const headers = () => ({
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  'content-type': 'application/json',
  'Accept-Profile': 'weekly_projects',
  'Content-Profile': 'weekly_projects',
});

export const priceCents = (value) => {
  const match = String(value || '').match(/\$\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (!match) return null;
  return (Number(match[1].replaceAll(',', '')) * 100) + Number((match[2] || '').padEnd(2, '0'));
};

export const priceDirection = (previous, current) => previous === null || previous === current ? 0 : current > previous ? 1 : -1;

const isSixAmPacific = () => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit',
  hourCycle: 'h23',
}).format(new Date()) === '06';

async function productsToCheck() {
  const response = await fetch(`${supabaseUrl}/rest/v1/s02_products?select=id,asin,source_url,last_price_cents&order=created_at.asc`, { headers: headers() });
  if (!response.ok) throw new Error('가격 확인 대상 제품을 읽지 못했다.');
  return response.json();
}

async function savePrice(product, displayedPrice, currentCents) {
  const direction = priceDirection(product.last_price_cents, currentCents);
  const checkedAt = new Date().toISOString();
  const update = await fetch(`${supabaseUrl}/rest/v1/s02_products?id=eq.${product.id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      displayed_price: displayedPrice,
      last_price_cents: currentCents,
      price_change: direction,
      last_price_checked_at: checkedAt,
    }),
  });
  if (!update.ok) throw new Error(`${product.asin} 가격 저장에 실패했다.`);

  const history = await fetch(`${supabaseUrl}/rest/v1/s02_price_checks`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      product_id: product.id,
      checked_at: checkedAt,
      displayed_price: displayedPrice,
      price_cents: currentCents,
      price_change: direction,
    }),
  });
  if (!history.ok) throw new Error(`${product.asin} 가격 이력 저장에 실패했다.`);
  return direction;
}

export async function runPriceCheck() {
  const { parseProductHtml } = await productMeta;
  const products = await productsToCheck();
  const results = { checked: 0, up: 0, down: 0, unchanged: 0, skipped: 0, failed: 0 };

  for (const product of products) {
    try {
      const response = await fetch(product.source_url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; CartHoarders/1.0; +https://github.com/JOKIM-SQ/naite)',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Amazon 응답 ${response.status}`);
      const parsed = parseProductHtml(await response.text(), product.asin);
      const currentCents = priceCents(parsed.displayedPrice);
      if (currentCents === null) { results.skipped += 1; continue; }
      const direction = await savePrice(product, parsed.displayedPrice, currentCents);
      results.checked += 1;
      if (direction > 0) results.up += 1;
      else if (direction < 0) results.down += 1;
      else results.unchanged += 1;
    } catch {
      results.failed += 1;
    }
  }
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET만 지원한다.' });
  if (!supabaseUrl || !supabaseKey || !cronSecret) return res.status(503).json({ message: '가격 확인 환경변수가 아직 없다.' });
  if (req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ message: 'Cron 요청만 허용한다.' });
  if (!isSixAmPacific()) return res.status(200).json({ skipped: true, message: '오전 6시(태평양 시간) 실행을 기다린다.' });
  try {
    return res.status(200).json(await runPriceCheck());
  } catch (error) {
    return res.status(502).json({ message: error.message });
  }
}
