import { PRODUCTS, SKUS, bySku, fmt } from './data.js';

/**
 * The bag. Lines are { sku, qty }, so a line survives colours being added or reordered in the admin.
 * Saved in this browser; when a customer is signed in, src/customer.js also keeps a copy on their account.
 */
const KEY = 'vertu.bag.v1';
const listeners = new Set();
let items = [];

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return normalise(
      raw.map((i) =>
        // bags saved before Phase 2 stored { id: collection, colour: index }
        i.sku ? i : { sku: PRODUCTS[i.id]?.colours[i.colour]?.sku, qty: i.qty },
      ),
    );
  } catch (e) {
    return [];
  }
}

/** Drop unknown or sold-out SKUs, merge duplicates, cap at stock and at 9 per line. */
export function normalise(list) {
  const out = new Map();
  for (const i of list || []) {
    const hit = i && SKUS.get(i.sku);
    if (!hit) continue;
    const qty = Math.min(9, hit.colour.stock, (out.get(i.sku) || 0) + Math.max(0, Math.floor(Number(i.qty) || 0)));
    if (qty > 0) out.set(i.sku, qty);
  }
  return [...out].map(([sku, qty]) => ({ sku, qty }));
}

items = load();

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch (e) {
    /* storage unavailable: the bag still works for this visit */
  }
};
const emit = () => listeners.forEach((fn) => fn(cart));

export const cart = {
  get items() {
    return items;
  },
  get count() {
    return items.reduce((n, i) => n + i.qty, 0);
  },
  get total() {
    return items.reduce((n, i) => n + (bySku(i.sku)?.colour.price || 0) * i.qty, 0);
  },
  subscribe(fn) {
    listeners.add(fn);
    fn(cart);
    return () => listeners.delete(fn);
  },
  /** Returns false if nothing could be added (sold out, or already at the stock limit). */
  add(sku, qty = 1) {
    const hit = bySku(sku);
    if (!hit) return false;
    const found = items.find((i) => i.sku === sku);
    const before = found ? found.qty : 0;
    const next = Math.min(9, hit.colour.stock, before + qty);
    if (next <= before) return false;
    if (found) found.qty = next;
    else items.push({ sku, qty: next });
    save();
    emit();
    return true;
  },
  setQty(sku, qty) {
    const found = items.find((i) => i.sku === sku);
    if (!found) return;
    found.qty = Math.min(9, qty, bySku(sku)?.colour.stock ?? qty);
    if (found.qty <= 0) items = items.filter((i) => i !== found);
    save();
    emit();
  },
  /** Replace every line (used when merging with the bag saved on an account). */
  replace(list) {
    items = normalise(list);
    save();
    emit();
  },
  clear() {
    items = [];
    save();
    emit();
  },
};

let toastTimer;
export function toast(message) {
  const el = document.querySelector('.toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

export function initCartUI({ onOpen, onClose, base = '' } = {}) {
  const root = document.getElementById('cart');
  const list = root.querySelector('.cart__list');
  const empty = root.querySelector('.cart__empty');
  const foot = root.querySelector('.cart__foot');
  const subtotal = root.querySelector('[data-subtotal]');
  const counters = document.querySelectorAll('[data-cart-count]');
  let lastFocus = null;

  const open = () => {
    lastFocus = document.activeElement;
    root.inert = false;
    root.classList.add('is-open');
    document.documentElement.classList.add('cart-open');
    onOpen && onOpen();
    setTimeout(() => root.querySelector('[data-cart-close]')?.focus({ preventScroll: true }), 50);
  };
  const close = () => {
    root.classList.remove('is-open');
    document.documentElement.classList.remove('cart-open');
    root.inert = true;
    onClose && onClose();
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  };
  root.inert = true;

  document.querySelectorAll('[data-cart-open]').forEach((b) => b.addEventListener('click', open));
  root.querySelectorAll('[data-cart-close]').forEach((b) => b.addEventListener('click', close));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) close();
  });

  root.querySelector('[data-checkout]').addEventListener('click', () => {
    toast('Checkout opens soon. Payments are being connected.');
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const sku = btn.closest('li').dataset.sku;
    const line = items.find((i) => i.sku === sku);
    if (!line) return;
    if (btn.dataset.act === 'inc' && !cart.add(sku, 1)) toast('That’s all we have in this colour right now');
    if (btn.dataset.act === 'dec') cart.setQty(sku, line.qty - 1);
    if (btn.dataset.act === 'remove') cart.setQty(sku, 0);
  });

  cart.subscribe(() => {
    counters.forEach((c) => (c.textContent = String(cart.count)));
    list.innerHTML = items
      .map((i) => {
        const { product: p, colour: c } = bySku(i.sku);
        const href = `${base}product/?c=${p.id}&colour=${encodeURIComponent(c.name.toLowerCase())}`;
        return `<li data-sku="${i.sku}">
          <a href="${href}" tabindex="-1" aria-hidden="true"><img src="${c.img || p.img}" alt="" width="72" height="90" /></a>
          <div class="cart__info">
            <p class="cart__name"><a href="${href}">${p.name}</a></p>
            <p class="cart__meta"><span class="dot" style="background:${c.hex}"></span>${c.name}</p>
            <div class="qty" role="group" aria-label="Quantity for ${p.name}, ${c.name}">
              <button type="button" data-act="dec" aria-label="Decrease quantity">&minus;</button>
              <output aria-live="polite">${i.qty}</output>
              <button type="button" data-act="inc" aria-label="Increase quantity">+</button>
            </div>
          </div>
          <div class="cart__side">
            <p class="cart__price">${fmt(c.price * i.qty)}</p>
            <button type="button" class="link-btn" data-act="remove">Remove</button>
          </div>
        </li>`;
      })
      .join('');
    const has = items.length > 0;
    empty.hidden = has;
    foot.hidden = !has;
    list.hidden = !has;
    subtotal.textContent = fmt(cart.total);
  });

  return { open, close };
}
