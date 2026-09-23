-- S08 Stockroom: run once in the Supabase SQL editor as the database owner.
-- Re-running this file preserves data. Only S08 objects are created or altered.
-- Google is the client login provider; database access requires auth.uid() plus membership.
begin;

create schema if not exists s08_private;
revoke all on schema s08_private from public, anon, authenticated;
grant usage on schema s08_private to authenticated;

create table if not exists public.s08_boards (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (pg_catalog.btrim(name) <> ''),
  owner_id uuid not null references auth.users(id),
  invite_code uuid not null unique default pg_catalog.gen_random_uuid(),
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists public.s08_members (
  board_id uuid not null references public.s08_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (board_id, user_id)
);
create index if not exists s08_members_user_board_idx on public.s08_members(user_id, board_id);

create table if not exists public.s08_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  board_id uuid not null references public.s08_boards(id) on delete cascade,
  name text not null check (pg_catalog.btrim(name) <> ''),
  sku text not null check (pg_catalog.btrim(sku) <> ''),
  quantity integer not null check (quantity between 0 and 1000000),
  unit text not null check (pg_catalog.btrim(unit) <> ''),
  low_stock integer not null check (low_stock between 0 and 1000000),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid not null references auth.users(id),
  unique (board_id, id)
);
create unique index if not exists s08_items_board_sku_idx
  on public.s08_items(board_id, pg_catalog.lower(sku));

create table if not exists public.s08_movements (
  request_id uuid primary key,
  board_id uuid not null references public.s08_boards(id) on delete cascade,
  item_id uuid not null,
  actor_id uuid not null references auth.users(id),
  delta integer not null,
  quantity_after integer not null check (quantity_after between 0 and 1000000),
  revision_after integer not null check (revision_after >= 1),
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (board_id, item_id) references public.s08_items(board_id, id) on delete cascade
);
create index if not exists s08_movements_board_created_idx
  on public.s08_movements(board_id, created_at desc);

-- Revoke Supabase default grants, then expose only the columns each client needs.
revoke all on table public.s08_boards, public.s08_members, public.s08_items, public.s08_movements
  from public, anon, authenticated;
grant select (id, name, owner_id, created_at) on public.s08_boards to authenticated;
grant select on public.s08_members, public.s08_items, public.s08_movements to authenticated;

alter table public.s08_boards enable row level security;
alter table public.s08_members enable row level security;
alter table public.s08_items enable row level security;
alter table public.s08_movements enable row level security;

-- A non-exposed SECURITY DEFINER helper avoids recursive membership RLS checks.
create or replace function s08_private.is_member(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.s08_members as member
    where member.board_id = p_board_id and member.user_id = (select auth.uid())
  );
$$;
revoke all on function s08_private.is_member(uuid) from public, anon, authenticated;
grant execute on function s08_private.is_member(uuid) to authenticated;

-- CREATE POLICY has no IF NOT EXISTS. Keep the existing S08 policies on a repeat run.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 's08_boards' and policyname = 's08_boards_member_read') then
    create policy s08_boards_member_read on public.s08_boards for select to authenticated
      using (s08_private.is_member(id));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 's08_members' and policyname = 's08_members_member_read') then
    create policy s08_members_member_read on public.s08_members for select to authenticated
      using (s08_private.is_member(board_id));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 's08_items' and policyname = 's08_items_member_read') then
    create policy s08_items_member_read on public.s08_items for select to authenticated
      using (s08_private.is_member(board_id));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 's08_movements' and policyname = 's08_movements_member_read') then
    create policy s08_movements_member_read on public.s08_movements for select to authenticated
      using (s08_private.is_member(board_id));
  end if;
end;
$$;

create or replace function public.s08_list_boards()
returns table (id uuid, name text, role text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  return query
    select board.id, board.name, member.role
    from public.s08_boards as board
    join public.s08_members as member on member.board_id = board.id
    where member.user_id = v_user
    order by board.created_at, board.id;
end;
$$;

create or replace function public.s08_create_board(p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_board uuid;
begin
  if v_user is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_name is null or pg_catalog.btrim(p_name) = '' then
    raise exception '보드 이름을 입력하세요.' using errcode = '22023';
  end if;
  insert into public.s08_boards (name, owner_id)
    values (pg_catalog.btrim(p_name), v_user) returning id into v_board;
  insert into public.s08_members (board_id, user_id, role)
    values (v_board, v_user, 'owner');
  return v_board;
end;
$$;

create or replace function public.s08_join_board(p_invite_code uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_board uuid;
begin
  if v_user is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select board.id into v_board from public.s08_boards as board
    where board.invite_code = p_invite_code;
  if v_board is null then
    raise exception '초대를 찾을 수 없습니다.' using errcode = '42501';
  end if;
  insert into public.s08_members (board_id, user_id, role)
    values (v_board, v_user, 'member') on conflict (board_id, user_id) do nothing;
  return v_board;
end;
$$;

create or replace function public.s08_get_invite(p_board_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_invite uuid;
begin
  if v_user is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select board.invite_code into v_invite from public.s08_boards as board
    where board.id = p_board_id and board.owner_id = v_user
      and s08_private.is_member(board.id);
  if v_invite is null then
    raise exception '소유자만 초대 링크를 만들 수 있습니다.' using errcode = '42501';
  end if;
  return v_invite;
end;
$$;

create or replace function public.s08_add_item(
  p_board_id uuid, p_name text, p_sku text, p_quantity integer, p_unit text, p_low_stock integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.s08_items%rowtype;
begin
  if v_user is null or not s08_private.is_member(p_board_id) then
    raise exception '이 보드에 접근할 수 없습니다.' using errcode = '42501';
  end if;
  if p_name is null or pg_catalog.btrim(p_name) = ''
    or p_sku is null or pg_catalog.btrim(p_sku) = ''
    or p_unit is null or pg_catalog.btrim(p_unit) = ''
    or p_quantity is null or p_quantity < 0 or p_quantity > 1000000
    or p_low_stock is null or p_low_stock < 0 or p_low_stock > 1000000 then
    raise exception '품목 입력값을 확인하세요. 수량과 부족 기준은 0~1,000,000입니다.' using errcode = '22023';
  end if;
  insert into public.s08_items (board_id, name, sku, quantity, unit, low_stock, updated_by)
    values (p_board_id, pg_catalog.btrim(p_name), pg_catalog.btrim(p_sku), p_quantity,
      pg_catalog.btrim(p_unit), p_low_stock, v_user)
    returning * into v_item;
  return pg_catalog.to_jsonb(v_item);
end;
$$;

create or replace function public.s08_adjust_stock(p_item_id uuid, p_delta integer, p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_item public.s08_items%rowtype;
  v_movement public.s08_movements%rowtype;
  v_quantity bigint;
begin
  if v_user is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_request_id is null or p_delta is null or p_delta = 0 then
    raise exception '0이 아닌 변경량과 요청 ID가 필요합니다.' using errcode = '22023';
  end if;

  -- Every writer locks the item before reading its quantity. Membership is checked
  -- before locking or looking up a replay, so request IDs never bypass permissions.
  select item.* into v_item from public.s08_items as item
    where item.id = p_item_id and s08_private.is_member(item.board_id)
    for update;
  if not found then
    raise exception '이 품목에 접근할 수 없습니다.' using errcode = '42501';
  end if;

  select movement.* into v_movement from public.s08_movements as movement
    where movement.request_id = p_request_id;
  if found then
    if v_movement.actor_id <> v_user or v_movement.item_id <> p_item_id or v_movement.delta <> p_delta then
      raise exception '같은 요청 ID를 다른 변경에 사용할 수 없습니다.' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object('item_id', v_movement.item_id,
      'quantity', v_movement.quantity_after, 'revision', v_movement.revision_after,
      'request_id', v_movement.request_id);
  end if;

  -- bigint arithmetic rejects out-of-range deltas without an integer overflow.
  v_quantity := v_item.quantity::bigint + p_delta::bigint;
  if v_quantity < 0 or v_quantity > 1000000 then
    raise exception '변경 후 수량은 0~1,000,000이어야 합니다.' using errcode = '22023';
  end if;

  -- A globally unique request ID also arbitrates concurrent calls for different
  -- items. The loser waits for the winning transaction and verifies its payload.
  -- No stock is updated before this INSERT succeeds. Both writes commit together.
  insert into public.s08_movements
    (request_id, board_id, item_id, actor_id, delta, quantity_after, revision_after)
    values (p_request_id, v_item.board_id, p_item_id, v_user, p_delta,
      v_quantity::integer, v_item.revision + 1)
    on conflict (request_id) do nothing
    returning * into v_movement;
  if not found then
    select movement.* into v_movement from public.s08_movements as movement
      where movement.request_id = p_request_id;
    if v_movement.request_id is null or v_movement.actor_id <> v_user
      or v_movement.item_id <> p_item_id or v_movement.delta <> p_delta then
      raise exception '같은 요청 ID를 다른 변경에 사용할 수 없습니다.' using errcode = '22023';
    end if;
  else
    update public.s08_items set quantity = v_quantity::integer,
      revision = v_item.revision + 1, updated_at = pg_catalog.clock_timestamp(), updated_by = v_user
      where id = p_item_id;
  end if;

  return pg_catalog.jsonb_build_object('item_id', v_movement.item_id,
    'quantity', v_movement.quantity_after, 'revision', v_movement.revision_after,
    'request_id', v_movement.request_id);
end;
$$;

-- PostgreSQL grants function EXECUTE to PUBLIC by default; revoke it explicitly.
revoke all on function public.s08_list_boards() from public, anon, authenticated;
revoke all on function public.s08_create_board(text) from public, anon, authenticated;
revoke all on function public.s08_join_board(uuid) from public, anon, authenticated;
revoke all on function public.s08_get_invite(uuid) from public, anon, authenticated;
revoke all on function public.s08_add_item(uuid, text, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.s08_adjust_stock(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.s08_list_boards() to authenticated;
grant execute on function public.s08_create_board(text) to authenticated;
grant execute on function public.s08_join_board(uuid) to authenticated;
grant execute on function public.s08_get_invite(uuid) to authenticated;
grant execute on function public.s08_add_item(uuid, text, text, integer, text, integer) to authenticated;
grant execute on function public.s08_adjust_stock(uuid, integer, uuid) to authenticated;

-- Preserve all other weeks' publication entries. Supabase supplies this publication.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 's08_items'
    ) then
      alter publication supabase_realtime add table public.s08_items;
    end if;
  else
    raise notice 'supabase_realtime publication is missing; enable it before using Realtime.';
  end if;
end;
$$;

commit;
