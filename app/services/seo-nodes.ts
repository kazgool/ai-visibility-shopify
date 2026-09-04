// Check B6: which of the nodes this app expects on a product's page are
// absent, and why (PRD-SEO-PER-PRODUCT section 2.1, row B6).
//
// Built 4 September 2026, having been deferred twice. The deferral's reason was
// that `deriveMissingReasons` needs the shop's mode, the app embed's state and
// this product's facts, and "source B reads a page; it reads none of those
// three". That was true and beside the point: it says where the data comes
// from, not whether the check can exist. All three are on the server at the
// moment a SeoScan row is written - the mode and the embed state are one read
// per pass (checkAppEmbed), and the facts are in the catalogue read source A
// already has in hand. So B6 is computed there, and carries `source: "A"`
// because source A is what owns and rewrites it. That is a documented
// deviation from section 2.1, which assigned it to source B.
//
// The distinction this module exists to make, and the reason it is a module
// rather than a filter: **a node the merchant switched off is not a finding.**
// `deriveMissingReasons` answers "is it emitted", which is one question, and
// puts "you turned this off", "this needs data you have not entered" and "we
// could not tell" in the same shape. On a merchant-facing screen those are
// three different sentences and only one of them is a defect. Reporting a
// deliberate choice back as a problem is how a findings screen teaches people
// to ignore it.

/** As `deriveMissingReasons` returns them. Declared structurally so this stays pure. */
export type NodeReason = {
  nodeType: string;
  emitted: boolean;
  reason: string | null;
  fixScreen: string | null;
};

/**
 * What we can say about one node on one page.
 *
 * `emitted`  - it is there.
 * `off`      - absent because the merchant or the operator switched it off.
 * `missing`  - absent, should be there, and a screen in this app can fix it.
 * `unknown`  - absent, and we do not know why, or the cause is outside the app.
 *
 * Only `missing` is a finding. `unknown` is deliberately not one: "if we did
 * not fetch it, we do not say" is this app's oldest rule, and a node whose
 * absence depends on a page nobody has read yet is not evidence of anything.
 */
export type NodeState = "emitted" | "off" | "missing" | "unknown";

/** What the row needs to know beyond the reasons themselves. */
export type NodeContext = {
  /** The block is in the theme but its "Enable output" checkbox is off. */
  outputDisabled: boolean;
  /** The block is in the theme but the embed itself is switched off. */
  presentButDisabled: boolean;
  /** The operator has not enabled the SEO module for this shop. */
  seoUnlocked: boolean;
  /** The settings file could not be read, so nothing here is certain. */
  unreadable: boolean;
};

/**
 * The sentences `deriveMissingReasons` produces for a cause that is a choice
 * rather than a defect. Matched on the reason text because that function
 * returns no code of its own, and matched on a distinctive fragment rather
 * than the whole string so a comma does not silently reclassify a node.
 *
 * If one of these sentences is reworded and this list is not, the node is
 * reported as `missing` rather than `off` - noisy, and visible, which is the
 * safe direction (DICTIONARY-PORT section 10.1). The test asserts the pairing
 * so it fails instead of drifting.
 */
const DELIBERATE_FRAGMENTS = [
  "operator-configured SEO module",
];

/**
 * And the sentences that mean "we have not looked", which are not findings
 * either. This one carries a `fixScreen` of /app/diagnostics - it invites the
 * merchant to run a scan - so it cannot be recognised by the absence of a
 * screen the way the others can. Found by the test that asserts a page nobody
 * has read raises nothing: without this list it reported three missing nodes
 * on every product of a store whose pages had never been scanned, which is the
 * same defect as the "0 of 50" bug in CLAUDE.md wearing a different hat.
 */
const UNKNOWN_FRAGMENTS = [
  "Could not be determined",
];

function matches(reason: string | null, fragments: string[]): boolean {
  if (!reason) return false;
  return fragments.some((fragment) => reason.includes(fragment));
}

function isDeliberate(reason: string | null): boolean {
  return matches(reason, DELIBERATE_FRAGMENTS);
}

function isUndetermined(reason: string | null): boolean {
  return matches(reason, UNKNOWN_FRAGMENTS);
}

/**
 * Classify one node's absence.
 *
 * Order matters. A shop whose settings file could not be read knows nothing,
 * so everything absent is `unknown` and no finding is raised at all - the
 * alternative is telling a merchant six nodes are missing because one Admin
 * call came back empty.
 */
export function classifyNode(reason: NodeReason, context: NodeContext): NodeState {
  if (reason.emitted) return "emitted";
  if (context.unreadable) return "unknown";

  // The whole output is off by choice, so every node is off by choice. This is
  // checked before the per-node reasons because deriveMissingReasons reports
  // an inactive embed as one blanket reason across every node type, and
  // "the app embed is not active" is a defect when nobody set it up and a
  // choice when the merchant switched it off.
  if (context.outputDisabled || context.presentButDisabled) return "off";

  if (isDeliberate(reason.reason)) return "off";

  // Nobody has read the page, so nothing can be concluded from what is not on
  // it. Checked before the fixScreen test because this sentence does carry one.
  if (isUndetermined(reason.reason)) return "unknown";

  // A cause outside this app, such as no review app having written a rating:
  // absent, real, and nothing here can fix it.
  if (!reason.fixScreen) return "unknown";

  return "missing";
}

export type NodeBreakdown = {
  emitted: string[];
  /** Absent by choice. Named on the screen, never counted as a finding. */
  off: string[];
  /** Absent, fixable here. The finding. */
  missing: { nodeType: string; reason: string; fixScreen: string }[];
  /** Absent, cause not established. */
  unknown: { nodeType: string; reason: string }[];
};

/** Every node sorted into the four states, in the order deriveMissingReasons gave. */
export function breakdownNodes(
  reasons: NodeReason[],
  context: NodeContext,
): NodeBreakdown {
  const out: NodeBreakdown = { emitted: [], off: [], missing: [], unknown: [] };
  for (const reason of reasons) {
    switch (classifyNode(reason, context)) {
      case "emitted":
        out.emitted.push(reason.nodeType);
        break;
      case "off":
        out.off.push(reason.nodeType);
        break;
      case "missing":
        out.missing.push({
          nodeType: reason.nodeType,
          reason: reason.reason ?? "",
          fixScreen: reason.fixScreen ?? "",
        });
        break;
      default:
        out.unknown.push({ nodeType: reason.nodeType, reason: reason.reason ?? "" });
    }
  }
  return out;
}

/**
 * B6's detail, or null when there is nothing to report.
 *
 * Null when no node is `missing`, however many are off or unknown: a row is a
 * finding or it is not, and a store that switched half the output off is not a
 * store with half its nodes broken. The counts of the other three states ride
 * along in the detail so the screen can say "and 2 you switched off" without
 * that being what the row is about.
 */
export function b6Detail(
  reasons: NodeReason[],
  context: NodeContext,
): Record<string, unknown> | null {
  const breakdown = breakdownNodes(reasons, context);
  if (breakdown.missing.length === 0) return null;
  return {
    missing: breakdown.missing,
    offCount: breakdown.off.length,
    off: breakdown.off,
    unknownCount: breakdown.unknown.length,
    emittedCount: breakdown.emitted.length,
  };
}
