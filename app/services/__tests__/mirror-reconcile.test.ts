// Section I.6 and the J.7 rows that the reconciliation answers.
//
// The bug this proves fixed: a product taken off the store kept its public
// text page and its llms.txt entry, sometimes for ever. Every case below ends
// with the row gone, which is what makes the proxy answer 404 and llms.txt
// stop listing it - both of those read this one table.

import { describe, expect, it, beforeEach, vi } from "vitest";

type Row = { id: string; shopId: string; handle: string; productId: string | null };

let rows: Row[] = [];

vi.mock("../../db.server", () => ({
  default: {
    mirrorCache: {
      findMany: async ({ where, select }: any) => {
        let found = rows.filter((r) => r.shopId === where.shopId);
        if (where.productId === null) found = found.filter((r) => r.productId === null);
        else if (where.productId?.not === null) found = found.filter((r) => r.productId !== null);
        if (!select) return found;
        return found.map((r) =>
          Object.fromEntries(Object.keys(select).map((k) => [k, (r as any)[k]])),
        );
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => {
        const i = rows.findIndex((r) => r.id === where.id);
        const [row] = rows.splice(i, 1);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const before = rows.length;
        rows = rows.filter((r) => {
          if (r.shopId !== where.shopId) return true;
          if (where.id?.in) return !where.id.in.includes(r.id);
          if (where.handle?.notIn) return where.handle.notIn.includes(r.handle);
          return false;
        });
        return { count: before - rows.length };
      },
    },
  },
}));

import { reconcileMirrors } from "../mirror-reconcile.server";
import { DEFAULT_PREFS, type PublishPrefs } from "../eligibility";
import type { CatalogueRead } from "../catalogue.server";

const SHOP = { id: "shop1", domain: "nordwood.myshopify.com" };

function product(handle: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    handle,
    title: handle,
    status: "ACTIVE",
    onlineStoreUrl: `https://nordwood.ro/products/${handle}`,
    available: true,
    ...extra,
  } as any;
}

/** A whole read: the counts agree with what was parsed. */
function read(products: any[], overrides: Partial<CatalogueRead> = {}): CatalogueRead {
  const counts = { root: products.length, objects: products.length };
  return {
    products,
    complete: true,
    objectsMatch: true,
    expected: counts,
    read: counts,
    ...overrides,
  };
}

const queued: string[] = [];
const logged: string[] = [];
const addJob = async (gid: string) => {
  queued.push(gid);
};
const log = (message: string) => {
  logged.push(message);
};

function run(products: any[], prefs: PublishPrefs = DEFAULT_PREFS, r?: CatalogueRead) {
  return reconcileMirrors(SHOP, r ?? read(products), prefs, addJob, log);
}

beforeEach(() => {
  rows = [];
  queued.length = 0;
  logged.length = 0;
});

describe("a page is withdrawn when its product stops qualifying", () => {
  it("closes a lost products/update: the row has a productId, which the old cleanup never matched", () => {
    rows = [{ id: "1", shopId: "shop1", handle: "x", productId: "gid://shopify/Product/1" }];
    return run([]).then((result) => {
      expect(result.deleted).toBe(1);
      expect(rows).toHaveLength(0);
    });
  });

  it("closes a lost products/delete the same way", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "gone", productId: "gid://shopify/Product/9" },
      { id: "2", shopId: "shop1", handle: "kept", productId: "gid://shopify/Product/2" },
    ];
    const result = await run([product("kept", "gid://shopify/Product/2")]);
    expect(result.deleted).toBe(1);
    expect(rows.map((r) => r.handle)).toEqual(["kept"]);
  });

  it("withdraws the old handle of a renamed product and queues the new one", async () => {
    rows = [{ id: "1", shopId: "shop1", handle: "x", productId: "gid://shopify/Product/1" }];
    const result = await run([product("y", "gid://shopify/Product/1")]);
    expect(result.deleted).toBe(1);
    expect(result.queued).toBe(1);
    expect(queued).toEqual(["gid://shopify/Product/1"]);
    expect(rows).toHaveLength(0);
  });

  it("empties the mirror for a shop that unpublished everything", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "a", productId: "gid://shopify/Product/1" },
      { id: "2", shopId: "shop1", handle: "b", productId: null },
      { id: "3", shopId: "shop1", handle: "c", productId: "gid://shopify/Product/3" },
    ];
    const result = await run([]);
    expect(result.deleted).toBe(3);
    expect(result.queued).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("never touches another shop's rows", async () => {
    rows = [{ id: "1", shopId: "other", handle: "x", productId: null }];
    const result = await run([]);
    expect(result.deleted).toBe(0);
    expect(rows).toHaveLength(1);
  });
});

describe("a truncated download deletes nothing", () => {
  it("skips, keeps every row, and names both figures in the log", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "a", productId: "gid://shopify/Product/1" },
      { id: "2", shopId: "shop1", handle: "b", productId: "gid://shopify/Product/2" },
    ];
    const short: CatalogueRead = {
      products: [product("a", "gid://shopify/Product/1")],
      complete: false,
      objectsMatch: false,
      expected: { root: 355, objects: 355 },
      read: { root: 354, objects: 354 },
    };
    const result = await run([], DEFAULT_PREFS, short);

    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(0);
    expect(rows).toHaveLength(2);
    expect(logged[0]).toContain("354 of 355 products");
    expect(logged[0]).toContain("nothing deleted");
  });
});

describe("rows written before the productId column", () => {
  it("adopts a NULL-productId row whose product is live, and deletes nothing", async () => {
    rows = [{ id: "1", shopId: "shop1", handle: "x", productId: null }];
    const result = await run([product("x", "gid://shopify/Product/7")]);
    expect(result.adopted).toBe(1);
    expect(result.deleted).toBe(0);
    expect(rows[0].productId).toBe("gid://shopify/Product/7");
  });
});

describe("the toggles decide the set", () => {
  const catalogue = [
    product("a", "gid://shopify/Product/1"),
    product("b", "gid://shopify/Product/2"),
    product("c", "gid://shopify/Product/3"),
    product("sold-1", "gid://shopify/Product/4", { available: false }),
    product("sold-2", "gid://shopify/Product/5", { available: false }),
  ];

  function fiveRows(): Row[] {
    return ["a", "b", "c", "sold-1", "sold-2"].map((handle, i) => ({
      id: String(i + 1),
      shopId: "shop1",
      handle,
      productId: `gid://shopify/Product/${i + 1}`,
    }));
  }

  it("withdraws the sold-out pages when the merchant turns that toggle off", async () => {
    rows = fiveRows();
    const result = await run(catalogue, { includeOutOfStock: false, includeUnlisted: false });
    expect(result.deleted).toBe(2);
    expect(rows.map((r) => r.handle).sort()).toEqual(["a", "b", "c"]);
  });

  it("queues them back, by their job key product, when it is turned on again", async () => {
    rows = fiveRows().slice(0, 3);
    const result = await run(catalogue, DEFAULT_PREFS);
    expect(result.deleted).toBe(0);
    expect(result.queued).toBe(2);
    expect(queued.sort()).toEqual([
      "gid://shopify/Product/4",
      "gid://shopify/Product/5",
    ]);
  });

  it("withdraws an unlisted product's page while unlisted products are excluded", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "hidden", productId: "gid://shopify/Product/8" },
      { id: "2", shopId: "shop1", handle: "live", productId: "gid://shopify/Product/9" },
    ];
    const unlisted = [
      product("hidden", "gid://shopify/Product/8", { status: "UNLISTED" }),
      product("live", "gid://shopify/Product/9"),
    ];

    const off = await run(unlisted, DEFAULT_PREFS);
    expect(off.deleted).toBe(1);
    expect(rows.map((r) => r.handle)).toEqual(["live"]);

    const on = await run(unlisted, { includeOutOfStock: true, includeUnlisted: true });
    expect(on.deleted).toBe(0);
    expect(on.queued).toBe(1);
  });

  it("withdraws a draft and an archived product, which no toggle can bring back", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "d", productId: "gid://shopify/Product/1" },
      { id: "2", shopId: "shop1", handle: "e", productId: "gid://shopify/Product/2" },
      { id: "3", shopId: "shop1", handle: "live", productId: "gid://shopify/Product/3" },
    ];
    const result = await run(
      [
        product("d", "gid://shopify/Product/1", { status: "DRAFT" }),
        product("e", "gid://shopify/Product/2", { status: "ARCHIVED" }),
        product("live", "gid://shopify/Product/3"),
      ],
      { includeOutOfStock: true, includeUnlisted: true },
    );
    expect(result.deleted).toBe(2);
    expect(result.queued).toBe(0);
    expect(rows.map((r) => r.handle)).toEqual(["live"]);
  });
});

describe("a handle swapped between two products", () => {
  // QA of 3 September 2026, wave fix 7. A renamed x to y and B renamed z to
  // x while the webhooks were lost. The row {x, A} used to survive because x
  // is eligible, and B was never queued because a row for x existed - so /x
  // served A's text under B's URL, reported as a clean pass.
  it("withdraws the row that another product's handle now points at, and queues both", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "x", productId: "gid://shopify/Product/A" },
      { id: "2", shopId: "shop1", handle: "z", productId: "gid://shopify/Product/B" },
    ];
    const result = await run([
      product("y", "gid://shopify/Product/A"),
      product("x", "gid://shopify/Product/B"),
    ]);

    // z is gone (handle not eligible), and x is gone (owned by B, held A).
    expect(result.deleted).toBe(2);
    expect(rows).toHaveLength(0);
    expect(queued.sort()).toEqual(["gid://shopify/Product/A", "gid://shopify/Product/B"]);
    expect(result.queued).toBe(2);
  });

  it("leaves a row alone when the handle still belongs to the same product", async () => {
    rows = [{ id: "1", shopId: "shop1", handle: "x", productId: "gid://shopify/Product/A" }];
    const result = await run([product("x", "gid://shopify/Product/A")]);
    expect(result.deleted).toBe(0);
    expect(result.queued).toBe(0);
    expect(rows).toHaveLength(1);
  });
});

describe("the floor on the eligible set", () => {
  // QA of 3 September 2026, blocking 1. A read that parsed products but found
  // none eligible is treated as a field that stopped arriving, not as a
  // catalogue with nothing public left. The alternative deletes every row for
  // the shop with `complete` true and nothing to re-queue.
  it("deletes nothing when products were read and none is eligible, and says so", async () => {
    rows = [
      { id: "1", shopId: "shop1", handle: "a", productId: "gid://shopify/Product/1" },
      { id: "2", shopId: "shop1", handle: "b", productId: "gid://shopify/Product/2" },
    ];
    // The shape of a schema drift: the products arrive, the field that decides
    // eligibility does not.
    const result = await run([
      product("a", "gid://shopify/Product/1", { status: undefined }),
      product("b", "gid://shopify/Product/2", { onlineStoreUrl: null }),
    ]);

    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(0);
    expect(result.queued).toBe(0);
    expect(rows).toHaveLength(2);
    expect(logged[0]).toContain("2 products read, none eligible");
    expect(logged[0]).toContain("0 page(s) of products no longer in the catalogue withdrawn");
    expect(logged[0]).toContain("nothing else deleted");
  });

  // The dev store on 5 September 2026: 401 rows, all with a NULL productId,
  // 352 of them from a 355-product catalogue replaced by a 50-product one,
  // and 49 whose handles are the current products'. Every read found 50 of
  // 50 and none eligible, because a password-protected storefront nulls
  // onlineStoreUrl, so the floor returned before any delete for a month.
  it("withdraws, under the floor, the rows of products the complete read does not contain at all", async () => {
    const current = Array.from({ length: 50 }, (_, i) =>
      product(`current-${i + 1}`, `gid://shopify/Product/${i + 1}`, { onlineStoreUrl: null }),
    );
    rows = [
      ...Array.from({ length: 352 }, (_, i) => ({
        id: `old-${i + 1}`,
        shopId: "shop1",
        handle: `old-${i + 1}`,
        productId: null,
      })),
      ...Array.from({ length: 49 }, (_, i) => ({
        id: `cur-${i + 1}`,
        shopId: "shop1",
        handle: `current-${i + 1}`,
        productId: null,
      })),
    ];
    expect(rows).toHaveLength(401);

    const result = await run(current);

    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(352);
    expect(result.adopted).toBe(0);
    expect(result.queued).toBe(0);
    expect(rows).toHaveLength(49);
    expect(rows.every((r) => r.handle.startsWith("current-"))).toBe(true);
    expect(logged[0]).toContain("50 products read, none eligible");
    expect(logged[0]).toContain("352 page(s) of products no longer in the catalogue withdrawn");
  });

  it("keeps, under the floor, a row whose product is in the read by id under a new handle", async () => {
    // A rename cannot be judged without eligibility, so the row stays until
    // the eligible set returns; only a product in the read by neither key goes.
    rows = [
      { id: "1", shopId: "shop1", handle: "old-name", productId: "gid://shopify/Product/1" },
      { id: "2", shopId: "shop1", handle: "vanished", productId: "gid://shopify/Product/9" },
    ];
    const result = await run([product("new-name", "gid://shopify/Product/1", { onlineStoreUrl: null })]);
    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(1);
    expect(rows.map((r) => r.handle)).toEqual(["old-name"]);
  });

  it("withdraws nothing under the floor when a product read carries no handle", async () => {
    // Handles stopped arriving: every row would look absent from the
    // catalogue, which is the failure the floor exists to prevent.
    rows = [
      { id: "1", shopId: "shop1", handle: "a", productId: null },
      { id: "2", shopId: "shop1", handle: "gone", productId: null },
    ];
    const result = await run([
      product("a", "gid://shopify/Product/1", { onlineStoreUrl: null }),
      product("b", "gid://shopify/Product/2", { onlineStoreUrl: null, handle: undefined }),
    ]);
    expect(result.skipped).toBe(true);
    expect(result.deleted).toBe(0);
    expect(rows).toHaveLength(2);
  });

  it("still empties the mirror when Shopify announced no products at all", async () => {
    // Root count zero is a different statement: the catalogue is empty, and
    // I.6 row 7 says every row goes.
    rows = [{ id: "1", shopId: "shop1", handle: "a", productId: "gid://shopify/Product/1" }];
    const result = await run([]);
    expect(result.skipped).toBe(false);
    expect(result.deleted).toBe(1);
    expect(rows).toHaveLength(0);
  });
});
