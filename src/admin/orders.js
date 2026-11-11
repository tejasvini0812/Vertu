import { getState, update, describeError, money, orderTotal, STATUSES, CATEGORIES } from '../store.js';
import { esc, $, $$, toast, openDrawer, drawerEl, enter, listen } from './ui.js';
import { fmtDate, fmtDateTime, statusChip } from './overview.js';

let filter = 'All';
let q = '';
const catName = (id) => CATEGORIES.find((c) => c.id === id)?.name || id;

const seg = (o) =>
  `<div class="seg" role="group" aria-label="Status for ${o.id}">${STATUSES.map((s) => `<button type="button" data-s="${s}" aria-pressed="${o.status === s}">${s}</button>`).join('')}</div>`;

function setStatus(id, status) {
  const o = getState().orders.find((x) => x.id === id);
  if (!o || o.status === status) return false;
  try {
    update((s) => (s.orders.find((x) => x.id === id).status = status)).catch(() => {});
    toast(`${id} marked ${status.toLowerCase()}`);
    return true;
  } catch (e) {
    toast(describeError(e));
    return false;
  }
}

export function renderOrders(root, params) {
  const on = listen(root);
  const s = getState();
  const counts = { All: s.orders.length };
  STATUSES.forEach((t) => (counts[t] = s.orders.filter((o) => o.status === t).length));
  const rows = s.orders
    .filter((o) => filter === 'All' || o.status === filter)
    .filter(
      (o) =>
        !q ||
        `${o.id} ${o.customer.name} ${o.customer.email} ${o.customer.city}`.toLowerCase().includes(q.toLowerCase()),
    );
  root.innerHTML = `
    <header class="page-head"><div><h1>Orders</h1>
      <p>Move an order along as it is packed and sent. Open one to see who it is for and what is inside.</p></div></header>
    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Order status">
        ${['All', ...STATUSES].map((t) => `<button role="tab" data-f="${t}" aria-selected="${filter === t}">${t}<sup>${counts[t]}</sup></button>`).join('')}
      </div>
      <div class="search"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg></span>
        <input class="input" type="search" placeholder="Search name, email or order" aria-label="Search orders" value="${esc(q)}" data-q /></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Items</th><th class="r">Total</th><th>Status</th></tr></thead>
      <tbody>${
        rows.length
          ? rows
              .map(
                (o) => `<tr data-id="${o.id}">
        <td><button class="text-btn order-id" data-open>${o.id}</button></td>
        <td><strong style="font-weight:500">${esc(o.customer.name)}</strong><br><span class="muted" style="font-size:.8125rem">${esc(o.customer.city)}, ${esc(o.customer.state)}</span></td>
        <td class="muted">${fmtDate(o.createdAt)}</td>
        <td class="muted num">${o.lines.reduce((n, l) => n + l.qty, 0)}</td>
        <td class="r num">${money(orderTotal(o))}</td>
        <td>${seg(o)}</td></tr>`,
              )
              .join('')
          : '<tr><td colspan="6"><p class="empty">No orders match.</p></td></tr>'
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
        else $('.seg', tr).outerHTML = seg(getState().orders.find((o) => o.id === tr.dataset.id));
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
  const body = `
    <div><p class="label" style="font-weight:500;margin-bottom:10px">Status</p><div data-seg>${seg(o)}</div></div>
    <dl style="margin:0">
      <div class="kv"><dt>Customer</dt><dd>${esc(c.name)}</dd></div>
      <div class="kv"><dt>Email</dt><dd><a class="text-btn" href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd></div>
      <div class="kv"><dt>Phone</dt><dd>${esc(c.phone)}</dd></div>
      <div class="kv"><dt>Ship to</dt><dd>${esc(c.address)}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.pin)}</dd></div>
    </dl>
    <div><p class="label" style="font-weight:500;margin-bottom:10px">Items</p>
      <ul class="lines">${o.lines.map((l) => `<li><span>${esc(l.colour)} ${catName(l.category)}<br><em>${l.sku}, qty ${l.qty}</em></span><span class="num">${money(l.price * l.qty)}</span></li>`).join('')}</ul>
      <div class="total-row" style="margin-top:14px"><span class="muted">Total</span><strong class="num">${money(orderTotal(o))}</strong></div></div>
    ${o.note ? `<div class="kv"><dt>Note</dt><dd>${esc(o.note)}</dd></div>` : ''}`;
  openDrawer({ title: o.id, sub: `Placed ${fmtDateTime(o.createdAt)}`, body, foot: '' });
  $('[data-seg]', drawerEl).addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b && setStatus(id, b.dataset.s)) {
      $('[data-seg]', drawerEl).innerHTML = seg(getState().orders.find((x) => x.id === id));
      rerender();
    }
  });
}
