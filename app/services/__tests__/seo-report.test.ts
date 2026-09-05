import { describe, it, expect } from "vitest";

// The printable report and the four exports (PRD-SEO-FULL-ONPAGE section 4.3).
//
// The five stores of section 4.2 are built here as literals, the same five the
// screen's own test renders: a 50-product fixture, a 189-product shop, a
// 20,000-product store, an empty store, and a store whose pages were never
// read. The acceptance table in the PRD says what each file holds on each of
// them, and these are the assertions behind that table.
//
// The rule that matters most in a file a merchant opens in Excel: a check that
// could not run is a sentence and never a zero. An empty file with only its
// headings is a correct answer; a file with a fabricated zero row is not.

import { aggregateFindings, themeNodeAggregate, type ScanRowLike } from "../seo-aggregate";
import { readinessOf } from "../seo-readiness";
import { FINDING_OWNER } from "../seo-findings";
import { csvCell, csvRows } from "../report-metrics";
import { ownerSinceCsv, type FactsRow } from "../seo-since";
import {
  dashboardDerived,
  exportFilename,
  findingsCsv,
  isExportTable,
  keyFigures,
  listingCsv,
  productFindingsCsv,
  reportHeading,
  shopWideCsv,
  stripSentence,
  EXPORT_TABLES,
  type DashboardSource,
} from "../seo-report";

const DAY = "2026-09-04T03:45:00.000Z";
const NOW = new Date("2026-09-05T09:00:00.000Z");

function row(
  id: number,
  codes: string[],
  options: { page?: boolean; status?: string } = {},
): ScanRowLike {
  const page = options.page ?? true;
  return {
    productId: `gid://shopify/Product/${id}`,
    handle: `p-${id}`,
    bulkAt: DAY,
    scannedAt: page ? DAY : null,
    status: page ? (options.status ?? "ok") : null,
    findings: codes.map((code) => ({
      code,
      source: code.startsWith("A") ? "A" : "B",
      detail: {},
    })),
    nodes: [],
  };
}

function facts(over: Partial<FactsRow> = {}): FactsRow {
  return {
    takenAt: "2026-08-15T08:00:00.000Z",
    takenBy: "unlock",
    products: 189,
    metaTitleSet: 62,
    metaTitleOurs: 0,
    metaDescriptionSet: 41,
    metaDescriptionOurs: 0,
    withBarcode: 0,
    withVendor: 189,
    withSku: 189,
    withImage: 171,
    productNodeTheme: null,
    productNodeNone: null,
    themeNodeTypes: null,
    findingsByCode: null,
    pagesRead: 0,
    ...over,
  };
}

function source(rows: ScanRowLike[], over: Partial<DashboardSource> = {}): DashboardSource {
  return {
    domain: "republicabio.ro",
    findings: aggregateFindings(rows),
    readiness: readinessOf(rows),
    blockedBy: null,
    since: { before: null, today: null },
    business: null,
    published: { at: null, reasons: [] },
    ...over,
  };
}

/** The five merchant spreadsheets for a store, as the routes write them. */
function merchantFiles(data: DashboardSource, rows: ScanRowLike[]): [string, string][] {
  const derived = dashboardDerived(data);
  const files: [string, string][] = [
    ["findings", findingsCsv(data, NOW)],
    ["shopwide", shopWideCsv(data, derived, NOW)],
    ["listing", listingCsv(data, derived, NOW)],
    ["products", productFindingsCsv(data, rows, NOW)],
  ];
  if (data.since.before) {
    files.push(["since", ownerSinceCsv(reportHeading(data, NOW), data.since.before, data.since.today)]);
  }
  return files;
}

function fiftyProducts(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 50; i += 1) {
    const codes: string[] = [];
    if (i < 12) codes.push("B17");
    if (i < 8) codes.push("A5");
    if (i >= 12 && i < 20) codes.push("B2");
    if (i >= 20 && i < 24) codes.push("B15");
    rows.push(row(i, codes));
  }
  return rows;
}

function oneEightyNine(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 189; i += 1) {
    const codes: string[] = ["B12"];
    if (i < 38) codes.push("B17");
    if (i < 23) codes.push("A5");
    if (i >= 100 && i < 114) codes.push("B25");
    if (i >= 150 && i < 161) codes.push("B15");
    rows.push(row(i, codes));
  }
  return rows;
}

function twentyThousand(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 20000; i += 1) {
    if (i < 500) rows.push(row(i, i < 120 ? ["B17"] : []));
    else rows.push(row(i, ["A5"], { page: false }));
  }
  return rows;
}

function pageReadNeverRan(): ScanRowLike[] {
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 120; i += 1) rows.push(row(i, ["A5"], { page: false }));
  return rows;
}

const STORES: [string, DashboardSource][] = [
  ["50 products", source(fiftyProducts())],
  [
    "189 products",
    source(oneEightyNine(), {
      business: { deliveryStated: false, returnsStated: false },
      since: { before: facts(), today: facts({ takenAt: DAY, takenBy: "current", withBarcode: 4 }) },
    }),
  ],
  ["20,000 products", source(twentyThousand())],
  ["empty", source([])],
  ["page read never ran", source(pageReadNeverRan())],
];

/** Cells, ignoring the quoting, so an assertion reads like the spreadsheet. */
function cells(csv: string): string[][] {
  return csv.split("\r\n").map((line) => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        out.push(cell);
        cell = "";
      } else cell += c;
    }
    out.push(cell);
    return out;
  });
}

// ---------------------------------------------------------------------------

describe("the formula-injection guard, on every export in this app", () => {
  // This was a defect in shipped code, not only in the new files: neither
  // app.report.export nor app.seo.export neutralised a leading = + - or @, and
  // both of them write product titles a merchant typed.
  it("neutralises a title that a spreadsheet would run as a formula", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1:A9)")).toBe("'+SUM(A1:A9)");
    expect(csvCell("@import")).toBe("'@import");
    expect(csvCell("-Scaun rosu")).toBe("'-Scaun rosu");
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it("leaves a plain number alone, sign and all", () => {
    // differenceLabel emits "-3" and "+3" for a figure that moved. Quoting
    // those would turn every fall in every comparison file into text.
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell("-3")).toBe("-3");
    expect(csvCell("+3")).toBe("+3");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("")).toBe("");
  });

  it("still quotes a cell with a comma, a quote or a newline in it", () => {
    expect(csvRows([["a,b", 'say "hi"', "one\ntwo"]])).toBe('"a,b","say ""hi""","one\ntwo"');
  });
});

describe("filenames a merchant can tell apart", () => {
  it("carries the shop and the date", () => {
    expect(exportFilename("republicabio.ro", "findings", NOW)).toBe(
      "ai-visibility-seo-republicabio-ro-findings-2026-09-05.csv",
    );
    expect(exportFilename("mrdigital-dev.myshopify.com", "products", NOW)).toBe(
      "ai-visibility-seo-mrdigital-dev-products-2026-09-05.csv",
    );
  });

  it("cannot carry a quote out of the header it sits in", () => {
    const name = exportFilename('a"; drop', "listing", NOW);
    expect(name).not.toContain('"');
    expect(name).not.toContain(";");
  });

  it("names the four tables the route serves", () => {
    expect([...EXPORT_TABLES]).toEqual(["findings", "shopwide", "listing", "products"]);
    expect(isExportTable("findings")).toBe(true);
    expect(isExportTable("since")).toBe(false);
    expect(isExportTable(undefined)).toBe(false);
  });
});

describe("the report and the screen answer from one place", () => {
  for (const [name, data] of STORES) {
    it(`derives the listing card and the shop-wide card once, on ${name}`, () => {
      const a = dashboardDerived(data);
      const b = dashboardDerived(data);
      expect(a.listing.inPlace).toBe(b.listing.inPlace);
      expect(a.wide.map((w) => w.key)).toEqual(b.wide.map((w) => w.key));
      // And the figure the report prints for the Google card is the KPI
      // string, not a second arithmetic of the same thing - or no figure at
      // all, on a shop nothing has read, because "0 of 10" there is a
      // fabricated zero and the screen shows a sentence instead.
      const listing = keyFigures(data, a).find((f) => f.key === "listing");
      if (a.listing.unmeasured) {
        expect(listing).toBeUndefined();
      } else {
        expect(listing?.value).toBe(`${a.listing.inPlace} of ${a.listing.total}`);
      }
    });

    it(`gives every key figure a denominator or an honest null, on ${name}`, () => {
      const derived = dashboardDerived(data);
      for (const figure of keyFigures(data, derived)) {
        expect(figure.value).not.toBe("");
        expect(figure.method.length).toBeGreaterThan(10);
        if (figure.of !== null) expect(figure.of).toMatch(/^of \d+/);
      }
    });

    it(`heads the report with the shop, the scope and the date, on ${name}`, () => {
      const heading = reportHeading(data, NOW);
      expect(heading).toContain(data.domain);
      expect(heading).toContain("2026-09-05");
      // Never "12 of 12": the scope sentence is denominated in the catalogue,
      // or it says the catalogue size and nothing about being checked.
      if (data.readiness.readSet > 0) {
        expect(heading).toContain(`${data.readiness.readSet} of `);
      } else {
        expect(heading).toContain("in the catalogue");
      }
    });

    it(`puts a figure in the strip only once a product is fully checked, on ${name}`, () => {
      // The same rule as the screen: tiles only with a read set, one sentence
      // otherwise (R2-09, R2-10). And every figure carries the exact token
      // both surfaces print.
      const figures = keyFigures(data, dashboardDerived(data));
      const strip = figures.filter((f) => f.strip);
      if (data.readiness.readSet === 0) {
        expect(strip).toEqual([]);
        expect(stripSentence(data)).toContain("nothing to group");
        expect(figures.filter((f) => f.key.startsWith("group-"))).toEqual([]);
      } else {
        expect(strip.length).toBeGreaterThanOrEqual(4);
        expect(stripSentence(data)).toBeNull();
      }
      for (const figure of figures) {
        expect(figure.token.length).toBeGreaterThan(0);
        if (figure.of !== null) expect(figure.token).toContain(" of ");
      }
    });
  }

  it("states the unchecked products as a number with the reason, with a thousands separator (R2-11, R2-27)", () => {
    const data = source(twentyThousand());
    const figures = keyFigures(data, dashboardDerived(data));
    const notChecked = figures.find((f) => f.key === "notChecked")!;
    expect(notChecked.value).toBe("19,500");
    expect(notChecked.of).toBe("of 20,000 in your catalogue");
    expect(notChecked.token).toBe("19,500 of 20,000");
    expect(notChecked.method).toContain("19,500 of 20,000 products have been read from your catalogue but their live page has not been opened yet");
    expect(reportHeading(data, NOW)).toContain("500 of 20,000 products fully checked");
    expect(keyFigures(source(fiftyProducts()), dashboardDerived(source(fiftyProducts()))).find((f) => f.key === "notChecked")).toBeUndefined();
  });
});

describe("the findings export", () => {
  it("gives every row a count and a denominator, on all five stores", () => {
    for (const [name, data] of STORES) {
      const table = cells(findingsCsv(data, NOW));
      const header = table[2];
      expect(header[0], name).toBe("What we looked for");
      for (const line of table.slice(3)) {
        if (line.length < 5) continue;
        expect(line[3], `${name}: empty count`).not.toBe("");
        expect(line[4], `${name}: empty denominator`).not.toBe("");
      }
    }
  });

  it("never exports a zero for a check that could not be asked", () => {
    // The store whose pages were never read: every page check must be a
    // sentence in both columns, not a 0 out of 0.
    const data = source(pageReadNeverRan());
    const table = cells(findingsCsv(data, NOW)).slice(3);
    const pageRows = table.filter((l) => l[2] === "Found by reading your pages");
    expect(pageRows.length).toBeGreaterThan(20);
    for (const line of pageRows) {
      expect(line[3]).toBe("Not checked yet");
      expect(line[4]).toBe("No product page has been read yet");
    }
  });

  it("uses the merchant vocabulary and never a check code", () => {
    // Every code in the vocabulary, so every plain label is actually written
    // into the file. The record is read as OWNER_LABEL with no fallback: the
    // `?? row.label` that used to sit there could not fire on a total record
    // and could only ever have leaked the operator's wording into a merchant's
    // spreadsheet.
    const rows: ScanRowLike[] = [];
    const codes = Object.keys(FINDING_OWNER);
    for (let i = 0; i < 12; i += 1) {
      rows.push(row(i, i === 0 ? codes : codes.filter((_, n) => n % 3 === i % 3)));
    }
    const text = findingsCsv(source(rows), NOW);
    expect(text).not.toMatch(/\b[AB]\d{1,2}\b/);
    expect(text).toContain("Whose it is");
    for (const pattern of [
      /\bcanonical\b/i,
      /\bhreflang\b/i,
      /\bJSON-LD\b/i,
      /\bh1\b/i,
      /\bnoindex\b/i,
      /\bopen graph\b/i,
      /\bschema\b/i,
      /\bgtin\b/i,
      /\blazy[- ]?load/i,
      /\bmeta\b/i,
      /\bnodes?\b/i,
      /\bstructured data\b/i,
    ]) {
      const hit = text.match(pattern);
      expect(hit === null, `the findings file says "${hit?.[0]}"`).toBe(true);
    }
  });

  it("says where every check went, so 40 rows is not read as 44 checks", () => {
    // CHECKS holds 40 codes; the vocabulary is 44. A6, A10 and A11 count
    // collections and B30 counts blog posts, each with its own denominator, so
    // none of them is a row here. The screen's own accounting is appended
    // rather than restated, so the file and the card cannot disagree.
    const text = findingsCsv(source(fiftyProducts()), NOW);
    expect(text).toContain("Where every check went");
    expect(text).toContain("That is all 13 checks on this side");
    expect(text).toContain("That is all 31 checks on this side");
  });

  it("says of a shop-wide check that it is one fix, rather than dropping it", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 12; i += 1) rows.push(row(i, ["B6"]));
    const data = source(rows);
    expect(data.readiness.shopWideCodes).toContain("B6");
    const table = cells(findingsCsv(data, NOW)).slice(3);
    const line = table.find((l) => l[5]?.includes("one fix for the whole shop"));
    expect(line).toBeTruthy();
    // One state, not "some" and "every" in one cell (R2-23), and the total
    // is the check's own: B6 is a catalogue check.
    expect(line![5]).toBe("Found on every product in the catalogue, so it is one fix for the whole shop");
    expect(line![5]).not.toContain("some");
  });

  it("names the read set for a shop-wide page check (R2-23, M1)", () => {
    const data = source(oneEightyNine());
    const table = cells(findingsCsv(data, NOW)).slice(3);
    const line = table.find((l) => l[5]?.includes("one fix for the whole shop"))!;
    expect(line[5]).toBe("Found on every product whose page we read, so it is one fix for the whole shop");
  });
});

describe("no spreadsheet points at anything (root cause A, R2-03, R2-05)", () => {
  const REFERENTS = [
    /\babove\b/,
    /\bbelow\b/,
    /\bthis screen\b/,
    /\bthis report\b/,
    /\bthis card\b/,
    /\bthe dial\b/,
    /\bfoot of\b/,
    /\bthe line above\b/,
  ];
  const withSnapshot = source(oneEightyNine(), {
    business: { deliveryStated: false, returnsStated: false },
    since: { before: facts(), today: facts({ takenAt: DAY, takenBy: "current", withBarcode: 4 }) },
  });
  const all: [string, DashboardSource, ScanRowLike[]][] = [
    ...STORES.map(([name, data]) => [name, data, data.readiness.products > 0 ? fiftyProducts() : []] as [string, DashboardSource, ScanRowLike[]]),
    ["189 with a snapshot", withSnapshot, oneEightyNine()],
  ];
  for (const [name, data, rows] of all) {
    it(`on ${name}`, () => {
      for (const [table, file] of merchantFiles(data, rows)) {
        for (const referent of REFERENTS) {
          const hit = file.match(referent);
          expect(hit, `${name}: the ${table} file says "${hit?.[0]}"`).toBeNull();
        }
      }
    });
  }
});

describe("the vocabulary guard covers all five merchant files (R1 4.2)", () => {
  const FORBIDDEN = [
    /\bcanonical\b/i,
    /\bhreflang\b/i,
    /\bJSON-LD\b/i,
    /\bh1\b/i,
    /\bnoindex\b/i,
    /\bopen graph\b/i,
    /\bschema\b/i,
    /\bgtin\b/i,
    /\blazy[- ]?load/i,
    /\bmeta\b/i,
    /\bmetafields?\b/i,
    /\bnodes?\b/i,
    /\bstructured data\b/i,
    /\bsnapshots?\b/i,
    /\boperators?\b/i,
    /\bsetup code\b/i,
    /\brobots\b/i,
    /\bliquid\b/i,
    /\bfill catalogue\b/i,
    /\b[AB]\d{1,2}\b/,
  ];
  // Every code in the vocabulary, a shop-wide B6 with a raw recorded reason,
  // and both snapshots, so every writer is driven through its jargon paths.
  const codes = Object.keys(FINDING_OWNER);
  const rows: ScanRowLike[] = [];
  for (let i = 0; i < 12; i += 1) {
    rows.push(row(i, i === 0 ? codes : ["B6", ...codes.filter((_, n) => n % 3 === i % 3)]));
  }
  const data = source(rows, {
    business: { deliveryStated: false, returnsStated: false },
    since: {
      before: facts({ findingsByCode: { A1: 12, B17: 4 } }),
      today: facts({ takenAt: DAY, takenBy: "current", findingsByCode: { A1: 12, B17: 2 } }),
    },
    published: {
      at: DAY,
      reasons: [
        {
          nodeType: "WebSite/SearchAction",
          emitted: false,
          reason:
            "The SEO module is enabled but the last scan did not find this node on the page - check that the app embed is active in the current theme.",
        },
        {
          nodeType: "AggregateRating",
          emitted: false,
          reason:
            "The last scan found no rating on this product's page - no review app has written rating metafields for it yet.",
        },
      ],
    },
  });

  const files = merchantFiles(data, rows);
  it("drives all five files", () => {
    expect(files.map(([t]) => t)).toEqual(["findings", "shopwide", "listing", "products", "since"]);
    expect(data.readiness.shopWideCodes).toContain("B6");
  });
  for (const [table, file] of files) {
    it(`keeps the ${table} file free of it`, () => {
      for (const pattern of FORBIDDEN) {
        const hit = file.match(pattern);
        expect(hit, `the ${table} file says "${hit?.[0]}"`).toBeNull();
      }
    });
  }
});

describe("the shop-wide export", () => {
  it("is headings and a sentence, never a fabricated row, when nothing is shop-wide", () => {
    const data = source(fiftyProducts());
    const derived = dashboardDerived(data);
    expect(derived.wide.length).toBe(0);
    const table = cells(shopWideCsv(data, derived, NOW));
    expect(table[0][0]).toContain("republicabio.ro");
    expect(table[1][0]).toContain("Nothing affects every product the same way");
    expect(table[3][0]).toBe("The fix");
    expect(table.length).toBe(4);
  });

  it("carries each row's own scope, not one denominator for the card", () => {
    const rows: ScanRowLike[] = [];
    for (let i = 0; i < 12; i += 1) rows.push(row(i, ["B6"]));
    const data = source(rows, {
      business: { deliveryStated: true, returnsStated: false },
      since: { before: null, today: facts({ products: 50, withBarcode: 0 }) },
    });
    const derived = dashboardDerived(data);
    const table = cells(shopWideCsv(data, derived, NOW)).slice(4);
    expect(table.length).toBe(derived.wide.length);
    for (const line of table) {
      expect(line[1]).toMatch(/^(You|Us|Your theme|Nothing to fix)$/);
      expect(line[4], `no scope on: ${line[0]}`).not.toBe("");
    }
    // The barcode row counts the catalogue, the check row counts what was read.
    expect(table.some((l) => l[4].includes("50"))).toBe(true);
  });
});

describe("the Google listing export", () => {
  it("writes a sentence where there is no figure, on all five stores", () => {
    for (const [name, data] of STORES) {
      const derived = dashboardDerived(data);
      const table = cells(listingCsv(data, derived, NOW)).slice(4);
      expect(table.length, name).toBe(derived.listing.properties.length);
      for (const [i, line] of table.entries()) {
        const property = derived.listing.properties[i];
        if (property.have === null) {
          expect(Number.isNaN(Number(line[2])), `${name}: ${property.key} exported as a number`)
            .toBe(true);
        } else {
          expect(line[2]).toBe(String(property.have));
        }
      }
    }
  });

  it("prints the same in-place figure as the KPI", () => {
    const data = source(oneEightyNine(), {
      since: { before: null, today: facts({ withBarcode: 4 }) },
    });
    const derived = dashboardDerived(data);
    const text = listingCsv(data, derived, NOW);
    expect(text).toContain(`${derived.listing.inPlace} of ${derived.listing.total}`);
  });
});

describe("the per-product export", () => {
  it("names each product and what was found on it", () => {
    const data = source(fiftyProducts());
    const table = cells(productFindingsCsv(data, fiftyProducts(), NOW)).slice(4);
    // 12 B17 + 8 A5 + 8 B2 + 4 B15
    expect(table.length).toBe(32);
    expect(table[0][0]).toBe("p-0");
    expect(table[0][1]).toBe("/products/p-0");
    expect(table[0][3]).toMatch(/^(You|Us|Your theme)$/);
    expect(table.join(" ")).not.toMatch(/\bB17\b/);
  });

  it("is headings and a sentence on a store with no findings at all", () => {
    const clean = [row(1, []), row(2, [])];
    const table = cells(productFindingsCsv(source(clean), clean, NOW));
    expect(table[1][0]).toContain("No product carries a finding");
    expect(table[3][0]).toBe("Product");
    expect(table.length).toBe(4);
  });

  it("is headings and a sentence on an empty store", () => {
    const table = cells(productFindingsCsv(source([]), [], NOW));
    expect(table[1][0]).toContain("No product carries a finding");
    expect(table.length).toBe(4);
  });

  it("says so in the file when it stops at the cap", () => {
    const rows = fiftyProducts();
    const text = productFindingsCsv(source(rows), rows, NOW, 5);
    expect(text).toContain("This file stopped at 5 rows");
    expect(cells(text).slice(4).length).toBe(6);
  });

  it("carries no check code and no search vocabulary", () => {
    const rows = oneEightyNine();
    const text = productFindingsCsv(source(rows), rows, NOW);
    expect(text).not.toMatch(/\b[AB]\d{1,2}\b/);
  });
});

describe("plain characters only, in every file a merchant opens", () => {
  const forbidden = /[–—‘’“”…]|&#\d+;/;
  for (const [name, data] of STORES) {
    it(`on ${name}`, () => {
      const derived = dashboardDerived(data);
      const rows = data.readiness.products > 0 ? fiftyProducts() : [];
      expect(derived).toBeTruthy();
      for (const [, file] of merchantFiles(data, rows)) expect(forbidden.test(file), name).toBe(false);
    });
  }
});
