-- API > Exposed schemas에 weekly_projects를 추가해야 합니다.
-- 서버 전용 SUPABASE_SERVICE_ROLE_KEY만 이 테이블과 private Storage에 접근합니다.
-- 브라우저 Auth 초기화에는 공개 publishable 키만 사용하며 서버 서비스 키는 노출하지 않습니다.

begin;

create schema if not exists weekly_projects;
grant usage on schema weekly_projects to service_role;

create table if not exists weekly_projects.s07_receipts (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete restrict,
  session_hash text check (session_hash ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed', 'deleting')),
  error text check (char_length(error) <= 500),
  original_values jsonb,
  edited_values jsonb,
  correction_count integer not null default 0 check (correction_count >= 0),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (original_values is null or jsonb_typeof(original_values) = 'object'),
  check (edited_values is null or jsonb_typeof(edited_values) = 'object'),
  check (status <> 'ready' or (original_values is not null and edited_values is not null))
);

alter table weekly_projects.s07_receipts
  add column if not exists user_id uuid;

alter table weekly_projects.s07_receipts
  alter column session_hash drop not null;

alter table weekly_projects.s07_receipts
  drop constraint if exists s07_receipts_status_check;
alter table weekly_projects.s07_receipts
  add constraint s07_receipts_status_check
  check (status in ('processing', 'ready', 'failed', 'deleting'));

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
grant select, insert, update, delete on weekly_projects.s07_receipts to service_role;

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('s07-receipts', 's07-receipts', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- s07-receipts에는 anon/authenticated Storage 정책을 추가하지 않습니다.
-- 기존 프로젝트에 모든 bucket을 허용하는 정책이 있다면 이 bucket은 제외해야 합니다.
-- 원본 조회는 서버가 생성하는 5분짜리 서명 URL만 사용합니다.
notify pgrst, 'reload schema';
commit;
