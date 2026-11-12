import '../styles.css';
import '../pages.css';
import { mountChrome } from '../chrome.js';
import { legalInfo } from '../legal/info.js';
import { policy, POLICY_PAGES } from '../legal/policies.js';
import { $ } from './ui.js';

mountChrome();
const main = $('#main');
const key = new URLSearchParams(location.search).get('p') || 'privacy';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const info = await legalInfo();
const sections = policy(key, info);
if (!sections) {
  main.innerHTML = `<div class="empty-state"><h1 class="page-title">Page not found.</h1><a class="btn btn--ink" href="?p=privacy">See our policies</a></div>`;
} else {
  document.title = `${POLICY_PAGES[key]} | VERTU`;
  const updated = info.policies_updated_at ? new Date(info.policies_updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  main.innerHTML = `
    <div class="legal">
      <nav class="legal__nav" aria-label="Policies">${Object.entries(POLICY_PAGES).map(([k, v]) => `<a href="?p=${k}" ${k === key ? 'aria-current="page"' : ''}>${v}</a>`).join('')}<a href="../contact/">Contact and grievances</a></nav>
      <article class="legal__body">
        <h1 class="page-title">${esc(POLICY_PAGES[key])}</h1>
        ${updated ? `<p class="fine">Last updated ${updated}</p>` : ''}
        ${sections.map((s) => `<section><h2>${esc(s.h)}</h2>${s.body}</section>`).join('')}
        <section><h2>Questions</h2><p>Write to <a href="mailto:${esc(info.care_email)}">${esc(info.care_email)}</a> or use our <a href="../contact/">contact form</a>.</p></section>
      </article>
    </div>`;
}
