// Migrasi data Supabase → Postgres lokal (§6 langkah 5 DESIGN.md).
//
// Jalankan: npm run migrate:supabase   (perlu SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY di .env)
// Flag:
//   --allow-nonempty  izinkan target DB yang sudah berisi data (default: menolak,
//                     jalankan dulu `npx prisma migrate reset --force --skip-seed`)
//   --skip-photos     lewati download foto guest book dari Supabase Storage
//
// Perilaku penting:
// - SEMUA primary key UUID dipertahankan apa adanya → relasi antar tabel tetap utuh.
// - tenant_users: password TIDAK dimigrasi (hash bcrypt auth.users tidak diakses;
//   kebijakan DESIGN.md: reset paksa). Tiap user dapat password sementara acak +
//   must_change_password=true. Daftar password sementara ditulis ke
//   migration-output/temp-passwords.csv (gitignored — bagikan manual lalu hapus).
// - auth_user_id lama disimpan ke legacy_auth_user_id (mapping created_by dsb).
// - Idempoten untuk data (createMany skipDuplicates / upsert by id) — aman diulang.

import { randomBytes, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ALLOW_NONEMPTY = process.argv.includes('--allow-nonempty');
const SKIP_PHOTOS = process.argv.includes('--skip-photos');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib di-set di .env');
  console.error('  (service role key: Supabase Dashboard → Project Settings → API → service_role)');
  process.exit(1);
}

const prisma = new PrismaClient();
const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn(`  WARN  ${msg}`); };

// ── Sumber: PostgREST dengan service key (bypass RLS), paginated ───────────
async function fetchAll(table) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        range: `${from}-${from + page - 1}`,
      },
    });
    if (!res.ok) throw new Error(`fetch ${table} gagal: ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

const d = (v) => (v == null ? null : new Date(v));

async function main() {
  // Guard: target harus kosong kecuali dipaksa
  const existing = await prisma.tenant.count();
  if (existing > 0 && !ALLOW_NONEMPTY) {
    console.error(`ERROR: DB target sudah berisi ${existing} tenant (data seed/tes?).`);
    console.error('  Reset dulu: npx prisma migrate reset --force --skip-seed');
    console.error('  atau paksa dengan --allow-nonempty (id yang sama akan di-skip).');
    process.exit(1);
  }

  console.log(`Sumber: ${SUPABASE_URL}\n`);

  // ── 1) tenants ───────────────────────────────────────────────────────────
  const tenants = await fetchAll('tenants');
  await prisma.tenant.createMany({
    skipDuplicates: true,
    data: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      subdomain: t.subdomain,
      description: t.description,
      logoUrl: t.logo_url,
      brandColor: t.brand_color ?? '#3B82F6',
      isActive: t.is_active ?? true,
      subscriptionTier: t.subscription_tier ?? 'standard',
      createdAt: d(t.created_at) ?? undefined,
      updatedAt: d(t.updated_at) ?? undefined,
    })),
  });
  console.log(`tenants          : ${tenants.length}`);

  // ── 2) tenant_themes ─────────────────────────────────────────────────────
  const themes = await fetchAll('tenant_themes');
  await prisma.tenantTheme.createMany({
    skipDuplicates: true,
    data: themes.map((th) => ({
      id: th.id,
      tenantId: th.tenant_id,
      primaryColor: th.primary_color ?? '#3B82F6',
      secondaryColor: th.secondary_color ?? '#1E40AF',
      accentColor: th.accent_color ?? '#10B981',
      textColor: th.text_color ?? '#1F2937',
      backgroundColor: th.background_color ?? '#FFFFFF',
      logoUrl: th.logo_url,
      faviconUrl: th.favicon_url,
      customCss: th.custom_css,
      isCustomTheme: th.is_custom_theme ?? false,
      createdAt: d(th.created_at) ?? undefined,
      updatedAt: d(th.updated_at) ?? undefined,
    })),
  });
  console.log(`tenant_themes    : ${themes.length}`);

  // ── 3) tenant_users (password reset paksa + CSV) ─────────────────────────
  const users = await fetchAll('tenant_users');
  const legacyToNewId = new Map(); // auth_user_id lama → tenant_users.id
  const csvLines = ['email,temp_password,role,tenant_id'];
  const seenEmails = new Set();
  let userCount = 0;

  for (const u of users) {
    if (seenEmails.has(u.email)) {
      warn(`email duplikat di-skip: ${u.email} (row ${u.id}) — resolve manual`);
      continue;
    }
    seenEmails.add(u.email);

    const tempPassword = randomBytes(9).toString('base64url'); // 12 char
    await prisma.tenantUser.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        tenantId: u.tenant_id,
        email: u.email,
        passwordHash: await argon2.hash(tempPassword),
        fullName: u.full_name,
        role: u.role ?? 'operator',
        isActive: u.is_active ?? true,
        mustChangePassword: true,
        legacyAuthUserId: u.auth_user_id,
        lastLogin: d(u.last_login),
        createdAt: d(u.created_at) ?? undefined,
        updatedAt: d(u.updated_at) ?? undefined,
      },
    });
    legacyToNewId.set(u.auth_user_id, u.id);
    csvLines.push(`${u.email},${tempPassword},${u.role},${u.tenant_id ?? ''}`);
    userCount++;
  }
  console.log(`tenant_users     : ${userCount}${users.length !== userCount ? ` (${users.length - userCount} di-skip)` : ''}`);

  await mkdir(resolve('migration-output'), { recursive: true });
  await writeFile(resolve('migration-output/temp-passwords.csv'), csvLines.join('\n'), 'utf8');

  // ── 4) queues ────────────────────────────────────────────────────────────
  const queues = await fetchAll('queues');
  await prisma.queue.createMany({
    skipDuplicates: true,
    data: queues.map((q) => ({
      id: q.id,
      tenantId: q.tenant_id,
      name: q.name,
      description: q.description,
      displayName: q.display_name,
      serviceCode: q.service_code,
      colorCode: q.color_code ?? '#3B82F6',
      isActive: q.is_active ?? true,
      maxCapacity: q.max_capacity ?? 100,
      estimatedServiceTimeMinutes: q.estimated_service_time_minutes ?? 15,
      createdAt: d(q.created_at) ?? undefined,
      updatedAt: d(q.updated_at) ?? undefined,
    })),
  });
  console.log(`queues           : ${queues.length}`);

  // ── 5) queue_entries (chunked) ───────────────────────────────────────────
  const entries = await fetchAll('queue_entries');
  for (let i = 0; i < entries.length; i += 1000) {
    await prisma.queueEntry.createMany({
      skipDuplicates: true,
      data: entries.slice(i, i + 1000).map((e) => ({
        id: e.id,
        queueId: e.queue_id,
        tenantId: e.tenant_id,
        ticketNumber: e.ticket_number,
        customerName: e.customer_name,
        status: e.status ?? 'waiting',
        serviceWindow: e.service_window,
        priority: e.priority ?? 0,
        enteredAt: d(e.entered_at) ?? undefined,
        startedAt: d(e.started_at),
        completedAt: d(e.completed_at),
        notes: e.notes,
      })),
    });
  }
  console.log(`queue_entries    : ${entries.length}`);

  // ── 6) announcements (map created_by via legacy id) ──────────────────────
  const announcements = await fetchAll('announcements');
  const fallbackSuperadmin = users.find((u) => u.role === 'superadmin');
  let annCount = 0;
  for (const a of announcements) {
    const createdBy = legacyToNewId.get(a.created_by) ?? fallbackSuperadmin?.id;
    if (!createdBy) {
      warn(`announcement "${a.title}" di-skip: created_by tidak bisa dipetakan & tidak ada superadmin`);
      continue;
    }
    if (!legacyToNewId.has(a.created_by)) {
      warn(`announcement "${a.title}": created_by asli tidak ditemukan, dipetakan ke superadmin`);
    }
    await prisma.announcement.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        title: a.title,
        description: a.description,
        announcementType: a.announcement_type ?? 'update',
        targetTenants: a.target_tenants ?? 'all',
        specificTenantIds: a.specific_tenant_ids ?? [],
        isActive: a.is_active ?? true,
        priority: a.priority ?? 0,
        publishedAt: d(a.published_at) ?? undefined,
        expiresAt: d(a.expires_at),
        createdBy,
        createdAt: d(a.created_at) ?? undefined,
        updatedAt: d(a.updated_at) ?? undefined,
      },
    });
    annCount++;
  }
  console.log(`announcements    : ${annCount}`);

  // ── 7) analytics_daily ───────────────────────────────────────────────────
  const analytics = await fetchAll('analytics_daily');
  await prisma.analyticsDaily.createMany({
    skipDuplicates: true,
    data: analytics.map((a) => ({
      id: a.id,
      tenantId: a.tenant_id,
      queueId: a.queue_id,
      date: d(a.date),
      totalEntries: a.total_entries ?? 0,
      completedEntries: a.completed_entries ?? 0,
      noShowEntries: a.no_show_entries ?? 0,
      cancelledEntries: a.cancelled_entries ?? 0,
      averageServiceTimeMinutes: a.average_service_time_minutes,
      peakHour: a.peak_hour,
      peakCount: a.peak_count,
      createdAt: d(a.created_at) ?? undefined,
    })),
  });
  console.log(`analytics_daily  : ${analytics.length}`);

  // ── 8) guest_book (+ migrasi foto dari Supabase Storage) ─────────────────
  const guestBook = await fetchAll('guest_book');
  await prisma.guestBookEntry.createMany({
    skipDuplicates: true,
    data: guestBook.map((g) => ({
      id: g.id,
      tenantId: g.tenant_id,
      name: g.name,
      institution: g.institution,
      purpose: g.purpose,
      phone: g.phone,
      photoUrl: g.photo_url,
      createdAt: d(g.created_at) ?? undefined,
    })),
  });
  console.log(`guest_book       : ${guestBook.length}`);

  if (!SKIP_PHOTOS) {
    const uploadsDir = resolve(process.env.STORAGE_LOCAL_DIR ?? './uploads');
    const baseUrl = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
    await mkdir(join(uploadsDir, 'guest-photos'), { recursive: true });
    let okPhotos = 0;
    const withPhotos = guestBook.filter((g) => g.photo_url && g.photo_url.includes('supabase.co'));
    for (const g of withPhotos) {
      try {
        const res = await fetch(g.photo_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const mime = res.headers.get('content-type') ?? '';
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
        const filename = `${randomUUID()}.${ext}`;
        await writeFile(join(uploadsDir, 'guest-photos', filename), Buffer.from(await res.arrayBuffer()));
        await prisma.guestBookEntry.update({
          where: { id: g.id },
          data: { photoUrl: `${baseUrl}/uploads/guest-photos/${filename}` },
        });
        okPhotos++;
      } catch (e) {
        warn(`foto guest_book ${g.id} gagal diunduh (URL lama dipertahankan): ${e.message}`);
      }
    }
    console.log(`foto guest book  : ${okPhotos}/${withPhotos.length} dipindah ke storage lokal`);
  }

  // ── Ringkasan ────────────────────────────────────────────────────────────
  console.log('\nSelesai.');
  console.log('Password sementara SEMUA user: migration-output/temp-passwords.csv');
  console.log('  → bagikan ke staff masing-masing, mereka wajib ganti password saat login pertama.');
  console.log('  → HAPUS file CSV ini setelah dibagikan.');
  if (warnings.length) console.log(`\n${warnings.length} warning — baca output di atas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
