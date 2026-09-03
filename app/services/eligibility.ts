// Which product states are put in front of AI, and the merchant's two
// toggles over that decision (PRD-PORT-1.7.8 section J).
//
// Pure, and deliberately without the `.server` suffix: the Report screen
// renders the labels, the help text and the refusal sentence from the same
// constants the writers decide from, so a merchant can never be told one
// rule while another one is applied. The database half - reading and writing
// the two Setting rows - lives in eligibility.server.ts.
//
// This replaces isEligibleForMirror(), which treated a missing status as
// eligible because the bulk fetch path used to leave the field unset. Both
// fetch paths now carry it, so an undefined status is decided the safe way
// instead: a page not created can be created by the next pass, while a page
// created for a draft is a false claim until someone notices.

export type PublishPrefs = {
  /**
   * Default true. Out of stock is a public, temporary state the shop itself
   * shows, so hiding it would be this app deciding something the merchant
   * did not.
   */
  includeOutOfStock: boolean;
  /**
   * Default false. Unlisted is the merchant's own decision to hide, so
   * publishing it by default would undo that decision.
   */
  includeUnlisted: boolean;
};

export const DEFAULT_PREFS: PublishPrefs = {
  includeOutOfStock: true,
  includeUnlisted: false,
};

export type Verdict =
  | "eligible"
  /** DRAFT, ARCHIVED, or a status we were not given. */
  | "not-active"
  /** ACTIVE or UNLISTED but with no Online Store address. */
  | "not-on-online-store"
  /** UNLISTED while the merchant excludes unlisted products. */
  | "unlisted-excluded"
  /** No variant can be ordered while the merchant excludes sold-out ones. */
  | "out-of-stock-excluded";

export type EligibilityInput = {
  status?: string;
  onlineStoreUrl?: string | null;
  /**
   * True when at least one variant can be ordered right now. Undefined when
   * no variant rows were in hand, which is not the same as false: unknown is
   * never treated as out of stock.
   */
  available?: boolean;
};

/**
 * The one decision function. The order of the checks is the order of the
 * Verdict union, and the first that applies is the verdict, so a draft is
 * reported as a draft rather than as "unlisted excluded" or "out of stock".
 *
 * UNLISTED is a real fourth ProductStatus since API version 2025-10: the
 * product is active but only a direct link reaches it, and it does not show
 * up in search, collections or recommendations. It never overrides
 * publication - an unlisted product with no Online Store address still has
 * no public URL for a text page to point at.
 */
export function eligibility(p: EligibilityInput, prefs: PublishPrefs): Verdict {
  const status = (p.status ?? "").toUpperCase();
  if (status !== "ACTIVE" && status !== "UNLISTED") return "not-active";
  if (!p.onlineStoreUrl) return "not-on-online-store";
  if (status === "UNLISTED" && !prefs.includeUnlisted) return "unlisted-excluded";
  if (p.available === false && !prefs.includeOutOfStock) return "out-of-stock-excluded";
  return "eligible";
}

/**
 * The `query` argument of the bulk products export and of every other read
 * that must see the same set.
 *
 * Out of stock is deliberately never in the query: the bulk read has to
 * return sold-out products so their rows can be withdrawn when the toggle is
 * off, and so their metafields keep being maintained either way. Unlisted is
 * in the query, because "off also means they are not read by the catalogue
 * pass" is what the help text promises.
 */
export function catalogueQuery(prefs: PublishPrefs): string {
  const status = prefs.includeUnlisted ? "status:active,unlisted" : "status:active";
  return `${status} AND published_status:published`;
}

// The copy. Kept here so the screen and the writers cannot drift apart, and
// so every sentence can be asserted on without a browser.

export const OUT_OF_STOCK_LABEL = "Include products that are out of stock";

export const OUT_OF_STOCK_HELP =
  "Sold-out products keep their text page and their llms.txt entry. The page " +
  "states availability as of its last update, so an assistant reading it is " +
  "told the product is out of stock; it is not hidden. Turn this off to " +
  "withdraw those pages until stock returns.";

export const UNLISTED_LABEL = "Include unlisted products";

export const UNLISTED_HELP =
  "Unlisted products are ones you hid from search, collections and " +
  "recommendations in Shopify; only a direct link reaches them. Off keeps " +
  "them out of the text pages and llms.txt as well. On gives them a text " +
  "page and an llms.txt entry, which makes them findable by assistants. Off " +
  "also means they are not read by the catalogue pass.";

/** What "out of stock" means here, stated where the toggle is. */
export const OUT_OF_STOCK_MEANING =
  "Out of stock means no variant can be ordered right now, which is " +
  "Shopify's own rule and includes products that continue selling at zero.";

/** A refusal with a reason, not a toggle set to off. */
export const NEVER_GIVEN_A_PAGE =
  "Never given a page: drafts, archived products, and products that are " +
  "active but not published to the Online Store. None of them has a public " +
  "address, so a text page for them would point at nothing.";

export const TOGGLES_METHOD_LINE =
  "Both apply to the text pages and to llms.txt and agents.md, which list " +
  "the same pages. Structured data on the product page follows the page: it " +
  "renders wherever Shopify renders the product. Changing either setting " +
  "withdraws pages that no longer qualify within the next minute and adds " +
  "newly qualifying pages after the next catalogue pass.";

/** Section I.4: how a page comes to be withdrawn at all. */
export const WITHDRAWAL_METHOD_LINE =
  "A page is withdrawn the moment its product stops being active and " +
  "published, and again by a weekly check that reads the whole catalogue; " +
  "that check deletes nothing when Shopify's download was short, and says so " +
  "in the job log.";
