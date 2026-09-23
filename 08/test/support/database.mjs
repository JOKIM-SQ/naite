import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const users = {
  owner: '11111111-1111-4111-8111-111111111111',
  member: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333',
};

export async function readMigration() {
  return readFile(new URL('../../SUPABASE.sql', import.meta.url), 'utf8').catch((error) => {
    // Before implementation, expose absent database behavior rather than a file-read error.
    if (error.code === 'ENOENT') return '';
    throw error;
  });
}

export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users (id) values
      ('${users.owner}'), ('${users.member}'), ('${users.outsider}');
    create publication supabase_realtime;
  `);
  await db.exec(await readMigration());
  return db;
}

export async function asUser(db, userId, sql, parameters = [], role = 'authenticated') {
  if (!['anon', 'authenticated'].includes(role)) throw new Error('Unsupported test role');
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
    return await db.query(sql, parameters);
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

export async function rpc(db, userId, name, parameters = [], role = 'authenticated') {
  if (!/^s08_[a-z_]+$/.test(name)) throw new Error('Unsupported test function');
  const placeholders = parameters.map((_, index) => `$${index + 1}`).join(', ');
  const result = await asUser(db, userId, `select public.${name}(${placeholders}) as result`, parameters, role);
  return result.rows[0].result;
}

export async function fixture(db, quantity = 10) {
  const boardId = await rpc(db, users.owner, 's08_create_board', ['테스트 보드']);
  const invite = await rpc(db, users.owner, 's08_get_invite', [boardId]);
  await rpc(db, users.member, 's08_join_board', [invite]);
  const item = await rpc(db, users.owner, 's08_add_item', [boardId, '충전기', 'CHARGER-01', quantity, '개', 3]);
  return { boardId, invite, item };
}

export function errorCode(expected) {
  return (error) => error.code === expected;
}
