---
title: AI Visibility All-in-One
subtitle: Documentation - the Shopify app that makes your catalogue readable by ChatGPT, Claude, Gemini and Perplexity. Nothing invented, ever.
footer: AI Visibility All-in-One for Shopify - MR.Digital - hello@mrdigital.ro
date: 4 September 2026
---

## 1. What this app is

AI assistants recommend products they can read. This app reads the descriptions you already wrote, extracts the attributes buyers compare - material, dimensions, colour, what a set includes - and publishes them everywhere an assistant looks: structured data on your storefront, a plain text copy of every product, a live llms.txt for the whole store, comparison tables on your collection pages, and described photographs.

Three promises the whole app is built around:

1. **Nothing is invented.** Extraction is deterministic - pattern matching against a dictionary you control. If your description does not state the material, the material stays empty. A gap is honest; a guess is a returned order.
2. **Nothing a person wrote is ever overwritten.** The app records what it wrote and when. Any value you write or edit by hand is marked as yours and never touched again. A value the app cannot account for is treated as yours too.
3. **The data is yours.** Everything lives in Shopify metafields with proper definitions, in your store. Uninstall the app and every attribute, summary and table keeps working.

Three things the app refuses to do, because most tools in this category do them:

- **No prompt sampling.** Tools that "measure AI visibility" by firing test prompts at ChatGPT measure their own simulation. This app counts the real requests AI crawlers make to your own pages.
- **No AI-generated text.** It will not write blog posts or product copy. It publishes what you wrote, made readable.
- **No access to orders, customers or payments.** The app asks for products and themes and nothing else. You can check that on the install screen.

## 2. How it works

**The dictionary.** A plain text list of attribute groups and terms, in the language of your descriptions. Presets exist for 20 trades; you translate the terms once.

**Extraction.** A pass reads every product description and matches it against your dictionary. It understands measurements (160x80 cm), counted items (6 scaune), decimal commas (29,7 g), and refuses to be fooled: "aspect de marmura" and "marble effect" are not marble - the description says so itself - and the app will not claim otherwise. A term under a negation ("nu contine gluten") is never published as its opposite.

**The capsule.** From the extracted attributes the app assembles a quotable summary, an FAQ block of buyer questions with answers drawn only from what the description states, and who the product suits.

**Provenance.** Every field carries a record of who wrote it - the app or a person. That record is what makes the never-overwrite promise enforceable, field by field.

## 3. The screens

### Dashboard

The state of your catalogue in one glance: products, coverage, protected values, images described. The crawler check asks your own store as each of eight AI crawlers - GPTBot, OAI-SearchBot, ChatGPT-User, Claude-SearchBot, PerplexityBot, DeepSeekBot, Applebot and Google-CloudVertexBot - and reports who got in, with the owner and purpose of each. Preview changes writes nothing; Fill catalogue writes it. Progress runs on our servers, so closing the tab loses nothing.

The dashboard also shows the real requests AI crawlers have made to your plain text pages and llms.txt in the last seven days. These are logged requests, never estimates.

The Setup card tracks what is done, what needs action, and what is simply optional. The one item that matters most is the theme app embed: until it is switched on, nothing reaches your storefront, and the card says so.

### Products

One row per product: how many attributes are published, how many buyer questions, whether a summary exists, how many images carry descriptions, whether a person has edited it, and whether an assistant has anything to read at all. Search by title, SKU or vendor, filter by collection, or narrow to the three questions that actually come up: what is missing, what did I edit, where is alt text absent. Each product links to its plain text page.

### Report

How much of the shop AI can read, in numbers with their denominators:

- **Readability.** Products that state at least four different kinds of detail, over all products read. The figure moves on its own whenever someone writes a real detail into a description.
- **Details found.** How many values were extracted, how many products stated something, and a spread of how many kinds of detail each product states.
- **What actually changes on a product page.** One of your own products, the description as written on the left, the readable values it produced on the right. Nothing is rewritten.
- **What your descriptions already say.** Each kind of detail and how many products state it.
- **Requests to your AI-readable pages.** Successful requests to the plain text pages and llms.txt in the last 30 days, by crawler, from the app's own log. A user agent is a claim the requester makes; the app records the name as given, so treat every count as self-declared.
- **What to do, worst first.** Findings ordered by severity, each with the fix beside it.
- **Products worth ten minutes of writing.** The ten products stating the fewest kinds of detail, and what each is missing. Not sorted by sales: that would need order data, which the app never reads.
- **What is switched on.** The plain text pages, and the two publishing settings described in section 4.
- **Take this away.** Every table as a CSV.

### Collections

Every collection gets a summary, the criteria to choose by, buyer questions, and a comparison table built only from attributes that actually differ between products. A column where every product says the same thing helps nobody choose, so it is left out - and the screen says so plainly.

### Business

Delivery time and cost (with a "starting price" option for shops with several shipping rates), return window, warranty, payment methods. Stated once, published as buyer questions on every product and as shipping and return policy structured data. A field left empty publishes nothing.

The same screen holds your official profiles - Facebook, Instagram, TikTok, YouTube, LinkedIn, X, Pinterest. These are published as the links that tell an assistant those accounts belong to you and not to someone using your name. Only full https addresses are accepted, and no profile is ever checked for existence: we publish what you state, exactly as everywhere else in the app.

### Dictionary

Pick a trade preset, translate the terms, test coverage live. The editor warns about terms that collide with common words.

### Product editor

Attributes, summary, buyer questions and who it suits, each editable, each with an Automatic or Edited-by-you badge. Edit anything and it becomes permanently yours. Reset to automatic hands a field back. Image descriptions are managed here too.

It also shows what an assistant can quote about that product, assembled strictly from what is published - with the same question answered from the bare product markup beside it. No simulation, no prediction of any assistant's wording.

### The product page panel

A card inside Shopify's own product page showing what is published for that product and where each value came from, with a link into the editor.

### Diagnostics

Explains every crawler check verdict in plain language and what to change: password protection, firewall rules, robots directives. Lists the last fifty real requests from AI crawlers to your pages. It also links to Google's source preferences tool, where you can check by hand whether your domain is eligible to be chosen as a preferred source. That check is Google's, not ours, and there is no way to automate it.

## 4. What reaches your storefront

The app embed renders static markup only: no JavaScript, no external requests. Extend mode adds what your theme omits, referenced to the Product data the theme already emits, so an assistant reads one product rather than two. Full mode, for themes that emit no product data of their own, publishes a complete node with shipping details, return policy, review app ratings when real reviews exist, and a true price span for products with variants. The Diagnostics screen tells you which mode your theme needs, from what it finds on your live pages.

**The FAQ block** is published as FAQPage structured data from the product's own buyer questions, on the product page. Assistants read it. Google stopped showing FAQ rich results in Search in May 2026, so no search feature is promised from it; it is there for the systems that read structured data.

**Your official profiles** are published alongside your business identity. If your theme already declares your business, the app adds the profile links to what the theme states rather than publishing a second version of who you are. If the theme declares nothing, the app publishes a small, complete statement of its own. Nothing at all is published when you have filled in no profiles.

**Collection pages** publish CollectionPage with a real ItemList and the collection's FAQ block, plus the visible comparison table if you add the block.

**The plain text page** serves every public product at yourstore.com/apps/ai-visibility/product-handle: the attributes, the summary, the buyer questions, the price and availability as of the last update, and the collections the product is part of. Every product page carries a link to its plain text version.

**llms.txt and agents.md** are generated on request at yourstore.com/apps/ai-visibility/llms.txt and /agents.md, listing every public product's plain text page. They are never a file written on a timer, so they are never stale. Every product page points at the llms.txt with the link relation the llms.txt proposal names for that purpose. Google has stated that Google Search does not use llms.txt; it is there for the assistants that do.

**The preferred source button** is a second optional theme block, off until you add it. Google lets a person mark a site as one of their preferred sources; for that person, your content is then more likely to be shown, and carries a "preferred" badge in AI Mode and AI Overviews. The block places Google's own link on your page, with your label and, if you like, your image. It makes no claim about the outcome.

**Which products get a page.** Drafts, archived products, and products not published to the Online Store never get one: they have no public address for a page to point at. Two settings on the Report screen decide the edge cases, and you decide them, not the app:

- *Include products that are out of stock.* On by default. A sold-out product keeps its page, which states that it is out of stock, so an assistant is told rather than left guessing. Turn it off to withdraw those pages until stock returns.
- *Include unlisted products.* Off by default. Unlisted products are the ones you hid from search, collections and recommendations in Shopify. Off keeps them out of the text pages and llms.txt too; on gives them a page.

**Pages are withdrawn as cleanly as they are added.** A product that is unpublished, deleted, renamed, or excluded by a setting loses its plain text page and its llms.txt entry within a minute of the change, and a weekly check reads the whole catalogue to catch anything a lost notification missed. That check deletes nothing when Shopify's download was short, and says so in the job log. Withdrawal never waits for a subscription: a page for a product you no longer sell is a false claim, not a benefit.

**IndexNow** pings the index ChatGPT search reads from whenever a page actually changes.

## 5. Variants

A product sold in grey and beige never claims one colour for both. Attributes that differ per variant are written on the variant, and the contradicted product level claim is withdrawn.

## 6. The protection rules, precisely

| Situation | What the app does |
|---|---|
| Value written by the app, description changed | Rewritten on the next pass |
| Value edited by a person | Never touched again |
| Value present but unaccounted for | Treated as a person's, left alone |
| Recomputed value identical | Not rewritten (no false updates) |
| Recomputed value now empty | Withdrawn - a stale claim is not left standing |
| Alt text that is a filename or machine junk | Treated as replaceable, rewritten properly |
| Alt text a person wrote | Never touched |
| Product unpublished, deleted or renamed | Its public page and llms.txt entry withdrawn |

## 7. Staying fresh

New and edited products are picked up automatically through webhooks, backed by a 15 minute poll and a weekly sweep. You never need to re-run anything by hand - though you can, and identical results write nothing.

## 8. Plans

**Free, for as long as you like.** The crawler check, the coverage score, and three products of your choosing fully processed - attributes, summary, FAQ block, plain text page. Nothing expires and nothing is taken away. This is not a trial: what is written for those three products stays written whether you subscribe or not. The free plan stops at the fourth product, and at the Dictionary, Business, Collections and Report screens, which need a subscription.

**Standard, 99 USD a year**, up to 20,000 products. **High volume, 149 USD a year**, no limit, priority support. Everything the app does is in both. Billed through Shopify, annually. Cancel any time; everything written stays in your metafields, and pages for products you stop selling are still withdrawn.

## 9. Support

Email hello@mrdigital.ro - one working day, Monday to Friday. Include your .myshopify.com domain.
