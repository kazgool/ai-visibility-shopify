// The plain text mirror (PRD §4.6).
//
// Rendered when extraction runs and stored in MirrorCache, so the proxy route
// is a single indexed read with no Admin API call on the request path
// (ARCHITECTURE §3). A crawler that cannot parse a themed page can still read
// this.

import type { BusinessInfo, Fact } from "../engine";
import { warrantyWithUnit } from "../engine";
import { cleanOutput } from "../engine/normalize";
import type { SocialProfiles } from "./social-profiles";
import { SOCIAL_PLATFORMS } from "./social-profiles";

/** Shop name, storefront URL and the official profiles filled in on the
 * Business screen - the Organization node the themed page carries, for the
 * reader that cannot parse the themed page either. */
export type MirrorStore = {
  name: string;
  url: string;
  profiles?: SocialProfiles | null;
};

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
  imageUrl?: string | null;
  imageAlt?: string | null;
  productType?: string | null;
  category?: string | null;
  updatedAt?: string;
  // The questions and the audience line are published in the page's structured
  // data too, but a crawler that reads a themed page badly is exactly the
  // reader this file exists for. Leaving them out gave the worst reader the
  // thinnest copy, which is backwards. The WordPress mirror has carried both
  // from the start.
  questions?: { q: string; a: string }[];
  fitFor?: string | null;
  business?: BusinessInfo | null;
  store?: MirrorStore | null;
};

function yamlEscape(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function renderMirror(raw: MirrorInput): string {
  // Published text uses plain characters only: no entities, no em dashes.
  const input: MirrorInput = {
    ...raw,
    title: cleanOutput(raw.title),
    summary: raw.summary ? cleanOutput(raw.summary) : raw.summary,
    vendor: raw.vendor ? cleanOutput(raw.vendor) : raw.vendor,
    facts: raw.facts.map((f) => ({ k: cleanOutput(f.k), v: cleanOutput(f.v) })),
  };
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
  if (input.productType) lines.push(`category: ${yamlEscape(cleanOutput(input.productType))}`);
  if (input.category) {
    lines.push(`product_category: ${yamlEscape(cleanOutput(input.category))}`);
  }
  if (input.imageUrl) lines.push(`image: ${yamlEscape(input.imageUrl)}`);
  if (input.imageAlt) lines.push(`image_alt: ${yamlEscape(cleanOutput(input.imageAlt))}`);
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
    lines.push(cleanOutput(input.description.replace(/<[^>]*>/g, " ")));
    lines.push("");
  }

  if (input.questions && input.questions.length > 0) {
    lines.push("## Questions");
    lines.push("");
    for (const qa of input.questions) {
      lines.push(`**${cleanOutput(qa.q)}**`);
      lines.push("");
      lines.push(cleanOutput(qa.a));
      lines.push("");
    }
  }

  if (input.fitFor) {
    lines.push("## Who it suits");
    lines.push("");
    lines.push(cleanOutput(input.fitFor));
    lines.push("");
  }

  // The commercial answers, as a table rather than only as questions. They are
  // the same facts, but a reader scanning for "does it ship to me" finds a row
  // faster than a sentence. Empty fields publish nothing, as everywhere else.
  const b = input.business;
  if (b) {
    const rows: [string, string][] = [];
    if (b.deliveryVaries) {
      rows.push(["Delivery", "Varies by product, stated on each product page"]);
    } else if (b.deliveryTime) {
      rows.push(["Delivery", cleanOutput(b.deliveryTime)]);
    }
    if (b.deliveryCost) {
      const cost = cleanOutput(b.deliveryCost);
      rows.push(["Delivery cost", b.deliveryCostIsFrom ? `From ${cost}` : cost]);
    }
    if (b.returnDays) rows.push(["Returns", `${b.returnDays} days`]);
    if (b.warranty) rows.push(["Warranty", cleanOutput(warrantyWithUnit(b.warranty))]);
    if (b.paymentMethods) rows.push(["Payment", cleanOutput(b.paymentMethods)]);

    if (rows.length > 0) {
      lines.push("## Buying it");
      lines.push("");
      lines.push("| | |");
      lines.push("| --- | --- |");
      for (const [k, v] of rows) lines.push(`| ${k} | ${v} |`);
      lines.push("");
    }
  }

  // The Organization node with the official profiles is published on the
  // themed page by the storefront block, but a crawler reading this mirror
  // instead of the themed page would otherwise never see it.
  const store = input.store;
  if (store && (store.name || store.url || store.profiles)) {
    const profileUrls = SOCIAL_PLATFORMS.map((p) => store.profiles?.[p]).filter(
      (v): v is string => !!v,
    );
    if (store.name || store.url || profileUrls.length > 0) {
      lines.push("## Store");
      lines.push("");
      if (store.name) lines.push(cleanOutput(store.name));
      if (store.url) lines.push(store.url);
      for (const profileUrl of profileUrls) lines.push(profileUrl);
      lines.push("");
    }
  }

  lines.push(`Source: ${input.url}`);
  lines.push("");

  return lines.join("\n");
}
