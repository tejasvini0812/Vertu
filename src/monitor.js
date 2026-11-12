// Reports errors in visitors' browsers to the database (Settings -> System health in the admin).
// Only the page path is sent (never the query string: order links carry access tokens), at most
// 5 distinct errors per page view, and nothing at all in sample mode.
import { LIVE, supabase } from './lib/supabase.js';

const RELEASE = typeof __RELEASE__ !== 'undefined' ? __RELEASE__ : 'dev';
const seen = new Set();
const NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|safari-extension:|Non-Error promise rejection|AbortError|Load failed|Failed to fetch|NetworkError/i;

export function report(message, source = '', stack = '') {
  message = String(message || '').slice(0, 500);
  if (!LIVE || !message || NOISE.test(message) || NOISE.test(source) || NOISE.test(stack)) return;
  const key = message + source;
  if (seen.has(key) || seen.size >= 5) return;
  seen.add(key);
  supabase
    .rpc('log_client_error', {
      p_message: message,
      p_source: String(source).slice(0, 300),
      p_page: location.pathname,
      p_stack: String(stack || '').slice(0, 4000),
      p_user_agent: navigator.userAgent.slice(0, 300),
      p_release: RELEASE,
    })
    .then(() => {}, () => {});
}

if (typeof window !== 'undefined' && !window.__vertuMonitor) {
  window.__vertuMonitor = true;
  window.addEventListener('error', (e) => {
    if (!e.message) return; // failed image/script loads have no message
    report(e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report(r?.message || String(r), '', r?.stack);
  });
}
