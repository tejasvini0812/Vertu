import { LIVE, supabase } from './lib/supabase.js';

/** Footer sign-up form markup (shared by every page). */
export const newsletterForm = () => `
  <form class="news" data-news novalidate>
    <label for="news-email" class="news__label">New colours and launches, a few times a year.</label>
    <div class="news__row"><input class="news__input" id="news-email" type="email" autocomplete="email" placeholder="Your email" required /><button class="news__btn" type="submit">Subscribe</button></div>
    <p class="news__msg" role="status" aria-live="polite"></p>
  </form>`;

export function bindNewsletterForms(root = document) {
  root.querySelectorAll('[data-news]').forEach((f) => {
    if (f.dataset.bound) return;
    f.dataset.bound = '1';
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = f.querySelector('.news__msg');
      const input = f.querySelector('input');
      const email = input.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        msg.textContent = 'Enter a valid email address.';
        input.setAttribute('aria-invalid', 'true');
        return input.focus();
      }
      input.removeAttribute('aria-invalid');
      const btn = f.querySelector('button');
      btn.disabled = true;
      if (LIVE) {
        const { data, error } = await supabase.rpc('subscribe_newsletter', { p_email: email, p_source: location.pathname.split('/')[1] || 'home' });
        btn.disabled = false;
        if (error || !data?.ok) return (msg.textContent = 'That didn’t go through. Please try again.');
        msg.textContent = 'Almost there: check your inbox and confirm your email.';
      } else {
        btn.disabled = false;
        msg.textContent = 'Thanks. (Sample mode: nothing is sent.)';
      }
      input.value = '';
    });
  });
}
