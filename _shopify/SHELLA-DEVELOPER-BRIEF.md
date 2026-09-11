# Structured data on republicabio.ro: what to remove from the Shella theme, and why

For the theme developer. Theme: Shella 6.5.1 (Shella6.5.1rb-20260610-2001).
Written 11 September 2026.

## Why

The store now runs the AI Visibility app. The app adds a Product schema node
to every product page through a theme app embed, and it extends the Product
node the theme already prints rather than duplicating it. The theme prints
its own JSON-LD by hand, in four places, and two of them overlap with what
the app emits. The schema validator currently shows 3 Organization nodes and
2 Product nodes on a product page. Search engines and AI crawlers treat
conflicting duplicate nodes as noise. The target after this change is 1
Organization node and 1 Product node per product page.

The app holds its Product node back until the theme's own Product node is
gone or carries an @id. So the app's product data does not appear on the
storefront until this change is made.

## What to change

All paths are inside the theme code editor. Line numbers are from the copy
of the theme read on 10 September 2026; confirm them before cutting.

1. sections/main-product.liquid, lines 87 to 130: the hand-written
   Product JSON-LD block. Remove the whole script block.
2. snippets/head-get-social-meta-tags.liquid, lines 54 to 61: the
   Organization JSON-LD fragment. Remove.
3. sections/header.liquid, lines 2085 to 2103: the second Organization
   JSON-LD block. Remove.
4. snippets/product-collection.liquid, lines 440 to 473: the Product
   JSON-LD printed per product card on collection pages. Remove.

## What to keep

sections/header.liquid, lines 2107 to 2119: the WebSite node with
SearchAction. Keep it as is. The app does not emit a WebSite node.

## How to do it safely

- Duplicate the live theme first, make the change on the copy, preview it,
  then publish the copy. Rolling back is then one click.
- Remove only the <script type="application/ld+json"> blocks listed. Leave
  the surrounding Liquid and HTML untouched.
- Do not replace the removed blocks with {{ product | structured_data }}.
  That filter prints another Product node and puts us back where we are.

## How to verify

1. Open any product page and view the source. There should be exactly one
   <script type="application/ld+json"> containing "@type": "Product", and
   it should come from the AI Visibility app embed.
2. Run the page through validator.schema.org. Expect 1 Organization and 1
   Product.
3. Tell the store owner it is done. They will switch the app's structured
   data mode and press "Read my pages now" in the app, and the finding
   "Your theme's product description blocks ours from being added" should
   disappear from the SEO screen. Step 1 above is then checked again.

## Contact

Questions about the app side: hello@mrdigital.ro.
