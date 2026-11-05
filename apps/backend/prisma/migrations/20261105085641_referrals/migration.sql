-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED', 'REJECTED');

-- CreateTable
CREATE TABLE "ReferralCode" (
    "userId" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "inviterId" UUID,
    "inviteeId" UUID,
    "inviteeIdentityHash" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "inviteeCredits" INTEGER NOT NULL,
    "inviterCredits" INTEGER NOT NULL,
    "rejectReason" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_inviteeId_key" ON "Referral"("inviteeId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_inviteeIdentityHash_key" ON "Referral"("inviteeIdentityHash");

-- CreateIndex
CREATE INDEX "Referral_inviterId_status_rewardedAt_idx" ON "Referral"("inviterId", "status", "rewardedAt");

-- CreateIndex
CREATE INDEX "Referral_createdAt_idx" ON "Referral"("createdAt");

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Credits are never negative; an inviter never invites themself (also checked in code by e-mail identity).
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_credits_nonnegative" CHECK ("inviteeCredits" >= 0 AND "inviterCredits" >= 0);
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_not_self" CHECK ("inviterId" IS NULL OR "inviteeId" IS NULL OR "inviterId" <> "inviteeId");
