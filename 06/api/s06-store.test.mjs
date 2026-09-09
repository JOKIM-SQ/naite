import assert from 'node:assert/strict';
import test from 'node:test';

import { createS06Store } from './s06-store.mjs';

function requestHeaders(key) {
  let headers;
  const store = createS06Store({
    url: 'https://example.supabase.co', key,
    fetchImpl: async (_url, options) => { headers = options.headers; return new Response('[]', { status: 200 }); },
  });
  return store.listProducts().then(() => headers);
}

test('레거시 service_role 키는 apikey와 Bearer 헤더를 함께 사용한다', async () => {
  const headers = await requestHeaders('eyJlegacy-service-role');
  assert.equal(headers.apikey, 'eyJlegacy-service-role');
  assert.equal(headers.Authorization, 'Bearer eyJlegacy-service-role');
});

test('최신 Supabase secret 키는 apikey 헤더로만 서버 요청을 보낸다', async () => {
  const headers = await requestHeaders('sb_secret_new_server_key');
  assert.equal(headers.apikey, 'sb_secret_new_server_key');
  assert.equal(headers.Authorization, undefined);
});
