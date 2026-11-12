import './admin.css';
import { subscribe, resetDemo, ready, onSyncError, describeError, LIVE } from '../store.js';
import { gate, session, signOut } from './auth.js';
import { $, $$, esc, icons, toast, confirmDialog } from './ui.js';
import { renderOverview, metrics } from './overview.js';
import { renderProducts } from './products.js';
import { renderOrders } from './orders.js';
import { renderContent } from './content.js';
import { renderSettings } from './settings.js';
import { renderDiscounts } from './discounts.js';
import { renderReturns } from './returns.js';
import { renderSupport } from './support.js';

const ROUTES = {
  overview: { label: 'Overview', fn: renderOverview },
  products: { label: 'Products', fn: renderProducts },
  orders: { label: 'Orders', fn: renderOrders },
  returns: { label: 'Returns', fn: renderReturns },
  support: { label: 'Support', fn: renderSupport },
  content: { label: 'Editorial', fn: renderContent },
  discounts: { label: 'Discounts', fn: renderDiscounts },
  settings: { label: 'Settings', fn: renderSettings },
};
const view = $('#view');

function nav() {
  const { active, low } = metrics();
  $$('.side__nav a').forEach((a) => {
    const r = a.dataset.route;
    const n = r === 'orders' ? active.length : r === 'products' ? low.length : 0;
    a.innerHTML = `${icons[r]}<span>${ROUTES[r].label}</span>${n ? `<span class="count ${r === 'products' ? 'is-alert' : ''}" aria-label="${n} ${r === 'orders' ? 'active' : 'low stock'}">${n}</span>` : ''}`;
  });
  markCurrent();
}
function parse() {
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'overview').split('?');
  return { route: ROUTES[path] ? path : 'overview', params: new URLSearchParams(qs || '') };
}
function markCurrent() {
  const { route } = parse();
  $$('.side__nav a').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}
function render() {
  const { route, params } = parse();
  document.title = `${ROUTES[route].label} | VERTU Studio`;
  ROUTES[route].fn(view, params);
  markCurrent();
  window.scrollTo(0, 0);
}

async function boot() {
  await gate();

  // sidebar: who is signed in, or the sample-mode note
  $('[data-demo-note]').hidden = LIVE;
  $('[data-reset]').hidden = LIVE;
  if (LIVE) {
    const who = $('[data-who]');
    who.hidden = false;
    who.innerHTML = `<strong>${esc(session.email)}</strong>${session.role === 'owner' ? 'Owner' : 'Staff'}`;
    const out = $('[data-signout]');
    out.hidden = false;
    out.addEventListener('click', signOut);
  }

  view.innerHTML = '<p class="empty">Loading the store…</p>';
  try {
    await ready('admin');
  } catch (e) {
    view.innerHTML = `<header class="page-head"><div><h1>Can’t load the store</h1><p>${esc(describeError(e))}</p></div></header>
      <button class="btn btn--ink" onclick="location.reload()">Try again</button>`;
    return;
  }

  let rerender = false;
  onSyncError((e) => {
    toast(describeError(e));
    rerender = true; // the store reloads from the database next; redraw the view when it does
  });
  subscribe(() => {
    nav();
    if (rerender) {
      rerender = false;
      render();
    }
  });

  let last = parse().route;
  window.addEventListener('hashchange', () => {
    const { route, params } = parse();
    const same = route === last;
    last = route;
    if (!same || params.size) render();
    else markCurrent();
  });

  $('[data-reset]').addEventListener('click', async () => {
    if (
      await confirmDialog({
        title: 'Reset sample data?',
        body: 'Products, orders and editorial content return to the starting sample. Your edits and uploads are lost.',
        ok: 'Reset',
      })
    ) {
      resetDemo();
      render();
      toast('Sample data restored');
    }
  });

  nav();
  render();
}

boot();
