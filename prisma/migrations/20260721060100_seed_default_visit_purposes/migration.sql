-- Backfill 6 kategori keperluan default untuk SEMUA tenant yang belum punya
-- baris visit_purpose sama sekali (tenant lama dibuat sebelum fitur ini —
-- seed on-create hanya jalan untuk tenant baru). Guard NOT EXISTS bikin ini
-- aman diulang & tidak menimpa tenant yang sudah dikustomisasi admin.
INSERT INTO "visit_purpose" ("tenant_id", "label", "sort_order")
SELECT t."id", v.label, v.ord
FROM "tenants" t
CROSS JOIN (VALUES
    ('Konsultasi Layanan', 0),
    ('Bertemu Pejabat/Staf', 1),
    ('Pengaduan', 2),
    ('Informasi Umum', 3),
    ('Keperluan Administratif', 4),
    ('Lainnya', 5)
) AS v(label, ord)
WHERE NOT EXISTS (
    SELECT 1 FROM "visit_purpose" p WHERE p."tenant_id" = t."id"
);
