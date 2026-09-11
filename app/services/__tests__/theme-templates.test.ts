import { describe, expect, it } from "vitest";
import {
  AGENTS_MD_TEMPLATE,
  AGENTS_MD_TEMPLATE_NOTE,
  AGENTS_MD_TEMPLATE_PATH,
} from "../theme-templates";

// PRD-AI-READABILITY P1.4: copy text for a developer, never written by the app.

describe("the agents.md theme template", () => {
  it("is the body the brief gives, line for line", () => {
    expect(AGENTS_MD_TEMPLATE_PATH).toBe("templates/agents.md.liquid");
    expect(AGENTS_MD_TEMPLATE.split("\n")).toEqual([
      "# {{ agents.store_name }}",
      "",
      "> Product data for AI agents at {{ agents.store_url }}. The complete, always current product index is served by the AI Visibility app at the links below.",
      "",
      "## Product index",
      "- [llms.txt]({{ agents.store_url }}/apps/ai-visibility/llms.txt): every published product, each with a plain text page",
      "- [agents.md]({{ agents.store_url }}/apps/ai-visibility/agents.md): agent notes for this store",
      "",
      "## Commerce Protocol (UCP)",
      "- Discovery: `GET {{ agents.ucp_discovery_url }}`",
      "- MCP endpoint: `POST {{ agents.mcp_endpoint_url }}`",
      "- Sitemap: {{ agents.sitemap_url }}",
      "",
    ]);
  });

  it("carries the note the brief gives", () => {
    expect(AGENTS_MD_TEMPLATE_NOTE).toBe(
      "Shopify serves /llms.txt from this file too. Paste it in the theme code editor under Templates. Nothing else in the theme changes.",
    );
  });

  it("offers no robots.txt fragment and uses plain characters only", () => {
    expect(AGENTS_MD_TEMPLATE).not.toMatch(/robots|disallow|user-agent/i);
    for (const text of [AGENTS_MD_TEMPLATE, AGENTS_MD_TEMPLATE_NOTE]) {
      expect(text).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
    }
  });
});
