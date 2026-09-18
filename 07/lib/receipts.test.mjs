import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/receipts.mjs';
import { createReceiptStore } from './receipt-store.mjs';
import { createTestService as service, testAccounts } from './test-support.mjs';

const env = { SUPABASE_URL: 'https://receipts.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_server_only', ANTHROPIC_API_KEY: 'sk-ant-test_server_only', NODE_ENV: 'production' };
const cookie = `s07_session=${'a'.repeat(43)}`;
const authorization = `Bearer ${testAccounts.a.accessToken}`;
const value = () => ({ merchant: '시장', date: '2026-09-16', total: 14.5, currency: 'USD', category: '장보기' });
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

test('전체 기록은 서버 페이지 상한이 작아도 누락·중복 없이 계정 범위로 읽는다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  await request(handler, 'POST', upload());
  const row = remote.rows[0];
  remote.rows.length = 0;
  for (let index = 0; index < 73; index += 1) {
    remote.rows.push({ ...structuredClone(row), id: `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`, created_at: '2026-09-01T00:00:00.000Z' });
  }
  remote.rows.push({ ...structuredClone(row), id: '44444444-3333-4333-8333-333333333333', user_id: testAccounts.b.id });
  remote.pageSize = 7;
  let signing = 0, maxSigning = 0;
  remote.beforeSign = async () => {
    signing += 1; maxSigning = Math.max(maxSigning, signing);
    await new Promise((resolve) => setImmediate(resolve));
    signing -= 1;
  };
  const response = await request(handler);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.receipts.length, 73);
  assert.equal(new Set(response.body.receipts.map((receipt) => receipt.id)).size, 73);
  assert.equal(response.body.receipts[0].id, '00000072-3333-4333-8333-333333333333');
  assert.equal(response.body.receipts.at(-1).id, '00000000-3333-4333-8333-333333333333');
  assert.ok(maxSigning <= 10, '전체 기록의 원본 서명 요청은 동시 10개 이하여야 한다');
  assert.ok(remote.calls.filter((call) => call.method === 'GET' && call.url.pathname === '/rest/v1/s07_receipts').every((call) => call.url.searchParams.get('user_id') === `eq.${testAccounts.a.id}`));
});

test('기존 품목 기록은 API에서 기본 분류로 보이며 DB 최초 추출은 수정하지 않는다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  await request(handler, 'POST', upload());
  const { category: _category, ...legacy } = value();
  legacy.items = [{ name: '과일', quantity: 2, amount: 14.5 }];
  remote.rows[0].original_values = structuredClone(legacy);
  remote.rows[0].edited_values = structuredClone(legacy);
  const listed = (await request(handler)).body.receipts[0];
  assert.deepEqual(listed.original, { ...value(), category: '그 외' });
  assert.deepEqual(listed.values, { ...value(), category: '그 외' });
  assert.deepEqual(remote.rows[0].original_values, legacy);
  const same = await request(handler, 'PATCH', { id: listed.id, revision: listed.revision, values: listed.values });
  assert.equal(same.body.receipt.correctionCount, 0);
  const saved = await request(handler, 'PATCH', { id: listed.id, revision: same.body.receipt.revision, values: { ...listed.values, category: '장보기' } });
  assert.equal(saved.body.receipt.correctionCount, 1);
  assert.equal(saved.body.receipt.values.category, '장보기');
  assert.deepEqual(remote.rows[0].original_values, legacy);
  assert.equal(Object.hasOwn(remote.rows[0].edited_values, 'items'), false);
});

test('PATCH는 품목·잘못된 분류·revision 누락을 저장 전에 거부한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  for (const candidate of [{ ...value(), items: [] }, { ...value(), category: '기타' }]) {
    assert.equal((await request(handler, 'PATCH', { id: uploaded.id, revision: uploaded.revision, values: candidate })).statusCode, 422);
  }
  assert.equal((await request(handler, 'PATCH', { id: uploaded.id, values: value() })).statusCode, 422);
  assert.equal(remote.rows[0].revision, uploaded.revision);
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
  assert.deepEqual(payload.output_config.format.schema.required, ['merchant', 'date', 'total', 'currency', 'category']);
  assert.deepEqual(payload.output_config.format.schema.properties.category.enum, ['쇼핑', '장보기', '외식', '그 외']);
  assert.equal(payload.output_config.format.schema.properties.items, undefined);
  assert.doesNotMatch(payload.system, /For items:|line items|quantity/);
  assert.match(payload.system, /store|merchant|business/i);
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
    for (const [method, body] of [['GET', undefined], ['POST', upload()], ['PATCH', { id: testAccounts.a.id, revision: 0, values: value() }], ['DELETE', { id: testAccounts.a.id, revision: 0 }]]) {
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

test('DELETE는 원본과 계정 행을 지우며 분석 서비스 키가 없어도 작동한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  const deleted = await request(createHandler({ env: { ...env, ANTHROPIC_API_KEY: '' }, fetchImpl: remote.fetch }), 'DELETE', { id: uploaded.id, revision: uploaded.revision });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.body, { deleted: true, id: uploaded.id });
  assert.equal(remote.rows.length, 0);
  assert.equal(remote.objects.size, 0);
  assert.deepEqual((await request(handler)).body.receipts, []);
  const removal = remote.calls.find((call) => call.method === 'DELETE' && call.url.pathname === '/rest/v1/s07_receipts');
  assert.equal(removal.url.searchParams.get('user_id'), `eq.${testAccounts.a.id}`);
  assert.equal(removal.url.searchParams.get('revision'), `eq.${uploaded.revision + 1}`);
  assert.equal(removal.url.searchParams.get('status'), 'eq.deleting');
});

test('DELETE는 타 계정·잘못된 버전·분석 중 행·교차 출처에서 파일을 지우지 않는다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  const body = { id: uploaded.id, revision: uploaded.revision };
  assert.equal((await request(handler, 'DELETE', body, { authorization: `Bearer ${testAccounts.b.accessToken}` })).statusCode, 404);
  assert.equal((await request(handler, 'DELETE', { ...body, revision: 0 })).statusCode, 409);
  for (const revision of [undefined, -1, '1', 0.5]) assert.equal((await request(handler, 'DELETE', { ...body, revision })).statusCode, 422);
  assert.equal((await request(handler, 'DELETE', body, { origin: 'https://attacker.example' })).statusCode, 403);
  remote.rows[0].status = 'processing';
  assert.equal((await request(handler, 'DELETE', body)).statusCode, 409);
  assert.equal(remote.calls.filter((call) => call.method === 'DELETE').length, 0);
  assert.equal(remote.objects.size, 1);
});

test('실패로 표시되는 오래된 processing 영수증은 재분석 없이 삭제한다', async () => {
  const remote = service(); remote.failOcr = true;
  const handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.rows[0].status = 'processing';
  remote.rows[0].updated_at = '2020-01-01T00:00:00Z';
  const listed = (await request(handler)).body.receipts[0];
  assert.equal(listed.status, 'failed');
  assert.equal(listed.original, null);
  const before = remote.calls.length;
  const deleted = await request(createHandler({ env: { ...env, ANTHROPIC_API_KEY: '' }, fetchImpl: remote.fetch }), 'DELETE', { id: uploaded.id, revision: uploaded.revision });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.body, { deleted: true, id: uploaded.id });
  assert.equal(remote.rows.length, 0);
  assert.equal(remote.objects.size, 0);
  assert.equal(remote.calls.slice(before).filter((call) => call.url.origin === 'https://api.anthropic.com').length, 0);
});

test('오래된 분석의 삭제 예약 뒤 늦은 OCR 결과는 CAS 충돌로 저장하지 않는다', async () => {
  const remote = service();
  let releaseOcr, startedOcr;
  const gate = new Promise((resolve) => { releaseOcr = resolve; });
  const started = new Promise((resolve) => { startedOcr = resolve; });
  const handler = createHandler({ env, fetchImpl: async (target, init) => {
    if (new URL(target).origin === 'https://api.anthropic.com') { startedOcr(); await gate; }
    return remote.fetch(target, init);
  } });
  const uploading = request(handler, 'POST', upload());
  await started;
  const pending = structuredClone(remote.rows[0]);
  remote.rows[0].updated_at = '2020-01-01T00:00:00Z';
  let checkedLateResult = false;
  remote.beforeObjectDelete = async () => {
    releaseOcr();
    const late = await uploading;
    assert.equal(late.statusCode, 409);
    assert.equal(remote.rows[0].status, 'deleting');
    assert.equal(remote.rows[0].revision, pending.revision + 1);
    assert.equal(remote.rows[0].original_values, null);
    checkedLateResult = true;
  };
  try {
    const deleted = await request(handler, 'DELETE', { id: pending.id, revision: pending.revision });
    assert.equal(deleted.statusCode, 200);
    assert.equal(checkedLateResult, true);
    assert.equal(remote.rows.length, 0);
    assert.equal(remote.objects.size, 0);
  } finally {
    releaseOcr();
    await uploading;
  }
});

test('삭제 예약이 실패하면 원본과 ready 행을 모두 유지한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.failDeleteClaim = true;
  assert.equal((await request(handler, 'DELETE', { id: uploaded.id, revision: uploaded.revision })).statusCode, 502);
  assert.equal(remote.rows[0].status, 'ready');
  assert.equal(remote.objects.size, 1);
});

test('원본 삭제 실패는 목록에 deleting 행을 남기고 원래 revision 재요청으로 완료한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.failObjectDelete = true;
  const body = { id: uploaded.id, revision: uploaded.revision };
  assert.equal((await request(handler, 'DELETE', body)).statusCode, 502);
  const pending = (await request(handler)).body.receipts[0];
  assert.equal(pending.status, 'deleting');
  assert.equal(pending.revision, uploaded.revision + 1);
  assert.equal(remote.objects.size, 1);
  assert.equal((await request(handler, 'PATCH', { id: pending.id, revision: pending.revision, values: value() })).statusCode, 409);
  assert.equal((await request(handler, 'POST', { action: 'retry', id: pending.id })).statusCode, 409);
  assert.equal((await request(handler, 'DELETE', { ...body, revision: uploaded.revision - 1 })).statusCode, 409);
  remote.failObjectDelete = false;
  assert.equal((await request(handler, 'DELETE', body)).statusCode, 200);
  assert.equal(remote.rows.length, 0);
});

test('DB 삭제 실패 뒤 남은 deleting 행은 현재 revision으로 원본 없음에도 재삭제한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.failRowDelete = true;
  assert.equal((await request(handler, 'DELETE', { id: uploaded.id, revision: uploaded.revision })).statusCode, 502);
  assert.equal(remote.objects.size, 0);
  const pending = (await request(handler)).body.receipts[0];
  assert.equal(pending.status, 'deleting');
  assert.equal(pending.imageUrl, null);
  remote.failRowDelete = false;
  assert.equal((await request(handler, 'DELETE', { id: pending.id, revision: pending.revision })).statusCode, 200);
  assert.equal(remote.rows.length, 0);
});

test('원본 삭제 응답이 유실되어도 기록을 숨기지 않으며 재요청으로 정리한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  const body = { id: uploaded.id, revision: uploaded.revision };
  remote.loseObjectDeleteResponse = true;
  assert.equal((await request(handler, 'DELETE', body)).statusCode, 502);
  assert.equal(remote.rows[0].status, 'deleting');
  assert.equal(remote.objects.size, 0);
  remote.loseObjectDeleteResponse = false;
  assert.equal((await request(handler, 'DELETE', body)).statusCode, 200);
});

test('DB 삭제 응답이 유실되면 계정 범위 재조회로 완료를 확인한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.loseRowDeleteResponse = true;
  assert.equal((await request(handler, 'DELETE', { id: uploaded.id, revision: uploaded.revision })).statusCode, 200);
  assert.equal(remote.rows.length, 0);
});

test('동시 편집이 삭제 예약보다 먼저 저장되면 삭제는 충돌하고 원본을 보존한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.beforePatch = async ({ init }) => {
    if (JSON.parse(init.body).status !== 'deleting') return;
    remote.beforePatch = null;
    const edited = await request(handler, 'PATCH', { id: uploaded.id, revision: uploaded.revision, values: { ...value(), total: 25 } });
    assert.equal(edited.statusCode, 200);
  };
  assert.equal((await request(handler, 'DELETE', { id: uploaded.id, revision: uploaded.revision })).statusCode, 409);
  assert.equal(remote.rows[0].edited_values.total, 25);
  assert.equal(remote.rows[0].status, 'ready');
  assert.equal(remote.objects.size, 1);
});

test('같은 삭제 예약을 동시에 마무리하는 재요청은 둘 다 성공한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = (await request(handler, 'POST', upload())).body.receipt;
  remote.failObjectDelete = true;
  const body = { id: uploaded.id, revision: uploaded.revision };
  await request(handler, 'DELETE', body);
  remote.failObjectDelete = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let arrived = 0;
  remote.beforeObjectDelete = async () => { arrived += 1; if (arrived === 2) release(); await gate; };
  const results = await Promise.all([request(handler, 'DELETE', body), request(handler, 'DELETE', body)]);
  assert.deepEqual(results.map((response) => response.statusCode), [200, 200]);
  assert.equal(remote.rows.length, 0);
  assert.equal(remote.objects.size, 0);
});

test('Store는 다른 계정의 원본 삭제 요청을 외부로 보내지 않는다', async () => {
  const remote = service();
  const store = createReceiptStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, userId: testAccounts.a.id, fetchImpl: remote.fetch, timeoutMs: 100 });
  await assert.rejects(async () => store.removeObject(`${testAccounts.b.id}/33333333-3333-4333-8333-333333333333.png`), (error) => error.status === 404);
  assert.equal(remote.calls.length, 0);
});
