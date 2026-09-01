import { describe, it, expect } from "vitest";
import { hasWithdrawableAutoValues } from "../extract.server";
import { AGENTS } from "../crawler-check.server";
import type { ProductInput } from "../facts.server";

function product(metafields: { key: string; value: string }[]): ProductInput {
  return { id: "gid://shopify/Product/1", title: "Test", metafields };
}

// The bulk write branch enters when productFacts is nonempty OR this returns
// true - the widened condition that fixes the all-variant-level case, where
// productFacts is empty but stale product-level auto values still need
// withdrawing.
describe("hasWithdrawableAutoValues", () => {
  it("is true when an auto-written value exists", () => {
    const p = product([
      { key: "summary", value: "Auto summary." },
      { key: "state", value: JSON.stringify({ summary: { source: "auto" } }) },
    ]);
    expect(hasWithdrawableAutoValues(p)).toBe(true);
  });

  it("is false when the value is human-written - never withdrawn", () => {
    const p = product([
      { key: "summary", value: "A person wrote this." },
      { key: "state", value: JSON.stringify({ summary: { source: "human" } }) },
    ]);
    expect(hasWithdrawableAutoValues(p)).toBe(false);
  });

  it("is false when a value exists but has no state entry (treated as human)", () => {
    const p = product([{ key: "summary", value: "From somewhere else." }]);
    expect(hasWithdrawableAutoValues(p)).toBe(false);
  });

  it("is false when nothing was ever written - the no-op stays free", () => {
    expect(hasWithdrawableAutoValues(product([]))).toBe(false);
    const emptyValues = product([
      { key: "questions", value: "[]" },
      { key: "state", value: JSON.stringify({ questions: { source: "auto" } }) },
    ]);
    expect(hasWithdrawableAutoValues(emptyValues)).toBe(false);
  });

  it("covers every withdrawable key, not only facts", () => {
    for (const key of ["facts", "summary", "questions", "fit_for"]) {
      const value = key === "facts" || key === "questions" ? '[{"x":1}]' : "value";
      const p = product([
        { key, value },
        { key: "state", value: JSON.stringify({ [key]: { source: "auto" } }) },
      ]);
      expect(hasWithdrawableAutoValues(p)).toBe(true);
    }
  });
});

// crawler_check derives JobRun total/progress from this list; a hardcoded 5
// once survived the list growing. This pins the derivation's input as real.
describe("AGENTS", () => {
  it("has at least the eight known agents, each with a user agent string", () => {
    const names = Object.keys(AGENTS);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const name of names) {
      expect(AGENTS[name]).toMatch(/Mozilla/);
    }
  });
});
