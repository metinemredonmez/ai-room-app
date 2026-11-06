-- API.md §7.47: waiting list and newsletter (double opt-in).
-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED');

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'tr',
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" VARCHAR(12) NOT NULL DEFAULT 'home',
    "status" "WaitlistStatus" NOT NULL DEFAULT 'PENDING',
    "consentVersion" VARCHAR(20) NOT NULL,
    "confirmHash" VARCHAR(64),
    "confirmSentAt" TIMESTAMP(3),
    "confirmMails" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_confirmHash_key" ON "WaitlistEntry"("confirmHash");

-- CreateIndex
CREATE INDEX "WaitlistEntry_status_createdAt_idx" ON "WaitlistEntry"("status", "createdAt");

-- API.md §7.47: the database refuses what the API would never write.
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_source_known" CHECK ("source" IN ('home', 'footer'));
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_platforms_known" CHECK ("platforms" <@ ARRAY['ios', 'android']::TEXT[]);
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_email_lower" CHECK ("email" = lower("email"));
