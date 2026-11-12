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
   - `supabase/migrations/20261112020000_phase3_checkout.sql`: pricing, stock holds, orders and payments, coupons, refunds
   - `supabase/migrations/20261112030000_phase4_emails.sql`: email outbox and triggers, newsletter, order tracking
   - `supabase/migrations/20261112040000_phase5_fulfilment.sql`: shipments and tracking, GST invoices, returns, delivery estimates
   - `supabase/migrations/20261112050000_phase6_compliance.sql`: legal and care details, support tickets, privacy export and erasure, product declarations and MRP
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

## Checkout and payments (Phase 3)

How an order is placed:

1. `/checkout/` asks the database for a **quote** (`quote_checkout`). The database reprices the bag from live products, applies the discount code, shipping and the cash-on-delivery fee. Anything sold out or reduced is fixed in the bag and explained to the shopper.
2. **Place order** calls the `checkout` Edge Function. It runs `create_order` in the database, which locks the products and takes the stock in one step, so two shoppers can't buy the last bag. Browsers can't call this function.
   - **Cash on delivery:** the order is confirmed straight away.
   - **Online:** a Razorpay order is created for the exact total and the Razorpay window opens. Stock is held for 15 minutes (adjustable).
3. When Razorpay reports success, `payment-verify` checks Razorpay's signature, fetches the payment from Razorpay, captures it if needed, checks the amount, and marks the order paid.
4. The `razorpay-webhook` function does the same if the shopper closes the tab before step 3. Repeat confirmations are harmless.
5. Unpaid holds are released automatically (every 5 minutes with pg_cron, and on every checkout). If a payment arrives after its hold expired, the stock is taken again. If it has sold out meanwhile, the order is flagged for a refund on the admin overview.
6. `/order/?id=…&t=…` is the confirmation page. The `t` value is a secret given only to the buyer.

**Admin:**
- Orders show payment status (Paid, Cash due, Awaiting payment, Refunded…). Unpaid checkouts sit under their own tab.
- Owners can **cancel** an order (restocks, and refunds anything paid online) or **refund** part or all of a payment, with an optional restock. Both go through the `admin-order` function, which checks the caller is an owner with two-step verification.
- **Discounts:** create percentage or rupee codes with a minimum order, dates and a use limit.
- **Settings:** shipping fee, free-shipping threshold, cash on delivery (on/off, fee, limit) and how long items are held.

### Setting up Razorpay

1. Create a Razorpay account. **Start KYC early**: live payments need it, and it can take 1–3 weeks. Test mode works immediately.
2. Razorpay Dashboard → *Account & Settings* → *API Keys*: generate **test** keys.
3. Give the keys to the Edge Functions (never to the website):
   ```
   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx \
     RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string ALLOWED_ORIGINS=https://yourdomain.com
   supabase functions deploy checkout payment-verify razorpay-webhook admin-order
   ```
4. Razorpay Dashboard → *Webhooks* → add `https://YOUR-PROJECT-REF.supabase.co/functions/v1/razorpay-webhook`. Use the same webhook secret, and select the events `payment.captured`, `payment.failed` and `order.paid`.
5. Supabase → *Database* → *Extensions*: enable **pg_cron**, then re-run the last block of the Phase 3 migration (it schedules the hold release).
6. Test with Razorpay's test cards or the UPI ID `success@razorpay`, then check the order in the admin.
7. To go live: after KYC, swap in **live** keys and a live webhook. Nothing else changes.

Without Razorpay keys, online payment shows as unavailable. Cash on delivery still works if you switch it on.

## Emails (Phase 4)

Every email is written to the `email_outbox` table by the same database change that caused it, so none are lost or duplicated. The `send-emails` function sends them through **Resend** every minute. A failed send is retried after 2, 4, 8 and 16 minutes, then marked failed so an owner can retry it from Settings.

| Email | Sent when | To |
|---|---|---|
| Order confirmed | An online payment is confirmed, or a cash-on-delivery order is placed | Customer |
| On its way | Staff mark the order **Shipped** (includes courier, tracking number and link if entered) | Customer |
| Delivered | Marked **Delivered** | Customer |
| Cancelled | An order is cancelled (says whether money is being refunded) | Customer |
| Refund | A part or full refund is made | Customer |
| Back in stock | A sold-out colour gets stock again (once per request) | Shoppers who asked |
| Bag reminder | A signed-in shopper's bag has been left for 3 hours. **Off by default**, and only for people who agreed to marketing emails. One per bag per day. | Shopper |
| Confirm subscription | Someone signs up in the footer (double opt-in) | Them |
| New order / Needs a look / Low stock | New confirmed order; a payment that needs refunding; a colour drops to the low-stock level (once a day) | The store address in Settings |

Unpaid online checkouts that expire send nothing. Marketing emails (bag reminders) carry an unsubscribe link and one-click unsubscribe headers. The newsletter page asks for a click before unsubscribing, so email security scanners can't unsubscribe people by opening links.

**Admin:**
- The order panel has *Shipping details* (courier, tracking number, link) and lists every email sent for that order.
- *Settings → Notifications* sets the store alert address and the bag reminder, and shows recent emails with a *Retry* for failures.
- *Settings → Newsletter* shows the subscriber count and downloads a CSV.

### Setting up email

1. Create a Resend account and **verify your sending domain** (it gives you DNS records: SPF, DKIM and a return path). Add a DMARC record too, so mail lands in inboxes.
2. Set the function secrets and deploy:
   ```
   supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="VERTU <orders@yourdomain.com>" \
     EMAIL_REPLY_TO=contact.shopvertu@gmail.com SUPPORT_EMAIL=contact.shopvertu@gmail.com \
     SITE_URL=https://yourdomain.com EMAIL_CRON_SECRET=choose-a-long-random-string
   supabase functions deploy send-emails email-unsubscribe
   ```
3. Edit the two values at the top of `supabase/schedule_emails.sql` (your project URL and the same cron secret), then run it in the SQL editor. It calls `send-emails` every minute.
4. **Sign-in emails:** under Authentication → Emails → SMTP settings, use Resend's SMTP details so Supabase's own emails come from your domain too. Then paste the branded templates from `supabase/templates/` into Authentication → Emails → Templates (subjects are in `subjects.json`). The *Magic Link* template already includes the 6-digit `{{ .Token }}` that the account page asks for.
5. In the admin: Settings → Notifications, enter where store alerts should go.
6. Test: place a cash-on-delivery order, wait a minute, and check both inboxes and *Recent emails*.

`npm test` writes `email-previews/index.html`, a page showing every email with sample data.

SMS and WhatsApp updates are not included. They need an Indian provider (MSG91, Gupshup) and DLT registration of your sender ID and message templates. The outbox design makes them a small addition later.

## Shipping, invoices and returns (Phase 5)

**Shipping with Shiprocket** (order panel → *Shipment*):
1. **Choose a courier** compares prices and delivery times for the parcel. Its size comes from each collection's parcel details; cash-on-delivery orders only show couriers that collect cash.
2. **Book courier** creates the Shiprocket order, gets the tracking number (AWB), prints the label, schedules pickup and issues the GST invoice.
   - If the courier can't be assigned, the Shiprocket order is kept and booking again reuses it, so nothing is duplicated.
   - *Cancel shipment* works until the courier collects the parcel.
3. Shiprocket's tracking webhook (`courier-updates`) updates the order automatically:
   - picked up → **Shipped** (sends "on its way")
   - out for delivery → an "arriving today" email
   - delivered → **Delivered** (cash orders become paid)
   - returned to origin or failed delivery → flagged on the overview, and the store is emailed
   - an older update arriving late never moves an order backwards
   - *Refresh tracking* pulls updates by hand.
4. Customers see the courier, tracking number, expected date and full tracking history on their order page.
5. **Delivery estimates** on product pages and at checkout come from Shiprocket for the shopper's PIN code, cached for a day per PIN. They fall back to rough zones if Shiprocket isn't connected. Checkout refuses PINs no courier serves, and cash on delivery where couriers don't collect cash.

**GST invoices:**
- Issued automatically when an order is booked or ships, or by hand with *Invoice* in the order panel.
- Numbered `VRT/26-27/0001`, restarting each April; numbers never repeat or skip.
- Prices are GST-inclusive, so tax is worked backwards (taxable = amount × 100 / (100 + rate)).
- Same state as your business: CGST + SGST. Another state: IGST.
- Discounts are spread across the lines. Shipping and cash-on-delivery fees are taxed with the goods.
- Customers download theirs from the order page. Each invoice is a snapshot, so later changes to settings don't alter issued invoices.
- If you're not GST-registered, invoices show no tax.
- **Check with your accountant:** HSN code (4202 is set; sub-heading by material), rate (18% is set), and how shipping is treated. All are editable per collection.

**Returns:**
1. Customers ask from their order page within the return window (Settings; 7 days by default, 0 turns returns off). They choose items and quantities and give a reason. They and the store are emailed.
2. *Returns* in the admin: approve or decline with a message (emailed), then *Book return pickup* (a Shiprocket reverse pickup, tracked automatically).
3. *Check in and restock*: only the returned items go back into stock, and the refund is suggested (item prices less the order's discount share).
4. Owners *Refund* (online payments) or mark *Refunded by bank transfer* (cash orders). The refund email goes out automatically.

**Orders → Export CSV** downloads the orders in the current tab, for accounting.

### Setting up Shiprocket

1. In Shiprocket: add your **pickup address** (Settings → Pickup addresses) and note its exact name. Create an **API user** (Settings → API → Configure → Create API user) with an email different from your login.
2. In the admin, Settings:
   - *Business and invoices*: legal name, address, city, state, phone, GSTIN.
   - *Shipping and payment*: the pickup location name and pickup PIN.
   - Then under Products → *Collection details*, weigh and measure one packed bag per collection.
3. Secrets and deploy:
   ```
   supabase secrets set SHIPROCKET_EMAIL=api-user@yourdomain.com SHIPROCKET_PASSWORD=xxx \
     SHIPROCKET_WEBHOOK_TOKEN=choose-a-long-random-string
   supabase functions deploy admin-shipping courier-updates delivery-estimate
   ```
4. In Shiprocket: Settings → API → Webhooks.
   - URL: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/courier-updates`
   - Token: the same `SHIPROCKET_WEBHOOK_TOKEN`
   - Shiprocket rejects webhook URLs containing "shiprocket", "sr" or "kr". That's why the function is called *courier-updates*. If your project reference itself contains "sr" or "kr", put a custom domain in front.
5. Book a test order. Shiprocket bills courier charges to your Shiprocket wallet, so keep it topped up.

## Legal and compliance (Phase 6)

> The policies and disclosures here are a careful starting point built from the 2026 Indian rules, not legal advice. Have a lawyer read them before launch, then record the review date in Settings.

**Policy pages** (`/legal/?p=privacy|terms|shipping|returns|cancellation`) are written from your Settings: legal name, registered address, GSTIN, care and grievance contacts, return window, dispatch days, return shipping fee and COD rules. When you change a setting, the policy text changes with it. Every page footer links to them, shows who the seller is, and has a *Privacy choices* link.

**Contact and grievances** (`/contact/`) follow the Consumer Protection (E-Commerce) Amendment Rules 2026:
- The page shows the seller, registered office, GSTIN, customer care contacts and hours, the grievance officer, and the National Consumer Helpline (1915).
- A complaint gets a reference (`VRT-T-1001`…), and the customer immediately receives an acknowledgement email with a copy of their message. That covers the 48-hour acknowledgement rule.
- Each ticket is due within one month. *Support* in the admin shows open tickets, and flags ones that are overdue or due within a week.
- Order pages link to the contact form with the order number already filled in. The form is limited to 5 messages per email per day and has a spam trap.

**Privacy requests** (DPDP Act 2023 and Rules 2025). Customers ask from their account; owners see the requests under Support.
- *Export* downloads everything held about the person as JSON.
- *Erase* deletes their account, addresses, wishlist, bag, newsletter and stock alerts, and anonymises closed tickets. Orders and GST invoices are kept for the 8 years tax law requires, no longer linked to an account.
- The person is emailed when their request arrives and again when it's done.

**Product declarations** (Legal Metrology rule 6(10)). Under Products → *Collection details*, fill in each collection's generic name, net quantity, country of origin, maker/importer and month of manufacture. Each product's MRP (inclusive of all taxes) goes on the product form, and it can't be lower than the price. Both appear on the product page under *Product information*. The page shows a "was" price only when the MRP is higher than the price.

**Settings → Compliance checklist** shows what is still missing: grievance officer, care contacts, declarations and MRPs, lawyer review, self-audit.

**Settings → Dark patterns self-audit** walks through the 13 patterns in the CCPA's 2023 guidelines, from false urgency to drip pricing. You can record the audit only once every box is ticked, and the contact page then shows its date. Repeat it every year.

**Cookie consent:** the site uses no analytics or advertising cookies today, only what's needed to keep you signed in and remember your bag. That's why no banner appears. If you later set `VITE_ANALYTICS_PROVIDER`, a consent banner appears, and analytics stays off until the visitor agrees.

### Setting up Phase 6

1. Run the new migration: `supabase db push`, which applies `20261112050000_phase6_compliance.sql`.
2. Deploy the new function: `supabase functions deploy admin-privacy`
3. In the admin, Settings:
   - *Legal and customer care*: registered address, care email, phone and hours, grievance officer, dispatch days, return shipping fee.
   - Then fill in the declarations for each collection, and an MRP for each product.
   - Complete the dark-patterns self-audit.
   - Work through the compliance checklist until it's clear.
4. Note: the DPDP Rules' main duties apply from 14 May 2027, and the e-commerce amendments from 1 Jan 2027. Personal-data breaches must be reported to the Data Protection Board and affected people within 72 hours.

### What each role can do

| | Shopper / public | Staff | Owner |
|---|---|---|---|
| See active products and published editorial | ✓ | ✓ | ✓ |
| Own profile, addresses, wishlist, bag, orders (own only) | ✓ (signed in) | ✓ | ✓ |
| Ask for a back-in-stock email | ✓ | ✓ | ✓ |
| See draft products, orders, customer details | | ✓ | ✓ |
| Edit products, price, stock, images; add products; collection details | | ✓ | ✓ |
| See back-in-stock requests and saved addresses | | ✓ | ✓ |
| Change order status; publish editorial; manage discount codes | | ✓ | ✓ |
| Book couriers, print labels, issue invoices; approve, pick up and check in returns | | ✓ | ✓ |
| Cancel and refund orders (including return refunds); shipping, payment and business settings | | | ✓ |
| Remove products; change the low-stock threshold | | | ✓ |
| Answer support tickets; edit collection declarations and MRPs | | ✓ | ✓ |
| Manage the team; see the activity log; export or erase personal data; legal settings and self-audit | | | ✓ |

These rules are enforced by the database (row level security in the migration), not only by hiding buttons. Admin rights also require a two-step-verified session, so a stolen password alone is not enough.

### How saving works

- The storefront loads products and editorial content from the database on each visit. It keeps a cached copy and falls back to it if the database can't be reached.
- In the admin, a change appears straight away and is written to the database in the background (`src/store.js` → `src/lib/sync.js`). If the database refuses (no permission, invalid value, network), a message explains why and the screen reloads the real data.
- New images are resized in the browser, uploaded to Storage, and saved as permanent URLs.
- Every stock change is recorded in `inventory_log` (shown as *Stock history* when editing a product). Every change to products, orders, editorial and the team is recorded in `audit_log` (Settings → Recent activity).

### Tests

- `npm test` runs both suites.
- `npm run test:unit`: how admin edits turn into database writes and image uploads.
- `npm run test:db`: runs the real migrations and seed in an in-process Postgres and checks 225 rules: access (guest, shopper, staff with and without two-step verification, owner), pricing, coupons, stock holds and expiry, late payments, refunds, which emails are queued when, tracking updates, GST invoice maths and numbering, the returns lifecycle, support tickets, and privacy export and erasure.
- `tests/payments.test.mjs`: the Edge Function logic against that same database with a fake Razorpay. Covers signatures, forged and replayed payments, webhooks, retries, Razorpay outages, refunds and cancellations.
- `tests/pricing-parity.test.mjs`: the browser's pricing matches the database's.
- `tests/shipping.test.mjs`: the Shiprocket logic against the real database with a fake Shiprocket. Covers login caching and re-login, parcel and order payloads, booking, a failed tracking number followed by a retry, cancelling, manual tracking sync, reverse pickups, delivery estimates and webhook parsing.
- `tests/emails.test.mjs`: every template renders cleanly and escapes customer input, plus the sender's sending, retries, auth and configuration checks against the real outbox.

### Still to do (later phases)

- **Phase 7:** security hardening, performance, SEO (prerendered product pages, sitemap), analytics, monitoring and backups.
- Later: credit notes for refunds (ask your accountant whether you need them), customers list, bulk product import, SMS/WhatsApp.
