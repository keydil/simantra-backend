-- AlterTable
ALTER TABLE "tenant_themes" ADD COLUMN     "header_subtitle_bold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "header_subtitle_font" VARCHAR(32) NOT NULL DEFAULT 'default',
ADD COLUMN     "header_subtitle_text" VARCHAR(100),
ADD COLUMN     "header_title_bold" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "header_title_font" VARCHAR(32) NOT NULL DEFAULT 'default';
