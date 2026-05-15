-- AlterTable
ALTER TABLE "public"."orders"
ADD COLUMN "in_progress_started_at" TIMESTAMP(3),
ADD COLUMN "ready_at" TIMESTAMP(3),
ADD COLUMN "estimated_ready_at" TIMESTAMP(3);
