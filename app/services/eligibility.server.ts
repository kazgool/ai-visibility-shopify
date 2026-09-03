// The database half of section J: the two Setting rows behind PublishPrefs.
//
// Separate from eligibility.ts because that module is imported by the Report
// screen's components, and a value import from a `.server` module fails the
// client build.

import db from "../db.server";
import { DEFAULT_PREFS, type PublishPrefs } from "./eligibility";

export const OUT_OF_STOCK_KEY = "publish_out_of_stock";
export const UNLISTED_KEY = "publish_unlisted";

/** An absent row means the default, so a shop that never touched the card
 * publishes exactly what it published before these toggles existed. */
export async function prefsFor(shopId: string): Promise<PublishPrefs> {
  const rows = await db.setting.findMany({
    where: { shopId, key: { in: [OUT_OF_STOCK_KEY, UNLISTED_KEY] } },
  });
  const read = (key: string, fallback: boolean): boolean => {
    const row = rows.find((r: { key: string; value: string }) => r.key === key);
    if (!row) return fallback;
    return row.value === "true";
  };
  return {
    includeOutOfStock: read(OUT_OF_STOCK_KEY, DEFAULT_PREFS.includeOutOfStock),
    includeUnlisted: read(UNLISTED_KEY, DEFAULT_PREFS.includeUnlisted),
  };
}

/**
 * Writes only what changed, and reports whether anything did - the same
 * principle as the `unchanged` check in every other writer here. The caller
 * uses the answer to decide whether a reconciliation job is worth queueing:
 * a save that changed nothing must not withdraw and re-add every page.
 */
export async function savePrefs(shopId: string, next: PublishPrefs): Promise<boolean> {
  const current = await prefsFor(shopId);
  let changed = false;

  const write = async (key: string, value: boolean) => {
    await db.setting.upsert({
      where: { shopId_key: { shopId, key } },
      create: { shopId, key, value: String(value) },
      update: { value: String(value) },
    });
    changed = true;
  };

  if (current.includeOutOfStock !== next.includeOutOfStock) {
    await write(OUT_OF_STOCK_KEY, next.includeOutOfStock);
  }
  if (current.includeUnlisted !== next.includeUnlisted) {
    await write(UNLISTED_KEY, next.includeUnlisted);
  }

  return changed;
}
