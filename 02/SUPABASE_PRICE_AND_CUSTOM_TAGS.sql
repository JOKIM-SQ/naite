alter table public.s02_products add column if not exists last_price_cents integer check (last_price_cents >= 0);
alter table public.s02_products add column if not exists price_change smallint not null default 0 check (price_change between -1 and 1);
alter table public.s02_products add column if not exists last_price_checked_at timestamptz;

alter table public.s02_tags drop constraint if exists s02_tags_level_check;
alter table public.s02_tags add constraint s02_tags_level_check check (level between 1 and 4);
alter table public.s02_tags add column if not exists source text not null default 'amazon' check (source in ('amazon', 'custom'));

create table if not exists public.s02_price_checks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.s02_products(id) on delete cascade,
  checked_at timestamptz not null default now(),
  displayed_price text not null,
  price_cents integer not null check (price_cents >= 0),
  price_change smallint not null check (price_change between -1 and 1)
);

create index if not exists s02_price_checks_product_checked_at_idx on public.s02_price_checks(product_id, checked_at desc);

alter table public.s02_price_checks enable row level security;

drop policy if exists "public read s02 price checks" on public.s02_price_checks;
create policy "public read s02 price checks" on public.s02_price_checks for select using (true);
drop policy if exists "public insert s02 price checks" on public.s02_price_checks;
create policy "public insert s02 price checks" on public.s02_price_checks for insert with check (true);
drop policy if exists "public update s02 products" on public.s02_products;
create policy "public update s02 products" on public.s02_products for update using (true) with check (true);
drop policy if exists "public delete s02 product tags" on public.s02_product_tags;
create policy "public delete s02 product tags" on public.s02_product_tags for delete using (true);
