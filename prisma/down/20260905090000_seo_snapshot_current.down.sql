-- Down path for 20260905090000_seo_snapshot_current. Written before the
-- migration it reverses.
--
--   psql "$DIRECT_URL" -f prisma/down/20260905090000_seo_snapshot_current.down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260905090000_seo_snapshot_current';
--
-- What the migration did: widened SeoSnapshot from one row per shop to one row
-- per shop per origin, so the immovable "before" (takenBy 'unlock' or 'manual')
-- and the rolling "current" (takenBy 'current', rewritten by every catalogue
-- pass) live in one shape and can only ever be compared like with like.
--
-- THE ORDER BELOW MATTERS AND IS NOT INTERCHANGEABLE. Reverting to a unique
-- index on shopId alone fails while a shop has both a before row and a current
-- row, which every unlocked shop will have. So the current rows are deleted
-- first. That loses nothing: a current row is recomputed in full by the next
-- catalogue pass, which is the only reason it was safe to make it rolling.
--
-- The before rows are NOT touched here, and must not be: they are the one
-- thing in this schema that cannot be read again, because the day they
-- describe has passed. If you are reverting far enough to drop the table
-- itself, read prisma/down/20260904120000_seo_snapshot.down.sql first - it
-- carries the \copy that has to happen before the drop.

DELETE FROM "SeoSnapshot" WHERE "takenBy" = 'current';

DROP INDEX IF EXISTS "SeoSnapshot_shopId_takenBy_key";

ALTER TABLE "SeoSnapshot" DROP COLUMN IF EXISTS "writtenSince";
ALTER TABLE "SeoSnapshot" DROP COLUMN IF EXISTS "writtenSinceAt";

CREATE UNIQUE INDEX IF NOT EXISTS "SeoSnapshot_shopId_key" ON "SeoSnapshot"("shopId");
