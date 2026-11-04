-- CreateIndex
CREATE INDEX "WebhookEvent_userId_receivedAt_idx" ON "WebhookEvent"("userId", "receivedAt");
