// Opt-in integration check against the configured Supabase project.
// Creates three isolated QA accounts. Run --cleanup when browser checks finish.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--run') && !process.argv.includes('--cleanup')) {
  console.log('사용법: node scripts/live-check.mjs --run | --cleanup (QA 계정·보드를 생성/정리함)');
  process.exit(0);
}

const env = parseEnv(await readFile(new URL('../../07/.env.local', import.meta.url), 'utf8'));
const url = env.SUPABASE_URL;
const key = env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Local integration credentials missing');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, options);
const fixtureFile = new URL('../.qa/fixture.json', import.meta.url);
const unwrap = ({ data, error }) => { if (error) throw error; return data; };
await mkdir(new URL('../.qa/', import.meta.url), { recursive: true, mode: 0o700 });

if (process.argv.includes('--cleanup')) {
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  // Delete only accounts/boards whose exact IDs were created by this check.
  for (const account of fixture.accounts) {
    unwrap(await admin.from('s08_boards').delete().eq('owner_id', account.id));
  }
  for (const account of fixture.accounts) unwrap(await admin.auth.admin.deleteUser(account.id));
  await unlink(fixtureFile);
  console.log('S08 QA 계정·보드 정리 완료');
  process.exit(0);
}

try { await readFile(fixtureFile); throw new Error('Previous QA fixture exists; clean it first'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const fixture = { accounts: [], createdAt: new Date().toISOString() };
const clients = [];
async function saveFixture() { await writeFile(fixtureFile, JSON.stringify(fixture), { mode: 0o600 }); }
const report = { date: new Date().toISOString(), checks: [], transportMs: [] };
const pass = label => { report.checks.push(label); console.log(`PASS ${label}`); };
async function waitFor(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Realtime observation timeout');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

try {
  for (const label of ['owner', 'member', 'outsider']) {
    const account = { label, email: `s08-qa-${label}-${randomUUID()}@example.invalid`, password: randomUUID() + randomUUID() };
    account.id = unwrap(await admin.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true, user_metadata: { name: `S08 QA ${label}` } })).user.id;
    fixture.accounts.push(account);
    await saveFixture();
    const client = createClient(url, key, options);
    unwrap(await client.auth.signInWithPassword({ email: account.email, password: account.password }));
    clients.push(client);
  }
  const [owner, member, outsider] = clients;
  const board = unwrap(await owner.rpc('s08_create_board', { p_name: '검증용 팀 보드' }));
  fixture.board = board;
  await saveFixture();
  const invite = unwrap(await owner.rpc('s08_get_invite', { p_board_id: board }));
  assert.equal(unwrap(await member.rpc('s08_join_board', { p_invite_code: invite })), board);
  assert.equal(unwrap(await member.rpc('s08_list_boards')).length, 1);
  assert.deepEqual(unwrap(await outsider.rpc('s08_list_boards')), []);
  assert.ok((await member.rpc('s08_get_invite', { p_board_id: board })).error);
  assert.ok((await member.from('s08_boards').select('invite_code').eq('id', board)).error);
  pass('실제 계정의 보드 생성·초대 참여·초대값 접근 제한');

  const item = unwrap(await owner.rpc('s08_add_item', { p_board_id: board, p_name: '데스크 노트', p_sku: 'QA-NOTE', p_quantity: 20, p_unit: '권', p_low_stock: 5 }));
  fixture.item = item.id;
  await saveFixture();
  assert.deepEqual(unwrap(await outsider.from('s08_items').select('*').eq('board_id', board)), []);
  assert.ok((await outsider.rpc('s08_adjust_stock', { p_item_id: item.id, p_delta: 1, p_request_id: randomUUID() })).error);
  assert.ok((await member.from('s08_items').update({ quantity: 999 }).eq('id', item.id)).error);
  pass('외부 계정 조회·변경 및 멤버 직접 UPDATE 차단');

  const events = [];
  let outsiderEvents = 0;
  let memberReady = false;
  let outsiderReady = false;
  const channelOptions = { config: { postgres_changes_options: { wait: true } } };
  member.channel(`qa-member-${randomUUID()}`, channelOptions).on('postgres_changes', { event: '*', schema: 'public', table: 's08_items', filter: `board_id=eq.${board}` }, payload => events.push({ payload, at: performance.now() })).subscribe(status => { memberReady = status === 'SUBSCRIBED'; });
  outsider.channel(`qa-outsider-${randomUUID()}`, channelOptions).on('postgres_changes', { event: '*', schema: 'public', table: 's08_items', filter: `board_id=eq.${board}` }, () => outsiderEvents++).subscribe(status => { outsiderReady = status === 'SUBSCRIBED'; });
  await waitFor(() => memberReady && outsiderReady);

  for (let i = 0; i < 5; i++) {
    const request = randomUUID();
    const sentAt = new Date().toISOString();
    const start = performance.now();
    const changed = unwrap(await owner.rpc('s08_adjust_stock', { p_item_id: item.id, p_delta: 1, p_request_id: request, p_sent_at: sentAt }));
    await waitFor(() => events.some(event => event.payload.new.revision === changed.revision));
    const event = events.find(event => event.payload.new.revision === changed.revision);
    assert.equal(Date.parse(event.payload.new.change_sent_at), Date.parse(sentAt));
    report.transportMs.push(Math.round(event.at - start));
  }
  assert.equal(outsiderEvents, 0);
  pass('실제 Realtime 이벤트가 보드 멤버에게만 전달됨');

  const changes = await Promise.all(Array.from({ length: 10 }, (_, i) => clients[i % 2].rpc('s08_adjust_stock', { p_item_id: item.id, p_delta: -1, p_request_id: randomUUID() })));
  changes.forEach(unwrap);
  const readItem = async () => unwrap(await member.from('s08_items').select('*').eq('id', item.id).single());
  assert.equal((await readItem()).quantity, 15);
  pass('두 계정 병렬 출고 10건이 모두 누적됨 (25 → 15)');

  const same = { p_item_id: item.id, p_delta: -2, p_request_id: randomUUID() };
  const replay = await Promise.all(Array.from({ length: 6 }, () => owner.rpc('s08_adjust_stock', same)));
  replay.forEach(result => assert.deepEqual(unwrap(result), unwrap(replay[0])));
  assert.equal((await readItem()).quantity, 13);
  assert.ok((await owner.rpc('s08_adjust_stock', { ...same, p_delta: -3 })).error);
  assert.ok((await owner.rpc('s08_adjust_stock', { p_item_id: item.id, p_delta: -14, p_request_id: randomUUID() })).error);
  assert.equal((await readItem()).quantity, 13);
  pass('동일 요청 병렬 재전송은 한 번만 반영, 요청 변조·음수 재고 거절');

  const firstPage = unwrap(await member.rpc('s08_list_item_movements', { p_item_id: item.id, p_limit: 2 }));
  assert.equal(firstPage.length, 2);
  assert.ok(firstPage.every(entry => entry.actor_name.startsWith('S08 QA ') && entry.quantity_before + entry.delta === entry.quantity_after));
  assert.ok(firstPage.every(entry => !('email' in entry)));
  const last = firstPage.at(-1);
  const nextPage = unwrap(await owner.rpc('s08_list_item_movements', { p_item_id: item.id, p_limit: 2, p_before_created_at: last.created_at, p_before_request_id: last.request_id }));
  assert.equal(nextPage.length, 2);
  assert.equal(new Set([...firstPage, ...nextPage].map(entry => entry.request_id)).size, 4);
  assert.ok((await outsider.rpc('s08_list_item_movements', { p_item_id: item.id })).error);
  pass('실제 변경 발신 시각 전달 및 품목별 수행자·전후 재고·이력 페이지·외부 계정 차단');

  for (const [name, sku, quantity, unit, low] of [['포장 테이프', 'QA-TAPE', 3, '롤', 5], ['드립 커피', 'QA-COFFEE', 0, '박스', 2]]) {
    unwrap(await owner.rpc('s08_add_item', { p_board_id: board, p_name: name, p_sku: sku, p_quantity: quantity, p_unit: unit, p_low_stock: low }));
  }
  await writeFile(new URL('../.qa/live-report.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks.length, transportMs: report.transportMs, note: 'SDK 요청→다른 SDK 이벤트 관측. UI 지연과 Google OAuth 검증은 별도.' }));
} finally {
  await Promise.all(clients.map(client => client.removeAllChannels()));
}
