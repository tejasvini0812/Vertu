import gsap from 'gsap';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const icons = {
  overview: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  products: I('<path d="M5 8h14l1 12H4L5 8zM9 8V6a3 3 0 0 1 6 0v2"/>'),
  orders: I('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  content: I('<path d="M4 5h16v14H4zM4 15l5-4 4 3 3-2 4 3"/>'),
  health: I('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  support: I('<path d="M4 5h16v11H8l-4 4V5z"/><path d="M8 9h8M8 12h5"/>'),
  returns: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  discounts: I('<path d="M20 12l-8 8-8-8V4h8l8 8z"/><circle cx="8.5" cy="8.5" r="1.5"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  search: I('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/>'),
  trash: I('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'),
};

/* ---------- toast ---------- */
let tt;
export function toast(msg, action) {
  const el = $('.toast');
  const btn = $('button', el);
  $('span', el).textContent = msg;
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => {
      clearTimeout(tt);
      el.classList.remove('is-on');
      action.run();
    };
  }
  el.classList.add('is-on');
  clearTimeout(tt);
  tt = setTimeout(() => el.classList.remove('is-on'), action ? 7000 : 3200);
}

/* ---------- confirm ---------- */
export function confirmDialog({ title, body, ok = 'Confirm' }) {
  const d = $('#confirm');
  $('#confirm-title').textContent = title;
  $('.confirm__body', d).textContent = body;
  $('[data-confirm-ok]', d).textContent = ok;
  return new Promise((res) => {
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true });
    d.returnValue = 'cancel';
    d.showModal();
  });
}

/* ---------- drawer ---------- */
const drawer = $('#drawer');
let lastFocus = null;
let onCloseCb = null;
export function openDrawer({ title, sub = '', body, foot = '', onClose }) {
  lastFocus = document.activeElement;
  $('#drawer-title').textContent = title;
  $('.drawer__sub', drawer).textContent = sub;
  $('.drawer__body', drawer).innerHTML = body;
  $('.drawer__foot', drawer).innerHTML = foot;
  $('.drawer__body', drawer).scrollTop = 0;
  onCloseCb = onClose || null;
  drawer.classList.add('is-open');
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('.drawer__body input, .drawer__body select, .drawer__head button', drawer)?.focus({ preventScroll: true }), 80);
  return drawer;
}
export function closeDrawer() {
  if (!drawer.classList.contains('is-open')) return;
  drawer.classList.remove('is-open');
  document.documentElement.style.overflow = '';
  onCloseCb && onCloseCb();
  onCloseCb = null;
  lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
}
export const drawerEl = drawer;
drawer.addEventListener('click', (e) => {
  if (e.target.closest('[data-drawer-close]')) closeDrawer();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Tab' && drawer.classList.contains('is-open')) {
    const f = $$('button, input, select, textarea, a[href]', $('.drawer__panel', drawer)).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  }
});

/* ---------- images ---------- */
export function resizeImage(file, max = 1400, q = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Choose an image file (JPG, PNG or WebP).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('That file could not be read as an image.')));
    img.src = url;
  });
}

/**
 * Wires a .drop element: click/drag to choose, shows preview.
 * get/set hold the image ref. Returns nothing; calls onChange(ref).
 */
export function mountDrop(root, { src, onChange, onError, max }) {
  const input = $('input[type=file]', root);
  const paint = (s) => {
    $('img', root)?.remove();
    root.classList.toggle('has-img', !!s);
    if (s) {
      const i = new Image();
      i.alt = '';
      i.src = s;
      root.prepend(i);
    }
    const act = $('.drop__actions', root);
    if (act) act.hidden = !s;
  };
  paint(src);
  const take = async (file) => {
    try {
      const data = await resizeImage(file, max);
      paint(data);
      onChange(data);
    } catch (e) {
      onError && onError(e.message);
    }
  };
  input.addEventListener('change', () => input.files[0] && take(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => root.addEventListener(t, (e) => (e.preventDefault(), root.classList.add('is-over'))));
  ['dragleave', 'drop'].forEach((t) => root.addEventListener(t, () => root.classList.remove('is-over')));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    e.dataTransfer.files[0] && take(e.dataTransfer.files[0]);
  });
  $('[data-replace]', root)?.addEventListener('click', () => input.click());
  return { paint };
}
export const dropHTML = (label = 'Drop an image or click to upload', tall = false) =>
  `<div class="drop ${tall ? 'drop--tall' : ''}">${icons.upload}<span>${label}</span>
   <input type="file" accept="image/*" aria-label="${label}" />
   <div class="drop__actions" hidden><button type="button" class="btn" data-replace>Replace image</button></div></div>`;

/* ---------- view listeners ----------
 * Views re-render into the same #view element. Each render calls listen(root) first, which removes the
 * previous render's root-level listeners, so handlers never stack up or fire for another view. */
const ctrls = new WeakMap();
export function listen(root) {
  ctrls.get(root)?.abort();
  const c = new AbortController();
  ctrls.set(root, c);
  return (type, fn) => root.addEventListener(type, fn, { signal: c.signal });
}

/* ---------- motion ---------- */
export function enter(root) {
  root.classList.remove('view-in');
  void root.offsetWidth;
  root.classList.add('view-in');
  requestAnimationFrame(() => root.classList.add('is-in'));
}
export function countUp(el, to, fmt) {
  if (reduced()) return (el.textContent = fmt(to));
  const o = { v: 0 };
  gsap.to(o, { v: to, duration: 1.4, ease: 'power3.out', onUpdate: () => (el.textContent = fmt(Math.round(o.v))) });
}
