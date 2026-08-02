# Design brief — AI Visibility All-in-One (Shopify admin)

For a designer or for Claude working on the interface. Written 2 August 2026,
after the first working build.

---

## 1. What this app does, in one sentence

It reads the product descriptions a merchant already wrote, pulls out the
attributes buyers compare, and publishes them where AI assistants can read
them — without inventing anything and without ever overwriting a human's work.

## 2. Who is using it

A non-technical shop owner or their marketing person. They will not edit
Liquid, will not write JSON, and will not read documentation. They have
between 50 and 5,000 products, usually in a language other than English, and
they are anxious about "AI" without knowing what to do about it.

They arrive from the App Store listing expecting one thing: *will ChatGPT
recommend my products?* Every screen should answer that question or move them
one step closer to it.

## 3. Constraints that are not negotiable

- **Polaris only**, embedded through App Bridge. Built for Shopify requires it,
  and merchants trust an app that looks like the admin around it.
- **No custom fonts, no custom colour system.** Polaris tokens throughout.
  Brand personality lives in copy and in illustration, not in restyled buttons.
- **Nothing heavier than it needs to be.** The storefront output is static
  markup; the admin should feel equally light. No animation for its own sake.
- English throughout the product.

## 4. Layout direction

The dashboard is the home screen and should read as a **status board, not a
form**:

```
┌──────────┬──────────┬──────────┬──────────┐   metrics row: Products,
│ Products │ Coverage │ Protected│ Alt text │   Coverage %, Protected,
└──────────┴──────────┴──────────┴──────────┘   Alt text written

┌───────────────────────────┬───────────────┐
│ Extract attributes        │ Describe      │   primary action, left,
│ (preview / fill)          │ images        │   secondary actions right
│ last result as badges     ├───────────────┤
│                           │ Setup steps   │   checklist with ticks
└───────────────────────────┴───────────────┘

┌────────────────────────────────────────────┐
│ Recently updated products                  │   table, click through to
└────────────────────────────────────────────┘   the per-product editor
```

Two columns on desktop, one on mobile. Cards of different heights are fine —
the point is that the eye lands on numbers first, actions second, detail last.

## 5. Tone of the interface copy

The product's differentiator is honesty, so the copy carries it:

- Say what will happen before it happens: "A dry run writes nothing."
- Say what we will not do: "Anything you edit by hand is never touched again."
- Name causes, not codes: "The store is password protected, so every crawler
  sees the password page" — never "HTTP 401".
- Never promise rankings. We make a catalogue readable; we do not sell
  visibility as an outcome.
- No exclamation marks, no "AI-powered", no emoji.

## 6. Screens

**Dashboard** — as above. The only screen a returning merchant needs.

**Dictionary** — the heart of the product. A preset picker for 20 trades, a
large editable text area, a "test on 40 products" button that shows coverage
and three real examples before anything is saved. Warnings appear inline when
a term collides with a connector. Help text explains the four term forms with
examples.

**Diagnostics** — can assistants read this store? One button, then a row per
crawler with a plain-language verdict, plus what structured data the theme
already emits and which app-embed mode to use.

**Per-product editor** — extracted values pre-filled and editable, add or
remove rows, save (marks them human and protected), reset to automatic. Below,
a permanent comparison card showing what the dictionary reads today.

## 7. Empty and in-progress states

- **Before anything runs**: metrics show "—" with a hint, not zeros. Zeros read
  as failure.
- **While a pass runs**: spinner, percentage, progress bar, and the sentence
  "You can close this tab; it keeps running." Never show "0/0"; show "Starting
  up…" until a total exists.
- **No products with attributes**: explain the two possible causes (dictionary
  in the wrong language, or descriptions that state nothing) rather than
  showing an empty table.

## 8. What still needs design work

1. **Onboarding**, three steps: pick your trade → test the dictionary → turn on
   the app embed. It must refuse to show a success state until the embed is
   actually active on the storefront, because that is the single largest
   support burden on this platform.
2. **The app-embed activation moment** — a merchant has to leave for the theme
   editor and come back. Needs a clear hand-off and a "check again" button.
3. **Collections view** — comparison tables generated from product attributes.
   No competitor produces this; it deserves a real design rather than a table
   dump.
4. **Billing screen** — three plans, monthly, with the product limits stated in
   the merchant's own numbers ("you have 355 products").
5. **App Store listing assets** — one video under two minutes, three
   screenshots at the required dimensions, showing: the dictionary test with
   real results, the dashboard with coverage, and a product page's structured
   data.

## 9. Billing screen — the brief in full

Two plans, no trial, and a free tier of *seeing* rather than a free tier of
*doing*. Design it so the merchant understands that in three seconds.

**Plans**

- **Standard — $29 / month**, up to 20,000 products. Everything the app does.
- **High volume — $49 / month**, above 20,000 products. Same features,
  priority support.

Not "Pro" and not "Enterprise". The second plan is for bigger catalogues,
not better software — the copy should say exactly that, or a merchant with
400 products will assume they are missing features.

**The free/paid split, shown as a comparison the merchant can trust**

| Free, no card, no expiry | Included in a plan |
|---|---|
| Dictionary editor and all 20 trade presets | Attributes written to your products |
| Test a dictionary on 40 real products | Summaries, starter questions, who-it-suits |
| Full preview: coverage, per-attribute counts, 20 worked examples | Alt text for images |
| Crawler visibility check | Structured data and plain text output on the storefront |

There is no countdown anywhere in the interface. Nothing expires. The
merchant runs the preview as often as they like, on their own catalogue,
and decides with real numbers in front of them.

**Copy that must appear on the screen**

- The merchant's own numbers: *"You have 355 products — Standard covers
  your catalogue."* Never an abstract "up to 20,000".
- What happens if they cancel: *"Your extracted attributes stay in your
  Shopify metafields and keep working, with or without this app."* This is
  a selling point, not fine print — give it visual weight.
- Why it is a subscription rather than a one-off: *"New products are picked
  up automatically, alt text is written for new images, and crawler access
  is re-checked when your theme or apps change."* Maintenance, not a
  one-time clean-up.

**States to design**

1. No plan yet, preview never run — lead with the free preview, not the
   plans. The button says "See what we would find", not "Start free trial".
2. No plan, preview run — show the result inline next to the plans
   ("352 of your 355 products would get comparable attributes"), then the
   plans. This is the conversion moment; it deserves the most care.
3. Active plan — quiet confirmation, current plan marked, no upsell noise.
4. Over the limit on Standard — one banner with the real number and 14 days
   of grace. Never a locked screen.

**Tone**: no urgency, no scarcity, no "most popular" badge. The product's
whole argument is that we show you the truth before you pay; the billing
screen is where that argument is either kept or broken.

## 10. Brand

Ink `#201e1d`, accent `#ec3013` in product surfaces, `#FF2E4D` on the landing
page and ad creatives. Inter. These belong on the listing, the landing page and
the app icon — *not* inside the admin, where Polaris tokens rule.
