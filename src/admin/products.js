import { getState, update, subscribe, money, CATEGORIES, skuFor, resolveImage } from '../store.js';
import { esc, $, $$, icons, toast, confirmDialog, openDrawer, closeDrawer, drawerEl, mountDrop, dropHTML, enter } from './ui.js';

let filter = 'all';
let q = '';
let stockOnly = false;
let flashId = null;

const catName = (id) => CATEGORIES.find((c) => c.id === id)?.name || id;
const safeSave = (fn, okMsg) => {
  try {
    update(fn);
    okMsg && toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message === 'storage-full' ? 'Browser storage is full. Remove some uploaded images and try again.' : 'Could not save that change.');
    return false;
  }
};

export function renderProducts(root, params) {
  if (params.get('stock') === 'low') {
    stockOnly = true;
    history.replaceState(null, '', '#/products');
  }
  const s = getState();
  const th = s.settings.lowStock;
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, s.products.filter((p) => p.category === c.id).length]));
  const rows = s.products
    .filter((p) => filter === 'all' || p.category === filter)
    .filter((p) => !stockOnly || p.stock <= th)
    .filter((p) => !q || `${p.id} ${p.colour} ${catName(p.category)}`.toLowerCase().includes(q.toLowerCase()));

  root.innerHTML = `
    <header class="page-head">
      <div><h1>Products &amp; inventory</h1>
      <p>Each colour is its own item with its own price and stock. Edit price or stock right in the table.</p></div>
      <div class="page-head__actions"><button class="btn btn--ink" data-add>${icons.plus}Add product</button></div>
    </header>
    <div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Collection">
        <button role="tab" data-f="all" aria-selected="${filter === 'all'}">All<sup>${s.products.length}</sup></button>
        ${CATEGORIES.map((c) => `<button role="tab" data-f="${c.id}" aria-selected="${filter === c.id}">${c.name}<sup>${counts[c.id]}</sup></button>`).join('')}
      </div>
      <div class="tools">
        <label class="switch"><input type="checkbox" data-low ${stockOnly ? 'checked' : ''}><i></i>Low stock only</label>
        <div class="search"><span aria-hidden="true">${icons.search}</span>
          <input class="input" type="search" placeholder="Search colour or SKU" aria-label="Search products" value="${esc(q)}" data-q /></div>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Product</th><th>Collection</th><th class="r">Price (₹)</th><th class="r">Stock</th><th>Status</th><th class="r"><span class="sr">Actions</span></th></tr></thead>
      <tbody>${
        rows.length
          ? rows
              .map(
                (p) => `<tr data-id="${p.id}" class="${flashId === p.id ? 'is-new' : ''}">
        <td><div class="prod"><img src="${esc(resolveImage(p.image))}" alt="" /><div><strong><span class="swatch-dot" style="background:${esc(p.hex)}"></span> ${esc(p.colour)}</strong><span>${p.id}</span></div></div></td>
        <td class="muted">${catName(p.category)}</td>
        <td class="r"><input class="cell-input" data-price type="number" min="0" step="1" value="${p.price}" aria-label="Price for ${esc(p.colour)} ${p.id}" /></td>
        <td class="r"><div class="stock-cell">
          ${p.stock === 0 ? '<span class="pill pill--ink">Sold out</span>' : p.stock <= th ? `<span class="pill pill--line">Low</span>` : ''}
          <div class="stepper"><button type="button" data-step="-1" aria-label="Decrease stock">&minus;</button>
          <input data-stock type="number" min="0" step="1" value="${p.stock}" aria-label="Stock for ${esc(p.colour)} ${p.id}" />
          <button type="button" data-step="1" aria-label="Increase stock">+</button></div></div></td>
        <td><label class="switch"><input type="checkbox" data-active ${p.status === 'active' ? 'checked' : ''} aria-label="Show ${esc(p.colour)} ${p.id} in the store"><i></i><span>${p.status === 'active' ? 'Active' : 'Draft'}</span></label></td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit aria-label="Edit ${esc(p.colour)} ${p.id}">${icons.edit}</button>
          <button class="icon-btn" data-del aria-label="Remove ${esc(p.colour)} ${p.id}">${icons.trash}</button></div></td></tr>`,
              )
              .join('')
          : `<tr><td colspan="6"><p class="empty">No products match. ${stockOnly || q ? 'Try clearing the filters.' : ''}</p></td></tr>`
      }</tbody></table></div>`;
  flashId = null;
  enter(root);
  wire(root);
}

function wire(root) {
  const rerender = () => renderProducts(root, new URLSearchParams());
  $$('[data-f]', root).forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.f;
      rerender();
    }),
  );
  $('[data-low]', root).addEventListener('change', (e) => {
    stockOnly = e.target.checked;
    rerender();
  });
  const qi = $('[data-q]', root);
  qi.addEventListener('input', () => {
    q = qi.value;
    const pos = qi.selectionStart;
    rerender();
    const n = $('[data-q]', root);
    n.focus();
    n.setSelectionRange(pos, pos);
  });
  $('[data-add]', root).addEventListener('click', () => openForm());

  const idOf = (el) => el.closest('tr').dataset.id;
  const commitNumber = (el, key, label) => {
    const id = idOf(el);
    const p = getState().products.find((x) => x.id === id);
    const v = Math.max(0, Math.round(Number(el.value)));
    if (el.value === '' || Number.isNaN(v)) {
      el.value = p[key];
      return;
    }
    if (v === p[key]) return (el.value = v);
    if (safeSave((st) => (st.products.find((x) => x.id === id)[key] = v), `${label} updated for ${p.colour}`)) rerender();
  };
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-price]')) commitNumber(t, 'price', 'Price');
    else if (t.matches('[data-stock]')) commitNumber(t, 'stock', 'Stock');
    else if (t.matches('[data-active]')) {
      const id = idOf(t);
      safeSave((st) => (st.products.find((x) => x.id === id).status = t.checked ? 'active' : 'draft'), t.checked ? 'Now visible in the store' : 'Moved to draft, hidden from the store');
      rerender();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.cell-input, [data-stock]')) e.target.blur();
  });
  root.addEventListener('click', async (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const inp = $('[data-stock]', step.closest('td'));
      inp.value = Math.max(0, Number(inp.value) + Number(step.dataset.step));
      commitNumber(inp, 'stock', 'Stock');
      return;
    }
    if (e.target.closest('[data-edit]')) return openForm(idOf(e.target));
    if (e.target.closest('[data-del]')) {
      const id = idOf(e.target);
      const p = getState().products.find((x) => x.id === id);
      const idx = getState().products.indexOf(p);
      const ok = await confirmDialog({
        title: `Remove ${p.colour}?`,
        body: `${catName(p.category)}, ${p.id}. It will disappear from the store. Existing orders are not affected.`,
        ok: 'Remove product',
      });
      if (!ok) return;
      const copy = structuredClone(p);
      if (
        safeSave((st) => st.products.splice(idx, 1))
      ) {
        rerender();
        toast(`${p.colour} removed`, {
          label: 'Undo',
          run: () => {
            safeSave((st) => st.products.splice(Math.min(idx, st.products.length), 0, copy));
            rerender();
          },
        });
      }
    }
  });
}

function openForm(id) {
  const st = getState();
  const editing = id ? st.products.find((p) => p.id === id) : null;
  const draft = editing
    ? structuredClone(editing)
    : { category: filter === 'all' ? 'sling' : filter, colour: '', hex: '#4a7048', price: 1799, stock: 10, status: 'active', image: '', description: '' };
  if (!editing) draft.image = `asset:${draft.category}`;

  const body = `
    <form id="pform" class="field" style="gap:22px" novalidate>
      <div class="field"><span class="label">Photo</span>${dropHTML('Drop a photo or click to upload')}<small>JPG, PNG or WebP. Resized to fit in this browser.</small><span class="err" data-err="img" role="alert"></span></div>
      <div class="row2">
        <div class="field"><label for="f-cat">Collection</label>
          <select id="f-cat" class="select" ${editing ? 'disabled' : ''}>${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === draft.category ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
        <div class="field"><label for="f-colour">Colour name</label>
          <input id="f-colour" class="input" value="${esc(draft.colour)}" placeholder="e.g. Tan" required /><span class="err" data-err="colour" role="alert"></span></div>
      </div>
      <div class="field"><label for="f-hex">Swatch</label>
        <div class="colour-field"><input id="f-hexp" type="color" value="${esc(draft.hex)}" aria-label="Pick swatch colour" /><input id="f-hex" class="input" value="${esc(draft.hex)}" maxlength="7" /></div></div>
      <div class="row2">
        <div class="field"><label for="f-price">Price (₹)</label><input id="f-price" class="input" type="number" min="0" step="1" value="${draft.price}" /><span class="err" data-err="price" role="alert"></span></div>
        <div class="field"><label for="f-stock">Stock</label><input id="f-stock" class="input" type="number" min="0" step="1" value="${draft.stock}" /><span class="err" data-err="stock" role="alert"></span></div>
      </div>
      <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" class="textarea">${esc(draft.description)}</textarea><small>Shown in the store when this colour is selected.</small></div>
      <label class="switch"><input id="f-active" type="checkbox" ${draft.status === 'active' ? 'checked' : ''}><i></i>Show in the store</label>
    </form>`;
  const foot = `<button class="btn btn--ghost" data-drawer-close type="button">Cancel</button><button class="btn btn--ink" type="submit" form="pform" id="pform-save">${editing ? 'Save changes' : 'Add product'}</button>`;
  openDrawer({ title: editing ? `Edit ${editing.colour}` : 'New product', sub: editing ? `${catName(editing.category)}, ${editing.id}` : 'Added as a new colour in a collection', body, foot });

  const d = drawerEl;
  const img = mountDrop($('.drop', d), {
    src: resolveImage(draft.image),
    onChange: (data) => ((draft.image = data), ($('[data-err=img]', d).textContent = '')),
    onError: (m) => ($('[data-err=img]', d).textContent = m),
  });
  const catSel = $('#f-cat', d);
  catSel.addEventListener('change', () => {
    if (!editing && String(draft.image).startsWith('asset:')) {
      draft.image = `asset:${catSel.value}`;
      img.paint(resolveImage(draft.image));
    }
  });
  const hex = $('#f-hex', d);
  const hp = $('#f-hexp', d);
  hp.addEventListener('input', () => (hex.value = hp.value));
  hex.addEventListener('input', () => /^#[0-9a-f]{6}$/i.test(hex.value) && (hp.value = hex.value));

  $('#pform', d).addEventListener('submit', (e) => {
    e.preventDefault();
    const colour = $('#f-colour', d).value.trim();
    const price = Number($('#f-price', d).value);
    const stock = Number($('#f-stock', d).value);
    const errs = {
      colour: !colour ? 'Give this colour a name.' : '',
      price: !(price >= 0) || $('#f-price', d).value === '' ? 'Enter a price of 0 or more.' : '',
      stock: !(stock >= 0) || $('#f-stock', d).value === '' ? 'Enter a stock count of 0 or more.' : '',
    };
    Object.entries(errs).forEach(([k, m]) => {
      $(`[data-err=${k}]`, d).textContent = m;
    });
    if (Object.values(errs).some(Boolean)) return $('#pform [aria-invalid], #pform input', d).focus();
    const cat = catSel.value;
    const hv = /^#[0-9a-f]{6}$/i.test(hex.value) ? hex.value : draft.hex;
    const fields = {
      colour,
      hex: hv,
      price: Math.round(price),
      stock: Math.round(stock),
      description: $('#f-desc', d).value.trim(),
      status: $('#f-active', d).checked ? 'active' : 'draft',
      image: draft.image,
    };
    let newId = null;
    const ok = safeSave((s) => {
      if (editing) Object.assign(s.products.find((p) => p.id === editing.id), fields);
      else {
        const n = s.products.filter((p) => p.category === cat).length + 1;
        let sku = skuFor(cat, colour, n);
        let k = n;
        while (s.products.some((p) => p.id === sku)) sku = skuFor(cat, colour, ++k);
        newId = sku;
        s.products.push({ id: sku, category: cat, ...fields });
      }
    }, editing ? 'Changes saved' : `${colour} added to ${catName(cat)}`);
    if (!ok) return;
    flashId = newId || editing.id;
    closeDrawer();
    if (!editing) filter = cat;
    renderProducts($('#view'), new URLSearchParams());
  });
}
