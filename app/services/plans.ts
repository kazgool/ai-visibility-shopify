// Plan definitions, safe to import from the browser.
//
// Deliberately not in billing.server.ts: that file holds the master key check
// and Shopify mutations, and Remix only strips server code from loader and
// action, not from a component. Importing it in the UI would ship secrets to
// the browser.

export type PlanHandle = "standard" | "high_volume";

export const PLANS: Record<
  PlanHandle,
  { name: string; amount: number; limit: number | null; blurb: string }
> = {
  standard: {
    name: "Standard",
    amount: 99,
    limit: 20000,
    blurb: "Everything the app does, for catalogues up to 20,000 products.",
  },
  high_volume: {
    name: "High volume",
    amount: 149,
    limit: null,
    blurb: "The same features for larger catalogues, with priority support.",
  },
};
