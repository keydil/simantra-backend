-- AlterTable
ALTER TABLE "tenant_themes" ADD COLUMN     "header_subtitle_color" VARCHAR(7) NOT NULL DEFAULT '#64748b',
ADD COLUMN     "header_subtitle_size" VARCHAR(8) NOT NULL DEFAULT 'sm';
