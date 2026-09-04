// One way to turn a caught error into a line a person can act on, and the
// only way this app is allowed to log one.
//
// Written 4 September 2026, after a 500 on POST /app/seo that could not be
// diagnosed from the logs at all. What Fly showed was:
//
//   SetShopThemeScan ... 200 ... ok: true
//   GraphQL Client: An error occurred while fetching from the API.
//     Review 'graphQLErrors' for details
//   graphQLErrors: [Array]
//
// Every fact needed to fix it was in that error object and none of it was
// printed. Three things conspired:
//
//  1. Shopify's Admin GraphQL API answers **HTTP 200 with a top-level
//     `errors` array** for throttling, for an access-scope refusal, and for a
//     document it will not run. `@shopify/shopify-api` turns that into a
//     `GraphqlQueryError` whose `message` is only the *first* error's message
//     and whose useful content is nested three levels down in `body.errors.
//     graphQLErrors` (see node_modules/@shopify/shopify-api/lib/clients/
//     common.ts, throwFailedRequest).
//  2. That error also carries `response` - a whole `Response` object - and
//     `console.error(err)` on it prints Node's default depth of 2, so the
//     array of messages renders as the literal string `[Array]`.
//  3. Nothing in the app had a `handleError`, so Remix logged the raw object.
//
// So: never log an error object, and never log a Response. Log this instead.
// It is a pure module with no ".server" suffix on purpose - `entry.server.tsx`,
// route actions, services, the worker and the scripts all reach it.

/** A GraphQL error as Shopify returns it in a top-level `errors` array. */
type GraphqlErrorEntry = {
  message?: unknown;
  path?: unknown;
  locations?: unknown;
  extensions?: { code?: unknown; cost?: unknown; documentation_url?: unknown } | null;
};

/** A userErrors entry, which is a different thing and is reported separately. */
type UserErrorEntry = { field?: unknown; message?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `["metafieldsSet", "metafields", 0]` becomes `metafieldsSet.metafields.0`.
 * The path is the half of a GraphQL error that says *where*, and it is the
 * half that a message alone never tells you.
 */
function formatPath(path: unknown): string {
  if (!Array.isArray(path) || path.length === 0) return "";
  return path.map((p) => String(p)).join(".");
}

/** One GraphQL error, flattened: code, path and message on one line. */
function formatEntry(entry: GraphqlErrorEntry): string {
  const code = isRecord(entry?.extensions) ? entry.extensions.code : undefined;
  const parts: string[] = [];
  if (code !== undefined && code !== null) parts.push(String(code));
  const path = formatPath(entry?.path);
  if (path) parts.push(`at ${path}`);
  const prefix = parts.length > 0 ? `[${parts.join(" ")}] ` : "";
  const message = entry?.message === undefined ? "(no message)" : String(entry.message);
  return `${prefix}${message}`;
}

/**
 * Pull the top-level `errors` array out of whatever shape it arrived in.
 *
 * The Shopify stack nests it differently depending on which layer threw:
 * `GraphqlQueryError` has `body.errors.graphQLErrors`, a raw client response
 * has `errors.graphQLErrors`, and a plain GraphQL body has `errors` as the
 * array itself. All three are read here so no caller has to know which it got.
 */
function graphqlEntriesOf(error: unknown): GraphqlErrorEntry[] {
  const seen: GraphqlErrorEntry[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) if (isRecord(entry)) seen.push(entry as GraphqlErrorEntry);
    }
  };
  if (!isRecord(error)) return seen;

  const body = isRecord(error.body) ? error.body : null;
  const bodyErrors = body && isRecord(body.errors) ? body.errors : null;
  const ownErrors = isRecord(error.errors) ? error.errors : null;

  push(bodyErrors?.graphQLErrors);
  push(ownErrors?.graphQLErrors);
  push(body?.errors);
  push(error.errors);
  push((error as { graphQLErrors?: unknown }).graphQLErrors);

  // Thrown by @shopify/graphql-client's stream path, which hides the array on
  // the error's `cause`.
  const cause = isRecord(error.cause) ? error.cause : null;
  push(cause?.graphQLErrors);

  return seen;
}

/** userErrors, which mean the mutation ran and refused - a different fault. */
function userErrorsOf(error: unknown): UserErrorEntry[] {
  if (!isRecord(error)) return [];
  const body = isRecord(error.body) ? error.body : null;
  const data = body && isRecord(body.data) ? body.data : null;
  if (!data) return [];
  const out: UserErrorEntry[] = [];
  for (const value of Object.values(data)) {
    if (!isRecord(value)) continue;
    const errors = (value as { userErrors?: unknown }).userErrors;
    if (!Array.isArray(errors)) continue;
    for (const entry of errors) if (isRecord(entry)) out.push(entry as UserErrorEntry);
  }
  return out;
}

/**
 * The HTTP status, read without touching the `Response` beyond its number.
 * Deliberately never returns the object: a Response in a log line is what
 * this module exists to prevent.
 */
function statusOf(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const direct = error.code ?? error.statusCode ?? error.networkStatusCode;
  if (typeof direct === "number") return direct;
  const body = isRecord(error.body) ? error.body : null;
  const bodyErrors = body && isRecord(body.errors) ? body.errors : null;
  if (typeof bodyErrors?.networkStatusCode === "number") return bodyErrors.networkStatusCode;
  const response = isRecord(error.response) ? error.response : null;
  if (typeof response?.status === "number") return response.status;
  return null;
}

/**
 * Shopify's own request id. It is the only thing their support can act on, and
 * it is in a header nobody was printing.
 */
function requestIdOf(error: unknown): string | null {
  if (!isRecord(error)) return null;
  const headers = error.headers;
  if (!isRecord(headers)) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "x-request-id") continue;
    return Array.isArray(value) ? String(value[0]) : String(value);
  }
  return null;
}

/**
 * The throttle state, when Shopify sent it. A THROTTLED error carries the
 * bucket in `extensions.cost.throttleStatus`, which is the difference between
 * "we are asking for too much" and "something else drained the bucket".
 */
function throttleOf(entries: GraphqlErrorEntry[], error: unknown): string | null {
  const fromEntry = entries
    .map((e) => (isRecord(e.extensions) ? e.extensions.cost : undefined))
    .find((c) => isRecord(c));
  const body = isRecord(error) && isRecord(error.body) ? error.body : null;
  const fromBody = body && isRecord(body.extensions) ? body.extensions.cost : undefined;
  const cost = (fromEntry ?? fromBody) as Record<string, unknown> | undefined;
  if (!isRecord(cost)) return null;
  const status = isRecord(cost.throttleStatus) ? cost.throttleStatus : null;
  const requested = cost.requestedQueryCost;
  const actual = cost.actualQueryCost;
  const parts: string[] = [];
  if (requested !== undefined) parts.push(`requestedCost=${String(requested)}`);
  if (actual !== undefined && actual !== null) parts.push(`actualCost=${String(actual)}`);
  if (status) {
    parts.push(
      `bucket=${String(status.currentlyAvailable)}/${String(status.maximumAvailable)}`,
      `restoreRate=${String(status.restoreRate)}`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Everything known about a caught error, on one line, with no object dumped.
 *
 * `operation` is the operation name - "SetShopThemeScan", "seo action". Pass
 * it: which of a request's six Admin calls failed is not recoverable from the
 * error, and it was the first question asked when this went wrong.
 */
export function describeGraphqlError(error: unknown, operation?: string): string {
  // An operation name attached by `named()` at the call site, when the caller
  // that logs is too far from the call that failed to know which it was.
  const tagged =
    isRecord(error) && typeof error.operationName === "string" ? error.operationName : undefined;
  const name0 = operation ?? tagged;
  const where = name0 ? `${name0}: ` : "";
  const entries = graphqlEntriesOf(error);
  const userErrors = userErrorsOf(error);
  const status = statusOf(error);
  const requestId = requestIdOf(error);
  const throttle = throttleOf(entries, error);

  const name = isRecord(error) && typeof error.name === "string" ? error.name : "Error";
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : String(error);

  const parts: string[] = [`${where}${name}: ${message}`];
  if (status !== null) parts.push(`http=${status}`);

  if (entries.length > 0) {
    // The whole point: every message and every path, flattened, so a log line
    // says what Shopify actually objected to.
    parts.push(
      `graphQLErrors(${entries.length})=${entries.map((e) => `{${formatEntry(e)}}`).join(" ")}`,
    );
  }
  if (userErrors.length > 0) {
    parts.push(
      `userErrors(${userErrors.length})=` +
        userErrors
          .map((u) => {
            const field = Array.isArray(u.field) ? u.field.map(String).join(".") : u.field;
            return `{${field ? `${String(field)}: ` : ""}${String(u.message ?? "(no message)")}}`;
          })
          .join(" "),
    );
  }
  if (throttle) parts.push(throttle);
  if (requestId) parts.push(`x-request-id=${requestId}`);

  // A stack, last, and only its frames - never the error object itself.
  if (error instanceof Error && error.stack) {
    const frames = error.stack
      .split("\n")
      .slice(1, 4)
      .map((l) => l.trim())
      .filter(Boolean);
    if (frames.length > 0) parts.push(`at ${frames.join(" < ")}`);
  }

  return parts.join(" | ");
}

/**
 * The same thing for a GraphQL body a caller read itself rather than caught -
 * the `const json = await res.json()` shape. Returns null when there are no
 * top-level errors, so a caller can write:
 *
 *     const failure = describeGraphqlBody(json, "SetShopThemeScan");
 *     if (failure) throw new Error(failure);
 *
 * This exists because a 200 with top-level `errors` reaches some callers as a
 * value rather than as a throw, and those callers used to read `json.data?.x`,
 * find undefined, and carry on as though nothing had happened.
 */
export function describeGraphqlBody(body: unknown, operation?: string): string | null {
  if (!isRecord(body)) return null;
  const entries = graphqlEntriesOf(body);
  if (entries.length === 0) return null;
  const where = operation ? `${operation}: ` : "";
  const throttle = throttleOf(entries, body);
  const parts = [
    `${where}the API returned ${entries.length} GraphQL error(s)`,
    `graphQLErrors(${entries.length})=${entries.map((e) => `{${formatEntry(e)}}`).join(" ")}`,
  ];
  if (throttle) parts.push(throttle);
  return parts.join(" | ");
}

/**
 * Run an Admin call with its operation name attached to anything it throws.
 *
 * The 500 that prompted this module was logged six frames from the call that
 * caused it, and the log could not say which of the request's six Admin calls
 * had failed. A GraphQL error's `path` names the field, which is close, but a
 * query that Shopify refuses outright has no path at all. Attaching the name
 * costs nothing and is never wrong.
 *
 * It does not wrap or replace the error: the original is rethrown, so
 * `instanceof` checks upstream keep working.
 */
export async function named<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isRecord(error) && error.operationName === undefined) {
      try {
        (error as Record<string, unknown>).operationName = operation;
      } catch {
        // A frozen error is still an error; the name is a convenience.
      }
    }
    throw error;
  }
}
