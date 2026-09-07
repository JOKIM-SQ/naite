create schema if not exists weekly_projects;

create table if not exists weekly_projects.s06_products (
  id uuid primary key default gen_random_uuid(),
  asin text not null unique check (asin ~ '^[A-Z0-9]{10}$'),
  source_url text not null,
  title text,
  displayed_price text,
  rating numeric(2,1) check (rating between 0 and 5),
  image_url text,
  tracking_enabled boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists weekly_projects.s06_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references weekly_projects.s06_products(id) on delete cascade,
  tracked_on date not null,
  checked_at timestamptz not null default now(),
  displayed_price text,
  rating numeric(2,1) check (rating between 0 and 5),
  visible_review_count integer not null default 0 check (visible_review_count >= 0),
  unique (product_id, tracked_on)
);

create table if not exists weekly_projects.s06_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references weekly_projects.s06_products(id) on delete cascade,
  fingerprint text not null,
  review_title text,
  review_text text not null,
  rating numeric(2,1) check (rating between 0 and 5),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (product_id, fingerprint)
);

create table if not exists weekly_projects.s06_review_analyses (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references weekly_projects.s06_products(id) on delete cascade,
  analyzed_on date not null,
  review_fingerprints text[] not null,
  review_count integer not null check (review_count > 0),
  analysis jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists weekly_projects.s06_settings (
  id boolean primary key default true check (id),
  daily_tracking_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into weekly_projects.s06_settings (id, daily_tracking_enabled)
values (true, true)
on conflict (id) do nothing;

create index if not exists s06_daily_snapshots_product_tracked_on_idx on weekly_projects.s06_daily_snapshots(product_id, tracked_on desc);
create index if not exists s06_reviews_product_first_seen_idx on weekly_projects.s06_reviews(product_id, first_seen_at desc);
create index if not exists s06_review_analyses_product_created_idx on weekly_projects.s06_review_analyses(product_id, created_at desc);

grant usage on schema weekly_projects to service_role;
grant all on all tables in schema weekly_projects to service_role;
grant usage, select on all sequences in schema weekly_projects to service_role;
