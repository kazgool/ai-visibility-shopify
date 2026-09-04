import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { RemixServer } from "@remix-run/react";
import {
  createReadableStreamFromReadable,
  type EntryContext,
} from "@remix-run/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { describeGraphqlError } from "./services/graphql-errors";

export const streamTimeout = 5000;

/**
 * Every error thrown out of a loader or an action lands here.
 *
 * Without this export Remix logs the raw error object, and a Shopify
 * `GraphqlQueryError` carries a whole `Response` plus its GraphQL errors
 * nested three deep - so `console.error` at Node's default depth printed
 * `graphQLErrors: [Array]` and a 500 on POST /app/seo could not be diagnosed
 * from the logs at all (4 September 2026). This is the only place an
 * unhandled request error is printed, and it prints the messages themselves.
 *
 * A thrown `Response` is Remix's own control flow - a redirect, a 404 from a
 * route - and is not an error; Remix asks us not to log those.
 */
export function handleError(
  error: unknown,
  { request }: { request: Request; params: unknown; context: unknown },
) {
  if (error instanceof Response) return;
  if (request.signal.aborted) return;
  const method = request.method;
  const path = new URL(request.url).pathname;
  console.error(describeGraphqlError(error, `${method} ${path}`));
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          // Never the object: see handleError above and graphql-errors.ts.
          console.error(describeGraphqlError(error, "render"));
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
