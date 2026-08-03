# Design update - AI Visibility All-in-One (Shopify), state of 3 Aug 2026

Update the existing demo mockup to match the shipped app. Same rules as
before, plus everything marked NEW. Paste-ready summary of what exists now.

## Non-negotiable rules (unchanged)

- Polaris look, embedded admin. English only. Plain characters everywhere:
  no em dashes (use "-" or ";"), no curly quotes, no "&amp;", no ellipsis
  character, no multiplication sign (use "x").
- The sidebar holds ONLY destinations: Dashboard, Collections, Business,
  Dictionary, Diagnostics, Plan. Never a single product or record - depth
  is shown by the page title with a back arrow.
- Honest empty states: when nothing qualifies, the screen says why, plainly.

## Navigation (current)

Dashboard | Collections | Business | Dictionary | Diagnostics | Plan

## Screens and demo data (real shapes from the live app)

### 1. Dashboard
- Metrics row: Products 355 - Coverage 99% (352 produce attributes) -
  Protected 1 (written by a person, never overwritten) - Alt text 0
  written, 859 left as written.
- Crawler check card: 5 crawlers (PerplexityBot, Claude-SearchBot,
  ChatGPT-User, OAI-SearchBot, GPTBot). For DEMO: show all green
  "Reads the store" (the dev-store password state is not demo material).
- Extract card: buttons Preview changes / Fill catalogue; below: "Last
  pass: 355 products read, 3 without attributes, 1 protected." plus
  attribute badges: Dimensiuni 306, Material 267, Culoare 215, Stil 170,
  Include 147, Finisaj 132.
- Describe your images card, with last-pass line: "355 products checked,
  0 descriptions written, 859 left as a person wrote them."
- Setup card, three verified steps: Dictionary saved / Attributes written /
  App embed active - "Verified in Horizon. The storefront output is live."

### 2. Collections (NEW screen)
- Header metrics: Collections 3 - Described 3 - With a comparison table 2.
- "Last built <date>: 3 collections read, 2 with a comparison table."
- Per collection card, e.g.: "Canapele [Comparison table] - 22 products.
  'Canapele has 22 products. They differ by dimensiuni: 225cm, 110cm,
  190cm and 15 more; culoare: verde, gri, negru, bej and 1 more;
  material: MDF, burete, textil.' Compared on: Dimensiuni, Culoare,
  Material, Stil - 22 rows."
- A collection where nothing varies says: "Nothing varies enough here to
  compare. A column where every product says the same thing helps nobody
  choose, so we left it out rather than fill the page."
- Primary action: Build collection pages.

### 3. Business (NEW screen)
- Cards: Delivery (Delivery time; checkbox "Delivery time varies by
  product"; Delivery cost; checkbox "This is a starting price" -> published
  as "From 25 RON"), Returns and warranty (Return window in days,
  Warranty), Payment (Payment methods).
- Footer card: "Where these answers appear" - buyer questions on every
  product, plain text mirror, shipping/return structured data.

### 4. Product editor (UPDATED)
- Title plain (e.g. "Set Masa & 6 Scaune - Negru"), badge Automatic.
- Card 1: Comparable attributes - label/value rows, Add attribute, Save.
- Card 2 (NEW): Summary and buyer questions - Summary textarea with badge
  Automatic / Edited by you; question+answer rows with Remove; "Who it
  suits" field with help text "Audience, not contents: 'living rooms,
  small flats' - never '6 chairs'."; Add question; Save.
- Card 3: Images - per image: badge Described / Camera filename / No
  description, current alt, our suggestion with "Use this".
- Card 4: "For comparison: what the dictionary reads from this
  description" + Reset to automatic.
- Demo buyer questions: "What is Coltar Chesterfield Negru made of? lemn
  masiv, catifea." / "What are the dimensions...? 280 x 280 cm." / "How
  much does it cost? 4700.0 USD." / "Can I return it? Yes, within 14
  days." / "How long does delivery take? 2-4 working days. Delivery costs
  from 25 RON."

### 5. Product page panel (NEW - lives in Shopify's own product page)
- Compact card "AI Visibility": Attributes line with badge Automatic;
  truncated Summary with badge; all buyer questions, one line each,
  truncated; "Suits: ..." only when set; link "Edit in AI Visibility".

### 6. Plan
- Two cards: Standard $99/year (badge "Fits your catalogue", "You have
  355 products. Standard covers your catalogue.") and High volume
  $149/year. Live proof card: a real product with its extracted attribute
  badges. Comped state shows a green banner: "This store has been given
  access. No subscription is needed and nothing will be charged."

## Demo tone

Furniture catalogue, Romanian product names and attribute values (the
merchant's language), English UI. Numbers above are real - keep them.
