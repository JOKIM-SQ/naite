import { summarizeTodaySignals } from './dashboard-signals.mjs';
import { buildDashboardIntelligence } from './insights-core.mjs';
import { createS06Store, trackingDate } from './s06-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET만 지원합니다.' });
  try {
    const store = createS06Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
    const rows = await store.dashboardRows();
    const today = trackingDate();
    return res.status(200).json({
      ...summarizeTodaySignals({ ...rows, today }),
      ...buildDashboardIntelligence({ ...rows, today }),
    });
  } catch {
    return res.status(502).json({ message: '오늘의 변화 신호를 읽지 못했습니다.' });
  }
}
