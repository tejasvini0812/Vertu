// Optional analytics, off unless VITE_ANALYTICS_PROVIDER is set AND the visitor allows it in Privacy choices.
//   VITE_ANALYTICS_PROVIDER=plausible  VITE_ANALYTICS_ID=yourdomain.com   (cookie-free, recommended)
//   VITE_ANALYTICS_PROVIDER=ga4        VITE_ANALYTICS_ID=G-XXXXXXXXXX
// Pages call track('add_to_cart', {...}); events before consent are dropped, never queued for later.
import { consent } from './consent.js';

const PROVIDER = (import.meta.env.VITE_ANALYTICS_PROVIDER || '').toLowerCase();
const ID = import.meta.env.VITE_ANALYTICS_ID || '';
let loaded = false;

function load() {
  if (loaded || !PROVIDER || !ID || !consent.allowed('analytics')) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  if (PROVIDER === 'plausible') {
    s.src = 'https://plausible.io/js/script.manual.js';
    s.dataset.domain = ID;
    window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
    window.plausible('pageview', { u: cleanUrl() });
  } else if (PROVIDER === 'ga4') {
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // No advertising features, no Google signals, page location without query strings (order links carry tokens).
    window.gtag('config', ID, { allow_google_signals: false, allow_ad_personalization_signals: false, page_location: cleanUrl() });
  }
  document.head.appendChild(s);
}

/** Page URL without the query string or hash, so order access tokens and emails never reach analytics. */
const cleanUrl = () => location.origin + location.pathname;

consent.onChange(load);
load();

/**
 * E-commerce events in GA4's names: view_item, add_to_cart, begin_checkout, purchase.
 * `items` are { sku, name, colour, price, qty }.
 */
export function track(event, { value, items = [], order_id, coupon } = {}) {
  if (!loaded) return;
  try {
    if (PROVIDER === 'plausible') {
      const props = { ...(order_id ? { order: order_id } : {}), ...(coupon ? { coupon } : {}), items: items.map((i) => i.sku).join(',') };
      window.plausible(event, { u: cleanUrl(), props, ...(value != null && event === 'purchase' ? { revenue: { currency: 'INR', amount: value } } : {}) });
    } else if (PROVIDER === 'ga4') {
      window.gtag('event', event, {
        currency: 'INR',
        ...(value != null ? { value } : {}),
        ...(order_id ? { transaction_id: order_id } : {}),
        ...(coupon ? { coupon } : {}),
        items: items.map((i) => ({ item_id: i.sku, item_name: i.name, item_variant: i.colour, price: i.price, quantity: i.qty || 1 })),
      });
    }
  } catch (_) {
    /* analytics must never break the shop */
  }
}
