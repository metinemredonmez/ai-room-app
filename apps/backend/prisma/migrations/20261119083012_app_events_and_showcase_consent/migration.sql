-- AlterTable
ALTER TABLE "Design" ADD COLUMN     "showcaseConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AppEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" VARCHAR(40) NOT NULL,
    "platform" VARCHAR(12),
    "version" VARCHAR(20),
    "sessionId" VARCHAR(64),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppEvent_name_createdAt_idx" ON "AppEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "AppEvent_userId_createdAt_idx" ON "AppEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AppEvent" ADD CONSTRAINT "AppEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
