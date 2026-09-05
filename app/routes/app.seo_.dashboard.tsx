// The merchant-facing SEO dashboard (PRD-SEO-FULL-ONPAGE section 4.1 as
// amended 4 September 2026; the approved mockup
// _shopify/mockup-seo-dashboard.html is the specification, and where it and
// the PRD prose disagree the mockup wins).
//
// Why the file is named app.seo_.dashboard.tsx and not app.seo.dashboard.tsx.
// This app uses flatRoutes (app/routes.ts), where dots are path separators and
// a nested file renders *inside* its parent's component. app.seo.dashboard.tsx
// would therefore be a child of app.seo.tsx, the operator workspace, which
// renders no <Outlet /> - so the screen would either show nothing at all or,
// once an Outlet were added, show the whole operator workspace above it. The
// trailing underscore is the flat-routes escape from exactly that: the URL
// stays /app/seo/dashboard and the layout parent is app.tsx, which is what
// carries App Bridge and the navigation and is required for any embedded
// route. /app/seo itself is untouched by this file.
//
// The vocabulary rule this screen keeps, and the reason it is worth the two
// extra constants in seo-findings.ts: nothing here uses the words a search
// specification uses. A shop owner should not have to learn the name of the
// address a page declares as its own, or of the machine-readable block it
// carries, in order to find out that six of their photos are still called
// IMG_4821. Check codes never appear here either - they stay in the CSV and in
// the operator view, where somebody is being paid to know them.
//
// And the rule the whole app keeps: a check that could not run is a sentence,
// never a zero, and every figure carries the denominator it was measured over.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isSeoUnlocked } from "../services/billing.server";
import { readSeoDashboardSource } from "../services/seo-dashboard.server";
import {
  SeoDashboardScreen,
  type SeoDashboardData,
} from "../components/SeoDashboardScreen";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the loader itself refuses without seo_unlocked, not only the
  // navigation link - a URL can be typed directly, and this screen is the one
  // the SEO module is paid for. The printable report and the four exports are
  // separate routes and each repeats this gate in its own loader; the
  // enumeration is in PRD-SEO-FULL-ONPAGE section 4.4.
  const unlocked = shop ? await isSeoUnlocked(shop.id) : false;
  if (!unlocked || !shop) {
    return { unlocked: false as const };
  }

  // One read, shared with the report and the exports, so no two of the four
  // routes can assemble the same figures differently.
  const source = await readSeoDashboardSource(shop.id, session.shop, admin.graphql);
  return { unlocked: true as const, ...source };
};


/**
 * The screen itself is in app/components/SeoDashboardScreen.tsx, so it can be
 * rendered in a test; this route is the loader, the entitlement gate and one
 * line of assembly.
 */
export default function SeoDashboardRoute() {
  const data = useLoaderData<typeof loader>() as SeoDashboardData;
  return <SeoDashboardScreen data={data} />;
}
