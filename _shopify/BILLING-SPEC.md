# BILLING-SPEC — plans, enforcement and the upgrade path

Build brief. Written 2 August 2026. Companion to `PRD.md` §6.

---

## 1. The plans

| Handle | Name | Price | Limit | Trial |
|---|---|---|---|---|
| `standard` | Standard | $29.00 USD / month | up to 20,000 products | none — see §4 |
| `high_volume` | High volume | $49.00 USD / month | above 20,000 products | none — see §4 |

Same features on both. The second plan exists as a fair-use valve for the
rare large catalogue, not as a feature gate. Never describe it as "Pro" or
"Enterprise": it is not better, it is for bigger catalogues.

No free plan at launch. Free installs are the main source of one-star
reviews, and we have no review history to absorb them. Revisit once the
paid funnel converts.

## 2. Shopify Billing API

- `appSubscriptionCreate` with a recurring `appRecurringPricingDetails`,
  interval `EVERY_30_DAYS`, `trialDays: 7`, `test: true` on development
  stores.
- `returnUrl` comes back into the embedded app, never to an external page.
- Read the current subscription with `currentAppInstallation {
  activeSubscriptions { name status lineItems } }` — never trust a locally
  cached plan for access decisions.
- Store the plan handle on `Shop.plan` for display and for the limit check;
  treat Shopify as the source of truth on every load of the billing screen.
- Cancellation, refunds and dunning are Shopify's job. Do not build them.

## 3. Enforcement — deliberately gentle

The check is a product count, run when a bulk pass starts and once a day,
not on every request.

```
count <= 20,000                     → run normally
count > 20,000 and plan standard    → run, show the upgrade banner,
                                      start a 14-day grace period
grace expired and still standard    → refuse new full passes only
```

What we never do:

- Never stop webhook-driven extraction of individual products. A merchant
  who is over the limit still gets new products processed; only the
  expensive full pass is withheld.
- Never delete or hide data already written. It lives in the merchant's
  metafields and belongs to them (PRD §4.1).
- Never break silently. The banner names the number: "Your catalogue has
  grown to 23,410 products. Move to High volume to keep running full
  passes." A growing merchant surprised by a broken app leaves a one-star
  review that costs more than the price difference.

## 4. No time-limited trial. The dry run is the trial.

**Why no trial (decided 2 Aug 2026).** This app's value is front-loaded:
one full pass does most of the work a catalogue will ever need. A seven-day
trial is therefore an invitation to extract everything and cancel on day
two — the merchant keeps the metafields, because they are genuinely theirs,
and we are paid nothing for the work.

**What replaces it, and why it is better.** The dry run is free, unlimited,
and needs no card:

| Free, forever | Requires a plan |
|---|---|
| Dictionary editor, all 20 trade presets | Writing attributes to metafields |
| "Test on 40 products" with real examples | Summaries, questions, who-it-suits |
| Full dry run: coverage, per-label counts, 20 worked examples | Alt text |
| Crawler visibility check | The plain text mirror and JSON-LD output |

The merchant sees precisely what they would get — computed from their own
descriptions, not a demo — without receiving it. No countdown, no expiry,
no "I never got round to testing it" churn, and nothing to free-ride on.

**The remaining risk, stated honestly.** A merchant can pay for one month,
run the pass, and cancel. That cannot be engineered away: the data lives in
their metafields and stays theirs (PRD §4.1) — that promise is worth more
than the churn it costs. Mitigate it with what is genuinely recurring, and
say so on the listing rather than hiding it:

- new and edited products processed automatically (three freshness layers,
  ARCHITECTURE §4.1);
- the dictionary refined as the catalogue grows into new categories;
- alt text for every new image;
- crawler checks after a theme change, a security app, or a new domain.

The line for the listing: *this is maintenance, not a one-off clean-up.*

## 5. Screens

**Billing** — two cards side by side, the merchant's own numbers in the
copy ("You have 355 products — Standard covers your catalogue"), the
current plan marked, and a single button per plan. Include one line on
what happens if they cancel: *your extracted attributes stay in your
Shopify metafields and keep working, with or without this app.* That
sentence is a selling point, not a disclaimer.

**Dashboard** — no pricing noise. At most one banner, and only when the
limit is genuinely crossed or the trial has three days left.

## 6. Data model

`Shop.plan` holds the handle (`none` | `standard` | `high_volume`), plus
`Setting` rows for `plan_checked_at` and `grace_started_at`. No new tables.

## 7. What not to build

- Usage metering or per-product charges. Our marginal cost is near zero
  because the engine calls no model; metering would add complexity that
  buys nothing.
- Annual plans at launch. Shopify supports them; revisit when monthly
  churn is understood.
- Coupons and partner discounts. Shopify's own mechanisms cover this.
