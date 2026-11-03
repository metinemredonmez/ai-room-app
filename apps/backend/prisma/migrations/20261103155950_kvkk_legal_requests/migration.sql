-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requiresConsent" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "publishedBy" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" UUID,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'app',
    "contactEmail" TEXT,
    "details" TEXT NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "response" TEXT,
    "handledBy" UUID,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalDocument_kind_publishedAt_idx" ON "LegalDocument"("kind", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_kind_version_locale_key" ON "LegalDocument"("kind", "version", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "DataRequest_reference_key" ON "DataRequest"("reference");

-- CreateIndex
CREATE INDEX "DataRequest_status_dueAt_idx" ON "DataRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DataRequest_userId_createdAt_idx" ON "DataRequest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
