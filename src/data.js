import pocketImg from './assets/img/detail-pocket.jpg';
import organiserImg from './assets/img/detail-organiser.jpg';
import hardwareImg from './assets/img/detail-hardware.jpg';
import laptopImg from './assets/img/laptop.jpg';
import { getState, ready, resolveImage, CATEGORIES } from './store.js';
import { seed } from './seed.js';

/**
 * The storefront catalogue, built from the shared store (edited in /admin).
 * A "product" is a collection (Sling Bag, Men's Sling Bag, Laptop Bag); each colour is one SKU
 * with its own price, stock and image. If a collection has no active SKUs the seed is used so pages never break.
 */
await ready('public');
const state = getState();
const fallback = seed();

function build(cat) {
  let skus = state.products.filter((p) => p.category === cat.id && p.status === 'active');
  if (!skus.length) skus = fallback.products.filter((p) => p.category === cat.id);
  const info = (state.categories || []).find((c) => c.id === cat.id) || fallback.categories.find((c) => c.id === cat.id);
  const colours = skus.map((p) => ({
    sku: p.id,
    name: p.colour,
    hex: p.hex,
    price: Number(p.price) || 0,
    stock: Math.max(0, Number(p.stock) || 0),
    img: resolveImage(p.image),
    description: p.description || '',
    mrp: Math.max(Number(p.mrp) || 0, Number(p.price) || 0),
  }));
  return {
    id: cat.id,
    name: cat.unit,
    collection: cat.name,
    price: Math.min(...colours.map((c) => c.price)),
    img: colours[0].img,
    colours,
    blurb: colours[0].description,
    description: info?.description || colours[0].description,
    details: info?.details || {},
    declarations: { generic_name: cat.unit, net_quantity: '1 N (one bag)', country_of_origin: 'India', ...(info?.declarations || {}) },
  };
}

export const PRODUCTS = Object.fromEntries(CATEGORIES.map((c) => [c.id, build(c)]));

/** sku -> { product, colour, index } for every buyable colour */
export const SKUS = new Map();
for (const p of Object.values(PRODUCTS)) p.colours.forEach((c, i) => SKUS.set(c.sku, { product: p, colour: c, index: i }));
export const bySku = (sku) => SKUS.get(sku) || null;

const { hero, collections, announcement } = state.content;
export const CONTENT = { hero, collections, announcement };

export const HERO_SLIDES = hero.slides
  .filter((s) => s.image)
  .map((s) => ({ src: resolveImage(s.image), caption: s.caption || '' }));

export const CRAFT_IMAGES = [organiserImg, pocketImg, hardwareImg, laptopImg];
export const DETAIL_SHOTS = [
  { src: organiserImg, alt: 'Inside a VERTU bag: separate places for a laptop, a bottle and a notebook' },
  { src: pocketImg, alt: 'A cream inside pocket stitched to the lining of a mustard VERTU bag' },
  { src: hardwareImg, alt: 'A metal clip and ring attaching the strap inside a VERTU bag' },
];

export const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

/** First colour index that can actually be bought, or -1 if the whole collection is sold out. */
export const firstInStock = (id) => PRODUCTS[id].colours.findIndex((c) => c.stock > 0);

/** Link to a product page from any page. `base` is '' on the home page and '../' on sub-pages. */
// Built sites use the prerendered address /product/sling/?colour=crimson (see scripts/site-plugin.mjs);
// the dev server has no prerendered pages, so it keeps /product/?c=sling.
export const productHref = (id, colourName, base = '') => {
  const colour = colourName ? encodeURIComponent(colourName.toLowerCase()) : '';
  return import.meta.env.PROD
    ? `${base}product/${encodeURIComponent(id)}/${colour ? `?colour=${colour}` : ''}`
    : `${base}product/?c=${encodeURIComponent(id)}${colour ? `&colour=${colour}` : ''}`;
};
