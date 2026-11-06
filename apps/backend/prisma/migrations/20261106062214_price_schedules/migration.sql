-- CreateTable
CREATE TABLE "PriceSchedule" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "targetKey" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL,
    "previousValue" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" VARCHAR(12) NOT NULL DEFAULT 'SCHEDULED',
    "note" VARCHAR(200) NOT NULL,
    "outcome" VARCHAR(200),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "PriceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceSchedule_status_startsAt_idx" ON "PriceSchedule"("status", "startsAt");

-- CreateIndex
CREATE INDEX "PriceSchedule_kind_targetKey_idx" ON "PriceSchedule"("kind", "targetKey");

-- Guard rails (API.md §7.36).
ALTER TABLE "PriceSchedule" ADD CONSTRAINT "PriceSchedule_kind_known" CHECK ("kind" IN ('tool', 'pack'));
ALTER TABLE "PriceSchedule" ADD CONSTRAINT "PriceSchedule_status_known" CHECK ("status" IN ('SCHEDULED', 'ACTIVE', 'DONE', 'CANCELLED', 'FAILED'));
ALTER TABLE "PriceSchedule" ADD CONSTRAINT "PriceSchedule_value_range" CHECK ("value" BETWEEN 1 AND 10000);
ALTER TABLE "PriceSchedule" ADD CONSTRAINT "PriceSchedule_window" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
