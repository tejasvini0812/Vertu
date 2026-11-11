-- VERTU Phase 2: customer accounts, address book, wishlist, saved bag, back-in-stock alerts,
-- collection details for product pages, and customers reading their own orders.

-- ---------------------------------------------------------------- collection details

alter table public.categories
  add column description text  not null default '' check (char_length(description) <= 2000),
  add column details     jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object');
-- details shape: { "features": [text], "specs": { "Dimensions": text, "Material": text, ... }, "care": text }

create trigger categories_audit after update on public.categories
  for each row execute function public.audit('id');

-- Staff edit collection copy (like editorial); adding or removing collections stays with owners.
create policy "categories admin update" on public.categories for update
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text not null default '' check (char_length(full_name) <= 120),
  phone            text not null default '' check (phone = '' or phone ~ '^\+91[6-9][0-9]{9}$'),
  marketing_opt_in boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Every new account gets a profile row.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- addresses

create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label      text not null default '' check (char_length(label) <= 40),
  full_name  text not null check (char_length(full_name) between 1 and 120),
  phone      text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  line1      text not null check (char_length(line1) between 1 and 200),
  line2      text not null default '' check (char_length(line2) <= 200),
  city       text not null check (char_length(city) between 1 and 80),
  state      text not null check (char_length(state) between 1 and 60),
  pin        text not null check (pin ~ '^[1-9][0-9]{5}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create trigger addresses_touch before update on public.addresses
  for each row execute function public.touch_updated_at();

-- At most 10 addresses per person; the first one is the default; choosing a new default unsets the old.
create function public.addresses_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return new; end if; -- the unset-other-defaults update below
  if tg_op = 'INSERT' and (select count(*) from public.addresses where user_id = new.user_id) >= 10 then
    raise exception 'address_limit' using errcode = '23514';
  end if;
  if new.is_default then
    update public.addresses set is_default = false
    where user_id = new.user_id and id <> new.id and is_default;
  elsif tg_op = 'INSERT' and not exists (select 1 from public.addresses where user_id = new.user_id and is_default) then
    new.is_default := true;
  end if;
  return new;
end $$;
create trigger addresses_rules before insert or update of is_default on public.addresses
  for each row execute function public.addresses_rules();

-- ---------------------------------------------------------------- wishlist, saved bag

create table public.wishlist_items (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sku        text not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sku)
);

create table public.carts (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  items      jsonb not null default '[]'::jsonb
             check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50),
  updated_at timestamptz not null default now()
);
create trigger carts_touch before update on public.carts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- back-in-stock alerts
-- Anyone can ask to be told when a sold-out colour returns. Emails go out in Phase 4.

create table public.stock_alerts (
  id          bigint generated always as identity primary key,
  sku         text not null references public.products (id) on delete cascade,
  email       text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (sku, email)
);
create index stock_alerts_pending_idx on public.stock_alerts (sku) where notified_at is null;

-- ---------------------------------------------------------------- privacy requests (DPDP Act)

create table public.data_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  email       text not null,
  kind        text not null check (kind in ('delete', 'export')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------------------------------------------------------------- row level security

alter table public.profiles       enable row level security;
alter table public.addresses      enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.carts          enable row level security;
alter table public.stock_alerts   enable row level security;
alter table public.data_requests  enable row level security;

create policy "profile own read" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profile own update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "addresses own" on public.addresses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "addresses admin read" on public.addresses for select using (public.is_admin());

create policy "wishlist own" on public.wishlist_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "cart own" on public.carts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "stock alert anyone asks" on public.stock_alerts for insert
  with check (
    notified_at is null
    and (user_id is null or user_id = auth.uid())
    and exists (select 1 from public.products p where p.id = sku and p.status = 'active')
  );
create policy "stock alert own or admin read" on public.stock_alerts for select
  using (user_id = auth.uid() or public.is_admin());
create policy "stock alert own delete" on public.stock_alerts for delete using (user_id = auth.uid());

create policy "data request own insert" on public.data_requests for insert
  with check (user_id = auth.uid() and resolved_at is null);
create policy "data request own or owner read" on public.data_requests for select
  using (user_id = auth.uid() or public.is_owner());
create policy "data request owner resolve" on public.data_requests for update
  using (public.is_owner()) with check (public.is_owner());

-- Customers see their own orders. (Orders are still only created by the checkout server, Phase 3.)
create policy "orders own read" on public.orders for select using (customer_id = auth.uid());
create policy "order items own read" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));

-- Column limits: people cannot rename their profile id or move rows between accounts.
revoke insert, delete on public.profiles from anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, marketing_opt_in) on public.profiles to authenticated;
revoke update on public.stock_alerts from anon, authenticated;
revoke insert, update, delete on public.addresses, public.wishlist_items, public.carts, public.data_requests from anon;
