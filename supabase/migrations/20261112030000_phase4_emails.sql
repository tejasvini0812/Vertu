-- VERTU Phase 4: email notifications.
--
-- Pattern: an "outbox". Whenever something email-worthy happens, the same database change writes a row
-- into email_outbox (so an email can never be lost or sent twice: dedupe_key is unique). The send-emails
-- Edge Function picks rows up every minute, renders them and sends them through Resend, retrying with backoff.

-- ---------------------------------------------------------------- settings and tracking

alter table public.settings
  add column notify_email           text check (notify_email is null or notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column abandoned_cart_enabled bool not null default false;

alter table public.orders
  add column courier         text check (char_length(courier) <= 60),
  add column tracking_number text check (char_length(tracking_number) <= 60),
  add column tracking_url    text check (tracking_url is null or tracking_url ~ '^https?://');
grant update (courier, tracking_number, tracking_url) on public.orders to authenticated;

-- ---------------------------------------------------------------- outbox

create table public.email_outbox (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  kind          text not null,
  to_email      text not null check (to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  payload       jsonb not null default '{}'::jsonb,
  dedupe_key    text not null unique,
  related_order text,
  status        text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts      int  not null default 0,
  send_after    timestamptz not null default now(),
  sent_at       timestamptz,
  last_error    text,
  provider_id   text
);
create index email_outbox_due_idx on public.email_outbox (send_after) where status = 'pending';
create index email_outbox_order_idx on public.email_outbox (related_order);
alter table public.email_outbox enable row level security;
create policy "outbox admin read" on public.email_outbox for select using (public.is_admin());
revoke insert, update, delete on public.email_outbox from anon, authenticated;

create function public.enqueue_email(p_kind text, p_to text, p_payload jsonb, p_key text, p_delay interval default '0 seconds')
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(trim(p_to), '') = '' or p_to !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  insert into public.email_outbox (kind, to_email, payload, dedupe_key, related_order, send_after)
  values (p_kind, lower(trim(p_to)), coalesce(p_payload, '{}'::jsonb), p_key, p_payload ->> 'order_id', now() + p_delay)
  on conflict (dedupe_key) do nothing;
end $$;

-- Everything an order email needs, in one object.
create function public.order_email_payload(p_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'order_id', o.id, 'token', o.access_token, 'name', o.customer_name, 'email', o.customer_email,
    'created_at', o.created_at, 'status', o.status, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'subtotal', o.subtotal, 'discount', o.discount, 'shipping', o.shipping, 'cod_fee', o.cod_fee, 'total', o.total,
    'refunded_amount', o.refunded_amount, 'coupon', o.coupon_code, 'phone', o.customer_phone,
    'address', jsonb_build_object('line', o.ship_address, 'city', o.ship_city, 'state', o.ship_state, 'pin', o.ship_pin),
    'courier', o.courier, 'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url, 'flag', o.flag,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('sku', i.sku, 'name', coalesce(c.unit, i.category), 'colour', i.colour,
                                                           'price', i.price, 'qty', i.qty) order by i.id), '[]')
              from public.order_items i left join public.categories c on c.id = i.category where i.order_id = o.id))
  from public.orders o where o.id = p_id
$$;

-- ---------------------------------------------------------------- order emails (customer + store)

create function public.orders_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  confirmed bool := false;
  p jsonb;
begin
  select * into s from public.settings where id = 1;
  if tg_op = 'INSERT' then
    confirmed := new.payment_status = 'cod';
  else
    confirmed := new.payment_status = 'paid' and old.payment_status in ('awaiting', 'expired', 'failed', 'cancelled');
  end if;
  p := public.order_email_payload(new.id);

  if confirmed then
    perform public.enqueue_email('order_confirmed', new.customer_email, p, 'order_confirmed:' || new.id);
    perform public.enqueue_email('admin_new_order', s.notify_email, p, 'admin_new_order:' || new.id);
  end if;

  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if new.status = 'Shipped' then
        perform public.enqueue_email('order_shipped', new.customer_email, p, 'order_shipped:' || new.id);
      elsif new.status = 'Delivered' then
        perform public.enqueue_email('order_delivered', new.customer_email, p, 'order_delivered:' || new.id);
      elsif new.status = 'Cancelled' and old.payment_status not in ('awaiting', 'expired', 'failed') then
        -- (abandoned online checkouts expire quietly; nothing to tell the shopper)
        perform public.enqueue_email('order_cancelled', new.customer_email, p, 'order_cancelled:' || new.id);
      end if;
    end if;
    if new.refunded_amount > old.refunded_amount and not (new.status = 'Cancelled' and old.status <> 'Cancelled') then
      perform public.enqueue_email('order_refunded', new.customer_email,
        p || jsonb_build_object('refund', new.refunded_amount - old.refunded_amount),
        'order_refunded:' || new.id || ':' || new.refunded_amount);
    end if;
    if new.flag is not null and new.flag is distinct from old.flag then
      perform public.enqueue_email('admin_attention', s.notify_email, p, 'admin_attention:' || new.id || ':' || md5(new.flag));
    end if;
  end if;
  return new;
end $$;

create trigger orders_notify after update on public.orders
  for each row execute function public.orders_notify();
-- New orders are announced when the transaction commits, once their items have been written.
create constraint trigger orders_notify_new after insert on public.orders
  deferrable initially deferred
  for each row execute function public.orders_notify();

-- ---------------------------------------------------------------- stock emails

create function public.products_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  a record;
  unit text;
begin
  select * into s from public.settings where id = 1;
  select c.unit into unit from public.categories c where c.id = new.category;

  -- A sold-out (or hidden) colour is back: write once to everyone who asked.
  if new.status = 'active' and new.stock > 0 and (old.stock <= 0 or old.status <> 'active') then
    for a in select id, email from public.stock_alerts where sku = new.id and notified_at is null order by id loop
      perform public.enqueue_email('back_in_stock', a.email,
        jsonb_build_object('sku', new.id, 'category', new.category, 'name', unit, 'colour', new.colour, 'price', new.price, 'stock', new.stock),
        'back_in_stock:' || a.id);
      update public.stock_alerts set notified_at = now() where id = a.id;
    end loop;
  end if;

  -- Crossing the low-stock line tells the store (at most once a day per colour).
  if new.status = 'active' and old.stock > s.low_stock and new.stock <= s.low_stock then
    perform public.enqueue_email('admin_low_stock', s.notify_email,
      jsonb_build_object('sku', new.id, 'name', unit, 'colour', new.colour, 'stock', new.stock, 'threshold', s.low_stock),
      'admin_low_stock:' || new.id || ':' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'));
  end if;
  return new;
end $$;

create trigger products_notify after update of stock, status on public.products
  for each row execute function public.products_notify();

-- ---------------------------------------------------------------- newsletter (double opt-in)

create table public.newsletter_subscribers (
  email           text primary key check (email = lower(email) and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status          text not null default 'pending' check (status in ('pending', 'subscribed', 'unsubscribed')),
  token           uuid not null unique default gen_random_uuid(),
  source          text not null default '',
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz
);
alter table public.newsletter_subscribers enable row level security;
create policy "subscribers owner read" on public.newsletter_subscribers for select using (public.is_owner());
revoke insert, update, delete on public.newsletter_subscribers from anon, authenticated;

-- Always answers { ok: true } so the form can't be used to find out who is subscribed.
create function public.subscribe_newsletter(p_email text, p_source text default 'footer') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  sub public.newsletter_subscribers;
begin
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(e) > 254 then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  insert into public.newsletter_subscribers (email, source) values (e, left(coalesce(p_source, ''), 40))
  on conflict (email) do update set
    status = case when newsletter_subscribers.status = 'subscribed' then 'subscribed' else 'pending' end,
    unsubscribed_at = null
  returning * into sub;
  if sub.status = 'pending' then
    perform public.enqueue_email('newsletter_confirm', e, jsonb_build_object('token', sub.token),
      'newsletter_confirm:' || e || ':' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.confirm_newsletter(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sub public.newsletter_subscribers;
begin
  update public.newsletter_subscribers set status = 'subscribed', confirmed_at = coalesce(confirmed_at, now()), unsubscribed_at = null
  where token = p_token and status <> 'unsubscribed' returning * into sub;
  if sub.email is null then return jsonb_build_object('ok', false); end if;
  update public.profiles p set marketing_opt_in = true from auth.users u where u.id = p.id and lower(u.email) = sub.email and not p.marketing_opt_in;
  return jsonb_build_object('ok', true);
end $$;

create function public.unsubscribe_newsletter(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare sub public.newsletter_subscribers;
begin
  update public.newsletter_subscribers set status = 'unsubscribed', unsubscribed_at = now()
  where token = p_token returning * into sub;
  if sub.email is null then return jsonb_build_object('ok', false); end if;
  update public.profiles p set marketing_opt_in = false from auth.users u where u.id = p.id and lower(u.email) = sub.email and p.marketing_opt_in;
  return jsonb_build_object('ok', true);
end $$;

-- The account's "email me about launches" box and the newsletter list stay in step.
-- (Signed-in emails are already verified, so no confirmation email is needed.)
create function public.profiles_marketing_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  select lower(email) into e from auth.users where id = new.id;
  if e is null then return new; end if;
  if new.marketing_opt_in then
    insert into public.newsletter_subscribers (email, status, source, confirmed_at) values (e, 'subscribed', 'account', now())
    on conflict (email) do update set status = 'subscribed', confirmed_at = coalesce(newsletter_subscribers.confirmed_at, now()), unsubscribed_at = null
    where newsletter_subscribers.status <> 'subscribed';
  else
    update public.newsletter_subscribers set status = 'unsubscribed', unsubscribed_at = now() where email = e and status <> 'unsubscribed';
  end if;
  return new;
end $$;
create trigger profiles_marketing_sync after update of marketing_opt_in on public.profiles
  for each row when (old.marketing_opt_in is distinct from new.marketing_opt_in)
  execute function public.profiles_marketing_sync();

-- ---------------------------------------------------------------- abandoned bags (opt-in only)

-- Signed-in shoppers who agreed to marketing emails, whose saved bag hasn't changed for 3 hours and who
-- haven't ordered since: one gentle reminder per bag per day. Off unless switched on in Settings.
create function public.queue_abandoned_carts() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; items jsonb; n int := 0;
begin
  if not (select abandoned_cart_enabled from public.settings where id = 1) then return 0; end if;
  for r in
    select c.user_id, c.items, c.updated_at, u.email, coalesce(nullif(p.full_name, ''), '') as name, ns.token
    from public.carts c
    join auth.users u on u.id = c.user_id
    join public.profiles p on p.id = c.user_id and p.marketing_opt_in
    join public.newsletter_subscribers ns on ns.email = lower(u.email) and ns.status = 'subscribed'
    where jsonb_array_length(c.items) > 0
      and c.updated_at < now() - interval '3 hours' and c.updated_at > now() - interval '48 hours'
      and not exists (select 1 from public.orders o where o.customer_id = c.user_id and o.created_at > c.updated_at - interval '5 minutes')
  loop
    select coalesce(jsonb_agg(jsonb_build_object('sku', pr.id, 'name', cat.unit, 'colour', pr.colour, 'price', pr.price, 'qty', (i ->> 'qty')::int)), '[]')
      into items
    from jsonb_array_elements(r.items) i
    join public.products pr on pr.id = i ->> 'sku' and pr.status = 'active' and pr.stock > 0
    join public.categories cat on cat.id = pr.category;
    if jsonb_array_length(items) = 0 then continue; end if;
    perform public.enqueue_email('abandoned_cart', r.email,
      jsonb_build_object('name', r.name, 'items', items, 'unsubscribe', r.token),
      'abandoned_cart:' || r.user_id || ':' || to_char(r.updated_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD'));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- the sender's side (service role only)

create function public.claim_outbox(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rows jsonb;
begin
  -- emails that waited more than 3 days (e.g. before email was set up) would arrive stale: skip them
  update public.email_outbox set status = 'skipped', last_error = 'too old to send'
  where status = 'pending' and created_at < now() - interval '3 days';
  -- a sender that crashed mid-send leaves rows in 'sending': try them again after 10 minutes
  update public.email_outbox set status = 'pending'
  where status = 'sending' and send_after < now() - interval '10 minutes';

  with picked as (
    select id from public.email_outbox
    where status = 'pending' and send_after <= now()
    order by id limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ), claimed as (
    update public.email_outbox e set status = 'sending', attempts = e.attempts + 1, send_after = now()
    from picked where e.id = picked.id
    returning e.id, e.kind, e.to_email, e.payload, e.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'to', to_email, 'payload', payload, 'attempts', attempts) order by id), '[]')
    into rows from claimed;
  return rows;
end $$;

-- Success, or a failure that is retried after 2, 4, 8, 16 minutes before giving up.
create function public.complete_outbox(p_id bigint, p_ok bool, p_provider_id text default null, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.email_outbox set
    status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
    sent_at = case when p_ok then now() end,
    provider_id = coalesce(p_provider_id, provider_id),
    last_error = case when p_ok then null else left(p_error, 500) end,
    send_after = case when p_ok then send_after else now() + make_interval(mins => power(2, attempts)::int) end
  where id = p_id and status = 'sending';
end $$;

-- Owners can retry an email that failed.
create function public.retry_email(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.email_outbox set status = 'pending', attempts = 0, send_after = now(), last_error = null
  where id = p_id and status in ('failed', 'skipped');
end $$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function public.enqueue_email(text, text, jsonb, text, interval), public.order_email_payload(text),
  public.queue_abandoned_carts(), public.claim_outbox(int), public.complete_outbox(bigint, bool, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_email(text, text, jsonb, text, interval), public.order_email_payload(text),
  public.queue_abandoned_carts(), public.claim_outbox(int), public.complete_outbox(bigint, bool, text, text)
  to service_role;
revoke execute on function public.retry_email(bigint) from public, anon;
grant execute on function public.retry_email(bigint) to authenticated;
-- subscribe / confirm / unsubscribe stay open to everyone (they only act on a valid email or a secret token)

-- ---------------------------------------------------------------- housekeeping job
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('vertu-abandoned-carts', '15 * * * *', 'select public.queue_abandoned_carts()');
  end if;
exception when others then
  raise notice 'abandoned-cart job not scheduled: %', sqlerrm;
end $$;
