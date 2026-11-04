-- CreateEnum
CREATE TYPE "MarketingDraftStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'APPROVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "MarketingDraft" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" "MarketingDraftStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "violations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingDraft_kind_locale_createdAt_idx" ON "MarketingDraft"("kind", "locale", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingDraft_status_idx" ON "MarketingDraft"("status");
