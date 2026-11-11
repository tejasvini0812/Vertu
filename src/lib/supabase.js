import { createClient } from '@supabase/supabase-js';

/**
 * Live mode is on when both keys are set (in .env.local or your host's environment).
 * Without them the site runs on per-browser sample data, which is handy for design work.
 * The anon / publishable key is safe in the browser: row level security decides what it can do.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Captured before the client consumes the URL: true when arriving from a password-reset email. */
export const ARRIVED_FOR_RECOVERY =
  typeof location !== 'undefined' && /type=recovery/.test(location.hash + location.search);

export const LIVE = Boolean(url && key);
export const SUPABASE_URL = url || '';
export const SUPABASE_KEY = key || '';
export const supabase = LIVE
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

/**
 * Call one of our Edge Functions (supabase/functions/*). Sends the shopper's session if they are signed in.
 * Resolves { ok, status, body } and never throws for HTTP errors, so callers can show a helpful message.
 */
export async function callFunction(name, body) {
  if (!LIVE) return { ok: false, status: 0, body: { error: 'not_live' } };
  let token = key;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) token = data.session.access_token;
  } catch (_) {
    /* guest */
  }
  try {
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: json };
  } catch (e) {
    return { ok: false, status: 0, body: { error: 'network' } };
  }
}
