// The printable report at /app/seo/dashboard/print (PRD-SEO-FULL-ONPAGE
// section 4.3, build step 6).
//
// Why the filename carries two trailing underscores. Under flatRoutes, dots
// are path separators and a nested file renders inside its parent's component.
// app.seo.dashboard.print.tsx would be a grandchild of app.seo.tsx, the
// operator workspace, which renders no <Outlet />; app.seo_.dashboard.print
// would be a child of the dashboard screen, which renders no <Outlet /> either.
// Both would show nothing. With `dashboard_` the layout parent is app.tsx,
// which is what carries App Bridge and the subscription gate, and the URL is
// unchanged.
//
// Being a child of app.tsx is deliberate rather than incidental: it is what
// puts this route on the same authenticated, embedded path the dashboard
// itself uses. See the long comment in SeoPrintReport.tsx for why the report
// is not opened in a new top-level tab.
//
// The loader reads exactly what the dashboard loader reads, through the same
// functions, and hands it to a component that computes nothing of its own.
// That is the mechanism behind "the same figure on the report and on the
// screen cannot diverge": neither page derives a figure.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isSeoUnlocked } from "../services/billing.server";
import { readSeoDashboardSource } from "../services/seo-dashboard.server";
import { SeoPrintReport, type SeoPrintData } from "../components/SeoPrintReport";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: this route is a second path to the dashboard's data, so it
  // carries the dashboard's gate in its own loader. A URL can be typed, and a
  // gate that lives only on the button that links here is not a gate.
  const unlocked = shop ? await isSeoUnlocked(shop.id) : false;
  if (!unlocked || !shop) {
    return { unlocked: false as const };
  }

  const source = await readSeoDashboardSource(shop.id, session.shop, admin.graphql);
  return {
    unlocked: true as const,
    domain: source.domain,
    findings: source.findings,
    readiness: source.readiness,
    blockedBy: source.blockedBy,
    since: source.since,
    business: source.business,
    published: source.published,
    producedAt: new Date().toISOString(),
  };
};

export default function SeoPrintRoute() {
  const data = useLoaderData<typeof loader>() as SeoPrintData;
  return <SeoPrintReport data={data} />;
}
