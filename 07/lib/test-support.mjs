// Test-only external HTTP fixture, excluded from production imports.
import assert from 'node:assert/strict';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const testAccounts = {
  a: { id: '11111111-1111-4111-8111-111111111111', accessToken: 'test-user-a-access-token' },
  b: { id: '22222222-2222-4222-8222-222222222222', accessToken: 'test-user-b-access-token' },
};

// Only the remote HTTP boundary is replaced. The real route, validation,
// Supabase adapter, extraction parser, authentication, and revision logic all run.
export function createTestService({ origin = 'https://receipts.supabase.co', extracted = { merchant: '시장', date: '2026-09-16', total: 14.5, currency: 'USD', category: '장보기' } } = {}) {
  const rows = [], objects = new Map(), calls = [];
  const authUsers = new Map(Object.values(testAccounts).map((account) => [account.accessToken, {
    id: account.id, aud: 'authenticated', role: 'authenticated', email: `${account.id}@example.test`,
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, is_anonymous: false,
    created_at: '2026-09-17T00:00:00.000Z', updated_at: '2026-09-17T00:00:00.000Z',
  }]));
  const state = { rows, objects, calls, authUsers, failAuth: false, hangAuth: false, failOcr: false, hangOcr: false, failStore: false, extracted: structuredClone(extracted) };
  state.fetch = async (target, init = {}) => {
    const url = new URL(target), method = init.method || 'GET';
    calls.push({ url, method, init });
    if (url.origin === 'https://api.anthropic.com') {
      if (state.hangOcr) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      if (state.failOcr) return reply({ error: { message: `upstream leak sk-ant-test_server_only` } }, 429);
      return reply({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: JSON.stringify(state.extracted) }], stop_reason: 'end_turn', usage: { input_tokens: 123, output_tokens: 30 } });
    }
    assert.equal(url.origin, origin, '사용자가 제공한 임의 URL로 요청하면 안 된다');
    if (url.pathname === '/auth/v1/user') {
      if (state.hangAuth) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      if (state.failAuth) return reply({ message: 'upstream auth error sb_secret_test_server_only' }, 503);
      const user = authUsers.get(String(init.headers?.Authorization || '').replace(/^Bearer /, ''));
      return user ? reply(user) : reply({ code: 401, error_code: 'bad_jwt', msg: 'Invalid JWT' }, 401);
    }
    if (state.failStore) return reply({ message: `upstream leak sb_secret_test_server_only` }, 500);
    if (url.pathname === '/rest/v1/s07_receipts') {
      const matches = (row) => ['id', 'user_id', 'session_hash', 'revision', 'status'].every((key) => !url.searchParams.has(key) || String(row[key]) === url.searchParams.get(key).slice(3));
      if (method === 'GET') {
        const cursor = url.searchParams.get('or')?.match(/^\(created_at.lt.([^,]+),and\(created_at.eq.[^,]+,id.lt.([^\)]+)\)\)$/);
        const sorted = rows.filter(matches).filter((row) => !cursor || row.created_at < cursor[1] || (row.created_at === cursor[1] && row.id < cursor[2]))
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        const offset = Number(url.searchParams.get('offset') || 0);
        return reply(structuredClone(sorted.slice(offset, offset + Math.min(Number(url.searchParams.get('limit') || 1000), state.pageSize || 1000))));
      }
      if (method === 'POST') {
        const row = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(), original_values: null, edited_values: null, error: null, revision: 0, correction_count: 0, user_id: null, session_hash: null, ...JSON.parse(init.body) };
        rows.push(row); return reply([structuredClone(row)], 201);
      }
      if (method === 'PATCH') {
        if (state.failDeleteClaim && JSON.parse(init.body).status === 'deleting') return reply({ message: 'deleting status unavailable' }, 400);
        if (state.beforePatch) await state.beforePatch({ url, init });
        const changed = rows.filter(matches);
        for (const row of changed) Object.assign(row, JSON.parse(init.body));
        return reply(structuredClone(changed));
      }
      if (method === 'DELETE') {
        if (state.failRowDelete) return reply({ message: 'database delete failure' }, 503);
        const removed = rows.filter(matches);
        for (const row of removed) rows.splice(rows.indexOf(row), 1);
        if (state.loseRowDeleteResponse) throw new Error('connection lost after committed delete');
        return reply(structuredClone(removed));
      }
    }
    const base = '/storage/v1/object/';
    if (url.pathname.startsWith(`${base}sign/`)) {
      if (state.beforeSign) await state.beforeSign();
      const path = url.pathname.slice(`${base}sign/`.length);
      return objects.has(path) ? reply({ signedURL: `/object/sign/${path}?token=temporary` }) : reply({ error: 'not found' }, 404);
    }
    if (url.pathname.startsWith(base)) {
      if (method === 'DELETE') {
        if (state.beforeObjectDelete) await state.beforeObjectDelete();
        if (state.failObjectDelete) return reply({ message: 'storage delete failure' }, 503);
        const removed = [];
        for (const prefix of JSON.parse(init.body).prefixes) {
          const key = `${url.pathname.slice(base.length)}/${prefix}`;
          if (objects.delete(key)) removed.push({ name: prefix });
        }
        if (state.loseObjectDeleteResponse) throw new Error('connection lost after object delete');
        return reply(removed);
      }
      const path = url.pathname.slice(base.length).replace(/^authenticated\//, '');
      if (method === 'POST') { objects.set(path, Buffer.from(init.body)); return reply({ Key: path }, 200); }
      return objects.has(path) ? new Response(objects.get(path)) : reply({ error: 'not found' }, 404);
    }
    throw new Error(`Unexpected test HTTP request: ${method} ${url.pathname}`);
  };
  return state;
}
