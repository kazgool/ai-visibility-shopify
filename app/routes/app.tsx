import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  activeSubscription,
  isComped,
  isSeoUnlocked,
  planFromName,
  recordPlan,
} from "../services/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// FREE-TIER-SPEC §5: these three routes load without a subscription -
// dashboard (score, setup state), diagnostics (crawler check), and the
// products area (the three free writes "and to read what was published").
// Everything else keeps redirecting to the plans screen. Widen this list
// only by editing FREE-TIER-SPEC first.
//
// /app/products is matched as a prefix, not exactly: the product editor at
// /app/products/:id is part of "reading what was published" and must load
// for a free shop. Widening the entrance here is safe because the editor's
// own action enforces the per-product free-tier rules (free-product set
// membership, the cap, human-value protection) - the route gate was never
// the thing protecting writes. Diagnostics and the dashboard have no child
// paths today, so they stay exact.
const FREE_EXACT_ROUTES = ["/app", "/app/diagnostics"];
const FREE_PREFIX_ROUTES = ["/app/products"];

/**
 * One gate, at the entrance (BILLING-SPEC §4). Without an active subscription
 * every page under /app redirects to the plans screen, except the routes
 * allowlisted above, so everything else downstream can assume a paying shop
 * and stays free of plan conditionals.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const isFreeRoute =
    FREE_EXACT_ROUTES.includes(url.pathname) ||
    FREE_PREFIX_ROUTES.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    );

  if (url.pathname !== "/app/plans" && !isFreeRoute) {
    const shopRow = await db.shop.findUnique({ where: { domain: session.shop } });
    const comped = await isComped(session.shop, shopRow?.id);

    // A comped shop skips the Shopify check entirely: no subscription exists
    // and none is expected.
    if (!comped) {
      const subscription = await activeSubscription(admin.graphql);

      if (!subscription) {
        await recordPlan(session.shop, "none");
        // Keep the query string: embedded requests carry shop/host/embedded
        // there, and dropping them sends the next request to the login page.
        throw redirect(`/app/plans${url.search}`);
      }

      // Keep our copy in step for display; Shopify remains the authority.
      const plan = planFromName(subscription.name);
      if (plan && shopRow && shopRow.plan !== plan) {
        await recordPlan(session.shop, plan);
      }
    }
  }

  const shopRowForNav = await db.shop.findUnique({ where: { domain: session.shop } });
  const seoUnlocked = shopRowForNav ? await isSeoUnlocked(shopRowForNav.id) : false;

  return { apiKey: process.env.SHOPIFY_API_KEY || "", seoUnlocked };
};

export default function App() {
  const { apiKey, seoUnlocked } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/collections">Collections</Link>
        <Link to="/app/business">Business</Link>
        <Link to="/app/dictionary">Dictionary</Link>
        <Link to="/app/diagnostics">Diagnostics</Link>
        {seoUnlocked ? <Link to="/app/seo">SEO</Link> : null}
        <Link to="/app/plans">Plan</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
