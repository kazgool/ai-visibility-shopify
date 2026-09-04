-- The page title, stored per product row (PRD-SEO-FULL-ONPAGE section 3,
-- check B21: "Duplicate title across pages: the page's title tag equals
-- another scanned page's").
--
-- Why a column and not a per-pass value. The nightly pass reads at most 500
-- pages a night, so on any store larger than that the two pages that share a
-- title are read on different nights and nothing held in the pass can see
-- both. The comparison has to be against what was stored.
--
-- Nullable, and null means "never read, or the page carries no title tag".
-- B21 never treats a null as a match, so a half-scanned catalogue reports
-- fewer duplicates than it has rather than inventing any.
--
-- Down path: prisma/down/20260906090000_seo_scan_page_title.down.sql, written
-- first.

-- AlterTable
ALTER TABLE "SeoScan" ADD COLUMN "pageTitle" TEXT;
