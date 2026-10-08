import test from 'node:test';
import assert from 'node:assert/strict';

const config = await import('../api/config.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
function request(env, method = 'GET') {
  let status = 200;
  let body = '';
  const headers = {};
  const res = { setHeader(k, v) { headers[k] = v; }, set statusCode(v) { status = v; }, end(value) { body = value; } };
  config.createHandler?.({ env })?.({ method }, res);
  return { status, body: body ? JSON.parse(body) : null, headers };
}
const valid = { SUPABASE_URL: 'https://kmfoeoxvsadlurpmkqwh.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example', SUPABASE_SERVICE_ROLE_KEY: 'server-only-secret' };
test('public configuration returns only the URL, publishable key and Google provider', () => {
  assert.deepEqual(request(valid).body, { url: valid.SUPABASE_URL, publishableKey: valid.SUPABASE_PUBLISHABLE_KEY, provider: 'google' });
});
test('secret or malformed configuration fails closed instead of exposing a key', () => {
  for (const env of [{ ...valid, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' }, { ...valid, SUPABASE_URL: 'https://name:password@example.com/' }, {}]) {
    const r = request(env); assert.equal(r.status, 503); assert.equal(JSON.stringify(r.body).includes('server-only-secret'), false);
  }
});
test('configuration rejects mutations and does not permit cached credentials', () => {
  assert.equal(request(valid, 'POST').status, 405);
  assert.equal(request(valid).headers['Cache-Control'], 'no-store');
});
