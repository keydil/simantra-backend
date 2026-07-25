# 🏗️ DESIGN.md — SIMANTRA Backend (NestJS)

**Status:** FASE DESAIN — belum ada kode implementasi.
**Tanggal:** 19 Juli 2026
**Referensi:** `simantra-multitenant/MIGRATION_AUDIT.md`, `UI_UX_AUDIT.md`, `lib/supabase/queries.ts`, `scripts/01-init-schema.sql` + scripts 03–13.

Backend ini menggantikan seluruh peran Supabase (PostgREST, Auth, Realtime, RLS, Storage) untuk frontend Next.js `simantra-multitenant`. Prinsip utama, sesuai kesimpulan MIGRATION_AUDIT.md: **konsolidasi 3 layer otorisasi (RLS + middleware.ts + auth-context.tsx) menjadi SATU sumber kebenaran — guard NestJS.** RLS tidak dibawa ke database baru; semua enforcement pindah ke service/guard layer, dan logika 7 RPC `SECURITY DEFINER` yang sudah dibuat di Supabase menjadi cetak biru langsung untuk service publik.

---

## 0. Pelajaran dari audit yang WAJIB terbawa ke desain

| # | Pelajaran (sumber) | Konsekuensi desain |
|---|---|---|
| L1 | RLS `_public_select` bocor lintas-tenant; filter client-side cuma UX (MIGRATION #1, #2) | Scoping tenant SELALU di server. Endpoint publik wajib menerima scoping eksplisit (`slug` atau UUID tiket) — persis kontrak 7 RPC yang sudah terbukti. Tidak pernah ada endpoint publik "list semua". |
| L2 | anon INSERT bisa spoof `status`/`priority`/`entered_at` (MIGRATION 🟡) | DTO whitelist ketat + kolom sensitif di-hardcode server-side (`status='waiting'`, `priority=0`, timestamp pakai `now()` server). |
| L3 | Race condition penomoran tiket count-then-insert (script 06) | Pembuatan tiket = transaksi DB dengan `SELECT ... FOR UPDATE` pada baris `queues`. |
| L4 | Bug "1 row semua NULL" dari RPC single-row (MIGRATION, bug sistemik 19 Jul) | REST semantics benar: tidak ketemu → **404**, bukan objek kosong. Frontend nanti cukup cek status HTTP. |
| L5 | Ghost account 3.3 (UI_UX_AUDIT) — `auth_user_id` random tanpa akun Auth | Pembuatan user = **satu transaksi atomik** (credential + profile satu tabel/satu transaksi, tidak mungkin drift), `must_change_password=true`, user dipaksa ganti password di login pertama. Pola ini sudah divalidasi di fix lama (`create-tenant-user/route.ts` + script 13) — diadopsi sebagai desain inti, bukan patch. |
| L6 | JWT claims staleness (custom access token hook — trade-off `is_active` ~1 jam) | Access token pendek (10–15 mnt) + refresh token di DB. Saat refresh, server re-cek `is_active` (user & tenant) → deaktivasi efektif maksimal seumur access token, dan bisa instan via revoke refresh token. |
| L7 | `search_path` & fungsi STRICT/NULL gotcha (2 insiden hook) | Tidak relevan lagi (tidak ada SECURITY DEFINER), tapi prinsipnya: semua logic DB non-trivial dites dengan input NULL/absen, dan migrasi dijalankan lewat tooling ORM, bukan SQL manual di dashboard di luar version control. |
| L8 | Perubahan RLS manual di dashboard tak ter-track (asal-usul bug #1) | Satu-satunya sumber skema = file migrasi di repo ini. Tidak ada perubahan DB di luar migrasi. |
| L9 | Rate limit/CAPTCHA tidak bisa di RLS (script 08) | Sekarang bisa: `@nestjs/throttler` di semua endpoint publik ber-write (ambil tiket, guest book). |
| L10 | Realtime `postgres_changes` diganti polling 3s sebagai workaround (script 05a) | WebSocket Gateway sendiri (socket.io) dengan room ter-scope; polling tetap dipertahankan frontend sebagai fallback. |
| L11 | Announcements = "CRUD tanpa pemirsa" (UI_UX 1.1), Admin tanpa analitik (UI_UX 1.2) | Backend sediakan endpoint yang frontend butuhkan untuk menutup gap ini (announcements aktif per-tenant termasuk publik; analytics per-tenant untuk admin), supaya fix UI tinggal konsumsi API. |

---

## 1. Struktur Module NestJS

```
src/
├── main.ts
├── app.module.ts
├── prisma/                    # PrismaModule (global) — PrismaService
├── common/
│   ├── decorators/            # @Public(), @Roles(...), @CurrentUser(), @CurrentTenant()
│   ├── guards/                # JwtAuthGuard (global), RolesGuard, TenantScopeGuard,
│   │                          #   MustChangePasswordGuard
│   ├── interceptors/          # (opsional) logging, serialisasi
│   ├── filters/               # HttpExceptionFilter — format error konsisten { statusCode, message }
│   └── dto/                   # PaginationDto, dsb.
├── auth/                      # login, refresh, logout, me, change-password; JwtStrategy
├── tenants/                   # CRUD tenants + tenant_themes (superadmin; admin read own)
├── users/                     # CRUD tenant_users — fix ghost account by design
├── queues/                    # CRUD queues (loket/layanan)
├── queue-entries/             # tiket: list/summary/update status/call-next (staff)
├── guest-book/                # buku tamu: list admin + submit publik + upload foto
├── announcements/             # CRUD superadmin + "active" per-tenant/publik
├── analytics/                 # baca analytics_daily + cron agregasi harian
├── public/                    # SEMUA endpoint anon (kiosk/TV/status/guest-book/tenant-branding)
│   │                          #   — port 1:1 dari 7 RPC SECURITY DEFINER
├── realtime/                  # WebSocket Gateway (socket.io) + RealtimeService (event bus)
└── storage/                   # upload file (foto guest book, logo tenant) — disk/S3 adapter
```

Catatan desain:
- **`public/` sengaja jadi module terpisah**, bukan dicampur ke `queues`/`queue-entries`. Alasannya dari audit: permukaan anon adalah tempat semua kebocoran terjadi. Satu module = satu tempat audit permukaan publik, semua handler-nya `@Public()` + throttled + DTO respons yang di-whitelist (lihat §4.8).
- `queue-entries` (staff) dan `public` (anon) berbagi service domain (`QueueEntriesService`) supaya logika status-transition & penomoran tiket tidak terduplikasi — mencegah drift seperti temuan UI_UX 1.3 (dua CRUD paralel untuk `queues`).
- `realtime/RealtimeService` dipanggil oleh service lain (bukan sebaliknya) — controller/service yang mengubah data yang memancarkan event, gateway hanya mengelola koneksi & room.

---

## 2. Autentikasi JWT + Guards

### 2.1 Model token
- **Access token (JWT, TTL 15 menit)** — claims:
  ```json
  {
    "sub": "<tenant_users.id>",
    "role": "superadmin | admin | operator | viewer",
    "tenant_id": "<uuid | null>",      // null untuk superadmin
    "tenant_slug": "<subdomain | null>",
    "must_change_password": false
  }
  ```
  Ini persis claims yang sudah dibuat di `custom_access_token_hook` (script 11) — frontend `middleware.ts` sudah didesain membacanya, jadi bentuknya dipertahankan agar migrasi frontend minim.
- **Refresh token (opaque, TTL 7 hari, rotating)** — disimpan **hashed** di tabel `refresh_tokens`. Setiap refresh: token lama di-revoke, terbit pasangan baru. Di titik refresh, server re-validasi `tenant_users.is_active` dan `tenants.is_active` → menjawab trade-off staleness yang dicatat di script 11 (Supabase: ~1 jam; di sini: maksimal 15 menit, atau instan dengan revoke semua refresh token user tsb).
- Password hash: **argon2id** (lib `argon2`).
- Penyimpanan di frontend: rekomendasi refresh token di httpOnly cookie + access token di memory; keputusan final di fase migrasi frontend (di luar scope dokumen ini). API mendukung dua-duanya (token juga diterima via `Authorization: Bearer`).

### 2.2 Rantai guard (urutan eksekusi)

```
AppThrottlerGuard (global, APP_GUARD) — src/common/guards/app-throttler.guard.ts
  → jalan PALING AWAL, sebelum JwtAuthGuard (request.user belum ada)
  → baca metadata @Public() sendiri (bukan request.user) buat pilih bucket:
    route @Public() → THROTTLE_LIMIT (default 100/60s), route staff (butuh
    JWT) → THROTTLE_STAFF_LIMIT (default 300/60s, tetap terbatas bukan
    unlimited). Alasan: throttle per-IP pertahanan utamanya buat trafik
    anonim; staff sudah digerbangi JwtAuthGuard+RolesGuard di bawah.
JwtAuthGuard (global, APP_GUARD)
  → skip jika handler ditandai @Public()
RolesGuard
  → baca @Roles('superadmin', 'admin', ...) di handler/controller; tanpa dekorator = semua role authenticated boleh
TenantScopeGuard
  → param :tenantId / :slug pada route harus == claim tenant_id/tenant_slug user;
    role 'superadmin' selalu lolos (tenant_id null = akses lintas tenant)
MustChangePasswordGuard (global)
  → jika claim must_change_password=true, tolak (403 MUST_CHANGE_PASSWORD) semua
    endpoint kecuali POST /auth/change-password, GET /auth/me, POST /auth/logout
```

Aturan role (konsolidasi dari `middleware.ts` + route API lama):
| Role | Cakupan |
|---|---|
| `superadmin` | Semua tenant, semua resource. Satu-satunya yang boleh CRUD `tenants`, `announcements`, dan membuat user role apapun. |
| `admin` | Hanya tenant sendiri: kelola queues, users (hanya role `admin`/`operator`, tenant dipaksa = tenant sendiri — aturan dari `create-tenant-user/route.ts`), guest book, theme, analytics, entries. |
| `operator` | Hanya tenant sendiri: baca queues/entries, ubah status entries (panggil/selesai/no-show/batal). |
| `viewer` | Read-only tenant sendiri (ada di CHECK constraint lama, dipertahankan). |

### 2.3 Alur pembuatan user (fix permanen ghost account 3.3)
1. `POST /users` (superadmin, atau admin utk tenant sendiri) — body: email, password awal, full_name, role, tenant_id (superadmin only).
2. Server: validasi aturan role → **satu transaksi**: insert `tenant_users` dengan `password_hash` + `must_change_password=true`. Tidak ada lagi dua sistem (Auth vs profil) yang bisa drift — ghost account jadi *mustahil secara struktural*, bukan sekadar di-patch.
3. Login pertama user baru → access token membawa `must_change_password=true` → `MustChangePasswordGuard` memblokir semuanya kecuali ganti password → `POST /auth/change-password` → flag di-clear (padanan RPC `mark_password_changed`), token baru diterbitkan.

---

## 3. Database & ORM

### 3.1 Keputusan ORM: **Prisma** (bukan TypeORM)

Alasan, dikaitkan langsung ke sejarah project ini:
1. **Type-safety yang tidak bisa di-bypass.** Project lama penuh `@ts-nocheck`/`@ts-ignore` (`queries.ts`) plus `ignoreBuildErrors: true`, dan itu meloloskan bug nyata (UI_UX 3.4: field yang tidak ada di type dibaca runtime). Prisma men-generate client dari skema — query ke kolom yang tidak ada gagal compile, dan tidak ada dekorator entity yang bisa diam-diam beda dari DDL sebenarnya (mode gagal klasik TypeORM: entity ≠ skema aktual).
2. **Migrasi sebagai artefak repo (pelajaran L8).** `prisma migrate` menghasilkan folder migrasi SQL yang ter-commit — persis obat untuk akar masalah "policy dibuat manual di dashboard di luar version control". `synchronize: true`-nya TypeORM adalah anti-pattern yang berbahaya di produksi; disiplin migrasinya lebih lemah.
3. **Skema lama gampang diserap.** `01-init-schema.sql` murni Postgres standar → jalankan sekali di DB baru → `prisma db pull` (introspeksi) → rapikan → jadi `schema.prisma` baseline. Tidak perlu menulis ulang DDL jadi dekorator.
4. Trade-off yang disadari: Prisma butuh `$queryRaw`/interactive transaction untuk `SELECT ... FOR UPDATE` (penomoran tiket, L3) dan untuk query view `queue_status_summary`. Ini terisolasi di 2–3 method service — dapat diterima, dan justru membuat titik-titik kritis konkurensi terlihat eksplisit di kode.

### 3.2 Skema: reuse `01-init-schema.sql` dengan delta berikut

**Dibuang** (perannya digantikan backend):
- Semua `CREATE POLICY` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — otorisasi kini 100% di guard/service (single source of truth). DB diakses lewat satu role koneksi milik backend.
- Extension `http` (tidak terpakai), `uuid-ossp` → pakai `gen_random_uuid()` bawaan (pgcrypto/PG13+).
- Tidak ada lagi fungsi `SECURITY DEFINER` — logika 7 RPC pindah ke service TypeScript (§4.8).

**Diubah / ditambah:**

| Tabel | Perubahan | Sumber |
|---|---|---|
| `tenant_users` | `tenant_id` **nullable** (superadmin); + `must_change_password BOOLEAN NOT NULL DEFAULT false`; + `password_hash TEXT NOT NULL`; **hapus** `auth_user_id` dari skema aktif (dipertahankan sementara sebagai kolom `legacy_auth_user_id` nullable HANYA untuk mapping data saat migrasi data dari Supabase, dihapus setelah cutover) | script 13; desain auth §2 |
| `refresh_tokens` **(baru)** | `id, user_id FK→tenant_users ON DELETE CASCADE, token_hash, expires_at, revoked_at, created_at, user_agent/ip (opsional)` | desain auth §2.1 |
| `guest_book` **(baru di file skema — di Supabase tabelnya ada tapi tidak pernah masuk `01-init-schema.sql`)** | `id UUID PK, tenant_id FK NOT NULL, name VARCHAR(255) NOT NULL, institution VARCHAR(255) NOT NULL, purpose VARCHAR(500) NOT NULL, phone VARCHAR(50) NOT NULL, photo_url VARCHAR(512), created_at timestamptz` — batas panjang mengikuti WITH CHECK script 08 | script 08, guest-book-form.tsx |
| `queue_entries` | + index parsial `(queue_id, entered_at) WHERE status='waiting'` (query posisi antrian); constraint CHECK status tetap | RPC 05a #6 |
| `announcements` | tetap; `created_by` FK → `tenant_users(id)` (dulu longgar ke auth.users) | 01-init |
| Views `active_queues`, `queue_status_summary` | dipertahankan apa adanya (dipakai `getStatusSummary`) — diakses via `$queryRaw` | queries.ts |

**Aturan integritas yang naik dari "disiplin client" menjadi constraint/logic server** (L2, L3):
- `ticket_number` dihitung dalam transaksi ber-lock (bukan constraint unik per-hari — mengikuti perilaku RPC 06 yang sudah terbukti di produksi; unik-per-hari bisa ditambah belakangan sebagai safety net).
- Transisi status divalidasi state machine di service: `waiting→serving`, `serving→completed|no_show`, `waiting|serving→cancelled`. Timestamp (`started_at`, `completed_at`) selalu diisi server, tidak pernah dari client (`updateStatus` lama menerima timestamp dari client — itu tidak dibawa).

### 3.3 Storage (pengganti Supabase Storage)
Bucket `guest-photos` (foto buku tamu) & logo tenant → module `storage/` dengan adapter interface (`LocalDiskStorage` untuk dev, `S3CompatibleStorage` untuk produksi — MinIO/R2/S3). Validasi server-side: mime whitelist (jpeg/png/webp), max size (mis. 2 MB), nama file di-generate server (UUID). Regex `photo_url` di script 08 tidak dibutuhkan lagi — URL foto dihasilkan backend sendiri, client tidak pernah mengirim URL bebas (L2).

---

## 4. Desain Endpoint REST API

Konvensi global:
- Prefix `/api/v1`. Response sukses = resource langsung; error via exception filter: `{ statusCode, message, error }`.
- **Tidak ketemu = 404** (L4). Soft-delete konsisten: `DELETE` = set `is_active=false` (mengikuti semantik `tenantQueries.delete` lama & cleanup script 07).
- Kolom `Auth`: `—` = `@Public()` (anon, throttled); selain itu daftar role (TenantScopeGuard implisit berlaku untuk semua route ber-`:tenantId`/`:slug`; superadmin selalu lolos scope).

### 4.1 Auth
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | `/auth/login` | — | email+password → `{ access_token, refresh_token, user }`; update `last_login`. Rate-limited ketat. Login superadmin & staff satu pintu (frontend `/auth` dan `/[tenant]/login` dua-duanya memanggil ini; validasi "user ini milik tenant slug X" dilakukan frontend dari claims, atau kirim `tenant_slug` opsional untuk divalidasi server). |
| POST | `/auth/refresh` | — (refresh token) | Rotasi token; re-cek `is_active` user+tenant (L6). |
| POST | `/auth/logout` | any | Revoke refresh token aktif. |
| GET | `/auth/me` | any | Profil + tenant (+ theme) — pengganti `fetchUserProfile` di `auth-context.tsx`. |
| POST | `/auth/change-password` | any (lolos MustChangePasswordGuard) | Ganti password sendiri; clear `must_change_password`; revoke semua refresh token lain; terbitkan token baru. |

### 4.2 Tenants & Themes (padanan `tenantQueries`, `themeQueries`)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/system/maintenance-status` | — (`@Public`) | `{active, message?}` — dipanggil halaman publik (kiosk/display/buku-tamu) untuk memutuskan tampil layar pemeliharaan. Tanpa auth (pengunjung anonim), sama alasannya dgn `/health`. Sumber: tabel singleton `system_config`. |
| PATCH | `/system/maintenance` | superadmin | Body `{active, message?}` — toggle Mode Maintenance global + pesan custom. Satu-satunya fitur nyata di `/dashboard/settings` (B1: 4 tab dekoratif dihapus). |
| GET | `/tenants` | superadmin | List semua (query `?is_active=`). `getAll` lama hardcode `is_active=true` — di sini superadmin bisa lihat semua (kebutuhan riil halaman Manajemen Instansi, UI_UX 3.2). |
| POST | `/tenants` | superadmin | Buat tenant + baris `tenant_themes` default dalam satu transaksi. Terima `logo_url` (hasil §4.9) — menutup gap "logo diupload lalu dibuang" (UI_UX 3.4). |
| GET | `/tenants/:id` | superadmin, admin (own) | |
| PATCH | `/tenants/:id` | superadmin | |
| DELETE | `/tenants/:id` | superadmin | Soft delete (`is_active=false`). |
| GET | `/tenants/:id/purge-preview` | superadmin | `{users, queues, entries, guest_book_entries}` — data yang akan ikut hancur kalau instansi dihapus permanen. Untuk layar konfirmasi "Zona Berbahaya". |
| DELETE | `/tenants/:id/permanent` | superadmin | **HARD DELETE, tidak bisa dibatalkan.** Cascade ke TenantUser (+RefreshToken), Queue, QueueEntry, AnalyticsDaily, TenantTheme, GuestBookEntry. **400 kalau tenant masih aktif** — wajib dinonaktifkan dulu (interlock dua langkah). Foto buku tamu & logo ikut dihapus dari storage, karena cascade Prisma tidak menyentuh disk. Diberi path sendiri, bukan `?hard=true`, supaya tidak mungkin terpicu karena salah ketik parameter. |
| GET | `/tenants/:id/theme` | superadmin, admin (own) | |
| PATCH | `/tenants/:id/theme` | superadmin, admin (own) | |

### 4.3 Users (padanan `tenantUserQueries` + route `create-tenant-user`)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/tenants/:tenantId/users` | superadmin, admin (own) | `?is_active=&role=` |
| GET | `/users/superadmins` | superadmin | List superadmin (tenant_id null) — dibutuhkan halaman `/dashboard/users`. |
| POST | `/users` | superadmin, admin | Alur §2.3. Aturan role & pemaksaan tenant persis `create-tenant-user/route.ts`. |
| PATCH | `/users/:id` | superadmin, admin (own tenant) | full_name/role/is_active. Admin tidak boleh menaikkan siapapun (termasuk dirinya) ke superadmin; user tidak bisa menonaktifkan dirinya sendiri. Ubah `is_active=false` → revoke semua refresh token user itu (efek instan, L6). |
| POST | `/users/:id/reset-password` | superadmin, admin (own tenant) | Set password baru + `must_change_password=true` — pengganti insiden "reset password via SQL" (script 12) dengan jalur resmi; email delivery tidak pernah ada di project ini. |
| DELETE | `/users/:id` | superadmin, admin (own tenant) | Soft delete. |

### 4.4 Queues (padanan `queueQueries` + halaman counters/queue-management)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/tenants/:tenantId/queues` | staff (own) | `?is_active=` |
| POST | `/tenants/:tenantId/queues` | superadmin, admin (own) | |
| GET | `/queues/:id` | staff (tenant pemilik) | Scope dicek dari `queue.tenant_id` vs claim. |
| PATCH | `/queues/:id` | superadmin, admin (own) | |
| DELETE | `/queues/:id` | superadmin, admin (own) | Soft delete. Satu set endpoint ini melayani DUA halaman lama (superadmin `queue-management` & admin `counters`) — menghapus duplikasi UI_UX 1.3 di sisi API. |

### 4.5 Queue Entries — staff (padanan `queueEntryQueries` + operator-panel)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/tenants/:tenantId/entries` | staff (own) | `?status=waiting,serving&queue_id=&limit=&since=` — menggantikan `getByTenant`/`getByQueue`. |
| GET | `/tenants/:tenantId/entries/summary` | staff (own) | View `queue_status_summary` (`getStatusSummary`). |
| GET | `/queues/:queueId/stats/today` | staff (own) | `{ waiting, completed, no_show, cancelled }` hari ini — 4 count paralel di operator-panel jadi 1 call. |
| POST | `/queues/:queueId/call-next` | operator, admin | Atomik (transaksi + lock): entry `waiting` tertua → `serving`, set `started_at`, `service_window` dari body. Emit WS `entry.called`. Menggantikan pola pilih-lalu-update di operator-panel yang bisa race antar dua operator. |
| PATCH | `/entries/:id/status` | operator, admin (own tenant) | Body `{ status }` — state machine §3.2, timestamp server-side, emit WS `entry.updated`. |
| PATCH | `/entries/:id` | operator, admin (own tenant) | `notes`, `customer_name`, `service_window` (recall/koreksi). |

### 4.6 Announcements (padanan `announcementQueries` — plus enabler fix UI_UX 1.1)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/announcements` | superadmin | Semua (CRUD dashboard). |
| POST | `/announcements` | superadmin | `created_by` dari JWT. |
| PATCH | `/announcements/:id` | superadmin | |
| DELETE | `/announcements/:id` | superadmin | Soft (`is_active=false`). |
| GET | `/tenants/:tenantId/announcements/active` | staff (own) | Logika `getActive(tenantId)`: aktif, belum expired, `target='all'` OR `specific_tenant_ids @> [tenantId]`, sort priority — untuk bell/banner admin & operator. |
| GET | `/public/tenants/:slug/announcements/active` | — | Subset untuk display publik: hanya tipe `maintenance`/`warning` (sesuai saran fix 1.1); field di-whitelist. |

### 4.7 Analytics (padanan `analyticsQueries` — plus enabler fix UI_UX 1.2)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/tenants/:tenantId/analytics` | staff (own) | `?from=&to=` — dipakai superadmin `/dashboard/analytics` DAN halaman analitik admin baru. |
| GET | `/queues/:queueId/analytics` | staff (own) | `?days=30` (`getQueueAnalytics`). |
| — | *(cron internal, `@nestjs/schedule`)* | — | Job harian (00:15 waktu server) agregasi `queue_entries` kemarin → upsert `analytics_daily` per tenant×queue (total/completed/no_show/cancelled, avg service time dari `started_at→completed_at`, peak hour). Di Supabase tidak ada satupun mekanisme pengisi tabel ini yang ter-version-control — sekarang jadi kode repo (L8). |

### 4.8 Public (anon) — port 1:1 dari 7 RPC `SECURITY DEFINER`
Semua `@Public()` + `@nestjs/throttler` (L9). Scoping = parameter wajib, filter di WHERE service — kontrak yang sama dengan RPC-nya (L1). Respons memakai **DTO whitelist** — endpoint publik tidak pernah mengembalikan kolom yang tidak dibutuhkan display (khususnya: list entries publik TIDAK menyertakan `customer_name`/`notes`; halaman tiket by-UUID boleh, karena UUID adalah capability pemegang tiket).

| Method | Path | Padanan RPC | Keterangan |
|---|---|---|---|
| GET | `/public/tenants/:slug` | `get_public_tenant` | Branding + theme utk kiosk/middleware; tenant tak aktif/tak ada → 404 (L4). |
| GET | `/public/tenants/:slug/queues` | `get_public_queues` | Layanan aktif, sort `service_code`. |
| GET | `/public/tenants/:slug/entries` | `get_public_queue_entries` | `?status=waiting,serving` — untuk TV display. DTO: `id, ticket_number, status, service_window, queue_id, entered_at`. |
| GET | `/public/entries/:id` | `get_public_queue_entry` | UUID tiket sebagai capability. 404 jika tak ada/tenant nonaktif. |
| GET | `/public/entries/:id/position` | `count_public_queue_position_ahead` | `{ ahead: number }`. |
| GET | `/public/queues/:id` | `get_public_queue` | Info layanan utk halaman tiket/status. |
| POST | `/public/tenants/:slug/queues/:queueId/entries` | `create_public_queue_entry` | Transaksi + `FOR UPDATE` lock di `queues` (L3); `status`/`priority`/`entered_at` hardcoded server (L2); throttle ketat per-IP; emit WS `entry.created`. Body opsional: `customer_name`. |

`count_public_queue_entries_since` tidak diberi endpoint — satu-satunya pemakainya adalah penomoran tiket client-side lama, yang sudah dipindah ke dalam transaksi create (RPC 06 juga sudah menghapus kebutuhannya).

### 4.9 Guest Book & Upload
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | `/public/tenants/:slug/guest-book` | — | Validasi DTO = WITH CHECK script 08 (trim length 1–255/500/50); throttled (L9); kolom di-whitelist. |
| POST | `/public/tenants/:slug/guest-book/photo` | — | Multipart upload → storage adapter → `{ photo_url }`; mime/size divalidasi; URL selalu buatan server (§3.3). |
| GET | `/public/tenants/:slug/guest-book/institutions` | — | `?search=` distinct autocomplete (dipakai `guest-book-form.tsx`). Hanya nama institusi, tidak pernah data pengunjung lain. |
| GET | `/public/tenants/:slug/guest-book/purposes` | — (`@Public`) | Kategori "Keperluan Kunjungan" per-tenant (aktif saja, urut `sort_order`) untuk chip form publik. Tabel `visit_purpose`. |
| GET | `/tenants/:tenantId/guest-book` | staff (own) | `?from=&to=&purpose=&search=&page=&limit=` + `count` — halaman admin guest book. |
| GET | `/tenants/:tenantId/guest-book/purposes` | staff (own) | Semua kategori (termasuk nonaktif) untuk halaman "Kelola Keperluan" & filter admin. |
| POST | `/tenants/:tenantId/guest-book/purposes` | superadmin, admin | Tambah kategori `{label, sort_order?}`. |
| PATCH | `/guest-book/purposes/:id` | superadmin, admin | Edit `label`/`sort_order`/`is_active` (reorder & toggle). |
| DELETE | `/guest-book/purposes/:id` | superadmin, admin | Soft delete (`is_active=false`). |
| POST | `/tenants/:tenantId/logo` | superadmin, admin (own) | Upload logo tenant → `{ logo_url }` — melengkapi fix UI_UX 3.4. |

### 4.10 Sponsors — logo mitra display ("OFFICIAL PARTNERS")
Child table per-tenant (BANYAK baris, beda dari `tenant.logo_url`/`theme.video_url`/
`theme.image_url` yang single-value), mirror `VisitPurpose` (§4.9). Self-manage
admin (konten operasional tampilan, sejajar video/foto/running-text — BUKAN
identitas brand seperti logo tenant/theme yang superadmin-only).

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/tenants/:tenantId/sponsors` | staff (own) | Semua baris (termasuk nonaktif), urut `sort_order` — halaman admin "Logo Sponsor / Mitra". |
| POST | `/tenants/:tenantId/sponsors` | superadmin, admin (own) | Multipart `file` (+ `name` opsional, alt text) → `saveImage` prefix `sponsor-logos` → row. Maks 8 sponsor per tenant. |
| PATCH | `/sponsors/:id` | superadmin, admin (own tenant) | `name`/`sort_order`/`is_active` (reorder & toggle). |
| DELETE | `/sponsors/:id` | superadmin, admin (own tenant) | **Hard delete** (beda dari VisitPurpose yang soft delete) — baris dihapus DAN file dihapus via `deleteByUrl` supaya tidak yatim. |
| GET | `/public/tenants/:slug/sponsors` | — (`@Public`) | Hanya aktif, urut `sort_order`, untuk strip display board. Endpoint terpisah dari `/public/tenants/:slug`, konsisten dengan pola announcements (§4.6). |

---

## 5. WebSocket Gateway (pengganti Supabase Realtime)

**Stack:** `@nestjs/websockets` + `@nestjs/platform-socket.io`; client `socket.io-client`. Satu gateway, namespace `/realtime`, model **room ter-scope** — meneruskan prinsip yang sama dengan REST publik: tidak ada room "semua tenant" (L1).

### 5.1 Room & otorisasi join
| Room | Siapa | Syarat join (divalidasi server saat `join`) |
|---|---|---|
| `tenant:{slug}:public` | TV display, kiosk | Slug ada & tenant aktif — kalau tidak, join ditolak. Event di room ini hanya membawa payload DTO publik (§4.8) — tanpa `customer_name`. |
| `entry:{entryId}` | HP pengunjung (status page) | Entry UUID ada & tenant aktif (UUID = capability, model trust yang sama dengan RPC). |
| `tenant:{tenantId}:staff` | Operator/admin panel | **JWT wajib** di `handshake.auth.token` → verifikasi → claim `tenant_id` harus cocok (superadmin bebas). Payload lengkap (termasuk `customer_name`). |

### 5.2 Events (server → client)
| Event | Room penerima | Trigger |
|---|---|---|
| `entry.created` | `tenant:{slug}:public`, `tenant:{tenantId}:staff` | Tiket baru diambil di kiosk. |
| `entry.updated` | kedua room tenant + `entry:{id}` | Perubahan status/field apapun. |
| `entry.called` | kedua room tenant + `entry:{id}` | `waiting→serving` (call-next) — event khusus supaya TV & status page bisa trigger TTS "dipanggil" tepat sekali (perilaku yang dulu dibangun di status-card). Payload: entry + `service_window` + `queue.display_name`. |
| `queue.updated` | kedua room tenant | CRUD queues (layanan muncul/hilang/ubah nama di kiosk & TV). |
| `announcement.updated` | `tenant:{tenantId}:staff` (+ `public` utk tipe maintenance/warning) | Enabler fix UI_UX 1.1 tanpa polling 30s. |

Emisi dilakukan `RealtimeService` yang dipanggil dari service domain **setelah transaksi DB commit** (bukan dari controller, bukan sebelum commit) — supaya event tidak pernah mendahului/berbeda dari state DB.

### 5.3 Strategi client & fallback
- Frontend lama sudah punya pola polling 3s (dipasang saat migrasi RPC, script 05a) — **dipertahankan sebagai fallback** saat socket disconnect; saat connected, polling berhenti. Ini juga jawaban untuk follow-up "WebSocket operator panel" di MIGRATION_AUDIT: koneksi lama `supabase.channel(postgres_changes)` diganti socket.io ke gateway ini dengan reconnect/backoff bawaan socket.io.
- Tidak ada state per-koneksi yang persisten di server (room membership saja) → gateway stateless, aman untuk restart; client cukup re-join room saat reconnect lalu refetch REST sekali untuk resync.

---

## 6. Konfigurasi, lingkungan & langkah berikutnya

**Env (`.env`):** `DATABASE_URL` (Postgres 15+ via Docker), `JWT_SECRET`, `JWT_ACCESS_TTL=15m`, `REFRESH_TTL=7d`, `STORAGE_DRIVER=local|s3` (+ kredensial S3), `THROTTLE_*`, `CORS_ORIGIN` (domain frontend).

**Paket inti:** `@nestjs/{core,common,platform-express,config,jwt,passport,websockets,platform-socket.io,schedule,throttler}`, `passport-jwt`, `argon2`, `prisma`+`@prisma/client`, `class-validator`+`class-transformer`, `multer`, `socket.io`.

**Urutan implementasi yang disarankan (fase berikutnya, bukan sekarang):**
1. Scaffold NestJS + Prisma + Docker Postgres; baseline skema (§3.2) sebagai migrasi pertama.
2. `auth/` + guards + `users/` (fondasi semua yang lain; ghost-account fix teruji sejak awal).
3. `public/` + `queue-entries/` + `realtime/` (jalur bisnis inti: ambil tiket → panggil → selesai, end-to-end dengan WS).
4. `tenants/`, `queues/`, `guest-book/`, `announcements/`, `analytics/` + cron.
5. Migrasi data dari Supabase (export CSV/pg_dump; mapping `auth_user_id`→user baru via `legacy_auth_user_id`; password di-reset paksa semua staff via `must_change_password`).
6. Ubah frontend per-hook (rencana kerja Fase 2 di MIGRATION_AUDIT tetap berlaku), mulai dari `lib/supabase/client.ts` → API client.

**Keputusan yang sengaja ditunda (perlu input sebelum implementasi):**
- Penyimpanan token di frontend (cookie httpOnly vs bearer) — menyentuh desain `middleware.ts` Next.js.
- Driver storage produksi (S3-compatible mana) & apakah foto guest book perlu retensi/purge.
- CAPTCHA di guest book / ambil tiket (throttler sudah ada; CAPTCHA opsional lapisan kedua).
