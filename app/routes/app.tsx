import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { activeSubscription, planFromName, recordPlan } from "../services/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * One gate, at the entrance (BILLING-SPEC §4). Without an active subscription
 * every page under /app redirects to the plans screen, so everything
 * downstream can assume a paying shop and stays free of plan conditionals.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  if (url.pathname !== "/app/plans") {
    const subscription = await activeSubscription(admin.graphql);

    if (!subscription) {
      await recordPlan(session.shop, "none");
      throw redirect("/app/plans");
    }

    // Keep our copy in step for display; Shopify remains the authority.
    const plan = planFromName(subscription.name);
    if (plan) {
      const shop = await db.shop.findUnique({ where: { domain: session.shop } });
      if (shop && shop.plan !== plan) await recordPlan(session.shop, plan);
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Products
        </Link>
        <Link to="/app/dictionary">Dictionary</Link>
        <Link to="/app/diagnostics">Diagnostics</Link>
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
