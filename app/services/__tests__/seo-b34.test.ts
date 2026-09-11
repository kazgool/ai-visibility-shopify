import { describe, expect, it } from "vitest";
import { checkVisibleContent, VISIBLE_CONTENT_CLASS } from "../seo-onpage";
import {
  buildFindingsAggregate,
  CHECKS,
  createFindingsCounters,
  describeFinding,
  foldFindingsRow,
} from "../seo-aggregate";
import { CHECK_LABEL, FINDING_OWNER, FIX_SHAPE, OWNER_LABEL, OWNER_STEPS, SHOP_WIDE_LABEL } from "../seo-findings";

// B34, the delivery counter (PRD-AI-READABILITY P0.6): counted, never judged.

describe("checkVisibleContent", () => {
  it("raises B34 when the page carries the content block's class", () => {
    const html = `<main><section ${VISIBLE_CONTENT_CLASS} style="margin:2rem 0;"><p>x</p></section></main>`;
    expect(checkVisibleContent(html)).toEqual({ code: "B34", source: "B", detail: {} });
  });

  it("raises nothing on a page without it, including the comparison block's own class", () => {
    expect(checkVisibleContent('<section class="ai-visibility-compare">x</section>')).toBeNull();
    expect(checkVisibleContent("<html><body></body></html>")).toBeNull();
  });
});

describe("B34 in the aggregate", () => {
  const read = (id: number, withBlock: boolean) => ({
    productId: `p${id}`,
    handle: `h-${id}`,
    bulkAt: "2026-09-11T03:00:00Z",
    scannedAt: "2026-09-11T03:46:00Z",
    status: "ok",
    findings: withBlock ? [{ code: "B34", source: "B", detail: {} }] : [],
  });

  it("is a reports check over the pages read, the label the brief names", () => {
    expect(CHECKS.find((c) => c.code === "B34")).toEqual({
      code: "B34",
      source: "B",
      basis: "pagesRead",
      reports: true,
    });
    expect(CHECK_LABEL.B34).toBe("Visible product content from this app is on the page");
  });

  it("counts the pages carrying the block over the pages read, and never goes red", () => {
    const counters = createFindingsCounters();
    for (let i = 0; i < 5; i += 1) foldFindingsRow(counters, read(i, i < 3));
    const row = buildFindingsAggregate(counters).rows.find((r) => r.code === "B34")!;
    expect(row).toMatchObject({ state: "counted", count: 3, denominator: 5 });
  });

  it("is still a counted row at zero, so the screen can say 0 of N", () => {
    const counters = createFindingsCounters();
    for (let i = 0; i < 4; i += 1) foldFindingsRow(counters, read(i, false));
    const row = buildFindingsAggregate(counters).rows.find((r) => r.code === "B34")!;
    expect(row).toMatchObject({ state: "counted", count: 0, denominator: 4 });
  });

  it("is not yet read, never zero, before any page has been read", () => {
    const row = buildFindingsAggregate(createFindingsCounters()).rows.find((r) => r.code === "B34")!;
    expect(row.state).toBe("notYetRead");
  });
});

describe("B34's words", () => {
  it("has an entry in every record that is total over the codes", () => {
    expect(FINDING_OWNER.B34).toBe("app");
    expect(FIX_SHAPE.B34).toBe("onceForTheShop");
    expect(OWNER_LABEL.B34).toBeTruthy();
    expect(SHOP_WIDE_LABEL.B34).toBeTruthy();
    expect(OWNER_STEPS.B34.what).toBeTruthy();
    expect(OWNER_STEPS.B34.where).toBeTruthy();
  });

  it("uses plain characters and none of the words a shop owner is never shown", () => {
    const merchant = [
      OWNER_LABEL.B34,
      SHOP_WIDE_LABEL.B34,
      OWNER_STEPS.B34.what,
      OWNER_STEPS.B34.where,
      describeFinding({ code: "B34", source: "B", detail: {} }),
    ];
    for (const text of merchant) {
      expect(text).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
      expect(text).not.toMatch(
        /\b(canonical|JSON-LD|schema|meta|metafields?|nodes?|structured data|liquid|operators?|snapshots?)\b/i,
      );
      expect(text).not.toMatch(/\b[AB]\d{1,2}\b/);
    }
  });
});
