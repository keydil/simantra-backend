import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toWireTenant, toWireTheme } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DEFAULT_VISIT_PURPOSES } from '../visit-purposes/visit-purposes.service';
import {
  CreateTenantDto,
  ListTenantsQueryDto,
  UpdateDisplayConfigDto,
  UpdateTenantDto,
  UpdateThemeDto,
} from './dto/tenants.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Superadmin lihat SEMUA tenant (halaman Manajemen Instansi butuh yang
   *  nonaktif juga — beda dari getAll lama yang hardcode is_active). */
  async list(query: ListTenantsQueryDto) {
    const tenants = await this.prisma.tenant.findMany({
      where: query.is_active !== undefined ? { isActive: query.is_active === 'true' } : {},
      include: { theme: true },
      orderBy: { createdAt: 'desc' },
    });
    return tenants.map(toWireTenant);
  }

  /** Tenant + theme default dibuat SATU transaksi (nested create). */
  async create(dto: CreateTenantDto) {
    try {
      const tenant = await this.prisma.tenant.create({
        data: {
          name: dto.name,
          subdomain: dto.subdomain,
          description: dto.description ?? null,
          logoUrl: dto.logo_url ?? null,
          ...(dto.brand_color ? { brandColor: dto.brand_color } : {}),
          ...(dto.subscription_tier ? { subscriptionTier: dto.subscription_tier } : {}),
          theme: { create: {} },
          // Seed 6 kategori keperluan default — pola nested create sama seperti
          // theme di atas. Backfill tenant lama ada di script terpisah.
          visitPurposes: {
            create: DEFAULT_VISIT_PURPOSES.map((label, i) => ({ label, sortOrder: i })),
          },
        },
        include: { theme: true },
      });
      return toWireTenant(tenant);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Nama atau subdomain instansi sudah dipakai');
      }
      throw e;
    }
  }

  async getById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { theme: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan');
    return toWireTenant(tenant);
  }

  async update(tenantId: string, dto: UpdateTenantDto) {
    await this.ensureExists(tenantId);
    try {
      const tenant = await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.subdomain !== undefined ? { subdomain: dto.subdomain } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.logo_url !== undefined ? { logoUrl: dto.logo_url } : {}),
          ...(dto.brand_color !== undefined ? { brandColor: dto.brand_color } : {}),
          ...(dto.subscription_tier !== undefined ? { subscriptionTier: dto.subscription_tier } : {}),
          ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
        },
        include: { theme: true },
      });
      if (dto.is_active === false) await this.revokeTenantSessions(tenantId);
      return toWireTenant(tenant);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Nama atau subdomain instansi sudah dipakai');
      }
      throw e;
    }
  }

  /** Soft delete (semantik tenantQueries.delete lama) + revoke sesi staff
   *  tenant tsb supaya deaktivasi terasa instan (L6). */
  async softDelete(tenantId: string) {
    await this.ensureExists(tenantId);
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive: false },
      include: { theme: true },
    });
    await this.revokeTenantSessions(tenantId);
    return toWireTenant(tenant);
  }

  /**
   * Ringkasan apa saja yang akan ikut hancur kalau tenant ini dihapus permanen.
   * Dipakai layar konfirmasi "Zona Berbahaya" — mengetik nama instansi hanya
   * membuktikan user membaca namanya, angka inilah yang membuat harganya nyata
   * dan otomatis membedakan instansi uji coba (semua nol) dari yang sungguhan.
   */
  async purgePreview(tenantId: string) {
    await this.ensureExists(tenantId);
    const [users, queues, entries, guestBookEntries] = await this.prisma.$transaction([
      this.prisma.tenantUser.count({ where: { tenantId } }),
      this.prisma.queue.count({ where: { tenantId } }),
      this.prisma.queueEntry.count({ where: { tenantId } }),
      this.prisma.guestBookEntry.count({ where: { tenantId } }),
    ]);
    return {
      users,
      queues,
      entries,
      guest_book_entries: guestBookEntries,
    };
  }

  /**
   * HARD DELETE — tidak bisa dibatalkan. Cascade schema ikut menghapus
   * TenantUser (+ RefreshToken turunannya), Queue, QueueEntry, AnalyticsDaily,
   * TenantTheme, dan GuestBookEntry milik tenant ini.
   *
   * Interlock: tenant WAJIB sudah nonaktif. Ini penjaga terkuatnya — memaksa
   * penghapusan jadi keputusan dua langkah yang terpisah waktu, sekaligus
   * membuat instansi yang masih melayani pengunjung mustahil terhapus karena
   * salah klik. `softDelete()` sudah mencabut sesi staff-nya lebih dulu.
   */
  async purge(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan');
    if (tenant.isActive) {
      throw new BadRequestException(
        'Nonaktifkan instansi ini terlebih dahulu sebelum menghapus permanen',
      );
    }

    // URL file HARUS dikumpulkan sebelum baris DB lenyap — begitu cascade
    // jalan, tidak ada lagi cara mengetahui file mana yang jadi yatim.
    const photos = await this.prisma.guestBookEntry.findMany({
      where: { tenantId, photoUrl: { not: null } },
      select: { photoUrl: true },
    });
    // CATATAN: daftar ini masih BELUM lengkap. headerWordmarkUrl, videoUrl, dan
    // imageUrl juga tersimpan di tenant_themes dan sama-sama jadi file yatim
    // saat instansi dihapus permanen — celah yang sudah ada sebelum field latar
    // ini dan sengaja tidak ikut diperbaiki di sini supaya perubahannya tetap
    // sempit. Yang ditambahkan cuma displayBackgroundUrl, supaya field BARU tak
    // ikut menambah kebocoran yang sudah ada.
    const theme = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { displayBackgroundUrl: true },
    });
    const fileUrls = [
      tenant.logoUrl,
      theme?.displayBackgroundUrl,
      ...photos.map((p) => p.photoUrl),
    ].filter((u): u is string => !!u);

    await this.prisma.tenant.delete({ where: { id: tenantId } });

    // Baris DB sudah hilang; kegagalan menghapus file tidak boleh membuat
    // request ini gagal (penghapusannya toh sudah terjadi dan tak bisa
    // dibatalkan). Paling buruk menyisakan file yatim, bukan data rusak.
    await Promise.allSettled(fileUrls.map((u) => this.storage.deleteByUrl(u)));

    return { id: tenantId, deleted: true, files_removed: fileUrls.length };
  }

  async getTheme(tenantId: string) {
    const theme = await this.prisma.tenantTheme.findUnique({ where: { tenantId } });
    if (!theme) throw new NotFoundException('Theme tidak ditemukan');
    return toWireTheme(theme);
  }

  async updateTheme(tenantId: string, dto: UpdateThemeDto) {
    await this.ensureExists(tenantId);
    const theme = await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, ...this.themeData(dto) },
      update: this.themeData(dto),
    });
    return toWireTheme(theme);
  }

  /** Upload logo → storage → set tenants.logo_url (menutup gap UI_UX 3.4). */
  async uploadLogo(tenantId: string, buffer: Buffer, mime: string) {
    await this.ensureExists(tenantId);
    const { url } = await this.storage.saveImage(buffer, mime, 'tenant-logos');
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl: url } });
    return { logo_url: url };
  }

  /**
   * Wordmark judul-tengah kiosk. TIDAK XOR dengan apa pun, TIDAK menyentuh
   * headerMode — upload murni set URL; toggle mode terpisah lewat updateTheme
   * (dto.header_mode, lihat themeData). Sengaja beda dari uploadVideo/
   * uploadImage yang saling meng-clear satu sama lain.
   */
  async uploadHeaderWordmark(tenantId: string, buffer: Buffer, mime: string) {
    await this.ensureExists(tenantId);
    const { url } = await this.storage.saveImage(buffer, mime, 'tenant-wordmarks');
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { headerWordmarkUrl: true },
    });
    await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, headerWordmarkUrl: url },
      update: { headerWordmarkUrl: url },
    });
    if (existing?.headerWordmarkUrl && existing.headerWordmarkUrl !== url) {
      await this.storage.deleteByUrl(existing.headerWordmarkUrl);
    }
    return { header_wordmark_url: url };
  }

  /**
   * Hapus file wordmark. TIDAK auto-revert headerMode ke 'generated' — kalau
   * wordmark dihapus saat mode masih 'wordmark', kiosk fallback ke teks
   * (lihat guard defensif di kiosk-home.tsx) sampai mode diganti manual.
   */
  async removeHeaderWordmark(tenantId: string) {
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { headerWordmarkUrl: true },
    });
    if (existing?.headerWordmarkUrl) {
      await this.prisma.tenantTheme.update({ where: { tenantId }, data: { headerWordmarkUrl: null } });
      await this.storage.deleteByUrl(existing.headerWordmarkUrl);
    }
    return { header_wordmark_url: null };
  }

  /**
   * Latar display board. Pola identik dengan uploadHeaderWordmark: TIDAK XOR
   * dengan apa pun, TIDAK menyentuh displayBackgroundMode — upload murni set
   * URL; toggle mode terpisah lewat updateTheme (dto.display_background_mode).
   */
  async uploadDisplayBackground(tenantId: string, buffer: Buffer, mime: string) {
    await this.ensureExists(tenantId);
    const { url } = await this.storage.saveImage(buffer, mime, 'tenant-display-bg');
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { displayBackgroundUrl: true },
    });
    await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, displayBackgroundUrl: url },
      update: { displayBackgroundUrl: url },
    });
    if (existing?.displayBackgroundUrl && existing.displayBackgroundUrl !== url) {
      await this.storage.deleteByUrl(existing.displayBackgroundUrl);
    }
    return { display_background_url: url };
  }

  /**
   * Hapus file latar. TIDAK auto-revert displayBackgroundMode ke 'default' —
   * kalau latar dihapus saat mode masih 'custom', board jatuh ke aset bawaan
   * (guard defensif di display-board.tsx) sampai mode diganti manual.
   */
  async removeDisplayBackground(tenantId: string) {
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { displayBackgroundUrl: true },
    });
    if (existing?.displayBackgroundUrl) {
      await this.prisma.tenantTheme.update({ where: { tenantId }, data: { displayBackgroundUrl: null } });
      await this.storage.deleteByUrl(existing.displayBackgroundUrl);
    }
    return { display_background_url: null };
  }

  /**
   * E7: set video signage instansi. File SUDAH ditulis multer diskStorage ke
   * disk sebelum method ini jalan — jadi kalau tenant ternyata tak ada, file
   * itu harus dibersihkan supaya tidak jadi yatim. Video lama (kalau ada)
   * dihapus setelah baris DB berhasil diperbarui.
   */
  async uploadVideo(tenantId: string, filename: string) {
    const url = await this.storage.commitVideo(filename);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      await this.storage.deleteByUrl(url); // bersihkan file yatim
      throw new NotFoundException('Instansi tidak ditemukan');
    }

    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { videoUrl: true, imageUrl: true },
    });
    // XOR: set video → clear foto (dan hapus file-nya).
    await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, videoUrl: url, imageUrl: null },
      update: { videoUrl: url, imageUrl: null },
    });
    if (existing?.videoUrl && existing.videoUrl !== url) {
      await this.storage.deleteByUrl(existing.videoUrl);
    }
    if (existing?.imageUrl) await this.storage.deleteByUrl(existing.imageUrl);
    return { video_url: url };
  }

  /**
   * Media Display FOTO (XOR dengan video). File kecil (≤2 MB) via memoryStorage,
   * jadi buffer langsung. Set foto → clear video (& hapus file video lama).
   */
  async uploadImage(tenantId: string, buffer: Buffer, mime: string) {
    await this.ensureExists(tenantId);
    const { url } = await this.storage.saveImage(buffer, mime, 'tenant-display');
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { videoUrl: true, imageUrl: true },
    });
    await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, imageUrl: url, videoUrl: null },
      update: { imageUrl: url, videoUrl: null },
    });
    if (existing?.imageUrl && existing.imageUrl !== url) {
      await this.storage.deleteByUrl(existing.imageUrl);
    }
    if (existing?.videoUrl) await this.storage.deleteByUrl(existing.videoUrl);
    return { image_url: url };
  }

  async removeImage(tenantId: string) {
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { imageUrl: true },
    });
    if (existing?.imageUrl) {
      await this.prisma.tenantTheme.update({ where: { tenantId }, data: { imageUrl: null } });
      await this.storage.deleteByUrl(existing.imageUrl);
    }
    return { image_url: null };
  }

  /** Durasi rotasi display (fase antrian vs media). Upsert; hanya field terkirim. */
  async updateDisplayConfig(tenantId: string, dto: UpdateDisplayConfigDto) {
    await this.ensureExists(tenantId);
    const data = {
      ...(dto.queue_view_seconds !== undefined ? { queueViewSeconds: dto.queue_view_seconds } : {}),
      ...(dto.media_view_seconds !== undefined ? { mediaViewSeconds: dto.media_view_seconds } : {}),
    };
    const theme = await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return toWireTheme(theme);
  }

  /**
   * Set teks berjalan display. Kosong/whitespace → null supaya display pakai
   * teks default. Upsert karena baris theme mungkin belum ada.
   */
  async updateRunningText(tenantId: string, runningText: string) {
    await this.ensureExists(tenantId);
    const value = runningText.trim() || null;
    const theme = await this.prisma.tenantTheme.upsert({
      where: { tenantId },
      create: { tenantId, runningText: value },
      update: { runningText: value },
    });
    return toWireTheme(theme);
  }

  /** E7: hapus video → display kembali ke layout nomor antrian (fallback). */
  async removeVideo(tenantId: string) {
    const existing = await this.prisma.tenantTheme.findUnique({
      where: { tenantId },
      select: { videoUrl: true },
    });
    if (existing?.videoUrl) {
      await this.prisma.tenantTheme.update({ where: { tenantId }, data: { videoUrl: null } });
      await this.storage.deleteByUrl(existing.videoUrl);
    }
    return { video_url: null };
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async ensureExists(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan');
  }

  private revokeTenantSessions(tenantId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { revokedAt: null, user: { tenantId } },
      data: { revokedAt: new Date() },
    });
  }

  private themeData(dto: UpdateThemeDto) {
    return {
      ...(dto.primary_color !== undefined ? { primaryColor: dto.primary_color } : {}),
      ...(dto.secondary_color !== undefined ? { secondaryColor: dto.secondary_color } : {}),
      ...(dto.accent_color !== undefined ? { accentColor: dto.accent_color } : {}),
      ...(dto.text_color !== undefined ? { textColor: dto.text_color } : {}),
      ...(dto.background_color !== undefined ? { backgroundColor: dto.background_color } : {}),
      ...(dto.logo_url !== undefined ? { logoUrl: dto.logo_url } : {}),
      ...(dto.favicon_url !== undefined ? { faviconUrl: dto.favicon_url } : {}),
      ...(dto.custom_css !== undefined ? { customCss: dto.custom_css } : {}),
      ...(dto.is_custom_theme !== undefined ? { isCustomTheme: dto.is_custom_theme } : {}),
      ...(dto.header_mode !== undefined ? { headerMode: dto.header_mode } : {}),
      ...(dto.display_background_mode !== undefined
        ? { displayBackgroundMode: dto.display_background_mode }
        : {}),
      ...(dto.header_title_font !== undefined ? { headerTitleFont: dto.header_title_font } : {}),
      ...(dto.header_title_bold !== undefined ? { headerTitleBold: dto.header_title_bold } : {}),
      ...(dto.header_subtitle_text !== undefined
        ? { headerSubtitleText: dto.header_subtitle_text.trim() || null }
        : {}),
      ...(dto.header_subtitle_font !== undefined ? { headerSubtitleFont: dto.header_subtitle_font } : {}),
      ...(dto.header_subtitle_bold !== undefined ? { headerSubtitleBold: dto.header_subtitle_bold } : {}),
      ...(dto.header_subtitle_size !== undefined ? { headerSubtitleSize: dto.header_subtitle_size } : {}),
      ...(dto.header_subtitle_color !== undefined ? { headerSubtitleColor: dto.header_subtitle_color } : {}),
    };
  }
}
