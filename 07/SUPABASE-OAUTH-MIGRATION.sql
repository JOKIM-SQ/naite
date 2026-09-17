-- 기존 익명 행과 원본 파일은 보존하며 어떤 계정에도 자동 귀속하지 않습니다.
-- 기존 session_hash 경로 CHECK는 계정 행의 NULL session_hash를 허용하므로 제거하지 않습니다.
-- 새 owner/path CHECK와 INSERT trigger가 신규 익명 행 및 계정 변경을 차단합니다.
begin;

alter table weekly_projects.s07_receipts
  add column if not exists user_id uuid;

alter table weekly_projects.s07_receipts
  alter column session_hash drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'weekly_projects.s07_receipts'::regclass
      and conname = 's07_receipts_user_id_fkey'
  ) then
    alter table weekly_projects.s07_receipts
      add constraint s07_receipts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'weekly_projects.s07_receipts'::regclass
      and conname = 's07_receipts_owner_path_check'
  ) then
    alter table weekly_projects.s07_receipts
      add constraint s07_receipts_owner_path_check check (
        (user_id is null and session_hash is not null
          and storage_path like session_hash || '/' || id::text || '.%')
        or
        (user_id is not null and session_hash is null
          and storage_path like user_id::text || '/' || id::text || '.%')
      );
  end if;
end;
$$;

create index if not exists s07_receipts_user_created
  on weekly_projects.s07_receipts (user_id, created_at desc)
  where user_id is not null;

alter table weekly_projects.s07_receipts enable row level security;
revoke all on weekly_projects.s07_receipts from public, anon, authenticated;
grant usage on schema weekly_projects to service_role;
grant select, insert, update on weekly_projects.s07_receipts to service_role;

create or replace function weekly_projects.s07_protect_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is null or new.session_hash is not null then
      raise exception 'Authenticated receipt owner is required';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.session_hash is distinct from old.session_hash
    or new.storage_path is distinct from old.storage_path
    or new.file_name is distinct from old.file_name
    or new.media_type is distinct from old.media_type
    or new.created_at is distinct from old.created_at then
    raise exception 'Receipt identity is immutable';
  end if;
  if old.original_values is not null and new.original_values is distinct from old.original_values then
    raise exception 'Initial extraction is immutable';
  end if;
  if new.revision <> old.revision + 1 or new.correction_count < old.correction_count then
    raise exception 'Invalid receipt revision';
  end if;
  if new.edited_values is distinct from old.edited_values and new.status <> 'ready' then
    raise exception 'Only ready receipts may be edited';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function weekly_projects.s07_protect_receipt() from public, anon, authenticated;
create or replace trigger s07_protect_receipt
before insert or update on weekly_projects.s07_receipts
for each row execute function weekly_projects.s07_protect_receipt();

notify pgrst, 'reload schema';
commit;
