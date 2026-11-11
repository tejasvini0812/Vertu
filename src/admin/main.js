import './admin.css';
import { getState, subscribe, resetDemo, orderTotal } from '../store.js';
import { $, $$, icons, toast, confirmDialog } from './ui.js';
import { renderOverview, metrics } from './overview.js';
import { renderProducts } from './products.js';
import { renderOrders } from './orders.js';
import { renderContent } from './content.js';

const ROUTES = {
  overview: { label: 'Overview', fn: renderOverview },
  products: { label: 'Products', fn: renderProducts },
  orders: { label: 'Orders', fn: renderOrders },
  content: { label: 'Editorial', fn: renderContent },
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
let last = '';
window.addEventListener('hashchange', () => {
  const { route } = parse();
  const same = route === last;
  last = route;
  if (!same || parse().params.size) render();
  else markCurrent();
});
subscribe(nav);

$('[data-reset]').addEventListener('click', async () => {
  if (await confirmDialog({ title: 'Reset sample data?', body: 'Products, orders and editorial content return to the starting sample. Your edits and uploads are lost.', ok: 'Reset' })) {
    resetDemo();
    render();
    toast('Sample data restored');
  }
});

nav();
last = parse().route;
render();
