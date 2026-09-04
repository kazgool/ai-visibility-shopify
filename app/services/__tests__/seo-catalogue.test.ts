import { describe, it, expect } from "vitest";
import {
  COLLECTION_DESCRIPTION_WORDS,
  checkCollectionDescription,
  checkCollectionSize,
  checkDuplicateDescription,
  checkHomeRedirect,
  checkImageFilenames,
  checkOrphan,
  descriptionKey,
  duplicateDescriptions,
  fileNameOf,
  homePageRedirects,
  looksLikeDefaultFilename,
  targetsHomePage,
  type MenuLinks,
  type RedirectRead,
} from "../seo-catalogue";
import {
  CHECKS,
  buildFindingsAggregate,
  createFindingsCounters,
  describeFinding,
  foldFindingsRow,
} from "../seo-aggregate";
import { CHECK_LABEL, CHECK_METHOD, type Finding, type FindingCode } from "../seo-findings";

// The catalogue checks of PRD-SEO-FULL-ONPAGE section 5b, A10 to A16, built as
// build step 4a. Every one is computed from the Admin API and none of them
// fetches a page, so every one is asserted here from a literal.
//
// A14 has no tests because it has no code. The Markets setting it asks about is
// not exposed by the Admin API - every field of `Market` and of `Shop` was
// listed against a live shop on 4 September 2026 - and a check that could only
// ever answer "could not be determined" is a promise rather than a finding.

function detail(finding: Finding | null): Record<string, any> {
  expect(finding).not.toBeNull();
  return (finding as Finding).detail as Record<string, any>;
}

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}

// --- A10: the collection description ---------------------------------------

describe("A10, the collection description", () => {
  const collection = (descriptionHtml: string | null) => ({
    id: "gid://shopify/Collection/1",
    handle: "chairs",
    title: "Chairs",
    descriptionHtml,
  });

  it("fires on a collection with no description at all, and says zero words", () => {
    const found = checkCollectionDescription(collection(null));
    expect(found?.words).toBe(0);
    expect(checkCollectionDescription(collection(""))?.words).toBe(0);
  });

  it("fires at 49 words", () => {
    expect(checkCollectionDescription(collection(`<p>${words(49)}</p>`))?.words).toBe(49);
  });

  it("says nothing at 50", () => {
    // The boundary is the figure the practitioners named, and it is the figure
    // the check uses - not 50 "or so".
    expect(COLLECTION_DESCRIPTION_WORDS).toBe(50);
    expect(checkCollectionDescription(collection(`<p>${words(50)}</p>`))).toBeNull();
  });

  it("counts the words of the text, not the markup around them", () => {
    const html = `<div class="rte"><p><strong>${words(60)}</strong></p></div>`;
    expect(checkCollectionDescription(collection(html))).toBeNull();
  });
});

// --- A11: how many products a collection holds ------------------------------

describe("A11, a collection with nothing much in it", () => {
  const collection = (count: number | null) => ({
    id: "gid://shopify/Collection/1",
    handle: "chairs",
    title: "Chairs",
    ...(count === null ? {} : { productsCount: { count } }),
  });

  it("fires on zero and reports the count", () => {
    expect(checkCollectionSize(collection(0))?.products).toBe(0);
  });

  it("fires on one", () => {
    expect(checkCollectionSize(collection(1))?.products).toBe(1);
  });

  it("says nothing on two", () => {
    expect(checkCollectionSize(collection(2))).toBeNull();
  });

  it("is not asked when the read did not carry the count", () => {
    // Never answered as zero: the first time the query changes, that would put
    // a finding on every collection in the catalogue.
    expect(checkCollectionSize(collection(null))).toBeNull();
  });
});

// --- A12: one description, two products -------------------------------------

describe("A12, a description shared between products", () => {
  const product = (id: string, handle: string, descriptionHtml: string | null) => ({
    id,
    handle,
    descriptionHtml,
  });

  it("names the other handles when two products share a description", () => {
    const groups = duplicateDescriptions([
      product("1", "chair-a", "<p>A dining chair in solid oak.</p>"),
      product("2", "chair-b", "<p>A dining chair in solid oak.</p>"),
      product("3", "table-a", "<p>A dining table in solid oak.</p>"),
    ]);
    expect(groups.get("1")).toEqual(["chair-b"]);
    expect(groups.get("2")).toEqual(["chair-a"]);
    expect(groups.get("3")).toBeUndefined();

    const finding = checkDuplicateDescription(groups.get("1"))!;
    expect(finding.source).toBe("A");
    expect((finding.detail as any).sharedWith).toBe(1);
    const sentence = describeFinding(finding);
    expect(sentence).toContain("word for word the same as 1 other product: chair-b");
    // The row names the group and stops. Rewriting is the line this product
    // does not cross.
    expect(sentence).not.toMatch(/rewrite|change|should|improve/i);
  });

  it("never makes a group of one", () => {
    const groups = duplicateDescriptions([product("1", "chair-a", "<p>Only this one.</p>")]);
    expect(groups.size).toBe(0);
    expect(checkDuplicateDescription(groups.get("1"))).toBeNull();
    expect(checkDuplicateDescription([])).toBeNull();
  });

  it("does not group products that simply have no description", () => {
    // Fifty products with no description are fifty instances of nothing, not
    // one group of fifty - the same rule A3 keeps for a blank meta title.
    const groups = duplicateDescriptions([
      product("1", "a", null),
      product("2", "b", ""),
      product("3", "c", "<p>   </p>"),
    ]);
    expect(groups.size).toBe(0);
  });

  it("compares after the cleaning this app applies to everything it publishes", () => {
    // An imported catalogue writes "&amp;" where another writes "&". Google's
    // duplicate clustering sees one text; so does this.
    expect(descriptionKey("<p>Masa &amp; scaune</p>")).toBe(descriptionKey("<p>Masa & scaune</p>"));
    expect(descriptionKey("<p>A Chair</p>")).toBe(descriptionKey("<p>a chair</p>"));
  });
});

// --- A13: a redirect that lands on the home page ----------------------------

describe("A13, a redirect to the home page", () => {
  const read = (entries: { path: string; target: string }[]): RedirectRead => ({
    entries,
    partial: false,
    read: entries.length,
  });

  it("knows a home-page target from a page target", () => {
    expect(targetsHomePage("/")).toBe(true);
    expect(targetsHomePage("https://shop.example")).toBe(true);
    expect(targetsHomePage("https://shop.example/")).toBe(true);
    expect(targetsHomePage("/collections/chairs")).toBe(false);
    expect(targetsHomePage("https://shop.example/products/a-chair")).toBe(false);
    expect(targetsHomePage("")).toBe(false);
  });

  it("attaches a home-page redirect to the product whose address it names", () => {
    const grouped = homePageRedirects(
      read([
        { path: "/products/old-chair", target: "/" },
        { path: "/products/a-chair", target: "/collections/chairs" },
      ]),
    )!;
    expect(grouped.total).toBe(1);
    expect(grouped.byHandle.get("old-chair")).toHaveLength(1);
    expect(grouped.unmatched).toEqual([]);

    const finding = checkHomeRedirect(grouped.byHandle.get("old-chair"), read([]))!;
    const sentence = describeFinding(finding);
    expect(sentence).toContain("/products/old-chair to /");
    expect(sentence).toContain("soft 404");
  });

  it("says nothing about a redirect that points at a product", () => {
    const grouped = homePageRedirects(
      read([{ path: "/products/old-chair", target: "/products/a-chair" }]),
    )!;
    expect(grouped.total).toBe(0);
    expect(checkHomeRedirect(grouped.byHandle.get("old-chair"), null)).toBeNull();
  });

  it("says nothing when the shop has no redirects at all", () => {
    const grouped = homePageRedirects(read([]))!;
    expect(grouped.total).toBe(0);
    expect(grouped.unmatched).toEqual([]);
  });

  it("keeps the redirects that name no product, rather than dropping them", () => {
    // A migrated store's home-page redirects are mostly from deleted products,
    // collections and pages. They have no row to sit on and are recorded per
    // shop, exactly as A7's withdrawn-product half is.
    const grouped = homePageRedirects(
      read([
        { path: "/collections/old-range", target: "/" },
        { path: "/pages/about-us-2019", target: "/" },
      ]),
    )!;
    expect(grouped.total).toBe(2);
    expect(grouped.byHandle.size).toBe(0);
    expect(grouped.unmatched.map((e) => e.path)).toEqual([
      "/collections/old-range",
      "/pages/about-us-2019",
    ]);
  });

  it("is not asked at all when the redirects could not be read", () => {
    // Null, never an empty list: "this app may not read your redirects" and
    // "you have no redirects to the home page" are different sentences.
    expect(homePageRedirects(null)).toBeNull();
  });
});

// --- A15: a filename a camera chose -----------------------------------------

describe("A15, image filenames", () => {
  it("fires on IMG_0001.jpg", () => {
    expect(looksLikeDefaultFilename("https://cdn.shopify.com/s/files/1/IMG_0001.jpg")).toBe(true);
  });

  it("fires on a UUID, with or without its hyphens", () => {
    expect(looksLikeDefaultFilename("https://cdn/8f14e45f-ceea-467a-9bd2-1c4b3f2a9d01.png")).toBe(
      true,
    );
    expect(looksLikeDefaultFilename("https://cdn/8f14e45fceea467a9bd21c4b3f2a9d01.png")).toBe(true);
  });

  it("passes a filename a person wrote", () => {
    expect(looksLikeDefaultFilename("https://cdn/aarhus-dining-chair-oak.jpg")).toBe(false);
    // Deliberately narrow: a filename with words in it passes even when one of
    // the words is "img". A filter that removes noise and value together is
    // worse than the noise.
    expect(looksLikeDefaultFilename("https://cdn/chair-img-2.jpg")).toBe(false);
  });

  it("ignores the CDN's query string and size suffix", () => {
    expect(fileNameOf("https://cdn/IMG_0001_1024x1024.jpg?v=1712345")).toBe("IMG_0001.jpg");
    expect(looksLikeDefaultFilename("https://cdn/IMG_0001_1024x1024.jpg?v=1712345")).toBe(true);
  });

  it("reports count of denominator, and says nothing when no image was read", () => {
    const d = detail(checkImageFilenames({ imageUrl: "https://cdn/DSC_4410.jpg" }));
    expect(d.count).toBe(1);
    expect(d.images).toBe(1);
    expect(d.names).toEqual(["DSC_4410.jpg"]);
    expect(describeFinding(checkImageFilenames({ imageUrl: "https://cdn/DSC_4410.jpg" }) as Finding))
      .toContain("1 of 1 image file");
    // A1 already has a sentence for a product with no image, and two rows for
    // one absence is a reader deciding which to believe.
    expect(checkImageFilenames({ imageUrl: null })).toBeNull();
    expect(checkImageFilenames({})).toBeNull();
  });
});

// --- A16: a product nothing links to ----------------------------------------

describe("A16, orphan products", () => {
  const menus: MenuLinks = {
    productIds: new Set(["gid://shopify/Product/2"]),
    handles: new Set(["chair-c"]),
  };
  const product = (id: string, handle: string, collections: { handle: string; title: string }[]) => ({
    id,
    handle,
    collections,
  });

  it("says nothing about a product in a collection", () => {
    expect(
      checkOrphan(product("gid://shopify/Product/1", "chair-a", [{ handle: "chairs", title: "Chairs" }]), menus),
    ).toBeNull();
  });

  it("says nothing about a product a menu links to, by id or by handle", () => {
    // A menu item picked from the product list carries a resourceId; one typed
    // by hand carries only a url. A product linked by either is linked.
    expect(checkOrphan(product("gid://shopify/Product/2", "chair-b", []), menus)).toBeNull();
    expect(checkOrphan(product("gid://shopify/Product/3", "chair-c", []), menus)).toBeNull();
  });

  it("fires on a product in neither", () => {
    const finding = checkOrphan(product("gid://shopify/Product/4", "chair-d", []), menus)!;
    expect(finding.source).toBe("A");
    expect((finding.detail as any).handle).toBe("chair-d");
    expect(describeFinding(finding)).toContain("the only route to it is the sitemap");
  });

  it("is not asked at all when the menus could not be read", () => {
    // A product in no collection might be linked from a menu nobody looked at.
    // Reporting it as an orphan would be an accusation, not a finding.
    expect(checkOrphan(product("gid://shopify/Product/4", "chair-d", []), null)).toBeNull();
  });
});

// --- the vocabulary ---------------------------------------------------------

describe("the section 5b vocabulary", () => {
  const PRODUCT_CODES: FindingCode[] = ["A12", "A13", "A15", "A16"];
  const COLLECTION_CODES: FindingCode[] = ["A10", "A11"];

  it("counts the four product checks over the catalogue, in source A's pass", () => {
    for (const code of PRODUCT_CODES) {
      const check = CHECKS.find((c) => c.code === code);
      expect(check?.source).toBe("A");
      expect(check?.basis).toBe("catalogue");
    }
  });

  it("keeps the two collection checks out of the product aggregate", () => {
    // Their denominator is collections. A denominator that is not this
    // aggregate's is never borrowed into it - the same separation A6 keeps.
    for (const code of COLLECTION_CODES) {
      expect(CHECK_LABEL[code]).toBeTruthy();
      expect(CHECKS.find((c) => c.code === code)).toBeUndefined();
    }
  });

  it("has no A14, and the absence is deliberate", () => {
    expect(Object.keys(CHECK_LABEL)).not.toContain("A14");
    expect(CHECKS.find((c) => c.code === ("A14" as FindingCode))).toBeUndefined();
  });

  it("says none of the words this product does not say", () => {
    const strings: string[] = [];
    for (const code of [...PRODUCT_CODES, ...COLLECTION_CODES]) {
      strings.push(CHECK_LABEL[code]);
      const method = CHECK_METHOD[code];
      if (method) strings.push(method);
    }
    for (const text of strings) {
      expect(text).not.toMatch(/\brank/i);
      expect(text).not.toMatch(/\bscore/i);
      expect(text).not.toMatch(/\bboost/i);
      expect(text).not.toMatch(/optimi[sz]/i);
      expect(text).not.toMatch(/keyword/i);
    }
  });
});

// --- the fourth state on the card -------------------------------------------

describe("a check that was asked for and refused", () => {
  function counters(products: number) {
    const c = createFindingsCounters();
    for (let i = 0; i < products; i += 1) {
      foldFindingsRow(c, {
        productId: `p${i}`,
        handle: `h${i}`,
        bulkAt: new Date(),
        scannedAt: null,
        status: null,
        findings: [],
      });
    }
    return c;
  }

  it("reads as could-not-run and not as clean, with the reason on the row", () => {
    // The distinction the whole state exists for. A13 has a full denominator
    // and a count of zero, which without this renders as a check that ran and
    // found nothing - a claim nobody is entitled to make about a query the
    // shop refused.
    const aggregate = buildFindingsAggregate(counters(50), {
      couldNotRun: { A13: "The shop's URL redirects could not be read." },
    });
    const a13 = aggregate.rows.find((r) => r.code === "A13")!;
    expect(a13.state).toBe("couldNotRun");
    expect(a13.reason).toContain("could not be read");
    expect(aggregate.clean.map((r) => r.code)).not.toContain("A13");
  });

  it("leaves every other check exactly as it was", () => {
    const aggregate = buildFindingsAggregate(counters(50), {
      couldNotRun: { A13: "refused" },
    });
    // Clean rows live in `clean`, not in `rows` - the card collapses them into
    // one line rather than printing a wall of zeros.
    expect(aggregate.clean.find((r) => r.code === "A16")!.state).toBe("clean");
    expect(aggregate.rows.map((r) => r.code)).not.toContain("A16");
  });

  it("is clean again the moment the read succeeds", () => {
    // The Setting is rewritten in full every pass, so a scope that arrives
    // clears the entry with nothing to migrate.
    const aggregate = buildFindingsAggregate(counters(50), { couldNotRun: {} });
    expect(aggregate.rows.find((r) => r.code === "A13")).toBeUndefined();
    expect(aggregate.clean.map((r) => r.code)).toContain("A13");
  });
});
