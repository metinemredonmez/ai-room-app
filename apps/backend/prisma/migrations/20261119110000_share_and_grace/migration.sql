-- AlterEnum
ALTER TYPE "EmailTokenPurpose" ADD VALUE 'EMAIL_CHANGE';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'PENDING_DELETION';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DesignShare" (
    "id" UUID NOT NULL,
    "designId" UUID NOT NULL,
    "token" VARCHAR(48) NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignShare_token_key" ON "DesignShare"("token");

-- CreateIndex
CREATE INDEX "DesignShare_expiresAt_idx" ON "DesignShare"("expiresAt");

-- AddForeignKey
ALTER TABLE "DesignShare" ADD CONSTRAINT "DesignShare_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignShare" ADD CONSTRAINT "DesignShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

