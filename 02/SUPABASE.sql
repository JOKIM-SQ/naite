create table if not exists s02_products (
  id uuid primary key default gen_random_uuid(),
  asin text not null unique,
  source_url text not null,
  title text not null,
  displayed_price text,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists s02_tags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  level smallint not null check (level between 1 and 3)
);

create table if not exists s02_product_tags (
  product_id uuid not null references s02_products(id) on delete cascade,
  tag_id uuid not null references s02_tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

alter table s02_products enable row level security;
alter table s02_tags enable row level security;
alter table s02_product_tags enable row level security;

create policy "public read s02 products" on s02_products for select using (true);
create policy "public insert s02 products" on s02_products for insert with check (true);
create policy "public read s02 tags" on s02_tags for select using (true);
create policy "public insert s02 tags" on s02_tags for insert with check (true);
create policy "public read s02 product tags" on s02_product_tags for select using (true);
create policy "public insert s02 product tags" on s02_product_tags for insert with check (true);
