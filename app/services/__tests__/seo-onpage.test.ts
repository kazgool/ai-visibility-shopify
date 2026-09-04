import { describe, it, expect } from "vitest";
import {
  DESCRIPTION_MAX_CHARS,
  LINK_CHECK_CAP,
  THIN_PAGE_WORDS,
  TITLE_MAX_CHARS,
  checkDeprecatedNodes,
  checkDuplicateTitle,
  checkH1,
  checkHandle,
  checkInternalLinks,
  checkMetaDescription,
  checkMetaKeywords,
  checkMixedContent,
  checkOpenGraph,
  checkPageAltText,
  checkRedirectChain,
  checkThinContent,
  checkTitleTag,
  checkTwitterCard,
  countWords,
  extractH1s,
  extractMetaContent,
  extractTitleTag,
  internalLinks,
  titleKey,
  visibleWords,
} from "../seo-onpage";
import { CHECKS, describeFinding } from "../seo-aggregate";
import { CHECK_LABEL, CHECK_METHOD, type Finding, type FindingCode } from "../seo-findings";

// The on-page checks of PRD-SEO-FULL-ONPAGE sections 3 and 5a, B10 to B24.
//
// Every one of them is asserted from a string of HTML, which is the only way
// the interesting cases can be produced at all: the one development store's
// storefront password cannot be turned off, so every page source B fetches
// there answers with the password form (PRD-SEO-PER-PRODUCT section 9.3).
//
// Two things are asserted about every check and not only about its logic: the
// sentence it renders on the screen, and that the sentence contains none of
// the words this product does not say.

const PAGE = "https://shop.example/products/a-chair";

function detail(finding: Finding | null): Record<string, any> {
  expect(finding).not.toBeNull();
  return (finding as Finding).detail as Record<string, any>;
}

// --- B10: the title tag -----------------------------------------------------

describe("B10, the title tag", () => {
  it("says nothing about a title inside the range a phone result shows", () => {
    expect(checkTitleTag("<title>A chair in solid oak, natural finish</title>")).toBeNull();
  });

  it("reports the length and the tag when it is longer than that", () => {
    const title = "A dining chair in solid oak with a natural oil finish, for a kitchen table";
    const d = detail(checkTitleTag(`<title>${title}</title>`));
    expect(d.length).toBe(title.length);
    expect(d.title).toBe(title);
    expect(d.side).toBe("long");
    expect(d.longerThan).toBe(TITLE_MAX_CHARS);
  });

  it("reports a short title as short and not as a fault", () => {
    const d = detail(checkTitleTag("<title>A chair</title>"));
    expect(d.side).toBe("short");
    expect(d.length).toBe(7);
  });

  it("reports an absent title tag as absent, not as a length of zero", () => {
    const d = detail(checkTitleTag("<html><body>no head</body></html>"));
    expect(d.present).toBe(false);
    expect(d.title).toBeNull();
  });

  it("counts characters, not bytes of markup: entities are decoded first", () => {
    expect(extractTitleTag("<title>Masa &amp; scaune</title>")).toBe("Masa & scaune");
  });

  it("prints plain characters, whatever the theme wrote", () => {
    // A real dev-store title, read on 4 September 2026, and the reason this
    // file uses the engine's entity table and cleanOutput rather than a local
    // one: `&ndash;` was unknown to the local table, so the row would have
    // shown a merchant an entity and counted it as seven characters.
    const title = extractTitleTag(
      "<title>Aarhus Round Dining Set &amp; 4 Chairs &ndash; MRDigital</title>",
    );
    expect(title).toBe("Aarhus Round Dining Set & 4 Chairs - MRDigital");
    expect(title).not.toMatch(/&[a-z]+;/i);
  });

  it("quotes Google on truncation and never says the title is over a limit", () => {
    const long = "x".repeat(80);
    const sentence = describeFinding(checkTitleTag(`<title>${long}</title>`) as Finding);
    expect(sentence).toContain("80 characters");
    expect(sentence).toContain("truncated to fit the device width");
    // The one thing the row must never say. Google states there is no limit,
    // so "over the limit" would be this app inventing a rule and attributing
    // it to Google.
    expect(sentence).toContain("no length limit");
    expect(sentence).not.toMatch(/over the limit|too long|should be/i);
    expect(CHECK_METHOD.B10).toContain("there's no limit on how long a title element can be");
  });
});

// --- B11: the meta description ----------------------------------------------

describe("B11, the meta description", () => {
  const inRange =
    '<meta name="description" content="A dining chair in solid oak with a natural oil ' +
    'finish, made for everyday use at a kitchen table or a desk.">';

  it("says nothing about a description inside the range", () => {
    expect(checkMetaDescription(inRange)).toBeNull();
  });

  it("reports the length when it is longer", () => {
    const text = "word ".repeat(60);
    const d = detail(checkMetaDescription(`<meta name="description" content="${text}">`));
    expect(d.side).toBe("long");
    expect(d.longerThan).toBe(DESCRIPTION_MAX_CHARS);
    expect(d.length).toBeGreaterThan(DESCRIPTION_MAX_CHARS);
  });

  it("reports an absent description as absent", () => {
    expect(detail(checkMetaDescription("<head></head>")).present).toBe(false);
  });

  it("says the snippet is truncated, never that the description is too long", () => {
    const sentence = describeFinding(
      checkMetaDescription(`<meta name="description" content="${"word ".repeat(60)}">`) as Finding,
    );
    expect(sentence).toContain("truncates the snippet to fit the device width");
    expect(sentence).not.toMatch(/too long|over the limit/i);
  });

  it("reads a description whether the tag used name or property", () => {
    expect(extractMetaContent('<meta property="description" content="x">', "description")).toBe("x");
  });
});

// --- B12: the H1s -----------------------------------------------------------

describe("B12, the H1", () => {
  it("says nothing about one H1 that is not the logo", () => {
    expect(checkH1("<h1>A chair in solid oak</h1>")).toBeNull();
  });

  it("reports no H1 at all", () => {
    const d = detail(checkH1("<h2>A chair</h2>"));
    expect(d.count).toBe(0);
    expect(describeFinding(checkH1("<h2>A chair</h2>") as Finding)).toBe(
      "This page has no H1 heading.",
    );
  });

  it("counts three H1s and reports every text", () => {
    const html = "<h1>One</h1><h1>Two</h1><h1>Three</h1>";
    const d = detail(checkH1(html));
    expect(d.count).toBe(3);
    expect(d.texts).toEqual(["One", "Two", "Three"]);
    expect(describeFinding(checkH1(html) as Finding)).toContain('"One"; "Two"; "Three"');
  });

  it("names the logo-in-H1 case even when the count is right", () => {
    const html = '<h1><a href="/"><img src="/logo.png" alt="Shop"></a></h1>';
    const d = detail(checkH1(html));
    expect(d.count).toBe(1);
    expect(d.logoInH1).toBe(true);
    expect(d.logoSignals).toEqual({ image: true, logoClass: false, linksHome: true });
    const sentence = describeFinding(checkH1(html) as Finding);
    expect(sentence).toContain("an image and a link to the home page");
    expect(sentence).toContain("gives every page the same H1");
  });

  it("reads a logo class on the heading itself as well as inside it", () => {
    expect(extractH1s('<h1 class="header__logo">Shop</h1>')[0].hasLogoClass).toBe(true);
  });
});

// --- B13 and B14: the social tags -------------------------------------------

describe("B13 and B14, the social tags", () => {
  const OG =
    '<meta property="og:title" content="A chair">' +
    '<meta property="og:image" content="https://shop.example/a.jpg">' +
    '<meta property="og:description" content="A chair.">';
  const TWITTER =
    '<meta name="twitter:card" content="summary">' +
    '<meta name="twitter:title" content="A chair">' +
    '<meta name="twitter:description" content="A chair.">' +
    '<meta name="twitter:image" content="https://shop.example/a.jpg">';

  it("says nothing when all three Open Graph properties are present", () => {
    expect(checkOpenGraph(OG)).toBeNull();
  });

  it("names exactly the absent Open Graph properties", () => {
    const d = detail(checkOpenGraph('<meta property="og:title" content="A chair">'));
    expect(d.missing).toEqual(["og:image", "og:description"]);
    expect(d.present).toEqual(["og:title"]);
    expect(describeFinding(checkOpenGraph('<meta property="og:title" content="A">') as Finding))
      .toContain("og:image, og:description");
  });

  it("treats an empty content attribute as absent", () => {
    expect(detail(checkOpenGraph(OG.replace('content="A chair"', 'content=""'))).missing).toEqual([
      "og:title",
    ]);
  });

  it("says nothing when the four Twitter tags are present, and names them when not", () => {
    expect(checkTwitterCard(TWITTER)).toBeNull();
    expect(detail(checkTwitterCard('<meta name="twitter:card" content="summary">')).missing).toEqual(
      ["twitter:title", "twitter:description", "twitter:image"],
    );
  });
});

// --- B15: alt text ----------------------------------------------------------

describe("B15, alt text on the page", () => {
  it("says nothing when every image carries an alt a person wrote", () => {
    expect(
      checkPageAltText('<img src="/a.jpg" alt="A dining chair in solid oak, from the front">'),
    ).toBeNull();
  });

  it("says nothing at all on a page with no images", () => {
    expect(checkPageAltText("<p>text</p>")).toBeNull();
  });

  it("reports count of denominator, with the three kinds counted apart", () => {
    const html =
      '<img src="/a.jpg">' +
      '<img src="/b.jpg" alt="">' +
      '<img src="/c.jpg" alt="IMG_20260527.jpg">' +
      '<img src="/d.jpg" alt="A dining chair in solid oak">';
    const d = detail(checkPageAltText(html));
    expect(d.images).toBe(4);
    expect(d.count).toBe(3);
    expect(d.noAlt).toBe(1);
    expect(d.emptyAlt).toBe(1);
    expect(d.machineAlt).toBe(1);
    expect(describeFinding(checkPageAltText(html) as Finding)).toContain("3 of 4 images");
  });

  it("uses the same heuristic looksLikeMachineAlt uses, entities included", () => {
    // The predicate the alt text writer uses to decide what it may replace.
    // Two screens disagreeing about what counts as machine output would be
    // worse than either being wrong.
    //
    // The attribute is decoded exactly once before the test is applied, and
    // that single pass is what makes the entity signal mean the same thing
    // here as it does against the Admin API. An ampersand a person typed is
    // written "&amp;" in every valid page and decodes to "&", so it does not
    // fire. A leftover entity in the stored value - the failure the writer
    // exists for - is written "&amp;#8211;" and decodes to "&#8211;", which
    // does. Testing the raw attribute would flag every alt containing an
    // ampersand on every page in existence.
    expect(checkPageAltText('<img alt="Set Masa &amp; 6 Scaune">')).toBeNull();
    expect(detail(checkPageAltText('<img alt="Set Masa &amp;#8211; 6 Scaune">')).machineAlt).toBe(1);
    expect(detail(checkPageAltText('<img alt="8f14e45f-ceea-467a-9bd2">')).machineAlt).toBe(1);
    expect(checkPageAltText('<img alt="Masa extensibila, cod 20260527, stejar natural">')).toBeNull();
  });
});

// --- B16: internal links ----------------------------------------------------

describe("B16, internal links", () => {
  function links(hrefs: string[]): string {
    return hrefs.map((h) => `<a href="${h}">x</a>`).join("");
  }

  it("takes same-origin links only, distinct, and never the page itself", () => {
    const plan = internalLinks(
      links([
        "/collections/chairs",
        "/collections/chairs",
        "/collections/chairs#top",
        "https://other.example/x",
        "mailto:a@b.c",
        "tel:+40",
        "#reviews",
        "/products/a-chair",
      ]),
      PAGE,
    );
    expect(plan.urls).toEqual(["https://shop.example/collections/chairs"]);
    expect(plan.total).toBe(1);
    expect(plan.capped).toBe(false);
  });

  it("caps at 20 links per page and says how many there were", () => {
    const hrefs = Array.from({ length: 200 }, (_, i) => `/collections/c${i}`);
    const plan = internalLinks(links(hrefs), PAGE);
    expect(plan.urls).toHaveLength(LINK_CHECK_CAP);
    expect(plan.total).toBe(200);
    expect(plan.capped).toBe(true);
  });

  it("says nothing when every checked link answered", () => {
    const results = [{ url: "https://shop.example/a", status: 200 }];
    expect(checkInternalLinks(results, { total: 1, capped: false }, 1)).toBeNull();
  });

  it("reports 20 of 200 checked when it capped, with the broken addresses", () => {
    const results = [
      { url: "https://shop.example/a", status: 404 },
      { url: "https://shop.example/b", status: 500 },
      { url: "https://shop.example/c", status: 0 },
      { url: "https://shop.example/d", status: 200 },
      { url: "https://shop.example/e", status: 301 },
    ];
    const finding = checkInternalLinks(results, { total: 200, capped: true }, 20) as Finding;
    const d = finding.detail as Record<string, any>;
    expect(d.count).toBe(3);
    expect(d.checked).toBe(20);
    expect(d.total).toBe(200);
    const sentence = describeFinding(finding);
    expect(sentence).toContain("20 of 200 links on the page were checked");
    expect(sentence).toContain("no answer");
  });

  it("says all N were checked when it did not cap", () => {
    const finding = checkInternalLinks(
      [{ url: "https://shop.example/a", status: 404 }],
      { total: 3, capped: false },
      3,
    ) as Finding;
    expect(describeFinding(finding)).toContain("All 3 internal links on the page were checked");
  });

  it("distinguishes a redirect from a failure: 301 is not broken", () => {
    expect(
      checkInternalLinks([{ url: "https://shop.example/a", status: 301 }], { total: 1, capped: false }, 1),
    ).toBeNull();
  });
});

// --- B17: word counts -------------------------------------------------------

describe("B17, the word counts", () => {
  const LONG = "<body>" + "word ".repeat(200) + "</body>";

  it("says nothing when both counts are above the two figures", () => {
    expect(checkThinContent(LONG, "word ".repeat(50), "structured data")).toBeNull();
  });

  it("reports a short description with the count and its source", () => {
    const d = detail(checkThinContent(LONG, "word ".repeat(10), "structured data"));
    expect(d.descriptionWords).toBe(10);
    expect(d.descriptionSource).toBe("structured data");
    expect(d.thinPage).toBe(false);
  });

  it("reports a page with little text, with its own count", () => {
    const d = detail(checkThinContent("<body>one two three</body>", null, null));
    expect(d.pageWords).toBe(3);
    expect(d.pageUnder).toBe(THIN_PAGE_WORDS);
    // The description could not be asked, so it is null and not zero: a null
    // is not a measurement of nothing.
    expect(d.descriptionWords).toBeNull();
    expect(d.thinDescription).toBe(false);
  });

  it("never says more words would help", () => {
    const sentence = describeFinding(
      checkThinContent(LONG, "word ".repeat(10), "structured data") as Finding,
    );
    expect(sentence).toBe("The description on this page is 10 words, read from the structured data.");
    expect(sentence).not.toMatch(/should|add|improve|longer/i);
  });

  it("counts visible words and not script or style content", () => {
    expect(
      visibleWords('<body><script>{"a":"one two three four five"}</script><p>one two</p></body>'),
    ).toBe(2);
    expect(countWords("   ")).toBe(0);
  });
});

// --- B18: the handle --------------------------------------------------------

describe("B18, the handle", () => {
  it("passes a clean handle", () => {
    expect(checkHandle("masa-extensibila-stejar")).toBeNull();
  });

  it("flags uppercase", () => {
    expect(detail(checkHandle("Masa-Extensibila")).issues).toEqual(["uppercase"]);
  });

  it("flags spaces", () => {
    expect(detail(checkHandle("masa extensibila")).issues).toEqual(["spaces"]);
  });

  it("flags non-ASCII and names the characters", () => {
    const d = detail(checkHandle("masa-extensibilă"));
    expect(d.issues).toEqual(["non-ASCII characters"]);
    expect(d.nonAscii).toEqual(["ă"]);
  });

  it("flags trailing punctuation", () => {
    expect(detail(checkHandle("masa-extensibila-")).issues).toEqual(["a trailing punctuation mark"]);
  });

  it("names every case a handle carries at once", () => {
    expect(detail(checkHandle("Masa Extensibila-")).issues).toEqual([
      "uppercase",
      "spaces",
      "a trailing punctuation mark",
    ]);
  });

  it("says nothing when there is no handle to look at", () => {
    expect(checkHandle(null)).toBeNull();
    expect(checkHandle("")).toBeNull();
  });
});

// --- B19: the redirect chain ------------------------------------------------

describe("B19, the redirect chain", () => {
  it("says nothing about a page that answered directly", () => {
    expect(checkRedirectChain([{ url: PAGE, status: 200 }])).toBeNull();
  });

  it("says nothing about one hop, which the response row already reports", () => {
    expect(
      checkRedirectChain([
        { url: `${PAGE}-old`, status: 301 },
        { url: PAGE, status: 200 },
      ]),
    ).toBeNull();
  });

  it("reports a two-hop chain with every address in it", () => {
    const chain = [
      { url: `${PAGE}-oldest`, status: 301 },
      { url: `${PAGE}-old`, status: 301 },
      { url: PAGE, status: 200 },
    ];
    const d = detail(checkRedirectChain(chain));
    expect(d.hops).toBe(2);
    expect(d.loop).toBe(false);
    expect(d.chain).toEqual(chain);
    expect(describeFinding(checkRedirectChain(chain) as Finding)).toContain(
      "answers after 2 redirects",
    );
  });

  it("reports a loop as a loop", () => {
    const chain = [
      { url: `${PAGE}-a`, status: 301 },
      { url: `${PAGE}-b`, status: 301 },
      { url: `${PAGE}-a`, status: 301 },
    ];
    const d = detail(checkRedirectChain(chain));
    expect(d.loop).toBe(true);
    expect(describeFinding(checkRedirectChain(chain) as Finding)).toContain(
      "redirects in a circle and never answers",
    );
  });
});

// --- B20: mixed content -----------------------------------------------------

describe("B20, mixed content", () => {
  it("lists http resources on an https page, by the tag that pulled them in", () => {
    const html =
      '<script src="http://cdn.example/a.js"></script>' +
      '<img src="http://cdn.example/b.jpg">' +
      '<link href="http://cdn.example/c.css" rel="stylesheet">' +
      '<img src="https://cdn.example/d.jpg">';
    const d = detail(checkMixedContent(html, PAGE));
    expect(d.count).toBe(3);
    expect(d.resources).toEqual([
      { tag: "script", url: "http://cdn.example/a.js" },
      { tag: "img", url: "http://cdn.example/b.jpg" },
      { tag: "link", url: "http://cdn.example/c.css" },
    ]);
  });

  it("is not about links: an http link to another site is not mixed content", () => {
    expect(checkMixedContent('<a href="http://supplier.example">supplier</a>', PAGE)).toBeNull();
  });

  it("says nothing on a page that is not itself https", () => {
    expect(
      checkMixedContent('<img src="http://cdn.example/b.jpg">', "http://shop.example/products/a"),
    ).toBeNull();
  });
});

// --- B21: two pages, one title ----------------------------------------------

describe("B21, a title shared with another page", () => {
  const titles = new Map<string, string[]>([
    [titleKey("A chair"), ["a-chair", "b-chair"]],
  ]);

  it("names the other handle sharing the title", () => {
    const d = detail(checkDuplicateTitle("A chair", "a-chair", titles));
    expect(d.others).toEqual(["b-chair"]);
    expect(d.sharedWith).toBe(1);
    expect(describeFinding(checkDuplicateTitle("A chair", "a-chair", titles) as Finding)).toContain(
      "is also the title of 1 other page: b-chair",
    );
  });

  it("does not report a page as a duplicate of itself", () => {
    expect(
      checkDuplicateTitle("A chair", "a-chair", new Map([[titleKey("A chair"), ["a-chair"]]])),
    ).toBeNull();
  });

  it("compares case-folded and whitespace-collapsed, so a double space is the same title", () => {
    expect(titleKey("A  Chair ")).toBe(titleKey("a chair"));
  });

  it("says nothing when there is no title, and nothing when nothing else has one", () => {
    expect(checkDuplicateTitle(null, "a-chair", titles)).toBeNull();
    expect(checkDuplicateTitle("Something else", "a-chair", titles)).toBeNull();
  });
});

// --- B22: deprecated structured data ----------------------------------------

describe("B22, structured data Google no longer shows", () => {
  it("says nothing about a page carrying only current types", () => {
    expect(checkDeprecatedNodes([{ types: ["Product"] }, { types: ["BreadcrumbList"] }])).toBeNull();
  });

  it("names FAQPage and HowTo, and counts repeats", () => {
    const d = detail(
      checkDeprecatedNodes([
        { types: ["FAQPage"] },
        { types: ["FAQPage"] },
        { types: ["HowTo"] },
        { types: ["Product"] },
      ]),
    );
    expect(d.types).toEqual([
      { type: "FAQPage", count: 2, ours: false },
      { type: "HowTo", count: 1, ours: false },
    ]);
  });

  it("says it costs nothing and earns nothing, and never says to remove it", () => {
    const sentence = describeFinding(checkDeprecatedNodes([{ types: ["FAQPage"] }]) as Finding);
    expect(sentence).toContain("costs nothing and earns nothing in Google");
    expect(sentence).not.toMatch(/remove|delete|should/i);
  });

  it("says when the node is this app's own, which it emits on purpose", () => {
    const sentence = describeFinding(
      checkDeprecatedNodes([{ types: ["FAQPage"], ours: true }]) as Finding,
    );
    expect(sentence).toContain("this app's own, emitted on purpose");
    expect(sentence).toContain("assistants still read it");
  });
});

// --- B24: the keywords tag --------------------------------------------------

describe("B24, the meta keywords tag", () => {
  it("says nothing when the page carries no keywords tag", () => {
    expect(checkMetaKeywords("<head></head>")).toBeNull();
  });

  it("counts the terms and states Google's position, with no advice about terms", () => {
    const finding = checkMetaKeywords(
      '<meta name="keywords" content="chair, oak chair, dining chair">',
    ) as Finding;
    expect((finding.detail as any).terms).toBe(3);
    const sentence = describeFinding(finding);
    expect(sentence).toContain("Google does not use that tag");
    expect(sentence).toContain("no effect on indexing");
    expect(sentence).toContain("nothing here to keep up to date");
  });
});

// --- the vocabulary the weekly diff reads -----------------------------------

describe("the vocabulary", () => {
  const NEW_CODES: FindingCode[] = [
    "B10", "B11", "B12", "B13", "B14", "B15", "B16", "B17",
    "B18", "B19", "B20", "B21", "B22", "B23", "B24",
  ];

  it("knows every code the aggregate counts, and counts every code it knows", () => {
    // The weekly diff (seo-since.ts) looks a code up in CHECK_LABEL for its
    // row and in CHECKS for its denominator. A code in one and not the other
    // renders as "a check this release does not know", or as a row counted
    // over the wrong denominator.
    const counted = CHECKS.map((c) => c.code).sort();
    const labelled = Object.keys(CHECK_LABEL).sort();
    // A6 is the one code with a denominator of its own (collections, not
    // products), so it is labelled and deliberately not in CHECKS.
    expect(labelled.filter((code) => code !== "A6")).toEqual(counted);
  });

  it("carries all fifteen new codes in both", () => {
    for (const code of NEW_CODES) {
      expect(CHECK_LABEL[code]).toBeTruthy();
      expect(CHECKS.find((c) => c.code === code)).toBeTruthy();
    }
  });

  it("counts every new check over the pages read, never over the catalogue", () => {
    // All fifteen are read off the page. Counting one over the catalogue would
    // put its numerator outside its denominator on any store part-way through
    // its first page pass.
    for (const code of NEW_CODES) {
      const check = CHECKS.find((c) => c.code === code);
      expect(check?.source).toBe("B");
      expect(check?.basis).toBe("pagesRead");
    }
  });

  it("says none of the words this product does not say", () => {
    // PRD-SEO-FULL-ONPAGE section 5: no new string on any screen contains
    // "rank", "score", "boost" or "optimise", and "keyword" appears only as
    // the name of the tag B24 reads, never as advice.
    const strings: string[] = [];
    for (const code of NEW_CODES) {
      strings.push(CHECK_LABEL[code]);
      const method = CHECK_METHOD[code];
      if (method) strings.push(method);
    }
    for (const text of strings) {
      expect(text).not.toMatch(/\brank/i);
      expect(text).not.toMatch(/\bscore/i);
      expect(text).not.toMatch(/\bboost/i);
      expect(text).not.toMatch(/optimi[sz]/i);
    }
    // "keywords" appears once, as the name of the tag, and nowhere else.
    const withKeyword = strings.filter((text) => /keyword/i.test(text));
    expect(withKeyword).toEqual([CHECK_LABEL.B24, CHECK_METHOD.B24]);
  });
});
