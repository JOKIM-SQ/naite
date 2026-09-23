import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { asUser, createDatabase, errorCode, fixture, readMigration, rpc, users } from './support/database.mjs';

let db;
before(async () => { db = await createDatabase(); });
after(async () => { await db?.close(); });

test('보드 생성은 소유자 멤버십을 만들고 초대 재참여는 멤버를 중복 생성하지 않는다', async () => {
  const boardId = await rpc(db, users.owner, 's08_create_board', ['  공동 창고  ']);
  const invite = await rpc(db, users.owner, 's08_get_invite', [boardId]);
  assert.equal(await rpc(db, users.member, 's08_join_board', [invite]), boardId);
  assert.equal(await rpc(db, users.member, 's08_join_board', [invite]), boardId);
  const own = await asUser(db, users.owner, 'select * from public.s08_list_boards() where id = $1', [boardId]);
  const member = await asUser(db, users.member, 'select * from public.s08_list_boards() where id = $1', [boardId]);
  assert.deepEqual(own.rows, [{ id: boardId, name: '공동 창고', role: 'owner' }]);
  assert.deepEqual(member.rows, [{ id: boardId, name: '공동 창고', role: 'member' }]);
  const members = await asUser(db, users.owner, 'select user_id, role from public.s08_members where board_id = $1 order by user_id', [boardId]);
  assert.deepEqual(members.rows, [{ user_id: users.owner, role: 'owner' }, { user_id: users.member, role: 'member' }]);
  await assert.rejects(rpc(db, users.outsider, 's08_join_board', [randomUUID()]), errorCode('42501'));
  await assert.rejects(rpc(db, users.owner, 's08_create_board', ['  ']), errorCode('22023'));
  await assert.rejects(rpc(db, users.owner, 's08_create_board', [null]), errorCode('22023'));
});

test('비멤버는 보드·멤버·품목·이력을 조회하거나 RPC로 변경할 수 없다', async () => {
  const { boardId, item } = await fixture(db);
  await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, randomUUID()]);
  for (const table of ['s08_members', 's08_items', 's08_movements']) {
    const rows = await asUser(db, users.outsider, `select * from public.${table} where board_id = $1`, [boardId]);
    assert.deepEqual(rows.rows, [], table);
  }
  const boards = await asUser(db, users.outsider, 'select id, name from public.s08_boards where id = $1', [boardId]);
  const list = await asUser(db, users.outsider, 'select * from public.s08_list_boards() where id = $1', [boardId]);
  assert.deepEqual(boards.rows, []);
  assert.deepEqual(list.rows, []);
  await assert.rejects(rpc(db, users.outsider, 's08_add_item', [boardId, '숨은 품목', 'HIDDEN', 0, '개', 0]), errorCode('42501'));
  await assert.rejects(rpc(db, users.outsider, 's08_adjust_stock', [item.id, 1, randomUUID()]), errorCode('42501'));
  const memberRows = await asUser(db, users.member, 'select id, quantity from public.s08_items where id = $1', [item.id]);
  assert.deepEqual(memberRows.rows, [{ id: item.id, quantity: 11 }]);
});

test('초대값은 소유자 RPC만 반환하며 소유자도 테이블 SELECT로 읽을 수 없다', async () => {
  const { boardId, invite } = await fixture(db);
  assert.equal(await rpc(db, users.owner, 's08_get_invite', [boardId]), invite);
  for (const userId of [users.owner, users.member, users.outsider]) {
    await assert.rejects(asUser(db, userId, 'select invite_code from public.s08_boards where id = $1', [boardId]), errorCode('42501'));
    await assert.rejects(asUser(db, userId, 'select * from public.s08_boards where id = $1', [boardId]), errorCode('42501'));
  }
  for (const userId of [users.member, users.outsider]) {
    await assert.rejects(rpc(db, userId, 's08_get_invite', [boardId]), errorCode('42501'));
  }
});

test('익명 역할과 사용자 없는 authenticated 세션은 모든 공개 RPC를 사용할 수 없다', async () => {
  const { boardId, invite, item } = await fixture(db);
  const calls = [
    ['s08_list_boards', []],
    ['s08_create_board', ['익명 보드']],
    ['s08_join_board', [invite]],
    ['s08_get_invite', [boardId]],
    ['s08_add_item', [boardId, '품목', 'ANON', 0, '개', 0]],
    ['s08_adjust_stock', [item.id, 1, randomUUID()]],
  ];
  for (const [name, args] of calls) {
    await assert.rejects(rpc(db, null, name, args, 'anon'), errorCode('42501'), name);
    await assert.rejects(rpc(db, null, name, args), errorCode('42501'), name);
  }
  await assert.rejects(asUser(db, null, 'select * from public.s08_items', [], 'anon'), errorCode('42501'));
  assert.deepEqual((await asUser(db, null, 'select * from public.s08_items')).rows, []);
});

test('보드 소유자와 멤버 모두 네 테이블을 직접 INSERT·UPDATE·DELETE할 수 없다', async () => {
  const { boardId, item } = await fixture(db);
  const writes = [
    ['insert into public.s08_boards (name, owner_id) values ($1, $2)', ['직접 보드', users.owner]],
    ['update public.s08_boards set name = $1 where id = $2', ['변조', boardId]],
    ['delete from public.s08_boards where id = $1', [boardId]],
    ['insert into public.s08_members (board_id, user_id, role) values ($1, $2, $3)', [boardId, users.outsider, 'owner']],
    ['update public.s08_members set role = $1 where board_id = $2', ['owner', boardId]],
    ['delete from public.s08_members where board_id = $1', [boardId]],
    ['insert into public.s08_items (board_id, name, sku, quantity, unit, low_stock, updated_by) values ($1, $2, $3, 0, $4, 0, $5)', [boardId, '직접 품목', 'DIRECT', '개', users.owner]],
    ['update public.s08_items set quantity = 900 where id = $1', [item.id]],
    ['delete from public.s08_items where id = $1', [item.id]],
    ['insert into public.s08_movements (request_id, board_id, item_id, actor_id, delta, quantity_after, revision_after) values ($1, $2, $3, $4, 1, 11, 1)', [randomUUID(), boardId, item.id, users.owner]],
    ['update public.s08_movements set delta = 2 where item_id = $1', [item.id]],
    ['delete from public.s08_movements where item_id = $1', [item.id]],
  ];
  for (const userId of [users.owner, users.member]) {
    for (const [sql, params] of writes) await assert.rejects(asUser(db, userId, sql, params), errorCode('42501'), sql);
  }
  assert.equal((await asUser(db, users.owner, 'select quantity from public.s08_items where id = $1', [item.id])).rows[0].quantity, 10);
});

test('품목 입력을 정리하고 같은 보드 안에서만 SKU 대소문자 중복을 거절한다', async () => {
  const { boardId } = await fixture(db);
  const item = await rpc(db, users.member, 's08_add_item', [boardId, '  케이블  ', '  Cable-01  ', 0, '  개  ', 1000000]);
  assert.equal(item.name, '케이블');
  assert.equal(item.sku, 'Cable-01');
  assert.equal(item.unit, '개');
  assert.equal(item.quantity, 0);
  assert.equal(item.low_stock, 1000000);
  assert.equal(item.updated_by, users.member);
  await assert.rejects(rpc(db, users.member, 's08_add_item', [boardId, '중복', 'cable-01', 0, '개', 0]), errorCode('23505'));
  const otherBoard = await rpc(db, users.owner, 's08_create_board', ['두 번째 보드']);
  assert.equal((await rpc(db, users.owner, 's08_add_item', [otherBoard, '케이블', 'cable-01', 1000000, '개', 0])).quantity, 1000000);
  const invalid = [
    [boardId, '', 'EMPTY-NAME', 0, '개', 0],
    [boardId, '품목', '  ', 0, '개', 0],
    [boardId, '품목', 'EMPTY-UNIT', 0, '  ', 0],
    [boardId, '품목', 'NEGATIVE', -1, '개', 0],
    [boardId, '품목', 'TOO-MUCH', 1000001, '개', 0],
    [boardId, '품목', 'LOW-NEGATIVE', 0, '개', -1],
    [boardId, '품목', 'LOW-TOO-MUCH', 0, '개', 1000001],
    [boardId, null, 'NULL-NAME', 0, '개', 0],
    [boardId, '품목', null, 0, '개', 0],
    [boardId, '품목', 'NULL-QTY', null, '개', 0],
    [boardId, '품목', 'NULL-UNIT', 0, null, 0],
    [boardId, '품목', 'NULL-LOW', 0, '개', null],
  ];
  for (const args of invalid) await assert.rejects(rpc(db, users.owner, 's08_add_item', args), errorCode('22023'));
});

test('재고 delta를 누적하고 동일 요청 재전송은 최초 결과와 단일 이력을 유지한다', async () => {
  const { boardId, item } = await fixture(db);
  const requestId = randomUUID();
  const first = await rpc(db, users.owner, 's08_adjust_stock', [item.id, 2, requestId]);
  assert.deepEqual(first, { item_id: item.id, quantity: 12, revision: item.revision + 1, request_id: requestId });
  const second = await rpc(db, users.member, 's08_adjust_stock', [item.id, -3, randomUUID()]);
  assert.equal(second.quantity, 9);
  assert.equal(second.revision, first.revision + 1);
  const replay = await rpc(db, users.owner, 's08_adjust_stock', [item.id, 2, requestId]);
  assert.deepEqual(replay, first);
  const snapshot = await asUser(db, users.member, 'select quantity, revision, updated_by from public.s08_items where id = $1', [item.id]);
  assert.deepEqual(snapshot.rows, [{ quantity: 9, revision: item.revision + 2, updated_by: users.member }]);
  const log = await asUser(db, users.member, 'select delta, quantity_after, actor_id from public.s08_movements where board_id = $1 order by revision_after', [boardId]);
  assert.deepEqual(log.rows, [{ delta: 2, quantity_after: 12, actor_id: users.owner }, { delta: -3, quantity_after: 9, actor_id: users.member }]);
});

test('요청 ID가 같아도 delta·품목·사용자가 달라지면 거절하고 수량을 유지한다', async () => {
  const { boardId, item } = await fixture(db);
  const other = await rpc(db, users.owner, 's08_add_item', [boardId, '다른 품목', 'OTHER', 20, '개', 0]);
  const requestId = randomUUID();
  await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, requestId]);
  await assert.rejects(rpc(db, users.owner, 's08_adjust_stock', [item.id, 2, requestId]), errorCode('22023'));
  await assert.rejects(rpc(db, users.owner, 's08_adjust_stock', [other.id, 1, requestId]), errorCode('22023'));
  await assert.rejects(rpc(db, users.member, 's08_adjust_stock', [item.id, 1, requestId]), errorCode('22023'));
  await assert.rejects(rpc(db, users.outsider, 's08_adjust_stock', [item.id, 1, requestId]), errorCode('42501'));
  const quantities = await asUser(db, users.owner, 'select quantity from public.s08_items where board_id = $1 order by quantity', [boardId]);
  assert.deepEqual(quantities.rows, [{ quantity: 11 }, { quantity: 20 }]);
});

test('재고 범위를 벗어난 조정은 이력까지 롤백하고 재시도 가능한 요청 ID를 남긴다', async () => {
  const { item } = await fixture(db, 1);
  const rejectedId = randomUUID();
  await assert.rejects(rpc(db, users.owner, 's08_adjust_stock', [item.id, -2, rejectedId]), errorCode('22023'));
  assert.deepEqual((await asUser(db, users.owner, 'select request_id from public.s08_movements where request_id = $1', [rejectedId])).rows, []);
  assert.equal((await rpc(db, users.member, 's08_adjust_stock', [item.id, 1, randomUUID()])).quantity, 2);
  assert.equal((await rpc(db, users.owner, 's08_adjust_stock', [item.id, -2, rejectedId])).quantity, 0);
  assert.equal((await rpc(db, users.owner, 's08_adjust_stock', [item.id, 1000000, randomUUID()])).quantity, 1000000);
  for (const delta of [1, 2147483647, -1000001, null]) {
    await assert.rejects(rpc(db, users.owner, 's08_adjust_stock', [item.id, delta, randomUUID()]), errorCode('22023'));
  }
  await assert.rejects(rpc(db, users.owner, 's08_adjust_stock', [item.id, 1, null]), errorCode('22023'));
  assert.equal((await asUser(db, users.owner, 'select quantity from public.s08_items where id = $1', [item.id])).rows[0].quantity, 1000000);
});

test('0 조정은 수량·revision·이력을 바꾸지 않고 입력 오류로 거절한다', async () => {
  const { item } = await fixture(db);
  const requestId = randomUUID();
  await assert.rejects(rpc(db, users.owner, 's08_adjust_stock', [item.id, 0, requestId]), errorCode('22023'));
  const current = await asUser(db, users.owner, 'select quantity, revision from public.s08_items where id = $1', [item.id]);
  assert.deepEqual(current.rows, [{ quantity: 10, revision: item.revision }]);
  assert.deepEqual((await asUser(db, users.owner, 'select request_id from public.s08_movements where request_id = $1', [requestId])).rows, []);
});

test('마이그레이션 재적용은 기존 재고와 이력을 보존하고 items만 Realtime publication에 추가한다', async () => {
  const { boardId, item } = await fixture(db);
  const requestId = randomUUID();
  const result = await rpc(db, users.owner, 's08_adjust_stock', [item.id, 4, requestId]);
  await db.exec(await readMigration());
  assert.deepEqual(await rpc(db, users.owner, 's08_adjust_stock', [item.id, 4, requestId]), result);
  assert.equal((await asUser(db, users.owner, 'select quantity from public.s08_items where id = $1', [item.id])).rows[0].quantity, 14);
  await assert.rejects(asUser(db, users.owner, 'select invite_code from public.s08_boards where id = $1', [boardId]), errorCode('42501'));
  const publication = await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 's08_%' order by tablename");
  assert.deepEqual(publication.rows, [{ tablename: 's08_items' }]);
});
