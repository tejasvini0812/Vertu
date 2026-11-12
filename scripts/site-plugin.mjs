// After `vite build`, turns dist/ into a deployable site:
//  - one prerendered page per collection (/product/sling/) with its title, description, canonical
//    address, social-sharing tags, structured data and readable content, so search engines and link
//    previews see the product without running JavaScript (the page script then takes over)
//  - sitemap.xml, robots.txt, /.well-known/security.txt and a 404 page
//  - _headers and _redirects (read by Netlify and Cloudflare Pages): security headers with a
//    content security policy, long caching for fingerprinted files, noindex for private pages
//
// Environment (all optional, read at build time):
//   SITE_URL                  https://yourdomain.com (Netlify's URL is used if unset). Needed for the sitemap.
//   VITE_SUPABASE_URL / _ANON_KEY  live catalogue for the prerendered pages (falls back to the sample data)
//   VITE_ANALYTICS_PROVIDER   plausible | ga4, so the security policy allows that script
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { seed, CATEGORIES } from '../src/seed.js';
import { productFromRow, categoryFromRow } from '../src/lib/sync.js';

const ASSET_FILES = { sling: 'sling.jpg', mens: 'mens.jpg', laptop: 'laptop.jpg', hero1: 'hero-1.jpg', hero2: 'hero-2.jpg', hero3: 'hero-3.jpg' };
const PRIVATE = ['admin', 'account', 'checkout', 'order', 'invoice', 'newsletter'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

/** Products and collection details: from Supabase when the build has keys, otherwise the sample data. */
async function loadCatalogue(env, log) {
  const sample = seed();
  const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      const get = async (path) => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      };
      const [products, categories] = await Promise.all([get('products?select=*&status=eq.active&order=sort'), get('categories?select=*&order=sort')]);
      return { products: products.map(productFromRow), categories: categories.map(categoryFromRow), source: 'database' };
    } catch (e) {
      log(`prerender: couldn't read the live catalogue (${e.message}); using the sample data for search pages`);
    }
  }
  return { products: sample.products, categories: sample.categories, source: 'sample' };
}

/** Same shape as src/data.js builds for the storefront. */
function collections(cat, assetUrl) {
  const fallback = seed();
  return CATEGORIES.map((c) => {
    let skus = cat.products.filter((p) => p.category === c.id && p.status === 'active');
    if (!skus.length) skus = fallback.products.filter((p) => p.category === c.id);
    const info = cat.categories.find((x) => x.id === c.id) || fallback.categories.find((x) => x.id === c.id) || {};
    const colours = skus.map((p) => ({
      sku: p.id,
      name: p.colour,
      price: Number(p.price) || 0,
      mrp: Math.max(Number(p.mrp) || 0, Number(p.price) || 0),
      stock: Math.max(0, Number(p.stock) || 0),
      img: !p.image ? '' : p.image.startsWith('asset:') ? assetUrl(p.image.slice(6)) : /^https?:/.test(p.image) ? p.image : '',
      description: p.description || '',
    }));
    return { id: c.id, name: c.unit, collection: c.name, colours, description: info.description || colours[0]?.description || '', details: info.details || {} };
  });
}

function headers({ supabaseUrl, analytics }) {
  const sb = supabaseUrl ? new URL(supabaseUrl).host : '';
  const script = ["'self'", 'https://checkout.razorpay.com'];
  const connect = ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'];
  if (sb) connect.push(`https://${sb}`, `wss://${sb}`);
  if (analytics === 'plausible') script.push('https://plausible.io'), connect.push('https://plausible.io');
  if (analytics === 'ga4') {
    script.push('https://www.googletagmanager.com');
    connect.push('https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com');
  }
  const csp = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    // inline style attributes are used by the page templates and animation library
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    'frame-src https://api.razorpay.com https://checkout.razorpay.com',
    "form-action 'self' https://api.razorpay.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  const lines = [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")',
    // Razorpay's bank and UPI pop-ups talk back to this window
    '  Cross-Origin-Opener-Policy: same-origin-allow-popups',
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    ...PRIVATE.flatMap((p) => [`/${p}/*`, '  X-Robots-Tag: noindex, nofollow', '  Cache-Control: no-cache', '']),
  ];
  return { file: lines.join('\n'), csp };
}

export function sitePlugin(env) {
  let outDir = 'dist';
  return {
    name: 'vertu-site',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    async writeBundle(_, bundle) {
      const log = (m) => this.warn ? this.warn(m) : console.warn(m);
      const SITE = (env.SITE_URL || env.URL || '').replace(/\/$/, '');
      const file = (p) => join(outDir, p);
      const read = (p) => readFileSync(file(p), 'utf8');
      const write = (p, s) => (mkdirSync(dirname(file(p)), { recursive: true }), writeFileSync(file(p), s));

      // fingerprinted asset names, by source file
      const byName = {};
      let glChunk = '';
      const fonts = [];
      for (const [name, b] of Object.entries(bundle)) {
        for (const o of b.originalFileNames || []) byName[o.split('/').pop()] = name;
        if (b.type === 'chunk' && b.isDynamicEntry && /gl\.js$/.test(b.facadeModuleId || '')) glChunk = name;
        if (/(hanken-grotesk-latin-wght-normal|bodoni-moda-latin-opsz-normal)-.*\.woff2$/.test(name)) fonts.push(name);
      }
      const rel = (depth) => '../'.repeat(depth);
      const assetUrl = (k) => (byName[ASSET_FILES[k]] ? `/${byName[ASSET_FILES[k]]}` : '');
      const absolute = (u) => (!u ? '' : /^https?:/.test(u) ? u : SITE ? SITE + u : '');

      const cat = await loadCatalogue(env, log);
      const items = collections(cat, assetUrl);

      // ---------------------------------------------------------------- every storefront page
      const pages = ['index.html', 'shop/index.html', 'product/index.html', 'legal/index.html', 'contact/index.html', ...PRIVATE.map((p) => `${p}/index.html`)];
      const sbHost = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : '';
      for (const p of pages) {
        if (!existsSync(file(p))) continue;
        const depth = p.split('/').length - 1;
        const priv = PRIVATE.includes(p.split('/')[0]);
        let html = read(p);
        const extra = [
          priv ? '<meta name="robots" content="noindex, nofollow" />' : '',
          sbHost ? `<link rel="preconnect" href="${sbHost}" crossorigin />` : '',
          ...(p.startsWith('admin') ? [] : fonts.map((f) => `<link rel="preload" href="${rel(depth)}${f}" as="font" type="font/woff2" crossorigin />`)),
          p === 'index.html' && glChunk ? `<link rel="modulepreload" href="./${glChunk}" />` : '',
        ].filter(Boolean);
        html = html.replace('</title>', `</title>\n    ${extra.join('\n    ')}`);
        write(p, html);
      }

      // ---------------------------------------------------------------- social and search tags for home and shop
      const og = ({ title, description, url, image, type = 'website' }) =>
        [
          `<meta property="og:site_name" content="VERTU" />`,
          `<meta property="og:type" content="${type}" />`,
          `<meta property="og:title" content="${esc(title)}" />`,
          `<meta property="og:description" content="${esc(description)}" />`,
          url ? `<meta property="og:url" content="${esc(url)}" />` : '',
          image ? `<meta property="og:image" content="${esc(image)}" />` : '',
          `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
          url ? `<link rel="canonical" href="${esc(url)}" data-prerendered="1" />` : '',
        ].filter(Boolean).join('\n    ');
      const metaOf = (html, name) => (html.match(new RegExp(`<meta\\s+name="${name}"[\\s\\S]*?content="([^"]*)"`)) || [])[1] || '';

      {
        let html = read('index.html');
        const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
        const ld = jsonLd({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'VERTU', url: SITE ? `${SITE}/` : undefined, logo: absolute(byName['logo.png'] ? `/${byName['logo.png']}` : '') || undefined },
            { '@type': 'WebSite', name: 'VERTU', url: SITE ? `${SITE}/` : undefined, publisher: { '@id': `${SITE}/#org` } },
          ],
        });
        html = html.replace('</title>', `</title>\n    ${og({ title, description: metaOf(html, 'description'), url: SITE && `${SITE}/`, image: absolute(assetUrl('hero1')) })}\n    ${ld}`);
        write('index.html', html);
      }
      {
        let html = read('shop/index.html');
        const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
        const list = jsonLd({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, url: SITE ? `${SITE}/product/${x.id}/` : undefined })),
        });
        html = html.replace('</title>', `</title>\n    ${og({ title, description: metaOf(html, 'description'), url: SITE && `${SITE}/shop/`, image: absolute(assetUrl('hero2')) })}\n    ${list}`);
        // readable without JavaScript; the shop script replaces it
        html = html.replace(
          /<main id="main" tabindex="-1">[\s\S]*?<\/main>/,
          `<main id="main" tabindex="-1"><div class="ssr"><h1 class="page-title">Shop all bags</h1><ul>${items
            .map((x) => `<li><a href="../product/${x.id}/">${esc(x.name)}</a>, ${x.colours.length} colours, from ${inr(Math.min(...x.colours.map((c) => c.price)))}</li>`)
            .join('')}</ul></div></main>`,
        );
        write('shop/index.html', html);
      }

      // ---------------------------------------------------------------- one page per collection
      const template = read('product/index.html');
      const productPage = (x, base) => {
        const from = Math.min(...x.colours.map((c) => c.price));
        const inStock = x.colours.filter((c) => c.stock > 0);
        const url = SITE ? `${SITE}/product/${x.id}/` : '';
        const title = `${x.name}, from ${inr(from)} | VERTU`;
        const description = `${x.description} ${x.colours.length} colours: ${x.colours.map((c) => c.name).join(', ')}.`.slice(0, 300);
        const image = absolute(x.colours[0]?.img);
        const ld = jsonLd({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'ProductGroup',
              name: x.name,
              brand: { '@type': 'Brand', name: 'VERTU' },
              description: x.description,
              productGroupID: x.id,
              url: url || undefined,
              variesBy: ['https://schema.org/color'],
              hasVariant: x.colours.map((c) => ({
                '@type': 'Product',
                sku: c.sku,
                name: `${c.name} ${x.name}`,
                color: c.name,
                image: absolute(c.img) || undefined,
                offers: {
                  '@type': 'Offer',
                  price: c.price,
                  priceCurrency: 'INR',
                  availability: c.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
                  url: url ? `${url}?colour=${encodeURIComponent(c.name.toLowerCase())}` : undefined,
                },
              })),
            },
            {
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Shop', item: SITE ? `${SITE}/shop/` : undefined },
                { '@type': 'ListItem', position: 2, name: x.name, item: url || undefined },
              ],
            },
          ],
        });
        const body = `<main id="main" tabindex="-1"><div class="ssr">
      <p><a href="../shop/">Shop</a> / ${esc(x.collection)}</p>
      <h1 class="page-title">${esc(x.name)}</h1>
      <p>From ${inr(from)} (MRP inclusive of all taxes). ${inStock.length ? `In stock in ${inStock.length} of ${x.colours.length} colours.` : 'Sold out.'}</p>
      ${x.colours[0]?.img ? `<img src="${esc(x.colours[0].img)}" alt="${esc(`${x.colours[0].name} ${x.name}`)}" width="480" />` : ''}
      <p>${esc(x.description)}</p>
      <ul>${x.colours.map((c) => `<li><a href="${x.id}/?colour=${encodeURIComponent(c.name.toLowerCase())}">${esc(c.name)}</a>: ${inr(c.price)}${c.stock > 0 ? '' : ' (sold out)'}</li>`).join('')}</ul>
      ${(x.details.features || []).filter(Boolean).length ? `<ul>${x.details.features.filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    </div></main>`;
        return template
          .replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <base href="${base}" />`)
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
          .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="${esc(description)}" />`)
          .replace('</title>', `</title>\n    ${og({ title, description, url, image, type: 'product' })}\n    ${ld}`)
          .replace(/<main id="main" tabindex="-1">[\s\S]*?<\/main>/, body);
      };
      for (const x of items) write(`product/${x.id}/index.html`, productPage(x, '../'));
      // for collections added after this build: served by the _redirects rule below
      write('product/_/index.html', template.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n    <base href="/product/" />'));

      // ---------------------------------------------------------------- hosting files
      const today = new Date().toISOString().slice(0, 10);
      write(
        'robots.txt',
        `User-agent: *\n${PRIVATE.map((p) => `Disallow: /${p}/`).join('\n')}\nAllow: /\n${SITE ? `\nSitemap: ${SITE}/sitemap.xml\n` : ''}`,
      );
      if (SITE) {
        const urls = [
          ['/', '1.0'],
          ['/shop/', '0.9'],
          ...items.map((x) => [`/product/${x.id}/`, '0.8']),
          ['/contact/', '0.4'],
          ...['privacy', 'terms', 'shipping', 'returns', 'cancellation'].map((p) => [`/legal/?p=${p}`, '0.3']),
        ];
        write(
          'sitemap.xml',
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
            .map(([u, pr]) => `  <url><loc>${esc(SITE + u)}</loc><lastmod>${today}</lastmod><priority>${pr}</priority></url>`)
            .join('\n')}\n</urlset>\n`,
        );
      } else {
        log('sitemap.xml skipped: set SITE_URL (for example https://yourdomain.com) when building for production');
      }
      const expires = new Date(Date.now() + 365 * 864e5).toISOString();
      write('.well-known/security.txt', `Contact: ${SITE ? `${SITE}/contact/?about=other` : 'mailto:contact.shopvertu@gmail.com'}\nExpires: ${expires}\nPreferred-Languages: en, hi\n${SITE ? `Canonical: ${SITE}/.well-known/security.txt\n` : ''}`);
      const h = headers({ supabaseUrl: env.VITE_SUPABASE_URL, analytics: (env.VITE_ANALYTICS_PROVIDER || '').toLowerCase() });
      write('_headers', h.file + '\n');
      write('_redirects', '/product/*  /product/_/index.html  200\n');
      write(
        '404.html',
        `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><base href="/" />
<title>Page not found | VERTU</title><meta name="robots" content="noindex" />
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f3ee;color:#22201d;font:16px/1.6 system-ui,sans-serif;text-align:center;padding:24px}h1{font:400 clamp(32px,6vw,56px)/1.1 Georgia,serif;margin:0 0 12px}a{color:#22201d}</style></head>
<body><main><h1>We couldn’t find that page.</h1><p>It may have moved. <a href="shop/">Browse the shop</a> or go to the <a href="./">home page</a>.</p></main></body></html>\n`,
      );
      console.log(`\nsite: ${items.length} product pages from the ${cat.source} catalogue, ${SITE ? 'sitemap for ' + SITE : 'no sitemap (SITE_URL not set)'}, security headers written`);
    },
  };
}
