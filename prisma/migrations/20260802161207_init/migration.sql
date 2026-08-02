-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "plan" TEXT NOT NULL DEFAULT 'none',
    "metafieldsInit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MirrorCache" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MirrorCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeScan" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "hasProductLd" BOOLEAN,
    "detail" JSONB,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlerCheck" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "status" INTEGER,
    "cause" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlerCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestMetric" (
    "id" BIGSERIAL NOT NULL,
    "path" TEXT NOT NULL,
    "ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "region" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_shopId_key_key" ON "Setting"("shopId", "key");

-- CreateIndex
CREATE INDEX "JobRun_shopId_kind_idx" ON "JobRun"("shopId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MirrorCache_shopId_handle_key" ON "MirrorCache"("shopId", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeScan_shopId_themeId_key" ON "ThemeScan"("shopId", "themeId");

-- CreateIndex
CREATE INDEX "CrawlerCheck_shopId_checkedAt_idx" ON "CrawlerCheck"("shopId", "checkedAt");

-- CreateIndex
CREATE INDEX "RequestMetric_at_idx" ON "RequestMetric"("at");

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorCache" ADD CONSTRAINT "MirrorCache_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeScan" ADD CONSTRAINT "ThemeScan_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlerCheck" ADD CONSTRAINT "CrawlerCheck_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
