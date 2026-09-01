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
