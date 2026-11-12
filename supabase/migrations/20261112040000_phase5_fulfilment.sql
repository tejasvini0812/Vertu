-- VERTU Phase 5: shipping (Shiprocket), tracking, GST invoices, returns, delivery estimates.

-- ---------------------------------------------------------------- per-collection tax and parcel details

alter table public.categories
  add column hsn      text          not null default '4202' check (hsn ~ '^[0-9]{4,8}$'),
  add column gst_rate numeric(4, 2) not null default 18    check (gst_rate between 0 and 28),
  -- parcel for one bag, used to book couriers: kg and cm. Estimates: weigh a packed bag and update.
  add column package  jsonb not null default '{"weight": 0.5, "length": 30, "breadth": 10, "height": 25}'::jsonb
    check (jsonb_typeof(package) = 'object');
update public.categories set package = '{"weight": 0.6, "length": 32, "breadth": 12, "height": 28}' where id = 'sling';
update public.categories set package = '{"weight": 0.4, "length": 26, "breadth": 8, "height": 30}' where id = 'mens';
update public.categories set package = '{"weight": 1.0, "length": 42, "breadth": 14, "height": 34}' where id = 'laptop';

-- ---------------------------------------------------------------- business and shipping settings

alter table public.settings
  add column pickup_location    text not null default 'Primary' check (char_length(pickup_location) between 1 and 60),
  add column pickup_pin         text check (pickup_pin is null or pickup_pin ~ '^[1-9][0-9]{5}$'),
  add column legal_name         text not null default '' check (char_length(legal_name) <= 120),
  add column gstin              text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  add column business_address   text not null default '' check (char_length(business_address) <= 300),
  add column business_state     text not null default '' check (char_length(business_state) <= 60),
  add column business_city      text not null default '' check (char_length(business_city) <= 80),
  add column business_phone     text check (business_phone is null or business_phone ~ '^\+91[6-9][0-9]{9}$'),
  add column gst_registered     bool not null default false,
  add column invoice_prefix     text not null default 'VRT' check (invoice_prefix ~ '^[A-Z0-9]{1,6}$'),
  add column return_window_days int  not null default 7 check (return_window_days between 0 and 60);

create or replace function public.store_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('shipping_fee', shipping_fee, 'free_shipping_over', free_shipping_over,
    'cod_enabled', cod_enabled, 'cod_fee', cod_fee, 'cod_max', cod_max, 'return_window_days', return_window_days)
  from public.settings where id = 1
$$;

-- ---------------------------------------------------------------- shipments and tracking

alter table public.orders
  add column delivered_at        timestamptz,
  add column shiprocket_order_id text,
  add column shipment_id         text,
  add column awb                 text unique,
  add column label_url           text check (label_url is null or label_url ~ '^https?://'),
  add column ship_status         text,
  add column ship_status_at      timestamptz,
  add column eta                 date;

create function public.orders_delivered_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'Delivered' and old.status <> 'Delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  return new;
end $$;
create trigger orders_delivered_at before update of status on public.orders
  for each row execute function public.orders_delivered_at();

create table public.shipment_events (
  id        bigint generated always as identity primary key,
  order_id  text references public.orders (id) on delete cascade,
  return_id bigint,
  awb       text not null,
  at        timestamptz not null,
  status    text not null,
  location  text not null default '',
  raw       jsonb,
  unique (awb, at, status)
);
create index shipment_events_order_idx on public.shipment_events (order_id, at desc);
alter table public.shipment_events enable row level security;
create policy "shipment events admin read" on public.shipment_events for select using (public.is_admin());
create policy "shipment events own read" on public.shipment_events for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));

-- Called after a shipment is booked with Shiprocket (server only).
create function public.record_shipment(p_order text, p_sr_order text, p_shipment text, p_awb text, p_courier text, p_label text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_order'); end if;
  perform set_config('vertu.system', 'yes', true);
  update public.orders set
    shiprocket_order_id = p_sr_order, shipment_id = p_shipment, awb = nullif(p_awb, ''),
    courier = coalesce(nullif(p_courier, ''), courier), tracking_number = coalesce(nullif(p_awb, ''), tracking_number),
    tracking_url = case when coalesce(p_awb, '') <> '' then 'https://shiprocket.co/tracking/' || p_awb else tracking_url end,
    label_url = coalesce(p_label, label_url),
    ship_status = case when coalesce(p_awb, '') = '' then 'BOOKED' else 'AWB ASSIGNED' end,
    ship_status_at = null, -- only courier events set the time
    status = case when status = 'Pending' and coalesce(p_awb, '') <> '' then 'Processing' else status end
  where id = p_order;
  perform set_config('vertu.system', '', true);
  return jsonb_build_object('ok', true, 'order_id', p_order);
end $$;

create function public.clear_shipment(p_order text, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.orders set shiprocket_order_id = null, shipment_id = null, awb = null, label_url = null,
    tracking_number = null, tracking_url = null, ship_status = 'SHIPMENT CANCELLED', ship_status_at = null,
    note = left(trim(note || ' Shipment cancelled. ' || coalesce(p_reason, '')), 500)
  where id = p_order and status in ('Pending', 'Processing');
end $$;

-- Courier tracking updates (Shiprocket webhook). Moves the order along and raises flags when deliveries go wrong.
create function public.apply_tracking(p_awb text, p_status text, p_at timestamptz, p_location text, p_etd timestamptz, p_is_return bool, p_raw jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  r record;
  st text := upper(regexp_replace(trim(coalesce(p_status, '')), '\s+', ' ', 'g'));
  at timestamptz := coalesce(p_at, now());
  moved text := null;
begin
  if st = '' or coalesce(p_awb, '') = '' then return jsonb_build_object('ok', false, 'error', 'bad_event'); end if;

  if p_is_return then
    select * into r from public.return_requests where return_awb = p_awb for update;
    if r.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_awb'); end if;
    insert into public.shipment_events (order_id, return_id, awb, at, status, location, raw)
    values (r.order_id, r.id, p_awb, at, st, left(coalesce(p_location, ''), 120), p_raw) on conflict do nothing;
    if st = 'DELIVERED' and r.status in ('pickup_scheduled', 'in_transit') then
      update public.return_requests set status = 'arrived' where id = r.id;
    elsif st ~ '(PICKED UP|IN TRANSIT|SHIPPED|REACHED)' and r.status = 'pickup_scheduled' then
      update public.return_requests set status = 'in_transit' where id = r.id;
    end if;
    return jsonb_build_object('ok', true, 'return_id', r.id);
  end if;

  select * into o from public.orders where awb = p_awb for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_awb'); end if;
  insert into public.shipment_events (order_id, awb, at, status, location, raw)
  values (o.id, p_awb, at, st, left(coalesce(p_location, ''), 120), p_raw) on conflict do nothing;
  -- an older courier event arriving late is kept in the timeline but doesn't move the order backwards
  if o.ship_status_at is not null and at < o.ship_status_at then
    return jsonb_build_object('ok', true, 'order_id', o.id, 'stale', true);
  end if;

  perform set_config('vertu.system', 'yes', true);
  update public.orders set ship_status = st, ship_status_at = at, eta = coalesce(p_etd::date, eta) where id = o.id;
  if o.status <> 'Cancelled' then
    if st = 'DELIVERED' and o.status <> 'Delivered' then
      update public.orders set status = 'Delivered' where id = o.id;
      moved := 'Delivered';
    elsif st ~ '^(PICKED UP|SHIPPED|IN TRANSIT|OUT FOR DELIVERY|REACHED|DISPATCHED)' and o.status in ('Pending', 'Processing') then
      update public.orders set status = 'Shipped' where id = o.id;
      moved := 'Shipped';
    end if;
    if st = 'OUT FOR DELIVERY' then
      perform public.enqueue_email('order_out_for_delivery', o.customer_email, public.order_email_payload(o.id), 'order_out_for_delivery:' || o.id);
    end if;
    if st ~ '^RTO' then
      update public.orders set flag = 'returning_to_us: ' || lower(st) where id = o.id and flag is distinct from 'returning_to_us: ' || lower(st);
    elsif st ~ '(UNDELIVERED|NDR|DELIVERY FAILED|LOST|DAMAGED)' then
      update public.orders set flag = 'delivery_problem: ' || lower(st) where id = o.id and flag is distinct from 'delivery_problem: ' || lower(st);
    end if;
  end if;
  perform set_config('vertu.system', '', true);
  return jsonb_build_object('ok', true, 'order_id', o.id, 'moved', moved);
end $$;

-- ---------------------------------------------------------------- GST invoices

create table public.invoice_counters (fy text primary key, last int not null default 0);
alter table public.invoice_counters enable row level security;

create table public.invoices (
  id        bigint generated always as identity primary key,
  number    text not null unique,
  order_id  text not null unique references public.orders (id),
  fy        text not null,
  issued_at timestamptz not null default now(),
  total     numeric(12, 2) not null,
  data      jsonb not null
);
alter table public.invoices enable row level security;
create policy "invoices admin read" on public.invoices for select using (public.is_admin());
create policy "invoices own read" on public.invoices for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
revoke insert, update, delete on public.invoices, public.invoice_counters from anon, authenticated;

-- Indian financial year: April to March, e.g. 2026-11-12 -> '26-27'.
create function public.fy_of(p_ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case when extract(month from p_ts at time zone 'Asia/Kolkata') >= 4
    then to_char(p_ts at time zone 'Asia/Kolkata', 'YY') || '-' || to_char((p_ts at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
    else to_char((p_ts at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || '-' || to_char(p_ts at time zone 'Asia/Kolkata', 'YY') end
$$;

-- Issues the tax invoice for an order (once). Prices are GST-inclusive, so tax is worked backwards:
-- taxable value = amount x 100 / (100 + rate). Discounts are spread over the lines in proportion.
-- Shipping and cash-on-delivery fees are charged with the goods (a composite supply) at the goods' rate.
create function public.issue_invoice(p_order text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; s public.settings; inv public.invoices;
  l record; lines jsonb := '[]'; n int; num text; f text;
  intra bool; reg bool; share numeric; left_discount numeric; gross numeric; net numeric; taxable numeric; tax numeric;
  rate numeric; top_rate numeric := 0; top_hsn text := '4202'; i int := 0; cnt int;
  t_taxable numeric := 0; t_cgst numeric := 0; t_sgst numeric := 0; t_igst numeric := 0; t_total numeric := 0;
  extra record;
begin
  select * into inv from public.invoices where order_id = p_order;
  if inv.id is not null then return jsonb_build_object('ok', true, 'number', inv.number, 'existing', true); end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'unknown_order'); end if;
  if o.payment_status not in ('paid', 'cod', 'partially_refunded') or o.status = 'Cancelled' then
    return jsonb_build_object('ok', false, 'error', 'not_invoiceable');
  end if;
  select * into s from public.settings where id = 1;
  if coalesce(s.legal_name, '') = '' then return jsonb_build_object('ok', false, 'error', 'seller_details_missing'); end if;
  reg := s.gst_registered and s.gstin is not null;
  intra := upper(trim(s.business_state)) = upper(trim(o.ship_state));
  left_discount := coalesce(o.discount, 0);
  select count(*) into cnt from public.order_items where order_id = o.id;

  for l in select it.*, c.unit, c.hsn, c.gst_rate from public.order_items it left join public.categories c on c.id = it.category
           where it.order_id = o.id order by it.id loop
    i := i + 1;
    gross := l.price * l.qty;
    share := case when i = cnt then left_discount else round(coalesce(o.discount, 0) * gross / nullif(o.subtotal, 0), 2) end;
    left_discount := left_discount - share;
    net := gross - share;
    rate := case when reg then coalesce(l.gst_rate, 18) else 0 end;
    if rate >= top_rate then top_rate := rate; top_hsn := coalesce(l.hsn, '4202'); end if;
    taxable := round(net * 100 / (100 + rate), 2);
    tax := net - taxable;
    lines := lines || jsonb_build_object(
      'description', l.colour || ' ' || coalesce(l.unit, l.category), 'sku', l.sku, 'hsn', coalesce(l.hsn, '4202'),
      'qty', l.qty, 'unit_price', l.price, 'gross', gross, 'discount', share, 'taxable', taxable, 'rate', rate,
      'cgst', case when reg and intra then round(tax / 2, 2) else 0 end,
      'sgst', case when reg and intra then tax - round(tax / 2, 2) else 0 end,
      'igst', case when reg and not intra then tax else 0 end, 'total', net);
    t_taxable := t_taxable + taxable; t_total := t_total + net;
    if reg and intra then t_cgst := t_cgst + round(tax / 2, 2); t_sgst := t_sgst + tax - round(tax / 2, 2);
    elsif reg then t_igst := t_igst + tax; end if;
  end loop;

  for extra in select * from (values ('Shipping and handling', o.shipping), ('Cash on delivery fee', o.cod_fee)) v(label, amount) where amount > 0 loop
    net := extra.amount;
    taxable := round(net * 100 / (100 + top_rate), 2);
    tax := net - taxable;
    lines := lines || jsonb_build_object('description', extra.label, 'sku', null, 'hsn', top_hsn, 'qty', 1, 'unit_price', net,
      'gross', net, 'discount', 0, 'taxable', taxable, 'rate', top_rate,
      'cgst', case when reg and intra then round(tax / 2, 2) else 0 end,
      'sgst', case when reg and intra then tax - round(tax / 2, 2) else 0 end,
      'igst', case when reg and not intra then tax else 0 end, 'total', net);
    t_taxable := t_taxable + taxable; t_total := t_total + net;
    if reg and intra then t_cgst := t_cgst + round(tax / 2, 2); t_sgst := t_sgst + tax - round(tax / 2, 2);
    elsif reg then t_igst := t_igst + tax; end if;
  end loop;

  f := public.fy_of(now());
  insert into public.invoice_counters (fy, last) values (f, 1)
  on conflict (fy) do update set last = invoice_counters.last + 1 returning last into n;
  num := s.invoice_prefix || '/' || f || '/' || lpad(n::text, 4, '0');

  insert into public.invoices (number, order_id, fy, total, data) values (num, o.id, f, t_total, jsonb_build_object(
    'title', case when reg then 'Tax invoice' else 'Invoice' end, 'number', num, 'date', now(), 'order_id', o.id,
    'order_date', o.created_at, 'registered', reg, 'intra_state', intra,
    'seller', jsonb_build_object('name', s.legal_name, 'gstin', s.gstin, 'address', s.business_address, 'state', s.business_state),
    'buyer', jsonb_build_object('name', o.customer_name, 'address', o.ship_address, 'city', o.ship_city, 'state', o.ship_state,
                                'pin', o.ship_pin, 'email', o.customer_email, 'phone', o.customer_phone),
    'place_of_supply', o.ship_state, 'payment_method', o.payment_method, 'lines', lines,
    'totals', jsonb_build_object('taxable', t_taxable, 'cgst', t_cgst, 'sgst', t_sgst, 'igst', t_igst, 'total', t_total)));
  return jsonb_build_object('ok', true, 'number', num);
end $$;

-- Staff can issue an invoice from the order panel; shipping an order issues it automatically.
create function public.create_invoice(p_order text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  return public.issue_invoice(p_order);
end $$;

create function public.orders_auto_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Shipped' and old.status <> 'Shipped' then perform public.issue_invoice(new.id); end if;
  return new;
end $$;
create trigger orders_auto_invoice after update of status on public.orders
  for each row execute function public.orders_auto_invoice();

-- The buyer's copy, reached with the order's secret link.
create function public.invoice_lookup(p_id text, p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select i.data from public.invoices i join public.orders o on o.id = i.order_id
  where o.id = p_id and o.access_token = p_token
$$;

-- ---------------------------------------------------------------- returns

create table public.return_requests (
  id            bigint generated always as identity primary key,
  order_id      text not null references public.orders (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  items         jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  reason        text not null check (reason in ('damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other')),
  details       text not null default '' check (char_length(details) <= 1000),
  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'rejected', 'pickup_scheduled', 'in_transit', 'arrived', 'received', 'refunded', 'closed')),
  decided_at    timestamptz,
  decided_by    uuid,
  admin_note    text not null default '' check (char_length(admin_note) <= 500),
  return_awb    text unique,
  refund_amount int
);
create index return_requests_order_idx on public.return_requests (order_id);
create trigger return_requests_touch before update on public.return_requests
  for each row execute function public.touch_updated_at();
create trigger return_requests_audit after insert or update on public.return_requests
  for each row execute function public.audit('id');
alter table public.return_requests enable row level security;
create policy "returns admin read" on public.return_requests for select using (public.is_admin());
create policy "returns own read" on public.return_requests for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
revoke insert, update, delete on public.return_requests from anon, authenticated;

create function public.return_payload(p_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.order_email_payload(r.order_id) || jsonb_build_object(
    'return_id', r.id, 'reason', r.reason, 'details', r.details, 'admin_note', r.admin_note, 'return_status', r.status,
    'return_items', (select coalesce(jsonb_agg(jsonb_build_object('sku', it ->> 'sku', 'qty', (it ->> 'qty')::int,
        'name', coalesce(c.unit, oi.category), 'colour', oi.colour, 'price', oi.price)), '[]')
      from jsonb_array_elements(r.items) it
      join public.order_items oi on oi.order_id = r.order_id and oi.sku = it ->> 'sku'
      left join public.categories c on c.id = oi.category))
  from public.return_requests r where r.id = p_id
$$;

-- Shoppers ask from their order page (secret link) or account. Delivered orders, within the return window.
create function public.request_return(p_order text, p_token uuid, p_items jsonb, p_reason text, p_details text default '')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; s public.settings; it jsonb; ordered int; already int; rid bigint; clean jsonb := '[]';
begin
  select * into o from public.orders where id = p_order
    and ((p_token is not null and access_token = p_token) or (auth.uid() is not null and customer_id = auth.uid()));
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into s from public.settings where id = 1;
  if s.return_window_days = 0 then return jsonb_build_object('ok', false, 'error', 'returns_off'); end if;
  if o.status <> 'Delivered' then return jsonb_build_object('ok', false, 'error', 'not_delivered'); end if;
  if o.delivered_at < now() - make_interval(days => s.return_window_days) then
    return jsonb_build_object('ok', false, 'error', 'window_closed');
  end if;
  if p_reason not in ('damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then return jsonb_build_object('ok', false, 'error', 'bad_items'); end if;
  for it in select value from jsonb_array_elements(p_items) loop
    select coalesce(sum(qty), 0) into ordered from public.order_items where order_id = o.id and sku = it ->> 'sku';
    select coalesce(sum((x ->> 'qty')::int), 0) into already
      from public.return_requests rr, jsonb_array_elements(rr.items) x
      where rr.order_id = o.id and rr.status <> 'rejected' and x ->> 'sku' = it ->> 'sku';
    if ordered = 0 or coalesce((it ->> 'qty')::int, 0) < 1 or (it ->> 'qty')::int > ordered - already then
      return jsonb_build_object('ok', false, 'error', 'bad_items', 'sku', it ->> 'sku');
    end if;
    clean := clean || jsonb_build_object('sku', it ->> 'sku', 'qty', (it ->> 'qty')::int);
  end loop;
  insert into public.return_requests (order_id, items, reason, details)
  values (o.id, clean, p_reason, left(coalesce(p_details, ''), 1000)) returning id into rid;
  perform public.enqueue_email('return_requested', o.customer_email, public.return_payload(rid), 'return_requested:' || rid);
  perform public.enqueue_email('admin_return', s.notify_email, public.return_payload(rid), 'admin_return:' || rid);
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

create function public.order_returns(p_id text, p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'created_at', r.created_at, 'items', r.items,
    'reason', r.reason, 'admin_note', r.admin_note) order by r.id), '[]')
  from public.return_requests r join public.orders o on o.id = r.order_id
  where o.id = p_id and o.access_token = p_token
$$;

create function public.decide_return(p_id bigint, p_approve bool, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.return_requests; o public.orders;
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.return_requests where id = p_id for update;
  if r.id is null or r.status <> 'requested' then return jsonb_build_object('ok', false, 'error', 'not_open'); end if;
  update public.return_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), admin_note = left(coalesce(p_note, ''), 500) where id = p_id;
  select * into o from public.orders where id = r.order_id;
  perform public.enqueue_email(case when p_approve then 'return_approved' else 'return_rejected' end, o.customer_email,
    public.return_payload(p_id), 'return_decided:' || p_id);
  return jsonb_build_object('ok', true);
end $$;

create function public.set_return_pickup(p_id bigint, p_awb text) returns void
language sql security definer set search_path = '' as $$
  update public.return_requests set return_awb = p_awb, status = 'pickup_scheduled' where id = p_id and status = 'approved'
$$;

-- Items checked back in: restock exactly what came back, and suggest the refund (after the order's discount share).
create function public.receive_return(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.return_requests; o public.orders; it jsonb; amount numeric := 0; price int;
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from public.return_requests where id = p_id for update;
  if r.id is null or r.status not in ('approved', 'pickup_scheduled', 'in_transit', 'arrived') then
    return jsonb_build_object('ok', false, 'error', 'not_receivable');
  end if;
  select * into o from public.orders where id = r.order_id;
  perform set_config('vertu.stock_reason', 'return', true);
  for it in select value from jsonb_array_elements(r.items) loop
    update public.products set stock = stock + (it ->> 'qty')::int where id = it ->> 'sku';
    select oi.price into price from public.order_items oi where oi.order_id = r.order_id and oi.sku = it ->> 'sku' limit 1;
    amount := amount + price * (it ->> 'qty')::int;
  end loop;
  perform set_config('vertu.stock_reason', '', true);
  amount := floor(amount * (1 - coalesce(o.discount, 0)::numeric / nullif(o.subtotal, 0)));
  amount := least(amount, coalesce(o.total, 0) - coalesce(o.refunded_amount, 0));
  update public.return_requests set status = 'received', refund_amount = amount::int where id = p_id;
  return jsonb_build_object('ok', true, 'refund_amount', amount::int);
end $$;

create function public.close_return(p_id bigint, p_refunded bool) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.return_requests set status = case when p_refunded then 'refunded' else 'closed' end
  where id = p_id and status in ('received', 'approved', 'arrived');
end $$;

-- ---------------------------------------------------------------- order page: everything the buyer can see

create or replace function public.order_lookup(p_id text, p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'created_at', o.created_at, 'status', o.status, 'payment_status', o.payment_status,
    'payment_method', o.payment_method, 'expires_at', o.expires_at,
    'name', o.customer_name, 'email', o.customer_email, 'city', o.ship_city, 'pin', o.ship_pin,
    'subtotal', o.subtotal, 'discount', o.discount, 'shipping', o.shipping, 'cod_fee', o.cod_fee, 'total', o.total,
    'refunded_amount', o.refunded_amount,
    'courier', o.courier, 'tracking_url', o.tracking_url, 'tracking_number', o.tracking_number, 'ship_status', o.ship_status, 'eta', o.eta,
    'delivered_at', o.delivered_at,
    'return_until', case when o.delivered_at is not null and s.return_window_days > 0 then o.delivered_at + make_interval(days => s.return_window_days) end,
    'invoice', (select number from public.invoices i where i.order_id = o.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'status', e.status, 'location', e.location) order by e.at desc), '[]')
               from public.shipment_events e where e.order_id = o.id and e.return_id is null),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'category', category, 'colour', colour, 'price', price, 'qty', qty) order by id), '[]')
              from public.order_items where order_id = o.id))
  from public.orders o, public.settings s where o.id = p_id and o.access_token = p_token and s.id = 1
$$;

-- ---------------------------------------------------------------- delivery estimate cache (filled by the delivery-estimate function)

create table public.pin_estimates (
  pin         text primary key check (pin ~ '^[1-9][0-9]{5}$'),
  serviceable bool not null,
  days_min    int,
  days_max    int,
  cod         bool not null default false,
  checked_at  timestamptz not null default now()
);
alter table public.pin_estimates enable row level security;

-- ---------------------------------------------------------------- Shiprocket login token (server only)

create table public.integration_tokens (
  name       text primary key,
  token      text not null,
  expires_at timestamptz not null
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens, public.pin_estimates from anon, authenticated;

-- ---------------------------------------------------------------- who may call what

revoke execute on function public.record_shipment(text, text, text, text, text, text), public.clear_shipment(text, text),
  public.apply_tracking(text, text, timestamptz, text, timestamptz, bool, jsonb), public.issue_invoice(text),
  public.set_return_pickup(bigint, text), public.return_payload(bigint), public.fy_of(timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_shipment(text, text, text, text, text, text), public.clear_shipment(text, text),
  public.apply_tracking(text, text, timestamptz, text, timestamptz, bool, jsonb), public.issue_invoice(text),
  public.set_return_pickup(bigint, text), public.return_payload(bigint), public.fy_of(timestamptz)
  to service_role;
revoke execute on function public.create_invoice(text), public.decide_return(bigint, bool, text),
  public.receive_return(bigint), public.close_return(bigint, bool) from public, anon;
grant execute on function public.create_invoice(text), public.decide_return(bigint, bool, text),
  public.receive_return(bigint), public.close_return(bigint, bool) to authenticated;
-- request_return, order_returns, invoice_lookup and order_lookup stay open: they need the order's secret token
-- (or, for request_return, the signed-in owner of the order).
