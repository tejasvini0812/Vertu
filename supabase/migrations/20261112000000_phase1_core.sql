-- VERTU Phase 1: catalogue, editorial content, orders, staff roles, audit trail.
-- Run once on a new Supabase project (SQL editor, or `supabase db push`).
-- Prices are whole rupees (integer). Razorpay works in paise: multiply by 100 at checkout.

-- ---------------------------------------------------------------- tables

create table public.categories (
  id    text primary key,
  name  text not null,
  code  text not null unique,
  unit  text not null,
  sort  int  not null default 0
);

create table public.products (
  id          text primary key check (id ~ '^[A-Z0-9-]{3,40}$'),
  category    text not null references public.categories (id),
  colour      text not null check (char_length(colour) between 1 and 40),
  hex         text not null default '#22201d' check (hex ~ '^#[0-9a-fA-F]{6}$'),
  price       int  not null check (price >= 0 and price <= 10000000),
  stock       int  not null default 0 check (stock >= 0),
  status      text not null default 'draft' check (status in ('active', 'draft')),
  image       text not null default '',
  description text not null default '' check (char_length(description) <= 2000),
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_category_idx on public.products (category, sort);

-- Exactly one row. `published` is the editorial JSON the storefront renders.
create table public.site_content (
  id           int primary key default 1 check (id = 1),
  published    jsonb not null,
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table public.settings (
  id         int primary key default 1 check (id = 1),
  low_stock  int not null default 5 check (low_stock between 0 and 999),
  updated_at timestamptz not null default now()
);

create sequence public.order_number_seq start 10500;

create table public.orders (
  id             text primary key default ('VRT-' || nextval('public.order_number_seq')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  status         text not null default 'Pending'
                 check (status in ('Pending', 'Processing', 'Shipped', 'Delivered')),
  customer_id    uuid references auth.users (id) on delete set null,
  customer_name  text not null,
  customer_email text not null,
  customer_phone text not null default '',
  ship_address   text not null default '',
  ship_city      text not null default '',
  ship_state     text not null default '',
  ship_pin       text not null default '',
  note           text not null default ''
);
create index orders_created_idx on public.orders (created_at desc);
create index orders_status_idx on public.orders (status);

create table public.order_items (
  id       bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete cascade,
  sku      text not null,
  category text not null,
  colour   text not null,
  price    int  not null check (price >= 0),
  qty      int  not null check (qty > 0)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  added_by   uuid
);

create table public.inventory_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  sku         text not null,
  delta       int  not null,
  stock_after int  not null,
  reason      text not null default 'manual',
  actor       uuid
);
create index inventory_log_sku_idx on public.inventory_log (sku, created_at desc);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  changes    jsonb
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------- roles
-- Admin rights require BOTH a row in admin_users AND a two-step-verified session (aal2).

create function public.admin_role() returns text
language sql stable security definer set search_path = '' as $$
  select au.role from public.admin_users au
  where au.user_id = auth.uid()
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.admin_role() is not null
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.admin_role() = 'owner', false)
$$;

-- ---------------------------------------------------------------- triggers

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();
create trigger site_content_touch before update on public.site_content
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- Every stock movement is recorded. Checkout (Phase 3) sets vertu.stock_reason = 'order'.
create function public.log_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  before_stock int := case when tg_op = 'INSERT' then 0 else old.stock end;
begin
  if new.stock is distinct from before_stock then
    insert into public.inventory_log (sku, delta, stock_after, reason, actor)
    values (new.id, new.stock - before_stock, new.stock,
            coalesce(nullif(current_setting('vertu.stock_reason', true), ''),
                     case when tg_op = 'INSERT' then 'created' else 'manual' end),
            auth.uid());
  end if;
  return new;
end $$;

create trigger products_stock_log after insert or update of stock on public.products
  for each row execute function public.log_stock();

-- Who changed what. Long values (images, editorial JSON) are recorded as '(changed)'.
create function public.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  diff jsonb := '{}'::jsonb;
  k text;
  a jsonb;
  b jsonb;
  key_col text := tg_argv[0];
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      continue when k in ('updated_at');
      a := to_jsonb(old) -> k;
      b := to_jsonb(new) -> k;
      if a is distinct from b then
        diff := diff || jsonb_build_object(k,
          case when length(coalesce(a::text, '')) > 300 or length(coalesce(b::text, '')) > 300
               then to_jsonb('(changed)'::text)
               else jsonb_build_object('from', a, 'to', b) end);
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then
    diff := jsonb_strip_nulls(to_jsonb(new) - 'published' - 'image' - 'description');
  else
    diff := jsonb_strip_nulls(to_jsonb(old) - 'published' - 'image' - 'description');
  end if;
  insert into public.audit_log (actor, action, entity, entity_id, changes)
  values (auth.uid(), lower(tg_op), tg_table_name, rec ->> key_col, diff);
  return coalesce(new, old);
end $$;

create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit('id');
create trigger orders_audit after update on public.orders
  for each row execute function public.audit('id');
create trigger site_content_audit after update on public.site_content
  for each row execute function public.audit('id');
create trigger settings_audit after update on public.settings
  for each row execute function public.audit('id');
create trigger admin_users_audit after insert or update or delete on public.admin_users
  for each row execute function public.audit('user_id');

-- ---------------------------------------------------------------- row level security

alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.site_content  enable row level security;
alter table public.settings      enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.admin_users   enable row level security;
alter table public.inventory_log enable row level security;
alter table public.audit_log     enable row level security;

-- Shoppers (anon or signed in) see live products and published editorial only.
create policy "categories readable" on public.categories for select using (true);
create policy "categories owner write" on public.categories for all
  using (public.is_owner()) with check (public.is_owner());

create policy "products readable" on public.products for select
  using (status = 'active' or public.is_admin());
create policy "products admin insert" on public.products for insert
  with check (public.is_admin());
create policy "products admin update" on public.products for update
  using (public.is_admin()) with check (public.is_admin());
create policy "products owner delete" on public.products for delete
  using (public.is_owner());

create policy "content readable" on public.site_content for select using (true);
create policy "content admin update" on public.site_content for update
  using (public.is_admin()) with check (public.is_admin());

create policy "settings admin read" on public.settings for select using (public.is_admin());
create policy "settings owner update" on public.settings for update
  using (public.is_owner()) with check (public.is_owner());

-- Orders are created by the checkout server function (Phase 3, service role), never by browsers.
create policy "orders admin read" on public.orders for select using (public.is_admin());
create policy "orders admin update" on public.orders for update
  using (public.is_admin()) with check (public.is_admin());
create policy "order items admin read" on public.order_items for select using (public.is_admin());

-- People can see their own staff row (so the admin can say "two-step verification needed").
create policy "admin_users self or admin read" on public.admin_users for select
  using (user_id = auth.uid() or public.is_admin());

create policy "inventory log admin read" on public.inventory_log for select using (public.is_admin());
create policy "audit log owner read" on public.audit_log for select using (public.is_owner());

-- Column-level limits on top of the policies.
revoke insert, update, delete on public.orders, public.order_items from anon, authenticated;
grant update (status, note) on public.orders to authenticated;
revoke insert, update, delete on public.admin_users, public.inventory_log, public.audit_log from anon, authenticated;
revoke insert, delete on public.site_content, public.settings from anon, authenticated;

-- ---------------------------------------------------------------- team management (owners)

create function public.team_list()
returns table (user_id uuid, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query
    select au.user_id, u.email::text, au.role, au.created_at, u.last_sign_in_at
    from public.admin_users au join auth.users u on u.id = au.user_id
    order by au.role, u.email;
end $$;

create function public.team_grant(p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_role not in ('owner', 'staff') then raise exception 'bad_role' using errcode = '22023'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no_account' using errcode = 'P0002'; end if;
  if uid = auth.uid() and p_role <> 'owner' then raise exception 'cannot_demote_self' using errcode = '42501'; end if;
  insert into public.admin_users (user_id, role, added_by) values (uid, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role;
end $$;

create function public.team_revoke(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_self' using errcode = '42501'; end if;
  delete from public.admin_users where user_id = p_user;
end $$;

-- Recent activity with the person's email, for owners.
create function public.activity(p_limit int default 40)
returns table (created_at timestamptz, email text, action text, entity text, entity_id text, changes jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query
    select l.created_at, u.email::text, l.action, l.entity, l.entity_id, l.changes
    from public.audit_log l left join auth.users u on u.id = l.actor
    order by l.created_at desc limit least(greatest(p_limit, 1), 200);
end $$;

revoke execute on function public.team_list(), public.team_grant(text, text),
  public.team_revoke(uuid), public.activity(int) from anon;

-- ---------------------------------------------------------------- image storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "media admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
create policy "media admin read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.is_admin());
create policy "media admin update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin());
create policy "media admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());
