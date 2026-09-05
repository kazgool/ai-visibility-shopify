// The merchant SEO dashboard's spreadsheet exports (PRD-SEO-FULL-ONPAGE
// section 4.3, build step 6). Four tables, at
// /app/seo/dashboard/export/{findings,shopwide,listing,products}.
//
// Same shape as app.seo.export.$table.tsx and app.report.export.$table.tsx,
// and for the same two reasons those files give:
//
//  - No default export, so this is a resource route and the loader's Response
//    reaches the browser as a file. A route with a default export renders its
//    component instead, and the merchant presses the button and gets a screen.
//  - The entitlement is repeated here rather than inherited. Remix runs a
//    resource route's loader alone, so nothing above it in the tree runs on
//    this request, and a gate enforced only by a parent is not enforced at all
//    on this path.
//
// The one deviation from those two files, and why: the filename carries the
// shop and the date (exportFilename), because a merchant with three of these
// on a desktop cannot tell ai-visibility-seo-since.csv from the copy they
// downloaded last month. The older two keep their names; renaming them would
// change files people already have scripts and habits around, and this note is
// the record that the difference is deliberate rather than a drift.
//
// The then-and-now comparison is deliberately NOT a fifth table here. It
// already exists at /app/seo/export/since and /app/seo/export/written, reads
// the same two snapshot rows, and carries the same gate. A second route
// writing the same figures is the copy this app keeps not making.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isSeoUnlocked } from "../services/billing.server";
import { CSV_BOM } from "../services/report-metrics";
import { readSeoDashboardSource } from "../services/seo-dashboard.server";
import { allScanRows } from "../services/seo-aggregate.server";
import {
  dashboardDerived,
  exportFilename,
  findingsCsv,
  isExportTable,
  listingCsv,
  productFindingsCsv,
  shopWideCsv,
} from "../services/seo-report";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const table = params.table;
  if (!isExportTable(table)) {
    return new Response(
      "Unknown table. Ask for findings, shopwide, listing or products.\r\n",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the same key the dashboard itself requires. Four new paths to
  // this data, four gates, none of them behind a button.
  if (!shop || !(await isSeoUnlocked(shop.id))) {
    return new Response("This export needs the SEO module.\r\n", {
      status: 402,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const source = await readSeoDashboardSource(shop.id, session.shop, admin.graphql);
  const derived = dashboardDerived(source);
  const now = new Date();

  let body: string;
  if (table === "findings") {
    body = findingsCsv(source, now);
  } else if (table === "shopwide") {
    body = shopWideCsv(source, derived, now);
  } else if (table === "listing") {
    body = listingCsv(source, derived, now);
  } else {
    // The only table that needs the rows themselves rather than the
    // aggregates. Read a batch at a time, like every other full-catalogue read
    // in this app, so a 20,000-product shop never holds its scan table twice.
    const rows = await allScanRows(shop.id);
    body = productFindingsCsv(source, rows, now);
  }

  // The byte order mark for the same reason the other two exports carry one:
  // Excel on Windows opens a BOM-less UTF-8 file in the system code page, and
  // every one of these files carries Romanian product handles and sentences.
  return new Response(`${CSV_BOM}${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(source.domain, table, now)}"`,
    },
  });
};
