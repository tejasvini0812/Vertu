import { legalInfo } from './info.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Policy links for every footer. `base` is '' on the home page, '../' elsewhere. */
export const legalLinks = (base) => `
  <nav class="footer__legal" aria-label="Policies">
    <a href="${base}legal/?p=shipping">Shipping</a><a href="${base}legal/?p=returns">Returns and refunds</a><a href="${base}legal/?p=cancellation">Cancellation</a>
    <a href="${base}legal/?p=privacy">Privacy</a><a href="${base}legal/?p=terms">Terms</a><a href="${base}contact/">Contact and grievances</a>
    <a href="#" data-privacy-choices>Privacy choices</a>
  </nav>
  <p class="footer__entity" data-entity></p>`;

/** Fills in "Sold by ... " with the business's legal details (required disclosures). */
export async function fillEntity(root = document) {
  const el = root.querySelector('[data-entity]');
  if (!el) return;
  const i = await legalInfo().catch(() => null);
  if (!i) return;
  el.innerHTML = `${esc(i.name)}${i.address ? `, ${esc(i.address)}` : ''}${i.gstin ? `. GSTIN ${esc(i.gstin)}` : ''}. Customer care: <a href="mailto:${esc(i.care_email)}">${esc(i.care_email)}</a>${i.care_phone ? `, <a href="tel:${esc(i.care_phone)}">${esc(i.care_phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2'))}</a>` : ''}.`;
}
