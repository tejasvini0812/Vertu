import { CONTENT } from './data.js';
import { initCartUI } from './cart.js';
import { customer, accountsEnabled } from './customer.js';
import { newsletterForm, bindNewsletterForms } from './newsletter.js';
import { legalLinks, fillEntity } from './legal/footer.js';
import { initConsent } from './consent.js';

/**
 * Header, announcement bar, footer, bag drawer and toast for the sub-pages (shop, product, account).
 * The home page has its own hand-built markup with the same classes.
 */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function mountChrome({ current = '' } = {}) {
  const base = '../';
  const a = CONTENT.announcement;
  const href = (h) => (h && h.startsWith('#') ? base + h : h || base);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<a class="skip" href="#main">Skip to content</a>
    ${a.enabled && a.text ? `<div class="announce" id="announce"><p>${esc(a.text)}</p>${a.linkLabel ? `<a href="${esc(href(a.linkHref))}">${esc(a.linkLabel)}</a>` : ''}</div>` : ''}
    <header class="nav is-solid nav--page" id="nav">
      <nav class="nav__side" aria-label="Primary">
        <a href="${base}shop/" ${current === 'shop' ? 'aria-current="page"' : ''}>Shop</a>
        <a href="${base}#collections">Collections</a>
        <a href="${base}#craft">Our craft</a>
      </nav>
      <a class="logo" href="${base}" aria-label="VERTU, home"><span></span></a>
      <div class="nav__side nav__side--end">
        <a href="${base}account/" class="nav__acct" data-account-link ${current === 'account' ? 'aria-current="page"' : ''}><svg class="nav__acct-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span data-account-label>${accountsEnabled ? 'Sign in' : 'Account'}</span></a>
        <button type="button" class="nav__bag" data-cart-open aria-label="Open your bag">Bag <span aria-hidden="true">(<span data-cart-count>0</span>)</span></button>
      </div>
    </header>`,
  );
  if (a.enabled && a.text) document.documentElement.classList.add('has-announce');
  document.body.insertAdjacentHTML(
    'beforeend',
    `<footer class="footer">
      <div class="footer__top"><span class="footer__logo" role="img" aria-label="VERTU"></span>
        <p class="footer__line">A utility-first bag brand designed for modern everyday life.</p>${newsletterForm()}</div>
      <div class="footer__cols">
        <nav aria-label="Footer"><a href="${base}shop/">Shop</a><a href="${base}#collections">Collections</a><a href="${base}account/">Account</a><a href="${base}contact/">Contact</a></nav>
        <div><a href="mailto:contact.shopvertu@gmail.com">contact.shopvertu@gmail.com</a><a href="https://instagram.com/shopvertu" rel="noopener">@shopvertu</a></div>
        <p class="footer__fine">&copy; ${new Date().getFullYear()} VERTU</p>
      </div>
      ${legalLinks(base)}
    </footer>
    <aside class="cart" id="cart" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <div class="cart__scrim" data-cart-close></div>
      <div class="cart__panel">
        <header class="cart__head"><h2 id="cart-title">Your bag</h2><button type="button" class="link-btn" data-cart-close>Close</button></header>
        <ul class="cart__list" hidden></ul>
        <p class="cart__empty">Your bag is empty. <a class="text-link" href="${base}shop/">Browse the shop</a></p>
        <div class="cart__foot" hidden>
          <div class="cart__sum"><span>Subtotal</span><strong data-subtotal></strong></div>
          <button type="button" class="btn btn--accent btn--block" data-checkout>Checkout</button>
        </div>
      </div>
    </aside>
    <div class="toast" role="status" aria-live="polite"></div>`,
  );
  const drawer = initCartUI({ base });
  bindAccountLink();
  bindNewsletterForms();
  fillEntity();
  initConsent();
  return { drawer, base };
}

/** "Sign in" becomes "Account" once a shopper is signed in. Works on the home page too. */
export function bindAccountLink() {
  if (!accountsEnabled) return;
  customer.onChange((u) => document.querySelectorAll('[data-account-label]').forEach((a) => (a.textContent = u ? 'Account' : 'Sign in')));
}
