function isPublishableKey(key) {
  if (typeof key !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; }
  catch { return false; }
}
export function createHandler({ env = process.env } = {}) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; return res.end(JSON.stringify({ message: 'GET만 지원합니다.' })); }
    let url;
    try { url = new URL(env.SUPABASE_URL); } catch {}
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !isPublishableKey(env.SUPABASE_PUBLISHABLE_KEY)) {
      res.statusCode = 503; return res.end(JSON.stringify({ message: '클라우드 연결 설정이 필요합니다.' }));
    }
    res.statusCode = 200;
    return res.end(JSON.stringify({ url: url.origin, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, provider: 'google' }));
  };
}
export default createHandler();
