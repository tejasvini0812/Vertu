import '../monitor.js';
import '../styles.css';
import '../pages.css';
import { mountChrome } from '../chrome.js';
import { legalInfo } from '../legal/info.js';
import { LIVE, supabase } from '../lib/supabase.js';
import { customer, customerReady } from '../customer.js';
import { $ } from './ui.js';

mountChrome({ current: 'contact' });
const main = $('#main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const q = new URLSearchParams(location.search);
await customerReady;
const i = await legalInfo();
const tel = (p) => (p ? `<a href="tel:${esc(p)}">${esc(p.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2'))}</a>` : '');
const CATS = { order: 'A question about an order', delivery: 'Delivery', return: 'A return or refund', payment: 'A payment', cancel: 'Cancel an order', product: 'A product', privacy: 'My personal data', other: 'Something else' };

main.innerHTML = `
  <div class="contact">
    <div>
      <h1 class="page-title">Contact us</h1>
      <p class="lede">A person reads every message. We reply to most within a working day, acknowledge every complaint within 48 hours, and resolve it within one month at the latest.</p>
      <form class="contact__form" data-form novalidate>
        <div class="form-grid">
          <div class="field"><label for="t-name">Your name</label><input class="input" id="t-name" autocomplete="name" maxlength="120" /></div>
          <div class="field"><label for="t-email">Email</label><input class="input" id="t-email" type="email" autocomplete="email" value="${esc(customer.user?.email || '')}" /></div>
          <div class="field"><label for="t-phone">Mobile <span class="fine">(optional)</span></label><input class="input" id="t-phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" /></div>
          <div class="field"><label for="t-order">Order number <span class="fine">(if it’s about one)</span></label><input class="input" id="t-order" maxlength="20" placeholder="VRT-10500" value="${esc(q.get('order') || '')}" /></div>
          <div class="field full"><label for="t-cat">What is it about?</label><select class="select" id="t-cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${q.get('about') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field full"><label for="t-msg">Message</label><textarea class="input" id="t-msg" rows="6" maxlength="4000" style="height:auto;padding:12px 14px"></textarea></div>
          <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true" />
        </div>
        <p class="err" data-err role="alert" style="margin-top:14px"></p>
        <div class="form-actions"><button class="btn btn--ink" type="submit">Send</button></div>
        <p class="fine" style="margin-top:12px">We use these details only to answer you. See our <a href="../legal/?p=privacy">privacy policy</a>.</p>
      </form>
    </div>
    <aside class="disclosure" aria-labelledby="who">
      <h2 id="who">Who we are</h2>
      <dl>
        <div><dt>Seller</dt><dd>${esc(i.name)}</dd></div>
        ${i.registered_address ? `<div><dt>Registered office</dt><dd>${esc(i.registered_address)}</dd></div>` : ''}
        ${i.business_address ? `<div><dt>${i.registered_address ? 'Address' : 'Address'}</dt><dd>${esc([i.business_address, i.business_city, i.business_state].filter(Boolean).join(', '))}</dd></div>` : ''}
        ${i.gstin ? `<div><dt>GSTIN</dt><dd>${esc(i.gstin)}</dd></div>` : ''}
        <div><dt>Customer care</dt><dd><a href="mailto:${esc(i.care_email)}">${esc(i.care_email)}</a>${i.care_phone ? `<br>${tel(i.care_phone)}` : ''}<br><span class="fine">${esc(i.care_hours)}</span></dd></div>
        <div><dt>${esc(i.grievance_title)}</dt><dd>${i.grievance_name ? `${esc(i.grievance_name)}<br>` : ''}<a href="mailto:${esc(i.grievance_email)}">${esc(i.grievance_email)}</a>${i.grievance_phone ? `<br>${tel(i.grievance_phone)}` : ''}</dd></div>
      </dl>
      <p class="fine">Not resolved? You can also contact the National Consumer Helpline: call 1915 or visit consumerhelpline.gov.in.</p>
      ${i.dark_patterns_audit_date ? `<p class="fine">Dark patterns self-audit: this site was checked against the Guidelines for Prevention and Regulation of Dark Patterns, 2023, on ${esc(new Date(i.dark_patterns_audit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>` : ''}
    </aside>
  </div>`;

const f = $('[data-form]', main);
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-err]', f);
  err.textContent = '';
  if (f.website.value) return; // filled in by bots only
  const v = { name: $('#t-name', f).value.trim(), email: $('#t-email', f).value.trim(), phone: $('#t-phone', f).value.replace(/\D/g, ''), order: $('#t-order', f).value.trim(), cat: $('#t-cat', f).value, msg: $('#t-msg', f).value.trim() };
  const bad = [[!v.name, '#t-name', 'Tell us your name.'], [!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email), '#t-email', 'Enter a valid email so we can reply.'], [v.phone && !/^[6-9][0-9]{9}$/.test(v.phone), '#t-phone', 'Enter a 10-digit mobile number, or leave it empty.'], [v.msg.length < 10, '#t-msg', 'Tell us a little more (at least 10 characters).']].find(([c]) => c);
  if (bad) {
    $(bad[1], f).focus();
    return (err.textContent = bad[2]);
  }
  const btn = $('button[type=submit]', f);
  btn.disabled = true;
  if (!LIVE) {
    main.querySelector('.contact > div').innerHTML = `<h1 class="page-title">Thank you.</h1><p class="lede">Sample mode: messages are saved once the store is connected. In the live store you’d now get a reference number by email.</p>`;
    return;
  }
  const { data, error } = await supabase.rpc('open_ticket', { p_name: v.name, p_email: v.email, p_phone: v.phone, p_order: v.order, p_category: v.cat, p_message: v.msg });
  if (error || !data?.ok) {
    btn.disabled = false;
    return (err.textContent = { too_many: 'You’ve sent several messages today. We’ll reply to those first, or email us directly.', too_short: 'Tell us a little more (at least 10 characters).' }[data?.error] || 'That didn’t go through. Please try again, or email us.');
  }
  main.querySelector('.contact > div').innerHTML = `<h1 class="page-title">Thank you.</h1><p class="lede">Your reference is <strong>${esc(data.number)}</strong>. We’ve emailed you a copy of your message, and a person will reply soon.</p><a class="btn btn--ghost" href="../shop/">Back to the shop</a>`;
});
