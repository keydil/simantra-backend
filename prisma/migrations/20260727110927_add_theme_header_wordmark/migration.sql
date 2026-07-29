-- CreateEnum
CREATE TYPE "tenant_header_mode" AS ENUM ('generated', 'wordmark');

-- AlterTable
ALTER TABLE "tenant_themes" ADD COLUMN     "header_mode" "tenant_header_mode" NOT NULL DEFAULT 'generated',
ADD COLUMN     "header_wordmark_url" VARCHAR(512);
