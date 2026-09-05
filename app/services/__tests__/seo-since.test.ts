import { describe, it, expect } from "vitest";

// The since-card's model (PRD-SEO-FULL-ONPAGE section 1.2 and 1.3). Pure: no
// database, no .env, no Shopify. The four shapes named in the acceptance table
// are the four describe blocks below - no change, the catalogue grew, the
// catalogue shrank, everything moved - plus the two the earlier wave got wrong
// on other screens: a figure nobody measured, and a snapshot taken by hand.

import {
  NO_SNAPSHOT_SENTENCE,
  OWNER_WRITTEN_NOT_YET_SENTENCE,
  OWNER_WRITTEN_LABEL,
  WRITTEN_KEYS,
  WRITTEN_LABEL,
  WRITTEN_OMISSION_SENTENCE,
  differenceLabel,
  figure,
  FIGURES,
  ownerFigure,
  ownerNoSnapshotSentence,
  ownerSinceCsv,
  ownerSinceMethodLine,
  ownerSinceRows,
  ownerUnchangedLine,
  ownerUnchangedRows,
  sinceCsv,
  sinceHeading,
  sinceMethodLine,
  sinceTable,
  writtenCsv,
  writtenRows,
  type FactsRow,
} from "../seo-since";

function facts(over: Partial<FactsRow> = {}): FactsRow {
  return {
    takenAt: "2026-09-05T08:00:00.000Z",
    takenBy: "unlock",
    products: 50,
    metaTitleSet: 30,
    metaTitleOurs: 0,
    metaDescriptionSet: 30,
    metaDescriptionOurs: 0,
    withBarcode: 0,
    withVendor: 50,
    withSku: 50,
    withImage: 1,
    productNodeTheme: null,
    productNodeNone: null,
    themeNodeTypes: null,
    findingsByCode: null,
    pagesRead: 0,
    ...over,
  };
}

/** The row for one figure, by key, out of both halves of the table. */
function row(table: ReturnType<typeof sinceTable>, key: string) {
  return [...table.rows, ...table.unchanged].find((r) => r.key === key);
}

describe("shape 1: nothing changed", () => {
  // Every figure measured on both sides, so "unchanged" is a real answer for
  // all of them rather than an unmeasured field pretending to be one.
  const measured = {
    pagesRead: 50,
    productNodeTheme: 48,
    productNodeNone: 2,
    findingsByCode: { A1: 50 },
  };
  const before = facts(measured);
  const table = sinceTable(before, facts({ ...measured, takenAt: "2026-09-20T03:45:00.000Z" }));

  it("puts every figure in the collapsed group and shows no rows", () => {
    expect(table.rows).toEqual([]);
    expect(table.unchanged.length).toBe(FIGURES.length + 1);
  });

  it("collapses them into one line that counts them", () => {
    expect(table.unchangedLine).toBe(`${table.unchanged.length} figures are unchanged.`);
  });
});

describe("shape 2: the catalogue grew", () => {
  const before = facts();
  const today = facts({
    takenAt: "2026-09-20T03:45:00.000Z",
    products: 60,
    metaTitleSet: 45,
    metaTitleOurs: 15,
  });
  const table = sinceTable(before, today);

  it("shows both denominators, because 30 of 50 against 45 of 60 is not 15", () => {
    const r = row(table, "metaTitleSet")!;
    expect(r.beforeDenominator).toBe(50);
    expect(r.todayDenominator).toBe(60);
    expect(r.denominatorsDiffer).toBe(true);
    expect(figure(r.before, r.beforeDenominator)).toBe("30 of 50");
    expect(figure(r.today, r.todayDenominator)).toBe("45 of 60");
  });

  it("orders by the size of the difference, largest first", () => {
    expect(table.rows.map((r) => r.key).slice(0, 3)).toEqual([
      "metaTitleSet",
      "metaTitleOurs",
      "products",
    ]);
  });

  it("reports the catalogue total itself with no denominator", () => {
    const r = row(table, "products")!;
    expect(r.beforeDenominator).toBeNull();
    expect(figure(r.before, r.beforeDenominator)).toBe("50");
    expect(differenceLabel(r)).toBe("+10");
  });
});

describe("shape 3: the catalogue shrank", () => {
  const table = sinceTable(
    facts(),
    facts({ takenAt: "2026-09-20T03:45:00.000Z", products: 40, metaTitleSet: 28 }),
  );

  it("keeps the sign on the difference", () => {
    expect(differenceLabel(row(table, "products")!)).toBe("-10");
    expect(differenceLabel(row(table, "metaTitleSet")!)).toBe("-2");
  });

  it("orders by size and not by sign, so a fall of 10 outranks a fall of 2", () => {
    expect(table.rows.map((r) => r.key).slice(0, 2)).toEqual(["products", "metaTitleSet"]);
  });
});

describe("shape 4: everything moved", () => {
  const table = sinceTable(
    facts({ findingsByCode: { A1: 50, A5: 20 }, pagesRead: 0 }),
    facts({
      takenAt: "2026-09-20T03:45:00.000Z",
      metaTitleSet: 50,
      metaTitleOurs: 20,
      metaDescriptionSet: 50,
      metaDescriptionOurs: 20,
      withImage: 44,
      pagesRead: 50,
      productNodeTheme: 48,
      productNodeNone: 2,
      findingsByCode: { A1: 50, A5: 0, B1: 2 },
    }),
  );

  it("collapses nothing that actually moved", () => {
    expect(table.unchanged.map((r) => r.key)).toEqual([
      "products",
      "withBarcode",
      "withVendor",
      "withSku",
      "finding:A1",
    ]);
  });

  it("counts a page figure out of pages read, never out of the catalogue", () => {
    const r = row(table, "productNodeTheme")!;
    expect(r.todayDenominator).toBe(50);
    expect(figure(r.today, r.todayDenominator)).toBe("48 of 50");
  });

  it("keeps a finding that appeared since the snapshot, with the before as a measured zero", () => {
    const r = row(table, "finding:B1")!;
    // The snapshot's findingsByCode was an object, so a code absent from it was
    // measured at zero - not unmeasured.
    expect(r.before).toBe(0);
    expect(r.today).toBe(2);
    expect(differenceLabel(r)).toBe("+2");
  });

  it("labels a finding row with its code and the shared check label", () => {
    expect(row(table, "finding:A5")!.label).toBe("A5: Meta title or description absent");
  });
});

describe("a figure nobody measured is never a zero", () => {
  it("says no page had been read at the time, and shows no difference", () => {
    const table = sinceTable(
      facts({ pagesRead: 0, productNodeTheme: null }),
      facts({ takenAt: "2026-09-20T03:45:00.000Z", pagesRead: 50, productNodeTheme: 48 }),
    );
    const r = row(table, "productNodeTheme")!;

    expect(r.state).toBe("notReadAtTheTime");
    expect(r.difference).toBeNull();
    expect(figure(r.before, r.beforeDenominator)).toBe("not read at the time");
    expect(differenceLabel(r)).toBe("No page had been read at the time");
  });

  it("keeps such a row out of the unchanged line, which would call it a zero", () => {
    const table = sinceTable(
      facts({ productNodeTheme: null, productNodeNone: null }),
      facts({ takenAt: "2026-09-20T03:45:00.000Z", productNodeTheme: null, productNodeNone: null }),
    );
    expect(table.unchanged.map((r) => r.key)).not.toContain("productNodeTheme");
    expect(row(table, "productNodeTheme")!.state).toBe("notMeasuredEither");
    expect(differenceLabel(row(table, "productNodeTheme")!)).toBe("Never read");
  });

  it("says so when no catalogue pass has run since the snapshot", () => {
    const before = facts();
    const table = sinceTable(before, null);
    expect(row(table, "metaTitleSet")!.state).toBe("notReadNow");
    expect(sinceMethodLine(before, null)).toContain(
      "No catalogue pass has run since the snapshot was taken",
    );
  });
});

describe("the heading", () => {
  it("says since this engagement began for a snapshot taken at unlock", () => {
    expect(sinceHeading(facts())).toBe("Since this engagement began, 5 September 2026");
  });

  it("never says since the start for a snapshot taken by hand", () => {
    const manual = facts({ takenBy: "manual" });
    expect(sinceHeading(manual)).toBe("Since 5 September 2026");
    expect(sinceHeading(manual)).not.toContain("engagement began");
    expect(sinceMethodLine(manual, null)).toContain("since-this-date and not a since-the-start");
  });

  it("has a sentence for a shop with no snapshot at all", () => {
    expect(NO_SNAPSHOT_SENTENCE).toContain("No before snapshot exists for this shop");
  });
});

describe("written by this app since then", () => {
  const before = facts({ takenAt: "2026-09-05T08:00:00.000Z" });

  function todayWith(writtenSince: FactsRow["writtenSince"], at = before.takenAt): FactsRow {
    return facts({ takenAt: "2026-09-20T03:45:00.000Z", writtenSince, writtenSinceAt: at });
  }

  it("lists what was written, largest first, with its span", () => {
    const rows = writtenRows(
      before,
      todayWith({
        seo_title: { count: 20, earliest: "2026-09-06T01:00:00Z", latest: "2026-09-19T01:00:00Z" },
        questions: { count: 44, earliest: "2026-09-07T01:00:00Z", latest: "2026-09-07T02:00:00Z" },
      }),
    )!;

    expect(rows.map((r) => [r.label, r.count])).toEqual([
      ["Buyer questions", 44],
      ["Meta titles", 20],
    ]);
    expect(rows[1].earliest).toBe("2026-09-06T01:00:00Z");
  });

  it("drops a key with a count of zero rather than showing an empty row", () => {
    const rows = writtenRows(
      before,
      todayWith({ seo_title: { count: 0, earliest: null, latest: null } }),
    )!;
    expect(rows).toEqual([]);
  });

  it("refuses the whole block when the count was taken against another date", () => {
    // The real window: a snapshot taken by hand today, the last catalogue pass
    // having run yesterday against no snapshot at all.
    expect(writtenRows(before, todayWith({}, "2026-09-01T00:00:00.000Z"))).toBeNull();
    expect(writtenRows(before, todayWith({}, null as unknown as string))).toBeNull();
    expect(writtenRows(before, null)).toBeNull();
  });

  it("states how alt texts are counted, and that structured data nodes are not", () => {
    // Since 5 September 2026 alt texts carry a dated record per photo; the
    // sentence says the count is per photo, that older ones are not in it,
    // and that nodes still have no record.
    expect(WRITTEN_OMISSION_SENTENCE).toContain("one per photo");
    expect(WRITTEN_OMISSION_SENTENCE).toContain("5 September 2026");
    expect(WRITTEN_OMISSION_SENTENCE).toContain("never here");
    expect(WRITTEN_OMISSION_SENTENCE).toContain("Structured data nodes are not counted");
    expect(WRITTEN_OMISSION_SENTENCE).toContain("stamps no dated record");
  });

  it("names every stamped key in plain words, alt text included", () => {
    for (const key of WRITTEN_KEYS) {
      expect(OWNER_WRITTEN_LABEL[key]).toBeTruthy();
      expect(WRITTEN_LABEL[key]).toBeTruthy();
    }
    expect(OWNER_WRITTEN_LABEL.alt_text).toBe("Photo descriptions (one per photo)");
  });
});

describe("the CSVs", () => {
  const before = facts();
  const today = facts({ takenAt: "2026-09-20T03:45:00.000Z", products: 60, metaTitleSet: 45 });

  it("carries both dates on the first line of the comparison", () => {
    const first = sinceCsv(before, today).split("\r\n")[0];
    expect(first).toContain("2026-09-05T08:00:00.000Z");
    expect(first).toContain("2026-09-20T03:45:00.000Z");
    expect(first).toContain("by unlock");
  });

  it("says so on the first line when there is no today", () => {
    expect(sinceCsv(before, null).split("\r\n")[0]).toContain(
      "no catalogue pass since the snapshot",
    );
  });

  it("writes both denominators as their own columns", () => {
    const lines = sinceCsv(before, today).split("\r\n");
    expect(lines[1]).toBe("Figure,At the snapshot,Out of,Today,Out of,Difference");
    const metaTitle = lines.find((l) => l.startsWith("Products with a meta title"))!;
    expect(metaTitle).toBe("Products with a meta title,30,50,45,60,+15");
  });

  it("never writes a bare zero for a figure nobody measured", () => {
    const line = sinceCsv(before, today)
      .split("\r\n")
      .find((l) => l.startsWith("Pages where the theme emits"))!;
    expect(line).toContain("not read at the time");
  });

  it("carries both dates and the omission sentence on the written list", () => {
    const csv = writtenCsv(
      before,
      facts({
        takenAt: "2026-09-20T03:45:00.000Z",
        writtenSinceAt: before.takenAt,
        writtenSince: {
          seo_title: { count: 20, earliest: "2026-09-06T01:00:00Z", latest: "2026-09-19T01:00:00Z" },
        },
      }),
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("2026-09-05T08:00:00.000Z");
    expect(lines[1]).toBe("What this app wrote since then,Count,Earliest,Latest");
    expect(lines[2]).toBe("Meta titles,20,2026-09-06T01:00:00Z,2026-09-19T01:00:00Z");
    expect(csv).toContain("Alt texts are counted one per photo");
    expect(csv).toContain("Structured data nodes are not counted");
  });
});

// --- the merchant surfaces, 5 September 2026 --------------------------------

describe("the unchanged line the merchant reads counts only the rows the merchant sees (R1 1.2)", () => {
  // A snapshot recording 21 finding codes, one fixed figure moved.
  const codes: Record<string, number> = {};
  for (let i = 1; i <= 21; i += 1) codes[`B${i}`] = 3;
  const before = facts({ pagesRead: 50, productNodeTheme: 48, productNodeNone: 2, findingsByCode: codes });
  const today = facts({ ...before, takenAt: "2026-09-20T03:45:00.000Z", metaTitleOurs: 7 });
  const table = sinceTable(before, today);

  it("counts eleven, not thirty-two", () => {
    expect(table.unchangedLine).toBe("32 figures are unchanged.");
    expect(ownerUnchangedRows(table).length).toBe(11);
    expect(ownerUnchangedLine(table)).toBe("11 figures are unchanged.");
    expect(ownerSinceRows(table).map((r) => r.ownerLabel)).toEqual([
      "Titles for Google written by this app",
    ]);
  });

  it("is null when nothing the merchant sees is unchanged", () => {
    const everything = facts({
      takenAt: "2026-09-20T03:45:00.000Z",
      products: 60,
      metaTitleSet: 45,
      metaTitleOurs: 5,
      metaDescriptionSet: 40,
      metaDescriptionOurs: 4,
      withBarcode: 3,
      withVendor: 59,
      withSku: 58,
      withImage: 2,
      pagesRead: 1,
      productNodeTheme: 1,
      productNodeNone: 0,
    });
    const moved = sinceTable(
      facts({ pagesRead: 0, productNodeTheme: null, productNodeNone: null }),
      everything,
    );
    expect(ownerUnchangedLine(moved)).toBeNull();
  });
});

describe("the merchant's then-and-now file (R1 2.4, R2-12)", () => {
  const before = facts({ findingsByCode: { A1: 50, B17: 12 }, pagesRead: 12, productNodeTheme: 10 });
  const today = facts({
    takenAt: "2026-09-20T03:45:00.000Z",
    takenBy: "current",
    metaTitleOurs: 9,
    findingsByCode: { A1: 50, B17: 8 },
    pagesRead: 12,
    productNodeTheme: 10,
    writtenSinceAt: before.takenAt,
    writtenSince: { seo_title: { count: 9, earliest: "2026-09-06T01:00:00Z", latest: "2026-09-19T01:00:00Z" } },
  });
  const heading = "republicabio.ro - 50 of 50 products fully checked - report produced 2026-09-20";
  const csv = ownerSinceCsv(heading, before, today);

  it("starts with the report heading and the card's own heading", () => {
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(heading);
    expect(lines[1]).toContain("Since this engagement began, 5 September 2026");
    expect(lines[2]).toContain("catalogue pass of 20 September 2026");
  });

  it("writes the merchant's labels, never the operator's, and no check code", () => {
    expect(csv).toContain("Titles for Google written by this app,0,50,9,50,+9");
    expect(csv).toContain("Products with a barcode,0,50,0,50,No change");
    expect(csv).toContain("Titles for Google,9,6 September 2026,19 September 2026");
    expect(csv).not.toMatch(/\b[AB]\d{1,2}\b/);
    for (const pattern of [/\bmeta\b/i, /\bgtin\b/i, /\bnodes?\b/i, /\bsnapshot\b/i, /by unlock/, /\d{4}-\d{2}-\d{2}T/]) {
      const hit = csv.match(pattern);
      expect(hit === null, `the then-and-now file says "${hit?.[0]}"`).toBe(true);
    }
  });

  it("carries the written block and the omission sentence in the merchant's words", () => {
    expect(csv).toContain("What this app wrote since then,Count,Earliest,Latest");
    expect(csv).toContain("Photo descriptions are counted one per photo");
    expect(csv).not.toContain("Alt texts");
  });

  it("says why the written block is empty rather than writing nothing", () => {
    const stale = facts({ ...today, writtenSinceAt: "2026-09-01T00:00:00.000Z" });
    expect(ownerSinceCsv(heading, before, stale)).toContain(OWNER_WRITTEN_NOT_YET_SENTENCE);
    expect(ownerSinceCsv(heading, before, null)).toContain("no today column yet");
  });
});

describe("the merchant sentences carry none of the operator's words (R2-18)", () => {
  it("names the surface it is on and no snapshot, setup code or operator", () => {
    for (const surface of ["screen", "paper"] as const) {
      const sentence = ownerNoSnapshotSentence(surface);
      expect(sentence).not.toMatch(/\b(snapshot|setup code|operator)\b/i);
      expect(sentence).toContain(surface === "paper" ? "this report" : "this card");
    }
    expect(ownerSinceMethodLine(facts({ takenBy: "manual" }), null)).not.toMatch(/\b(snapshot|setup code)\b/i);
    expect(ownerSinceMethodLine(facts({ takenBy: "manual" }), null)).toContain("since-this-date");
  });

  it("separates thousands on the merchant figure", () => {
    expect(ownerFigure(19500, 20000)).toBe("19,500 of 20,000");
    expect(ownerFigure(null, 20000)).toBe("not read at the time");
    expect(figure(19500, 20000)).toBe("19500 of 20000");
  });
});
