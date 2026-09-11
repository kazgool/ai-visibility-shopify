import { describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_EVERY_ITEMS,
  HEARTBEAT_EVERY_MS,
  beatingGraphql,
  createHeartbeat,
  type HeartbeatWrite,
} from "../job-heartbeat";

// CC-PROMPT-AI-READABILITY-2 item 3: at most one write every 10 units or 60
// seconds, whichever comes first.

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const saver = () => vi.fn(async (_write: HeartbeatWrite) => {});

describe("createHeartbeat", () => {
  it("writes every ten units when the units come fast", async () => {
    const c = clock();
    const save = saver();
    const hb = createHeartbeat(save, { now: c.now });
    for (let i = 1; i <= 25; i++) await hb.progress(i, 500);
    expect(HEARTBEAT_EVERY_ITEMS).toBe(10);
    expect(save.mock.calls).toEqual([[{ done: 10, total: 500 }], [{ done: 20, total: 500 }]]);
  });

  it("writes after sixty seconds when the units come slowly", async () => {
    const c = clock();
    const save = saver();
    const hb = createHeartbeat(save, { now: c.now });
    await hb.progress(1, 500);
    c.advance(HEARTBEAT_EVERY_MS - 1);
    await hb.progress(2, 500);
    expect(save).not.toHaveBeenCalled();
    c.advance(1);
    await hb.progress(3, 500);
    expect(save.mock.calls).toEqual([[{ done: 3, total: 500 }]]);
  });

  it("touch writes a sign of life without counts, on time alone", async () => {
    const c = clock();
    const save = saver();
    const hb = createHeartbeat(save, { now: c.now });
    await hb.touch();
    expect(save).not.toHaveBeenCalled();
    c.advance(HEARTBEAT_EVERY_MS);
    await hb.touch();
    await hb.touch();
    expect(save.mock.calls).toEqual([[null]]);
  });

  it("a touch restarts the clock the counts are throttled on", async () => {
    const c = clock();
    const save = saver();
    const hb = createHeartbeat(save, { now: c.now });
    c.advance(HEARTBEAT_EVERY_MS);
    await hb.touch();
    c.advance(HEARTBEAT_EVERY_MS - 1);
    for (let i = 1; i <= 9; i++) await hb.progress(i, 189);
    expect(save.mock.calls).toEqual([[null]]);
  });

  it("a failed write does not throw, is reported, and is tried again next time", async () => {
    const c = clock();
    const errors: unknown[] = [];
    const save = vi
      .fn<(write: HeartbeatWrite) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Neon away"))
      .mockResolvedValue(undefined);
    const hb = createHeartbeat(save, { now: c.now, onError: (e) => errors.push(e) });
    c.advance(HEARTBEAT_EVERY_MS);
    await expect(hb.touch()).resolves.toBeUndefined();
    await hb.touch();
    expect(save).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });
});

describe("beatingGraphql", () => {
  it("beats after each call and returns the call's result", async () => {
    const order: string[] = [];
    const graphql = vi.fn(async () => {
      order.push("call");
      return { shop: { id: "1" } };
    });
    const beat = vi.fn(async () => {
      order.push("beat");
    });
    const wrapped = beatingGraphql(graphql as any, beat);
    await expect(wrapped("query { shop { id } }", { a: 1 })).resolves.toEqual({ shop: { id: "1" } });
    expect(graphql).toHaveBeenCalledWith("query { shop { id } }", { a: 1 });
    expect(order).toEqual(["call", "beat"]);
  });

  it("returns the client unchanged when there is no beat", () => {
    const graphql = vi.fn() as any;
    expect(beatingGraphql(graphql)).toBe(graphql);
  });
});
