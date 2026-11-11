import { getState, orderTotal, orderRevenue, countsAsSale, money, CATEGORIES } from '../store.js';
import { esc, $, $$, icons, countUp, enter, listen } from './ui.js';

const DAY = 86400000;
const dayKey = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
export const fmtDate = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDateTime = (t) =>
  new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const statusChip = (s) => `<span class="status st-${s.toLowerCase()}">${s}</span>`;

export function metrics() {
  const s = getState();
  const threshold = s.settings.lowStock;
  const sales = s.orders.filter(countsAsSale);
  const revenue = s.orders.reduce((n, o) => n + orderRevenue(o), 0);
  const active = sales.filter((o) => o.status !== 'Delivered');
  const low = s.products
    .filter((p) => p.status === 'active' && p.stock <= threshold)
    .sort((a, b) => a.stock - b.stock);
  const attention = s.orders.filter((o) => o.flag && o.status !== 'Cancelled');
  return { s, threshold, revenue, active, low, sales, attention };
}

export function renderOverview(root) {
  const on = listen(root);
  const { s, threshold, revenue, active, low, sales, attention } = metrics();
  const today = dayKey(Date.now());
  const days = Array.from({ length: 14 }, (_, i) => today - (13 - i) * DAY);
  const byDay = days.map((d) =>
    s.orders.filter((o) => dayKey(o.createdAt) === d).reduce((n, o) => n + orderRevenue(o), 0),
  );
  const max = Math.max(...byDay, 1);
  const top = byDay.indexOf(Math.max(...byDay));
  const fortnight = byDay.reduce((a, b) => a + b, 0);
  const catRev = CATEGORIES.map((c) => ({
    c,
    v: sales.reduce(
      (n, o) => n + o.lines.filter((l) => l.category === c.id).reduce((m, l) => m + l.price * l.qty, 0),
      0,
    ),
  }));
  const catMax = Math.max(...catRev.map((x) => x.v), 1);
  const pending = active.filter((o) => o.status === 'Pending').length;
  const recent = sales.slice(0, 6);
  const nameOf = (id) => CATEGORIES.find((c) => c.id === id)?.name;
  const out = low.filter((p) => p.stock === 0).length;

  root.innerHTML = `
    <header class="page-head">
      <div><h1>Good to see you.</h1>
      <p>A quiet look at how the three collections are doing across the last thirty days.</p></div>
    </header>

    ${attention.length ? `<p class="alert-bar" role="alert"><b>${attention.length} ${attention.length === 1 ? 'order needs' : 'orders need'} a look:</b> ${attention.map((o) => `<a class="text-btn" href="#/orders?open=${o.id}">${o.id}</a>`).join(', ')}</p>` : ''}
    <section class="kpis" aria-label="Key figures">
      <div class="kpi"><p class="kpi__label">Total revenue</p>
        <p class="kpi__value num" data-count="${revenue}" data-money>${money(revenue)}</p>
        <p class="kpi__note">${sales.length} orders, after refunds; ${money(fortnight)} in the last 14 days</p></div>
      <div class="kpi"><p class="kpi__label">Active orders</p>
        <p class="kpi__value num" data-count="${active.length}">${active.length}</p>
        <p class="kpi__note"><b>${pending}</b> waiting to be picked up, ${active.length - pending} on the way</p></div>
      <div class="kpi"><p class="kpi__label">Low-stock alerts</p>
        <p class="kpi__value num" data-count="${low.length}">${low.length}</p>
        <p class="kpi__note">${low.length ? `${out} sold out, ${low.length - out} with ${threshold} or fewer left` : 'Every colour is comfortably stocked'}</p></div>
    </section>

    <div class="split">
      <div class="stack">
        <section aria-labelledby="rev-h">
          <div class="panel__head"><h2 id="rev-h">Revenue, last 14 days</h2>
            <p class="readout" id="readout" aria-live="polite">Highest: <b>${fmtDate(days[top])}</b>, ${money(byDay[top])}</p></div>
          <div class="bars" role="list">
            ${byDay
              .map(
                (v, i) => `<div class="bar ${i === top ? 'is-top' : ''}" role="listitem" tabindex="0"
                  data-r="${fmtDate(days[i])}|${v}" aria-label="${fmtDate(days[i])}: ${money(v)}" style="--h:${(v / max) * 100}%;--i:${i}"><i></i></div>`,
              )
              .join('')}
          </div>
          <div class="axis"><span>${fmtDate(days[0])}</span><span>${fmtDate(days[6])}</span><span>${fmtDate(days[13])}</span></div>
        </section>

        <section aria-labelledby="rec-h">
          <div class="panel__head"><h2 id="rec-h">Recent orders</h2><a class="text-btn" href="#/orders">All orders</a></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Status</th><th class="r">Total</th></tr></thead>
            <tbody>${recent
              .map(
                (o) => `<tr class="clickable" data-order="${o.id}" tabindex="0">
              <td class="order-id">${o.id}</td><td>${esc(o.customer.name)}</td><td class="muted">${fmtDate(o.createdAt)}</td>
              <td>${statusChip(o.status)}</td><td class="r num">${money(orderTotal(o))}</td></tr>`,
              )
              .join('')}</tbody></table></div>
        </section>
      </div>

      <div class="stack">
        <section aria-labelledby="cat-h">
          <div class="panel__head"><h2 id="cat-h">By collection</h2></div>
          ${catRev
            .map(
              ({ c, v }) => `<div class="hbar"><div class="hbar__top"><span>${c.name}</span><span class="num">${money(v)}</span></div>
              <div class="hbar__track"><div class="hbar__fill" style="--w:${(v / catMax) * 100}%"></div></div></div>`,
            )
            .join('')}
        </section>

        <section aria-labelledby="low-h">
          <div class="panel__head"><h2 id="low-h">Needs restocking</h2><a class="text-btn" href="#/products?stock=low">Manage</a></div>
          ${
            low.length
              ? `<ul class="list">${low
                  .slice(0, 7)
                  .map(
                    (p) => `<li class="list__row"><span class="swatch-dot" style="background:${esc(p.hex)}"></span>
                  <div class="list__main"><strong>${esc(p.colour)}</strong><span>${nameOf(p.category)}</span></div>
                  ${p.stock === 0 ? '<span class="pill pill--ink">Sold out</span>' : `<span class="pill pill--line">${p.stock} left</span>`}</li>`,
                  )
                  .join('')}</ul>`
              : '<p class="empty">Nothing to restock right now.</p>'
          }
        </section>
      </div>
    </div>`;

  enter(root);
  $$('[data-count]', root).forEach((el) => {
    const v = Number(el.dataset.count);
    countUp(el, v, el.hasAttribute('data-money') ? money : (n) => String(n));
  });
  const readout = $('#readout', root);
  const base = readout.innerHTML;
  $$('.bar', root).forEach((b) => {
    const show = () => {
      const [d, v] = b.dataset.r.split('|');
      readout.innerHTML = `<b>${d}</b>, ${money(Number(v))}`;
    };
    b.addEventListener('mouseenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('mouseleave', () => (readout.innerHTML = base));
    b.addEventListener('blur', () => (readout.innerHTML = base));
  });
  on('click', (e) => {
    const r = e.target.closest('[data-order]');
    if (r) location.hash = `#/orders?open=${r.dataset.order}`;
  });
  on('keydown', (e) => {
    const r = e.target.closest?.('[data-order]');
    if (r && e.key === 'Enter') location.hash = `#/orders?open=${r.dataset.order}`;
  });
}
