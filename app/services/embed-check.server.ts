// App embed verification (LAUNCH-PLAN: onboarding refuses success until the
// embed is verified active).
//
// A theme app extension that is installed but not enabled renders nothing,
// and the merchant has no way to notice: the app looks configured, the
// storefront stays silent. So we do not trust our own setup flow - we read
// the published theme's config/settings_data.json through the Admin API and
// look for our embed block actually enabled. Server side, works behind
// storefront passwords, GraphQL only.

export type EmbedCheckResult = {
  /** Our embed block is present in the published theme and not disabled. */
  active: boolean;
  /** Present but switched off - the merchant got halfway. */
  presentButDisabled: boolean;
  themeId: string | null;
  themeName: string | null;
  /** The settings file could not be read; unknown is not "off". */
  unreadable?: boolean;
};

// The block type in settings_data.json contains the extension uid
// (shopify://apps/<app>/blocks/<handle>/<uid>). The uid is stable across
// deploys; the app name in the path is not, so we match on uid + handle.
const EXTENSION_UID = "1fba957a-2c9f-f8b0-6c55-1e0680f3865ef9012d7f";
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
  const res = await graphql(MAIN_THEME_SETTINGS);
  const json = await res.json();

  const theme = json.data?.themes?.nodes?.[0];
  if (!theme) {
    return {
      active: false,
      presentButDisabled: false,
      themeId: null,
      themeName: null,
      unreadable: true,
    };
  }

  const content: string | undefined = theme.files?.nodes?.[0]?.body?.content;
  const base = {
    themeId: String(theme.id),
    themeName: String(theme.name ?? ""),
  };
  if (!content) {
    // A theme with no settings_data.json has no embeds enabled at all.
    return { active: false, presentButDisabled: false, ...base };
  }

  let settings: any;
  try {
    // Shopify allows comments in this file; strip the /* */ header if any.
    settings = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
  } catch {
    return { active: false, presentButDisabled: false, ...base, unreadable: true };
  }

  // App embeds live under current.blocks, keyed by random ids, each with a
  // type like "shopify://apps/<app>/blocks/<handle>/<uid>" and an optional
  // disabled flag. "current" can also be a preset name string; then there is
  // nothing enabled for us to find.
  const current = settings?.current;
  const blocks = current && typeof current === "object" ? current.blocks ?? {} : {};

  let present = false;
  let enabled = false;
  for (const block of Object.values<any>(blocks)) {
    const type = String(block?.type ?? "");
    if (type.includes(EXTENSION_UID) || type.includes(`/blocks/${EXTENSION_HANDLE}/`)) {
      present = true;
      if (block?.disabled !== true) enabled = true;
    }
  }

  return {
    active: enabled,
    presentButDisabled: present && !enabled,
    ...base,
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
