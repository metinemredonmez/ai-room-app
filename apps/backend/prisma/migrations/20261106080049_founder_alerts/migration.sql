-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "message" VARCHAR(300) NOT NULL,
    "location" VARCHAR(200) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRequestId" VARCHAR(64),
    "lastAlertedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "dedupeKey" VARCHAR(120) NOT NULL,
    "sentTo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_fingerprint_key" ON "ErrorGroup"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorGroup_lastSeen_idx" ON "ErrorGroup"("lastSeen");

-- CreateIndex
CREATE INDEX "AlertLog_createdAt_idx" ON "AlertLog"("createdAt");

-- CreateIndex
CREATE INDEX "AlertLog_dedupeKey_createdAt_idx" ON "AlertLog"("dedupeKey", "createdAt");

-- Guard rails (API.md §7.41).
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_kind_known" CHECK ("kind" IN ('http', 'job', 'other'));
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_count_positive" CHECK ("count" > 0);
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_kind_known" CHECK ("kind" IN ('error', 'job', 'purchase', 'disk', 'budget', 'test'));
