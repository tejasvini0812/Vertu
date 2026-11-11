// The Edge Function logic (supabase/functions/_shared/payments.js) driven against the real database
// functions in PGlite, with a fake Razorpay. Covers the whole money path.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, serviceRpc, USERS } from '../supabase/tests/db.mjs';
import {
  hmacHex, verifyPaymentSignature, verifyWebhookSignature, razorpayClient,
  handleCheckout, handleVerify, handleWebhook, handleAdminOrder,
} from '../supabase/functions/_shared/payments.js';

const KEY_SECRET = 'test_key_secret';
const HOOK_SECRET = 'test_webhook_secret';
let db, deps, fake;

function fakeRazorpay() {
  let n = 0;
  const orders = new Map();
  const payments = new Map();
  const refunds = [];
  let failNextOrder = false;
  return {
    orders, payments, refunds,
    failNext() { failNextOrder = true; },
    async createOrder(b) {
      if (failNextOrder) { failNextOrder = false; throw Object.assign(new Error('down'), { code: 'razorpay' }); }
      const o = { id: `order_T${++n}`, ...b };
      orders.set(o.id, o);
      return o;
    },
    /** what Razorpay Checkout does when the shopper pays */
    pay(orderId, { status = 'captured', amount } = {}) {
      const o = orders.get(orderId);
      const p = { id: `pay_T${++n}`, order_id: orderId, amount: amount ?? o.amount, status };
      payments.set(p.id, p);
      return p;
    },
    async fetchPayment(id) { return payments.get(id); },
    async capture(id) { payments.get(id).status = 'captured'; return payments.get(id); },
    async refund(id, amount) { const r = { id: `rfnd_T${++n}`, payment_id: id, amount }; refunds.push(r); return r; },
  };
}

const order = async (id) => (await db.query('select * from orders where id=$1', [id])).rows[0];
const stock = async (sku) => (await db.query('select stock from products where id=$1', [sku])).rows[0].stock;
const body = (items, extra = {}) => ({
  items,
  method: 'razorpay',
  contact: { email: 'buyer@example.com', phone: '+919876543210' },
  address: { full_name: 'Meera K', line1: '2 Hill View', city: 'Bengaluru', state: 'Karnataka', pin: '560034' },
  ...extra,
});
const signed = async (p) => ({ razorpay_order_id: p.order_id, razorpay_payment_id: p.id, razorpay_signature: await hmacHex(KEY_SECRET, `${p.order_id}|${p.id}`) });

before(async () => {
  db = await makeDb();
  fake = fakeRazorpay();
  deps = {
    rpc: serviceRpc(db),
    getOrder: async (id) => (await db.query('select * from orders where id=$1', [id])).rows[0] || null,
    rzp: fake, keyId: 'rzp_test_123', keySecret: KEY_SECRET, webhookSecret: HOOK_SECRET, now: () => new Date(),
  };
});

test('signatures: known vector and tamper detection', async () => {
  // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
  assert.equal(await hmacHex('key', 'The quick brown fox jumps over the lazy dog'), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  const ok = { razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: await hmacHex('s', 'order_1|pay_1') };
  assert.equal(await verifyPaymentSignature(ok, 's'), true);
  assert.equal(await verifyPaymentSignature({ ...ok, razorpay_payment_id: 'pay_2' }, 's'), false);
  assert.equal(await verifyPaymentSignature(ok, 'other'), false);
  assert.equal(await verifyWebhookSignature('{"a":1}', await hmacHex('w', '{"a":1}'), 'w'), true);
  assert.equal(await verifyWebhookSignature('{"a":2}', await hmacHex('w', '{"a":1}'), 'w'), false);
});

test('razorpay client sends Basic auth to the right URL and reports errors', async () => {
  const calls = [];
  const c = razorpayClient('rzp_test_x', 'sec', async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/orders') ? new Response(JSON.stringify({ id: 'order_9' }), { status: 200 }) : new Response(JSON.stringify({ error: { description: 'bad amount' } }), { status: 400 });
  });
  assert.equal((await c.createOrder({ amount: 100 })).id, 'order_9');
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders');
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + btoa('rzp_test_x:sec'));
  await assert.rejects(c.refund('pay_1', 1), /bad amount/);
  assert.equal(razorpayClient('', ''), null);
});

test('online payment: checkout -> pay -> verify -> paid; prices come from the database', async () => {
  const before = await stock('VRT-LP-CRI');
  const r = await handleCheckout(body([{ sku: 'VRT-LP-CRI', qty: 2, price: 1 }]), deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 4998);
  assert.equal(r.body.razorpay.amount, 499800);
  assert.equal(r.body.razorpay.key, 'rzp_test_123');
  assert.equal(await stock('VRT-LP-CRI'), before - 2);
  const pay = fake.pay(r.body.razorpay.order_id);
  const v = await handleVerify(await signed(pay), deps);
  assert.deepEqual(v, { status: 200, body: { order_id: r.body.order_id, paid: true } });
  const o = await order(r.body.order_id);
  assert.equal(o.payment_status, 'paid');
  assert.equal(o.razorpay_payment_id, pay.id);
});

test('forged or mismatched payment confirmations are refused', async () => {
  const r = await handleCheckout(body([{ sku: 'VRT-MS-NAV', qty: 1 }]), deps);
  const pay = fake.pay(r.body.razorpay.order_id);
  assert.equal((await handleVerify({ ...(await signed(pay)), razorpay_signature: 'f'.repeat(64) }, deps)).status, 400);
  // a valid payment for a different (cheaper) order can't be replayed against this one
  const other = await handleCheckout(body([{ sku: 'VRT-SL-BLA', qty: 1 }]), deps);
  const cheap = fake.pay(other.body.razorpay.order_id);
  const forged = await signed({ ...cheap, order_id: r.body.razorpay.order_id });
  assert.equal((await handleVerify(forged, deps)).body.error, 'order_mismatch');
  assert.equal((await order(r.body.order_id)).payment_status, 'awaiting');
});

test('authorized (not yet captured) payments are captured', async () => {
  const r = await handleCheckout(body([{ sku: 'VRT-SL-FOR', qty: 1 }]), deps);
  const pay = fake.pay(r.body.razorpay.order_id, { status: 'authorized' });
  assert.equal((await handleVerify(await signed(pay), deps)).status, 200);
  assert.equal(fake.payments.get(pay.id).status, 'captured');
});

test('webhook marks paid when the shopper closed the tab, and repeats are harmless', async () => {
  const r = await handleCheckout(body([{ sku: 'VRT-LP-COB', qty: 1 }]), deps);
  const pay = fake.pay(r.body.razorpay.order_id);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: pay } } });
  assert.equal((await handleWebhook(raw, 'bad', deps)).status, 400);
  const sig = await hmacHex(HOOK_SECRET, raw);
  assert.equal((await handleWebhook(raw, sig, deps)).status, 200);
  assert.equal((await order(r.body.order_id)).payment_status, 'paid');
  const again = await handleWebhook(raw, sig, deps);
  assert.equal(again.body.result.already, true);
  const failed = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { ...pay, error_description: 'Card declined' } } } });
  assert.equal((await handleWebhook(failed, await hmacHex(HOOK_SECRET, failed), deps)).status, 200);
  const ignored = JSON.stringify({ event: 'refund.processed', payload: {} });
  assert.equal((await handleWebhook(ignored, await hmacHex(HOOK_SECRET, ignored), deps)).body.ignored, 'refund.processed');
});

test('closing the payment window and retrying reuses the same hold', async () => {
  const first = await handleCheckout(body([{ sku: 'VRT-MS-TEA', qty: 1 }]), deps);
  const held = await stock('VRT-MS-TEA');
  const retry = await handleCheckout(body([{ sku: 'VRT-MS-TEA', qty: 1 }], { resume: { order_id: first.body.order_id, access_token: first.body.access_token } }), deps);
  assert.equal(retry.body.order_id, first.body.order_id);
  assert.equal(retry.body.razorpay.order_id, first.body.razorpay.order_id);
  assert.equal(await stock('VRT-MS-TEA'), held);
  const wrongToken = await handleCheckout(body([{ sku: 'VRT-MS-TEA', qty: 1 }], { resume: { order_id: first.body.order_id, access_token: '00000000-0000-0000-0000-000000000000' } }), deps);
  assert.notEqual(wrongToken.body.order_id, first.body.order_id);
});

test('if Razorpay is down the hold is released at once', async () => {
  const before = await stock('VRT-MS-MAR');
  fake.failNext();
  const r = await handleCheckout(body([{ sku: 'VRT-MS-MAR', qty: 1 }]), deps);
  assert.equal(r.status, 502);
  assert.equal(await stock('VRT-MS-MAR'), before);
});

test('cart problems come back with a fresh quote', async () => {
  const r = await handleCheckout(body([{ sku: 'VRT-SL-MUS', qty: 1 }]), deps);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'cart');
  assert.equal(r.body.quote.problems[0].kind, 'insufficient');
  assert.equal((await handleCheckout(body([]), deps)).body.error, 'bad_items');
  assert.equal((await handleCheckout(body([{ sku: 'VRT-LP-CRI', qty: 1 }]), { ...deps, rzp: null })).body.error, 'payments_not_configured');
});

test('cash on delivery works without Razorpay', async () => {
  await db.exec('update settings set cod_enabled = true, cod_fee = 49, cod_max = 5000');
  const r = await handleCheckout(body([{ sku: 'VRT-SL-BLA', qty: 1 }], { method: 'cod' }), { ...deps, rzp: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.method, 'cod');
  assert.equal((await order(r.body.order_id)).payment_status, 'cod');
});

test('owner refunds and cancels; staff cannot', async () => {
  const r = await handleCheckout(body([{ sku: 'VRT-LP-BLA', qty: 2 }]), deps);
  await handleVerify(await signed(fake.pay(r.body.razorpay.order_id)), deps);
  const id = r.body.order_id;
  assert.equal((await handleAdminOrder({ order_id: id, action: 'refund', amount: 100 }, { ...deps, role: 'staff' })).status, 403);
  const part = await handleAdminOrder({ order_id: id, action: 'refund', amount: 500, reason: 'Scuffed corner' }, { ...deps, role: 'owner', actor: USERS.owner });
  assert.equal(part.status, 200);
  assert.equal(fake.refunds.at(-1).amount, 50000);
  assert.equal((await order(id)).payment_status, 'partially_refunded');
  assert.equal((await handleAdminOrder({ order_id: id, action: 'refund', amount: 999999 }, { ...deps, role: 'owner' })).body.error, 'bad_amount');
  const before = await stock('VRT-LP-BLA');
  const cancel = await handleAdminOrder({ order_id: id, action: 'cancel', reason: 'Customer changed mind' }, { ...deps, role: 'owner', actor: USERS.owner });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.refunded, 4998 - 500);
  const o = await order(id);
  assert.equal(o.status, 'Cancelled');
  assert.equal(o.payment_status, 'refunded');
  assert.equal(await stock('VRT-LP-BLA'), before + 2);
  assert.equal((await handleAdminOrder({ order_id: id, action: 'cancel' }, { ...deps, role: 'owner' })).body.error, 'cannot_cancel');
});

test('cancelling an unpaid cash order restocks without a refund', async () => {
  const r = await handleCheckout(body([{ sku: 'VRT-SL-FOR', qty: 1 }], { method: 'cod' }), deps);
  const before = await stock('VRT-SL-FOR');
  const c = await handleAdminOrder({ order_id: r.body.order_id, action: 'cancel' }, { ...deps, role: 'owner' });
  assert.equal(c.body.refunded, 0);
  assert.equal(await stock('VRT-SL-FOR'), before + 1);
  assert.equal((await order(r.body.order_id)).payment_status, 'cancelled');
  assert.equal((await handleAdminOrder({ order_id: r.body.order_id, action: 'refund', amount: 1 }, { ...deps, role: 'owner' })).body.error, 'not_refundable_online');
});
