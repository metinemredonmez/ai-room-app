-- CreateTable
CREATE TABLE "WaitlistCampaign" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "commercial" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistCampaignSend" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistCampaignSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistCampaign_status_createdAt_idx" ON "WaitlistCampaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistCampaignSend_createdAt_idx" ON "WaitlistCampaignSend"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistCampaignSend_campaignId_entryId_key" ON "WaitlistCampaignSend"("campaignId", "entryId");

-- AddForeignKey
ALTER TABLE "WaitlistCampaign" ADD CONSTRAINT "WaitlistCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistCampaignSend" ADD CONSTRAINT "WaitlistCampaignSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WaitlistCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

