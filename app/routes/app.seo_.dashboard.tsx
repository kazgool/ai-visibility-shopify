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
import { named } from "../services/graphql-errors";
import { readSeoDashboard } from "../services/seo-aggregate.server";
import { dailyBudget, robotsBlock, blogPostReport } from "../services/seo-page.server";
import { readCurrentFacts, readSeoSnapshot, serialiseFacts } from "../services/seo-snapshot.server";
import { businessFor } from "../services/business.server";
import { isQueueUsable } from "../services/seo-queue-metrics";
import type { CollectionSeoQueue } from "../services/seo-collections.server";
import type { FactsRow } from "../services/seo-since";
import {
  SeoDashboardScreen,
  type SeoDashboardData,
} from "../components/SeoDashboardScreen";

const PRIMARY_DOMAIN = `#graphql
  query PrimaryDomainSeoDashboard {
    shop { primaryDomain { host } }
  }
`;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  // ENTITLEMENT: the loader itself refuses without seo_unlocked, not only the
  // navigation link - a URL can be typed directly, and this screen is the one
  // the SEO module is paid for. There is no action and no resource route on
  // this file, so this is the only path to this data; the exports the mockup
  // shows are build step 6 and will carry the same gate.
  const unlocked = shop ? await isSeoUnlocked(shop.id) : false;
  if (!unlocked || !shop) {
    return { unlocked: false as const };
  }

  const [dashboard, budget, blockedBy, beforeRow, currentRow, business, blogPosts, collectionJob] =
    await Promise.all([
      readSeoDashboard(shop.id),
      dailyBudget(shop.id),
      robotsBlock(shop.id),
      readSeoSnapshot(shop.id),
      readCurrentFacts(shop.id),
      businessFor(shop.id),
      blogPostReport(shop.id),
      db.jobRun.findFirst({
        where: { shopId: shop.id, kind: "seo_collection_queue" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  // The last scan of the published theme, for "what your pages publish about
  // each product". One page, and the card says so: this read is a sample and
  // has never claimed to be the catalogue.
  const themeScan = await db.themeScan.findFirst({
    where: { shopId: shop.id },
    orderBy: { scannedAt: "desc" },
  });

  // The name the merchant knows their shop by, rather than the myshopify one.
  // One Admin call, and a failure falls back rather than breaking the screen.
  let domain = session.shop;
  try {
    const res = await named("PrimaryDomainSeoDashboard", () => admin.graphql(PRIMARY_DOMAIN));
    const json = await res.json();
    domain = json.data?.shop?.primaryDomain?.host ?? session.shop;
  } catch {
    domain = session.shop;
  }

  const collectionView = collectionJob
    ? {
        status: collectionJob.status,
        finishedAt: collectionJob.finishedAt?.toISOString() ?? null,
        report: collectionJob.report,
      }
    : null;

  const detail = (themeScan?.detail ?? null) as {
    missingReasons?: { nodeType: string; emitted: boolean; reason: string | null }[];
  } | null;

  return {
    unlocked: true as const,
    domain,
    findings: dashboard.findings,
    themeNodes: dashboard.themeNodes,
    readiness: dashboard.readiness,
    budget,
    blockedBy,
    since: {
      before: beforeRow ? (serialiseFacts(beforeRow) as FactsRow) : null,
      today: currentRow ? (serialiseFacts(currentRow) as FactsRow) : null,
    },
    business: business
      ? {
          deliveryStated: Boolean(
            (business.deliveryTime ?? "").trim() || (business.deliveryCost ?? "").trim(),
          ),
          returnsStated: typeof business.returnDays === "number" && business.returnDays > 0,
        }
      : null,
    blogPosts,
    collections: isQueueUsable(collectionView)
      ? ((collectionJob!.report ?? null) as CollectionSeoQueue | null)
      : null,
    published: {
      at: themeScan?.scannedAt?.toISOString() ?? null,
      reasons: Array.isArray(detail?.missingReasons) ? detail!.missingReasons! : [],
    },
  };
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
