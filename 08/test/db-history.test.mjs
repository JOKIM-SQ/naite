import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { asUser, createDatabase, errorCode, fixture, rpc, users } from './support/database.mjs';

const migrationUrl = new URL('../migrations/20260924_item_history.sql', import.meta.url);
const readHistoryMigration = () => readFile(migrationUrl, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
let db;
before(async () => {
  db = await createDatabase();
  // The isolated auth fixture starts with IDs only; Supabase already has this column.
  await db.exec('alter table auth.users add column if not exists raw_user_meta_data jsonb');
  await db.exec(await readHistoryMigration());
});
after(async () => { await db?.close(); });

async function history(userId, itemId, beforeCreatedAt = null, beforeRequestId = null, limit = 20, role = 'authenticated') {
  return (await asUser(db, userId, `
    select * from public.s08_list_item_movements($1::uuid, $2::timestamptz, $3::uuid, $4::integer)
  `, [itemId, beforeCreatedAt, beforeRequestId, limit], role)).rows;
}

async function setNames(ownerMetadata, memberMetadata) {
  await db.query('update auth.users set raw_user_meta_data = $2::jsonb where id = $1', [users.owner, JSON.stringify(ownerMetadata)]);
  await db.query('update auth.users set raw_user_meta_data = $2::jsonb where id = $1', [users.member, JSON.stringify(memberMetadata)]);
}

test('아이템 이력은 기존 원장의 수행자와 부호 있는 입출고·전후 수량을 반환한다', async () => {
  await setNames({ full_name: '  창고 관리자  ', name: '무시할 별칭', email: 'private@example.com', key: 'private-key' }, { name: '  현장 팀원  ' });
  const { item } = await fixture(db);
  const incoming = randomUUID();
  const outgoing = randomUUID();
  await rpc(db, users.owner, 's08_adjust_stock', [item.id, 4, incoming]);
  await rpc(db, users.member, 's08_adjust_stock', [item.id, -3, outgoing]);
  await db.query('update public.s08_movements set created_at = $2::timestamptz where request_id = $1', [incoming, '2026-09-24T10:00:00.000Z']);
  await db.query('update public.s08_movements set created_at = $2::timestamptz where request_id = $1', [outgoing, '2026-09-24T10:01:00.000Z']);
  const expected = [
    { request_id: outgoing, actor_id: users.member, actor_name: '현장 팀원', delta: -3, quantity_before: 14, quantity_after: 11, created_at: new Date('2026-09-24T10:01:00.000Z') },
    { request_id: incoming, actor_id: users.owner, actor_name: '창고 관리자', delta: 4, quantity_before: 10, quantity_after: 14, created_at: new Date('2026-09-24T10:00:00.000Z') },
  ];
  assert.deepEqual(await history(users.member, item.id), expected);
  assert.deepEqual(await history(users.owner, item.id), expected);
});

test('소속 없는 보드·존재하지 않는 품목·익명·사용자 없는 세션은 이력을 읽지 못한다', async () => {
  const { item } = await fixture(db);
  await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, randomUUID()]);
  await assert.rejects(history(users.outsider, item.id), errorCode('42501'));
  await assert.rejects(history(users.owner, randomUUID()), errorCode('42501'));
  await assert.rejects(history(users.owner, null), errorCode('42501'));
  await assert.rejects(history(null, item.id), errorCode('42501'));
  await assert.rejects(history(null, item.id, null, null, 20, 'anon'), errorCode('42501'));
  await assert.rejects(history(users.owner, item.id, null, null, 20, 'anon'), errorCode('42501'));
});

test('페이지 커서는 같은 시각 기록과 다른 시각 기록을 누락·중복 없이 내림차순으로 읽는다', async () => {
  const { item, boardId } = await fixture(db);
  const ids = [
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-0000-4000-8000-000000000002',
    'aaaaaaaa-0000-4000-8000-000000000003',
    'aaaaaaaa-0000-4000-8000-000000000004',
    'aaaaaaaa-0000-4000-8000-000000000005',
  ];
  for (const id of ids) await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, id]);
  await db.query('update public.s08_movements set created_at = $2::timestamptz where item_id = $1', [item.id, '2026-09-24T12:00:00.000Z']);
  await db.query('update public.s08_movements set created_at = $2::timestamptz where request_id = $1', [ids[0], '2026-09-24T11:00:00.000Z']);
  const otherItem = await rpc(db, users.owner, 's08_add_item', [boardId, '별도 품목', 'OTHER-HISTORY', 10, '개', 0]);
  await rpc(db, users.owner, 's08_adjust_stock', [otherItem.id, 1, randomUUID()]);

  const page1 = await history(users.member, item.id, null, null, 2);
  assert.deepEqual(page1.map(row => row.request_id), [ids[4], ids[3]]);
  const page2 = await history(users.member, item.id, page1[1].created_at, page1[1].request_id, 2);
  assert.deepEqual(page2.map(row => row.request_id), [ids[2], ids[1]]);
  const page3 = await history(users.member, item.id, page2[1].created_at, page2[1].request_id, 2);
  assert.deepEqual(page3.map(row => row.request_id), [ids[0]]);
  assert.deepEqual(await history(users.member, item.id, page3[0].created_at, page3[0].request_id, 2), []);
  assert.equal(new Set([...page1, ...page2, ...page3].map(row => row.request_id)).size, 5);
});

test('기본 페이지 크기는 20이고 크기 1과 50 경계를 허용한다', async () => {
  const { item } = await fixture(db);
  for (let index = 0; index < 51; index += 1) await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, randomUUID()]);
  const defaultPage = await asUser(db, users.owner, 'select * from public.s08_list_item_movements($1::uuid)', [item.id]);
  assert.equal(defaultPage.rows.length, 20);
  assert.equal((await history(users.owner, item.id, null, null, 1)).length, 1);
  assert.equal((await history(users.owner, item.id, null, null, 50)).length, 50);
});

test('부분 커서·무한 시각·잘못된 페이지 크기는 유효성 오류로 거절한다', async () => {
  const { item } = await fixture(db);
  const requestId = randomUUID();
  for (const [timestamp, cursorId, limit] of [
    ['2026-09-24T10:00:00.000Z', null, 20],
    [null, requestId, 20],
    ['infinity', requestId, 20],
    ['-infinity', requestId, 20],
    [null, null, 0],
    [null, null, -1],
    [null, null, 51],
    [null, null, null],
  ]) await assert.rejects(history(users.owner, item.id, timestamp, cursorId, limit), errorCode('22023'));
});

test('표시 이름은 공백·비문자 메타데이터를 대체하고 XSS 문자는 일반 텍스트로 반환한다', async () => {
  const { item } = await fixture(db);
  await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, randomUUID()]);
  for (const [metadata, expected] of [
    [{ full_name: ' \t\n ', name: ' \n ' }, '팀원'],
    [{ full_name: '  ', name: '  별칭  ' }, '별칭'],
    [null, '팀원'],
    [{ email: 'private@example.com', key: 'secret' }, '팀원'],
    [{ full_name: { email: 'private@example.com' }, name: false }, '팀원'],
    [{ full_name: '<img src=x onerror="alert(1)">' }, '<img src=x onerror="alert(1)">'],
  ]) {
    await setNames(metadata, null);
    const [row] = await history(users.member, item.id);
    assert.equal(row.actor_name, expected);
    assert.equal(row.actor_id, users.owner);
    assert.deepEqual(Object.keys(row).sort(), ['actor_id', 'actor_name', 'created_at', 'delta', 'quantity_after', 'quantity_before', 'request_id']);
  }
});

test('마이그레이션 재적용은 기존 재고와 이력을 보존하고 이력 없는 품목은 빈 목록을 반환한다', async () => {
  const { item } = await fixture(db);
  assert.deepEqual(await history(users.owner, item.id), []);
  await rpc(db, users.member, 's08_adjust_stock', [item.id, -2, randomUUID()]);
  const beforeItems = (await db.query('select * from public.s08_items where id = $1', [item.id])).rows;
  const beforeMovements = (await db.query('select * from public.s08_movements where item_id = $1', [item.id])).rows;
  const beforeHistory = await history(users.owner, item.id);
  await db.exec(await readHistoryMigration());
  await db.exec(await readHistoryMigration());
  assert.deepEqual((await db.query('select * from public.s08_items where id = $1', [item.id])).rows, beforeItems);
  assert.deepEqual((await db.query('select * from public.s08_movements where item_id = $1', [item.id])).rows, beforeMovements);
  assert.deepEqual(await history(users.owner, item.id), beforeHistory);
});

test('공개 RPC는 빈 search_path의 SECURITY DEFINER이며 실행 권한은 authenticated에만 있다', async () => {
  const result = await db.query(`
    select routine.prosecdef, routine.proconfig,
      pg_catalog.has_function_privilege('authenticated', routine.oid, 'EXECUTE') as authenticated_execute,
      pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE') as anon_execute,
      exists (select 1 from pg_catalog.aclexplode(routine.proacl) as privilege where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE') as public_execute
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public' and routine.proname = 's08_list_item_movements'
  `);
  assert.deepEqual(result.rows, [{ prosecdef: true, proconfig: ['search_path=""'], authenticated_execute: true, anon_execute: false, public_execute: false }]);
});
