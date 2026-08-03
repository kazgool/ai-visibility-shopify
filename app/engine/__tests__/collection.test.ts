import { describe, expect, it } from "vitest";
import {
  buildCollectionCapsule,
  buildComparisonTable,
  comparableLabels,
  type CollectionMember,
} from "../collection";

const f = (k: string, v: string) => ({ k, v });

function member(id: string, title: string, facts: [string, string][]): CollectionMember {
  return { id, title, handle: id, facts: facts.map(([k, v]) => f(k, v)) };
}

const products = [
  member("a", "Masa Oslo", [
    ["Material", "stejar"],
    ["Culoare", "natur"],
    ["Dimensiuni", "160 cm"],
  ]),
  member("b", "Masa Bergen", [
    ["Material", "MDF"],
    ["Culoare", "alb"],
    ["Dimensiuni", "180 cm"],
  ]),
  member("c", "Masa Tromso", [
    ["Material", "stejar"],
    ["Culoare", "gri"],
    ["Dimensiuni", "140 cm"],
  ]),
];

describe("comparableLabels", () => {
  it("keeps attributes that are widely present and actually vary", () => {
    expect(comparableLabels(products)).toEqual(
      expect.arrayContaining(["Material", "Culoare", "Dimensiuni"]),
    );
  });

  it("drops an attribute every product shares - a column of one value compares nothing", () => {
    const same = products.map((p) => ({
      ...p,
      facts: [...p.facts, f("Garantie", "24 luni")],
    }));
    expect(comparableLabels(same)).not.toContain("Garantie");
  });

  it("drops an attribute only a minority carries", () => {
    const sparse = [
      ...products,
      member("d", "Masa Kiruna", [
        ["Material", "sticla"],
        ["Culoare", "negru"],
        ["Dimensiuni", "150 cm"],
        ["Finisaj", "lucios"],
      ]),
    ];
    expect(comparableLabels(sparse)).not.toContain("Finisaj");
  });

  it("returns nothing for an empty collection", () => {
    expect(comparableLabels([])).toEqual([]);
  });
});

describe("buildComparisonTable", () => {
  it("puts a cell per column and keeps the collection order", () => {
    const table = buildComparisonTable({ title: "Mese", products });
    expect(table.rows.map((r) => r.title)).toEqual([
      "Masa Oslo",
      "Masa Bergen",
      "Masa Tromso",
    ]);
    for (const row of table.rows) {
      expect(row.cells).toHaveLength(table.columns.length);
    }
  });

  it("leaves a gap rather than inventing a value", () => {
    const withGap = [
      ...products,
      member("d", "Masa Umea", [
        ["Material", "nuc"],
        ["Culoare", "maro"],
      ]),
    ];
    const table = buildComparisonTable({ title: "Mese", products: withGap });
    const dims = table.columns.indexOf("Dimensiuni");
    const row = table.rows.find((r) => r.title === "Masa Umea")!;
    expect(row.cells[dims]).toBe("");
  });

  it("drops a product with nothing in any compared column", () => {
    const withEmpty = [
      ...products,
      member("e", "Masa fara descriere", [["Provenienta", "import"]]),
    ];
    const table = buildComparisonTable({ title: "Mese", products: withEmpty });
    expect(table.rows.map((r) => r.title)).not.toContain("Masa fara descriere");
  });

  it("has no table when nothing is comparable", () => {
    const single = [member("a", "Singura", [["Material", "stejar"]])];
    expect(buildComparisonTable({ title: "Mese", products: single })).toEqual({
      columns: [],
      rows: [],
    });
  });
});

describe("buildCollectionCapsule", () => {
  it("says how many and what differs, in plain characters", () => {
    const capsule = buildCollectionCapsule({ title: "Mese", products });
    expect(capsule.summary).toContain("3 products");
    expect(capsule.summary).toMatch(/differ by/);
    expect(capsule.summary).not.toMatch(/[–—…]|&[a-z]+;/);
  });

  it("cleans entities coming from imported catalogues", () => {
    const dirty = [
      member("x", "Masa &amp; Scaune", [
        ["Material", "stejar"],
        ["Culoare", "natur"],
      ]),
      member("y", "Masa &amp; Banca", [
        ["Material", "MDF"],
        ["Culoare", "alb"],
      ]),
    ];
    const capsule = buildCollectionCapsule({ title: "Seturi", products: dirty });
    expect(capsule.table.rows[0].title).toBe("Masa & Scaune");
  });

  it("answers only what it can answer", () => {
    const capsule = buildCollectionCapsule({ title: "Mese", products });
    expect(capsule.questions[0].q).toContain("How many products");
    for (const qa of capsule.questions) expect(qa.a.trim()).not.toBe("");
  });

  it("counts 'burete' and 'burete ' as one material", () => {
    const sloppy = [
      member("a", "Canapea A", [["Material", "burete"], ["Culoare", "gri"]]),
      member("b", "Canapea B", [["Material", "burete "], ["Culoare", "bej"]]),
      member("c", "Canapea C", [["Material", "textil."], ["Culoare", "negru"]]),
      member("d", "Canapea D", [["Material", "Textil"], ["Culoare", "verde"]]),
    ];
    const capsule = buildCollectionCapsule({ title: "Canapele", products: sloppy });
    const materials = capsule.criteria.find((c) => c.startsWith("Material:"))!;
    expect(materials).toBe("Material: burete, textil.");
  });

  it("splits composite values so 'textil, burete' does not re-list burete", () => {
    const composite = [
      member("a", "Canapea A", [["Material", "MDF"], ["Culoare", "gri"]]),
      member("b", "Canapea B", [["Material", "burete"], ["Culoare", "bej"]]),
      member("c", "Canapea C", [["Material", "textil, burete"], ["Culoare", "verde"]]),
    ];
    const capsule = buildCollectionCapsule({ title: "Canapele", products: composite });
    const materials = capsule.criteria.find((c) => c.startsWith("Material:"))!;
    expect(materials).toBe("Material: MDF, burete, textil");
  });

  it("lists four values and counts the rest rather than running on", () => {
    const varied = Array.from({ length: 12 }, (_, i) =>
      member(`p${i}`, `Canapea ${i}`, [
        ["Dimensiuni", `${150 + i * 10} cm`],
        ["Culoare", i % 2 === 0 ? "gri" : "bej"],
      ]),
    );
    const capsule = buildCollectionCapsule({ title: "Canapele", products: varied });
    expect(capsule.summary).toContain("150 cm");
    expect(capsule.summary).toContain("and 8 more");
    expect(capsule.summary).toContain("culoare: gri, bej");
  });

  it("states criteria as label plus the values to choose between", () => {
    const capsule = buildCollectionCapsule({ title: "Mese", products });
    expect(capsule.criteria.some((c) => c.startsWith("Material:"))).toBe(true);
  });
});
