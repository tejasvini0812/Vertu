import { seed } from './seed.js';
import slingImg from './assets/img/sling.jpg';
import mensImg from './assets/img/mens.jpg';
import laptopImg from './assets/img/laptop.jpg';
import hero1 from './assets/img/hero-1.jpg';
import hero2 from './assets/img/hero-2.jpg';
import hero3 from './assets/img/hero-3.jpg';

export { CATEGORIES, STATUSES, skuFor } from './seed.js';

/**
 * One small persisted store shared by the storefront and the /admin portal.
 * It lives in localStorage, so it is per-browser demo data. To go live, replace
 * `load` / `persist` with calls to your API and keep the same state shape.
 */
const KEY = 'vertu.admin.v1';
export const ASSETS = { sling: slingImg, mens: mensImg, laptop: laptopImg, hero1, hero2, hero3 };

/** "asset:sling" -> bundled image URL; anything else (data: URL or http URL) passes through. */
export const resolveImage = (ref) =>
  !ref ? '' : ref.startsWith('asset:') ? ASSETS[ref.slice(6)] || '' : ref;

const subs = new Set();

function persist(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    return false;
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 1) return s;
    }
  } catch (e) {
    /* fall through to a fresh seed */
  }
  const s = seed();
  persist(s);
  return s;
}

let state = load();

export const getState = () => state;

/** Mutate a copy, persist it, notify. Throws 'storage-full' if the browser refuses the write. */
export function update(fn) {
  const next = structuredClone(state);
  fn(next);
  if (!persist(next)) throw new Error('storage-full');
  state = next;
  subs.forEach((f) => f(state));
  return state;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function resetDemo() {
  state = seed();
  persist(state);
  subs.forEach((f) => f(state));
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load();
    subs.forEach((f) => f(state));
  }
});

export const orderTotal = (o) => o.lines.reduce((n, l) => n + l.price * l.qty, 0);
export const money = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
