-- The before-snapshot of a paid SEO engagement (PRD-SEO-FULL-ONPAGE section
-- 1.1). One row per shop, written once at unlock and never updated, so a
-- screen can say what the engagement changed rather than only what the shop
-- looks like now.
--
-- Down path: prisma/down/20260904120000_seo_snapshot.down.sql, written first.
-- Read it before dropping: this is the one table in the schema whose contents
-- cannot be re-read from Shopify, because the day it describes has passed.

-- CreateTable
CREATE TABLE "SeoSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenBy" TEXT NOT NULL,
    "products" INTEGER NOT NULL,
    "metaTitleSet" INTEGER NOT NULL,
    "metaTitleOurs" INTEGER NOT NULL,
    "metaDescriptionSet" INTEGER NOT NULL,
    "metaDescriptionOurs" INTEGER NOT NULL,
    "withBarcode" INTEGER NOT NULL,
    "withVendor" INTEGER NOT NULL,
    "withSku" INTEGER NOT NULL,
    "withImage" INTEGER NOT NULL,
    "productNodeTheme" INTEGER,
    "productNodeNone" INTEGER,
    "themeNodeTypes" JSONB,
    "findingsByCode" JSONB,
    "pagesRead" INTEGER NOT NULL,

    CONSTRAINT "SeoSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per shop, enforced by Postgres and not only by the code that writes
-- it: "written once and never updated" is the whole value of the table, and a
-- second row would make every difference on the card ambiguous.
CREATE UNIQUE INDEX "SeoSnapshot_shopId_key" ON "SeoSnapshot"("shopId");

-- AddForeignKey
ALTER TABLE "SeoSnapshot" ADD CONSTRAINT "SeoSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
