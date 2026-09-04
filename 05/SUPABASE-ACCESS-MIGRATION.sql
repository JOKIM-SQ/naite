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
