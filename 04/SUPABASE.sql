create schema if not exists weekly_projects;

create table if not exists weekly_projects.s04_products (
  id uuid primary key default gen_random_uuid(),
  asin text not null unique,
  source_url text not null,
  title text not null,
  displayed_price text,
  rating numeric(2,1) check (rating between 0 and 5),
  image_url text,
  last_price_cents integer check (last_price_cents >= 0),
  price_change smallint not null default 0 check (price_change between -1 and 1),
  rating_change smallint not null default 0 check (rating_change between -1 and 1),
  last_price_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists weekly_projects.s04_tags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  level smallint not null check (level between 1 and 4),
  source text not null default 'amazon' check (source in ('amazon', 'custom'))
);

create table if not exists weekly_projects.s04_product_tags (
  product_id uuid not null references weekly_projects.s04_products(id) on delete cascade,
  tag_id uuid not null references weekly_projects.s04_tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create table if not exists weekly_projects.s04_price_checks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references weekly_projects.s04_products(id) on delete cascade,
  checked_at timestamptz not null default now(),
  displayed_price text,
  price_cents integer not null check (price_cents >= 0),
  rating numeric(2,1) check (rating between 0 and 5),
  price_change smallint not null default 0 check (price_change between -1 and 1),
  rating_change smallint not null default 0 check (rating_change between -1 and 1)
);

alter table weekly_projects.s04_products add column if not exists rating_change smallint not null default 0 check (rating_change between -1 and 1);
alter table weekly_projects.s04_price_checks add column if not exists rating_change smallint not null default 0 check (rating_change between -1 and 1);

create index if not exists s04_price_checks_product_checked_at_idx on weekly_projects.s04_price_checks(product_id, checked_at asc);

grant usage on schema weekly_projects to anon, authenticated, service_role;
grant select, insert, update, delete on weekly_projects.s04_products to anon, authenticated, service_role;
grant select, insert, update, delete on weekly_projects.s04_tags to anon, authenticated, service_role;
grant select, insert, delete on weekly_projects.s04_product_tags to anon, authenticated, service_role;
grant select, insert on weekly_projects.s04_price_checks to anon, authenticated, service_role;

alter table weekly_projects.s04_products enable row level security;
alter table weekly_projects.s04_tags enable row level security;
alter table weekly_projects.s04_product_tags enable row level security;
alter table weekly_projects.s04_price_checks enable row level security;

drop policy if exists "s04 products public" on weekly_projects.s04_products;
create policy "s04 products public" on weekly_projects.s04_products for all using (true) with check (true);
drop policy if exists "s04 tags public" on weekly_projects.s04_tags;
create policy "s04 tags public" on weekly_projects.s04_tags for all using (true) with check (true);
drop policy if exists "s04 product tags public" on weekly_projects.s04_product_tags;
create policy "s04 product tags public" on weekly_projects.s04_product_tags for all using (true) with check (true);
drop policy if exists "s04 price checks public" on weekly_projects.s04_price_checks;
create policy "s04 price checks public" on weekly_projects.s04_price_checks for all using (true) with check (true);
