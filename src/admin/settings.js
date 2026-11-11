import { getState, update, describeError, LIVE, supabase } from '../store.js';
import { session, signOut } from './auth.js';
import { esc, $, toast, confirmDialog, enter, listen } from './ui.js';

const ENTITY = { products: 'Product', orders: 'Order', site_content: 'Editorial', settings: 'Settings', admin_users: 'Team' };
const when = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function describe(a) {
  const c = a.changes || {};
  const keys = Object.keys(c);
  if (a.entity === 'products' && a.action === 'update') {
    return keys
      .map((k) => (c[k] && typeof c[k] === 'object' && 'to' in c[k] ? `${k} ${c[k].from} → ${c[k].to}` : `${k} changed`))
      .join(', ');
  }
  if (a.entity === 'orders') return c.status ? `status ${c.status.from} → ${c.status.to}` : keys.join(', ');
  if (a.entity === 'site_content') return 'published editorial changes';
  if (a.entity === 'admin_users') return a.action === 'delete' ? 'removed a team member' : `role: ${c.role?.to || c.role || ''}`;
  return a.action === 'insert' ? 'created' : a.action === 'delete' ? 'deleted' : keys.join(', ');
}

export async function renderSettings(root) {
  const on = listen(root);
  const owner = session.role === 'owner';
  const s = getState();
  root.innerHTML = `
    <header class="page-head"><div><h1>Settings</h1>
      <p>${owner ? 'Your account, the team who can use the store manager, and a record of recent changes.' : 'Your account and store preferences.'}</p></div></header>

    <section class="block" aria-labelledby="s-acc">
      <div class="block__intro"><h2 id="s-acc">Your account</h2><p>${LIVE ? 'Signed in with two-step verification.' : 'Sample mode. No accounts until the database is connected.'}</p></div>
      <div class="block__form">
        ${
          LIVE
            ? `<dl style="margin:0"><div class="kv"><dt>Email</dt><dd>${esc(session.email)}</dd></div>
               <div class="kv"><dt>Role</dt><dd>${owner ? 'Owner: everything, including the team and removing products' : 'Staff: products, stock, orders and editorial'}</dd></div></dl>
               <div><button class="btn btn--ghost" data-signout>Sign out</button></div>`
            : '<p class="muted">Add your Supabase keys to switch to live data. The README explains how.</p>'
        }
      </div>
    </section>

    <section class="block" aria-labelledby="s-stock">
      <div class="block__intro"><h2 id="s-stock">Low-stock alert</h2><p>Colours at or below this number are flagged on the overview and in products.</p></div>
      <div class="block__form">
        <form class="inline-form" data-stock-form style="grid-template-columns:160px max-content">
          <div class="field"><label for="s-low">Alert at</label><input id="s-low" class="input" type="number" min="0" max="999" value="${s.settings.lowStock}" ${owner ? '' : 'disabled'} /></div>
          ${owner ? '<button class="btn btn--ink" type="submit">Save</button>' : '<p class="muted" style="align-self:center">Only an owner can change this.</p>'}
        </form>
      </div>
    </section>

    ${
      owner && LIVE
        ? `<section class="block" aria-labelledby="s-team">
      <div class="block__intro"><h2 id="s-team">Team</h2><p>People who can sign in here. They need an account first: create one in Supabase under Authentication, then add their email.</p></div>
      <div class="block__form">
        <div class="list" data-team><p class="empty">Loading…</p></div>
        <form class="inline-form" data-add-form novalidate>
          <div class="field"><label for="t-email">Email</label><input id="t-email" class="input" type="email" autocomplete="off" required /></div>
          <div class="field"><label for="t-role">Role</label><select id="t-role" class="select"><option value="staff">Staff</option><option value="owner">Owner</option></select></div>
          <button class="btn btn--ink" type="submit">Add</button>
        </form>
        <p class="err" data-team-err role="alert"></p>
      </div>
    </section>
    <section class="block" aria-labelledby="s-act">
      <div class="block__intro"><h2 id="s-act">Recent activity</h2><p>Every change to products, orders, editorial and the team, with who made it.</p></div>
      <div class="block__form"><ul class="activity" data-activity><li><span class="muted">Loading…</span></li></ul></div>
    </section>`
        : ''
    }`;
  enter(root);

  $('[data-signout]', root)?.addEventListener('click', signOut);

  $('[data-stock-form]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Math.round(Number($('#s-low', root).value));
    if (!(v >= 0 && v <= 999)) return toast('Enter a number from 0 to 999.');
    try {
      update((st) => (st.settings.lowStock = v)).then(() => toast('Low-stock alert saved'), () => {});
      if (!LIVE) toast('Low-stock alert saved');
    } catch (err) {
      toast(describeError(err));
    }
  });

  if (!(owner && LIVE)) return;

  const loadTeam = async () => {
    const { data, error } = await supabase.rpc('team_list');
    const box = $('[data-team]', root);
    if (!box) return;
    if (error) return (box.innerHTML = `<p class="empty">${esc(describeError(error))}</p>`);
    box.innerHTML = data
      .map(
        (m) => `<div class="list__row"><div class="list__main"><strong>${esc(m.email)}</strong>
          <span>${m.role === 'owner' ? 'Owner' : 'Staff'}${m.last_sign_in_at ? `, last signed in ${when(m.last_sign_in_at)}` : ''}</span></div>
          ${m.user_id === session.userId ? '<span class="pill">You</span>' : `<button class="text-btn" data-remove="${m.user_id}" data-email="${esc(m.email)}">Remove</button>`}</div>`,
      )
      .join('');
  };
  const loadActivity = async () => {
    const { data, error } = await supabase.rpc('activity', { p_limit: 40 });
    const ul = $('[data-activity]', root);
    if (!ul) return;
    if (error) return (ul.innerHTML = `<li>${esc(describeError(error))}</li>`);
    ul.innerHTML = data.length
      ? data
          .map(
            (a) => `<li><time>${when(a.created_at)}</time><span><strong style="font-weight:500">${esc(ENTITY[a.entity] || a.entity)}${a.entity_id && a.entity !== 'site_content' && a.entity !== 'settings' ? ` ${esc(a.entity_id.length > 20 ? '' : a.entity_id)}` : ''}</strong>: ${esc(describe(a))}<br><span class="muted">${esc(a.email || 'system')}</span></span></li>`,
          )
          .join('')
      : '<li><span class="muted">Nothing yet.</span></li>';
  };
  loadTeam();
  loadActivity();

  $('[data-add-form]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-team-err]', root);
    err.textContent = '';
    const email = $('#t-email', root).value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'Enter a valid email address.');
    const { error } = await supabase.rpc('team_grant', { p_email: email, p_role: $('#t-role', root).value });
    if (error) {
      err.textContent = /no_account/.test(error.message)
        ? 'There’s no account with that email yet. Create it in Supabase (Authentication → Add user), then add it here.'
        : /cannot_demote_self/.test(error.message)
          ? 'You can’t remove your own owner role.'
          : describeError(error);
      return;
    }
    $('#t-email', root).value = '';
    toast(`${email} added`);
    loadTeam();
    loadActivity();
  });
  on('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const ok = await confirmDialog({ title: 'Remove from the team?', body: `${b.dataset.email} will no longer be able to use the store manager. Their account itself is kept.`, ok: 'Remove' });
    if (!ok) return;
    const { error } = await supabase.rpc('team_revoke', { p_user: b.dataset.remove });
    if (error) return toast(describeError(error));
    toast('Removed from the team');
    loadTeam();
    loadActivity();
  });
}
