import { createS06Store } from './s06-store.mjs';
import { syncTrackedProduct } from './tracker.mjs';

export const isSixAmPacific = (now = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(now) === '06';

export async function runDailyTracking({ store, apiKey, model, now = new Date(), fetchImpl = fetch }) {
  const settings = await store.settings();
  if (!settings.daily_tracking_enabled) return { skipped: true, reason: 'disabled' };
  const products = await store.trackedProducts();
  const result = { checked: 0, newReviews: 0, analyzed: 0, failed: 0 };
  for (const product of products) {
    try {
      const synced = await syncTrackedProduct({ store, product, apiKey, model, now, fetchImpl });
      result.checked += 1;
      result.newReviews += synced.newReviews;
      if (synced.analyzed) result.analyzed += 1;
    } catch { result.failed += 1; }
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET만 지원합니다.' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.CRON_SECRET || !process.env.ANTHROPIC_API_KEY) return res.status(503).json({ message: '일별 추적 환경변수가 아직 없습니다.' });
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ message: 'Cron 요청만 허용합니다.' });
  if (!isSixAmPacific()) return res.status(200).json({ skipped: true, reason: 'waiting-for-6am-pacific' });
  try {
    const store = createS06Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
    return res.status(200).json(await runDailyTracking({ store, apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' }));
  } catch {
    return res.status(502).json({ message: '일별 추적을 시작하지 못했습니다.' });
  }
}
