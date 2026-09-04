import { describe, it, expect } from "vitest";

// B8, B9 and A7 (PRD-SEO-FULL-ONPAGE section 2), plus the sitemap parser they
// depend on. Every one of them is a pure function over a string or a value, so
// the interesting cases can be produced at all - which is the only reason
// source B's checks were written that way.

import {
  checkCanonicalShape,
  checkHreflang,
  checkSitemap,
  extractHreflangs,
  locsOf,
  productHandleOf,
  fetchSitemap,
  type MarketsInfo,
} from "../seo-page.server";

const PAGE = "https://nordwood.example/products/masa-oslo";

describe("B8: the shape of the canonical", () => {
  it("is silent on the plain product URL", () => {
    expect(checkCanonicalShape(PAGE, "masa-oslo", PAGE)).toBeNull();
    // A trailing slash is the same address, not a second one.
    expect(checkCanonicalShape(`${PAGE}/`, "masa-oslo", PAGE)).toBeNull();
  });

  it("names a variant URL and the address it should carry", () => {
    const finding = checkCanonicalShape(`${PAGE}?variant=44556677`, "masa-oslo", PAGE)!;
    expect(finding.code).toBe("B8");
    expect(finding.detail.reason).toBe("variant");
    // As fetched, so the merchant finds this string when they open the source.
    expect(finding.detail.canonical).toBe(`${PAGE}?variant=44556677`);
    expect(finding.detail.shouldBe).toBe("/products/masa-oslo");
  });

  it("names a collection-prefixed URL, and says where the second URL comes from", () => {
    const finding = checkCanonicalShape(
      "https://nordwood.example/collections/mese/products/masa-oslo",
      "masa-oslo",
      PAGE,
    )!;
    expect(finding.detail.reason).toBe("collection");
    // Section 5a listed this as its own case; it is this check, not a second
    // one, and the row explains the mechanism rather than blaming the theme.
    expect(String(finding.detail.note)).toContain("`within` filter");
  });

  it("reports anything else as other, including the home page", () => {
    const finding = checkCanonicalShape("https://nordwood.example/", "masa-oslo", PAGE)!;
    expect(finding.detail.reason).toBe("other");
  });

  it("says nothing when there is no canonical - B2 already has that sentence", () => {
    // Two rows both saying "no canonical" is a reader deciding which to believe.
    expect(checkCanonicalShape(null, "masa-oslo", PAGE)).toBeNull();
  });

  it("says nothing when the handle is unknown, rather than guessing the address", () => {
    expect(checkCanonicalShape(PAGE, null, PAGE)).toBeNull();
  });

  it("resolves a relative canonical against the page before judging it", () => {
    expect(checkCanonicalShape("/products/masa-oslo", "masa-oslo", PAGE)).toBeNull();
    const finding = checkCanonicalShape("/collections/x/products/masa-oslo", "masa-oslo", PAGE)!;
    expect(finding.detail.reason).toBe("collection");
  });
});

describe("B9: hreflang", () => {
  const two: MarketsInfo = { count: 2, locales: ["en-gb", "ro-ro"] };

  const withLinks = `
    <link rel="alternate" hreflang="en-GB" href="https://x/en">
    <link rel="alternate" hreflang="ro-RO" href="https://x/ro">
  `;

  it("says nothing at all on a single-market shop", () => {
    // Not "clean" - the card reads the recorded market count and renders
    // "not applicable". A finding here would be an accusation about nothing.
    expect(checkHreflang("", { count: 1, locales: ["ro-ro"] })).toBeNull();
  });

  it("says nothing when the markets read could not be made", () => {
    expect(checkHreflang("", null)).toBeNull();
  });

  it("is silent on a two-market shop whose page declares both locales", () => {
    expect(checkHreflang(withLinks, two)).toBeNull();
  });

  it("blames the platform setting, never the theme, when the links are absent", () => {
    const finding = checkHreflang("<html><head></head></html>", two)!;
    expect(finding.code).toBe("B9");
    expect(finding.detail.cause).toBe("platform_setting");
    expect(finding.detail.missing).toEqual(["en-gb", "ro-ro"]);
  });

  it("names only the locales that are missing when some are present", () => {
    const partial = '<link rel="alternate" hreflang="ro-RO" href="https://x/ro">';
    const finding = checkHreflang(partial, two)!;
    expect(finding.detail.present).toEqual(["ro-ro"]);
    expect(finding.detail.missing).toEqual(["en-gb"]);
  });

  it("reads hreflang values case-insensitively and ignores non-alternate links", () => {
    const html = `
      <link rel="stylesheet" hreflang="fr-FR" href="x.css">
      <link rel="alternate" hreflang="EN-gb" href="https://x/en">
    `;
    expect(extractHreflangs(html)).toEqual(["en-gb"]);
  });
});

describe("A7: the sitemap", () => {
  const sitemap = { handles: new Set(["masa-oslo", "scaun-bergen"]), urls: 2 };

  it("is silent for a product the sitemap lists", () => {
    expect(checkSitemap("masa-oslo", sitemap)).toBeNull();
  });

  it("reports a public product the sitemap does not list, as a product setting", () => {
    const finding = checkSitemap("raft-viborg", sitemap)!;
    expect(finding.code).toBe("A7");
    // Computed in source B's pass from a fetch source A never makes, so source
    // B must own it or the next catalogue pass would erase it.
    expect(finding.source).toBe("A+B");
    // Shopify owns the file, so the row can only ever report.
    expect(finding.detail.fix).toBe("product_setting");
  });

  it("says nothing at all when the sitemap could not be read", () => {
    // Every development store is behind a storefront password, and its
    // sitemap answers with the password form. Reading that as "no product is
    // listed" would put a finding on the entire catalogue.
    expect(checkSitemap("masa-oslo", null)).toBeNull();
  });
});

describe("the sitemap parser", () => {
  it("reads every loc in document order", () => {
    const xml = `<urlset><url><loc>https://x/a</loc></url><url><loc> https://x/b </loc></url></urlset>`;
    expect(locsOf(xml)).toEqual(["https://x/a", "https://x/b"]);
  });

  it("takes the handle from a product URL and skips everything else", () => {
    expect(productHandleOf("https://x/products/masa-oslo")).toBe("masa-oslo");
    expect(productHandleOf("https://x/products/masa-oslo/")).toBe("masa-oslo");
    // Shopify prefixes a market's URLs with its locale.
    expect(productHandleOf("https://x/en-gb/products/masa-oslo")).toBe("masa-oslo");
    expect(productHandleOf("https://x/collections/mese")).toBeNull();
    expect(productHandleOf("https://x/pages/about")).toBeNull();
    expect(productHandleOf("not a url")).toBeNull();
  });
});

describe("fetching the sitemap", () => {
  function xmlResponse(body: string) {
    return { ok: true, text: async () => body } as unknown as Response;
  }

  it("follows the index to the product sitemaps and collects the handles", async () => {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith("/sitemap.xml")) {
        return xmlResponse(
          `<sitemapindex>
             <sitemap><loc>https://x/sitemap_products_1.xml</loc></sitemap>
             <sitemap><loc>https://x/sitemap_collections_1.xml</loc></sitemap>
           </sitemapindex>`,
        );
      }
      return xmlResponse(
        `<urlset><url><loc>https://x/products/masa-oslo</loc></url></urlset>`,
      );
    }) as unknown as typeof fetch;

    const out = await fetchSitemap("https://x", impl);

    expect(out.read?.handles.has("masa-oslo")).toBe(true);
    expect(out.read?.urls).toBe(1);
    // The collections sitemap is never fetched: it holds no product URLs, and
    // every fetch here is charged to the shop's daily page budget.
    expect(calls).toEqual(["https://x/sitemap.xml", "https://x/sitemap_products_1.xml"]);
    expect(out.fetches).toBe(2);
  });

  it("reads a small shop's sitemap.xml when it is a urlset rather than an index", async () => {
    const impl = (async () =>
      xmlResponse(
        `<urlset><url><loc>https://x/products/masa-oslo</loc></url></urlset>`,
      )) as unknown as typeof fetch;

    const out = await fetchSitemap("https://x", impl);
    expect(out.read?.handles.has("masa-oslo")).toBe(true);
    expect(out.fetches).toBe(1);
  });

  it("returns nothing readable when the password form answers instead of XML", async () => {
    // A password page answers 200 with HTML. Treating it as an empty sitemap
    // would put A7 on every product in the catalogue.
    const impl = (async () =>
      ({ ok: true, text: async () => "<html><body>Enter password</body></html>" }) as unknown as Response) as unknown as typeof fetch;

    const out = await fetchSitemap("https://x", impl);
    expect(out.read).toBeNull();
    expect(out.error).toContain("could not be read");
  });

  it("returns nothing readable rather than a partial set when the index is too large", async () => {
    const children = Array.from(
      { length: 30 },
      (_, i) => `<sitemap><loc>https://x/sitemap_products_${i}.xml</loc></sitemap>`,
    ).join("");
    const impl = (async (url: string) =>
      String(url).endsWith("/sitemap.xml")
        ? xmlResponse(`<sitemapindex>${children}</sitemapindex>`)
        : xmlResponse(`<urlset></urlset>`)) as unknown as typeof fetch;

    const out = await fetchSitemap("https://x", impl, { maxSitemaps: 5 });
    // A partial set would report every product in the unread sitemaps as
    // absent from the file, which is the loudest possible wrong answer.
    expect(out.read).toBeNull();
    expect(out.error).toContain("30 product sitemaps");
  });

  it("returns nothing readable when the request throws", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const out = await fetchSitemap("https://x", impl);
    expect(out.read).toBeNull();
  });
});
