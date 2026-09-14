import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";

// The button every CSV export is downloaded with, asserted on the two things
// that were wrong before it existed: it must not be a link, and the file must
// not be saved under a name nobody can tell apart from the other four.
//
// No jsdom and no testing-library, the same reason the other component tests
// give: renderToStaticMarkup needs neither. The click path itself (fetch, the
// content-type guard, the blob) is not reachable from static markup and is not
// asserted here; what is asserted is the shape that made the defect possible.

import { ExportButton, filenameFrom } from "../ExportButton";

function render(url: string): string {
  return renderToStaticMarkup(
    <AppProvider i18n={{}}>
      <ExportButton url={url}>Spreadsheet: which products</ExportButton>
    </AppProvider>,
  );
}

describe("the export button", () => {
  it("is a button and not a link", () => {
    const html = render("/app/seo/dashboard/export/products");
    // The whole defect in one assertion: an anchor opened in a new tab carries
    // no session token under token-exchange auth, so the server answers with
    // the login page and `download` saves that page to the merchant's disk.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain("<button");
  });

  it("keeps the route it points at in the markup, for the screens' own tests", () => {
    const html = render("/app/seo/dashboard/export/products");
    expect(html).toContain('data-export-url="/app/seo/dashboard/export/products"');
  });

  it("prints the label it was given", () => {
    expect(render("/app/report/export/weakest")).toContain("Spreadsheet: which products");
  });
});

describe("the name the file is saved under", () => {
  it("is the one the route asked for", () => {
    expect(
      filenameFrom(
        'attachment; filename="ai-visibility-seo-republicabio-ro-products-2026-09-14.csv"',
        "/app/seo/dashboard/export/products",
      ),
    ).toBe("ai-visibility-seo-republicabio-ro-products-2026-09-14.csv");
  });

  it("reads an unquoted header too", () => {
    expect(filenameFrom("attachment; filename=report.csv", "/x/y")).toBe("report.csv");
  });

  it("falls back to the table's own name rather than one name for all of them", () => {
    // The defect this guards: five files called export.csv in one Downloads
    // folder, which is the same as no name at all.
    expect(filenameFrom(null, "/app/seo/dashboard/export/products")).toBe("products.csv");
    expect(filenameFrom(null, "/app/seo/dashboard/export/findings")).toBe("findings.csv");
    expect(filenameFrom("attachment", "/app/seo/dashboard/export/listing")).toBe("listing.csv");
  });
});
