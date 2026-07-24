-- AlterTable
ALTER TABLE "tenant_themes" ADD COLUMN "image_url" VARCHAR(512);
ALTER TABLE "tenant_themes" ADD COLUMN "queue_view_seconds" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "tenant_themes" ADD COLUMN "media_view_seconds" INTEGER NOT NULL DEFAULT 60;
