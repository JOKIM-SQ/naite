-- S08 item history: apply after SUPABASE.sql as the database owner.
begin;

create index if not exists s08_movements_item_created_request_idx
  on public.s08_movements(item_id, created_at desc, request_id desc);

create or replace function public.s08_list_item_movements(
  p_item_id uuid,
  p_before_created_at timestamptz default null,
  p_before_request_id uuid default null,
  p_limit integer default 20
)
returns table (
  request_id uuid,
  actor_id uuid,
  actor_name text,
  delta integer,
  quantity_before integer,
  quantity_after integer,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_board_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception '조회 개수는 1~50이어야 합니다.' using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_request_id is null) then
    raise exception '이력 커서에는 시각과 요청 ID가 모두 필요합니다.' using errcode = '22023';
  end if;
  if p_before_created_at is not null and not pg_catalog.isfinite(p_before_created_at) then
    raise exception '유효한 이력 커서 시각이 필요합니다.' using errcode = '22023';
  end if;

  select item.board_id into v_board_id
    from public.s08_items as item
    where item.id = p_item_id and s08_private.is_member(item.board_id);
  if not found then
    raise exception '이 품목에 접근할 수 없습니다.' using errcode = '42501';
  end if;

  return query
    select movement.request_id, movement.actor_id,
      coalesce(
        nullif(pg_catalog.regexp_replace(
          case when pg_catalog.jsonb_typeof(actor.raw_user_meta_data -> 'full_name') = 'string'
            then actor.raw_user_meta_data ->> 'full_name' end,
          '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
        nullif(pg_catalog.regexp_replace(
          case when pg_catalog.jsonb_typeof(actor.raw_user_meta_data -> 'name') = 'string'
            then actor.raw_user_meta_data ->> 'name' end,
          '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
        '팀원'
      ) as actor_name,
      movement.delta, movement.quantity_after - movement.delta,
      movement.quantity_after, movement.created_at
    from public.s08_movements as movement
    join auth.users as actor on actor.id = movement.actor_id
    where movement.item_id = p_item_id and movement.board_id = v_board_id
      and (p_before_created_at is null
        or (movement.created_at, movement.request_id) < (p_before_created_at, p_before_request_id))
    order by movement.created_at desc, movement.request_id desc
    limit p_limit;
end;
$$;

revoke all on function public.s08_list_item_movements(uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.s08_list_item_movements(uuid, timestamptz, uuid, integer)
  to authenticated;

commit;
