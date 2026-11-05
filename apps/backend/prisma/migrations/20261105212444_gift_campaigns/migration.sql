-- CreateTable
CREATE TABLE "GiftCampaign" (
    "id" UUID NOT NULL,
    "segment" VARCHAR(40) NOT NULL,
    "days" INTEGER,
    "credits" INTEGER NOT NULL,
    "message" VARCHAR(140) NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "pushed" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'SENDING',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GiftCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftRecipient" (
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftRecipient_pkey" PRIMARY KEY ("campaignId","userId")
);

-- CreateIndex
CREATE INDEX "GiftCampaign_createdAt_idx" ON "GiftCampaign"("createdAt");

-- CreateIndex
CREATE INDEX "GiftRecipient_userId_idx" ON "GiftRecipient"("userId");

-- AddForeignKey
ALTER TABLE "GiftRecipient" ADD CONSTRAINT "GiftRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "GiftCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftRecipient" ADD CONSTRAINT "GiftRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A group gift gives at least one credit (API.md §7.32).
ALTER TABLE "GiftCampaign" ADD CONSTRAINT "GiftCampaign_credits_positive" CHECK ("credits" > 0);
