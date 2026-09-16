import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandler } from '../api/receipts.mjs';
import { createTestService as service } from './test-support.mjs';

const env = { SUPABASE_URL: 'https://receipts.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_server_only', ANTHROPIC_API_KEY: 'sk-ant-test_server_only', NODE_ENV: 'production' };
const token = 'a'.repeat(43);
const cookie = `s07_session=${token}`;
const sessionHash = createHash('sha256').update(token).digest('hex');
const value = () => ({ merchant: '시장', date: '2026-09-16', total: 14.5, currency: 'USD', items: [{ name: '과일', quantity: 2, amount: 14.5 }] });
const upload = () => ({ action: 'upload', fileName: '영수증.png', mediaType: 'image/png', data: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64') });
async function request(handler, method = 'GET', body, headers = {}) {
  const response = { headers: {}, statusCode: 200, setHeader(key, item) { this.headers[key.toLowerCase()] = item; }, status(code) { this.statusCode = code; return this; }, json(item) { this.body = item; return this; } };
  await handler({ method, body, headers: { host: 'receipts.example.com', 'x-forwarded-proto': 'https', cookie, ...headers } }, response);
  return response;
}

test('GET은 HttpOnly 보안 쿠키를 만들고 해당 해시 세션만 조회한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const response = await request(handler, 'GET', undefined, { cookie: '' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { receipts: [] });
  assert.match(response.headers['set-cookie'], /^s07_session=[A-Za-z0-9_-]{43};/);
  for (const option of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(response.headers['set-cookie'].includes(option));
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(remote.calls[0].url.searchParams.get('session_hash'), /^eq\.[a-f0-9]{64}$/);
  assert.equal(remote.calls[0].init.headers['Accept-Profile'], 'weekly_projects');
});

test('원본 저장과 행 생성 뒤 실제 이미지 및 JSON schema로 추출하여 돌려준다', async () => {
  const remote = service(), response = await request(createHandler({ env, fetchImpl: remote.fetch }), 'POST', upload());
  assert.equal(response.statusCode, 201);
  assert.equal(response.body?.receipt?.status, 'ready');
  assert.deepEqual(response.body.receipt.original, value());
  assert.deepEqual(response.body.receipt.values, value());
  assert.equal(response.body.receipt.correctionCount, 0);
  assert.match(response.body.receipt.imageUrl, /^https:\/\/receipts.supabase.co\/storage\/v1\/object\/sign\//);
  assert.equal(remote.rows[0].session_hash, sessionHash);
  assert.ok(remote.rows[0].storage_path.startsWith(`${sessionHash}/`));
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

test('다른 세션은 목록·편집·재분석에서 원본과 값을 볼 수 없다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  const uploaded = await request(handler, 'POST', upload()), id = uploaded.body?.receipt?.id;
  const other = { cookie: `s07_session=${'b'.repeat(43)}` };
  assert.deepEqual((await request(handler, 'GET', undefined, other)).body, { receipts: [] });
  assert.equal((await request(handler, 'PATCH', { id, values: value(), revision: 1 }, other)).statusCode, 404);
  assert.equal((await request(handler, 'POST', { action: 'retry', id }, other)).statusCode, 404);
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

test('값 검증·세션 교차 출처·잘못된 JSON은 외부 요청 전에 거부한다', async () => {
  const remote = service(), handler = createHandler({ env, fetchImpl: remote.fetch });
  assert.equal((await request(handler, 'POST', upload(), { origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await request(handler, 'POST', '{')).statusCode, 400);
  assert.equal((await request(handler, 'POST', { ...upload(), data: 'https://localhost/secrets' })).statusCode, 422);
  assert.equal((await request(handler, 'PATCH', { id: 'not-a-uuid', revision: 0, values: value() })).statusCode, 422);
  assert.equal(remote.calls.length, 0);
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
