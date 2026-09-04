// Read-only. How many of our app-embed blocks the published theme actually
// carries, and how many of them would render.
//
// Written 4 September 2026 to settle one question. The row read the same day
// showed two Product nodes and two Organization nodes on every product page,
// both of them ours, merged to one each by `@id` and therefore invisible to
// B1. Two causes are possible and they belong to different people: the embed
// enabled twice in the merchant's theme, which the app cannot fix and must
// report, or one enable rendering the block twice, which is ours.
// `checkAppEmbed` counts instances from this date, and this prints the count.
//
// One GraphQL query (`themes(first: 1, roles: [MAIN])` and one theme file), no
// write of any kind, and no page fetch.
//
//   cd F:\ai-visibility-shopify
//   npx tsx scripts/read-app-embed.ts <shop-domain>
//
// Without a domain it picks the single installed shop and refuses to guess when
// there is more than one. It prints counts, flags and the theme's name - no
// product data, and not the settings file itself.

import db from "../app/db.server";
import { adminGraphql } from "../app/services/admin.server";
import { checkAppEmbed } from "../app/services/embed-check.server";
import { describeGraphqlError } from "../app/services/graphql-errors";

async function main() {
  const wanted = process.argv[2];
  const shops = await db.shop.findMany({ where: { uninstalledAt: null } });
  const shop = wanted
    ? shops.find((s: { domain: string }) => s.domain === wanted)
    : shops.length === 1
      ? shops[0]
      : null;
  if (!shop) {
    console.log(
      wanted
        ? `No installed shop with domain ${wanted}.`
        : `Expected one installed shop, found ${shops.length}. Pass the domain as an argument.`,
    );
    await db.$disconnect();
    return;
  }

  console.log(`READ ONLY: one Admin query, no write. Shop: ${shop.domain}`);

  const graphql = await adminGraphql(shop.domain);
  const embed = await checkAppEmbed(async (query, options) => {
    const data = await graphql<any>(query, (options?.variables ?? {}) as any);
    return new Response(JSON.stringify({ data }));
  });

  console.log("");
  console.log(`  published theme     ${embed.themeName ?? "(unknown)"} (${embed.themeId ?? "-"})`);
  console.log(`  settings readable   ${embed.unreadable ? "no" : "yes"}`);
  console.log(`  our blocks present  ${embed.instances}`);
  console.log(`  of those, rendering ${embed.activeInstances}`);
  console.log(`  active              ${embed.active}`);
  console.log(`  presentButDisabled  ${embed.presentButDisabled}`);
  console.log(`  staleReference      ${embed.staleReference}`);
  console.log(`  mode                ${embed.mode}`);
  console.log(`  output switched off ${embed.outputDisabled}`);

  console.log("");
  if (embed.unreadable) {
    console.log("The settings file could not be read, so nothing here is certain.");
  } else if (embed.activeInstances > 1) {
    console.log(
      `The theme renders our block ${embed.activeInstances} times. Each render emits the ` +
        `whole block again, which is why every product page carried two Product nodes ` +
        `and two Organization nodes. This is in the merchant's theme, not in our code.`,
    );
  } else if (embed.activeInstances === 1) {
    console.log(
      "The theme renders our block exactly once. Two of each node on the page therefore " +
        "came from one render, which is ours to fix.",
    );
  } else {
    console.log("Our block does not render in this theme at all.");
  }

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(describeGraphqlError(error, "read-app-embed"));
  await db.$disconnect();
  process.exit(1);
});
