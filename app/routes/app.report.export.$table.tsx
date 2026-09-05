import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { hasPaidAccess } from "../services/billing.server";
import { CSV_BOM, familiesCsv, readPass, weakestCsv } from "../services/report-metrics";
import { exportFilename } from "../services/seo-report";

// The Report screen's CSV export (PRD-REPORT-SCREEN section 8).
//
// It lives here, on its own, because a route that exports a default component
// is a UI route: Remix takes whatever its loader returns, treats it as data for
// that component, and renders the component. A `new Response(csv)` returned
// from the loader of a route with a default export therefore never reaches the
// browser as a file - the merchant presses the button and gets the screen back.
// A route with no default export is a resource route, and its loader's Response
// is sent as it stands, headers and all.
//
// The gate is repeated here rather than inherited. Remix serves a resource
// route by running that route's loader alone, so nothing above it in the tree -
// including the plan gate in app.tsx - runs on this request. An entitlement
// that is only enforced by a parent is not enforced at all on this path.
//
// The figures come through readPass, the same door the screen uses, so the file
// and the tables it is named after are computed once and cannot drift apart.

const TABLES = ["families", "weakest"] as const;
type Table = (typeof TABLES)[number];

function isTable(value: string | undefined): value is Table {
  return value !== undefined && (TABLES as readonly string[]).includes(value);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const table = params.table;
  if (!isTable(table)) {
    return new Response("Unknown table. Ask for families or weakest.\r\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the same gate as the screen itself (FREE-TIER-SPEC section 3).
  // The export reads across the whole catalogue and is not part of the free
  // tier.
  const paid = await hasPaidAccess(session.shop, shop?.id, admin.graphql);
  if (!paid) {
    return new Response("This export needs a subscription.\r\n", {
      status: 402,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const passJob = shop
    ? await db.jobRun.findFirst({
        where: { shopId: shop.id, kind: { in: ["dry_run", "bulk_extract"] } },
        orderBy: { startedAt: "desc" },
      })
    : null;

  const pass = readPass(
    passJob
      ? {
          status: passJob.status,
          report: passJob.report,
          startedAt: passJob.startedAt?.toISOString() ?? null,
          finishedAt: passJob.finishedAt?.toISOString() ?? null,
        }
      : null,
  );

  if (pass.state !== "done") {
    return new Response("No completed pass to export.\r\n", {
      status: 409,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const body =
    table === "families"
      ? familiesCsv(pass.figures.byAttr, pass.figures.sampled, pass.figures.byAttrProducts)
      : weakestCsv(
          pass.figures.weakest ?? [],
          pass.figures.byAttr,
          pass.figures.byAttr.length,
        );

  // The byte order mark goes on here rather than inside familiesCsv/weakestCsv,
  // so those two stay string builders that can be asserted on directly. Excel
  // on Windows opens a BOM-less UTF-8 file in the system code page, and both
  // tables carry Romanian family names and product titles.
  // Named like every other download of this app: the shop, the table and the
  // date, so two files on one desktop can be told apart (5 September 2026).
  return new Response(`${CSV_BOM}${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(session.shop, table, new Date(), "report")}"`,
    },
  });
};
