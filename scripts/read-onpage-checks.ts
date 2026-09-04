// What checks B10 to B24 actually find on a live storefront, without touching
// anything (PRD-SEO-FULL-ONPAGE sections 3 and 5a, build step 4).
//
// It writes nothing at all: no row, no Setting, no metafield, no Shopify Admin
// request, and it does not spend the shop's daily page budget, because it does
// not go through the budget counter. That is deliberate - this is the tool for
// answering "what does this store's theme actually do", and a development tool
// that moved the merchant's allowance would change the thing it is measuring.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-onpage-checks.ts <origin> [--limit N] [--password P]
//
// The origin is the storefront's own address, e.g.
// https://mrdigital-dev.myshopify.com. Handles come from the shop's product
// sitemap, so the script needs neither the database nor an Admin token; on a
// store with a storefront password, pass it and the script unlocks once, the
// same way the nightly pass does.

import {
  fetchRobots,
  fetchSitemap,
  productsDisallow,
  readProductPage,
  readingOf,
  reviewRobots,
  PRODUCTS_PATH,
} from "../app/services/seo-page.server";
import { storefrontCookie } from "../app/services/theme-scan.server";
import {
  BLOG_POST_CAP,
  COLLECTION_PAGE_CAP,
  checkBlogPostLinks,
  countLinkForms,
  productLinks,
  titleKey,
  type LinkFormCount,
} from "../app/services/seo-onpage";
import { describeFinding } from "../app/services/seo-aggregate";
import { CHECK_LABEL } from "../app/services/seo-findings";
import type { Finding } from "../app/services/seo-findings";

const args = process.argv.slice(2);
const origin = args.find((a) => a.startsWith("http")) ?? "";
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 10;
const passwordArg = args.indexOf("--password");
const password = passwordArg >= 0 ? args[passwordArg + 1] : null;

async function main() {
  if (!origin) {
    console.error("read-onpage-checks: give the storefront origin.");
    console.error("  npx tsx scripts/read-onpage-checks.ts https://shop.myshopify.com --limit 10");
    process.exit(1);
  }

  console.log(`Origin: ${origin}`);
  console.log(`Reading at most ${limit} product pages. Nothing is written.`);
  console.log("");

  const robots = await fetchRobots(origin);
  const blocked = robots.fetched ? productsDisallow(robots.content) : null;
  const review = reviewRobots(robots);
  console.log(
    `robots.txt: ${robots.fetched ? "read" : "not readable"}` +
      (robots.fetched
        ? `, ${review.defaults.length} lines Shopify ships, ${review.custom.length} it does not recognise` +
          (review.blocking.length > 0
            ? `, blocking ${review.blocking.map((b) => b.path).join(" and ")}`
            : ", blocking neither /products/ nor /collections/")
        : ""),
  );
  if (blocked) {
    console.log(`  Disallow ${blocked} covers ${PRODUCTS_PATH}: the nightly pass would fetch nothing.`);
  }

  const cookie = password ? await storefrontCookie(origin, password) : null;
  console.log(`Storefront password: ${password ? (cookie ? "unlocked" : "refused") : "not given"}`);

  // The same unlock the pages get. Writing this script is how it was noticed
  // that the nightly pass did not do it (4 September 2026): `fetchSitemap` was
  // called with the plain fetch, so on any shop with a storefront password the
  // file answered with the password form and A7 reported nothing at all. The
  // pass now takes a `cookie` option and this script and it read the same way.
  const sitemap = await fetchSitemap(origin, fetch, { cookie });
  if (!sitemap.read) {
    console.log(`No product sitemap: ${sitemap.error}. Nothing to read.`);
    return;
  }
  const handles = [...sitemap.read.handles].sort().slice(0, limit);
  console.log(`Sitemap: ${sitemap.read.urls} product URLs, reading ${handles.length}.`);
  console.log("");

  // B25: the collection pages first, exactly as the nightly pass reads them,
  // because every product row needs the answer before it is written. This
  // script spends no budget, but it reads in the same order so what it prints
  // is what the pass would find.
  const collectionUrls = (sitemap.read.collections ?? []).slice(0, COLLECTION_PAGE_CAP);
  const linkForms = new Map<string, LinkFormCount>();
  let collectionPagesRead = 0;
  let longLinks = 0;
  let shortLinks = 0;
  for (const url of collectionUrls) {
    const page = await readProductPage(url, cookie);
    if (page.status !== 200 || page.passwordProtected || page.error) continue;
    collectionPagesRead += 1;
    const links = productLinks(page.html, page.finalUrl);
    const counts = countLinkForms(links);
    longLinks += counts.long;
    shortLinks += counts.short;
    for (const link of links) {
      const seen = linkForms.get(link.handle) ?? { long: 0, short: 0 };
      if (link.long) seen.long += 1;
      else seen.short += 1;
      linkForms.set(link.handle, seen);
    }
  }
  console.log(
    `Collection pages: ${(sitemap.read.collections ?? []).length} in the sitemap, ${collectionPagesRead} read; ` +
      `${longLinks} collection-prefixed product links, ${shortLinks} plain.`,
  );
  console.log("");

  const titlesByKey = new Map<string, string[]>();
  const byCode = new Map<string, { count: number; example: Finding }>();
  let read = 0;
  let couldNotBeRead = 0;

  for (const handle of handles) {
    const page = await readProductPage(`${origin}${PRODUCTS_PATH}${handle}`, cookie);
    const reading = readingOf(page, null, {
      handle,
      markets: null,
      sitemap: sitemap.read,
      robots: review,
      titlesByKey,
      // Link checks are not made here: they would multiply this script's
      // requests to the merchant's storefront by twenty, and it is a read.
      links: null,
      linkForms: linkForms.get(handle),
    });
    if (reading.status !== "ok") {
      couldNotBeRead += 1;
      console.log(`  ${handle}: ${reading.status}`);
      continue;
    }
    read += 1;
    if (reading.pageTitle) {
      const key = titleKey(reading.pageTitle);
      titlesByKey.set(key, [...(titlesByKey.get(key) ?? []), handle]);
    }
    for (const finding of reading.findings) {
      const entry = byCode.get(finding.code);
      if (entry) entry.count += 1;
      else byCode.set(finding.code, { count: 1, example: finding });
    }
  }

  console.log("");
  console.log(`Pages read as a crawler sees them: ${read}. Could not be read: ${couldNotBeRead}.`);
  console.log("");
  if (read === 0) {
    console.log("No page answered, so no check ran. Nothing here is a finding of zero.");
    return;
  }
  console.log("Findings, count of pages read:");
  for (const [code, entry] of [...byCode.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  )) {
    const label = CHECK_LABEL[code as keyof typeof CHECK_LABEL] ?? code;
    console.log(`  ${code.padEnd(4)} ${String(entry.count).padStart(3)} of ${read}  ${label}`);
    console.log(`       example: ${describeFinding(entry.example)}`);
  }
  // B30 last, as the pass reads it and for the same reason.
  const articles = (sitemap.read.articles ?? []).slice(0, BLOG_POST_CAP);
  let postsRead = 0;
  let postsWithoutLinks = 0;
  for (const url of articles) {
    const page = await readProductPage(url, cookie);
    if (page.status !== 200 || page.passwordProtected || page.error) continue;
    postsRead += 1;
    if (checkBlogPostLinks(page.html, page.finalUrl)) postsWithoutLinks += 1;
  }
  console.log("");
  console.log(
    postsRead === 0
      ? `B30   no blog post was read (${(sitemap.read.articles ?? []).length} in the sitemap), so nothing is reported about the blog`
      : `B30   ${postsWithoutLinks} of ${postsRead}  ${CHECK_LABEL.B30}`,
  );

  const silent = Object.keys(CHECK_LABEL).filter((code) => !byCode.has(code));
  console.log("");
  console.log(`Checks that raised nothing on these pages: ${silent.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
