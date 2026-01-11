-- AlterTable
ALTER TABLE "stories" ADD COLUMN "tldr" TEXT;
ALTER TABLE "stories" ADD COLUMN "tldr_content_length" INTEGER;
ALTER TABLE "stories" ADD COLUMN "tldr_generated_at" DATETIME;
ALTER TABLE "stories" ADD COLUMN "tldr_model" TEXT;
