-- VERTU Phase 6: legal disclosures, grievance redressal, privacy requests, listing declarations.
-- Written against: Consumer Protection (E-Commerce) Rules 2020 and the 2026 amendment (notified 9 Sep 2026),
-- Legal Metrology (Packaged Commodities) Rules 2011 rule 6(10), DPDP Act 2023 and DPDP Rules 2025.
-- Not legal advice: have a lawyer review the policies and declarations before launch.

-- ---------------------------------------------------------------- business disclosures

alter table public.settings
  add column registered_address   text not null default '' check (char_length(registered_address) <= 300),
  add column care_email           text check (care_email is null or care_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column care_phone           text check (care_phone is null or care_phone ~ '^\+91[0-9]{10}$'),
  add column care_hours           text not null default 'Monday to Saturday, 10am to 6pm' check (char_length(care_hours) <= 80),
  add column grievance_name       text not null default '' check (char_length(grievance_name) <= 80),
  add column grievance_title      text not null default 'Grievance Officer' check (char_length(grievance_title) <= 80),
  add column grievance_email      text check (grievance_email is null or grievance_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column grievance_phone      text check (grievance_phone is null or grievance_phone ~ '^\+91[0-9]{10}$'),
  add column dispatch_days        int  not null default 2 check (dispatch_days between 0 and 15),
  add column return_shipping_fee  int  not null default 0 check (return_shipping_fee between 0 and 10000),
  add column policies_updated_at  date,
  add column dark_patterns_audit  jsonb not null default '{}'::jsonb; -- { date, by, checks: {pattern: true} }

-- Everything the public pages need (legal name, addresses, contacts, policy numbers). Nothing secret.
create function public.legal_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'legal_name', legal_name, 'gstin', gstin, 'registered_address', registered_address,
    'business_address', business_address, 'business_city', business_city, 'business_state', business_state,
    'care_email', care_email, 'care_phone', care_phone, 'care_hours', care_hours,
    'grievance_name', grievance_name, 'grievance_title', grievance_title, 'grievance_email', grievance_email, 'grievance_phone', grievance_phone,
    'return_window_days', return_window_days, 'return_shipping_fee', return_shipping_fee, 'dispatch_days', dispatch_days,
    'shipping_fee', shipping_fee, 'free_shipping_over', free_shipping_over, 'cod_enabled', cod_enabled, 'cod_fee', cod_fee, 'cod_max', cod_max,
    'hold_minutes', hold_minutes, 'policies_updated_at', policies_updated_at,
    'dark_patterns_audit_date', dark_patterns_audit ->> 'date')
  from public.settings where id = 1
$$;

-- ---------------------------------------------------------------- listing declarations (Legal Metrology rule 6(10))

alter table public.categories
  add column declarations jsonb not null default '{}'::jsonb check (jsonb_typeof(declarations) = 'object');
-- { generic_name, net_quantity, country_of_origin, maker (name and address of manufacturer/packer/importer), made_on (month and year) }

update public.categories set declarations = jsonb_build_object('generic_name', unit, 'net_quantity', '1 N (one bag)', 'country_of_origin', 'India', 'maker', '', 'made_on', '')
where declarations = '{}'::jsonb;

-- MRP (inclusive of all taxes). The selling price may not exceed it. Empty means MRP = price.
alter table public.products add column mrp int check (mrp is null or mrp > 0);
alter table public.products add constraint products_price_within_mrp check (mrp is null or price <= mrp);

-- ---------------------------------------------------------------- grievance tickets

create sequence public.ticket_number_seq start 1001;

create table public.support_tickets (
  id              bigint generated always as identity primary key,
  number          text not null unique default ('VRT-T-' || nextval('public.ticket_number_seq')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  due_at          timestamptz not null default now() + interval '30 days', -- resolve within one month
  name            text not null check (char_length(name) between 1 and 120),
  email           text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  phone           text not null default '' check (phone = '' or phone ~ '^\+91[0-9]{10}$'),
  order_id        text,
  category        text not null check (category in ('order', 'delivery', 'return', 'payment', 'product', 'cancel', 'privacy', 'other')),
  message         text not null check (char_length(message) between 10 and 4000),
  status          text not null default 'open' check (status in ('open', 'answered', 'closed')),
  user_id         uuid default auth.uid() references auth.users (id) on delete set null,
  last_reply      text,
  last_reply_at   timestamptz,
  resolved_at     timestamptz
);
create index support_tickets_open_idx on public.support_tickets (status, due_at);
create index support_tickets_email_idx on public.support_tickets (lower(email), created_at desc);
create trigger support_tickets_touch before update on public.support_tickets for each row execute function public.touch_updated_at();
alter table public.support_tickets enable row level security;
create policy "tickets admin read" on public.support_tickets for select using (public.is_admin());
create policy "tickets own read" on public.support_tickets for select using (user_id = auth.uid());
revoke insert, update, delete on public.support_tickets from anon, authenticated;

create function public.ticket_payload(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('number', t.number, 'name', t.name, 'email', t.email, 'phone', t.phone, 'order_id', t.order_id,
    'category', t.category, 'message', t.message, 'created_at', t.created_at, 'due_at', t.due_at, 'reply', t.last_reply, 'status', t.status)
  from public.support_tickets t where t.id = p_id
$$;

-- Anyone can raise a complaint or question. The acknowledgement (with a copy of what they wrote and a
-- ticket number) is emailed straight away, well inside the 48 hours the rules allow.
create function public.open_ticket(p_name text, p_email text, p_phone text, p_order text, p_category text, p_message text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  s public.settings;
  tid bigint;
  num text;
begin
  if e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if char_length(trim(coalesce(p_message, ''))) < 10 then return jsonb_build_object('ok', false, 'error', 'too_short'); end if;
  if p_category not in ('order', 'delivery', 'return', 'payment', 'product', 'cancel', 'privacy', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_category');
  end if;
  if ph <> '' and ph !~ '^(91)?[6-9][0-9]{9}$' then return jsonb_build_object('ok', false, 'error', 'bad_phone'); end if;
  -- a light brake on abuse: five tickets per email address per day
  if (select count(*) from public.support_tickets where lower(email) = e and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into public.support_tickets (name, email, phone, order_id, category, message)
  values (left(trim(p_name), 120), e, case when ph = '' then '' else '+91' || right(ph, 10) end,
          nullif(left(upper(trim(coalesce(p_order, ''))), 20), ''), p_category, left(trim(p_message), 4000))
  returning id, number into tid, num;
  select * into s from public.settings where id = 1;
  perform public.enqueue_email('ticket_received', e, public.ticket_payload(tid), 'ticket_received:' || tid);
  perform public.enqueue_email('admin_ticket', coalesce(s.grievance_email, s.notify_email), public.ticket_payload(tid), 'admin_ticket:' || tid);
  return jsonb_build_object('ok', true, 'number', num);
end $$;

create function public.reply_ticket(p_id bigint, p_reply text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_status not in ('open', 'answered', 'closed') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  select * into t from public.support_tickets where id = p_id for update;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.support_tickets set
    status = p_status,
    last_reply = coalesce(nullif(trim(coalesce(p_reply, '')), ''), last_reply),
    last_reply_at = case when coalesce(trim(p_reply), '') <> '' then now() else last_reply_at end,
    resolved_at = case when p_status = 'closed' then coalesce(resolved_at, now()) else null end
  where id = p_id;
  if coalesce(trim(p_reply), '') <> '' then
    perform public.enqueue_email('ticket_reply', t.email, public.ticket_payload(p_id), 'ticket_reply:' || p_id || ':' || extract(epoch from now())::bigint);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- privacy requests (DPDP)

alter table public.data_requests
  add column note text not null default '',
  add column handled_by uuid;

create function public.data_requests_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.settings;
begin
  select * into s from public.settings where id = 1;
  perform public.enqueue_email('admin_privacy', coalesce(s.grievance_email, s.notify_email),
    jsonb_build_object('kind', new.kind, 'email', new.email, 'id', new.id), 'admin_privacy:' || new.id);
  perform public.enqueue_email('privacy_received', new.email, jsonb_build_object('kind', new.kind, 'id', new.id), 'privacy_received:' || new.id);
  return new;
end $$;
create trigger data_requests_notify after insert on public.data_requests for each row execute function public.data_requests_notify();

-- Everything held about one person, for an export request (server only; the admin-privacy function calls it).
create function public.personal_data_export(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'generated_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at) from auth.users u where u.id = p_user),
    'profile', (select to_jsonb(p) - 'id' from public.profiles p where p.id = p_user),
    'addresses', (select coalesce(jsonb_agg(to_jsonb(a) - 'user_id' - 'id'), '[]') from public.addresses a where a.user_id = p_user),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'placed', o.created_at, 'status', o.status, 'total', o.total,
                 'ship_to', o.ship_address || ', ' || o.ship_city || ' ' || o.ship_pin, 'phone', o.customer_phone,
                 'items', (select jsonb_agg(jsonb_build_object('sku', sku, 'colour', colour, 'qty', qty, 'price', price)) from public.order_items i where i.order_id = o.id))
                 order by o.created_at), '[]')
               from public.orders o where o.customer_id = p_user or lower(o.customer_email) = (select lower(email) from auth.users where id = p_user)),
    'wishlist', (select coalesce(jsonb_agg(sku), '[]') from public.wishlist_items where user_id = p_user),
    'saved_bag', (select items from public.carts where user_id = p_user),
    'newsletter', (select jsonb_build_object('status', n.status, 'since', n.confirmed_at) from public.newsletter_subscribers n where n.email = (select lower(email) from auth.users where id = p_user)),
    'support_tickets', (select coalesce(jsonb_agg(jsonb_build_object('number', t.number, 'created_at', t.created_at, 'message', t.message, 'reply', t.last_reply)), '[]')
               from public.support_tickets t where t.user_id = p_user or lower(t.email) = (select lower(email) from auth.users where id = p_user)),
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('order', r.order_id, 'reason', r.reason, 'status', r.status)), '[]')
               from public.return_requests r join public.orders o on o.id = r.order_id where o.customer_id = p_user));
$$;

-- Erase a person's account data. Orders and invoices stay (tax law requires keeping them) but are detached
-- from the account; the person's newsletter record, tickets' contact details and stock alerts are removed.
-- The auth user itself is deleted by the admin-privacy function (Supabase Auth admin API) right after.
create function public.personal_data_erase(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text;
begin
  select lower(email) into e from auth.users where id = p_user;
  if e is null then return jsonb_build_object('ok', false, 'error', 'unknown_user'); end if;
  delete from public.addresses where user_id = p_user;
  delete from public.wishlist_items where user_id = p_user;
  delete from public.carts where user_id = p_user;
  delete from public.newsletter_subscribers where email = e;
  delete from public.stock_alerts where user_id = p_user or lower(email) = e;
  update public.support_tickets set name = 'Erased', phone = '', message = '[erased at the customer''s request]', user_id = null
    where (user_id = p_user or lower(email) = e) and status = 'closed';
  update public.orders set customer_id = null where customer_id = p_user;
  delete from public.profiles where id = p_user;
  delete from public.admin_users where user_id = p_user;
  return jsonb_build_object('ok', true, 'email', e);
end $$;

create function public.resolve_data_request(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.data_requests;
begin
  if not public.is_owner() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.data_requests set resolved_at = now(), note = left(coalesce(p_note, ''), 500), handled_by = auth.uid()
  where id = p_id and resolved_at is null returning * into r;
  if r.id is not null then
    perform public.enqueue_email('privacy_done', r.email, jsonb_build_object('kind', r.kind, 'id', r.id, 'note', r.note), 'privacy_done:' || r.id);
  end if;
end $$;

-- ---------------------------------------------------------------- who may call what

revoke execute on function public.ticket_payload(bigint), public.personal_data_export(uuid), public.personal_data_erase(uuid)
  from public, anon, authenticated;
grant execute on function public.ticket_payload(bigint), public.personal_data_export(uuid), public.personal_data_erase(uuid) to service_role;
revoke execute on function public.reply_ticket(bigint, text, text), public.resolve_data_request(bigint, text) from public, anon;
grant execute on function public.reply_ticket(bigint, text, text), public.resolve_data_request(bigint, text) to authenticated;
-- legal_info and open_ticket stay open to everyone.
