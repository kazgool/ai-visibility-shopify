-- AlterTable
ALTER TABLE "MirrorCache" ADD COLUMN "productId" TEXT;

-- CreateIndex
CREATE INDEX "MirrorCache_shopId_productId_idx" ON "MirrorCache"("shopId", "productId");
