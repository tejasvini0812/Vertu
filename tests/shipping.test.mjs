// Shiprocket integration logic against the real database (PGlite) with a fake Shiprocket API.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, serviceRpc } from '../supabase/tests/db.mjs';
import {
  shiprocketClient, parcelFor, adhocPayload, pickRates, parseSrDate, parseTrackingWebhook,
  handleAdminShipping, handleShiprocketWebhook, handleDeliveryEstimate,
} from '../supabase/functions/_shared/shiprocket.js';

let db, rpc, deps, fake;
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];

function fakeShiprocket() {
  let n = 100;
  const calls = [];
  let awbFails = 0;
  return {
    calls,
    failAwb(k = 1) { awbFails = k; },
    async serviceability(a) {
      calls.push(['serviceability', a]);
      if (a.delivery === '999999') return { data: { available_courier_companies: [] } };
      return { data: { recommended_courier_company_id: 2, available_courier_companies: [
        { courier_company_id: 1, courier_name: 'Xpressbees Surface', rate: 72.5, estimated_delivery_days: '5', cod: 1 },
        { courier_company_id: 2, courier_name: 'Delhivery Surface', rate: 88, estimated_delivery_days: '3', cod: 1 },
        { courier_company_id: 3, courier_name: 'Bluedart Air', rate: 140, estimated_delivery_days: '2', cod: 0 },
      ] } };
    },
    async createOrder(p) { calls.push(['createOrder', p]); return { order_id: ++n, shipment_id: ++n, status: 'NEW' }; },
    async assignAwb(sh, courier, isReturn) {
      calls.push(['assignAwb', sh, courier, isReturn]);
      if (awbFails > 0) { awbFails--; return { awb_assign_status: 0, response: { data: { awb_assign_error: 'Courier not serviceable' } } }; }
      return { awb_assign_status: 1, response: { data: { awb_code: `AWB${sh}`, courier_name: courier === 1 ? 'Xpressbees Surface' : 'Delhivery Surface' } } };
    },
    async label(sh) { calls.push(['label', sh]); return { label_created: 1, label_url: `https://labels.example/${sh}.pdf` }; },
    async pickup(sh) { calls.push(['pickup', sh]); return { pickup_status: 1, response: { pickup_scheduled_date: '2026-11-13 10:00:00' } }; },
    async cancel(ids) { calls.push(['cancel', ids]); return { message: 'Order cancelled' }; },
    async createReturn(p) { calls.push(['createReturn', p]); return { order_id: ++n, shipment_id: ++n }; },
    async track(awb) {
      calls.push(['track', awb]);
      return { tracking_data: { etd: '2026-11-16 18:00:00', shipment_track_activities: [
        { date: '2026-11-13 11:00:00', activity: 'Shipment picked up', location: 'Mumbai', 'sr-status-label': 'PICKED UP' },
        { date: '2026-11-14 09:00:00', activity: 'In transit', location: 'Pune', 'sr-status-label': 'IN TRANSIT' },
      ] } };
    },
  };
}

before(async () => {
  db = await makeDb();
  rpc = serviceRpc(db);
  await db.exec(`update settings set pickup_pin = '400050', legal_name = 'Vertu Lifestyle LLP', business_state = 'Maharashtra',
    business_address = '12 Studio Lane, Bandra', business_city = 'Mumbai', business_phone = '+919769245614', cod_enabled = true, cod_max = 9000`);
  fake = fakeShiprocket();
  deps = {
    role: 'staff', rpc, sr: fake,
    db: {
      order: (id) => q1('select * from orders where id=$1', [id]),
      items: async (id) => (await db.query('select * from order_items where order_id=$1 order by id', [id])).rows,
      settings: () => q1('select * from settings where id=1'),
      categories: async () => (await db.query('select * from categories')).rows,
      ret: (id) => q1('select * from return_requests where id=$1', [id]),
    },
  };
});

const place = (items, method = 'cod') => rpc('create_order', {
  p_items: items, p_coupon: null, p_method: method,
  p_contact: { email: 'riya@example.com', phone: '+919822233344' },
  p_address: { full_name: 'Riya Desai Mehta', line1: '7 Garden Road', city: 'Surat', state: 'Gujarat', pin: '395007' }, p_user: null,
});

test('client logs in once, reuses the token, re-logs on 401', async () => {
  const seen = [];
  let tokens = 0;
  let reject = true;
  const store = { v: null, get: async () => store.v, set: async (token, expires_at) => (store.v = { token, expires_at }) };
  const c = shiprocketClient({ email: 'api@vertu.in', password: 'pw', tokenStore: store, fetchImpl: async (url, init) => {
    seen.push([init.method, url.replace('https://apiv2.shiprocket.in/v1/external', ''), init.headers.Authorization || '']);
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ token: `tok${++tokens}` }), { status: 200 });
    if (url.includes('/courier/track/') && reject) { reject = false; return new Response('{}', { status: 401 }); }
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  } });
  await c.serviceability({ pickup: '400050', delivery: '110016', weight: 1, cod: true });
  await c.label('55');
  await c.track('AWB1');
  assert.deepEqual(seen.map((s) => s[1]), ['/auth/login', '/courier/serviceability/?pickup_postcode=400050&delivery_postcode=110016&weight=1&cod=1', '/courier/generate/label', '/courier/track/awb/AWB1', '/auth/login', '/courier/track/awb/AWB1']);
  assert.equal(seen[1][2], 'Bearer tok1');
  assert.equal(seen.at(-1)[2], 'Bearer tok2');
  assert.equal(store.v.token, 'tok2');
  assert.equal(shiprocketClient({ email: '', password: '' }), null);
});

test('parcel, payload and rate parsing', async () => {
  const cats = (await db.query('select * from categories')).rows;
  const p = parcelFor([{ category: 'laptop', qty: 1 }, { category: 'sling', qty: 2 }], cats);
  assert.deepEqual(p, { weight: 2.2, length: 42, breadth: 14, height: 90 });
  const o = await place([{ sku: 'VRT-LP-CRI', qty: 1 }]);
  const order = await deps.db.order(o.order_id);
  const items = await deps.db.items(o.order_id);
  const s = await deps.db.settings();
  const a = adhocPayload(order, items, s, cats);
  assert.equal(a.order_id, o.order_id);
  assert.equal(a.payment_method, 'COD');
  assert.equal(a.billing_customer_name, 'Riya');
  assert.equal(a.billing_last_name, 'Desai Mehta');
  assert.equal(a.billing_phone, '9822233344');
  assert.equal(a.order_items[0].name, 'Crimson Laptop Bag');
  assert.equal(a.order_items[0].hsn, '4202');
  assert.equal(a.transaction_charges, order.cod_fee);
  assert.match(a.order_date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  const r = pickRates(await fake.serviceability({ delivery: '110016' }));
  assert.equal(r[0].name, 'Delhivery Surface');
  assert.equal(r[0].recommended, true);
  assert.equal(r[1].rate, 72.5);
  assert.equal(parseSrDate('23 05 2026 11:43:52'), '2026-05-23T06:13:52.000Z');
  assert.equal(parseSrDate('2026-05-19 11:59:16'), '2026-05-19T06:29:16.000Z');
});

test('book a shipment: order, AWB, label, pickup, invoice; then courier updates move it', async () => {
  const o = await place([{ sku: 'VRT-SL-COB', qty: 1 }, { sku: 'VRT-MS-TEA', qty: 1 }]);
  assert.equal((await handleAdminShipping({ action: 'rates', order_id: o.order_id }, { ...deps, role: null })).status, 403);
  const rates = await handleAdminShipping({ action: 'rates', order_id: o.order_id }, deps);
  assert.equal(rates.status, 200);
  assert.equal(rates.body.couriers.length, 3);
  assert.equal(fake.calls.at(-1)[1].cod, true);
  const b = await handleAdminShipping({ action: 'book', order_id: o.order_id, courier_id: 1 }, deps);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.courier, 'Xpressbees Surface');
  assert.match(b.body.label_url, /labels\.example/);
  const row = await q1('select status, awb, label_url, tracking_url, ship_status from orders where id=$1', [o.order_id]);
  assert.equal(row.status, 'Processing');
  assert.equal(row.awb, b.body.awb);
  assert.equal(row.ship_status, 'AWB ASSIGNED');
  assert.ok(await q1('select number from invoices where order_id=$1', [o.order_id]), 'invoice issued on booking');
  assert.equal((await handleAdminShipping({ action: 'book', order_id: o.order_id }, deps)).body.error, 'already_booked');

  const hook = (body, key = 'hook-token') => handleShiprocketWebhook(body, key, { rpc, webhookToken: 'hook-token' });
  assert.equal((await hook({ awb: row.awb, current_status: 'DELIVERED' }, 'wrong')).status, 401);
  const r1 = await hook({ awb: row.awb, current_status: 'PICKED UP', current_timestamp: '13 11 2026 11:00:00', etd: '2026-11-16 18:00:00', scans: [{ date: '2026-11-13 11:00:00', location: 'Mumbai Hub', 'sr-status-label': 'PICKED UP' }], is_return: 0 });
  assert.equal(r1.body.result.moved, 'Shipped');
  const r2 = await hook({ awb: row.awb, current_status: 'DELIVERED', current_timestamp: '16 11 2026 15:20:00', scans: [], is_return: 0 });
  assert.equal(r2.body.result.moved, 'Delivered');
  const done = await q1('select status, payment_status, delivered_at from orders where id=$1', [o.order_id]);
  assert.equal(done.status, 'Delivered');
  assert.equal(done.payment_status, 'paid', 'cash collected on delivery');
  assert.equal((await hook({ awb: 'UNKNOWN', current_status: 'DELIVERED' })).status, 200, 'unknown AWBs acknowledged so Shiprocket stops retrying');
});

test('AWB failure keeps the Shiprocket order and a retry reuses it', async () => {
  const o = await place([{ sku: 'VRT-LP-COB', qty: 1 }]);
  fake.failAwb(1);
  const first = await handleAdminShipping({ action: 'book', order_id: o.order_id }, deps);
  assert.equal(first.status, 502);
  assert.equal(first.body.message, 'Courier not serviceable');
  const mid = await q1('select status, awb, shipment_id, ship_status from orders where id=$1', [o.order_id]);
  assert.equal(mid.status, 'Pending');
  assert.equal(mid.awb, null);
  assert.equal(mid.ship_status, 'BOOKED');
  const creates = fake.calls.filter((c) => c[0] === 'createOrder').length;
  const second = await handleAdminShipping({ action: 'book', order_id: o.order_id }, deps);
  assert.equal(second.status, 200);
  assert.equal(fake.calls.filter((c) => c[0] === 'createOrder').length, creates, 'no duplicate Shiprocket order');
});

test('cancel a booked shipment before pickup; sync tracking by hand', async () => {
  const o = await place([{ sku: 'VRT-LP-BLA', qty: 1 }]);
  await handleAdminShipping({ action: 'book', order_id: o.order_id }, deps);
  const c = await handleAdminShipping({ action: 'cancel', order_id: o.order_id, reason: 'Customer changed address' }, deps);
  assert.equal(c.status, 200);
  const row = await q1('select awb, ship_status, status from orders where id=$1', [o.order_id]);
  assert.equal(row.awb, null);
  assert.equal(row.ship_status, 'SHIPMENT CANCELLED');
  const again = await handleAdminShipping({ action: 'book', order_id: o.order_id }, deps);
  assert.equal(again.status, 200);
  const t = await handleAdminShipping({ action: 'track', order_id: o.order_id }, deps);
  assert.deepEqual(t.body, { events: 2, applied: 2 });
  assert.equal((await q1('select status from orders where id=$1', [o.order_id])).status, 'Shipped');
  assert.equal((await handleAdminShipping({ action: 'cancel', order_id: o.order_id }, deps)).body.error, 'already_shipped');
});

test('reverse pickup for an approved return', async () => {
  const o = await place([{ sku: 'VRT-MS-NAV', qty: 2 }]);
  await handleAdminShipping({ action: 'book', order_id: o.order_id }, deps);
  const awb = (await q1('select awb from orders where id=$1', [o.order_id])).awb;
  await rpc('apply_tracking', { p_awb: awb, p_status: 'DELIVERED', p_at: new Date().toISOString(), p_location: '', p_etd: null, p_is_return: false, p_raw: {} });
  const req = (await db.query(`select request_return($1, $2, '[{"sku":"VRT-MS-NAV","qty":1}]'::jsonb, 'changed_mind', '') r`, [o.order_id, o.access_token])).rows[0].r;
  assert.ok(req.ok, JSON.stringify(req));
  assert.equal((await handleAdminShipping({ action: 'return_pickup', return_id: req.id }, deps)).body.error, 'not_approved');
  await db.exec(`update return_requests set status = 'approved' where id = ${req.id}`);
  const r = await handleAdminShipping({ action: 'return_pickup', return_id: req.id }, deps);
  assert.equal(r.status, 200);
  const payload = fake.calls.filter((c) => c[0] === 'createReturn').at(-1)[1];
  assert.equal(payload.pickup_pincode, '395007');
  assert.equal(payload.shipping_pincode, '400050');
  assert.equal(payload.order_items[0].units, 1);
  assert.equal(fake.calls.filter((c) => c[0] === 'assignAwb').at(-1)[3], true);
  assert.equal((await q1('select status, return_awb from return_requests where id=$1', [req.id])).status, 'pickup_scheduled');
});

test('delivery estimate: cached per PIN, unserviceable PINs, not configured', async () => {
  const cache = new Map();
  const d = { sr: fake, pickupPin: '400050', getCache: async (p) => cache.get(p), setCache: async (r) => cache.set(r.pin, r) };
  assert.equal((await handleDeliveryEstimate({ pin: '12' }, d)).status, 400);
  const a = await handleDeliveryEstimate({ pin: '110016' }, d);
  assert.deepEqual(a.body, { pin: '110016', serviceable: true, days_min: 3, days_max: 4, cod: true });
  const before = fake.calls.length;
  assert.equal((await handleDeliveryEstimate({ pin: '110016' }, d)).body.cached, true);
  assert.equal(fake.calls.length, before);
  assert.equal((await handleDeliveryEstimate({ pin: '999999' }, d)).body.serviceable, false);
  assert.equal((await handleDeliveryEstimate({ pin: '560034' }, { ...d, sr: null })).status, 503);
});

test('webhook parsing tolerates Shiprocket formats', () => {
  const e = parseTrackingWebhook({ awb: 123, current_status: 'OUT FOR DELIVERY', current_timestamp: '15 11 2026 09:00:00', scans: [{ date: '2026-11-15 08:55:00', location: 'Surat Hub' }], is_return: '1' });
  assert.deepEqual(e, { awb: '123', status: 'OUT FOR DELIVERY', at: '2026-11-15T03:30:00.000Z', location: 'Surat Hub', etd: null, isReturn: true });
});
