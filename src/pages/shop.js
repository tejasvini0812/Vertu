import '../styles.css';
import '../pages.css';
import { PRODUCTS, SKUS } from '../data.js';
import { mountChrome } from '../chrome.js';
import { esc, $, $$, tile, bindWishButtons } from './ui.js';

mountChrome({ current: 'shop' });
const main = $('#main');

const all = [...SKUS.values()];
const collections = Object.values(PRODUCTS);
const colours = [...new Map(all.map(({ colour: c }) => [c.name.toLowerCase(), c])).values()];

const url = new URL(location.href);
const f = {
  q: url.searchParams.get('q') || '',
  c: url.searchParams.get('c') || '',
  colour: url.searchParams.get('colour') || '',
  stock: url.searchParams.get('stock') === '1',
  sort: url.searchParams.get('sort') || 'featured',
};

main.innerHTML = `
  <header class="shop-head"><div><h1 class="page-title">Shop</h1>
    <p class="lede">Three bags, each made in five colours. Every colour has its own stock, so what you see is what we can send.</p></div>
    <p class="count" data-count aria-live="polite"></p></header>
  <div class="filters" role="search">
    <div class="filters__row filters__row--split">
      <div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
        <input class="input" type="search" data-q placeholder="Search by colour or bag" aria-label="Search bags" value="${esc(f.q)}" /></div>
      <div class="filters__row">
        <label class="toggle"><input type="checkbox" data-stock ${f.stock ? 'checked' : ''} />In stock only</label>
        <label class="sort">Sort <select class="select" data-sort>
          <option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Colour A–Z</option>
        </select></label>
      </div>
    </div>
    <div class="chips" role="group" aria-label="Collection" data-cats>
      <button type="button" class="chip" data-cat="">All bags</button>
      ${collections.map((p) => `<button type="button" class="chip" data-cat="${p.id}">${esc(p.collection)}</button>`).join('')}
    </div>
    <div class="chips" role="group" aria-label="Colour" data-colours>
      ${colours.map((c) => `<button type="button" class="chip" data-colour="${esc(c.name.toLowerCase())}"><span class="dot" style="background:${esc(c.hex)}"></span>${esc(c.name)}</button>`).join('')}
    </div>
  </div>
  <div class="tiles" data-grid></div>
  <div class="empty-state" data-empty hidden><h2>Nothing matches that.</h2><p>Try another colour or clear the filters.</p><button type="button" class="btn btn--ghost" data-clear>Clear filters</button></div>`;

$('[data-sort]', main).value = f.sort;
bindWishButtons(main);

const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);

function results() {
  const terms = words(f.q);
  let list = all.filter(({ product: p, colour: c }) => {
    if (f.c && p.id !== f.c) return false;
    if (f.colour && c.name.toLowerCase() !== f.colour) return false;
    if (f.stock && c.stock <= 0) return false;
    if (!terms.length) return true;
    const hay = `${c.name} ${p.name} ${p.collection} ${p.description} ${(p.details.features || []).join(' ')} ${c.sku}`.toLowerCase().replace(/’/g, "'");
    return terms.every((t) => hay.includes(t.replace(/’/g, "'").replace(/s$/, '')));
  });
  const by = {
    'price-asc': (a, b) => a.colour.price - b.colour.price,
    'price-desc': (a, b) => b.colour.price - a.colour.price,
    name: (a, b) => a.colour.name.localeCompare(b.colour.name),
    // featured: in-stock first, then the order the admin set
    featured: (a, b) => (b.colour.stock > 0) - (a.colour.stock > 0),
  };
  return [...list].sort(by[f.sort] || by.featured);
}

function render() {
  const list = results();
  $('[data-grid]', main).innerHTML = list.map((x) => tile(x)).join('');
  $('[data-empty]', main).hidden = list.length > 0;
  $('[data-count]', main).textContent = `${list.length} ${list.length === 1 ? 'bag' : 'bags'}`;
  $$('[data-cat]', main).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === f.c)));
  $$('[data-colour]', main).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.colour === f.colour)));
  const u = new URL(location.href);
  [['q', f.q], ['c', f.c], ['colour', f.colour], ['stock', f.stock ? '1' : ''], ['sort', f.sort === 'featured' ? '' : f.sort]].forEach(([k, v]) =>
    v ? u.searchParams.set(k, v) : u.searchParams.delete(k),
  );
  history.replaceState(null, '', u);
  const title = f.c ? PRODUCTS[f.c]?.collection : '';
  document.title = `${title ? `${title} | ` : ''}Shop | VERTU`;
}

let t;
$('[data-q]', main).addEventListener('input', (e) => {
  clearTimeout(t);
  t = setTimeout(() => ((f.q = e.target.value.trim()), render()), 150);
});
$('[data-stock]', main).addEventListener('change', (e) => ((f.stock = e.target.checked), render()));
$('[data-sort]', main).addEventListener('change', (e) => ((f.sort = e.target.value), render()));
$('[data-cats]', main).addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) (f.c = b.dataset.cat), render();
});
$('[data-colours]', main).addEventListener('click', (e) => {
  const b = e.target.closest('[data-colour]');
  if (b) (f.colour = f.colour === b.dataset.colour ? '' : b.dataset.colour), render();
});
$('[data-clear]', main).addEventListener('click', () => {
  Object.assign(f, { q: '', c: '', colour: '', stock: false });
  $('[data-q]', main).value = '';
  $('[data-stock]', main).checked = false;
  render();
});

render();
