# App Store listing - AI Visibility All-in-One

Every text below is ready to paste into the listing form. The listing has
one job (PRD §6): nothing in the app is visible before paying, so the
listing does the demonstrating. It sells the failure mode of the
alternatives - apps that guess describe one product as another - and the
one guarantee no competitor makes: nothing a person wrote is ever
overwritten, and everything stays in your metafields if you leave.

## App name (30 characters max)

AI Visibility All-in-One

## Tagline / introduction (100 characters max)

Make your catalogue readable by ChatGPT, Claude, Gemini and Perplexity.
Nothing invented, ever.

## App details (500 characters max)

AI assistants recommend products they can read. This app reads the
descriptions you already wrote, extracts the attributes buyers compare
(material, dimensions, colour, what a set includes) and publishes them as
structured data, plain text for crawlers, and comparison tables on your
collection pages. Deterministic extraction, no AI guessing: the app only
writes what your descriptions actually say. Anything you edit by hand is
never overwritten. All data lives in your metafields and stays yours.

## Feature list (5 bullets, 80 characters each)

- Extracts comparable attributes from descriptions you already wrote
- Structured data on products and collections, zero JavaScript in your theme
- Comparison tables assistants and buyers can actually use
- Checks whether AI crawlers can reach your store, and tells you why not
- Your edits are never overwritten; everything stays in your metafields

## Demo / how it works (long description section)

**Why this exists.** When someone asks an AI assistant "which dining set
under 2000 lei seats six", the assistant answers from what it can read.
A page whose attributes live only in a photo or a PDF is invisible. Most
stores' pages are exactly that.

**What it does.** The app reads each product description and extracts the
attributes a buyer compares: material, finish, dimensions, colour, what
the set includes, how many it seats. It writes them to metafields under
proper definitions, publishes them as schema.org structured data through
a theme app embed (static markup, no JavaScript, no performance cost),
serves a plain text version of every product for crawlers that do not run
JavaScript, and builds comparison tables for your collections from
attributes that actually differ between products.

**What it refuses to do.** It never invents a value. If your description
does not state the material, the material stays empty - a gap is honest,
a guess is a returned order. Apps that use AI to fill attributes routinely
describe one product as another; this one is deterministic and only writes
what your text says.

**What stays yours.** Every value lives in Shopify metafields with proper
definitions. Edit any value by hand and the app never touches it again.
Uninstall and everything keeps working - the structured data, the
attributes, all of it. The app maintains the data; it does not hold it
hostage.

**Set up in minutes.** Install, pick your trade's dictionary preset,
translate the terms into the language of your descriptions, preview what
would be written (a dry run writes nothing), then fill the catalogue. New
and edited products are picked up automatically from then on.

## FAQ for the listing

**Does this app use AI to generate content?**
No. Extraction is deterministic - pattern matching against a dictionary
you control. That is the point: apps that generate can hallucinate; this
one only publishes what your descriptions already say.

**Will it overwrite my product data?**
Never. The app records what it wrote and when. A value written or edited
by a person is never touched again. A value it cannot account for is
treated as human and left alone.

**What happens if I uninstall?**
Everything stays. Attributes, summaries and tables live in your Shopify
metafields, which belong to you. Your theme can keep rendering them
without our app.

**Does it slow down my storefront?**
No. The storefront output is static markup rendered by Shopify - no
JavaScript, no external requests, nothing that executes in the browser.

**Does it work in my language?**
The dictionary is yours: presets for 20 trades, with terms you translate
into whatever language your descriptions use. The extraction matches your
terms, diacritics included.

**Can it guarantee my products appear in ChatGPT?**
No, and be wary of anyone who promises that. What it guarantees is
readability: your attributes published where assistants look, in the
formats they parse, with a crawler check that tells you if something on
your store blocks them.

## Pricing display

Standard - $99/year. Catalogues up to 20,000 products. Everything included.
High volume - $149/year. No product limit, priority support.
No free tier, no trial. The app does most of its work in the first
fifteen minutes; a trial would be a free extraction.

## Categories and search terms

Category: Search engine optimization - or "Selling products - Product
descriptions" if the SEO category is contested. Verify what the form
offers at submission time.

Search terms (comma separated):
ai seo, ai visibility, chatgpt, structured data, json-ld, product
attributes, metafields, comparison table, geo, answer engine
optimization, ai search, perplexity

## Support

Email: hello@mrdigital.ro
Stated response time: one working day, by email.

## Screenshots to capture (1600x900 or 1200x900, desktop)

Take these after `fly deploy`, on the dev store with real furniture data,
English admin. No fake numbers: the dashboard already shows real ones.

1. Dashboard - metrics row (355 products, 99% coverage), crawler check
   verdicts visible. The money shot: state of your catalogue in one glance.
2. Product editor - attributes on the right, "For comparison" reading
   below, images with alt text states on the left. Shows the protection
   story: Automatic vs Manual.
3. Collections screen - "Canapele: 22 products, compared on Dimensiuni,
   Culoare, Material, Stil". No competitor has this screen.
4. Storefront comparison table on a collection page, in a clean theme.
5. Dictionary editor with a preset loaded - shows the merchant controls
   the vocabulary.
6. Diagnostics - the crawler check explaining exactly why a crawler
   cannot read the store and what to change.

## App icon

1200x1200, no text (Shopify rejects text in icons), simple mark on the
brand background. Suggestion: an eye or aperture motif made of table rows
- visibility built from structured data. Produce in the design pass.

## Submission checklist (PRD §5, verify before submitting)

- [ ] GDPR webhooks live on production and answering 200
- [ ] Privacy policy URL published (PRIVACY.md content)
- [ ] Support email in the listing matches the one that answers
- [ ] App embed verified active on a fresh install (onboarding gate)
- [ ] Billing test: install on a fresh dev store, subscribe, cancel
- [ ] LCP / performance re-checked from Fly, not the dev tunnel
- [ ] Listing screenshots taken from production, not the tunnel
