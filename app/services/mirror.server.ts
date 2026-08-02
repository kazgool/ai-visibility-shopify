// The plain text mirror (PRD §4.6).
//
// Rendered when extraction runs and stored in MirrorCache, so the proxy route
// is a single indexed read with no Admin API call on the request path
// (ARCHITECTURE §3). A crawler that cannot parse a themed page can still read
// this.

import type { Fact } from "../engine";

export type MirrorInput = {
  handle: string;
  title: string;
  url: string;
  description?: string | null;
  summary?: string | null;
  facts: Fact[];
  price?: string | null;
  currency?: string | null;
  available?: boolean;
  vendor?: string | null;
  sku?: string | null;
  updatedAt?: string;
};

function yamlEscape(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function renderMirror(input: MirrorInput): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`title: ${yamlEscape(input.title)}`);
  lines.push(`url: ${yamlEscape(input.url)}`);
  if (input.vendor) lines.push(`brand: ${yamlEscape(input.vendor)}`);
  if (input.sku) lines.push(`sku: ${yamlEscape(input.sku)}`);
  if (input.price) {
    lines.push(`price: ${yamlEscape(`${input.price} ${input.currency ?? ""}`.trim())}`);
  }
  if (input.available !== undefined) {
    lines.push(`availability: ${input.available ? "in stock" : "out of stock"}`);
  }
  if (input.updatedAt) lines.push(`updated: ${yamlEscape(input.updatedAt)}`);
  lines.push("---");
  lines.push("");

  lines.push(`# ${input.title}`);
  lines.push("");

  if (input.summary) {
    lines.push(input.summary);
    lines.push("");
  }

  if (input.facts.length > 0) {
    lines.push("| Attribute | Value |");
    lines.push("| --- | --- |");
    for (const fact of input.facts) {
      lines.push(`| ${fact.k} | ${fact.v} |`);
    }
    lines.push("");
  }

  if (input.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(input.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    lines.push("");
  }

  lines.push(`Source: ${input.url}`);
  lines.push("");

  return lines.join("\n");
}
