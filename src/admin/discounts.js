import { getState, update, describeError, money } from '../store.js';
import { esc, $, $$, icons, toast, confirmDialog, openDrawer, closeDrawer, drawerEl, enter, listen } from './ui.js';

const describe = (c) => (c.kind === 'percent' ? `${c.value}% off` : `${money(c.value)} off`);
const state = (c) => {
  const now = Date.now();
  if (!c.active) return ['Off', 'pay-off'];
  if (c.ends_at && now > Date.parse(c.ends_at)) return ['Ended', 'pay-off'];
  if (c.starts_at && now < Date.parse(c.starts_at)) return ['Scheduled', 'pay-wait'];
  if (c.max_uses != null && c.used_count >= c.max_uses) return ['Used up', 'pay-off'];
  return ['Live', 'pay-ok'];
};
const day = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const save = (fn, msg) => {
  try {
    update(fn).catch(() => {});
    msg && toast(msg);
    return true;
  } catch (e) {
    toast(describeError(e));
    return false;
  }
};

export function renderDiscounts(root) {
  const on = listen(root);
  const list = getState().coupons || [];
  root.innerHTML = `
    <header class="page-head"><div><h1>Discounts</h1>
      <p>Codes shoppers type at checkout. Totals are always worked out by the store, so a code can’t be stretched further than you set.</p></div>
      <div class="page-head__actions"><button class="btn btn--ink" data-new>${icons.plus}New code</button></div></header>
    <div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Dates</th><th class="r">Used</th><th>State</th><th class="r"><span class="sr">Actions</span></th></tr></thead>
      <tbody>${
        list.length
          ? list
              .map((c) => {
                const [label, cls] = state(c);
                return `<tr data-code="${esc(c.code)}">
          <td><strong style="font-weight:600;letter-spacing:.04em">${esc(c.code)}</strong>${c.note ? `<br><span class="muted" style="font-size:.8125rem">${esc(c.note)}</span>` : ''}</td>
          <td>${describe(c)}</td>
          <td class="muted">${c.min_subtotal ? money(c.min_subtotal) : 'None'}</td>
          <td class="muted">${c.starts_at || c.ends_at ? `${day(c.starts_at) || 'Now'} – ${day(c.ends_at) || 'no end'}` : 'Always'}</td>
          <td class="r num">${c.used_count || 0}${c.max_uses != null ? ` / ${c.max_uses}` : ''}</td>
          <td><span class="pay ${cls}">${label}</span></td>
          <td><div class="row-actions">
            <label class="switch" title="On or off"><input type="checkbox" data-toggle ${c.active ? 'checked' : ''} aria-label="${esc(c.code)} active"><i></i></label>
            ${(c.used_count || 0) === 0 ? `<button class="icon-btn" data-del aria-label="Delete ${esc(c.code)}">${icons.trash}</button>` : ''}
          </div></td></tr>`;
              })
              .join('')
          : '<tr><td colspan="7"><p class="empty">No codes yet. Create one for a launch, a partner or a thank-you.</p></td></tr>'
      }</tbody></table></div>`;
  enter(root);
  const rerender = () => renderDiscounts(root);
  $('[data-new]', root).addEventListener('click', () => openForm(rerender));
  on('change', (e) => {
    if (!e.target.matches('[data-toggle]')) return;
    const code = e.target.closest('tr').dataset.code;
    save((s) => (s.coupons.find((c) => c.code === code).active = e.target.checked), e.target.checked ? `${code} is on` : `${code} is off`);
    rerender();
  });
  on('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    const code = e.target.closest('tr').dataset.code;
    if (!(await confirmDialog({ title: `Delete ${code}?`, body: 'It has never been used. Shoppers who type it will be told it isn’t valid.', ok: 'Delete' }))) return;
    save((s) => (s.coupons = s.coupons.filter((c) => c.code !== code)), `${code} deleted`);
    rerender();
  });
}

function openForm(done) {
  const body = `
    <form id="cform" class="field" style="gap:20px" novalidate>
      <div class="field"><label for="k-code">Code</label><input id="k-code" class="input" maxlength="24" autocapitalize="characters" placeholder="e.g. WELCOME10" style="text-transform:uppercase" />
        <small>Letters, numbers, - and _. Shoppers can type it in any case.</small><span class="err" data-err="code" role="alert"></span></div>
      <div class="row2">
        <div class="field"><label for="k-kind">Type</label><select id="k-kind" class="select"><option value="percent">Percentage off</option><option value="amount">Rupees off</option></select></div>
        <div class="field"><label for="k-val">Amount</label><input id="k-val" class="input" type="number" min="1" value="10" /><span class="err" data-err="value" role="alert"></span></div>
      </div>
      <div class="row2">
        <div class="field"><label for="k-min">Minimum order (₹)</label><input id="k-min" class="input" type="number" min="0" value="0" /></div>
        <div class="field"><label for="k-max">Total uses</label><input id="k-max" class="input" type="number" min="1" placeholder="No limit" /></div>
      </div>
      <div class="row2">
        <div class="field"><label for="k-start">Starts</label><input id="k-start" class="input" type="date" /></div>
        <div class="field"><label for="k-end">Ends (end of day)</label><input id="k-end" class="input" type="date" /><span class="err" data-err="end" role="alert"></span></div>
      </div>
      <div class="field"><label for="k-note">Note for the team <span class="muted">(optional)</span></label><input id="k-note" class="input" maxlength="120" placeholder="e.g. Instagram launch post" /></div>
    </form>`;
  openDrawer({ title: 'New discount code', sub: 'Applied at checkout before shipping is worked out', body, foot: '<button class="btn btn--ghost" data-drawer-close type="button">Cancel</button><button class="btn btn--ink" type="submit" form="cform">Create code</button>' });
  const d = drawerEl;
  $('#cform', d).addEventListener('submit', (e) => {
    e.preventDefault();
    $$('[data-err]', d).forEach((x) => (x.textContent = ''));
    const code = $('#k-code', d).value.trim().toUpperCase();
    const kind = $('#k-kind', d).value;
    const value = Math.round(Number($('#k-val', d).value));
    const start = $('#k-start', d).value;
    const end = $('#k-end', d).value;
    const err = (k, m) => (($(`[data-err=${k}]`, d).textContent = m), false);
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return err('code', 'Use 3–24 letters, numbers, - or _.');
    if ((getState().coupons || []).some((c) => c.code === code)) return err('code', 'That code already exists.');
    if (!(value >= 1) || (kind === 'percent' && value > 90)) return err('value', kind === 'percent' ? 'Choose 1–90%.' : 'Enter at least ₹1.');
    const starts_at = start ? new Date(`${start}T00:00:00+05:30`).toISOString() : null;
    const ends_at = end ? new Date(`${end}T23:59:59+05:30`).toISOString() : null;
    if (starts_at && ends_at && ends_at <= starts_at) return err('end', 'The end must be after the start.');
    const max = $('#k-max', d).value;
    const c = {
      code, kind, value, starts_at, ends_at, active: true, used_count: 0,
      min_subtotal: Math.max(0, Math.round(Number($('#k-min', d).value) || 0)),
      max_uses: max ? Math.max(1, Math.round(Number(max))) : null,
      note: $('#k-note', d).value.trim(),
      created_at: new Date().toISOString(),
    };
    if (save((s) => (s.coupons = [c, ...(s.coupons || [])]), `${code} created`)) {
      closeDrawer();
      done();
    }
  });
}
