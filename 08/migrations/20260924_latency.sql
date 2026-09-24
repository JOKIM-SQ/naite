-- S08 latency upgrade: apply after the original setup as database owner.
begin;

alter table public.s08_items add column if not exists change_sent_at timestamptz;

-- No DEFAULT on p_sent_at: PostgREST must distinguish legacy and new callers.
create or replace function public.s08_adjust_stock(
  p_item_id uuid, p_delta integer, p_request_id uuid, p_sent_at timestamptz
)
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
  if p_sent_at is not null and not pg_catalog.isfinite(p_sent_at) then
    raise exception '유효한 발신 시각이 필요합니다.' using errcode = '22023';
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
      revision = v_item.revision + 1, updated_at = pg_catalog.clock_timestamp(), updated_by = v_user,
      change_sent_at = p_sent_at
      where id = p_item_id;
  end if;

  return pg_catalog.jsonb_build_object('item_id', v_movement.item_id,
    'quantity', v_movement.quantity_after, 'revision', v_movement.revision_after,
    'request_id', v_movement.request_id);
end;
$$;

create or replace function public.s08_adjust_stock(p_item_id uuid, p_delta integer, p_request_id uuid)
returns jsonb
language sql security definer set search_path = ''
as $$
  select public.s08_adjust_stock(p_item_id, p_delta, p_request_id, null::timestamptz);
$$;

revoke all on function public.s08_adjust_stock(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.s08_adjust_stock(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.s08_adjust_stock(uuid, integer, uuid) to authenticated;
grant execute on function public.s08_adjust_stock(uuid, integer, uuid, timestamptz) to authenticated;

commit;
