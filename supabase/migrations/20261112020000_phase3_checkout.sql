-- VERTU Phase 3: checkout, payments (Razorpay + cash on delivery), coupons, stock holds, refunds.
--
-- Money rule: the browser never decides a price. Every total is recomputed here from the live
-- products table. Orders are only created by create_order(), which only the server (service role) may call.
-- Amounts are whole rupees; Razorpay receives total * 100 (paise).

-- ---------------------------------------------------------------- store settings

alter table public.settings
  add column shipping_fee       int  not null default 0     check (shipping_fee between 0 and 100000),
  add column free_shipping_over int  not null default 0     check (free_shipping_over >= 0), -- 0 = no threshold
  add column cod_enabled        bool not null default false,
  add column cod_fee            int  not null default 0     check (cod_fee between 0 and 100000),
  add column cod_max            int  not null default 5000  check (cod_max >= 0),
  add column hold_minutes       int  not null default 15    check (hold_minutes between 5 and 120);

-- Shoppers need the shipping rules to show them (nothing secret in here).
create or replace function public.store_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shipping_fee', shipping_fee, 'free_shipping_over', free_shipping_over,
    'cod_enabled', cod_enabled, 'cod_fee', cod_fee, 'cod_max', cod_max)
  from public.settings where id = 1
$$;

-- ---------------------------------------------------------------- orders: totals and payment

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'));

alter table public.orders
  add column subtotal            int  check (subtotal >= 0),
  add column discount            int  not null default 0 check (discount >= 0),
  add column shipping            int  not null default 0 check (shipping >= 0),
  add column cod_fee             int  not null default 0 check (cod_fee >= 0),
  add column total               int  check (total >= 0),
  add column coupon_code         text,
  add column payment_method      text not null default 'manual' check (payment_method in ('razorpay', 'cod', 'manual')),
  add column payment_status      text not null default 'paid'
             check (payment_status in ('awaiting', 'paid', 'cod', 'failed', 'expired', 'refunded', 'partially_refunded', 'cancelled')),
  add column razorpay_order_id   text unique,
  add column razorpay_payment_id text,
  add column paid_at             timestamptz,
  add column expires_at          timestamptz,
  add column refunded_amount     int  not null default 0 check (refunded_amount >= 0),
  add column access_token        uuid not null default gen_random_uuid(),
  add column flag                text; -- set when a person needs to look (e.g. paid after the hold expired and stock ran out)

-- Existing orders (entered before checkout existed) count as paid; fill their totals.
update public.orders o set
  subtotal = coalesce((select sum(price * qty) from public.order_items i where i.order_id = o.id), 0),
  total    = coalesce((select sum(price * qty) from public.order_items i where i.order_id = o.id), 0)
where subtotal is null;

create index orders_awaiting_idx on public.orders (expires_at) where payment_status = 'awaiting';
create index orders_email_idx on public.orders (lower(customer_email));

-- Cash on delivery is collected by the courier: delivered means paid.
create function public.cod_collected() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'Delivered' and new.payment_status = 'cod' then
    new.payment_status := 'paid';
    new.paid_at := now();
  end if;
  return new;
end $$;
create trigger orders_cod_collected before update of status on public.orders
  for each row execute function public.cod_collected();

-- Staff may not cancel from the status buttons: cancelling must go through cancel/refund (it restocks and refunds).
create function public.orders_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('vertu.system', true) = 'yes' then return new; end if; -- checkout/refund functions
  if new.status = 'Cancelled' and old.status <> 'Cancelled' then
    raise exception 'use_cancel' using errcode = '42501';
  end if;
  if old.status = 'Cancelled' and new.status <> 'Cancelled' then
    raise exception 'order_cancelled' using errcode = '42501';
  end if;
  if new.status <> old.status and old.payment_status in ('awaiting', 'failed', 'expired') then
    raise exception 'order_unpaid' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger orders_status_guard before update of status on public.orders
  for each row execute function public.orders_status_guard();

-- ---------------------------------------------------------------- coupons

create table public.coupons (
  code         text primary key check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind         text not null check (kind in ('percent', 'amount')),
  value        int  not null check (value > 0),
  min_subtotal int  not null default 0 check (min_subtotal >= 0),
  starts_at    timestamptz,
  ends_at      timestamptz,
  max_uses     int  check (max_uses > 0),
  used_count   int  not null default 0 check (used_count >= 0),
  active       bool not null default true,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  check (kind <> 'percent' or value <= 90),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
alter table public.coupons enable row level security;
create policy "coupons admin" on public.coupons for all using (public.is_admin()) with check (public.is_admin());
create trigger coupons_audit after insert or update or delete on public.coupons
  for each row execute function public.audit('code');

-- ---------------------------------------------------------------- pricing (one function, used for quotes and orders)

-- p_items: [{ "sku": "VRT-SL-CRI", "qty": 2 }, ...]
-- Returns the authoritative quote. "problems" lists anything that stops checkout.
create function public.price_cart(p_items jsonb, p_coupon text default null, p_method text default 'razorpay')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  c public.coupons;
  lines jsonb := '[]'::jsonb;
  problems jsonb := '[]'::jsonb;
  item jsonb;
  p public.products;
  qty int;
  subtotal int := 0;
  discount int := 0;
  shipping int := 0;
  codfee int := 0;
  coupon jsonb := null;
  v_code text := upper(nullif(trim(coalesce(p_coupon, '')), ''));
  n int := 0;
begin
  select * into s from public.settings where id = 1;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('problems', jsonb_build_array(jsonb_build_object('kind', 'empty')));
  end if;
  if jsonb_array_length(p_items) > 20 then
    return jsonb_build_object('problems', jsonb_build_array(jsonb_build_object('kind', 'too_many_lines')));
  end if;
  if p_method not in ('razorpay', 'cod') then
    return jsonb_build_object('problems', jsonb_build_array(jsonb_build_object('kind', 'bad_method')));
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    n := n + 1;
    qty := case when (item ->> 'qty') ~ '^[0-9]{1,2}$' then (item ->> 'qty')::int else 0 end;
    select * into p from public.products where id = item ->> 'sku';
    if p.id is null or p.status <> 'active' then
      problems := problems || jsonb_build_object('kind', 'unavailable', 'sku', item ->> 'sku');
      continue;
    end if;
    if qty < 1 or qty > 9 then
      problems := problems || jsonb_build_object('kind', 'bad_qty', 'sku', p.id);
      continue;
    end if;
    if p.stock < qty then
      problems := problems || jsonb_build_object('kind', 'insufficient', 'sku', p.id, 'available', p.stock);
    end if;
    if lines @> jsonb_build_array(jsonb_build_object('sku', p.id)) then
      problems := problems || jsonb_build_object('kind', 'duplicate', 'sku', p.id);
      continue;
    end if;
    lines := lines || jsonb_build_object('sku', p.id, 'category', p.category, 'colour', p.colour,
                                         'price', p.price, 'qty', qty, 'image', p.image);
    subtotal := subtotal + p.price * qty;
  end loop;

  if v_code is not null then
    select * into c from public.coupons cc where cc.code = v_code;
    coupon := jsonb_build_object('code', v_code, 'valid', false);
    if c.code is null or not c.active then
      coupon := coupon || '{"reason": "not_found"}';
    elsif c.starts_at is not null and now() < c.starts_at then
      coupon := coupon || '{"reason": "not_started"}';
    elsif c.ends_at is not null and now() > c.ends_at then
      coupon := coupon || '{"reason": "expired"}';
    elsif c.max_uses is not null and c.used_count >= c.max_uses then
      coupon := coupon || '{"reason": "used_up"}';
    elsif subtotal < c.min_subtotal then
      coupon := coupon || jsonb_build_object('reason', 'min_subtotal', 'min_subtotal', c.min_subtotal);
    else
      discount := case when c.kind = 'percent' then floor(subtotal * c.value / 100.0)::int else least(c.value, subtotal) end;
      coupon := jsonb_build_object('code', v_code, 'valid', true, 'kind', c.kind, 'value', c.value);
    end if;
  end if;

  -- shipping_fee applies unless the order reaches free_shipping_over (0 = no free-shipping threshold)
  shipping := case when s.free_shipping_over > 0 and subtotal - discount >= s.free_shipping_over then 0 else s.shipping_fee end;

  if p_method = 'cod' then
    if not s.cod_enabled then
      problems := problems || '{"kind": "cod_off"}';
    else
      codfee := s.cod_fee;
      if subtotal - discount + shipping + codfee > s.cod_max then
        problems := problems || jsonb_build_object('kind', 'cod_limit', 'cod_max', s.cod_max);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'lines', lines, 'subtotal', subtotal, 'discount', discount, 'shipping', shipping, 'cod_fee', codfee,
    'total', subtotal - discount + shipping + codfee, 'coupon', coupon, 'method', p_method,
    'cod_available', s.cod_enabled and subtotal - discount + shipping + s.cod_fee <= s.cod_max,
    'problems', problems);
end $$;

-- Anyone can ask for a quote (it only reveals public prices, stock levels and whether a code works).
create function public.quote_checkout(p_items jsonb, p_coupon text default null, p_method text default 'razorpay')
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.price_cart(p_items, p_coupon, p_method)
$$;

-- ---------------------------------------------------------------- stock holds

create function public.restock_order(p_order text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  perform set_config('vertu.stock_reason', p_reason, true);
  for l in select sku, qty from public.order_items where order_id = p_order order by sku loop
    update public.products set stock = stock + l.qty where id = l.sku;
  end loop;
  perform set_config('vertu.stock_reason', '', true);
end $$;

-- Unpaid online orders give their stock back after the hold (default 15 minutes).
create function public.release_expired_orders() returns int
language plpgsql security definer set search_path = '' as $$
declare o record; n int := 0;
begin
  for o in select id, coupon_code from public.orders
           where payment_status = 'awaiting' and expires_at < now()
           order by id for update skip locked loop
    perform public.restock_order(o.id, 'released');
    if o.coupon_code is not null then
      update public.coupons set used_count = greatest(used_count - 1, 0) where code = o.coupon_code;
    end if;
    perform set_config('vertu.system', 'yes', true);
    update public.orders set payment_status = 'expired', status = 'Cancelled' where id = o.id;
    perform set_config('vertu.system', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- creating orders (server only)

create function public.create_order(
  p_items jsonb, p_coupon text, p_method text, p_contact jsonb, p_address jsonb, p_user uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  q jsonb;
  s public.settings;
  oid text;
  token uuid;
  l jsonb;
  email text := lower(trim(coalesce(p_contact ->> 'email', '')));
  phone text := coalesce(p_contact ->> 'phone', '');
  hold timestamptz;
begin
  perform public.release_expired_orders();

  if email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(email) > 254 then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if phone !~ '^\+91[6-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_phone');
  end if;
  if coalesce(trim(p_address ->> 'full_name'), '') = '' or coalesce(trim(p_address ->> 'line1'), '') = ''
     or coalesce(trim(p_address ->> 'city'), '') = '' or coalesce(trim(p_address ->> 'state'), '') = ''
     or coalesce(p_address ->> 'pin', '') !~ '^[1-9][0-9]{5}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_address');
  end if;

  -- Lock every product in the bag (in a fixed order, so two checkouts can't deadlock), then price.
  perform 1 from public.products
    where id in (select value ->> 'sku' from jsonb_array_elements(p_items)) order by id for update;
  q := public.price_cart(p_items, p_coupon, p_method);
  if jsonb_array_length(q -> 'problems') > 0 then
    return jsonb_build_object('ok', false, 'error', 'cart', 'quote', q);
  end if;
  if p_coupon is not null and trim(p_coupon) <> '' and not coalesce((q -> 'coupon' ->> 'valid')::bool, false) then
    return jsonb_build_object('ok', false, 'error', 'coupon', 'quote', q);
  end if;
  if (q ->> 'total')::int < 1 then
    return jsonb_build_object('ok', false, 'error', 'zero_total', 'quote', q);
  end if;

  select * into s from public.settings where id = 1;
  hold := case when p_method = 'razorpay' then now() + make_interval(mins => s.hold_minutes) end;

  insert into public.orders (
    status, customer_id, customer_name, customer_email, customer_phone,
    ship_address, ship_city, ship_state, ship_pin, note,
    subtotal, discount, shipping, cod_fee, total, coupon_code,
    payment_method, payment_status, expires_at)
  values (
    'Pending', p_user, left(trim(p_address ->> 'full_name'), 120), email, phone,
    left(trim(p_address ->> 'line1') || coalesce(nullif(', ' || trim(coalesce(p_address ->> 'line2', '')), ', '), ''), 400),
    left(trim(p_address ->> 'city'), 80), left(trim(p_address ->> 'state'), 60), p_address ->> 'pin',
    left(coalesce(p_contact ->> 'note', ''), 500),
    (q ->> 'subtotal')::int, (q ->> 'discount')::int, (q ->> 'shipping')::int, (q ->> 'cod_fee')::int, (q ->> 'total')::int,
    case when coalesce((q -> 'coupon' ->> 'valid')::bool, false) then q -> 'coupon' ->> 'code' end,
    p_method, case when p_method = 'cod' then 'cod' else 'awaiting' end, hold)
  returning id, access_token into oid, token;

  perform set_config('vertu.stock_reason', 'order', true);
  for l in select value from jsonb_array_elements(q -> 'lines') loop
    insert into public.order_items (order_id, sku, category, colour, price, qty)
    values (oid, l ->> 'sku', l ->> 'category', l ->> 'colour', (l ->> 'price')::int, (l ->> 'qty')::int);
    update public.products set stock = stock - (l ->> 'qty')::int where id = l ->> 'sku';
  end loop;
  perform set_config('vertu.stock_reason', '', true);

  if coalesce((q -> 'coupon' ->> 'valid')::bool, false) then
    update public.coupons set used_count = used_count + 1 where code = q -> 'coupon' ->> 'code';
  end if;

  return jsonb_build_object('ok', true, 'order_id', oid, 'access_token', token, 'total', (q ->> 'total')::int,
                            'method', p_method, 'expires_at', hold, 'quote', q);
end $$;

create function public.attach_razorpay_order(p_order text, p_rzp_order text) returns void
language sql security definer set search_path = '' as $$
  update public.orders set razorpay_order_id = p_rzp_order where id = p_order and payment_status = 'awaiting'
$$;

-- Payment confirmed (by the browser's signed response or by Razorpay's webhook). Safe to call twice.
create function public.mark_order_paid(p_rzp_order text, p_payment text, p_amount_paise bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; short text := null; l record;
begin
  select * into o from public.orders where razorpay_order_id = p_rzp_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_order'); end if;
  if o.payment_status in ('paid', 'refunded', 'partially_refunded') then
    return jsonb_build_object('ok', true, 'order_id', o.id, 'already', true);
  end if;
  if p_amount_paise is not null and p_amount_paise <> o.total::bigint * 100 then
    update public.orders set flag = 'amount_mismatch: paid ' || p_amount_paise || ' paise, expected ' || o.total * 100 where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch', 'order_id', o.id);
  end if;

  -- Paid after the hold ran out: take the stock again if it is still there; otherwise flag for a refund.
  if o.payment_status in ('expired', 'failed', 'cancelled') then
    for l in select i.sku, i.qty, p.stock from public.order_items i join public.products p on p.id = i.sku
             where i.order_id = o.id order by i.sku for update of p loop
      if l.stock < l.qty then short := coalesce(short || ', ', '') || l.sku; end if;
    end loop;
    if short is null then
      perform set_config('vertu.stock_reason', 'order', true);
      update public.products p set stock = p.stock - i.qty from public.order_items i where i.order_id = o.id and p.id = i.sku;
      perform set_config('vertu.stock_reason', '', true);
    end if;
  end if;

  perform set_config('vertu.system', 'yes', true);
  update public.orders set
    status = case when status = 'Cancelled' then 'Pending' else status end,
    payment_status = 'paid', razorpay_payment_id = p_payment, paid_at = now(), expires_at = null,
    flag = case when short is not null then 'paid_after_hold_out_of_stock: ' || short end
  where id = o.id;
  perform set_config('vertu.system', '', true);
  return jsonb_build_object('ok', true, 'order_id', o.id, 'flag', short);
end $$;

create function public.mark_order_failed(p_rzp_order text, p_reason text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where razorpay_order_id = p_rzp_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_order'); end if;
  -- A failed attempt doesn't end the order: the shopper can retry until the hold expires.
  if o.payment_status = 'awaiting' then
    update public.orders set note = left(trim(note || ' ' || 'Payment attempt failed: ' || coalesce(p_reason, '')), 500) where id = o.id;
  end if;
  return jsonb_build_object('ok', true, 'order_id', o.id);
end $$;

-- Cancel and/or record a refund (the server function calls Razorpay first, then this).
create function public.settle_cancel_refund(
  p_order text, p_refund_paise bigint, p_refund_id text, p_restock bool, p_cancel bool, p_actor uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; refunded int;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_order'); end if;
  refunded := o.refunded_amount + coalesce(p_refund_paise, 0)::int / 100;
  if refunded > coalesce(o.total, 0) then return jsonb_build_object('ok', false, 'error', 'refund_too_large'); end if;
  if p_restock and o.status <> 'Cancelled' then perform public.restock_order(o.id, case when p_cancel then 'cancelled' else 'return' end); end if;
  if p_cancel and o.status <> 'Cancelled' and o.coupon_code is not null and o.payment_status in ('awaiting', 'cod') then
    update public.coupons set used_count = greatest(used_count - 1, 0) where code = o.coupon_code;
  end if;
  perform set_config('vertu.system', 'yes', true);
  update public.orders set
    refunded_amount = refunded,
    status = case when p_cancel then 'Cancelled' else status end,
    payment_status = case
      when refunded > 0 and refunded >= total then 'refunded'
      when refunded > 0 then 'partially_refunded'
      when p_cancel and payment_status in ('awaiting', 'cod') then 'cancelled'
      else payment_status end,
    note = left(trim(note || ' ' || coalesce(nullif(p_reason, ''), '') ||
           case when p_refund_id is not null then ' [refund ' || p_refund_id || ']' else '' end), 500)
  where id = o.id;
  perform set_config('vertu.system', '', true);
  insert into public.audit_log (actor, action, entity, entity_id, changes)
  values (p_actor, case when p_cancel then 'cancel' else 'refund' end, 'orders', o.id,
          jsonb_build_object('refund_rupees', coalesce(p_refund_paise, 0) / 100, 'restock', p_restock, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'order_id', o.id, 'refunded_amount', refunded);
end $$;

-- ---------------------------------------------------------------- shoppers looking at their order

-- The confirmation page knows the order id and its secret token (given only to the buyer).
create function public.order_lookup(p_id text, p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'created_at', o.created_at, 'status', o.status, 'payment_status', o.payment_status,
    'payment_method', o.payment_method, 'expires_at', o.expires_at,
    'name', o.customer_name, 'email', o.customer_email, 'city', o.ship_city, 'pin', o.ship_pin,
    'subtotal', o.subtotal, 'discount', o.discount, 'shipping', o.shipping, 'cod_fee', o.cod_fee, 'total', o.total,
    'refunded_amount', o.refunded_amount,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'category', category, 'colour', colour, 'price', price, 'qty', qty) order by id), '[]')
              from public.order_items where order_id = o.id))
  from public.orders o where o.id = p_id and o.access_token = p_token
$$;

-- After signing in, orders placed as a guest with the same (verified) email join the account.
create function public.claim_my_orders() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null or coalesce(auth.email(), '') = '' then return 0; end if;
  update public.orders set customer_id = auth.uid()
  where customer_id is null and lower(customer_email) = lower(auth.email());
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function public.price_cart(jsonb, text, text), public.restock_order(text, text),
  public.release_expired_orders(), public.create_order(jsonb, text, text, jsonb, jsonb, uuid),
  public.attach_razorpay_order(text, text), public.mark_order_paid(text, text, bigint),
  public.mark_order_failed(text, text), public.settle_cancel_refund(text, bigint, text, bool, bool, uuid, text)
  from public, anon, authenticated;
grant execute on function public.price_cart(jsonb, text, text), public.release_expired_orders(),
  public.create_order(jsonb, text, text, jsonb, jsonb, uuid), public.attach_razorpay_order(text, text),
  public.mark_order_paid(text, text, bigint), public.mark_order_failed(text, text),
  public.settle_cancel_refund(text, bigint, text, bool, bool, uuid, text), public.restock_order(text, text)
  to service_role;
revoke execute on function public.claim_my_orders() from public, anon;

-- Postgres lets PUBLIC run new functions by default, so "revoke from anon" alone is not enough.
-- Tighten the Phase 1 team functions too (they already refuse non-owners inside; this closes the door earlier).
revoke execute on function public.team_list(), public.team_grant(text, text), public.team_revoke(uuid), public.activity(int)
  from public, anon;
grant execute on function public.team_list(), public.team_grant(text, text), public.team_revoke(uuid), public.activity(int)
  to authenticated;

-- Staff still only change status and note by hand; payment columns are set by the functions above.

-- ---------------------------------------------------------------- housekeeping job (optional but recommended)
-- Releases expired holds every 5 minutes. Checkout also does this itself, so the store works without it.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('vertu-release-holds', '*/5 * * * *', 'select public.release_expired_orders()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%). Enable it under Database -> Extensions, then run: select cron.schedule(''vertu-release-holds'', ''*/5 * * * *'', ''select public.release_expired_orders()'');', sqlerrm;
end $$;
