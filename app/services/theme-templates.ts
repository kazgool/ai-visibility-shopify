// Theme files a merchant's developer can add by hand (PRD-AI-READABILITY P1.4).
//
// Shown as copy text on Diagnostics, behind the operator key, and never
// written by the app: writing theme files needs write_themes and an exemption
// Shopify grants on request (themeFilesUpsert), which this app does not have.
// Shopify serves /agents.md from templates/agents.md.liquid and mirrors it at
// /llms.txt (https://shopify.dev/changelog/customize-llmstxt-llms-fulltxt-and-agentsmd),
// so this one file is how a crawler arriving at the root finds the app's live
// index. It only links: the index itself stays the app's, so it is current.
//
// No robots.txt fragment: Shopify's default robots.txt blocks no AI crawler
// (verified on republicabio.ro, 11 September 2026), so there is nothing to add.
//
// Pure, no .server suffix: the Diagnostics component renders it.

export const AGENTS_MD_TEMPLATE_PATH = "templates/agents.md.liquid";

/** The file's body, exactly as the brief of 11 September 2026 gives it. */
export const AGENTS_MD_TEMPLATE = `# {{ agents.store_name }}

> Product data for AI agents at {{ agents.store_url }}. The complete, always current product index is served by the AI Visibility app at the links below.

## Product index
- [llms.txt]({{ agents.store_url }}/apps/ai-visibility/llms.txt): every published product, each with a plain text page
- [agents.md]({{ agents.store_url }}/apps/ai-visibility/agents.md): agent notes for this store

## Commerce Protocol (UCP)
- Discovery: \`GET {{ agents.ucp_discovery_url }}\`
- MCP endpoint: \`POST {{ agents.mcp_endpoint_url }}\`
- Sitemap: {{ agents.sitemap_url }}
`;

export const AGENTS_MD_TEMPLATE_NOTE =
  "Shopify serves /llms.txt from this file too. Paste it in the theme code editor under Templates. Nothing else in the theme changes.";
