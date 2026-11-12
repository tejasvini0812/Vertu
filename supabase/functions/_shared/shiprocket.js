// Shiprocket integration. Plain JS with injected dependencies, shared by the Edge Functions (Deno) and tests (Node).
// API: https://apiv2.shiprocket.in/v1/external, Bearer token from /auth/login (valid 10 days; cached for 9).

const BASE = 'https://apiv2.shiprocket.in/v1/external';
const DAY = 86400000;

export function shiprocketClient({ email, password, fetchImpl = fetch, tokenStore }) {
  if (!email || !password) return null;
  let memo = null;
  async function token(force = false) {
    if (!force) {
      const t = memo || (tokenStore && (await tokenStore.get()));
      if (t && new Date(t.expires_at) - Date.now() > 3600000) return (memo = t).token;
    }
    const res = await fetchImpl(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.token) throw srError(json, res.status, 'Shiprocket login failed');
    memo = { token: json.token, expires_at: new Date(Date.now() + 9 * DAY).toISOString() };
    if (tokenStore) await tokenStore.set(memo.token, memo.expires_at);
    return memo.token;
  }
  async function call(method, path, body, retried = false) {
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token(retried)}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) return call(method, path, body, true);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw srError(json, res.status);
    return json;
  }
  const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return {
    serviceability: ({ pickup, delivery, weight, cod }) =>
      call('GET', `/courier/serviceability/?${qs({ pickup_postcode: pickup, delivery_postcode: delivery, weight, cod: cod ? 1 : 0 })}`),
    createOrder: (payload) => call('POST', '/orders/create/adhoc', payload),
    assignAwb: (shipmentId, courierId, isReturn = false) =>
      call('POST', '/courier/assign/awb', { shipment_id: shipmentId, ...(courierId ? { courier_id: courierId } : {}), ...(isReturn ? { is_return: 1 } : {}) }),
    pickup: (shipmentId) => call('POST', '/courier/generate/pickup', { shipment_id: [shipmentId] }),
    label: (shipmentId) => call('POST', '/courier/generate/label', { shipment_id: [shipmentId] }),
    cancel: (srOrderIds) => call('POST', '/orders/cancel', { ids: srOrderIds }),
    createReturn: (payload) => call('POST', '/orders/create/return', payload),
    track: (awb) => call('GET', `/courier/track/awb/${encodeURIComponent(awb)}`),
  };
}

function srError(json, status, fallback) {
  const msg =
    json?.message ||
    (json?.errors && Object.values(json.errors).flat().join(' ')) ||
    json?.response?.data?.awb_assign_error ||
    fallback ||
    `Shiprocket responded ${status}`;
  return Object.assign(new Error(msg), { status, code: 'shiprocket' });
}

// ---------------------------------------------------------------- building requests

/** Parcel for an order: weights add up; length/breadth take the largest bag; heights stack (capped). */
export function parcelFor(lines, categories) {
  const pk = (cat) => ({ weight: 0.5, length: 30, breadth: 10, height: 25, ...(categories.find((c) => c.id === cat)?.package || {}) });
  let weight = 0;
  let length = 0;
  let breadth = 0;
  let height = 0;
  for (const l of lines) {
    const p = pk(l.category);
    weight += Number(p.weight) * l.qty;
    length = Math.max(length, Number(p.length));
    breadth = Math.max(breadth, Number(p.breadth));
    height += Number(p.height) * l.qty;
  }
  return { weight: Math.max(0.1, Math.round(weight * 100) / 100), length, breadth, height: Math.min(height, 120) };
}

const phone10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const split = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return { first: parts[0] || 'Customer', last: parts.slice(1).join(' ') };
};
const srDate = (d) => {
  const x = new Date(new Date(d).getTime() + 330 * 60000); // IST wall clock
  return x.toISOString().slice(0, 16).replace('T', ' ');
};
const lineName = (l, categories) => `${l.colour} ${categories.find((c) => c.id === l.category)?.unit || l.category}`;

/** Our order -> Shiprocket "adhoc" order. Prices are GST-inclusive; COD collects total minus nothing. */
export function adhocPayload(order, items, settings, categories) {
  const n = split(order.customer_name);
  const parcel = parcelFor(items, categories);
  return {
    order_id: order.id,
    order_date: srDate(order.created_at),
    pickup_location: settings.pickup_location,
    billing_customer_name: n.first,
    billing_last_name: n.last,
    billing_address: order.ship_address,
    billing_city: order.ship_city,
    billing_pincode: order.ship_pin,
    billing_state: order.ship_state,
    billing_country: 'India',
    billing_email: order.customer_email,
    billing_phone: phone10(order.customer_phone),
    shipping_is_billing: true,
    order_items: items.map((l) => {
      const c = categories.find((x) => x.id === l.category);
      return { name: lineName(l, categories), sku: l.sku, units: l.qty, selling_price: l.price, hsn: c?.hsn || '4202', tax: Number(c?.gst_rate ?? 18) };
    }),
    payment_method: order.payment_method === 'cod' && order.payment_status === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges: order.shipping || 0,
    transaction_charges: order.cod_fee || 0,
    total_discount: order.discount || 0,
    sub_total: order.subtotal ?? items.reduce((s, l) => s + l.price * l.qty, 0),
    ...parcel,
  };
}

/** A reverse pickup from the customer back to our pickup address. */
export function returnPayload(order, ret, items, settings, categories) {
  const n = split(order.customer_name);
  const picked = ret.items.map((r) => ({ ...items.find((i) => i.sku === r.sku), qty: r.qty }));
  return {
    order_id: `${order.id}-R${ret.id}`,
    order_date: srDate(new Date()),
    pickup_customer_name: n.first,
    pickup_last_name: n.last,
    pickup_address: order.ship_address,
    pickup_city: order.ship_city,
    pickup_state: order.ship_state,
    pickup_country: 'India',
    pickup_pincode: order.ship_pin,
    pickup_email: order.customer_email,
    pickup_phone: phone10(order.customer_phone),
    shipping_customer_name: settings.legal_name || 'VERTU',
    shipping_address: settings.business_address,
    shipping_city: settings.business_city || '',
    shipping_country: 'India',
    shipping_pincode: settings.pickup_pin,
    shipping_state: settings.business_state,
    shipping_email: settings.notify_email || '',
    shipping_phone: phone10(settings.business_phone || ''),
    order_items: picked.map((l) => ({ name: lineName(l, categories), sku: l.sku, units: l.qty, selling_price: l.price })),
    payment_method: 'Prepaid',
    sub_total: picked.reduce((s, l) => s + l.price * l.qty, 0),
    ...parcelFor(picked, categories),
  };
}

// ---------------------------------------------------------------- reading responses (defensively: field names vary)

export function pickRates(resp) {
  const d = resp?.data || {};
  const list = d.available_courier_companies || [];
  const rec = d.recommended_courier_company_id ?? d.shiprocket_recommended_courier_id ?? null;
  return list
    .map((c) => ({
      courier_id: c.courier_company_id ?? c.id,
      name: c.courier_name,
      rate: Number(c.rate ?? c.freight_charge ?? 0),
      days: Number.parseInt(c.estimated_delivery_days ?? c.etd_hours / 24, 10) || null,
      etd: c.etd || null,
      cod: Number(c.cod) === 1,
      rating: Number(c.rating) || null,
      recommended: rec != null && (c.courier_company_id ?? c.id) === rec,
    }))
    .sort((a, b) => b.recommended - a.recommended || a.rate - b.rate);
}

export const parseAwb = (resp) => {
  const d = resp?.response?.data || resp?.data || resp || {};
  return { awb: d.awb_code || '', courier: d.courier_name || '', error: d.awb_assign_error || resp?.message || '' };
};

/** Shiprocket timestamps come as "23 05 2026 11:43:52" or "2026-05-19 11:59:16", in India time. */
export function parseSrDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{2}) (\d{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`).toISOString();
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+05:30`).toISOString();
  const d = new Date(str);
  return Number.isNaN(+d) ? null : d.toISOString();
}

export function parseTrackingWebhook(b) {
  const scans = Array.isArray(b?.scans) ? b.scans : [];
  const last = scans[scans.length - 1] || {};
  return {
    awb: String(b?.awb || b?.awb_code || ''),
    status: String(b?.current_status || b?.shipment_status || last['sr-status-label'] || ''),
    at: parseSrDate(b?.current_timestamp) || parseSrDate(last.date) || new Date().toISOString(),
    location: last.location || '',
    etd: parseSrDate(b?.etd),
    isReturn: Number(b?.is_return) === 1,
  };
}

// ---------------------------------------------------------------- handlers

const reply = (status, body) => ({ status, body });
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};
const shippable = (o) => ['paid', 'cod', 'partially_refunded'].includes(o.payment_status) && !['Cancelled', 'Delivered'].includes(o.status);

/**
 * POST /admin-shipping { action, order_id?, courier_id?, return_id? }  (staff and owners)
 * deps: { role, rpc, sr, db: { order(id), items(id), settings(), categories(), ret(id) } }
 */
export async function handleAdminShipping(body, deps) {
  if (!['owner', 'staff'].includes(deps.role)) return reply(403, { error: 'staff_only' });
  if (!deps.sr) return reply(503, { error: 'shiprocket_not_configured' });
  const action = body?.action;

  if (action === 'return_pickup') {
    const r = await deps.db.ret(Number(body?.return_id));
    if (!r) return reply(404, { error: 'unknown_return' });
    if (r.status !== 'approved') return reply(409, { error: 'not_approved' });
    const [o, items, s, cats] = await Promise.all([deps.db.order(r.order_id), deps.db.items(r.order_id), deps.db.settings(), deps.db.categories()]);
    if (!s.pickup_pin || !s.business_address) return reply(409, { error: 'pickup_address_missing' });
    const created = await deps.sr.createReturn(returnPayload(o, r, items, s, cats));
    const a = parseAwb(await deps.sr.assignAwb(created.shipment_id, null, true));
    if (!a.awb) return reply(502, { error: 'awb_failed', message: a.error });
    await deps.rpc('set_return_pickup', { p_id: r.id, p_awb: a.awb });
    return reply(200, { awb: a.awb, courier: a.courier });
  }

  const o = await deps.db.order(String(body?.order_id || ''));
  if (!o) return reply(404, { error: 'unknown_order' });

  if (action === 'rates') {
    if (!shippable(o)) return reply(409, { error: 'not_shippable' });
    const [items, s, cats] = await Promise.all([deps.db.items(o.id), deps.db.settings(), deps.db.categories()]);
    if (!s.pickup_pin) return reply(409, { error: 'pickup_pin_missing' });
    const parcel = parcelFor(items, cats);
    const resp = await deps.sr.serviceability({ pickup: s.pickup_pin, delivery: o.ship_pin, weight: parcel.weight, cod: o.payment_status === 'cod' });
    return reply(200, { parcel, couriers: pickRates(resp) });
  }

  if (action === 'book') {
    if (!shippable(o)) return reply(409, { error: 'not_shippable' });
    if (o.awb) return reply(409, { error: 'already_booked', awb: o.awb });
    const [items, s, cats] = await Promise.all([deps.db.items(o.id), deps.db.settings(), deps.db.categories()]);
    let srOrder = o.shiprocket_order_id;
    let shipment = o.shipment_id;
    if (!shipment) {
      const c = await deps.sr.createOrder(adhocPayload(o, items, s, cats));
      srOrder = String(c.order_id ?? '');
      shipment = String(c.shipment_id ?? '');
      if (!shipment) return reply(502, { error: 'order_failed', message: c.message || 'Shiprocket did not return a shipment' });
    }
    const a = parseAwb(await deps.sr.assignAwb(shipment, body?.courier_id || null));
    if (!a.awb) {
      await deps.rpc('record_shipment', { p_order: o.id, p_sr_order: srOrder, p_shipment: shipment, p_awb: '', p_courier: '', p_label: null });
      return reply(502, { error: 'awb_failed', message: a.error || 'No courier accepted the shipment' });
    }
    let label = null;
    const notes = [];
    try {
      label = (await deps.sr.label(shipment))?.label_url || null;
    } catch (e) {
      notes.push(`Label: ${e.message}`);
    }
    await deps.rpc('record_shipment', { p_order: o.id, p_sr_order: srOrder, p_shipment: shipment, p_awb: a.awb, p_courier: a.courier, p_label: label });
    let pickup = null;
    try {
      const p = await deps.sr.pickup(shipment);
      pickup = p?.response?.pickup_scheduled_date || p?.response?.data || true;
    } catch (e) {
      notes.push(`Pickup: ${e.message}`);
    }
    try {
      await deps.rpc('issue_invoice', { p_order: o.id });
    } catch (e) {
      notes.push(`Invoice: ${e.message}`);
    }
    return reply(200, { awb: a.awb, courier: a.courier, label_url: label, pickup, notes });
  }

  if (action === 'label') {
    if (!o.shipment_id || !o.awb) return reply(409, { error: 'not_booked' });
    const label = (await deps.sr.label(o.shipment_id))?.label_url || null;
    await deps.rpc('record_shipment', { p_order: o.id, p_sr_order: o.shiprocket_order_id, p_shipment: o.shipment_id, p_awb: o.awb, p_courier: o.courier, p_label: label });
    return reply(200, { label_url: label });
  }

  if (action === 'cancel') {
    if (!o.shiprocket_order_id) return reply(409, { error: 'not_booked' });
    if (!['Pending', 'Processing'].includes(o.status)) return reply(409, { error: 'already_shipped' });
    await deps.sr.cancel([o.shiprocket_order_id]);
    await deps.rpc('clear_shipment', { p_order: o.id, p_reason: String(body?.reason || '').slice(0, 200) });
    return reply(200, { cancelled: true });
  }

  if (action === 'track') {
    if (!o.awb) return reply(409, { error: 'not_booked' });
    const t = await deps.sr.track(o.awb);
    const acts = [...(t?.tracking_data?.shipment_track_activities || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let applied = 0;
    for (const x of acts) {
      const st = x['sr-status-label'] && x['sr-status-label'] !== 'NA' ? x['sr-status-label'] : x.activity;
      const r = await deps.rpc('apply_tracking', { p_awb: o.awb, p_status: st, p_at: parseSrDate(x.date), p_location: x.location || '', p_etd: parseSrDate(t?.tracking_data?.etd), p_is_return: false, p_raw: x });
      if (r?.ok) applied++;
    }
    return reply(200, { events: acts.length, applied });
  }
  return reply(400, { error: 'bad_action' });
}

/** POST /shiprocket-webhook (header x-api-key = the token you entered in Shiprocket). Answers 200 so Shiprocket doesn't retry. */
export async function handleShiprocketWebhook(body, apiKey, deps) {
  if (!safeEqual(String(apiKey || ''), String(deps.webhookToken || ''))) return reply(401, { error: 'unauthorised' });
  const e = parseTrackingWebhook(body);
  if (!e.awb || !e.status) return reply(200, { ignored: true });
  const r = await deps.rpc('apply_tracking', { p_awb: e.awb, p_status: e.status, p_at: e.at, p_location: e.location, p_etd: e.etd, p_is_return: e.isReturn, p_raw: body });
  return reply(200, { result: r });
}

/** POST /delivery-estimate { pin }  (public; cached a day per PIN). */
export async function handleDeliveryEstimate(body, deps) {
  const pin = String(body?.pin || '');
  if (!/^[1-9][0-9]{5}$/.test(pin)) return reply(400, { error: 'bad_pin' });
  const cached = await deps.getCache(pin);
  const now = deps.now ? deps.now() : new Date();
  if (cached && now - new Date(cached.checked_at) < DAY) return reply(200, { ...shape(cached), cached: true });
  if (!deps.sr || !deps.pickupPin) return reply(503, { error: 'not_configured' });
  let rates;
  try {
    rates = pickRates(await deps.sr.serviceability({ pickup: deps.pickupPin, delivery: pin, weight: 0.5, cod: true }));
  } catch (e) {
    if (e.status === 404 || /not serviceable|no courier/i.test(e.message)) rates = [];
    else return reply(502, { error: 'shiprocket' });
  }
  const days = rates.map((r) => r.days).filter(Boolean);
  const best = rates.find((r) => r.recommended) || rates[0];
  const row = {
    pin,
    serviceable: rates.length > 0,
    days_min: best?.days ?? (days.length ? Math.min(...days) : null),
    days_max: days.length ? Math.max(best?.days ?? 0, Math.min(...days) + 2) : null,
    cod: rates.some((r) => r.cod),
    checked_at: now.toISOString(),
  };
  await deps.setCache(row);
  return reply(200, shape(row));
}
const shape = (r) => ({ pin: r.pin, serviceable: r.serviceable, days_min: r.days_min, days_max: r.days_max, cod: r.cod });
