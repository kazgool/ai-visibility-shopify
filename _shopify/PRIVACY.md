# Privacy Policy - AI Visibility All-in-One

Publish this at a stable URL (e.g. mrdigital.ro/ai-visibility/privacy)
before submission; the listing form requires the link. Plain language on
purpose: the audience is a merchant deciding whether to trust us, and a
Shopify reviewer checking the GDPR story.

Effective date: [set at publication]

## Who we are

AI Visibility All-in-One ("the app") is operated by SC RHEADIGITAL SRL,
Romania ("we"). Contact: hello@mrdigital.ro.

## What the app reads

The app reads, from your Shopify store, with your authorization:

- Product data: titles, descriptions, images and their alt text, variants,
  prices, availability, collections.
- Theme data: whether our app embed is enabled, and what structured data
  your published theme already emits.
- Store metadata: shop domain, plan, product count.

The app does not read customer data. It requests no customer scopes, and
it never sees names, addresses, orders or payment details of your buyers.

## What the app writes

The app writes extracted attributes, summaries, questions and comparison
tables to metafields in your store. Metafields belong to you: they remain
in your store if you uninstall.

## What we store on our servers

- Your shop domain and installation state.
- Job history: when extraction ran, how many products were processed,
  what was written. This is what the progress screens show you.
- Your dictionary and settings.
- A cache of the plain text mirror pages.
- Raw request records for the plain text mirror: the requesting user agent,
  the client IP address if the request supplied one, the path and product
  handle requested, the response status, and the timestamp. This lets us
  confirm that AI crawlers are reading the mirror we publish. We also record,
  for the same diagnostic purpose, the raw values of the request forwarding
  headers present on the request (such as x-forwarded-for and
  cf-connecting-ip); this is temporary instrumentation to determine whether a
  real client address is available at all. Raw records are kept for 30 days.

We store no customer personal data, because we never receive any.

## Payments

Billing is handled entirely by Shopify through their Billing API. We
never see your payment details.

## GDPR

We support Shopify's mandatory privacy webhooks:

- `customers/data_request`: we hold no customer data, and answer so.
- `customers/redact`: nothing to delete, acknowledged regardless.
- `shop/redact`: within 48 hours of this webhook (sent by Shopify after
  uninstall), all stored data about your shop is deleted from our systems.

For any privacy request, write to hello@mrdigital.ro; we answer within
one working day.

## Third parties

Our infrastructure runs on Fly.io (hosting, EU and US regions) and Neon
(Postgres database, Frankfurt, EU). Both act as processors; neither
receives customer personal data, because we hold none.

We do not sell, share or monetise any data. No analytics trackers run in
your admin or on your storefront through this app.

## Changes

We update this page when practice changes, and note the effective date
above. Material changes are announced by email to installed merchants.
