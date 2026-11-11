import { LIVE, supabase } from './lib/supabase.js';
import { cart, normalise } from './cart.js';
import { SKUS } from './data.js';

/**
 * Shopper session, wishlist and the bag saved to the account.
 *  - Signed out: wishlist and bag live in this browser.
 *  - Signing in merges both into the account (nothing is lost), then keeps them in sync.
 *  - Signing out clears them from this browser, so a shared computer doesn't show someone else's bag.
 * Without Supabase keys (sample mode) accounts are off and everything stays in the browser.
 */
const WKEY = 'vertu.wish.v1';
const readLocalWish = () => {
  try {
    return JSON.parse(localStorage.getItem(WKEY) || '[]').filter((s) => typeof s === 'string');
  } catch (e) {
    return [];
  }
};
const writeLocalWish = (list) => {
  try {
    localStorage.setItem(WKEY, JSON.stringify(list));
  } catch (e) {
    /* optional */
  }
};

let user = null;
let wish = new Set(readLocalWish());
let syncing = false;
const userSubs = new Set();
const wishSubs = new Set();
const emitUser = () => userSubs.forEach((f) => f(user));
const emitWish = () => wishSubs.forEach((f) => f(wishlist));

export const accountsEnabled = LIVE;

export const customer = {
  get user() {
    return user;
  },
  onChange(fn) {
    userSubs.add(fn);
    fn(user);
    return () => userSubs.delete(fn);
  },
};

export const wishlist = {
  has: (sku) => wish.has(sku),
  /** SKUs still on sale, newest first */
  get items() {
    return [...wish].filter((s) => SKUS.has(s)).reverse();
  },
  get count() {
    return this.items.length;
  },
  subscribe(fn) {
    wishSubs.add(fn);
    fn(wishlist);
    return () => wishSubs.delete(fn);
  },
  async toggle(sku) {
    const adding = !wish.has(sku);
    adding ? wish.add(sku) : wish.delete(sku);
    emitWish();
    if (!user) return writeLocalWish([...wish]), adding;
    const q = adding
      ? supabase.from('wishlist_items').upsert({ user_id: user.id, sku }, { onConflict: 'user_id,sku', ignoreDuplicates: true })
      : supabase.from('wishlist_items').delete().eq('user_id', user.id).eq('sku', sku);
    const { error } = await q;
    if (error) {
      adding ? wish.delete(sku) : wish.add(sku);
      emitWish();
      throw error;
    }
    return adding;
  },
};

async function mergeWishlist() {
  const { data, error } = await supabase.from('wishlist_items').select('sku, created_at').order('created_at');
  if (error) return console.warn('[vertu] wishlist', error);
  const remote = data.map((r) => r.sku);
  const local = readLocalWish().filter((s) => SKUS.has(s) && !remote.includes(s));
  if (local.length) {
    const { error: e2 } = await supabase
      .from('wishlist_items')
      .upsert(local.map((sku) => ({ user_id: user.id, sku })), { onConflict: 'user_id,sku', ignoreDuplicates: true });
    if (e2) console.warn('[vertu] wishlist merge', e2);
  }
  wish = new Set([...remote, ...local]);
  writeLocalWish([]);
  emitWish();
}

let pushTimer;
const pushCart = () => {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (!user) return;
    const { error } = await supabase.from('carts').upsert({ user_id: user.id, items: cart.items }, { onConflict: 'user_id' });
    if (error) console.warn('[vertu] saving bag', error);
  }, 600);
};

async function mergeCart() {
  const { data, error } = await supabase.from('carts').select('items').eq('user_id', user.id).maybeSingle();
  if (error) return console.warn('[vertu] bag', error);
  // keep the larger quantity of each line rather than adding them up
  const best = new Map();
  for (const i of [...(data?.items || []), ...cart.items]) best.set(i.sku, Math.max(best.get(i.sku) || 0, i.qty));
  syncing = true;
  cart.replace(normalise([...best].map(([sku, qty]) => ({ sku, qty }))));
  syncing = false;
  // only write back if the merge changed something
  const key = (list) => JSON.stringify([...(list || [])].map((i) => [i.sku, i.qty]).sort());
  if (key(cart.items) !== key(data?.items)) pushCart();
}

async function setUser(next) {
  const was = user;
  if ((was && was.id) === (next && next.id)) {
    user = next;
    return;
  }
  user = next;
  if (user) {
    await Promise.all([mergeWishlist(), mergeCart()]);
  } else if (was) {
    wish = new Set();
    writeLocalWish([]);
    syncing = true;
    cart.clear();
    syncing = false;
    emitWish();
  }
  emitUser();
}

cart.subscribe(() => {
  if (user && !syncing) pushCart();
});

export const customerReady = (async () => {
  if (!LIVE) return null;
  const { data } = await supabase.auth.getSession();
  await setUser(data.session?.user || null);
  supabase.auth.onAuthStateChange((event, session) => {
    if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'INITIAL_SESSION'].includes(event)) {
      // run outside the auth callback (supabase-js recommends not awaiting other calls inside it)
      setTimeout(() => setUser(session?.user || null), 0);
    }
  });
  return user;
})();

/* ---------- sign-in helpers for the account page ---------- */

const redirectTo = () => new URL('account/', location.href.replace(/(account|shop|product)\/.*$/, '')).href;

export async function sendCode(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo() },
  });
  if (error) throw error;
}
export async function verifyCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}
export const googleEnabled = LIVE && import.meta.env.VITE_AUTH_GOOGLE === 'true';
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
}
