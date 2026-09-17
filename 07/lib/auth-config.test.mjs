import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/auth-config.mjs';

const env = { SUPABASE_URL: 'https://receipts.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_server', ANTHROPIC_API_KEY: 'sk-ant-private' };
function call(config = env, method = 'GET') {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  createHandler({ env: config })({ method }, res);
  return res;
}

test('browser configuration contains only the Supabase URL and public login key', () => {
  const response = call();
  assert.equal(response.code, 200);
  assert.deepEqual(response.body, { url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, provider: 'google' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('server keys cannot accidentally be returned as browser keys', () => {
  const jwt = role => 'e30.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.signature';
  for (const key of ['', '[SENSITIVE]', 'sb_secret_oops', jwt('service_role'), 'unrecognized']) {
    const response = call({ ...env, SUPABASE_PUBLISHABLE_KEY: key });
    assert.equal(response.code, 503);
    assert.deepEqual(Object.keys(response.body), ['message']);
  }
  assert.equal(call({ ...env, SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).code, 200);
});

test('configuration rejects unsafe project URLs and non-GET requests', () => {
  assert.equal(call({ ...env, SUPABASE_URL: 'http://receipts.supabase.co' }).code, 503);
  assert.equal(call(env, 'POST').code, 405);
});
