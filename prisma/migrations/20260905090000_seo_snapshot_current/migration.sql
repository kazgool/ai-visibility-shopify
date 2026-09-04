-- One row per shop per origin, instead of one row per shop
-- (PRD-SEO-FULL-ONPAGE section 1.2, build step 2).
--
-- The card has to show "the value at the snapshot, the value today, and the
-- difference". "Today" for figures like `metaTitleOurs` or `withBarcode` can
-- only come from a catalogue read, and a catalogue read is a bulk operation -
-- not something a screen load can pay for. So the catalogue pass that already
-- holds the whole read writes a second row in the same shape, `takenBy`
-- 'current', rewritten every pass.
--
-- One shape for both halves on purpose: the before and the today are computed
-- by the same function over the same fields, so a difference between them
-- cannot be an artefact of two readings of one catalogue.
--
-- Down path: prisma/down/20260905090000_seo_snapshot_current.down.sql,
-- written first. Its DELETE of the current rows is not optional - the old
-- unique index cannot be recreated while a shop holds two rows.

-- DropIndex
DROP INDEX "SeoSnapshot_shopId_key";

-- AlterTable
ALTER TABLE "SeoSnapshot" ADD COLUMN "writtenSince" JSONB;
ALTER TABLE "SeoSnapshot" ADD COLUMN "writtenSinceAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "SeoSnapshot_shopId_takenBy_key" ON "SeoSnapshot"("shopId", "takenBy");
