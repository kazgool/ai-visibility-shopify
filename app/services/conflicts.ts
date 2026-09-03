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
 * Is this `@id` one this app emitted? Our nodes always end in a fragment we
 * chose; a theme's node ends in whatever the theme chose, or has no fragment
 * at all. Moved here from theme-scan.server.ts on 3 September 2026 (build
 * step 4) for the reason this file exists: the SEO card's B1 aggregate has to
 * tell a theme node from ours, and it is computed by a pure function the
 * browser bundle can import. theme-scan.server.ts re-exports it, so every
 * existing caller and its test are unchanged.
 */
export function isOurNodeId(id: string): boolean {
  return id.endsWith("#product") || id.endsWith("#collection") || id.endsWith("#organization");
}
