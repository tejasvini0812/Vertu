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

Open `/admin/` (built from `admin/index.html`, code in `src/admin/`). Views: Overview, Products, Orders, Editorial, Settings.

The site runs in one of two modes:

| | Sample mode | Live mode |
|---|---|---|
| When | No Supabase keys set | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set |
| Data | This browser's localStorage, seeded from `src/seed.js` | Supabase Postgres, shared by every visitor |
| Admin sign-in | None | Email + password, then two-step verification (authenticator app) |
| Images | Kept in the browser | Uploaded to Supabase Storage (`media` bucket) |

## Going live with Supabase (Phase 1)

1. **Create a project** at supabase.com. Pick the Mumbai (ap-south-1) region for Indian customers.
2. **Create the database.** In the SQL editor, run in order:
   - `supabase/migrations/20261112000000_phase1_core.sql`: catalogue, orders, staff, access rules, storage bucket
   - `supabase/migrations/20261112010000_phase2_customers.sql`: customer profiles, addresses, wishlist, saved bag, back-in-stock alerts, collection details
   - `supabase/seed.sql`: the 15 starting products, collection details and editorial content (safe to re-run)
   - optional, staging only: `supabase/sample_orders.sql` (invented orders to try the Orders view)

   With the Supabase CLI instead: `supabase link`, then `supabase db push`, then run `seed.sql`.
3. **Create your owner account.** Authentication → Users → Add user (tick *Auto confirm*). Then edit the email in `supabase/bootstrap_owner.sql` and run it.
4. **Auth settings** (Authentication → URL configuration and Sign in / Providers):
   - Site URL: your domain. Add `https://yourdomain.com/admin/` and `https://yourdomain.com/account/` (and the same on `http://localhost:5173` for development) to *Redirect URLs*.
   - Keep "Allow new users to sign up" **on**: shoppers create accounts themselves. Being signed up gives no admin rights; only owners can grant those.
   - **Email template for sign-in codes:** Authentication → Emails → *Magic Link*. Add `{{ .Token }}` to the body (for example "Your VERTU code is {{ .Token }}"), so shoppers get a 6-digit code as well as the link.
   - Optional **Google sign-in:** enable the Google provider (it needs a Google Cloud OAuth client), then set `VITE_AUTH_GOOGLE=true`.
   - Check that TOTP multi-factor is enabled (it is by default).
   - Set up custom SMTP (Authentication → Emails) before launch. The built-in sender is rate-limited and meant for testing.
5. **Add the keys.** Copy `.env.example` to `.env.local` and fill in the project URL and anon/publishable key (Project Settings → API). In production, set the same two variables in your host (Vercel, Netlify and so on).
6. `npm run dev`, open `http://localhost:5173/admin/`, sign in, scan the QR code with an authenticator app, and you're in.

**Adding staff:** create their user in Supabase (step 3), then Settings → Team → add their email as Staff or Owner. They set up two-step verification on first sign-in.

## Shopper pages (Phase 2)

| Page | What it does |
|---|---|
| `/shop/` | Every colour of every bag. Search, collection and colour filters, in-stock only, sort. Filters live in the URL, so a filtered view can be shared. |
| `/product/?c=sling&colour=crimson` | Gallery, colour picker with per-colour price and stock, quantity, add to bag, wishlist, delivery estimate by PIN code, design details and specs, related bags. Sold-out colours offer an email alert. Includes Google-readable product data (schema.org). |
| `/account/` | Sign in with an emailed code (or Google). Orders with progress, wishlist, address book (up to 10, one default), profile with marketing consent, and requests to export or delete personal data (DPDP Act). |

- **Bag and wishlist:** saved in the browser for guests. Signing in merges them into the account so nothing is lost, and keeps them in sync across devices. Signing out clears them from that browser. Bag lines are stored by SKU, and bags saved before Phase 2 are converted automatically.
- **Collection details** (description, design details, specifications, care): edited in the admin under Products → *Collection details*. Specs are blank to start, because the brand deck has none. Empty rows aren't shown.
- **Back-in-stock alerts** are collected now. The admin shows "N waiting" next to sold-out colours. The emails themselves are sent in Phase 4.
- **Delivery estimates** are rough PIN-code zones in `src/delivery.js` until the courier integration (Phase 5) gives real ones. Edit the zones once you know where orders ship from.

### What each role can do

| | Shopper / public | Staff | Owner |
|---|---|---|---|
| See active products and published editorial | ✓ | ✓ | ✓ |
| Own profile, addresses, wishlist, bag, orders (own only) | ✓ (signed in) | ✓ | ✓ |
| Ask for a back-in-stock email | ✓ | ✓ | ✓ |
| See draft products, orders, customer details | | ✓ | ✓ |
| Edit products, price, stock, images; add products; collection details | | ✓ | ✓ |
| See back-in-stock requests and saved addresses | | ✓ | ✓ |
| Change order status; publish editorial | | ✓ | ✓ |
| Remove products; change the low-stock threshold | | | ✓ |
| Manage the team; see the activity log and data requests | | | ✓ |

These rules are enforced by the database (row level security in the migration), not only by hiding buttons. Admin rights also require a two-step-verified session, so a stolen password alone is not enough.

### How saving works

- The storefront loads products and editorial content from the database on each visit. It keeps a cached copy and falls back to it if the database can't be reached.
- In the admin, a change appears straight away and is written to the database in the background (`src/store.js` → `src/lib/sync.js`). If the database refuses (no permission, invalid value, network), a message explains why and the screen reloads the real data.
- New images are resized in the browser, uploaded to Storage, and saved as permanent URLs.
- Every stock change is recorded in `inventory_log` (shown as *Stock history* when editing a product). Every change to products, orders, editorial and the team is recorded in `audit_log` (Settings → Recent activity).

### Tests

- `npm test` runs both suites.
- `npm run test:unit`: how admin edits turn into database writes and image uploads.
- `npm run test:db`: runs the real migrations and seed in an in-process Postgres and checks 78 access rules (guest, shopper, staff with and without two-step verification, owner).

### Still to do (later phases)

- **Phase 3:** checkout and Razorpay. Orders will be created by a server function that re-checks prices and stock. Browsers can never create orders.
- **Phase 4:** order and shipping emails.
- **Phase 5 onwards:** shipping (Shiprocket), invoices, legal pages, security hardening, SEO and monitoring.
