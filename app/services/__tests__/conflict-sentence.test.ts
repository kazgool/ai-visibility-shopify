import { describe, expect, it } from "vitest";
import {
  conflictSentence,
  WEBSITE_BEFORE_SCAN_SENTENCE,
  WEBSITE_OURS_SENTENCE,
} from "../conflicts";
import { detectConflicts, extractLdNodes, OUR_NODE_MARKER } from "../theme-scan.server";

// The SEO screen's conflicts card (PRD-AI-READABILITY P0.4). A duplicate
// WebSite used to read "Unknown source" even when the second node was ours.

const script = (node: object) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
const theirs = { "@context": "https://schema.org", "@type": "WebSite", url: "https://shop.example" };
const ours = { ...theirs, [OUR_NODE_MARKER]: "1" };

describe("conflictSentence: WebSite", () => {
  it("says the duplicate is ours, and that it goes after the next scan, when our node is marked", () => {
    const [conflict] = detectConflicts(extractLdNodes(script(theirs) + script(ours)), "https://shop.example/");
    expect(conflict).toMatchObject({ type: "WebSite", count: 2, weEmitOne: true });
    const sentence = conflictSentence(conflict);
    expect(sentence).toBe(WEBSITE_OURS_SENTENCE);
    expect(sentence).toContain("this app's own");
    expect(sentence).toContain("disappears after the next scan");
    expect(sentence).not.toMatch(/unknown source/i);
  });

  it("says one may be ours and the scan has not told them apart, when neither is marked", () => {
    const [conflict] = detectConflicts(extractLdNodes(script(theirs) + script(theirs)), "https://shop.example/");
    expect(conflict).toMatchObject({ type: "WebSite", weEmitOne: false });
    const sentence = conflictSentence(conflict);
    expect(sentence).toBe(WEBSITE_BEFORE_SCAN_SENTENCE);
    expect(sentence).toContain("next scan");
    expect(sentence).not.toMatch(/unknown source/i);
  });
});

describe("conflictSentence: other types keep their sentences", () => {
  it("reports an Organization pair with ours as informational", () => {
    expect(conflictSentence({ type: "Organization", count: 2, weEmitOne: true })).toMatch(/^Informational/);
  });

  it("still says unknown source for a Product pair with none of ours", () => {
    expect(conflictSentence({ type: "Product", count: 2, weEmitOne: false })).toMatch(/^Unknown source/);
  });

  it("writes plain characters only", () => {
    for (const s of [WEBSITE_OURS_SENTENCE, WEBSITE_BEFORE_SCAN_SENTENCE]) {
      expect(s).not.toMatch(/[–—‘’“”…]|&#?\w+;/);
    }
  });
});
