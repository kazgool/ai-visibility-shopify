// App embed verification (LAUNCH-PLAN: onboarding refuses success until the
// embed is verified active).
//
// A theme app extension that is installed but not enabled renders nothing,
// and the merchant has no way to notice: the app looks configured, the
// storefront stays silent. So we do not trust our own setup flow - we read
// the published theme's config/settings_data.json through the Admin API and
// look for our embed block actually enabled. Server side, works behind
// storefront passwords, GraphQL only.

import { named } from "./graphql-errors";

export type EmbedCheckResult = {
  /** Our embed block is present in the published theme and not disabled. */
  active: boolean;
  /** Present but switched off - the merchant got halfway. */
  presentButDisabled: boolean;
  /**
   * Enabled, but pointing at an extension uid that is not the released one -
   * typically saved while a dev preview was active. The theme then logs
   * "app block path does not exist" and renders nothing, while the settings
   * file still says enabled. Verification must compare uids, not handles,
   * or it certifies a corpse.
   */
  staleReference: boolean;
  themeId: string | null;
  themeName: string | null;
  /** The settings file could not be read; unknown is not "off". */
  unreadable?: boolean;
  /**
   * The block's own `mode` setting, extend or full, as the merchant saved it.
   *
   * Read here from 4 September 2026, for check B6. Until then the one caller
   * that needed a mode hardcoded `mode: "extend"` (app.seo.tsx), so a shop in
   * Full mode was told its Product node was missing whenever the product had
   * no facts - which in Full mode is emitted regardless. "unknown" when the
   * settings file could not be read or our block is not in it, and unknown is
   * never treated as either mode.
   */
  mode: "extend" | "full" | "unknown";
  /**
   * The merchant switched "Enable AI Visibility output" off inside an embed
   * that is otherwise active. A deliberate choice, and the difference between
   * "this node should be here and is not" and "you turned it off" (B6).
   */
  outputDisabled: boolean;
  /**
   * How many of our app-embed blocks are in the published theme at all,
   * enabled or not, and how many would actually render.
   *
   * Counted from 4 September 2026. The loop below always visited every block -
   * it never broke early - but it recorded only booleans, so a theme carrying
   * our embed twice looked exactly like a theme carrying it once. That is how
   * five product pages came to hold two Product nodes and two Organization
   * nodes, both of them ours, merged to one each by `@id` and therefore
   * invisible to B1 (see the row read of 4 September 2026). More than one
   * `activeInstances` is a defect whichever side caused it: CLAUDE.md's rule
   * is that our output never produces a second complete Product node.
   */
  instances: number;
  activeInstances: number;
  /**
   * B32's other half: every app embed block in the published theme, ours and
   * everyone else's, counted by the app handle in the block type.
   *
   * Read here because it is already in the file this function parses, and
   * because it cannot be read from a page at all: an embed that is present and
   * switched off renders nothing, so HTML shows the absence of a block that
   * exists. Counts only, never a verdict - Break The Web's ghost code is the
   * practice behind the row, and which of a shop's apps it wants is entirely
   * the merchant's business.
   *
   * Absent when the settings file could not be read, which is not the same as
   * a theme with no embeds and must not render as one.
   */
  appEmbeds?: { total: number; enabled: number; byApp: { app: string; count: number }[] };
};

// The block type in settings_data.json contains the extension uid
// (shopify://apps/<app>/blocks/<handle>/<uid>).
//
// Two different uids exist and confusing them cost an afternoon: the local
// toml uid (1fba957a...) is only a workspace identifier; Shopify assigns the
// released extension its own uid at first deploy, and THAT is what themes
// reference. A dev preview references a third, temporary uid - which is how
// "enabled" can still render nothing. Verified against the published theme
// on 3 Aug 2026; if this ever goes stale, read the current value from
// settings_data.json of a working install.
const EXTENSION_UID = "019fc7c8-03b7-7553-a37b-84b873e7cb96";
const EXTENSION_HANDLE = "ai-visibility";

const MAIN_THEME_SETTINGS = `#graphql
  query MainThemeSettings {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(filenames: ["config/settings_data.json"], first: 1) {
          nodes {
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

export async function checkAppEmbed(
  graphql: (query: string, options?: { variables?: object }) => Promise<Response>,
): Promise<EmbedCheckResult> {
  // Named at the innermost site, so every caller - the SEO action, the SEO
  // loader, Diagnostics - gets "MainThemeSettings" in the log without having
  // to know that is what checkAppEmbed sends. `named` never overwrites a name
  // an inner call already attached, so this one wins over any outer wrapper.
  const res = await named("MainThemeSettings", () => graphql(MAIN_THEME_SETTINGS));
  const json = await res.json();

  const theme = json.data?.themes?.nodes?.[0];
  if (!theme) {
    return {
      active: false,
      presentButDisabled: false,
      staleReference: false,
      themeId: null,
      themeName: null,
      unreadable: true,
      mode: "unknown",
      outputDisabled: false,
      instances: 0,
      activeInstances: 0,
    };
  }

  const content: string | undefined = theme.files?.nodes?.[0]?.body?.content;
  const base = {
    themeId: String(theme.id),
    themeName: String(theme.name ?? ""),
  };
  if (!content) {
    // A theme with no settings_data.json has no embeds enabled at all.
    return {
      active: false,
      presentButDisabled: false,
      staleReference: false,
      ...base,
      mode: "unknown",
      outputDisabled: false,
      instances: 0,
      activeInstances: 0,
    };
  }

  let settings: any;
  try {
    // Shopify allows comments in this file; strip the /* */ header if any.
    settings = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
  } catch {
    return {
      active: false,
      presentButDisabled: false,
      staleReference: false,
      ...base,
      unreadable: true,
      mode: "unknown",
      outputDisabled: false,
      instances: 0,
      activeInstances: 0,
    };
  }

  // App embeds live under current.blocks, keyed by random ids, each with a
  // type like "shopify://apps/<app>/blocks/<handle>/<uid>" and an optional
  // disabled flag. "current" can also be a preset name string; then there is
  // nothing enabled for us to find.
  const current = settings?.current;
  const blocks = current && typeof current === "object" ? current.blocks ?? {} : {};

  let present = false;
  let enabled = false;
  let stale = false;
  // The block's own settings, from our block only. Both are merchant choices
  // and B6 reads them: `mode` decides whether a Product node is emitted
  // unconditionally, and `enabled: false` means the merchant switched the
  // output off deliberately.
  let mode: "extend" | "full" | "unknown" = "unknown";
  let outputDisabled = false;
  // Counted, not flagged: a boolean cannot tell one embed from two.
  let instances = 0;
  let activeInstances = 0;
  // B32. Every app embed in the theme, ours included, before the filter below
  // narrows to ours. `shopify://apps/<app>/blocks/<handle>/<uid>` is the shape;
  // the app segment is what a merchant recognises on their apps list.
  const embedsByApp = new Map<string, number>();
  let embedTotal = 0;
  let embedEnabled = 0;
  for (const block of Object.values<any>(blocks)) {
    const type = String(block?.type ?? "");
    const app = /^shopify:\/\/apps\/([^/]+)\//.exec(type)?.[1];
    if (!app) continue;
    embedTotal += 1;
    embedsByApp.set(app, (embedsByApp.get(app) ?? 0) + 1);
    if (block?.disabled !== true) embedEnabled += 1;
  }
  const appEmbeds = {
    total: embedTotal,
    enabled: embedEnabled,
    byApp: [...embedsByApp.entries()]
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app)),
  };

  for (const block of Object.values<any>(blocks)) {
    const type = String(block?.type ?? "");
    const ours = type.includes(`/blocks/${EXTENSION_HANDLE}/`) || type.includes(EXTENSION_UID);
    if (!ours) continue;
    present = true;
    instances += 1;
    const rawMode = String(block?.settings?.mode ?? "");
    if (rawMode === "full" || rawMode === "extend") mode = rawMode;
    if (block?.settings?.enabled === false) outputDisabled = true;
    if (block?.disabled === true) continue;
    if (type.includes(EXTENSION_UID)) {
      enabled = true;
      // Present, not disabled, and pointing at the released uid: this one
      // renders, and every one of them renders the whole block again.
      activeInstances += 1;
    } else {
      // Right handle, wrong uid: a reference saved against a dev preview.
      // The theme logs "app block path does not exist" and renders nothing.
      stale = true;
    }
  }

  return {
    active: enabled,
    presentButDisabled: present && !enabled && !stale,
    staleReference: stale && !enabled,
    ...base,
    mode,
    outputDisabled,
    instances,
    activeInstances,
    appEmbeds,
  };
}

/**
 * Deep link that opens the theme editor with our embed ready to switch on.
 * The merchant still flips the switch and saves - Shopify offers no API to
 * enable an embed for them, which is also why we verify instead of assuming.
 */
export function embedDeepLink(shopDomain: string): string {
  const store = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/themes/current/editor?context=apps&activateAppId=${EXTENSION_UID}/${EXTENSION_HANDLE}`;
}
