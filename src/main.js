import './styles.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { GL } from './gl.js';
import { PRODUCTS, HERO_SLIDES, CRAFT_IMAGES, CONTENT, fmt, firstInStock } from './data.js';
import { cart, initCartUI, toast } from './cart.js';
import { bindAccountLink } from './chrome.js';
import { newsletterForm, bindNewsletterForms } from './newsletter.js';
import './customer.js';

gsap.registerPlugin(ScrollTrigger);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const desktop = window.matchMedia('(min-width: 900px)');
const root = document.documentElement;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Wrap each word in a masked span so it can rise into place. Keeps an accessible copy. */
function splitWords(el) {
  const text = el.textContent.trim();
  const words = text.split(/\s+/);
  el.innerHTML =
    `<span class="sr">${text}</span>` +
    `<span aria-hidden="true">${words
      .map((w) => `<span class="w"><span class="wi">${w}</span></span>`)
      .join(' ')}</span>`;
  return $$('.wi', el);
}

// price labels everywhere
$$('[data-price]').forEach((el) => (el.textContent = fmt(PRODUCTS[el.dataset.price].price)));
$$('[data-year]').forEach((el) => (el.textContent = new Date().getFullYear()));

/** Copy, images and the announcement bar come from the shared store (edited in /admin). */
function applyContent() {
  const { hero, collections, announcement } = CONTENT;
  if (HERO_SLIDES.length === 1) HERO_SLIDES.push({ ...HERO_SLIDES[0] });

  $('.hero h1').textContent = hero.headline;
  $('.hero__sub').textContent = hero.sub;
  $('.hero .btn--light').textContent = hero.cta;
  if (HERO_SLIDES[0]) $('.hero__fallback').src = HERO_SLIDES[0].src;

  collections.forEach((c) => {
    const art = $(`.collection__media[data-select="${c.id}"]`)?.closest('.collection');
    if (!art) return;
    art.hidden = !c.visible;
    $('h3', art).textContent = c.title;
    $('.collection__text p', art).textContent = c.description;
    const img = $('img', art);
    const url = c.image && !c.image.startsWith('asset:') ? c.image : null;
    if (url) {
      img.src = url;
      img.alt = c.title;
    }
  });

  const bar = $('#announce');
  if (announcement.enabled && announcement.text) {
    bar.hidden = false;
    $('p', bar).textContent = announcement.text;
    const a = $('a', bar);
    if (announcement.linkLabel) {
      a.textContent = announcement.linkLabel;
      a.href = announcement.linkHref || '#shop';
    } else a.remove();
    root.classList.add('has-announce');
  }
}
applyContent();

/* ------------------------------------------------------------------ */
/* smooth scroll                                                       */
/* ------------------------------------------------------------------ */

let lenis = null;
if (!reduce) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

const scrollToTarget = (target, offset = 0) => {
  if (lenis) lenis.scrollTo(target, { offset, duration: 1.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else target.scrollIntoView?.({ behavior: 'auto' });
};

$$('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const target = id === '#top' ? document.body : $(id);
    if (!target) return;
    e.preventDefault();
    scrollToTarget(id === '#top' ? 0 : target, id === '#top' ? 0 : id === '#buy' ? -40 : 0);
  });
});

/* ------------------------------------------------------------------ */
/* WebGL planes                                                        */
/* ------------------------------------------------------------------ */

const gl = new GL($('#gl'));
const planes = new Map();
const heroStage = $('[data-hero]');

if (gl.ok) {
  // hero (sequence plane)
  const hp = gl.add(heroStage, { src: HERO_SLIDES[0].src, parAmp: 0.05 });
  planes.set(heroStage, hp);

  $$('[data-gl]').forEach((el) => {
    const img = $('img', el);
    const p = gl.add(el, {
      src: img.currentSrc || img.src,
      axis: el.dataset.axis === 'x' ? 1 : 0,
      flip: el.dataset.flip ? 1 : 0,
      parAmp: parseFloat(el.dataset.par || '0'),
    });
    planes.set(el, p);
  });

  const craftEl = $('[data-craft-media]');
  planes.set(craftEl, gl.add(craftEl, { src: CRAFT_IMAGES[0], parAmp: 0.04 }));
  const buyEl = $('[data-buy-media]');
  planes.set(buyEl, gl.add(buyEl, { src: PRODUCTS.sling.colours[Math.max(0, firstInStock('sling'))].img, parAmp: 0.03 }));

  // hover distortion
  $$('[data-hover]').forEach((el) => {
    const p = planes.get(el);
    if (!p || !finePointer || reduce) return;
    el.addEventListener('pointerenter', () =>
      gsap.to(p.u.uHover, { value: 1, duration: 0.9, ease: "power3.out", overwrite: true }),
    );
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      p.mouse.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
    });
    el.addEventListener('pointerleave', () =>
      gsap.to(p.u.uHover, { value: 0, duration: 0.9, ease: 'power3.out', overwrite: true }),
    );
  });

  gsap.ticker.add((time) => {
    gl.render(time, lenis ? lenis.velocity / 90 : 0);
  });
}

/* ------------------------------------------------------------------ */
/* loader + hero intro                                                 */
/* ------------------------------------------------------------------ */

const heroH1 = $('.hero h1');
const heroWords = splitWords(heroH1);
const heroBits = $$('.hero__sub, .hero__actions, .hero__meta');
const sectionHeads = $$('[data-split]').filter((el) => el !== heroH1);
sectionHeads.forEach((el) => (el._words = splitWords(el)));

gsap.set(heroWords, { yPercent: 115 });
gsap.set(heroBits, { opacity: 0 });
gsap.set('.nav', { yPercent: -100 });

let heroPlane = planes.get(heroStage);
if (heroPlane) {
  heroPlane.u.uReveal.value = 0;
  heroPlane.u.uScale.value = 1.3;
}

async function runIntro() {
  const loaderLogo = $('.loader__logo');
  const loader = $('.loader');

  if (gl.ok) {
    try {
      await Promise.all([...planes.values()].map((p) => p.ready));
      await gl.setPair(heroPlane, HERO_SLIDES[0].src, HERO_SLIDES[1].src);
    } catch (e) {
      /* a missing texture should never block the page */
    }
    root.classList.add('gl-on');
  }

  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  if (!reduce) {
    tl.to(loaderLogo, { clipPath: 'inset(0 0% 0 0)', duration: 1.1, ease: 'power3.inOut' })
      .to({}, { duration: 0.25 })
      .to(loader, { yPercent: -100, duration: 1.2, ease: 'expo.inOut' }, '>');
    if (heroPlane) {
      tl.to(heroPlane.u.uReveal, { value: 1, duration: 1.6, ease: 'expo.inOut' }, '<0.1').to(
        heroPlane.u.uScale,
        { value: 1, duration: 2.4, ease: 'expo.out' },
        '<',
      );
    }
    tl.to(heroWords, { yPercent: 0, duration: 1.4, stagger: 0.09 }, '<0.55')
      .to(heroBits, { opacity: 1, duration: 1.2, stagger: 0.12, ease: 'power2.out' }, '<0.35')
      .to('.nav', { yPercent: 0, duration: 1.1 }, '<0.2');
  } else {
    gsap.set(loader, { display: 'none' });
    gsap.set(heroWords, { yPercent: 0 });
    gsap.set(heroBits, { opacity: 1 });
    gsap.set('.nav', { yPercent: 0 });
    if (heroPlane) {
      heroPlane.u.uReveal.value = 1;
      heroPlane.u.uScale.value = 1;
    }
  }
  tl.add(() => {
    root.classList.add('is-ready');
    ScrollTrigger.refresh();
    startHeroSequence();
  });
}

/* ------------------------------------------------------------------ */
/* hero image sequence                                                 */
/* ------------------------------------------------------------------ */

function startHeroSequence() {
  const caption = $('.hero__caption');
  $('.hero__ticks').innerHTML = HERO_SLIDES.map(() => '<i></i>').join('');
  const ticks = $$('.hero__ticks i');
  let idx = 0;
  const HOLD = 6.5;
  const FADE = 2.1;

  const showCaption = (i, instant) => {
    const set = () => (caption.textContent = HERO_SLIDES[i].caption);
    if (instant || reduce) return set();
    gsap.to(caption, { opacity: 0, duration: 0.35, onComplete: () => { set(); gsap.to(caption, { opacity: 1, duration: 0.6 }); } });
  };
  const runTick = (i) => {
    ticks.forEach((t, n) => gsap.set(t, { '--p': n < i ? 1 : 0 }));
    if (reduce) return gsap.set(ticks[i], { '--p': 1 });
    gsap.fromTo(ticks[i], { '--p': 0 }, { '--p': 1, duration: HOLD + FADE, ease: 'none' });
  };

  showCaption(0, true);
  runTick(0);
  if (reduce || !heroPlane) return;

  const u = heroPlane.u;
  const zoom = () => gsap.fromTo(u.uScale, { value: 1 }, { value: 1.07, duration: HOLD + FADE + 1, ease: 'none', overwrite: 'auto' });
  zoom();

  const next = () => {
    const n = (idx + 1) % HERO_SLIDES.length;
    showCaption(n);
    runTick(n);
    gsap.to(u.uMix, {
      value: 1,
      duration: FADE,
      ease: 'power2.inOut',
      onComplete: async () => {
        idx = n;
        await gl.setPair(heroPlane, HERO_SLIDES[idx].src, HERO_SLIDES[(idx + 1) % HERO_SLIDES.length].src);
        zoom();
        gsap.delayedCall(HOLD, next);
      },
    });
  };
  gsap.delayedCall(HOLD, next);
}

/* ------------------------------------------------------------------ */
/* scroll choreography                                                 */
/* ------------------------------------------------------------------ */

// hero leaves as a framed image
gsap.to(heroStage, {
  scale: 0.9,
  yPercent: 6,
  ease: 'none',
  scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
});
gsap.to('.hero__copy, .hero__meta', {
  y: -60,
  opacity: 0,
  ease: 'none',
  scrollTrigger: { trigger: '.hero', start: 'top top', end: '55% top', scrub: true },
});

// nav: transparent over the hero, solid after, tucks away when scrolling down
const nav = $('#nav');
const heroEl = $('.hero');
ScrollTrigger.create({
  start: 0,
  end: 'max',
  onUpdate: (self) => {
    const y = self.scroll();
    const h = heroEl.offsetHeight;
    root.classList.toggle('bar-away', y > 24);
    nav.classList.toggle('is-solid', y > h * 0.7);
    nav.classList.toggle('is-hidden', y > h && self.direction === 1 && !root.classList.contains('cart-open'));
  },
});

// reading progress
const bar = $('.progress i');
ScrollTrigger.create({
  start: 0,
  end: 'max',
  onUpdate: (s) => (bar.style.transform = `scaleX(${s.progress})`),
});

// statement: each word comes into focus as you read
const scrubWords = splitWords($('[data-scrub]'));
if (reduce) gsap.set(scrubWords, { opacity: 1 });
else
  gsap.to(scrubWords, {
    opacity: 1,
    stagger: 0.12,
    ease: 'none',
    scrollTrigger: { trigger: '.statement', start: 'top 72%', end: 'bottom 62%', scrub: true },
  });

// headings rise out of their masks
sectionHeads.forEach((el) => {
  const words = el._words;
  if (reduce) return;
  gsap.set(words, { yPercent: 115 });
  ScrollTrigger.create({
    trigger: el,
    start: 'top 88%',
    once: true,
    onEnter: () => gsap.to(words, { yPercent: 0, duration: 1.3, stagger: 0.07, ease: 'expo.out' }),
  });
});

// image mask reveals
$$('[data-reveal]').forEach((el) => {
  const p = planes.get(el);
  const rule = el.closest('.collection')?.querySelector('.collection__row');
  if (rule) gsap.set(rule, { '--rule': reduce ? 1 : 0 });

  if (reduce) return;
  if (p) {
    p.u.uReveal.value = 0;
    p.u.uScale.value = 1.28;
  } else {
    gsap.set(el, { clipPath: 'inset(100% 0 0 0)' });
  }

  ScrollTrigger.create({
    trigger: el,
    start: 'top 86%',
    once: true,
    onEnter: () => {
      const tl = gsap.timeline();
      if (p) {
        tl.to(p.u.uReveal, { value: 1, duration: 1.6, ease: 'expo.inOut' }, 0).to(
          p.u.uScale,
          { value: 1, duration: 2.2, ease: 'expo.out' },
          0,
        );
      } else {
        tl.to(el, { clipPath: 'inset(0% 0 0 0)', duration: 1.4, ease: 'expo.inOut' }, 0);
      }
      if (rule) tl.to(rule, { '--rule': 1, duration: 1.4, ease: 'expo.out' }, 0.5);
    },
  });
});

// the edit: columns drift at different speeds for depth (desktop only)
ScrollTrigger.matchMedia({
  '(min-width: 900px)': () => {
    if (reduce) return;
    $$('.edit__col').forEach((col) => {
      const d = parseFloat(col.dataset.depth || '0');
      gsap.fromTo(
        col,
        { y: d },
        {
          y: -d,
          ease: 'none',
          scrollTrigger: { trigger: '.edit__grid', start: 'top bottom', end: 'bottom top', scrub: true },
        },
      );
    });
  },
});

// craft: a sticky stage; scroll position chooses the active principle and image
(() => {
  const section = $('.craft');
  const items = $$('.craft__item');
  const rail = $('.craft__rail i');
  const craftEl = $('[data-craft-media]');
  const imgEl = $('img', craftEl);
  const p = planes.get(craftEl);
  let current = 0;

  const setStep = (i) => {
    current = i;
    items.forEach((it, n) => it.classList.toggle('is-active', n === i));
    if (p) gl.transitionTo(p, CRAFT_IMAGES[i], 1.2);
    else imgEl.src = CRAFT_IMAGES[i];
  };

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    scrub: true,
    onUpdate: (self) => {
      rail.parentElement.style.setProperty('--p', self.progress);
      rail.style.setProperty('--p', self.progress);
      const i = Math.min(items.length - 1, Math.floor(self.progress * items.length * 0.999));
      if (i !== current) setStep(i);
    },
  });
})();

// marquee: drifts on its own, speeds up and reverses with the scroll
(() => {
  const track = $('[data-marquee]');
  track.innerHTML += track.innerHTML;
  track.querySelectorAll('.star').forEach((s) => s.setAttribute('aria-hidden', 'true'));
  if (reduce) return;
  let x = 0;
  let dir = 1;
  gsap.ticker.add(() => {
    const half = track.scrollWidth / 2;
    const v = lenis ? lenis.velocity : 0;
    if (Math.abs(v) > 0.2) dir = v > 0 ? 1 : -1;
    x -= (0.55 + Math.abs(v) * 0.32) * dir;
    if (x <= -half) x += half;
    if (x > 0) x -= half;
    track.style.transform = `translate3d(${x}px,0,0)`;
  });
})();

/* ------------------------------------------------------------------ */
/* cursor + magnetic buttons                                           */
/* ------------------------------------------------------------------ */

if (finePointer && !reduce) {
  const cur = $('.cursor');
  const label = $('span', cur);
  const qx = gsap.quickTo(cur, 'x', { duration: 0.45, ease: 'power3' });
  const qy = gsap.quickTo(cur, 'y', { duration: 0.45, ease: 'power3' });
  window.addEventListener('pointermove', (e) => {
    cur.classList.add('is-on');
    qx(e.clientX);
    qy(e.clientY);
  });
  document.addEventListener('pointerleave', () => cur.classList.remove('is-on'));
  $$('[data-cursor]').forEach((el) => {
    el.addEventListener('pointerenter', () => {
      label.textContent = el.dataset.cursor;
      cur.classList.add('is-label');
    });
    el.addEventListener('pointerleave', () => cur.classList.remove('is-label'));
  });

  $$('[data-magnetic]').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' });
    const my = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      mx((e.clientX - (r.left + r.width / 2)) * 0.22);
      my((e.clientY - (r.top + r.height / 2)) * 0.3);
    });
    el.addEventListener('pointerleave', () => {
      mx(0);
      my(0);
    });
  });
}

/* ------------------------------------------------------------------ */
/* bag + quick buy                                                     */
/* ------------------------------------------------------------------ */

bindAccountLink();
const newsSlot = document.querySelector('[data-news-slot]');
if (newsSlot) {
  newsSlot.outerHTML = newsletterForm();
  bindNewsletterForms();
}
const drawer = initCartUI({
  onOpen: () => lenis && lenis.stop(),
  onClose: () => lenis && lenis.start(),
});

const buy = { id: 'sling', colour: Math.max(0, firstInStock('sling')), qty: 1, shown: '' };
const buyEl = $('[data-buy-media]');
const buyPlane = planes.get(buyEl);
const tabs = $$('[data-tab]');
const swatchRow = $('[data-swatches]');
buy.shown = PRODUCTS[buy.id].colours[buy.colour].img;

function renderBuy({ swap = false } = {}) {
  const p = PRODUCTS[buy.id];
  const colour = p.colours[buy.colour];
  const sold = colour.stock <= 0;
  buy.qty = Math.min(Math.max(1, buy.qty), Math.max(1, colour.stock));

  $('[data-buy-name]').textContent = p.name;
  $('[data-buy-price]').textContent = fmt(colour.price);
  $('[data-buy-blurb]').textContent = colour.description || p.blurb;
  $('[data-buy-colour]').textContent = colour.name;
  $('[data-qty-out]').textContent = String(buy.qty);
  $('[data-buy-stock]').textContent = sold ? 'Sold out in this colour' : colour.stock <= 5 ? `Only ${colour.stock} left` : '';

  const addBtn = $('[data-buy-add]');
  addBtn.disabled = sold;
  addBtn.textContent = sold ? 'Sold out' : 'Add to bag';
  $('[data-buy-now]').hidden = sold;

  tabs.forEach((t) => {
    const on = t.dataset.tab === buy.id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  swatchRow.innerHTML = p.colours
    .map(
      (c, i) =>
        `<button type="button" class="swatch${c.stock <= 0 ? ' is-sold' : ''}" role="radio" aria-checked="${i === buy.colour}" aria-label="${c.name}${c.stock <= 0 ? ', sold out' : ''}" style="--c:${c.hex}" data-i="${i}"></button>`,
    )
    .join('');

  const img = $('img', buyEl);
  const url = colour.img || p.img;
  if (swap || url !== buy.shown) {
    if (buyPlane) gl.transitionTo(buyPlane, url, 1.1);
    else img.src = url;
    buy.shown = url;
  }
  img.alt = `${p.name} in ${colour.name}`;
  $('[data-buy-details]').href = `product/?c=${p.id}&colour=${encodeURIComponent(colour.name.toLowerCase())}`;
}

const pickProduct = (id) => {
  buy.id = id;
  buy.colour = Math.max(0, firstInStock(id));
  buy.qty = 1;
  renderBuy({ swap: true });
};

tabs.forEach((t) => t.addEventListener('click', () => pickProduct(t.dataset.tab)));
$('.tabs').addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  const order = tabs.map((t) => t.dataset.tab);
  const i = order.indexOf(buy.id) + (e.key === 'ArrowRight' ? 1 : -1);
  pickProduct(order[(i + order.length) % order.length]);
  $(`[data-tab="${buy.id}"]`).focus();
});
swatchRow.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  buy.colour = Number(b.dataset.i);
  buy.qty = 1;
  renderBuy();
  swatchRow.children[buy.colour].focus();
});
$$('[data-qty]').forEach((b) =>
  b.addEventListener('click', () => {
    const max = Math.max(1, PRODUCTS[buy.id].colours[buy.colour].stock);
    buy.qty = Math.max(1, Math.min(Math.min(9, max), buy.qty + Number(b.dataset.qty)));
    $('[data-qty-out]').textContent = String(buy.qty);
  }),
);
const buySku = () => PRODUCTS[buy.id].colours[buy.colour].sku;
$('[data-buy-add]').addEventListener('click', () => {
  if (!cart.add(buySku(), buy.qty)) return toast('That colour is sold out, or already in your bag at the most we have');
  const c = PRODUCTS[buy.id].colours[buy.colour].name;
  toast(`${PRODUCTS[buy.id].name} in ${c} added to your bag`);
});
$('[data-buy-now]').addEventListener('click', () => {
  cart.add(buySku(), buy.qty);
  if (cart.count) drawer.open();
});

// "Add to bag" on product cards takes the first colour; choosing a colour is one click away
$$('[data-add]').forEach((b) => {
  const idx = firstInStock(b.dataset.add);
  if (idx < 0) {
    b.disabled = true;
    b.lastChild.textContent = 'Sold out';
    return;
  }
  b.addEventListener('click', () => {
    cart.add(PRODUCTS[b.dataset.add].colours[idx].sku, 1);
    toast(`${PRODUCTS[b.dataset.add].name} added to your bag`);
    drawer.open();
  });
});

// collection / card images preselect the product in the quick-buy
$$('[data-select]').forEach((a) =>
  a.addEventListener('click', () => pickProduct(a.dataset.select)),
);

renderBuy();

/* ------------------------------------------------------------------ */

document.fonts?.ready.then(() => ScrollTrigger.refresh());
window.addEventListener('load', () => ScrollTrigger.refresh());
runIntro();
