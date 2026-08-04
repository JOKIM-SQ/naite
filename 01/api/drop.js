// 서버 함수 1개로 끝낸다 — GET=목록, POST=드랍.
// 키를 클라이언트에 두지 않기 위해 목록 조회도 여기서 프록시한다 (CLAUDE.md 규칙 6).
// sites 테이블은 팀 공유 레지스트리다. 스키마를 바꾸지 않고, 남의 행을 덮어쓰지 않는다.

// publishable(anon) 키로 충분하다 — sites 의 RLS 가 anon 읽기·쓰기를 허용한다 (실측).
// service_role 은 쓰지 않는다. 이 키도 클라이언트가 아니라 서버 환경변수에만 둔다.
const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

const headers = () => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
});

// data-f 규약에서 값을 뽑는다 (SPIKE.md 2번에서 검증한 코드)
function parsePlan(html) {
  const text = (f) => {
    const m = html.match(new RegExp(`data-f="${f}"[^>]*>([\\s\\S]*?)</`, 'i'));
    if (!m) return null;
    const v = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return v && v !== '기록 없음' ? v : null;
  };
  const repoHref = () => {
    const m = html.match(/data-f="repo"[^>]*href="([^"]*)"/i)
           || html.match(/href="([^"]*)"[^>]*data-f="repo"/i);
    const v = m && m[1];
    // 템플릿 기본값이 그대로 남아 있으면 소스 없음이다 (SPIKE.md 2번 부수 발견)
    return v && v !== 'https://github.com/' && v !== '../' ? v : null;
  };
  return {
    title: text('title'),
    intro: text('intro'),
    sprint: text('sprint'),
    author: text('author'),
    stack_option: text('option'),
    repo: repoHref(),
  };
}

export default async function handler(req, res) {
  if (!SUPA || !KEY) {
    return res.status(500).json({ message: '서버 환경변수가 없다. SUPABASE_URL / SUPABASE_ANON_KEY 확인.' });
  }

  if (req.method === 'GET') {
    const r = await fetch(`${SUPA}/rest/v1/sites?select=*&order=created_at.desc`, { headers: headers() });
    if (!r.ok) return res.status(502).json({ message: '레지스트리 조회 실패.' });
    return res.status(200).json(await r.json());
  }

  if (req.method !== 'POST') return res.status(405).json({ message: 'GET 또는 POST.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  let url;
  try {
    const u = new URL(body.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    url = u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return res.status(400).json({ message: 'URL 형식이 아니다.' });
  }

  // 규약 준수면 기획서에서 채우고, 아니면 도메인 카드로 폴백한다 — 드랍 실패는 없다
  let meta = { title: null, intro: null, sprint: null, author: null, stack_option: null, repo: null };
  let fallback = true;
  try {
    const r = await fetch(`${url}/docs/plan.html`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const parsed = parsePlan(await r.text());
      if (parsed.title || parsed.author || parsed.sprint) { meta = parsed; fallback = false; }
    }
  } catch {
    // 기획서를 못 읽어도 계속 간다
  }
  if (fallback) meta.title = new URL(url).hostname;

  const ins = await fetch(`${SUPA}/rest/v1/sites`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify({ url, ...meta, shot_url: body.shot_url || null }),
  });

  // 공유 테이블이라 업서트하지 않는다 — 중복은 알리고 끝낸다
  if (ins.status === 409) return res.status(200).json({ message: '이미 등록된 URL이다.' });
  if (!ins.ok) return res.status(502).json({ message: '저장 실패.' });

  return res.status(200).json({
    message: fallback ? '기획서를 못 읽어 도메인 카드로 등록했다.' : `${meta.title} 등록됐다.`,
  });
}
