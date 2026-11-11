import { PRODUCTS, fmt } from './data.js';

const KEY = 'vertu.bag.v1';
const listeners = new Set();
let items = [];

try {
  const raw = localStorage.getItem(KEY);
  if (raw) items = JSON.parse(raw).filter((i) => PRODUCTS[i.id]);
} catch (e) {
  items = [];
}

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch (e) {
    /* storage unavailable: the bag still works for this visit */
  }
};
const emit = () => listeners.forEach((fn) => fn(cart));
const colourOf = (i) => PRODUCTS[i.id].colours[i.colour] || PRODUCTS[i.id].colours[0];
const unitPrice = (i) => colourOf(i).price;

export const cart = {
  get items() {
    return items;
  },
  get count() {
    return items.reduce((n, i) => n + i.qty, 0);
  },
  get total() {
    return items.reduce((n, i) => n + unitPrice(i) * i.qty, 0);
  },
  subscribe(fn) {
    listeners.add(fn);
    fn(cart);
  },
  add(id, colour = 0, qty = 1) {
    const stock = PRODUCTS[id].colours[colour]?.stock ?? 0;
    const found = items.find((i) => i.id === id && i.colour === colour);
    const next = Math.min(stock, (found ? found.qty : 0) + qty);
    if (next <= 0) return false;
    if (found) found.qty = next;
    else items.push({ id, colour, qty: next });
    save();
    emit();
    return true;
  },
  setQty(id, colour, qty) {
    const found = items.find((i) => i.id === id && i.colour === colour);
    if (!found) return;
    found.qty = Math.min(qty, PRODUCTS[id].colours[colour]?.stock ?? qty);
    if (found.qty <= 0) items = items.filter((i) => i !== found);
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

export function initCartUI({ onOpen, onClose } = {}) {
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
    toast('Checkout is not connected yet. Hook your payment provider into src/cart.js.');
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const li = btn.closest('li');
    const id = li.dataset.id;
    const colour = Number(li.dataset.colour);
    const line = items.find((i) => i.id === id && i.colour === colour);
    if (!line) return;
    if (btn.dataset.act === 'inc') cart.setQty(id, colour, line.qty + 1);
    if (btn.dataset.act === 'dec') cart.setQty(id, colour, line.qty - 1);
    if (btn.dataset.act === 'remove') cart.setQty(id, colour, 0);
  });

  cart.subscribe(() => {
    counters.forEach((c) => (c.textContent = String(cart.count)));
    list.innerHTML = items
      .map((i) => {
        const p = PRODUCTS[i.id];
        const c = colourOf(i);
        return `<li data-id="${i.id}" data-colour="${i.colour}">
          <img src="${c.img || p.img}" alt="" width="72" height="90" />
          <div class="cart__info">
            <p class="cart__name">${p.name}</p>
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
