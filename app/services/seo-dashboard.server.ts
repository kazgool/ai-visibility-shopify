// One read for the merchant SEO dashboard, its printable report and its
// exports (PRD-SEO-FULL-ONPAGE sections 4.1 and 4.3).
//
// This was the body of app.seo_.dashboard.tsx's loader until a second and a
// third route needed the same figures. Copying it would have been three copies
// of the assembly that decides, among other things, which source answers "has
// the catalogue been read" - a question two cards on the screen already
// answered differently once. There is one copy, and the routes are a gate, a
// call and a component.

import db from "../db.server";
import { named } from "./graphql-errors";
import { readSeoDashboard } from "./seo-aggregate.server";
import { dailyBudget, robotsBlock, blogPostReport } from "./seo-page.server";
import { readCurrentFacts, readSeoSnapshot, serialiseFacts } from "./seo-snapshot.server";
import { businessFor } from "./business.server";
import { isQueueUsable } from "./seo-queue-metrics";
import type { CollectionSeoQueue } from "./seo-collections.server";
import type { FactsRow } from "./seo-since";
import type { FindingsAggregate, ThemeNodeAggregate } from "./seo-aggregate";
import type { Readiness } from "./seo-readiness";

const PRIMARY_DOMAIN = `#graphql
  query PrimaryDomainSeoDashboard {
    shop { primaryDomain { host } }
  }
`;

export type SeoDashboardSource = {
  domain: string;
  findings: FindingsAggregate;
  themeNodes: ThemeNodeAggregate;
  readiness: Readiness;
  budget: number;
  blockedBy: string | null;
  since: { before: FactsRow | null; today: FactsRow | null };
  business: { deliveryStated: boolean; returnsStated: boolean } | null;
  blogPosts: { read: number; withoutLinks: number } | null;
  collections: CollectionSeoQueue | null;
  published: {
    at: string | null;
    reasons: { nodeType: string; emitted: boolean; reason: string | null }[];
  };
};

// The Admin client the callers already hold. Typed structurally so this module
// does not have to import the Shopify types a route already has to hand.
type GraphqlClient = (query: string, options?: { variables?: object }) => Promise<Response>;

export async function readSeoDashboardSource(
  shopId: string,
  sessionShop: string,
  graphql: GraphqlClient,
): Promise<SeoDashboardSource> {
  const [dashboard, budget, blockedBy, beforeRow, currentRow, business, blogPosts, collectionJob] =
    await Promise.all([
      readSeoDashboard(shopId),
      dailyBudget(shopId),
      robotsBlock(shopId),
      readSeoSnapshot(shopId),
      readCurrentFacts(shopId),
      businessFor(shopId),
      blogPostReport(shopId),
      db.jobRun.findFirst({
        where: { shopId, kind: "seo_collection_queue" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  // The last scan of the published theme, for "what your pages publish about
  // each product". One page, and the card says so: this read is a sample and
  // has never claimed to be the catalogue.
  const themeScan = await db.themeScan.findFirst({
    where: { shopId },
    orderBy: { scannedAt: "desc" },
  });

  // The name the merchant knows their shop by, rather than the myshopify one.
  // One Admin call, and a failure falls back rather than breaking the screen.
  let domain = sessionShop;
  try {
    const res = await named("PrimaryDomainSeoDashboard", () => graphql(PRIMARY_DOMAIN));
    const json = await res.json();
    domain = json.data?.shop?.primaryDomain?.host ?? sessionShop;
  } catch {
    domain = sessionShop;
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
}
