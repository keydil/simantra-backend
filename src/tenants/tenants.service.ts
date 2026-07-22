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
import { CreateTenantDto, ListTenantsQueryDto, UpdateTenantDto, UpdateThemeDto } from './dto/tenants.dto';

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
    const fileUrls = [tenant.logoUrl, ...photos.map((p) => p.photoUrl)].filter(
      (u): u is string => !!u,
    );

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
    };
  }
}
