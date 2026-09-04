-- Down path for 20260906090000_seo_scan_page_title. Written before the
-- migration it reverses.
--
--   psql "$DIRECT_URL" -f prisma/down/20260906090000_seo_scan_page_title.down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260906090000_seo_scan_page_title';
--
-- What the migration did: added one nullable text column to SeoScan, holding
-- the page's <title> tag so that check B21 (two pages sharing one title) can
-- compare pages read on different nights.
--
-- Dropping it loses nothing that cannot be read again: the column is written
-- by every source B page read, so the next nightly pass refills it for every
-- page it reaches. B21 reports nothing at all while the column is empty,
-- which is the correct reading of "no page has been read", not "no page
-- shares a title".
--
-- Safe to run while the app is serving: the column is nullable, no index
-- depends on it, and no code path other than source B writes it.

ALTER TABLE "SeoScan" DROP COLUMN IF EXISTS "pageTitle";
