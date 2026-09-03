-- Per-product SEO scan rows (PRD-SEO-PER-PRODUCT section 2.2).
-- Down path: prisma/down/20260903120000_seo_scan.down.sql, written first.

-- CreateTable
CREATE TABLE "SeoScan" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "handle" TEXT,
    "bulkAt" TIMESTAMP(3),
    "findings" JSONB,
    "offer" JSONB,
    "scannedAt" TIMESTAMP(3),
    "nodes" JSONB,
    "status" TEXT,
    "canonical" TEXT,
    "noindex" BOOLEAN,
    "appBlock" TEXT,
    "cacheControl" TEXT,

    CONSTRAINT "SeoScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoScan_shopId_productId_key" ON "SeoScan"("shopId", "productId");

-- CreateIndex
CREATE INDEX "SeoScan_shopId_scannedAt_idx" ON "SeoScan"("shopId", "scannedAt");

-- AddForeignKey
ALTER TABLE "SeoScan" ADD CONSTRAINT "SeoScan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
