import { describe, it, expect, vi, beforeEach } from "vitest";

// CC-PROMPT-AI-READABILITY-3 addendum, item 12: the "written by this app"
// counter learns of a write when the job that made it finishes, not at the
// next catalogue pass. The case it was written for: the snapshot on 1
// September, the last catalogue pass on 10 September, a meta title applied on
// 11 September. The stored count said 1, the page and its dated state entry
// said 2.
//
// db.server and catalogue.server are stubbed the way seo-snapshot.server.test.ts
// stubs them, and for the same reason (see the comment there).

const mockBefore = vi.fn();
const mockCurrent = vi.fn();
const mockSnapshotUpdate = vi.fn(async () => ({}));

vi.mock("../../db.server", () => ({
  default: {
    setting: { findUnique: vi.fn(), findMany: vi.fn(async () => []), upsert: vi.fn() },
    seoSnapshot: {
      findFirst: (...args: unknown[]) => mockBefore(...(args as [])),
      findUnique: (...args: unknown[]) => mockCurrent(...(args as [])),
      update: (...args: unknown[]) => mockSnapshotUpdate(...(args as [])),
    },
    seoScan: { findMany: vi.fn(async () => []) },
  },
}));

const mockFetchAllProducts = vi.fn();
vi.mock("../catalogue.server", () => ({
  fetchAllProducts: (...args: unknown[]) => mockFetchAllProducts(...(args as [])),
}));

import { refreshWrittenSince } from "../seo-snapshot.server";
import type { ProductInput } from "../facts.server";

const SNAPSHOT = new Date("2026-09-01T08:00:00.000Z");
const graphql = (async () => ({})) as any;

function stated(id: string, at: string): ProductInput {
  return {
    id,
    title: "Produs",
    handle: id,
    variants: [],
    metafields: [{ key: "state", value: JSON.stringify({ seo_title: { source: "auto", at } }) }],
  } as unknown as ProductInput;
}

function read(products: ProductInput[], complete = true) {
  return {
    products,
    complete,
    objectsMatch: complete,
    expected: { root: products.length, objects: products.length },
    read: { root: complete ? products.length : products.length - 1, objects: products.length },
  };
}

/** The current row as the 10 September pass left it: one title, counted then. */
function currentRow(count: number, latest: string) {
  return {
    takenBy: "current",
    takenAt: new Date("2026-09-10T02:00:00.000Z"),
    writtenSinceAt: SNAPSHOT,
    writtenSince: { seo_title: { count, earliest: "2026-09-09T10:00:00.000Z", latest } },
  };
}

beforeEach(() => {
  mockBefore.mockReset();
  mockCurrent.mockReset();
  mockSnapshotUpdate.mockClear();
  mockFetchAllProducts.mockReset();
  mockBefore.mockResolvedValue({ takenBy: "unlock", takenAt: SNAPSHOT });
});

describe("refreshWrittenSince (addendum item 12)", () => {
  it("counts a title written the day after the last catalogue pass: 1 before, 2 after", async () => {
    mockCurrent.mockResolvedValue(currentRow(1, "2026-09-09T10:00:00.000Z"));
    mockFetchAllProducts.mockResolvedValue(
      read([stated("p1", "2026-09-09T10:00:00.000Z"), stated("p2", "2026-09-11T09:30:00.000Z")]),
    );

    const out = await refreshWrittenSince("shop1", graphql);

    expect(out).toEqual({ written: true });
    const data = (mockSnapshotUpdate.mock.calls as any[])[0][0].data;
    expect(data.writtenSince.seo_title).toEqual({
      count: 2,
      earliest: "2026-09-09T10:00:00.000Z",
      latest: "2026-09-11T09:30:00.000Z",
    });
    // Counted against the snapshot, and the pass's own date is left alone.
    expect(data.writtenSinceAt).toEqual(SNAPSHOT);
    expect(data.takenAt).toBeUndefined();
  });

  it("writes nothing when the count has not moved", async () => {
    mockCurrent.mockResolvedValue(currentRow(1, "2026-09-09T10:00:00.000Z"));
    mockFetchAllProducts.mockResolvedValue(read([stated("p1", "2026-09-09T10:00:00.000Z")]));

    expect(await refreshWrittenSince("shop1", graphql)).toEqual({ written: false, reason: "unchanged" });
    expect(mockSnapshotUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing on a short read", async () => {
    mockCurrent.mockResolvedValue(currentRow(1, "2026-09-09T10:00:00.000Z"));
    mockFetchAllProducts.mockResolvedValue(read([stated("p2", "2026-09-11T09:30:00.000Z")], false));

    expect(await refreshWrittenSince("shop1", graphql)).toEqual({ written: false, reason: "short_read" });
    expect(mockSnapshotUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing without a snapshot, and reads no catalogue", async () => {
    mockBefore.mockResolvedValue(null);

    expect(await refreshWrittenSince("shop1", graphql)).toEqual({ written: false, reason: "no_snapshot" });
    expect(mockFetchAllProducts).not.toHaveBeenCalled();
    expect(mockSnapshotUpdate).not.toHaveBeenCalled();
  });
});
