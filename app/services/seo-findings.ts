// The finding vocabulary of the per-product SEO scan: the codes, the shape of
// a finding, and the label each check reads under (PRD-SEO-PER-PRODUCT
// section 2.1).
//
// Split out of seo-scan.ts on 3 September 2026, build step 4, and this is the
// reason. seo-scan.ts holds the checks, and the checks need classifyMetaField
// from seo.server for A5 - a legitimate dependency for a module that only
// ever runs in a catalogue pass. But build step 4 put these labels on three
// merchant-facing screens, so seo-aggregate.ts (and through it the Products
// list and the product editor) now reaches them from the browser bundle, and
// a client build that reaches a .server module fails outright. It failed
// exactly that way before this file existed:
//
//     './seo.server' imported by 'app/services/seo-scan.ts'
//
// Same reason meta-column.ts and conflicts.ts exist. Everything here is data
// and pure predicates - no database, no fetch, no Admin API, nothing that
// imports anything with a ".server" suffix. seo-scan.ts re-exports all of it,
// so every existing caller and every existing test keeps the import it had.

/** Stable across releases: the weekly diff says "A1 changed on Tuesday". */
export type FindingCode =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "A6"
  | "A7"
  // A10 to A16: the catalogue checks of PRD-SEO-FULL-ONPAGE section 5b, built
  // 4 September 2026. All source A - every one is computed from the Admin API
  // at the end of the catalogue pass, and not one of them fetches a page.
  //
  // A14 is deliberately absent. The setting it asks about (automatic geo or
  // currency redirection under Markets) is not exposed by the Admin API: every
  // field of `Market` and of `Shop` was listed against a live shop on 4
  // September 2026 and none of them carries it. A code whose check could only
  // ever answer "could not be determined" would render as a promise on every
  // screen for ever.
  | "A10"
  | "A11"
  | "A12"
  | "A13"
  | "A15"
  | "A16"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "B6"
  | "B7"
  | "B8"
  | "B9"
  // B10 to B24: the on-page checks of PRD-SEO-FULL-ONPAGE sections 3 and 5a,
  // built 4 September 2026. All source B - each one is read off the product's
  // public page, or (B16, B19) off what fetching it and its links answered.
  | "B10"
  | "B11"
  | "B12"
  | "B13"
  | "B14"
  | "B15"
  | "B16"
  | "B17"
  | "B18"
  | "B19"
  | "B20"
  | "B21"
  | "B22"
  | "B23"
  | "B24"
  // B25 to B32: the page half of PRD-SEO-FULL-ONPAGE section 5b, built 4
  // September 2026 (build step 4b).
  //
  // B27 is deliberately absent, and this is a different absence from A14's.
  // A14 could not be built at all; B27 was built and put where it belongs.
  // Section 5b describes it as "two Product nodes from two different sources,
  // each with its own AggregateRating", and says in its own row that it is B1
  // with the sources named. So B1's detail gained `origins` - which node came
  // from the theme, which from an app, and which carries a rating - rather
  // than the vocabulary gaining a second code that reports the same count of
  // the same nodes on the same page. Two rows for one fact is a reader
  // deciding which to believe.
  //
  // B28 is here even though it never reads a page: it is computed in source
  // A's pass from the menu tree and collection membership. The number is the
  // check; where it was measured is the method line's business.
  | "B25"
  | "B26"
  | "B28"
  | "B29"
  | "B30"
  | "B31"
  | "B32";

/** Which read the finding came from. Stated on the row, never mixed. */
export type FindingSource = "A" | "B" | "A+B";

export type Finding = {
  code: FindingCode | string;
  source: FindingSource;
  detail: Record<string, unknown>;
};

/**
 * Labels for the SEO card. One line per check, no store-specific wording, and
 * no sentence that promises a result Google decides (PRD section 5, the last
 * acceptance row). A1 read "Missing identifiers for rich results" until build
 * step 4 put the label on a merchant-facing screen: supplying a GTIN does not
 * earn a rich result, it removes one reason not to get one, and the row now
 * says what is absent rather than what would follow.
 */
export const CHECK_LABEL: Record<FindingCode, string> = {
  A1: "Missing product identifiers: GTIN, brand, SKU or image",
  A2: "Offer on the page disagrees with the product",
  A3: "Meta title or description shared with another product",
  A4: "Handle renamed with no redirect from the old one",
  A5: "Meta title or description absent",
  // Per collection, not per product. Its denominator is the collections read
  // by the last collections check, never the catalogue - the card keeps the
  // two apart the same way it keeps A denominators apart from B ones.
  A6: "Collection meta title or description absent",
  // Shopify owns sitemap.xml and offers no way to edit it, so this row can
  // only ever report. The fix is always a product setting.
  A7: "Not listed in the shop's sitemap",
  // A10 and A11 carry the collection denominator, like A6, and are rendered
  // from the collections report rather than from the product aggregate.
  A10: "Collection description empty or under 50 words",
  A11: "Collection holding no products, or one",
  A12: "Description shared word for word with another product",
  A13: "A redirect from this product's address lands on the home page",
  A15: "Image filename is a camera or upload default",
  A16: "In no collection and linked from no menu",
  B1: "No Product node on the page, or two of them",
  B2: "Canonical points somewhere other than this page",
  B3: "The page tells search engines not to index it",
  B4: "The app block was not detected on the page",
  B5: "The page could not be read as a crawler would read it",
  // B6 says "should be here and is not". A node the merchant switched off is
  // not counted (seo-nodes.ts), so the label can promise that without lying.
  B6: "Structured data this app should be adding is missing",
  // Our own output, twice on one page. Deliberately phrased about us and not
  // about the theme: B1 is the theme question, and B1's @id merge is what made
  // this invisible (4 September 2026).
  B7: "This app's structured data appears more than once on the page",
  // Distinct from B2, which asks whether the canonical is this page's own
  // address. B8 asks what shape it has: a variant URL, a collection-prefixed
  // URL, or anything that is not /products/<handle>. Shopify's `within` filter
  // produces the collection-prefixed form for every product in every
  // collection, so that case is this check and not a second one.
  B8: "Canonical does not point at the plain product URL",
  B9: "hreflang links absent on a shop with more than one market",
  // B10 and B11 name the length and never a limit. Google states there is no
  // limit on either; what happens is truncation, by device width. The method
  // line below carries Google's own wording, and the label carries none of
  // ours - "too long" is a judgement this app is not entitled to make.
  B10: "Title tag absent, or a length that a phone result often cuts",
  B11: "Meta description absent, or a length that a phone result often cuts",
  // The logo case (B12a in PRD section 5b) rides on this row rather than on a
  // code of its own: the merchant fixes it in the same place, and a second row
  // saying "and also your H1" is two rows for one heading.
  B12: "No H1 on the page, more than one, or an H1 that is the shop logo",
  B13: "Open Graph tags absent",
  B14: "Twitter card tags absent",
  B15: "Images on the page with no alt text, or an alt that reads as a filename",
  B16: "Internal links on the page that answer 4xx or 5xx",
  B17: "Short description, or a page with little text",
  B18: "Handle carries characters that do not belong in a URL",
  B19: "The product URL answers after more than one redirect, or loops",
  B20: "http resources on an https page",
  B21: "The page's title tag is the same as another page's",
  B22: "Structured data on the page that Google no longer shows",
  B23: "robots.txt has been edited, or blocks products or collections",
  B24: "Meta keywords tag on the page",
  B25: "Only collection-prefixed links point at this product, never its canonical URL",
  B26: "The page says noindex on a product that is only out of stock",
  // B28 is counted over the catalogue, not the pages read: no page is fetched
  // to answer it. The row's own method line says so.
  B28: "More than three clicks from the home page through menus and collections",
  // B29 and B32 report counts and never a verdict, so their labels name what
  // is being counted and claim nothing about it.
  B29: "Internal links on the product page, by kind",
  B30: "Blog post that links to no product and no collection",
  B31: "The first image on the page is lazy-loaded",
  B32: "Scripts the product page loads, by origin",
};

/**
 * The method line under a row: where a threshold comes from, or what a check
 * can and cannot see. Only the rows that need one have one.
 *
 * It exists because of the rule PRD-SEO-FULL-ONPAGE section 3 states for B10
 * and B11: "the length thresholds are stated as what Google truncates at, with
 * the source in the row's method line, not as a rule of ours. If the
 * thresholds change, the method line changes and nothing else." The same
 * applies wherever this app repeats something Google has said - B22 and B24
 * are Google's positions, not ours, and a merchant is entitled to see whose
 * they are.
 */
export const CHECK_METHOD: Partial<Record<FindingCode, string>> = {
  A10:
    "The word count of the collection's own description text. 50 words is what " +
    "Craftshift and Charle report seeing on collections that do well; it is an " +
    "observation, not a rule, and this row states the count rather than a target.",
  A11: "The product count Shopify reports for the collection. No judgement about what a collection is for.",
  A12:
    "The description text compared after the same cleaning this app applies to " +
    "everything it publishes, so two descriptions that differ only in how an " +
    "imported catalogue encoded an ampersand count as one. The row names the " +
    "group and stops there.",
  A13:
    "Matthew Edgar, quoting John Mueller: a redirect to the home page is treated " +
    "as a soft 404, so the old address earns nothing and the visitor lands " +
    "somewhere that does not answer their question. Read once per pass from the " +
    "shop's URL redirects; the right target is a question only you can answer.",
  A15:
    "The filename alone, without the CDN's size suffix: a camera or phone prefix " +
    "such as IMG_ or DSC_ followed by digits, or a UUID. A filename with any " +
    "word in it passes, including one that happens to contain \"img\".",
  A16:
    "The product's collections from the catalogue read, and one menus query per " +
    "pass. No page is fetched and no link is followed, so this is what the Admin " +
    "API knows and not what a crawler would find.",
  B25:
    "Every link this pass saw pointing at this product used the " +
    "/collections/x/products/y form. The Ahrefs Help Center describes the " +
    "consequence on Shopify stores by name: the canonical URL then has no " +
    "internal link pointing at it, so the address you are asking Google to " +
    "index is the one address nothing on your shop links to. Read from the " +
    "collection pages this pass fetched, so a product on no collection page " +
    "is not checked rather than reported as clean.",
  B26:
    "Matthew Edgar and Glenn Davidson (Tomango) make the same point: a " +
    "noindexed page behaves like a soft 404, so the address loses the " +
    "standing it had and does not get it back when the product returns to " +
    "stock - it has to be found and re-evaluated from nothing. The row states " +
    "the availability the page itself declares. It does not say to remove the " +
    "tag: on a product that is gone for good, noindex is a reasonable thing " +
    "to have done, and only you know which of the two this is.",
  B28:
    "Break The Web's figure: more than three clicks from the home page. " +
    "Computed from your menus and your collection membership with no crawl - " +
    "a top-level menu item is one click, a product on a collection that item " +
    "links to is two. A product reachable only through a link in a page's " +
    "body text is counted at whatever its menu route costs, because no page " +
    "is fetched to answer this.",
  B29:
    "Counts, and no target number, because no named source states one. The " +
    "four kinds overlap and are not a partition: a related-products grid whose " +
    "links are collection-prefixed is counted under both. A kind is read from " +
    "the part of the markup a link sits in, so a theme that names its " +
    "containers unusually will be counted unusually.",
  B30:
    "One fetch per post, out of the same daily allowance as the product " +
    "pages, and read last so products keep the first claim on it. Counted " +
    "over the posts this pass actually read, never over the posts you have. " +
    "The row states what the post links to and nothing about what it ought to: " +
    "a shipping-policy post that sells nothing is doing its job.",
  B31:
    "The first image inside the page body, and the loading attribute as " +
    "found. Not \"the largest element\", which no server-side read can " +
    "identify - what paints largest depends on the viewport and this app " +
    "fetches HTML with no browser. On many themes the first image is the shop " +
    "logo, which is a smaller fact than a lazy hero image.",
  B32:
    "A count of the script tags on the page by the host they load from, with " +
    "inline scripts as their own group. Break The Web's \"ghost code\" is the " +
    "practice behind it - scripts left behind by apps that are no longer "  +
    "installed - but " +
    "the count is a fact and the judgement is entirely yours: this app cannot " +
    "know which host you want, and it names none of them as a problem.",
  B10:
    "Google: \"there's no limit on how long a title element can be, the title " +
    "link is truncated as needed, typically to fit the device width.\" " +
    "30 to 60 characters is the industry's estimate of what a phone shows in " +
    "full, not a rule of this app and not a limit of Google's.",
  B11:
    "Google describes the same truncation for the description snippet: it is " +
    "cut to fit the device, and there is no stated length. 70 to 160 " +
    "characters is the industry's estimate of what is shown in full.",
  B15:
    "The same test the alt text writer uses (looksLikeMachineAlt): a filename, " +
    "an HTML entity, a UUID, or a camera or upload prefix such as IMG_ or " +
    "DSC_. An alt written as an empty string is counted separately, because " +
    "that is the correct markup for a decorative image.",
  B16:
    "At most 20 links per page, each distinct address fetched once per pass " +
    "and charged once to the same daily budget as the pages. A page with more " +
    "says how many of its links were checked.",
  B17: "Word counts, from the page's own description and its visible text. Nothing here is a target.",
  B19:
    "The chain is followed manually, up to five hops. One redirect is reported " +
    "by the response row instead; this row is for two or more, and for a loop.",
  B21:
    "Compared against the title tags stored for this shop's other pages, so a " +
    "catalogue part-way through its first page pass reports fewer duplicates " +
    "than it has and never more.",
  B22:
    "Google removed HowTo results in 2023 and FAQ results for every site on 7 " +
    "May 2026. The nodes stay valid schema.org and assistants still read them, " +
    "so this app emits an FAQPage of its own on purpose. The row is here so " +
    "nobody expects a Google feature from it.",
  B23:
    "Shopify calls editing robots.txt.liquid an unsupported customisation that " +
    "can result in loss of all traffic. Read once per pass; the lines Shopify " +
    "ships by default are listed separately from the rest.",
  B24:
    "Google does not use the keywords meta tag; it has no effect on indexing. " +
    "The row says so once so that nobody keeps maintaining the list.",
};

/**
 * Which source owns a finding. Source A owns exactly the findings whose
 * `source` is "A"; source B owns "B" and "A+B" (A2 is computed from the page
 * against the offer facts source A stored). Both write into the same
 * `findings` column, so each must rewrite only its own half - without this
 * rule the next catalogue pass would erase every page finding, and the next
 * page scan would erase every catalogue finding.
 */
export function isSourceAFinding(finding: Finding): boolean {
  return finding.source === "A";
}

/** The findings on a stored row, defensively: the column is json. */
export function findingsOf(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is Finding => !!f && typeof f === "object" && typeof (f as any).code === "string",
  );
}

// --- the shop owner's half of the vocabulary --------------------------------
//
// Everything below exists for one screen: the merchant-facing SEO dashboard at
// /app/seo/dashboard (PRD-SEO-FULL-ONPAGE section 4.1, and the approved mockup
// _shopify/mockup-seo-dashboard.html, which is its specification).
//
// CHECK_LABEL above is untouched and stays the operator's vocabulary: the
// workspace at /app/seo, the CSV export and the weekly diff all keep reading
// it, and it keeps naming the thing by the name the standard gives it. The
// dashboard reads OWNER_LABEL instead, which is a plain rewrite of the same
// row for someone who runs a shop and has never read a search-engine
// specification.
//
// Both are keyed by FindingCode and both are total, so a new check that
// forgets a plain label fails typecheck rather than shipping jargon to a
// merchant. That is the whole reason they are two constants and not one
// optional field.
//
// The vocabulary that never appears in any string below, because a shop owner
// does not have to learn it to fix their own shop: the words for the address a
// page declares as its own, for the machine-readable block a page carries, for
// the language-and-country links, for the manufacturer's barcode standard, for
// the text behind a photo, for the deferred loading attribute, for the sharing
// tags, for the largest heading, and for the tags in a page's head. Check codes
// never appear on that screen either - they stay in the CSV and in the operator
// view, where somebody is being paid to know them. A test asserts both.

/**
 * Who has to move first on a finding.
 *
 * `merchant` - a field, a setting or a switch the shop owner reaches without
 *   help. `app` - this app writes it, after the merchant has read what it
 *   proposes. `theme` - somebody edits the theme, once, and it applies to
 *   every page.
 *
 * The order in that sentence is the priority order the dashboard groups by,
 * and it is the order of immediacy rather than of severity: a product with a
 * gap the owner can close today and a gap that needs a developer is counted in
 * the group of the thing that can happen today. Nothing here is weighted and
 * nothing is a grade.
 */
export type FindingOwner = "merchant" | "app" | "theme";

export const FINDING_OWNER: Record<FindingCode, FindingOwner> = {
  A1: "merchant",
  // The page contradicts the product's own price or stock. The page is the
  // theme's rendering of it, so the theme is what has to change.
  A2: "theme",
  A3: "merchant",
  A4: "merchant",
  A5: "merchant",
  A6: "merchant",
  A7: "merchant",
  A10: "merchant",
  A11: "merchant",
  A12: "merchant",
  A13: "merchant",
  A15: "merchant",
  A16: "merchant",
  B1: "theme",
  B2: "theme",
  B3: "theme",
  // Turning an app embed on is a switch in the theme editor, not a code
  // change and not a developer's job, so it belongs with the things the owner
  // does themselves. The step below names the screen and the switch.
  B4: "merchant",
  B5: "merchant",
  B6: "app",
  B7: "app",
  B8: "theme",
  // Shopify Markets adds these links automatically unless the setting is off,
  // so this is a setting the owner reaches and not a fault in the theme - the
  // same finding CHECK_METHOD already records for B9.
  B9: "merchant",
  B10: "merchant",
  B11: "merchant",
  B12: "theme",
  B13: "theme",
  B14: "theme",
  B15: "app",
  B16: "merchant",
  B17: "merchant",
  B18: "merchant",
  B19: "merchant",
  B20: "theme",
  B21: "merchant",
  B22: "theme",
  // robots.txt is a theme file on Shopify (robots.txt.liquid), and Shopify
  // calls editing it an unsupported customisation.
  B23: "theme",
  B24: "theme",
  B25: "theme",
  B26: "theme",
  // Menus and collection membership are the owner's, and no page is fetched
  // to answer this one.
  B28: "merchant",
  // B29 and B32 state no verdict, so they never put a product in a group at
  // all. They carry an owner because this record is total; the dashboard
  // filters them out before it groups anything.
  B29: "theme",
  B30: "merchant",
  B31: "theme",
  B32: "theme",
};

/**
 * The row as a shop owner reads it. A plain rewrite of CHECK_LABEL: same key,
 * same meaning, none of the vocabulary.
 *
 * Where the approved mockup covers a code, the wording here is the mockup's,
 * word for word. The rest are written to the same shape: what is true of the
 * products, stated as a count of products and never as advice.
 */
export const OWNER_LABEL: Record<FindingCode, string> = {
  A1: "Products missing a barcode, a brand, a product code or a photo",
  A2: "Products whose page shows a different price or stock than the product has",
  A3: "Products sharing their search title or description with another product",
  A4: "Products whose address changed with no forwarding from the old one",
  A5: "Products with no title or description for Google",
  A6: "Collections with no title or description for Google",
  A7: "Products missing from your sitemap, the list of pages you hand search engines",
  A10: "Collections with little or no description",
  A11: "Collections holding one product, or none",
  A12: "Products sharing the same description word for word",
  A13: "Old product links that drop visitors on your home page",
  A15: "Photos still named the way the camera saved them",
  A16: "Products in no collection and in no menu",
  B1: "Pages that describe no product to search engines, or describe two",
  B2: "Products telling Google the wrong main address",
  B3: "Pages that tell search engines not to list them",
  B4: "Pages where this app's block was not found",
  B5: "Pages that could not be read the way a search engine reads them",
  B6: "Product details this app should be adding to the page and is not",
  B7: "Pages carrying this app's own details twice",
  B8: "Products whose stated main address is not the plain product address",
  B9: "Country and language links for shops selling abroad",
  B10: "Titles that are missing, or get cut off in a search result on a phone",
  B11: "Descriptions that are missing, or get cut off in a search result on a phone",
  B12: "Pages whose largest heading is not the product",
  B13: "Products that show no preview when someone shares them",
  B14: "Products that show no preview card on X",
  B15: "Photos with no description of what is in them",
  B16: "Links on the page that lead nowhere",
  B17: "Products with very little text on the page",
  B18: "Product addresses carrying characters that do not belong in a web address",
  B19: "Products whose address bounces through more than one stop",
  B20: "Pages loading something over an unsecured connection",
  B21: "Pages whose search title is the same as another page's",
  B22: "Extra details on the page that Google no longer shows",
  B23: "The file that tells search engines where they may go has been edited",
  B24: "Pages carrying a list of keywords that Google ignores",
  B25: "Products whose main address nothing links to",
  B26: "Products hidden from search only because they are out of stock",
  B28: "Products more than three clicks from your home page",
  B29: "Links on a product page, by kind",
  B30: "Blog posts that link to no product and no collection",
  B31: "The main product photo waits before it loads",
  B32: "Code your product page loads, by source",
};

/**
 * The numbered how-to behind a row: one sentence saying why it matters, and
 * where in Shopify or in the theme it is done.
 *
 * This is what stops the screen from naming a problem and leaving the merchant
 * with nowhere to go, which is why it is total and typed: a code with no steps
 * fails typecheck. `where` is a place, not a paragraph - a screen path in
 * Shopify, a button in this app, or the sentence that says a theme file is
 * edited once and applies everywhere.
 */
export type OwnerStep = { what: string; where: string };

export const OWNER_STEPS: Record<FindingCode, OwnerStep> = {
  A1: {
    what:
      "Google will not list a product without a photo, and it matches your product to the " +
      "same product sold elsewhere by its barcode, brand and product code.",
    where:
      "Shopify, Products, open one: Media for a photo, the variant row for the barcode and " +
      "product code, and the Product organization box for the brand.",
  },
  A2: {
    what:
      "The page states a price or a stock status that the product itself does not, so a " +
      "search result can show a figure you are not selling at.",
    where:
      "Your theme decides what the page publishes about price and stock. A developer changes " +
      "it in one place and it applies to every product.",
  },
  A3: {
    what:
      "Two products asking to be listed under the same words compete with each other, and " +
      "search engines pick one.",
    where:
      "Shopify, Products, open one, scroll to Search engine listing, press Edit. Or let us " +
      "draft them and approve them.",
  },
  A4: {
    what:
      "The product moved to a new address and the old one now answers nothing, so every link " +
      "and every bookmark pointing at it is lost.",
    where:
      "Shopify, Online Store, Navigation, URL Redirects. Add one from the old address to the " +
      "new one.",
  },
  A5: {
    what: "Without them Google writes its own, from whatever it finds.",
    where:
      "Shopify, Products, open one, scroll to Search engine listing, press Edit. Or let us " +
      "draft them and approve them.",
  },
  A6: {
    what:
      "A category page with nothing written for search engines is listed under whatever text " +
      "happens to be on it.",
    where: "Shopify, Products, Collections, open one, Search engine listing, press Edit.",
  },
  A7: {
    what:
      "Your sitemap is the list of pages you hand search engines. A product that is not on it " +
      "has to be stumbled upon.",
    where:
      "Shopify builds the sitemap itself and it cannot be edited. A product is on it when it " +
      "is active and available on the Online Store sales channel: Shopify, Products, open one.",
  },
  A10: {
    what:
      "A category page with a line of text on it says little about what the category is for, " +
      "to a visitor or to a search engine.",
    where: "Shopify, Products, Collections, open one, the Description box.",
  },
  A11: {
    what:
      "A category holding one product or none is a page with nothing on it, and it is still " +
      "offered to visitors and to search engines.",
    where: "Shopify, Products, Collections. Add products to it, or remove it.",
  },
  A12: {
    what: "Search engines pick one and quietly ignore the rest.",
    where: "Shopify, Products. The report names each pair.",
  },
  A13: {
    what: "Someone wanted a specific product and got the front page instead.",
    where: "Shopify, Online Store, Navigation, URL Redirects.",
  },
  A15: {
    what: "A filename like IMG_4821 tells nobody anything.",
    where: "Shopify, Products, open one, Media, rename before you upload again.",
  },
  A16: {
    what:
      "Nothing on your shop leads to this product, so the only way to it is to already know " +
      "its address.",
    where:
      "Shopify, Products, open one, the Collections box. Or Online Store, Navigation, to put " +
      "its category in a menu.",
  },
  B1: {
    what:
      "The page either tells search engines nothing about the product it is selling, or tells " +
      "them about two products at once and leaves them to choose.",
    where:
      "Your theme decides what the page publishes about the product. A developer changes it in " +
      "one place and it applies to every page.",
  },
  B2: {
    what:
      "The page names a longer address as its own, so Google splits attention between two " +
      "versions of the same product.",
    where: "Same file, same visit. The report names the exact line.",
  },
  B3: {
    what:
      "The page asks search engines not to list it, so nobody finds it by searching however " +
      "good it is.",
    where:
      "Your theme decides which pages carry that instruction. A developer finds it in one " +
      "place. If you hid the product on purpose, nothing here needs doing.",
  },
  B4: {
    what:
      "Our block was not found on the page, so nothing this app writes is reaching search " +
      "engines or assistants on it.",
    where:
      "Shopify, Online Store, Themes, Customize, App embeds. Switch AI Visibility on, then " +
      "press Save. It is a switch, not code.",
  },
  B5: {
    what:
      "We asked for the page the way a search engine would and did not get it, so nothing on " +
      "this list has been checked for that product.",
    where:
      "Shopify, Products, open one and check it is active and available on the Online Store. " +
      "A storefront password also stops this, and so does a forwarding rule on the address.",
  },
  B6: {
    what:
      "There are product details this app is meant to be adding to the page for search engines " +
      "and assistants, and they are not arriving.",
    where: "Open the Diagnostics screen in this app. It says which ones and why.",
  },
  B7: {
    what:
      "This app's own details appear twice on the page. Assistants read one of the two, so the " +
      "second is wasted at best and contradicts the first at worst.",
    where: "Open the Diagnostics screen in this app and switch the block to Extend mode.",
  },
  B8: {
    what:
      "The address the page puts forward as its own carries extra parts - a category, or a " +
      "chosen size - so the same product is offered under several addresses.",
    where:
      "Your theme builds that address. A developer changes it in one place and it applies to " +
      "every product.",
  },
  B9: {
    what:
      "You sell into more than one country and the pages do not tell search engines which page " +
      "is for which country and language.",
    where:
      "Shopify, Settings, Markets. Shopify adds these links itself unless the setting has been " +
      "switched off.",
  },
  B10: {
    what:
      "The title is what a person reads in a search result before deciding whether to open " +
      "your shop. A missing one is written for you, and a very long one is cut off.",
    where:
      "Shopify, Products, open one, Search engine listing, press Edit. Or let us draft them " +
      "and approve them.",
  },
  B11: {
    what:
      "The line under the title in a search result is your sentence to sell with. A missing " +
      "one is written for you, and a very long one is cut off.",
    where:
      "Shopify, Products, open one, Search engine listing, press Edit. Or let us draft them " +
      "and approve them.",
  },
  B12: {
    what:
      "The largest heading on a product page should name the product. On your theme it names " +
      "the shop, so every page looks like the same page.",
    where:
      "Your theme decides that heading. A developer changes it in one place and it applies to " +
      "every page.",
  },
  B13: {
    what:
      "Paste a product link into WhatsApp, Facebook or a message and it appears as a bare " +
      "address with no picture and no title.",
    where:
      "Your theme builds what a shared link shows. A developer changes it in one place and it " +
      "applies to every page.",
  },
  B14: {
    what: "A link to this product shared on X appears as plain text with no picture.",
    where:
      "Your theme builds what a shared link shows. A developer changes it in one place and it " +
      "applies to every page.",
  },
  B15: {
    what: "That description is what a blind visitor hears and what an image search reads.",
    where:
      "Press Write photo descriptions on the dashboard. You get a list of what we propose, " +
      "per photo, before anything is saved.",
  },
  B16: {
    what:
      "A link on the page leads to an address that answers nothing, so a visitor who follows " +
      "it hits a dead end.",
    where:
      "Shopify, Products, open one, the Description box, and fix or remove the link. The " +
      "report names each address.",
  },
  B17: {
    what:
      "Anything you add gives us more to work with, and the product describes itself better.",
    where: "Shopify, Products, open one, the Description box.",
  },
  B18: {
    what:
      "The product's address carries characters that travel badly - spaces, accents or capital " +
      "letters - so it is copied and shared wrongly.",
    where:
      "Shopify, Products, open one, Search engine listing, press Edit, and change the address. " +
      "Keep the forwarding Shopify offers you from the old one.",
  },
  B19: {
    what:
      "The address passes through more than one stop before it answers, which wastes every " +
      "visit a person makes and every visit a search engine makes.",
    where:
      "Shopify, Online Store, Navigation, URL Redirects. Point the first rule straight at the " +
      "end of the chain.",
  },
  B20: {
    what:
      "The page is served securely and then loads something that is not, which browsers warn " +
      "about or block outright.",
    where:
      "Your theme or an installed app loads it. A developer finds the address in one place; " +
      "the report names it.",
  },
  B21: {
    what:
      "Two of your pages ask to be listed under the same title, so a search result cannot tell " +
      "them apart and neither can a person.",
    where:
      "Shopify, Products, open one, Search engine listing, press Edit. The report names the " +
      "other page.",
  },
  B22: {
    what:
      "The page publishes extra detail of a kind Google stopped showing, so it costs a little " +
      "and earns nothing in Google. Assistants still read it.",
    where:
      "Your theme or an installed app publishes it. Nothing breaks if it stays; this row is " +
      "here so nobody expects a Google feature from it.",
  },
  B23: {
    what:
      "The file that tells search engines where they may go has been changed from what Shopify " +
      "ships, and one wrong line in it can hide the whole shop.",
    where:
      "It lives in your theme as robots.txt.liquid. Shopify calls editing it an unsupported " +
      "change. A developer reads it; the report names the lines.",
  },
  B24: {
    what:
      "The page carries a list of keywords. Google does not use it and it has no effect, so " +
      "there is nothing here to keep up to date.",
    where:
      "Your theme or an installed app adds it. Removing it changes nothing; leaving it costs " +
      "nothing but the time spent maintaining the list.",
  },
  B25: {
    what:
      "Every link to them goes through a category first, so the address you tell Google is the " +
      "correct one is an address nothing actually points at.",
    where:
      "Your theme decides how product links are built. A developer changes it in one place and " +
      "it applies to every product.",
  },
  B26: {
    what:
      "The page asks search engines not to list the product, and the only thing wrong with it " +
      "is that it is out of stock. The address loses the standing it had and does not get it " +
      "back when the product returns.",
    where:
      "Your theme decides which pages carry that instruction. If the product is gone for good, " +
      "this is a reasonable thing to have done, and only you know which it is.",
  },
  B28: {
    what:
      "It takes more than three clicks from your home page to reach the product through your " +
      "menus and categories, which is further than most visitors go.",
    where:
      "Shopify, Online Store, Navigation, to shorten the route. Or add the product to a " +
      "category a menu already links to.",
  },
  B29: {
    what:
      "A count of the links on a product page, by kind. There is no right number, so this is " +
      "here to be watched and not to be fixed.",
    where: "Nothing to do. It is on the screen so you can see when it changes.",
  },
  B30: {
    what:
      "The post links to nothing you sell, so a reader who liked it has nowhere to go. A " +
      "shipping-policy post that sells nothing is doing its job.",
    where:
      "Shopify, Content, Blog posts, open one, and link a product or a category from the text.",
  },
  B31: {
    what:
      "The first picture a visitor sees is set to load late, so the page looks empty for a " +
      "moment on a slow phone connection.",
    where:
      "Your theme decides that. A developer changes it in one place and it applies to every " +
      "page.",
  },
  B32: {
    what:
      "A count of the code your product page loads, by where it comes from. There is no right " +
      "number, so this is here to be watched and not to be fixed.",
    where: "Nothing to do. It is on the screen so you can see when it changes.",
  },
};
