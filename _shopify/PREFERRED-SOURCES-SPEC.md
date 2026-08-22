# PREFERRED-SOURCES-SPEC - the Google "Add as Preferred Source" button

Build brief. Written 22 August 2026. Not started.

Written to be implemented twice: once in the Shopify app, once in the
WordPress plugin. Sections 1 to 6 apply to both. Section 7 is the only part
that differs by platform.

Source of every claim below: Google Search Central, "Help your readers find
your site through preferred sources in Google Search", last updated
20 August 2026:
https://developers.google.com/search/docs/appearance/preferred-sources

---

## 1. What it is

A visitor can tell Google that a site is one of their preferred sources. For
that person, from then on:

- the site's content is more likely to appear in Top Stories, with a
  "preferred" badge;
- in **AI Mode and AI Overviews**, its content can carry the same badge.

Google shipped an embeddable button on 20 August 2026 so a site can ask for
this in one tap: the reader clicks, Google shows a confirmation screen with
the site name and a single Add button, and the reader is returned to the page
they were on.

Feature availability is global, in every language where Search operates. The
AI Mode and AI Overviews part is available wherever those features are.

## 2. Why it is worth building, and what it is not

Worth building:

- It is the only mechanism either product currently has that acts on the
  **user's** side of the ranking, not the document's side. Everything else we
  publish improves what a machine reads; this changes who it reads for.
- It reaches AI Overviews and AI Mode directly, which is the surface both
  products are aimed at.
- Google shipped it two days before this document. Nobody in either app
  ecosystem has it yet.
- The zero-JavaScript path exists (section 5), so it costs nothing in
  performance budget.

What it is not, and what must never be claimed:

- **It is not a switch.** It requires a real visitor, signed in to Google, to
  click and confirm. A store with no returning visitors gains nothing.
- **It is not a ranking factor for everyone.** The effect exists only for the
  individuals who selected the site.
- **Top Stories is irrelevant for most merchants.** A furniture shop does not
  appear there. The AI Mode and AI Overviews badge is the part that matters,
  and it is the part to describe.
- Implementing the button is **not required** to be eligible as a preferred
  source. It only helps people find the option.

## 3. Eligibility

Only domain-level and subdomain-level sites are eligible:
`https://example.com/` and `https://shop.example.com/` qualify;
`https://example.com/shop` does not.

The check is manual and authoritative: enter the domain at
https://www.google.com/preferences/source and see whether it appears.

Both products should perform this check rather than assume it, and report the
result plainly. See section 6.

## 4. Implementation options, and the one we use

Google documents three. Two are unusable for us.

| Option | What it loads | Verdict |
|---|---|---|
| Standard JavaScript (Google's recommendation) | `news.google.com/swg/js/v1/publisher.js` plus a `<div>` | **Rejected.** Third-party JavaScript on every page. Breaks the zero-JavaScript rule of the Shopify theme block and the performance budget both products keep. |
| Advanced JavaScript with custom assets | Same library, plus an SDK | **Rejected**, same reason, more of it. |
| **Deeplink** | Nothing. A plain link. | **Chosen.** |

The deeplink gives up one thing: the reader lands on Google's source
preferences tool rather than being returned automatically to the page they
were on. That is the whole cost, and it buys a feature that ships no script.

## 5. The implementation

A single anchor, with the merchant's own domain in the query:

```html
<a href="https://www.google.com/preferences/source?q=example.com">
  Add as Preferred Source
</a>
```

Google publishes official badge images, already translated into every
supported language, so the control looks like Google's own rather than a bare
link:

https://services.google.com/fh/files/helpcenter/google_preferred_source_badge_all_languages.zip

Rules for both implementations:

- The domain in `q=` is the storefront domain the visitor is on, never a
  platform domain. On Shopify that means the custom domain when one exists,
  not `*.myshopify.com`.
- Every string we render goes through the existing output cleaner. Plain
  characters only.
- No script, no fetch, no external stylesheet. The badge image is either
  bundled with the extension or plugin, or inlined as SVG.
- `rel="noopener"` and `target="_blank"` so the shop does not lose the visitor.
- Off by default. A merchant who does nothing gets nothing new on the page.

## 6. Merchant-facing behaviour

This is the first element either product renders **for the human visitor**.
Everything published until now was for machines, and both products say so in
their marketing. That sentence has to change wherever it appears, and the
change belongs in the same release.

The settings screen must state, in plain words:

- what the button does for the shopper (one tap, confirms with Google);
- that the effect applies only to the person who clicks;
- that Top Stories is unlikely to apply to a store, and the value is the
  badge in AI Mode and AI Overviews;
- that nothing happens in the first weeks, because the mechanism depends on
  returning visitors.

The eligibility check goes in the diagnostics screen, next to the crawler
check, phrased as a fact and a date, never as a promise: "checked on
DD Month YYYY: the domain appears in Google's source preferences tool", or
"does not appear yet", with a link to the tool so the merchant can look.

Do not report a count of people who added the site. Google exposes no such
number, and inventing a proxy for it would be the one thing that undoes the
credibility both products are built on.

## 7. Platform notes

**Shopify.** A theme app block, same shape as the collection comparison
table: optional, off by default, merchant chooses placement and light or dark
theme. Storefront domain comes from the shop record, not from a setting the
merchant can mistype. Ships in the extension, so it needs a version release,
not just a server deploy.

**WordPress.** A block or shortcode plus an optional automatic placement in
the footer, following whatever the plugin already does for its other output.
Domain comes from `home_url()`. The badge asset is bundled, not hotlinked from
Google.

## 8. Decisions still open

These belong to Marius, not to the implementer:

1. **Default placement.** Footer, product page, or nowhere until the merchant
   chooses. Footer reaches every page; product page reaches the buyer at the
   moment of interest and is more intrusive.
2. **Wording of the label.** Google's asset says "Add as Preferred Source",
   which means nothing to a furniture buyer. A plain-language alternative
   converts better but drifts from Google's own words, and Google's assets
   are already translated.
3. **Whether the marketing claim changes.** "Nothing changes visually" is
   currently true and is a selling point. Adding this makes it conditional.

## 9. How we will know it works

There is no metric Google exposes, so the honest answer is that we will not
know, per shop, how many people clicked. What can be verified:

- the link renders and points at the right domain (visual check);
- the domain appears in the source preferences tool (manual check, recorded
  with a date);
- clicks on the link, if and only if the merchant already has analytics that
  measure outbound clicks. We do not add tracking to measure it ourselves.

Anything beyond that is a claim we cannot support, and the spec ends here
rather than inventing one.
