-- AlterTable
ALTER TABLE "stories" ADD COLUMN "rating" TEXT;

-- CreateIndex
CREATE INDEX "stories_rating_idx" ON "stories"("rating");
