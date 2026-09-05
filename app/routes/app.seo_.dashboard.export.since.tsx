// The merchant dashboard's then-and-now spreadsheet, at
// /app/seo/dashboard/export/since (QA of 5 September 2026, R1 2.4 and R2-12).
//
// Its own file beside app.seo_.dashboard.export.$table.tsx rather than a
// fifth name in that route's table, because it reads different rows: the two
// snapshot rows, not the scan aggregates. Under flatRoutes a static segment
// wins over a dynamic one, so this file answers /since and the $table route
// keeps answering the other four.
//
// Why it exists at all. The dashboard's "Spreadsheet: then and now" button
// pointed at /app/seo/export/since, the operator's file: FIGURES labels
// ("Meta titles", "Products with a barcode (GTIN)", "Pages where the theme
// emits a Product node"), one row per check code with the code as its prefix,
// ISO dates and "by unlock". A merchant pressing a button on the merchant
// screen received every word that screen exists to keep out. This route writes
// the same two rows in the words the dashboard uses (OWNER_FIGURE_LABEL,
// OWNER_WRITTEN_LABEL, formatDay), carries the shop and the date in its
// filename like the other four merchant files, and leaves the operator route
// exactly as it was.
//
// Same two rules as every other export here: no default export, so the
// Response reaches the browser as a file; and the entitlement is checked in
// this loader, because Remix runs a resource route's loader alone.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isSeoUnlocked } from "../services/billing.server";
import { CSV_BOM } from "../services/report-metrics";
import { readSeoDashboardSource } from "../services/seo-dashboard.server";
import { exportFilename, reportHeading } from "../services/seo-report";
import { ownerSinceCsv } from "../services/seo-since";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the same key the dashboard itself requires, in this loader.
  if (!shop || !(await isSeoUnlocked(shop.id))) {
    return new Response("This export needs the SEO module.\r\n", {
      status: 402,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const source = await readSeoDashboardSource(shop.id, session.shop, admin.graphql);

  // No starting point, no comparison. A file of today's figures under a
  // heading that says "since" would be read as a difference by whoever opens
  // it, and that is exactly the claim there is no evidence for. The dashboard
  // shows the button only when a starting point exists, so this answer is for
  // a typed URL.
  if (!source.since.before) {
    return new Response(
      "No starting point has been recorded for this shop, so there is nothing to compare today against.\r\n",
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const now = new Date();
  const body = ownerSinceCsv(reportHeading(source, now), source.since.before, source.since.today);

  return new Response(`${CSV_BOM}${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(source.domain, "since", now)}"`,
    },
  });
};
