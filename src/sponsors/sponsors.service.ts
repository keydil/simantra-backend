import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { toWireSponsor } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateSponsorDto } from './dto/sponsors.dto';

const MAX_SPONSORS_PER_TENANT = 8;

@Injectable()
export class SponsorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Staff (admin kelola) — semua baris, termasuk nonaktif, urut sort_order. */
  async listByTenant(tenantId: string) {
    const rows = await this.prisma.sponsor.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toWireSponsor);
  }

  /** Publik (display board) — hanya aktif, urut sort_order. */
  async listPublic(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: slug, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');

    const rows = await this.prisma.sponsor.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toWireSponsor);
  }

  async create(tenantId: string, buffer: Buffer, mime: string, name?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan');

    const count = await this.prisma.sponsor.count({ where: { tenantId } });
    if (count >= MAX_SPONSORS_PER_TENANT) {
      throw new BadRequestException(`Maksimal ${MAX_SPONSORS_PER_TENANT} logo sponsor per instansi`);
    }

    const { url } = await this.storage.saveImage(buffer, mime, 'sponsor-logos');
    const sortOrder = await this.nextSortOrder(tenantId);

    const row = await this.prisma.sponsor.create({
      data: { tenantId, imageUrl: url, name: name?.trim() || null, sortOrder },
    });
    return toWireSponsor(row);
  }

  async update(id: string, dto: UpdateSponsorDto, caller: AuthUser) {
    await this.getScoped(id, caller);
    const row = await this.prisma.sponsor.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });
    return toWireSponsor(row);
  }

  async remove(id: string, caller: AuthUser) {
    const existing = await this.getScoped(id, caller);
    await this.prisma.sponsor.delete({ where: { id } });
    await this.storage.deleteByUrl(existing.imageUrl);
    return { id };
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async nextSortOrder(tenantId: string) {
    const last = await this.prisma.sponsor.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last ? last.sortOrder + 1 : 0;
  }

  private async getScoped(id: string, caller: AuthUser) {
    const row = await this.prisma.sponsor.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Logo sponsor tidak ditemukan');
    if (caller.role !== 'superadmin' && row.tenantId !== caller.tenantId) {
      throw new ForbiddenException('Tidak punya akses ke sponsor ini');
    }
    return row;
  }
}
