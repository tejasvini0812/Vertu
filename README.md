# VERTU

Landing page for VERTU: GSAP + ScrollTrigger + Lenis for scroll choreography, Three.js for the image layer
(mask reveals, parallax, hover distortion, noise-wipe transitions).

```bash
npm install
npm run dev            # local dev server
npm run build          # production build -> dist/
npm run build:single   # one self-contained index.html -> dist-single/
```

## Where things live
- `src/data.js`   products, colours, **placeholder prices (INR)**, hero slides. Edit here.
- `src/cart.js`   bag state (localStorage), drawer UI. Checkout is a stub: wire your payment provider here.
- `src/gl.js`     the shared WebGL canvas + shader.
- `src/main.js`   scroll choreography, intro, quick-buy.
- `src/styles.css` tokens (palette, type) and layout.
- `src/assets/`   photography (extracted from the brand deck) and self-hosted fonts.

## To replace before launch
- Prices (deck had none) and any product specs/dimensions.
- The three testimonial placeholders in `index.html` (`.quotes`) with real, verified reviews.
- Photography: the deck images are small (max 1600px) and some carry a small sparkle glyph bottom-right.
  Swap in clean, high-resolution originals under `src/assets/img/` using the same file names.


## Admin portal (`/admin/`)

Open `/admin/` (built from `admin/index.html`, code in `src/admin/`). Views: Overview, Products, Orders, Editorial.

- `npm run build` outputs the storefront at `/` and the admin at `/admin/`.
- `npm run build:single` / `npm run build:single:admin` each produce one self-contained HTML file (storefront / admin).
- Storefront and admin share one store (`src/store.js`, localStorage key `vertu.admin.v1`). Editing in the admin and reloading the storefront shows the change (stock, prices, sold-out colours, hero, collection highlights, announcement bar). The two only share data when served from the same origin, which is why the single-file previews do not sync with each other.
- **This is sample data, saved per browser, with no sign-in.** Before going live: replace `load`/`persist`/`update` in `src/store.js` with API calls (keep the state shape in `src/seed.js`), add real authentication in front of `/admin/`, and store uploaded images in object storage instead of data URLs.
- Orders in the admin are invented sample orders. Checkout in the storefront does not create orders yet.
