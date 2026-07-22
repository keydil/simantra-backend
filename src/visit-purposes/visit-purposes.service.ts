import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { toWireVisitPurpose } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVisitPurposeDto, UpdateVisitPurposeDto } from './dto/visit-purposes.dto';

// 6 kategori default — dipakai seed on-create tenant baru (tenants.service) DAN
// backfill tenant lama. Urutan array = sort_order.
export const DEFAULT_VISIT_PURPOSES = [
  'Konsultasi Layanan',
  'Bertemu Pejabat/Staf',
  'Pengaduan',
  'Informasi Umum',
  'Keperluan Administratif',
  'Lainnya',
];

@Injectable()
export class VisitPurposesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff (admin kelola) — semua baris, termasuk nonaktif, urut sort_order. */
  async listByTenant(tenantId: string) {
    const rows = await this.prisma.visitPurpose.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toWireVisitPurpose);
  }

  /** Publik (form buku tamu anonim) — hanya aktif, urut sort_order. */
  async listPublic(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: slug, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');

    const rows = await this.prisma.visitPurpose.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toWireVisitPurpose);
  }

  async create(tenantId: string, dto: CreateVisitPurposeDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan');

    // Kalau sort_order tak dikirim, taruh di paling bawah.
    const sortOrder = dto.sort_order ?? (await this.nextSortOrder(tenantId));

    const row = await this.prisma.visitPurpose.create({
      data: { tenantId, label: dto.label, sortOrder },
    });
    return toWireVisitPurpose(row);
  }

  async update(id: string, dto: UpdateVisitPurposeDto, caller: AuthUser) {
    await this.getScoped(id, caller);
    const row = await this.prisma.visitPurpose.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });
    return toWireVisitPurpose(row);
  }

  async softDelete(id: string, caller: AuthUser) {
    await this.getScoped(id, caller);
    const row = await this.prisma.visitPurpose.update({
      where: { id },
      data: { isActive: false },
    });
    return toWireVisitPurpose(row);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async nextSortOrder(tenantId: string) {
    const last = await this.prisma.visitPurpose.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last ? last.sortOrder + 1 : 0;
  }

  private async getScoped(id: string, caller: AuthUser) {
    const row = await this.prisma.visitPurpose.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Kategori keperluan tidak ditemukan');
    if (caller.role !== 'superadmin' && row.tenantId !== caller.tenantId) {
      throw new ForbiddenException('Tidak punya akses ke kategori ini');
    }
    return row;
  }
}
