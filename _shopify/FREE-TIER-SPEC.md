# FREE-TIER-SPEC - what a merchant can do before paying

Build brief. Written 28 August 2026. Decided by Marius the same day.

This document changes a rule that was hard until now. `BILLING-SPEC.md` and
the "No trial, no free tier" line in `CLAUDE.md` are both superseded on this
point, and both carry a pointer here.

---

## 1. What changed, and why it is not a trial

The original rule said: no trial, because the app does most of its work in the
first fifteen minutes, so a trial gives the product away. That reasoning still
holds and is not being abandoned.

What is being added is not time-limited access to everything. It is a
permanent, quantity-limited demonstration: the diagnosis, plus three products
actually processed. A trial hands over the product for a while. This hands over
a sample, forever, and never the volume.

The second reason is commercial. The cold email asks a merchant to believe they
have a problem they cannot see. Charging 99 dollars to find out whether the
problem exists is the wrong order. Now the answer is free and the fix is paid.

---

## 2. What is free

**The crawler access check**, unlimited. Eight requests to the merchant's own
storefront, one per crawler. It publishes nothing and costs us almost nothing.

**The coverage score.** The dry run already exists and writes nothing: how many
products have something extractable, which attributes would be found, how many
state nothing at all. This is the honest version of "what would this do for
me", computed against the merchant's real catalogue.

**Three products, fully processed.** Not a preview - the real write. Attributes,
summary, buyer questions, the plain text copy, the structured data on the page.
The merchant chooses which three, because they will choose the product they
care about, which is also where the result is most convincing.

Three is deliberate: enough to open a product page, view the source, and read
the plain text copy; too few to run a shop on.

## 3. What is not free

Everything that is volume or continuity:

- the rest of the catalogue
- automatic freshness (webhooks, the poll, the weekly sweep)
- collections and comparison tables
- bulk alt text
- IndexNow
- variant-level attributes beyond the three products

## 4. The cap, and the hole to avoid

**The count lives on the `Shop` row, not on a session and not in a setting that
resets.** A merchant who uninstalls and reinstalls keeps the same `Shop` row,
keyed by domain, and therefore the same count. Without this, the free tier is
an infinite loop of reinstalls.

Count what was written, not what was attempted: a failed write must not consume
one of the three.

The three products are chosen by the merchant, one at a time, from the Products
screen. There is no separate selection screen: a "Process this product" action
on a row, with the remaining count next to it, is enough.

**What is written stays written.** If the merchant never subscribes, the three
products keep their attributes, their summary, their questions and their
structured data. Taking them back would contradict the rule that merchant data
lives in their store and survives our uninstall, and it would be petty. Say so
on the screen: it is a better argument than the offer itself.

## 5. The gate

Today every route under `/app` verifies the subscription on load. Three things
must now load without one:

- the dashboard, showing the score and the setup state
- diagnostics, for the crawler check
- the products list, for the three writes and to read what was published

Everything else redirects to the plans screen as it does now. The plans screen
stays reachable from everywhere, and stays the first thing offered once the
three are used.

A merchant with an active subscription sees none of this: no counts, no
remaining, no upgrade prompts on screens they have already paid for.

## 6. What this does to the copy

Three published texts say "no trial and no free tier, on purpose", as a virtue:
the landing page pricing note, the cold email, and the client deck. All three
become wrong the day this ships.

The replacement is not weaker, it is more specific. Something close to:

> You can see the whole diagnosis, and have three products fully processed,
> before paying anything. Nothing is published until you ask for it, and what
> is published stays yours whether you subscribe or not.

The "no trial" claim can stay in one narrow form, because it is still true:
there is no time limit and nothing is taken away at the end. What ended was
the refusal to demonstrate.

## 7. What this does not become

No coupons. No discounts. No second paid tier below 99. No time-limited
anything. The only quantity that exists is three, and it is permanent.

If a merchant asks for more free products, the answer is no, and the reason is
the honest one: the app does its work in bulk, and bulk is the product.
