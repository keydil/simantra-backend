# Panduan Deploy SIMANTRA ke Produksi

Arsitektur target:

| Bagian | Platform | URL |
|---|---|---|
| Frontend (Next.js) | Vercel | `https://xxx.vercel.app` |
| Backend (NestJS) | Railway | `https://xxx.up.railway.app` |
| Database (Postgres) | Railway | jaringan internal |
| File upload | Cloudflare R2 | `https://pub-xxx.r2.dev` |
| Email | Resend | sudah aktif |

---

## 0. Akun yang perlu disiapkan

| Layanan | Perlu kartu? | Biaya |
|---|---|---|
| GitHub | tidak | gratis (sudah ada) |
| Vercel | tidak | gratis (Hobby) |
| **Railway** | **ya** | **$5/bln** (plan Free cuma $1 kredit/bln — tidak cukup untuk server nyala 24/7) |
| Cloudflare | kemungkinan ya | gratis (R2 free tier: 10 GB, egress gratis) |
| Resend | tidak | gratis (sudah ada) |

---

## 1. Cloudflare R2

Filesystem Railway bersifat **ephemeral** — tanpa R2, semua logo/video/foto tamu hilang tiap redeploy sementara baris database tetap menunjuk URL yang sudah 404. Jadi langkah ini wajib, bukan opsional.

1. Buat akun Cloudflare → menu **R2** → **Enable**.
2. **Create bucket**, nama misal `simantra-uploads`. Lokasi: pilih APAC kalau tersedia.
3. Buka bucket → **Settings** → **Public Development URL** → **Enable** (ketik `allow` untuk konfirmasi). Catat URL yang muncul: `https://pub-xxxxxxxx.r2.dev`.
4. Kembali ke halaman R2 → **Manage API Tokens** → **Create API Token**:
   - Permission: **Object Read & Write**
   - Scope: bucket `simantra-uploads` saja
   - Catat **Access Key ID** dan **Secret Access Key** — hanya ditampilkan **sekali**.
5. Catat **Account ID** (ada di sidebar dashboard R2).

Yang harus dikantongi setelah langkah ini: Account ID, Access Key ID, Secret Access Key, nama bucket, dan URL `pub-xxx.r2.dev`.

> Cloudflare menyatakan URL `r2.dev` **rate-limited dan ditujukan untuk development**. Untuk skala TA ini aman. Begitu punya domain sendiri, hubungkan sebagai Custom Domain ke bucket lalu cukup ganti `R2_PUBLIC_BASE_URL` — tapi lihat catatan di bagian Batasan soal rewrite data.

---

## 2. Railway — backend + Postgres

1. Buat akun, upgrade ke **Hobby**.
2. **New Project** → **Deploy from GitHub repo** → pilih `simantra-backend`.
3. Di project yang sama: **+ New** → **Database** → **Add PostgreSQL**.
4. Buka service backend → tab **Variables**, isi semua yang ada di tabel bagian 6.
   Untuk `DATABASE_URL`, isi dengan referensi variabel Railway (bukan disalin manual):
   ```
   ${{Postgres.DATABASE_URL}}
   ```
   Ini memakai jaringan internal Railway — lebih cepat dan tidak kena biaya egress.
5. Tab **Settings** → **Deploy**:
   - **Custom Start Command**: `npm run start:prod`
     ⚠️ **Wajib di-set.** Default `npm start` menjalankan `nest start` yang meng-compile ulang saat runtime dan bergantung pada devDependency — bukan untuk produksi.
   - **Pre-Deploy Command**: `npx prisma migrate deploy`
     Dijalankan setelah build tapi sebelum versi baru live, jadi skema selalu ter-migrasi lebih dulu.
   - **Replicas**: pastikan **1**. Socket.IO memakai adapter in-memory tanpa Redis; dengan 2+ replica, klien di replica A tidak akan pernah menerima event dari replica B — display TV & panel operator berhenti update tanpa pesan error, dan cron analitik jalan dobel.
   - **Healthcheck Path**: `/api/v1/health`
6. Tab **Networking** → **Generate Domain**. Catat URL `https://xxx.up.railway.app`.

Pada tahap ini `CORS_ORIGIN` dan `FRONTEND_BASE_URL` belum bisa diisi benar (URL Vercel belum ada) — isi sementara, nanti dibetulkan di langkah 4.

---

## 3. Vercel — frontend

1. **Add New** → **Project** → import repo `multitenant-simantra`.
2. ⚠️ **Settings → Git → Production Branch: `versi-nestjs`.**
   Repo ini tidak sedang berada di branch default; tanpa ini semua deploy hanya jadi Preview, tidak pernah jadi Production.
3. **Environment Variables** — dua saja, perhatikan sufiks path-nya karena keduanya wajib:
   ```
   NEXT_PUBLIC_API_URL = https://xxx.up.railway.app/api/v1
   NEXT_PUBLIC_WS_URL  = https://xxx.up.railway.app/realtime
   ```
   - `/api/v1` wajib ikut — client menyambung path seperti `/auth/refresh` langsung ke nilai ini.
   - `/realtime` adalah **namespace** Socket.IO, bukan path. Pakai skema `https://`, **jangan** `wss://` — Socket.IO yang menurunkannya sendiri.
   - Keduanya **di-inline saat build**. Mengubahnya nanti **wajib redeploy**, restart saja tidak berpengaruh.
4. Deploy. Catat URL `https://xxx.vercel.app`.

---

## 4. Kembali ke Railway

Isi dua variabel yang tadi belum bisa diisi, lalu **redeploy**:

```
CORS_ORIGIN        = https://xxx.vercel.app
FRONTEND_BASE_URL  = https://xxx.vercel.app
```

Tanpa spasi, tanpa slash di akhir. `CORS_ORIGIN` dipakai REST API **sekaligus** gateway WebSocket.

> URL preview Vercel berubah tiap deploy dan tidak akan lolos CORS. Itu wajar dan justru lebih aman — hanya domain produksi yang didaftarkan.

---

## 5. Isi data awal

Database produksi masih kosong. Jalankan **dari mesin lokal** dengan `DATABASE_URL` diarahkan ke database Railway — bukan dari dalam container, karena `ts-node` yang dipakai seeder cuma devDependency.

Ambil **`DATABASE_PUBLIC_URL`** dari service Postgres di Railway (tab Variables) — yang versi publik, bukan `.railway.internal`.

Buat file `.env.production` di folder backend (sudah otomatis ter-gitignore lewat pola `.env`):

```
DATABASE_URL=postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/railway
BOOTSTRAP_EMAIL=email-asli-anda@gmail.com
BOOTSTRAP_PASSWORD=password-kuat-min-8-karakter
BOOTSTRAP_NAME=Nama Anda
```

Lalu:

```bash
node --env-file=.env.production scripts/bootstrap-superadmin.mjs
```

Akun dibuat dengan `mustChangePassword: true`, jadi akan diminta ganti password saat login pertama. Pakai email asli supaya fitur lupa-password bisa dipakai kalau sewaktu-waktu terkunci.

Lalu isi data demo (tenant contoh + antrian + data analitik 14 hari, idempoten, aman diulang). Seeder ini lewat `npm run` sehingga `--env-file` tidak terbawa — set variabelnya langsung di shell.

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/railway"; npm run seed:demo
```

Git Bash:

```bash
DATABASE_URL="postgresql://postgres:xxx@xxx.proxy.rlwy.net:PORT/railway" npm run seed:demo
```

Tutup terminal setelah selesai supaya kredensial produksi tidak tertinggal di sesi shell.

> **Jangan pernah menjalankan `npm run db:seed` di produksi** — script itu meng-hardcode `admin@simantra.local` / `admin12345` dan beberapa akun demo berpassword lemah. Itu khusus dev.

---

## 6. Referensi environment variable Railway

| Var | Nilai | Wajib |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `TZ` | `Asia/Jakarta` | ✅ container default UTC, tanpa ini cron analitik salah batas hari |
| `JWT_SECRET` | string acak panjang **baru** (jangan pakai punya dev) | ✅ |
| `CORS_ORIGIN` | `https://xxx.vercel.app` | ✅ kalau kosong, SEMUA origin diizinkan + credentials |
| `FRONTEND_BASE_URL` | `https://xxx.vercel.app` | ✅ dipakai membangun link di email reset password |
| `COOKIE_SAMESITE` | `none` | ✅ beda domain Vercel↔Railway |
| `COOKIE_SECURE` | `true` | ✅ |
| `STORAGE_DRIVER` | `r2` | ✅ |
| `R2_ACCOUNT_ID` | dari Cloudflare | ✅ |
| `R2_ACCESS_KEY_ID` | dari Cloudflare | ✅ |
| `R2_SECRET_ACCESS_KEY` | dari Cloudflare | ✅ |
| `R2_BUCKET` | `simantra-uploads` | ✅ |
| `R2_PUBLIC_BASE_URL` | `https://pub-xxx.r2.dev` (tanpa slash akhir) | ✅ |
| `RESEND_API_KEY` | dari Resend | ✅ |
| `EMAIL_FROM` | `SIMANTRA <noreply@simantra.fadhilfa.my.id>` | ✅ |
| `PORT` | — | diisi Railway otomatis |
| `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS`, `RESET_TOKEN_TTL_MINUTES`, `THROTTLE_*` | — | opsional, ada default di kode |

Kelima variabel `R2_*` divalidasi saat boot: kalau `STORAGE_DRIVER=r2` tapi ada yang kosong, aplikasi **sengaja gagal start** dengan pesan jelas — jauh lebih mudah didiagnosis daripada error 500 misterius saat admin mengunggah logo pertama kali.

---

## 7. Verifikasi

1. `GET https://xxx.up.railway.app/api/v1/health` → `{"status":"ok","db":"up"}` dengan HTTP 200.
2. Buka URL Vercel → login superadmin → **reload halaman**. Kalau tetap login, cookie lintas domain berfungsi. **Ini tes paling penting.**
3. Upload logo tenant lewat UI → URL yang tampil harus berdomain `r2.dev` dan gambarnya muncul.
4. **Redeploy backend di Railway, lalu cek gambar tadi masih ada.** Ini yang membuktikan masalah filesystem ephemeral benar-benar teratasi.
5. Upload video signage (jalur staging disk → R2, paling rawan) → cek halaman display memutarnya.
6. Buka halaman display di dua tab, panggil antrian dari panel operator → keduanya harus ikut berubah (WebSocket + CORS gateway).
7. Uji lupa-password end-to-end → link di email harus mengarah ke domain Vercel, bukan localhost.

---

## 8. Kalau ada yang bermasalah

| Gejala | Penyebab paling mungkin |
|---|---|
| Ke-logout tiap reload halaman | `COOKIE_SAMESITE` bukan `none`, atau `COOKIE_SECURE` bukan `true`, atau `CORS_ORIGIN` tidak sama persis dengan domain Vercel |
| Login gagal, console browser penuh error CORS | `CORS_ORIGIN` salah/ada spasi/pakai slash di akhir |
| Upload berhasil tapi gambar tidak muncul | Public Development URL belum di-enable di bucket, atau `R2_PUBLIC_BASE_URL` salah/ada slash di akhir |
| Aplikasi gagal start, log menyebut `R2_...` | Salah satu dari 5 variabel R2 kosong |
| Display TV tidak update realtime | `CORS_ORIGIN` belum termasuk domain Vercel (gateway WS pakai variabel yang sama), atau replica > 1 |
| Email reset password mengarah ke localhost | `FRONTEND_BASE_URL` belum diisi URL Vercel |
| Frontend tetap nembak localhost | Env var Vercel diubah tapi belum redeploy (`NEXT_PUBLIC_*` di-inline saat build) |
| Data analitik harian bergeser sehari | `TZ` belum di-set `Asia/Jakarta` |

---

## 9. Batasan yang perlu diketahui

- **Safari/iOS akan memblokir cookie sesi.** `SameSite=None` adalah cookie pihak ketiga dan Safari memblokirnya secara default, jadi di iPhone/iPad sesi putus tiap reload. Chrome/Edge aman. **Solusinya**: begitu punya domain sendiri, arahkan frontend ke `app.domain.com` dan backend ke `api.domain.com` (satu domain induk), lalu set `COOKIE_SAMESITE=lax`. Tidak ada kode yang perlu diubah.
- **Wajib 1 replica** selama Socket.IO belum memakai Redis adapter.
- **Mengganti `R2_PUBLIC_BASE_URL` di kemudian hari butuh rewrite data.** URL absolut tersimpan permanen di 9 kolom database (`tenants.logo_url`, `tenant_themes.{logo,favicon,video,image,header_wordmark,display_background}_url`, `guest_book.photo_url`, `sponsor.image_url`), jadi pindah ke domain CDN nanti perlu `UPDATE ... SET x = REPLACE(x, 'url-lama', 'url-baru')` pada kolom-kolom itu.
- **Railway Hobby $5/bln sudah termasuk $5 kredit pemakaian.** Backend + Postgres kecil umumnya muat, tapi pemakaian di atas itu ditagih selisihnya — pantau tab Usage.
