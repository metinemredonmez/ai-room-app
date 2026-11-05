-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "text" TEXT NOT NULL,
    "note" VARCHAR(200) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptVersion_key_createdAt_idx" ON "PromptVersion"("key", "createdAt");
