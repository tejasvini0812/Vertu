import { getState, update, describeError, money, orderTotal, countsAsSale, STATUSES, CATEGORIES, LIVE, callFunction, refresh, supabase } from '../store.js';
import { session } from './auth.js';
import { esc, $, $$, toast, openDrawer, drawerEl, enter, listen, confirmDialog } from './ui.js';
import { fmtDate, fmtDateTime, statusChip } from './overview.js';

let filter = 'All';
let q = '';
const catName = (id) => CATEGORIES.find((c) => c.id === id)?.name || id;

export const PAY = {
  paid: ['Paid', 'pay-ok'],
  cod: ['Cash due', 'pay-due'],
  awaiting: ['Awaiting payment', 'pay-wait'],
  failed: ['Payment failed', 'pay-off'],
  expired: ['Not paid', 'pay-off'],
  cancelled: ['Cancelled', 'pay-off'],
  refunded: ['Refunded', 'pay-off'],
  partially_refunded: ['Part refunded', 'pay-due'],
};
const payChip = (o) => {
  const [label, cls] = PAY[o.paymentStatus || 'paid'] || [o.paymentStatus, ''];
  return `<span class="pay ${cls}">${label}${o.paymentMethod === 'cod' && o.paymentStatus === 'paid' ? ' (cash)' : ''}</span>`;
};
const movable = (o) => countsAsSale(o) && o.status !== 'Cancelled';

const seg = (o) =>
  movable(o)
    ? `<div class="seg" role="group" aria-label="Status for ${o.id}">${STATUSES.map((s) => `<button type="button" data-s="${s}" aria-pressed="${o.status === s}">${s}</button>`).join('')}</div>`
    : statusChip(o.status);

function setStatus(id, status) {
  const o = getState().orders.find((x) => x.id === id);
  if (!o || o.status === status) return false;
  try {
    update((s) => {
      const x = s.orders.find((y) => y.id === id);
      x.status = status;
      if (status === 'Delivered' && x.paymentStatus === 'cod') x.paymentStatus = 'paid'; // mirrors the database trigger
    }).catch(() => {});
    toast(`${id} marked ${status.toLowerCase()}`);
    return true;
  } catch (e) {
    toast(describeError(e));
    return false;
  }
}

const TABS = ['All', ...STATUSES, 'Cancelled', 'Unpaid'];
const inTab = (o, t) =>
  t === 'All' ? countsAsSale(o) || o.status === 'Cancelled' && o.paymentStatus !== 'expired'
  : t === 'Unpaid' ? ['awaiting', 'failed', 'expired'].includes(o.paymentStatus)
  : t === 'Cancelled' ? o.status === 'Cancelled' && o.paymentStatus !== 'expired'
  : o.status === t && countsAsSale(o);

export function renderOrders(root, params) {
  const on = listen(root);
  const s = getState();
  const counts = Object.fromEntries(TABS.map((t) => [t, s.orders.filter((o) => inTab(o, t)).length]));
  const rows = s.orders
    .filter((o) => inTab(o, filter))
    .filter((o) => !q || `${o.id} ${o.customer.name} ${o.customer.email} ${o.customer.city}`.toLowerCase().includes(q.toLowerCase()));
  root.innerHTML = `
    <header class="page-head"><div><h1>Orders</h1>
      <p>Move an order along as it is packed and sent. Open one for the customer, payment and refund options.</p></div></header>
    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Order status">
        ${TABS.map((t) => `<button role="tab" data-f="${t}" aria-selected="${filter === t}">${t}<sup>${counts[t]}</sup></button>`).join('')}
      </div>
      <div class="search"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg></span>
        <input class="input" type="search" placeholder="Search name, email or order" aria-label="Search orders" value="${esc(q)}" data-q /></div>
    </div>
    ${filter === 'Unpaid' ? '<p class="muted" style="margin:8px 0 4px">Checkouts that were never paid. Their stock is held for 15 minutes, then released automatically.</p>' : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th class="r">Total</th><th>Payment</th><th>Status</th></tr></thead>
      <tbody>${
        rows.length
          ? rows
              .map(
                (o) => `<tr data-id="${o.id}">
        <td><button class="text-btn order-id" data-open>${o.id}</button>${o.flag ? ' <span class="pill pill--ink" title="Needs a look">!</span>' : ''}</td>
        <td><strong style="font-weight:500">${esc(o.customer.name)}</strong><br><span class="muted" style="font-size:.8125rem">${esc(o.customer.city)}, ${esc(o.customer.state)}</span></td>
        <td class="muted">${fmtDate(o.createdAt)}</td>
        <td class="r num">${money(orderTotal(o))}</td>
        <td>${payChip(o)}</td>
        <td>${seg(o)}</td></tr>`,
              )
              .join('')
          : '<tr><td colspan="6"><p class="empty">No orders here.</p></td></tr>'
      }</tbody></table></div>`;
  enter(root);

  const rerender = () => renderOrders(root, new URLSearchParams());
  $$('[data-f]', root).forEach((b) => b.addEventListener('click', () => ((filter = b.dataset.f), rerender())));
  const qi = $('[data-q]', root);
  qi.addEventListener('input', () => {
    q = qi.value;
    const p = qi.selectionStart;
    rerender();
    const n = $('[data-q]', root);
    n.focus();
    n.setSelectionRange(p, p);
  });
  on('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const sb = e.target.closest('[data-s]');
    if (sb) {
      if (setStatus(tr.dataset.id, sb.dataset.s)) {
        if (filter !== 'All') rerender();
        else $('td:last-child', tr).innerHTML = seg(getState().orders.find((o) => o.id === tr.dataset.id));
        $('td:nth-child(5)', tr).innerHTML = payChip(getState().orders.find((o) => o.id === tr.dataset.id));
      }
    } else if (e.target.closest('[data-open]')) openOrder(tr.dataset.id, rerender);
  });
  const open = params.get('open');
  if (open && getState().orders.some((o) => o.id === open)) {
    history.replaceState(null, '', '#/orders');
    openOrder(open, rerender);
  }
}

function openOrder(id, rerender) {
  const o = getState().orders.find((x) => x.id === id);
  if (!o) return;
  const c = o.customer;
  const owner = session.role === 'owner';
  const remaining = orderTotal(o) - (o.refunded || 0);
  const online = o.paymentMethod === 'razorpay' && ['paid', 'partially_refunded'].includes(o.paymentStatus);
  const canCancel = !['Shipped', 'Delivered', 'Cancelled'].includes(o.status) && !['expired', 'failed'].includes(o.paymentStatus);
  const row = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  const body = `
    ${o.flag ? `<p class="alert-bar" role="alert"><b>Needs a look:</b> ${esc(o.flag.replace(/_/g, ' '))}</p>` : ''}
    <div><p class="label" style="font-weight:500;margin-bottom:10px">Status</p><div data-seg>${seg(o)}</div></div>
    <dl style="margin:0">
      <div class="kv"><dt>Customer</dt><dd>${esc(c.name)}</dd></div>
      <div class="kv"><dt>Email</dt><dd><a class="text-btn" href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd></div>
      <div class="kv"><dt>Phone</dt><dd>${esc(c.phone)}</dd></div>
      <div class="kv"><dt>Ship to</dt><dd>${esc(c.address)}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.pin)}</dd></div>
      ${o.note ? `<div class="kv"><dt>Note</dt><dd>${esc(o.note)}</dd></div>` : ''}
    </dl>
    <div><p class="label" style="font-weight:500;margin-bottom:10px">Items</p>
      <ul class="lines">${o.lines.map((l) => `<li><span>${esc(l.colour)} ${catName(l.category)}<br><em>${l.sku}, qty ${l.qty}</em></span><span class="num">${money(l.price * l.qty)}</span></li>`).join('')}</ul>
      <dl class="money">
        ${row('Subtotal', money(o.subtotal ?? orderTotal(o)))}
        ${o.discount ? row(`Discount${o.coupon ? ` (${esc(o.coupon)})` : ''}`, '−' + money(o.discount)) : ''}
        ${row('Shipping', o.shipping ? money(o.shipping) : 'Free')}
        ${o.codFee ? row('Cash on delivery fee', money(o.codFee)) : ''}
        <div class="money__total"><dt>Total</dt><dd>${money(orderTotal(o))}</dd></div>
        ${o.refunded ? row('Refunded', '−' + money(o.refunded)) : ''}
      </dl></div>
    <div><p class="label" style="font-weight:500;margin-bottom:10px">Payment</p>
      <dl style="margin:0">
        <div class="kv"><dt>Status</dt><dd>${payChip(o)}</dd></div>
        <div class="kv"><dt>Method</dt><dd>${{ razorpay: 'Online (Razorpay)', cod: 'Cash on delivery', manual: 'Recorded by hand' }[o.paymentMethod] || esc(o.paymentMethod)}</dd></div>
        ${o.razorpayPaymentId ? `<div class="kv"><dt>Razorpay payment</dt><dd><code>${esc(o.razorpayPaymentId)}</code></dd></div>` : ''}
        ${o.paidAt ? `<div class="kv"><dt>Paid</dt><dd>${fmtDateTime(o.paidAt)}</dd></div>` : ''}
      </dl></div>
    ${
      countsAsSale(o) && o.status !== 'Cancelled'
        ? `<form class="track" data-track novalidate><p class="label" style="font-weight:500">Shipping details</p>
        <div class="row2"><div class="field"><label for="t-courier">Courier</label><input id="t-courier" class="input" maxlength="60" value="${esc(o.courier || '')}" placeholder="e.g. Delhivery" /></div>
        <div class="field"><label for="t-num">Tracking number</label><input id="t-num" class="input" maxlength="60" value="${esc(o.trackingNumber || '')}" /></div></div>
        <div class="field"><label for="t-url">Tracking link</label><input id="t-url" class="input" type="url" value="${esc(o.trackingUrl || '')}" placeholder="https://" /><small>Add these before marking the order Shipped: the customer’s “on its way” email includes them.</small></div>
        <p class="err" data-track-err role="alert"></p>
        <button class="btn btn--ghost" type="submit" style="justify-self:start">Save shipping details</button></form>`
        : ''
    }
    ${LIVE ? '<div><p class="label" style="font-weight:500;margin-bottom:6px">Emails</p><ul class="history" data-mails><li class="muted">Loading…</li></ul></div>' : ''}
    ${
      owner && (canCancel || (online && remaining > 0))
        ? `<div class="danger-zone"><p class="label" style="font-weight:500">Cancel or refund</p>
        ${online && remaining > 0 ? `<form class="refund" data-refund novalidate>
          <div class="field"><label for="r-amt">Refund amount (₹)</label><input id="r-amt" class="input" type="number" min="1" max="${remaining}" value="${remaining}" /><small>Up to ${money(remaining)}. Goes back to the customer’s original payment method.</small></div>
          <div class="field"><label for="r-why">Reason (kept in the order notes)</label><input id="r-why" class="input" maxlength="200" /></div>
          <label class="switch"><input type="checkbox" id="r-restock"><i></i>Put the items back in stock</label>
          <button class="btn btn--ghost" type="submit">Refund</button></form>` : ''}
        ${canCancel ? `<button class="btn btn--ghost" type="button" data-cancel>Cancel order${online && remaining > 0 ? ` and refund ${money(remaining)}` : ''}</button><small class="muted">Puts the items back in stock.</small>` : ''}
        <p class="err" data-act-err role="alert"></p></div>`
        : ''
    }`;
  openDrawer({ title: o.id, sub: `Placed ${fmtDateTime(o.createdAt)}`, body, foot: '' });
  if (LIVE) loadMails(id, $('[data-mails]', drawerEl));

  $('[data-track]', drawerEl)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const courier = $('#t-courier', drawerEl).value.trim();
    const num = $('#t-num', drawerEl).value.trim();
    const url = $('#t-url', drawerEl).value.trim();
    const err = $('[data-track-err]', drawerEl);
    if (url && !/^https?:\/\/\S+$/.test(url)) return (err.textContent = 'The tracking link must start with https://');
    err.textContent = '';
    try {
      update((s) => Object.assign(s.orders.find((x) => x.id === id), { courier, trackingNumber: num, trackingUrl: url })).catch(() => {});
      toast('Shipping details saved');
    } catch (x) {
      toast(describeError(x));
    }
  });

  $('[data-seg]', drawerEl).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b && setStatus(id, b.dataset.s)) {
      $('[data-seg]', drawerEl).innerHTML = seg(getState().orders.find((x) => x.id === id));
      rerender();
    }
  });

  const act = async (payload, confirmCopy) => {
    if (!(await confirmDialog(confirmCopy))) return;
    const err = $('[data-act-err]', drawerEl);
    err.textContent = '';
    if (!LIVE) {
      sampleAction(o, payload);
    } else {
      const r = await callFunction('admin-order', { order_id: id, ...payload });
      if (!r.ok) {
        err.textContent = {
          owners_only: 'Only an owner can do this.',
          cannot_cancel: 'This order has shipped, so it can’t be cancelled. Refund it instead.',
          bad_amount: 'That amount is more than what’s left to refund.',
          not_refundable_online: 'This order wasn’t paid online, so there’s nothing to refund through Razorpay.',
          network: 'Could not reach the server.',
        }[r.body.error] || `Didn’t go through: ${r.body.error || r.status}. Nothing was changed.`;
        return;
      }
      await refresh();
    }
    toast(payload.action === 'cancel' ? `${id} cancelled` : `${money(payload.amount)} refunded`);
    rerender();
    openOrder(id, rerender);
  };
  $('[data-cancel]', drawerEl)?.addEventListener('click', () =>
    act({ action: 'cancel', reason: '' }, {
      title: `Cancel ${id}?`,
      body: `The items go back into stock${online && remaining > 0 ? ` and ${money(remaining)} is refunded to the customer` : ''}. This can’t be undone.`,
      ok: 'Cancel order',
    }),
  );
  $('[data-refund]', drawerEl)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Math.round(Number($('#r-amt', drawerEl).value));
    if (!(amount >= 1 && amount <= remaining)) return ($('[data-act-err]', drawerEl).textContent = `Enter an amount from ₹1 to ${money(remaining)}.`);
    act({ action: 'refund', amount, restock: $('#r-restock', drawerEl).checked, reason: $('#r-why', drawerEl).value.trim() }, {
      title: `Refund ${money(amount)}?`,
      body: `The money goes back to ${o.customer.name}’s original payment method. Razorpay usually takes 5–7 working days. This can’t be undone.`,
      ok: 'Refund',
    });
  });
}

// Sample mode: the same effects as the server, applied to the local data.
function sampleAction(o, p) {
  update((s) => {
    const x = s.orders.find((y) => y.id === o.id);
    const restock = () => x.lines.forEach((l) => { const pr = s.products.find((z) => z.id === l.sku); if (pr) pr.stock += l.qty; });
    if (p.action === 'cancel') {
      if (x.status !== 'Cancelled') restock();
      const due = orderTotal(x) - (x.refunded || 0);
      if (x.paymentMethod === 'razorpay' && ['paid', 'partially_refunded'].includes(x.paymentStatus)) {
        x.refunded = (x.refunded || 0) + due;
        x.paymentStatus = 'refunded';
      } else if (['cod', 'awaiting'].includes(x.paymentStatus)) {
        x.paymentStatus = 'cancelled';
        const c = x.coupon && (s.coupons || []).find((k) => k.code === x.coupon);
        if (c && x.status !== 'Cancelled') c.used_count = Math.max(0, (c.used_count || 0) - 1);
      }
      x.status = 'Cancelled';
    } else {
      x.refunded = (x.refunded || 0) + p.amount;
      x.paymentStatus = x.refunded >= orderTotal(x) ? 'refunded' : 'partially_refunded';
      if (p.restock) restock();
    }
  });
}

export const MAIL_LABEL = {
  order_confirmed: 'Order confirmation', order_shipped: 'On its way', order_delivered: 'Delivered', order_cancelled: 'Cancelled',
  order_refunded: 'Refund', admin_new_order: 'New order (to you)', admin_attention: 'Needs a look (to you)',
  back_in_stock: 'Back in stock', abandoned_cart: 'Bag reminder', newsletter_confirm: 'Newsletter confirmation', admin_low_stock: 'Low stock (to you)',
};
export const MAIL_STATUS = { pending: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Not sent' };

async function loadMails(id, ul) {
  const { data, error } = await supabase.from('email_outbox').select('kind, to_email, status, created_at, sent_at, last_error').eq('related_order', id).order('id');
  if (!ul?.isConnected) return;
  if (error) return (ul.innerHTML = `<li class="muted">${esc(describeError(error))}</li>`);
  ul.innerHTML = data.length
    ? data.map((m) => `<li><span>${esc(MAIL_LABEL[m.kind] || m.kind)}<br><span class="muted" style="font-size:.8125rem">${esc(m.to_email)}${m.last_error ? ` · ${esc(m.last_error)}` : ''}</span></span><span class="muted">${MAIL_STATUS[m.status] || m.status}, ${fmtDateTime(m.sent_at || m.created_at)}</span></li>`).join('')
    : '<li class="muted">No emails for this order yet.</li>';
}
