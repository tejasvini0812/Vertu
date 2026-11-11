/**
 * Demo data. Everything here is SAMPLE content so the admin has something to manage:
 *  - products mirror the colours shown in the brand deck (5 per category)
 *  - orders, customers and stock levels are invented
 * Replace with your real backend; the shapes below are what the UI expects.
 */
export const CATEGORIES = [
  { id: 'sling', name: 'Sling Bags', code: 'SL', unit: 'Sling Bag' },
  { id: 'mens', name: "Men’s Sling Bags", code: 'MS', unit: "Men’s Sling Bag" },
  { id: 'laptop', name: 'Laptop Bags', code: 'LP', unit: 'Laptop Bag' },
];
export const STATUSES = ['Pending', 'Processing', 'Shipped', 'Delivered'];

/**
 * Collection details shown on product pages. Features are taken from what the photographs show.
 * Specs are left empty on purpose: the brand deck has no dimensions or materials. Fill them in from
 * the admin (Products -> Collection details); empty specs are simply not shown.
 */
export const CATEGORY_DETAILS = {
  sling: {
    description:
      'Small enough for the day, organised enough for everything in it. Carry it by the handles or across the body with the detachable strap.',
    details: {
      features: [
        'Detachable strap: carry it by the handles or across the body',
        'Inside pocket that keeps small things where you left them',
        'Metal clips and rings that hold the strap and stay out of the way',
      ],
      specs: { Dimensions: '', Material: '', Weight: '', Capacity: '' },
      care: '',
    },
  },
  mens: {
    description:
      'A slim crossbody with a wide webbing strap and a zip pocket on the front, for the things you reach for most.',
    details: {
      features: ['Wide webbing strap that sits comfortably across the body', 'Zip pocket on the front', 'Slim profile that stays close'],
      specs: { Dimensions: '', Material: '', Weight: '', Capacity: '' },
      care: '',
    },
  },
  laptop: {
    description:
      'A structured carry-all with room for a laptop and everything that travels with it, kept apart and easy to find.',
    details: {
      features: [
        'A place each for a laptop, a bottle, a notebook and lunch',
        'Twin handles',
        'Front pocket for the things you need quickly',
      ],
      specs: { Dimensions: '', Material: '', Weight: '', Capacity: '', 'Fits laptops up to': '' },
      care: '',
    },
  },
};

const BASE = [
  ['Crimson', '#a82a2e'],
  ['Cobalt', '#1f3fb0'],
  ['Black', '#1c1b1a'],
  ['Mustard', '#e0b00f'],
  ['Forest', '#1f7a55'],
];
const MENS = [
  ['Navy', '#1e2f73'],
  ['Mustard', '#e0b00f'],
  ['Teal', '#1f8a78'],
  ['Maroon', '#8a1f2a'],
  ['Black', '#1c1b1a'],
];
const SPEC = {
  sling: {
    price: 1799,
    colours: BASE,
    stock: [14, 3, 22, 0, 9],
    description:
      'Compact and organised, with a detachable strap so it carries by hand or across the body.',
  },
  mens: {
    price: 1999,
    colours: MENS,
    stock: [11, 6, 1, 19, 25],
    description:
      'A slim crossbody with a wide webbing strap, metal hardware and a zip pocket on the front.',
  },
  laptop: {
    price: 2499,
    colours: BASE,
    stock: [8, 12, 4, 17, 2],
    description:
      'Room for a laptop and the day that goes with it, with twin handles and a front pocket.',
  },
};

export const skuFor = (cat, colour, n = 1) => {
  const code = CATEGORIES.find((c) => c.id === cat)?.code || 'XX';
  return `VRT-${code}-${colour.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase()}${n > 1 ? '-' + n : ''}`;
};

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = [
  ['Aanya Mehta', 'Mumbai', 'Maharashtra', '400050'],
  ['Rohan Iyer', 'Bengaluru', 'Karnataka', '560034'],
  ['Meera Kapoor', 'New Delhi', 'Delhi', '110016'],
  ['Kabir Singh', 'Pune', 'Maharashtra', '411004'],
  ['Ishita Rao', 'Hyderabad', 'Telangana', '500033'],
  ['Vihaan Shah', 'Ahmedabad', 'Gujarat', '380015'],
  ['Tara Nair', 'Kochi', 'Kerala', '682016'],
  ['Arjun Bose', 'Kolkata', 'West Bengal', '700019'],
  ['Zoya Khan', 'Lucknow', 'Uttar Pradesh', '226010'],
  ['Dev Malhotra', 'Chandigarh', 'Chandigarh', '160017'],
  ['Naina Joshi', 'Jaipur', 'Rajasthan', '302001'],
  ['Sahil Verma', 'Gurugram', 'Haryana', '122002'],
  ['Riya Desai', 'Surat', 'Gujarat', '395007'],
  ['Aditya Menon', 'Chennai', 'Tamil Nadu', '600028'],
  ['Kiara Sethi', 'Panaji', 'Goa', '403001'],
  ['Neel Agarwal', 'Indore', 'Madhya Pradesh', '452001'],
];
const STREETS = ['Rose Lane', 'Garden Road', 'Hill View Apartments', 'Park Avenue', 'Lake Street', 'Station Road'];

export function seed(now = Date.now()) {
  const products = [];
  for (const cat of CATEGORIES) {
    const spec = SPEC[cat.id];
    spec.colours.forEach(([colour, hex], i) => {
      products.push({
        id: skuFor(cat.id, colour),
        category: cat.id,
        colour,
        hex,
        price: spec.price,
        stock: spec.stock[i],
        status: 'active',
        image: `asset:${cat.id}`,
        description: spec.description,
      });
    });
  }

  const r = rng(11);
  const DAY = 86400000;
  const orders = [];
  for (let i = 0; i < 28; i++) {
    const ageDays = Math.pow(r(), 1.25) * 30;
    const createdAt = now - ageDays * DAY - r() * 6e6;
    const [name, city, state, pin] = PEOPLE[Math.floor(r() * PEOPLE.length)];
    const lines = [];
    const n = r() < 0.65 ? 1 : r() < 0.8 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const p = products[Math.floor(r() * products.length)];
      const found = lines.find((l) => l.sku === p.id);
      if (found) found.qty += 1;
      else lines.push({ sku: p.id, category: p.category, colour: p.colour, price: p.price, qty: r() < 0.82 ? 1 : 2 });
    }
    let status;
    if (ageDays > 12) status = r() < 0.95 ? 'Delivered' : 'Shipped';
    else if (ageDays > 6) status = r() < 0.55 ? 'Delivered' : 'Shipped';
    else if (ageDays > 2) status = r() < 0.5 ? 'Shipped' : 'Processing';
    else status = r() < 0.55 ? 'Pending' : 'Processing';
    const first = name.split(' ')[0].toLowerCase();
    const last = name.split(' ')[1].toLowerCase();
    orders.push({
      id: `VRT-${10400 + i}`,
      createdAt: Math.round(createdAt),
      status,
      customer: {
        name,
        email: `${first}.${last}@example.com`,
        phone: `+91 98••• ••${String(Math.floor(r() * 900) + 100)}`,
        address: `${Math.floor(r() * 90) + 3}, ${STREETS[Math.floor(r() * STREETS.length)]}`,
        city,
        state,
        pin,
      },
      lines,
      note: '',
    });
  }
  orders.sort((a, b) => b.createdAt - a.createdAt);
  orders.forEach((o, i) => (o.id = `VRT-${10428 - i}`));

  return {
    version: 1,
    seededAt: now,
    categories: CATEGORIES.map((c) => ({ ...c, ...structuredClone(CATEGORY_DETAILS[c.id]) })),
    settings: { lowStock: 5 },
    products,
    orders,
    content: {
      publishedAt: null,
      announcement: {
        enabled: true,
        text: 'Sling bags, men’s slings and laptop bags, each in five colours.',
        linkLabel: 'Shop now',
        linkHref: '#shop',
      },
      hero: {
        headline: 'The art of utility.',
        sub: 'Bags built around how you actually move through the day.',
        cta: 'Shop the collection',
        slides: [
          { image: 'asset:hero1', caption: 'Laptop bags in five colours' },
          { image: 'asset:hero2', caption: 'Slings and laptop bags, together' },
          { image: 'asset:hero3', caption: 'Men’s sling bags in five colours' },
        ],
      },
      collections: [
        {
          id: 'sling',
          visible: true,
          title: 'Sling Bags',
          image: 'asset:sling',
          description:
            'Small enough for the day, organised enough for everything in it. Carry it by the handles or across the body.',
        },
        {
          id: 'mens',
          visible: true,
          title: 'Men’s Sling Bags',
          image: 'asset:mens',
          description:
            'A slim crossbody with a wide webbing strap and a zip pocket on the front, for the things you reach for most.',
        },
        {
          id: 'laptop',
          visible: true,
          title: 'Laptop Bags',
          image: 'asset:laptop',
          description:
            'A structured carry-all with room for a laptop and everything that travels with it, kept apart and easy to find.',
        },
      ],
    },
  };
}
