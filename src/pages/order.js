import '../monitor.js';
import '../styles.css';
import '../pages.css';
import { bySku, fmt } from '../data.js';
import { mountChrome } from '../chrome.js';
import { customer, customerReady, accountsEnabled } from '../customer.js';
import { LIVE, supabase } from '../lib/supabase.js';
import { getState } from '../store.js';
import { track } from '../analytics.js';
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
  const live = ['paid', 'cod', 'partially_refunded'].includes(o.payment_status) && o.status !== 'Cancelled';
  if (live && o.status === 'Delivered') return ['Delivered.', 'We hope it’s everything you wanted. If anything isn’t right, you can ask for a return below.'];
  if (live && o.status === 'Shipped') return ['It’s on its way.', o.payment_status === 'cod' ? `Please keep ${fmt(o.total)} ready for the courier.` : 'Follow it with the courier below.'];
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

function trackPurchase(o) {
  const key = `vertu.tracked.${o.id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch (_) {
    return; // without storage we can't avoid double counting on reloads, so don't count
  }
  track('purchase', {
    order_id: o.id,
    value: o.total,
    coupon: o.coupon_code || undefined,
    items: o.lines.map((l) => ({ sku: l.sku, name: bySku(l.sku)?.product.name || l.category, colour: l.colour, price: l.price, qty: l.qty })),
  });
}

function render(o) {
  const [h, sub] = headline(o);
  const at = STEPS.indexOf(o.status);
  const live = ['paid', 'cod', 'partially_refunded'].includes(o.payment_status) && o.status !== 'Cancelled';
  if (live && Date.now() - new Date(o.created_at).getTime() < 864e5) trackPurchase(o);
  document.title = `${o.id} | VERTU`;
  main.innerHTML = `
    <div class="confirm">
      <p class="confirm__id">Order ${esc(o.id)}</p>
      <h1 class="page-title">${h}</h1>
      <p class="lede">${sub}</p>
      ${live ? `<ol class="steps" aria-label="Status: ${esc(STEP_LABEL[o.status])}">${STEPS.map((s, i) => `<li class="${i <= at ? 'is-done' : ''}">${STEP_LABEL[s]}</li>`).join('')}</ol>` : ''}
      ${shippingBlock(o)}
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
          ${o.invoice ? `<p style="margin-top:18px"><a class="text-link" href="../invoice/?id=${encodeURIComponent(o.id)}&t=${encodeURIComponent(token)}">Download invoice ${esc(o.invoice)}</a></p>` : ''}
          <p class="fine" style="margin-top:14px">Bookmark this page to check on your order. Questions? <a class="text-link" href="mailto:contact.shopvertu@gmail.com?subject=${encodeURIComponent('Order ' + o.id)}">Write to us</a>.</p>
        </section>
      </div>
      <section class="returns" data-returns></section>
      <a class="btn btn--ghost" href="../shop/" style="margin-top:40px">Continue shopping</a>
    </div>`;
  if (LIVE && token) returnsBlock(o);
}

function shippingBlock(o) {
  if (!o.courier && !(o.events || []).length && !o.eta) return '';
  const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `<div class="shipbox">
    <p>${o.courier ? `With <strong>${esc(o.courier)}</strong>` : 'Shipping'}${o.tracking_number ? `, tracking number <strong>${esc(o.tracking_number)}</strong>` : ''}${o.eta && o.status !== 'Delivered' ? `. Expected by <strong>${new Date(o.eta).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>` : ''}.
    ${o.tracking_url ? ` <a class="text-link" href="${esc(o.tracking_url)}" target="_blank" rel="noopener">Track with the courier</a>` : ''}</p>
    ${(o.events || []).length ? `<details><summary>Tracking history</summary><ul class="history">${o.events.map((e) => `<li><span>${esc(e.status.charAt(0) + e.status.slice(1).toLowerCase())}${e.location ? `, ${esc(e.location)}` : ''}</span><span class="muted">${when(e.at)}</span></li>`).join('')}</ul></details>` : ''}
  </div>`;
}

const REASONS = { damaged: 'It arrived damaged', wrong_item: 'I received the wrong item', not_as_described: 'It isn’t as described', changed_mind: 'I changed my mind', other: 'Something else' };
const RSTATUS = { requested: 'Requested, we’ll reply within two working days', approved: 'Approved, a courier will collect it', rejected: 'Not accepted', pickup_scheduled: 'Pickup booked', in_transit: 'On its way back to us', arrived: 'Arrived with us, being checked', received: 'Checked, refund on its way', refunded: 'Refunded', closed: 'Closed' };

async function returnsBlock(o) {
  const box = $('[data-returns]', main);
  const { data: list } = await supabase.rpc('order_returns', { p_id: o.id, p_token: token });
  const open = o.status === 'Delivered' && o.return_until && new Date(o.return_until) > new Date();
  const returned = {};
  (list || []).filter((r) => r.status !== 'rejected').forEach((r) => r.items.forEach((i) => (returned[i.sku] = (returned[i.sku] || 0) + i.qty)));
  const left = o.lines.map((l) => ({ ...l, max: l.qty - (returned[l.sku] || 0) })).filter((l) => l.max > 0);
  if (!(list || []).length && !open) return;
  box.innerHTML = `<h2>Returns</h2>
    ${(list || []).map((r) => `<p class="ret"><strong>${r.items.map((i) => `${i.qty} × ${esc(o.lines.find((l) => l.sku === i.sku)?.colour || i.sku)}`).join(', ')}</strong>: ${esc(RSTATUS[r.status] || r.status)}${r.admin_note ? `<br><span class="fine">${esc(r.admin_note)}</span>` : ''}</p>`).join('')}
    ${
      open && left.length
        ? `<p class="fine">You can ask to return items until ${new Date(o.return_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.</p>
      <button class="btn btn--ghost" type="button" data-ret-open>Request a return</button>
      <form class="ret-form" data-ret-form hidden novalidate>
        ${left.map((l) => `<label class="ret-line"><span>${esc(l.colour)} ${esc(bySku(l.sku)?.product.name || l.category)}</span>
          <select class="select" data-sku="${esc(l.sku)}" aria-label="How many ${esc(l.colour)} to return"><option value="0">Keep</option>${Array.from({ length: l.max }, (_, i) => `<option value="${i + 1}">Return ${i + 1}</option>`).join('')}</select></label>`).join('')}
        <div class="field"><label for="ret-why">Why are you returning it?</label><select class="select" id="ret-why"><option value="">Choose…</option>${Object.entries(REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label for="ret-more">Anything we should know? <span class="fine">(optional)</span></label><textarea class="input" id="ret-more" rows="3" maxlength="1000" style="height:auto;padding:12px 14px"></textarea></div>
        <p class="err" data-ret-err role="alert"></p>
        <button class="btn btn--ink" type="submit">Send request</button>
      </form>`
        : ''
    }`;
  box.querySelector('[data-ret-open]')?.addEventListener('click', (e) => {
    e.currentTarget.hidden = true;
    box.querySelector('[data-ret-form]').hidden = false;
  });
  box.querySelector('[data-ret-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = f.querySelector('[data-ret-err]');
    const items = [...f.querySelectorAll('[data-sku]')].map((s) => ({ sku: s.dataset.sku, qty: Number(s.value) })).filter((i) => i.qty > 0);
    const reason = f.querySelector('#ret-why').value;
    if (!items.length) return (err.textContent = 'Choose at least one item to return.');
    if (!reason) return (err.textContent = 'Tell us why you’re returning it.');
    f.querySelector('button[type=submit]').disabled = true;
    const { data, error } = await supabase.rpc('request_return', { p_order: o.id, p_token: token, p_items: items, p_reason: reason, p_details: f.querySelector('#ret-more').value.trim() });
    if (error || !data?.ok) {
      f.querySelector('button[type=submit]').disabled = false;
      return (err.textContent = { window_closed: 'The return window for this order has closed.', not_delivered: 'Returns open once the order is delivered.', bad_items: 'Those items can’t be returned (perhaps already requested).' }[data?.error] || 'That didn’t go through. Please try again.');
    }
    returnsBlock({ ...o });
  });
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
