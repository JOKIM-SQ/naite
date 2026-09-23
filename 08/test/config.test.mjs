import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/config.mjs';

const env = { SUPABASE_URL: 'https://inventory.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_browser', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_private' };
function call(overrides = {}, method = 'GET') {
  const res = {
    headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
  createHandler({ env: { ...env, ...overrides } })({ method }, res);
  return res;
}

test('browser config allows public keys but never includes server credentials', () => {
  const result = call();
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { url: 'https://inventory.supabase.co', publishableKey: 'sb_publishable_browser', provider: 'google' });
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('accidentally configuring a secret or service-role JWT fails closed', () => {
  const jwt = role => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
  for (const key of ['sb_secret_private', jwt('service_role'), '', 'invalid']) {
    const result = call({ SUPABASE_PUBLISHABLE_KEY: key });
    assert.equal(result.code, 503);
    assert.deepEqual(Object.keys(result.body), ['message']);
  }
  assert.equal(call({ SUPABASE_PUBLISHABLE_KEY: jwt('anon') }).code, 200);
});

test('invalid origins and write methods cannot produce browser configuration', () => {
  for (const url of ['', 'http://inventory.supabase.co', 'https://user:password@inventory.supabase.co', 'https://inventory.supabase.co/private', 'https://inventory.supabase.co/?secret=x']) {
    assert.equal(call({ SUPABASE_URL: url }).code, 503);
  }
  assert.equal(call({}, 'POST').code, 405);
});
