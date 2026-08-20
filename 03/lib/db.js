// PostgREST 위에 직접 fetch — RLS를 안 쓰므로 service_role 키로만 접근한다.
// 소유권·투표 한도 검증은 각 API 라우트에서 세션 사용자 id로 직접 한다.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function pgFetch(path, init = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없다.');
  }
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'weekly_projects',
      'Content-Profile': 'weekly_projects',
      ...(init.headers || {}),
    },
  });
}
