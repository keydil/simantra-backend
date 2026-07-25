-- CreateTable
CREATE TABLE "sponsor" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "image_url" VARCHAR(512) NOT NULL,
    "name" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsor_tenant_id_idx" ON "sponsor"("tenant_id");

-- AddForeignKey
ALTER TABLE "sponsor" ADD CONSTRAINT "sponsor_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
