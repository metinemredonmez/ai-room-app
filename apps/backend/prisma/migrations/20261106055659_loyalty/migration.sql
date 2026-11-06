-- AlterTable
ALTER TABLE "User" ADD COLUMN     "streakDay" VARCHAR(10),
ADD COLUMN     "streakDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LoyaltyGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rule" VARCHAR(20) NOT NULL,
    "periodKey" VARCHAR(20) NOT NULL,
    "credits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyGrant_rule_createdAt_idx" ON "LoyaltyGrant"("rule", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyGrant_userId_rule_periodKey_key" ON "LoyaltyGrant"("userId", "rule", "periodKey");

-- AddForeignKey
ALTER TABLE "LoyaltyGrant" ADD CONSTRAINT "LoyaltyGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guard rails (API.md §7.35): known rules only, a gift is positive and bounded, a streak never negative.
ALTER TABLE "LoyaltyGrant" ADD CONSTRAINT "LoyaltyGrant_rule_known" CHECK ("rule" IN ('streak', 'anniversary', 'winback'));
ALTER TABLE "LoyaltyGrant" ADD CONSTRAINT "LoyaltyGrant_credits_range" CHECK ("credits" BETWEEN 1 AND 50);
ALTER TABLE "User" ADD CONSTRAINT "User_streakDays_nonnegative" CHECK ("streakDays" >= 0);
