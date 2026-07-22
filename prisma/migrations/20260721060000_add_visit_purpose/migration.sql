-- CreateTable
CREATE TABLE "visit_purpose" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_purpose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_purpose_tenant_id_idx" ON "visit_purpose"("tenant_id");

-- AddForeignKey
ALTER TABLE "visit_purpose" ADD CONSTRAINT "visit_purpose_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
