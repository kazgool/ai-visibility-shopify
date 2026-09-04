// Pure conflict-presentation rules, in a module without the ".server"
// suffix on purpose: the SEO screen's components render these judgements in
// the browser, and a value import from a .server file used outside a
// loader/action fails the client build (same reason meta-column.ts exists).

/** Same shape as theme-scan.server's ConflictEntry, declared here so the
 * server module can depend on this file and not the other way round. */
export type ConflictLike = {
  type: string;
  count: number;
  weEmitOne: boolean;
};

/**
 * An Organization pair where one node is ours is expected, not a defect:
 * the theme's node carries no @id we could attach to, so we publish our own
 * complete node with the merchant's profiles alongside it, and consumers
 * merge or pick. Reported as informational, never warning or critical - the
 * alternative (suppressing our node so the conflict count reads zero) was
 * removed on 1 September 2026 because it silently dropped the merchant's
 * profiles to make our own metric look cleaner.
 */
export function organizationPairIsInformational(conflict: ConflictLike): boolean {
  return conflict.type === "Organization" && conflict.weEmitOne;
}

/**
 * The marker our block puts on every JSON-LD node it emits, and the only thing
 * that identifies our output.
 *
 * **Why it is a property and not an `@id` fragment.** The instruction on 4
 * September 2026 was to give our nodes an `@id` fragment a theme cannot
 * coincidentally match. It cannot go in the `@id`, and the reason is the
 * feature itself: in extend mode our Product node deliberately carries the
 * *theme's* address so that JSON-LD merges the two into one node, and the same
 * is true of our Organization node when the theme has an `@id` to reuse. Give
 * our node its own address and it stops merging - and then the page carries two
 * distinct Product nodes, which is the one thing CLAUDE.md forbids outright.
 * The marker therefore rides on the node instead, where it identifies the
 * emitter without touching the address. Deviation recorded rather than
 * improvised; extend mode's merge is not negotiable.
 *
 * It is an absolute IRI used directly as a key, which is valid JSON-LD needing
 * no `@context` term, is ignored by every consumer that does not know it, and
 * pollutes no schema.org property - so it cannot be mistaken for a real
 * `identifier` on the merchant's product. And it is on our own domain, so a
 * theme cannot match it by coincidence the way it can match "#product".
 */
export const OUR_NODE_MARKER = "https://mrdigital.ro/ns/ai-visibility";

/**
 * Did this app emit this node?
 *
 * By the marker alone. The old test was `id.endsWith("#product")` and its own
 * comment carried the assumption that broke it: "a theme's node ends in
 * whatever the theme chose". Horizon chooses `#product`, so on 4 September 2026
 * every Horizon Product node was counted as ours, the Structured data card
 * concluded the theme emitted none, and it recommended switching to Full mode -
 * which would have produced the second complete Product node the rule forbids.
 * A node without our marker is the theme's, whatever its suffix.
 *
 * A node read before the marker shipped has no marker and is therefore read as
 * the theme's. That is the safe direction: it can only ever recommend Extend,
 * and Extend never creates a duplicate node.
 */
export function isOurNode(node: { ours?: boolean }): boolean {
  return node.ours === true;
}

/** Does a parsed JSON-LD object carry our marker? */
export function objectCarriesOurMarker(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>)[OUR_NODE_MARKER] !== undefined;
}
