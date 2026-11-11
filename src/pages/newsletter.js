import '../styles.css';
import '../pages.css';
import { mountChrome } from '../chrome.js';
import { LIVE, supabase } from '../lib/supabase.js';
import { newsletterForm, bindNewsletterForms } from '../newsletter.js';
import { $ } from './ui.js';

mountChrome();
const main = $('#main');
const q = new URLSearchParams(location.search);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const say = (title, body, extra = '') =>
  (main.innerHTML = `<div class="signin"><h1 class="page-title">${title}</h1><p class="lede" style="margin-top:0">${body}</p>${extra}</div>`);

async function run() {
  const confirm = q.get('confirm');
  const unsub = q.get('unsubscribe');
  if (confirm) {
    if (!LIVE || !UUID.test(confirm)) return say('That link didn’t work.', 'It may be incomplete. Sign up again from the bottom of any page.');
    const { data } = await supabase.rpc('confirm_newsletter', { p_token: confirm });
    return data?.ok
      ? say('You’re subscribed.', 'We’ll write when there are new colours and launches. A few times a year, never shared.', '<a class="btn btn--ink" href="../shop/">Visit the shop</a>')
      : say('That link didn’t work.', 'It may have been used to unsubscribe already. Sign up again from the bottom of any page.');
  }
  if (unsub) {
    // A button rather than an automatic unsubscribe, so email security scanners that open links can't unsubscribe people.
    say('Unsubscribe?', 'You’ll stop getting VERTU news. Emails about your orders still arrive.', '<button class="btn btn--ink" type="button" data-go>Unsubscribe</button>');
    $('[data-go]', main).addEventListener('click', async () => {
      if (!LIVE || !UUID.test(unsub)) return say('That link didn’t work.', 'It may be incomplete.');
      const { data } = await supabase.rpc('unsubscribe_newsletter', { p_token: unsub });
      say(data?.ok ? 'You’re unsubscribed.' : 'That link didn’t work.', data?.ok ? 'Sorry to see you go. You can sign up again any time.' : 'It may be incomplete.');
    });
    return;
  }
  say('VERTU news', 'New colours and launches, a few times a year. Never shared.', newsletterForm());
  bindNewsletterForms(main);
}
run();
