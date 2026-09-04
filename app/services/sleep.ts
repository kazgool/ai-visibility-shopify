// One line, its own file, and the reason is an import graph rather than a
// preference.
//
// `sleep` lived in admin.server.ts, and admin.server.ts imports
// `unauthenticated` from shopify.server, which builds a PrismaSessionStorage
// at module load. So every module that wanted to wait two seconds - most of
// all catalogue.server.ts, between two polls of a bulk operation - dragged the
// whole Shopify app object in with it, and any test that stubbed db.server
// then failed at collection time with "PrismaClient does not have a session
// table", before a single assertion ran. catalogue-read.test.ts already
// carried a `vi.mock("../admin.server")` whose only purpose was to supply this
// function, and billing.server.test.ts failed outright on 4 September 2026 the
// moment billing.server reached a catalogue read through the SEO snapshot.
//
// The function has nothing to do with the Admin API. Here it needs no mock at
// all, and nothing that imports it inherits a dependency on Shopify or on a
// database. admin.server.ts re-exports it, so every existing caller keeps the
// import it had.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
