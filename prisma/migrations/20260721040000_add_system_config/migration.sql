-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "maintenance_message" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);
