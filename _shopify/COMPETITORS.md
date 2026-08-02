# Competitive scan — is the PRD core already offered?

Researched 2 August 2026. Question: does any Shopify app already do what
the PRD's core is — deterministic attribute extraction from prose into
merchant-owned metafields, with honest JSON-LD and human-edit protection?

**Short answer: no app does that combination. But every individual feature
exists somewhere, the category is crowded with new entrants, and none of
them has traction yet. The window is open and it is closing.**

---

## The closest overlaps

### Attributify (apps.shopify.com/attributify-pim) — closest in concept
- Launched Jan 2026, $49–$149/month, **0 reviews**
- "Standardize messy vendor data into clean metafields for AI shopping
  assistants" — writes to metafields, injects schema.org, MCP server on
  the top plan
- Difference: it maps **existing structured vendor data** (literal/regex
  rules on fields that already exist). It does not read prose. A furniture
  store whose specs live inside description paragraphs gets nothing from
  it. Ours reads the prose. Also aimed at multi-vendor catalogues, priced
  2.5x above our Starter.

### ChatGPT-AI Metafield Populator — same output, opposite method
- Bulk-fills metafields by asking ChatGPT to read title + description
- Difference: LLM extraction hallucinates, is non-repeatable, and has no
  concept of "never overwrite a human value." Ours is deterministic,
  testable (96 assertions), and refuses fragments rather than guessing.
  This is the app to beat on message: same promised outcome, unreliable
  delivery.

### Mento "AI Visibility ‑ ChatGPT Gemini" — name collision, not a product collision
- Oct 2025, free–$67/month, **0 reviews**
- Generates blogs/FAQs on a schedule, llm.txt sync (a route Shopify now
  owns), query-rank tracking. Content generation + monitoring. Does not
  extract attributes, does not touch metafields.

### AIO – AI SEO Visibility Engine — the price anchor
- May 2026, free–$12.49/month, **0 reviews**
- AI-rewritten titles/descriptions, auto alt text, auto product schema,
  FAQ generation. A thin LLM wrapper, but it claims alt text + schema +
  "AI visibility" for a quarter of our planned price. Expect merchants to
  compare.

### Monitoring-only apps — different business entirely
Visibly, Agentic Shopper, BrandScan, Kedra: track whether AI mentions the
brand. They measure; they do not fix. Complementary, not competitive.

### Established SEO suites — the real incumbents
SEOLab (1,862 reviews), TinyIMG (2,281), IndexGPT (102, Built for
Shopify), SearchPie etc. all now market "AI SEO / AEO": bulk alt text,
JSON-LD, llms-era checklists. None extracts comparable attributes to
metafields. Their threat is bundling: "our SEO app already does AI."

---

## What nobody does (the actual gap)

1. **Reading attributes out of prose.** Attributify needs structured
   input. The LLM populators guess. Nobody does dictionary-driven,
   deterministic extraction with measurement/count readers and a
   refuse-fragments rule.
2. **Merchant-owned output as a principle.** Metafield definitions that
   survive uninstall, usable by the theme without the app. Nobody markets
   data ownership.
3. **JSON-LD deduplication.** Every schema app adds a node; none detects
   the theme's existing Product node and merges. "Zero duplicate Product
   nodes" is an unclaimed line.
4. **Human-edit protection with provenance** (`state`). No competitor has
   the concept.
5. **Crawler reachability with named causes** (password page, bot app,
   Cloudflare). Blog posts explain it; no app diagnoses it.

## Honest risks

- **The differentiation is subtle.** "Deterministic vs LLM extraction"
  means nothing to a non-technical merchant. The listing has to sell the
  failure mode instead: "apps that guess describe one product as another;
  this one only writes what your description actually says."
- **Cheap noise.** $4.49 AI-SEO apps will sit next to a $19 app in search
  results. Reviews and a Built for Shopify badge are the separators, and
  both take months.
- **Zero reviews everywhere is also a warning.** Either the demand is
  early (good: land now) or merchants don't yet feel the pain (bad: the
  category sells anxiety, not results). The WordPress product selling at
  €99–499/yr is the best evidence the pain is real.
- **Speed matters more than the PRD's polish.** Attributify adding an
  "extract from description" feature, or a suite adding metafield
  extraction, is one release away. First-mover on the message beats
  feature completeness.

## Verdict

Build it. It is not already offered — the core (prose → deterministic
attributes → merchant-owned metafields, with honest schema) has no direct
competitor. But do not build it slowly, and lead the listing with
extraction and data ownership, not with "AI visibility," which is already
a commodity phrase attached to thinner products.
