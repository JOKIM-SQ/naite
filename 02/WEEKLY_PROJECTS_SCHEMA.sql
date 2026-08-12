create schema if not exists weekly_projects;
grant usage on schema weekly_projects to anon, authenticated;

create table if not exists weekly_projects.s02_products (
  id uuid primary key default gen_random_uuid(),
  asin text not null unique,
  source_url text not null,
  title text not null,
  displayed_price text,
  image_url text,
  last_price_cents integer check (last_price_cents >= 0),
  price_change smallint not null default 0 check (price_change between -1 and 1),
  last_price_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists weekly_projects.s02_tags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  level smallint not null check (level between 1 and 4),
  source text not null default 'amazon' check (source in ('amazon', 'custom'))
);

create table if not exists weekly_projects.s02_product_tags (
  product_id uuid not null references weekly_projects.s02_products(id) on delete cascade,
  tag_id uuid not null references weekly_projects.s02_tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

create table if not exists weekly_projects.s02_price_checks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references weekly_projects.s02_products(id) on delete cascade,
  checked_at timestamptz not null default now(),
  displayed_price text not null,
  price_cents integer not null check (price_cents >= 0),
  price_change smallint not null check (price_change between -1 and 1)
);

create index if not exists s02_price_checks_product_checked_at_idx on weekly_projects.s02_price_checks(product_id, checked_at desc);

grant select, insert, update on weekly_projects.s02_products to anon, authenticated;
grant select, insert on weekly_projects.s02_tags to anon, authenticated;
grant select, insert, delete on weekly_projects.s02_product_tags to anon, authenticated;
grant select, insert on weekly_projects.s02_price_checks to anon, authenticated;
grant usage, select on all sequences in schema weekly_projects to anon, authenticated;

insert into weekly_projects.s02_products (id, asin, source_url, title, displayed_price, image_url, last_price_cents, price_change, last_price_checked_at, created_at)
select id, asin, source_url, title, displayed_price, image_url, last_price_cents, price_change, last_price_checked_at, created_at
from public.s02_products
on conflict (id) do update set asin = excluded.asin, source_url = excluded.source_url, title = excluded.title, displayed_price = excluded.displayed_price, image_url = excluded.image_url, last_price_cents = excluded.last_price_cents, price_change = excluded.price_change, last_price_checked_at = excluded.last_price_checked_at;

insert into weekly_projects.s02_tags (id, key, label, level, source)
select id, key, label, level, coalesce(source, case when level = 4 then 'custom' else 'amazon' end)
from public.s02_tags
on conflict (id) do update set key = excluded.key, label = excluded.label, level = excluded.level, source = excluded.source;

insert into weekly_projects.s02_product_tags (product_id, tag_id)
select product_id, tag_id from public.s02_product_tags
on conflict do nothing;

insert into weekly_projects.s02_price_checks (id, product_id, checked_at, displayed_price, price_cents, price_change)
select id, product_id, checked_at, displayed_price, price_cents, price_change from public.s02_price_checks
on conflict (id) do nothing;

alter table weekly_projects.s02_products enable row level security;
alter table weekly_projects.s02_tags enable row level security;
alter table weekly_projects.s02_product_tags enable row level security;
alter table weekly_projects.s02_price_checks enable row level security;

drop policy if exists "weekly read s02 products" on weekly_projects.s02_products;
create policy "weekly read s02 products" on weekly_projects.s02_products for select using (true);
drop policy if exists "weekly insert s02 products" on weekly_projects.s02_products;
create policy "weekly insert s02 products" on weekly_projects.s02_products for insert with check (true);
drop policy if exists "weekly update s02 products" on weekly_projects.s02_products;
create policy "weekly update s02 products" on weekly_projects.s02_products for update using (true) with check (true);
drop policy if exists "weekly read s02 tags" on weekly_projects.s02_tags;
create policy "weekly read s02 tags" on weekly_projects.s02_tags for select using (true);
drop policy if exists "weekly insert s02 tags" on weekly_projects.s02_tags;
create policy "weekly insert s02 tags" on weekly_projects.s02_tags for insert with check (true);
drop policy if exists "weekly read s02 product tags" on weekly_projects.s02_product_tags;
create policy "weekly read s02 product tags" on weekly_projects.s02_product_tags for select using (true);
drop policy if exists "weekly insert s02 product tags" on weekly_projects.s02_product_tags;
create policy "weekly insert s02 product tags" on weekly_projects.s02_product_tags for insert with check (true);
drop policy if exists "weekly delete s02 product tags" on weekly_projects.s02_product_tags;
create policy "weekly delete s02 product tags" on weekly_projects.s02_product_tags for delete using (true);
drop policy if exists "weekly read s02 price checks" on weekly_projects.s02_price_checks;
create policy "weekly read s02 price checks" on weekly_projects.s02_price_checks for select using (true);
drop policy if exists "weekly insert s02 price checks" on weekly_projects.s02_price_checks;
create policy "weekly insert s02 price checks" on weekly_projects.s02_price_checks for insert with check (true);

create or replace function weekly_projects.delete_s02_product(p_product_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = weekly_projects
as $$
begin
  if p_pin <> '0000' then
    raise exception 'PIN_MISMATCH' using errcode = '28000';
  end if;
  delete from weekly_projects.s02_products where id = p_product_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return true;
end;
$$;

revoke all on function weekly_projects.delete_s02_product(uuid, text) from public;
grant execute on function weekly_projects.delete_s02_product(uuid, text) to anon, authenticated;
