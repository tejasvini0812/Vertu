// Payment logic shared by the Edge Functions. Plain JavaScript with injected dependencies, so it runs
// the same in Deno (Supabase Edge Functions) and in Node (our tests, against a real Postgres).
//
// deps:
//   rpc(name, args)      -> calls a database function with the service role, returns its value
//   getOrder(id)         -> the raw orders row (service role) or null
//   rzp                  -> razorpayClient(...) or null when Razorpay keys are not configured
//   keyId                -> public Razorpay key id (sent to the browser)
//   keySecret            -> Razorpay key secret (signature checks)
//   webhookSecret        -> Razorpay webhook secret
//   user                 -> { id, email } of the signed-in shopper, or null
//   role                 -> 'owner' | 'staff' | null for admin calls (two-step verified sessions only)
//   now                  -> () => Date

const enc = new TextEncoder();

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (both are hex strings of the same expected length). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** Razorpay Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }, keySecret) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !keySecret) return false;
  return safeEqual(await hmacHex(keySecret, `${razorpay_order_id}|${razorpay_payment_id}`), razorpay_signature);
}

/** Webhooks: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook secret). */
export async function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (!rawBody || !signature || !webhookSecret) return false;
  return safeEqual(await hmacHex(webhookSecret, rawBody), signature);
}

export function razorpayClient(keyId, keySecret, fetchImpl = fetch) {
  if (!keyId || !keySecret) return null;
  const auth = 'Basic ' + btoa(`${keyId}:${keySecret}`);
  const call = async (method, path, body) => {
    const res = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json?.error?.description || `Razorpay responded ${res.status}`);
      err.status = res.status;
      err.code = 'razorpay';
      throw err;
    }
    return json;
  };
  return {
    createOrder: (b) => call('POST', '/orders', b),
    fetchPayment: (id) => call('GET', `/payments/${encodeURIComponent(id)}`),
    capture: (id, amount) => call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency: 'INR' }),
    refund: (id, amount, notes) => call('POST', `/payments/${encodeURIComponent(id)}/refund`, { amount, notes }),
  };
}

const reply = (status, body) => ({ status, body });
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 20) return null;
  return items.map((i) => ({ sku: str(i?.sku, 40), qty: Number.isInteger(i?.qty) ? i.qty : Number.parseInt(i?.qty, 10) || 0 }));
}

function checkoutPayload(order, rzpOrderId, deps, contact, name) {
  return {
    order_id: order.order_id,
    access_token: order.access_token,
    method: 'razorpay',
    total: order.total,
    razorpay: {
      key: deps.keyId,
      order_id: rzpOrderId,
      amount: order.total * 100,
      currency: 'INR',
      name: 'VERTU',
      description: `Order ${order.order_id}`,
      prefill: { name, email: contact.email, contact: contact.phone },
      notes: { order_id: order.order_id },
    },
  };
}

/** POST /checkout  { items, coupon, method, contact, address, resume? } */
export async function handleCheckout(body, deps) {
  const items = cleanItems(body?.items);
  if (!items) return reply(400, { error: 'bad_items' });
  const method = body?.method === 'cod' ? 'cod' : 'razorpay';
  const contact = { email: str(body?.contact?.email, 254), phone: str(body?.contact?.phone, 16), note: str(body?.contact?.note, 500) };
  const a = body?.address || {};
  const address = { full_name: str(a.full_name, 120), line1: str(a.line1, 200), line2: str(a.line2, 200), city: str(a.city, 80), state: str(a.state, 60), pin: str(a.pin, 6) };
  const now = deps.now ? deps.now() : new Date();

  if (method === 'razorpay' && !deps.rzp) return reply(503, { error: 'payments_not_configured' });

  // Retrying after closing the payment window: reuse the order (and its stock hold) if it's still open.
  const r = body?.resume;
  if (method === 'razorpay' && r?.order_id && r?.access_token) {
    const o = await deps.getOrder(str(r.order_id, 20));
    if (o && o.access_token === r.access_token && o.payment_status === 'awaiting' && o.razorpay_order_id && new Date(o.expires_at) > now) {
      return reply(200, checkoutPayload({ order_id: o.id, access_token: o.access_token, total: o.total }, o.razorpay_order_id, deps, { email: o.customer_email, phone: o.customer_phone }, o.customer_name));
    }
  }

  const created = await deps.rpc('create_order', {
    p_items: items,
    p_coupon: str(body?.coupon, 24) || null,
    p_method: method,
    p_contact: contact,
    p_address: address,
    p_user: deps.user?.id ?? null,
  });
  if (!created?.ok) return reply(409, { error: created?.error || 'failed', quote: created?.quote });
  if (method === 'cod') return reply(200, { order_id: created.order_id, access_token: created.access_token, method: 'cod', total: created.total });

  let rzpOrder;
  try {
    rzpOrder = await deps.rzp.createOrder({
      amount: created.total * 100,
      currency: 'INR',
      receipt: created.order_id,
      notes: { order_id: created.order_id },
    });
  } catch (e) {
    // give the stock straight back; the shopper can try again
    await deps.rpc('settle_cancel_refund', { p_order: created.order_id, p_refund_paise: 0, p_refund_id: null, p_restock: true, p_cancel: true, p_actor: null, p_reason: 'Payment provider unavailable' });
    return reply(502, { error: 'payment_provider' });
  }
  await deps.rpc('attach_razorpay_order', { p_order: created.order_id, p_rzp_order: rzpOrder.id });
  return reply(200, checkoutPayload(created, rzpOrder.id, deps, contact, address.full_name));
}

/** POST /payment-verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature } from Razorpay Checkout */
export async function handleVerify(body, deps) {
  if (!(await verifyPaymentSignature(body || {}, deps.keySecret))) return reply(400, { error: 'bad_signature' });
  const pay = await deps.rzp.fetchPayment(body.razorpay_payment_id);
  if (pay.order_id !== body.razorpay_order_id) return reply(400, { error: 'order_mismatch' });
  if (pay.status === 'authorized') await deps.rzp.capture(pay.id, pay.amount);
  else if (pay.status !== 'captured') return reply(409, { error: 'not_captured', status: pay.status });
  const r = await deps.rpc('mark_order_paid', { p_rzp_order: pay.order_id, p_payment: pay.id, p_amount_paise: pay.amount });
  if (!r?.ok) return reply(409, { error: r?.error || 'failed' });
  return reply(200, { order_id: r.order_id, paid: true });
}

/** POST /razorpay-webhook  (raw body + X-Razorpay-Signature). Always answer 200 once handled, so Razorpay stops retrying. */
export async function handleWebhook(rawBody, signature, deps) {
  if (!(await verifyWebhookSignature(rawBody, signature, deps.webhookSecret))) return reply(400, { error: 'bad_signature' });
  let evt;
  try {
    evt = JSON.parse(rawBody);
  } catch (e) {
    return reply(400, { error: 'bad_json' });
  }
  const pay = evt?.payload?.payment?.entity;
  switch (evt?.event) {
    case 'payment.captured':
    case 'order.paid': {
      if (!pay?.order_id) return reply(200, { ignored: true });
      const r = await deps.rpc('mark_order_paid', { p_rzp_order: pay.order_id, p_payment: pay.id, p_amount_paise: pay.amount });
      return reply(200, { handled: evt.event, result: r });
    }
    case 'payment.failed': {
      if (!pay?.order_id) return reply(200, { ignored: true });
      const r = await deps.rpc('mark_order_failed', { p_rzp_order: pay.order_id, p_reason: str(pay.error_description || pay.error_reason || '', 200) });
      return reply(200, { handled: evt.event, result: r });
    }
    default:
      return reply(200, { ignored: evt?.event || 'unknown' });
  }
}

/** POST /admin-order  { order_id, action: 'cancel' | 'refund', amount?, restock?, reason? }  (owners only) */
export async function handleAdminOrder(body, deps) {
  if (deps.role !== 'owner') return reply(403, { error: 'owners_only' });
  const o = await deps.getOrder(str(body?.order_id, 20));
  if (!o) return reply(404, { error: 'unknown_order' });
  const reason = str(body?.reason, 200);
  const remaining = (o.total || 0) - (o.refunded_amount || 0);
  const online = o.payment_method === 'razorpay' && o.razorpay_payment_id && ['paid', 'partially_refunded'].includes(o.payment_status);

  if (body?.action === 'cancel') {
    if (['Shipped', 'Delivered', 'Cancelled'].includes(o.status)) return reply(409, { error: 'cannot_cancel', status: o.status });
    let refund = null;
    if (online && remaining > 0) refund = await deps.rzp.refund(o.razorpay_payment_id, remaining * 100, { order_id: o.id, reason });
    const r = await deps.rpc('settle_cancel_refund', {
      p_order: o.id, p_refund_paise: refund ? remaining * 100 : 0, p_refund_id: refund?.id ?? null,
      p_restock: true, p_cancel: true, p_actor: deps.actor ?? null, p_reason: reason || 'Cancelled',
    });
    return r?.ok ? reply(200, { ...r, refunded: refund ? remaining : 0 }) : reply(409, r);
  }

  if (body?.action === 'refund') {
    if (!online) return reply(409, { error: 'not_refundable_online' });
    const amount = Number.parseInt(body?.amount, 10);
    if (!(amount > 0) || amount > remaining) return reply(400, { error: 'bad_amount', remaining });
    const refund = await deps.rzp.refund(o.razorpay_payment_id, amount * 100, { order_id: o.id, reason });
    const r = await deps.rpc('settle_cancel_refund', {
      p_order: o.id, p_refund_paise: amount * 100, p_refund_id: refund.id, p_restock: !!body?.restock,
      p_cancel: false, p_actor: deps.actor ?? null, p_reason: reason || 'Refund',
    });
    return r?.ok ? reply(200, { ...r, refunded: amount }) : reply(409, r);
  }
  return reply(400, { error: 'bad_action' });
}
