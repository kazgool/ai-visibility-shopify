// The page half of PRD-SEO-FULL-ONPAGE section 5b: B25 to B32, built 4
// September 2026 (build step 4b).
//
// Every check here is a pure function over a string of HTML, so the cases that
// matter can be produced at all. That is not a convenience: the dev store's
// storefront is behind a password that cannot be turned off, its theme emits
// one shape of markup, and a suite that could only assert what that one theme
// happens to do would be asserting the theme.
//
// Two absences are asserted deliberately, because a reader six months from now
// will otherwise assume they were forgotten:
//
//  - B27 is not a code. Section 5b's own row says it is "B1 with the sources
//    named", so B1's detail carries the origins.
//  - B30 is not in CHECKS. Its denominator is the blog posts a pass read,
//    which is neither the catalogue nor the pages read.

import { describe, expect, it } from "vitest";

import {
  BLOG_POST_CAP,
  COLLECTION_PAGE_CAP,
  MAX_CLICK_DEPTH,
  checkBlogPostLinks,
  checkInternalLinkKinds,
  checkLazyFirstImage,
  checkLongFormLinks,
  checkNoindexOutOfStock,
  checkScriptOrigins,
  countLinkForms,
  elementRegions,
  firstImage,
  linksByKind,
  productLinks,
  scriptOrigins,
} from "../seo-onpage";
import { checkClickDepth, clickDepthOf, type MenuLinks } from "../seo-catalogue";
import { CHECKS, buildFindingsAggregate, createFindingsCounters, describeFinding, foldFindingsRow } from "../seo-aggregate";
import { CHECK_LABEL, CHECK_METHOD, type Finding, type FindingCode } from "../seo-findings";

const ORIGIN = "https://nordwood.example";
const PAGE = `${ORIGIN}/products/masa-oslo`;

// --- B25 --------------------------------------------------------------------

describe("B25, the two shapes of a product link", () => {
  const grid = `
    <a href="/collections/mese/products/masa-oslo">Masa Oslo</a>
    <a href="/collections/mese/products/scaun-bergen">Scaun Bergen</a>
    <a href="/products/raft-viborg">Raft Viborg</a>
    <a href="/collections/mese">All tables</a>
    <a href="https://other.example/products/masa-oslo">Elsewhere</a>
    <a href="/en-gb/products/masa-oslo">The British copy</a>
  `;

  it("tells the collection-prefixed form from the plain one", () => {
    const links = productLinks(grid, `${ORIGIN}/collections/mese`);
    expect(links.map((l) => `${l.handle}:${l.long}`)).toEqual([
      "masa-oslo:true",
      "scaun-bergen:true",
      "raft-viborg:false",
    ]);
    expect(countLinkForms(links)).toEqual({ long: 2, short: 1 });
  });

  it("counts neither a collection page nor another shop's address as a product link", () => {
    const links = productLinks(grid, `${ORIGIN}/collections/mese`);
    expect(links.some((l) => l.href.includes("other.example"))).toBe(false);
    expect(links.some((l) => l.href.endsWith("/collections/mese"))).toBe(false);
  });

  it("skips a market-prefixed address rather than counting it as the long form", () => {
    // /en-gb/products/y is a different market's copy of the page, which is
    // B9's question. Counted here it would report the long form on every
    // product of every multi-market shop.
    const links = productLinks(grid, `${ORIGIN}/collections/mese`);
    expect(links.filter((l) => l.handle === "masa-oslo")).toHaveLength(1);
  });

  it("fires when every link the pass saw used the long form", () => {
    const finding = checkLongFormLinks({ long: 3, short: 0 })!;
    expect(finding.code).toBe("B25");
    expect(finding.source).toBe("B");
    expect(finding.detail).toEqual({ long: 3, short: 0 });
    expect(describeFinding(finding)).toContain("plain product address");
  });

  it("stays silent when the plain address is linked at least once", () => {
    // The canonical is linked, which is the whole question. Three long-form
    // links beside it are Shopify doing what Shopify does.
    expect(checkLongFormLinks({ long: 3, short: 1 })).toBeNull();
  });

  it("is not asked at all about a product no collection page named", () => {
    // undefined is "this pass saw no link to it", which is A16's question and
    // not this one. A zero here would claim the canonical was checked.
    expect(checkLongFormLinks(undefined)).toBeNull();
    expect(checkLongFormLinks({ long: 0, short: 0 })).toBeNull();
  });
});

// --- B26 --------------------------------------------------------------------

describe("B26, noindex on a product that is only out of stock", () => {
  it("fires only when both halves are true", () => {
    const finding = checkNoindexOutOfStock(true, "https://schema.org/OutOfStock")!;
    expect(finding.code).toBe("B26");
    expect(describeFinding(finding)).toContain("soft 404");
  });

  it("says nothing about a noindex on a product that is in stock", () => {
    // That is B3's finding. Two rows for one tag is a reader deciding which to
    // believe.
    expect(checkNoindexOutOfStock(true, "https://schema.org/InStock")).toBeNull();
  });

  it("says nothing about an out-of-stock product that is indexed", () => {
    expect(checkNoindexOutOfStock(false, "https://schema.org/OutOfStock")).toBeNull();
  });

  it("says nothing when the page states no availability at all", () => {
    // "Not stated" is not "out of stock", and a page with no Product node
    // states nothing.
    expect(checkNoindexOutOfStock(true, null)).toBeNull();
    expect(checkNoindexOutOfStock(true, "  ")).toBeNull();
  });

  it("reads SoldOut and Discontinued as well as OutOfStock", () => {
    expect(checkNoindexOutOfStock(true, "SoldOut")).not.toBeNull();
    expect(checkNoindexOutOfStock(true, "https://schema.org/Discontinued")).not.toBeNull();
  });
});

// --- B28 --------------------------------------------------------------------

describe("B28, click depth", () => {
  const menus: MenuLinks = {
    productIds: new Set(),
    handles: new Set(),
    productDepth: new Map([["gid://shopify/Product/9", 2]]),
    // "mese" is a top-level menu item; "arhiva" is three levels down.
    collectionDepth: new Map([
      ["mese", 1],
      ["arhiva", 3],
    ]),
  };
  const product = (id: string, handle: string, collections: string[]) => ({
    id,
    handle,
    collections: collections.map((h) => ({ handle: h, title: h })),
  });

  it("counts the collection click and then the product click", () => {
    expect(clickDepthOf(product("p1", "masa-oslo", ["mese"]), menus)).toBe(2);
    expect(clickDepthOf(product("p2", "raft", ["arhiva"]), menus)).toBe(4);
  });

  it("takes the shortest route when a product is in two collections", () => {
    expect(clickDepthOf(product("p3", "x", ["arhiva", "mese"]), menus)).toBe(2);
  });

  it("prefers a direct menu link over the route through a collection", () => {
    expect(clickDepthOf(product("gid://shopify/Product/9", "y", ["arhiva"]), menus)).toBe(2);
  });

  it("fires past three and stays silent at three", () => {
    expect(checkClickDepth(product("p3", "x", ["mese"]), menus)).toBeNull();
    const finding = checkClickDepth(product("p4", "z", ["arhiva"]), menus)!;
    expect(finding.code).toBe("B28");
    // Computed in source A's pass, so source A owns it and the next catalogue
    // read rewrites it rather than a page read clearing it.
    expect(finding.source).toBe("A");
    expect(finding.detail).toEqual({ depth: 4, limit: MAX_CLICK_DEPTH });
    expect(describeFinding(finding)).toContain("4 clicks");
  });

  it("says nothing at all about a product no menu route reaches", () => {
    // That is A16's finding, not a depth of infinity, and two rows for one
    // absence is a reader deciding which to believe.
    expect(clickDepthOf(product("p5", "orphan", []), menus)).toBeNull();
    expect(checkClickDepth(product("p5", "orphan", []), menus)).toBeNull();
  });

  it("is not asked at all when the menus could not be read", () => {
    expect(checkClickDepth(product("p4", "z", ["arhiva"]), null)).toBeNull();
  });
});

// --- B29 --------------------------------------------------------------------

describe("B29, internal links by kind", () => {
  const html = `
    <body>
      <nav class="breadcrumbs">
        <a href="/">Home</a><a href="/collections/mese">Tables</a>
      </nav>
      <div class="product__description rte">
        <a href="/products/scaun-bergen">Matching chair</a>
      </div>
      <section class="related-products">
        <a href="/collections/mese/products/raft-viborg">Raft</a>
        <a href="/products/masa-aarhus">Aarhus</a>
      </section>
      <a href="https://instagram.example/x">Instagram</a>
    </body>
  `;

  it("counts each kind where the markup puts it", () => {
    const kinds = linksByKind(html, PAGE);
    expect(kinds.breadcrumb).toBe(2);
    expect(kinds.related).toBe(2);
    expect(kinds.inDescription).toBe(1);
    // Two: the breadcrumb's collection link and the related grid's
    // collection-prefixed one.
    expect(kinds.collection).toBe(2);
  });

  it("does not count another shop's address as an internal link", () => {
    expect(linksByKind(html, PAGE).total).toBe(5);
  });

  it("closes a region where it really closes, not at the first closing tag", () => {
    const nested = `<div class="related"><div><a href="/a">a</a></div><a href="/b">b</a></div><a href="/c">c</a>`;
    const regions = elementRegions(nested, ["div"], /related/i);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toContain('href="/b"');
    expect(regions[0]).not.toContain('href="/c"');
  });

  it("is a count on every page and never a verdict", () => {
    // Including the interesting case: a product page with no breadcrumb and no
    // related products. A check that returned null on "nothing found" would
    // lose exactly that page.
    const bare = "<body><p>Just words.</p></body>";
    const finding = checkInternalLinkKinds(linksByKind(bare, PAGE))!;
    expect(finding.code).toBe("B29");
    expect(finding.detail).toMatchObject({ breadcrumb: 0, related: 0, total: 0 });
  });

  it("states no target number anywhere in its row", () => {
    const finding = checkInternalLinkKinds(linksByKind(html, PAGE))!;
    const text = `${CHECK_LABEL.B29} ${CHECK_METHOD.B29} ${describeFinding(finding)}`;
    expect(text).toMatch(/no target number/i);
    expect(text).not.toMatch(/should have|at least|too few|aim for/i);
  });
});

// --- B31 --------------------------------------------------------------------

describe("B31, the first image", () => {
  it("reads the first image inside the body and its loading attribute", () => {
    const html = `<head><img src="/head.png"></head><body><img src="/hero.jpg" loading="lazy"><img src="/b.jpg"></body>`;
    expect(firstImage(html)).toEqual({ src: "/hero.jpg", loading: "lazy" });
  });

  it("fires on lazy and says nothing on eager or on no attribute at all", () => {
    const lazy = `<body><img src="/hero.jpg" loading="lazy"></body>`;
    const eager = `<body><img src="/hero.jpg" loading="eager"></body>`;
    const plain = `<body><img src="/hero.jpg"></body>`;
    expect(checkLazyFirstImage(lazy)?.detail).toEqual({ loading: "lazy", src: "/hero.jpg" });
    expect(checkLazyFirstImage(eager)).toBeNull();
    expect(checkLazyFirstImage(plain)).toBeNull();
  });

  it("says nothing at all about a page with no image", () => {
    expect(firstImage("<body><p>Words.</p></body>")).toBeNull();
    expect(checkLazyFirstImage("<body><p>Words.</p></body>")).toBeNull();
  });

  it("claims nothing about what paints largest", () => {
    // The row is the attribute as found. "LCP" cannot be read from HTML with
    // no browser, and a row that implied it could would be a guess.
    expect(CHECK_METHOD.B31).toMatch(/first image/i);
    expect(CHECK_METHOD.B31).not.toMatch(/\bLCP\b|core web vitals/i);
  });
});

// --- B32 --------------------------------------------------------------------

describe("B32, the scripts a page loads", () => {
  const html = `
    <script>var a = 1;</script>
    <script src="https://cdn.shopify.com/a.js"></script>
    <script src="https://cdn.shopify.com/b.js"></script>
    <script src="//reviews.example/widget.js"></script>
    <script src="/local.js"></script>
  `;

  it("groups by host, with inline as its own group and a relative src as the shop's", () => {
    expect(scriptOrigins(html, PAGE)).toEqual([
      { origin: "cdn.shopify.com", count: 2 },
      { origin: "inline", count: 1 },
      { origin: "nordwood.example", count: 1 },
      { origin: "reviews.example", count: 1 },
    ]);
  });

  it("counts and never judges", () => {
    const finding = checkScriptOrigins(html, PAGE)!;
    expect(finding.code).toBe("B32");
    expect(finding.detail).toMatchObject({ scripts: 5, origins: 4 });
    const text = `${CHECK_LABEL.B32} ${CHECK_METHOD.B32} ${describeFinding(finding)}`;
    expect(text).not.toMatch(/remove|delete|slow|too many|bloat/i);
  });

  it("reports a page with one inline script rather than nothing", () => {
    // A reports check has to have a row on every page, including the quiet
    // one: "no third-party script here" is a fact worth seeing beside a page
    // that carries nine.
    expect(checkScriptOrigins("<script>1</script>", PAGE)?.detail).toMatchObject({
      scripts: 1,
      origins: 1,
    });
  });
});

// --- B30 --------------------------------------------------------------------

describe("B30, a blog post that links to nothing you sell", () => {
  const url = `${ORIGIN}/blogs/news/how-to-choose`;

  it("fires on a post with no product and no collection link", () => {
    const html = `<a href="/pages/about">About</a><a href="https://elsewhere.example/products/x">Elsewhere</a>`;
    const finding = checkBlogPostLinks(html, url)!;
    expect(finding.code).toBe("B30");
    expect(finding.detail).toMatchObject({ products: 0, collections: 0 });
  });

  it("says nothing when the post links to a product, or to a collection", () => {
    expect(checkBlogPostLinks(`<a href="/products/masa-oslo">x</a>`, url)).toBeNull();
    expect(checkBlogPostLinks(`<a href="/collections/mese">x</a>`, url)).toBeNull();
    // A market prefix is the same link.
    expect(checkBlogPostLinks(`<a href="/en-gb/products/masa-oslo">x</a>`, url)).toBeNull();
  });

  it("never says a post should link to something", () => {
    const text = `${CHECK_LABEL.B30} ${CHECK_METHOD.B30}`;
    expect(text).not.toMatch(/should|must|add a link/i);
  });
});

// --- the vocabulary and the two deliberate absences --------------------------

describe("the section 5b page vocabulary", () => {
  const PAGE_CODES: FindingCode[] = ["B25", "B26", "B29", "B31", "B32"];
  const REPORTS_CODES: FindingCode[] = ["B29", "B32"];

  it("counts the page checks over the pages read, in source B's pass", () => {
    for (const code of PAGE_CODES) {
      expect(CHECK_LABEL[code]).toBeTruthy();
      const check = CHECKS.find((c) => c.code === code)!;
      expect(check.source).toBe("B");
      expect(check.basis).toBe("pagesRead");
    }
  });

  it("counts B28 over the catalogue, because it fetches no page", () => {
    const check = CHECKS.find((c) => c.code === "B28")!;
    expect(check.source).toBe("A");
    expect(check.basis).toBe("catalogue");
  });

  it("keeps B30 out of the aggregate, because its denominator is the posts read", () => {
    expect(CHECK_LABEL.B30).toBeTruthy();
    expect(CHECKS.find((c) => c.code === "B30")).toBeUndefined();
  });

  it("has no B27, and the absence is deliberate: B1 carries the sources", () => {
    expect(Object.keys(CHECK_LABEL)).not.toContain("B27");
    expect(CHECKS.find((c) => c.code === ("B27" as FindingCode))).toBeUndefined();
  });

  it("marks the two counting checks as reports, and no others", () => {
    expect(CHECKS.filter((c) => c.reports).map((c) => c.code).sort()).toEqual(REPORTS_CODES);
  });

  it("says none of the words this product does not say", () => {
    const strings: string[] = [];
    for (const code of [...PAGE_CODES, "B28" as FindingCode, "B30" as FindingCode]) {
      strings.push(CHECK_LABEL[code]);
      const method = CHECK_METHOD[code];
      if (method) strings.push(method);
    }
    for (const text of strings) {
      expect(text).not.toMatch(/\brank/i);
      expect(text).not.toMatch(/\bscore/i);
      expect(text).not.toMatch(/\bboost/i);
      expect(text).not.toMatch(/optimi[sz]/i);
      expect(text).not.toMatch(/\bkeyword/i);
    }
  });
});

// --- how a counted row reaches the card --------------------------------------

describe("a check that counts and does not judge", () => {
  function rowWith(findings: Finding[]) {
    return {
      bulkAt: new Date(),
      scannedAt: new Date(),
      status: "ok",
      findings,
      nodes: [],
      appBlock: "present",
      noindex: false,
    } as any;
  }

  const b29 = (n: number): Finding => ({
    code: "B29",
    source: "B",
    detail: { breadcrumb: n, related: 0, collection: n, inDescription: 0, total: n },
  });

  it("renders as counted rather than as found, whatever its count", () => {
    const counters = createFindingsCounters();
    foldFindingsRow(counters, rowWith([b29(3)]));
    foldFindingsRow(counters, rowWith([b29(1)]));
    const aggregate = buildFindingsAggregate(counters);

    const row = aggregate.rows.find((r) => r.code === "B29")!;
    expect(row.state).toBe("counted");
    // Two products carried it, and the numbers are summed across them: a row
    // that says nothing about pass or fail has only the numbers to say.
    expect(row.count).toBe(2);
    expect(row.totals).toEqual({
      breadcrumb: 4,
      related: 0,
      collection: 4,
      inDescription: 0,
      total: 4,
    });
    // Never in the clean group: "found nothing" is a verdict, and this row
    // states none.
    expect(aggregate.clean.map((r) => r.code)).not.toContain("B29");
    expect(aggregate.rows.filter((r) => r.state === "found").map((r) => r.code)).not.toContain("B29");
  });

  it("is still not-yet-read before any page has been read", () => {
    // A count of nothing measured is not a count of zero, and that rule does
    // not stop applying because a row states no verdict.
    const counters = createFindingsCounters();
    foldFindingsRow(counters, { bulkAt: new Date(), scannedAt: null, status: null, findings: [] } as any);
    const aggregate = buildFindingsAggregate(counters);
    expect(aggregate.rows.find((r) => r.code === "B29")?.state).toBe("notYetRead");
  });

  it("sits after every row that does state a verdict", () => {
    const counters = createFindingsCounters();
    foldFindingsRow(counters, rowWith([b29(1), { code: "B3", source: "B", detail: { from: "meta" } }]));
    const aggregate = buildFindingsAggregate(counters);
    const codes = aggregate.rows.map((r) => r.code);
    expect(codes.indexOf("B29")).toBeGreaterThan(codes.indexOf("B3"));
    expect(codes[codes.length - 1]).toBe("B32");
  });
});

// --- the two caps ------------------------------------------------------------

describe("the caps B25 and B30 read under", () => {
  it("states both as numbers a reader can find", () => {
    // Neither is advice and neither is a threshold: they are how much of a
    // merchant's storefront one pass is willing to ask for.
    expect(COLLECTION_PAGE_CAP).toBe(20);
    expect(BLOG_POST_CAP).toBe(25);
  });
});
