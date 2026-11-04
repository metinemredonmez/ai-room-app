-- CreateEnum
CREATE TYPE "BroadcastChannel" AS ENUM ('PUSH', 'EMAIL');

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "channel" "BroadcastChannel" NOT NULL DEFAULT 'PUSH';
