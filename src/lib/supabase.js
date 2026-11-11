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
export const supabase = LIVE
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
