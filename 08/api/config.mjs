function isPublicKey(key) {
  if (typeof key !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    return key.split('.').length === 3 && JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
  } catch { return false; }
}

export function createHandler({ env = process.env } = {}) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ message: 'GET만 지원합니다.' });
    }
    let url;
    try { url = new URL(env.SUPABASE_URL); } catch { /* Configuration not ready. */ }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !isPublicKey(env.SUPABASE_PUBLISHABLE_KEY)) {
      return res.status(503).json({ message: '로그인 연결 설정이 필요합니다.' });
    }
    return res.status(200).json({ url: url.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, provider: 'google' });
  };
}

export default createHandler();
