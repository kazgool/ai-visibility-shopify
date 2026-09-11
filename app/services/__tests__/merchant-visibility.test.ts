import { describe, expect, it } from "vitest";
import {
  MERCHANT_VISIBLE,
  codeCanShow,
  merchantVisible,
  type Finding,
} from "../seo-findings";
import {
  CSV_CONTEXT,
  columnAccount,
  readinessOf,
  shopWideItems,
  type ShopWideFacts,
} from "../seo-readiness";
import {
  aggregateFindings,
  findingsForProduct,
  pageFindings,
  pageStateOf,
  type ScanRowLike,
} from "../seo-aggregate";

// CC-PROMPT-AI-READABILITY-3 addendum, item 9: a check this app can neither fix
// nor causes still runs and keeps its stored rows, and appears on no merchant
// surface. The test the brief asks for: a hidden finding changes no number on
// any surface. The same shop is built twice - once with only what a merchant
// sees, once with hidden findings added on top - and every function the
// surfaces are drawn from must answer both the same. The print view, the
// report and every spreadsheet are computed from these functions and nothing
// else (seo-report.ts), so an equal answer here is an equal answer there.

const AT = new Date("2026-09-10T02:00:00.000Z");

function row(productId: string, findings: Finding[], over: Partial<ScanRowLike> = {}): ScanRowLike {
  return {
    productId,
    handle: productId,
    bulkAt: AT,
    scannedAt: AT,
    status: "ok",
    findings,
    ...over,
  } as ScanRowLike;
}

const B10: Finding = { code: "B10", source: "B", detail: { present: false, title: null, length: 0 } };
const A5: Finding = { code: "A5", source: "A", detail: { field: "title" } };
const B34: Finding = { code: "B34", source: "B", detail: { present: 1 } };
const B1_OURS: Finding = { code: "B1", source: "B", detail: { productNodes: 2, emitters: ["theme", "app"] } };

// Hidden: on every product (so it would have been shop-wide), on a page, a
// counted one, B1 with both nodes the theme's, B22 that is not ours.
const A1: Finding = { code: "A1", source: "A", detail: { missing: ["barcode"] } };
const B12: Finding = { code: "B12", source: "B", detail: { h1: 0 } };
const B29: Finding = { code: "B29", source: "B", detail: { internal: 12 } };
const B1_THEME: Finding = { code: "B1", source: "B", detail: { productNodes: 2, emitters: ["theme"] } };
const B22_THEIRS: Finding = { code: "B22", source: "B", detail: { types: [{ type: "FAQPage", count: 1, ours: false }], ours: false } };

const VISIBLE_ONLY: ScanRowLike[] = [
  row("p1", [B10, B34]),
  row("p2", [A5, B1_OURS]),
  row("p3", []),
  row("p4", []),
  row("p5", [B10], { scannedAt: null, status: null }),
];

const WITH_HIDDEN: ScanRowLike[] = [
  row("p1", [B10, B34, A1, B12, B29]),
  row("p2", [A5, B1_OURS, A1, B22_THEIRS]),
  row("p3", [A1, B1_THEME]),
  row("p4", [A1, B12, B29]),
  row("p5", [B10, A1], { scannedAt: null, status: null }),
];

const FACTS: ShopWideFacts = {
  deliveryStated: true,
  returnsStated: true,
  barcode: { have: 5, of: 5 },
  brand: { have: 5, of: 5 },
  productCode: { have: 5, of: 5 },
  photo: { have: 5, of: 5 },
  catalogue: 5,
  publishedReasons: null,
};

describe("a hidden finding changes no number on any surface (addendum item 9)", () => {
  it("leaves the headline, the four groups and the shop-wide codes exactly as they were", () => {
    expect(readinessOf(WITH_HIDDEN)).toEqual(readinessOf(VISIBLE_ONLY));
  });

  it("leaves every check row, count and denominator exactly as it was", () => {
    expect(aggregateFindings(WITH_HIDDEN)).toEqual(aggregateFindings(VISIBLE_ONLY));
  });

  it("leaves the column sentences, their totals and their arithmetic exactly as they were", () => {
    for (const source of ["A", "B"] as const) {
      const account = (rows: ScanRowLike[]) => {
        const aggregate = aggregateFindings(rows);
        return columnAccount({
          source,
          rows: aggregate.rows,
          clean: aggregate.clean,
          shopWideCodes: readinessOf(rows).shopWideCodes,
          ctx: CSV_CONTEXT,
        });
      };
      expect(account(WITH_HIDDEN)).toEqual(account(VISIBLE_ONLY));
      expect(account(WITH_HIDDEN).balanced).toBe(true);
    }
  });

  it("leaves the shop-wide card exactly as it was, although A1 is on every product", () => {
    expect(shopWideItems(readinessOf(WITH_HIDDEN), FACTS)).toEqual(shopWideItems(readinessOf(VISIBLE_ONLY), FACTS));
    expect(readinessOf(WITH_HIDDEN).shopWideCodes).not.toContain("A1");
  });

  it("shows a product whose findings are all hidden as clean in the Products list and empty in the editor", () => {
    const onlyHidden = WITH_HIDDEN[3];
    expect(pageFindings(onlyHidden)).toEqual([]);
    expect(findingsForProduct(onlyHidden)).toEqual([]);
    expect(pageStateOf(onlyHidden)).toBe("clean");
  });

  it("gives a hidden check no row at all, never a clean one", () => {
    const codes = [...aggregateFindings(WITH_HIDDEN).rows, ...aggregateFindings(WITH_HIDDEN).clean].map((r) => r.code);
    for (const code of codes) expect(codeCanShow(code)).toBe(true);
    expect(codes).not.toContain("A1");
    expect(codes).not.toContain("B12");
    expect(codes).not.toContain("B29");
  });
});

describe("merchantVisible", () => {
  it("shows B1 only when one of the nodes is this app's, and B22 only when the old data is ours", () => {
    expect(merchantVisible(B1_OURS)).toBe(true);
    expect(merchantVisible(B1_THEME)).toBe(false);
    expect(merchantVisible(B22_THEIRS)).toBe(false);
    expect(merchantVisible({ code: "B22", detail: { ours: true } })).toBe(true);
  });

  it("shows a code this release does not know nowhere", () => {
    expect(merchantVisible({ code: "Z9", detail: {} })).toBe(false);
    expect(codeCanShow("Z9")).toBe(false);
  });

  it("classifies every code in the vocabulary", () => {
    for (const [code, v] of Object.entries(MERCHANT_VISIBLE)) {
      expect(["yes", "ours", "no"]).toContain(v);
      expect(codeCanShow(code)).toBe(v !== "no");
    }
  });
});
