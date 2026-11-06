-- API.md §7.48: lifecycle e-mails (one row per mail a rule sent).
-- CreateTable
CREATE TABLE "LifecycleSend" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rule" VARCHAR(20) NOT NULL,
    "periodKey" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'SENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifecycleSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifecycleSend_createdAt_idx" ON "LifecycleSend"("createdAt");

-- CreateIndex
CREATE INDEX "LifecycleSend_userId_createdAt_idx" ON "LifecycleSend"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleSend_userId_rule_periodKey_key" ON "LifecycleSend"("userId", "rule", "periodKey");

-- AddForeignKey
ALTER TABLE "LifecycleSend" ADD CONSTRAINT "LifecycleSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- API.md §7.48: only the known rules and states are ever written.
ALTER TABLE "LifecycleSend" ADD CONSTRAINT "LifecycleSend_rule_known" CHECK ("rule" IN ('onboarding', 'firstResult', 'inactive'));
ALTER TABLE "LifecycleSend" ADD CONSTRAINT "LifecycleSend_status_known" CHECK ("status" IN ('SENDING', 'SENT', 'FAILED'));
