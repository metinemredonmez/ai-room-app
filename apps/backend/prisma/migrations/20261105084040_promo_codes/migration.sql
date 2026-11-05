-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('CREDITS', 'PRO_DAYS');

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "display" VARCHAR(40) NOT NULL,
    "campaign" VARCHAR(80) NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "newUsersOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "userId" UUID,
    "identityHash" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_hash_key" ON "PromoCode"("hash");

-- CreateIndex
CREATE INDEX "PromoCode_campaign_createdAt_idx" ON "PromoCode"("campaign", "createdAt");

-- CreateIndex
CREATE INDEX "PromoRedemption_userId_idx" ON "PromoRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_codeId_identityHash_key" ON "PromoRedemption"("codeId", "identityHash");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_codeId_userId_key" ON "PromoRedemption"("codeId", "userId");

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Amounts are positive and redemptions never exceed the limit (BUS-02: the database refuses an over-redemption even if
-- the application check were bypassed).
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_redeemed_range" CHECK ("redeemed" >= 0 AND ("maxRedemptions" IS NULL OR "redeemed" <= "maxRedemptions"));
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_max_positive" CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" > 0);
