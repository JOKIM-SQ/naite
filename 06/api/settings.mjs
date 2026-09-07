import { createS06Store } from './s06-store.mjs';

const bodyOf = (req) => typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

export default async function handler(req, res) {
  try {
    const store = createS06Store({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
    if (req.method === 'GET') {
      const settings = await store.settings();
      return res.status(200).json({ dailyTrackingEnabled: settings.daily_tracking_enabled, updatedAt: settings.updated_at });
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST만 지원합니다.' });
    if (!process.env.ADMIN_PIN || req.headers['x-admin-pin'] !== process.env.ADMIN_PIN) return res.status(401).json({ message: '관리자 PIN이 필요합니다.' });
    const { dailyTrackingEnabled } = bodyOf(req);
    if (typeof dailyTrackingEnabled !== 'boolean') return res.status(400).json({ message: '자동 추적 상태를 선택하세요.' });
    await store.updateSettings(dailyTrackingEnabled);
    return res.status(200).json({ dailyTrackingEnabled });
  } catch {
    return res.status(502).json({ message: '관리자 설정을 저장하지 못했습니다.' });
  }
}
