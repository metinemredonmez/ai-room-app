-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "method" VARCHAR(12) NOT NULL,
    "device" VARCHAR(80) NOT NULL,
    "ipPrefix" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "method" VARCHAR(12) NOT NULL,
    "reason" VARCHAR(30),
    "device" VARCHAR(80) NOT NULL,
    "ipPrefix" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_userId_lastUsedAt_idx" ON "AuthSession"("userId", "lastUsedAt");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guard rails (API.md §7.37).
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_method_known" CHECK ("method" IN ('password', 'register', 'guest', 'google', 'apple', 'review', 'unknown'));
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_method_known" CHECK ("method" IN ('password', 'register', 'guest', 'google', 'apple', 'admin', 'review'));
