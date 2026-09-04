create table if not exists public.s05_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_asin text not null check (source_asin ~ '^[A-Z0-9]{10}$'),
  source_url text not null,
  title text,
  image_url text,
  displayed_price text,
  import_status text not null default 'collecting' check (import_status in ('collecting', 'complete', 'needs_retry')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_asin)
);

create table if not exists public.s05_compatible_devices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.s05_products(id) on delete cascade,
  model_name text not null,
  variant_asin text not null check (variant_asin ~ '^[A-Z0-9]{10}$'),
  import_status text not null default 'collecting' check (import_status in ('collecting', 'complete', 'needs_retry')),
  unique (product_id, model_name)
);

create table if not exists public.s05_product_options (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.s05_compatible_devices(id) on delete cascade,
  color_name text not null,
  variant_asin text not null check (variant_asin ~ '^[A-Z0-9]{10}$'),
  variant_title text,
  image_url text,
  is_available boolean not null default true,
  unique (device_id, variant_asin)
);

alter table public.s05_product_options add column if not exists variant_title text;
alter table public.s05_product_options add column if not exists image_url text;

create index if not exists s05_products_owner_id_idx on public.s05_products(owner_id);
create index if not exists s05_compatible_devices_product_id_idx on public.s05_compatible_devices(product_id);
create index if not exists s05_product_options_device_id_idx on public.s05_product_options(device_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.s05_products to authenticated;
grant select, insert, update, delete on public.s05_compatible_devices to authenticated;
grant select, insert, update, delete on public.s05_product_options to authenticated;

alter table public.s05_products enable row level security;
alter table public.s05_compatible_devices enable row level security;
alter table public.s05_product_options enable row level security;

drop policy if exists "s05 products select own" on public.s05_products;
create policy "s05 products select own" on public.s05_products for select to authenticated
using (owner_id = (select auth.uid()));
drop policy if exists "s05 products insert own" on public.s05_products;
create policy "s05 products insert own" on public.s05_products for insert to authenticated
with check (owner_id = (select auth.uid()));
drop policy if exists "s05 products update own" on public.s05_products;
create policy "s05 products update own" on public.s05_products for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
drop policy if exists "s05 products delete own" on public.s05_products;
create policy "s05 products delete own" on public.s05_products for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "s05 devices select own product" on public.s05_compatible_devices;
create policy "s05 devices select own product" on public.s05_compatible_devices for select to authenticated
using (exists (select 1 from public.s05_products products where products.id = product_id and products.owner_id = (select auth.uid())));
drop policy if exists "s05 devices insert own product" on public.s05_compatible_devices;
create policy "s05 devices insert own product" on public.s05_compatible_devices for insert to authenticated
with check (exists (select 1 from public.s05_products products where products.id = product_id and products.owner_id = (select auth.uid())));
drop policy if exists "s05 devices update own product" on public.s05_compatible_devices;
create policy "s05 devices update own product" on public.s05_compatible_devices for update to authenticated
using (exists (select 1 from public.s05_products products where products.id = product_id and products.owner_id = (select auth.uid())))
with check (exists (select 1 from public.s05_products products where products.id = product_id and products.owner_id = (select auth.uid())));
drop policy if exists "s05 devices delete own product" on public.s05_compatible_devices;
create policy "s05 devices delete own product" on public.s05_compatible_devices for delete to authenticated
using (exists (select 1 from public.s05_products products where products.id = product_id and products.owner_id = (select auth.uid())));

drop policy if exists "s05 options select own product" on public.s05_product_options;
create policy "s05 options select own product" on public.s05_product_options for select to authenticated
using (exists (
  select 1 from public.s05_compatible_devices devices
  join public.s05_products products on products.id = devices.product_id
  where devices.id = device_id and products.owner_id = (select auth.uid())
));
drop policy if exists "s05 options insert own product" on public.s05_product_options;
create policy "s05 options insert own product" on public.s05_product_options for insert to authenticated
with check (exists (
  select 1 from public.s05_compatible_devices devices
  join public.s05_products products on products.id = devices.product_id
  where devices.id = device_id and products.owner_id = (select auth.uid())
));
drop policy if exists "s05 options update own product" on public.s05_product_options;
create policy "s05 options update own product" on public.s05_product_options for update to authenticated
using (exists (
  select 1 from public.s05_compatible_devices devices
  join public.s05_products products on products.id = devices.product_id
  where devices.id = device_id and products.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.s05_compatible_devices devices
  join public.s05_products products on products.id = devices.product_id
  where devices.id = device_id and products.owner_id = (select auth.uid())
));
drop policy if exists "s05 options delete own product" on public.s05_product_options;
create policy "s05 options delete own product" on public.s05_product_options for delete to authenticated
using (exists (
  select 1 from public.s05_compatible_devices devices
  join public.s05_products products on products.id = devices.product_id
  where devices.id = device_id and products.owner_id = (select auth.uid())
));

drop policy if exists "s05 spigen members only" on public.s05_products;
create policy "s05 spigen members only" on public.s05_products as restrictive for all to authenticated
using (right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@spigen.com' or lower(coalesce(auth.jwt() ->> 'email', '')) = 'jayoo0621@gmail.com')
with check (right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@spigen.com' or lower(coalesce(auth.jwt() ->> 'email', '')) = 'jayoo0621@gmail.com');

drop policy if exists "s05 spigen members only" on public.s05_compatible_devices;
create policy "s05 spigen members only" on public.s05_compatible_devices as restrictive for all to authenticated
using (right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@spigen.com' or lower(coalesce(auth.jwt() ->> 'email', '')) = 'jayoo0621@gmail.com')
with check (right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@spigen.com' or lower(coalesce(auth.jwt() ->> 'email', '')) = 'jayoo0621@gmail.com');

drop policy if exists "s05 spigen members only" on public.s05_product_options;
create policy "s05 spigen members only" on public.s05_product_options as restrictive for all to authenticated
using (right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@spigen.com' or lower(coalesce(auth.jwt() ->> 'email', '')) = 'jayoo0621@gmail.com')
with check (right(lower(coalesce(auth.jwt() ->> 'email', '')), 11) = '@spigen.com' or lower(coalesce(auth.jwt() ->> 'email', '')) = 'jayoo0621@gmail.com');
