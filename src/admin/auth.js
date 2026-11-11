import { LIVE, supabase, ARRIVED_FOR_RECOVERY } from '../lib/supabase.js';
import { esc, $ } from './ui.js';

/**
 * Admin sign-in gate (live mode only):
 *   password  ->  staff check  ->  two-step verification (authenticator app)  ->  portal
 * The database independently refuses admin reads/writes unless the session is two-step verified (aal2)
 * and the person is in admin_users, so this screen is a convenience, not the security boundary.
 */

export const session = { email: null, role: 'owner', userId: null, demo: !LIVE };

let recovering = ARRIVED_FOR_RECOVERY;
let root;

const shell = (title, sub, body) => `
  <div class="gate__card view-in">
    <span class="side__logo gate__logo" role="img" aria-label="VERTU"></span>
    <h1>${title}</h1>
    ${sub ? `<p class="gate__sub">${sub}</p>` : ''}
    ${body}
  </div>`;

const field = (id, label, type = 'text', extra = '') =>
  `<div class="field"><label for="${id}">${label}</label><input id="${id}" class="input" type="${type}" ${extra} /></div>`;

function screen(html, onSubmit) {
  root.innerHTML = html;
  const form = $('form', root);
  const err = $('[data-err]', root);
  const btn = form && $('button[type=submit]', form);
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'One moment…';
      try {
        await onSubmit(new FormData(form));
      } catch (x) {
        err.textContent = x.message || String(x);
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    setTimeout(() => $('input', form)?.focus(), 60);
  }
  return root;
}

const friendly = (error) => {
  const m = error?.message || '';
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(m)) return 'This email address has not been confirmed yet. Check your inbox.';
  if (/invalid totp|code.*(invalid|expired)/i.test(m)) return 'That code didn’t work. Codes change every 30 seconds, so try the newest one.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network/i.test(m)) return 'Could not reach the server. Check your connection.';
  return m || 'Something went wrong.';
};
const must = ({ data, error }) => {
  if (error) throw new Error(friendly(error));
  return data;
};

function signIn(done) {
  screen(
    shell(
      'Store manager',
      'Sign in with your VERTU staff account.',
      `<form novalidate>
        ${field('g-email', 'Email', 'email', 'name="email" autocomplete="username" required')}
        ${field('g-pass', 'Password', 'password', 'name="password" autocomplete="current-password" required')}
        <p class="err" data-err role="alert"></p>
        <button class="btn btn--ink" type="submit">Sign in</button>
        <button class="link-btn" type="button" data-forgot>Forgot your password?</button>
      </form>`,
    ),
    async (f) => {
      const email = String(f.get('email')).trim();
      const password = String(f.get('password'));
      if (!email || !password) throw new Error('Enter your email and password.');
      must(await supabase.auth.signInWithPassword({ email, password }));
      await step(done);
    },
  );
  $('[data-forgot]', root).addEventListener('click', () => forgot(done));
}

function forgot(done) {
  screen(
    shell(
      'Reset your password',
      'We’ll email you a link to choose a new one.',
      `<form novalidate>
        ${field('g-email', 'Email', 'email', 'name="email" autocomplete="username" required')}
        <p class="err" data-err role="alert"></p>
        <button class="btn btn--ink" type="submit">Send reset link</button>
        <button class="link-btn" type="button" data-back>Back to sign in</button>
      </form>`,
    ),
    async (f) => {
      const email = String(f.get('email')).trim();
      if (!email) throw new Error('Enter your email address.');
      must(await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
      root.innerHTML = shell(
        'Check your inbox',
        `If <strong>${esc(email)}</strong> has an account, a reset link is on its way. It works once and expires within the hour.`,
        `<button class="link-btn" type="button" data-back>Back to sign in</button>`,
      );
      $('[data-back]', root).addEventListener('click', () => signIn(done));
    },
  );
  $('[data-back]', root).addEventListener('click', () => signIn(done));
}

function newPassword(done) {
  screen(
    shell(
      'Choose a new password',
      'At least 10 characters. A short phrase is easier to remember than a jumble.',
      `<form novalidate>
        ${field('g-p1', 'New password', 'password', 'name="p1" autocomplete="new-password" minlength="10" required')}
        ${field('g-p2', 'Repeat it', 'password', 'name="p2" autocomplete="new-password" required')}
        <p class="err" data-err role="alert"></p>
        <button class="btn btn--ink" type="submit">Save password</button>
      </form>`,
    ),
    async (f) => {
      const p1 = String(f.get('p1'));
      if (p1.length < 10) throw new Error('Use at least 10 characters.');
      if (p1 !== f.get('p2')) throw new Error('The two passwords don’t match.');
      must(await supabase.auth.updateUser({ password: p1 }));
      recovering = false;
      history.replaceState(null, '', location.pathname);
      await step(done);
    },
  );
}

function noAccess(email) {
  root.innerHTML = shell(
    'No access yet',
    `<strong>${esc(email)}</strong> is signed in but isn’t on the VERTU staff list. Ask an owner to add you under Settings, then sign in again.`,
    `<button class="btn btn--ghost" type="button" data-out>Sign out</button>`,
  );
  $('[data-out]', root).addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

function verify(factorId, done) {
  screen(
    shell(
      'Two-step verification',
      'Enter the 6-digit code from your authenticator app.',
      `<form novalidate>
        ${field('g-code', 'Code', 'text', 'name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required')}
        <p class="err" data-err role="alert"></p>
        <button class="btn btn--ink" type="submit">Verify</button>
        <button class="link-btn" type="button" data-out>Use a different account</button>
      </form>`,
    ),
    async (f) => {
      const code = String(f.get('code')).replace(/\D/g, '');
      if (code.length !== 6) throw new Error('Enter all 6 digits.');
      must(await supabase.auth.mfa.challengeAndVerify({ factorId, code }));
      await step(done);
    },
  );
  $('[data-out]', root).addEventListener('click', async () => {
    await supabase.auth.signOut();
    signIn(done);
  });
}

async function enroll(all, done) {
  for (const f of all.filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
  const data = must(await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VERTU Studio' }));
  screen(
    shell(
      'Two-step verification',
      'One-time setup: the store manager needs a second step to sign in. Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the code it shows.',
      `<div class="gate__qr"><img src="${esc(data.totp.qr_code)}" alt="QR code for your authenticator app" width="180" height="180" /></div>
       <p class="gate__secret">Can’t scan? Enter this key instead:<br><code>${esc(data.totp.secret)}</code></p>
       <form novalidate>
        ${field('g-code', 'Code from the app', 'text', 'name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required')}
        <p class="err" data-err role="alert"></p>
        <button class="btn btn--ink" type="submit">Turn on and continue</button>
      </form>`,
    ),
    async (f) => {
      const code = String(f.get('code')).replace(/\D/g, '');
      if (code.length !== 6) throw new Error('Enter all 6 digits.');
      must(await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code }));
      await step(done);
    },
  );
}

async function step(done) {
  if (recovering) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return newPassword(done);
  }
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return signIn(done);
  const user = sess.session.user;

  const { data: me, error } = await supabase.from('admin_users').select('role').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(friendly(error));
  if (!me) return noAccess(user.email);

  const aal = must(await supabase.auth.mfa.getAuthenticatorAssuranceLevel());
  if (aal.currentLevel !== 'aal2') {
    const factors = must(await supabase.auth.mfa.listFactors());
    const ready = (factors.totp || []).find((f) => f.status === 'verified');
    if (ready) return verify(ready.id, done);
    return enroll(factors.all || [], done);
  }

  Object.assign(session, { email: user.email, role: me.role, userId: user.id, demo: false });
  root.remove();
  document.body.classList.remove('gated');
  done(session);
}

/** Resolves with { email, role } once the person is a verified staff member. Demo mode resolves at once. */
export function gate() {
  if (!LIVE) return Promise.resolve(session);
  document.body.classList.add('gated');
  root = document.createElement('main');
  root.className = 'gate';
  root.id = 'gate';
  document.body.prepend(root);
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      recovering = true;
      if (document.body.classList.contains('gated')) setTimeout(() => step(resolveGate), 0);
    }
    if (event === 'SIGNED_OUT' && !document.body.classList.contains('gated')) location.reload();
  });
  let resolveGate;
  return new Promise((resolve) => {
    resolveGate = resolve;
    root.innerHTML = '<p class="gate__loading">Loading…</p>';
    step(resolve).catch((e) => {
      root.innerHTML = shell('Can’t connect', esc(friendly(e)), '<button class="btn btn--ghost" type="button" onclick="location.reload()">Try again</button>');
    });
  });
}

export async function signOut() {
  if (LIVE) await supabase.auth.signOut();
  location.reload();
}
