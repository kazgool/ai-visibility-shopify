import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isSeoUnlocked } from "../services/billing.server";
import {
  readCurrentFacts,
  readSeoSnapshot,
  serialiseFacts,
} from "../services/seo-snapshot.server";
import { sinceCsv, writtenCsv, type FactsRow } from "../services/seo-since";
import { CSV_BOM } from "../services/report-metrics";
import { exportFilename } from "../services/seo-report";

// The since-card's CSVs (PRD-SEO-FULL-ONPAGE section 1.3). Same pattern as
// app.report.export.$table.tsx, and the two reasons that route gives for its
// shape apply here unchanged:
//
//  - No default export, so this is a resource route and the loader's Response
//    reaches the browser as a file. A route with a default export renders the
//    component instead, and the merchant presses the button and gets a screen.
//  - The entitlement is repeated here rather than inherited. Remix runs a
//    resource route's loader alone, so nothing above it in the tree runs on
//    this request, and a gate enforced only by a parent is not enforced at all
//    on this path.
//
// The figures come from the same two rows the screen reads, flattened by the
// same `serialiseFacts`, so the file and the card cannot drift apart.

const TABLES = ["since", "written"] as const;
type Table = (typeof TABLES)[number];

function isTable(value: string | undefined): value is Table {
  return value !== undefined && (TABLES as readonly string[]).includes(value);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const table = params.table;
  if (!isTable(table)) {
    return new Response("Unknown table. Ask for since or written.\r\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the same key the screen itself requires. The SEO module is a
  // separately billed engagement, and this file is what goes on the invoice.
  if (!shop || !(await isSeoUnlocked(shop.id))) {
    return new Response("This export needs the SEO module.\r\n", {
      status: 402,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const [beforeRow, currentRow] = await Promise.all([
    readSeoSnapshot(shop.id),
    readCurrentFacts(shop.id),
  ]);

  // No before, no comparison. A file of today's figures under a heading that
  // says "since" would be read as a difference by whoever opens it, and that
  // is exactly the claim there is no evidence for.
  if (!beforeRow) {
    return new Response(
      "No before snapshot exists for this shop, so there is nothing to compare today against.\r\n",
      { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const before = serialiseFacts(beforeRow) as FactsRow;
  const today = currentRow ? (serialiseFacts(currentRow) as FactsRow) : null;
  const body = table === "since" ? sinceCsv(before, today) : writtenCsv(before, today);

  // The byte order mark for the same reason the Report export carries one:
  // Excel on Windows opens a BOM-less UTF-8 file in the system code page.
  // The shop and the date in the name, like every other download; the
  // "seo-operator" module keeps this per-code file apart from the merchant
  // dashboard's since file, which shares the table name (5 September 2026).
  return new Response(`${CSV_BOM}${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(session.shop, table, new Date(), "seo-operator")}"`,
    },
  });
};
