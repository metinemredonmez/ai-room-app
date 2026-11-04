-- CreateTable
CREATE TABLE "WelcomeGrant" (
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomeGrant_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "WelcomeGrant_createdAt_idx" ON "WelcomeGrant"("createdAt");
