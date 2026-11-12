import { seed } from './seed.js';
import { LIVE, supabase } from './lib/supabase.js';
import { diff, apply, productFromRow, orderFromRow, contentFromRow, categoryFromRow, settingsFromRow } from './lib/sync.js';
import slingImg from './assets/img/sling.jpg';
import mensImg from './assets/img/mens.jpg';
import laptopImg from './assets/img/laptop.jpg';
import hero1 from './assets/img/hero-1.jpg';
import hero2 from './assets/img/hero-2.jpg';
import hero3 from './assets/img/hero-3.jpg';

export { CATEGORIES, STATUSES, skuFor } from './seed.js';
import { CATEGORIES as BASE_CATEGORIES, CATEGORY_DETAILS } from './seed.js';
export { LIVE, supabase };
export { callFunction } from './lib/supabase.js';

/**
 * One store shared by the storefront and the /admin portal.
 *
 * LIVE (Supabase keys set): state is loaded from the database with `ready()`. `update(fn)` applies the
 * change on screen at once, then writes it to the database in the background. If the write fails,
 * `onSyncError` listeners are told and the state is reloaded from the database.
 *
 * DEMO (no keys): state lives in this browser's localStorage, seeded with sample data.
 */
const KEY = 'vertu.admin.v1';
const CACHE = 'vertu.cache.v1';
export const ASSETS = { sling: slingImg, mens: mensImg, laptop: laptopImg, hero1, hero2, hero3 };

/** "asset:sling" -> bundled image URL; anything else (storage URL or data: URL) passes through. */
export const resolveImage = (ref) =>
  !ref ? '' : ref.startsWith('asset:') ? ASSETS[ref.slice(6)] || '' : ref;

const subs = new Set();
const errorSubs = new Set();
const notify = () => subs.forEach((f) => f(state));

function persist(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    return false;
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 1) {
        // demo data saved before Phase 2 has no collection details
        // demo data saved before Phase 3 has no shipping rules or coupons
        s.settings = { ...seed().settings, ...s.settings };
        if (!s.coupons) s.coupons = [];
        if (!s.categories) s.categories = seed().categories;
        s.categories = s.categories.map((c) => ({ ...seed().categories.find((x) => x.id === c.id), ...c }));
        return s;
      }
    }
  } catch (e) {
    /* fall through to a fresh seed */
  }
  const s = seed();
  persist(s);
  return s;
}

const blank = () => {
  const s = seed();
  return { version: 1, settings: s.settings, categories: s.categories, products: [], orders: [], coupons: [], content: s.content };
};

let state = LIVE ? blank() : loadLocal();
let scope = 'public';

export const getState = () => state;
export const mode = LIVE ? 'live' : 'demo';

async function fetchState(which) {
  const db = supabase;
  const asks = [
    db.from('products').select('*').order('category').order('sort'),
    db.from('site_content').select('*').eq('id', 1).maybeSingle(),
    db.from('categories').select('*').order('sort'),
  ];
  if (which === 'admin') {
    asks.push(
      db.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(1000),
      db.from('settings').select('*').eq('id', 1).maybeSingle(),
      db.from('coupons').select('*').order('created_at', { ascending: false }),
    );
  }
  const [p, c, cat, o, st, cp] = await Promise.all(asks);
  const err = [p, c, cat, o, st, cp].find((r) => r && r.error);
  if (err) throw err.error;
  const next = blank();
  next.products = p.data.map(productFromRow);
  if (c.data) next.content = contentFromRow(c.data);
  if (cat.data && cat.data.length) next.categories = cat.data.map(categoryFromRow);
  if (o) next.orders = o.data.map(orderFromRow);
  if (st && st.data) next.settings = settingsFromRow(st.data);
  if (cp) next.coupons = cp.data;
  return next;
}

/**
 * Load data before first render. `which` is 'public' (storefront) or 'admin'.
 * The storefront keeps a cached copy so a slow or failed request still shows the last known catalogue.
 */
export async function ready(which = 'public') {
  scope = which;
  if (!LIVE) return state;
  try {
    state = await withTimeout(fetchState(which), 8000);
    if (which === 'public') {
      try {
        localStorage.setItem(CACHE, JSON.stringify({ products: state.products, content: state.content, categories: state.categories }));
      } catch (e) {
        /* cache is optional */
      }
    }
  } catch (e) {
    if (which === 'admin') throw e;
    try {
      const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (c) Object.assign(state, c);
    } catch (_) {
      /* no cache */
    }
    console.warn('[vertu] catalogue request failed, using cached or default content', e);
  }
  notify();
  return state;
}

export async function refresh() {
  if (!LIVE) return state;
  state = await fetchState(scope);
  notify();
  return state;
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

let queue = Promise.resolve();

/**
 * Change state with a mutator. In demo mode this saves synchronously and throws 'storage-full' if the
 * browser refuses. In live mode it updates the screen at once and returns a promise for the database write.
 */
export function update(fn) {
  const prev = state;
  const next = structuredClone(state);
  fn(next);
  if (!LIVE) {
    if (!persist(next)) throw new Error('storage-full');
    state = next;
    notify();
    return Promise.resolve(state);
  }
  const ops = diff(prev, next);
  state = next;
  notify();
  if (!ops.length) return Promise.resolve(state);
  const job = queue.then(async () => {
    try {
      await apply(supabase, ops);
      // swap any just-uploaded data: URLs for their permanent storage URLs
      const patched = structuredClone(state);
      for (const op of ops) {
        if (op.table === 'products' && op.values?.image) {
          const p = patched.products.find((x) => x.id === op.id);
          if (p) p.image = op.values.image;
        }
        if (op.table === 'site_content') patched.content = { ...op.values.published, publishedAt: Date.parse(op.values.published_at) };
      }
      state = patched;
      notify();
      return state;
    } catch (err) {
      errorSubs.forEach((f) => f(err));
      try {
        await refresh();
      } catch (_) {
        /* keep the optimistic state; the error was already reported */
      }
      throw err;
    }
  });
  queue = job.catch(() => {});
  return job;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function onSyncError(fn) {
  errorSubs.add(fn);
  return () => errorSubs.delete(fn);
}

export function resetDemo() {
  if (LIVE) return;
  state = seed();
  persist(state);
  notify();
}

if (!LIVE) {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = loadLocal();
      notify();
    }
  });
}

/** Human wording for a failed save. */
export function describeError(e) {
  const code = e && (e.code || e.cause?.code);
  const msg = String((e && e.message) || '');
  if (msg === 'storage-full') return 'Browser storage is full. Remove some uploaded images and try again.';
  if (msg === 'not-allowed' || code === '42501') return 'Your account is not allowed to make that change.';
  if (code === '23505' && /coupons/.test(msg)) return 'A code with that name already exists.';
  if (code === '23505') return 'That SKU already exists. Use a different colour name.';
  if (code === '23514' || code === '22P02') return 'One of the values is not allowed. Check prices, stock and the swatch colour.';
  if (msg === 'use_cancel') return 'To cancel, use “Cancel order” in the order details. It restocks and refunds.';
  if (msg === 'order_unpaid') return 'This order hasn’t been paid yet, so it can’t move along.';
  if (msg === 'order_cancelled') return 'This order was cancelled.';
  if (code === 'upload') return `The image could not be uploaded: ${msg}`;
  if (msg === 'timeout' || /fetch|network/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  if (code === 'PGRST301' || /JWT/i.test(msg)) return 'Your session has expired. Sign in again.';
  return `Could not save: ${msg}`;
}

/** What the customer was charged (checkout orders), or the sum of the lines (older orders). */
export const orderTotal = (o) => (o.total != null ? o.total : o.lines.reduce((n, l) => n + l.price * l.qty, 0));
/** Orders whose money is real: excludes unpaid, expired and cancelled-before-payment orders. */
export const countsAsSale = (o) =>
  !['awaiting', 'failed', 'expired', 'cancelled'].includes(o.paymentStatus || 'paid') && o.status !== 'Cancelled';
/** Net revenue of an order after refunds. */
export const orderRevenue = (o) => (countsAsSale(o) ? orderTotal(o) - (o.refunded || 0) : 0);
export const money = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
