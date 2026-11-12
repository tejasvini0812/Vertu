// Privacy choices. The store only uses storage that's needed to work (bag, wishlist, sign-in, these choices).
// Optional categories (analytics, added in Phase 7) stay off until the visitor allows them.
// The banner appears only when an optional category actually exists (VITE_ANALYTICS_PROVIDER is set).
const KEY = 'vertu.consent.v1';
const OPTIONAL = import.meta.env.VITE_ANALYTICS_PROVIDER ? ['analytics'] : [];
const subs = new Set();

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (_) {
    return null;
  }
}
function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch (_) {
    /* private mode: choices last for this visit */
  }
  current = v;
  subs.forEach((f) => f(v));
}
let current = read();

export const consent = {
  allowed: (cat) => !!current?.[cat],
  decided: () => !!current?.decided_at,
  onChange(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

export function openPrivacyChoices() {
  document.querySelector('.consent')?.remove();
  const el = document.createElement('div');
  el.className = 'consent consent--panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Privacy choices');
  el.innerHTML = `
    <h2>Privacy choices</h2>
    <p>We only store what the site needs to work: your bag, wishlist, sign-in and these choices. We don’t use advertising cookies.</p>
    <label class="check"><input type="checkbox" checked disabled /><span><strong>Needed to work</strong><br><span class="fine">Always on</span></span></label>
    ${OPTIONAL.includes('analytics') ? `<label class="check"><input type="checkbox" data-c="analytics" ${consent.allowed('analytics') ? 'checked' : ''} /><span><strong>Analytics</strong><br><span class="fine">Anonymous counts of visits and purchases, so we can improve the site</span></span></label>` : '<p class="fine">There’s nothing optional to choose at the moment.</p>'}
    <div class="consent__actions"><button class="btn btn--ink" type="button" data-save>Save</button><a class="text-link" href="${location.pathname.includes('/legal/') ? '' : location.pathname.split('/').length > 2 ? '../' : ''}legal/?p=privacy">Privacy policy</a></div>`;
  document.body.appendChild(el);
  el.querySelector('[data-save]').addEventListener('click', () => {
    const v = { decided_at: new Date().toISOString() };
    el.querySelectorAll('[data-c]').forEach((c) => (v[c.dataset.c] = c.checked));
    write(v);
    el.remove();
  });
  el.querySelector('input:not([disabled]), button')?.focus();
}

/** A small banner on first visit, only when there is something optional to ask about. */
export function initConsent() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-privacy-choices]')) {
      e.preventDefault();
      openPrivacyChoices();
    }
  });
  if (!OPTIONAL.length || consent.decided()) return;
  const el = document.createElement('div');
  el.className = 'consent';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Privacy choices');
  el.innerHTML = `<p>We’d like to count visits anonymously to improve the site. Nothing is shared for advertising.</p>
    <div class="consent__actions"><button class="btn btn--ink" type="button" data-yes>Allow</button><button class="btn btn--ghost" type="button" data-no>Only what’s needed</button><button class="link-btn" type="button" data-more>Choose</button></div>`;
  document.body.appendChild(el);
  el.querySelector('[data-yes]').addEventListener('click', () => (write({ decided_at: new Date().toISOString(), analytics: true }), el.remove()));
  el.querySelector('[data-no]').addEventListener('click', () => (write({ decided_at: new Date().toISOString(), analytics: false }), el.remove()));
  el.querySelector('[data-more]').addEventListener('click', openPrivacyChoices);
}
