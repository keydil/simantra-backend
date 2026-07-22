-- CreateEnum
CREATE TYPE "role" AS ENUM ('superadmin', 'admin', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "subscription_tier" AS ENUM ('free', 'standard', 'premium');

-- CreateEnum
CREATE TYPE "queue_entry_status" AS ENUM ('waiting', 'serving', 'completed', 'no_show', 'cancelled');

-- CreateEnum
CREATE TYPE "announcement_type" AS ENUM ('update', 'warning', 'maintenance', 'info');

-- CreateEnum
CREATE TYPE "announcement_target" AS ENUM ('all', 'specific');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "subdomain" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "logo_url" VARCHAR(512),
    "brand_color" VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "subscription_tier" "subscription_tier" NOT NULL DEFAULT 'standard',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" VARCHAR(255),
    "role" "role" NOT NULL DEFAULT 'operator',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "legacy_auth_user_id" UUID,
    "last_login" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" VARCHAR(512),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "display_name" VARCHAR(255),
    "service_code" VARCHAR(50),
    "color_code" VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_capacity" INTEGER NOT NULL DEFAULT 100,
    "estimated_service_time_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queue_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_number" VARCHAR(50) NOT NULL,
    "customer_name" VARCHAR(255),
    "status" "queue_entry_status" NOT NULL DEFAULT 'waiting',
    "service_window" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "announcement_type" "announcement_type" NOT NULL DEFAULT 'update',
    "target_tenants" "announcement_target" NOT NULL DEFAULT 'all',
    "specific_tenant_ids" UUID[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "queue_id" UUID,
    "date" DATE NOT NULL,
    "total_entries" INTEGER NOT NULL DEFAULT 0,
    "completed_entries" INTEGER NOT NULL DEFAULT 0,
    "no_show_entries" INTEGER NOT NULL DEFAULT 0,
    "cancelled_entries" INTEGER NOT NULL DEFAULT 0,
    "average_service_time_minutes" DECIMAL(10,2),
    "peak_hour" INTEGER,
    "peak_count" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_themes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "primary_color" VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
    "secondary_color" VARCHAR(7) NOT NULL DEFAULT '#1E40AF',
    "accent_color" VARCHAR(7) NOT NULL DEFAULT '#10B981',
    "text_color" VARCHAR(7) NOT NULL DEFAULT '#1F2937',
    "background_color" VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
    "logo_url" VARCHAR(512),
    "favicon_url" VARCHAR(512),
    "custom_css" TEXT,
    "is_custom_theme" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_book" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "institution" VARCHAR(255) NOT NULL,
    "purpose" VARCHAR(500) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "photo_url" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_book_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_name_key" ON "tenants"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_email_key" ON "tenant_users"("email");

-- CreateIndex
CREATE INDEX "tenant_users_tenant_id_idx" ON "tenant_users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "queues_tenant_id_idx" ON "queues"("tenant_id");

-- CreateIndex
CREATE INDEX "queue_entries_queue_id_idx" ON "queue_entries"("queue_id");

-- CreateIndex
CREATE INDEX "queue_entries_tenant_id_idx" ON "queue_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "queue_entries_status_idx" ON "queue_entries"("status");

-- CreateIndex
CREATE INDEX "queue_entries_entered_at_idx" ON "queue_entries"("entered_at");

-- CreateIndex
CREATE INDEX "announcements_is_active_idx" ON "announcements"("is_active");

-- CreateIndex
CREATE INDEX "analytics_daily_tenant_id_date_idx" ON "analytics_daily"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_daily_tenant_id_queue_id_date_key" ON "analytics_daily"("tenant_id", "queue_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_themes_tenant_id_key" ON "tenant_themes"("tenant_id");

-- CreateIndex
CREATE INDEX "guest_book_tenant_id_created_at_idx" ON "guest_book"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "tenant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "tenant_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_themes" ADD CONSTRAINT "tenant_themes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_book" ADD CONSTRAINT "guest_book_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Tambahan di luar kemampuan schema.prisma (lihat header schema.prisma):
-- partial index posisi antrian + views warisan 01-init-schema.sql
-- ============================================================================

-- Index parsial untuk query "berapa yang menunggu di depan saya" (§3.2)
CREATE INDEX "idx_queue_entries_waiting_position"
  ON "queue_entries" ("queue_id", "entered_at")
  WHERE status = 'waiting';

-- Views convenience (dipakai getStatusSummary & laporan)
CREATE OR REPLACE VIEW active_queues AS
  SELECT q.*, t.name AS tenant_name
  FROM queues q
  JOIN tenants t ON q.tenant_id = t.id
  WHERE q.is_active = true AND t.is_active = true;

CREATE OR REPLACE VIEW queue_status_summary AS
  SELECT
    qe.queue_id,
    qe.tenant_id,
    q.name AS queue_name,
    COUNT(*) AS total_in_queue,
    COUNT(CASE WHEN qe.status = 'serving' THEN 1 END) AS currently_serving,
    COUNT(CASE WHEN qe.status = 'waiting' THEN 1 END) AS waiting_count,
    MAX(qe.entered_at) AS latest_entry_time
  FROM queue_entries qe
  LEFT JOIN queues q ON qe.queue_id = q.id
  WHERE qe.status IN ('waiting', 'serving')
  GROUP BY qe.queue_id, qe.tenant_id, q.name;
