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

create or replace function public.delete_s02_product(p_product_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pin <> '0000' then
    raise exception 'PIN_MISMATCH' using errcode = '28000';
  end if;

  delete from public.s02_products where id = p_product_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_s02_product(uuid, text) from public;
grant execute on function public.delete_s02_product(uuid, text) to anon, authenticated;
