import { wishlist, accountsEnabled } from '../customer.js';
import { toast } from '../cart.js';
import { fmt, productHref } from '../data.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const heart = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;

export const wishButton = (sku, label, cls = '') =>
  `<button type="button" class="wish ${cls}" data-wish="${sku}" aria-pressed="${wishlist.has(sku)}" aria-label="Save ${esc(label)} to your wishlist">${heart}</button>`;

/** One delegated handler for every heart on the page; keeps them in sync with the wishlist. */
export function bindWishButtons(root = document) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wish]');
    if (!b) return;
    e.preventDefault();
    try {
      const added = await wishlist.toggle(b.dataset.wish);
      toast(added ? (accountsEnabled ? 'Saved to your wishlist' : 'Saved to your wishlist on this device') : 'Removed from your wishlist');
    } catch (err) {
      toast('Couldn’t update your wishlist. Try again.');
    }
  });
  wishlist.subscribe(() => $$('[data-wish]', root).forEach((b) => b.setAttribute('aria-pressed', String(wishlist.has(b.dataset.wish)))));
}

/** A product tile for one colour. */
export function tile({ product: p, colour: c }, base = '../', { actions = '' } = {}) {
  const sold = c.stock <= 0;
  return `<article class="tile${sold ? ' is-sold' : ''}" data-sku="${c.sku}">
    <div class="tile__media">
      ${sold ? '<span class="tile__badge">Sold out</span>' : c.stock <= 3 ? `<span class="tile__badge tile__badge--line">Only ${c.stock} left</span>` : ''}
      ${wishButton(c.sku, `${c.name} ${p.name}`, 'wish--float')}
      <img src="${esc(c.img || p.img)}" alt="${esc(`${p.name} in ${c.name}`)}" loading="lazy" />
    </div>
    <div class="tile__row">
      <h3 class="tile__name"><a href="${productHref(p.id, c.name, base)}">${esc(c.name)} ${esc(p.name)}</a></h3>
      <span class="tile__price">${fmt(c.price)}</span>
    </div>
    <p class="tile__meta"><span class="dot" style="background:${esc(c.hex)}"></span>${esc(p.collection)}</p>
    ${actions}
  </article>`;
}
