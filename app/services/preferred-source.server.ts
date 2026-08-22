// Preferred source eligibility record (PREFERRED-SOURCES-SPEC.md §6): the
// manual, authoritative check a merchant performs by hand at Google's own
// tool. There is no API for this, so the app never fetches or infers it -
// it only records what the merchant reports having seen, with a date, and
// shows that back as a fact rather than a promise.

import db from "../db.server";

const SETTING_KEY = "preferred_source_eligibility";

export type PreferredSourceStatus = "listed" | "not_listed";

export type PreferredSourceEligibility = {
  status: PreferredSourceStatus;
  recordedAt: string; // ISO date
};

export async function preferredSourceEligibilityFor(
  shopId: string,
): Promise<PreferredSourceEligibility | null> {
  const row = await db.setting.findUnique({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
  });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as PreferredSourceEligibility;
  } catch {
    return null;
  }
}

export async function recordPreferredSourceEligibility(
  shopId: string,
  status: PreferredSourceStatus,
): Promise<PreferredSourceEligibility> {
  const record: PreferredSourceEligibility = {
    status,
    recordedAt: new Date().toISOString(),
  };
  await db.setting.upsert({
    where: { shopId_key: { shopId, key: SETTING_KEY } },
    create: { shopId, key: SETTING_KEY, value: JSON.stringify(record) },
    update: { value: JSON.stringify(record) },
  });
  return record;
}
