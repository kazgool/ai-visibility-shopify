// A GraphQL Admin client usable from the worker process, where there is no
// Remix request to authenticate against. Reads the offline access token from
// the session table (ARCHITECTURE §4).
//
// GraphQL only — a single REST call is grounds for App Store rejection.

import db from "../db.server";

const API_VERSION = "2026-07";

export type GraphqlFn = <T = any>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

export class ThrottledError extends Error {}

async function tokenFor(shopDomain: string): Promise<string> {
  const session = await db.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session?.accessToken) {
    throw new Error(`No offline session for ${shopDomain}`);
  }
  return session.accessToken;
}

/**
 * Build a GraphQL caller for a shop. The returned function throttles itself
 * off the cost extensions Shopify returns (PRD §5.5): when the leaky bucket
 * runs low it waits for it to refill rather than eating a 429.
 */
export async function adminGraphql(shopDomain: string): Promise<GraphqlFn> {
  const token = await tokenFor(shopDomain);
  const endpoint = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  return async function graphql<T = any>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Admin API ${res.status}: ${await res.text()}`);
      }

      const json: any = await res.json();

      if (json.errors?.some((e: any) => e.extensions?.code === "THROTTLED")) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (json.errors?.length) {
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
      }

      // Stay ahead of the bucket instead of hitting the wall.
      const throttle = json.extensions?.cost?.throttleStatus;
      if (throttle && throttle.currentlyAvailable < throttle.maximumAvailable * 0.2) {
        const deficit = throttle.maximumAvailable * 0.5 - throttle.currentlyAvailable;
        const waitMs = Math.min(5000, Math.max(0, (deficit / throttle.restoreRate) * 1000));
        if (waitMs > 0) await sleep(waitMs);
      }

      return json.data as T;
    }
    throw new ThrottledError("Admin API stayed throttled after 5 attempts");
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
