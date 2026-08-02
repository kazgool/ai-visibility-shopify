# Ideas carried over from the WordPress module, plus Shopify-only additions

Read 2 August 2026 from the live 1.6.6 source. These are decisions that were
paid for with real failures on a live catalogue; the Shopify build should not
re-derive them. Anything marked **NEW** has no WordPress equivalent and is a
Shopify-specific opportunity.

---

## 1. Alt text — the rules that matter (`class-avw-images.php`)

- **Never put the summary in alt text.** Screen readers read alt aloud in
  full, and keyword-stuffed alt reads as spam. Short and specific in `alt`,
  the long description belongs in the caption and in structured data.
- **125 characters, hard cap.**
- **Build alt from visually descriptive attributes only**, in priority order:
  material/fabric/finish → cut/silhouette/shape/style → colour → neckline/
  sleeves/back → length/size/dimensions → details/pattern. An attribute like
  "warranty" or "room" never belongs in alt.
- **Gallery images get distinct alt text** — position-aware, so image 3 does
  not repeat image 1.
- **Camera filenames are recognised as junk** (`DSC_4471`, `IMG_0042`) and
  replaced; a real human title is left alone.
- Why it matters, from the source: images grew from 3.3% to 5.9% of everything
  AI crawlers fetch between Q2 2025 and Q2 2026. Multimodal models read
  pictures.

**Shopify addition (NEW).** Alt text belongs to the *file*, and on Shopify the
same media can be attached to several products. The app must record which
product a description was generated from and flag reuse in the UI rather than
silently describing one product as another. This is already in PRD §4.3 — it
is the single biggest correctness risk in the alt text feature.

## 2. Summary / answer capsule (`class-avw-meta.php`)

- **Price belongs in the sentence, not only in markup.** From the source: an
  assistant answers with the sentence it can lift. If the price only exists in
  structured data, the answer becomes "contact them for pricing"; if it is in
  the prose, the answer is "Model X, 3000 RON". Append commercials (price,
  availability) to the capsule.
- **Never repeat a price the summary already contains** (tested behaviour).
- **Price detection from prose** as a fallback when no structured price
  exists — WooCommerce had `guess_price()` reading "1800 lei" out of the text.
  On Shopify the price is always structured, so this becomes: use the variant
  price, but *state it in the capsule sentence*.
- Summary length is capped by a setting (80 words in the WP defaults).

## 3. Facts merging (`merge_facts`)

Extraction is not the only source of facts. WordPress merged: WooCommerce
attributes + taxonomy terms + extracted attributes, with **known structured
facts winning over extracted ones**.

**Shopify equivalent (NEW).** Merge, in priority order:
1. Existing product options and variant option values (Size, Colour…)
2. Existing merchant metafields (including from other apps, e.g. Attributify)
3. Our extraction from prose

Never overwrite a structured value with a guessed one. This also neutralises
the "we duplicate what my PIM app already does" objection.

## 4. Starter questions (`auto_faq`)

Generated Q&A pairs from the facts, phrased the way people ask assistants
("how do I choose", "which one suits me", "what is it made of"). Cheap to
build, and it is what fills the `questions` metafield.

## 5. Collections (`class-avw-collections.php`)

Already promoted into PRD §4.8. The reasoning, verbatim from the source: a
listing page that is only a grid of thumbnails has nothing an assistant can
quote, yet it is exactly the page that should answer "what kinds of X are
there", "how do I choose one", "which one suits me". Capsule + choice
criteria + Q&A + generated comparison table (max 12 rows), rendered as
`CollectionPage` with a real `ItemList`.

## 6. Crawler diagnostics (`class-avw-diagnostics.php`)

- Checks **five agents** by exact user-agent string, not by robots.txt parsing.
- **Retries a failed request once**, and separates "blocked" from "could not
  complete" — a site testing itself competes with itself for workers, and a
  timeout was being reported as a firewall block. (This bug shipped in 1.6.2;
  do not reintroduce it.)
- Also checks **speed** and **content reachability** as the crawler sees it,
  not as the browser sees it.

**Shopify addition (NEW).** Checks run from our backend, from outside
Shopify's network. Name the likely cause: store password page, bot-protection
app, redirect app, merchant's own Cloudflare zone with Bot Fight Mode, or
rules in `robots.txt.liquid`.

## 7. Schema honesty (`class-avw-schema.php`)

- **Never emit a duplicate node.** When another plugin owns the Product node,
  merge into it instead. Existing `additionalProperty` entries and an existing
  `brand` are never overwritten (tested by reflection in the smoke suite).
- **Lift snippet limits**: `max-snippet: -1`, so assistants may quote in full.
  A one-line robots directive with outsized effect — port it to the theme app
  extension's meta output.
- Stable `@id` anchors (`#organization`, `#showroom`) so nodes can reference
  each other rather than repeat themselves.

## 8. IndexNow (`class-avw-indexnow.php`)

ChatGPT search runs on the Bing index, so fast Bing indexing is a direct path
into AI answers. No account, no OAuth — just a key file served from the site
root. Already promoted into PRD §4.9; on Shopify the key file is served
through the app proxy.

## 9. Environment honesty (`class-avw-compat.php`)

The plugin detects what else is installed and adapts rather than fighting.
**Shopify equivalent (NEW):** detect other SEO/schema apps on install (by
scanning the rendered storefront for their markup), and say plainly in
onboarding: "Your theme already emits a Product node; we will extend it
rather than add a second one."

## 10. Honest marketing, in the product

From the WordPress readme: "Google has publicly stated it does not use
llms.txt for Search. This plugin still generates it, because other AI tools do
read it — but it is one optional module among several, not the headline
feature."

That tone is the brand's actual asset, and it is worth keeping on the App
Store listing: say what does not work, and merchants believe what you say
does.

---

## Shopify-only opportunities with no WordPress ancestor

1. **Variant-level attributes.** WooCommerce variations were rarely rich;
   Shopify variants are. Extracting to the variant, not just the product,
   makes the data usable by filters and feeds. (PRD §5.4.)
2. **Metafield definitions with `PUBLIC_READ`.** The theme can render our data
   without our app running. No WordPress equivalent, and it is the strongest
   proof of the "your data stays yours" promise.
3. **Shopify's own agentic surfaces.** Since May 2026 every store serves
   `agents.md`, `.well-known/ucp` and an MCP endpoint. We cannot own those
   routes, but we can *fill them with better data*: everything we write into
   metafields improves what Shopify itself exposes to agents. Worth saying
   explicitly in the listing — we make the platform's own AI surfaces useful.
4. **Comparison tables from variants.** A collection of 20 tables with
   dimensions extracted per product is a genuinely new artefact for an
   assistant to quote, and nothing on the App Store produces it.
