import { describe, expect, it } from "vitest";

// The formatter that exists because a 500 on POST /app/seo could not be
// diagnosed from the logs (4 September 2026). The failure was not that the
// information was missing - it was in the error object - but that every place
// that logged it dumped an object at Node's default depth, so the array of
// GraphQL messages printed as the literal string "[Array]".
//
// So the assertions here are mostly negative: the output must contain the
// messages and paths, and must never contain "[Array]", "[Object]" or anything
// that came out of a Response.

import { describeGraphqlBody, describeGraphqlError, named } from "../graphql-errors";

/**
 * A GraphqlQueryError exactly as @shopify/shopify-api builds it - see
 * node_modules/@shopify/shopify-api/lib/clients/common.ts, throwFailedRequest.
 * The `response` property really is a whole Response, which is the trap.
 */
function shopifyError(
  graphQLErrors: unknown[],
  extra: { headers?: Record<string, string>; data?: unknown } = {},
) {
  const error = new Error(
    (graphQLErrors[0] as any)?.message ?? "GraphQL operation failed",
  ) as Error & Record<string, unknown>;
  error.name = "GraphqlQueryError";
  error.response = new Response("{}", { status: 200 });
  error.headers = extra.headers ?? { "x-request-id": "abc-123" };
  error.body = {
    ...(extra.data === undefined ? {} : { data: extra.data }),
    errors: {
      networkStatusCode: 200,
      message:
        "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
      graphQLErrors,
      response: new Response("{}", { status: 200 }),
    },
  };
  return error;
}

describe("describeGraphqlError", () => {
  it("prints every message and path, flattened, and the operation name", () => {
    const line = describeGraphqlError(
      shopifyError([
        { message: "Field 'nope' doesn't exist on type 'Shop'", path: ["shop", "nope"] },
        { message: "Access denied for metafieldsSet field", path: ["metafieldsSet"] },
      ]),
      "SetShopThemeScan",
    );

    expect(line).toContain("SetShopThemeScan");
    expect(line).toContain("graphQLErrors(2)");
    expect(line).toContain("Field 'nope' doesn't exist on type 'Shop'");
    expect(line).toContain("at shop.nope");
    expect(line).toContain("Access denied for metafieldsSet field");
    expect(line).toContain("at metafieldsSet");
    expect(line).toContain("http=200");
    expect(line).toContain("x-request-id=abc-123");
  });

  // The whole reason this module exists.
  it("never prints a collapsed array, a collapsed object or a Response", () => {
    const line = describeGraphqlError(
      shopifyError([{ message: "Throttled", extensions: { code: "THROTTLED" } }]),
      "SetShopThemeScan",
    );
    expect(line).not.toContain("[Array]");
    expect(line).not.toContain("[Object]");
    expect(line).not.toContain("[object Response]");
    expect(line).not.toContain("Response {");
    expect(line).toBe(line.split("\n")[0]); // one line, so one grep finds it
  });

  it("names the code, so THROTTLED is not mistaken for a broken document", () => {
    const line = describeGraphqlError(
      shopifyError([
        {
          message: "Throttled",
          extensions: {
            code: "THROTTLED",
            cost: {
              requestedQueryCost: 10,
              actualQueryCost: null,
              throttleStatus: {
                maximumAvailable: 2000,
                currentlyAvailable: 3,
                restoreRate: 100,
              },
            },
          },
        },
      ]),
      "SetShopThemeScan",
    );
    expect(line).toContain("[THROTTLED]");
    expect(line).toContain("requestedCost=10");
    expect(line).toContain("bucket=3/2000");
    expect(line).toContain("restoreRate=100");
  });

  it("reports userErrors separately, since they mean the mutation ran", () => {
    const line = describeGraphqlError(
      shopifyError([], {
        data: { metafieldsSet: { userErrors: [{ field: ["metafields", "0", "value"], message: "Value is too long" }] } },
      }),
      "SetShopThemeScan",
    );
    expect(line).toContain("userErrors(1)");
    expect(line).toContain("metafields.0.value");
    expect(line).toContain("Value is too long");
  });

  it("survives a plain Error, a string and null", () => {
    expect(describeGraphqlError(new Error("boom"), "op")).toContain("op: Error: boom");
    expect(describeGraphqlError("boom", "op")).toContain("boom");
    expect(describeGraphqlError(null, "op")).toContain("op: ");
    expect(describeGraphqlError(undefined)).toBeTypeOf("string");
  });

  it("reads the errors array off a client response that was not thrown", () => {
    const line = describeGraphqlError({
      errors: {
        networkStatusCode: 200,
        graphQLErrors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      },
    });
    expect(line).toContain("Throttled");
    expect(line).toContain("[THROTTLED]");
  });
});

describe("describeGraphqlBody", () => {
  it("is null when the body carries no top-level errors", () => {
    expect(describeGraphqlBody({ data: { shop: { id: "gid://shopify/Shop/1" } } })).toBeNull();
    expect(describeGraphqlBody(null)).toBeNull();
  });

  // A 200 with top-level errors and no data reaches a caller that does
  // `json.data?.x` as undefined, which used to read as "nothing to do".
  it("names what the API objected to when data is absent", () => {
    const line = describeGraphqlBody(
      { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
      "SetShopThemeScan",
    );
    expect(line).toContain("SetShopThemeScan");
    expect(line).toContain("1 GraphQL error(s)");
    expect(line).toContain("[THROTTLED] Throttled");
  });
});

describe("named", () => {
  it("attaches the operation to whatever the call threw, and rethrows it", async () => {
    const original = new Error("boom");
    await expect(named("SetShopThemeScan", async () => Promise.reject(original))).rejects.toBe(
      original,
    );
    expect(describeGraphqlError(original)).toContain("SetShopThemeScan");
  });

  it("does not overwrite a name an inner call already attached", async () => {
    const original = new Error("boom") as Error & { operationName?: string };
    original.operationName = "ShopId";
    await expect(named("outer", async () => Promise.reject(original))).rejects.toBe(original);
    expect(original.operationName).toBe("ShopId");
  });

  it("returns the value when nothing throws", async () => {
    await expect(named("ok", async () => 42)).resolves.toBe(42);
  });
});
