-- CreateTable
CREATE TABLE "Partner" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "note" VARCHAR(300),
    "commissionPct" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerVisitDay" (
    "partnerId" UUID NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PartnerVisitDay_pkey" PRIMARY KEY ("partnerId","day")
);

-- CreateTable
CREATE TABLE "PartnerAttribution" (
    "userId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerAttribution_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_slug_key" ON "Partner"("slug");

-- CreateIndex
CREATE INDEX "PartnerAttribution_partnerId_createdAt_idx" ON "PartnerAttribution"("partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "PartnerVisitDay" ADD CONSTRAINT "PartnerVisitDay_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAttribution" ADD CONSTRAINT "PartnerAttribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAttribution" ADD CONSTRAINT "PartnerAttribution_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Commission is a report figure between 0 and 50 percent; visit counts never go negative.
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_commission_range" CHECK ("commissionPct" BETWEEN 0 AND 50);
ALTER TABLE "PartnerVisitDay" ADD CONSTRAINT "PartnerVisitDay_count_nonnegative" CHECK ("count" >= 0);
