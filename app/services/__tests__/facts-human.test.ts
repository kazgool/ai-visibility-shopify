import { describe, expect, it } from "vitest";
import {
  diffFactRows,
  factKey,
  factsHumanOf,
  humanMerge,
  humanRowCount,
  mergeFacts,
  readFacts,
  withFactsHuman,
  type FactsHuman,
} from "../facts-human";

// CC-PROMPT-AI-READABILITY-4 item 4b: protection per attribute row. Pure, so
// every rule is asserted here once, and the writers are tested for wiring it.

const AT = "2026-09-11T10:00:00.000Z";
const ENGINE = "1.0.0";
const human = (k: string, v: string | null): FactsHuman => ({ [factKey(k)]: { k, v, at: AT, engine: ENGINE } });

describe("factKey", () => {
  it("is the label without case, diacritics or stray spaces", () => {
    expect(factKey("  Cantitate  pachet ")).toBe("cantitate pachet");
    expect(factKey("Origine geografic\u0103")).toBe(factKey("origine geografica"));
  });
});

describe("mergeFacts: the person's rows over the fresh ones", () => {
  const stored = [
    { k: "Forma", v: "capsule" },
    { k: "Gramaj", v: "105 g" },
  ];

  it("keeps one edited row and updates the others after a description change", () => {
    const fresh = [
      { k: "Forma", v: "pulbere, capsule" },
      { k: "Gramaj", v: "120 g" },
    ];
    expect(mergeFacts(fresh, stored, human("Forma", "capsule"))).toEqual([
      { k: "Forma", v: "capsule" },
      { k: "Gramaj", v: "120 g" },
    ]);
  });

  it("keeps a deleted row deleted when the engine finds it again", () => {
    const fresh = [
      { k: "Forma", v: "pulbere" },
      { k: "Gramaj", v: "105 g" },
    ];
    expect(mergeFacts(fresh, stored, human("Forma", null))).toEqual([{ k: "Gramaj", v: "105 g" }]);
  });

  it("keeps a row the person added, which the engine never finds", () => {
    const merged = mergeFacts([{ k: "Gramaj", v: "105 g" }], stored, human("Tara", "Romania"));
    expect(merged).toEqual([
      { k: "Gramaj", v: "105 g" },
      { k: "Tara", v: "Romania" },
    ]);
  });

  it("drops an automatic row the engine no longer finds, and adds a new one after the stored rows", () => {
    const merged = mergeFacts([{ k: "Gramaj", v: "105 g" }, { k: "Ambalaj", v: "cutie" }], stored, {});
    expect(merged).toEqual([
      { k: "Gramaj", v: "105 g" },
      { k: "Ambalaj", v: "cutie" },
    ]);
  });

  it("keeps the stored order, so rows do not move between passes", () => {
    const fresh = [
      { k: "Gramaj", v: "105 g" },
      { k: "Forma", v: "capsule" },
    ];
    expect(mergeFacts(fresh, stored, {}).map((f) => f.k)).toEqual(["Forma", "Gramaj"]);
  });

  it("a per-row reset hands the row back to the engine on the next pass", () => {
    const rows = human("Forma", "capsule");
    delete rows[factKey("Forma")];
    expect(mergeFacts([{ k: "Forma", v: "pulbere" }], stored, rows)).toEqual([{ k: "Forma", v: "pulbere" }]);
  });
});

describe("diffFactRows: what a save changed", () => {
  const shown = [
    { k: "Forma", v: "capsule" },
    { k: "Gramaj", v: "105 g" },
  ];

  it("marks nothing when nothing changed", () => {
    expect(diffFactRows(shown, [...shown], AT, ENGINE)).toEqual({});
  });

  it("marks only the row that changed", () => {
    const changes = diffFactRows(shown, [{ k: "Forma", v: "pulbere" }, shown[1]], AT, ENGINE);
    expect(Object.keys(changes)).toEqual(["forma"]);
    expect(changes.forma.v).toBe("pulbere");
  });

  it("marks a removed row as deleted and an added row as written", () => {
    const changes = diffFactRows(shown, [shown[0], { k: "Tara", v: "Romania" }], AT, ENGINE);
    expect(changes).toEqual({
      gramaj: { k: "Gramaj", v: null, at: AT, engine: ENGINE },
      tara: { k: "Tara", v: "Romania", at: AT, engine: ENGINE },
    });
  });

  it("reads a renamed label as the old row deleted and a new row", () => {
    const changes = diffFactRows(shown, [{ k: "Form", v: "capsule" }, shown[1]], AT, ENGINE);
    expect(changes.forma.v).toBeNull();
    expect(changes.form.v).toBe("capsule");
  });
});

describe("humanMerge: the migration, in the safe direction", () => {
  const stored = [
    { k: "Forma", v: "capsule" },
    { k: "Gramaj", v: "105 g" },
  ];
  const fresh = [
    { k: "Forma", v: "pulbere, capsule" },
    { k: "Gramaj", v: "120 g" },
    { k: "Culoare", v: "alb" },
  ];

  it("turns a table marked edited by hand into rows a person wrote, and publishes exactly that table", () => {
    const merge = humanMerge({ facts: { source: "human", at: AT } }, stored, fresh, AT, ENGINE);
    expect(merge.migrated).toBe(true);
    expect(merge.facts).toEqual(stored);
    expect(merge.human.forma.v).toBe("capsule");
    expect(merge.human.gramaj.v).toBe("105 g");
    // Left out of the table the person saved, so kept out.
    expect(merge.human.culoare.v).toBeNull();
  });

  it("does the same for facts with no record of who wrote them, which are treated as a person's", () => {
    const merge = humanMerge({}, stored, fresh, AT, ENGINE);
    expect(merge.migrated).toBe(true);
    expect(merge.facts).toEqual(stored);
  });

  it("is idempotent: a converted state is not the old form, and merges to the same table", () => {
    const first = humanMerge({ facts: { source: "human", at: AT } }, stored, fresh, AT, ENGINE);
    const state: Record<string, unknown> = { facts: { source: "auto", at: AT } };
    withFactsHuman(state, first.human);
    const second = humanMerge(state, first.facts, fresh, AT, ENGINE);
    expect(second.migrated).toBe(false);
    expect(second.facts).toEqual(first.facts);
  });

  it("leaves an automatic table automatic", () => {
    const merge = humanMerge({ facts: { source: "auto", at: AT } }, stored, fresh, AT, ENGINE);
    expect(merge.migrated).toBe(false);
    expect(merge.facts).toEqual([
      { k: "Forma", v: "pulbere, capsule" },
      { k: "Gramaj", v: "120 g" },
      { k: "Culoare", v: "alb" },
    ]);
    expect(humanRowCount(merge.human)).toBe(0);
  });

  it("converts nothing on a product that has no facts yet", () => {
    expect(humanMerge({}, [], fresh, AT, ENGINE).migrated).toBe(false);
  });
});

describe("state helpers", () => {
  it("reads rows back, ignoring malformed entries", () => {
    expect(factsHumanOf({ factsHuman: { a: { k: "A", v: "1" }, b: { v: 2 }, c: null } })).toEqual({
      a: { k: "A", v: "1", at: "", engine: "" },
    });
    expect(factsHumanOf({ factsHuman: [] })).toEqual({});
  });

  it("takes the key off the state when no rows are left", () => {
    const state: Record<string, unknown> = { factsHuman: human("A", "1") };
    withFactsHuman(state, {});
    expect("factsHuman" in state).toBe(false);
  });

  it("reads a stored facts value, and nothing from what is not one", () => {
    expect(readFacts(JSON.stringify([{ k: "A", v: "1" }, { k: 2 }]))).toEqual([{ k: "A", v: "1" }]);
    expect(readFacts("{")).toEqual([]);
    expect(readFacts(null)).toEqual([]);
  });
});
