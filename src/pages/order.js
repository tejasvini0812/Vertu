import '../styles.css';
import '../pages.css';
import { bySku, fmt } from '../data.js';
import { mountChrome } from '../chrome.js';
import { customer, customerReady, accountsEnabled } from '../customer.js';
import { LIVE, supabase } from '../lib/supabase.js';
import { getState } from '../store.js';
import { esc, $ } from './ui.js';

mountChrome();
const main = $('#main');
const q = new URLSearchParams(location.search);
const id = q.get('id');
const token = q.get('t');
await customerReady;

const STEPS = ['Pending', 'Processing', 'Shipped', 'Delivered'];
const STEP_LABEL = { Pending: 'Order placed', Processing: 'Being packed', Shipped: 'On the way', Delivered: 'Delivered' };

async function load() {
  if (!LIVE) {
    const o = getState().orders.find((x) => x.id === id);
    if (!o) return null;
    return {
      id: o.id, created_at: o.createdAt, status: o.status, payment_status: o.paymentStatus || 'paid', payment_method: o.paymentMethod,
      name: o.customer.name, email: o.customer.email, city: o.customer.city, pin: o.customer.pin,
      subtotal: o.subtotal ?? o.total, discount: o.discount || 0, shipping: o.shipping || 0, cod_fee: o.codFee || 0, total: o.total, refunded_amount: o.refunded || 0,
      lines: o.lines,
    };
  }
  if (!id || !token) return null;
  const { data, error } = await supabase.rpc('order_lookup', { p_id: id, p_token: token });
  if (error) throw error;
  return data;
}

function headline(o) {
  const first = esc((o.name || '').split(' ')[0]);
  switch (o.payment_status) {
    case 'paid':
    case 'partially_refunded':
      return [`Thank you${first ? `, ${first}` : ''}.`, 'Your payment is confirmed and we’re getting your order ready.'];
    case 'cod':
      return [`Thank you${first ? `, ${first}` : ''}.`, `Your order is confirmed. Please keep ${fmt(o.total)} ready for the courier.`];
    case 'awaiting':
      return ['Confirming your payment…', 'This usually takes a few seconds. You can keep this page open.'];
    case 'refunded':
      return ['This order was refunded.', 'The money is on its way back to your original payment method (usually 5–7 working days).'];
    case 'expired':
    case 'failed':
    case 'cancelled':
      return ['This order wasn’t completed.', 'No payment was taken, or it has been cancelled. Your items were released. You can order again any time.'];
    default:
      return ['Your order', ''];
  }
}

function render(o) {
  const [h, sub] = headline(o);
  const at = STEPS.indexOf(o.status);
  const live = ['paid', 'cod', 'partially_refunded'].includes(o.payment_status) && o.status !== 'Cancelled';
  document.title = `${o.id} | VERTU`;
  main.innerHTML = `
    <div class="confirm">
      <p class="confirm__id">Order ${esc(o.id)}</p>
      <h1 class="page-title">${h}</h1>
      <p class="lede">${sub}</p>
      ${live ? `<ol class="steps" aria-label="Status: ${esc(STEP_LABEL[o.status])}">${STEPS.map((s, i) => `<li class="${i <= at ? 'is-done' : ''}">${STEP_LABEL[s]}</li>`).join('')}</ol>` : ''}
      <div class="confirm__grid">
        <section><h2>Items</h2>
          <ul class="order__lines">${o.lines.map((l) => `<li><span>${esc(l.colour)} ${esc(bySku(l.sku)?.product.name || l.category)} <em>× ${l.qty}</em></span><span>${fmt(l.price * l.qty)}</span></li>`).join('')}</ul>
          <dl class="summary__totals">
            <div><dt>Subtotal</dt><dd>${fmt(o.subtotal ?? o.total)}</dd></div>
            ${o.discount ? `<div><dt>Discount</dt><dd>−${fmt(o.discount)}</dd></div>` : ''}
            <div><dt>Shipping</dt><dd>${o.shipping ? fmt(o.shipping) : 'Free'}</dd></div>
            ${o.cod_fee ? `<div><dt>Cash on delivery fee</dt><dd>${fmt(o.cod_fee)}</dd></div>` : ''}
            <div class="summary__total"><dt>${o.payment_status === 'cod' ? 'To pay on delivery' : 'Total'}</dt><dd>${fmt(o.total)}</dd></div>
            ${o.refunded_amount ? `<div><dt>Refunded</dt><dd>${fmt(o.refunded_amount)}</dd></div>` : ''}
          </dl></section>
        <section><h2>Delivery</h2>
          <p>${esc(o.name)}<br>${esc(o.city)} ${esc(o.pin)}</p>
          <p class="fine" style="margin-top:14px">Updates go to ${esc(o.email)}.</p>
          ${
            accountsEnabled && !customer.user
              ? `<p style="margin-top:22px"><a class="text-link" href="../account/">Sign in with ${esc(o.email)}</a> to see this order in your account.</p>`
              : accountsEnabled
                ? '<p style="margin-top:22px"><a class="text-link" href="../account/#orders">See your orders</a></p>'
                : ''
          }
          <p class="fine" style="margin-top:14px">Bookmark this page to check on your order. Questions? <a class="text-link" href="mailto:contact.shopvertu@gmail.com?subject=${encodeURIComponent('Order ' + o.id)}">Write to us</a>.</p>
        </section>
      </div>
      <a class="btn btn--ghost" href="../shop/" style="margin-top:40px">Continue shopping</a>
    </div>`;
}

let tries = 0;
async function run() {
  let o;
  try {
    o = await load();
  } catch (e) {
    main.innerHTML = `<div class="empty-state"><h1 class="page-title">We couldn’t load this order.</h1><p>Check your connection and refresh. If you paid, your payment is safe.</p></div>`;
    return;
  }
  if (!o) {
    main.innerHTML = `<div class="empty-state"><h1 class="page-title">Order not found.</h1><p>The link may be incomplete. Your order confirmation link contains everything needed.</p><a class="btn btn--ink" href="../shop/">Go to the shop</a></div>`;
    return;
  }
  render(o);
  // waiting on Razorpay's confirmation (webhook): check again for up to two minutes
  if (o.payment_status === 'awaiting' && tries++ < 40) setTimeout(run, 3000);
}
run();
