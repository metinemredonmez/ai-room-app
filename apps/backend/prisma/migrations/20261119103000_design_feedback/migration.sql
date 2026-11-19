-- AlterTable
ALTER TABLE "Design" ADD COLUMN     "feedbackAt" TIMESTAMP(3),
ADD COLUMN     "feedbackRating" VARCHAR(8),
ADD COLUMN     "feedbackReason" VARCHAR(300);

