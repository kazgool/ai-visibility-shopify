-- CreateTable
CREATE TABLE "CrawlerHit" (
    "id" BIGSERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "ip" TEXT,
    "handle" TEXT,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlerHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrawlerHit_shopId_at_idx" ON "CrawlerHit"("shopId", "at");
