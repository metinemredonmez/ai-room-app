-- API.md §7.54: cache of the coach's spoken replies (no user link; files in private storage).
CREATE TABLE "CoachAudio" (
    "key" CHAR(64) NOT NULL,
    "mime" VARCHAR(20) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachAudio_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "CoachAudio_lastUsedAt_idx" ON "CoachAudio"("lastUsedAt");
