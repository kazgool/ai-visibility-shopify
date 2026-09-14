import { useCallback, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, Text } from "@shopify/polaris";

/**
 * The button every CSV export is downloaded with.
 *
 * Why this exists rather than `<Button url=... target="_blank" download>`,
 * which is what all nine exports used until 14 September 2026:
 *
 * This app authenticates with `unstable_newEmbeddedAuthStrategy` (token
 * exchange, app/shopify.server.ts). Under that strategy there is no session
 * cookie at all. Every authenticated request proves itself with a short-lived
 * App Bridge session token. The token must be requested with `shopify.idToken()`
 * and sent as an Authorization header; native browser `fetch` does not add it.
 *
 * `target="_blank"` is not a fetch. It is a top-level navigation in a fresh
 * browsing context, so it carries no session token and no cookie, and
 * `authenticate.admin` in the export route cannot authenticate it. It
 * redirects to /auth/login. And because the anchor also carried `download`,
 * the browser saved that login page to the merchant's disk as a .htm file
 * instead of displaying it: the merchant pressed "Spreadsheet: which products"
 * and received a login page named like a spreadsheet, with no error anywhere.
 * Reported on Republica BIO, reproducible on any shop.
 *
 * So the file is fetched, not navigated to: `fetch` from inside the frame
 * carries the token, the response is read as a blob, and the blob is saved
 * under the filename the route's own Content-Disposition names. The URL still
 * appears in the markup as `data-export-url`, because the screens' tests
 * assert which route a button points at and that is worth keeping assertable.
 *
 * The content-type guard is the part that must never be dropped. A `fetch`
 * follows redirects, so an authentication failure arrives here as a perfectly
 * ordinary 200 carrying HTML. Saving that under a .csv name is the original
 * defect wearing a different coat. Anything that is not CSV is refused and
 * said out loud, because a merchant who is told nothing assumes the file is
 * fine.
 */
export function ExportButton({
  url,
  children,
  disabled,
  variant,
}: {
  url: string;
  children: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const shopify = useAppBridge();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Native fetch does not attach App Bridge credentials by itself. Ask
      // App Bridge for the current short-lived token and send it explicitly;
      // otherwise authenticate.admin redirects to /auth/login and the old
      // bug returns that HTML page as the apparent spreadsheet.
      const token = await shopify.idToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // The export routes answer a refusal with a plain sentence rather
        // than a status alone ("This export needs the SEO module."), so the
        // sentence is what the merchant is shown. Read as text, capped: a
        // proxy error page is not a message anybody should be handed whole.
        const said = (await res.text()).trim();
        const plain = said.startsWith("<") ? "" : said.slice(0, 300);
        setError(
          plain ||
            `The file could not be fetched (${res.status}). Reload the screen and press it again.`,
        );
        return;
      }

      const type = res.headers.get("Content-Type") ?? "";
      if (!type.includes("text/csv")) {
        setError(
          "The server answered with something that is not a spreadsheet, which usually means " +
            "this screen's session has expired. Reload the screen and press it again.",
        );
        return;
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filenameFrom(res.headers.get("Content-Disposition"), url);
      // Firefox will not follow a click on an anchor that is not in the
      // document.
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError(
        "The file could not be fetched. Check the connection and press it again.",
      );
    } finally {
      setBusy(false);
    }
  }, [shopify, url]);

  return (
    <span data-export-url={url}>
      <BlockStack gap="100">
        <Button onClick={download} loading={busy} disabled={disabled} variant={variant}>
          {children}
        </Button>
        {error ? (
          <Text as="p" variant="bodySm" tone="critical">
            {error}
          </Text>
        ) : null}
      </BlockStack>
    </span>
  );
}

/**
 * The filename the route asked for, or one derived from the path.
 *
 * Exported for its own test: the header is written by four different routes
 * and a merchant with five of these in a Downloads folder cannot tell them
 * apart if this quietly falls back to "export.csv" on all of them.
 */
export function filenameFrom(disposition: string | null, url: string): string {
  if (disposition) {
    // filename="..." as the export routes write it. RFC 5987's filename*
    // is not produced by any route here, so it is not parsed here either.
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    if (match?.[1]) return match[1].trim();
  }
  const tail = url.split("/").filter(Boolean).pop() ?? "export";
  return `${tail}.csv`;
}
