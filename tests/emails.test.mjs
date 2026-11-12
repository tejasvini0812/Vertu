// Email templates and the sender, against the real outbox in PGlite.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeDb, serviceRpc } from '../supabase/tests/db.mjs';
import { render, KINDS, handleSendEmails, resendSender } from '../supabase/functions/_shared/emails.js';

const cfg = { siteUrl: 'https://vertu.example/', supportEmail: 'help@vertu.example', functionsUrl: 'https://ref.supabase.co/functions/v1' };
const order = {
  order_id: 'VRT-10501', token: '5f0c1c0e-1111-4222-8333-944444444444', name: 'Asha <b>Rao</b>', email: 'asha@example.com', phone: '+919876543210',
  payment_method: 'razorpay', payment_status: 'paid', subtotal: 4298, discount: 429, shipping: 0, cod_fee: 0, total: 3869, coupon: 'WELCOME10', refunded_amount: 0,
  address: { line: '14 Park Avenue', city: 'New Delhi', state: 'Delhi', pin: '110016' },
  courier: 'Delhivery', tracking_number: 'DL123', tracking_url: 'https://track.example/DL123',
  lines: [{ sku: 'VRT-SL-COB', name: 'Sling Bag', colour: 'Cobalt', price: 1799, qty: 1 }, { sku: 'VRT-LP-CRI', name: 'Laptop Bag', colour: 'Crimson', price: 2499, qty: 1 }],
};
export const SAMPLES = {
  order_confirmed: order,
  order_shipped: order,
  order_delivered: order,
  order_cancelled: { ...order, refunded_amount: 3869 },
  order_refunded: { ...order, refund: 500 },
  back_in_stock: { sku: 'VRT-SL-MUS', category: 'sling', name: 'Sling Bag', colour: 'Mustard', price: 1799, stock: 3 },
  abandoned_cart: { name: 'Asha Rao', items: order.lines, unsubscribe: '9f0c1c0e-1111-4222-8333-944444444444' },
  newsletter_confirm: { token: '7f0c1c0e-1111-4222-8333-944444444444' },
  admin_new_order: { ...order, payment_method: 'cod', payment_status: 'cod', cod_fee: 49, total: 3918 },
  admin_attention: { ...order, flag: 'paid_after_hold_out_of_stock: VRT-LP-MUS' },
  order_out_for_delivery: { ...order, payment_method: 'cod', payment_status: 'cod' },
  return_requested: { ...order, return_items: [order.lines[0]], reason: 'damaged', details: 'Strap came loose', admin_note: '' },
  return_approved: { ...order, return_items: [order.lines[0]], admin_note: 'Sorry about that. A courier will collect it on Monday.' },
  return_rejected: { ...order, return_items: [order.lines[0]], admin_note: 'The return window had closed.' },
  admin_return: { ...order, return_items: [order.lines[0]], reason: 'damaged', details: 'Strap came loose' },
  admin_low_stock: { sku: 'VRT-LP-COB', name: 'Laptop Bag', colour: 'Cobalt', stock: 3, threshold: 5 },
};

test('every kind renders cleanly (no undefined/NaN/null, escaped, both formats)', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...KINDS].sort());
  const previews = [];
  for (const k of KINDS) {
    const e = render(k, SAMPLES[k], cfg);
    for (const part of [e.subject, e.html, e.text]) {
      assert.ok(part && part.length > 10, `${k} empty`);
      assert.doesNotMatch(part, /undefined|NaN|\[object Object\]|>null</, `${k} has a bad value`);
    }
    assert.doesNotMatch(e.html, /<b>Rao<\/b>/, `${k} must escape names`);
    assert.match(e.html, /https:\/\/vertu\.example\/email\/logo\.png/);
    assert.doesNotMatch(e.html, /vertu\.example\/\//, `${k} double slash`);
    previews.push(`<section style="margin:0 0 60px"><h2 style="font:600 14px system-ui;color:#5c5852;margin:0 0 4px">${k}</h2><p style="font:15px system-ui;margin:0 0 12px"><b>${e.subject}</b></p><iframe style="width:640px;height:900px;border:1px solid #d6d2c9;background:#fff" srcdoc="${e.html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></section>`);
  }
  mkdirSync('email-previews', { recursive: true });
  writeFileSync('email-previews/index.html', `<!doctype html><meta charset="utf-8"><title>VERTU email previews</title><body style="margin:40px;background:#ebe8e1">${previews.join('')}</body>`);
});

test('order emails link to the private order page and show the right money', () => {
  const c = render('order_confirmed', order, cfg);
  assert.equal(c.subject, 'Order VRT-10501 confirmed');
  assert.match(c.html, /https:\/\/vertu\.example\/order\/\?id=VRT-10501&amp;t=5f0c1c0e/);
  assert.match(c.html, /₹3,869/);
  assert.match(c.html, /WELCOME10/);
  const cod = render('order_confirmed', { ...order, payment_method: 'cod', payment_status: 'cod' }, cfg);
  assert.match(cod.html, /To pay on delivery/);
  const s = render('order_shipped', order, cfg);
  assert.match(s.html, /Track your parcel/);
  assert.match(s.html, /track\.example\/DL123/);
  const s2 = render('order_shipped', { ...order, courier: null, tracking_number: null, tracking_url: null }, cfg);
  assert.match(s2.html, /View your order/);
  assert.match(render('order_cancelled', { ...order, refunded_amount: 0, payment_method: 'cod' }, cfg).text, /nothing to pay/);
});

test('marketing email has unsubscribe link and one-click headers; transactional ones do not', () => {
  const a = render('abandoned_cart', SAMPLES.abandoned_cart, cfg);
  assert.match(a.html, /newsletter\/\?unsubscribe=9f0c1c0e/);
  assert.equal(a.headers['List-Unsubscribe'], '<https://ref.supabase.co/functions/v1/email-unsubscribe?t=9f0c1c0e-1111-4222-8333-944444444444>');
  assert.equal(a.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.deepEqual(render('order_confirmed', order, cfg).headers, {});
  assert.match(render('back_in_stock', SAMPLES.back_in_stock, cfg).html, /product\/\?c=sling&amp;colour=mustard/);
});

test('resend client posts the email with an idempotency key', async () => {
  const calls = [];
  const send = resendSender('re_key', async (url, init) => (calls.push({ url, init }), new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })));
  assert.equal(await send({ from: 'VERTU <o@v.in>', to: 'a@b.co', subject: 's', html: 'h', text: 't', idempotencyKey: 'vertu-email-9' }), 'em_1');
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_key');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'vertu-email-9');
  assert.deepEqual(JSON.parse(calls[0].init.body).to, ['a@b.co']);
  const bad = resendSender('re_key', async () => new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 }));
  await assert.rejects(bad({ to: 'a@b.co' }), /Domain not verified/);
});

let db, rpc;
before(async () => {
  db = await makeDb();
  rpc = serviceRpc(db);
  await db.exec(`update settings set notify_email = 'store@vertu.test', cod_enabled = true`);
});

test('sender: auth, configuration, sending, retrying', async () => {
  const mk = (items) => rpc('create_order', { p_items: items, p_coupon: null, p_method: 'cod', p_contact: { email: 'buyer@example.com', phone: '+919876543210' }, p_address: { full_name: 'Buyer', line1: '1 Road', city: 'Pune', state: 'Maharashtra', pin: '411001' }, p_user: null });
  await mk([{ sku: 'VRT-LP-CRI', qty: 1 }]);
  await mk([{ sku: 'VRT-SL-COB', qty: 1 }]);
  const sent = [];
  let failNext = 0;
  const deps = {
    rpc, from: 'VERTU <orders@vertu.example>', siteUrl: 'https://vertu.example', cronSecret: 'cron-secret', supportEmail: 'help@vertu.example',
    send: async (m) => { if (failNext > 0) { failNext--; throw new Error('Resend down'); } sent.push(m); return `em_${sent.length}`; },
  };
  assert.equal((await handleSendEmails('wrong', deps)).status, 401);
  assert.equal((await handleSendEmails('cron-secret', { ...deps, send: null })).status, 503);
  failNext = 1;
  const r = await handleSendEmails('cron-secret', deps);
  assert.deepEqual(r.body, { sent: 3, failed: 1 });
  assert.ok(sent.every((m) => m.from === 'VERTU <orders@vertu.example>' && /^vertu-email-\d+$/.test(m.idempotencyKey)));
  assert.deepEqual(sent.map((m) => m.to).sort(), ['buyer@example.com', 'store@vertu.test', 'store@vertu.test']);
  const rows = (await db.query(`select status, provider_id, last_error from email_outbox order by id`)).rows;
  assert.equal(rows.filter((x) => x.status === 'sent').length, 3);
  assert.equal(rows.find((x) => x.status === 'pending').last_error, 'Resend down');
  // the failed one waits for its backoff, so an immediate rerun sends nothing
  assert.deepEqual((await handleSendEmails('cron-secret', deps)).body, { sent: 0, failed: 0 });
  await db.exec(`update email_outbox set send_after = now() where status = 'pending'`);
  assert.deepEqual((await handleSendEmails('cron-secret', deps)).body, { sent: 1, failed: 0 });
});
