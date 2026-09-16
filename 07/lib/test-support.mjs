// Test-only external HTTP fixture, excluded from production imports.
import assert from 'node:assert/strict';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Only the remote HTTP boundary is replaced. The real route, validation,
// Supabase adapter, extraction parser, cookie, and revision logic all run.
export function createTestService({ origin = 'https://receipts.supabase.co', extracted = { merchant: '시장', date: '2026-09-16', total: 14.5, currency: 'USD', items: [{ name: '과일', quantity: 2, amount: 14.5 }] } } = {}) {
  const rows = [], objects = new Map(), calls = [];
  const state = { rows, objects, calls, failOcr: false, hangOcr: false, failStore: false, extracted: structuredClone(extracted) };
  state.fetch = async (target, init = {}) => {
    const url = new URL(target), method = init.method || 'GET';
    calls.push({ url, method, init });
    if (url.origin === 'https://api.anthropic.com') {
      if (state.hangOcr) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      if (state.failOcr) return reply({ error: { message: `upstream leak sk-ant-test_server_only` } }, 429);
      return reply({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: JSON.stringify(state.extracted) }], stop_reason: 'end_turn', usage: { input_tokens: 123, output_tokens: 30 } });
    }
    assert.equal(url.origin, origin, '사용자가 제공한 임의 URL로 요청하면 안 된다');
    if (state.failStore) return reply({ message: `upstream leak sb_secret_test_server_only` }, 500);
    if (url.pathname === '/rest/v1/s07_receipts') {
      const matches = (row) => ['id', 'session_hash', 'revision', 'status'].every((key) => !url.searchParams.has(key) || String(row[key]) === url.searchParams.get(key).slice(3));
      if (method === 'GET') return reply(rows.filter(matches).slice(-30).reverse());
      if (method === 'POST') {
        const row = { created_at: new Date().toISOString(), updated_at: new Date().toISOString(), original_values: null, edited_values: null, error: null, revision: 0, correction_count: 0, ...JSON.parse(init.body) };
        rows.push(row); return reply([structuredClone(row)], 201);
      }
      if (method === 'PATCH') {
        const changed = rows.filter(matches);
        for (const row of changed) Object.assign(row, JSON.parse(init.body));
        return reply(structuredClone(changed));
      }
    }
    const base = '/storage/v1/object/';
    if (url.pathname.startsWith(`${base}sign/`)) {
      const path = url.pathname.slice(`${base}sign/`.length);
      return objects.has(path) ? reply({ signedURL: `/object/sign/${path}?token=temporary` }) : reply({ error: 'not found' }, 404);
    }
    if (url.pathname.startsWith(base)) {
      const path = url.pathname.slice(base.length).replace(/^authenticated\//, '');
      if (method === 'POST') { objects.set(path, Buffer.from(init.body)); return reply({ Key: path }, 200); }
      return objects.has(path) ? new Response(objects.get(path)) : reply({ error: 'not found' }, 404);
    }
    throw new Error(`Unexpected test HTTP request: ${method} ${url.pathname}`);
  };
  return state;
}
