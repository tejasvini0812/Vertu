import pocketImg from './assets/img/detail-pocket.jpg';
import organiserImg from './assets/img/detail-organiser.jpg';
import hardwareImg from './assets/img/detail-hardware.jpg';
import laptopImg from './assets/img/laptop.jpg';
import { getState, resolveImage, CATEGORIES } from './store.js';
import { seed } from './seed.js';

/**
 * The storefront catalogue is built from the shared store (edited in /admin).
 * Each colour is one SKU with its own price, stock and image.
 * If a category has no active SKUs the seed data is used so the page never breaks.
 */
const state = getState();
const fallback = seed().products;

function build(cat) {
  let skus = state.products.filter((p) => p.category === cat.id && p.status === 'active');
  if (!skus.length) skus = fallback.filter((p) => p.category === cat.id);
  const colours = skus.map((p) => ({
    sku: p.id,
    name: p.colour,
    hex: p.hex,
    price: Number(p.price) || 0,
    stock: Math.max(0, Number(p.stock) || 0),
    img: resolveImage(p.image),
    description: p.description || '',
  }));
  return {
    id: cat.id,
    name: cat.unit,
    price: Math.min(...colours.map((c) => c.price)),
    img: colours[0].img,
    colours,
    blurb: colours[0].description,
  };
}

export const PRODUCTS = Object.fromEntries(CATEGORIES.map((c) => [c.id, build(c)]));

const { hero, collections, announcement } = state.content;

export const CONTENT = { hero, collections, announcement };

export const HERO_SLIDES = hero.slides
  .filter((s) => s.image)
  .map((s) => ({ src: resolveImage(s.image), caption: s.caption || '' }));

export const CRAFT_IMAGES = [organiserImg, pocketImg, hardwareImg, laptopImg];

export const fmt = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);

/** First colour index that can actually be bought, or -1 if the whole category is sold out. */
export const firstInStock = (id) => PRODUCTS[id].colours.findIndex((c) => c.stock > 0);
