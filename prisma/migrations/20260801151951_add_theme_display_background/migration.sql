-- CreateEnum
CREATE TYPE "tenant_display_background_mode" AS ENUM ('default', 'custom');

-- AlterTable
ALTER TABLE "tenant_themes" ADD COLUMN     "display_background_mode" "tenant_display_background_mode" NOT NULL DEFAULT 'default',
ADD COLUMN     "display_background_url" VARCHAR(512);
