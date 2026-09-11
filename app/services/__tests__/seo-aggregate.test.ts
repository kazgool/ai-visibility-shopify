// The aggregate behind every per-product SEO screen (PRD-SEO-PER-PRODUCT
// section 4 and section 5's screen rows).
//
// Tested against the function and never against a component, because the
// acceptance criterion is about four shapes of store and a component test
// would only ever prove that one of them renders. The four shapes, each of
// which has broken a screen somewhere in this app before:
//
//   1. A 50-product fixture, part-way through its first source B pass.
//   2. A 20,000-product store, where 500 pages a night means the screen has
//      to read correctly for 39 more nights and the denominators are the only
//      thing keeping it honest.
//   3. An empty store, where every count is zero and no sentence may divide
//      by it.
//   4. A store where source B has never run, which is the state every shop is
//      in the day the key is turned on - and the one where a count of zero
//      would be a lie about what was never looked at.
//
// The pure module has no database and no .env, so nothing here is mocked.

import { describe, expect, it } from "vitest";
import {
  CHECKS,
  aggregateFindings,
  buildFindingsAggregate,
  createFindingsCounters,
  foldFindingsRow,
  cleanSentence,
  describeFinding,
  findingsForProduct,
  pageStateOf,
  pagesReadSentence,
  nightlyPassMoved,
  themeNodeAggregate,
  themeNodeAdvice,
  themeNodeSentence,
  type ScanRowLike,
} from "../seo-aggregate";
import type { Finding } from "../seo-scan";

// --- builders --------------------------------------------------------------

const BULK = new Date("2026-09-03T02:00:00Z");
const SCAN = new Date("2026-09-03T03:45:00Z");
/** A screen opened the morning after SCAN: the pass moved 20 hours ago. */
const NEXT_MORNING = new Date("2026-09-03T23:45:00Z");
/** A screen opened a week after SCAN: nothing has moved. */
const A_WEEK_LATER = new Date("2026-09-10T03:45:00Z");

function f(code: string, source: "A" | "B" | "A+B", detail: Record<string, unknown> = {}): Finding {
  return { code, source, detail } as Finding;
}

const THEME_NODE = { types: ["Product"], id: "https://shop.example/products/a#product-theme" };
// Ours by the marker, not by the suffix: a theme is free to end its @id in
// "#product" and Horizon does (4 September 2026).
const OUR_NODE = { types: ["Product"], id: "https://shop.example/products/a#product", ours: true };

function row(i: number, over: Partial<ScanRowLike> = {}): ScanRowLike {
  return {
    productId: `gid://shopify/Product/${i}`,
    handle: `p-${i}`,
    bulkAt: BULK,
    scannedAt: null,
    status: null,
    findings: [],
    nodes: null,
    ...over,
  };
}

/** Shape 1: 50 products, source A on all of them, 20 pages read so far. */
// Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: A1 and B2 are hidden, so the fixture carries A5 (catalogue, merchant) and B10 (page, merchant) in their place, same counts.
function fixture50(): ScanRowLike[] {
  return Array.from({ length: 50 }, (_, i) => {
    const scanned = i < 20;
    const findings: Finding[] = [];
    // 30 of the 50 have no meta description; 6 share a meta title.
    if (i < 30) findings.push(f("A5", "A", { missing: ["description"] }));
    if (i < 6) findings.push(f("A3", "A", { fields: [{ field: "title", sharedWith: 5 }] }));
    // Of the 20 pages read, 4 have no title tag.
    if (scanned && i < 4) findings.push(f("B10", "B", { present: false }));
    return row(i, {
      scannedAt: scanned ? SCAN : null,
      status: scanned ? "ok" : null,
      findings,
      nodes: scanned ? [THEME_NODE] : null,
    });
  });
}

/** Shape 2: 20,000 products, one night of scanning done (500 pages). */
function store20k(): ScanRowLike[] {
  return Array.from({ length: 20000 }, (_, i) => {
    const scanned = i < 500;
    const findings: Finding[] = [];
    if (i % 2 === 0) findings.push(f("A5", "A", { missing: ["description"] }));
    if (scanned && i < 100) findings.push(f("B4", "B", { signals: {} }));
    return row(i, {
      scannedAt: scanned ? SCAN : null,
      status: scanned ? "ok" : null,
      findings,
      nodes: scanned ? [THEME_NODE] : null,
    });
  });
}

/** Shape 4: source A has run over the whole catalogue, source B never. */
// Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: A1 is hidden, so the seven catalogue findings are A5 (catalogue, merchant).
function neverScanned(n = 50): ScanRowLike[] {
  return Array.from({ length: n }, (_, i) =>
    row(i, { findings: i < 7 ? [f("A5", "A", { missing: ["title"] })] : [] }),
  );
}

// --- shape 1: the 50-product fixture ---------------------------------------

describe("a 50-product fixture, part-way through its first page pass", () => {
  const aggregate = aggregateFindings(fixture50());

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the two denominators are asserted on A5 and B10, which replaced the hidden A1 and B2 in the fixture.
  it("counts every A check against the catalogue and every B check against the pages read", () => {
    expect(aggregate.products).toBe(50);
    expect(aggregate.bulkRead).toBe(50);
    expect(aggregate.pagesRead).toBe(20);

    const a5 = aggregate.rows.find((r) => r.code === "A5")!;
    expect(a5).toMatchObject({ count: 30, denominator: 50, state: "found" });

    const b10 = aggregate.rows.find((r) => r.code === "B10")!;
    expect(b10).toMatchObject({ count: 4, denominator: 20, state: "found" });
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the found rows are A5, A3 and B10, which replaced the hidden A1 and B2 in the fixture, same counts.
  it("orders rows by the count this store actually has, nothing hard-coded", () => {
    const found = aggregate.rows.filter((r) => r.state === "found").map((r) => r.code);
    expect(found).toEqual(["A5", "A3", "B10"]);
    expect(aggregate.rows.filter((r) => r.state === "found").map((r) => r.count)).toEqual([
      30, 6, 4,
    ]);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: only visible checks have a row, so the clean list is the visible codes that ran and found nothing, 7 over the pages read and 1 (B6) over the catalogue.
  it("collapses the checks that ran and found nothing, with their own denominators", () => {
    // Every check that ran and found nothing. A2 needs the page as well as
    // the catalogue, so it is counted over the 20 pages read, not over 50 -
    // this is the grouping the sentence exists for.
    // B6 joined the list on 4 September 2026 and is counted over the catalogue,
    // because source A computes it from the read it already has.
    // A7, B8 and B9 joined on 5 September (PRD-SEO-FULL-ONPAGE section 2). All
    // three are counted over the pages read: A7 needs a fetch of the sitemap,
    // and both B checks need the page itself.
    // B10 to B24 joined on 4 September (sections 3 and 5a), all fifteen read
    // off the page and so all fifteen over the 20 pages read.
    // A12, A13, A15 and A16 joined on 4 September (section 5b), all four over
    // the catalogue, so the catalogue group grows from three to seven.
    // B25, B26 and B31 joined the same day with the page half of 5b, over the
    // pages read; B28 joined the catalogue group, because it is computed from
    // the menu tree with no page fetched. B29 and B32 are deliberately absent
    // from this list and from every count in it: they state no verdict, so
    // they are never clean and never found (state "counted"), and folding them
    // into "found nothing" would be inventing the verdict their whole design
    // refuses to state. B30 is absent because its denominator is the blog
    // posts a pass read, which is neither of these two.
    // Since addendum item 9 (11 September 2026) a check no merchant sees has
    // no row at all, so the list is the visible checks only: B6 over the
    // catalogue, and seven over the pages read. B34 is counted, never clean.
    expect(aggregate.clean.map((r) => r.code)).toEqual([
      "B1", "B11", "B15", "B22", "B33", "B4", "B6", "B7",
    ]);
    // B33 joined on 10 September: the theme emits a Product node with no @id
    // of its own, so the storefront block holds its own back rather than
    // publish a second product. It states a verdict, so unlike B29 and B32 it
    // belongs in this list, and its denominator is the pages read, which is
    // why the first group grows and not the catalogue one.
    expect(cleanSentence(aggregate)).toBe(
      "7 checks found nothing on 20 products; 1 check found nothing on 50 products.",
    );
  });

  it("states the pages-read sentence with the shop's own budget, while the pass moves", () => {
    expect(aggregate.lastPageAttemptAt).toBe("2026-09-03T03:45:00.000Z");
    expect(pagesReadSentence(aggregate, 500, null, "operator", NEXT_MORNING)).toBe(
      "20 of 50 pages read; the rest by tomorrow night.",
    );
    expect(pagesReadSentence(aggregate, 10, null, "operator", NEXT_MORNING)).toBe(
      "20 of 50 pages read; the rest over the next 3 nights.",
    );
  });

  it("stops promising the next nights when nothing has moved for 36 hours", () => {
    // Option C, 5 September 2026: the promise is kept only while the nightly
    // pass has moved on this shop recently; otherwise the date and the fact.
    expect(pagesReadSentence(aggregate, 500, null, "operator", A_WEEK_LATER)).toBe(
      "20 of 50 pages read; the rest is waiting: last page attempted 2026-09-03, nothing has moved since.",
    );
    expect(pagesReadSentence(aggregate, 500, null, "merchant", A_WEEK_LATER)).toBe(
      "20 of 50 pages read; the rest is waiting: the last page was opened on 3 September 2026 and nothing has moved since.",
    );
    expect(pagesReadSentence(aggregate, 500, null, "merchant", A_WEEK_LATER)).not.toContain("tomorrow");
  });

  it("draws the line at exactly 36 hours, boundary included", () => {
    const boundary = new Date(SCAN.getTime() + 36 * 3600 * 1000);
    expect(nightlyPassMoved(aggregate.lastPageAttemptAt, boundary)).toBe(true);
    expect(pagesReadSentence(aggregate, 500, null, "operator", boundary)).toContain("by tomorrow night");
    const past = new Date(boundary.getTime() + 1);
    expect(nightlyPassMoved(aggregate.lastPageAttemptAt, past)).toBe(false);
    expect(pagesReadSentence(aggregate, 500, null, "operator", past)).toContain("nothing has moved since");
    // A clock ahead of the scan table is still "moved"; no attempt never is.
    expect(nightlyPassMoved(aggregate.lastPageAttemptAt, new Date(SCAN.getTime() - 1000))).toBe(true);
    expect(nightlyPassMoved(null, boundary)).toBe(false);
  });

  it("counts an attempt that did not answer as movement, and takes the latest", () => {
    const later = new Date("2026-09-08T03:45:00Z");
    const mixed = aggregateFindings([
      row(0, { scannedAt: SCAN, status: "ok" }),
      row(1, { scannedAt: later, status: "password" }),
      row(2),
    ]);
    expect(mixed.lastPageAttemptAt).toBe("2026-09-08T03:45:00.000Z");
    expect(nightlyPassMoved(mixed.lastPageAttemptAt, new Date("2026-09-09T00:00:00Z"))).toBe(true);
  });
});

// --- shape 2: 20,000 products ----------------------------------------------

describe("a 20,000-product store, one night in", () => {
  const aggregate = aggregateFindings(store20k());

  it("never lets a B count borrow the catalogue's denominator", () => {
    expect(aggregate.products).toBe(20000);
    expect(aggregate.pagesRead).toBe(500);
    expect(aggregate.rows.find((r) => r.code === "A5")).toMatchObject({
      count: 10000,
      denominator: 20000,
    });
    expect(aggregate.rows.find((r) => r.code === "B4")).toMatchObject({
      count: 100,
      denominator: 500,
    });
  });

  it("says how many nights the rest takes rather than implying it is done", () => {
    expect(pagesReadSentence(aggregate, 500, null, "operator", NEXT_MORNING)).toBe(
      "500 of 20000 pages read; the rest over the next 39 nights.",
    );
  });

  it("puts the largest real problem first without knowing what it is in advance", () => {
    expect(aggregate.rows[0].code).toBe("A5");
  });
});

// --- shape 3: an empty store ------------------------------------------------

describe("an empty store", () => {
  const aggregate = aggregateFindings([]);

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: only the 12 CHECKS a merchant can see have a row (A3, A5, B1, B4, B6, B7, B10, B11, B15, B22, B33, B34), not all of CHECKS.
  it("reads every check as not yet read, never as a clean zero", () => {
    expect(aggregate.products).toBe(0);
    expect(aggregate.clean).toEqual([]);
    expect(aggregate.rows).toHaveLength(12);
    expect(aggregate.rows.every((r) => r.state === "notYetRead")).toBe(true);
    expect(cleanSentence(aggregate)).toBeNull();
  });

  // The first of the three states the sentence must never conflate: nothing to
  // scan because the catalogue was never read. It names the catalogue pass, and
  // it does not print a count, because a screen of zeros reads as finished.
  it("says the catalogue has not been read, and names what to do", () => {
    const sentence = pagesReadSentence(aggregate, 500);
    expect(sentence).toContain("No products have been read into this table yet");
    expect(sentence).toContain("Fill catalogue");
    expect(sentence).not.toContain("0 of 0");
    expect(pagesReadSentence(aggregate, 0)).toContain("Fill catalogue");
  });

  it("has no structured-data verdict at all", () => {
    const nodes = themeNodeAggregate([]);
    expect(nodes.verdict).toBe("unknown");
    expect(themeNodeSentence(nodes)).toContain("No product page has been read yet");
    expect(themeNodeAdvice(nodes)).toContain("Leave the app embed as it is");
  });
});

// --- shape 4: source B has never run ---------------------------------------

describe("a store where source B has never run", () => {
  const aggregate = aggregateFindings(neverScanned());

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the found A check is A5 (replacing hidden A1), and the page checks asserted are every visible page-basis check, since A2, B2, B3 and B5 are hidden and have no row.
  it("answers every A check and refuses to answer any B check", () => {
    expect(aggregate.pagesAttempted).toBe(0);
    expect(aggregate.neverScanned).toBe(50);

    const a5 = aggregate.rows.find((r) => r.code === "A5")!;
    expect(a5).toMatchObject({ count: 7, denominator: 50, state: "found" });

    for (const code of ["B1", "B4", "B7", "B10", "B11", "B15", "B22", "B33", "B34"]) {
      const check = aggregate.rows.find((r) => r.code === code)!;
      expect(check.state).toBe("notYetRead");
      expect(check.denominator).toBe(0);
      expect(check.notRead).toBe(50);
    }
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: of the visible catalogue checks, A5 found something and A3 and B6 found nothing; B6 still shows a B-numbered check answered over the catalogue (B28 is hidden).
  it("collapses only the A checks that ran, and says 50 rather than 0", () => {
    // B6 is in the catalogue group and not the page group: it is a B-numbered
    // check that source A computes, so a store where source B has never run
    // still has an answer for it. That is the whole reason CHECKS carries a
    // basis separately from a source.
    expect(aggregate.clean.map((r) => r.code)).toEqual(["A3", "B6"]);
    expect(cleanSentence(aggregate)).toBe("2 checks found nothing on 50 products.");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: the one found row is A5, which replaced the hidden A1 in the fixture.
  it("puts the not-yet-read rows after the ones that found something", () => {
    expect(aggregate.rows[0].code).toBe("A5");
    expect(aggregate.rows.slice(1).every((r) => r.state === "notYetRead")).toBe(true);
  });

  it("says no pages have been read and how long the catalogue will take, without promising tonight", () => {
    expect(aggregate.lastPageAttemptAt).toBeNull();
    expect(pagesReadSentence(aggregate, 500)).toBe(
      "No product pages have been read yet, out of 50. The nightly pass reads up to 500 a night and has not run for this shop yet.",
    );
    expect(pagesReadSentence(aggregate, 10)).toBe(
      "No product pages have been read yet, out of 50. The nightly pass reads up to 10 a night and has not run for this shop yet; this catalogue takes 5 nights once it does.",
    );
  });
});

// --- a store behind the password form --------------------------------------

describe("a store whose pages answered with the password form", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row(i, { scannedAt: SCAN, status: "password", findings: [f("A1", "A", { missing: ["sku"] })] }),
  );
  const aggregate = aggregateFindings(rows);

  it("has attempted every page and read none of them", () => {
    expect(aggregate.pagesAttempted).toBe(12);
    expect(aggregate.pagesRead).toBe(0);
    expect(aggregate.couldNotBeRead).toBe(12);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B2, B3 and B5 are hidden and have no row, so every visible page check is asserted instead, and B5 is asserted absent.
  it("says not yet read for every page check, never 'no Product node'", () => {
    for (const code of ["B1", "B4", "B7", "B10", "B11", "B15", "B22", "B33", "B34"]) {
      expect(aggregate.rows.find((r) => r.code === code)!.state).toBe("notYetRead");
    }
    expect([...aggregate.rows, ...aggregate.clean].find((r) => r.code === "B5")).toBeUndefined();
  });

  // The pages-read sentence used to count attempted pages as read, so this
  // store's card said "12 of 12 pages read." four lines above "12 of the 12
  // pages fetched could not be read" - the card contradicting itself
  // (QA, 3 September 2026).
  it("never claims a page was read that answered with the password form", () => {
    const sentence = pagesReadSentence(aggregate, 500);
    expect(sentence).toContain("0 of 12 pages read");
    expect(sentence).toContain("12 more could not be read");
  });

  it("refuses to recommend Full mode from pages nobody could read", () => {
    const nodes = themeNodeAggregate(rows);
    expect(nodes.pagesRead).toBe(0);
    expect(nodes.verdict).toBe("unknown");
  });
});

// --- the Structured data verdict -------------------------------------------

describe("the B1 aggregate behind the Structured data card", () => {
  // The writer stores the nodes and the B1 finding together, and B1 fires
  // exactly when the page did not carry one Product node. These fixtures
  // carry both, because a row with two nodes and no B1 finding is a row the
  // writer cannot produce - and the aggregate now takes the count from the
  // finding rather than re-deriving it from the raw @id strings, which is
  // what let the two cards disagree (QA, 3 September 2026).
  const b1 = (productNodes: number) => f("B1", "B", { productNodes });

  it("recommends Extend when any scanned page has a theme node", () => {
    const rows = [
      row(1, { scannedAt: SCAN, status: "ok", nodes: [THEME_NODE] }),
      row(2, { scannedAt: SCAN, status: "ok", nodes: [], findings: [b1(0)] }),
      row(3, { scannedAt: SCAN, status: "ok", nodes: [], findings: [b1(0)] }),
    ];
    const nodes = themeNodeAggregate(rows);
    expect(nodes).toMatchObject({ pagesRead: 3, theme: 1, none: 2, two: 0, verdict: "extend" });
    expect(themeNodeSentence(nodes)).toBe(
      "Product node from the theme on 1 of 3 pages read; none on 2.",
    );
  });

  it("recommends Full only when no scanned page has one, and says how many", () => {
    const rows = [
      row(1, { scannedAt: SCAN, status: "ok", nodes: [], findings: [b1(0)] }),
      row(2, { scannedAt: SCAN, status: "ok", nodes: [OUR_NODE] }),
      // Never scanned, so it is not part of the verdict either way.
      row(3),
    ];
    const nodes = themeNodeAggregate(rows);
    expect(nodes).toMatchObject({ pagesRead: 2, theme: 0, appOnly: 1, verdict: "full" });
    expect(themeNodeAdvice(nodes)).toContain("any of the 2 pages read");
  });

  it("reads extend mode's shared @id as one node and not as two", () => {
    const shared = { types: ["Product"], id: "https://shop.example/products/a#product" };
    const nodes = themeNodeAggregate([
      row(1, { scannedAt: SCAN, status: "ok", nodes: [shared, { ...shared }] }),
    ]);
    expect(nodes.two).toBe(0);
    expect(nodes.none).toBe(0);
  });

  it("counts two genuinely different Product nodes on one page", () => {
    const nodes = themeNodeAggregate([
      row(1, { scannedAt: SCAN, status: "ok", nodes: [THEME_NODE, OUR_NODE], findings: [b1(2)] }),
    ]);
    expect(nodes).toMatchObject({ two: 1, theme: 1, verdict: "extend" });
  });

  // The defect this rule exists for. The page reader merges two @ids that
  // resolve to the same address, so it stored one node and raised no B1. The
  // aggregate used to re-derive the count from the raw strings, see two, and
  // put "two or more Product nodes" on the Structured data card while the
  // Findings card showed B1 clean - the two screens disagreeing about one
  // page, which is the promise build step 4 was written to keep.
  it("does not re-derive a second node from a relative @id the page reader merged", () => {
    const nodes = themeNodeAggregate([
      row(1, {
        scannedAt: SCAN,
        status: "ok",
        nodes: [
          { types: ["Product"], id: "/products/a#shopify-product" },
          { types: ["Product"], id: "https://shop.example/products/a#shopify-product" },
        ],
        findings: [],
      }),
    ]);
    expect(nodes.two).toBe(0);
    expect(nodes.none).toBe(0);
    expect(nodes.theme).toBe(1);
  });
});

// --- B5, whose denominator is the one that is not pagesRead ----------------

describe("B5 over pages that did not answer", () => {
  // B5 is the check about pages that did not answer as a crawler would see
  // them, and its denominator used to be pagesRead - which subtracts from it
  // exactly the pages it fires on. A store where two of five products
  // answered 404 read "2 of 3": a numerator outside its own denominator
  // (QA, 3 September 2026).
  const b5 = f("B5", "B", { reason: "status", status: 404 });
  const aggregate = aggregateFindings([
    row(1, { scannedAt: SCAN, status: "404", findings: [b5] }),
    row(2, { scannedAt: SCAN, status: "404", findings: [b5] }),
    row(3, { scannedAt: SCAN, status: "ok", findings: [] }),
    row(4, { scannedAt: SCAN, status: "ok", findings: [] }),
    row(5, { scannedAt: SCAN, status: "ok", findings: [] }),
  ]);

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B5 is hidden and is the only pagesTried check, so no visible row can show this denominator; B5 now has no row and counts nothing, while the page counters still see both failures.
  it("counts the failures inside a denominator that contains them", () => {
    expect([...aggregate.rows, ...aggregate.clean].find((r) => r.code === "B5")).toBeUndefined();
    expect(aggregate.rows.filter((r) => r.state === "found")).toEqual([]);
    expect(aggregate.pagesAttempted).toBe(5);
    expect(aggregate.couldNotBeRead).toBe(2);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B2 and B3 are hidden, so every visible page-basis check is asserted over the 3 pages that answered.
  it("keeps every other page check on the pages that answered", () => {
    for (const code of ["B1", "B4", "B7", "B10", "B11", "B15", "B22", "B33", "B34"]) {
      const check = [...aggregate.rows, ...aggregate.clean].find((r) => r.code === code)!;
      expect(check.denominator).toBe(3);
    }
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B5 is hidden, so a store where every page failed has no B5 row and no found row; the failures are still in the page counters.
  it("still reports a finding on a store where every page failed", () => {
    const all404 = aggregateFindings(
      Array.from({ length: 4 }, (_, i) =>
        row(i, { scannedAt: SCAN, status: "500", findings: [b5] }),
      ),
    );
    expect([...all404.rows, ...all404.clean].find((r) => r.code === "B5")).toBeUndefined();
    expect(all404.rows.filter((r) => r.state === "found")).toEqual([]);
    expect(all404.pagesAttempted).toBe(4);
    expect(all404.couldNotBeRead).toBe(4);
  });
});

// --- robots.txt turned the scan away ---------------------------------------

describe("the pages-read sentence on a shop robots.txt blocks", () => {
  const aggregate = aggregateFindings(
    Array.from({ length: 20 }, (_, i) => row(i, { bulkAt: BULK })),
  );

  it("says why nothing is read, instead of promising a night that fetches nothing", () => {
    const sentence = pagesReadSentence(aggregate, 500, "/products/");
    expect(sentence).toContain("robots.txt disallows /products/");
    expect(sentence).not.toContain("starting tonight");
  });

  it("says the pass has not run yet as soon as robots.txt stops blocking, and promises nothing", () => {
    const sentence = pagesReadSentence(aggregate, 500, null);
    expect(sentence).toContain("has not run for this shop yet");
    expect(sentence).not.toContain("tonight");
  });
});

// --- the Products list column ----------------------------------------------

describe("the Page column's four states", () => {
  it("is grey for a product with no row at all and for one never scanned", () => {
    expect(pageStateOf(null)).toBe("unread");
    expect(pageStateOf(row(1))).toBe("unread");
  });

  it("is green only when the page was read and the page half found nothing", () => {
    expect(
      pageStateOf(row(1, { scannedAt: SCAN, status: "ok", findings: [f("A1", "A")] })),
    ).toBe("clean");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B3 is hidden, so the page finding is B10 (page, merchant); A2 is hidden too, so a page carrying only A2 now reads clean.
  it("is amber when the page read found something", () => {
    expect(
      pageStateOf(row(1, { scannedAt: SCAN, status: "ok", findings: [f("B10", "B", { present: false })] })),
    ).toBe("findings");
    // A2 is computed from the page as well, but no merchant sees it, so it
    // colours nothing.
    expect(
      pageStateOf(row(1, { scannedAt: SCAN, status: "ok", findings: [f("A2", "A+B", {})] })),
    ).toBe("clean");
  });

  it("has its own state for a page that could not be read", () => {
    expect(pageStateOf(row(1, { scannedAt: SCAN, status: "password", findings: [] }))).toBe(
      "unreadable",
    );
    expect(pageStateOf(row(1, { scannedAt: SCAN, status: "404", findings: [] }))).toBe(
      "unreadable",
    );
  });
});

// --- the editor's section ---------------------------------------------------

describe("one product's findings, for the editor", () => {
  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: A1 and B3 are hidden, so the row carries A3 (catalogue) and B10 (page) in their place.
  it("puts the page half first and keeps the catalogue half", () => {
    const r = row(1, {
      scannedAt: SCAN,
      status: "ok",
      findings: [f("A3", "A"), f("B10", "B", { present: false }), f("A5", "A", { missing: ["title"] })],
    });
    expect(findingsForProduct(r).map((x) => x.code)).toEqual(["B10", "A3", "A5"]);
  });

  it("is empty for a product with no row", () => {
    expect(findingsForProduct(null)).toEqual([]);
  });

  it("describes a finding from what the row recorded and never invents a cause", () => {
    expect(describeFinding(f("A1", "A", { missing: ["barcode", "vendor"] }))).toBe(
      "Absent on this product: barcode, vendor.",
    );
    expect(describeFinding(f("A1", "A", { missing: ["vendor"], notRead: ["sku"] }))).toContain(
      "Not checked on this pass: sku.",
    );
    expect(
      describeFinding(f("A2", "A+B", { mismatch: "availability", pageSays: "InStock", everyVariantSoldOut: true })),
    ).toBe("The page says InStock while every variant is sold out.");
    expect(describeFinding(f("B5", "B", { reason: "robots", disallow: "/products/" }))).toBe(
      "robots.txt disallows /products/, so this page was never fetched.",
    );
    expect(describeFinding(f("B1", "B", { productNodes: 0, emitters: [] }))).toBe(
      "No Product node on this page at all.",
    );
    // An unrecognised shape falls back to the check's label, not to raw JSON.
    expect(describeFinding(f("B5", "B", {}))).toBe(
      "The page could not be read as a crawler would read it",
    );
  });
});

// --- a finding recorded twice on one product -------------------------------

describe("counting", () => {
  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: A1 is hidden and has no row, so the product carries A5 twice instead.
  it("counts a product once per code however many findings carry it", () => {
    const aggregate = aggregateFindings([
      row(1, { findings: [f("A5", "A", { missing: ["title"] }), f("A5", "A", { missing: ["description"] })] }),
    ]);
    expect(aggregate.rows.find((r) => r.code === "A5")!.count).toBe(1);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: A1 is hidden and has no clean row, so the catalogue check asserted clean is A5.
  it("survives a findings column that is not an array", () => {
    const aggregate = aggregateFindings([row(1, { findings: "not json" }), row(2, { findings: null })]);
    expect(aggregate.products).toBe(2);
    // A5 ran over both rows and found nothing, so it is clean, not a row.
    expect(aggregate.clean.find((r) => r.code === "A5")).toMatchObject({
      count: 0,
      denominator: 2,
    });
  });

  // B6 was deferred through steps 3 and 5 and built on 4 September 2026. It is
  // computed in source A's pass, so its basis is the catalogue and not the
  // pages read - a deviation from PRD section 2.1, recorded there.
  it("has a row for B6, counted over the catalogue", () => {
    const b6 = CHECKS.find((c) => (c.code as string) === "B6");
    expect(b6).toBeDefined();
    expect(b6!.source).toBe("A");
    expect(b6!.basis).toBe("catalogue");
  });
});

// --- B9's applicability (PRD-SEO-FULL-ONPAGE section 2) --------------------
//
// The fifth shape, and the one the four above could not express: a check that
// does not apply to this shop at all. B9 asks about hreflang, and a shop with
// one market has none to declare. Without a state of its own that reads as
// "clean" - a claim that a check ran and passed.

describe("B9 on a shop with one market", () => {
  function counters(rows: ScanRowLike[]) {
    const c = createFindingsCounters();
    for (const r of rows) foldFindingsRow(c, r);
    return c;
  }

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B9 is hidden and is the only check that can be not applicable, so the state can only be asserted absent: no B9 row, no not-applicable row, and one market changes nothing.
  it("reads not applicable, and is never counted as clean", () => {
    const aggregate = buildFindingsAggregate(counters(fixture50()), { markets: 1 });

    expect([...aggregate.rows, ...aggregate.clean].find((r) => r.code === "B9")).toBeUndefined();
    expect(aggregate.rows.filter((r) => r.state === "notApplicable")).toEqual([]);
    expect(aggregate.clean.map((r) => r.code)).not.toContain("B9");
    // The clean sentence counts the checks that ran and found nothing. A check
    // that never applied is not one of them.
    expect(cleanSentence(aggregate)).not.toContain("B9");
    // With B9 on no surface, the number of markets moves nothing at all.
    expect(aggregate).toEqual(buildFindingsAggregate(counters(fixture50()), { markets: 2 }));
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B9 is hidden, so a two-market shop has no B9 row either, clean or otherwise.
  it("stays a normal check on a two-market shop", () => {
    const aggregate = buildFindingsAggregate(counters(fixture50()), { markets: 2 });
    expect([...aggregate.rows, ...aggregate.clean].find((r) => r.code === "B9")).toBeUndefined();
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: B9 is hidden, so an unread markets fact leaves no B9 row either; it is not excused into another state, it is simply not shown.
  it("stays a normal check when the markets read could not be made", () => {
    // Null is "not established", which is not "does not apply". A shop whose
    // plan or scope hides `markets` must not have B9 quietly excused.
    const aggregate = buildFindingsAggregate(counters(fixture50()), { markets: null });
    expect([...aggregate.rows, ...aggregate.clean].find((r) => r.code === "B9")).toBeUndefined();
    expect(aggregate.rows.filter((r) => r.state === "notApplicable")).toEqual([]);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-3 addendum item 9: A7 is hidden and no visible A-numbered check has a page basis, so A7 has no row while CHECKS still records it over the pages read.
  it("keeps A7 counted over the pages read, never over the catalogue", () => {
    // A7 is computed in source B's pass from a fetch, so its denominator is
    // the pages that answered - the same rule every B check follows.
    const aggregate = buildFindingsAggregate(counters(fixture50()), {});
    expect([...aggregate.rows, ...aggregate.clean].find((r) => r.code === "A7")).toBeUndefined();
    expect(CHECKS.find((c) => c.code === "A7")).toEqual({ code: "A7", source: "B", basis: "pagesRead" });
  });

  it("has no A6 row at all, because A6 counts collections", () => {
    // Its denominator is collections, and this aggregate counts product rows.
    // The SEO screen renders A6 from the collections check's own report.
    const aggregate = buildFindingsAggregate(counters(fixture50()), {});
    expect([...aggregate.rows, ...aggregate.clean].map((r) => r.code)).not.toContain("A6");
    expect(CHECKS.map((c) => c.code)).not.toContain("A6");
  });
});

describe("the pages-read sentence for the merchant (R2-19, R2-20)", () => {
  function rows(n: number): ScanRowLike[] {
    const out: ScanRowLike[] = [];
    for (let i = 0; i < n; i += 1) out.push(row(i));
    return out;
  }

  it("keeps the operator's wording by default and gives the merchant plain words", () => {
    const empty = aggregateFindings([]);
    expect(pagesReadSentence(empty, 500)).toContain("Fill catalogue");
    const merchant = pagesReadSentence(empty, 500, null, "merchant");
    expect(merchant).not.toContain("Fill catalogue");
    expect(merchant).not.toContain("this table");
    expect(merchant).toContain("No product has been read from your catalogue yet");
  });

  it("names the shop's own settings and where to look, never the file", () => {
    const blocked = aggregateFindings(rows(3));
    expect(pagesReadSentence(blocked, 500, "GPTBot")).toContain("robots.txt");
    const merchant = pagesReadSentence(blocked, 500, "GPTBot", "merchant");
    expect(merchant).toContain("Your shop's own settings turn GPTBot away");
    expect(merchant).toContain("Online Store, Themes");
    expect(merchant).not.toMatch(/robots|liquid|below/);
  });

  it("separates thousands for the merchant only", () => {
    const big: ScanRowLike[] = [];
    for (let i = 0; i < 20000; i += 1) {
      big.push(i < 500 ? row(i, { scannedAt: BULK, status: "ok" }) : row(i));
    }
    const aggregate = aggregateFindings(big);
    expect(pagesReadSentence(aggregate, 500)).toContain("500 of 20000 pages read");
    expect(pagesReadSentence(aggregate, 500, null, "merchant")).toContain("500 of 20,000 pages read");
  });
});
