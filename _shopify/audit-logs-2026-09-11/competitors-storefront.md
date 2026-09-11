# Competitor scan, storefront output only, 11 September 2026

Delegate: Sonnet, 9 App Store listings, quotes from the listings. Verified by
the main session only where noted. Feeds the competitor row in
PRD-AI-READABILITY.md.

| App | Listing | Reviews | Price |
|---|---|---|---|
| LLMagnet, AI Visibility and GEO | apps.shopify.com/llmagnet | 0 | Free / 29 / 79 USD per month |
| AI Visibility and LLMs for GEO | apps.shopify.com/geo-ai-visibility-llms-txt | 0 | Free |
| AEO: AI SEO optimizer LLMs.txt | apps.shopify.com/ai-sitemap-llms-txt-generator-gen-ai-geo | 10, 4.7 | Free / 5 / 9 USD per month |
| Avada AEO optimizer LLMs.txt | apps.shopify.com/aeo-llms-txt | 396, 5.0 | Free |
| GEORank | apps.shopify.com/llms-optimizer-generator | 1, 5.0 | 29.95 / 99.95 USD per month, 1,799 USD per year |
| FSEO: ChatGPT SEO plus LLMs.txt | apps.shopify.com/ai-search-llms-txt-generator | 14, 4.2 | Free / 29 / 79 / 299 USD per month |
| AI SEO and GEO Catalog Optimizer (NestScale) | apps.shopify.com/ns-llms-txt-generator | 0 | Free |
| GEO AI LLMs.txt and Robots.txt | apps.shopify.com/ai-seo-llms-txt-robots-txt | 1, 5.0 | Free |
| Store FAQs: Support Automation | apps.shopify.com/uttik-ai-faq-aeo | 7, 5.0 | Free / 99 / 499 USD per month |

What they ship on the storefront, per the listings:

- llms.txt: all except NestScale and Store FAQs. Several claim it at the
  store root ("/llms.txt endpoint", "placed at the root of your store"),
  which on Shopify means a theme template file written by the app; those
  apps request the theme edit permission. None describes the write or a
  rollback.
- JSON-LD: claimed by GEORank and FSEO ("Auto JSON-LD"), vaguely by
  NestScale. No sample payload shown by any.
- robots.txt AI-bot toggles: Avada, FSEO, GEORank, GEO AI.
- Visible on-page content: only Store FAQs (an FAQ widget, "no-code").
- Per-page plain-text mirror: none.
- Shopify Catalog or shopping feeds: none.

Main-session verification: the "root llms.txt" claims are consistent with
themeFilesUpsert, which shopify.dev says needs write_themes and a Shopify
exemption; so at least some competitors hold that exemption or write through
an older path. Not verified per app.
