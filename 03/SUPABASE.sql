-- S03 팀 아이디어 보드 — 오늘 커피 어디서 마실까요?
-- 이번 주 인증 옵션을 Auth.js(Credentials + JWT 세션)로 바꾸면서
-- Supabase Auth(auth.users)에 대한 의존을 없애고 자체 사용자 테이블을 둔다.
-- 서버 함수가 직접 이 Postgres에 접속해 소유권·투표 한도를 검증하므로 RLS는 쓰지 않는다.

create schema if not exists weekly_projects;

-- 이전(Supabase Auth 버전)의 s03 테이블이 있다면 auth.users 참조를 없애기 위해 다시 만든다.
drop table if exists weekly_projects.s03_votes;
drop table if exists weekly_projects.s03_ideas;
drop table if exists weekly_projects.s03_users;

create table weekly_projects.s03_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table weekly_projects.s03_ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0 and char_length(title) <= 120),
  author_id uuid not null references weekly_projects.s03_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table weekly_projects.s03_votes (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references weekly_projects.s03_ideas(id) on delete cascade,
  voter_id uuid not null references weekly_projects.s03_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (idea_id, voter_id)
);

create index s03_votes_voter_idx on weekly_projects.s03_votes(voter_id);
create index s03_votes_idea_idx on weekly_projects.s03_votes(idea_id);

-- RLS는 켜지 않는다 — 서버 함수가 service_role 키로 PostgREST에 접속해
-- Auth.js 세션에서 나온 user id로 본인 글/투표 한도를 코드에서 직접 검증한다.
-- anon/authenticated에는 아무 권한도 주지 않는다 — 클라이언트는 우리 서버 함수를 거쳐야만 접근 가능하다.
grant usage on schema weekly_projects to service_role;
grant all on all tables in schema weekly_projects to service_role;
grant usage, select on all sequences in schema weekly_projects to service_role;
