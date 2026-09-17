import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/receipts.mjs';
import { createReceiptStore } from './receipt-store.mjs';
import { createTestService as service, testAccounts } from './test-support.mjs';

const env = { SUPABASE_URL: 'https://receipts.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_server_only', ANTHROPIC_API_KEY: 'sk-ant-test_server_only', NODE_ENV: 'production' };
const cookie = `s07_session=${'a'.repeat(43)}`;
const authorization = `Bearer ${testAccounts.a.accessToken}`;
const value = () => ({ merchant: '시장', date: '2026-09-16', total: 14.5, currency: 'USD', items: [{ name: '과일', quantity: 2, amount: 14.5 }] });
const upload = () => ({ action: 'upload', fileName: '영수증.png', mediaType: 'image/png', data: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64') });
async function request(handler, method = 'GET', body, headers = {}) {
  const response = { headers: {}, statusCode: 200, setHeader(key, item) { this.headers[key.toLowerCase()] = item; }, status(code) { this.statusCode = code; return this; }, json(item) { this.body = item; return this; } };
  await handler({ method, body, headers: { host: 'receipts.example.com', 'x-forwarded-proto': 'https', cookie, authorization, ...headers } }, response);
  return response;
}

test('GET은 Supabase에서 토큰을 검증하고 확인한 사용자 ID로만 조회한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const response = await request(handler, 'GET', undefined, { cookie: '' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { receipts: [] });
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(remote.calls[0].url.pathname, '/auth/v1/user');
  assert.equal(remote.calls[0].init.headers.Authorization, authorization);
  assert.equal(remote.calls[0].init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
  const query = remote.calls.find((call) => call.url.pathname === '/rest/v1/s07_receipts');
  assert.equal(query.url.searchParams.get('user_id'), `eq.${testAccounts.a.id}`);
  assert.equal(query.url.searchParams.has('session_hash'), false);
  assert.equal(query.init.headers['Accept-Profile'], 'weekly_projects');
});

test('원본 저장과 행 생성 뒤 실제 이미지 및 JSON schema로 추출하여 돌려준다', async () => {
  const remote = service(), response = await request(createHandler({ env, fetchImpl: remote.fetch }), 'POST', upload());
  assert.equal(response.statusCode, 201);
  assert.equal(response.body?.receipt?.status, 'ready');
  assert.deepEqual(response.body.receipt.original, value());
  assert.deepEqual(response.body.receipt.values, value());
  assert.equal(response.body.receipt.correctionCount, 0);
  assert.match(response.body.receipt.imageUrl, /^https:\/\/receipts.supabase.co\/storage\/v1\/object\/sign\//);
  assert.equal(remote.rows[0].user_id, testAccounts.a.id);
  assert.equal(remote.rows[0].session_hash, null);
  assert.ok(remote.rows[0].storage_path.startsWith(`${testAccounts.a.id}/`));
  assert.deepEqual([...remote.objects.values()][0], Buffer.from(upload().data, 'base64'));
  const ocr = remote.calls.find((call) => call.url.origin === 'https://api.anthropic.com');
  assert.ok(remote.calls.indexOf(ocr) > remote.calls.findIndex((call) => call.method === 'POST' && call.url.pathname === '/rest/v1/s07_receipts'));
  const payload = JSON.parse(ocr.init.body);
  assert.equal(payload.output_config.format.type, 'json_schema');
  assert.equal(payload.output_config.format.schema.additionalProperties, false);
  assert.equal(payload.messages[0].content[0].source.data, upload().data);
  assert.equal(payload.messages[0].content[0].source.type, 'base64');
  assert.ok(ocr.init.signal instanceof AbortSignal);
});

test('다른 계정은 같은 과거 쿠키가 있어도 목록·편집·재분석에서 원본과 값을 볼 수 없다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = await request(handler, 'POST', upload()), id = uploaded.body?.receipt?.id;
  const other = { authorization: `Bearer ${testAccounts.b.accessToken}` };
  const before = remote.calls.length;
  assert.deepEqual((await request(handler, 'GET', undefined, other)).body, { receipts: [] });
  assert.equal((await request(handler, 'PATCH', { id, values: value(), revision: 1 }, other)).statusCode, 404);
  assert.equal((await request(handler, 'POST', { action: 'retry', id }, other)).statusCode, 404);
  assert.equal(remote.calls.slice(before).filter((call) => call.url.pathname.startsWith('/storage/') || call.url.origin === 'https://api.anthropic.com').length, 0);
});

test('AI 오류 후에도 재시도할 원본과 failed 행을 남기며 외부 오류/키를 숨긴다', async () => {
  const remote = service(); remote.failOcr = true;
  const handler = createHandler({ env, fetchImpl: remote.fetch });
  const failed = await request(handler, 'POST', upload());
  assert.equal(failed.body?.receipt?.status, 'failed');
  assert.equal(failed.body.receipt.original, null);
  assert.equal(remote.objects.size, 1);
  assert.ok(!JSON.stringify(failed).includes('sk-ant-'));
  remote.failOcr = false;
  const retried = await request(handler, 'POST', { action: 'retry', id: failed.body.receipt.id });
  assert.equal(retried.body?.receipt?.status, 'ready');
  assert.deepEqual(retried.body.receipt.original, value());
  assert.equal(remote.rows.length, 1);
  assert.equal(remote.objects.size, 1);
});

test('동일 revision 두 저장은 하나만 성공하며 최초 추출을 덮어쓰지 않는다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body?.receipt;
  assert.ok(uploaded, '업로드가 영수증을 돌려줘야 한다');
  const a = { id: uploaded.id, revision: uploaded.revision, values: { ...value(), total: 20 } };
  const b = { id: uploaded.id, revision: uploaded.revision, values: { ...value(), total: 30 } };
  const responses = await Promise.all([request(handler, 'PATCH', a), request(handler, 'PATCH', b)]);
  assert.deepEqual(responses.map((result) => result.statusCode).sort(), [200, 409]);
  const saved = responses.find((result) => result.statusCode === 200).body.receipt;
  assert.equal(saved.correctionCount, 1);
  assert.equal(saved.revision, uploaded.revision + 1);
  assert.deepEqual(saved.original, value());
  assert.equal((await request(handler)).body.receipts[0].values.total, saved.values.total);
  const same = await request(handler, 'PATCH', { id: saved.id, revision: saved.revision, values: saved.values });
  assert.equal(same.body.receipt.correctionCount, 1);
});

test('재분석의 다른 추출 결과가 최초 원본과 사용자 수정값을 지우지 않는다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body?.receipt;
  assert.ok(uploaded, '업로드가 영수증을 돌려줘야 한다');
  const edited = { ...value(), total: 25 };
  await request(handler, 'PATCH', { id: uploaded.id, revision: uploaded.revision, values: edited });
  remote.extracted = { ...value(), total: 999 };
  const retried = await request(handler, 'POST', { action: 'retry', id: uploaded.id });
  assert.deepEqual(retried.body.receipt.original, value());
  assert.deepEqual(retried.body.receipt.values, edited);
  assert.equal(retried.body.receipt.correctionCount, 1);
});

test('ready 상태가 아닌 행은 편집할 수 없고 중복 재분석은 거부된다', async () => {
  const remote = service(); remote.failOcr = true;
  const handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body?.receipt;
  assert.ok(uploaded, '실패도 저장된 영수증을 돌려줘야 한다');
  assert.equal((await request(handler, 'PATCH', { id: uploaded.id, revision: uploaded.revision, values: value() })).statusCode, 409);
  remote.rows[0].status = 'processing';
  assert.equal((await request(handler, 'POST', { action: 'retry', id: uploaded.id })).statusCode, 409);
  remote.rows[0].updated_at = '2020-01-01T00:00:00Z'; remote.failOcr = false;
  assert.equal((await request(handler, 'POST', { action: 'retry', id: uploaded.id })).body.receipt.status, 'ready');
});

test('값 검증·교차 출처·잘못된 JSON은 저장·OCR 요청 전에 거부한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  assert.equal((await request(handler, 'POST', upload(), { origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await request(handler, 'POST', '{')).statusCode, 400);
  assert.equal((await request(handler, 'POST', { ...upload(), data: 'https://localhost/secrets' })).statusCode, 422);
  assert.equal((await request(handler, 'PATCH', { id: 'not-a-uuid', revision: 0, values: value() })).statusCode, 422);
  assert.equal(remote.calls.filter((call) => call.url.pathname !== '/auth/v1/user').length, 0);
});

test('미설정 환경과 Supabase 오류는 키나 외부 내부정보 없이 명시적으로 실패한다', async () => {
  const remote = service();
  assert.equal((await request(createHandler({ env: {}, fetchImpl: remote.fetch }))).statusCode, 503);
  assert.equal(remote.calls.length, 0);
  remote.failStore = true;
  const failed = await request(createHandler({ env, fetchImpl: remote.fetch }));
  assert.equal(failed.statusCode, 502);
  assert.ok(!JSON.stringify(failed).includes('sb_secret_'));
});

test('느린 AI 요청을 서버가 중단하고 재시도 가능한 failed 결과를 돌려준다', async () => {
  const remote = service(); remote.hangOcr = true;
  const result = await request(createHandler({ env, fetchImpl: remote.fetch, ocrTimeoutMs: 15 }), 'POST', upload());
  assert.equal(result.body?.receipt?.status, 'failed');
  assert.equal(remote.rows.length, 1);
  assert.ok(remote.calls.find((call) => call.url.origin === 'https://api.anthropic.com')?.init.signal.aborted);
});

test('서버의 명시적 모델 설정을 구조화 추출 요청에 전달한다', async () => {
  const remote = service();
  const result = await request(createHandler({ env: { ...env, ANTHROPIC_MODEL: 'claude-sonnet-4-6' }, fetchImpl: remote.fetch }), 'POST', upload());
  assert.equal(result.body?.receipt?.status, 'ready');
  const call = remote.calls.find((item) => item.url.origin === 'https://api.anthropic.com');
  assert.equal(JSON.parse(call.init.body).model, 'claude-sonnet-4-6');
});

test('같은 호스트라도 HTTP 출처에서 HTTPS 쿠키를 사용하는 변경 요청은 거부한다', async () => {
  const remote = service();
  const result = await request(createHandler({ env, fetchImpl: remote.fetch }), 'POST', upload(), { origin: 'http://receipts.example.com' });
  assert.equal(result.statusCode, 403);
  assert.equal(remote.calls.length, 0);
});

test('누락·만료·위조·다른 프로젝트 토큰은 모든 작업에서 401이며 저장과 OCR을 실행하지 않는다', async () => {
  for (const auth of ['', 'Basic credential', 'Bearer expired', 'Bearer forged.jwt.signature', 'Bearer other-project-token']) {
    const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
    for (const [method, body] of [['GET', undefined], ['POST', upload()], ['PATCH', { id: testAccounts.a.id, revision: 0, values: value() }]]) {
      const response = await request(handler, method, body, { authorization: auth });
      assert.equal(response.statusCode, 401, `${method} ${auth || 'missing'}`);
      assert.ok(!JSON.stringify(response.body).includes('sb_secret_'));
    }
    assert.equal(remote.calls.filter((call) => call.url.pathname !== '/auth/v1/user').length, 0);
  }
});

test('Auth 서버 장애와 timeout은 인증 성공으로 간주하지 않는다', async () => {
  for (const mode of ['failAuth', 'hangAuth']) {
    const remote = service(); remote[mode] = true;
    const response = await request(createHandler({ env, fetchImpl: remote.fetch, timeoutMs: 15 }), 'POST', upload());
    assert.equal(response.statusCode, 502);
    assert.equal(remote.calls.filter((call) => call.url.pathname !== '/auth/v1/user').length, 0);
    assert.ok(!JSON.stringify(response.body).includes('sb_secret_'));
  }
});

test('요청 본문과 사용자 metadata의 다른 소유자 ID는 검증한 계정을 바꾸지 못한다', async () => {
  const remote = service();
  remote.authUsers.get(testAccounts.a.accessToken).user_metadata = { id: testAccounts.b.id, user_id: testAccounts.b.id };
  const response = await request(createHandler({ env, fetchImpl: remote.fetch }), 'POST', { ...upload(), user_id: testAccounts.b.id });
  assert.equal(response.statusCode, 201);
  assert.equal(remote.rows[0].user_id, testAccounts.a.id);
  assert.ok(remote.rows[0].storage_path.startsWith(`${testAccounts.a.id}/`));
});

test('동일 계정의 갱신 토큰과 다른 브라우저에서도 기록을 복원한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.authUsers.set('refreshed-access-token', structuredClone(remote.authUsers.get(testAccounts.a.accessToken)));
  const restored = await request(handler, 'GET', undefined, { cookie: '', authorization: 'Bearer refreshed-access-token' });
  assert.equal(restored.body.receipts.length, 1);
  assert.equal(restored.body.receipts[0].id, uploaded.id);
});

test('기존 익명 행은 자동 귀속하지 않고 로그인 계정에 노출하지 않는다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  await request(handler, 'POST', upload());
  const legacyId = '33333333-3333-4333-8333-333333333333';
  const legacyHash = '66d34fba71f8f450f7e45598853e53bfc23bbd129027cbb131a2f4ffd7878cd0';
  remote.rows.push({ ...structuredClone(remote.rows[0]), id: legacyId, user_id: null, session_hash: legacyHash, storage_path: `${legacyHash}/${legacyId}.png` });
  const listed = await request(handler);
  assert.equal(listed.body.receipts.length, 1);
  assert.equal((await request(handler, 'POST', { action: 'retry', id: legacyId })).statusCode, 404);
  assert.equal(remote.rows.find((row) => row.id === legacyId).user_id, null);
});

test('Store는 다른 소유자의 행을 전달해도 자신의 사용자 ID 조건으로만 수정한다', async () => {
  const remote = service();
  await request(createHandler({ env, fetchImpl: remote.fetch }), 'POST', upload());
  const otherStore = createReceiptStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, userId: testAccounts.b.id, fetchImpl: remote.fetch, timeoutMs: 100 });
  await assert.rejects(() => otherStore.update(remote.rows[0], { edited_values: { ...value(), total: 1 }, correction_count: 1 }), (error) => error.status === 409 || error.status === 404);
  assert.equal(remote.rows[0].edited_values.total, 14.5);
});

test('Store는 다른 계정 경로의 업로드·다운로드·서명 요청을 외부에 보내지 않는다', async () => {
  const remote = service();
  const store = createReceiptStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, userId: testAccounts.a.id, fetchImpl: remote.fetch, timeoutMs: 100 });
  const path = `${testAccounts.b.id}/33333333-3333-4333-8333-333333333333.png`;
  for (const candidate of [path, `${testAccounts.a.id}/../${path}`]) {
    for (const run of [() => store.upload(candidate, Buffer.from(upload().data, 'base64'), 'image/png'), () => store.download(candidate), () => store.signedUrl(candidate)]) {
      await assert.rejects(async () => run(), (error) => error.status === 404);
    }
  }
  assert.equal(remote.calls.length, 0);
});

test('익명 Auth 사용자와 유효하지 않은 Auth 사용자 응답은 소유자로 사용하지 않는다', async () => {
  for (const user of [{ id: testAccounts.a.id, is_anonymous: true }, { id: 'not-a-user-uuid' }]) {
    const remote = service(); remote.authUsers.set(testAccounts.a.accessToken, user);
    const result = await request(createHandler({ env, fetchImpl: remote.fetch }));
    assert.ok([401, 502].includes(result.statusCode));
    assert.equal(remote.calls.filter((call) => call.url.pathname !== '/auth/v1/user').length, 0);
  }
});
