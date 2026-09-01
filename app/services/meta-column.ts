// Client-safe half of the products list "Meta" column (SEO-WORKSPACE-PRD
// §4). The classification itself (classifyMetaField / metaColumnState in
// seo.server.ts) needs parseState and only ever runs in the loader; the
// labels and the disagreement rule here are plain display logic the route's
// component also needs, so they live in a module with no ".server" suffix -
// importing a value from a .server file anywhere the client component can
// see it pulls that whole module, and its dependency chain, into the
// browser bundle and fails the build (see CLAUDE.md: this has happened four
// times).

export type MetaFieldStatus = "auto" | "human" | "outside" | "missing";

export type MetaColumnState = {
  title: MetaFieldStatus;
  description: MetaFieldStatus;
};

export const META_FIELD_LABEL: Record<MetaFieldStatus, string> = {
  auto: "Auto",
  human: "Yours",
  outside: "Outside app",
  missing: "Missing",
};

/**
 * A single label when both fields agree; when they do not (a human title
 * with an empty description is the case that must never collapse into one
 * state), the caller reads title/description separately instead of calling
 * this - see the products list "Meta" column.
 */
export function metaColumnLabel(state: MetaColumnState): string {
  if (state.title === state.description) return META_FIELD_LABEL[state.title];
  return `Title: ${META_FIELD_LABEL[state.title]}, description: ${META_FIELD_LABEL[state.description]}`;
}

/** True when either field is empty and writable - the "still needs doing" filter. */
export function metaColumnMissing(state: MetaColumnState): boolean {
  return state.title === "missing" || state.description === "missing";
}
