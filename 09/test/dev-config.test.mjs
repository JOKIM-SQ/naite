import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startServer } from '../scripts/dev.mjs';

test('development server exposes the same public configuration route and refuses mutations', async t => {
  const server = startServer(0, { SUPABASE_URL: 'https://kmfoeoxvsadlurpmkqwh.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example', SUPABASE_SERVICE_ROLE_KEY: 'secret-must-stay-server-side' });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: 'https://kmfoeoxvsadlurpmkqwh.supabase.co', publishableKey: 'sb_publishable_example', provider: 'google' });
  assert.equal((await fetch(`${origin}/api/config`, { method: 'POST' })).status, 405);
});
