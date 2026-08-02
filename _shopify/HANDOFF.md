# Handoff — starting the Shopify project in a fresh chat

Copy this whole folder into `F:\AI Visibility SHOPIFY`, connect that folder,
and open a new conversation. Everything needed is in `PRD.md` and
`LAUNCH-PLAN.md`.

---

## What to say first in the new chat

> Read PRD.md and LAUNCH-PLAN.md in this folder. This is a Shopify app,
> separate from the WordPress plugin. Start with Phase 0.

---

## Context the new chat will not have

**The WordPress product is live and selling.** Version 1.6.6, sold on Lemon
Squeezy at €99, €199 and €499 a year, with the store verification still in
review at the time of writing. Landing page at `mrdigital.ro/ai-visibility`.

**The extraction engine is the crown jewels, and it is already correct.** It
lives in `plugin/ai-visibility/includes/class-avw-attributes.php` in the
WordPress folder, with 96 assertions covering it in `tests/smoke-test.php`. The
Shopify port must reproduce its behaviour exactly, including:

- a term followed by a verb or connector produces nothing rather than a
  fragment
- `#size` reads measurements directly out of prose
- `* term` reads a count written before the noun
- diacritic variants collapse to one value
- nothing a human wrote is ever overwritten

Those rules came from real failures on a live furniture catalogue. Do not let
them be re-derived from scratch.

**The alt text lesson.** Alt text belongs to the image file, not the product.
A shared image inherits the description written for whichever product was
processed first, and the result is one product described as another. On Shopify
the same media can be attached to several products, so this has to be handled
in the design rather than discovered later.

**Brand.** Ink `#201e1d`, accent `#ec3013` in the product, `#FF2E4D` on the
landing page and ad creatives. Inter. English throughout, no em dashes.

---

## Open questions blocking Phase 0

1. Is the name `AI Visibility` free on the Shopify App Store?
2. Where does the backend run? It shapes the job queue and has to answer at
   p95 under 500 ms.
3. Development store with a real seeded catalogue, ideally the furniture one.
4. Am I building it directly, or writing the specification for Claude Code and
   reviewing the output?
